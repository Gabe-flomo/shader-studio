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
}

// ── Tokens ──────────────────────────────────────────────────────────────────

type Tok =
  | { t: 'sep'; at: number; end: number }
  | { t: 'num'; v: number; unit: 'deg' | 'rad' | null; at: number; end: number }
  | { t: 'word'; v: string; at: number; end: number }
  | { t: 'str'; v: string; at: number; end: number }
  | { t: 'hex'; v: Vec3; at: number; end: number }
  | { t: '(' | ')' | ',' | '=' | '@'; at: number; end: number }
  | { t: 'eof'; at: number; end: number };

/** Does the line starting at `at` go on with the clause above: indented, or starting with a closing bracket? */
export function continuesClause(src: string, at: number): boolean {
  const m = /^([ \t]*)(\S?)/.exec(src.slice(at));
  return !!m && (m[1].length > 0 || m[2] === ')') && m[2] !== '';
}

function tokenize(src: string, errors: RecipeError[], pos: (from: number, to: number, message: string) => RecipeError): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    // Inside brackets, a new line that is indented (or closes the bracket) goes on with the clause:
    // the pretty form puts each shape of a combine on its own line (formatRecipe).
    if (c === '\n' && depth > 0 && continuesClause(src, i + 1)) { i++; continue; }
    if (c === '\n' || c === '·' || c === '•' || c === '|' || c === ';') { out.push({ t: 'sep', at: i, end: i + 1 }); depth = 0; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if ('(),=@'.includes(c)) {
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      out.push({ t: c as '(' | ')' | ',' | '=' | '@', at: i, end: i + 1 }); i++; continue;
    }
    if (c === '"' || c === '\'' || c === '“' || c === '‘') {
      const close = c === '“' ? '”' : c === '‘' ? '’' : c;
      const j = src.indexOf(close, i + 1);
      const end = j < 0 ? src.length : j;
      if (j < 0) errors.push(pos(i, end, 'This quote is never closed.'));
      out.push({ t: 'str', v: src.slice(i + 1, end), at: i, end: Math.min(src.length, end + 1) });
      i = end + 1;
      continue;
    }
    if (c === '#') {
      const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/.exec(src.slice(i));
      if (m) {
        const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1];
        const rgb: Vec3 = [0, 2, 4].map(k => round(parseInt(h.slice(k, k + 2), 16) / 255)) as Vec3;
        out.push({ t: 'hex', v: rgb, at: i, end: i + m[0].length });
        i += m[0].length;
        continue;
      }
    }
    const nm = /^[-+−]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?[ \t]*(deg|°|rad)?/i.exec(src.slice(i));
    if (nm && (/[\d.]/.test(c) || ((c === '-' || c === '+' || c === '−') && /[\d.]/.test(src[i + 1] ?? '')))) {
      const v = parseFloat(nm[0].replace('−', '-'));
      const u = nm[3]?.toLowerCase();
      out.push({ t: 'num', v, unit: u === 'rad' ? 'rad' : u ? 'deg' : null, at: i, end: i + nm[0].length });
      i += nm[0].length;
      continue;
    }
    const wm = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i));
    if (wm) {
      // A trailing '-' belongs to nothing ("box-" while typing): keep it in the word so the error points at it.
      out.push({ t: 'word', v: wm[0], at: i, end: i + wm[0].length });
      i += wm[0].length;
      continue;
    }
    errors.push(pos(i, i + 1, `“${c}” isn't part of a recipe.`));
    i++;
  }
  out.push({ t: 'eof', at: src.length, end: src.length });
  return out;
}

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

type Value = { kind: 'num'; v: number; unit: 'deg' | 'rad' | null } | { kind: 'vec'; v: Vec3 } | { kind: 'word'; v: string } | { kind: 'str'; v: string };
/** `comma`: a `,` followed it inside a warp's brackets (`@move(1, 2, 3)` is one vector). */
type Arg = { key: string | null; value: Value; at: number; end: number; comma?: boolean };

export const round = (n: number) => Math.round(n * 10000) / 10000;

