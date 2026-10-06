/**
 * Explanations as structured segments (segments.ts): names, numbers, code and function names are
 * tokens; plain text wraps names and code in backticks so it reads unambiguously.
 */
import { describe, it, expect } from 'vitest';
import { explainExpression, explainLine, mark, parseSegs, toPlainText, stripMarks, varsIn, IDIOMS, type Explanation, type Seg } from '..';
import { idiomSpecs } from '../../../suggestions/idiomBlocks';

const ex = (s: string, types: Record<string, string>): Explanation => {
  const r = explainExpression(s, { types: types as never });
  if (!r.ok) throw new Error(r.error);
  return r;
};
const kinds = (segs: Seg[]) => segs.filter(s => s.kind !== 'text').map(s => `${s.kind}:${s.text}${s.kind === 'var' && s.type ? `:${s.type}` : ''}`);

describe('marks and segments', () => {
  it('round-trips marked text into segments and back', () => {
    const s = `where ${mark.v('a', 'a', 'float')} is below ${mark.n('0.02')}, see ${mark.c('1.0 - step(0.02, a)')} and ${mark.f('foo')}`;
    expect(parseSegs(s)).toEqual([
      { kind: 'text', text: 'where ' }, { kind: 'var', text: 'a', name: 'a', type: 'float' }, { kind: 'text', text: ' is below ' },
      { kind: 'num', text: '0.02' }, { kind: 'text', text: ', see ' }, { kind: 'code', text: '1.0 - step(0.02, a)' },
      { kind: 'text', text: ' and ' }, { kind: 'fn', text: 'foo' },
    ]);
    expect(toPlainText(s)).toBe('where `a` is below 0.02, see `1.0 - step(0.02, a)` and foo');
    expect(stripMarks(s)).toBe('where a is below 0.02, see 1.0 - step(0.02, a) and foo');
  });
  it('a member read keeps its variable for hover linking', () => {
    expect(parseSegs(mark.v('p.x', 'p', 'float'))).toEqual([{ kind: 'var', text: 'p.x', name: 'p', type: 'float' }]);
  });
  it('unknown types are left off', () => {
    expect(parseSegs(mark.v('q', 'q', 'unknown'))).toEqual([{ kind: 'var', text: 'q', name: 'q' }]);
  });
});

describe('segment generation for idioms', () => {
  it('the user’s line: 1.0 - step(0.02, a)', () => {
    const r = explainLine('float silent = 1.0 - step(0.02, a)', { types: { a: 'float' } });
    if (!r.ok) throw new Error(r.error);
    expect(kinds(r.lineSentenceSegs)).toEqual(['var:silent:float', 'var:a:float', 'num:0.02']);
    expect(r.lineSentence).toBe('`silent` is where `a` is below 0.02.');
    // The plain meaning leads
    expect(r.lead).toBe('`silent` is 1 while `a` stays under 0.02 and 0 otherwise: a switch that is on only when `a` is almost 0.');
    expect(r.use).toBe('a hard on/off mask');
    expect(varsIn(r.leadSegs)).toEqual(['silent', 'a']);
  });
  const cases: Array<[string, Record<string, string>, string, string[]]> = [
    ['smoothstep(0.3, 0.35, length(uv))', { uv: 'vec2' }, 'soft-circle', ['num:0.3']],
    ['fract(uv * 4.0)', { uv: 'vec2' }, 'tile', ['var:uv:vec2', 'num:4', 'num:4']],
    ['mix(c1, c2, t)', { c1: 'vec3', c2: 'vec3', t: 'float' }, 'mix', ['var:c1:vec3', 'var:c2:vec3']],
    ['length(p) - 0.3', { p: 'vec2' }, 'circle-sdf', ['num:0.3']],
    ['sin(t) * 0.5 + 0.5', { t: 'float' }, 'remap-01', []],
    ['clamp(x, 0.0, 1.0)', { x: 'float' }, 'saturate', ['var:x:float']],
  ];
  it.each(cases)('%s', (src, types, id, sentence) => {
    const r = ex(src, types);
    expect(r.idioms.find(h => h.node === r.root)?.idiom.id).toBe(id);
    expect(kinds(r.sentenceSegs)).toEqual(sentence);
    expect(r.meaningSegs?.length).toBeGreaterThan(0);
    expect(r.meaning).toMatch(/^Gives /);
  });
  it('unknown functions are function tokens, their arguments tokens too', () => {
    const r = ex('foo(p, 2.0)', { p: 'vec2' });
    expect(kinds(r.sentenceSegs)).toEqual(['fn:foo', 'var:p:vec2', 'num:2']);
  });
  it('the breakdown carries each step’s code as a code token', () => {
    const r = ex('fract(sin(uv*3.0)*2.0)', { uv: 'vec2' });
    expect(r.breakdownSegs.filter(s => s.kind === 'code').map(s => s.text)).toEqual(['A = uv*3.0', 'B = sin(A)', 'C = B*2.0', 'fract(C)']);
    expect(r.steps[0].segs.some(s => s.kind === 'var' && s.name === 'uv' && s.type === 'vec2')).toBe(true);
  });
  it('composed explanations end with an In short summary built from the parts', () => {
    const r = ex('fract(sin(uv*3.0)*2.0)', { uv: 'vec2' });
    expect(r.inShort).toBe('In short: `uv` → zoomed space → waves → doubled waves → ramps, 0…1 per component.');
    expect(ex('smoothstep(0.3, 0.35, length(uv))', { uv: 'vec2' }).inShort).toBeUndefined();
  });
});

describe('plain text disambiguates names', () => {
  it('variables and code are backticked, numbers and words are not', () => {
    const r = explainLine('float silent = 1.0 - step(0.02, a)', { types: { a: 'float' } });
    if (!r.ok) throw new Error(r.error);
    expect(r.lineSentence).not.toMatch(/(^|[^`])\ba\b(?!`)/);
    expect(r.lineSentence).toContain('`a`');
    expect(r.lineSentence).toContain(' 0.02');
    expect(r.breakdown).toBe('It cuts `a` at 0.02: 1 below it, 0 at or above (a hard edge).');
  });
  it('a vec2 / vec3 line', () => {
    const r = explainLine('vec3 col = mix(c1, c2, smoothstep(0.2, 0.3, length(p)))', { types: { c1: 'vec3', c2: 'vec3', p: 'vec2' } });
    if (!r.ok) throw new Error(r.error);
    expect(r.lineSentence).toBe('`col` is a blend of `c1` and `c2`.');
    expect(kinds(r.leadSegs)).toEqual(['var:col:vec3', 'var:c1:vec3', 'var:c2:vec3']);
  });
});

describe('plain meanings', () => {
  it('every idiom has a plain meaning and a use', () => {
    const missing = IDIOMS.filter(i => typeof i.meaning !== 'function' || !i.use).map(i => i.id);
    expect(missing).toEqual([]);
  });
  it('each idiom’s meaning reads without empty holes when explained', () => {
    let checked = 0;
    for (const spec of idiomSpecs()) {
      const r = explainExpression(spec.result, { types: Object.fromEntries(spec.inputs.map(i => [i.name, i.type])) as never });
      if (!r.ok || r.idioms.find(h => h.node === r.root)?.idiom.id !== spec.idiom.id) continue;
      checked++;
      expect(r.meaning, spec.idiom.id).toBeTruthy();
      expect(r.meaning, spec.idiom.id).not.toMatch(/\s\s|\s[,.:]|\(\)/);
    }
    expect(checked).toBeGreaterThan(30);
  });
});
