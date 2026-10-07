/**
 * picture.ts — the 2D picture and edit dialects of the Playfield language, the Do… bar's own
 * (docs/playfield-language-plan.md §4.1, §4.6, §3.9, §5).
 *
 *   circle r=0.3 · glow falloff=8 · colour by length
 *   noise · warp 0.6 · colour by it · output
 *   the hexagon · glow falloff=12 color=pink · the picture · tone-map
 *   connect noise → glow.tint · insert tone-map between palette and output · set glow falloff=8
 *   it * circle · noise + it · mix(palette, glow) by=0.3 · union(circle, box) · group(circle, glow) name="Neon"
 *
 * Three things live here:
 *  - parsePicture: canonical text → clauses (with "did you mean" at line and column);
 *  - desugarPicture: clauses → a Do… bar sentence the bar's own readers run (doCommands.ts
 *    execCommand). This is the plan's "first version reuses the executors" (§8.4): canonical and
 *    sugar go through the same clause executors, so they can't drift;
 *  - canonicalOf: a sugar sentence → its canonical line (shown under the bar), built from the same
 *    readers the bar uses (doBar.ts readPhrase, doCommands.ts classify, doRefs.ts readRef).
 *
 * Edit verbs leave "the" out of their slots (§13 decision 2): `set glow falloff=8`. A clause that
 * is only a reference keeps it (`the hexagon · glow`): there "the" says "the one that is there", and
 * a bare `hexagon` makes a new one.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { Cursor } from '../parse';
import type { Arg, Diagnostic, Ref, Value } from '../ast';
import type { Tok as LexTok } from '../lex';
import { colourOf, colourText } from '../colours';
import { fmtNum, printArg, printRef, printValue } from '../print';
import { suggest } from '../fuzzy';
import { drawFrom, freshSeed, makeRng, resolveRandom, seedOf, type Resolved, type Rng } from '../random';
import { ACTION_HEAD, entriesFor, lookupHead, paramOf, type Entry, type ParamSpec } from '../registry';
import { ACTIONS, PARAMS, PLACES, SHAPES, TARGETS, numberOf } from '../vocabulary';
import { RELATIVE_STEP, RELATIVE_WORDS } from '../commands';
import { OUTPUT_WORDS, PALETTES, PALETTE_BY_KEY } from '../../sceneBuilder/output';
import { moveById } from '../../suggestions/moves';
import { readPhrase, type PhraseItem } from '../../suggestions/doBar';
import { classify, clausesOf } from '../../suggestions/doCommands';
import { lex as sugarLex, readRef, typeByName, untok, type RefEnv, type Tok } from '../../suggestions/doRefs';
import { matchTaught } from '../../suggestions/taught';
import { readOutputPhrase } from '../../suggestions/doOutputs';
import { gridRulesParams, readGridRules } from '../../suggestions/doBarGridRules';
import { printGrid } from './grid';

// ── Clauses ───────────────────────────────────────────────────────────────

export type PClause =
  | { t: 'maker'; entry: Entry; head: string; args: Arg[]; at: number; end: number }
  | { t: 'step'; entry: Entry; head: string; args: Arg[]; at: number; end: number }
  | { t: 'colour'; driver: string | Ref; palette?: string; at: number; end: number }
  | { t: 'ref'; ref: Ref; at: number; end: number }
  | { t: 'expr'; left: Ref; ops: Array<{ op: '+' | '-' | '*' | '/'; right: Ref | number }>; at: number; end: number }
  | { t: 'call'; op: string; items: Ref[]; args: Arg[]; at: number; end: number }
  | { t: 'create'; name: string; args: Arg[]; at: number; end: number }
  | { t: 'connect' | 'reconnect'; from: Ref; to: Ref; at: number; end: number }
  | { t: 'disconnect'; what: Ref; from?: Ref; at: number; end: number }
  | { t: 'insert'; name: string; where: 'between' | 'after' | 'before'; a: Ref; b?: Ref; at: number; end: number }
  | { t: 'output'; what?: Ref; show?: string; at: number; end: number }
  | { t: 'switch'; what: Ref; to: string; at: number; end: number }
  | { t: 'delete' | 'duplicate' | 'select'; what: Ref; at: number; end: number }
  | { t: 'rename'; what: Ref; name: string; at: number; end: number }
  | { t: 'set'; what: Ref; args: Arg[]; at: number; end: number };

export interface PictureParse {
  clauses: PClause[];
  errors: Diagnostic[];
  hints: Diagnostic[];
  resolved: Resolved[];
  seed?: number;
}

const CALLS = new Set(['union', 'subtract', 'intersect', 'smooth-union', 'smooth-subtract', 'smooth-intersect', 'mix', 'screen', 'overlay', 'group', 'add', 'cut', 'minus', 'both', 'merge', 'blend', 'combine', 'difference', 'intersection']);
const CALL_CANON: Record<string, string> = { add: 'union', combine: 'union', merge: 'union', cut: 'subtract', minus: 'subtract', difference: 'subtract', both: 'intersect', intersection: 'intersect', blend: 'smooth-union' };
const VERBS = new Set(['create', 'connect', 'reconnect', 'disconnect', 'insert', 'output', 'switch', 'delete', 'duplicate', 'select', 'rename', 'set']);
/** 2D drivers of `colour by`; 3D output words (depth, normal…) make a scene output instead. */
export const DRIVERS = ['length', 'angle', 'x', 'y', 'time', 'noise'] as const;

/** Is a word a node-name slug (create, insert, switch): `tone-map`, `fractal-noise`, `voronoi`. */
const nameWords = (slug: string) => slug.replace(/-/g, ' ');

// ── Reading canonical text ────────────────────────────────────────────────

