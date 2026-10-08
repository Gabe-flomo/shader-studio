/**
 * recipe.ts — the 2D Scene Builder's recipe text, both ways (docs/scene-builder-2d-plan.md).
 *
 *   kaleidoscope 8 · ring r=0.35 th=0.03 color=teal glow @ring(6 r=0.4) · glow selected · colour by length palette=sunset · tone aces
 *
 * The same language as the 3D Scene Builder's recipe and the rest of Playfield (docs/playfield-language.md):
 * clauses separated by `·` (or `|`, `;`, a new line); a clause is a head word and its settings
 * (`key=value`, the primary value bare, flags); `(…)` holds a combine's items; `@name(…)` is a
 * modifier of one item.
 *
 *   space      zoom · rotate · move · pixelate · tile · mirror-tile · mirror · kaleidoscope · polar-repeat
 *              · polar · swirl · warp · wave · fisheye · invert        (the stack, top to bottom)
 *   layers     a shape or a combine (union( ) smooth-union( ) subtract( ) intersect( )), painted in order
 *   look       glow · colour by … · tone · background · bloom · vignette · grain · scanlines
 *   output     output distance | mask | space [palette=…]
 *
 * The parser is forgiving: case, spacing, aliases (`disc`, `rect`, `kaleido`) and units (`30deg`,
 * `0.5rad`) are all fine, a mistake is reported with its position and a "did you mean", and
 * everything else in the recipe still applies. printRecipe writes the shortest recipe that parses
 * back to the same scene: only what differs from the defaults.
 */
import { Cursor } from '../lang/parse';
import { lineCol } from '../lang/lex';
import type { Arg as AstArg, Item as AstItem, Modifier } from '../lang/ast';
import { COLOUR_TABLE, colourText } from '../lang/colours';
import { suggest } from '../lang/fuzzy';
import { PALETTE_BY_KEY, PALETTES } from '../sceneBuilder/output';
import { GRID_ASSIGNS, GRID_COLOUR_BYS, GRID_SHAPES, GRID_TARGETS, RIPPLE_FROMS, defaultGrid, printGrid, type GridShape, type GridSpec } from './grid';
import type { RecipeError } from '../sceneBuilder/recipe';
import {
  COLOUR_BYS, DEFAULT_COLOR, DEFAULT_LOOK, MAX_DUP, MAX_LEVELS, MOTIONS, MOTION_BY_KIND, SHAPES, SHAPE_BY_KIND, SHOW_WORDS, SPACES, SPACE_BY_KIND, TONE_MODES,
  defaultSize, defaultSpaceValues, emptyScene, newDup, newGroup, newMotion, newShape, newSpaceOp, walkItems,
  type ColourBy, type CombineOp, type DupSpec, type Item, type MotionKind, type ParamDef, type Scene2D, type ShapeSpec, type SpaceDef, type SpaceOp, type ToneMode, type Vec2, type Vec3,
} from './spec';

export interface ParseResult2D {
  scene: Scene2D;
  errors: RecipeError[];
  warnings: string[];
}

// ── Words ───────────────────────────────────────────────────────────────────

const OP_WORDS: Record<string, { op: CombineOp; smooth: boolean }> = {
  union: { op: 'union', smooth: false }, add: { op: 'union', smooth: false }, combine: { op: 'union', smooth: false },
  'smooth-union': { op: 'union', smooth: true }, blend: { op: 'union', smooth: true }, merge: { op: 'union', smooth: true }, melt: { op: 'union', smooth: true },
  subtract: { op: 'subtract', smooth: false }, cut: { op: 'subtract', smooth: false }, difference: { op: 'subtract', smooth: false }, minus: { op: 'subtract', smooth: false },
  'smooth-subtract': { op: 'subtract', smooth: true }, 'smooth-cut': { op: 'subtract', smooth: true },
  intersect: { op: 'intersect', smooth: false }, intersection: { op: 'intersect', smooth: false }, both: { op: 'intersect', smooth: false },
  'smooth-intersect': { op: 'intersect', smooth: true },
};
export const DEFAULT_SMOOTH_K = 0.1;

const SHAPE_WORDS: Record<string, string> = Object.fromEntries(SHAPES.flatMap(s => [[s.kind, s.kind], ...s.aliases.map(a => [a, s.kind])]));
const SPACE_WORDS: Record<string, string> = Object.fromEntries(SPACES.flatMap(s => [[s.kind, s.kind], ...s.aliases.map(a => [a, s.kind])]));
const MOTION_WORDS = [...MOTIONS.map(m => m.kind), 'ring'];
const LOOK_WORDS = ['grid', 'glow', 'colour', 'color', 'tone', 'tone-map', 'tonemap', 'background', 'bg', 'bloom', 'vignette', 'grain', 'scanlines', 'output', 'show'];
const CLAUSE_WORDS = [...Object.keys(SHAPE_WORDS), ...Object.keys(OP_WORDS), ...Object.keys(SPACE_WORDS), ...LOOK_WORDS];

