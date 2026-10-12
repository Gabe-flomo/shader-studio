/**
 * tiles.ts — the Warp Builder's tiles (docs/warp-builder.md): an expression as a tree of tiles you
 * drag and drop, and the text it stands for.
 *
 * There is one format: a space block's lines (sceneBuilder2d/blocks.ts), `uv.x += amp * sin(y * 7 + t)`.
 * A row's tiles print to that right-hand side (tileText) and any right-hand side reads back into
 * tiles (textToTile). What the tiles can't show (a comparison, a ternary, an index) stays as a
 * code tile holding its text, so nothing is lost. An empty slot prints as `_`, which the block
 * check reports ("fill the empty slot") and which reads back as an empty slot.
 *
 * Pure: no React, no store.
 */
import { allNodes, parseExpr, sourceOf, type Expr } from '../lib/glslPatterns';

/** Variable tiles. `r` is length(uv), `theta` is atan(y, x); fi, k, n and uv0 only in a looped block. */
export type VarName = 'x' | 'y' | 'uv' | 't' | 'r' | 'theta' | 'fi' | 'k' | 'n' | 'uv0';
export type TileOp = '+' | '-' | '*' | '/';

export type Tile =
  | { k: 'var'; name: VarName }
  | { k: 'num'; value: number }
  | { k: 'param'; name: string }
  | { k: 'call'; fn: string; args: Tile[] }
  | { k: 'op'; op: TileOp; a: Tile; b: Tile }
  | { k: 'neg'; a: Tile }
  | { k: 'swz'; a: Tile; field: string }
  | { k: 'hole' }
  | { k: 'code'; text: string };

/** Where a tile sits in its row: child indices from the root. [] is the root. */
export type TilePath = number[];

export const HOLE: Tile = { k: 'hole' };
export const HOLE_TEXT = '_';

export const VAR_TILES: ReadonlyArray<{ name: VarName; label: string; blurb: string; type: 'float' | 'vec2'; loop?: boolean }> = [
  { name: 'x', label: 'x', blurb: 'The point’s x, as it is now', type: 'float' },
  { name: 'y', label: 'y', blurb: 'The point’s y, as it is now', type: 'float' },
  { name: 'uv', label: 'uv', blurb: 'The whole point (two numbers)', type: 'vec2' },
  { name: 't', label: 't', blurb: 'Time in seconds: makes it move', type: 'float' },
  { name: 'r', label: 'r', blurb: 'Distance from the centre: length(uv)', type: 'float' },
  { name: 'theta', label: 'θ', blurb: 'Angle round the centre: atan(y, x)', type: 'float' },
  { name: 'fi', label: 'i', blurb: 'The pass, 0 at the first (looped blocks)', type: 'float', loop: true },
  { name: 'k', label: 'k', blurb: 'How far through the loop, 0 to 1 (looped blocks)', type: 'float', loop: true },
  { name: 'n', label: 'n', blurb: 'How many passes run (looped blocks)', type: 'float', loop: true },
  { name: 'uv0', label: 'uv0', blurb: 'The point before the block (looped blocks)', type: 'vec2', loop: true },
];
const VAR_NAMES = new Set<string>(VAR_TILES.map(v => v.name));
export const varLabel = (n: VarName) => VAR_TILES.find(v => v.name === n)?.label ?? n;

export const OP_TILES: ReadonlyArray<{ op: TileOp; label: string; blurb: string }> = [
  { op: '+', label: '+', blurb: 'Add' }, { op: '-', label: '−', blurb: 'Subtract' }, { op: '*', label: '×', blurb: 'Multiply' }, { op: '/', label: '÷', blurb: 'Divide' },
];
export const opLabel = (op: TileOp) => OP_TILES.find(o => o.op === op)!.label;

const num = (value: number): Tile => ({ k: 'num', value });
const call = (fn: string, ...args: Tile[]): Tile => ({ k: 'call', fn, args });

/**
 * The function tiles of the palette. `wrap` is what dropping it on a tile makes (the tile goes in
 * its main slot), `curve` its picture when the row is empty (y = f(x)).
 */
