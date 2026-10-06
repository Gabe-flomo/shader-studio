import { C, C_LIGHT, tokenizeLine, type Token } from '../../glslSyntax';

/**
 * GLSL highlighting for the code cards, memoised per code string and theme: the same
 * tokenizer and colours as the GLSL page and the code editors. A card re-renders when its
 * node changes; an unchanged block costs a map lookup. Least recently used entries go first.
 */
const cache = new Map<string, Token[][]>();
const MAX = 300;

export function highlightGlsl(code: string, dark: boolean): Token[][] {
  const key = `${dark ? 'd' : 'l'}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); cache.set(key, hit);
    return hit;
  }
  const pal = dark ? C : C_LIGHT;
  const lines = code.split('\n').map(l => tokenizeLine(l, pal));
  cache.set(key, lines);
  if (cache.size > MAX) cache.delete(cache.keys().next().value as string);
  return lines;
}

/** For tests: how many highlighted blocks are cached. */
export function highlightCacheSize(): number { return cache.size; }
