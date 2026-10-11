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
import type { TexSource } from '../builders/textures';
import type { Mutable } from '../builders/mute';
import { defaultDrawnPath, pathAt, pathConfig, samplePoints, type DrawnPath } from './paths';
import { mathOf, mathPoint, modOffset, modPhase, modsOf, varyRandom, type MathPath, type MotionMix, type PathMod, type Vary, type VaryKey } from './pathMods';

/** A Drawn path with no stroke yet moves round the default one (as the shader does). */
const DEFAULT_DRAWN = defaultDrawnPath();

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export const MIN_CELLS = 2;
export const MAX_CELLS = 24;
/** Most placed cells: the whole grid. The drawing is data the shader looks cells up in (glsl.ts). */
export const MAX_PLACED = 24 * 24;
export const MAX_SHAPES = 6;
export const MAX_RULES = 8;
export const MAX_WARPS = 3;
export const SHAPE_IDS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export const SHAPE_KINDS = ['circle', 'square', 'ring', 'diamond', 'triangle', 'hexagon', 'star', 'plus', 'cross', 'heart', 'picture'] as const;
export type ShapeKind = typeof SHAPE_KINDS[number];
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  circle: 'Circle', square: 'Square', ring: 'Ring', diamond: 'Diamond', triangle: 'Triangle', hexagon: 'Hexagon', star: 'Star', plus: 'Plus', cross: 'Cross', heart: 'Heart', picture: 'Picture',
};

/**
 * How a shape carries its picture (docs/grid-builder.md, "Pictures in pieces"):
 *   cell   the whole picture inside every shape, fitted to its square (the Picture shape's way);
 *   mask   the picture stays put on the screen; the shapes are windows onto it, moving over it;
 *   matte  each shape is one flat colour, the picture's at its home cell's centre (a mosaic);
 *   piece  each shape carries its own piece of the picture, from round its home cell, and takes it
 *          wherever it moves, turns or grows: the picture is made of the pieces.
 */
export const PIC_MODES = ['cell', 'mask', 'matte', 'piece'] as const;
export type PicMode = typeof PIC_MODES[number];
export const PIC_MODE_LABELS: Record<PicMode, { label: string; word: string; blurb: string }> = {
  cell: { label: 'In each shape', word: 'cell', blurb: 'The whole picture inside every shape, turning and pulsing with it.' },
  mask: { label: 'Mask', word: 'mask', blurb: 'The picture stays still; the shapes are windows onto it, so moving shapes show different parts of it.' },
  matte: { label: 'Matte: colour', word: 'matte', blurb: 'Each shape is one flat colour: the picture\'s colour at its home cell\'s centre. A mosaic that moves with the shapes.' },
  piece: { label: 'Matte: piece', word: 'piece', blurb: 'Each shape carries its own piece of the picture wherever it moves, spins or grows. At rest the pieces make up the picture.' },
};
/** The picture mode a shape uses (a picture shape defaults to its own: in each cell). */
export const picModeOf = (s: Pick<GShape, 'picMode'>): PicMode => ((PIC_MODES as readonly string[]).includes(s.picMode as string) ? s.picMode! : 'cell');

export const MOTION_PATHS = ['still', 'updown', 'sideways', 'both', 'circle', 'eight', 'bounce', 'travel', 'hop', 'drawn', 'math'] as const;
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
  drawn: { label: 'Drawn', blurb: 'Your own path: draw it on the pad (or Generate one), X wide and Y tall.' },
  math: { label: 'Math', blurb: 'A path from a formula (x and y of t, 0 to 1 round the cycle) or a curve from the library (Lissajous, loops, stars, spirals), X wide and Y tall.' },
};

