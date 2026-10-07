/**
 * recipe.ts — the Scene Builder's recipe text, both ways (docs/scene-builder.md).
 *
 *   volumetric · smooth-union(sphere r=1, cone h=2 rot=(30,0,0)) k=0.3 · twist 0.5 · polar-repeat 6 · camera dist=4 orbit=10 · fog 0.3
 *
 * A recipe is clauses separated by `·`, `|`, `;` or new lines. A clause is a
 * render mode, a shape or a combine group (the scene's items, joined by a
 * union), a warp (bends the whole scene), or a setting (sun, sky, shadows,
 * fog, background, camera, quality…). Warps on one item follow it with `@`:
 * `box size=(0.3,1,0.3) @twist(2)`.
 *
 * The parser is forgiving: case, spacing, aliases (`ball`, `donut`, `cube`)
 * and units (`30deg`, `0.5rad`) are all fine, a mistake is reported with its
 * position and a "did you mean", and everything else in the recipe still
 * applies. printRecipe writes the shortest recipe that parses back to the
 * same spec: only what differs from the defaults.
 */
import {
  DEFAULT_CAMERA, DEFAULT_COLOR, DEFAULT_LOOK, DEFAULT_QUALITY, SHAPES, SHAPE_BY_KIND, TONE_MODES, WARPS, WARP_BY_KIND,
  defaultSize, defaultWarpValues, emptySpec, newGroup, newShape, newWarp,
  type CameraSpec, type CombineOp, type ParamDef, type RenderMode, type SceneItem, type SceneSpec, type ShapeSpec, type ToneMode, type Vec3, type WarpDef, type WarpSpec,
} from './spec';
import { COLOUR_TABLE, colourText } from '../lang/colours';
import { Cursor } from '../lang/parse';
import { continuesClause, lineCol, type Tok, type Unit } from '../lang/lex';
import type { Value as LangValue } from '../lang/ast';
import { printValue } from '../lang/print';
import { drawFrom, freshSeed, makeRng, resolveRandom, seedOf, type RandSpec, type Resolved, type Rng } from '../lang/random';
import { SCENE_SETTING_RAND, sceneRand } from '../lang/sceneRand';
import { suggest } from '../lang/fuzzy';
import { DEFAULT_PALETTE, OUTPUTS, OUTPUT_WORDS, PALETTES, PALETTE_BY_KEY, outputClause, type OutputSpec } from './output';

// ── Errors ──────────────────────────────────────────────────────────────────

export interface RecipeError {
  message: string;
  /** Character offsets into the recipe. */
  from: number;
  to: number;
  line: number;
  col: number;
}

export interface ParseResult {
  spec: SceneSpec;
  errors: RecipeError[];
  /** Clauses that parsed but have no effect in this render mode, and the like. */
  warnings: string[];
  /** Old words that still work, with the canonical one (a one-click rewrite): `glow` as a mode, `noise` as a warp… */
  hints?: RecipeHint[];
  /** What `random` values became (`falloff=random → 3.7`), and the seed that drew them. */
  resolved?: Resolved[];
  seed?: number;
}

/** An old word, where it is, and what to write instead (`fix` replaces from…to). */
export interface RecipeHint extends RecipeError { fix: string }

/** Warp words that still work with a hint (D8: the 3D noise warp is written `warp`). */
const WARP_HINTS: Record<string, [string, string]> = {
  noise: ['“noise” as a 3D warp: write warp (noise is the 2D noise node).', 'warp'],
};

// ── Tokens ──────────────────────────────────────────────────────────────────
// The one lexer (lang/lex.ts) and the shared reader (lang/parse.ts): every Playfield surface reads
// values, settings and modifiers the same way.

export { continuesClause };

// ── Words ───────────────────────────────────────────────────────────────────

const MODE_WORDS: Record<string, RenderMode> = {
  surface: 'surface', lit: 'surface', solid: 'surface',
  volumetric: 'volumetric', volume: 'volumetric', glow: 'volumetric', glowing: 'volumetric',
  glass: 'glass', glassy: 'glass',
  gi: 'gi', 'gi-lit': 'gi', global: 'gi',
};

const OP_WORDS: Record<string, { op: CombineOp; smooth: boolean }> = {
  union: { op: 'union', smooth: false }, add: { op: 'union', smooth: false }, combine: { op: 'union', smooth: false }, group: { op: 'union', smooth: false },
  'smooth-union': { op: 'union', smooth: true }, blend: { op: 'union', smooth: true }, merge: { op: 'union', smooth: true }, smooth: { op: 'union', smooth: true },
  subtract: { op: 'subtract', smooth: false }, cut: { op: 'subtract', smooth: false }, difference: { op: 'subtract', smooth: false }, minus: { op: 'subtract', smooth: false },
  'smooth-subtract': { op: 'subtract', smooth: true }, 'smooth-cut': { op: 'subtract', smooth: true },
  intersect: { op: 'intersect', smooth: false }, intersection: { op: 'intersect', smooth: false }, both: { op: 'intersect', smooth: false },
  'smooth-intersect': { op: 'intersect', smooth: true },
};

export const DEFAULT_SMOOTH_K = 0.3;

const SHAPE_WORDS: Record<string, string> = Object.fromEntries(SHAPES.flatMap(s => [[s.kind, s.kind], ...s.aliases.map(a => [a, s.kind])]));
const WARP_WORDS: Record<string, string> = Object.fromEntries(WARPS.flatMap(w => [[w.kind, w.kind], ...w.aliases.map(a => [a, w.kind])]));
const SETTING_WORDS = ['sun', 'sky', 'bounce', 'shadows', 'shadow', 'ao', 'occlusion', 'fog', 'background', 'bg', 'tone', 'camera', 'cam', 'quality', 'custom', 'custom-warp', 'output', 'show', 'colour', 'color'];

const COLOR_NAMES = COLOUR_TABLE as Readonly<Record<string, Vec3>>;

/** Every word a clause can start with, for "did you mean". */
const CLAUSE_WORDS = [...Object.keys(MODE_WORDS), ...Object.keys(OP_WORDS), ...Object.keys(SHAPE_WORDS), ...Object.keys(WARP_WORDS), ...SETTING_WORDS];

export { suggest };

// ── Values ──────────────────────────────────────────────────────────────────

type Value = { kind: 'num'; v: number; unit: Unit | null } | { kind: 'vec'; v: Vec3 } | { kind: 'word'; v: string } | { kind: 'str'; v: string }
  /** `random…`, resolved when its setting is known (resolveArgs). */
  | { kind: 'random'; r: Extract<LangValue, { k: 'random' }> };
/** `comma`: a `,` followed it inside a warp's brackets (`@move(1, 2, 3)` is one vector). */
type Arg = { key: string | null; value: Value; at: number; end: number; comma?: boolean };

export const round = (n: number) => Math.round(n * 10000) / 10000;