export const round = (n: number) => Math.round(n * 10000) / 10000;
export const fmt = (n: number): string => {
  const r = round(n);
  return Object.is(r, -0) ? '0' : String(r);
};
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => round(x) === round(b[i]));
const valueEq = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? same(a, b) : typeof a === 'number' && typeof b === 'number' ? round(a) === round(b) : a === b);
const fmtVec = (v: readonly number[]): string => (v.length === 2 && v[0] === v[1] ? fmt(v[0]) : `(${v.map(fmt).join(',')})`);
const fmtName = (s: string) => (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) ? s : `"${s.replace(/"/g, '\'')}"`);

// ── Parser ──────────────────────────────────────────────────────────────────

class Parser {
  errors: RecipeError[] = [];
  warnings: string[] = [];
  private c: Cursor;
  private ids = { s: 0, g: 0, m: 0, p: 0 };
  /** A shape asked for glow (a bare `glow` flag) before any `glow` clause said how. */
  private flagged = false;

  private src: string;
  constructor(src: string) { this.src = src; this.c = new Cursor(src); }

  fail(s: { at: number; end: number }, message: string) {
    this.errors.push({ message, from: s.at, to: Math.max(s.end, s.at + 1), ...lineCol(this.src, s.at) });
  }

  // ── Values ──

  num(a: AstArg, what: string, deg = false): number | null {
    const v = a.value;
    if (v.k === 'num') return deg && v.unit === 'rad' ? round(v.v * 180 / Math.PI) : v.v;
    this.fail(a, `${what} is a number.`);
    return null;
  }

  vec2(a: AstArg, what: string): Vec2 | null {
    const v = a.value;
    if (v.k === 'vec' && v.v.length >= 2) return [v.v[0], v.v[1]];
    if (v.k === 'vec' && v.v.length === 1) return [v.v[0], v.v[0]];
    if (v.k === 'num') return [v.v, v.v];
    this.fail(a, `${what} is (x, y).`);
    return null;
  }

  colour(a: AstArg): Vec3 | null {
    const v = a.value;
    if (v.k === 'colour') return [...v.v] as Vec3;
    if (v.k === 'vec' && v.v.length >= 3) return [v.v[0], v.v[1], v.v[2]];
    if (v.k === 'num') return [v.v, v.v, v.v];
    if (v.k === 'word' || v.k === 'str') {
      const c = (COLOUR_TABLE as Record<string, Vec3>)[v.v.toLowerCase()];
      if (c) return [...c] as Vec3;
      const s = suggest(v.v, Object.keys(COLOUR_TABLE));
      this.fail(a, `“${v.v}” isn't a colour I know: use #rrggbb or (r, g, b).${s ? ` Did you mean “${s}”?` : ''}`);
    } else this.fail(a, 'A colour is a name, #rrggbb or (r, g, b).');
    return null;
  }

  word(a: AstArg): string | null {
    const v = a.value;
    return v.k === 'word' || v.k === 'str' ? v.v.toLowerCase() : null;
  }

  /** A number or vector for a ParamDef. */
  param(p: ParamDef, a: AstArg): number | Vec2 | null {
    if (Array.isArray(p.def)) return this.vec2(a, `${p.key}`);
    return this.num(a, p.key, !!p.deg);
  }

  // ── Space ──

  space(t: { at: number; end: number }, kind: string, given?: AstArg[]): SpaceOp {
    const def: SpaceDef = SPACE_BY_KIND[kind];
    const op = newSpaceOp(kind, `p${++this.ids.p}`);
    let pos = 0;
    for (const a of given ?? this.c.args([])) {
      const key = a.key?.toLowerCase() ?? null;
      if (a.op !== '=') { this.fail(a, `${a.key}${a.op} changes a value by a factor: in a recipe, write ${a.key}=… .`); continue; }
      if (!key && def.select) {
        const w = this.word(a);
        if (w && def.select.options.includes(w)) { op.values[def.select.key] = w; continue; }
      }
      if (key && def.select && (key === def.select.key || key === 'axis' || key === 'axes')) {
        const w = this.word(a);
        if (w && def.select.options.includes(w)) op.values[def.select.key] = w;
        else this.fail(a, `${def.select.key} is one of ${def.select.options.join(', ')}.`);
        continue;
      }
      const p = key ? def.params.find(q => q.key.toLowerCase() === key) : def.params[pos++];
      if (!p) {
        const s = key ? suggest(key, def.params.map(q => q.key)) : null;
        this.fail(a, key ? `${def.label} has no setting “${a.key}”.${s ? ` Did you mean “${s}”?` : ` It takes ${def.params.map(q => q.key).join(', ') || 'none'}.`}` : `${def.label} has no more settings to fill.`);
        continue;
      }
      const v = this.param(p, a);
      if (v !== null) op.values[p.key] = v;
    }
    void t;
    return op;
  }

