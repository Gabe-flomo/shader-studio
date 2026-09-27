/**
 * The math nodes the GLSL → nodes converter's phase 2 leans on: the Exact switch on the guarded
 * nodes (off by default, so hand-built graphs keep their guards), the type-generic versions, Make
 * Vec4 and the general Swizzle.
 */
import { describe, it, expect } from 'vitest';
import { getNodeDefinition } from '../definitions';
import { swizzleTypes } from '../definitions/math';
import type { GraphNode } from '../../types/nodeGraph';

const node = (type: string, params: Record<string, unknown> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  return { id: 'n', type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { ...(def.defaultParams ?? {}), ...params } } as GraphNode;
};
const glsl = (type: string, params: Record<string, unknown>, inputs: Record<string, string>) => getNodeDefinition(type)!.generateGLSL(node(type, params), inputs).code.trim();

describe('the Exact switch', () => {
  it('is off for a new card: Divide, Pow and Square Root keep their guards', () => {
    for (const t of ['divide', 'pow', 'sqrt']) expect(getNodeDefinition(t)!.defaultParams!.exact).toBe(false);
    expect(glsl('divide', {}, { a: 'a', b: 'b' })).toBe('float n_result = a / max(b, 0.0001);');
    expect(glsl('pow', {}, { base: 'x', exponent: 'e' })).toBe('float n_result = pow(max(x, 0.0), e);');
    expect(glsl('sqrt', {}, { input: 'x' })).toBe('float n_output = sqrt(max(x, 0.0));');
  });
  it('on, each is the plain GLSL call', () => {
    expect(glsl('divide', { exact: true, outputType: 'vec3' }, { a: 'a', b: 'b' })).toBe('vec3 n_result = a / b;');
    expect(glsl('pow', { exact: true }, { base: 'x', exponent: 'e' })).toBe('float n_result = pow(x, e);');
    expect(glsl('sqrt', { exact: true }, { input: 'x' })).toBe('float n_output = sqrt(x);');
  });
  it('shows on the card', () => {
    for (const t of ['divide', 'pow', 'sqrt']) expect(getNodeDefinition(t)!.paramDefs!.exact).toMatchObject({ label: 'Exact', type: 'bool' });
  });
});

describe('type-generic math', () => {
  it('abs, min and max follow the card type; length and dot take any vector, vec2 when unset', () => {
    expect(glsl('abs', { outputType: 'vec4' }, { input: 'v' })).toBe('vec4 n_output = abs(v);');
    expect(glsl('minMath', { outputType: 'vec3', b: 0.5 }, { a: 'v' })).toBe('vec3 n_result = min(v, 0.5);');
    expect(glsl('length', { outputType: undefined }, {})).toBe('float n_output = length(vec2(0.0)) * 1.0;');
    expect(glsl('dot', { outputType: 'vec3' }, { a: 'p', b: 'q' })).toBe('float n_result = dot(p, q);');
  });
  it('Make Vec4 has a slider per component, W at 1', () => {
    expect(glsl('makeVec4', {}, { x: 'r' })).toBe('vec4 n_xyzw = vec4(r, 0.0, 0.0, 1.0);');
  });
});

describe('Swizzle', () => {
  it('any pattern of up to four letters, as wide as the pattern', () => {
    expect(glsl('swizzle', { inputType: 'vec2', pattern: 'xyx' }, { input: 'u' })).toBe('vec3 n_output = (u).xyx;');
    expect(glsl('swizzle', { inputType: 'vec4', pattern: 'bgr' }, { input: 'c' })).toBe('vec3 n_output = (c).zyx;');
    expect(swizzleTypes(node('swizzle', { inputType: 'vec4', pattern: 'zwxy' }))).toEqual({ input: 'vec4', output: 'vec4' });
    expect(swizzleTypes(node('swizzle', { inputType: 'vec3', pattern: 'y' }))).toEqual({ input: 'vec3', output: 'float' });
  });
  it('a pattern that reaches past its input passes the input through instead of breaking the shader', () => {
    expect(glsl('swizzle', { inputType: 'vec2', pattern: 'xz' }, { input: 'u' })).toBe('vec2 n_output = u;');
  });
});