/** A shared value in the recipe's terms (null: not a value a recipe takes). */
function recipeValue(v: LangValue): Value | null {
  switch (v.k) {
    case 'num': return { kind: 'num', v: v.v, unit: v.unit };
    case 'colour': return { kind: 'vec', v: v.v };
    case 'vec': {
      const n = v.v;
      return { kind: 'vec', v: (n.length === 1 ? [n[0], n[0], n[0]] : n.length === 2 ? [n[0], n[1], 0] : [n[0], n[1], n[2]]) as Vec3 };
    }
    case 'word': return { kind: 'word', v: v.v };
    case 'str': return { kind: 'str', v: v.v };
    case 'random': return { kind: 'random', r: v };
    default: return null;
  }
}

export interface ParseOptions {
  /** The seed for `random` values when the text has no `seed=` (default: a fresh one). */
  seed?: number;
}

class Parser {
  errors: RecipeError[] = [];
  warnings: string[] = [];
  hints: RecipeHint[] = [];
  ids = { s: 0, g: 0, w: 0 };
  private c: Cursor;
  private src: string;
  /** Randomness: a leading `random`, the seed, what was drawn. */
  randomAll = false;
  seed: number | null = null;
  private seedOpt: number | undefined;
  private rngCache: Rng | null = null;
  resolved: Resolved[] = [];

  constructor(src: string, opts: ParseOptions = {}) {
    this.src = src;
    this.c = new Cursor(src);
    this.seedOpt = opts.seed;
    // A `seed=N` (or `seed N`) anywhere sets the seed before anything is drawn.
    const m = /(?:^|[\s·•|;])seed\s*=?\s*([A-Za-z0-9_-]+)/i.exec(src);
    if (m) this.seed = seedOf(m[1]);
  }

  get rng(): Rng {
    if (!this.rngCache) {
      if (this.seed === null) this.seed = this.seedOpt ?? freshSeed();
      this.rngCache = makeRng(this.seed);
    }
    return this.rngCache;
  }

  err(from: number, to: number, message: string): RecipeError {
    const { line, col } = lineCol(this.src, from);
    return { message, from, to: Math.max(to, from + 1), line, col };
  }
  fail(tok: { at: number; end: number }, message: string) { this.errors.push(this.err(tok.at, tok.end, message)); }
  hint(tok: { at: number; end: number }, message: string, fix: string) {
    if (!this.hints.some(h => h.from === tok.at)) this.hints.push({ ...this.err(tok.at, tok.end, message), fix });
  }

  peek(o = 0): Tok { return this.c.peek(o); }
  next(): Tok { return this.c.next(); }
  get i() { return this.c.i; }
  get toks() { return this.c.toks; }
  /** Skip to the end of this clause (after an error). */
  skipClause() { this.c.skipClause(); }
  atEnd(stop: ReadonlyArray<Tok['t']>) { return this.c.atEnd(stop); }

  /** The cursor's own mistakes (unclosed brackets, stray characters…), in the recipe's terms. */
  private takeCursorErrors() {
    for (const d of this.c.diagnostics.splice(0)) if (d.severity === 'error') this.errors.push(this.err(d.at, d.end, d.message));
  }

  value(): Value | null {
    const at = this.peek();
    const v = this.c.value();
    this.takeCursorErrors();
    if (!v) return null;
    const r = recipeValue(v);
    if (!r) { this.fail(at, `“${this.src.slice(at.at, this.toks[this.i - 1].end)}” isn't a recipe value: a number, (x, y, z), a colour or a word.`); return null; }
    return r;
  }

  /** Arguments up to the end of the clause, a `,`, `)` or `@`. `commas`: a `,` between arguments is allowed and marked on the one before it. */
  args(stop: ReadonlyArray<Tok['t']> = [',', ')', '@'], commas = false): Arg[] {
    const raw = this.c.args(stop, commas);
    this.takeCursorErrors();
    const out: Arg[] = [];
    for (const a of raw) {
      const v = recipeValue(a.value);
      if (!v) { this.fail(a, `“${this.src.slice(a.at, a.end)}” isn't a recipe value: a number, (x, y, z), a colour or a word.`); continue; }
      if (a.op !== '=') { this.fail(a, `${a.key}${a.op} changes a value by a factor: in a recipe, write ${a.key}=… .`); continue; }
      out.push({ key: a.key, value: v, at: a.at, end: a.end, ...(a.comma ? { comma: true } : {}) });
    }
    return out;
  }

  /**
   * Random values resolved now that their settings are known: `spec(key, n)` gives the range for a
   * named setting, or the n-th positional one. What was drawn is kept (`resolved`) for the preview.
   */
  resolveArgs(args: Arg[], what: string, spec: (key: string | null, n: number) => RandSpec | undefined): Arg[] {
    let pos = 0;
    return args.map(a => {
      const n = a.key ? -1 : pos;
      if (!a.key && !(a.value.kind === 'word' && /^glass$/i.test(a.value.v)) && a.value.kind !== 'str') pos++;
      if (a.value.kind !== 'random') return a;
      const sp = spec(a.key?.toLowerCase() ?? null, n);
      const drawn = resolveRandom(a.value.r, sp, this.rng);
      const v = drawn ? recipeValue(drawn) : null;
      if (!v || v.kind === 'random') { this.fail(a, `There is nothing to draw ${a.key ?? 'that'} from: give it a range, random(0.2..2).`); return { ...a, value: { kind: 'word', v: '' } }; }
      this.resolved.push({ key: `${what}${a.key ? `.${a.key}` : ''}`, from: this.src.slice(a.at, a.end).replace(/^[\w-]+=/, ''), to: printValue(drawn!), at: a.at, end: a.end });
      return { ...a, value: v };
    });
  }

  /** A value drawn for a setting the line left unset (a leading `random`). */
  draw(spec: RandSpec, key: string, at: { at: number; end: number }): Value {
    const v = drawFrom(spec, this.rng);
    this.resolved.push({ key, from: 'random', to: printValue(v), at: at.at, end: at.end });
    return recipeValue(v)!;
  }

  // ── Clauses ──

