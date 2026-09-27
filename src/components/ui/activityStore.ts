import { create } from 'zustand';
import type { Tone } from './tone';
import type { Toast, ToastAction } from './toastStore';

/**
 * The Activity log: every toast the app shows, kept for the session (and the newest few across
 * a reload) so a notice that faded can still be read, and its button still pressed where that
 * still makes sense. Shown in the History panel; the rail icon counts the ones not seen yet.
 */

export type ActivityKind = 'info' | 'success' | 'warning' | 'error';

export interface ActivityEntry {
  id: number;
  at: number;
  kind: ActivityKind;
  title: string;
  message?: string;
  details?: string;
  action?: ToastAction;
  /** Pressed once already (from the toast or the log): not offered again. */
  actionUsed?: boolean;
  /** Restored from browser storage: from before this reload, without its button. */
  earlier?: boolean;
}

export const ACTIVITY_CAP = 200;
/** How many entries survive a reload. */
export const ACTIVITY_PERSIST = 50;
/** An "Undo" button without its own check stays usable this long after its toast. */
export const UNDO_ACTION_TTL_MS = 60_000;
const STORAGE_KEY = 'playfield:activity-log';

export const toneKind = (tone: Tone): ActivityKind => (tone === 'danger' ? 'error' : tone);

interface ActivityState {
  entries: ActivityEntry[];
  /** Highest id the person has seen (the panel was open when it arrived, or since). */
  seenId: number;
  /** How many Activity views are on screen; while any is, new entries count as seen. */
  watching: number;
  add: (t: Omit<Toast, 'id'>) => number;
  clear: () => void;
  markSeen: () => void;
  watch: () => () => void;
  /** Run an entry's button, once. Returns false when it no longer applies. */
  runAction: (id: number) => boolean;
  /** The toast for this entry had its button pressed. */
  markActionUsed: (id: number) => void;
}

function load(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((e): e is Omit<ActivityEntry, 'id'> => !!e && typeof e === 'object' && typeof (e as ActivityEntry).title === 'string' && typeof (e as ActivityEntry).at === 'number')
      .slice(-ACTIVITY_PERSIST)
      .map((e, i) => ({ id: i + 1, at: e.at, kind: e.kind, title: e.title, message: e.message, details: e.details, earlier: true }));
  } catch { return []; }
}

function save(entries: ActivityEntry[]): void {
  try {
    const keep = entries.slice(-ACTIVITY_PERSIST).map(({ at, kind, title, message, details }) => ({ at, kind, title, message, details }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
  } catch { /* storage full or blocked: the log still works for this session */ }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const saveSoon = (entries: ActivityEntry[]) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; save(entries); }, 400);
};

const initial = load();
let nextId = (initial[initial.length - 1]?.id ?? 0) + 1;

/** Can this entry's button still be pressed? */
export function actionAvailable(e: ActivityEntry, now = Date.now()): boolean {
  const a = e.action;
  if (!a || e.actionUsed || e.earlier) return false;
  if (a.stillValid) {
    try { return a.stillValid(); } catch { return false; }
  }
  // An Undo from a toast undoes what it was about only while nothing else has happened since:
  // without its own check, it's offered for a minute.
  if (/^undo\b/i.test(a.label)) return now - e.at < UNDO_ACTION_TTL_MS;
  return true;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  entries: initial,
  seenId: nextId - 1,
  watching: 0,
  add: (t) => {
    const id = nextId++;
    const entry: ActivityEntry = { id, at: Date.now(), kind: toneKind(t.tone), title: t.title, message: t.message, details: t.details, action: t.action };
    set(s => {
      const entries = [...s.entries, entry];
      if (entries.length > ACTIVITY_CAP) entries.splice(0, entries.length - ACTIVITY_CAP);
      saveSoon(entries);
      return { entries, seenId: s.watching > 0 ? id : s.seenId };
    });
    return id;
  },
  clear: () => {
    set({ entries: [], seenId: nextId - 1 });
    saveSoon([]);
  },
  markSeen: () => { if (get().seenId !== nextId - 1) set({ seenId: nextId - 1 }); },
  watch: () => {
    set(s => ({ watching: s.watching + 1, seenId: nextId - 1 }));
    return () => set(s => ({ watching: Math.max(0, s.watching - 1) }));
  },
  runAction: (id) => {
    const e = get().entries.find(x => x.id === id);
    if (!e || !actionAvailable(e)) return false;
    get().markActionUsed(id);
    e.action!.onClick();
    return true;
  },
  markActionUsed: (id) => set(s => ({ entries: s.entries.map(x => (x.id === id ? { ...x, actionUsed: true } : x)) })),
}));

/** Unseen entries, and whether any of them is an error (the badge turns red). */
export function useUnseenActivity(): { count: number; error: boolean } {
  const count = useActivityStore(s => { let n = 0; for (let i = s.entries.length - 1; i >= 0 && s.entries[i].id > s.seenId; i--) n++; return n; });
  const error = useActivityStore(s => { for (let i = s.entries.length - 1; i >= 0 && s.entries[i].id > s.seenId; i--) if (s.entries[i].kind === 'error') return true; return false; });
  return { count, error };
}