  // ── Items ──

  item(): Item | null {
    const raw = this.c.item(w => !!SHAPE_WORDS[w], w => !!OP_WORDS[w]);
    return raw ? this.toItem(raw) : null;
  }

  private toItem(raw: AstItem): Item | null {
    const w = raw.head.toLowerCase();
    let it: Item;
    if (OP_WORDS[w]) {
      const { op, smooth } = OP_WORDS[w];
      const g = newGroup(`g${++this.ids.g}`, { op, k: smooth ? DEFAULT_SMOOTH_K : 0 });
      for (const ch of raw.items ?? []) {
        const child = this.toItem(ch);
        if (child) g.children.push(child);
      }
      if (!g.children.length) this.warnings.push(`${w}( ) is empty.`);
      it = g;
    } else if (SHAPE_WORDS[w]) {
      it = newShape(SHAPE_WORDS[w], `s${++this.ids.s}`);
    } else {
      this.fail(raw.headSpan, `“${raw.head}” isn't a shape or a combine.`);
      return null;
    }
    this.itemArgs(it, raw.args);
    for (const m of raw.mods) this.modifier(it, m);
    return it;
  }

  private itemArgs(it: Item, args: AstArg[]) {
    const def = it.type === 'shape' ? SHAPE_BY_KIND[it.kind] : null;
    let pos = 0;
    for (const a of args) {
      const key = a.key?.toLowerCase() ?? null;
      if (a.op !== '=') { this.fail(a, `${a.key}${a.op} changes a value by a factor: in a recipe, write ${a.key}=… .`); continue; }
      if (!key) {
        const word = this.word(a);
        if (a.value.k === 'str') { it.name = a.value.v; continue; }
        if (word === 'glow') { it.glow = true; this.flagged = true; continue; }
        if (word === 'outline' || word === 'hollow') { it.hollow = 0.02; continue; }
        if (it.type === 'group') {
          if (a.value.k === 'num') { it.k = Math.max(0, a.value.v); continue; }
          this.fail(a, 'A combine takes k= (its blend radius), name= and the settings every item takes.');
          continue;
        }
        const p = def!.params[pos++];
        if (!p) { this.fail(a, `${def!.label} has no more settings to fill.`); continue; }
        const v = this.param(p, a);
        if (v !== null) (it as ShapeSpec).size[p.key] = v;
        continue;
      }
      if (key === 'at' || key === 'pos' || key === 'position') { const v = this.vec2(a, 'at'); if (v) it.at = v; continue; }
      if (key === 'rot' || key === 'rotate' || key === 'turn') { const v = this.num(a, 'rot', true); if (v !== null) it.rot = v; continue; }
      if (key === 'scale' || key === 'size-by') { const v = this.num(a, 'scale'); if (v !== null) it.scale = Math.max(0.01, v); continue; }
      if (key === 'color' || key === 'colour' || key === 'c') { const c = this.colour(a); if (c) it.color = c; continue; }
      if (key === 'name') { if (a.value.k === 'str' || a.value.k === 'word') it.name = a.value.v; continue; }
      if (key === 'inflate' || key === 'fatten') { const v = this.num(a, 'inflate'); if (v !== null) it.inflate = Math.max(0, v); continue; }
      if (key === 'outline' || key === 'hollow') { const v = this.num(a, 'outline'); if (v !== null) it.hollow = Math.max(0, v); continue; }
      if (key === 'glow') { it.glow = !(a.value.k === 'word' && /^(no|off|false)$/i.test(a.value.v)) && !(a.value.k === 'num' && a.value.v === 0); if (it.glow) this.flagged = true; continue; }
      if (key === 'k' || key === 'blend' || key === 'smooth') {
        if (it.type === 'group') { const v = this.num(a, 'k'); if (v !== null) it.k = Math.max(0, v); } else this.fail(a, 'k is for a combine.');
        continue;
      }
      if (it.type === 'group') {
        this.fail(a, `A combine takes k=, name= and the settings every item takes (at, rot, scale, color, inflate, outline).`);
        continue;
      }
      const p = def!.params.find(q => q.key.toLowerCase() === key) ?? (key === 'radius' ? def!.params.find(q => q.key === 'r') : undefined);
      if (!p) {
        const s = suggest(a.key!, [...def!.params.map(q => q.key), 'at', 'rot', 'scale', 'color', 'inflate', 'outline', 'name', 'glow']);
        this.fail(a, `${def!.label} has no setting “${a.key}”.${s ? ` Did you mean “${s}”?` : ` It takes ${def!.params.map(q => q.key).join(', ')}.`}`);
        continue;
      }
      const v = this.param(p, a);
      if (v !== null) (it as ShapeSpec).size[p.key] = v;
    }
  }