  recipe(): ParseResult {
    const spec = emptySpec();
    const items: SceneItem[] = [];
    const sceneWarps: WarpSpec[] = [];
    let mode: RenderMode | null = null;
    while (this.peek().t !== 'eof') {
      if (this.peek().t === 'sep') { this.next(); continue; }
      const t = this.peek();
      if (t.t !== 'word') { this.fail(t, 'A clause starts with a word: a shape, a combine, a warp or a setting.'); this.skipClause(); continue; }
      const w = t.v.toLowerCase();
      // A leading `random`: every setting the line leaves unset is drawn (lang/random.ts).
      if (w === 'random' && this.peek(1).t !== '(' && this.peek(1).t !== '=') {
        this.next();
        this.randomAll = true;
        if (this.peek().t === 'word' && (this.peek() as Extract<Tok, { t: 'word' }>).v.toLowerCase() === 'seed') continue;
        continue;
      }
      // `seed=42` / `seed 42` (read up front, in the constructor).
      if (w === 'seed') { this.next(); if (this.peek().t === '=') this.next(); if (this.peek().t === 'num' || this.peek().t === 'word') this.next(); else this.fail(t, 'seed takes a number or a word: seed=42, seed=mossy.'); }
      else if (MODE_WORDS[w] && !(w === 'glass' && this.peek(1).t === '=')) {
        this.next();
        if (w === 'glow') this.hint(t, '“glow” as a render mode: write volumetric (glow is the glow step).', 'volumetric');
        if (mode && mode !== MODE_WORDS[w]) this.warnings.push(`Two render modes; ${MODE_WORDS[w]} wins.`);
        mode = MODE_WORDS[w];
        const margs = this.resolveArgs(this.args([]), mode, key => (key ? SCENE_SETTING_RAND[`${mode}.${key}`] : undefined));
        this.modeArgs(spec, mode, margs);
        if (this.randomAll) for (const k of ['glass.ior', 'volumetric.density', 'volumetric.falloff', 'gi.bounce', 'gi.rough']) {
          const [m, key] = k.split('.');
          if (m !== mode || margs.some(a => a.key?.toLowerCase() === key)) continue;
          this.modeArgs(spec, mode, [{ key, value: this.draw(SCENE_SETTING_RAND[k], k, t), at: t.at, end: t.end }]);
        }
      } else if (OP_WORDS[w] || SHAPE_WORDS[w] || w === 'custom') {
        const it = this.item();
        if (it) items.push(it);
      } else if (WARP_WORDS[w] || w === 'custom-warp') {
        this.next();
        if (WARP_HINTS[w]) this.hint(t, WARP_HINTS[w][0], WARP_HINTS[w][1]);
        const wp = this.warpBody(WARP_WORDS[w] ?? 'custom', t, true);
        if (wp) sceneWarps.push(wp);
      } else if (SETTING_WORDS.includes(w)) {
        this.next();
        if (w === 'show') this.hint(t, '“show” in a recipe: write output.', 'output');
        const key0 = w === 'shadow' ? 'shadows' : w === 'bg' ? 'background' : w === 'cam' ? 'camera' : w;
        const PRIMARY: Record<string, string> = { fog: 'density', shadows: 'hardness', sky: 'color', bounce: 'color', background: 'top', tone: 'mode', camera: 'dist' };
        const sargs = this.resolveArgs(this.args([]), key0, (key, n) => SCENE_SETTING_RAND[`${key0}.${key ?? (n === 0 ? PRIMARY[key0] : n === 1 && key0 === 'background' ? 'bottom' : '')}`]);
        if (this.randomAll && key0 === 'camera') for (const k of ['dist', 'orbit', 'elev']) if (!sargs.some(a => a.key?.toLowerCase() === k || (!a.key && k === 'dist'))) sargs.push({ key: k, value: this.draw(SCENE_SETTING_RAND[`camera.${k}`], `camera.${k}`, t), at: t.at, end: t.end });
        if (this.randomAll && key0 === 'fog' && !sargs.some(a => !a.key || a.key === 'density')) sargs.unshift({ key: null, value: this.draw(SCENE_SETTING_RAND['fog.density'], 'fog.density', t), at: t.at, end: t.end });
        this.setting(spec, w, t, sargs);
      } else {
        const s = suggest(w, CLAUSE_WORDS);
        this.fail(t, `“${t.v}” isn't a shape, combine, warp or setting.${s ? ` Did you mean “${s}”?` : ''}`);
        this.skipClause();
        continue;
      }
      if (this.peek().t !== 'sep' && this.peek().t !== 'eof') {
        const extra = this.peek();
        this.fail(extra, `Unexpected “${this.src.slice(extra.at, extra.end)}”: separate clauses with · or a new line.`);
        this.skipClause();
      }
    }
    spec.look.mode = mode ?? 'surface';
    // One combine on its own is the scene's root; anything else is joined by a union.
    if (items.length === 1 && items[0].type === 'group') {
      spec.root = { ...items[0], warps: [...sceneWarps, ...items[0].warps] };
    } else {
      spec.root = newGroup(this.gid(), { name: 'Scene', children: items, warps: sceneWarps });
    }
    if (!spec.root.name) spec.root.name = 'Scene';
    this.renumber(spec);
    const r: ParseResult = { spec, errors: this.errors, warnings: this.warnings };
    if (this.hints.length) r.hints = this.hints;
    if (this.resolved.length || this.randomAll) { r.resolved = this.resolved; r.seed = this.seed ?? undefined; }
    return r;
  }

  gid() { return `g${++this.ids.g}`; }
  sid() { return `s${++this.ids.s}`; }
  wid() { return `w${++this.ids.w}`; }

  /** Ids in tree order (the root first), so a recipe always parses to the same ids. */
  renumber(spec: SceneSpec) {
    let s = 0, g = 0, w = 0;
    const go = (it: SceneItem) => {
      it.id = it.type === 'group' ? `g${++g}` : `s${++s}`;
      for (const wp of it.warps) wp.id = `w${++w}`;
      if (it.type === 'group') it.children.forEach(go);
    };
    go(spec.root);
  }

