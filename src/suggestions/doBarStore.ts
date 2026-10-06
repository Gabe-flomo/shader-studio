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
  setDoBarHighlight(null);
}

/**
 * Nodes the Do… bar points at on the canvas (the candidates of a pick, the nodes a step makes),
 * or null. The canvas dims the rest while it is set.
 */
export const useDoBarHighlight = create<{ ids: string[] | null }>(() => ({ ids: null }));

export function setDoBarHighlight(ids: string[] | null): void {
  const cur = useDoBarHighlight.getState().ids;
  if (cur === ids || (cur && ids && cur.length === ids.length && cur.every((x, i) => x === ids[i]))) return;
  useDoBarHighlight.setState({ ids: ids && ids.length ? ids : null });
}

/** The Commands reference (docs/do-bar-commands.md): open, and what to search for. */
export const useCommandsRef = create<{ open: boolean; query: string }>(() => ({ open: false, query: '' }));

export function openCommandsRef(query = ''): void {
  useCommandsRef.setState({ open: true, query });
}

export function closeCommandsRef(): void {
  useCommandsRef.setState({ open: false });
}