export const PATTERN_KINDS = ['none', 'ripple', 'diagonal', 'checker', 'rings', 'spiral', 'stripes', 'random', 'picture'] as const;
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
  picture: { label: 'Picture', blurb: 'A picture over the grid: each cell takes its brightness there (bright is the wave\'s top), so the picture drives the size, turn, colour…' },
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
  /** Degrees: turns the whole path (the XY arrow) round, keeping its length. Absent: 0. Live. */
  angle?: number;
  /** Degrees a second the Angle turns on its own. Absent: 0. Live. */
  angleSpin?: number;
  /** The Drawn path's stroke and settings (kept when another path is picked, so it comes back). */
  drawn?: DrawnPath;
  /** The Math path's formula or curve (kept when another path is picked). */
  math?: MathPath;
  /** Path modifiers, in order (not for Travel and Hop). */
  mods?: PathMod[];
  /** Vary per cell: a random strength per number (absent: every cell alike, and the code as it was). */
  vary?: Vary;
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
  /** The picture the shape carries (a name in the scene's textures): any kind; a Picture shape needs one. */
  tex?: string;
  /** How it carries it (PIC_MODES). Absent: 'cell', the whole picture in every shape. */
  picMode?: PicMode;
  /** Switched off for now (builders/mute.ts): left out of the build, its cells and settings kept. */
  muted?: boolean;
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
  /** kind 'picture': the picture whose brightness is the wave (a name in the scene's textures). */
  tex?: string;
  /** Switched off for now (builders/mute.ts): built as no pattern, settings kept. */
  muted?: boolean;
}

/** One condition of a rule on its shape (`a`, the rule's): where it is, or the shape it meets. */
export interface GridClause { kind: WhenKind; b?: string; x?: number; y?: number; dist?: number }
export type GridWhen = GridClause & { a: string };
export type GridDo = { kind: DoKind; shape?: string; color?: Vec3; amount?: number };
export const JOINS = ['and', 'or'] as const;
export type Join = typeof JOINS[number];
/** Most extra conditions a rule can have (after its first When). */
export const MAX_ALSO = 3;

export interface GridRule {
  id: string;
  on: boolean;
  when: GridWhen;
  /**
   * More conditions on the same shape, each joined to everything before it (left to right: "A and B
   * or C" is "(A and B) or C"). Absent: the one When.
   */
  also?: Array<{ join: Join; when: GridClause }>;
  do: GridDo;
  /** What the shape does while the conditions are false ("else"). Absent or null: nothing. */
  else?: GridDo | null;
  /**
   * "Stays changed": once the conditions have held for a drawn cell, that cell keeps the Do after
   * they end (a memory pass, docs/grid-builder.md "Rules that stay changed"). Absent: false.
   */
  sticky?: boolean;
}

/** A rule's conditions in order, the first with no join. */
export function ruleClauses(r: GridRule): Array<{ join: Join | null; when: GridClause }> {
  const { a: _a, ...first } = r.when;
  return [{ join: null, when: first }, ...(r.also ?? []).filter(x => x && x.when && (WHEN_KINDS as readonly string[]).includes(x.when.kind)).map(x => ({ join: x.join === 'or' ? 'or' as const : 'and' as const, when: x.when }))];
}
/** Does a condition name a second shape? */
export const clauseNeedsB = (c: Pick<GridClause, 'kind'>) => c.kind === 'sameCell' || c.kind === 'near';

export interface Look {
  bg: Vec3;
  lines: boolean;
  lineColor: Vec3;
  lineWidth: number;
  glow: boolean;
  glowAmount: number;
  glowFalloff: number;
  /**
   * soft (absent): one shape, its colour running out into the glow (colour × (amount ÷ (distance
   * outside + amount)) ^ falloff, 1 at the edge). halo: the Glow Layer's amount ÷ |distance|, a bright
   * rim round a flat shape.
   */
  glowStyle?: 'soft' | 'halo';
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
  /** A warp can be muted: still built, its node bypassed by a live uniform (builders/mute.ts). */
  warps: Array<SpaceBlock & Mutable>;
  rules: GridRule[];
  look: Look;
  /** The pictures the scene reads (builders/textures.ts): picture cells, a picture pattern, the mask. */
  textures?: TexSource[];
  /** Shapes only in the cells where a picture is bright (or dark, inverted), read at each cell's centre. */
  picMask?: GridPicMask | null;
  /** How the drawing covers the grid (DRAW_MODES). Absent: each cell only itself. */
  draw?: DrawSpec | null;
  /**
   * "Make it a simulation": the Grid Rules state each shape starts as (shape id → 0 left out,
   * 1…15), remembered for the next jump. Absent (or a shape missing): state 1.
   */
  simStates?: Record<string, number> | null;
  /** The scene's motion mix: one motion shared by every shape, the per-shape Offset, the Seed of Vary per cell. Absent: none (the code as it was). */
  motionMix?: MotionMix;
}