class Parser {
  i = 0;
  errors: RecipeError[] = [];
  warnings: string[] = [];
  toks: Tok[];
  ids = { s: 0, g: 0, w: 0 };
  private src: string;

  constructor(src: string) {
    this.src = src;
    this.toks = tokenize(src, this.errors, (a, b, m) => this.err(a, b, m));
  }

  err(from: number, to: number, message: string): RecipeError {
    const before = this.src.slice(0, from);
    const line = before.split('\n').length;
    const col = from - before.lastIndexOf('\n');
    return { message, from, to: Math.max(to, from + 1), line, col };
  }
  fail(tok: { at: number; end: number }, message: string) { this.errors.push(this.err(tok.at, tok.end, message)); }

  peek(o = 0): Tok { return this.toks[Math.min(this.i + o, this.toks.length - 1)]; }
  next(): Tok { return this.toks[Math.min(this.i++, this.toks.length - 1)]; }
  /** Skip to the end of this clause (after an error). */
  skipClause() { while (this.peek().t !== 'sep' && this.peek().t !== 'eof') this.next(); }
  atEnd(stop: ReadonlyArray<Tok['t']>) { return stop.includes(this.peek().t) || this.peek().t === 'sep' || this.peek().t === 'eof'; }

  value(): Value | null {
    const t = this.peek();
    if (t.t === 'num') { this.next(); return { kind: 'num', v: t.v, unit: t.unit }; }
    if (t.t === 'hex') { this.next(); return { kind: 'vec', v: t.v }; }
    if (t.t === 'str') { this.next(); return { kind: 'str', v: t.v }; }
    if (t.t === 'word') { this.next(); return { kind: 'word', v: t.v }; }
    if (t.t === '(') {
      // A vector: (x, y, z), or (v) / (x, y) filled out.
      const open = this.next();
      const nums: number[] = [];
      while (this.peek().t !== ')' && this.peek().t !== 'eof' && this.peek().t !== 'sep') {
        const n = this.next();
        if (n.t === 'num') nums.push(n.unit === 'rad' ? n.v * 180 / Math.PI : n.v);
        else if (n.t !== ',') { this.fail(n, 'A vector holds numbers: (x, y, z).'); }
      }
      if (this.peek().t === ')') this.next(); else this.fail(open, 'This ( is never closed.');
      if (!nums.length) { this.fail(open, 'An empty vector: write (x, y, z).'); return null; }
      const v: Vec3 = nums.length === 1 ? [nums[0], nums[0], nums[0]] : nums.length === 2 ? [nums[0], nums[1], 0] : [nums[0], nums[1], nums[2]];
      if (nums.length > 3) this.fail(open, 'A vector has three numbers; the rest are left out.');
      return { kind: 'vec', v };
    }
    return null;
  }