export interface FnTile { fn: string; label: string; blurb: string; wrap: (a: Tile) => Tile; curve: (x: number) => number }
const fract = (v: number) => v - Math.floor(v);
const hash = (i: number) => fract(Math.sin(i * 127.1) * 43758.5453);
const vnoise = (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
export const FN_TILES: readonly FnTile[] = [
  { fn: 'sin', label: 'sin', blurb: 'A wave: rises and falls between −1 and 1', wrap: a => call('sin', a), curve: Math.sin },
  { fn: 'cos', label: 'cos', blurb: 'A wave a quarter turn ahead of sin', wrap: a => call('cos', a), curve: Math.cos },
  { fn: 'tan', label: 'tan', blurb: 'Shoots off to infinity every half turn: tears', wrap: a => call('tan', a), curve: x => Math.max(-3, Math.min(3, Math.tan(x))) },
  { fn: 'abs', label: 'abs', blurb: 'Folds negatives over: a mirror', wrap: a => call('abs', a), curve: Math.abs },
  { fn: 'fract', label: 'fract', blurb: 'Keeps the part after the point: repeats', wrap: a => call('fract', a), curve: fract },
  { fn: 'floor', label: 'floor', blurb: 'Down to the whole number: steps', wrap: a => call('floor', a), curve: Math.floor },
  { fn: 'mod', label: 'mod', blurb: 'Wraps round every so often: tiles', wrap: a => call('mod', a, num(1)), curve: x => x - Math.floor(x) },
  { fn: 'pow', label: 'pow', blurb: 'Raises to a power: bends the spacing', wrap: a => call('pow', a, num(2)), curve: x => Math.pow(Math.abs(x), 2) },
  { fn: 'exp', label: 'exp', blurb: 'Grows faster and faster', wrap: a => call('exp', a), curve: x => Math.min(3, Math.exp(x)) },
  { fn: 'log', label: 'log', blurb: 'Grows slower and slower: squashes the far away', wrap: a => call('log', a), curve: x => (x > 0 ? Math.log(x) : -3) },
  { fn: 'sqrt', label: 'sqrt', blurb: 'The square root: stretches near 0', wrap: a => call('sqrt', a), curve: x => (x > 0 ? Math.sqrt(x) : 0) },
  { fn: 'sign', label: 'sign', blurb: '−1, 0 or 1: which side of zero', wrap: a => call('sign', a), curve: Math.sign },
  { fn: 'smoothstep', label: 'smoothstep', blurb: 'A soft step from 0 to 1 between two edges', wrap: a => call('smoothstep', num(0), num(1), a), curve: x => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); } },
  { fn: 'min', label: 'min', blurb: 'The smaller of two: a ceiling', wrap: a => call('min', a, num(0.5)), curve: x => Math.min(x, 0.5) },
  { fn: 'max', label: 'max', blurb: 'The larger of two: a floor', wrap: a => call('max', a, num(-0.5)), curve: x => Math.max(x, -0.5) },
  { fn: 'mix', label: 'mix', blurb: 'Part way from one to another', wrap: a => call('mix', a, HOLE, num(0.5)), curve: x => x * 0.5 },
  { fn: 'length', label: 'length', blurb: 'How long: the distance from 0', wrap: a => call('length', a), curve: Math.abs },
  { fn: 'atan', label: 'atan', blurb: 'The angle whose tangent this is', wrap: a => call('atan', a), curve: Math.atan },
  { fn: 'valueNoise', label: 'noise', blurb: 'Smooth random hills between 0 and 1', wrap: a => call('valueNoise', tileType(a) === 'vec2' ? a : call('vec2', a, { k: 'var', name: 't' })), curve: x => vnoise(x * 2) * 2 - 1 },
  { fn: 'rotate', label: 'rotate', blurb: 'Turns a point (uv) round the centre', wrap: a => call('rotate', tileType(a) === 'vec2' ? a : { k: 'var', name: 'uv' }, num(0.5)), curve: x => x },
];
export const FN_BY_NAME: Record<string, FnTile> = Object.fromEntries(FN_TILES.map(f => [f.fn, f]));
export const fnLabel = (fn: string) => FN_BY_NAME[fn]?.label ?? fn;

/** A tile's type, roughly: vec2 or float (for the noise and rotate wraps). */
export function tileType(t: Tile): 'float' | 'vec2' {
  switch (t.k) {
    case 'var': return t.name === 'uv' || t.name === 'uv0' ? 'vec2' : 'float';
    case 'op': return tileType(t.a) === 'vec2' || tileType(t.b) === 'vec2' ? 'vec2' : 'float';
    case 'neg': return tileType(t.a);
    case 'swz': return t.field.length === 2 ? 'vec2' : 'float';
    case 'call':
      if (t.fn === 'vec2' || t.fn === 'rotate') return 'vec2';
      if (['length', 'dot', 'distance', 'valueNoise', 'float'].includes(t.fn)) return 'float';
      return t.args[0] ? tileType(t.args[0]) : 'float';
    default: return 'float';
  }
}

// ── Tiles → text ─────────────────────────────────────────────────────────────

/** A number, short: 0.1, 7, -0.5. */
export function numText(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return String(parseFloat(v.toPrecision(6)));
}

const PREC: Record<TileOp, number> = { '+': 6, '-': 6, '*': 7, '/': 7 };

