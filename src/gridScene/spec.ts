/**
 * spec.ts — the Grid scene builder's scene (docs/grid-builder.md): a small grid you draw on.
 *
 *   grid      columns × rows of square cells, `span` from the centre to the grid's taller edge
 *   shapes    a palette of up to MAX_SHAPES shapes (A, B, C…): kind, colour, size, turn, spin,
 *             pulse, outline, and a motion (a path, its XY reach in cells, speed and lag)
 *   cells     where shapes are placed: one shape per cell, drawn on the mini grid
 *   pattern   a wave over the cells (ripple, diagonal, checker, rings, spiral, stripes, random)
 *             that changes every shape's size, turn, push, hue or brightness, and can fill the
 *             empty cells with a shape of its own
 *   warps     space blocks from the 2D Scene Builder's library, bending the whole grid
 *   rules     When … Do … between shapes, run in the shader: "when A is in cell (4, 2), become B",
 *             "when A and B share a cell, swap colours"
 *   look      background, grid lines, glow, tone
 *
 * Cell coordinates: x from the left (0 … cols−1), y from the top (0 … rows−1), as the mini grid
 * shows them. Motion offsets are in cells with y up. Pure data: no store, no React.
 */
import type { SpaceBlock } from '../sceneBuilder2d/blocks';
import { cloneBlock } from '../sceneBuilder2d/blocks';
import type { TextMask } from './textMask';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export const MIN_CELLS = 2;
export const MAX_CELLS = 24;
/** Most placed cells: every one is drawn by every pixel, so the shader stays quick. */
export const MAX_PLACED = 128;
export const MAX_SHAPES = 6;
export const MAX_RULES = 8;
export const MAX_WARPS = 3;
export const SHAPE_IDS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export const SHAPE_KINDS = ['circle', 'square', 'ring', 'diamond', 'triangle', 'hexagon', 'star', 'plus', 'cross', 'heart'] as const;
export type ShapeKind = typeof SHAPE_KINDS[number];
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  circle: 'Circle', square: 'Square', ring: 'Ring', diamond: 'Diamond', triangle: 'Triangle', hexagon: 'Hexagon', star: 'Star', plus: 'Plus', cross: 'Cross', heart: 'Heart',
};

export const MOTION_PATHS = ['still', 'updown', 'sideways', 'both', 'circle', 'eight', 'bounce', 'travel', 'hop'] as const;
export type MotionPath = typeof MOTION_PATHS[number];
export const MOTION_LABELS: Record<MotionPath, { label: string; blurb: string }> = {
  still: { label: 'Still', blurb: 'Stays in its cell.' },
  updown: { label: 'Up and down', blurb: 'Bobs up and down by Y cells.' },
  sideways: { label: 'Side to side', blurb: 'Sways left and right by X cells.' },
  both: { label: 'Both at once', blurb: 'Back and forth along the XY arrow: diagonal when both are set.' },
  circle: { label: 'Circle', blurb: 'Round an ellipse X wide and Y tall.' },
  eight: { label: 'Figure eight', blurb: 'A figure of eight, X wide and Y tall.' },
  bounce: { label: 'Bounce', blurb: 'Hops up by Y cells and drops back.' },
  travel: { label: 'Travel', blurb: 'Glides X, Y cells each cycle, wrapping round the grid.' },
  hop: { label: 'Hop', blurb: 'Jumps X, Y cells at a time, wrapping round the grid.' },
};

export const PATTERN_KINDS = ['none', 'ripple', 'diagonal', 'checker', 'rings', 'spiral', 'stripes', 'random'] as const;
export type PatternKind = typeof PATTERN_KINDS[number];
export const PATTERN_LABELS: Record<PatternKind, { label: string; blurb: string }> = {
  none: { label: 'None', blurb: 'No wave: every shape as you set it.' },
  ripple: { label: 'Ripple', blurb: 'Rings travelling out from the centre.' },
  diagonal: { label: 'Diagonal', blurb: 'Waves running corner to corner.' },
  checker: { label: 'Checker', blurb: 'Every other cell, swapping over time.' },
  rings: { label: 'Rings', blurb: 'Rings of cells, alternating, moving outwards.' },
  spiral: { label: 'Spiral', blurb: 'Spiral arms turning round the centre.' },
  stripes: { label: 'Stripes', blurb: 'Columns in waves, left to right.' },
  random: { label: 'Random', blurb: 'Each cell its own phase: twinkling.' },
};

