import { create } from 'zustand';

/**
 * The clip open in the piano roll window (PianoRollWindow.tsx): its rack and a
 * time inside it; `key` changes on each open so the view refits.
 */
interface PianoRollWindowState {
  target: { rack: string; t: number; key: number } | null;
  open: (rack: string, t: number) => void;
  /** The clip's start moved (a trim): keep pointing inside it. */
  setAnchor: (t: number) => void;
  close: () => void;
}

export const usePianoRollWindow = create<PianoRollWindowState>(set => ({
  target: null,
  open: (rack, t) => set(s => ({ target: { rack, t, key: (s.target?.key ?? 0) + 1 } })),
  setAnchor: t => set(s => (s.target ? { target: { ...s.target, t } } : s)),
  close: () => set(s => (s.target ? { target: null } : s)),
}));