/** The right-hand side a tile stands for (empty slots as `_`). */
export function tileText(t: Tile | null): string {
  if (!t) return '';
  const p = (n: Tile, min: number): string => {
    switch (n.k) {
      case 'var': return n.name === 'r' ? 'length(uv)' : n.name === 'theta' ? 'atan(y, x)' : n.name;
      case 'num': { const s = numText(n.value); return n.value < 0 && min > 6 ? `(${s})` : s; }
      case 'param': return n.name;
      case 'hole': return HOLE_TEXT;
      case 'call': return `${n.fn}(${n.args.map(a => p(a, 0)).join(', ')})`;
      case 'swz': return `${p(n.a, 9)}.${n.field}`;
      case 'neg': { const s = `-${p(n.a, 8)}`; return min > 8 ? `(${s})` : s; }
      case 'code': return min === 0 || /^[\w.]+(\([^()]*\))?$/.test(n.text.trim()) ? n.text.trim() : `(${n.text.trim()})`;
      case 'op': {
        const pr = PREC[n.op];
        const s = `${p(n.a, pr)} ${n.op} ${p(n.b, pr + 1)}`;
        return min > pr ? `(${s})` : s;
      }
    }
  };
  return p(t, 0);
}

// ── Text → tiles ─────────────────────────────────────────────────────────────

const isXY = (e: Expr, c: 'x' | 'y') => (e.kind === 'ident' && e.name === c) || (e.kind === 'member' && e.object.kind === 'ident' && e.object.name === 'uv' && e.field === c);

/**
 * A right-hand side as tiles. Empty text is null (an empty row). Names that aren't the block's
 * variables or sliders, and anything the tiles don't cover, become code tiles holding their text.
 * Text that doesn't parse at all is one code tile.
 */
export function textToTile(text: string, params: readonly string[] = []): Tile | null {
  const src = text.trim();
  if (!src) return null;
  const parsed = parseExpr(src);
  if (!parsed.ok) return { k: 'code', text: src };
  const names = new Set(params);
  const from = (e: Expr): Tile => {
    switch (e.kind) {
      case 'num': return { k: 'num', value: e.value };
      case 'ident':
        if (e.name === HOLE_TEXT) return HOLE;
        if (names.has(e.name)) return { k: 'param', name: e.name };
        if (VAR_NAMES.has(e.name) && e.name !== 'r' && e.name !== 'theta') return { k: 'var', name: e.name as VarName };
        return { k: 'code', text: e.name };
      case 'call':
        if (e.callee === 'length' && e.args.length === 1 && e.args[0].kind === 'ident' && e.args[0].name === 'uv') return { k: 'var', name: 'r' };
        if (e.callee === 'atan' && e.args.length === 2 && isXY(e.args[0], 'y') && isXY(e.args[1], 'x')) return { k: 'var', name: 'theta' };
        return { k: 'call', fn: e.callee, args: e.args.map(from) };
      case 'binary':
        if (e.op === '+' || e.op === '-' || e.op === '*' || e.op === '/') return { k: 'op', op: e.op, a: from(e.left), b: from(e.right) };
        return { k: 'code', text: sourceOf(e, src) };
      case 'unary':
        if (e.op === '+') return from(e.arg);
        if (e.op === '-') return e.arg.kind === 'num' ? { k: 'num', value: -e.arg.value } : { k: 'neg', a: from(e.arg) };
        return { k: 'code', text: sourceOf(e, src) };
      case 'member':
        if (e.object.kind === 'ident' && e.object.name === 'uv' && (e.field === 'x' || e.field === 'y')) return { k: 'var', name: e.field };
        return { k: 'swz', a: from(e.object), field: e.field };
      default: return { k: 'code', text: sourceOf(e, src) };
    }
  };
  return from(parsed.expr);
}

/** Whether a tree holds any code tile (shown as "kept as code"). */
export function hasCode(t: Tile | null): boolean {
  return !!t && someTile(t, n => n.k === 'code');
}
/** Whether a tree has an empty slot. */
export function hasHole(t: Tile | null): boolean {
  return !!t && someTile(t, n => n.k === 'hole');
}
/** The slider names a tree reads. */
export function paramsIn(t: Tile | null): string[] {
  const out = new Set<string>();
  if (t) forEachTile(t, n => { if (n.k === 'param') out.add(n.name); if (n.k === 'code') codeNames(n.text).forEach(x => out.add(x)); });
  return [...out];
}
function codeNames(text: string): string[] {
  const r = parseExpr(text);
  return r.ok ? allNodes(r.expr).filter(n => n.kind === 'ident').map(n => (n as { name: string }).name) : [];
}

// ── Walking and editing (all immutable) ──────────────────────────────────────