  item(): SceneItem | null {
    const t = this.next() as Extract<Tok, { t: 'word' }>;
    const w = t.v.toLowerCase();
    let it: SceneItem;
    if (w === 'custom') {
      it = newShape('custom', this.sid(), { label: this.parenText(t) ?? 'custom' });
    } else if (OP_WORDS[w]) {
      const { op, smooth } = OP_WORDS[w];
      if (w === 'group') this.hint(t, '“group( )” in a scene: write union( ) (group( ) groups nodes in an edit).', 'union');
      if (w === 'both') this.hint(t, '“both( )”: write intersect( ) (both on its own means the two selected nodes).', 'intersect');
      const g = newGroup(this.gid(), { op, k: smooth ? DEFAULT_SMOOTH_K : 0 });
      if (this.peek().t !== '(') { this.fail(t, `${t.v} needs its shapes in brackets: ${w}(sphere, box).`); this.skipClause(); return null; }
      const open = this.next();
      while (this.peek().t !== ')' && this.peek().t !== 'eof' && this.peek().t !== 'sep') {
        if (this.peek().t === ',') { this.next(); continue; }
        const c = this.peek();
        if (c.t === 'word' && (OP_WORDS[c.v.toLowerCase()] || SHAPE_WORDS[c.v.toLowerCase()] || c.v.toLowerCase() === 'custom')) {
          const child = this.item();
          if (child) g.children.push(child);
        } else {
          const s = c.t === 'word' ? suggest(c.v, [...Object.keys(SHAPE_WORDS), ...Object.keys(OP_WORDS)]) : null;
          this.fail(c, `Inside ${w}( ) go shapes and combines.${s ? ` Did you mean “${s}”?` : ''}`);
          while (![',', ')', 'sep', 'eof'].includes(this.peek().t)) this.next();
        }
      }
      if (this.peek().t === ')') this.next(); else this.fail(open, 'This ( is never closed.');
      if (!g.children.length) this.warnings.push(`${w}( ) is empty.`);
      const gargs = this.resolveArgs(this.args([',', ')', '@']), w, key => (key === null || key === 'k' || key === 'blend' || key === 'smooth' ? SCENE_SETTING_RAND['combine.k'] : undefined));
      if (this.randomAll && smooth && !gargs.some(a => a.value.kind === 'num')) g.k = Math.max(0, (this.draw(SCENE_SETTING_RAND['combine.k'], `${w}.k`, t) as { v: number }).v);
      for (const a of gargs) {
        const key = a.key?.toLowerCase();
        if ((key === 'k' || key === 'blend' || key === 'smooth') && a.value.kind === 'num') g.k = Math.max(0, a.value.v);
        else if (key === 'name' && (a.value.kind === 'str' || a.value.kind === 'word')) g.name = a.value.v;
        else if (!key && a.value.kind === 'num') g.k = Math.max(0, a.value.v);
        else this.fail(a, `A combine takes k= (its blend radius) and name=.`);
      }
      it = g;
    } else {
      const kind = SHAPE_WORDS[w];
      const sh = newShape(kind, this.sid());
      if (w === 'rounded-box' || w === 'roundbox') sh.size.round = 0.1;
      if (w === 'rounded-cylinder') sh.size.round = 0.05;
      const def = SHAPE_BY_KIND[kind];
      const sargs = this.resolveArgs(this.args([',', ')', '@']), kind, (key, n) => {
        const p = key ? def.params.find(q => q.key.toLowerCase() === key) ?? (key === 'radius' ? def.params.find(q => q.key === 'r') : undefined) : def.params[n];
        if (p) return sceneRand(p);
        const k = key === 'colour' || key === 'c' ? 'color' : key === 'pos' || key === 'position' ? 'at' : key;
        return SCENE_SETTING_RAND[`shape.${k}`];
      });
      this.shapeArgs(sh, sargs);
      if (this.randomAll) {
        const given = new Set(sargs.map(a => a.key?.toLowerCase()).filter(Boolean));
        def.params.forEach((p, n) => {
          if (given.has(p.key.toLowerCase()) || sargs.filter(a => !a.key && a.value.kind !== 'str' && !(a.value.kind === 'word')).length > n) return;
          const v = this.draw(sceneRand(p), `${kind}.${p.key}`, t);
          sh.size[p.key] = v.kind === 'vec' ? v.v : (v as { v: number }).v;
        });
        if (!given.has('color') && !given.has('colour') && !given.has('c')) sh.color = this.colour({ key: 'color', value: this.draw({ kind: 'colour' }, `${kind}.color`, t), at: t.at, end: t.end }) ?? sh.color;
      }
      it = sh;
    }
    while (this.peek().t === '@') {
      const at = this.next();
      const wt = this.peek();
      if (wt.t !== 'word') { this.fail(at, '@ is followed by a warp: @twist(2).'); continue; }
      this.next();
      const kind = WARP_WORDS[wt.v.toLowerCase()] ?? (wt.v.toLowerCase() === 'custom' ? 'custom' : null);
      if (WARP_HINTS[wt.v.toLowerCase()]) this.hint(wt, WARP_HINTS[wt.v.toLowerCase()][0], WARP_HINTS[wt.v.toLowerCase()][1]);
      if (!kind) {
        const s = suggest(wt.v, Object.keys(WARP_WORDS));
        this.fail(wt, `“${wt.v}” isn't a warp.${s ? ` Did you mean “${s}”?` : ''}`);
        if (this.peek().t === '(') this.parenText(wt);
        continue;
      }
      const wp = this.warpBody(kind, wt, false);
      if (wp) it.warps.push(wp);
    }
    return it;
  }

  /** The raw text between ( and ), for custom(…). */
  parenText(t: { at: number; end: number }): string | null {
    if (this.peek().t !== '(') return null;
    const open = this.next();
    let depth = 1;
    const start = open.end;
    let end = start;
    while (this.peek().t !== 'eof') {
      const x = this.next();
      if (x.t === '(') depth++;
      if (x.t === ')' && --depth === 0) { end = x.at; break; }
      end = x.end;
    }
    if (depth) this.fail(t, 'This ( is never closed.');
    return this.src.slice(start, end).trim();
  }

  warpBody(kind: string, t: { at: number; end: number }, top: boolean): WarpSpec | null {
    if (kind === 'custom') return { id: this.wid(), kind: 'custom', values: {}, label: this.parenText(t) ?? (top ? this.args([]).map(a => this.src.slice(a.at, a.end)).join(' ') : 'custom') };
    let args: Arg[];
    // `twist(2)` is a call; at the top level `repeat (2,100,2)` (a space before the bracket) is a vector value.
    if (this.peek().t === '(' && (!top || this.peek().at === t.end)) {
      const open = this.next();
      args = this.args([')'], true);
      if (this.peek().t === ')') this.next(); else this.fail(open, 'This ( is never closed.');
    } else {
      args = this.args(top ? [] : [',', ')', '@']);
    }
    // `rotate y 30` (an axis and an angle) is the older Turn; `rotate (30, 0, 45)` turns about all three.
    if (kind === 'rotate' && args.some(a => (!a.key && a.value.kind === 'word' && /^[xyz]$/i.test(a.value.v)) || a.key?.toLowerCase() === 'axis')) kind = 'turn';
    const wp = newWarp(kind, this.wid());
    const def = WARP_BY_KIND[kind];
    args = this.resolveArgs(args, kind, (key, n) => {
      const p = key ? def.params.find(q => q.key.toLowerCase() === key) : def.params[n];
      if (p) return sceneRand(p);
      if (key && def.axes && (key === def.axes.key || key === 'axis')) return { kind: 'choice', options: def.axes.kind === 'one' ? def.axes.options : ['x', 'y', 'z', 'xz', 'xy'] };
      if (key && def.select && key === def.select.key) return { kind: 'choice', options: def.select.options };
      return undefined;
    });
    this.warpArgs(wp, def, args);
    if (this.randomAll) {
      const given = new Set(args.map(a => a.key?.toLowerCase()).filter(Boolean));
      const positional = args.filter(a => !a.key && a.value.kind !== 'word').length;
      def.params.forEach((p, n) => {
        if (given.has(p.key.toLowerCase()) || positional > n) return;
        const v = this.draw(sceneRand(p), `${kind}.${p.key}`, t);
        wp.values[p.key] = v.kind === 'vec' ? v.v : (v as { v: number }).v;
      });
    }
    return wp;
  }

  // ── Arguments to things ──

  numberFor(p: ParamDef, a: Arg): number | Vec3 | null {
    const v = a.value;
    const conv = (n: number, unit: Unit | null) => (p.deg && unit === 'rad' ? n * 180 / Math.PI : n);
    if (Array.isArray(p.def)) {
      if (v.kind === 'vec') return v.v;
      if (v.kind === 'num') return [v.v, v.v, v.v];
    } else if (v.kind === 'num') return conv(v.v, v.unit);
    this.fail(a, typeMismatch(p.key, Array.isArray(p.def) ? 'vec3' : 'float', v));
    return null;
  }

  colour(a: Arg): Vec3 | null {
    const v = a.value;
    if (v.kind === 'vec') return v.v;
    if (v.kind === 'num') return [v.v, v.v, v.v];
    if (v.kind === 'word' || v.kind === 'str') {
      const c = COLOR_NAMES[v.v.toLowerCase()];
      if (c) return [...c] as Vec3;
      const s = suggest(v.v, Object.keys(COLOR_NAMES));
      this.fail(a, `“${v.v}” isn't a colour I know: use #rrggbb or (r, g, b).${s ? ` Did you mean “${s}”?` : ''}`);
      return null;
    }
    return null;
  }

