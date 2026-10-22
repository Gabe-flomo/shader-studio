/**
 * SDF Bevel (nodes/definitions/sdfBevel.ts, docs/sdf-bevel.md): the profile curves against a JS reference; the
 * emitted GLSL run on the CPU (compiler/__tests__/glslEval.ts) over a straight edge gives the bevel's height, slope,
 * normal and light; a Distance chain that can be a function is read at offsets (one pixel to each side, and towards
 * the light for the shadow), one that can't falls back to dFdx / dFdy with no shadow; every Profile × Mode compiles.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));

import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../definitions';
import { BEVEL_PROFILES, BEVEL_PROFILE_BODY, bevelProfileFn, bevelProfileGLSL, type BevelProfile } from '../definitions/sdfBevel';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Env, type Val } from '../../compiler/__tests__/glslEval';
import type { GraphNode } from '../../types/nodeGraph';

const def = () => getNodeDefinition('sdfBevel')!;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const each = (v: Val, f: (x: number) => number): Val => (Array.isArray(v) ? v.map(f) : f(v as number));
const EXTRA: Env = {
  smoothstep: (a: Val, b: Val, x: Val) => each(x, xx => smooth(a as number, b as number, xx)),
  pow: (a: Val, b: Val) => each(a, x => Math.pow(x, b as number)),
  step: (e: Val, x: Val) => each(x, xx => (xx < (e as number) ? 0 : 1)),
};

/** A profile's GLSL body run on the CPU: height 0..1 at t (0 at the outline, 1 at Width in). */
function profileGlsl(pr: BevelProfile, t: number, steps = 4): number {
  const body = BEVEL_PROFILE_BODY[pr].replace(/return ([^;]+);/, 'float r = $1;');
  return runGlsl(`float t = clamp(${t.toFixed(6)}, 0.0, 1.0);\n${body}`, { ...EXTRA, n: steps }).r as number;
}
/** The same curves in JS: what each profile is meant to be. */
const REFERENCE: Record<BevelProfile, (t: number, n: number) => number> = {
  chamfer: t => t,
  round: t => Math.sqrt(1 - (1 - t) ** 2),
  cove: t => 1 - Math.sqrt(1 - t * t),
  ogee: t => 0.5 - 0.5 * Math.cos(Math.PI * t),
  pillow: t => t * (2 - t),
  steps: (t, k) => { const s = Math.min(t, 0.9999) * k; return (Math.floor(s) + smooth(0, 0.3, s - Math.floor(s))) / k; },
};

describe('SDF Bevel\'s profiles', () => {
  for (const pr of BEVEL_PROFILES) {
    it(`${pr}: 0 at the outline, 1 at Width in, and the JS reference in between`, () => {
      expect(profileGlsl(pr, 0)).toBeCloseTo(0, 3);
      expect(profileGlsl(pr, 1)).toBeCloseTo(1, 3);
      for (const t of [0.1, 0.25, 0.5, 0.6, 0.9]) expect(profileGlsl(pr, t), `${pr} at ${t}`).toBeCloseTo(REFERENCE[pr](t, 4), 5);
    });
  }
  it('the shapes differ as the names say', () => {
    // Round bulges (above the chamfer line), Cove scoops (below), the S-curve crosses at half way.
    expect(profileGlsl('round', 0.3)).toBeGreaterThan(0.3);
    expect(profileGlsl('cove', 0.3)).toBeLessThan(0.3);
    expect(profileGlsl('ogee', 0.25)).toBeLessThan(0.25);
    expect(profileGlsl('ogee', 0.75)).toBeGreaterThan(0.75);
    expect(profileGlsl('ogee', 0.5)).toBeCloseTo(0.5, 6);
    // Steps (3): flat terraces at 1/3 and 2/3.
    expect(profileGlsl('steps', 0.2, 3)).toBeCloseTo(1 / 3, 6);
    expect(profileGlsl('steps', 0.3, 3)).toBeCloseTo(1 / 3, 6);
    expect(profileGlsl('steps', 0.6, 3)).toBeCloseTo(2 / 3, 6);
  });
  it('each profile is its own GLSL function, with the distance and Width', () => {
    for (const pr of BEVEL_PROFILES) {
      const g = bevelProfileGLSL(pr);
      expect(g).toMatch(new RegExp(`^float ${bevelProfileFn(pr)}\\(float d, float w, float n\\) \\{`));
      expect(g).toContain('float t = clamp(-d / max(w, 1.0e-5), 0.0, 1.0);');
    }
  });
});

