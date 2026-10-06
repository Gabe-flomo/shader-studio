/**
 * spec.ts — the Grid Rules node's rule set (docs/grid-rules.md): what the editor writes into the
 * node's params, and what the GLSL (gridRules/glsl.ts), the CPU reference (gridRules/cpu.ts) and
 * Open as nodes (store/gridRulesAsNodes.ts) read back.
 *
 * Everything lives in the node's params, so undo, saving, groups and Play work as for any node:
 *  - selects (rule type, neighbourhood, template, start, board size, edges) and Steps are baked
 *    into the GLSL: changing one recompiles;
 *  - the numbers (born / survive switches as bit masks, states, speed, brush, colours…) are live
 *    uniforms: a checkbox, a slider or a Play control never recompiles.
 *
 * The board (a Pass the compiler adds, compiler/gridRulesExpand.ts) stores, per cell:
 *   R = the state (a whole number, rounded on store) or, for Smooth, the first field (u);
 *   G = age / afterglow (0–1) or, for Smooth, the second field (v);
 *   B = the step clock's phase (Speed below 1); for Blocks also the step's parity (B ≥ 2 on odd steps);
 *   A = the rule's signature (a whole number ≥ 2): a board whose Alpha is anything else (an empty
 *       Pass reads 0, or 1) is new, and is seeded. Changing the rule type or the start reseeds too.
 */

import { BLOCK_PRESETS, DEFAULT_BLOCKS, DEFAULT_PATTERNS, PATTERN_PRESETS, readBlocks, readPatterns, type BlockRule, type PatternRule } from './stencils';

export type GridRuleType = 'count' | 'stages' | 'patterns' | 'blocks' | 'smooth';
export type Neighbourhood = 'moore' | 'vonNeumann' | 'radius';
export type RadiusShape = 'box' | 'circle';
export type SmoothTemplate = 'diffusion' | 'waves' | 'reaction' | 'custom';
export type StartMode = 'noise' | 'empty' | 'image' | 'centre';

/** Board sizes: the Pass's scale. One pixel of the board is one cell. */
export const BOARD_SIZES: Array<{ value: string; label: string; scale: number }> = [
  { value: '0.5', label: 'Fine (½: 960 cells across at 1080p)', scale: 0.5 },
  { value: '0.25', label: 'Medium (¼: 480 across)', scale: 0.25 },
  { value: '0.125', label: 'Coarse (⅛: 240 across)', scale: 0.125 },
  { value: '0.0625', label: 'Chunky (1/16: 120 across)', scale: 0.0625 },
  { value: '0.03125', label: 'Huge (1/32: 60 across)', scale: 0.03125 },
];
export const boardScale = (v: unknown): number => BOARD_SIZES.find(b => b.value === String(v))?.scale ?? 0.125;

export const RULE_TYPES: Array<{ value: GridRuleType; label: string; hint: string }> = [
  { value: 'count', label: 'Count', hint: 'Life-like: count the live neighbours; born on some counts, survive on others.' },
  { value: 'stages', label: 'Stages', hint: 'Generations: like Count, but a cell that stops surviving fades through dying stages before it is empty.' },
  { value: 'patterns', label: 'Patterns', hint: 'An ordered list of 3×3 pictures: the first one that matches decides what the cell becomes.' },
  { value: 'blocks', label: 'Blocks', hint: 'Margolus: 2×2 blocks change together, from a before picture to an after picture; the blocks shift every step.' },
  { value: 'smooth', label: 'Smooth', hint: 'Continuous values: diffusion, waves, reaction–diffusion or your own one-line update.' },
];

/** Most states a board holds (Stages, Patterns). */
export const MAX_STATES = 16;
/** Explicit colours per state; states past these blend the last two (Stages' dying stages). */
export const STATE_COLOURS = 8;
/** Largest Larger-than-Life radius. */
export const MAX_RADIUS = 7;
/** Most steps per frame (the board Pass's Repeat). */
export const MAX_STEPS = 16;

