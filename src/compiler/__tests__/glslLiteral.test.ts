/**
 * GLSL literal formatting must be exact: vector components and socket
 * defaultValues used to be rounded with toFixed(), so a default of 0.25
 * compiled to 0.3. Every number must round-trip, and integers must still
 * carry a decimal point so GLSL treats them as floats.
 */
import { describe, it, expect } from 'vitest';
import { formatGlslLiteral } from '../shaderAssembler';
import { f, vec3Str, vec4Str } from '../../nodes/definitions/helpers';

const CASES: Array<[number, string]> = [
  [0.25, '0.25'],
  [1, '1.0'],
  [-0.5, '-0.5'],
  [1e-4, '0.0001'],
  [0, '0.0'],
  [-3, '-3.0'],
];

describe('GLSL float literal formatting', () => {
  it('f() emits exact scalars with a decimal point for integers', () => {
    for (const [n, expected] of CASES) expect(f(n)).toBe(expected);
  });

  it('formatGlslLiteral emits exact scalars', () => {
    for (const [n, expected] of CASES) expect(formatGlslLiteral(n, 'float')).toBe(expected);
  });

  it('formatGlslLiteral emits exact vector components', () => {
    expect(formatGlslLiteral([0.25, 1, -0.5, 1e-4], 'vec4')).toBe('vec4(0.25, 1.0, -0.5, 0.0001)');
    expect(formatGlslLiteral([0.25, 1, -0.5], 'vec3')).toBe('vec3(0.25, 1.0, -0.5)');
    expect(formatGlslLiteral([1e-4, 2], 'vec2')).toBe('vec2(0.0001, 2.0)');
  });

  it('vec3Str / vec4Str emit exact components', () => {
    expect(vec3Str([0.25, 1, -0.5])).toBe('vec3(0.25, 1.0, -0.5)');
    expect(vec4Str([0.25, 1, -0.5, 1e-4])).toBe('vec4(0.25, 1.0, -0.5, 0.0001)');
  });

  it('never rounds sub-cent precision away', () => {
    expect(vec3Str([0.125, 0.001, 0.999])).toBe('vec3(0.125, 0.001, 0.999)');
    expect(formatGlslLiteral([0.125, 0.001, 0.999], 'vec3')).toBe('vec3(0.125, 0.001, 0.999)');
  });
});
