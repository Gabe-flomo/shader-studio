/**
 * Sense's Smell and Crowding (nodes/definitions/agents.ts), and Trail field's Channel names: Smell picks
 * the channel weights without a code block; Crowding Limit turns readings r into r · e^(−r / limit); a
 * Trail field's channel outputs take its names.
 */
import { describe, expect, it } from 'vitest';
import { getNodeDefinition } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Val } from './glslEval';

const sense = (params: Record<string, unknown>, inputs: Record<string, string> = {}) =>
  getNodeDefinition('agentSense')!.generateGLSL(n('agentSense', 'S', 0, 0, params), inputs);

describe('Sense', () => {
  it('Smell: one channel, all, or own species (Channels wired overrides it)', () => {
    expect(sense({ smell: 'ch3' }, { texture: 'u_tex' }).code).toContain('vec4(0.0, 0.0, 1.0, 0.0)');
    expect(sense({ smell: 'all' }, { texture: 'u_tex' }).code).toContain('vec4(1.0)');
    expect(sense({}, { texture: 'u_tex' }).code).toContain('a_ownChannels');
    expect(sense({ smell: 'ch3' }, { texture: 'u_tex', channels: 'myWeights' }).code).not.toContain('vec4(0.0, 0.0, 1.0, 0.0)');
  });
  it('Crowding Limit: readings r become r · e^(−r / limit); Off leaves them', () => {
    const field = { fieldfn_f_v: (): Val => 120, a_pos: [0, 0], a_heading: 0, agDir: (a: Val) => [Math.cos(a as number), Math.sin(a as number)] };
    const on = sense({ crowding: 'limit', crowd: 60, weight: 1 }, { field: 'fieldfn_f_v' });
    const r = runGlsl(on.code, field)[on.outputVars.readings] as number[];
    r.forEach(x => expect(x).toBeCloseTo(120 * Math.exp(-2), 4));
    const off = sense({ weight: 1 }, { field: 'fieldfn_f_v' });
    (runGlsl(off.code, field)[off.outputVars.readings] as number[]).forEach(x => expect(x).toBeCloseTo(120, 6));
  });
  it('its texture socket is called Texture', () => {
    expect(getNodeDefinition('agentSense')!.inputs.texture.label).toBe('Texture');
  });
});

describe('Trail field Channel names', () => {
  it('name its channel outputs; blanks stay Channel N', () => {
    const t = n('trailField', 'T', 0, 0, { names: 'grass, , prey scent' });
    expect(['ch1', 'ch2', 'ch3', 'ch4'].map(k => t.outputs[k].label)).toEqual(['grass', 'Channel 2', 'prey scent', 'Channel 4']);
  });
});
