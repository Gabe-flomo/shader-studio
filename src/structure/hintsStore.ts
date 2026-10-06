/**
 * hintsStore.ts — the structure hints' preferences and live state (docs/structure-hints.md):
 * whether the flow strip shows, whether cards carry a stage tag, whether order notices are on,
 * which notices were dismissed in which graph; and, live, the stage the strip hints next (the
 * rankers give it a small boost) and the stage the node browser is filtered to.
 *
 * Preferences live in localStorage (each read and write guarded: a private window still works).
 */
import { create } from 'zustand';
import type { FlowId, StageId } from './stages';

export const STRIP_KEY = 'playfield:structure:strip';
export const TAGS_KEY = 'playfield:structure:tags';
export const NOTICES_KEY = 'playfield:structure:notices';
export const DISMISSED_KEY = 'playfield:structure:dismissed';

function read(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch { return fallback; }
}
function write(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* kept for this session only */ }
}
function readDismissed(): Record<string, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string[]> : {};
  } catch { return {}; }
}

export interface StageTarget { flow: FlowId; stage: StageId }

interface HintsState {
  /** The flow strip above the canvas (hidden is remembered). */
  stripOn: boolean;
  /** A faint stage colour on each card's edge. */
  tagsOn: boolean;
  /** Gentle order notices. */
  noticesOn: boolean;
  /** Graph key → dismissed notice ids. */
  dismissed: Record<string, string[]>;
  /** The stage the strip hints next: suggestions, quick add, search and the Do… bar lean to it a little. */
  target: StageTarget | null;
  /** The node browser shows this stage's nodes (a stage clicked on the strip). */
  browse: StageTarget | null;
  setStrip: (on: boolean) => void;
  setTags: (on: boolean) => void;
  setNotices: (on: boolean) => void;
  dismiss: (graph: string, id: string) => void;
  setTarget: (t: StageTarget | null) => void;
  setBrowse: (t: StageTarget | null) => void;
}

export const useStructureHints = create<HintsState>((set, get) => ({
  stripOn: read(STRIP_KEY, true),
  tagsOn: read(TAGS_KEY, true),
  noticesOn: read(NOTICES_KEY, true),
  dismissed: readDismissed(),
  target: null,
  browse: null,
  setStrip: on => { write(STRIP_KEY, on); set({ stripOn: on }); },
  setTags: on => { write(TAGS_KEY, on); set({ tagsOn: on }); },
  setNotices: on => { write(NOTICES_KEY, on); set({ noticesOn: on }); },
  dismiss: (graph, id) => {
    const cur = get().dismissed;
    const list = cur[graph] ?? [];
    if (list.includes(id)) return;
    const next = { ...cur, [graph]: [...list, id] };
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* session only */ }
    set({ dismissed: next });
  },
  setTarget: t => {
    const cur = get().target;
    if (cur?.flow === t?.flow && cur?.stage === t?.stage) return;
    set({ target: t });
  },
  setBrowse: t => set({ browse: t }),
}));

/** The stage the rankers lean to now (null when the strip is hidden: no hint, no boost). */
export function currentStageTarget(): StageTarget | null {
  const s = useStructureHints.getState();
  return s.stripOn ? s.target : null;
}

/** Re-read the preferences (after storage changed elsewhere, and in tests). */
export function reloadStructurePrefs(): void {
  useStructureHints.setState({ stripOn: read(STRIP_KEY, true), tagsOn: read(TAGS_KEY, true), noticesOn: read(NOTICES_KEY, true), dismissed: readDismissed() });
}

/** The key notices are dismissed under: the saved graph's name, or one shared key for unsaved work. */
export const graphKey = (name: string | null | undefined) => name || '(unsaved)';

// App settings' Reset (or another tab) removes or changes a key: follow it.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', e => {
    if (e.key === null || e.key.startsWith('playfield:structure:')) reloadStructurePrefs();
  });
}
