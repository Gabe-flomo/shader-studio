/**
 * spec.ts — what the Warp Builder edits (docs/warp-builder.md): a stack of warp blocks, each one a
 * space block of the 2D Scene Builder (sceneBuilder2d/blocks.ts) with a mute switch. The next block
 * warps the result of the one before. Rows are the block's lines; a row's tiles are its right-hand
 * side read as tiles (tiles.ts), and every tile edit writes the text back, so the block is always in
 * the one format the 2D builder, My blocks and the library use.
 *
 * Also: the number tile (a slider named from where it lands), Surprise me (a random tile
 * expression), and moving stacks to and from the 2D builder's space. Pure: no React, no store.
 */
import {
  MAX_LINES, blockMap, checkBlock, cloneBlock, paramNameProblem, rangeFor,
  type BlockLine, type BlockOp, type BlockTarget, type Map2, type SpaceBlock,
} from '../sceneBuilder2d/blocks';
import type { SpaceOp } from '../sceneBuilder2d/spec';
import { mulberry32 } from '../lib/surprise/rng';
import {
  HOLE, HOLE_TEXT, appendTo, childrenOf, holePaths, isBool, moveTile, opAt, paramsIn, removeAt, replaceAt, slotKind, textToTile, tileAt, tileText, withChildren, wrapAt,
  type CmpOp, type LogicOp, type Tile, type TileOp, type TilePath, type VarName,
} from './tiles';

export type PreviewMode = 'checker' | 'ring' | 'vectors' | 'heat';
export const PREVIEW_MODES: ReadonlyArray<{ mode: PreviewMode; label: string; blurb: string }> = [
  { mode: 'checker', label: 'Checkerboard', blurb: 'A checkerboard and grid lines seen through the warp' },
  { mode: 'ring', label: 'Ring', blurb: 'A glowing white ring seen through the warp' },
  { mode: 'vectors', label: 'Vectors', blurb: 'Arrows: where each point is sent (the displacement)' },
  { mode: 'heat', label: 'Heat', blurb: 'How far each point moves: dark still, bright far' },
];

export interface WarpItem { id: string; muted?: boolean; block: SpaceBlock }
export interface WarpSpec { blocks: WarpItem[] }

export const ROW_LABEL: Record<BlockTarget, string> = { 'uv.x': 'X', 'uv.y': 'Y', uv: 'UV' };

/** A new block: an X row and a Y row, both +=, empty. */
export function newWarpBlock(name = 'Warp'): SpaceBlock {
  return { name, lines: [{ target: 'uv.x', op: '+=', rhs: '' }, { target: 'uv.y', op: '+=', rhs: '' }], params: [], times: 1 };
}
export function nextItemId(spec: WarpSpec): string {
  const used = new Set(spec.blocks.map(b => b.id));
  for (let i = 1; ; i++) if (!used.has(`w${i}`)) return `w${i}`;
}
export function starterWarp(): WarpSpec {
  return { blocks: [{ id: 'w1', block: newWarpBlock() }] };
}

/** A row's tiles. */
export function rowTile(block: SpaceBlock, line: number): Tile | null {
  const l = block.lines[line];
  return l ? textToTile(l.rhs, block.params.map(p => p.name)) : null;
}

/**
 * Write a row's tiles back as its text, and drop sliders the edit took out of the block (sliders no
 * line reads any more that some line read before).
 */
export function setRowTile(block: SpaceBlock, line: number, tile: Tile | null): void {
  const before = usedParams(block);
  if (!block.lines[line]) return;
  block.lines[line].rhs = tileText(tile);
  const after = usedParams(block);
  block.params = block.params.filter(p => after.has(p.name) || !before.has(p.name));
}
function usedParams(block: SpaceBlock): Set<string> {
  const names = block.params.map(p => p.name);
  return new Set(block.lines.flatMap(l => paramsIn(textToTile(l.rhs, names))));
}

/** Add a row (up to three): X, then Y, then UV, whichever isn't there yet. */
export function addRow(block: SpaceBlock, target?: BlockTarget): boolean {
  if (block.lines.length >= MAX_LINES) return false;
  const has = new Set(block.lines.map(l => l.target));
  const t = target ?? (['uv.x', 'uv.y', 'uv'] as const).find(x => !has.has(x)) ?? 'uv';
  block.lines.push({ target: t, op: t === 'uv' ? '*=' : '+=', rhs: '' });
  return true;
}

// ── The number tile ──────────────────────────────────────────────────────────