/** Neighbour offsets (x right, y up), clockwise from the cell above. */
export const MOORE_OFFSETS: Array<[number, number]> = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
export const VON_NEUMANN_OFFSETS: Array<[number, number]> = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** The offsets a neighbourhood counts (self excluded). */
export function neighbourOffsets(nb: Neighbourhood, radius = 1, shape: RadiusShape = 'box'): Array<[number, number]> {
  if (nb === 'moore') return MOORE_OFFSETS;
  if (nb === 'vonNeumann') return VON_NEUMANN_OFFSETS;
  const r = clampRadius(radius);
  const out: Array<[number, number]> = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx === 0 && dy === 0) continue;
    if (shape === 'circle' && dx * dx + dy * dy > r * r + r) continue;
    out.push([dx, dy]);
  }
  return out;
}
export const clampRadius = (r: unknown) => Math.max(1, Math.min(MAX_RADIUS, Math.round(typeof r === 'number' && isFinite(r) ? r : 2)));
/** Most neighbours the neighbourhood can count. */
export const maxCount = (nb: Neighbourhood, radius = 1, shape: RadiusShape = 'box') => neighbourOffsets(nb, radius, shape).length;

// ── Born / survive sets as bit masks (live floats: bit k is "on with k neighbours") ─────────────

export const maskOf = (counts: number[]) => counts.reduce((m, k) => m | (1 << k), 0);
export const countsOf = (mask: number, max = 8) => Array.from({ length: max + 1 }, (_, k) => k).filter(k => (Math.round(mask) >> k) & 1);
export const hasCount = (mask: number, k: number) => ((Math.round(mask) >> k) & 1) === 1;

/** B3/S23 style text for a mask pair (Moore / von Neumann). */
export function ruleString(born: number, survive: number, max = 8): string {
  return `B${countsOf(born, max).join('')}/S${countsOf(survive, max).join('')}`;
}

/** Parse "B36/S23" (or "23/3", S/B order as in Golly's older notation); null if it isn't one. */
export function parseRuleString(text: string): { born: number; survive: number } | null {
  const t = text.trim().toUpperCase().replace(/\s+/g, '');
  let m = /^B([0-8]*)\/S([0-8]*)$/.exec(t);
  if (m) return { born: maskOf([...m[1]].map(Number)), survive: maskOf([...m[2]].map(Number)) };
  m = /^S([0-8]*)\/B([0-8]*)$/.exec(t);
  if (m) return { born: maskOf([...m[2]].map(Number)), survive: maskOf([...m[1]].map(Number)) };
  m = /^([0-8]*)\/([0-8]*)$/.exec(t);
  if (m) return { born: maskOf([...m[2]].map(Number)), survive: maskOf([...m[1]].map(Number)) };
  return null;
}

// ── Presets ─────────────────────────────────────────────────────────────────────────────────────

export interface GridPreset {
  label: string;
  hint: string;
  /** The params it sets (merged over the node's own). */
  params: Record<string, unknown>;
  /** Colours (and, for reaction–diffusion, Steps) that suit it: set with it, not compared by matchingPreset. */
  look?: Record<string, unknown>;
}

/** Looks the presets and the rule types bring along (presetPatch). */
export const LOOKS = {
  count: { color0: [0.02, 0.025, 0.05], color1: [0.85, 1.0, 0.92], glowColor: [0.55, 0.12, 0.35], oldColor: [0.3, 0.75, 1.0] },
  stages: { color0: [0.01, 0.01, 0.03], color1: [0.75, 0.95, 1.0], color2: [0.25, 0.45, 1.0], color3: [0.12, 0.06, 0.3], afterglow: 0 },
  heat: { color0: [0.02, 0.02, 0.05], color1: [0.55, 0.05, 0.2], color2: [1.0, 0.45, 0.1], color3: [1.0, 0.95, 0.75], gain: 1, brushState: 1, steps: 1 },
  ripples: { color0: [0.0, 0.04, 0.12], color1: [0.03, 0.2, 0.42], color2: [0.3, 0.65, 0.88], color3: [0.95, 1.0, 1.0], gain: 3, brushState: 1, steps: 2 },
  reaction: { color0: [0.97, 0.95, 0.9], color1: [0.55, 0.75, 0.8], color2: [0.1, 0.3, 0.45], color3: [0.02, 0.04, 0.1], gain: 1, brushState: 1, steps: 8 },
} satisfies Record<string, Record<string, unknown>>;

/** What a preset sets: its numbers, then its look. */
export const presetPatch = (pr: GridPreset): Record<string, unknown> => ({ ...pr.params, ...(pr.look ?? {}) });

const bs = (b: number[], s: number[]) => ({ bornMask: maskOf(b), surviveMask: maskOf(s) });

