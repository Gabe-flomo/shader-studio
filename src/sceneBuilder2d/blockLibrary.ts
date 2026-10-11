/**
 * blockLibrary.ts — the 2D Scene Builder's library of space blocks, like an audio plugin's effect
 * list (docs/scene-builder-2d.md, "Space blocks").
 *
 * Where it comes from: an audit of the vec2 → vec2 moves the Expression Builder mined from the
 * bundled examples (src/exprBuilder/prebuilt/moves.json, 153 space moves) and the GLSL corpus.
 * The most used, by count: offsets and scales (x − c, x × c), cells (floor), folds (abs), repeats
 * (fract, fract(x × c) − 0.5), sines of the point and of the swapped point (sin(x), x + a·sin(x.yx·b + t)),
 * inversion (x / max(dot(x, x), ε)), rotations (mat2 / rot2D, often by time or by distance),
 * brick offsets (step(1, mod(floor(y·n), 2))) and travelling waves (vec2(sin(y·9 + t), cos(x·9 − t))).
 * Those families are here, written as three-line blocks, with the classic ones the corpus only
 * hints at (log-polar, kaleidoscope folds, Kali and IFS folds, iq's warp of a warp) filled in.
 *
 * Each entry: a name, one line on what it does, its lines (x, y, uv and t free; numbers by name
 * are sliders), and how many times it runs. The tests check every entry parses, type-checks,
 * runs on the CPU (for its thumbnail) and compiles into the graph.
 */
import { cloneBlock, type BlockLine, type BlockOp, type BlockParam, type BlockTarget, type SpaceBlock } from './blocks';

export type BlockCategory = 'trig' | 'exp' | 'waves' | 'twist' | 'mirror' | 'fractal' | 'noise' | 'tiles';

export const BLOCK_CATEGORIES: Array<{ id: BlockCategory; label: string; blurb: string }> = [
  { id: 'trig', label: 'Trigonometric', blurb: 'Sines, cosines and tangents of the point: wobbles and folds.' },
  { id: 'exp', label: 'Exponential & log', blurb: 'Growth, squash and log-polar: distances stretched by powers.' },
  { id: 'waves', label: 'Ripples & waves', blurb: 'Rings and waves that travel through space.' },
  { id: 'twist', label: 'Twists & polar', blurb: 'Turning space by its distance, and polar coordinates.' },
  { id: 'mirror', label: 'Mirrors & kaleidoscopes', blurb: 'Folds that make both sides (or every wedge) match.' },
  { id: 'fractal', label: 'Fractal & recursive', blurb: 'Folds run several times: detail inside detail.' },
  { id: 'noise', label: 'Noise warps', blurb: 'Smooth noise pushing space about: organic edges.' },
  { id: 'tiles', label: 'Tiles & cells', blurb: 'Repeats, bricks and pixel steps.' },
];

export interface BlockEntry {
  id: string;
  name: string;
  category: BlockCategory;
  /** One line: what it does. */
  blurb: string;
  lines: BlockLine[];
  params: BlockParam[];
  times?: number;
}

const L = (target: BlockTarget, op: BlockOp, rhs: string): BlockLine => ({ target, op, rhs });
const N = (name: string, value: number, min: number, max: number): BlockParam => ({ name, value, min, max });