/** Most states a drawn start can hold (Grid Rules' start cells: 1–9, a–f). */
export const MAX_SIM_STATE = 15;
/** The state shape `id` starts the simulation as (0 left out). */
export function simStateOf(spec: Pick<GridSceneSpec, 'simStates'>, id: string): number {
  const v = spec.simStates?.[id];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(MAX_SIM_STATE, Math.round(v))) : 1;
}

export interface GridPicMask { tex: string; cut: number; invert: boolean }

/**
 * How the brush's drawing covers the grid (docs/grid-builder.md, "Draw modes"). The drawing stays
 * the source; the shader maps each cell to the cell of the drawing it shows before reading it:
 *   here     each cell shows itself (the default);
 *   repeat   the tile of period × period cells from offset repeats over the grid (cell id mod the
 *            period, as Cell Filter's Modulo), each row of tiles shifted by shift cells (bricks);
 *   mirrorX  the left half reflects into the right; mirrorY the top half into the bottom; mirrorXY both;
 *   rotate4  the top-left quarter turned round the middle four times (a kaleidoscope; square grids).
 */
export const DRAW_MODES = ['here', 'repeat', 'mirrorX', 'mirrorY', 'mirrorXY', 'rotate4'] as const;
export type DrawMode = typeof DRAW_MODES[number];
export const DRAW_MODE_LABELS: Record<DrawMode, { label: string; blurb: string }> = {
  here: { label: 'Only here', blurb: 'A shape goes only in the cell you draw it in.' },
  repeat: { label: 'Repeat', blurb: 'Draw in one tile: it repeats over the whole grid, every Period cells across and down.' },
  mirrorX: { label: 'Mirror X', blurb: 'Draw on the left half: the right half is its reflection.' },
  mirrorY: { label: 'Mirror Y', blurb: 'Draw on the top half: the bottom half is its reflection.' },
  mirrorXY: { label: 'Mirror both', blurb: 'Draw in the top-left quarter: it reflects across and down.' },
  rotate4: { label: 'Rotate 4', blurb: 'Draw in the top-left quarter: it turns round the middle into all four (best on a square grid).' },
};
export interface DrawSpec {
  mode: DrawMode;
  /** Repeat: the tile's size in cells (x across, y down). */
  period: Vec2;
  /** Repeat: where the tile starts (cells). */
  offset: Vec2;
  /** Repeat: each row of tiles slides this many cells across (bricks, staggers). */
  shift: number;
  /**
   * What a copy runs as: 'shown' (the default) its own cell, so lag ripples across the copies and
   * rules and pictures see where it is; 'source' the drawn cell it copies, so every copy moves and
   * looks alike ("Copies match the drawn cell").
   */
  copies?: DrawCopies;
}
export type DrawCopies = 'shown' | 'source';
export const defaultDraw = (): DrawSpec => ({ mode: 'here', period: [2, 2], offset: [0, 0], shift: 0 });
export const drawOf = (spec: Pick<GridSceneSpec, 'draw'>): DrawSpec => ({ ...defaultDraw(), ...(spec.draw ?? {}) });

const imod = (a: number, b: number) => a - b * Math.floor(a / b);

/**
 * The cell of the drawing that cell (x, y) shows under the draw mode (the same sums as the shader's
 * gs_cell), or null when it shows none (a turned cell outside a non-square grid).
 */