/** Count presets (Moore 8 unless they say otherwise). Sources: LifeWiki's list of Life-like rules. */
export const COUNT_PRESETS: Record<string, GridPreset> = {
  life: { label: 'Life', hint: 'B3/S23, Conway\'s Game of Life: gliders, blinkers, still lifes.', params: { neighbourhood: 'moore', ...bs([3], [2, 3]) } },
  highLife: { label: 'HighLife', hint: 'B36/S23: Life plus a replicator.', params: { neighbourhood: 'moore', ...bs([3, 6], [2, 3]) } },
  seeds: { label: 'Seeds', hint: 'B2/S: every live cell dies at once; explodes into sparks.', params: { neighbourhood: 'moore', ...bs([2], []) } },
  dayNight: { label: 'Day & Night', hint: 'B3678/S34678: live and dead behave the same way round.', params: { neighbourhood: 'moore', ...bs([3, 6, 7, 8], [3, 4, 6, 7, 8]) } },
  maze: { label: 'Maze', hint: 'B3/S12345: grows corridors.', params: { neighbourhood: 'moore', ...bs([3], [1, 2, 3, 4, 5]) } },
  coral: { label: 'Coral', hint: 'B3/S45678: slow coral growth.', params: { neighbourhood: 'moore', ...bs([3], [4, 5, 6, 7, 8]) } },
  anneal: { label: 'Anneal', hint: 'B4678/S35678: blobs that smooth their edges (the "twisted majority").', params: { neighbourhood: 'moore', ...bs([4, 6, 7, 8], [3, 5, 6, 7, 8]) } },
  diamoeba: { label: 'Diamoeba', hint: 'B35678/S5678: diamond-shaped amoebas.', params: { neighbourhood: 'moore', ...bs([3, 5, 6, 7, 8], [5, 6, 7, 8]) } },
  replicator: { label: 'Replicator', hint: 'B1357/S1357: every pattern copies itself.', params: { neighbourhood: 'moore', ...bs([1, 3, 5, 7], [1, 3, 5, 7]) } },
  lifeWithoutDeath: { label: 'Life without Death', hint: 'B3/S012345678: cells are born as in Life and never die: ladders and crystals.', params: { neighbourhood: 'moore', ...bs([3], [0, 1, 2, 3, 4, 5, 6, 7, 8]) } },
  diamonds: { label: 'Diamonds (von Neumann)', hint: 'B1/S1234 on the 4 neighbours: grows diamond rings.', params: { neighbourhood: 'vonNeumann', bornMask: maskOf([1]), surviveMask: maskOf([1, 2, 3, 4]) } },
  bosco: { label: 'Bosco (radius 5)', hint: 'Larger than Life, radius 5: born on 34–45, survive on 33–57 (Evans\'s Bosco\'s rule): moving blobs.', params: { neighbourhood: 'radius', radius: 5, shape: 'box', bornLo: 34, bornHi: 45, surviveLo: 33, surviveHi: 57 } },
  majority: { label: 'Majority (radius 4)', hint: 'Larger than Life, radius 4: a cell takes the side most of its 9×9 block is on. Noise melts into smooth islands.', params: { neighbourhood: 'radius', radius: 4, shape: 'box', bornLo: 41, bornHi: 80, surviveLo: 40, surviveHi: 80 } },
};

/** Stages presets: Generations rules, S/B/C (survive / born / states). Source: Golly's Generations list. */
export const STAGES_PRESETS: Record<string, GridPreset> = {
  briansBrain: { label: 'Brian\'s Brain', hint: '/2/3: off → on with exactly 2 on neighbours, on → dying, dying → off. Endless gliding sparks.', params: { neighbourhood: 'moore', ...bs([2], []), states: 3 }, look: LOOKS.stages },
  starWars: { label: 'Star Wars', hint: '345/2/4: sparks that build stable walls.', params: { neighbourhood: 'moore', ...bs([2], [3, 4, 5]), states: 4 }, look: LOOKS.stages },
  frogs: { label: 'Frogs', hint: '12/34/3: hopping blobs.', params: { neighbourhood: 'moore', ...bs([3, 4], [1, 2]), states: 3 }, look: LOOKS.stages },
  sticks: { label: 'Sticks', hint: '3456/2/6: crawling sticks.', params: { neighbourhood: 'moore', ...bs([2], [3, 4, 5, 6]), states: 6 }, look: LOOKS.stages },
  spirals: { label: 'Spirals', hint: '2/234/5: spiral waves.', params: { neighbourhood: 'moore', ...bs([2, 3, 4], [2]), states: 5 }, look: LOOKS.stages },
  swirl: { label: 'Swirl', hint: '23/34/8: swirling fronts with long tails.', params: { neighbourhood: 'moore', ...bs([3, 4], [2, 3]), states: 8 }, look: LOOKS.stages },
  lava: { label: 'Lava', hint: '12345/45678/8: flowing lava.', params: { neighbourhood: 'moore', ...bs([4, 5, 6, 7, 8], [1, 2, 3, 4, 5]), states: 8 }, look: LOOKS.stages },
  bloomerang: { label: 'Bloomerang', hint: '234/34678/24: blooms with very long tails.', params: { neighbourhood: 'moore', ...bs([3, 4, 6, 7, 8], [2, 3, 4]), states: 16 }, look: LOOKS.stages },
};