export function parsePicture(src: string, opts: { seed?: number } = {}): PictureParse {
  const c = new Cursor(src);
  const clauses: PClause[] = [];
  const resolved: Resolved[] = [];
  let seed: number | null = (() => { const m = /(?:^|[\s·;|])seed\s*=?\s*([A-Za-z0-9_-]+)/i.exec(src); return m ? seedOf(m[1]) : null; })();
  let rngCache: Rng | null = null;
  const rng = () => { if (!rngCache) { if (seed === null) seed = opts.seed ?? freshSeed(); rngCache = makeRng(seed); } return rngCache; };
  let randomAll = false;
  const end = () => c.toks[Math.max(0, c.i - 1)].end;
  const refOrFail = (what: string): Ref | null => {
    const r = c.ref({ and: true });
    if (!r) c.error(c.peek(), `${what}: name a node (it, this, glow, "Halo", circle#2, glow.tint…).`);
    return r;
  };
  /** A node name after create / insert / switch: one word, hyphenated (tone-map). */
  const nodeName = (what: string): string | null => {
    const t = c.peek();
    if (t.t !== 'word') { c.error(t, `${what}: a node or shape name (circle, noise, tone-map…).`); return null; }
    c.next();
    return t.v.toLowerCase();
  };
  /** `random` values in a clause's settings, drawn now (§13 randomness). */
  const resolveArgs = (entry: Entry, args: Arg[]): Arg[] => {
    let pos = 0;
    const positional = entry.params.filter(p => p.type === 'number' || p.type === 'count' || p.type === 'colour' || p.type === 'choice' || p.type === 'place');
    return args.map(a => {
      const p = a.key ? paramOf(entry, a.key) : positional[pos++];
      if (a.value.k !== 'random') return a;
      const v = resolveRandom(a.value, p?.rand, rng());
      if (!v) { c.error(a, `There is nothing to draw ${a.key ?? entry.words[0]} from: give it a range, random(0.2..2).`); return a; }
      resolved.push({ key: `${entry.words[0]}.${p?.key ?? a.key ?? '?'}`, from: c.text(a).replace(/^[\w-]+=/, ''), to: printValue(v), at: a.at, end: a.end });
      return { ...a, value: v };
    });
  };
  /** A leading `random`: every setting the clause leaves unset, drawn. */
  const drawUnset = (entry: Entry, args: Arg[], at: { at: number; end: number }): Arg[] => {
    const out = [...args];
    const positional = args.filter(a => !a.key).length;
    entry.params.forEach((p: ParamSpec, i) => {
      if (!p.rand || args.some(a => a.key && paramOf(entry, a.key) === p)) return;
      if (p.primary && positional > 0) return;
      if (i < positional && (p.type === 'number' || p.type === 'count')) return;
      // A place is drawn only for shapes after the first (the first stays in the middle).
      if (p.type === 'place' && !clauses.some(x => x.t === 'maker')) return;
      const v = drawFrom(p.rand, rng());
      resolved.push({ key: `${entry.words[0]}.${p.key}`, from: 'random', to: printValue(v), at: at.at, end: at.end });
      out.push({ key: p.key, op: '=', value: v, at: at.at, end: at.end });
    });
    return out;
  };

  while (c.peek().t !== 'eof') {
    if (c.peek().t === 'sep') { c.next(); continue; }
    const t = c.peek();
    const at = t.at;
    if (t.t === 'word') {
      const w = t.v.toLowerCase();
      const nxt = c.peek(1);
      if (w === 'random' && nxt.t !== '(' && nxt.t !== '=') { c.next(); randomAll = true; continue; }
      if (w === 'seed') { c.next(); if (c.peek().t === '=') c.next(); c.next(); continue; }
      // An expression: a reference and an operator.
      const exprStart = (): boolean => {
        const save = c.i;
        const r = c.ref();
        const ok = !!r && c.peek().t === 'op';
        c.i = save;
        return ok;
      };
      if (exprStart()) {
        const left = c.ref()!;
        const ops: Array<{ op: '+' | '-' | '*' | '/'; right: Ref | number }> = [];
        while (c.peek().t === 'op') {
          const op = (c.next() as Extract<LexTok, { t: 'op' }>).v;
          const n = c.peek();
          if (n.t === 'num') { c.next(); ops.push({ op, right: n.v }); continue; }
          const r = refOrFail(`After ${op}`);
          if (!r) break;
          ops.push({ op, right: r });
        }
        clauses.push({ t: 'expr', left, ops, at, end: end() });
      } else if (CALLS.has(w) && nxt.t === '(') {
        c.next(); c.next();
        const items: Ref[] = [];
        while (c.peek().t !== ')' && !c.atClauseEnd()) {
          if (c.peek().t === ',') { c.next(); continue; }
          const r = c.ref();
          if (!r) { c.error(c.peek(), `Inside ${w}( ) go the nodes it joins (circle, box, it…): make new shapes first, then join them.`); while (![',', ')', 'sep', 'eof'].includes(c.peek().t)) c.next(); continue; }
          items.push(r);
        }
        if (c.peek().t === ')') c.next(); else c.error(t, 'This ( is never closed.');
        const args = c.args([]);
        if (CALL_CANON[w]) c.hint(t, `“${w}( )”: write ${CALL_CANON[w]}( ).`, [CALL_CANON[w]]);
        if (items.length < 2 && w !== 'group') c.error(t, `${w}( ) joins two nodes: ${w}(circle, box).`);
        clauses.push({ t: 'call', op: CALL_CANON[w] ?? w, items, args, at, end: end() });
      } else if ((w === 'colour' || w === 'color' || w === 'palette') && nxt.t === 'word' && nxt.v.toLowerCase() === 'by') {
        c.next(); c.next();
        const d = c.peek();
        let driver: string | Ref | null = null;
        if (d.t === 'word' && ((DRIVERS as readonly string[]).includes(d.v.toLowerCase()) || OUTPUT_WORDS[d.v.toLowerCase()]) && !(c.peek(1).t === '.' )) { c.next(); driver = d.v.toLowerCase(); }
        else if (d.t === 'word' && d.v.toLowerCase() === 'random') {
          c.next();
          driver = rng().pick(['length', 'length', 'angle', 'x', 'y', 'time']);
          resolved.push({ key: 'colour.by', from: 'random', to: driver, at: d.at, end: d.end });
        } else driver = c.ref();
        if (!driver) { c.error(d, `colour by what? ${DRIVERS.join(', ')} or a node.`); c.skipClause(); continue; }
        let palette: string | undefined;
        for (const a of c.args([])) {
          const key = a.key?.toLowerCase() ?? (a.value.k === 'word' && a.value.v.toLowerCase() === 'palette' ? null : 'palette');
          if (key === null) continue;
          if (key !== 'palette') { c.error(a, 'colour by takes palette=.'); continue; }
          let v = a.value;
          if (v.k === 'random') { const r = resolveRandom(v, { kind: 'choice', options: PALETTES.filter(p => p.kind === 'palette').map(p => p.key) }, rng()); if (r) { resolved.push({ key: 'colour.palette', from: c.text(a).replace(/^palette=/, ''), to: printValue(r), at: a.at, end: a.end }); v = r; } }
          const name = v.k === 'word' ? v.v.toLowerCase() : '';
          if (PALETTE_BY_KEY[name]) palette = name;
          else { const s = suggest(name, PALETTES.map(p => p.key)); c.error(a, `“${name}” isn't a palette: ${PALETTES.map(p => p.key).join(', ')}.${s ? ` Did you mean “${s}”?` : ''}`); }
        }
        if (randomAll && !palette) {
          palette = rng().pick(PALETTES.filter(p => p.kind === 'palette').map(p => p.key));
          resolved.push({ key: 'colour.palette', from: 'random', to: palette, at, end: end() });
        }
        clauses.push({ t: 'colour', driver, ...(palette ? { palette } : {}), at, end: end() });
      } else if (VERBS.has(w) && !(w === 'output' && nxt.t === 'sep')) {
        c.next();
        const verbClause = (): PClause | null => {
          switch (w) {
            case 'create': {
              const name = nodeName('create'); if (!name) return null;
              return { t: 'create', name, args: c.args([]), at, end: end() };
            }
            case 'connect': case 'reconnect': {
              const from = refOrFail(w); if (!from) return null;
              if (c.peek().t === 'arrow' || c.isWord('to')) c.next(); else { c.error(c.peek(), `${w} A → B.`); return null; }
              const to = refOrFail(`${w} … →`); if (!to) return null;
              return { t: w, from, to, at, end: end() };
            }
            case 'disconnect': {
              const what = refOrFail('disconnect'); if (!what) return null;
              let from: Ref | undefined;
              if (c.takeWord('from')) from = refOrFail('from') ?? undefined;
              return { t: 'disconnect', what, ...(from ? { from } : {}), at, end: end() };
            }
            case 'insert': {
              const name = nodeName('insert'); if (!name) return null;
              const how = c.takeWord('between', 'after', 'before');
              if (!how) { c.error(c.peek(), 'insert <node> between A and B, after A or before A.'); return null; }
              const where = how.v.toLowerCase() as 'between';
              if (where === 'between') {
                const a = c.ref(); if (!a) { refOrFail('between'); return null; }
                if (!c.takeWord('and')) { c.error(c.peek(), 'between A and B.'); return null; }
                const b = refOrFail('and'); if (!b) return null;
                return { t: 'insert', name, where, a, b, at, end: end() };
              }
              const a = refOrFail(where); if (!a) return null;
              return { t: 'insert', name, where, a, at, end: end() };
            }
            case 'output': {
              const n = c.peek();
              if (n.t === 'word' && OUTPUT_WORDS[n.v.toLowerCase()] && !['colour', 'color'].includes(n.v.toLowerCase())) { c.next(); return { t: 'output', show: n.v.toLowerCase(), at, end: end() }; }
              if (c.atClauseEnd()) return { t: 'output', at, end: end() };
              const what = refOrFail('output'); if (!what) return null;
              return { t: 'output', what, at, end: end() };
            }
            case 'switch': {
              const what = refOrFail('switch'); if (!what) return null;
              if (!c.takeWord('to')) { c.error(c.peek(), 'switch A to <type>.'); return null; }
              const to = nodeName('switch … to'); if (!to) return null;
              return { t: 'switch', what, to, at, end: end() };
            }
            case 'delete': case 'duplicate': case 'select': {
              const what = refOrFail(w); if (!what) return null;
              return { t: w, what, at, end: end() };
            }
            case 'rename': {
              const what = refOrFail('rename'); if (!what) return null;
              const s = c.next();
              if (s.t !== 'str' && s.t !== 'word') { c.error(s, 'rename A "New name".'); return null; }
              return { t: 'rename', what, name: s.v, at, end: end() };
            }
            case 'set': {
              const what = refOrFail('set'); if (!what) return null;
              const args = c.args([]);
              if (!args.length || args.some(a => !a.key)) { c.error(args.find(a => !a.key) ?? c.peek(), 'set A key=value (or key*=1.25, key+=0.1…).'); return null; }
              return { t: 'set', what, args, at, end: end() };
            }
          }
          return null;
        };
        const cl = verbClause();
        if (cl) clauses.push(cl); else c.skipClause();
      } else if (w === 'output' && nxt.t === 'sep') {
        c.next(); clauses.push({ t: 'output', at, end: end() });
      } else if (w === 'the' || w === 'it' || w === 'this' || w === 'these') {
        const r = c.ref({ and: true });
        if (!r) { c.error(t, 'A reference: the circle, it, this, these, the picture.'); c.skipClause(); continue; }
        clauses.push({ t: 'ref', ref: r, at, end: end() });
      } else {
        const hit = lookupHead(w, 'picture', ['maker', 'step']);
        if (!hit) {
          const s = suggest(w, entriesFor('picture').filter(e => e.kind === 'maker' || e.kind === 'step').map(e => e.words[0]).concat([...VERBS]));
          c.error(t, `“${t.v}” isn't a shape, a step or a verb.${s ? ` Did you mean “${s}”?` : ''}`, s ? [s] : undefined);
          c.skipClause();
          continue;
        }
        c.next();
        if (hit.how === 'alias' && hit.entry.words[0] !== w && ACTION_HEAD[hit.entry.id.replace(/^picture:/, '')] && w === 'trails') c.hint(t, '“trails”: the step is called fade.', ['fade']);
        let args = resolveArgs(hit.entry, c.args([]));
        if (randomAll) args = drawUnset(hit.entry, args, t);
        for (const a of args) {
          if (a.key && !paramOf(hit.entry, a.key)) {
            const s = suggest(a.key, hit.entry.params.map(p => p.key));
            c.error(a, `${hit.entry.words[0]} has no setting “${a.key}”.${s ? ` Did you mean “${s}”?` : hit.entry.params.length ? ` It takes ${hit.entry.params.map(p => p.key).join(', ')}.` : ''}`);
          }
        }
        clauses.push({ t: hit.entry.kind === 'maker' ? 'maker' : 'step', entry: hit.entry, head: hit.entry.words[0], args, at, end: end() } as PClause);
      }
      if (!c.atClauseEnd()) { c.error(c.peek(), `Unexpected “${c.text(c.peek())}”: separate clauses with · or a new line.`); c.skipClause(); }
      continue;
    }
    if (t.t === 'str') { const r = c.ref(); if (r) clauses.push({ t: 'ref', ref: r, at, end: end() }); continue; }
    c.error(t, 'A clause starts with a word: a shape, a step, a verb or a reference.');
    c.skipClause();
  }
  return { clauses, errors: c.errors, hints: c.diagnostics.filter(d => d.severity === 'hint'), resolved, ...(seed !== null && (resolved.length || randomAll) ? { seed } : {}) };
}