export const BLOCK_LIBRARY: BlockEntry[] = [
  // ── Trigonometric ──
  { id: 'sine-shift', name: 'Sine shift', category: 'trig', blurb: 'Slides each row sideways by a sine of its height: wavy lines.',
    lines: [L('uv.x', '+=', 'amp * sin(y * freq + t * speed)')], params: [N('amp', 0.12, 0, 0.6), N('freq', 6, 0, 30), N('speed', 1, -4, 4)] },
  { id: 'sine-weave', name: 'Sine weave', category: 'trig', blurb: 'Rows and columns both slide by sines: a woven wobble.',
    lines: [L('uv.x', '+=', 'amp * sin(y * freq + t * speed)'), L('uv.y', '+=', 'amp * sin(x * freq + t * speed)')], params: [N('amp', 0.08, 0, 0.5), N('freq', 7, 0, 30), N('speed', 0.8, -4, 4)] },
  { id: 'cross-sines', name: 'Cross sines', category: 'trig', blurb: 'Adds a sine of the swapped point (y, x): soft diagonal ripples.',
    lines: [L('uv', '+=', 'amp * sin(uv.yx * freq + t * speed)')], params: [N('amp', 0.1, 0, 0.5), N('freq', 5, 0, 20), N('speed', 0.5, -4, 4)] },
  { id: 'sine-fold', name: 'Sine fold', category: 'trig', blurb: 'Space through a sine: it folds back and forth smoothly, a soft mirror tile.',
    lines: [L('uv', '=', 'sin(uv * freq + t * speed) / freq')], params: [N('freq', 3, 0.2, 12), N('speed', 0, -4, 4)] },
  { id: 'tangent-tear', name: 'Tangent tear', category: 'trig', blurb: 'Rows torn sideways where the tangent shoots off: sharp glitchy bands.',
    lines: [L('uv.x', '+=', 'clamp(amp * tan(y * freq + t * speed), -1, 1)')], params: [N('amp', 0.05, 0, 0.5), N('freq', 4, 0, 20), N('speed', 0.5, -4, 4)] },

  // ── Exponential & log ──
  { id: 'log-polar', name: 'Log-polar', category: 'exp', blurb: 'Rings become columns and zooming becomes sliding: the Droste trick.',
    lines: [L('uv', '=', 'vec2(log(max(length(uv), 0.0001)) - t * speed, atan(y, x) / PI) * zoom')], params: [N('zoom', 1, 0.1, 4), N('speed', 0.2, -2, 2)] },
  { id: 'exp-bulge', name: 'Exponential bulge', category: 'exp', blurb: 'Stretches the edges more than the middle; negative pinches them in.',
    lines: [L('uv', '*=', 'exp(amount * length(uv))')], params: [N('amount', 0.8, -3, 3)] },
  { id: 'power-pinch', name: 'Power pinch', category: 'exp', blurb: 'Raises the distance from the centre to a power: above 1 pulls the middle in.',
    lines: [L('uv', '*=', 'pow(length(uv) + 0.0001, power - 1)')], params: [N('power', 1.6, 0.2, 4)] },
  { id: 'log-spiral', name: 'Log spiral', category: 'exp', blurb: 'Turns space by the log of its distance: a spiral that looks the same at every zoom.',
    lines: [L('uv', '=', 'vec2(log(max(length(uv), 0.0001)), atan(y, x))'), L('uv.y', '+=', 'x * twist + t * speed'), L('uv', '=', 'vec2(cos(y), sin(y)) * exp(x)')],
    params: [N('twist', 1.5, -6, 6), N('speed', 0, -2, 2)] },
  { id: 'soft-squash', name: 'Soft squash', category: 'exp', blurb: 'tanh squashes far space towards a box edge; near the middle is left alone.',
    lines: [L('uv', '=', 'tanh(uv * amount) / amount')], params: [N('amount', 1.5, 0.1, 6)] },

  // ── Ripples & waves ──
  { id: 'ripple-rings', name: 'Ripple rings', category: 'waves', blurb: 'Rings of push and pull travelling out from the centre, like a stone in a pond.',
    lines: [L('uv', '+=', 'amp * normalize(uv + 0.0001) * sin(length(uv) * freq - t * speed)')], params: [N('amp', 0.04, 0, 0.3), N('freq', 20, 0, 60), N('speed', 3, -10, 10)] },
  { id: 'water', name: 'Water wobble', category: 'waves', blurb: 'Rows and columns swaying the other way to each other, like light under water.',
    lines: [L('uv', '+=', 'amp * vec2(sin(y * freq + t * speed), cos(x * freq - t * speed))')], params: [N('amp', 0.03, 0, 0.3), N('freq', 9, 0, 30), N('speed', 1, -6, 6)] },
  { id: 'standing-waves', name: 'Standing waves', category: 'waves', blurb: 'Waves that swell and fall in place without travelling.',
    lines: [L('uv', '+=', 'amp * sin(uv.yx * freq) * cos(t * speed)')], params: [N('amp', 0.08, 0, 0.4), N('freq', 8, 0, 30), N('speed', 2, -8, 8)] },
  { id: 'shock-ring', name: 'Shock ring', category: 'waves', blurb: 'One ring sweeps outward over and over, shoving space as it passes.',
    lines: [L('uv', '*=', '1 - amp * exp(-pow((length(uv) - fract(t * speed) * 1.5) * sharp, 2))')], params: [N('amp', 0.3, -1, 1), N('sharp', 8, 1, 30), N('speed', 0.4, 0, 2)] },
  { id: 'two-sources', name: 'Two sources', category: 'waves', blurb: 'Ripples from two points that cross and interfere.',
    lines: [L('uv', '+=', 'amp * (sin(length(uv - vec2(gap, 0)) * freq - t * speed) + sin(length(uv + vec2(gap, 0)) * freq - t * speed))')],
    params: [N('amp', 0.02, 0, 0.2), N('gap', 0.4, 0, 1.5), N('freq', 18, 0, 60), N('speed', 3, -10, 10)] },

  // ── Twists & polar ──
  { id: 'twirl', name: 'Twirl', category: 'twist', blurb: 'Turns the middle a lot and the edges hardly at all.',
    lines: [L('uv', '=', 'rot2D(amount * exp(-falloff * length(uv))) * uv')], params: [N('amount', 2.5, -10, 10), N('falloff', 2, 0, 8)] },
  { id: 'spiral', name: 'Spiral', category: 'twist', blurb: 'Turns space more the further out it is: straight lines wind into spirals.',
    lines: [L('uv', '=', 'rot2D(length(uv) * twist + t * speed) * uv')], params: [N('twist', 3, -15, 15), N('speed', 0, -3, 3)] },
  { id: 'spinning-rings', name: 'Spinning rings', category: 'twist', blurb: 'Each ring turns back and forth by its own angle.',
    lines: [L('uv', '=', 'rot2D(sin(length(uv) * freq - t * speed) * amount) * uv')], params: [N('amount', 0.5, 0, 3), N('freq', 10, 0, 40), N('speed', 1, -6, 6)] },
  { id: 'vortex', name: 'Vortex', category: 'twist', blurb: 'A whirlpool: turns sharply near the centre, gently far away.',
    lines: [L('uv', '=', 'rot2D(amount / (length(uv) + core) + t * speed) * uv')], params: [N('amount', 0.6, -4, 4), N('core', 0.2, 0.01, 1), N('speed', 0, -3, 3)] },
  { id: 'to-polar', name: 'To polar', category: 'twist', blurb: 'Angle across, distance up: circles become straight lines.',
    lines: [L('uv', '=', 'vec2(atan(y, x) / PI * around, length(uv) * 2 - 1)')], params: [N('around', 1, 0.5, 8)] },

  // ── Mirrors & kaleidoscopes ──
  { id: 'mirror', name: 'Mirror', category: 'mirror', blurb: 'Folds the left half onto the right; Offset moves the fold.',
    lines: [L('uv.x', '=', 'abs(x) - offset')], params: [N('offset', 0, -1, 1)] },
  { id: 'mirror-both', name: 'Mirror both', category: 'mirror', blurb: 'Folds both axes: four matching quarters.',
    lines: [L('uv', '=', 'abs(uv) - offset')], params: [N('offset', 0.2, -1, 1)] },
  { id: 'kaleidoscope', name: 'Kaleidoscope', category: 'mirror', blurb: 'Folds space into mirrored wedges round the centre.',
    lines: [L('uv', '=', 'vec2(atan(y, x), length(uv))'), L('uv.x', '=', 'abs(mod(x + t * speed, TAU / count) - PI / count)'), L('uv', '=', 'vec2(cos(x), sin(x)) * y')],
    params: [N('count', 6, 1, 24), N('speed', 0, -2, 2)] },
  { id: 'eight-fold', name: 'Eight-fold', category: 'mirror', blurb: 'Folds over both axes and the diagonal: eight matching slices.',
    lines: [L('uv', '=', 'abs(uv)'), L('uv', '=', 'x < y ? uv.yx : uv'), L('uv.x', '-=', 'offset')], params: [N('offset', 0.3, -1, 1)] },
  { id: 'wavy-mirror', name: 'Wavy mirror', category: 'mirror', blurb: 'A mirror whose fold line wiggles.',
    lines: [L('uv.x', '=', 'abs(x + amp * sin(y * freq + t * speed))')], params: [N('amp', 0.1, 0, 0.5), N('freq', 5, 0, 20), N('speed', 1, -6, 6)] },

  // ── Fractal & recursive ──
  { id: 'kali-fold', name: 'Kali fold', category: 'fractal', blurb: 'Fold, then turn inside out, again and again: Kali’s fractal.',
    lines: [L('uv', '=', 'abs(uv) / max(dot(uv, uv), 0.001) - c')], params: [N('c', 0.8, 0.2, 1.5)], times: 5 },
  { id: 'fold-turn', name: 'Fold & turn', category: 'fractal', blurb: 'Fold, shift, turn and grow, repeated: an IFS fractal of branches.',
    lines: [L('uv', '=', 'abs(uv) - offset'), L('uv', '=', 'rot2D(angle) * uv'), L('uv', '*=', 'grow')], params: [N('offset', 0.3, 0, 1), N('angle', 0.6, -3.14, 3.14), N('grow', 1.2, 0.5, 2)], times: 4 },
  { id: 'tiles-in-tiles', name: 'Tiles in tiles', category: 'fractal', blurb: 'Each tile split into smaller turned tiles, a few levels deep.',
    lines: [L('uv', '=', 'rot2D(turn) * (fract(uv * zoom + 0.5) - 0.5)')], params: [N('zoom', 2, 1, 6), N('turn', 0.3, -3.14, 3.14)], times: 3 },
  { id: 'apollonian', name: 'Inversion repeats', category: 'fractal', blurb: 'Repeat, then turn each cell inside out through a circle: Apollonian bubbles.',
    lines: [L('uv', '=', 'fract(uv * 0.5 + 0.5) * 2 - 1'), L('uv', '*=', 'k / max(dot(uv, uv), 0.001)')], params: [N('k', 1.2, 0.5, 2)], times: 4 },

  // ── Noise warps ──
  { id: 'noise-push', name: 'Noise push', category: 'noise', blurb: 'Smooth noise pushes every point a little: organic, flowing edges.',
    lines: [L('uv', '+=', 'amount * (vec2(valueNoise(uv * scale + t * speed), valueNoise(uv * scale + vec2(17.3, 4.1) - t * speed)) - 0.5)')],
    params: [N('amount', 0.4, 0, 2), N('scale', 3, 0.2, 12), N('speed', 0.2, -2, 2)] },
  { id: 'noise-swirl', name: 'Noise swirl', category: 'noise', blurb: 'Noise turns space about the centre: patches twist one way or the other.',
    lines: [L('uv', '=', 'rot2D((valueNoise(uv * scale + t * speed) - 0.5) * amount) * uv')], params: [N('amount', 3, 0, 12), N('scale', 2, 0.2, 10), N('speed', 0.2, -2, 2)] },
  { id: 'warp-of-warp', name: 'Warp of a warp', category: 'noise', blurb: 'Noise pushes space, then noise of the pushed space pushes it again (iq’s domain warping).',
    lines: [L('uv', '+=', 'amount * (vec2(valueNoise(uv * scale), valueNoise(uv * scale + 5.2)) - 0.5)'), L('uv', '+=', 'amount * (vec2(valueNoise(uv * scale + t * speed), valueNoise(uv * scale + 9.7)) - 0.5)')],
    params: [N('amount', 0.6, 0, 2), N('scale', 2.5, 0.2, 10), N('speed', 0.3, -2, 2)] },
  { id: 'flow', name: 'Flow', category: 'noise', blurb: 'Each point steps along a direction read from noise, like a current.',
    lines: [L('uv', '+=', 'amount * vec2(cos(valueNoise(uv * scale + t * speed) * TAU), sin(valueNoise(uv * scale + t * speed) * TAU))')],
    params: [N('amount', 0.15, 0, 1), N('scale', 2, 0.2, 10), N('speed', 0.2, -2, 2)] },

  // ── Tiles & cells ──
  { id: 'tile', name: 'Tile', category: 'tiles', blurb: 'Repeats the picture Count times across and up.',
    lines: [L('uv', '=', 'fract(uv * count * 0.5 + 0.5) * 2 - 1')], params: [N('count', 2, 1, 12)] },
  { id: 'bricks', name: 'Brick rows', category: 'tiles', blurb: 'Shifts every other row half a cell, like bricks (pair it with Tile).',
    lines: [L('uv.x', '+=', 'step(1, mod(floor(y * rows), 2)) * 0.5 / rows')], params: [N('rows', 4, 1, 20)] },
  { id: 'pixel-steps', name: 'Pixel steps', category: 'tiles', blurb: 'Snaps space to a grid of blocks: pixel art.',
    lines: [L('uv', '=', '(floor(uv * count) + 0.5) / count')], params: [N('count', 12, 1, 64)] },
  { id: 'terraces', name: 'Terraces', category: 'tiles', blurb: 'Steps with soft edges: space holds still, then slides to the next step.',
    lines: [L('uv', '=', '(floor(uv * count) + smoothstep(0.5 - soft, 0.5 + soft, fract(uv * count))) / count')], params: [N('count', 6, 1, 30), N('soft', 0.25, 0.01, 0.5)] },
];

