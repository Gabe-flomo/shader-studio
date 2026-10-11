/**
 * recipe.ts — the Look's palette, grade and effects as recipe words, both ways (docs/builder-look.md,
 * "Recipe"), shared by the scene builders' recipes:
 *
 *   palette fire                                   a library palette
 *   palette #1b1f3b #e94f37 #f6c90e name="Dusk"     the scene's own colours (2–8)
 *   grade saturation 1.3 · grade levels blacks=0.05 · grade hue 40 off
 *   crt mask=aperture size=4 strength=0.7 curve=0.05 · chroma amount=6 mode=directional angle=30
 *   fx pixelate 0.03 · fx displace picture=clouds pixels=40 · fx glow 1.2 threshold=0.5
 *
 * A stack's clauses are printed and read in the stack's order. A setting is printed only when it
 * differs from its default; the primary one bare (`grade saturation 1.3`). `off` keeps a card that
 * is switched off.
 */
import type { Arg as AstArg, Span } from '../../lang/ast';
import { colourText } from '../../lang/colours';
import { suggest } from '../../lang/fuzzy';
import { fmt } from '../../sceneBuilder/recipe';
import { PALETTE_BY_KEY, PALETTES } from '../../sceneBuilder/output';
import { CUSTOM_PALETTE, MAX_SWATCHES, type Vec3 } from './palette';
import { newStackItem, stackValue, type LookParam, type StackItem, type StackKindDef } from './stack';
import { GRADE_BY_KIND, GRADE_WORDS } from './grade';
import { FX_BY_KIND, FX_WORDS } from './effects';

/** What a builder's parser lends the shared readers. */
export interface ArgReader {
  fail(s: Span, message: string): void;
  num(a: AstArg, what: string): number | null;
  colour(a: AstArg): Vec3 | null;
  word(a: AstArg): string | null;
  /** A picture's name (the recipe's textures). */
  texName?(a: AstArg, what: string): string | null;
}

/** The clause words this file reads. */
export const LOOK_STACK_WORDS = ['palette', 'grade', 'fx', 'effect', 'crt', 'chroma'];

const same3 = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Math.round(x * 1e4) === Math.round(b[i] * 1e4));
const vecText = (v: readonly number[]) => `(${v.map(fmt).join(',')})`;
const nameText = (s: string) => (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) ? s : `"${s.replace(/"/g, '\'')}"`);

function paramFor(def: StackKindDef, key: string): LookParam | undefined {
  const k = key.toLowerCase();
  return def.params.find(p => p.key.toLowerCase() === k || (p.aliases ?? []).includes(k));
}

/** One setting's value from an argument (true when it was taken). */
function setParam(it: StackItem, p: LookParam, a: AstArg, r: ArgReader): void {
  if (p.type === 'num') {
    const v = r.num(a, p.label.toLowerCase());
    if (v === null) return;
    const deg = p.deg && a.value.k === 'num' && a.value.unit === 'rad' ? v * 180 / Math.PI : v;
    it.params[p.key] = p.integer ? Math.round(deg) : deg;
  } else if (p.type === 'select') {
    const w = r.word(a);
    const o = p.options?.find(x => x.value === w || x.label.toLowerCase().startsWith(w ?? '\u0000'));
    if (o) it.params[p.key] = o.value;
    else r.fail(a, `${p.key} is one of ${(p.options ?? []).map(x => x.value).join(', ')}.`);
  } else if (p.type === 'colour') {
    const c = r.colour(a);
    if (c) it.params[p.key] = c;
  } else {
    const v = a.value;
    if (v.k === 'vec' && v.v.length >= 3) it.params[p.key] = [v.v[0], v.v[1], v.v[2]];
    else if (v.k === 'num') it.params[p.key] = [v.v, v.v, v.v];
    else r.fail(a, `${p.key} is (r, g, b) or one number for all three.`);
  }
}

/**
 * A stack item from a clause's arguments: `kind` (a word of `words`), then settings by name, the
 * primary one bare, a bare option word (`aperture`), `picture=…` and `off`.
 */
export function parseStackItem(defs: Record<string, StackKindDef>, kind: string, args: AstArg[], r: ArgReader, at: Span, id: string, what: string): StackItem {
  const def = defs[kind];
  const it = newStackItem(def, id);
  let primaryDone = false;
  for (const a of args) {
    const key = a.key?.toLowerCase() ?? null;
    if (key === 'picture' || key === 'texture' || key === 'by-picture') {
      if (!def.picture) { r.fail(a, `${def.label} doesn't read a picture.`); continue; }
      const name = r.texName ? r.texName(a, 'picture') : r.word(a);
      if (name) { it.tex = name; const by = def.params.find(p => p.key === 'by'); if (by) it.params.by = 'picture'; }
      continue;
    }
    if (key) {
      const p = paramFor(def, key);
      if (p) setParam(it, p, a, r);
      else {
        const s = suggest(key, def.params.flatMap(q => [q.key, ...(q.aliases ?? [])]));
        r.fail(a, `${def.label} has no setting “${a.key}”: ${def.params.map(q => q.key).join(', ')}${def.picture ? ', picture' : ''}.${s ? ` Did you mean “${s}”?` : ''}`);
      }
      continue;
    }
    const w = r.word(a);
    if (w === 'off' || w === 'no' || w === 'muted') { it.on = false; continue; }
    if (w === 'on') { it.on = true; continue; }
    if (a.value.k === 'num' && !primaryDone) {
      const p = def.params.find(q => q.primary) ?? def.params.find(q => q.type === 'num');
      if (p) { setParam(it, p, a, r); primaryDone = true; continue; }
    }
    if (w) {
      const p = def.params.find(q => q.type === 'select' && q.options?.some(o => o.value === w));
      if (p) { it.params[p.key] = w; continue; }
    }
    r.fail(a, `${what} ${def.words[0]} takes ${def.params.map(q => `${q.key}=`).join(' ')}${def.picture ? ' picture=' : ''} and off.`);
  }
  void at;
  return it;
}