  private modifier(it: Item, m: Modifier) {
    const name = m.name.toLowerCase();
    if (name === 'ring' || name === 'array' || name === 'radial') { this.ring(it, m); return; }
    const d = MOTION_BY_KIND[name];
    if (!d) {
      const s = suggest(name, MOTION_WORDS);
      this.fail(m, `“${m.name}” isn't a motion or a ring.${s ? ` Did you mean “${s}”?` : ' Motions: orbit, bob, spin, pulse. Ring: @ring(6 r=0.5).'}`);
      return;
    }
    const mo = newMotion(d.kind, `m${++this.ids.m}`);
    let pos = 0;
    for (const a of m.args) {
      const key = a.key?.toLowerCase() ?? null;
      // The primary value: a spin's speed, otherwise the amount (radius, distance, swell).
      const primary = d.kind === 'spin' ? 'speed' : 'amount';
      const k = key ?? (pos++ === 0 ? primary : 'speed');
      if (k === 'speed' || k === 'rate') { const v = this.num(a, 'speed'); if (v !== null) mo.speed = v; }
      else if (k === 'amount' || k === 'r' || k === 'radius' || k === 'dist' || k === 'distance' || k === 'swell') {
        if (!d.amount) this.fail(a, `${d.label} has no ${key ?? 'amount'}; it takes speed= and phase=.`);
        else { const v = this.num(a, 'amount'); if (v !== null) mo.amount = Math.max(0, v); }
      } else if (k === 'phase') { const v = this.num(a, 'phase', true); if (v !== null) mo.phase = v; }
      else if (k === 'dir' || k === 'direction' || k === 'angle') {
        if (!d.dir) this.fail(a, `${d.label} has no direction.`);
        else { const v = this.num(a, 'dir', true); if (v !== null) mo.dir = v; }
      } else {
        this.fail(a, `${d.label} has no setting “${a.key ?? ''}”. It takes ${[d.amount ? 'amount' : '', 'speed', 'phase', d.dir ? 'dir' : ''].filter(Boolean).join(', ')}.`);
      }
    }
    if (it.motion.some(x => x.kind === d.kind)) this.warnings.push(`${d.label} twice on one item: both apply.`);
    it.motion.push(mo);
  }

  private ring(it: Item, m: Modifier) {
    const dup: DupSpec = newDup({ count: 6, radius: 0.5 });
    let pos = 0;
    for (const a of m.args) {
      const key = a.key?.toLowerCase() ?? (pos++ === 0 ? 'count' : '');
      if (key === 'count' || key === 'n') { const v = this.num(a, 'count'); if (v !== null) dup.count = Math.max(2, Math.min(MAX_DUP, Math.round(v))); }
      else if (key === 'r' || key === 'radius') { const v = this.num(a, 'r'); if (v !== null) dup.radius = Math.max(0, v); }
      else if (key === 'levels' || key === 'sizes') { const v = this.num(a, 'levels'); if (v !== null) dup.levels = Math.max(1, Math.min(MAX_LEVELS, Math.round(v))); }
      else if (key === 'factor' || key === 'grow') { const v = this.num(a, 'factor'); if (v !== null) dup.factor = Math.max(0.1, v); }
      else if (key === 'inner') {
        const v = this.vec2(a, 'inner');
        if (v) dup.inner = { count: Math.max(2, Math.min(MAX_DUP, Math.round(v[0]))), radius: Math.max(0, v[1]) };
      } else this.fail(a, `@ring takes the count, r=, levels=, factor= and inner=(count, radius).`);
    }
    it.dup = dup;
  }

  // ── The whole text ──

