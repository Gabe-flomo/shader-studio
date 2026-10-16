import { describe, expect, it } from 'vitest';
import { lineTargetName, nameAt, nameOrigins } from '../exprNameOrigin';

const lines = [
  { lhs: 'float r', op: '=', rhs: '0.3' },
  { lhs: 'vec2 c', op: '=', rhs: 'vec2(cos(a0), sin(a0)) * r' },
  { lhs: 'float size', op: '=', rhs: '0.03 + 0.07 * life * (0.6 + h)' },
  { lhs: 'r', op: '*=', rhs: '2.0' },
  { lhs: 'p.xy', op: '+=', rhs: 'c' },
  { lhs: 'r', op: '+=', rhs: '1.0', off: true },
];
const inputs = [{ name: 'p', type: 'vec2' }, { name: 'life', type: 'float' }];

describe('where a name in an Expression Block comes from', () => {
  it('reads line targets', () => {
    expect(lineTargetName('float size')).toEqual({ name: 'size', declares: true });
    expect(lineTargetName('p.xy')).toEqual({ name: 'p', declares: false });
    expect(lineTargetName('vec3 col')).toEqual({ name: 'col', declares: true });
  });

  it('a declared local: the line that made it, then the lines above that changed it', () => {
    expect(nameOrigins('r', lines, inputs, 2)).toEqual([{ kind: 'line', index: 0, text: 'float r = 0.3', declares: true }]);
    const end = nameOrigins('r', lines, inputs, 'end');
    // The switched-off line is skipped
    expect(end.map(o => o.kind === 'line' && o.index)).toEqual([0, 3]);
  });

  it('only lines above the hovered one count', () => {
    expect(nameOrigins('size', lines, inputs, 2)).toEqual([]);
    expect(nameOrigins('size', lines, inputs, 3)).toHaveLength(1);
  });

  it('an input, then the lines that change it', () => {
    expect(nameOrigins('life', lines, inputs, 2)).toEqual([{ kind: 'input', name: 'life', type: 'float' }]);
    expect(nameOrigins('p', lines, inputs, 'end').map(o => o.kind)).toEqual(['input', 'line']);
  });

  it('built-ins have none', () => {
    expect(nameOrigins('time', lines, inputs, 'end')).toEqual([]);
  });

  it('finds the name under the pointer, not swizzles or numbers', () => {
    const t = 'abs(v - c) + p.xy * 0.5';
    expect(nameAt(t, 4)?.name).toBe('v');
    expect(nameAt(t, 8)?.name).toBe('c');
    expect(nameAt(t, 13)?.name).toBe('p');
    expect(nameAt(t, 15)).toBeNull();
    expect(nameAt(t, 21)).toBeNull();
  });
});
