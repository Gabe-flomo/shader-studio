import { describe, expect, it } from 'vitest';
import { getNodeDefinition } from '../../../nodes/definitions';
import { suggestQuickAdds } from '../quickAdds';

describe('suggestQuickAdds', () => {
  it('feeds a float input with Time, an LFO and a slider', () => {
    expect(suggestQuickAdds({ type: 'float', dir: 'in', label: 'Radius' }).map(q => q.type)).toEqual(['time', 'lfo', 'constant']);
  });

  it('reads the socket label: a Time input gets BPM Sync, a Center input gets the mouse', () => {
    expect(suggestQuickAdds({ type: 'float', dir: 'in', label: 'Time' }).map(q => q.type)).toEqual(['time', 'bpmSync', 'lfo']);
    expect(suggestQuickAdds({ type: 'vec2', dir: 'in', label: 'Center' }).map(q => q.type)).toEqual(['mouse', 'vec2Const', 'uv']);
    expect(suggestQuickAdds({ type: 'vec2', dir: 'in', label: 'UV' }).map(q => q.type)).toEqual(['uv', 'pixelUV', 'mouse']);
  });

  it('treats a vec3 input as a colour, unless it is a position or normal', () => {
    expect(suggestQuickAdds({ type: 'vec3', dir: 'in', label: 'Color A' }).map(q => q.type)).toEqual(['colorPicker', 'palette', 'colorRamp']);
    expect(suggestQuickAdds({ type: 'vec3', dir: 'in', label: 'Position' })).toEqual([]);
  });

  it('sends a distance output to SDF colourers and any other float to a colour', () => {
    expect(suggestQuickAdds({ type: 'float', dir: 'out', label: 'Distance' }).map(q => q.type)).toEqual(['sdfFill', 'glowLayer', 'sdfColorize']);
    expect(suggestQuickAdds({ type: 'float', dir: 'out', label: 'Value' }).map(q => q.type)).toEqual(['floatToVec3', 'palette', 'colorRamp']);
    expect(suggestQuickAdds({ type: 'vec2', dir: 'out', label: 'UV' }).map(q => q.type)).toEqual(['circleSDF', 'fbm', 'gradient']);
    expect(suggestQuickAdds({ type: 'vec3', dir: 'out', label: 'Color' }).map(q => q.type)).toEqual(['brightnessContrast', 'vignette', 'blendModes']);
  });

  it('only names sockets that exist on the definition, with the right direction', () => {
    for (const dir of ['in', 'out'] as const) {
      for (const type of ['float', 'vec2', 'vec3']) {
        for (const label of ['Time', 'Center', 'Distance', 'Color', 'Value']) {
          for (const q of suggestQuickAdds({ type, dir, label })) {
            const def = getNodeDefinition(q.type)!;
            const socket = dir === 'in' ? def.outputs[q.key] : def.inputs[q.key];
            expect(socket, `${q.type}.${q.key}`).toBeDefined();
            expect(q.label).toBe(def.label);
          }
        }
      }
    }
  });

  it('offers nothing for types it has no opinion on', () => {
    expect(suggestQuickAdds({ type: 'scene3d', dir: 'in' })).toEqual([]);
    expect(suggestQuickAdds({ type: 'mat3', dir: 'out' })).toEqual([]);
  });
});