export function sourceCell(spec: Pick<GridSceneSpec, 'cols' | 'rows' | 'draw'>, x: number, y: number): [number, number] | null {
  const d = drawOf(spec);
  const { cols, rows } = spec;
  let sx = x, sy = y;
  switch (d.mode) {
    case 'repeat': {
      const px = Math.max(1, Math.round(d.period[0])), py = Math.max(1, Math.round(d.period[1]));
      const ox = Math.round(d.offset[0]), oy = Math.round(d.offset[1]);
      const ry = y - oy;
      const row = Math.floor(ry / py);
      const rx = x - ox - Math.round(d.shift) * row;
      sx = ox + imod(rx, px); sy = oy + imod(ry, py);
      break;
    }
    case 'mirrorX': sx = Math.min(x, cols - 1 - x); break;
    case 'mirrorY': sy = Math.min(y, rows - 1 - y); break;
    case 'mirrorXY': sx = Math.min(x, cols - 1 - x); sy = Math.min(y, rows - 1 - y); break;
    case 'rotate4': {
      const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
      let dx = x - cx, dy = y - cy;
      for (let k = 0; k < 4; k++) {
        if ((dx < 0 && dy <= 0) || (dx === 0 && dy === 0)) break;
        [dx, dy] = [dy, -dx];
      }
      sx = Math.floor(cx + dx + 0.5); sy = Math.floor(cy + dy + 0.5);
      break;
    }
    default: break;
  }
  return sx >= 0 && sy >= 0 && sx < cols && sy < rows ? [sx, sy] : null;
}

/** Is cell (x, y) part of the drawing itself (not a copy) under the draw mode? */
export const isSourceCell = (spec: Pick<GridSceneSpec, 'cols' | 'rows' | 'draw'>, x: number, y: number) => {
  const s = sourceCell(spec, x, y);
  return !!s && s[0] === x && s[1] === y;
};

/** The shape each cell shows (after the draw mode), cols × rows, row by row: a shape id or null. */
export function shownCells(spec: GridSceneSpec): Array<string | null> {
  const at = new Map(spec.cells.map(c => [`${c.x},${c.y}`, c.s]));
  const out: Array<string | null> = [];
  for (let y = 0; y < spec.rows; y++) {
    for (let x = 0; x < spec.cols; x++) {
      const s = sourceCell(spec, x, y);
      const id = s ? at.get(`${s[0]},${s[1]}`) : undefined;
      out.push(id && shapeOf(spec, id) ? id : null);
    }
  }
  return out;
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
  spec.rules = spec.rules.filter(r => r.when.a !== id && r.when.b !== id && r.do.shape !== id && r.else?.shape !== id && !(r.also ?? []).some(x => x.when.b === id));
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
  if ((clauseNeedsB(r.when) || r.do.kind === 'swap') && !shapeOf(spec, r.when.b)) return 'it needs a second shape';
  if (ruleClauses(r).slice(1).some(c => clauseNeedsB(c.when) && !shapeOf(spec, c.when.b))) return 'a condition needs a second shape';
  if (r.do.kind === 'become' && !shapeOf(spec, r.do.shape)) return 'it needs a shape to become';
  if (r.do.kind === 'swap' && !clauseNeedsB(r.when)) return 'swap needs “shares a cell with” or “is near”';
  if (r.else && r.else.kind === 'become' && !shapeOf(spec, r.else.shape)) return 'its Else needs a shape to become';
  if (r.else && r.else.kind === 'swap') return 'Else can\'t swap colours';
  return null;
}

/** A copy of a library block for the warps list. */
export const warpOf = (b: SpaceBlock): SpaceBlock => cloneBlock(b);

/** One line for a shape: "circle · up and down". */
export function shapeSummary(spec: GridSceneSpec, s: GShape): string {
  const n = spec.cells.filter(c => c.s === s.id).length;
  return `${SHAPE_LABELS[s.kind].toLowerCase()} · ${n} cell${n === 1 ? '' : 's'}${spec.pattern.fill === s.id ? ' · pattern fill' : ''}${s.motion.path === 'still' ? '' : ` · ${MOTION_LABELS[s.motion.path].label.toLowerCase()}`}`;
}