export const BLOCK_BY_ID: Record<string, BlockEntry> = Object.fromEntries(BLOCK_LIBRARY.map(e => [e.id, e]));

/** A fresh block from a library entry. */
export function blockFromEntry(e: BlockEntry): SpaceBlock {
  return cloneBlock({ lib: e.id, name: e.name, lines: e.lines, params: e.params, times: e.times ?? 1 });
}

/** Does the block still say what its library entry says (only the slider values may differ)? */
export function isLibraryBlock(b: SpaceBlock): BlockEntry | null {
  const e = b.lib ? BLOCK_BY_ID[b.lib] : undefined;
  if (!e) return null;
  const sameLines = e.lines.length === b.lines.filter(l => l.rhs.trim()).length
    && e.lines.every((l, i) => { const m = b.lines.filter(x => x.rhs.trim())[i]; return m && m.target === l.target && m.op === l.op && m.rhs.trim() === l.rhs; });
  const sameParams = e.params.length === b.params.length && e.params.every(p => b.params.some(q => q.name === p.name));
  return sameLines && sameParams ? e : null;
}

/**
 * Random: three different blocks to pick from (from three different categories when it can),
 * each with its sliders set somewhere in the middle of their ranges. `rand` is 0..1. `extra`: your
 * saved blocks that may be offered too (only those you opted in; their ids start `my:`, and the
 * block they make links back with `my` instead of `lib`).
 */
