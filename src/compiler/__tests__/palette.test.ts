import { describe, expect, it } from 'vitest';
import { compileGraph } from '../graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { migrateNodeParams } from '../../types/nodeGraph';
import { upgradeLegacyNode } from '../../store/legacyLabels';

const uv: GraphNode = { id: 'n1', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} };
const out = (from: string): GraphNode => ({ id: 'n9', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: from, outputKey: 'color' } } }, outputs: {}, params: {} });
const paletteLine = (fs: string) => fs.split('\n').find(l => l.includes('= palette('))!;

describe('Palette', () => {
  it('unwired vec3 sockets fall back to the colour params', () => {
    const def = getNodeDefinition('palette')!;
    const pal: GraphNode = {
      id: 'n2', type: 'palette', position: { x: 200, y: 0 },
      inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label }])),
      outputs: { color: { type: 'vec3', label: 'Color' } },
      params: { ...def.defaultParams, phase: [0.1, 0.2, 0.3] },
    };
    const r = compileGraph({ nodes: [uv, pal, out("n2")] } as never);
    expect(r.success).toBe(true);
    // Colour params are live vec3 uniforms (audit D8): the line reads the uniform, which carries the value.
    const phaseUniform = r.paramBindings['n2::phase'];
    expect(phaseUniform).toMatch(/^u_p_\w+_phase$/);
    expect(paletteLine(r.fragmentShader!)).toContain(phaseUniform);
    expect(r.paramUniforms[phaseUniform]).toEqual([0.1, 0.2, 0.3]);
    expect(r.fragmentShader).toContain(`uniform vec3 ${phaseUniform};`);
  });

  it('migrates a legacy node: unwired per-channel sockets go, a wired one still drives its channel', () => {
    const legacy: GraphNode = {
      id: 'n2', type: 'palette', position: { x: 200, y: 0 },
      inputs: {
        value: { type: 'float', label: 'Value' }, anim: { type: 'float', label: 'Time' },
        offset_r: { type: 'float', label: 'offset.r' }, offset_g: { type: 'float', label: 'offset.g' }, offset_b: { type: 'float', label: 'offset.b' },
        phase_g: { type: 'float', label: 'phase.g', connection: { nodeId: 't', outputKey: 'time' } },
      },
      outputs: { color: { type: 'vec3', label: 'Color' } },
      params: { value: 0, anim: 0, offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0, 0.33, 0.67] },
    };
    const time: GraphNode = { id: 't', type: 'time', position: { x: 0, y: 200 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} };
    const up = migrateNodeParams(upgradeLegacyNode(legacy), getNodeDefinition);
    expect(Object.keys(up.inputs).sort()).toEqual(['amplitude', 'anim', 'freq', 'offset', 'phase', 'phase_g', 'value']);
    expect(up.inputs.value.label).toBe('Angle');
    const r = compileGraph({ nodes: [uv, time, up, out("n2")] } as never);
    expect(r.success).toBe(true);
    // The wired channel drives .y; the other two come from the (live uniform) phase param.
    const phaseUniform = r.paramBindings['n2::phase'];
    expect(phaseUniform).toMatch(/^u_p_\w+_phase$/);
    expect(paletteLine(r.fragmentShader!)).toMatch(new RegExp(`vec3\\(${phaseUniform}\\.x,\\w+_time,${phaseUniform}\\.z\\)`));
  });
});