  vecArg(a: Arg, what: string): Vec3 | null {
    if (a.value.kind === 'vec') return a.value.v;
    if (a.value.kind === 'num') return [a.value.v, a.value.v, a.value.v];
    this.fail(a, `${what} is (x, y, z).`);
    return null;
  }

  shapeArgs(sh: ShapeSpec, args: Arg[]) {
    const def = SHAPE_BY_KIND[sh.kind];
    let positional = 0;
    for (const a of args) {
      const raw = a.key;
      const key = raw?.toLowerCase();
      if (!raw) {
        if (a.value.kind === 'word' && a.value.v.toLowerCase() === 'glass') { sh.glass = true; continue; }
        if (a.value.kind === 'str') { sh.name = a.value.v; continue; }
        const p = def.params[positional++];
        if (!p) { this.fail(a, `${def.label} has no more settings to fill.`); continue; }
        const n = this.numberFor(p, a);
        if (n !== null) sh.size[p.key] = n;
        continue;
      }
      if (key === 'at' || key === 'pos' || key === 'position') { const v = this.vecArg(a, 'at'); if (v) sh.at = v; continue; }
      if (key === 'rot' || key === 'rotate' || key === 'turn') {
        const v = a.value.kind === 'vec' ? (a.value.v.map(x => x) as Vec3) : null;
        if (v) sh.rot = v; else this.fail(a, 'rot is (x, y, z) in degrees.');
        continue;
      }
      if (key === 'color' || key === 'colour' || key === 'c') { const c = this.colour(a); if (c) sh.color = c; continue; }
      if (key === 'shine' || key === 'gloss') { if (a.value.kind === 'num') sh.shine = Math.max(0, Math.min(1, a.value.v)); else this.fail(a, typeMismatch('shine', 'float', a.value, 'a number from 0 to 1')); continue; }
      if (key === 'name') { if (a.value.kind === 'str' || a.value.kind === 'word') sh.name = a.value.v; continue; }
      if (key === 'glass') { sh.glass = !(a.value.kind === 'word' && /^(no|off|false)$/i.test(a.value.v)) && !(a.value.kind === 'num' && a.value.v === 0); continue; }
      // Size keys: exact first (torus R vs r), then any case.
      const p = def.params.find(q => q.key === raw) ?? def.params.find(q => q.key.toLowerCase() === key)
        ?? (key === 'radius' ? def.params.find(q => q.key === 'r') : key === 'height' ? def.params.find(q => q.key === 'h') : undefined);
      if (!p) {
        const s = suggest(raw, [...def.params.map(q => q.key), 'at', 'rot', 'color', 'shine', 'name', 'glass']);
        this.fail(a, `${def.label} has no setting “${raw}”.${s ? ` Did you mean “${s}”?` : ` It takes ${def.params.map(q => q.key).join(', ')}.`}`);
        continue;
      }
      const n = this.numberFor(p, a);
      if (n !== null) sh.size[p.key] = n;
    }
  }

  warpArgs(wp: WarpSpec, def: WarpDef, args0: Arg[]) {
    let positional = 0;
    // Numbers joined by commas are one vector: @move(1, 0.5, 0) is by=(1, 0.5, 0).
    const args: Arg[] = [];
    for (let i = 0; i < args0.length; i++) {
      const a = args0[i];
      if (a.comma && a.value.kind === 'num') {
        const nums = [a];
        while (nums.length < 3 && nums[nums.length - 1].comma && args0[i + 1] && !args0[i + 1].key && args0[i + 1].value.kind === 'num') nums.push(args0[++i]);
        if (nums.length > 1) {
          const v = nums.map(n => (n.value as { v: number }).v);
          args.push({ key: a.key, value: { kind: 'vec', v: [v[0], v[1], v[2] ?? 0] }, at: a.at, end: nums[nums.length - 1].end });
          continue;
        }
      }
      args.push(a);
    }
    for (const a of args) {
      const key = a.key;
      const lower = key?.toLowerCase();
      if (!key && a.value.kind === 'word') {
        const word = a.value.v.toLowerCase();
        if (def.axes?.kind === 'flags' && /^[xyz]+$/.test(word)) { wp.values[def.axes.key] = word; continue; }
        if (def.axes?.kind === 'one' && def.axes.options.includes(word)) { wp.values[def.axes.key] = word; continue; }
        if (def.select?.options.includes(word)) { wp.values[def.select.key] = word; continue; }
        this.fail(a, `${def.label} doesn't know “${a.value.v}”.`);
        continue;
      }
      if (lower && def.axes && (lower === def.axes.key || lower === 'axis' || lower === 'axes')) {
        const word = a.value.kind === 'word' || a.value.kind === 'str' ? a.value.v.toLowerCase() : '';
        if (def.axes.kind === 'flags' ? /^[xyz]+$/.test(word) : def.axes.options.includes(word)) wp.values[def.axes.key] = word;
        else this.fail(a, def.axes.kind === 'flags' ? `${def.axes.key} is letters from xyz, like xz.` : `${def.axes.key} is one of ${def.axes.options.join(', ')}.`);
        continue;
      }
      if (lower && def.select && lower === def.select.key) {
        const word = a.value.kind === 'word' || a.value.kind === 'str' ? a.value.v.toLowerCase() : '';
        if (def.select.options.includes(word)) wp.values[def.select.key] = word; else this.fail(a, `${def.select.key} is one of ${def.select.options.join(', ')}.`);
        continue;
      }
      const p = key ? def.params.find(q => q.key === key) ?? def.params.find(q => q.key.toLowerCase() === lower) : def.params[positional++];
      if (!p) {
        const s = key ? suggest(key, [...def.params.map(q => q.key), ...(def.axes ? [def.axes.key] : []), ...(def.select ? [def.select.key] : [])]) : null;
        this.fail(a, key ? `${def.label} has no setting “${key}”.${s ? ` Did you mean “${s}”?` : ''}` : `${def.label} has no more settings to fill.`);
        continue;
      }
      const n = this.numberFor(p, a);
      if (n !== null) wp.values[p.key] = n;
    }
  }

  modeArgs(spec: SceneSpec, mode: RenderMode, args: Arg[]) {
    const L = spec.look;
    for (const a of args) {
      const key = a.key?.toLowerCase();
      const n = a.value.kind === 'num' ? a.value.v : null;
      if (mode === 'volumetric') {
        if (key === 'density' && n !== null) L.glow.density = n;
        else if (key === 'falloff' && n !== null) L.glow.falloff = n;
        else if (key === 'shell' && n !== null) L.glow.shell = n;
        else if (key === 'exposure' && n !== null) L.glow.exposure = n;
        else if ((key === 'tint' || key === 'color' || key === 'colour')) { const c = this.colour(a); if (c) L.glow.tint = c; }
        else this.fail(a, 'volumetric takes density, falloff, shell, exposure and tint.');
      } else if (mode === 'glass') {
        if (key === 'ior' && n !== null) L.glass.ior = n;
        else if (key === 'dispersion' && n !== null) L.glass.dispersion = n;
        else if (key === 'tint' || key === 'color') { const c = this.colour(a); if (c) L.glass.tint = c; }
        else this.fail(a, 'glass takes ior, dispersion and tint.');
      } else if (mode === 'gi') {
        if ((key === 'bounce' || key === 'gi') && n !== null) L.gi.strength = n;
        else if ((key === 'metal' || key === 'metallic') && n !== null) L.gi.metal = n;
        else if ((key === 'rough' || key === 'roughness') && n !== null) L.gi.rough = n;
        else if ((key === 'spec' || key === 'specular') && n !== null) L.gi.spec = n;
        else this.fail(a, 'gi takes bounce, metal, rough and spec.');
      } else this.fail(a, 'surface takes no settings: set the lights with sun, sky, shadows, ao.');
    }
  }

