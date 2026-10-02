/**
 * Input names on a placed node: a clearer name and a description for any of
 * its inputs, chosen on the card (Input names…), without touching its code.
 * Kept in the node's params (`__inputLabels`, `__inputHints`, by socket key);
 * publishing the node as a node type carries them into the Node Builder.
 */
import type { GraphNode } from '../types/nodeGraph';

type Texts = Record<string, string>;
const textsOf = (node: Pick<GraphNode, 'params'>, k: '__inputLabels' | '__inputHints'): Texts => {
  const v = node.params[k];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Texts) : {};
};

/** The name an input shows: its chosen one, else its own. */
export function inputLabelOf(node: Pick<GraphNode, 'params'>, key: string, fallback: string): string {
  const v = textsOf(node, '__inputLabels')[key];
  return typeof v === 'string' && v.trim() ? v : fallback;
}

/** An input's chosen description, or ''. */
export function inputHintOf(node: Pick<GraphNode, 'params'>, key: string): string {
  const v = textsOf(node, '__inputHints')[key];
  return typeof v === 'string' ? v : '';
}

/** The params patch that sets (or, with '', clears) an input's name or description. */
export function inputTextPatch(node: Pick<GraphNode, 'params'>, kind: 'label' | 'hint', key: string, text: string): Record<string, unknown> {
  const field = kind === 'label' ? '__inputLabels' : '__inputHints';
  const next: Texts = { ...textsOf(node, field) };
  if (text.trim()) next[key] = text.slice(0, kind === 'label' ? 60 : 300); else delete next[key];
  return { [field]: Object.keys(next).length ? next : undefined };
}

/** Every chosen name and description, by socket key (what publishing carries over). */
export function inputTexts(node: Pick<GraphNode, 'params'>): Record<string, { label?: string; hint?: string }> {
  const out: Record<string, { label?: string; hint?: string }> = {};
  for (const [k, v] of Object.entries(textsOf(node, '__inputLabels'))) if (v.trim()) out[k] = { ...out[k], label: v };
  for (const [k, v] of Object.entries(textsOf(node, '__inputHints'))) if (v.trim()) out[k] = { ...out[k], hint: v };
  return out;
}
