/**
 * synonyms.ts — how people talk → how code is written (docs/code-explorer-plan.md §5.4).
 *
 * Each row's words, typed in a search, add the row's expansions (function names and words) to
 * the query, at a lower weight than the words actually typed. The rows for the Playfield
 * language's words (glow, halo, rings, union, blend, colour by…) come from the language
 * (lang/expand.ts, D17), so the Do… bar and the Code Explorer mean the same by a word; the rows
 * below are for code-only ideas.
 */
import { languageSynonymRows, type SynonymRow } from '../lang/expand';

export type { SynonymRow };

/** Code-only rows: ideas the language has no word for. */
const CODE_ONLY: readonly SynonymRow[] = [
  { words: ['soft', 'smooth', 'feather', 'feathered', 'blur', 'antialias', 'anti-alias', 'aa', 'edge', 'edges'], expand: ['smoothstep', 'fwidth', 'edge', 'antialias'] },
  { words: ['random', 'hash', 'noise', 'grain', 'rand', 'jitter'], expand: ['fract', 'sin', 'dot', 'hash', 'noise', 'fbm', 'hash21', 'hash2'] },
  { words: ['blend', 'fade', 'lerp', 'mix', 'crossfade', 'interpolate', 'gradient'], expand: ['mix', 'smoothstep'] },
  { words: ['brightness', 'luma', 'grey', 'gray', 'greyscale', 'grayscale', 'luminance', 'bright'], expand: ['dot', 'luminance', 'luma', 'bright'] },
  { words: ['pulse', 'beat', 'flash', 'blink', 'throb'], expand: ['exp', 'fract', 'pow', 'beat', 'pulse'] },
  { words: ['wave', 'waves', 'oscillate', 'wobble', 'ripple', 'ripples'], expand: ['sin', 'cos', 'wave'] },
  { words: ['distance', 'sdf', 'shape', 'field'], expand: ['length', 'abs', 'max', 'min', 'sd'] },
  { words: ['threshold', 'cutoff', 'step', 'hard', 'mask'], expand: ['step', 'smoothstep'] },
  { words: ['clamp', 'limit', 'saturate', 'range'], expand: ['clamp', 'min', 'max'] },
  { words: ['time', 'animate', 'animation', 'move', 'moving'], expand: ['u_time', 'time', 'sin'] },
  { words: ['decay', 'falloff', 'fall'], expand: ['exp', 'pow'] },
];

export const SYNONYMS: readonly SynonymRow[] = [...languageSynonymRows(), ...CODE_ONLY];

/** The extra terms a query's words bring in (lower-case, none of the typed words themselves). */
export function expandQuery(words: readonly string[]): string[] {
  const typed = new Set(words);
  const out = new Set<string>();
  for (const w of words) {
    for (const row of SYNONYMS) {
      if (!row.words.includes(w)) continue;
      for (const x of row.expand) if (!typed.has(x)) out.add(x.toLowerCase());
    }
  }
  return [...out];
}
