import type { NodeDefinition } from '../types/nodeGraph';

/**
 * Search score for a node definition (0 = no match). Substring/prefix only, no fuzzy scatter.
 * Old names (`aliases`) rank just under the current label, so "Make Light" still finds
 * SDF Glow after a rename.
 */
export function scoreNodeDef(def: NodeDefinition, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const label = def.label.toLowerCase();
  if (label === q) return 120;
  if (label.startsWith(q)) return 100;
  const aliases = (def.aliases ?? []).map(a => a.toLowerCase());
  if (aliases.some(a => a === q || a.startsWith(q))) return 90;
  if (label.includes(q)) return 80;
  if (aliases.some(a => a.includes(q))) return 70;
  if (def.type.toLowerCase().includes(q)) return 60;
  // Category word starts with the query (word boundary, so "sign" won't match "design")
  const cat = (def.category ?? '').toLowerCase();
  if (cat.split(/[\s/,]+/).some(w => w.startsWith(q))) return 40;
  // Description contains the query as a whole word
  const rawDesc = def.description as string | string[] | undefined;
  const desc = (Array.isArray(rawDesc) ? rawDesc.join(' ') : (rawDesc ?? '')).toLowerCase();
  if (desc.split(/\W+/).some(w => w === q)) return 20;
  return 0;
}