export const PATTERN_TARGETS = ['size', 'turn', 'push', 'hue', 'bright'] as const;
export type PatternTarget = typeof PATTERN_TARGETS[number];
export const TARGET_LABELS: Record<PatternTarget, string> = { size: 'Size', turn: 'Turn', push: 'Push', hue: 'Hue', bright: 'Brightness' };

export const WHEN_KINDS = ['cell', 'column', 'row', 'sameCell', 'near'] as const;
export type WhenKind = typeof WHEN_KINDS[number];
export const DO_KINDS = ['become', 'colour', 'swap', 'grow', 'hide', 'spin'] as const;
export type DoKind = typeof DO_KINDS[number];
export const WHEN_LABELS: Record<WhenKind, string> = { cell: 'is in the cell', column: 'is in the column', row: 'is in the row', sameCell: 'shares a cell with', near: 'is near' };
export const DO_LABELS: Record<DoKind, string> = { become: 'becomes', colour: 'turns the colour', swap: 'swaps colours with', grow: 'grows by', hide: 'hides', spin: 'spins' };

export interface Motion {
  path: MotionPath;
  /** The XY control: how far, in cells (y up). Travel and Hop: the step each cycle. */
  xy: Vec2;
  /** Cycles a second. */
  speed: number;
  /** Each cell starts this much of a cycle later than the one before it (x + y): a wave of motion. */
  lag: number;
}

export interface GShape {
  id: string;
  kind: ShapeKind;
  color: Vec3;
  /** Radius as a share of half a cell: 1 touches the neighbours. */
  size: number;
  /** Degrees. */
  turn: number;
  /** Turns a second. */
  spin: number;
  /** How much the size breathes (0 … 1), once a cycle of its motion speed (or a second when still). */
  pulse: number;
  /** 0 filled; above 0 an outline this wide (a share of half a cell). */
  outline: number;
  motion: Motion;
}

export interface Cell { x: number; y: number; s: string }

export interface Pattern {
  kind: PatternKind;
  target: PatternTarget;
  amount: number;
  /** Waves across the grid. */
  freq: number;
  /** Cycles a second. */
  speed: number;
  /** Spiral arms. */
  arms: number;
  /** A shape the pattern puts in every empty cell (its size follows the wave), or null. */
  fill: string | null;
  /** Words the pattern is limited to (textMask.ts): the wave and the fill only in the cells they cover. Absent or null: everywhere. */
  mask?: TextMask | null;
}

export interface GridRule {
  id: string;
  on: boolean;
  when: { kind: WhenKind; a: string; b?: string; x?: number; y?: number; dist?: number };
  do: { kind: DoKind; shape?: string; color?: Vec3; amount?: number };
}

export interface Look {
  bg: Vec3;
  lines: boolean;
  lineColor: Vec3;
  lineWidth: number;
  glow: boolean;
  glowAmount: number;
  glowFalloff: number;
  tone: 'none' | 'aces';
}

export interface GridSceneSpec {
  v: 1;
  cols: number;
  rows: number;
  span: number;
  shapes: GShape[];
  cells: Cell[];
  pattern: Pattern;
  warps: SpaceBlock[];
  rules: GridRule[];
  look: Look;
}

const PALETTE: Vec3[] = [[0.35, 0.8, 1], [1, 0.45, 0.7], [1, 0.82, 0.3], [0.5, 1, 0.6], [0.75, 0.55, 1], [1, 0.55, 0.3]];
const KINDS_IN_ORDER: ShapeKind[] = ['circle', 'star', 'square', 'heart', 'triangle', 'ring'];

export const stillMotion = (): Motion => ({ path: 'still', xy: [0, 0.3], speed: 0.5, lag: 0 });

/** A new shape for slot `id` (A, B…): a kind and colour of its own, still. */
export function newShape(id: string, o: Partial<GShape> = {}): GShape {
  const i = Math.max(0, SHAPE_IDS.indexOf(id as typeof SHAPE_IDS[number]));
  return { id, kind: KINDS_IN_ORDER[i % KINDS_IN_ORDER.length], color: [...PALETTE[i % PALETTE.length]] as Vec3, size: 0.7, turn: 0, spin: 0, pulse: 0, outline: 0, motion: stillMotion(), ...o };
}