/** A slider name from where the number lands: amp at the front of a product, freq inside a wave… */
export function nameForNumber(root: Tile | null, path: TilePath, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = 'a';
  const parent = path.length ? tileAt(root, path.slice(0, -1)) : null;
  const grand = path.length > 1 ? tileAt(root, path.slice(0, -2)) : null;
  if (parent?.k === 'op' && parent.op === '*' && grand?.k === 'call' && ['sin', 'cos', 'tan', 'fract', 'floor', 'mod', 'valueNoise'].includes(grand.fn)) base = 'freq';
  else if (parent?.k === 'call' && (parent.fn === 'rotate')) base = 'angle';
  else if (parent?.k === 'cmp') base = 'edge';
  else if (parent?.k === 'if') base = path[path.length - 1] === 2 ? 'b' : path[path.length - 1] === 3 ? 'width' : 'a';
  else if (parent?.k === 'op' && parent.op === '*' && path.length === 1) base = 'amp';
  else if (parent?.k === 'op' && parent.op === '*' && t_isTime(parent)) base = 'speed';
  else if (parent?.k === 'op' && (parent.op === '+' || parent.op === '-')) base = 'shift';
  else if (parent?.k === 'call') base = parent.fn === 'pow' ? 'power' : parent.fn === 'mix' ? 'amount' : 'edge';
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}${i}`;
    if (!used.has(name) && !paramNameProblem(name)) return name;
  }
}
const t_isTime = (op: Tile) => op.k === 'op' && [op.a, op.b].some(s => s.k === 'var' && s.name === 't');

/** A sensible starting value for a slider by its name. */
export function valueForName(name: string): number {
  const b = name.replace(/\d+$/, '');
  return b === 'amp' ? 0.1 : b === 'freq' ? 7 : b === 'speed' ? 1 : b === 'angle' ? 0.5 : b === 'power' ? 2 : b === 'amount' ? 0.5 : b === 'shift' ? 0.25 : b === 'edge' ? 0 : b === 'width' ? 0.05 : b === 'b' ? 0 : 0.5;
}

/** Drop the number tile at `path`: a new slider, read there by name. Returns its name. */
export function dropNumber(block: SpaceBlock, line: number, path: TilePath, value?: number): string {
  const root = rowTile(block, line);
  const name = nameForNumber(root, path, [...block.params.map(p => p.name), 'x', 'y', 'uv', 't', 'p', ...(block.loop ? ['fi', 'k', 'n', 'uv0', 'trap'] : [])]);
  const v = value ?? valueForName(name);
  block.params.push({ name, value: v, ...rangeFor(v) });
  const next = placeTile(root, path, { k: 'param', name });
  block.lines[line].rhs = tileText(next);
  return name;
}

/** Put a tile at a path ([] on an empty row: the row). */
export function placeTile(root: Tile | null, path: TilePath, tile: Tile): Tile {
  return replaceAt(root, path, tile);
}

// ── Checking ─────────────────────────────────────────────────────────────────

/** Per row: null when fine (or empty), else what is wrong, in plain words. */
export function rowProblems(block: SpaceBlock): Array<string | null> {
  const chk = checkBlock(block);
  return block.lines.map((l, i) => {
    if (l.rhs.includes(HOLE_TEXT) && /(^|[^\w])_([^\w]|$)/.test(l.rhs)) return 'Fill the empty slot: drop a tile on it.';
    const c = chk.lines[i];
    return c && !c.ok ? c.error ?? 'This row doesn’t check.' : null;
  });
}

// ── The whole stack, on the CPU ──────────────────────────────────────────────

/** Where the stack sends a point (muted blocks pass it through); `upTo` stops after that many blocks. */
export function warpMap(spec: WarpSpec, t = 0, upTo: number | null = null): Map2 {
  const maps = spec.blocks.slice(0, upTo ?? spec.blocks.length).filter(b => !b.muted).map(b => blockMap(b.block, t));
  return (x, y) => { let p: [number, number] = [x, y]; for (const m of maps) p = m(p[0], p[1]); return p; };
}

// ── To and from the 2D Scene Builder ─────────────────────────────────────────

/** The blocks of a 2D space stack (only `block` ops; `ids` picks some), as a warp stack. */
export function warpFromSpace(ops: readonly SpaceOp[], ids?: readonly string[]): WarpSpec {
  const picked = ops.filter(op => op.kind === 'block' && op.block && (!ids || ids.includes(op.id)));
  return { blocks: picked.map((op, i) => ({ id: `w${i + 1}`, muted: op.muted || undefined, block: cloneBlock(op.block!) })) };
}

/**
 * The warp stack written back into a 2D space stack: in place of the ops it came from (`ids`, the
 * first of them holding the place), else at the end. Other ops stay as they are. New op ids come
 * from `nextId`.
 */
export function spaceWithWarp(ops: readonly SpaceOp[], warp: WarpSpec, ids: readonly string[] | null, nextId: (taken: Set<string>) => string): SpaceOp[] {
  const taken = new Set(ops.map(o => o.id));
  const reuse = (ids ?? []).filter(id => ops.some(o => o.id === id));
  const made: SpaceOp[] = warp.blocks.map((b, i) => {
    const id = reuse[i] ?? nextId(taken);
    taken.add(id);
    return { id, kind: 'block', values: {}, block: cloneBlock(b.block), ...(b.muted ? { muted: true } : {}) };
  });
  if (!reuse.length) return [...ops, ...made];
  const out: SpaceOp[] = [];
  let placed = false;
  for (const op of ops) {
    if (!reuse.includes(op.id)) { out.push(op); continue; }
    if (!placed) { out.push(...made); placed = true; }
  }
  return out;
}

// ── Surprise me ──────────────────────────────────────────────────────────────

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];
const v = (name: VarName): Tile => ({ k: 'var', name });

/** A random warp block from `seed`: one or two rows of tiles (a wave, a twist, a fold, noise). */
export function surpriseWarp(seed: number): WarpSpec {
  const r = mulberry32(seed);
  const params: SpaceBlock['params'] = [];
  const P = (base: string, value: number): Tile => {
    let name = base, i = 2;
    while (params.some(p => p.name === name)) name = `${base}${i++}`;
    params.push({ name, value, ...rangeFor(value) });
    return { k: 'param', name };
  };
  const term = (axis: 'x' | 'y'): Tile => {
    const other = v(axis === 'x' ? 'y' : 'x');
    const src = pick(r, [other, other, v('r'), v('theta'), v(axis)]);
    const fn = pick(r, ['sin', 'sin', 'cos', 'abs', 'fract', 'valueNoise']);
    const amp = P('amp', Math.round((0.04 + r() * 0.14) * 100) / 100);
    const freq = P('freq', Math.round(2 + r() * 10));
    const moving = r() < 0.7;
    let inner: Tile = { k: 'op', op: '*', a: src, b: freq };
    if (moving) inner = { k: 'op', op: '+', a: inner, b: v('t') };
    const f: Tile = fn === 'valueNoise'
      ? { k: 'op', op: '-', a: { k: 'call', fn: 'valueNoise', args: [{ k: 'call', fn: 'vec2', args: [inner, src] }] }, b: { k: 'num', value: 0.5 } }
      : fn === 'abs' || fn === 'fract' ? { k: 'op', op: '-', a: { k: 'call', fn, args: [{ k: 'call', fn: 'sin', args: [inner] }] }, b: { k: 'num', value: 0.5 } }
        : { k: 'call', fn, args: [inner] };
    return { k: 'op', op: '*', a: amp, b: f };
  };
  const lines: BlockLine[] = [];
  const both = r() < 0.6;
  const first: 'x' | 'y' = r() < 0.5 ? 'x' : 'y';
  for (const axis of both ? (['x', 'y'] as const) : [first]) lines.push({ target: axis === 'x' ? 'uv.x' : 'uv.y', op: '+=' as BlockOp, rhs: tileText(term(axis)) });
  if (r() < 0.3) {
    const turn = P('twist', Math.round((0.5 + r() * 2) * 10) / 10);
    lines.push({ target: 'uv', op: '=', rhs: tileText({ k: 'call', fn: 'rotate', args: [v('uv'), { k: 'op', op: '*', a: v('r'), b: turn }] }) });
  }
  return { blocks: [{ id: 'w1', block: { name: 'Surprise', lines, params, times: 1 } }] };
}

/** The tile path's text in a row (the hover help on a tile). */
export const tileTextAt = (root: Tile | null, path: TilePath) => tileText(tileAt(root, path));

// ── Dropping tiles ───────────────────────────────────────────────────────────

/** A picked tile: block, row, path. */
export interface WarpSel { block: number; line: number; path: TilePath }

/** What is being dragged: a palette tile, or a tile already in a row. */
export type TileDrag =
  | { from: 'palette'; kind: 'var'; name: VarName }
  | { from: 'palette'; kind: 'num' }
  | { from: 'palette'; kind: 'fn'; fn: string }
  | { from: 'palette'; kind: 'op'; op: TileOp }
  | { from: 'palette'; kind: 'if' }
  | { from: 'palette'; kind: 'cmp'; op: CmpOp }
  | { from: 'palette'; kind: 'logic'; op: LogicOp }
  | { from: 'palette'; kind: 'not' }
  | { from: 'row'; block: number; line: number; path: TilePath };

/** What a drag gives: a condition (`bool`: comparisons, and/or/not) or a value (the rest). */
export function dragKind(spec: WarpSpec, drag: TileDrag): 'bool' | 'value' {
  if (drag.from === 'row') return isBool(tileAt(rowTile(spec.blocks[drag.block]?.block ?? { lines: [], params: [], times: 1 }, drag.line), drag.path)) ? 'bool' : 'value';
  return drag.kind === 'cmp' || drag.kind === 'logic' || drag.kind === 'not' ? 'bool' : 'value';
}

/**
 * Whether a drop may land there (the type rule): a condition slot takes only conditions, and a
 * value slot (a row, a function's argument, the If's then/else) only values.
 */
export function dropAllowed(spec: WarpSpec, to: TileTarget, drag: TileDrag): boolean {
  const block = spec.blocks[to.block]?.block;
  if (!block?.lines[to.line]) return false;
  const want = to.path ? slotKind(rowTile(block, to.line), to.path) : 'value';
  return dragKind(spec, drag) === want;
}

/** Where it lands: a tile in a row, or the row itself (`path` null: the end of the row). */
export interface TileTarget { block: number; line: number; path: TilePath | null }

/**
 * Drop a tile (docs/warp-builder.md, "Building by dragging"):
 *
 *  - a function on a tile wraps it (`sin(y)`); on the row's end, wraps the whole row;
 *  - an operator on a tile makes `tile ⊕ _`;
 *  - a value on an empty slot fills it; on an empty row, is the row;
 *  - the number tile (#) on a filled tile scales it (`y * freq`), the clock (t) on a filled tile
 *    adds to it (`y * freq + t`), any other variable replaces it;
 *  - on the row's end, a value is added (`row + value`);
 *  - a tile from a row moves there (across blocks it takes its sliders along).
 *
 * Changes `spec` in place. Returns the tile to select next: the next empty slot, else what landed.
 */
export function dropTile(spec: WarpSpec, to: TileTarget, drag: TileDrag): WarpSel | null {
  const item = spec.blocks[to.block];
  const line = item?.block.lines[to.line];
  if (!item || !line) return null;
  const block = item.block;
  if (!dropAllowed(spec, to, drag)) return null;
  const root = rowTile(block, to.line);
  const atPath: TilePath = to.path ?? [];
  const at = to.path ? tileAt(root, to.path) : root;
  const filled = !!at && at.k !== 'hole';
  let next: Tile | null = root;
  let landed: TilePath = atPath;

  if (drag.from === 'row') {
    const srcItem = spec.blocks[drag.block];
    const srcRoot = srcItem ? rowTile(srcItem.block, drag.line) : null;
    const moving = tileAt(srcRoot, drag.path);
    if (!srcItem || !moving) return null;
    if (drag.block === to.block && drag.line === to.line) {
      if (!to.path) {
        // To the end of its own row: take it out, add it on the end.
        const without = removeAt(srcRoot, drag.path);
        next = appendTo(without, structuredClone(moving));
        landed = without ? [1] : [];
      } else next = moveTile(srcRoot, drag.path, to.path);
      setRowTile(block, to.line, next);
      return { block: to.block, line: to.line, path: landed };
    }
    // Across rows: its sliders come along (when the other block hasn't one by that name).
    if (drag.block !== to.block) {
      for (const name of paramsIn(moving)) {
        const p = srcItem.block.params.find(q => q.name === name);
        if (p && !block.params.some(q => q.name === name)) block.params.push({ ...p });
      }
    }
    next = to.path ? replaceAt(root, to.path, structuredClone(moving)) : appendTo(root, structuredClone(moving));
    landed = to.path ?? (root ? [1] : []);
    setRowTile(block, to.line, next);
    setRowTile(srcItem.block, drag.line, removeAt(rowTile(srcItem.block, drag.line), drag.path));
    return { block: to.block, line: to.line, path: landed };
  }

  if (drag.kind === 'if') {
    // A filled tile goes in the then slot: if _ then tile else _ (the condition first).
    next = replaceAt(root, atPath, { k: 'if', cond: HOLE, a: filled && at ? at : HOLE, b: HOLE });
  } else if (drag.kind === 'cmp') {
    // On a comparison: change its sign. On another condition: `cond and _ > _`. Empty: `_ > _`.
    const c: Tile = { k: 'cmp', op: drag.op, a: HOLE, b: HOLE };
    next = replaceAt(root, atPath, !filled || !at ? c : at.k === 'cmp' ? { ...at, op: drag.op } : { k: 'logic', op: '&&', a: at, b: c });
  } else if (drag.kind === 'logic') {
    next = replaceAt(root, atPath, { k: 'logic', op: drag.op, a: filled && at ? at : HOLE, b: HOLE });
  } else if (drag.kind === 'not') {
    next = replaceAt(root, atPath, { k: 'not', a: filled && at ? at : HOLE });
  } else if (drag.kind === 'fn') {
    next = wrapAt(root, atPath, drag.fn);
  } else if (drag.kind === 'op') {
    next = opAt(root, atPath, drag.op);
    landed = [...atPath, 1];
  } else if (drag.kind === 'num') {
    if (!to.path && filled) {
      next = appendTo(root, HOLE);
      landed = [1];
    } else if (filled) {
      next = opAt(root, atPath, '*');
      landed = [...atPath, 1];
    }
    setRowTile(block, to.line, next ?? HOLE);
    dropNumber(block, to.line, landed);
    const holes = holePaths(rowTile(block, to.line));
    return { block: to.block, line: to.line, path: holes[0] ?? landed };
  } else {
    const tile: Tile = { k: 'var', name: drag.name };
    if (!to.path && filled) { next = appendTo(root, tile); landed = [1]; }
    else if (filled && drag.name === 't') { next = opAt(root, atPath, '+', tile); landed = [...atPath, 1]; }
    else next = placeTile(root, atPath, tile);
  }
  setRowTile(block, to.line, next);
  const holes = holePaths(next);
  return { block: to.block, line: to.line, path: holes[0] ?? landed };
}

/** The same row with every empty slot read as 0 (the palette's pictures of what a drop would do). */
export function fillHoles(t: Tile | null, slot: 'bool' | 'value' = 'value'): Tile | null {
  if (!t) return t;
  // An empty condition reads as x > 0 (a split down the middle), an empty value as 0.
  if (t.k === 'hole') return slot === 'bool' ? { k: 'cmp', op: '>', a: { k: 'var', name: 'x' }, b: { k: 'num', value: 0 } } : { k: 'num', value: 0 };
  const boolKids = t.k === 'logic' || t.k === 'not';
  return withChildren(t, childrenOf(t).map((c, i) => fillHoles(c, boolKids || (t.k === 'if' && i === 0) ? 'bool' : 'value')!));
}

/** The block as it would be with `fn` wrapped round the tile at `path` of row `line` (palette pictures). */
export function blockWithWrap(block: SpaceBlock, line: number, path: TilePath, fn: string): SpaceBlock {
  const b = cloneBlock(block);
  if (!b.lines[line]) return b;
  b.lines[line].rhs = tileText(fillHoles(wrapAt(rowTile(b, line), path, fn)));
  return b;
}

/**
 * The If tile's picture: the picked tile kept on one side of a split and left out (0) on the other,
 * `if x > 0 then tile else 0`, so you see where the condition cuts. A condition tile's picture: the
 * row with the picked tile behind `if <that comparison> …` on x and 0.
 */
export function blockWithIf(block: SpaceBlock, line: number, path: TilePath, cond?: CmpOp | LogicOp | '!'): SpaceBlock {
  const b = cloneBlock(block);
  const root = rowTile(b, line);
  if (!b.lines[line] || slotKind(root, path) === 'bool') return b;
  const at = tileAt(root, path) ?? HOLE;
  const x: Tile = { k: 'var', name: 'x' }, y: Tile = { k: 'var', name: 'y' }, zero: Tile = { k: 'num', value: 0 };
  const c: Tile = !cond ? { k: 'cmp', op: '>', a: x, b: zero }
    : cond === '!' ? { k: 'not', a: { k: 'cmp', op: '>', a: x, b: zero } }
      : cond === '&&' || cond === '||' ? { k: 'logic', op: cond, a: { k: 'cmp', op: '>', a: x, b: zero }, b: { k: 'cmp', op: '>', a: y, b: zero } }
        : { k: 'cmp', op: cond, a: x, b: zero };
  b.lines[line].rhs = tileText(fillHoles(replaceAt(root, path, { k: 'if', cond: c, a: at, b: zero })));
  return b;
}