// ── Printing canonical text ───────────────────────────────────────────────

const refText = (r: Ref) => printRef(r);

export function printClause(cl: PClause): string {
  switch (cl.t) {
    case 'maker': case 'step': return [cl.head, ...cl.args.map(printArg)].join(' ');
    case 'colour': return [`colour by ${typeof cl.driver === 'string' ? cl.driver : cl.driver.r === 'type' ? printRef(cl.driver, { the: true }) : refText(cl.driver)}`, ...(cl.palette ? [`palette=${cl.palette}`] : [])].join(' ');
    case 'ref': return printRef(cl.ref, { the: true });
    case 'expr': return [refText(cl.left), ...cl.ops.flatMap(o => [o.op, typeof o.right === 'number' ? fmtNum(o.right) : refText(o.right)])].join(' ');
    case 'call': return [`${cl.op}(${cl.items.map(refText).join(', ')})`, ...cl.args.map(printArg)].join(' ');
    case 'create': return [`create ${cl.name}`, ...cl.args.map(printArg)].join(' ');
    case 'connect': case 'reconnect': return `${cl.t} ${refText(cl.from)} → ${refText(cl.to)}`;
    case 'disconnect': return `disconnect ${refText(cl.what)}${cl.from ? ` from ${refText(cl.from)}` : ''}`;
    case 'insert': return `insert ${cl.name} ${cl.where} ${refText(cl.a)}${cl.b ? ` and ${refText(cl.b)}` : ''}`;
    case 'output': return cl.show ? `output ${cl.show}` : cl.what ? `output ${refText(cl.what)}` : 'output';
    case 'switch': return `switch ${refText(cl.what)} to ${cl.to}`;
    case 'delete': case 'duplicate': case 'select': return `${cl.t} ${refText(cl.what)}`;
    case 'rename': return `rename ${refText(cl.what)} "${cl.name}"`;
    case 'set': return [`set ${refText(cl.what)}`, ...cl.args.map(printArg)].join(' ');
  }
}

export const printPicture = (clauses: PClause[]) => clauses.map(printClause).join(' · ');

// ── Canonical → the bar's sentence ────────────────────────────────────────

const ORD = ['first', 'second', 'third', 'fourth', 'fifth'];

/** A reference in the bar's words. */
export function sugarRef(r: Ref): string {
  switch (r.r) {
    case 'it': case 'this': case 'these': return r.r;
    case 'picture': return 'the current output';
    case 'scene': return 'the scene';
    case 'label': return `"${r.label}"`;
    case 'type': {
      const name = nameWords(r.word);
      const base = r.ord === undefined ? `the ${name}` : r.ord < 0 ? `the last ${name}` : r.ord >= 1 && r.ord <= 5 ? `the ${ORD[r.ord - 1]} ${name}` : `${name} ${r.ord}`;
      return r.socket ? `the ${nameWords(r.socket)} of ${base}` : base;
    }
    case 'before': case 'after': return `the node ${r.r} ${sugarRef(r.of)}`;
    case 'all': return `all ${nameWords(r.word)}${r.word.endsWith('s') ? '' : 's'}`;
    case 'and': return r.refs.map(sugarRef).join(' and ');
  }
}

/** A value as the bar reads it. */
function sugarValue(v: Value): string | null {
  switch (v.k) {
    case 'num': return v.unit === 'deg' ? `${fmtNum(v.v)} degrees` : fmtNum(v.unit === '%' ? v.v / 100 : v.v);
    case 'colour': return colourText(v.v).startsWith('(') ? `#${v.v.map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}` : colourText(v.v);
    case 'vec': return v.v.length === 3 ? `#${v.v.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('')}` : null;
    case 'word': return v.v;
    case 'str': return `"${v.v}"`;
    default: return null;
  }
}

/** The bar's words for a step's head. */
const STEP_WORDS: Record<string, string> = {
  'smooth-union': 'blend', mask: 'mask', 'polar-repeat': 'repeat', 'zoom-rotate': 'zoom', custom: 'custom code', mix: 'mix with', 'tone-map': 'tone map',
  'blend-mode': 'blend mode', 'soft-edge': 'soften', 'grow-mask': 'dilate', 'mix-two': 'mix two pictures', blur: 'blur', fade: 'trails',
};

/** PARAMS slot word for a setting key (the bar fills slots by these words). */
const SLOT_WORD = (key: string): string | null => {
  const k = key.toLowerCase();
  if (k === 'width') return 'width';
  for (const [, words] of Object.entries(PARAMS)) if (words.includes(k)) return k;
  return null;
};

class Unsugarable extends Error {}

