/**
 * showHowStore.ts — the Show me how window (ShowHowWindow.tsx): open, and on what line.
 */
import { create } from 'zustand';
import type { HowInput } from './showHow';
import type { Dialect } from '../lang/registry';

export interface ShowHowOpen extends HowInput {
  /** The dialect the line came from (for its colours). */
  dialect?: Dialect;
  /** The line as typed, shown at the top (`text` is what runs: the bar's sentence for a canonical line). */
  label?: string;
}

export const useShowHow = create<{ open: ShowHowOpen | null; seq: number }>(() => ({ open: null, seq: 0 }));

export function openShowHow(o: ShowHowOpen): void {
  useShowHow.setState(s => ({ open: o, seq: s.seq + 1 }));
}

export function closeShowHow(): void {
  useShowHow.setState({ open: null });
}
