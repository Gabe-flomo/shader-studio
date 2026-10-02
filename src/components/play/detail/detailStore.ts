/**
 * detailStore — the detail window's history (implementation guide 7.3): what
 * it shows (a control, a source or a signal), with back and forward like a
 * browser. Opening something new drops what was ahead. UI state only.
 */
import { create } from 'zustand';

export type DetailKind = 'control' | 'source' | 'signal';
export interface DetailRef { kind: DetailKind; id: string }

interface DetailState {
  stack: DetailRef[];
  /** Where in the stack the window is (-1: closed). */
  at: number;
  open: (ref: DetailRef) => void;
  back: () => void;
  forward: () => void;
  close: () => void;
}

const same = (a: DetailRef | undefined, b: DetailRef) => !!a && a.kind === b.kind && a.id === b.id;

export const useDetail = create<DetailState>((set, get) => ({
  stack: [],
  at: -1,
  open: ref => {
    const { stack, at } = get();
    if (same(stack[at], ref)) return;
    const kept = stack.slice(0, at + 1);
    set({ stack: [...kept, ref].slice(-50), at: Math.min(kept.length, 49) });
  },
  back: () => set(s => ({ at: Math.max(0, s.at - 1) })),
  forward: () => set(s => ({ at: Math.min(s.stack.length - 1, s.at + 1) })),
  close: () => set({ stack: [], at: -1 }),
}));

/** Open the detail window on something (from anywhere). */
export function openDetail(kind: DetailKind, id: string): void {
  useDetail.getState().open({ kind, id });
}