/** A maker or step clause as a phrase (with its target words, if any). */
function sugarHead(cl: Extract<PClause, { t: 'maker' | 'step' }>, target: string | null): string {
  const e = cl.entry;
  const parts: string[] = [];
  if (cl.t === 'maker') {
    // A node that isn't a shape (noise, voronoi) is made by name.
    parts.push(e.id.startsWith('picture:shape:') ? cl.head : `create a ${cl.head === 'noise' ? 'fractal noise' : cl.head}`);
    for (const a of cl.args) {
      const p = a.key ? paramOf(e, a.key) : e.params.find(x => x.primary);
      if (!p) throw new Unsugarable(`${cl.head} has no setting ${a.key}`);
      if (p.key === 'at') {
        const w = a.value.k === 'word' ? a.value.v.toLowerCase().replace(/-/g, ' ') : '';
        if (!PLACES[w]) throw new Unsugarable('at= takes a place: middle, top-left, bottom-right…');
        parts.push(`at the ${w}`);
      } else if (p.key === 'r') { const v = sugarValue(a.value); if (v === null) throw new Unsugarable('r'); parts.push(`radius ${v}`); }
      else if (p.type === 'colour') { const v = sugarValue(a.value); if (v === null) throw new Unsugarable('colour'); parts.push(v); }
      else { const v = sugarValue(a.value); if (v === null) throw new Unsugarable(p.key); parts.push(`${p.key} ${v}`); }
    }
    return parts.join(' ');
  }
  const actionId = e.id.replace(/^picture:/, '');
  const word = STEP_WORDS[cl.head] ?? ACTIONS.find(a => a.id === actionId)?.words[0] ?? cl.head;
  parts.push(word);
  if (target) parts.push(target);
  const move = e.move ? moveById(e.move) : undefined;
  const specs = move?.args ?? [];
  const positional: Array<number | null> = [];
  const extra: string[] = [];
  const numberSpecs = specs.filter(s => s.kind === 'number' || s.kind === 'count');
  let pos = 0;
  for (const a of cl.args) {
    const p = a.key ? paramOf(e, a.key) : e.params.find(x => x.primary) ?? e.params[pos];
    if (!a.key) pos++;
    if (!p) throw new Unsugarable(`${cl.head} has no setting ${a.key}`);
    if (p.type === 'colour') { const v = sugarValue(a.value); if (!v) throw new Unsugarable('colour'); extra.push(v); continue; }
    if (p.type === 'choice') {
      const v = a.value.k === 'word' ? a.value.v.toLowerCase() : '';
      if (p.key === 'axis') extra.push(v === 'both' ? 'both' : v === 'y' ? 'vertically' : '');
      else if (p.key === 'shape') extra.push(v);
      else if (p.key === 'mode') extra.push(v);
      continue;
    }
    if (a.value.k !== 'num') throw new Unsugarable(`${p.key} is a number`);
    const value = a.value.unit === 'deg' && p.key === 'angle' && !(a.key && SLOT_WORD(a.key)) ? a.value.v * Math.PI / 180 : a.value.v;
    // Named slots the bar reads by word; the rest by position, in the move's own order.
    const argName = p.aliases?.[0] ?? p.key;
    const idx = numberSpecs.findIndex(s => s.name === argName || s.name === p.key);
    // A slot word reaches its setting only when the bar's slot table leads there.
    const word = a.key ? SLOT_WORD(a.key) : null;
    const slotKey = word ? Object.entries(PARAMS).find(([, ws]) => ws.includes(word))?.[0] : undefined;
    const reaches = !!slotKey && (SLOT_FOR[slotKey] ?? []).find(nm => specs.some(sp => sp.name === nm)) === (numberSpecs[idx]?.name ?? argName);
    if (word && reaches && !(cl.head === 'polar-repeat' || cl.head === 'repeat')) { extra.push(`${word} ${fmtNum(value)}${a.value.unit === 'deg' && p.key === 'angle' ? ' degrees' : ''}`); continue; }
    if (idx < 0) throw new Unsugarable(`${p.key}`);
    positional[idx] = value;
  }
  // Fill the numbers before the last one given with their defaults, so each lands on its own setting.
  const last = positional.length - 1;
  for (let i = 0; i <= last; i++) {
    const v = positional[i] ?? (numberSpecs[i].default as number);
    parts.push(fmtNum(v));
  }
  if (cl.head === 'polar-repeat') parts.push('around');
  parts.push(...extra.filter(Boolean));
  return parts.join(' ');
}

/**
 * A canonical line as the bar's sentence (run by execCommand). Throws (with the message) for a
 * clause the bar has no words for.
 */
export function desugarPicture(clauses: PClause[]): string {
  const out: string[] = [];
  for (let i = 0; i < clauses.length; i++) {
    const cl = clauses[i];
    switch (cl.t) {
      // A reference after a new shape (the picture, the hexagon) needs the shape made first: each clause on its own ("create a …").
      case 'maker': {
        const s = sugarHead(cl, null);
        out.push(`${!s.startsWith('create ') && clauses.slice(i + 1).some(x => x.t === 'ref' && (x.ref.r === 'type' || x.ref.r === 'label' || x.ref.r === 'picture')) ? 'create a ' : ''}${s}`);
        break;
      }
      case 'step': out.push(sugarHead(cl, null)); break;
      case 'ref': {
        const next = clauses[i + 1];
        const r = cl.ref;
        const target = r.r === 'picture' ? 'the picture' : r.r === 'these' ? 'these' : r.r === 'this' || r.r === 'it' ? 'it' : sugarRef(r);
        if (next?.t === 'step') { out.push(sugarHead(next, target)); i++; break; }
        if (next?.t === 'colour') { out.push(colourSugar(next, sugarRef(r))); i++; break; }
        out.push(`select ${sugarRef(r)}`);
        break;
      }
      case 'colour': out.push(colourSugar(cl, 'it')); break;
      case 'expr': {
        let left = sugarRef(cl.left);
        cl.ops.forEach((o, k) => {
          const right = typeof o.right === 'number' ? fmtNum(o.right) : sugarRef(o.right);
          const base = k === 0 ? left : 'it';
          out.push(o.op === '*' ? `multiply ${base} by ${right}` : o.op === '/' ? `divide ${base} by ${right}` : o.op === '+' ? `add ${right} to ${base}` : `subtract ${right} from ${base}`);
          left = 'it';
        });
        break;
      }
      case 'call': {
        const [a, b] = cl.items.map(sugarRef);
        const by = cl.args.find(x => x.key === 'by' || (!x.key && x.value.k === 'num'));
        const name = cl.args.find(x => x.key === 'name');
        switch (cl.op) {
          case 'union': out.push(`union ${a} with ${b}`); break;
          case 'smooth-union': out.push(`blend ${a} with ${b}`); break;
          case 'intersect': out.push(`intersect ${a} with ${b}`); break;
          case 'subtract': out.push(`cut ${b} from ${a}`); break;
          case 'mix': out.push(`mix ${a} with ${b}${by && by.value.k === 'num' ? ` by ${fmtNum(by.value.v)}` : ''}`); break;
          case 'screen': out.push(`screen ${b} over ${a}`); break;
          case 'overlay': out.push(`overlay ${b} over ${a}`); break;
          case 'group': out.push(`group ${cl.items.map(sugarRef).join(' and ')}${name && (name.value.k === 'str' || name.value.k === 'word') ? ` as "${name.value.v}"` : ''}`); break;
          default: throw new Unsugarable(`${cl.op}( ) has no Do… bar form yet`);
        }
        break;
      }
      case 'create': {
        const sh = SHAPES.find(s => s.words[0] === cl.name || s.words.includes(nameWords(cl.name)));
        const args = cl.args.map(a => (a.key ? `${nameWords(a.key)} ${sugarValue(a.value) ?? ''}` : sugarValue(a.value) ?? '')).join(' ');
        out.push(`create a ${sh ? sh.words[0] : nameWords(cl.name)}${args ? ` ${args}` : ''}`);
        break;
      }
      case 'connect': case 'reconnect': out.push(`${cl.t} ${sugarRef(cl.from)} to ${sugarRef(cl.to)}`); break;
      case 'disconnect': out.push(`disconnect ${sugarRef(cl.what)}${cl.from ? ` from ${sugarRef(cl.from)}` : ''}`); break;
      case 'insert': out.push(`insert a ${nameWords(cl.name)} ${cl.where} ${sugarRef(cl.a)}${cl.b ? ` and ${sugarRef(cl.b)}` : ''}`); break;
      case 'output': out.push(cl.show ? `output the ${cl.show}` : `output ${cl.what ? sugarRef(cl.what) : 'it'}`); break;
      case 'switch': out.push(`switch ${sugarRef(cl.what)} to ${nameWords(cl.to)}`); break;
      case 'delete': case 'duplicate': case 'select': out.push(`${cl.t} ${sugarRef(cl.what)}`); break;
      case 'rename': out.push(`rename ${sugarRef(cl.what)} to "${cl.name}"`); break;
      case 'set': {
        const what = sugarRef(cl.what);
        for (const a of cl.args) out.push(setSugar(what, a));
        break;
      }
    }
  }
  return out.join(', then ');
}