export const defaultPattern = (): Pattern => ({ kind: 'none', target: 'size', amount: 0.5, freq: 4, speed: 0.3, arms: 3, fill: null });

export const defaultLook = (): Look => ({
  bg: [0.03, 0.035, 0.06], lines: true, lineColor: [0.22, 0.25, 0.35], lineWidth: 0.03, glow: true, glowAmount: 0.006, glowFalloff: 1.4, tone: 'aces',
});

/** An empty 10 × 10 grid with shape A ready to draw. */
export function emptyGridScene(): GridSceneSpec {
  return { v: 1, cols: 10, rows: 10, span: 0.9, shapes: [newShape('A')], cells: [], pattern: defaultPattern(), warps: [], rules: [], look: defaultLook() };
}

/** What the builder opens on: a small heart of A's in the middle, so there is something to see. */
export function starterGridScene(): GridSceneSpec {
  const s = emptyGridScene();
  s.shapes = [newShape('A', { kind: 'circle', size: 0.6, motion: { path: 'updown', xy: [0, 0.25], speed: 0.4, lag: 0.08 } })];
  const heart = ['..XX.XX...', '.XXXXXXX..', '.XXXXXXX..', '..XXXXX...', '...XXX....', '....X.....'];
  heart.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === 'X') s.cells.push({ x: i, y: j + 2, s: 'A' }); }));
  return s;
}

// ── Reading and editing ─────────────────────────────────────────────────────

export const clampCells = (n: unknown) => Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.round(typeof n === 'number' && Number.isFinite(n) ? n : 10)));
export const cellSize = (spec: Pick<GridSceneSpec, 'cols' | 'rows' | 'span'>) => (2 * spec.span) / Math.max(spec.cols, spec.rows);
export const shapeOf = (spec: GridSceneSpec, id: string | null | undefined) => spec.shapes.find(s => s.id === id);
export const cellAt = (spec: GridSceneSpec, x: number, y: number) => spec.cells.find(c => c.x === x && c.y === y);

/** The next free shape slot (A, B…), or null when all MAX_SHAPES are taken. */
export function nextShapeId(spec: GridSceneSpec): string | null {
  return SHAPE_IDS.find(id => !spec.shapes.some(s => s.id === id)) ?? null;
}

/** Put shape `s` in cell (x, y) (replacing what is there). False when outside the grid, unknown, or the grid is full. */
export function placeCell(spec: GridSceneSpec, x: number, y: number, s: string): boolean {
  if (x < 0 || y < 0 || x >= spec.cols || y >= spec.rows || !shapeOf(spec, s)) return false;
  const hit = cellAt(spec, x, y);
  if (hit) { hit.s = s; return true; }
  if (spec.cells.length >= MAX_PLACED) return false;
  spec.cells.push({ x, y, s });
  return true;
}

/** Clear cell (x, y). True when something was there. */
export function eraseCell(spec: GridSceneSpec, x: number, y: number): boolean {
  const i = spec.cells.findIndex(c => c.x === x && c.y === y);
  if (i < 0) return false;
  spec.cells.splice(i, 1);
  return true;
}

/** Change the grid's size: cells now outside it go. */
export function resizeGrid(spec: GridSceneSpec, cols: number, rows: number): void {
  spec.cols = clampCells(cols);
  spec.rows = clampCells(rows);
  spec.cells = spec.cells.filter(c => c.x < spec.cols && c.y < spec.rows);
}

/** Take shape `id` away: its cells, its rules and the pattern's fill go with it. */
export function removeShape(spec: GridSceneSpec, id: string): void {
  spec.shapes = spec.shapes.filter(s => s.id !== id);
  spec.cells = spec.cells.filter(c => c.s !== id);
  spec.rules = spec.rules.filter(r => r.when.a !== id && r.when.b !== id && r.do.shape !== id);
  if (spec.pattern.fill === id) spec.pattern.fill = null;
}

export function newRule(spec: GridSceneSpec): GridRule {
  const a = spec.shapes[0]?.id ?? 'A';
  const b = spec.shapes[1]?.id;
  const n = spec.rules.reduce((m, r) => Math.max(m, Number(r.id.replace(/\D/g, '')) || 0), 0) + 1;
  return b
    ? { id: `r${n}`, on: true, when: { kind: 'sameCell', a, b }, do: { kind: 'swap' } }
    : { id: `r${n}`, on: true, when: { kind: 'column', a, x: Math.floor(spec.cols / 2) }, do: { kind: 'colour', color: [1, 1, 1] } };
}

