import { describe, it, expect } from 'vitest';
import { presetPreviewShader, presetRoles, thumbnailKey, type PresetLike } from '../presetPreview';
import type { CustomFnPreset } from '../../types/customFnPreset';

const SD: PresetLike = {
  inputs: [{ name: 'p', type: 'vec2' }, { name: 'r', type: 'float' }], outputType: 'float',
  body: 'sdCircle(p, r)', glslFunctions: 'float sdCircle(vec2 p, float r) { return length(p) - r; }',
};

describe('thumbnail cache keys', () => {
  const full: CustomFnPreset = { ...SD, id: 'cfp_1', label: 'Circle', comment: 'a circle', savedAt: 1 } as CustomFnPreset;
  it('ignore what doesn’t change the picture', () => {
    const k = thumbnailKey(full, 44);
    expect(thumbnailKey({ ...full, id: 'cfp_2', label: 'Renamed', comment: 'other', savedAt: 99 } as CustomFnPreset, 44)).toBe(k);
  });
  it('change with the code, inputs, output, bindings and size', () => {
    const k = thumbnailKey(SD, 44);
    expect(thumbnailKey({ ...SD, body: 'sdCircle(p, r * 2.0)' }, 44)).not.toBe(k);
    expect(thumbnailKey({ ...SD, glslFunctions: SD.glslFunctions.replace('- r', '- r * 0.5') }, 44)).not.toBe(k);
    expect(thumbnailKey({ ...SD, inputs: [{ name: 'q', type: 'vec2' }, SD.inputs[1]] }, 44)).not.toBe(k);
    expect(thumbnailKey({ ...SD, preview: { bindings: [{ kind: 'uv01', value: [] }, { kind: 'const', value: [0.3] }], returnRole: 'distance' } }, 44)).not.toBe(k);
    expect(thumbnailKey(SD, 112)).not.toBe(k);
  });
});

describe('preset preview shader', () => {
  it('guesses roles from the helper a plain-call body calls, and paints a distance as a signed field', () => {
    const r = presetRoles(SD);
    expect(r.roles.map(x => x.role)).toEqual(['position', 'scale']);
    expect(r.returnRole).toBe('distance');
    const src = presetPreviewShader(SD)!;
    expect(src).toContain('float pv_preset(vec2 p, float r)');
    expect(src).toContain('return sdCircle(p, r);');
    expect(src).toContain('float pv_v = pv_preset(pv_uv, 1.0);');
    expect(src).toContain('vec3(1.0, 0.6, 0.25)');
  });
  it('uses the bindings saved by discovery', () => {
    const src = presetPreviewShader({ ...SD, preview: { bindings: [{ kind: 'uv01', value: [] }, { kind: 'const', value: [0.3] }], returnRole: 'distance' } })!;
    expect(src).toContain('pv_preset(pv_uv01, 0.3)');
  });
  it('wraps a block body with its own returns, paints a colour as colour, and refuses what it can’t draw', () => {
    const block: PresetLike = { inputs: [{ name: 't', type: 'float' }], outputType: 'vec3', body: 'vec3 c = 0.5 + 0.5 * cos(t + vec3(0.0, 2.0, 4.0));\nreturn c;', glslFunctions: '' };
    const src = presetPreviewShader(block)!;
    expect(src).toContain('return c;');
    expect(src).toContain('return vec3(0.0);');
    expect(src).toContain('vec3 col = clamp(pv_v, 0.0, 1.0);');
    expect(presetPreviewShader({ ...block, outputType: 'mat2' as never })).toBeNull();
    expect(presetPreviewShader({ ...block, inputs: [{ name: 'm', type: 'mat2' as never }] })).toBeNull();
  });
});
