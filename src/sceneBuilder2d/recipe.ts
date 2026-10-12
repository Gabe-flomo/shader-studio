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
 *   look       glow · colour by … · tone · background · palette · grade … · vignette · grain
 *   effects    crt … · chroma … · fx displace|swirl|ripple|lens|pixelate|kaleido|blur|glow …  (in order)
 *   output     output distance | mask | space [palette=…]
 *   blocks     space-block ripple-rings amp=0.05 · space-block {uv.x += amp * sin(y * 8 + t)} amp=0.1 times=2
 *              · combine-blocks multiply a=twirl b={uv = abs(uv)} a_amount=3   (space blocks, blocks.ts)
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
import { BUILT_IN_FUNCTIONS, builtInFunction } from './functions';
import { COMBINE_MODES, checkBlock, clampTimes, linesText, parseBlockText, rangeFor, type CombineMode, type SpaceBlock } from './blocks';
import { BLOCK_BY_ID, BLOCK_LIBRARY, blockFromEntry, isLibraryBlock } from './blockLibrary';
import { findSavedBlock, loadSavedBlocks, sceneOpFromSaved } from './savedBlocks';
import { PIECES_MOVES, PIECES_SIZE_BYS, PIECES_VOCABULARY, defaultPieces, printPieces, type PiecesSpec } from './pieces';
import { PIECE_SHAPES } from '../nodes/definitions/pieces';
import { GRID_ASSIGNS, GRID_COLOUR_BYS, GRID_PIC_MODES, GRID_SHAPES, GRID_TARGETS, RIPPLE_FROMS, defaultGrid, printGrid, type GridPicMode, type GridShape, type GridSpec } from './grid';
import type { RecipeError } from '../sceneBuilder/recipe';
import { mutedSuffix, takeMuted } from '../builders/mute';
import { LOOK_STACK_WORDS, parseFxClause, parseGradeClause, parsePaletteClause, printFx, printGrade, printPalette } from '../builders/look/recipe';
import { CUSTOM_PALETTE } from '../builders/look/palette';
import { parseDepthArgs, printDepth } from './depth';
import { TEX_FITS, findTex, newTexUse, texSlug, type TexFit, type TexSource, type TexUse } from '../builders/textures';
import {
  COLOUR_BYS, DEFAULT_COLOR, DEFAULT_LOOK, LOOK_MUTES_2D, MAX_DUP, MAX_LEVELS, MOTIONS, MOTION_BY_KIND, SHAPES, SHAPE_BY_KIND, SHOW_WORDS, SPACES, SPACE_BY_KIND, TONE_MODES,
  defaultSize, defaultSpaceValues, emptyScene, newBlockOp, newCombineOp, newDup, newGroup, newMotion, newShape, newSpaceOp, walkItems,
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
const BUILT_IN_FN_NAMES = { space: BUILT_IN_FUNCTIONS.filter(f => f.role === 'space').map(f => f.name), shape: BUILT_IN_FUNCTIONS.filter(f => f.role === 'shape').map(f => f.name) };
const BLOCK_WORDS = ['space-block', 'combine-blocks', 'texture'];
const LOOK_WORDS = ['depth-picture', 'picture-depth', 'grid', 'glow', 'colour', 'color', 'tone', 'tone-map', 'tonemap', 'background', 'bg', 'bloom', 'vignette', 'grain', 'scanlines', 'output', 'show'];
const CLAUSE_WORDS = [...Object.keys(SHAPE_WORDS), ...Object.keys(OP_WORDS), ...Object.keys(SPACE_WORDS), ...BLOCK_WORDS, ...LOOK_WORDS, ...LOOK_STACK_WORDS];

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
  /** The pictures declared (`texture …`) or named by a use. */
  textures: TexSource[] = [];
  constructor(src: string) { this.src = src; this.c = new Cursor(src); }

  /** A picture's name from a value; the scene gets the source when the recipe never declared it. */
  texName(a: AstArg, what: string): string | null {
    const w = a.value.k === 'word' || a.value.k === 'str' ? a.value.v : null;
    if (!w) { this.fail(a, `${what} is a picture's name (from a texture clause).`); return null; }
    const name = texSlug(w);
    if (!findTex(this.textures, name)) this.textures.push({ name });
    return name;
  }

  /** `texture [name] node=… aspect=… kind=image|shader`: a picture the scene reads. */
  texture(t: { at: number; end: number }, args: AstArg[]) {
    let src: TexSource | null = null;
    const rest: AstArg[] = [];
    for (const a of args) {
      const key = a.key?.toLowerCase() ?? null;
      if (!src && (key === null || key === 'name') && (a.value.k === 'word' || a.value.k === 'str')) { src = { name: texSlug(a.value.v) }; continue; }
      rest.push(a);
    }
    if (!src) { this.fail(t, 'texture needs a name: texture name=brick (then fill=brick on a shape, picture brick, mask=brick or background picture=brick).'); return; }
    for (const a of rest) {
      const key = a.key?.toLowerCase() ?? '';
      if (key === 'node' && (a.value.k === 'word' || a.value.k === 'str')) src.node = a.value.v;
      else if (key === 'aspect') { const n = this.num(a, 'aspect'); if (n !== null && n > 0) src.aspect = n; }
      else if (key === 'kind') { const w = this.word(a); if (w === 'image' || w === 'shader') src.kind = w; else this.fail(a, 'kind is image or shader.'); }
      else this.fail(a, `texture takes a name, node=, aspect= and kind=; not “${a.key ?? this.src.slice(a.at, a.end)}”.`);
    }
    const i = this.textures.findIndex(s => s.name === src!.name);
    if (i >= 0) this.textures[i] = { ...this.textures[i], ...src }; else this.textures.push(src);
  }

  /** fit=, tiles= / zoom=: how a picture use covers its box. */
  texUseKey(key: string, a: AstArg, use: Partial<TexUse>): boolean {
    if (key === 'fit') {
      const w = this.word(a);
      const fit = w === 'fill' ? 'cover' : w === 'fit' ? 'contain' : w;
      if (fit && (TEX_FITS as readonly string[]).includes(fit)) use.fit = fit as TexFit;
      else this.fail(a, `fit is one of ${TEX_FITS.join(', ')}.`);
      return true;
    }
    if (key === 'tiles' || key === 'zoom') { const n = this.num(a, key); if (n !== null) use.scale = Math.max(0.05, n); return true; }
    return false;
  }

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
    // `muted` on any clause: switched off for now (builders/mute.ts).
    const m = takeMuted(given ?? this.c.args([]));
    if (m.muted) op.muted = true;
    for (const a of m.rest) {
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
    const m = takeMuted(raw.args);
    this.itemArgs(it, m.rest);
    if (m.muted) it.muted = true;
    for (const mod of raw.mods) this.modifier(it, mod);
    return it;
  }

  private itemArgs(it: Item, args: AstArg[]) {
    const def = it.type === 'shape' ? SHAPE_BY_KIND[it.kind] : null;
    let pos = 0;
    // Picture settings (docs/scene-builder-2d.md, "Textures"), applied once the item's words are read.
    const use: Partial<TexUse> = {};
    let fillName: string | null = null;
    const mask: { tex?: string; cut?: number; invert?: boolean } = {};
    for (const a of args) {
      const key = a.key?.toLowerCase() ?? null;
      if (a.op !== '=') { this.fail(a, `${a.key}${a.op} changes a value by a factor: in a recipe, write ${a.key}=… .`); continue; }
      if (key === 'fill' || key === 'texture' || key === 'picture') { fillName = this.texName(a, key); continue; }
      if (key && this.texUseKey(key, a, use)) continue;
      if (key === 'mask') { const n = this.texName(a, 'mask'); if (n) mask.tex = n; continue; }
      if (key === 'mask-cut') { const n = this.num(a, 'mask-cut'); if (n !== null) mask.cut = Math.max(0, Math.min(1, n)); continue; }
      if (!key && this.word(a) === 'mask-invert') { mask.invert = true; continue; }
      if (!key && it.type === 'shape' && it.kind === 'picture' && !fillName && (a.value.k === 'word' || a.value.k === 'str')) { fillName = this.texName(a, 'picture'); continue; }
      if (!key) {
        const word = this.word(a);
        if (a.value.k === 'str' && !(it.type === 'shape' && it.kind === 'fnshape' && !it.fn)) { it.name = a.value.v; continue; }
        if (word === 'glow') { it.glow = true; this.flagged = true; continue; }
        if (word === 'outline' || word === 'hollow') { it.hollow = 0.02; continue; }
        if (it.type === 'group') {
          if (a.value.k === 'num') { it.k = Math.max(0, a.value.v); continue; }
          this.fail(a, 'A combine takes k= (its blend radius), name= and the settings every item takes.');
          continue;
        }
        if (it.kind === 'fnshape' && !it.fn && (a.value.k === 'word' || a.value.k === 'str')) {
          const f = builtInFunction(a.value.v);
          if (f && f.role === 'shape') it.fn = { name: f.name, code: f.code, timed: f.timed, from: f.from };
          else this.fail(a, `“${a.value.v}” isn't a built-in shape function (${this.fnNames('shape')}). Functions from your code are picked in the builder.`);
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
      if (key === 'slot') { const v = this.num(a, 'slot'); if (v !== null) it.slot = Math.max(0, Math.round(v) - 1); continue; }
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
    if (fillName) it.fill = newTexUse(fillName, use);
    else if (use.fit || use.scale !== undefined) this.warnings.push('fit= and tiles= are for a picture fill: add fill=… (a picture\'s name).');
    if (mask.tex) it.mask = { tex: mask.tex, cut: mask.cut ?? 0.5, invert: !!mask.invert };
    if (it.type === 'shape' && it.kind === 'picture' && !it.fill) this.warnings.push('A picture layer needs its picture: picture brick (a name from a texture clause).');
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
    const mu = takeMuted(m.args);
    if (mu.muted) mo.muted = true;
    for (const a of mu.rest) {
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
    const mu = takeMuted(m.args);
    if (mu.muted) dup.muted = true;
    for (const a of mu.rest) {
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
      } else if (w === 'pieces') {
        this.c.next();
        const pm = takeMuted(this.c.args([]));
        this.pieces(scene, pm.rest);
        if (pm.muted && scene.pieces) scene.pieces.muted = true;
      } else if (w === 'space-block') {
        this.c.next();
        const m = takeMuted(this.c.args([]));
        const b = this.block(t, m.rest, '');
        if (b) scene.space.push({ ...newBlockOp(`p${++this.ids.p}`, b), ...(m.muted ? { muted: true } : {}) });
      } else if (w === 'combine-blocks') {
        this.c.next();
        const m = takeMuted(this.c.args([]));
        const op = this.combineBlocks(t, m.rest);
        if (op) scene.space.push(m.muted ? { ...op, muted: true } : op);
      } else if (w === 'texture') {
        this.c.next();
        this.texture(t, this.c.args([]));
      } else if (SPACE_WORDS[w] === 'fn') {
        this.c.next();
        const mf = takeMuted(this.c.args([]));
        const args = mf.rest;
        const nm = args.find(a => !a.key);
        const name = nm && (nm.value.k === 'word' || nm.value.k === 'str') ? nm.value.v : '';
        const f = builtInFunction(name);
        if (!f || f.role !== 'space') { this.fail(nm ?? t, `“${name}” isn't a built-in space function (${this.fnNames('space')}). Functions from your code are picked in the builder.`); continue; }
        scene.space.push({ ...newSpaceOp('fn', `p${++this.ids.p}`, { name: f.name, code: f.code, timed: 1, from: f.from }), ...(mf.muted ? { muted: true } : {}) });
      } else if (SPACE_WORDS[w]) {
        this.c.next();
        scene.space.push(this.space(t, SPACE_WORDS[w]));
      } else if (LOOK_STACK_WORDS.includes(w)) {
        this.c.next();
        this.lookStack(scene, w, t, this.c.args([]));
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
    if (this.textures.length) scene.textures = this.textures;
    return { scene, errors: this.errors, warnings: this.warnings };
  }

  /**
   * A block's settings: the library id or `{lines}` (the first bare value), `times=`, `name=`, and
   * its numbers by name. `prefix` (`a_`, `b_`) picks one side of a combine's settings.
   */
  private block(t: { at: number; end: number }, args: AstArg[], prefix: string, source?: AstArg): SpaceBlock | null {
    // `my="Wobble rings"`: one of your saved blocks (savedBlocks.ts). With lines in { } beside it,
    // the lines are used (so the recipe works where that block isn't saved); alone, it is looked up.
    const myArg = prefix ? undefined : args.find(a => a.key?.toLowerCase() === 'my');
    const my = myArg && (myArg.value.k === 'str' || myArg.value.k === 'word') ? myArg.value.v.trim() : '';
    const src = source ?? args.find(a => !a.key);
    let b: SpaceBlock | null = null;
    if (!src && my) {
      const saved = findSavedBlock(my);
      if (!saved?.block) {
        const s = suggest(my, loadSavedBlocks().filter(x => x.block).map(x => x.name));
        this.fail(myArg!, `“${my}” isn't one of your saved blocks on this machine.${s ? ` Did you mean “${s}”?` : ' Write its lines in { } too, so the recipe works anywhere.'}`);
        return null;
      }
      b = sceneOpFromSaved(saved).block!;
    } else if (!src) { this.fail(t, `A block needs a library name (${BLOCK_LIBRARY.slice(0, 4).map(e => e.id).join(', ')}…) or lines in { }.`); return null; }
    const v = src?.value;
    if (!src || !v) { /* a saved block, looked up above */ } else if (v.k === 'code') {
      const r = parseBlockText(v.v);
      for (const e of r.errors) this.fail(src, e);
      if (r.errors.length) return null;
      b = { name: '', lines: r.lines, params: [], times: 1 };
    } else if (v.k === 'word' || v.k === 'str') {
      const e = BLOCK_BY_ID[v.v.toLowerCase()];
      if (!e) { const s = suggest(v.v.toLowerCase(), BLOCK_LIBRARY.map(x => x.id)); this.fail(src, `“${v.v}” isn't a block in the library.${s ? ` Did you mean “${s}”?` : ''}`); return null; }
      b = blockFromEntry(e);
    } else { this.fail(src, 'A block is a library name or lines in { }.'); return null; }
    if (!b) return null;
    if (my && src) { b.my = my; b.name = my; }
    const at = (src ?? myArg)!;
    for (const a of args) {
      if (!a.key || a === src || a === myArg) continue;
      const key = a.key;
      if (prefix && !key.startsWith(prefix)) continue;
      const k = key.slice(prefix.length);
      if (a.op !== '=') { this.fail(a, `${a.key}${a.op}: in a recipe, write ${a.key}=… .`); continue; }
      if (k === 'times') { const n = this.num(a, 'times'); if (n !== null) b.times = clampTimes(n); continue; }
      if (k === 'name') { if (a.value.k === 'str' || a.value.k === 'word') b.name = a.value.v; continue; }
      const n = this.num(a, k);
      if (n === null) continue;
      const p = b.params.find(q => q.name === k);
      if (p) { p.value = n; p.min = Math.min(p.min, n); p.max = Math.max(p.max, n); continue; }
      if (b.lib || (b.my && !src)) { const s = suggest(k, b.params.map(q => q.name)); this.fail(a, `${b.name} has no slider “${k}”.${s ? ` Did you mean “${s}”?` : ` It has ${b.params.map(q => q.name).join(', ') || 'none'}.`}`); continue; }
      b.params.push({ name: k, value: n, ...rangeFor(n) });
    }
    if (!b.lib && !b.name) b.name = prefix ? `Block ${prefix[0].toUpperCase()}` : 'Block';
    const chk = checkBlock(b);
    if (!chk.ok) {
      for (const e of chk.errors) this.fail(at, e);
      chk.lines.forEach((l, i) => { if (!l.ok) this.fail(at, `Line ${i + 1} (${b!.lines[i].target}): ${l.error}`); });
      return null;
    }
    return b;
  }

  /** `combine-blocks add|subtract|multiply|blend a=… b=… [amount=0.5] [a_k=…] [b_k=…]` */
  private combineBlocks(t: { at: number; end: number }, args: AstArg[]): SpaceOp | null {
    let mode: CombineMode = 'add';
    let amount = 0.5;
    const sideA = args.find(a => a.key?.toLowerCase() === 'a');
    const sideB = args.find(a => a.key?.toLowerCase() === 'b');
    for (const a of args) {
      if (a.key) {
        if (a.key.toLowerCase() === 'my') continue;
        if (a.key.toLowerCase() === 'amount') { const n = this.num(a, 'amount'); if (n !== null) amount = Math.max(0, Math.min(1, n)); }
        else if (!/^(a|b|[ab]_\w+)$/i.test(a.key)) this.fail(a, `combine-blocks takes a=, b=, amount= and a_…/b_… for the blocks' sliders; not “${a.key}”.`);
        continue;
      }
      const w = this.word(a);
      const m = COMBINE_MODES.find(x => x.mode === w);
      if (m) mode = m.mode; else this.fail(a, `A combine is one of ${COMBINE_MODES.map(x => x.mode).join(', ')}.`);
    }
    const myArg = args.find(a => a.key?.toLowerCase() === 'my');
    const my = myArg && (myArg.value.k === 'str' || myArg.value.k === 'word') ? myArg.value.v.trim() : '';
    if (my && !sideA && !sideB) {
      // `combine-blocks my="…"`: one of your saved combines.
      const saved = findSavedBlock(my);
      if (!saved?.combine) {
        const s = suggest(my, loadSavedBlocks().filter(x => x.combine).map(x => x.name));
        this.fail(myArg!, `“${my}” isn't one of your saved combines on this machine.${s ? ` Did you mean “${s}”?` : ' Write a= and b= too, so the recipe works anywhere.'}`);
        return null;
      }
      const c = sceneOpFromSaved(saved).combine!;
      const op = newCombineOp(`p${++this.ids.p}`, c.a, c.b, c.mode, c.mode === 'blend' && args.some(a => a.key?.toLowerCase() === 'amount') ? amount : c.amount);
      op.combine!.my = my;
      return op;
    }
    if (!sideA || !sideB) { this.fail(t, 'combine-blocks needs both blocks: a=… and b=… (a library name or lines in { }).'); return null; }
    const A = this.block(sideA, args, 'a_', sideA);
    const B = this.block(sideB, args, 'b_', sideB);
    if (!A || !B) return null;
    const op = newCombineOp(`p${++this.ids.p}`, A, B, mode, amount);
    if (my) op.combine!.my = my;
    return op;
  }

  fnNames(role: 'space' | 'shape') { return BUILT_IN_FN_NAMES[role].join(', '); }

  /** `grid 12 [rows] shape=… assign=… size=… ripple=… freq=… speed=… target=… amount=… by=… color=… color2=… glow=off picture=… picture-mode=cell|mask|matte|piece` */
  private grid(scene: Scene2D, given: AstArg[]) {
    const g = defaultGrid();
    const mu = takeMuted(given);
    const args = mu.rest;
    if (mu.muted) g.muted = true;
    const shapes: GridShape[] = [];
    const ripples: GridSpec['ripples'] = [];
    const pic: { tex?: string; mode?: GridPicMode } = {};
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
        case 'picture': case 'texture': { const n = this.texName(a, key); if (n) pic.tex = n; break; }
        case 'picture-mode': case 'pic-mode': { const v = pick(a, GRID_PIC_MODES, 'picture-mode'); if (v) pic.mode = v; break; }
        default: this.fail(a, `grid has no setting “${a.key}”.`);
      }
    }
    if (shapes.length) g.shapes = shapes;
    if (ripples.length) g.ripples = ripples;
    if (pic.tex) g.pic = { tex: pic.tex, mode: pic.mode ?? 'piece' };
    else if (pic.mode) this.warnings.push('picture-mode= is for a grid with a picture: add picture=… (a picture\'s name).');
    scene.grid = g;
  }

  /** `palette …`, `grade …`, `crt …`, `chroma …`, `fx …`: the Look's palette and grade, the Effects page (builders/look/recipe.ts). */
  private lookStack(scene: Scene2D, w: string, t: { at: number; end: number }, args: AstArg[]) {
    const L = scene.look;
    if (w === 'palette') {
      const p = parsePaletteClause(args, this, t);
      if (!p) return;
      L.colour.palette = p.key;
      L.custom = p.custom;
      L.customName = p.name;
      if (!p.custom) delete L.custom;
      if (!p.name) delete L.customName;
      return;
    }
    if (w === 'grade') {
      const it = parseGradeClause(args, this, t, `gr${(L.grade?.length ?? 0) + 1}`);
      if (it) (L.grade ??= []).push(it);
      return;
    }
    const it = parseFxClause(w === 'effect' ? 'fx' : w, args, this, t, `fx${(scene.effects?.length ?? 0) + 1}`);
    if (it) (scene.effects ??= []).push(it);
  }

  /** `pieces brick count=40 shape=… size=1 colour=flat|piece size-by=… move=… amount=0.35 speed=0.1 swirl=0.8` (pieces.ts) */
  private pieces(scene: Scene2D, args: AstArg[]) {
    let p: PiecesSpec | null = null;
    const rest: AstArg[] = [];
    for (const a of args) {
      if (!a.key && !p) { const n = this.texName(a, 'pieces'); if (n) p = defaultPieces(n); continue; }
      rest.push(a);
    }
    for (const a of rest) {
      const key = a.key?.toLowerCase() ?? '';
      if (key === 'picture' || key === 'texture') { const n = this.texName(a, key); if (n) p = { ...(p ?? defaultPieces(n)), tex: n }; }
    }
    if (!p) { this.warnings.push('pieces needs a picture: pieces brick … (a picture\'s name).'); return; }
    const pick = <T extends string>(a: AstArg, list: readonly T[], what: string): T | null => {
      const w = this.word(a);
      if (w && (list as readonly string[]).includes(w)) return w as T;
      this.fail(a, `${what} is one of ${list.join(', ')}.`);
      return null;
    };
    for (const a of rest) {
      const key = a.key?.toLowerCase() ?? '';
      switch (key) {
        case 'picture': case 'texture': break;
        case 'count': case 'across': { const n = this.num(a, key); if (n !== null) p.count = Math.max(2, Math.round(n)); break; }
        case 'size': case 'amount': case 'speed': case 'swirl': { const n = this.num(a, key); if (n !== null) p[key] = n; break; }
        case 'scatter': case 'seed': case 'dim': { const n = this.num(a, key); if (n !== null) p[key] = n; break; }
        case 'scatter-turn': { const n = this.num(a, key); if (n !== null) p.scatterTurn = n; break; }
        case 'scatter-size': { const n = this.num(a, key); if (n !== null) p.scatterSize = n; break; }
        case 'shape': { const v = pick(a, PIECE_SHAPES, 'A piece\'s shape'); if (v) p.shape = v; break; }
        case 'colour': case 'color': { const v = pick(a, ['flat', 'piece'] as const, key); if (v) p.colour = v; break; }
        case 'size-by': { const v = pick(a, PIECES_SIZE_BYS, 'size-by'); if (v) p.sizeBy = v; break; }
        case 'move': { const v = pick(a, PIECES_MOVES, 'move'); if (v) p.move = v; break; }
        default: this.fail(a, `pieces has no setting “${a.key ?? ''}”.`);
      }
    }
    scene.pieces = p;
  }

  private look(scene: Scene2D, w: string, t: { at: number; end: number }, given: AstArg[]) {
    if (w === 'grid') { this.grid(scene, given); return; }
    if (w === 'depth-picture' || w === 'picture-depth') {
      const d = parseDepthArgs(given, {
        key: a => a.key?.toLowerCase() ?? null, word: a => this.word(a), num: (a, what) => this.num(a, what), vec2: (a, what) => this.vec2(a, what),
        colour: a => this.colour(a), fail: (a, m) => this.fail(a, m),
      }, a => this.texName(a, 'depth-picture'));
      if (!d) { this.fail(t, 'depth-picture needs a picture\'s name: depth-picture pond size look=fog.'); return; }
      scene.depth = d;
      return;
    }
    const L = scene.look;
    // `tone aces muted`, `bloom 0.6 muted`: the effect switched off for now (builders/mute.ts).
    const mu = takeMuted(given);
    const args = mu.rest;
    const effect = w === 'tone-map' || w === 'tonemap' ? 'tone' : w;
    if (mu.muted) {
      if ((LOOK_MUTES_2D as readonly string[]).includes(effect)) L.mute = { ...L.mute, [effect]: true };
      else this.warnings.push(`${w} can't be muted; muted is left out.`);
    }
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
            if (PALETTE_BY_KEY[k] || k === CUSTOM_PALETTE) L.colour.palette = k;
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
        const use: Partial<TexUse> = {};
        let pic: string | null = null;
        let warp = true;
        let coloured = false;
        for (const a of args) {
          const key = a.key?.toLowerCase() ?? null;
          if (key === 'picture' || key === 'texture') { pic = this.texName(a, key); continue; }
          if (key && this.texUseKey(key, a, use)) continue;
          if (!key && this.word(a) === 'still') { warp = false; continue; }
          if (key === 'slot') { const v = this.num(a, 'slot'); if (v !== null) L.bgSlot = Math.max(0, Math.round(v) - 1); coloured = true; continue; }
          if (!key && !coloured) { const c = this.colour(a); if (c) L.bg = c; coloured = true; continue; }
          if (key === 'color' || key === 'colour') { const c = this.colour(a); if (c) L.bg = c; continue; }
          this.fail(a, 'background takes a colour, picture=, fit=, tiles= and still (the picture not bent by the space).');
        }
        if (pic) L.bgTex = { ...newTexUse(pic, use), warp };
        if (!args.length) this.fail(t, 'background takes a colour or picture=.');
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

/** A block's source (`ripple-rings` or `{lines}`) and its settings, with `prefix` on the keys (a combine's sides). */
function printBlock(b: SpaceBlock, prefix = ''): { source: string; keys: string[] } {
  // One of your saved blocks: its name and its lines both, so the recipe still works where it isn't saved.
  const e = b.my && !prefix ? null : isLibraryBlock(b);
  const keys: string[] = [];
  if (e) {
    for (const p of b.params) { const d = e.params.find(q => q.name === p.name); if (!d || !valueEq(d.value, p.value)) keys.push(`${prefix}${p.name}=${fmt(p.value)}`); }
    if (clampTimes(b.times) !== (e.times ?? 1)) keys.push(`${prefix}times=${clampTimes(b.times)}`);
    if (b.name && b.name !== e.name) keys.push(`${prefix}name=${fmtName(b.name)}`);
    return { source: e.id, keys };
  }
  for (const p of b.params) keys.push(`${prefix}${p.name}=${fmt(p.value)}`);
  if (clampTimes(b.times) > 1) keys.push(`${prefix}times=${clampTimes(b.times)}`);
  const auto = prefix ? `Block ${prefix[0].toUpperCase()}` : 'Block';
  if (b.my && !prefix) keys.unshift(`my=${fmtName(b.my)}`);
  if (b.name && b.name !== auto && !(b.my && !prefix && b.name === b.my)) keys.push(`${prefix}name=${fmtName(b.name)}`);
  return { source: `{${linesText(b.lines).replace(/\n/g, '; ')}}`, keys };
}

function printSpace(op: SpaceOp): string {
  return printSpaceBody(op) + mutedSuffix(op);
}

function printSpaceBody(op: SpaceOp): string {
  if (op.kind === 'block' && op.block) {
    const p = printBlock(op.block);
    // A saved block reads `space-block my="Name" {lines} …`.
    return (op.block.my ? ['space-block', p.keys[0], p.source, ...p.keys.slice(1)] : ['space-block', p.source, ...p.keys]).join(' ');
  }
  if (op.kind === 'combine' && op.combine) {
    const k = op.combine, a = printBlock(k.a, 'a_'), b = printBlock(k.b, 'b_');
    return ['combine-blocks', k.mode, ...(k.my ? [`my=${fmtName(k.my)}`] : []), `a=${a.source}`, `b=${b.source}`, ...(k.mode === 'blend' ? [`amount=${fmt(k.amount)}`] : []), ...a.keys, ...b.keys].join(' ');
  }
  if (op.kind === 'fn') return `fn ${fmtName(String(op.values.name ?? 'f'))}`;
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

function printMotion(m: { kind: MotionKind; speed: number; amount: number; phase: number; dir: number; muted?: boolean }): string {
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
  if (m.muted) parts.push('muted');
  return `@${m.kind}(${parts.join(' ')})`;
}

function printRing(d: DupSpec): string {
  const parts = [String(d.count), `r=${fmt(d.radius)}`];
  if (d.inner) parts.push(`inner=(${d.inner.count},${fmt(d.inner.radius)})`);
  if (d.levels > 1) parts.push(`levels=${d.levels}`, `factor=${fmt(d.factor)}`);
  if (d.muted) parts.push('muted');
  return `@ring(${parts.join(' ')})`;
}

/** A picture use's fit and scale, where they differ from the defaults (cover, 1). */
function printUse(u: TexUse): string[] {
  return [...(u.fit !== 'cover' ? [`fit=${u.fit}`] : []), ...(round(u.scale) !== 1 ? [`${u.fit === 'tile' ? 'tiles' : 'zoom'}=${fmt(u.scale)}`] : [])];
}

/** `texture brick node=node_4 aspect=1.5`. */
function printTexture(s: TexSource): string {
  return ['texture', fmtName(s.name), ...(s.node ? [`node=${fmtName(s.node)}`] : []), ...(s.aspect && round(s.aspect) !== 1 ? [`aspect=${fmt(s.aspect)}`] : []), ...(s.kind === 'shader' ? ['kind=shader'] : [])].join(' ');
}

/** An item as recipe text. `indent` (the pretty form): a combine's items each on their own line. */
function printItem(it: Item, indent: string | null = null): string {
  const common: string[] = [];
  const picture = it.type === 'shape' && it.kind === 'picture';
  if (it.fill) common.push(...(picture ? [] : [`fill=${fmtName(it.fill.tex)}`]), ...printUse(it.fill));
  if (it.mask) common.push(`mask=${fmtName(it.mask.tex)}`, ...(round(it.mask.cut) !== 0.5 ? [`mask-cut=${fmt(it.mask.cut)}`] : []), ...(it.mask.invert ? ['mask-invert'] : []));
  if (!same(it.at, [0, 0])) common.push(`at=(${it.at.map(fmt).join(',')})`);
  if (it.rot) common.push(`rot=${fmt(it.rot)}`);
  if (it.scale !== 1) common.push(`scale=${fmt(it.scale)}`);
  if (it.inflate) common.push(`inflate=${fmt(it.inflate)}`);
  if (it.hollow) common.push(`outline=${fmt(it.hollow)}`);
  if (!same(it.color, DEFAULT_COLOR)) common.push(`color=${colourText(it.color)}`);
  if (it.slot != null) common.push(`slot=${it.slot + 1}`);
  if (it.glow) common.push('glow');
  if (it.name) common.push(`name=${fmtName(it.name)}`);
  if (it.muted) common.push('muted');
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
  const parts: string[] = [it.kind === 'fnshape' ? `fn-shape ${fmtName(it.fn?.name ?? 'f')}` : picture && it.fill ? `picture ${fmtName(it.fill.tex)}` : it.kind];
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
  clauses.push(...(scene.textures ?? []).map(printTexture));
  clauses.push(...scene.space.map(printSpace));
  clauses.push(...scene.layers.map(it => printItem(it, ind)));
  if (scene.grid) clauses.push(printGrid(scene.grid, colourText) + mutedSuffix(scene.grid));
  const muted = (k: keyof NonNullable<typeof L.mute>) => (L.mute?.[k] ? ' muted' : '');
  if (scene.pieces) clauses.push(printPieces(scene.pieces, fmtName) + mutedSuffix(scene.pieces));
  // Look.
  if (L.glow.mode !== 'off') {
    const g = ['glow'];
    if (L.glow.mode === 'selected') g.push('selected');
    if (!valueEq(L.glow.amount, D.glow.amount)) g.push(fmt(L.glow.amount));
    if (!valueEq(L.glow.falloff, D.glow.falloff)) g.push(`falloff=${fmt(L.glow.falloff)}`);
    if (L.glow.tint) g.push(`color=${colourText(L.glow.tint)}`);
    clauses.push(g.join(' ') + muted('glow'));
  }
  if (L.colour.by !== 'layer') {
    const c = ['colour', 'by', L.colour.by, `palette=${L.colour.palette}`];
    if (!valueEq(L.colour.scale, D.colour.scale)) c.push(`scale=${fmt(L.colour.scale)}`);
    if (!valueEq(L.colour.speed, D.colour.speed)) c.push(`speed=${fmt(L.colour.speed)}`);
    clauses.push(c.join(' '));
  }
  if (L.tone !== D.tone) clauses.push(`tone ${L.tone}${L.tone !== 'none' ? muted('tone') : ''}`);
  const bgSlot = L.bgSlot != null ? [`slot=${L.bgSlot + 1}`] : [];
  if (L.bgTex) clauses.push(['background', ...(!same(L.bg, D.bg) ? [colourText(L.bg)] : []), ...bgSlot, `picture=${fmtName(L.bgTex.tex)}`, ...printUse(L.bgTex), ...(L.bgTex.warp ? [] : ['still'])].join(' '));
  else if (!same(L.bg, D.bg) || bgSlot.length) clauses.push(['background', ...(!same(L.bg, D.bg) ? [colourText(L.bg)] : []), ...bgSlot].join(' '));
  // The palette: its own clause when the colour-by clause above doesn't already name it.
  const usesPaletteClause = L.colour.palette === CUSTOM_PALETTE || (L.colour.by === 'layer' && L.colour.palette !== D.colour.palette);
  if (usesPaletteClause) clauses.push(printPalette(L.colour.palette, L.custom, L.customName));
  clauses.push(...(L.grade ?? []).map(printGrade));
  // Bloom and Scanlines: only a scene made with them still has them (the Effects page has Glow and CRT mask).
  for (const k of ['bloom', 'vignette', 'grain', 'scanlines'] as const) if (L.post[k] > 0) clauses.push(`${k} ${fmt(L.post[k])}${muted(k)}`);
  clauses.push(...(scene.effects ?? []).map(printFx));
  if (scene.depth) clauses.push(printDepth(scene.depth, { num: fmt, name: fmtName, colour: colourText }));
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
  blocks: [`space-block ${BLOCK_LIBRARY[0].id} amp=0.1`, 'space-block {uv.x += amp * sin(y * 6 + t)} amp=0.1 times=1', `combine-blocks ${COMBINE_MODES.map(m => m.mode).join('|')} a=… b=… amount=0.5 a_k=… b_k=…`],
  combines: ['union', 'smooth-union', 'subtract', 'smooth-subtract', 'intersect', 'smooth-intersect'],
  shapes: SHAPES.map(s => ({ kind: s.kind, keys: s.params.map(p => p.key) })),
  itemKeys: ['at=(x,y)', 'rot=30', 'scale=1.5', 'color=teal', 'inflate=0.02', 'outline=0.02', 'glow', 'name="Sun"', 'fill=brick fit=cover|contain|stretch|tile tiles=3 zoom=1.5', 'mask=brick mask-cut=0.5 mask-invert'],
  textures: ['texture brick node=node_4 aspect=1.5', 'picture brick h=0.6 fit=cover', 'circle r=0.4 fill=brick fit=tile tiles=3', 'background picture=brick fit=cover [still]', `grid 12 picture=brick picture-mode=${GRID_PIC_MODES.join('|')}`],
  depth: ['depth-picture pond [fit=cover] [size | size=(0.4,1.6)] [space=shift|zoom|turn shift=0.15 dir=0 focus=0] [look=top|occlude|fog|mix|light] [with=add|screen|over|tint] [picture=1] [range=(0,1)] [curve=1] [at=0.5 soft=0.05] [fog=1 haze=0.6 fog-color=] [light=3 own=0.5 glow=0.35] [near=picture|scene mix=1] [gradient=sunset gradient-on=scene|picture|both gradient-how=multiply|colorize|add gradient-amount=0.8 cycles=1 phase=0 flow=0.1]'],
  grid: [`grid 12 [rows] shape=${GRID_SHAPES.join('|')} assign=${GRID_ASSIGNS.join('|')} size=0.7 ripple=centre|corners|mouse|(x,y) freq=8 speed=0.4 target=${GRID_TARGETS.join('|')} amount=0.5 by=${GRID_COLOUR_BYS.join('|')} color= color2= glow=off picture=brick picture-mode=${GRID_PIC_MODES.join('|')}`],
  pieces: [PIECES_VOCABULARY],
  motion: ['@orbit(0.3 speed=0.25)', '@bob(0.15 dir=90)', '@spin(0.25)', '@pulse(0.25 speed=0.5)'],
  ring: ['@ring(6 r=0.5)', '@ring(6 r=0.5 inner=(5,0.2))', '@ring(6 r=0.5 levels=3 factor=1.6)'],
  look: ['glow [selected] [amount] falloff= color=', `colour by ${COLOUR_BYS.join('|')} palette= scale= speed=`, `tone ${TONE_MODES.join('|')}`, 'background colour [picture=brick fit= tiles= still]', 'vignette 0.5', 'grain 0.05', 'palette fire | palette #1b1f3b #e94f37 #f6c90e name=Dusk', 'background slot=1 · circle slot=2', 'grade saturation 1.3 · grade levels blacks=0.05', 'output distance|mask|space palette='],
  effects: ['crt mask=aperture size=4 strength=0.8 curve=0.04 vignette=0.35', 'chroma 4 mode=directional angle=30', 'fx displace 0.12 scale=2 · fx displace picture=clouds pixels=24', 'fx pixelate 0.025 · fx kaleido 6 · fx swirl 2 · fx ripple · fx lens 0.2', 'fx blur 4 · fx glow 0.8 threshold=0.6'],
  colours: Object.keys(COLOUR_TABLE),
  palettes: PALETTES.map(p => p.key),
};

export const RECIPE_WORDS_2D = { ops: OP_WORDS, shapes: SHAPE_WORDS, space: SPACE_WORDS, look: LOOK_WORDS, motion: MOTION_WORDS };