  recipe(): ParseResult2D {
    const scene = emptyScene();
    const L = scene.look;
    while (this.c.peek().t !== 'eof') {
      if (this.c.peek().t === 'sep') { this.c.next(); continue; }
      const t = this.c.peek();
      if (t.t !== 'word') { this.fail(t, 'A clause starts with a word: a shape, a combine, a space transform or a look setting.'); this.c.skipClause(); continue; }
      const w = t.v.toLowerCase();
      if (OP_WORDS[w] || SHAPE_WORDS[w]) {
        const it = this.item();
        if (it) scene.layers.push(it);
      } else if (w === 'grid') {
        // `grid 12 shape=…` is the cell grid; `grid 0.5` (a cell size) is still Tile's other name.
        this.c.next();
        const args = this.c.args([]);
        const first = args.find(a => !a.key);
        const isCells = args.some(a => a.key && !['cell'].includes(a.key.toLowerCase()))
          || (!!first && first.value.k === 'num' && Number.isInteger(first.value.v) && first.value.v >= 2);
        if (isCells || !args.length) this.grid(scene, args);
        else scene.space.push(this.space(t, SPACE_WORDS[w], args));
      } else if (SPACE_WORDS[w]) {
        this.c.next();
        scene.space.push(this.space(t, SPACE_WORDS[w]));
      } else if (LOOK_WORDS.includes(w)) {
        this.c.next();
        this.look(scene, w, t, this.c.args([]));
      } else {
        const s = suggest(w, CLAUSE_WORDS);
        this.fail(t, `“${t.v}” isn't a shape, combine, space transform or look setting.${s ? ` Did you mean “${s}”?` : ''}`);
        this.c.skipClause();
        continue;
      }
      if (this.c.peek().t !== 'sep' && this.c.peek().t !== 'eof') {
        const extra = this.c.peek();
        this.fail(extra, `Unexpected “${this.src.slice(extra.at, extra.end)}”: separate clauses with · or a new line.`);
        this.c.skipClause();
      }
    }
    for (const d of this.c.diagnostics) if (d.severity === 'error') this.errors.push({ message: d.message, from: d.at, to: d.end, line: d.line, col: d.col });
    // A shape that asked for glow with no `glow` clause: glow is for the selected layers.
    if (this.flagged && L.glow.mode === 'off') L.glow.mode = 'selected';
    // Ids in tree order, so a recipe always parses to the same ids.
    let s = 0, g = 0, mo = 0, p = 0;
    for (const op of scene.space) op.id = `p${++p}`;
    walkItems(scene.layers, it => { it.id = it.type === 'group' ? `g${++g}` : `s${++s}`; for (const m of it.motion) m.id = `m${++mo}`; });
    return { scene, errors: this.errors, warnings: this.warnings };
  }

  /** `grid 12 [rows] shape=… assign=… size=… ripple=… freq=… speed=… target=… amount=… by=… color=… color2=… glow=off` */
  private grid(scene: Scene2D, args: AstArg[]) {
    const g = defaultGrid();
    const shapes: GridShape[] = [];
    const ripples: GridSpec['ripples'] = [];
    let pos = 0;
    const pick = <T extends string>(a: AstArg, list: readonly T[], what: string): T | null => {
      const w = this.word(a);
      if (w && (list as readonly string[]).includes(w)) return w as T;
      this.fail(a, `${what} is one of ${list.join(', ')}.`);
      return null;
    };
    for (const a of args) {
      const key = a.key?.toLowerCase() ?? null;
      if (!key) {
        const n = this.num(a, pos === 0 ? 'Columns' : 'Rows');
        if (n !== null) { if (pos === 0) { g.cols = g.rows = Math.max(1, Math.round(n)); } else g.rows = Math.max(1, Math.round(n)); }
        pos++;
        continue;
      }
      switch (key) {
        case 'cols': case 'columns': { const n = this.num(a, key); if (n !== null) g.cols = Math.max(1, Math.round(n)); break; }
        case 'rows': { const n = this.num(a, key); if (n !== null) g.rows = Math.max(1, Math.round(n)); break; }
        case 'span': case 'size': case 'freq': case 'speed': case 'amount': case 'every': {
          const n = this.num(a, key);
          if (n !== null) (g as unknown as Record<string, number>)[key] = n;
          break;
        }
        case 'shape': case 'shapes': { const v = pick(a, GRID_SHAPES, 'A grid shape'); if (v && shapes.length < 3) shapes.push(v); break; }
        case 'assign': { const v = pick(a, GRID_ASSIGNS, 'assign'); if (v) g.assign = v; break; }
        case 'target': { const v = pick(a, GRID_TARGETS, 'target'); if (v) g.target = v; break; }
        case 'by': { const v = pick(a, GRID_COLOUR_BYS, 'by'); if (v) g.colourBy = v; break; }
        case 'ripple': {
          if (a.value.k === 'vec' || a.value.k === 'num') { const at = this.vec2(a, 'ripple'); if (at) ripples.push({ from: 'point', at }); break; }
          const v = pick(a, RIPPLE_FROMS.filter(x => x !== 'point'), 'ripple');
          if (v) ripples.push({ from: v, at: [0, 0] });
          break;
        }
        case 'color': case 'colour': { const c = this.colour(a); if (c) g.colour = c; break; }
        case 'color2': case 'colour2': { const c = this.colour(a); if (c) g.colour2 = c; break; }
        case 'glow': { const w = this.word(a); g.glow = !(w === 'off' || w === 'no' || w === 'false'); break; }
        default: this.fail(a, `grid has no setting “${a.key}”.`);
      }
    }
    if (shapes.length) g.shapes = shapes;
    if (ripples.length) g.ripples = ripples;
    scene.grid = g;
  }

