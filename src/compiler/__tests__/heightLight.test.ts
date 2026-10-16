/**
 * Height Light (nodes/definitions/heightLight.ts, docs/height-light.md): its emitted GLSL, run on the CPU
 * (glslEval.ts) on a plane rising to the right, gives the plane's normal, a shade of dot(normal, sun), the
 * height through Range, and Low→High colour lit by it; it compiles from a field (noise) and from a texture
 * (a Trail field's Image); unwired it draws nothing.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Env, type Val } from './glslEval';

const def = () => getNodeDefinition('heightLight')!;

describe('Height Light on the CPU', () => {
  // A plane: height = 2·x (picture units), read at g_uv.
  const plane: Env = { fieldfn_p_v: (q: Val) => 2 * (q as number[])[0], g_uv: [0.25, 0.1], u_resolution: [1280, 720] };
  function light(params: Record<string, unknown>) {
    const node = n('heightLight', 'H', 0, 0, params);
    const { code, outputVars } = def().generateGLSL(node, { height: 'fieldfn_p_v' });
    const out = runGlsl(code, plane);
    return Object.fromEntries(Object.entries(outputVars).map(([k, v]) => [k, out[v]])) as Record<string, Val>;
  }
  it('finds the slope and the normal of a plane, and shades it by the sun', () => {
    // Range 0..1, Relief 0.5: slope = 2 × 0.5 = 1 across, 0 up.
    const r = light({ low: 0, high: 1, relief: 0.5, sunAngle: 180, sunHeight: 45, ambient: 0 });
    const g = r.slope as number[];
    expect(g[0]).toBeCloseTo(1, 4); expect(g[1]).toBeCloseTo(0, 6);
    const nrm = r.normal as number[];
    expect(nrm[0]).toBeCloseTo(-Math.SQRT1_2, 4); expect(nrm[2]).toBeCloseTo(Math.SQRT1_2, 4);
    // Sun from the left (180°), 45° up: it faces the slope head-on.
    expect(r.shade as number).toBeCloseTo(1, 4);
    // From the right, it lights the slope at grazing angle: 0.
    expect(light({ low: 0, high: 1, relief: 0.5, sunAngle: 0, sunHeight: 45, ambient: 0 }).shade as number).toBeCloseTo(0, 4);
  });
  it('Height runs through Range; the colour is Low→High by it, lit with Ambient', () => {
    // height = 2 × 0.25 = 0.5; Range 0..2 → 0.25.
    const r = light({ low: 0, high: 2, relief: 0, ambient: 0.5, lowColour: [0, 0, 0], highColour: [1, 1, 1] });
    expect(r.height as number).toBeCloseTo(0.25, 5);
    // Flat (Relief 0): normal straight out, shade = sin(sun height 35°).
    const shade = Math.sin(35 * Math.PI / 180);
    (r.color as number[]).forEach(c => expect(c).toBeCloseTo(0.25 * (0.5 + 0.5 * shade), 4));
  });
});

describe('Height Light compiles', () => {
  it('from a field (noise) and from a Trail field\'s Image, each channel or brightness', () => {
    const field = compileGraph({ nodes: [
      n('noiseFloat', 'nz', 0, 0, {}),
      n('heightLight', 'hl', 300, 0, {}, { height: ['nz', 'value'] }),
      n('output', 'o', 600, 0, {}, { color: ['hl', 'color'] }),
    ] });
    expect(field.errors, JSON.stringify(field.errors)).toBeUndefined();
    expect(field.fragmentShader).toMatch(/fieldfn_\w+\(/);
    for (const channel of ['1', '4', 'bright']) {
      const tex = compileGraph({ nodes: [
        n('textureInput', 'tx', 0, 0, {}),
        n('heightLight', 'hl', 300, 0, { channel }, { texture: ['tx', 'texture'] }),
        n('output', 'o', 600, 0, {}, { color: ['hl', 'color'] }),
      ] });
      expect(tex.errors, JSON.stringify(tex.errors)).toBeUndefined();
    }
  });
  it('unwired, it draws nothing', () => {
    const { code } = def().generateGLSL(n('heightLight', 'hl', 0, 0, {}), {});
    expect(code).toContain('vec3 hl_c = vec3(0.0)');
  });
});
