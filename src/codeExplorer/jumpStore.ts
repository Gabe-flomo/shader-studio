/**
 * jumpStore.ts — a pending "jump to source" (docs/code-explorer-plan.md §10.3).
 *
 * The Explorer opens the graph and selects the node; the node's card (which
 * owns its editors) sees a request for itself here, opens the right editor,
 * and the editor takes the request and scrolls to the line. The GLSL page
 * does the same for shaders and files. Tiny and dependency-free, because the
 * node card imports it.
 */
import { create } from 'zustand';

export interface NodeJump { nodeId: string; field: string; line: number; column: number; length: number; n: number; at: number }
export interface TextJump { kind: 'shader' | 'file'; id?: string; text?: string; label?: string; line: number; column: number; length: number; n: number; at: number }

export const useCodeJump = create<{ node: NodeJump | null; text: TextJump | null }>(() => ({ node: null, text: null }));

/** Requests older than this are ignored (the node never showed up). */
export const JUMP_TTL_MS = 15_000;

export function requestNodeJump(j: Omit<NodeJump, 'n' | 'at'>): void {
  useCodeJump.setState(s => ({ node: { ...j, n: (s.node?.n ?? 0) + 1, at: Date.now() } }));
}

export function requestTextJump(j: Omit<TextJump, 'n' | 'at'>): void {
  useCodeJump.setState(s => ({ text: { ...j, n: (s.text?.n ?? 0) + 1, at: Date.now() } }));
}

/** The pending jump for this node, if fresh; taking it clears it. */
export function takeNodeJump(nodeId: string): NodeJump | null {
  const j = useCodeJump.getState().node;
  if (!j || j.nodeId !== nodeId) return null;
  useCodeJump.setState({ node: null });
  return Date.now() - j.at <= JUMP_TTL_MS ? j : null;
}

export function takeTextJump(): TextJump | null {
  const j = useCodeJump.getState().text;
  if (!j) return null;
  useCodeJump.setState({ text: null });
  return Date.now() - j.at <= JUMP_TTL_MS ? j : null;
}

/** For a node card: a number that changes when a jump to this node is requested (0: none). */
export const nodeJumpSignal = (nodeId: string) => (s: { node: NodeJump | null }) => (s.node && s.node.nodeId === nodeId ? s.node.n : 0);
