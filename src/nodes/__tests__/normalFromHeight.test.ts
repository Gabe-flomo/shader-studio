/**
 * Normal from Height (nodes/definitions/normalFromHeight.ts, docs/normal-from-height.md): its emitted GLSL, run on
 * the CPU (compiler/__tests__/glslEval.ts) on a plane, gives the plane's slope, normal and Blinn-Phong light; a
 * wired chain that can be a function is read on four sides of the point (the field function called at offsets),
 * one that can't (it reads the previous frame) falls back to dFdx / dFdy of the value; every Mode compiles from
 * noise, FBM and a picture.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));

import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../definitions';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Env, type Val } from '../../compiler/__tests__/glslEval';
import type { GraphNode } from '../../types/nodeGraph';

const def = () => getNodeDefinition('normalFromHeight')!;
const pow = (a: Val, b: Val) => (Array.isArray(a) ? a.map(x => Math.pow(x, b as number)) : Math.pow(a as number, b as number));

describe('Normal from Height on the CPU', () => {
  // A plane rising to the right: height = 2·x (picture units), read at g_uv.
  const env = (): Env => ({ fieldfn_p_v: (q: Val) => 2 * (q as number[])[0], g_uv: [0.25, 0.1], u_resolution: [1280, 720], pow });
  function run(params: Record<string, unknown>) {
    const node = n('normalFromHeight', 'N', 0, 0, params);
    const { code, outputVars } = def().generateGLSL(node, { height: 'fieldfn_p_v' });
    const out = runGlsl(code, env());
    return Object.fromEntries(Object.entries(outputVars).map(([k, v]) => [k, out[v]])) as Record<string, Val>;
  }

  it('finds the slope of a plane, and its normal from Strength', () => {
    const r = run({ strength: 0.5 });
    const g = r.slope as number[];
    expect(g[0]).toBeCloseTo(2, 4); expect(g[1]).toBeCloseTo(0, 6);
    // Normal = normalize(−slope × Strength, 1) = normalize(−1, 0, 1).
    const nrm = r.normal as number[];
    expect(nrm[0]).toBeCloseTo(-Math.SQRT1_2, 4); expect(nrm[1]).toBeCloseTo(0, 6); expect(nrm[2]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(Math.hypot(...nrm)).toBeCloseTo(1, 6);
  });

  it('Invert turns the slope round', () => {
    expect((run({ strength: 0.5, invert: true }).slope as number[])[0]).toBeCloseTo(-2, 4);
  });

  it('lights it: full from a lamp facing the slope, Ambient only from behind; the highlight adds on', () => {
    // The slope faces left and up 45°: a lamp from the left (180°) at 45° faces it head-on.
    const facing = run({ strength: 0.5, lightAngle: 180, lightHeight: 45, ambient: 0, specular: 0 });
    expect(facing.shaded as number).toBeCloseTo(1, 4);
    const behind = run({ strength: 0.5, lightAngle: 0, lightHeight: 45, ambient: 0.25, specular: 0 });
    expect(behind.shaded as number).toBeCloseTo(0.25, 4);
    // Flat (Strength 0), lamp straight in front: the highlight is at its peak, Specular on top of full light.
    const flat = run({ strength: 0, lightHeight: 90, ambient: 0, specular: 0.5, lightColour: [1, 1, 1], mode: 'lit' });
    (flat.colour as number[]).forEach(c => expect(c).toBeCloseTo(1.5, 4));
  });

  it('Mode picks the Colour output: the normal or the slope as colour', () => {
    const nc = run({ strength: 0.5, mode: 'normal' }).colour as number[];
    expect(nc[0]).toBeCloseTo(0.5 - Math.SQRT1_2 / 2, 4); expect(nc[2]).toBeCloseTo(0.5 + Math.SQRT1_2 / 2, 4);
    const sc = run({ strength: 0.5, mode: 'slope' }).colour as number[];
    expect(sc[0]).toBeCloseTo(1, 4); expect(sc[1]).toBeCloseTo(0.5, 4); expect(sc[2]).toBe(0.5);
  });
});

describe('Normal from Height\'s GLSL', () => {
  it('a field: the function is called on four sides of the point, Sample distance pixels apart, no dFdx', () => {
    const { code } = def().generateGLSL(n('normalFromHeight', 'N', 0, 0, {}), { height: 'fieldfn_f_value', uv: 'myUv' });
    expect(code).toContain('vec2 N_q = myUv;');
    expect(code).toMatch(/float N_e = max\(1\.0, 0\.01\) \* 2\.0 \/ u_resolution\.y;/);
    for (const off of ['vec2(N_e, 0.0)', 'vec2(-N_e, 0.0)', 'vec2(0.0, N_e)', 'vec2(0.0, -N_e)']) {
      expect(code).toContain(`fieldfn_f_value(N_q + ${off}, vec2(0.0), 1.0, 0.0)`);
    }
    expect(code).not.toContain('dFdx');
  });

  it('a plain value: the slope from dFdx / dFdy on screen', () => {
    const { code } = def().generateGLSL(n('normalFromHeight', 'N', 0, 0, {}), { height: 'lum_0_result' });
    expect(code).toContain('float N_h = lum_0_result;');
    expect(code).toContain('vec2(dFdx(N_h), dFdy(N_h))');
    expect(code).not.toContain('fieldfn_');
  });

  it('unwired: a flat surface facing the screen', () => {
    const { code } = def().generateGLSL(n('normalFromHeight', 'N', 0, 0, {}), {});
    expect(code).toContain('vec2 N_g = vec2(0.0);');
  });
});

describe('Normal from Height compiles', () => {
  const graph = (src: GraphNode[], wire: [string, string], params: Record<string, unknown> = {}, out = 'colour') => [
    ...src,
    n('normalFromHeight', 'nh', 400, 0, params, { height: wire }),
    n('output', 'o', 700, 0, {}, { color: ['nh', out] }),
  ];
  const mainOf = (fs: string) => fs.slice(fs.indexOf('void main()'));

  it('FBM → Height: a field function, called at four offsets in main()', () => {
    const r = compileGraph({ nodes: graph([n('fbm', 'f', 0, 0, {})], ['f', 'value']) });
    expect(r.errors ?? []).toEqual([]);
    const name = r.fragmentShader.match(/^float (fieldfn_\w+)\(vec2 g_uv/m)?.[1];
    expect(name).toBeTruthy();
    expect(mainOf(r.fragmentShader).split(`${name}(`).length - 1).toBe(4);
    expect(r.fragmentShader).not.toContain('dFdx');
  });

  it('a picture (Texture → Luminance → Height): the texture read goes into the field function', () => {
    const r = compileGraph({ nodes: graph([
      n('textureInput', 'tx', 0, 0, {}),
      n('luminance', 'lum', 200, 0, {}, { color: ['tx', 'color'] }),
    ], ['lum', 'result']) });
    expect(r.errors ?? []).toEqual([]);
    const fn = r.fragmentShader.match(/^float fieldfn_\w+\(vec2 g_uv[^\n]*\n([\s\S]*?)\n\}/m);
    expect(fn?.[1]).toMatch(/texture2D\(u_tex_/);
  });

  it('a chain that reads the previous frame falls back to dFdx, with no error', () => {
    const r = compileGraph({ nodes: graph([
      n('echo', 'ec', 0, 0, {}),
      n('luminance', 'lum', 200, 0, {}, { color: ['ec', 'color'] }),
    ], ['lum', 'result']) });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).not.toMatch(/fieldfn_/);
    expect(mainOf(r.fragmentShader)).toContain('dFdx(');
  });

  it('every Mode and output compiles, with live sliders', () => {
    for (const mode of ['lit', 'normal', 'slope']) {
      for (const out of ['colour', 'normal', 'shaded', 'slope']) {
        const r = compileGraph({ nodes: graph([n('noiseFloat', 'nz', 0, 0, {})], ['nz', 'value'], { mode, invert: mode === 'slope' }, out) });
        expect(r.errors ?? [], `${mode} / ${out}`).toEqual([]);
      }
    }
    const r = compileGraph({ nodes: graph([n('noiseFloat', 'nz', 0, 0, {})], ['nz', 'value']) });
    for (const k of ['strength', 'distance', 'lightAngle', 'lightHeight', 'ambient', 'specular', 'shininess', 'lightColour']) {
      expect(r.paramBindings[`nh::${k}`], k).toMatch(/^u_p_/);
    }
  });
});