/** `colour by <driver> [palette=]` on a value. */
function colourSugar(cl: Extract<PClause, { t: 'colour' }>, what: string): string {
  const pal = cl.palette ? `${cl.palette} palette` : 'palette';
  if (typeof cl.driver === 'string') {
    if (OUTPUT_WORDS[cl.driver] && !(DRIVERS as readonly string[]).includes(cl.driver)) return `colour by ${cl.driver}${cl.palette ? ` palette ${cl.palette}` : ''}`;
    const d = cl.driver === 'length' ? 'the length of the space' : cl.driver === 'angle' ? 'the angle' : cl.driver === 'x' || cl.driver === 'y' ? `the ${cl.driver} of the space` : cl.driver;
    return `colour ${what} with a ${pal} by ${d}`;
  }
  if (cl.driver.r === 'it') return `colour ${what} with a ${pal}`;
  return `colour ${what} with a ${pal} by ${sugarRef(cl.driver)}`;
}

const ROLE_KEYS: Record<string, 'size' | 'intensity' | 'speed' | 'softness' | 'count'> = { size: 'size', intensity: 'intensity', brightness: 'intensity', speed: 'speed', softness: 'softness', count: 'count' };

/** `set X key=value` and the relative forms, as the bar says them. */
function setSugar(what: string, a: Arg): string {
  const key = nameWords(a.key!);
  const v = a.value;
  if (a.op === '=') {
    const s = sugarValue(v);
    if (s === null) throw new Unsugarable(`${a.key}=${printValue(v)}`);
    // `size=` is the node's own size (the bar's "set the circle to 0.25").
    return a.key === 'size' ? `set ${what} to ${s}` : `set the ${key} of ${what} to ${s}`;
  }
  if (v.k !== 'num') throw new Unsugarable(`${a.key}${a.op} takes a number`);
  const role = ROLE_KEYS[a.key!.toLowerCase()];
  const f = v.v;
  if (role && (a.op === '*=' || a.op === '/=')) {
    const up = (a.op === '*=') === (f >= 1);
    const step = a.op === '*=' ? (f >= 1 ? f : 1 / f) : (f >= 1 ? f : 1 / f);
    const word = Object.entries(RELATIVE_WORDS).find(([, r]) => r.role === role && r.dir === (up ? 1 : -1))?.[0];
    const how = Math.abs(step - RELATIVE_STEP.much) < 1e-6 ? 'much ' : Math.abs(step - RELATIVE_STEP.bit) < 1e-6 ? 'a bit ' : Math.abs(step - RELATIVE_STEP.normal) < 1e-6 ? '' : null;
    if (word && how !== null) return `make ${what} ${how}${word}`;
  }
  if (role && (a.op === '+=' || a.op === '-=')) {
    const word = Object.entries(RELATIVE_WORDS).find(([, r]) => r.role === role && r.dir === (a.op === '+=' ? 1 : -1))?.[0];
    if (word) return `make ${what} ${word} by ${fmtNum(f)}`;
  }
  if (a.op === '+=') return `increase the ${key} of ${what} by ${fmtNum(f)}`;
  if (a.op === '-=') return `decrease the ${key} of ${what} by ${fmtNum(f)}`;
  if (a.op === '*=' && f === 2) return `double the ${key} of ${what}`;
  if ((a.op === '*=' && f === 0.5) || (a.op === '/=' && f === 2)) return `halve the ${key} of ${what}`;
  if (a.op === '*=' && f === 3) return `triple the ${key} of ${what}`;
  if (a.op === '*=' && Math.abs(f - RELATIVE_STEP.normal) < 1e-6) return `increase the ${key} of ${what}`;
  if (a.op === '/=' && Math.abs(f - RELATIVE_STEP.normal) < 1e-6) return `decrease the ${key} of ${what}`;
  throw new Unsugarable(`${a.key}${a.op}${fmtNum(f)}: write the value (${a.key}=…), or ×2, ×0.5, ×3, ×1.25`);
}

/** The bar's sentence for canonical text, or why there isn't one. */
export function toSentence(clauses: PClause[]): { sentence: string } | { error: string } {
  try { return { sentence: desugarPicture(clauses) }; } catch (e) {
    if (e instanceof Unsugarable) return { error: e.message };
    throw e;
  }
}

// ── The bar's sentence → canonical ────────────────────────────────────────

const PLACE_TEXT = (at: [number, number]): string | null => {
  const hit = Object.entries(PLACES).find(([w, p]) => p[0] === at[0] && p[1] === at[1] && !w.startsWith('the '));
  if (!hit) return null;
  const w = hit[0];
  return w === 'center' || w === 'centre' ? 'middle' : w.replace(/ /g, '-');
};

/** The bar's slot words → the move settings they fill, in order (doBar.ts fillArgs). */
const SLOT_FOR: Record<string, string[]> = {
  falloff: ['falloff'], count: ['count'], amount: ['amount', 'smoothness', 'thickness', 'falloff', 'count'], thickness: ['thickness', 'width', 'amount'],
  smoothness: ['smoothness', 'amount'], radius: ['amount', 'thickness'], speed: ['speed'], angle: ['angle'], zoom: ['zoom'],
};

