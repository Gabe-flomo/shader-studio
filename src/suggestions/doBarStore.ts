/**
 * doBarStore.ts — whether the Do… bar is open, and what it opened for: a phrase, the connection
 * check of one wire (right-click a wire's + badge), or teaching the selection.
 */
import { create } from 'zustand';
import type { Wire4 } from './connectionCheck';

export interface DoBarOpen {
  /** Text to start with. */
  text?: string;
  /** Check this wire straight away ("Is this typical?"). */
  check?: Wire4[];
}

export const useDoBar = create<{ open: DoBarOpen | null; seq: number }>(() => ({ open: null, seq: 0 }));

export function openDoBar(o: DoBarOpen = {}): void {
  useDoBar.setState(s => ({ open: o, seq: s.seq + 1 }));
}

export function closeDoBar(): void {
  useDoBar.setState({ open: null });
}