describe('SDF Bevel on the CPU', () => {
  // A straight edge along x = 0, inside to the right: distance = −x. The point is 0.02 in.
  function run(params: Record<string, unknown>, at: number[] = [0.02, 0.1]) {
    const node = n('sdfBevel', 'B', 0, 0, params);
    const pr = (params.profile ?? 'chamfer') as BevelProfile;
    const fn = bevelProfileFn(pr);
    const env: Env = {
      ...EXTRA,
      fieldfn_e_v: (q: Val) => -(q as number[])[0],
      [fn]: (d: Val, w: Val, k: Val) => profileGlsl(pr, Math.min(Math.max(-(d as number) / Math.max(w as number, 1e-5), 0), 1), k as number),
      g_uv: at, u_resolution: [1280, 720],
    };
    const { code, outputVars } = def().generateGLSL({ ...node, params: { ...node.params, profile: pr, ...params } }, { d: 'fieldfn_e_v' });
    const out = runGlsl(code, env);
    return Object.fromEntries(Object.entries(outputVars).map(([k, v]) => [k, out[v]])) as Record<string, Val>;
  }

  it('Chamfer: the height climbs Depth over Width, and the slope is Depth ÷ Width', () => {
    const r = run({ profile: 'chamfer', width: 0.08, depth: 0.08 });
    expect(r.height as number).toBeCloseTo(0.02, 6); // a quarter of the way in, a quarter of Depth
    // Slope 1 to the right: the normal leans left, 45°.
    const nrm = r.normal as number[];
    expect(nrm[0]).toBeCloseTo(-Math.SQRT1_2, 4); expect(nrm[1]).toBeCloseTo(0, 6); expect(nrm[2]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(r.mask as number).toBeCloseTo(1, 6);
  });

  it('on the flat top and outside the normal faces straight out; Height is Depth on top, 0 outside', () => {
    const top = run({ width: 0.05, depth: 0.03 }, [0.3, 0]);
    expect(top.height as number).toBeCloseTo(0.03, 6);
    expect((top.normal as number[])[2]).toBeCloseTo(1, 6);
    const outside = run({ width: 0.05, depth: 0.03 }, [-0.3, 0]);
    expect(outside.height as number).toBe(0);
    expect(outside.mask as number).toBeCloseTo(0, 6);
  });

  it('Invert engraves: the height goes below 0 and the slope turns round', () => {
    const r = run({ profile: 'chamfer', width: 0.08, depth: 0.08, invert: true });
    expect(r.height as number).toBeCloseTo(-0.02, 6);
    expect((r.normal as number[])[0]).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('lights it like Normal from Height: full from a lamp facing the slope, Ambient from behind', () => {
    // The chamfer faces left and up 45°: a lamp from the left (180°) at 45° faces it head-on.
    const facing = run({ width: 0.08, depth: 0.08, lightAngle: 180, lightHeight: 45, ambient: 0, specular: 0 });
    expect(facing.shaded as number).toBeCloseTo(1, 4);
    const behind = run({ width: 0.08, depth: 0.08, lightAngle: 0, lightHeight: 45, ambient: 0.25, specular: 0 });
    expect(behind.shaded as number).toBeCloseTo(0.25, 4);
  });

  it('the drop shadow falls beside the shape, away from the light, and the Colour darkens there', () => {
    // Just outside the edge (x = −0.01); the lamp from the right (0°) sees the shape 0.025 towards it.
    const lit = { width: 0.05, depth: 0.03, lightHeight: 45, shadow: 0.5, shadowDistance: 0.025, shadowSoftness: 0.001, background: [1, 1, 1] };
    const shaded = run({ ...lit, lightAngle: 0 }, [-0.01, 0]);
    expect(shaded.shaded as number).toBeLessThan(0.6);
    expect((shaded.colour as number[])[0]).toBeCloseTo(0.5, 2);
    // The lamp from the left: the shape is behind the point, no shadow.
    const clear = run({ ...lit, lightAngle: 180 }, [-0.01, 0]);
    expect((clear.colour as number[])[0]).toBeCloseTo(1, 4);
  });

  it('Mode: the normal or the height as colour', () => {
    const nc = run({ width: 0.08, depth: 0.08, mode: 'normal' }).colour as number[];
    expect(nc[0]).toBeCloseTo(0.5 - Math.SQRT1_2 / 2, 4); expect(nc[2]).toBeCloseTo(0.5 + Math.SQRT1_2 / 2, 4);
    const hc = run({ width: 0.08, depth: 0.08, mode: 'height' }).colour as number[];
    hc.forEach(c => expect(c).toBeCloseTo(0.25, 6));
    const engraved = run({ width: 0.08, depth: 0.08, mode: 'height', invert: true }).colour as number[];
    engraved.forEach(c => expect(c).toBeCloseTo(0.75, 6));
  });
});

describe('SDF Bevel\'s GLSL', () => {
  const gen = (params: Record<string, unknown>, v: Record<string, string>) => def().generateGLSL(n('sdfBevel', 'B', 0, 0, params), v).code;

  for (const profile of BEVEL_PROFILES) {
    for (const mode of ['lit', 'normal', 'height']) {
      it(`${profile} × ${mode}: a field is read at the point, one pixel to each side, and towards the light`, () => {
        const code = gen({ profile, mode }, { d: 'fieldfn_s_d', uv: 'myUv' });
        const F = bevelProfileFn(profile);
        expect(code).toContain('vec2 B_q = myUv;');
        expect(code).toContain('float B_dist = fieldfn_s_d(B_q, vec2(0.0), 1.0, 0.0);');
        expect(code).toContain(`float B_pr = ${F}(B_dist, B_w, `);
        for (const off of ['vec2(B_px, 0.0)', 'vec2(-B_px, 0.0)', 'vec2(0.0, B_px)', 'vec2(0.0, -B_px)', 'B_sd']) {
          expect(code).toContain(`fieldfn_s_d(B_q + ${off}, vec2(0.0), 1.0, 0.0)`);
        }
        expect(code).not.toContain('dFdx');
        if (profile === 'steps') expect(code).toMatch(/sdfBevelSteps\(B_dist, B_w, \(4(\.0)?\)\)/);
        if (mode === 'lit') expect(code).toContain('vec3 B_c = mix(');
        if (mode === 'normal') expect(code).toContain('vec3 B_c = B_n * 0.5 + 0.5;');
        if (mode === 'height') expect(code).toContain('vec3 B_c = vec3(B_pr);');
      });
    }
  }

  it('a plain value: the slope from dFdx / dFdy, and no shadow', () => {
    const code = gen({}, { d: 'lum_0_result' });
    expect(code).toContain('float B_dist = lum_0_result;');
    expect(code).toContain('vec2(dFdx(B_h), dFdy(B_h))');
    expect(code).toContain('float B_sh = 0.0;');
    expect(code).not.toContain('fieldfn_');
  });

  it('unwired: nothing there (all outside), flat', () => {
    const code = gen({}, {});
    expect(code).toContain('float B_dist = 1.0;');
    expect(code).toContain('vec2 B_g = vec2(0.0);');
  });

  it('Invert: the height is negative and the shadow falls inside the shape', () => {
    const code = gen({ invert: true }, { d: 'fieldfn_s_d' });
    expect(code).toMatch(/float B_h = B_pr \* -\(/);
    expect(code).toContain('float B_sh = (1.0 - B_cast) * B_m');
    expect(code).toContain('mix(vec3(0.16, 0.17, 0.2), (');
  });
});

describe('SDF Bevel compiles', () => {
  const graph = (src: GraphNode[], wire: [string, string], params: Record<string, unknown> = {}, out = 'colour') => [
    ...src,
    n('sdfBevel', 'bv', 400, 0, params, { d: wire }),
    n('output', 'o', 700, 0, {}, { color: ['bv', out] }),
  ];
  const mainOf = (fs: string) => fs.slice(fs.indexOf('void main()'));
  const circle = () => [n('uv', 'uv', 0, 0, {}), n('circleSDF', 'c', 200, 0, { radius: 0.5 }, { position: ['uv', 'uv'] })];

  it('every Profile × Mode × Invert, and every output, compiles from a Circle SDF with no errors', () => {
    for (const profile of BEVEL_PROFILES) {
      for (const mode of ['lit', 'normal', 'height']) {
        for (const invert of [false, true]) {
          const r = compileGraph({ nodes: graph(circle(), ['c', 'distance'], { profile, mode, invert }) });
          expect(r.errors ?? [], `${profile} / ${mode} / ${invert}`).toEqual([]);
          expect(r.fragmentShader).toContain(`float ${bevelProfileFn(profile)}(float d, float w, float n)`);
        }
      }
    }
    for (const out of ['colour', 'shaded', 'normal', 'height', 'mask']) {
      const r = compileGraph({ nodes: graph(circle(), ['c', 'distance'], {}, out) });
      expect(r.errors ?? [], out).toEqual([]);
    }
  });

  it('Circle SDF → Distance: a field function, called six times in main() (the point, four sides, the shadow)', () => {
    const r = compileGraph({ nodes: graph(circle(), ['c', 'distance']) });
    const name = r.fragmentShader.match(/^float (fieldfn_\w+)\(vec2 g_uv/m)?.[1];
    expect(name).toBeTruthy();
    expect(mainOf(r.fragmentShader).split(`${name}(`).length - 1).toBe(6);
    expect(r.fragmentShader).not.toContain('dFdx');
    // The profile helper is declared before main() uses it.
    expect(r.fragmentShader.indexOf('float sdfBevelRound(')).toBeLessThan(r.fragmentShader.indexOf('void main()'));
  });

  it('a chain that reads the previous frame falls back to dFdx, with no error and no shadow', () => {
    const r = compileGraph({ nodes: graph([
      n('echo', 'ec', 0, 0, {}),
      n('luminance', 'lum', 200, 0, {}, { color: ['ec', 'color'] }),
    ], ['lum', 'result']) });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).not.toMatch(/fieldfn_/);
    expect(mainOf(r.fragmentShader)).toContain('dFdx(');
  });

  it('its numbers are live sliders', () => {
    const r = compileGraph({ nodes: graph(circle(), ['c', 'distance'], { profile: 'steps' }) });
    for (const k of ['steps', 'width', 'depth', 'lightAngle', 'lightHeight', 'lightColour', 'ambient', 'specular', 'shininess',
      'shadow', 'shadowDistance', 'shadowSoftness', 'edge', 'outlineWidth', 'outlineColour', 'fill', 'background']) {
      expect(r.paramBindings[`bv::${k}`], k).toMatch(/^u_p_/);
    }
  });

  it('Light from takes a wire (Time drives the lamp round)', () => {
    const r = compileGraph({ nodes: [
      ...circle(),
      n('time', 't', 0, 300, {}),
      n('sdfBevel', 'bv', 400, 0, {}, { d: ['c', 'distance'], lightAngle: ['t', 'time'] }),
      n('output', 'o', 700, 0, {}, { color: ['bv', 'colour'] }),
    ] });
    expect(r.errors ?? []).toEqual([]);
    expect(mainOf(r.fragmentShader)).toMatch(/radians\(\w*time\w*\)/);
  });
});