/** An item's settings as recipe text: what differs from the defaults, the primary one bare and first. */
export function printStackArgs(it: StackItem, def: StackKindDef): string[] {
  const out: string[] = [];
  const rest: string[] = [];
  // Every setting that differs, shown or not (a hidden one is kept for when it shows again).
  for (const p of def.params) {
    const v = stackValue(it, p);
    const d = p.def;
    if (p.type === 'num') {
      if (Math.round((v as number) * 1e4) === Math.round((d as number) * 1e4)) continue;
      if (p.primary && !out.length) out.push(fmt(v as number)); else rest.push(`${p.key}=${fmt(v as number)}`);
    } else if (p.type === 'select') {
      if (v !== d) rest.push(`${p.key}=${v}`);
    } else if (!same3(v as Vec3, d as Vec3)) rest.push(`${p.key}=${p.type === 'colour' ? colourText(v as Vec3) : vecText(v as Vec3)}`);
  }
  if (def.picture && it.tex) {
    const i = rest.findIndex(x => x.startsWith('by='));
    if (i >= 0) rest.splice(i, 1);
    rest.unshift(`picture=${nameText(it.tex)}`);
  }
  return [...out, ...rest, ...(it.on ? [] : ['off'])];
}

// ── Grade ──

export function parseGradeClause(args: AstArg[], r: ArgReader, at: Span, id: string): StackItem | null {
  const first = args[0];
  const w = first && !first.key ? r.word(first) : null;
  const kind = w ? GRADE_WORDS[w] : undefined;
  if (!kind) {
    const s = w ? suggest(w, Object.keys(GRADE_WORDS)) : null;
    r.fail(first ?? at, `grade is one of ${Object.values(GRADE_BY_KIND).map(d => d.words[0]).join(', ')}.${s ? ` Did you mean “${s}”?` : ''}`);
    return null;
  }
  return parseStackItem(GRADE_BY_KIND, kind, args.slice(1), r, at, id, 'grade');
}

export const printGrade = (it: StackItem): string => ['grade', GRADE_BY_KIND[it.kind].words[0], ...printStackArgs(it, GRADE_BY_KIND[it.kind])].join(' ');

// ── Effects ──

/** An effects clause: `crt …`, `chroma …`, or `fx <kind> …` (also `effect <kind>`). */
export function parseFxClause(head: string, args: AstArg[], r: ArgReader, at: Span, id: string): StackItem | null {
  if (head === 'crt' || head === 'chroma') return parseStackItem(FX_BY_KIND, head, args, r, at, id, '');
  const first = args[0];
  const w = first && !first.key ? r.word(first) : null;
  const kind = w ? FX_WORDS[w] : undefined;
  if (!kind) {
    const s = w ? suggest(w, Object.keys(FX_WORDS)) : null;
    r.fail(first ?? at, `fx is one of ${Object.values(FX_BY_KIND).map(d => d.words[0]).join(', ')}.${s ? ` Did you mean “${s}”?` : ''}`);
    return null;
  }
  return parseStackItem(FX_BY_KIND, kind, args.slice(1), r, at, id, 'fx');
}

export function printFx(it: StackItem): string {
  const def = FX_BY_KIND[it.kind];
  const head = it.kind === 'crt' || it.kind === 'chroma' ? [it.kind] : ['fx', def.words[0]];
  return [...head, ...printStackArgs(it, def)].join(' ');
}

// ── Palette ──

export interface PaletteClause { key: string; custom: Vec3[] | null; name: string | null }

/** `palette fire` or `palette #111 #f80 … name="…"`. */
export function parsePaletteClause(args: AstArg[], r: ArgReader, at: Span): PaletteClause | null {
  const cols: Vec3[] = [];
  let key: string | null = null;
  let name: string | null = null;
  for (const a of args) {
    const k = a.key?.toLowerCase() ?? null;
    if (k === 'name') { name = a.value.k === 'str' || a.value.k === 'word' ? a.value.v : null; continue; }
    if (k) { r.fail(a, 'palette takes a palette\'s name (fire, ice…) or its colours, and name="…".'); continue; }
    const w = r.word(a);
    if (w && PALETTE_BY_KEY[w] && !cols.length) { key = w; continue; }
    if (w === CUSTOM_PALETTE) continue;
    const c = r.colour(a);
    if (c) cols.push(c);
  }
  if (cols.length) {
    if (cols.length < 2) { r.fail(at, 'A palette of your own needs at least two colours.'); return null; }
    if (cols.length > MAX_SWATCHES) r.fail(at, `A palette holds up to ${MAX_SWATCHES} colours: the rest are left out.`);
    return { key: CUSTOM_PALETTE, custom: cols.slice(0, MAX_SWATCHES), name };
  }
  if (!key) { r.fail(at, `palette is one of ${PALETTES.map(p => p.key).join(', ')}, or colours of your own.`); return null; }
  return { key, custom: null, name: null };
}

export function printPalette(key: string, custom: readonly Vec3[] | null | undefined, name?: string | null): string {
  if (key === CUSTOM_PALETTE && custom?.length) return ['palette', ...custom.map(c => colourText(c)), ...(name ? [`name=${nameText(name)}`] : [])].join(' ');
  return `palette ${key}`;
}
