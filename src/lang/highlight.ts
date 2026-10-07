/**
 * highlight.ts — word colours for every dialect from the registry (docs/playfield-language-plan.md
 * §8.1): the recipe highlighter (sceneBuilder/highlight.ts) colours the shared lexer's tokens, and
 * this says what a word is in a dialect (a header, a maker, a step, a combine, a setting…), so a
 * Grid Rules or Agent Rules line is coloured the same way a recipe is.
 */
import type { RecipeKind, WordKind } from '../sceneBuilder/highlight';
import { entriesFor, registry, type Dialect, type EntryKind } from './registry';

const KIND: Record<EntryKind, RecipeKind> = {
  header: 'mode', maker: 'shape', step: 'warp', combine: 'op', setting: 'setting', output: 'setting', verb: 'setting',
  condition: 'warp', action: 'op', modifier: 'warp',
};

/** Words that glue a line together in rules and edits. */
const GLUE: Record<string, RecipeKind> = {
  when: 'mode', always: 'mode', do: 'mode', and: 'punct', not: 'op', grid: 'mode', species: 'mode', agents: 'mode', pass: 'mode',
  it: 'name', this: 'name', these: 'name', picture: 'name', random: 'number', seed: 'key',
};

const cache = new Map<string, WordKind>();

/** A word's colour in `dialects` (the first that knows it), or null. */
export function wordKindFor(...dialects: Dialect[]): WordKind {
  const key = `${dialects.join('+')}:${registry().length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const map = new Map<string, RecipeKind>();
  for (const d of dialects) for (const e of entriesFor(d)) for (const w of e.words) if (!map.has(w)) map.set(w, KIND[e.kind]);
  for (const [w, k] of Object.entries(GLUE)) if (!map.has(w)) map.set(w, k);
  const fn: WordKind = (w: string) => map.get(w) ?? null;
  cache.set(key, fn);
  return fn;
}