  setting(spec: SceneSpec, w: string, t: { at: number; end: number }, args: Arg[]) {
    const L = spec.look;
    const first = args[0];
    const firstNum = first && !first.key && first.value.kind === 'num' ? first.value.v : null;
    const off = first && !first.key && first.value.kind === 'word' && /^(off|no|none|false)$/i.test(first.value.v);
    const on = first && !first.key && first.value.kind === 'word' && /^(on|yes|true)$/i.test(first.value.v);
    switch (w) {
      case 'sun':
        for (const a of args) {
          const key = a.key?.toLowerCase();
          if (!key || key === 'dir' || key === 'direction') { const v = this.vecArg(a, 'sun dir'); if (v) L.sunDir = v; }
          else if (key === 'color' || key === 'colour') { const c = this.colour(a); if (c) L.sunColor = c; }
          else this.fail(a, 'sun takes dir=(x, y, z) and color.');
        }
        return;
      case 'sky': case 'bounce': {
        const a = args.find(x => !x.key || /^colou?r$/i.test(x.key));
        const c = a ? this.colour(a) : null;
        if (c) L[w] = c; else if (!a) this.fail(t, `${w} takes a colour.`);
        return;
      }
      case 'shadows': case 'shadow':
        L.shadows = off ? 0 : firstNum ?? (on ? DEFAULT_LOOK.shadows : L.shadows);
        if (!off && !on && firstNum === null && first) this.fail(first, 'shadows takes a hardness (8 soft … 32 hard) or off.');
        return;
      case 'ao': case 'occlusion':
        L.ao = off ? 0 : firstNum ?? (on ? DEFAULT_LOOK.ao : L.ao);
        if (!off && !on && firstNum === null && first) this.fail(first, 'ao takes a step (0.06) or off.');
        return;
      case 'fog':
        for (const a of args) {
          const key = a.key?.toLowerCase();
          if (!key && a.value.kind === 'num') L.fog = a.value.v;
          else if (!key && a.value.kind === 'word' && /^(off|none)$/i.test(a.value.v)) L.fog = 0;
          else if (key === 'density' && a.value.kind === 'num') L.fog = a.value.v;
          else if (key === 'color' || key === 'colour') { const c = this.colour(a); if (c) L.fogColor = c; }
          else this.fail(a, 'fog takes a density and color.');
        }
        return;
      case 'background': case 'bg': {
        let pos = 0;
        for (const a of args) {
          const key = a.key?.toLowerCase();
          if (key === 'top' || (!key && pos === 0)) { const c = this.colour(a); if (c) L.bg = c; if (!key) pos++; }
          else if (key === 'bottom' || (!key && pos === 1)) { const c = this.colour(a); if (c) L.bg2 = c; if (!key) pos++; }
          else this.fail(a, 'background takes a colour, or top= and bottom= for a gradient.');
        }
        return;
      }
      case 'tone': {
        const word = first?.value.kind === 'word' ? first.value.v.toLowerCase() : '';
        if ((TONE_MODES as readonly string[]).includes(word)) L.tone = word as ToneMode;
        else if (word === 'off') L.tone = 'none';
        else this.fail(first ?? t, `tone is one of ${TONE_MODES.join(', ')}.`);
        return;
      }
      case 'camera': case 'cam': {
        const C = spec.camera;
        const KEYS: Record<string, keyof CameraSpec> = {
          dist: 'dist', distance: 'dist', angle: 'angle', elev: 'elev', elevation: 'elev', orbit: 'orbit', speed: 'orbit',
          zoom: 'zoom', fov: 'zoom', flatten: 'flatten', ortho: 'flatten', x: 'x', y: 'y', z: 'z',
        };
        for (const a of args) {
          const key = a.key ? KEYS[a.key.toLowerCase()] : 'dist';
          if (!key) { const s = suggest(a.key!, Object.keys(KEYS)); this.fail(a, `camera has no “${a.key}”.${s ? ` Did you mean “${s}”?` : ''}`); continue; }
          if (a.value.kind !== 'num') { this.fail(a, `camera ${key} is a number.`); continue; }
          const deg = key === 'angle' || key === 'elev' || key === 'orbit';
          C[key] = deg && a.value.unit === 'rad' ? round(a.value.v * 180 / Math.PI) : a.value.v;
        }
        return;
      }
      case 'quality': {
        const Q = spec.quality;
        for (const a of args) {
          const key = a.key?.toLowerCase();
          if (key === 'steps' && a.value.kind === 'num') Q.steps = Math.round(a.value.v);
          else if ((key === 'dist' || key === 'max' || key === 'maxdist') && a.value.kind === 'num') Q.maxDist = a.value.v;
          else if ((key === 'step' || key === 'stepscale') && a.value.kind === 'num') Q.stepScale = a.value.v;
          else if ((key === 'step' || key === 'stepscale') && a.value.kind === 'word' && a.value.v.toLowerCase() === 'auto') Q.stepScale = 'auto';
          else if (key === 'jitter' && a.value.kind === 'num') Q.jitter = a.value.v;
          else this.fail(a, 'quality takes steps, dist, step (or step=auto) and jitter.');
        }
        return;
      }
      case 'output': case 'show': case 'colour': case 'color': {
        // "output depth", "show normals", "colour by depth palette sunset".
        const rest = [...args];
        const byPalette = w === 'colour' || w === 'color';
        if (byPalette) {
          const by = rest[0];
          if (by && !by.key && by.value.kind === 'word' && by.value.v.toLowerCase() === 'by') rest.shift();
          else { this.fail(by ?? t, `${w} by … colours the space: colour by depth palette=sunset.`); return; }
        }
        const o: OutputSpec = { show: 'picture' };
        let named = false, wantPalette = false;
        for (const a of rest) {
          const key = a.key?.toLowerCase();
          const word = a.value.kind === 'word' || a.value.kind === 'str' ? a.value.v.toLowerCase() : '';
          const paletteNext = wantPalette;
          wantPalette = !key && (word === 'palette' || word === 'ramp');
          if ((key === 'palette' || key === 'ramp') || (!key && paletteNext) || (!key && named && PALETTE_BY_KEY[word])) {
            if (PALETTE_BY_KEY[word]) o.palette = word;
            else { const s = suggest(word, PALETTES.map(p => p.key)); this.fail(a, `“${word}” isn't a palette: ${PALETTES.map(p => p.key).join(', ')}.${s ? ` Did you mean “${s}”?` : ''}`); }
            continue;
          }
          if (!key && (word === 'palette' || word === 'ramp' || word === 'the' || word === 'through' || word === 'with' || word === 'a')) continue;
          if (!key && !named && OUTPUT_WORDS[word]) { o.show = OUTPUT_WORDS[word]; named = true; continue; }
          const s = word ? suggest(word, Object.keys(OUTPUT_WORDS)) : null;
          this.fail(a, `${w} shows one of ${OUTPUTS.map(x => x.words[0]).join(', ')}${byPalette ? '' : ' (add palette=sunset to colour it)'}.${s ? ` Did you mean “${s}”?` : ''}`);
        }
        if (!named) { if (!rest.length) this.fail(t, `${w} needs what to show: ${OUTPUTS.map(x => x.words[0]).join(', ')}.`); return; }
        if (byPalette && !o.palette) o.palette = DEFAULT_PALETTE;
        if (o.palette && o.show === 'picture') { this.warnings.push('The picture is already coloured: the palette is left out.'); delete o.palette; }
        spec.output = o.show === 'picture' ? undefined : o;
        if (!spec.output) delete spec.output;
        return;
      }
      case 'custom': case 'custom-warp':
        return;
    }
  }
}

