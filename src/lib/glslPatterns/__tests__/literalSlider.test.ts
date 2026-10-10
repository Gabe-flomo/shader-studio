import { describe, expect, it } from 'vitest';
import { literalAt, literalToSlider, nameForLiteral, namesIn } from '../literalSlider';

describe('literalAt', () => {
  it('finds the number under the caret, touching it at either end', () => {
    const t = 'smoothstep(0.6, 0.62, d)';
    for (const at of [11, 12, 14]) expect(literalAt(t, at)).toMatchObject({ start: 11, end: 14, value: 0.6, text: '0.6', int: false });
    expect(literalAt(t, 16)?.text).toBe('0.62');
    expect(literalAt(t, 22)).toBeNull(); // on `d`
  });

  it('finds the number a selection covers (spaces around it allowed), not a wider one', () => {
    const t = 'a * 0.6 + b';
    expect(literalAt(t, 4, 7)?.value).toBe(0.6);
    expect(literalAt(t, 3, 8)?.value).toBe(0.6);
    expect(literalAt(t, 0, 7)).toBeNull();
  });

  it('a unary minus belongs to the number, a subtraction does not', () => {
    expect(literalAt('vec2(-2.0, 1.)', 7)).toMatchObject({ start: 5, end: 9, value: -2, text: '-2.0' });
    expect(literalAt('x * -0.5', 6)).toMatchObject({ text: '-0.5', value: -0.5 });
    expect(literalAt('return -1.5', 9)).toMatchObject({ text: '-1.5' });
    expect(literalAt('x - 2.0', 5)).toMatchObject({ text: '2.0', value: 2 });
  });

  it('skips digits inside names and swizzles; reads .5, 1., exponents and ints', () => {
    expect(literalAt('vec3(1.0)', 3)).toBeNull();
    expect(literalAt('x1 + y', 1)).toBeNull();
    expect(literalAt('u_2', 2)).toBeNull();
    expect(literalAt('a + .5', 5)).toMatchObject({ value: 0.5, int: false });
    expect(literalAt('a + 1.', 4)).toMatchObject({ value: 1, int: false });
    expect(literalAt('a * 2.5e-2', 6)).toMatchObject({ value: 0.025, text: '2.5e-2' });
    expect(literalAt('i < 10', 5)).toMatchObject({ value: 10, int: true });
  });
});

describe('nameForLiteral', () => {
  const name = (t: string, at: number, taken: string[] = [], types: Record<string, string> = {}) =>
    nameForLiteral(t, literalAt(t, at)!, taken, { types: types as never });

  it('names a number from where it sits, as Make a node does', () => {
    expect(name('smoothstep(0.6, 0.62, d)', 12)).toBe('edge0');
    expect(name('smoothstep(0.6, 0.62, d)', 17)).toBe('edge1');
    expect(name('mix(a, b, 0.3)', 11)).toBe('amount');
    expect(name('uv * 3.0', 6, [], { uv: 'vec2' })).toBe('zoom');
    expect(name('sin(t * 2.0)', 8)).toBe('speed');
    expect(name('pow(x, 2.2)', 8)).toBe('exponent');
  });

  it('is unique against the names in use, and never a GLSL word', () => {
    expect(name('smoothstep(0.6, 0.62, d)', 12, ['edge0'])).toBe('edge02');
    expect(name('0.6', 1)).toBe('value');
  });

  it('names a number in a statement of a function body', () => {
    const body = 'float d = length(p);\nreturn smoothstep(0.3, 0.31, d);';
    expect(nameForLiteral(body, literalAt(body, body.indexOf('0.3') + 1)!, ['d', 'p'])).toBe('edge0');
    const loop = 'for (int i = 0; i < 4; i++) { x += 1.0; }';
    expect(nameForLiteral(loop, literalAt(loop, loop.indexOf('4'))!, [])).toBe('count');
  });
});

describe('literalToSlider', () => {
  it('replaces the number with the input, starting at its value, with a range around it', () => {
    const r = literalToSlider('mix(a, b, 0.6)', literalAt('mix(a, b, 0.6)', 11)!, ['a', 'b']);
    expect(r).toMatchObject({ text: 'mix(a, b, amount)', name: 'amount', value: 0.6, slider: { min: 0, max: 1 }, start: 10, end: 16 });
    const big = literalToSlider('x * 40.0', literalAt('x * 40.0', 5)!, ['x']);
    expect(big.slider).toEqual({ min: 0, max: 100 });
    expect(big.value).toBe(40);
    const neg = literalToSlider('x + -3.0', literalAt('x + -3.0', 6)!, ['x']);
    expect(neg.text).toBe('x + offset');
    expect(neg.slider.min).toBeLessThanOrEqual(-3);
  });

  it('an int literal reads int(name), so the code still compiles', () => {
    const t = 'for (int i = 0; i < 4; i++) { x += 1.0; }';
    const r = literalToSlider(t, literalAt(t, t.indexOf('4'))!, ['x', 'i']);
    expect(r.text).toBe('for (int i = 0; i < int(count); i++) { x += 1.0; }');
    expect(r.value).toBe(4);
  });

  it('namesIn collects every identifier', () => {
    expect([...namesIn('float d = length(p);', 'return d;')].sort()).toEqual(['d', 'float', 'length', 'p', 'return']);
  });
});