/** Smooth presets: a template and its numbers. */
export const SMOOTH_PRESETS: Record<string, GridPreset> = {
  heat: { label: 'Heat', hint: 'Diffusion: every cell drifts towards its neighbours\' average and cools a little.', params: { template: 'diffusion', spread: 0.9, decay: 0.004 }, look: LOOKS.heat },
  ripples: { label: 'Ripples', hint: 'The two-buffer wave: height and last height; the mouse drops ripples.', params: { template: 'waves', waveSpeed: 0.9, damping: 0.995 }, look: LOOKS.ripples },
  mitosis: { label: 'Mitosis', hint: 'Gray–Scott reaction–diffusion, feed 0.0367 kill 0.0649: dividing cells.', params: { template: 'reaction', feed: 0.0367, kill: 0.0649, diffA: 1, diffB: 0.5 }, look: LOOKS.reaction },
  coralRd: { label: 'Coral growth', hint: 'Gray–Scott, feed 0.0545 kill 0.062: branching coral.', params: { template: 'reaction', feed: 0.0545, kill: 0.062, diffA: 1, diffB: 0.5 }, look: LOOKS.reaction },
  worms: { label: 'Worms', hint: 'Gray–Scott, feed 0.078 kill 0.061: wriggling worms.', params: { template: 'reaction', feed: 0.078, kill: 0.061, diffA: 1, diffB: 0.5 }, look: LOOKS.reaction },
  spots: { label: 'Spots', hint: 'Gray–Scott, feed 0.035 kill 0.065: spots that split.', params: { template: 'reaction', feed: 0.035, kill: 0.065, diffA: 1, diffB: 0.5 }, look: LOOKS.reaction },
  maze: { label: 'Labyrinth', hint: 'Gray–Scott, feed 0.029 kill 0.057: a maze of stripes.', params: { template: 'reaction', feed: 0.029, kill: 0.057, diffA: 1, diffB: 0.5 }, look: LOOKS.reaction },
};

// ── Smooth: the custom update ───────────────────────────────────────────────────────────────────

/** Names a custom Smooth update can use. */
export const SMOOTH_NAMES: Array<{ name: string; doc: string }> = [
  { name: 'u', doc: 'This cell\'s first value (red), a step ago.' },
  { name: 'v', doc: 'This cell\'s second value (green), a step ago.' },
  { name: 'avg_u', doc: 'The average u of the 8 cells round this one.' },
  { name: 'avg_v', doc: 'The average v of the 8 cells round this one.' },
  { name: 'lap_u', doc: 'The Laplacian of u: avg (0.2 edges, 0.05 corners) minus u. Positive in a dip, negative on a peak.' },
  { name: 'lap_v', doc: 'The Laplacian of v.' },
  { name: 'n', doc: 'u of the cell above.' }, { name: 's', doc: 'u of the cell below.' },
  { name: 'e', doc: 'u of the cell to the right.' }, { name: 'w', doc: 'u of the cell to the left.' },
  { name: 'x', doc: 'Across the board, 0 to 1.' }, { name: 'y', doc: 'Up the board, 0 to 1.' },
  { name: 't', doc: 'Seconds since the start.' },
  { name: 'rnd', doc: 'A random number per cell, new every step.' },
  { name: 'a', doc: 'Knob A (a slider, 0–1).' }, { name: 'b', doc: 'Knob B.' }, { name: 'c', doc: 'Knob C.' }, { name: 'd', doc: 'Knob D.' },
];

/** GLSL built-ins a custom update may call. */
export const SMOOTH_FUNCTIONS = new Set('sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep length distance dot float vec2 vec3'.split(' '));