  private look(scene: Scene2D, w: string, t: { at: number; end: number }, args: AstArg[]) {
    if (w === 'grid') { this.grid(scene, args); return; }
    const L = scene.look;
    const first = args[0];
    const firstNum = first && !first.key && first.value.k === 'num' ? first.value.v : null;
    const firstWord = first && !first.key ? this.word(first) : null;
    const off = firstWord === 'off' || firstWord === 'none' || firstWord === 'no';
    switch (w) {
      case 'glow': {
        if (off) { L.glow.mode = 'off'; return; }
        L.glow.mode = 'all';
        for (const a of args) {
          const key = a.key?.toLowerCase() ?? null;
          const word = !key ? this.word(a) : null;
          if (word === 'all') L.glow.mode = 'all';
          else if (word === 'selected' || word === 'some' || word === 'chosen') L.glow.mode = 'selected';
          else if (!key && a.value.k === 'num') L.glow.amount = Math.max(0.0005, a.value.v);
          else if (key === 'amount' || key === 'intensity') { const v = this.num(a, 'amount'); if (v !== null) L.glow.amount = Math.max(0.0005, v); }
          else if (key === 'falloff' || key === 'power') { const v = this.num(a, 'falloff'); if (v !== null) L.glow.falloff = Math.max(0.1, v); }
          else if (key === 'color' || key === 'colour' || key === 'tint') { const c = this.colour(a); if (c) L.glow.tint = c; }
          else this.fail(a, 'glow takes all or selected, an amount, falloff= and color=. Turn it off with glow off.');
        }
        return;
      }
      case 'colour': case 'color': {
        let rest = args;
        const by = rest[0];
        if (by && !by.key && this.word(by) === 'by') rest = rest.slice(1);
        else { this.fail(by ?? t, `${w} by … colours the picture: colour by length palette=sunset.`); return; }
        let named = false;
        for (const a of rest) {
          const key = a.key?.toLowerCase() ?? null;
          const word = this.word(a);
          if (!key && word && !named && (COLOUR_BYS as readonly string[]).includes(word)) { L.colour.by = word as ColourBy; named = true; }
          else if (key === 'palette' || key === 'ramp' || (!key && word && PALETTE_BY_KEY[word])) {
            const k = word ?? '';
            if (PALETTE_BY_KEY[k]) L.colour.palette = k;
            else this.fail(a, `“${k}” isn't a palette: ${PALETTES.map(p => p.key).join(', ')}.`);
          } else if (key === 'scale') { const v = this.num(a, 'scale'); if (v !== null) L.colour.scale = v; }
          else if (key === 'speed') { const v = this.num(a, 'speed'); if (v !== null) L.colour.speed = v; }
          else {
            const s = word ? suggest(word, [...COLOUR_BYS]) : null;
            this.fail(a, `${w} by one of ${COLOUR_BYS.join(', ')}.${s ? ` Did you mean “${s}”?` : ''}`);
          }
        }
        if (!named) this.fail(t, `${w} by what? One of ${COLOUR_BYS.join(', ')}.`);
        return;
      }
      case 'tone': case 'tone-map': case 'tonemap': {
        const word = firstWord ?? '';
        if ((TONE_MODES as readonly string[]).includes(word)) L.tone = word as ToneMode;
        else if (word === 'off') L.tone = 'none';
        else this.fail(first ?? t, `tone is one of ${TONE_MODES.join(', ')}.`);
        return;
      }
      case 'background': case 'bg': {
        const c = first ? this.colour(first) : null;
        if (c) L.bg = c; else if (!first) this.fail(t, 'background takes a colour.');
        return;
      }
      case 'bloom': case 'vignette': case 'grain': case 'scanlines': {
        const dflt = { bloom: 0.6, vignette: 0.5, grain: 0.05, scanlines: 0.3 }[w]!;
        if (off) L.post[w] = 0;
        else if (firstNum !== null) L.post[w] = Math.max(0, firstNum);
        else if (!first) L.post[w] = dflt;
        else this.fail(first, `${w} takes an amount (${fmt(dflt)}) or off.`);
        return;
      }
      case 'output': case 'show': {
        let show: 'picture' | 'distance' | 'mask' | 'space' | null = null;
        let palette: string | undefined;
        for (const a of args) {
          const key = a.key?.toLowerCase() ?? null;
          const word = this.word(a);
          if (key === 'palette' || key === 'ramp') { if (word && PALETTE_BY_KEY[word]) palette = word; else this.fail(a, `“${word ?? ''}” isn't a palette: ${PALETTES.map(p => p.key).join(', ')}.`); }
          else if (!key && word && SHOW_WORDS[word]) show = SHOW_WORDS[word];
          else if (!key && word && PALETTE_BY_KEY[word]) palette = word;
          else {
            const s = word ? suggest(word, Object.keys(SHOW_WORDS)) : null;
            this.fail(a, `output shows one of picture, distance, mask, space.${s ? ` Did you mean “${s}”?` : ''}`);
          }
        }
        if (!show) { this.fail(t, 'output needs what to show: picture, distance, mask or space.'); return; }
        scene.output = show === 'picture' ? undefined : { show, ...(palette ? { palette } : {}) };
        if (!scene.output) delete scene.output;
      }
    }
  }
}

