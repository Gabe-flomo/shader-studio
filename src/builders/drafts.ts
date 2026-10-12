/**
 * drafts.ts — a builder's unbuilt edits are never lost. While the 2D, 3D or Grid Scene Builder has
 * edits the graph doesn't have yet, they are kept as a draft in this browser's storage (written a
 * moment after each change, and at once when the window closes), so a close, a reload or a crash
 * leaves them where reopening the builder on the same scene finds them. A build clears the draft;
 * so does "Discard" in the close prompt (builders/finish.ts).
 *
 * One draft per scene (its target id, or "new" for one not built yet), the newest few per kind.
 * No graph-store import here: the builder stores wire themselves up with keepDrafts.
 */
import { toast } from '../components/ui/toastStore';

export type DraftKind = '2d' | '3d' | 'grid';

/** What a builder store has that the drafts read. */
export interface DraftableState {
  open: boolean;
  dirty: boolean;
  past: unknown[];
  future: unknown[];
  targetSceneId: string | null;
  at: { x: number; y: number } | null;
}

export interface Draft<T = unknown> {
  target: string | null;
  spec: T;
  at: { x: number; y: number } | null;
  savedAt: number;
}

interface StoreLike<S> {
  getState: () => S;
  setState: (partial: Partial<S>) => void;
  subscribe: (fn: (s: S, prev: S) => void) => () => void;
}

const STORAGE_PREFIX = 'playfield.builderDraft.';
const KEEP = 8;
const SAVE_DELAY_MS = 400;

const keyOf = (target: string | null) => target ?? 'new';

/**
 * Edits the graph doesn't have: changed since the last build (or since opening a built scene). A new
 * scene that was only opened (its starter, a template) has nothing of the user's in it yet.
 */
export function hasUnbuiltEdits(s: DraftableState): boolean {
  return s.dirty && (s.targetSceneId != null || s.past.length > 0 || s.future.length > 0);
}

function readAll(kind: DraftKind): Record<string, Draft> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + kind);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, Draft> : {};
  } catch { return {}; }
}

function writeAll(kind: DraftKind, all: Record<string, Draft>): void {
  try {
    const entries = Object.entries(all).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, KEEP);
    if (!entries.length) globalThis.localStorage?.removeItem(STORAGE_PREFIX + kind);
    else globalThis.localStorage?.setItem(STORAGE_PREFIX + kind, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* storage full or blocked: the builder's own state still has the edits */ }
}

/** The draft kept for a scene (`target` null: a new one), if any. */
export function readDraft<T = unknown>(kind: DraftKind, target: string | null): Draft<T> | null {
  const d = readAll(kind)[keyOf(target)];
  return d && d.spec ? d as Draft<T> : null;
}

export function saveDraft(kind: DraftKind, d: Omit<Draft, 'savedAt'>): void {
  const all = readAll(kind);
  all[keyOf(d.target)] = { ...d, savedAt: Date.now() };
  writeAll(kind, all);
}

const timers = new Map<DraftKind, ReturnType<typeof setTimeout>>();
const cancelSave = (kind: DraftKind) => { const t = timers.get(kind); if (t) clearTimeout(t); timers.delete(kind); };

/** Forget the drafts of these scenes (built, or discarded). */
export function clearDraft(kind: DraftKind, ...targets: Array<string | null>): void {
  cancelSave(kind);
  const all = readAll(kind);
  let changed = false;
  for (const t of targets) if (keyOf(t) in all) { delete all[keyOf(t)]; changed = true; }
  if (changed) writeAll(kind, all);
}

/**
 * Keep a builder store's unbuilt edits as a draft: a moment after each change while it has some,
 * at once when it closes with some, and cleared when they are built. Returns the unsubscribe.
 */
export function keepDrafts<S extends DraftableState>(kind: DraftKind, store: StoreLike<S>, specOf: (s: S) => unknown): () => void {
  const draftOf = (s: S) => ({ target: s.targetSceneId, spec: specOf(s), at: s.at });
  return store.subscribe((s, prev) => {
    // Closing: write what it had now, not after the delay.
    if (prev.open && !s.open) {
      cancelSave(kind);
      if (hasUnbuiltEdits(prev)) saveDraft(kind, draftOf(prev));
      return;
    }
    if (!s.open) return;
    // Built: the graph has it now.
    if (prev.open && prev.dirty && !s.dirty) {
      clearDraft(kind, prev.targetSceneId, s.targetSceneId);
      return;
    }
    if (!hasUnbuiltEdits(s)) return;
    if (specOf(s) === specOf(prev) && s.targetSceneId === prev.targetSceneId && prev.open) return;
    cancelSave(kind);
    timers.set(kind, setTimeout(() => {
      timers.delete(kind);
      const now = store.getState();
      if (now.open && hasUnbuiltEdits(now)) saveDraft(kind, draftOf(now));
    }, SAVE_DELAY_MS));
  });
}

/**
 * Opening a builder on a scene with a draft: open the draft instead (`open`), one builder undo away
 * from `original` (the scene as built, or the starter), with a note that offers to start fresh.
 * False when there is no draft (open as usual).
 */
export function reopenDraft<T, S extends DraftableState>(o: {
  kind: DraftKind;
  store: StoreLike<S>;
  target: string | null;
  original: T;
  label: string;
  open: (spec: T, at: { x: number; y: number } | null) => void;
  startFresh: () => void;
}): boolean {
  const d = readDraft<T>(o.kind, o.target);
  if (!d) return false;
  o.open(d.spec, d.at);
  o.store.setState({ past: [o.original], future: [], dirty: true } as unknown as Partial<S>);
  toast.info(`Your unbuilt ${o.label} is back`, {
    message: 'The edits you made last time, not built yet. Done builds them; Undo in the builder goes back to the scene as it was.',
    action: { label: 'Start fresh', onClick: () => { clearDraft(o.kind, o.target); o.startFresh(); } },
  });
  return true;
}