/** Why a custom update isn't usable (null: it is). One expression, known names, balanced. */
export function customUpdateProblem(expr: string): string | null {
  const e = expr.trim();
  if (!e) return 'Empty: write the new value, e.g. u + 0.2 * lap_u';
  if (e.length > 400) return 'Too long: one line, up to 400 characters';
  if (/[;{}]/.test(e)) return 'One expression only: no ; or braces';
  if (/(^|[^=!<>])=([^=]|$)/.test(e)) return 'No assignment: the expression is the new value';
  let depth = 0;
  for (const ch of e) { if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth < 0) return 'A ) before its ('; } }
  if (depth !== 0) return 'Unbalanced parentheses';
  const names = new Set(SMOOTH_NAMES.map(x => x.name));
  for (const m of e.matchAll(/\b([A-Za-z_]\w*)\b(\s*\()?/g)) {
    const [, id, call] = m;
    if (call) { if (!SMOOTH_FUNCTIONS.has(id)) return `${id}() isn't a function the update can call`; continue; }
    if (names.has(id) || id === 'PI' || id === 'TAU') continue;
    if (/^[xyzrgb]{1,3}$/.test(id) && e[m.index! - 1] === '.') continue;
    return `${id} isn't available here (use ${[...names].slice(0, 6).join(', ')}…)`;
  }
  return null;
}

/** The update as GLSL: whole numbers get a point (GLSL ES 1.00 won't mix `u * 2`). */
export function floatLiterals(expr: string): string {
  return expr.replace(/(\d*\.\d+(?:e[-+]?\d+)?|\d+\.\d*(?:e[-+]?\d+)?|\d+e[-+]?\d+)|([A-Za-z_]\w*)|(\d+)/g, (m, _fl: string | undefined, _id: string | undefined, int: string | undefined) => (int ? `${int}.0` : m));
}

// ── The node's params ───────────────────────────────────────────────────────────────────────────

/** Defaults of a new Grid Rules node: Conway's Life on a coarse board. */
export const GRID_DEFAULTS: Record<string, unknown> = {
  ruleType: 'count',
  neighbourhood: 'moore', radius: 2, shape: 'box',
  bornMask: maskOf([3]), surviveMask: maskOf([2, 3]),
  bornLo: 34, bornHi: 45, surviveLo: 33, surviveHi: 57,
  states: 3,
  template: 'diffusion', customU: 'u + 0.2 * lap_u', customV: 'v',
  spread: 0.9, decay: 0.004, waveSpeed: 0.9, damping: 0.995, feed: 0.0367, kill: 0.0649, diffA: 1, diffB: 0.5,
  knobA: 0.5, knobB: 0.5, knobC: 0.5, knobD: 0.5, gain: 1,
  start: 'noise', density: 0.3, seed: 1, reset: 0,
  edges: 'wrap', board: '0.125', steps: 1, rate: 0.5,
  paint: 0, brushRadius: 3, brushState: 1, brushFill: 0.5,
  afterglow: 0.9, ageRate: 0.02, ageFade: 0,
  color0: [0.02, 0.025, 0.05], color1: [0.85, 1.0, 0.92], color2: [0.95, 0.45, 0.2], color3: [0.25, 0.06, 0.2],
  color4: [0.3, 0.6, 1.0], color5: [1.0, 0.85, 0.3], color6: [0.7, 0.3, 0.9], color7: [0.4, 0.9, 0.5],
  glowColor: [0.55, 0.12, 0.35], oldColor: [0.3, 0.75, 1.0],
  patterns: DEFAULT_PATTERNS, blocks: DEFAULT_BLOCKS,
};

/** The baked part of the rule, read from a node's params (what decides the GLSL's shape). */
export interface GridShape {
  type: GridRuleType;
  neighbourhood: Neighbourhood;
  radius: number;
  shape: RadiusShape;
  template: SmoothTemplate;
  customU: string;
  customV: string;
  start: StartMode;
  wrap: boolean;
  scale: number;
  steps: number;
  /** Patterns: the stencil rules (stencils.ts). */
  patterns: PatternRule[];
  /** Blocks: the before → after rules. */
  blocks: BlockRule[];
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : d);