/** Canonical clauses of a build phrase (the phrase language's items). Null: nothing to say. */
function phraseCanon(words: string[], target: string | null): string[] | null {
  const { items } = readPhrase(words);
  if (!items.some(it => it.t === 'shape' || it.t === 'action')) return null;
  type G = { head: Extract<PhraseItem, { t: 'shape' | 'action' }>; target?: string; slots: Array<{ slot: string; value: number }>; numbers: number[]; colours: string[]; place?: string };
  const groups: G[] = [];
  let pending: string | undefined;
  const pre: PhraseItem[] = [];
  const degrees = words.some(w => w === 'degrees' || w === 'deg');
  const absorb = (g: G, it: PhraseItem) => {
    if (it.t === 'slot') g.slots.push({ slot: it.slot, value: it.value });
    else if (it.t === 'number') g.numbers.push(it.value);
    else if (it.t === 'colour') g.colours.push(colourText(it.rgb));
    else if (it.t === 'place') { const p = PLACE_TEXT(it.at); g.place = p ? `at=${p}` : `at=(${it.at.map(fmtNum).join(',')})`; }
    else if (it.t === 'target') g.target = it.target;
  };
  for (const it of items) {
    if (it.t === 'shape' || it.t === 'action') {
      const g: G = { head: it, target: pending, slots: [], numbers: [], colours: [] };
      pending = undefined;
      groups.push(g);
      for (const p of pre.splice(0)) absorb(g, p);
      continue;
    }
    if (it.t === 'target') {
      const g = groups[groups.length - 1];
      if (g && g.head.t === 'action' && !g.target) g.target = it.target; else pending = it.target;
      continue;
    }
    const g = groups[groups.length - 1];
    if (g) absorb(g, it); else pre.push(it);
  }
  // "create a ring with falloff 0.3": a falloff on a shape (no action) is the glow's (doCommands.ts execBuild).
  if (!groups.some(g => g.head.t === 'action')) {
    const sh = groups.find(g => g.slots.some(s => s.slot === 'falloff'));
    if (sh) {
      const f = sh.slots.filter(s => s.slot === 'falloff');
      sh.slots = sh.slots.filter(s => s.slot !== 'falloff');
      const glow = ACTIONS.find(a => a.id === 'glow')!;
      groups.splice(groups.indexOf(sh) + 1, 0, { head: { t: 'action', action: glow, id: 'glow', text: 'glow' }, slots: f, numbers: [], colours: [] });
    }
  }
  const out: string[] = [];
  groups.forEach((g, gi) => {
    if (g.head.t === 'shape') {
      const parts = [g.head.shape.words[0]];
      const size = g.slots.find(s => s.slot === 'radius')?.value ?? g.numbers[0];
      if (size !== undefined) parts.push(`r=${fmtNum(size)}`);
      if (g.colours[0]) parts.push(`color=${g.colours[0]}`);
      if (g.place) parts.push(g.place);
      out.push(parts.join(' '));
      return;
    }
    const id = g.head.id;
    const head = ACTION_HEAD[id] ?? id;
    const entry = lookupHead(head, 'picture', ['step'])?.entry;
    const move = entry?.move ? moveById(entry.move) : moveById(id);
    const specs = move?.args ?? [];
    const parts: string[] = [];
    const used = new Set<string>();
    for (const s of g.slots) {
      const name = (SLOT_FOR[s.slot] ?? [s.slot]).find(nm => specs.some(a => a.name === nm) && !used.has(nm));
      if (!name) continue;
      used.add(name);
      const key = entry ? (entry.params.find(p => p.key === name || p.aliases?.includes(name))?.key ?? name) : name;
      parts.push(`${key}=${fmtNum(s.slot === 'angle' && degrees ? s.value : s.value)}${s.slot === 'angle' && degrees ? 'deg' : ''}`);
    }
    const free = specs.filter(a => (a.kind === 'number' || a.kind === 'count') && !used.has(a.name));
    // Bare numbers fill the free number settings in order; the first is written bare.
    g.numbers.slice(0, free.length).forEach((v, k) => {
      const a = free[k];
      const key = entry?.params.find(p => p.key === a.name || p.aliases?.includes(a.name));
      if (k === 0 && key?.primary) parts.unshift(fmtNum(v));
      else parts.push(`${key?.key ?? a.name}=${fmtNum(v)}`);
    });
    if (g.colours[0] && specs.some(a => a.kind === 'colour')) parts.push(`color=${g.colours[0]}`);
    if (id === 'mirror') { if (words.includes('both')) parts.push('axis=both'); else if (words.some(w => w === 'vertical' || w === 'vertically' || w === 'y')) parts.push('axis=y'); }
    if (id === 'blend') { const sh = words.find(w => /box|square|circle/.test(w)); if (sh) parts.push(`shape=${/box|square/.test(sh) ? 'box' : 'circle'}`); }
    if (id === 'blend-with') { const m = words.find(w => ['screen', 'multiply', 'overlay', 'add', 'difference', 'softlight'].includes(w)); if (m) parts.push(`mode=${m}`); }
    const tg = g.target ?? (gi === 0 ? target : null);
    if (tg === 'picture') out.push('the picture');
    else if (tg === 'pair') out.push('these');
    else if (tg === 'selection' && gi > 0) out.push('this');
    else if (tg && tg !== 'selection' && tg !== 'space') out.push(tg);
    out.push([head, ...parts].join(' '));
  });
  return out;
}