  /** Arguments up to the end of the clause, a `,`, `)` or `@`. `commas`: a `,` between arguments is allowed and marked on the one before it. */
  args(stop: ReadonlyArray<Tok['t']> = [',', ')', '@'], commas = false): Arg[] {
    const out: Arg[] = [];
    while (!this.atEnd(stop)) {
      const t = this.peek();
      if (commas && t.t === ',') { this.next(); if (out.length) out[out.length - 1].comma = true; continue; }
      if (t.t === 'word' && this.peek(1).t === '=') {
        this.next(); this.next();
        const v = this.value();
        if (!v) { this.fail(t, `${t.v}= needs a value.`); continue; }
        out.push({ key: t.v, value: v, at: t.at, end: this.toks[this.i - 1].end });
        continue;
      }
      if (t.t === '=') { this.next(); this.fail(t, 'An = with no name before it.'); continue; }
      const v = this.value();
      if (!v) { this.next(); this.fail(t, `Unexpected “${this.src.slice(t.at, t.end)}”.`); continue; }
      out.push({ key: null, value: v, at: t.at, end: this.toks[this.i - 1].end });
    }
    return out;
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
      if (MODE_WORDS[w] && !(w === 'glass' && this.peek(1).t === '=')) {
        this.next();
        if (mode && mode !== MODE_WORDS[w]) this.warnings.push(`Two render modes; ${MODE_WORDS[w]} wins.`);
        mode = MODE_WORDS[w];
        this.modeArgs(spec, mode, this.args([]));
      } else if (OP_WORDS[w] || SHAPE_WORDS[w] || w === 'custom') {
        const it = this.item();
        if (it) items.push(it);
      } else if (WARP_WORDS[w] || w === 'custom-warp') {
        this.next();
        const wp = this.warpBody(WARP_WORDS[w] ?? 'custom', t, true);
        if (wp) sceneWarps.push(wp);
      } else if (SETTING_WORDS.includes(w)) {
        this.next();
        this.setting(spec, w, t, this.args([]));
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
    return { spec, errors: this.errors, warnings: this.warnings };
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
      for (const a of this.args([',', ')', '@'])) {
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
      this.shapeArgs(sh, this.args([',', ')', '@']));
      it = sh;
    }
    while (this.peek().t === '@') {
      const at = this.next();
      const wt = this.peek();
      if (wt.t !== 'word') { this.fail(at, '@ is followed by a warp: @twist(2).'); continue; }
      this.next();
      const kind = WARP_WORDS[wt.v.toLowerCase()] ?? (wt.v.toLowerCase() === 'custom' ? 'custom' : null);
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
    if (this.peek().t === '(') {
      const open = this.next();
      args = this.args([')'], true);
      if (this.peek().t === ')') this.next(); else this.fail(open, 'This ( is never closed.');
    } else {
      args = this.args(top ? [] : [',', ')', '@']);
    }
    // `rotate y 30` (an axis and an angle) is the older Turn; `rotate (30, 0, 45)` turns about all three.
    if (kind === 'rotate' && args.some(a => (!a.key && a.value.kind === 'word' && /^[xyz]$/i.test(a.value.v)) || a.key?.toLowerCase() === 'axis')) kind = 'turn';
    const wp = newWarp(kind, this.wid());
    this.warpArgs(wp, WARP_BY_KIND[kind], args);
    return wp;
  }

  // ── Arguments to things ──

  numberFor(p: ParamDef, a: Arg): number | Vec3 | null {
    const v = a.value;
    const conv = (n: number, unit: 'deg' | 'rad' | null) => (p.deg && unit === 'rad' ? n * 180 / Math.PI : n);
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
          else { this.fail(by ?? t, `${w} by … colours the space: colour by depth palette sunset.`); return; }
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
          this.fail(a, `${w} shows one of ${OUTPUTS.map(x => x.words[0]).join(', ')}${byPalette ? '' : ' (add palette sunset to colour it)'}.${s ? ` Did you mean “${s}”?` : ''}`);
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

export function parseRecipe(src: string): ParseResult {
  return new Parser(src).recipe();
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
  return top ? [w.kind, ...parts].join(' ') : `@${w.kind}(${parts.join(' ')})`;
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
  warps: WARPS.map(w => ({ kind: w.kind, keys: [...(w.axes ? [w.axes.key] : []), ...w.params.map(p => p.key), ...(w.select ? [w.select.key] : [])] })),
  settings: ['sun dir=(x,y,z) color=…', 'sky (r,g,b)', 'bounce (r,g,b)', 'shadows 16 | off', 'ao 0.06 | off', 'fog 0.3 color=…', 'background (r,g,b) | top=… bottom=…', `tone ${TONE_MODES.join('|')}`, 'camera dist angle elev orbit zoom flatten x y z', 'quality steps dist step jitter'],
  colours: Object.keys(COLOR_NAMES),
  outputs: OUTPUTS.map(o => o.words[0]),
  palettes: PALETTES.map(p => p.key),
};

/** The words a recipe clause can start with, and the colour names (for type-ahead, lang/complete.ts). */
export const RECIPE_WORDS = {
  modes: MODE_WORDS, ops: OP_WORDS, shapes: SHAPE_WORDS, warps: WARP_WORDS, settings: SETTING_WORDS, colours: COLOR_NAMES,
};