export function gridShape(params: Record<string, unknown>): GridShape {
  const P = { ...GRID_DEFAULTS, ...params };
  return {
    type: pick(P.ruleType, ['count', 'stages', 'patterns', 'blocks', 'smooth'] as const, 'count'),
    neighbourhood: pick(P.neighbourhood, ['moore', 'vonNeumann', 'radius'] as const, 'moore'),
    radius: clampRadius(P.radius),
    shape: pick(P.shape, ['box', 'circle'] as const, 'box'),
    template: pick(P.template, ['diffusion', 'waves', 'reaction', 'custom'] as const, 'diffusion'),
    customU: typeof P.customU === 'string' ? P.customU : 'u',
    customV: typeof P.customV === 'string' ? P.customV : 'v',
    start: pick(P.start, ['noise', 'empty', 'image', 'centre'] as const, 'noise'),
    wrap: P.edges !== 'walls',
    scale: boardScale(P.board),
    steps: Math.max(1, Math.min(MAX_STEPS, Math.round(typeof P.steps === 'number' && isFinite(P.steps) ? P.steps : 1))),
    patterns: readPatterns(P.patterns),
    blocks: readBlocks(P.blocks),
  };
}

const TYPE_INDEX: Record<GridRuleType, number> = { count: 0, stages: 1, patterns: 2, blocks: 3, smooth: 4 };
const TEMPLATE_INDEX: Record<SmoothTemplate, number> = { diffusion: 0, waves: 1, reaction: 2, custom: 3 };
const NB_INDEX: Record<Neighbourhood, number> = { moore: 0, vonNeumann: 1, radius: 2 };
const START_INDEX: Record<StartMode, number> = { noise: 0, empty: 1, image: 2, centre: 3 };

/**
 * The board's signature (stored in Alpha): changes when the rule type, the neighbourhood (Count,
 * Stages), the Smooth template or the start changes, so the board is dealt again. Whole numbers from 2 up (a fresh Pass reads 0 or 1).
 */
export function gridSignature(s: GridShape): number {
  const kind = s.type === 'smooth' ? 4 + TEMPLATE_INDEX[s.template] : TYPE_INDEX[s.type];
  const nb = s.type === 'count' || s.type === 'stages' ? NB_INDEX[s.neighbourhood] : 0;
  return 2 + (kind * 3 + nb) * 4 + START_INDEX[s.start];
}

/** Whether the rule type keeps whole-number states (everything but Smooth). */
export const isDiscrete = (t: GridRuleType) => t !== 'smooth';

/** One-line summary of a node's rule (card, tooltips). */
export function ruleSummary(params: Record<string, unknown>): string {
  const P = { ...GRID_DEFAULTS, ...params };
  const s = gridShape(P);
  const born = Number(P.bornMask), survive = Number(P.surviveMask);
  const nbWord = s.neighbourhood === 'moore' ? '' : s.neighbourhood === 'vonNeumann' ? ' · von Neumann' : ` · radius ${s.radius}${s.shape === 'circle' ? ' circle' : ''}`;
  const max = maxCount(s.neighbourhood, s.radius, s.shape);
  const counts = s.neighbourhood === 'radius'
    ? `B${P.bornLo}–${P.bornHi}/S${P.surviveLo}–${P.surviveHi}`
    : ruleString(born, survive, max);
  if (s.type === 'count') return `Count ${counts}${nbWord}`;
  if (s.type === 'stages') return `Stages ${counts}/C${Math.round(Number(P.states))}${nbWord}`;
  if (s.type === 'smooth') return `Smooth · ${s.template === 'reaction' ? 'reaction–diffusion' : s.template}`;
  const n = s.type === 'patterns' ? s.patterns.filter(r => !r.off).length : s.blocks.filter(r => !r.off).length;
  return `${s.type === 'patterns' ? 'Patterns' : 'Blocks'} · ${n} rule${n === 1 ? '' : 's'} · ${Math.round(Number(P.states))} states`;
}

/** The preset whose numbers this node has now (its key), or null. */
export function matchingPreset(params: Record<string, unknown>): string | null {
  const P = { ...GRID_DEFAULTS, ...params };
  const s = gridShape(P);
  const table: Record<string, { params: Record<string, unknown> }> = s.type === 'count' ? COUNT_PRESETS : s.type === 'stages' ? STAGES_PRESETS : s.type === 'smooth' ? SMOOTH_PRESETS
    : s.type === 'patterns' ? PATTERN_PRESETS : BLOCK_PRESETS;
  for (const [key, pr] of Object.entries(table)) {
    if (Object.entries(pr.params).every(([k, v]) => (typeof v === 'number' ? Math.abs(Number(P[k]) - v) < 1e-6 : Array.isArray(v) ? JSON.stringify(v) === JSON.stringify(P[k]) : P[k] === v))) return key;
  }
  return null;
}
