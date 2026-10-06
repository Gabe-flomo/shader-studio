import { describe, it, expect } from 'vitest';
import { explainExpression, explainLine, inferRoles, inferTypes, parseExpr, roleOfSourceNode, type Explanation } from '..';

const T = { uv: 'vec2', p: 'vec2', q: 'vec2', col: 'vec3', mask: 'float', d: 'float', t: 'float', x: 'float', a: 'float', b: 'float', tex: 'sampler2D' } as const;
const ex = (s: string, types: Record<string, string> = T): Explanation => {
  const r = explainExpression(s, { types: types as never });
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('the user’s example', () => {
  it('fract(sin(uv*3.0)*2.0) reads inside-out, with names for the parts', () => {
    const r = ex('fract(sin(uv*3.0)*2.0)');
    expect(r.sentence).toBe('Repeating 0–1 ramps of sine waves of `uv` zoomed out 3×, doubled.');
    expect(r.steps.map(s => s.code)).toEqual(['uv*3.0', 'sin(A)', 'B*2.0', 'fract(C)']);
    expect(r.steps[0].text).toMatch(/^zooms `uv` out 3×/);
    expect(r.steps[1].text).toMatch(/sine of each coordinate of the zoomed space: waves from −1 to 1/);
    expect(r.steps[2].text).toBe('doubles the waves (now −2…2)');
    expect(r.steps[3].text).toMatch(/repeating 0…1 ramps \(its −2…2 range becomes 4 ramps\)/);
    expect(r.breakdown).toMatch(/^First, `A = uv\*3\.0`: zooms `uv` out 3×.*Then, `B = sin\(A\)`:.*Then, `C = B\*2\.0`:.*Finally, `fract\(C\)`:/);
    expect(r.idioms).toEqual([]);
    // Spans point at the sub-expressions, for hover highlighting
    expect(r.source.slice(r.steps[0].start, r.steps[0].end)).toBe('uv*3.0');
    expect(r.source.slice(r.steps[1].start, r.steps[1].end)).toBe('sin(uv*3.0)');
  });
});

describe('composition text (role-aware)', () => {
  // Plain text puts names and code in backticks so they never read as words (numbers stay bare)
  const cases: Array<[string, RegExp | string, RegExp?]> = [
    ['uv * 3.0', '`uv` zoomed out 3×.', /zooms `uv` out 3×/],
    ['uv * 0.5', '`uv` zoomed in 2×.', /zooms `uv` in 2×/],
    ['uv / 4.0', '`uv` zoomed in 4×.'],
    ['-uv', '`uv` mirrored.', /mirrors `uv` through the origin/],
    ['uv + 0.25', '`uv` shifted by 0.25.', /moves whatever is drawn in it by −0.25/],
    ['uv.yx', '`uv` with x and y swapped.'],
    ['col * 3.0', '`col`, 3× brighter.', /makes `col` 3× brighter/],
    ['col * 0.5', '`col`, darkened to 50%.'],
    ['col + 0.1', '`col` lifted by 0.1.', /brighter and greyer/],
    ['col * mask', '`col`, masked by `mask`.', /fades it to black where it is 0/],
    ['col * vec3(1.0, 0.5, 0.2)', /tinted by `vec3\(1\.0, 0\.5, 0\.2\)`/, /channel by channel/],
    ['t * 2.0', '`t` 2× faster.', /runs `t` 2× faster/],
    ['t * 0.25', '`t` 4× slower.'],
    ['sin(t)', 'A sine wave of `t`.', /from −1 to 1 that repeats every 2π/],
    ['cos(uv)', 'Cosine waves of `uv`.', /each coordinate/],
    ['length(uv)', 'The distance of `uv` from the origin.', /growing outward in circles/],
    ['abs(uv)', '`uv` folded.', /mirrors `uv` across both axes/],
    ['abs(d)', '`d` without its sign.', /inside and outside/],
    ['floor(t)', '`t` rounded down.'],
    ['fract(t * 4.0)', /^Repeating 0–1 ramps of `t` 4× faster\.$/],
    ['max(d, 0.0)', '`d`, at least 0.', /cuts the negative part/],
    ['min(x, 1.0)', '`x`, at most 1.'],
    ['pow(x, 2.0)', '`x` squared.'],
    ['pow(x, 0.3)', '`x` to the power 0.3.', /softens/],
    ['sqrt(x)', 'The square root of `x`.'],
    ['exp(x)', 'The exponential of `x`.'],
    ['smoothstep(0.0, 1.0, x)', 'A smooth ramp of `x`.', /S-curve/],
    ['mix(col, vec3(1.0), 0.3)', 'A blend of `col` and `vec3(1.0)`.', /mixes 30% of `vec3\(1\.0\)` into `col`/],
    ['texture(tex, uv)', 'The colour of `tex` at `uv`.'],
    ['x > 0.5 ? a : b', '`a` where `x` is greater than 0.5, otherwise `b`.'],
    ['vec3(x, x * 0.5, 1.0)', 'The colour (`x`, `x * 0.5`, 1).', /red `x`, green the halved `x`, blue 1/],
    ['vec4(col, 1.0)', '`col` with alpha 1.'],
    ['d - 0.1', '`d` grown by 0.1.', /the shape grows by 0\.1/],
    ['d + 0.1', '`d` shrunk by 0.1.'],
    ['atan(x)', 'The arctangent of `x`.'],
    ['col.r', 'Just `col.r` (a float).'],
  ];
  it.each(cases)('%s', (src, sentence, last) => {
    const r = ex(src);
    if (typeof sentence === 'string') expect(r.sentence).toBe(sentence); else expect(r.sentence).toMatch(sentence);
    if (last) expect(r.steps[r.steps.length - 1].text).toMatch(last);
  });

  it('words unknown functions literally and never guesses', () => {
    const r = ex('foo(p, 2.0)');
    expect(r.sentence).toBe('The result of foo(`p`, 2).');
    expect(r.steps[0].text).toBe('calls foo(`p`, 2), a function this explainer doesn’t know');
  });

  it('the same * 3.0 reads by role: space, colour, time, distance', () => {
    expect(ex('a * 3.0', { a: 'vec2' }).steps[0].text).toMatch(/zooms `a` out 3×/);
    expect(ex('a * 3.0', { a: 'vec3' }).steps[0].text).toMatch(/3× brighter/);
    expect(ex('t * 3.0', { t: 'float' }).steps[0].text).toMatch(/3× faster/);
    expect(ex('d * 3.0', { d: 'float' }).steps[0].text).toMatch(/scales the distance `d` by 3/);
    expect(ex('v * 3.0', { v: 'float' }).steps[0].text).toMatch(/scales `v` by 3/);
  });

  it('recognised idioms explain in one step with their parts named', () => {
    const r = ex('smoothstep(0.3, 0.35, length(uv))');
    expect(r.sentence).toBe('A soft-edged circle of radius 0.3.');
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].idiom?.id).toBe('soft-circle');
    expect(r.steps[0].text).toMatch(/0 inside, rising to 1 over 0\.05/);
  });

  it('idioms compose with the rest', () => {
    const r = ex('col * exp(-3.0 * length(uv - 0.5))');
    expect(r.idioms.map(h => h.idiom.id).sort()).toEqual(['centre-half', 'glow-exp']);
    expect(r.steps[r.steps.length - 1].code).toBe('col * C');
  });

  it('explains lines: declarations, compound assignment, return', () => {
    const d = explainLine('float d = length(p) - 0.3;', { types: { p: 'vec2' } });
    expect(d.ok && d.lineSentence).toBe('`d` is the signed distance to a circle of radius 0.3.');
    const c = explainLine('p *= 2.0', { types: { p: 'vec2' } });
    expect(c.ok && c.lineSentence).toBe('`p` becomes `p` zoomed out 2×.');
    const r = explainLine('return col * 0.5;', { types: { col: 'vec3' } });
    expect(r.ok && r.lineSentence).toBe('Returns `col`, darkened to 50%.');
  });
});