/** A value of the wrong type for a setting, with the fix where there is one (docs/scene-builder.md, "Type checks"). */
function typeMismatch(key: string, want: 'float' | 'vec3', v: Value, wantWords?: string): string {
  const what = want === 'float' ? (wantWords ?? 'a number (a float)') : 'a number or (x, y, z)';
  if (want === 'float' && v.kind === 'vec') {
    const lum = Math.round((0.2126 * v.v[0] + 0.7152 * v.v[1] + 0.0722 * v.v[2]) * 1000) / 1000;
    return `${key} is ${what}; (${v.v.map(fmt).join(', ')}) is three numbers (a vec3). Take .x: ${key}=${fmt(v.v[0])}, or its brightness (Luminance): ${key}=${lum}.`;
  }
  if (v.kind === 'word' && COLOR_NAMES[v.v.toLowerCase()]) {
    const c = COLOR_NAMES[v.v.toLowerCase()];
    const lum = Math.round((0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * 1000) / 1000;
    return want === 'float'
      ? `${key} is ${what}; “${v.v}” is a colour (a vec3). Use its brightness (Luminance): ${key}=${lum}.`
      : `${key} is ${what}; “${v.v}” is a colour, not a size. Write ${key}=(x, y, z).`;
  }
  if (v.kind === 'word' || v.kind === 'str') return `${key} is ${what}, not “${v.v}”.`;
  return `${key} is ${what}.`;
}

export function parseRecipe(src: string, opts: ParseOptions = {}): ParseResult {
  return new Parser(src, opts).recipe();
}

// ── Printing ────────────────────────────────────────────────────────────────

export const fmt = (n: number): string => {
  const r = round(n);
  return Object.is(r, -0) ? '0' : String(r);
};
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => round(x) === round(b[i]));
const fmtVec = (v: Vec3): string => (v[0] === v[1] && v[1] === v[2] ? fmt(v[0]) : `(${v.map(fmt).join(',')})`);
const fmtColour = (v: Vec3): string => colourText(v);
const fmtName = (s: string) => (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) ? s : `"${s.replace(/"/g, '\'')}"`);
const valueEq = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? same(a, b) : typeof a === 'number' && typeof b === 'number' ? round(a) === round(b) : a === b);

function printWarp(w: WarpSpec, top: boolean): string {
  if (w.kind === 'custom') return top ? `custom-warp(${w.label ?? ''})` : `@custom(${w.label ?? ''})`;
  const def = WARP_BY_KIND[w.kind];
  const defaults = defaultWarpValues(w.kind);
  const parts: string[] = [];
  if (def.axes && (def.axes.kind === 'flags' || w.kind === 'turn')) parts.push(String(w.values[def.axes.key] ?? def.axes.def));
  else if (def.axes && !valueEq(w.values[def.axes.key], defaults[def.axes.key])) parts.push(`${def.axes.key}=${w.values[def.axes.key]}`);
  def.params.forEach((p, i) => {
    const v = w.values[p.key] as number | Vec3 | undefined;
    if (v === undefined) return;
    // On an item the first vector is bare numbers: @move(1,0.5,0).
    const text = Array.isArray(v) ? (!top && i === 0 && !(v[0] === v[1] && v[1] === v[2]) ? v.map(fmt).join(',') : fmtVec(v)) : fmt(v);
    if (i === 0) parts.push(text);
    else if (!valueEq(v, defaults[p.key])) parts.push(`${p.key}=${text}`);
  });
  if (def.select && !valueEq(w.values[def.select.key], defaults[def.select.key])) parts.push(`${def.select.key}=${w.values[def.select.key]}`);
  // D8: the noise warp is written `warp` (noise is the 2D node); `noise` still reads.
  const word = w.kind === 'noise' ? 'warp' : w.kind;
  return top ? [word, ...parts].join(' ') : `@${word}(${parts.join(' ')})`;
}

/** An item as recipe text. `indent` (the pretty form): a combine's items each on their own line, indented under it. */
function printItem(it: SceneItem, indent: string | null = null): string {
  const warps = it.warps.map(w => printWarp(w, false));
  if (it.type === 'group') {
    const inner = indent === null
      ? it.children.map(c => printItem(c)).join(', ')
      : `\n${it.children.map(c => `${indent}  ${printItem(c, `${indent}  `)}`).join(',\n')}\n${indent}`;
    const head = `${it.k > 0 ? 'smooth-' : ''}${it.op}(${inner})`;
    const extra: string[] = [];
    if (it.k > 0 && round(it.k) !== DEFAULT_SMOOTH_K) extra.push(`k=${fmt(it.k)}`);
    if (it.name) extra.push(`name=${fmtName(it.name)}`);
    return [head, ...extra, ...warps].join(' ');
  }
  if (it.kind === 'custom') return [`custom(${it.label ?? ''})`, ...warps].join(' ');
  const def = SHAPE_BY_KIND[it.kind];
  const parts: string[] = [it.kind];
  const defaults = defaultSize(it.kind);
  for (const p of def.params) {
    const v = it.size[p.key];
    if (v !== undefined && !valueEq(v, defaults[p.key])) parts.push(`${p.key}=${Array.isArray(v) ? fmtVec(v) : fmt(v)}`);
  }
  if (!same(it.at, [0, 0, 0])) parts.push(`at=(${it.at.map(fmt).join(',')})`);
  if (!same(it.rot, [0, 0, 0])) parts.push(`rot=(${it.rot.map(fmt).join(',')})`);
  if (!same(it.color, DEFAULT_COLOR)) parts.push(`color=${fmtColour(it.color)}`);
  if (it.shine > 0) parts.push(`shine=${fmt(it.shine)}`);
  if (it.glass) parts.push('glass');
  if (it.name) parts.push(`name=${fmtName(it.name)}`);
  return [...parts, ...warps].join(' ');
}

