/**
 * synonyms.ts — how people talk → how code is written (docs/code-explorer-plan.md §5.4).
 *
 * A hand-made table. Each row's words, typed in a search, add the row's
 * expansions (function names and words) to the query, at a lower weight
 * than the words actually typed.
 */

export interface SynonymRow { words: string[]; expand: string[] }

export const SYNONYMS: readonly SynonymRow[] = [
  { words: ['soft', 'smooth', 'feather', 'feathered', 'blur', 'antialias', 'anti-alias', 'aa', 'edge', 'edges'], expand: ['smoothstep', 'fwidth', 'edge', 'antialias'] },
  { words: ['circle', 'disc', 'disk', 'dot', 'dots', 'round', 'radius', 'radial'], expand: ['length', 'distance', 'sdcircle', 'circle'] },
  { words: ['outline', 'ring', 'rings', 'stroke', 'border', 'line'], expand: ['abs', 'ring', 'stroke', 'outline'] },
  { words: ['random', 'hash', 'noise', 'grain', 'rand', 'jitter'], expand: ['fract', 'sin', 'dot', 'hash', 'noise', 'fbm', 'hash21', 'hash2'] },
  { words: ['repeat', 'tile', 'tiles', 'tiling', 'grid', 'cell', 'cells', 'wrap'], expand: ['fract', 'mod', 'floor', 'cell', 'grid'] },
  { words: ['blend', 'fade', 'lerp', 'mix', 'crossfade', 'interpolate', 'gradient'], expand: ['mix', 'smoothstep'] },
  { words: ['brightness', 'luma', 'grey', 'gray', 'greyscale', 'grayscale', 'luminance', 'bright'], expand: ['dot', 'luminance', 'luma', 'bright'] },
  { words: ['pulse', 'beat', 'flash', 'blink', 'throb'], expand: ['exp', 'fract', 'pow', 'beat', 'pulse'] },
  { words: ['wave', 'waves', 'oscillate', 'wobble', 'ripple', 'ripples'], expand: ['sin', 'cos', 'wave'] },
  { words: ['rotate', 'rotation', 'spin', 'turn', 'angle'], expand: ['rot', 'rotate', 'mat2', 'atan', 'cos', 'sin'] },
  { words: ['distance', 'sdf', 'shape', 'field'], expand: ['length', 'abs', 'max', 'min', 'sd'] },
  { words: ['union', 'combine', 'merge', 'join'], expand: ['min', 'smin'] },
  { words: ['intersect', 'intersection', 'cut', 'subtract'], expand: ['max'] },
  { words: ['threshold', 'cutoff', 'step', 'hard', 'mask'], expand: ['step', 'smoothstep'] },
  { words: ['colour', 'color', 'palette', 'hue', 'tint'], expand: ['palette', 'cos', 'mix', 'col', 'color'] },
  { words: ['glow', 'bloom', 'light', 'halo'], expand: ['exp', 'glow', 'pow'] },
  { words: ['clamp', 'limit', 'saturate', 'range'], expand: ['clamp', 'min', 'max'] },
  { words: ['time', 'animate', 'animation', 'move', 'moving'], expand: ['u_time', 'time', 'sin'] },
  { words: ['polar', 'spiral', 'swirl'], expand: ['atan', 'length', 'polar'] },
  { words: ['decay', 'falloff', 'fall'], expand: ['exp', 'pow'] },
];

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