export function parseRecipe2D(src: string): ParseResult2D {
  return new Parser(src).recipe();
}

// ── Printing ────────────────────────────────────────────────────────────────

function printSpace(op: SpaceOp): string {
  const def = SPACE_BY_KIND[op.kind];
  if (!def) return op.kind;
  const defaults = defaultSpaceValues(op.kind);
  const parts: string[] = [];
  if (def.select) parts.push(String(op.values[def.select.key] ?? def.select.def));
  def.params.forEach((p, i) => {
    const v = op.values[p.key];
    if (v === undefined) return;
    const text = Array.isArray(v) ? fmtVec(v) : `${fmt(v as number)}`;
    if (i === 0) parts.push(text);
    else if (!valueEq(v, defaults[p.key])) parts.push(`${p.key}=${text}`);
  });
  return [op.kind, ...parts].join(' ');
}

function printMotion(m: { kind: MotionKind; speed: number; amount: number; phase: number; dir: number }): string {
  const d = MOTION_BY_KIND[m.kind];
  const dflt = newMotion(m.kind, '');
  const parts: string[] = [];
  if (d.kind === 'spin') parts.push(fmt(m.speed));
  else {
    parts.push(fmt(m.amount));
    if (!valueEq(m.speed, dflt.speed)) parts.push(`speed=${fmt(m.speed)}`);
  }
  if (m.phase) parts.push(`phase=${fmt(m.phase)}`);
  if (d.dir && !valueEq(m.dir, dflt.dir)) parts.push(`dir=${fmt(m.dir)}`);
  return `@${m.kind}(${parts.join(' ')})`;
}

function printRing(d: DupSpec): string {
  const parts = [String(d.count), `r=${fmt(d.radius)}`];
  if (d.inner) parts.push(`inner=(${d.inner.count},${fmt(d.inner.radius)})`);
  if (d.levels > 1) parts.push(`levels=${d.levels}`, `factor=${fmt(d.factor)}`);
  return `@ring(${parts.join(' ')})`;
}

/** An item as recipe text. `indent` (the pretty form): a combine's items each on their own line. */
function printItem(it: Item, indent: string | null = null): string {
  const common: string[] = [];
  if (!same(it.at, [0, 0])) common.push(`at=(${it.at.map(fmt).join(',')})`);
  if (it.rot) common.push(`rot=${fmt(it.rot)}`);
  if (it.scale !== 1) common.push(`scale=${fmt(it.scale)}`);
  if (it.inflate) common.push(`inflate=${fmt(it.inflate)}`);
  if (it.hollow) common.push(`outline=${fmt(it.hollow)}`);
  if (!same(it.color, DEFAULT_COLOR)) common.push(`color=${colourText(it.color)}`);
  if (it.glow) common.push('glow');
  if (it.name) common.push(`name=${fmtName(it.name)}`);
  const mods = [...it.motion.map(printMotion), ...(it.dup ? [printRing(it.dup)] : [])];
  if (it.type === 'group') {
    const inner = indent === null
      ? it.children.map(c => printItem(c)).join(', ')
      : `\n${it.children.map(c => `${indent}  ${printItem(c, `${indent}  `)}`).join(',\n')}\n${indent}`;
    const head = `${it.k > 0 ? 'smooth-' : ''}${it.op}(${inner})`;
    const extra: string[] = [];
    if (it.k > 0 && round(it.k) !== DEFAULT_SMOOTH_K) extra.push(`k=${fmt(it.k)}`);
    return [head, ...extra, ...common, ...mods].join(' ');
  }
  const def = SHAPE_BY_KIND[it.kind];
  const parts: string[] = [it.kind];
  const defaults = defaultSize(it.kind);
  for (const p of def.params) {
    const v = it.size[p.key];
    if (v !== undefined && !valueEq(v, defaults[p.key])) parts.push(`${p.key}=${Array.isArray(v) ? fmtVec(v) : fmt(v)}`);
  }
  return [...parts, ...common, ...mods].join(' ');
}