/** A reference's tokens as canonical text (no "the"; `the picture` for the current output). */
export function canonRef(toks: Tok[]): string | null {
  const ws = toks.map(t => (t.q ? `"${t.w}"` : t.w));
  const s = ws.join(' ').replace(/'s$/, '');
  if (!toks.length) return null;
  if (toks[0].q || (toks[0].w === 'the' && toks[1]?.q)) return `"${(toks[0].q ? toks[0] : toks[1]).w}"`;
  const joined = toks.filter(t => !t.q).map(t => t.w).join(' ');
  if (['it', 'that', 'the result', 'the last one', 'the new one', 'the previous one', 'the result of that', 'the last result', 'the new node'].includes(joined)) return 'it';
  if (['this', 'this node', 'the selected node', 'the selection'].includes(joined)) return 'this';
  if (['these', 'them', 'those', 'both', 'the selected nodes', 'these nodes', 'both of them', 'the two'].includes(joined)) return 'these';
  if (['the current output', 'what the output shows', 'what feeds the output', 'whats on the output', 'what is on the output', 'the picture', 'the image', 'what is shown', 'current output'].includes(joined)) return 'picture';
  let w = toks.map(t => t.w);
  if (w[0] === 'the') w = w.slice(1);
  if ((w[0] === 'node' || w[0] === 'one') && (w[1] === 'before' || w[1] === 'after')) {
    const inner = canonRef(toks.slice(toks.findIndex(t => t.w === w[1]) + 1));
    return inner ? `${w[1]} ${inner}` : null;
  }
  if (w[0] === 'all' || w[0] === 'every' || w[0] === 'each') { const rest = w.slice(1).filter(x => x !== 'the' && x !== 'nodes'); return rest.length ? `all ${rest.join('-')}` : null; }
  let ord: string | null = null;
  const ORDS: Record<string, string> = { first: '1', '1st': '1', second: '2', '2nd': '2', third: '3', '3rd': '3', fourth: '4', '4th': '4', fifth: '5', '5th': '5', last: 'last' };
  if (ORDS[w[0]] && w.length > 1) { ord = ORDS[w[0]]; w = w.slice(1); }
  if (w[w.length - 1] === 'node') w = w.slice(0, -1);
  if (w.length > 1 && /^\d+$/.test(w[w.length - 1])) { ord = w[w.length - 1]; w = w.slice(0, -1); }
  if (!w.length || w.some(x => !/^[a-z0-9-]+$/.test(x))) return s ? null : null;
  return `${w.join('-')}${ord ? `#${ord}` : ''}`;
}

/** Split tokens at the first of `words` (outside quotes). */
const at = (toks: Tok[], words: string[], from = 0) => toks.findIndex((t, k) => k >= from && !t.q && words.includes(t.w));

/** The span of the reference that starts the tokens (by the bar's own reader). */
function refSpan(toks: Tok[], i: number, env: RefEnv): number {
  const r = readRef(toks, i, env);
  return Math.max(1, r.used);
}

/** "the tint of the glow", "the glow's tint", "the glow tint" → glow.tint (null: not a socket form). */
function socketRef(toks: Tok[], env: RefEnv): string | null {
  const of = at(toks, ['of']);
  const poss = toks.findIndex(t => t.poss);
  const words = (ts: Tok[]) => ts.map(t => t.w).filter(w => w !== 'the' && w !== 'input').join('-');
  if (of >= 0) { const r = canonRef(toks.slice(of + 1)); const s = words(toks.slice(0, of)); return r && s ? `${r}.${s}` : null; }
  if (poss >= 0) { const r = canonRef(toks.slice(0, poss)); const s = words(toks.slice(poss + 1)); return r && s ? `${r}.${s}` : null; }
  const used = refSpan(toks, 0, env);
  const r = canonRef(toks.slice(0, used));
  const rest = words(toks.slice(used));
  return r ? (rest ? `${r}.${rest}` : r) : null;
}

const cleanName = (ws: string[]) => ws.filter(w => !['a', 'an', 'the', 'new', 'some', 'one', 'node'].includes(w)).join('-');

/** One edit clause as canonical text, or null when it has none. */
function clauseCanon(env: RefEnv, verb: string, word: string | undefined, rest: Tok[]): string[] | null {
  const ref = (ts: Tok[]) => canonRef(ts);
  switch (verb) {
    case 'create': {
      const words = rest.map(t => t.w);
      const p = phraseCanon(words, null);
      const shapeFirst = words.find(w => !['a', 'an', 'the', 'new', 'some'].includes(w));
      if (p && SHAPES.some(s => s.words.includes(shapeFirst ?? ''))) return p;
      const name = cleanName(words.filter(w => numberOf(w) === null));
      return name ? [`create ${name}`] : null;
    }
    case 'connect': case 'reconnect': {
      const k = at(rest, ['to', 'into', 'onto', 'with']);
      if (k < 0) return null;
      const a = ref(rest.slice(0, k)), b = socketRef(rest.slice(k + 1), env);
      return a && b ? [`${verb} ${a} → ${b}`] : null;
    }
    case 'disconnect': {
      const from = at(rest, ['from']);
      const of = at(rest, ['of']);
      if (of >= 0 || rest.some(t => t.poss)) { const s = socketRef(rest, env); return s ? [`disconnect ${s}`] : null; }
      const a = ref(from >= 0 ? rest.slice(0, from) : rest);
      const b = from >= 0 ? ref(rest.slice(from + 1)) : null;
      return a && (from < 0 || b) ? [`disconnect ${a}${b ? ` from ${b}` : ''}`] : null;
    }
    case 'insert': {
      const k = at(rest, ['between', 'after', 'before']);
      if (k < 0) return null;
      const name = cleanName(rest.slice(0, k).map(t => t.w));
      const how = rest[k].w;
      const tail = rest.slice(k + 1);
      if (how === 'between') {
        const and = at(tail, ['and']);
        const a = ref(tail.slice(0, and)), b = ref(tail.slice(and + 1));
        return a && b ? [`insert ${name} between ${a} and ${b}`] : null;
      }
      const a = ref(tail);
      return a ? [`insert ${name} ${how} ${a}`] : null;
    }
    case 'combine': {
      const w = word!;
      const seps = w === 'add' ? ['to', 'with', 'and', 'onto'] : w === 'subtract' || w === 'cut' ? ['from', 'and', 'with'] : w === 'screen' || w === 'overlay' ? ['over', 'onto', 'on', 'with', 'and'] : ['by', 'with', 'and', 'into'];
      const k = at(rest, seps);
      if (k < 0) return null;
      const sep = rest[k].w;
      let right = rest.slice(k + 1);
      let amount: number | null = null;
      const byAt = at(right, ['by']);
      if ((w === 'mix' || w === 'blend') && byAt >= 0 && numberOf(right[byAt + 1]?.w ?? '') !== null) { amount = numberOf(right[byAt + 1].w); right = right.slice(0, byAt); }
      const a = ref(rest.slice(0, k));
      const lit = right.filter(t => !['the', 'a', 'an'].includes(t.w));
      const litNum = lit.length === 1 ? numberOf(lit[0].w) : null;
      const b = litNum !== null ? fmtNum(litNum) : lit.length === 1 && colourOf(lit[0].w) ? null : ref(right);
      if (!a || !b) return null;
      const swap = (w === 'add' && (sep === 'to' || sep === 'onto')) || ((w === 'subtract' || w === 'cut') && sep === 'from') || ((w === 'screen' || w === 'overlay') && ['over', 'onto', 'on'].includes(sep));
      const [base, other] = swap ? [b, a] : [a, b];
      if (w === 'multiply' || w === 'times') return [`${base} * ${other}`];
      if (w === 'divide') return [`${base} / ${other}`];
      if (w === 'add') return [`${base} + ${other}`];
      if (w === 'subtract') return [`${base} - ${other}`];
      if (litNum !== null) return null;
      if (w === 'mix') return [`mix(${base}, ${other})${amount !== null ? ` by=${fmtNum(amount)}` : ''}`];
      if (w === 'blend') return [`smooth-union(${base}, ${other})`];
      if (w === 'screen' || w === 'overlay') return [`${w}(${base}, ${other})`];
      if (w === 'union' || w === 'merge') return [`union(${base}, ${other})`];
      if (w === 'intersect') return [`intersect(${base}, ${other})`];
      if (w === 'cut') return [`subtract(${base}, ${other})`];
      return null;
    }
    case 'output': {
      const r = ref(rest.filter(t => !(t.w === 'to' || t.w === 'on')));
      return r ? [r === 'it' ? 'output' : `output ${r}`] : null;
    }
    case 'replace': {
      const k = at(rest, ['with', 'to', 'into', 'for', 'by']);
      if (k < 0) return null;
      const a = ref(rest.slice(0, k));
      const name = cleanName(rest.slice(k + 1).map(t => t.w));
      return a && name ? [`switch ${a} to ${name}`] : null;
    }
    case 'delete': case 'duplicate': case 'select': {
      const parts: string[] = [];
      let i = 0;
      while (i < rest.length) {
        if (['and', 'plus', 'also'].includes(rest[i].w) && !rest[i].q) { i++; continue; }
        const used = refSpan(rest, i, env);
        const r = ref(rest.slice(i, i + used));
        if (!r) return null;
        parts.push(r);
        i += used;
      }
      return parts.length ? [`${verb} ${parts.join(' and ')}`] : null;
    }
    case 'rename': {
      const k = at(rest, ['to', 'as']);
      const quoted = rest.findIndex(t => t.q && rest.indexOf(t) > 0);
      const end = k >= 0 ? k : quoted;
      if (end < 0) return null;
      const a = ref(rest.slice(0, end));
      const nameTok = rest.slice(k >= 0 ? k + 1 : quoted).find(t => t.q);
      return a && nameTok ? [`rename ${a} "${nameTok.w}"`] : null;
    }
    case 'set': {
      let k = -1;
      for (let i = rest.length - 1; i >= 0; i--) if (!rest[i].q && ['to', '=', 'at', 'into'].includes(rest[i].w)) { k = i; break; }
      if (k < 0) return null;
      const head = rest.slice(0, k);
      const value = rest.slice(k + 1).map(t => t.w).filter(w => w !== 'the' && w !== 'a');
      if (value.length !== 1) return null;
      const target = paramWords(head, env);
      if (!target) return null;
      return [`set ${target.ref} ${target.key || 'size'}=${value[0]}`];
    }
    case 'adjust': {
      const w = word!;
      if (w === 'make') {
        const relAt = rest.findIndex(t => !t.q && t.w in RELATIVE_WORDS);
        if (relAt < 0) return null;
        const rel = RELATIVE_WORDS[rest[relAt].w];
        const mods = rest.slice(0, relAt).map(t => t.w);
        const head = rest.slice(0, relAt).filter(t => !['much', 'a', 'bit', 'little', 'slightly', 'lot', 'far', 'even', 'way'].includes(t.w));
        const step = mods.includes('much') || mods.includes('lot') || mods.includes('far') || mods.includes('way') ? RELATIVE_STEP.much : mods.includes('bit') || mods.includes('slightly') || mods.includes('little') ? RELATIVE_STEP.bit : RELATIVE_STEP.normal;
        const target = paramWords(head, env);
        if (!target) return null;
        const key = target.key || (rel.role === 'intensity' ? 'brightness' : rel.role);
        const by = at(rest, ['by'], relAt);
        if (by >= 0 && numberOf(rest[by + 1]?.w ?? '') !== null) return target.key ? null : [`set ${target.ref} ${key}${rel.dir > 0 ? '+=' : '-='}${fmtNum(numberOf(rest[by + 1].w)!)}`];
        if (target.key) return null;
        return [`set ${target.ref} ${key}${rel.dir > 0 ? '*=' : '/='}${fmtNum(step)}`];
      }
      const by = at(rest, ['by']);
      const target = paramWords(by >= 0 ? rest.slice(0, by) : rest, env);
      if (!target || !target.key) return null;
      const dir = ['increase', 'raise'].includes(w) ? 1 : -1;
      if (w === 'double') return [`set ${target.ref} ${target.key}*=2`];
      if (w === 'halve') return [`set ${target.ref} ${target.key}/=2`];
      if (w === 'triple') return [`set ${target.ref} ${target.key}*=3`];
      if (by >= 0 && numberOf(rest[by + 1]?.w ?? '') !== null) return [`set ${target.ref} ${target.key}${dir > 0 ? '+=' : '-='}${fmtNum(numberOf(rest[by + 1].w)!)}`];
      return [`set ${target.ref} ${target.key}${dir > 0 ? '*=' : '/='}${fmtNum(RELATIVE_STEP.normal)}`];
    }
    case 'group': {
      const asAt = at(rest, ['as', 'called', 'named']);
      const list = asAt >= 0 ? rest.slice(0, asAt) : rest;
      const parts: string[] = [];
      let i = 0;
      while (i < list.length) {
        if (['and', 'plus', 'also'].includes(list[i].w) && !list[i].q) { i++; continue; }
        const used = refSpan(list, i, env);
        const r = ref(list.slice(i, i + used));
        if (!r) return null;
        parts.push(r);
        i += used;
      }
      const name = asAt >= 0 ? (rest.slice(asAt + 1).find(t => t.q)?.w ?? rest.slice(asAt + 1).map(t => t.w).join(' ')) : null;
      return [`group(${parts.join(', ')})${name ? ` name="${name}"` : ''}`];
    }
    case 'colour': {
      const withAt = at(rest, ['with', 'using', 'through']);
      const byAt = at(rest, ['by', 'along']);
      const refEnd = [withAt, byAt].filter(k => k >= 0).reduce((m, k) => Math.min(m, k), rest.length);
      const what = refEnd > 0 ? ref(rest.slice(0, refEnd)) : 'it';
      if (!what) return null;
      const palWord = rest.map(t => t.w).find(w => PALETTE_BY_KEY[w] && PALETTE_BY_KEY[w].kind === 'palette');
      const pal = palWord ? ` palette=${palWord}` : '';
      let driver = 'it';
      if (byAt >= 0) {
        const d = rest.slice(byAt + 1).map(t => t.w).filter(w => !['the', 'a', 'an'].includes(w));
        const spaceWords = ['space', 'uv', 'uvs', 'coordinates', 'centre', 'center', 'middle'];
        if (['length', 'distance', 'radius'].includes(d[0]) && (d.length === 1 || d.slice(1).some(x => spaceWords.includes(x)))) driver = 'length';
        else if (d[0] === 'angle' || d[0] === 'direction') driver = 'angle';
        else if ((d[0] === 'x' || d[0] === 'y' || d[0] === 'height' || d[0] === 'width') && d.slice(1).every(x => ['of', ...spaceWords].includes(x))) driver = d[0] === 'y' || d[0] === 'height' ? 'y' : 'x';
        else if (d[0] === 'time' && d.length === 1) driver = 'time';
        else if (d[0] === 'noise' && d.length === 1 && rest[byAt + 1]?.w !== 'the') driver = 'noise';
        else { const r = ref(rest.slice(byAt + 1)); if (!r) return null; driver = /^[a-z][a-z0-9-]*(#\w+)?$/.test(r) && !['it', 'this', 'these', 'picture'].includes(r) ? `the ${r}` : r; }
      }
      return what === 'it' ? [`colour by ${driver}${pal}`] : [what === 'picture' ? 'the picture' : `the ${what}`, `colour by ${driver}${pal}`];
    }
  }
  return null;
}

/** "the glow falloff", "the falloff of the glow", "the glow's falloff", "the radius" → reference and setting key. */
function paramWords(toks: Tok[], env: RefEnv): { ref: string; key: string } | null {
  const of = at(toks, ['of']);
  const poss = toks.findIndex(t => t.poss);
  const key = (ts: Tok[]) => ts.map(t => t.w).filter(w => w !== 'the').join('-');
  if (of >= 0) { const r = canonRef(toks.slice(of + 1)); return r ? { ref: r, key: key(toks.slice(0, of)) } : null; }
  if (poss >= 0) { const r = canonRef(toks.slice(0, poss)); return r ? { ref: r, key: key(toks.slice(poss + 1)) } : null; }
  const rr = readRef(toks, 0, env);
  if (rr.ok) { const r = canonRef(toks.slice(0, rr.used)); return r ? { ref: r, key: key(toks.slice(rr.used)) } : null; }
  // Just a setting, on "it".
  return toks.length ? { ref: 'it', key: key(toks) } : null;
}

/**
 * The canonical line for a Do… bar sentence, read with the bar's own readers; null when there is
 * nothing to show (an intent, a taught phrase, an idiom, a phrase it can't read).
 */
export function canonicalOf(text: string, ctx: { nodes: GraphNode[]; selected: string[] }): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const env: RefEnv = { nodes: ctx.nodes, selected: ctx.selected, subject: null };
  const lower = trimmed.toLowerCase();
  if (/^(is (this|that|it) |how (common|typical|usual|often)|typical\??$|check |teach\b)/.test(lower)) return null;
  if (matchTaught(trimmed)) return null;
  const out3d = readOutputPhrase(trimmed);
  if (out3d) return out3d.show === 'picture' ? 'output picture' : out3d.palette ? `colour by ${out3d.show} palette=${out3d.palette}` : `output ${out3d.show}`;
  const grid = readGridRules(trimmed);
  if (grid) return printGrid(gridRulesParams(grid), { header: 'always' });
  const clauses = clausesOf(trimmed);
  if (!clauses.length) return null;
  // As execCommand tells: "the" before a target phrase ("the space") or a place ("the top left") names no node.
  const TARGET_PHRASES = Object.values(TARGETS).flat();
  const PLACE_WORDS = Object.keys(PLACES);
  const isTargetOrPlace = (ts: Tok[], i: number) => {
    const words = ts.map(x => x.w);
    return TARGET_PHRASES.some(p => p.split(' ').every((w, k) => words[i + k] === w))
      || PLACE_WORDS.some(p => p.split(' ').every((w, k) => words[i + 1 + k] === w));
  };
  const definite = (ts: Tok[]) => ts.findIndex((t, i) => (t.q || t.w === 'the') && !isTargetOrPlace(ts, i));
  const allBuild = clauses.every(ts => classify(ts).verb === 'build' && (definite(ts) < 0 || !readRef(ts, definite(ts), env).ok));
  if (allBuild) {
    const words = sugarLex(trimmed).filter(t => !t.sep).map(t => t.w);
    const p = phraseCanon(words, null);
    return p ? p.join(' · ') : null;
  }
  const out: string[] = [];
  for (const ts of clauses) {
    const k = classify(ts);
    if (k.verb === 'build') {
      // A node named with "the" ("glow the circle") is what it works on.
      const tIdx = definite(ts);
      let target: string | null = null;
      let words = ts.filter(t => !t.sep).map(t => t.w);
      if (tIdx >= 0) {
        let r = readRef(ts, tIdx, env);
        // A node an earlier clause makes isn't on the graph yet: "the" and a shape or node name.
        if (!r.ok && !r.candidates) {
          const ws = ts.slice(tIdx + 1).map(t => t.w);
          for (let n2 = Math.min(3, ws.length); n2 >= 1; n2--) {
            if (SHAPES.some(sh => sh.words.includes(ws.slice(0, n2).join(' '))) || typeByName(ws.slice(0, n2))) { r = { ok: true, ids: [], used: n2 + 1, text: '' }; break; }
          }
        }
        if (r.ok || r.candidates) {
          const span = ts.slice(tIdx, tIdx + r.used);
          const c2 = canonRef(span);
          if (c2) {
            target = c2 === 'picture' ? 'picture' : c2 === 'these' ? 'pair' : c2 === 'it' || c2 === 'this' ? null : `the ${c2}`;
            words = [...ts.slice(0, tIdx), ...ts.slice(tIdx + r.used)].filter(t => !t.sep && !['to', 'on', 'onto', 'of', 'for'].includes(t.w) || false).map(t => t.w);
          }
        }
      }
      const p = phraseCanon(words, target);
      if (!p) return null;
      out.push(...p);
      continue;
    }
    const c = clauseCanon(env, k.verb, k.word, k.rest);
    if (!c) return null;
    out.push(...c);
  }
  return out.join(' · ');
}

/** Whether a line is in the bar's dialects as written (canonical): it reads with no mistakes. */
export function readsAsCanonical(text: string): boolean {
  return parsePicture(text, { seed: 1 }).errors.length === 0;
}

export { untok };