/**
 * The shortest recipe that parses back to `spec`. `multiline` puts each clause on its own line;
 * `pretty` also puts each item of a combine on its own indented line, the combine's `k=` on its
 * closing line (formatRecipe). Both parse back to the same spec as the one-line form.
 */
export function printRecipe(spec: SceneSpec, opts: { multiline?: boolean; pretty?: boolean } = {}): string {
  const ind = opts.pretty ? '' : null;
  const L = spec.look, D = DEFAULT_LOOK;
  const clauses: string[] = [];
  // Mode, with its own settings.
  const mode: string[] = [L.mode];
  if (L.mode === 'volumetric') {
    const g = L.glow, dg = D.glow;
    if (!valueEq(g.density, dg.density)) mode.push(`density=${fmt(g.density)}`);
    if (!valueEq(g.falloff, dg.falloff)) mode.push(`falloff=${fmt(g.falloff)}`);
    if (!valueEq(g.shell, dg.shell)) mode.push(`shell=${fmt(g.shell)}`);
    if (!valueEq(g.exposure, dg.exposure)) mode.push(`exposure=${fmt(g.exposure)}`);
    if (!same(g.tint, dg.tint)) mode.push(`tint=${fmtColour(g.tint)}`);
  } else if (L.mode === 'glass') {
    if (!valueEq(L.glass.ior, D.glass.ior)) mode.push(`ior=${fmt(L.glass.ior)}`);
    if (!valueEq(L.glass.dispersion, D.glass.dispersion)) mode.push(`dispersion=${fmt(L.glass.dispersion)}`);
    if (!same(L.glass.tint, D.glass.tint)) mode.push(`tint=${fmtColour(L.glass.tint)}`);
  } else if (L.mode === 'gi') {
    if (!valueEq(L.gi.strength, D.gi.strength)) mode.push(`bounce=${fmt(L.gi.strength)}`);
    if (!valueEq(L.gi.metal, D.gi.metal)) mode.push(`metal=${fmt(L.gi.metal)}`);
    if (!valueEq(L.gi.rough, D.gi.rough)) mode.push(`rough=${fmt(L.gi.rough)}`);
    if (!valueEq(L.gi.spec, D.gi.spec)) mode.push(`spec=${fmt(L.gi.spec)}`);
  }
  clauses.push(mode.join(' '));
  // The tree: a plain union root is its items; anything else is one combine clause.
  const root = spec.root;
  if (root.op === 'union' && root.k === 0 && (!root.name || root.name === 'Scene')) clauses.push(...root.children.map(c => printItem(c, ind)));
  else clauses.push(printItem({ ...root, warps: [], name: root.name === 'Scene' ? '' : root.name }, ind));
  clauses.push(...root.warps.map(w => printWarp(w, true)));
  // Lights and air.
  if (!same(L.sunDir, D.sunDir) || !same(L.sunColor, D.sunColor)) {
    const s = ['sun'];
    if (!same(L.sunDir, D.sunDir)) s.push(`dir=(${L.sunDir.map(fmt).join(',')})`);
    if (!same(L.sunColor, D.sunColor)) s.push(`color=${fmtColour(L.sunColor)}`);
    clauses.push(s.join(' '));
  }
  if (!same(L.sky, D.sky)) clauses.push(`sky ${fmtColour(L.sky)}`);
  if (!same(L.bounce, D.bounce)) clauses.push(`bounce ${fmtColour(L.bounce)}`);
  if (!valueEq(L.shadows, D.shadows)) clauses.push(L.shadows > 0 ? `shadows ${fmt(L.shadows)}` : 'shadows off');
  if (!valueEq(L.ao, D.ao)) clauses.push(L.ao > 0 ? `ao ${fmt(L.ao)}` : 'ao off');
  if (L.fog > 0 || L.fogColor) clauses.push([`fog ${fmt(L.fog)}`, ...(L.fogColor ? [`color=${fmtColour(L.fogColor)}`] : [])].join(' '));
  if (L.bg2) clauses.push(`background top=${fmtColour(L.bg)} bottom=${fmtColour(L.bg2)}`);
  else if (!same(L.bg, D.bg)) clauses.push(`background ${fmtColour(L.bg)}`);
  if (L.tone !== D.tone) clauses.push(`tone ${L.tone}`);
  // Camera and quality.
  const cam = (Object.keys(DEFAULT_CAMERA) as Array<keyof CameraSpec>).filter(k => !valueEq(spec.camera[k], DEFAULT_CAMERA[k]));
  if (cam.length) clauses.push(['camera', ...cam.map(k => `${k}=${fmt(spec.camera[k])}`)].join(' '));
  const Q = spec.quality, DQ = DEFAULT_QUALITY;
  const q: string[] = [];
  if (Q.steps !== DQ.steps) q.push(`steps=${Q.steps}`);
  if (!valueEq(Q.maxDist, DQ.maxDist)) q.push(`dist=${fmt(Q.maxDist)}`);
  if (Q.stepScale !== DQ.stepScale) q.push(`step=${Q.stepScale === 'auto' ? 'auto' : fmt(Q.stepScale)}`);
  if (!valueEq(Q.jitter, DQ.jitter)) q.push(`jitter=${fmt(Q.jitter)}`);
  if (q.length) clauses.push(['quality', ...q].join(' '));
  const out = outputClause(spec.output);
  if (out) clauses.push(out);
  return clauses.join(opts.multiline || opts.pretty ? '\n' : ' · ');
}

/** A recipe in the pretty form (printRecipe `pretty`), or the text as it is when it doesn't read cleanly. */
export function formatRecipe(src: string): string {
  const r = parseRecipe(src);
  return r.errors.length ? src : printRecipe(r.spec, { pretty: true });
}

/** The words a recipe understands, for the Recipe tab's reference. */
export const RECIPE_VOCABULARY = {
  modes: ['surface', 'volumetric', 'glass', 'gi'],
  combines: ['union', 'smooth-union', 'subtract', 'smooth-subtract', 'intersect', 'smooth-intersect'],
  shapes: SHAPES.map(s => ({ kind: s.kind, keys: s.params.map(p => p.key) })),
  warps: WARPS.map(w => ({ kind: w.kind === 'noise' ? 'warp' : w.kind, keys: [...(w.axes ? [w.axes.key] : []), ...w.params.map(p => p.key), ...(w.select ? [w.select.key] : [])] })),
  settings: ['sun dir=(x,y,z) color=…', 'sky (r,g,b)', 'bounce (r,g,b)', 'shadows 16 | off', 'ao 0.06 | off', 'fog 0.3 color=…', 'background (r,g,b) | top=… bottom=…', `tone ${TONE_MODES.join('|')}`, 'camera dist angle elev orbit zoom flatten x y z', 'quality steps dist step jitter'],
  colours: Object.keys(COLOR_NAMES),
  outputs: OUTPUTS.map(o => o.words[0]),
  palettes: PALETTES.map(p => p.key),
};

/** The words a recipe clause can start with, and the colour names (for type-ahead, lang/complete.ts). */
export const RECIPE_WORDS = {
  modes: MODE_WORDS, ops: OP_WORDS, shapes: SHAPE_WORDS, warps: WARP_WORDS, settings: SETTING_WORDS, colours: COLOR_NAMES,
};