export function childrenOf(t: Tile): Tile[] {
  switch (t.k) {
    case 'call': return t.args;
    case 'op': return [t.a, t.b];
    case 'neg': case 'swz': return [t.a];
    default: return [];
  }
}
function withChildren(t: Tile, kids: Tile[]): Tile {
  switch (t.k) {
    case 'call': return { ...t, args: kids };
    case 'op': return { ...t, a: kids[0], b: kids[1] };
    case 'neg': case 'swz': return { ...t, a: kids[0] };
    default: return t;
  }
}
export function forEachTile(t: Tile, visit: (n: Tile, path: TilePath) => void, path: TilePath = []): void {
  visit(t, path);
  childrenOf(t).forEach((c, i) => forEachTile(c, visit, [...path, i]));
}
function someTile(t: Tile, test: (n: Tile) => boolean): boolean {
  if (test(t)) return true;
  return childrenOf(t).some(c => someTile(c, test));
}

export function tileAt(root: Tile | null, path: TilePath): Tile | null {
  let cur = root;
  for (const i of path) { if (!cur) return null; cur = childrenOf(cur)[i] ?? null; }
  return cur;
}

export function replaceAt(root: Tile | null, path: TilePath, next: Tile): Tile {
  if (!path.length || !root) return next;
  const kids = childrenOf(root).slice();
  if (path[0] >= kids.length) return root;
  kids[path[0]] = replaceAt(kids[path[0]], path.slice(1), next);
  return withChildren(root, kids);
}

/**
 * Take a tile out: the root goes (null, an empty row); a side of + − × ÷ leaves the other side in
 * its place; a function's argument becomes an empty slot.
 */
export function removeAt(root: Tile | null, path: TilePath): Tile | null {
  if (!root || !path.length) return null;
  const parentPath = path.slice(0, -1);
  const parent = tileAt(root, parentPath);
  if (!parent) return root;
  const i = path[path.length - 1];
  if (parent.k === 'op') return replaceAt(root, parentPath, i === 0 ? parent.b : parent.a);
  if (parent.k === 'neg' || parent.k === 'swz') return removeAt(root, parentPath);
  return replaceAt(root, path, HOLE);
}

/** A function dropped on a tile: the tile goes in its main slot. */
export function wrapAt(root: Tile | null, path: TilePath, fn: string): Tile {
  const at = tileAt(root, path) ?? HOLE;
  const f = FN_BY_NAME[fn];
  return replaceAt(root, path, f ? f.wrap(at) : call(fn, at));
}

/** An operator dropped on a tile: `tile ⊕ _`. */
export function opAt(root: Tile | null, path: TilePath, op: TileOp, other: Tile = HOLE): Tile {
  const at = tileAt(root, path) ?? HOLE;
  return replaceAt(root, path, { k: 'op', op, a: at, b: other });
}

/** Duplicate a term: `tile + tile`. */
export function duplicateAt(root: Tile | null, path: TilePath): Tile {
  const at = tileAt(root, path) ?? HOLE;
  return replaceAt(root, path, { k: 'op', op: '+', a: at, b: structuredClone(at) });
}

/** Swap the two sides of + − × ÷ (reorder). */
export function swapAt(root: Tile | null, path: TilePath): Tile | null {
  const at = tileAt(root, path);
  if (!at || at.k !== 'op') return root;
  return replaceAt(root, path, { ...at, a: at.b, b: at.a });
}

/** Add a tile to the end of a row: `row + tile` (or the tile, in an empty row). */
export function appendTo(root: Tile | null, tile: Tile, op: TileOp = '+'): Tile {
  if (!root || root.k === 'hole') return tile;
  return { k: 'op', op, a: root, b: tile };
}

const isPrefix = (a: TilePath, b: TilePath) => a.length <= b.length && a.every((v, i) => b[i] === v);

/**
 * Drag a tile from one place in a row to another: it replaces what is at `to`, and leaves its old
 * place as removeAt does. Moving a tile into itself does nothing.
 */
export function moveTile(root: Tile | null, from: TilePath, to: TilePath): Tile | null {
  if (isPrefix(from, to)) return root;
  const t = tileAt(root, from);
  if (!t) return root;
  const placed = replaceAt(root, to, structuredClone(t));
  // `to` holding an ancestor of `from` swallowed it: nothing is left to take out.
  if (isPrefix(to, from)) return placed;
  return removeAt(placed, from);
}

/** Every empty slot's path, in order (the next one to fill after a drop). */
export function holePaths(t: Tile | null): TilePath[] {
  const out: TilePath[] = [];
  if (t) forEachTile(t, (n, p) => { if (n.k === 'hole') out.push(p); });
  return out;
}

/** Whether two paths are the same place. */
export function samePath(a: TilePath | null | undefined, b: TilePath | null | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
}