/** A condition in words: "is in the column 4", "is within 2 cells of B". */
export function clauseText(w: GridClause): string {
  return w.kind === 'cell' ? `${WHEN_LABELS.cell} (${w.x ?? 0}, ${w.y ?? 0})`
    : w.kind === 'column' ? `${WHEN_LABELS.column} ${w.x ?? 0}`
      : w.kind === 'row' ? `${WHEN_LABELS.row} ${w.y ?? 0}`
        : w.kind === 'near' ? `is within ${w.dist ?? 1} cell${(w.dist ?? 1) === 1 ? '' : 's'} of ${w.b}`
          : `${WHEN_LABELS.sameCell} ${w.b}`;
}

/** A Do in words: "becomes B", "grows ×1.5". */
export function doText(d: GridDo, b?: string): string {
  return d.kind === 'become' ? `becomes ${d.shape}` : d.kind === 'colour' ? 'changes colour' : d.kind === 'swap' ? `swaps colours with ${b}`
    : d.kind === 'grow' ? `grows ×${d.amount ?? 1.5}` : d.kind === 'hide' ? 'hides' : `spins ${d.amount ?? 1} turn${(d.amount ?? 1) === 1 ? '' : 's'} a second`;
}

/** One line for a rule, in words: "When A shares a cell with B, A swaps colours with B" (with its and / or, else, and "stays changed"). */
export function ruleText(r: GridRule): string {
  const w = r.when;
  const where = ruleClauses(r).map((c, i) => `${i ? `${c.join} ` : ''}${clauseText(c.when)}`).join(' ');
  return `When ${w.a} ${where}, ${w.a} ${doText(r.do, w.b)}${r.sticky ? ' and stays changed' : ''}${r.else ? `, else ${w.a} ${doText(r.else, w.b)}` : ''}`;
}

// ── Motion on the CPU (the same sums as the shader: glsl.ts) ──────────────────

const TAU = Math.PI * 2;
const fract = (v: number) => v - Math.floor(v);

/** Where a shape whose home is cell (hx, hy) is at time t, in cell coordinates (the cell's centre is +0.5; y down). */
/** The motion's turn at time t, radians: Angle + Spin × t (both in degrees). */
export const motionTheta = (m: Pick<Motion, 'angle' | 'angleSpin'>, t: number) => ((m.angle ?? 0) + (m.angleSpin ?? 0) * t) * Math.PI / 180;
/** (x, y) turned `th` radians counter-clockwise, y up (the shader's gs_rot). */
export function rotate2(v: Vec2, th: number): Vec2 {
  const c = Math.cos(th), s = Math.sin(th);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1]];
}

const sampled = new WeakMap<DrawnPath, Vec2[]>();
/** A drawn path's arc-length points (cached per path object: the mini grid asks often). */
export function drawnPoints(p: DrawnPath): Vec2[] {
  let q = sampled.get(p);
  if (!q) { q = samplePoints(p); sampled.set(p, q); }
  return q;
}

/** A path's offset from its home (cells, y up) at phase `ph` cycles and time t, with its modifiers, before the Angle: the shader's gs_move. */
export function pathOffsetAt(m: Motion, ph: number, t = 0): Vec2 {
  const mods = modsOf(m);
  if (!mods.length) return baseOffsetAt(m, ph);
  const q = modPhase(mods, ph);
  return modOffset(mods, baseOffsetAt(m, q), q, t, e => baseOffsetAt(m, e));
}

/** The unmodified path's offset (the shader's gs_base). */
function baseOffsetAt(m: Motion, ph: number): Vec2 {
  const a = ph * TAU;
  const [ax, ay] = m.xy;
  switch (m.path) {
    case 'updown': return [0, ay * Math.sin(a)];
    case 'sideways': return [ax * Math.sin(a), 0];
    case 'both': return [ax * Math.sin(a), ay * Math.sin(a)];
    case 'circle': return [ax * Math.cos(a), ay * Math.sin(a)];
    case 'eight': return [ax * Math.sin(a), ay * Math.sin(2 * a)];
    case 'bounce': return [0, ay * Math.abs(Math.sin(a * 0.5))];
    case 'travel': return [ax * ph, ay * ph];
    case 'hop': return [ax * Math.floor(ph), ay * Math.floor(ph)];
    case 'drawn': {
      const d = m.drawn ?? DEFAULT_DRAWN;
      const p = pathAt(drawnPoints(d), pathConfig(d), ph);
      return [ax * p[0], ay * p[1]];
    }
    case 'math': { const p = mathPoint(mathOf(m), ph - Math.floor(ph)); return [ax * p[0], ay * p[1]]; }
    default: return [0, 0];
  }
}