describe('role inference', () => {
  const roles = (s: string, types: Record<string, string> = {}, env = {}) => {
    const r = parseExpr(s);
    if (!r.ok) throw new Error(r.error);
    const t = inferTypes(r.expr, types as never);
    return inferRoles(r.expr, t, env).get(r.expr.id)!;
  };
  it('reads names: uv, p are space; col is colour; d is distance; t is time', () => {
    expect(roles('uv').role).toBe('space');
    expect(roles('uv').because).toBe('name');
    expect(roles('col').role).toBe('colour');
    expect(roles('d').role).toBe('distance');
    expect(roles('t').role).toBe('time');
  });
  it('falls back on types', () => {
    expect(roles('foo', { foo: 'vec2' })).toEqual({ role: 'space', because: 'type' });
    expect(roles('foo', { foo: 'vec3' })).toEqual({ role: 'colour', because: 'type' });
    expect(roles('foo', { foo: 'float' })).toEqual({ role: 'value', because: 'type' });
  });
  it('lets the graph decide over names', () => {
    expect(roles('col', { col: 'vec2' }, { col: 'space' })).toEqual({ role: 'space', because: 'graph' });
    expect(roleOfSourceNode('uv')).toBe('space');
    expect(roleOfSourceNode('time')).toBe('time');
  });
  it('follows operations', () => {
    expect(roles('length(uv)', { uv: 'vec2' }).role).toBe('distance');
    expect(roles('atan(p.y, p.x)', { p: 'vec2' }).role).toBe('angle');
    expect(roles('smoothstep(0.0, 1.0, x)', { x: 'float' }).role).toBe('mask');
    expect(roles('uv * 3.0', { uv: 'vec2' }).role).toBe('space');
    expect(roles('sin(uv)', { uv: 'vec2' }).role).toBe('value');
    expect(roles('col * 2.0', { col: 'vec3' }).role).toBe('colour');
    expect(roles('floor(uv)', { uv: 'vec2' }).role).toBe('cell');
  });
});
