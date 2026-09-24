import { describe, expect, it } from 'vitest';
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';

type Conn = { nodeId: string; outputKey: string };
function mk(id: string, type: string, x: number, params: Record<string, unknown> = {}, wires: Record<string, Conn> = {}): GraphNode {
  const def = getNodeDefinition(type)!;
  const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label, ...(wires[k] ? { connection: wires[k] } : {}) }]));
  const outputs = Object.fromEntries(Object.entries(def.outputs).map(([k, s]) => [k, { type: s.type, label: s.label }]));
  return { id, type, position: { x, y: 0 }, inputs, outputs, params: { ...(def.defaultParams ?? {}), ...params } };
}
const compileOk = (nodes: GraphNode[]) => { const r = compileGraph({ nodes }); expect(r.success, r.errors?.join('; ')).toBe(true); return r.fragmentShader; };

describe('pattern nodes', () => {
  it('SDF Glow has a Tinted output: glow × tint, wired straight to Output', () => {
    const fs = compileOk([
      mk('uv', 'uv', 0), mk('c', 'circleSDF', 100, {}, { position: { nodeId: 'uv', outputKey: 'uv' } }),
      mk('g', 'light', 200, { tint: [1, 0.5, 0.2] }, { distance: { nodeId: 'c', outputKey: 'distance' } }),
      mk('o', 'output', 300, {}, { color: { nodeId: 'g', outputKey: 'tinted' } }),
    ]);
    expect(fs).toMatch(/_glow_tinted = u_p_\w+_tint \* \w+_glow;/);
  });

  it('Palette applies Scale to Angle and Speed to the offset', () => {
    const fs = compileOk([
      mk('uv', 'uv', 0), mk('t', 'time', 0), mk('l', 'length', 100, {}, { input: { nodeId: 'uv', outputKey: 'uv' } }),
      mk('p', 'palette', 200, { scale: 3, speed: 0.5 }, { value: { nodeId: 'l', outputKey: 'output' }, anim: { nodeId: 't', outputKey: 'time' } }),
      mk('o', 'output', 300, {}, { color: { nodeId: 'p', outputKey: 'color' } }),
    ]);
    // scale and speed are live sliders, so they arrive as uniforms
    expect(fs).toMatch(/palette\(\(\w+_output \* u_p_\w+_scale \+ \w+_time \* u_p_\w+_speed\)/);
  });

  it('Noise Float remaps its Value into Out Min…Out Max', () => {
    const fs = compileOk([
      mk('uv', 'uv', 0), mk('n', 'noiseFloat', 100, { outMin: 0.2, outMax: 0.6 }, { uv: { nodeId: 'uv', outputKey: 'uv' } }),
      mk('c', 'circleSDF', 200, {}, { position: { nodeId: 'uv', outputKey: 'uv' }, radius: { nodeId: 'n', outputKey: 'value' } }),
      mk('o', 'output', 300, {}, { color: { nodeId: 'c', outputKey: 'distance' } }),
    ]);
    expect(fs).toMatch(/_value\s+= mix\(u_p_\w+_outMin, u_p_\w+_outMax, \w+_raw\)/);
  });

  it('Glow to Color, Normal to Color and Rotation Matrix compile and emit their formulas', () => {
    const mul = getNodeDefinition('mat2MulVec')!;
    const mKey = Object.entries(mul.inputs).find(([, s]) => s.type === 'mat2')![0];
    const vKey = Object.entries(mul.inputs).find(([, s]) => s.type === 'vec2')![0];
    const outKey = Object.keys(mul.outputs)[0];
    const fs = compileOk([
      mk('uv', 'uv', 0), mk('t', 'time', 0),
      mk('rot', 'rotationMatrix', 50, { axis: 'y' }, { angle: { nodeId: 't', outputKey: 'time' } }),
      mk('mv', 'mat2MulVec', 100, {}, { [mKey]: { nodeId: 'rot', outputKey: 'mat2' }, [vKey]: { nodeId: 'uv', outputKey: 'uv' } }),
      mk('c', 'circleSDF', 150, {}, { position: { nodeId: 'mv', outputKey: outKey } }),
      mk('g', 'glowToColor', 200, { exposure: 2 }, { glow: { nodeId: 'c', outputKey: 'distance' } }),
      mk('n', 'normalToColor', 250, {}, { v: { nodeId: 'g', outputKey: 'color' } }),
      mk('o', 'output', 300, {}, { color: { nodeId: 'n', outputKey: 'color' } }),
    ]);
    expect(fs).toContain('mat2(');
    expect(fs).toMatch(/\* tanh\(clamp\(\w+ \* u_p_\w+_exposure, 0\.0, 40\.0\)\)/);
    expect(fs).toMatch(/_color = \w+_color \* 0\.5 \+ 0\.5;/);
  });

  it('Fresnel and Phase HG compute cos θ from wired vectors', () => {
    const fresnel = getNodeDefinition('fresnelSchlick')!;
    const r = fresnel.generateGLSL({ id: 'f', type: 'fresnelSchlick', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { ior: 1.5 } }, { normal: 'n_normal', rayDir: 'cam_rd' });
    expect(r.code).toContain('dot(normalize(n_normal), -normalize(cam_rd))');
    const phase = getNodeDefinition('phaseHG')!;
    const r2 = phase.generateGLSL({ id: 'h', type: 'phaseHG', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { g: 0.5 } }, { rayDir: 'cam_rd', lightDir: 'sun' });
    expect(r2.code).toContain('dot(-normalize(cam_rd), normalize(sun))');
    // Without the vectors, the cos θ socket still drives it
    expect(phase.generateGLSL({ id: 'h', type: 'phaseHG', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} }, { cosTheta: 'ct' }).code).toContain('clamp(ct, -1.0, 1.0)');
  });

  it('Volume Glow is finite at d = 0 and hollows with Shell', () => {
    const vg = getNodeDefinition('volumeGlow')!;
    const r = vg.generateGLSL({ id: 'v', type: 'volumeGlow', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { density: 0.05, falloff: 10, shell: 0.1 } }, { dist: 'sd_raw' });
    expect(r.code).toContain('0.1 > 0.0 ? abs(sd_raw) - 0.1 : sd_raw');
    expect(r.code).toContain('0.05 / (1.0 + 10.0 * max(v_sd, 0.0))');
  });
});
