/** The Convert page's canvas switcher (convertView.ts): which view can show, what the main canvas renders, and the source's own uniforms pinned. */
import { describe, expect, it } from 'vitest';
import { VIEW_OPTIONS, effectiveView, rawShaderFor, withUniformConsts } from '../convertView';
import type { ConvertedUniform } from '../../../glslToGraph';

const u = (name: string, type: ConvertedUniform['type'], value: number | number[]): ConvertedUniform => ({ name, type, value, min: 0, max: 1, step: 0.01, colour: false });

describe('the switcher', () => {
  it('offers Source, Converted and Split', () => {
    expect(VIEW_OPTIONS.map(o => o.value)).toEqual(['source', 'converted', 'split']);
  });

  it('shows only the source while there is no converted graph, and the chosen view once there is', () => {
    expect(effectiveView('split', false)).toBe('source');
    expect(effectiveView('converted', false)).toBe('source');
    expect(effectiveView('split', true)).toBe('split');
    expect(effectiveView('converted', true)).toBe('converted');
  });

  it('puts the source on the main canvas for Source and lets the graph render otherwise', () => {
    expect(rawShaderFor('source', 'void main(){}', true)).toBe('void main(){}');
    expect(rawShaderFor('converted', 'void main(){}', true)).toBeNull();
    expect(rawShaderFor('split', 'void main(){}', true)).toBeNull();
    // No graph yet: the source, whatever was chosen.
    expect(rawShaderFor('split', 'void main(){}', false)).toBe('void main(){}');
  });
});

describe('withUniformConsts', () => {
  const src = 'uniform vec2 u_resolution;\nuniform float speed;\nuniform highp int steps;\nuniform vec3 tint;\nuniform vec2 off;\nvoid main(){}';

  it('pins the shader’s own uniforms to their starting values and leaves the rest', () => {
    const out = withUniformConsts(src, [u('speed', 'float', 2), u('steps', 'int', 3.2), u('tint', 'vec3', [0.5, 0.25, 1]), u('off', 'vec2', [1, 0.5])]);
    expect(out).toContain('const float speed = 2.0;');
    expect(out).toContain('const int steps = 3;');
    expect(out).toContain('const vec3 tint = vec3(0.5, 0.25, 1.0);');
    expect(out).toContain('const vec2 off = vec2(1.0, 0.5);');
    expect(out).toContain('uniform vec2 u_resolution;');
    expect(out).not.toContain('uniform float speed');
  });

  it('is the source itself with nothing to pin', () => {
    expect(withUniformConsts(src, undefined)).toBe(src);
    expect(withUniformConsts(src, [])).toBe(src);
    expect(withUniformConsts(src, [u('missing', 'float', 1)])).toBe(src);
  });
});