/**
 * The shortest recipe that parses back to `scene`. `multiline` puts each clause on its own line;
 * `pretty` also puts each item of a combine on its own indented line.
 */
export function printRecipe2D(scene: Scene2D, opts: { multiline?: boolean; pretty?: boolean } = {}): string {
  const ind = opts.pretty ? '' : null;
  const L = scene.look, D = DEFAULT_LOOK;
  const clauses: string[] = [];
  clauses.push(...scene.space.map(printSpace));
  clauses.push(...scene.layers.map(it => printItem(it, ind)));
  if (scene.grid) clauses.push(printGrid(scene.grid, colourText));
  // Look.
  if (L.glow.mode !== 'off') {
    const g = ['glow'];
    if (L.glow.mode === 'selected') g.push('selected');
    if (!valueEq(L.glow.amount, D.glow.amount)) g.push(fmt(L.glow.amount));
    if (!valueEq(L.glow.falloff, D.glow.falloff)) g.push(`falloff=${fmt(L.glow.falloff)}`);
    if (L.glow.tint) g.push(`color=${colourText(L.glow.tint)}`);
    clauses.push(g.join(' '));
  }
  if (L.colour.by !== 'layer') {
    const c = ['colour', 'by', L.colour.by, `palette=${L.colour.palette}`];
    if (!valueEq(L.colour.scale, D.colour.scale)) c.push(`scale=${fmt(L.colour.scale)}`);
    if (!valueEq(L.colour.speed, D.colour.speed)) c.push(`speed=${fmt(L.colour.speed)}`);
    clauses.push(c.join(' '));
  }
  if (L.tone !== D.tone) clauses.push(`tone ${L.tone}`);
  if (!same(L.bg, D.bg)) clauses.push(`background ${colourText(L.bg)}`);
  for (const k of ['bloom', 'vignette', 'grain', 'scanlines'] as const) if (L.post[k] > 0) clauses.push(`${k} ${fmt(L.post[k])}`);
  if (scene.output && scene.output.show !== 'picture') clauses.push(`output ${scene.output.show}${scene.output.palette ? ` palette=${scene.output.palette}` : ''}`);
  return clauses.join(opts.multiline || opts.pretty ? '\n' : ' · ');
}

/** A recipe in the pretty form, or the text as it is when it doesn't read cleanly. */
export function formatRecipe2D(src: string): string {
  const r = parseRecipe2D(src);
  return r.errors.length ? src : printRecipe2D(r.scene, { pretty: true });
}

/** The words a recipe understands, for the Recipe tab's reference. */
export const RECIPE_VOCABULARY_2D = {
  space: SPACES.map(s => ({ kind: s.kind, keys: [...(s.select ? [s.select.key] : []), ...s.params.map(p => p.key)] })),
  combines: ['union', 'smooth-union', 'subtract', 'smooth-subtract', 'intersect', 'smooth-intersect'],
  shapes: SHAPES.map(s => ({ kind: s.kind, keys: s.params.map(p => p.key) })),
  itemKeys: ['at=(x,y)', 'rot=30', 'scale=1.5', 'color=teal', 'inflate=0.02', 'outline=0.02', 'glow', 'name="Sun"'],
  motion: ['@orbit(0.3 speed=0.25)', '@bob(0.15 dir=90)', '@spin(0.25)', '@pulse(0.25 speed=0.5)'],
  ring: ['@ring(6 r=0.5)', '@ring(6 r=0.5 inner=(5,0.2))', '@ring(6 r=0.5 levels=3 factor=1.6)'],
  look: ['glow [selected] [amount] falloff= color=', `colour by ${COLOUR_BYS.join('|')} palette= scale= speed=`, `tone ${TONE_MODES.join('|')}`, 'background colour', 'bloom 0.6', 'vignette 0.5', 'grain 0.05', 'scanlines 0.3', 'output distance|mask|space palette='],
  colours: Object.keys(COLOUR_TABLE),
  palettes: PALETTES.map(p => p.key),
};

export const RECIPE_WORDS_2D = { ops: OP_WORDS, shapes: SHAPE_WORDS, space: SPACE_WORDS, look: LOOK_WORDS, motion: MOTION_WORDS };