/**
 * Where a shape whose home is cell (hx, hy) is at time t (the shader's gs_move): its path, its
 * modifiers, its Angle, and with `index` (its place for the scene's Offset: shapeIndex) the scene's
 * mix and its per-cell vary.
 */
export function motionAt(spec: Pick<GridSceneSpec, 'cols' | 'rows'> & { motionMix?: MotionMix }, m: Motion, hx: number, hy: number, t: number, index = 0): Vec2 {
  const wrap = m.path === 'travel' || m.path === 'hop';
  const mix = spec.motionMix;
  const seed = mix?.seed ?? 0;
  const r = (k: VaryKey) => (!wrap && m.vary?.[k]?.amt ? m.vary[k]!.amt * varyRandom(hx, hy, seed, k, m.vary[k]) : 0);
  const reach = (1 + r('reach')) * (1 + index * (mix?.offReach ?? 0));
  const modsMul = 1 + r('mods');
  const mv: Motion = reach === 1 && modsMul === 1 ? m : {
    ...m, xy: [m.xy[0] * reach, m.xy[1] * reach],
    mods: m.mods?.map(md => (md.kind === 'wave' || md.kind === 'noise' || md.kind === 'twist' ? { ...md, v: md.v.map((v, i) => (i === 0 ? v * modsMul : v)) } : md)),
  };
  const ph = t * m.speed * (1 + r('speed')) + m.lag * (hx + hy) + r('phase') + index * (mix?.offPhase ?? 0);
  let [ox, oy] = pathOffsetAt(mv, ph, t);
  const th = motionTheta(m, t) + r('angle') * Math.PI + index * (mix?.offAngle ?? 0) * Math.PI / 180;
  if (th) [ox, oy] = rotate2([ox, oy], th);
  let px = hx + 0.5 + ox, py = hy + 0.5 - oy;
  if (m.path === 'travel' || m.path === 'hop') { px = fract(px / spec.cols) * spec.cols; py = fract(py / spec.rows) * spec.rows; }
  return [px, py];
}

/** The names of the pictures a grid scene uses. */
export function texturesUsedGrid(spec: GridSceneSpec): string[] {
  const out = spec.shapes.filter(s => s.tex).map(s => s.tex!);
  if (spec.pattern.kind === 'picture' && spec.pattern.tex) out.push(spec.pattern.tex);
  if (spec.picMask) out.push(spec.picMask.tex);
  return [...new Set(out)];
}

// ── Muting (docs/grid-builder.md, "Muting") ─────────────────────────────────

/**
 * The scene as it builds: a muted shape is left out (with its cells, the rules that name it and the
 * pattern's fill of it), a muted pattern builds as no pattern. Warps stay: their nodes are gated
 * live (build.ts). Nothing muted: the spec itself, untouched.
 */
export function liveGridSpec(spec: GridSceneSpec): GridSceneSpec {
  const mutedShapes = spec.shapes.filter(s => s.muted);
  if (!mutedShapes.length && !spec.pattern.muted) return spec;
  const out: GridSceneSpec = { ...spec, pattern: { ...spec.pattern } };
  for (const s of mutedShapes) removeShape(out, s.id);
  if (out.pattern.muted) out.pattern = { ...out.pattern, kind: 'none', fill: null };
  return out;
}

/** The shapes an edit of shape `id`'s motion changes: every shape while the motion is Shared (docs/grid-builder.md "Shared motion"), else just it. */
export const motionTargets = (spec: GridSceneSpec, id: string): GShape[] => spec.shapes.filter(s => s.id === id || !!spec.motionMix?.shared);
