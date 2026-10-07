/**
 * The language core (docs/playfield-language-plan.md phase 1): one lexer, one fuzzy match, one
 * colour table, the shared value and setting reader, references, the registry and randomness.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { lex, type Tok } from '../lex';
import { Cursor } from '../parse';
import { printArg, printRef, printValue } from '../print';
import { COLOUR_TABLE, colourOf, colourText } from '../colours';
import { editDistance, fuzzBudget, suggest } from '../fuzzy';
import { COLOURS } from '../vocabulary';
import { RECIPE_WORDS } from '../../sceneBuilder/recipe';
import { entriesFor, lookupHead, paramOf, registry, type Dialect } from '../registry';
import { drawFrom, makeRng, resolveRandom } from '../random';

const kinds = (src: string) => lex(src).toks.filter(t => t.t !== 'eof').map(t => t.t);
const one = <T extends Tok['t']>(src: string, t: T) => lex(src).toks.find(x => x.t === t) as Extract<Tok, { t: T }>;

describe('lexer', () => {
  it('reads the recipe as before', () => {
    expect(kinds('sphere r=1 @twist(2) · box')).toEqual(['word', 'word', '=', 'num', '@', 'word', '(', 'num', ')', 'sep', 'word']);
    expect(one('x 30deg', 'num')).toMatchObject({ v: 30, unit: 'deg' });
    expect(one('x 30 °', 'num')).toMatchObject({ v: 30, unit: 'deg' });
    expect(one('c=#ff8800', 'hex').v).toEqual([1, 0.5333, 0]);
    expect(one('"My shape"', 'str').v).toBe('My shape');
    expect(kinds('sphere // a note\nbox')).toEqual(['word', 'sep', 'word']);
  });
  it('keeps a combine going over indented lines, and marks indents', () => {
    expect(kinds('union(\n  sphere,\n  box\n) k=1')).toEqual(['word', '(', 'word', ',', 'word', ')', 'word', '=', 'num']);
    const seps = lex('species Ants\n  always do stop\nchannels a').toks.filter(t => t.t === 'sep');
    expect(seps.map(s => s.t === 'sep' && s.indent)).toEqual([2, 0]);
  });
  it('reads the new tokens: arrows, relative settings, ops, comparisons, units, ranges, code, ordinals, sockets, cells', () => {
    expect(kinds('connect noise → glow.tint')).toEqual(['word', 'word', 'arrow', 'word', '.', 'word']);
    expect(kinds('a -> b')).toEqual(['word', 'arrow', 'word']);
    expect(kinds('set it r*=1.25 falloff+=2')).toEqual(['word', 'word', 'word', 'opeq', 'num', 'word', 'opeq', 'num']);
    expect(kinds('it * circle')).toEqual(['word', 'op', 'word']);
    expect(kinds('noise - it')).toEqual(['word', 'op', 'word']);
    expect(kinds('smooth-union(a, b)')).toEqual(['word', '(', 'word', ',', 'word', ')']);
    expect(kinds('food ahead > 0.5')).toEqual(['word', 'word', 'cmp', 'num']);
    expect(one('fade 0.5s', 'num')).toMatchObject({ v: 0.5, unit: 's' });
    expect(one('t 200ms', 'num')).toMatchObject({ v: 200, unit: 'ms' });
    expect(one('memory += 1/s', 'num')).toMatchObject({ v: 1, unit: '/s' });
    expect(one('chance 60%', 'num')).toMatchObject({ v: 60, unit: '%' });
    expect(one('repeat 6x', 'num')).toMatchObject({ v: 6, unit: 'x' });
    expect(one('scale=1/2', 'num')).toMatchObject({ v: 0.5 });
    expect(one('born=34..45', 'range')).toMatchObject({ lo: 34, hi: 45 });
    expect(one('u={u + 0.2 * lap_u}', 'code').v).toBe('u + 0.2 * lap_u');
    expect(one('circle#2', 'ord').v).toBe(2);
    expect(one('circle#last', 'ord').v).toBe(-1);
    expect(one('stencil .../.1./... → 2', 'cells').v).toEqual(['...', '.1.', '...']);
    expect(one('block 11/00 → 00/11', 'cells').v).toEqual(['11', '00']);
    expect(one('block 1./0. → 0=/1=', 'cells').v).toEqual(['1.', '0.']);
    expect(kinds('species Ants: always do wander')).toEqual(['word', 'word', ':', 'word', 'word', 'word']);
    expect(one('@move(0,-1,0)', 'num')).toMatchObject({ v: 0 });
    expect(lex('@move(0,-1,0)').toks.filter(t => t.t === 'num').map(t => t.t === 'num' && t.v)).toEqual([0, -1, 0]);
  });
  it('says where a stray character is', () => {
    expect(lex('sphere $ box').errors[0]).toMatchObject({ at: 7 });
  });
});

describe('fuzzy matching and colours: one of each', () => {
  it('uses the stricter budget everywhere (D2)', () => {
    expect([fuzzBudget('red'), fuzzBudget('blue'), fuzzBudget('sphere'), fuzzBudget('volumetric')]).toEqual([0, 1, 1, 2]);
    expect(editDistance('dpeth', 'depth')).toBe(1);
    expect(suggest('sphre', ['sphere', 'box'])).toBe('sphere');
    expect(suggest('bxo', ['box'])).toBeNull();
  });
  it('has one colour table, with the recipe\'s values where both had a name (D3)', () => {
    expect(COLOURS).toBe(COLOUR_TABLE);
    expect(RECIPE_WORDS.colours).toBe(COLOUR_TABLE);
    expect(COLOUR_TABLE.red).toEqual([0.9, 0.15, 0.12]);
    for (const w of ['lime', 'warm', 'cool', 'neon', 'fire', 'ice', 'silver', 'brown', 'cream', 'sky', 'night']) expect(COLOUR_TABLE[w], w).toBeTruthy();
    expect(colourOf('#f80')).toEqual([1, 0.5333, 0]);
    expect(colourText([0.9, 0.15, 0.12])).toBe('red');
    expect(colourText([1, 0.5333, 0])).toBe('#ff8800');
    expect(colourText([0.1234, 0.5, 0.5])).toBe('(0.1234,0.5,0.5)');
  });
});

describe('values and settings', () => {
  const args = (src: string) => new Cursor(src).args([]);
  it('reads key=value, positional values, lists, empty lists, ranges and relative settings', () => {
    expect(args('r=0.3 at=(1,0,0) glass 6').map(printArg)).toEqual(['r=0.3', 'at=(1,0,0)', 'glass', '6']);
    expect(args('survive=2,3,4 board=240').map(printArg)).toEqual(['survive=2,3,4', 'board=240']);
    expect(args('born=2 survive= states=3').map(printArg)).toEqual(['born=2', 'survive=', 'states=3']);
    expect(args('born=34..45').map(printArg)).toEqual(['born=34..45']);
    expect(args('r*=1.25 falloff+=2').map(printArg)).toEqual(['r*=1.25', 'falloff+=2']);
    expect(args('color=#FF8800 u={u * 2}').map(printArg)).toEqual(['color=#ff8800', 'u={u * 2}']);
  });
  it('reads random values: bare, a range and choices', () => {
    const a = args('falloff=random r=random(0.2..2) color=random(red, teal, gold)');
    expect(a.map(x => x.value.k)).toEqual(['random', 'random', 'random']);
    expect(a.map(printArg)).toEqual(['falloff=random', 'r=random(0.2..2)', 'color=random(red, teal, gold)']);
  });
  it('reads modifiers and items', () => {
    const c = new Cursor('smooth-union(sphere r=1 @move(0,1,0), box) k=0.5');
    const it = c.item(w => ['sphere', 'box'].includes(w), w => w === 'smooth-union')!;
    expect(it.items!.map(x => x.head)).toEqual(['sphere', 'box']);
    expect(it.items![0].mods[0].args.map(printArg)).toEqual(['0', '1', '0']);
    expect(it.items![0].mods[0].args.map(a => !!a.comma)).toEqual([true, true, false]);
    expect(it.args.map(printArg)).toEqual(['k=0.5']);
    expect(c.errors).toEqual([]);
  });
  it('reads references in every canonical form', () => {
    const ref = (s: string) => { const c = new Cursor(s); const r = c.ref({ and: true }); return r ? printRef(r) : null; };
    for (const s of ['it', 'this', 'these', '"Halo"', 'circle', 'circle#2', 'circle#last', 'glow.tint', 'before output', 'all circles', 'circle and glow']) expect(ref(s)).toBe(s);
    expect(ref('the circle')).toBe('circle');
    expect(ref('the picture')).toBe('picture');
    expect(ref('the "Halo"')).toBe('"Halo"');
  });
  it('reports a mistake at its line and column', () => {
    const c = new Cursor('sphere\nbox r=(1,2');
    c.args([]); c.next(); c.args([]);
    expect(c.errors[0]).toMatchObject({ line: 2, col: 7 });
  });
});

describe('the registry', () => {
  const groups: Dialect[][] = [['picture', 'edit'], ['scene']];
  it('no word means two things within a dialect (calls and plain heads apart)', () => {
    for (const g of groups) {
      for (const cls of ['call', 'head']) {
        const seen = new Map<string, string>();
        for (const e of registry().filter(x => x.dialects.some(d => g.includes(d)) && (x.kind === 'combine' ? 'call' : 'head') === cls)) {
          for (const w of e.words) {
            const prev = seen.get(w);
            expect(prev === undefined || prev === e.id, `${g.join('+')} ${cls}: “${w}” is ${prev} and ${e.id}`).toBe(true);
            seen.set(w, e.id);
          }
        }
      }
    }
  });
  it('settles the clashes the plan found', () => {
    // D5: add/subtract are CSG calls; D6: glow is the step, a mode only as a deprecated alias.
    expect(lookupHead('add', 'scene', ['combine'])?.entry.id).toBe('combine:union');
    expect(lookupHead('glow', 'picture')?.entry.id).toBe('picture:glow');
    expect(lookupHead('glow', 'scene', ['header'])).toMatchObject({ how: 'deprecated', entry: { id: 'scene:volumetric' } });
    // D8: noise is the node in 2D, the warp is written warp in 3D.
    expect(lookupHead('noise', 'picture')?.entry.id).toBe('picture:noise');
    expect(lookupHead('warp', 'scene')?.entry.id).toBe('scene:warp:noise');
    expect(lookupHead('noise', 'scene')).toMatchObject({ how: 'deprecated' });
    // D7: both( is intersect.
    expect(lookupHead('both', 'scene', ['combine'])?.entry.id).toBe('combine:intersect');
    // §13 decision 1: colour by is canonical.
    expect(lookupHead('colour', 'picture')?.entry.id).toBe('picture:colour-by');
    expect(lookupHead('trails', 'picture')?.entry.words[0]).toBe('fade');
    expect(lookupHead('duplicate', 'edit')?.entry.id).toBe('edit:duplicate');
  });
  it('every step and maker setting with a primary has one primary, and keys resolve', () => {
    for (const e of registry()) expect(e.params.filter(p => p.primary).length, e.id).toBeLessThanOrEqual(1);
    const glow = lookupHead('glow', 'picture')!.entry;
    expect(paramOf(glow, 'falloff')).toMatchObject({ primary: true, def: 10 });
    expect(paramOf(glow, 'colour')?.key).toBe('color');
  });
  it('has picture, scene and edit words', () => {
    for (const d of ['picture', 'scene', 'edit'] as const) expect(entriesFor(d).length).toBeGreaterThan(5);
  });
});

describe('randomness', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = makeRng(42), b = makeRng(42), c = makeRng(43);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(xs);
  });
  it('draws inside ranges, picks choices and snaps counts', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 200; i++) {
      const v = drawFrom({ kind: 'num', lo: 4, hi: 20, log: true }, rng);
      expect(v.k === 'num' && v.v >= 4 && v.v <= 20).toBe(true);
      const n = drawFrom({ kind: 'num', lo: 3, hi: 12, int: true }, rng);
      expect(n.k === 'num' && Number.isInteger(n.v)).toBe(true);
      const r = resolveRandom({ k: 'random', range: [0.2, 2] }, undefined, rng)!;
      expect(r.k === 'num' && r.v >= 0.2 && r.v <= 2).toBe(true);
      const ch = resolveRandom({ k: 'random', choices: [{ k: 'word', v: 'red' }, { k: 'word', v: 'teal' }] }, undefined, rng)!;
      expect(['red', 'teal']).toContain(printValue(ch));
    }
  });
  it('every random range in the registry sits inside its setting\'s legal range', () => {
    for (const e of registry()) for (const p of e.params) {
      if (p.rand?.kind !== 'num') continue;
      expect(p.rand.lo, `${e.id}.${p.key}`).toBeLessThan(p.rand.hi);
      if (p.min !== undefined) expect(p.rand.lo, `${e.id}.${p.key}`).toBeGreaterThanOrEqual(p.min);
      if (p.max !== undefined) expect(p.rand.hi, `${e.id}.${p.key}`).toBeLessThanOrEqual(p.max);
    }
  });
});
