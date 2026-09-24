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
const c = (nodeId: string, outputKey: string): Conn => ({ nodeId, outputKey });

describe('nodes from the FragCoord / GM Shaders articles', () => {
  it('SDF Glow: haze and bounded falloffs, and an inner glow output', () => {
    const light = getNodeDefinition('light')!;
    const n = (mode: string) => ({ id: 'g', type: 'light', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { mode, brightness: 5, innerFalloff: 12, tint: [1, 1, 1] } });
    expect(light.generateGLSL(n('haze'), { distance: 'd' }).code).toContain('1.0 / (1.0 + clamp(5.0, 0.1, 100.0) * max(d, 0.0) * max(d, 0.0))');
    expect(light.generateGLSL(n('bounded'), { distance: 'd' }).code).toContain('smoothstep(1.0 / clamp(5.0, 0.1, 100.0), 0.0, max(d, 0.0))');
    const r = light.generateGLSL(n('glow'), { distance: 'd' });
    expect(r.code).toContain('g_glow_inner = exp(-clamp(12.0, 0.1, 100.0) * max(-(d), 0.0)) * step(d, 0.0)');
    expect(r.outputVars.inner).toBe('g_glow_inner');
  });

  it('CRT Screen feeds CRT Mask and both compile', () => {
    const fs = compileOk([
      mk('uv', 'uv', 0), mk('t', 'time', 0),
      mk('crt', 'crtScreen', 100, { curvature: 0.08, cellSize: 5 }, { uv: c('uv', 'uv') }),
      mk('n', 'fbm', 200, {}, { uv: c('crt', 'uv'), time: c('t', 'time') }),
      mk('pal', 'palette', 300, {}, { value: c('n', 'value') }),
      mk('mask', 'crtMask', 400, { cellSize: 5, scanlines: 0.3 }, { color: c('pal', 'color'), uv: c('uv', 'uv'), vignette: c('crt', 'vignette') }),
      mk('o', 'output', 500, {}, { color: c('mask', 'result') }),
    ]);
    expect(fs).toContain('crtMaskFn(');
    expect(fs).toMatch(/pow\(\w+_edge\.x \* \w+_edge\.y, u_p_\w+_vignettePower\)/);
  });

  it('Lens Distortion is the Brown–Conrady radial model', () => {
    const fs = compileOk([
      mk('uv', 'uv', 0), mk('lens', 'lensDistortion', 100, { k1: 0.2, k2: -0.1, zoom: 1.06 }, { input: c('uv', 'uv') }),
      mk('cir', 'circleSDF', 200, {}, { position: c('lens', 'output') }),
      mk('o', 'output', 300, {}, { color: c('cir', 'distance') }),
    ]);
    expect(fs).toMatch(/\* \(1\.0 \+ u_p_\w+_k1 \* \w+_r2 \+ u_p_\w+_k2 \* \w+_r2 \* \w+_r2\) \/ u_p_\w+_zoom/);
  });

  it('SDF Fill anti-aliases by one pixel with fwidth unless Softness is chosen', () => {
    const fill = getNodeDefinition('sdfFill')!;
    const base = { id: 'f', type: 'sdfFill', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { strokeWidth: 0, antialias: 0.01, strokeAlign: 'center' } };
    expect(fill.generateGLSL({ ...base, params: { ...base.params, aaMode: 'pixel' } }, { d: 'd' }).code).toContain('fwidth(f_d)');
    expect(fill.generateGLSL({ ...base, params: { ...base.params, aaMode: 'fixed' } }, { d: 'd' }).code).not.toContain('fwidth');
  });

  it('Noise Float has a Perlin mode with its own gradient-noise helper', () => {
    const fs = compileOk([
      mk('uv', 'uv', 0), mk('n', 'noiseFloat', 100, { mode: 'perlin' }, { uv: c('uv', 'uv') }),
      mk('o', 'output', 200, {}, { color: c('n', 'value') }),
    ]);
    expect(fs).toContain('perlinNoise2(');
    expect(fs).toContain('float perlinNoise2(vec2 p)');
  });

  it('OkLab Mix linearises sRGB, blends in LMS space and returns sRGB', () => {
    const fs = compileOk([
      mk('uv', 'uv', 0), mk('l', 'length', 100, {}, { input: c('uv', 'uv') }),
      mk('m', 'oklabMix', 200, {}, { t: c('l', 'output') }),
      mk('o', 'output', 300, {}, { color: c('m', 'result') }),
    ]);
    expect(fs).toMatch(/oklabMixFn\(pow\(max\(u_p_\w+_a, 0\.0\), vec3\(2\.2\)\), pow\(max\(u_p_\w+_b, 0\.0\), vec3\(2\.2\)\), clamp\(\w+_output, 0\.0, 1\.0\), u_p_\w+_midGain\)/);
    expect(fs).toMatch(/pow\(max\(\w+_lin, 0\.0\), vec3\(1\.0 \/ 2\.2\)\)/);
  });
});