/** Does a rule name only shapes that exist (and the partner it needs)? */
export function ruleProblem(spec: GridSceneSpec, r: GridRule): string | null {
  if (!shapeOf(spec, r.when.a)) return `shape ${r.when.a} isn't in the scene`;
  if ((r.when.kind === 'sameCell' || r.when.kind === 'near' || r.do.kind === 'swap') && !shapeOf(spec, r.when.b)) return 'it needs a second shape';
  if (r.do.kind === 'become' && !shapeOf(spec, r.do.shape)) return 'it needs a shape to become';
  if (r.do.kind === 'swap' && r.when.kind !== 'sameCell' && r.when.kind !== 'near') return 'swap needs “shares a cell with” or “is near”';
  return null;
}

/** A copy of a library block for the warps list. */
export const warpOf = (b: SpaceBlock): SpaceBlock => cloneBlock(b);

/** One line for a shape: "circle · up and down". */
export function shapeSummary(spec: GridSceneSpec, s: GShape): string {
  const n = spec.cells.filter(c => c.s === s.id).length;
  return `${SHAPE_LABELS[s.kind].toLowerCase()} · ${n} cell${n === 1 ? '' : 's'}${spec.pattern.fill === s.id ? ' · pattern fill' : ''}${s.motion.path === 'still' ? '' : ` · ${MOTION_LABELS[s.motion.path].label.toLowerCase()}`}`;
}

/** One line for a rule, in words: "When A shares a cell with B, A swaps colours with B". */
export function ruleText(r: GridRule): string {
  const w = r.when;
  const where = w.kind === 'cell' ? `${WHEN_LABELS.cell} (${w.x ?? 0}, ${w.y ?? 0})`
    : w.kind === 'column' ? `${WHEN_LABELS.column} ${w.x ?? 0}`
      : w.kind === 'row' ? `${WHEN_LABELS.row} ${w.y ?? 0}`
        : w.kind === 'near' ? `is within ${w.dist ?? 1} cell${(w.dist ?? 1) === 1 ? '' : 's'} of ${w.b}`
          : `${WHEN_LABELS.sameCell} ${w.b}`;
  const d = r.do;
  const what = d.kind === 'become' ? `becomes ${d.shape}` : d.kind === 'colour' ? 'changes colour' : d.kind === 'swap' ? `swaps colours with ${w.b}`
    : d.kind === 'grow' ? `grows ×${d.amount ?? 1.5}` : d.kind === 'hide' ? 'hides' : `spins ${d.amount ?? 1} turn${(d.amount ?? 1) === 1 ? '' : 's'} a second`;
  return `When ${w.a} ${where}, ${w.a} ${what}`;
}

// ── Motion on the CPU (the same sums as the shader: glsl.ts) ──────────────────

const TAU = Math.PI * 2;
const fract = (v: number) => v - Math.floor(v);

/** Where a shape whose home is cell (hx, hy) is at time t, in cell coordinates (the cell's centre is +0.5; y down). */
export function motionAt(spec: Pick<GridSceneSpec, 'cols' | 'rows'>, m: Motion, hx: number, hy: number, t: number): Vec2 {
  const ph = t * m.speed + m.lag * (hx + hy);
  const a = ph * TAU;
  const [ax, ay] = m.xy;
  let ox = 0, oy = 0;
  switch (m.path) {
    case 'updown': oy = ay * Math.sin(a); break;
    case 'sideways': ox = ax * Math.sin(a); break;
    case 'both': ox = ax * Math.sin(a); oy = ay * Math.sin(a); break;
    case 'circle': ox = ax * Math.cos(a); oy = ay * Math.sin(a); break;
    case 'eight': ox = ax * Math.sin(a); oy = ay * Math.sin(2 * a); break;
    case 'bounce': oy = ay * Math.abs(Math.sin(a * 0.5)); break;
    case 'travel': ox = ax * ph; oy = ay * ph; break;
    case 'hop': ox = ax * Math.floor(ph); oy = ay * Math.floor(ph); break;
    default: break;
  }
  let px = hx + 0.5 + ox, py = hy + 0.5 - oy;
  if (m.path === 'travel' || m.path === 'hop') { px = fract(px / spec.cols) * spec.cols; py = fract(py / spec.rows) * spec.rows; }
  return [px, py];
}