export function randomChoices(rand: () => number = Math.random, n = 3, avoid: readonly string[] = [], extra: readonly BlockEntry[] = []): SpaceBlock[] {
  const pool = [...BLOCK_LIBRARY, ...extra].filter(e => !avoid.includes(e.id));
  const out: BlockEntry[] = [];
  const usedCats = new Set<BlockCategory>();
  let guard = 0;
  while (out.length < n && guard++ < 400) {
    const e = pool[Math.floor(rand() * pool.length) % pool.length];
    if (!e || out.includes(e)) continue;
    if (usedCats.has(e.category) && guard < 200) continue;
    out.push(e);
    usedCats.add(e.category);
  }
  for (const e of BLOCK_LIBRARY) if (out.length < n && !out.includes(e)) out.push(e);
  return out.map(e => {
    const b = blockFromEntry(e);
    if (e.id.startsWith('my:')) { delete b.lib; b.my = e.name; }
    for (const p of b.params) {
      // Somewhere between the default and the middle of the range: varied, rarely wild.
      const mid = (p.min + p.max) / 2;
      const v = p.value + (mid - p.value) * rand() * 0.6 + (rand() - 0.5) * (p.max - p.min) * 0.15;
      const r = Math.min(p.max, Math.max(p.min, v));
      p.value = Number.isInteger(p.min) && Number.isInteger(p.max) && Number.isInteger(p.value) && p.max - p.min >= 4 ? Math.round(r) : Math.round(r * 1000) / 1000;
    }
    return b;
  });
}
