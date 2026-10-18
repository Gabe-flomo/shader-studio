/**
 * plainDescriptions.ts — plain-words blurbs for the node list, the search and the preview card,
 * where a node's own description is written for someone who already knows it (UX audit §3.6).
 * Read through `nodeBlurb`, which falls back to the definition's description. When a definition's
 * own description is rewritten in plain words, its entry here can go.
 */
import type { NodeDefinition } from '../types/nodeGraph';

const PLAIN: Record<string, string> = {
  exprNode: 'A few lines of GLSL math on one card. Name its inputs (each can have a slider), work out some values line by line, and return the result. ⟴ opens the editor.',
  transformVec: 'Change each part of a vector (x, y, z, w) with its own small formula, then put it back together. Handy for a quick warp of UV.',
};

/** What to say about `def` in lists and previews. */
export function nodeBlurb(def: Pick<NodeDefinition, 'type' | 'description'> | undefined | null): string | undefined {
  if (!def) return undefined;
  const plain = PLAIN[def.type];
  if (plain) return plain;
  const raw = def.description as string | string[] | undefined;
  return Array.isArray(raw) ? raw.join('\n') : raw;
}
