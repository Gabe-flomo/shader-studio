/**
 * Kuwahara (nodes/definitions/kuwahara.ts, docs/kuwahara.md): the emitted GLSL, run on the CPU
 * (compiler/__tests__/glslEval.ts) over a small field and a small texture, matches a plain JS Kuwahara for every
 * Kind; a flat picture comes back unchanged and a step edge stays a step; Radius is capped lower for a Colour chain;
 * the reads come from a Texture at texel offsets or a field function at picture offsets; every Kind × source
 * compiles to an Output the parser accepts, with its sliders live uniforms.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, getNodeDefinitionFor } from '../definitions';
import { n, nv } from '../../store/graphBuilder';
import { runGlsl, type Env, type Val } from '../../compiler/__tests__/glslEval';
import type { GraphNode } from '../../types/nodeGraph';
import {
  KUWAHARA_FIELD_MAX_RADIUS, KUWAHARA_KINDS, KUWAHARA_MAX_RADIUS, kuwaharaNote, kuwaharaRadius, kuwaharaReads, type KuwaharaKind,
} from '../definitions/kuwahara';

const def = () => getNodeDefinition('kuwahara')!;
type V3 = [number, number, number];

// ── A plain JS Kuwahara: what the GLSL should work out ──────────────────────

function reference(kind: KuwaharaKind, read: (x: number, y: number) => V3, radius: number, sharpness: number, maxR: number): { colour: V3; variance: number } {
  const r = Math.min(Math.max(radius, 1), maxR);
  const sigmaOf = (m: V3, s: V3, w: number) => {
    const mu = m.map(c => c / w) as V3;
    return { mu, sg: s.reduce((a, c, i) => a + Math.abs(c / w - mu[i] * mu[i]), 0) };
  };
  if (kind === 'classic') {
    const M = [0, 1, 2, 3].map(() => [0, 0, 0] as V3), S = [0, 1, 2, 3].map(() => [0, 0, 0] as V3), N = [0, 0, 0, 0];
    for (let j = -maxR; j <= maxR; j++) for (let i = -maxR; i <= maxR; i++) {
      if (Math.abs(i) > r || Math.abs(j) > r) continue;
      const a = read(i, j);
      const inRegion = [i <= 0 && j >= 0, i >= 0 && j >= 0, i <= 0 && j <= 0, i >= 0 && j <= 0];
      inRegion.forEach((yes, k) => { if (yes) { for (let c = 0; c < 3; c++) { M[k][c] += a[c]; S[k][c] += a[c] * a[c]; } N[k]++; } });
    }
    let best = sigmaOf(M[0], S[0], N[0]);
    for (let k = 1; k < 4; k++) { const t = sigmaOf(M[k], S[k], N[k]); if (t.sg < best.sg) best = t; }
    return { colour: best.mu, variance: best.sg };
  }
  // Generalised / Anisotropic: 8 soft sectors (Kyprianidis's polynomials) × a Gaussian; blended by calm.
  let along: [number, number] = [0, 1], sa = 1, sb = 1;
  if (kind === 'anisotropic') {
    const t = (x: number, y: number) => read(x, y);
    const gx = [0, 1, 2].map(c => (t(1, 1)[c] + 2 * t(1, 0)[c] + t(1, -1)[c]) - (t(-1, 1)[c] + 2 * t(-1, 0)[c] + t(-1, -1)[c]));
    const gy = [0, 1, 2].map(c => (t(-1, 1)[c] + 2 * t(0, 1)[c] + t(1, 1)[c]) - (t(-1, -1)[c] + 2 * t(0, -1)[c] + t(1, -1)[c]));
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
    const E = dot(gx, gx), F = dot(gx, gy), G = dot(gy, gy);
    const root = Math.sqrt((E - G) ** 2 + 4 * F * F);
    const l1 = (E + G + root) / 2, l2 = (E + G - root) / 2;
    const tv = [l1 - E, -F], len = Math.hypot(tv[0], tv[1]);
    along = len * len > 1e-12 ? [tv[0] / len, tv[1] / len] : [0, 1];
    const A = l1 + l2 > 1e-8 ? (l1 - l2) / (l1 + l2) : 0;
    sa = 1 + A; sb = 1 / (1 + A);
  }
  const zeta = 2 / r, eta = (zeta + Math.cos(Math.PI / 8)) / Math.sin(Math.PI / 8) ** 2;
  const M = Array.from({ length: 8 }, () => [0, 0, 0] as V3), S = Array.from({ length: 8 }, () => [0, 0, 0] as V3), N = new Array(8).fill(0);
  for (let j = -maxR; j <= maxR; j++) for (let i = -maxR; i <= maxR; i++) {
    if (i * i + j * j > r * r) continue;
    const v = [i / r, j / r];
    const ox = along[0] * sa * i - along[1] * sb * j, oy = along[1] * sa * i + along[0] * sb * j;
    const a = read(ox, oy);
    const w = new Array(8).fill(0);
    const four = (p: number[], k0: number) => {
      const xx = zeta - eta * p[0] * p[0], yy = zeta - eta * p[1] * p[1];
      w[k0] = Math.max(0, p[1] + xx) ** 2; w[k0 + 2] = Math.max(0, -p[0] + yy) ** 2;
      w[k0 + 4] = Math.max(0, -p[1] + xx) ** 2; w[k0 + 6] = Math.max(0, p[0] + yy) ** 2;
    };
    four(v, 0);
    four([Math.SQRT1_2 * (v[0] - v[1]), Math.SQRT1_2 * (v[0] + v[1])], 1);
    const g = Math.exp(-3.125 * (v[0] ** 2 + v[1] ** 2)) / Math.max(w.reduce((s, x) => s + x, 0), 1e-6);
    for (let k = 0; k < 8; k++) { const wk = w[k] * g; for (let c = 0; c < 3; c++) { M[k][c] += a[c] * wk; S[k][c] += a[c] * a[c] * wk; } N[k] += wk; }
  }
  const sec = M.map((m, k) => sigmaOf(m, S[k], Math.max(N[k], 1e-6)));
  const lo = Math.min(...sec.map(s => s.sg));
  let ws = 0, variance = 0;
  const colour: V3 = [0, 0, 0];
  for (const s of sec) {
    const wk = ((lo + 1e-4) / (s.sg + 1e-4)) ** (sharpness / 2);
    for (let c = 0; c < 3; c++) colour[c] += s.mu[c] * wk;
    ws += wk; variance += s.sg * wk;
  }
  return { colour: colour.map(c => c / ws) as V3, variance: variance / ws };
}

// ── The GLSL on the CPU ─────────────────────────────────────────────────────

const HERE = [0.03, -0.02];
/** A field with an edge across it, ripples on one side and grain on the other (one picture pixel is 0.01 at 200 high). */
const fieldAt = (q: number[]): V3 => {
  const [x, y] = q;
  const side = x + 0.4 * y > 0.025 ? 1 : 0;
  const grain = Math.sin(x * 731 + y * 517) * 0.05;
  return [0.2 + 0.6 * side + grain, 0.5 + 0.3 * Math.sin(x * 40) - 0.2 * side, 0.4 + grain * side + 0.1 * Math.cos(y * 60)];
};
const fieldEnv = (field: (q: number[]) => V3 = fieldAt): Env => ({ fieldfn_p_c: (q: Val) => field(q as number[]), g_uv: [...HERE], u_resolution: [200, 200] });

function runField(params: Record<string, unknown>, field?: (q: number[]) => V3) {
  const { code, outputVars } = def().generateGLSL(n('kuwahara', 'N', 0, 0, params), { colour: 'fieldfn_p_c' });
  const out = runGlsl(code, fieldEnv(field));
  return { colour: out[outputVars.colour] as number[], variance: out[outputVars.variance] as number };
}
const fieldRead = (spacing = 1, field: (q: number[]) => V3 = fieldAt) => (x: number, y: number) => field([HERE[0] + x * 0.01 * spacing, HERE[1] + y * 0.01 * spacing]);

describe('Kuwahara\'s GLSL is the Kuwahara filter', () => {
  for (const kind of KUWAHARA_KINDS) {
    for (const [radius, sharpness, spacing] of [[2, 8, 1], [3.5, 4, 1.5], [9, 12, 1]] as const) {
      it(`${kind}, Radius ${radius}, Sharpness ${sharpness}, Spacing ${spacing}: matches the JS (a field)`, () => {
        const r = runField({ kind, radius, sharpness, spacing });
        const e = reference(kind, fieldRead(spacing), radius, sharpness, KUWAHARA_FIELD_MAX_RADIUS);
        for (let c = 0; c < 3; c++) expect(r.colour[c], `channel ${c}`).toBeCloseTo(e.colour[c], 6);
        expect(r.variance).toBeCloseTo(e.variance, 6);
      });
    }
  }
  it('a texture: read at texel offsets, Radius up to 8, matching the JS', () => {
    // An 8-pixel-a-side texture lattice (u_pass_a_px 1/64 across a 64 × 64 picture), sampled nearest.
    const img = (u: number, v: number): V3 => { const i = Math.round(u * 64), j = Math.round(v * 64); return [((i * 7 + j * 3) % 11) / 10, i > 33 ? 0.9 : 0.1, ((i * j) % 5) / 4]; };
    for (const kind of KUWAHARA_KINDS) {
      const { code, outputVars } = def().generateGLSL(n('kuwahara', 'N', 0, 0, { kind, radius: 6, sharpness: 8 }), { texture: 'u_pass_a' });
      const env: Env = { u_pass_a: 0, u_pass_a_px: [1 / 64, 1 / 64], g_uv: [0, 0], u_resolution: [64, 64], texture2D: (_s: Val, uv: Val) => [...img(...(uv as [number, number])), 1] };
      const out = runGlsl(code, env);
      const e = reference(kind, (x, y) => img(0.5 + x / 64, 0.5 + y / 64), 6, 8, KUWAHARA_MAX_RADIUS);
      for (let c = 0; c < 3; c++) expect((out[outputVars.colour] as number[])[c], `${kind} channel ${c}`).toBeCloseTo(e.colour[c], 6);
    }
  });
  it('a flat colour comes back unchanged, with no variance', () => {
    for (const kind of KUWAHARA_KINDS) {
      const r = runField({ kind, radius: 3 }, () => [0.3, 0.6, 0.9]);
      expect(r.colour[0]).toBeCloseTo(0.3, 6); expect(r.colour[1]).toBeCloseTo(0.6, 6); expect(r.colour[2]).toBeCloseTo(0.9, 6);
      expect(r.variance).toBeCloseTo(0, 6);
    }
  });
  it('a step edge stays a step: each side keeps its own colour, not a blur of both', () => {
    const step = (q: number[]): V3 => (q[0] > 0 ? [1, 1, 1] : [0, 0, 0]);
    for (const kind of ['classic', 'generalised'] as const) {
      // Two pixels left of the edge and two right: a blur of Radius 3 would mix them.
      const left = runField({ kind, radius: 3 }, q => step([q[0] - HERE[0] + 0.02, 0]));
      const right = runField({ kind, radius: 3 }, q => step([q[0] - HERE[0] - 0.02, 0]));
      expect(left.colour[0], kind).toBeGreaterThan(0.97);
      expect(right.colour[0], kind).toBeLessThan(0.03);
    }
  });
  it('Mix blends with the original; nothing it can read passes through', () => {
    const full = runField({ kind: 'generalised', radius: 2 });
    const half = runField({ kind: 'generalised', radius: 2, mix: 0.5 });
    const orig = fieldAt(HERE);
    expect(Math.abs(full.colour[0] - orig[0])).toBeGreaterThan(0.001);
    expect(half.colour[0]).toBeCloseTo((orig[0] + full.colour[0]) / 2, 6);
    expect(def().generateGLSL(n('kuwahara', 'N', 0, 0, {}), { colour: 'ec_color' }).code).toContain('vec3 N_out = ec_color;');
    expect(def().generateGLSL(n('kuwahara', 'N', 0, 0, {}), {}).code).toContain('vec3 N_out = vec3(0.0);');
  });
});

describe('Kuwahara\'s sources and cost', () => {
  it('a field: called at picture offsets inside a loop to 4 (Radius capped at 4)', () => {
    const { code } = def().generateGLSL(n('kuwahara', 'N', 0, 0, { kind: 'classic' }), { colour: 'fieldfn_f_c', uv: 'myUv' });
    expect(code).toContain('vec2 N_q = myUv;');
    expect(code).toContain('fieldfn_f_c(N_q + vec2(N_x, N_y) * N_e, vec2(0.0), 1.0, 0.0)');
    expect(code).toContain('for (int N_j = -4; N_j <= 4; N_j++)');
    expect(code).toContain('clamp(4.0, 1.0, 4.0)');
  });
  it('a texture: read at texel offsets in a loop to 8, before Colour', () => {
    const { code } = def().generateGLSL(n('kuwahara', 'N', 0, 0, { kind: 'generalised', spacing: 2 }), { texture: 'u_pass_a', colour: 'fieldfn_f_c' });
    expect(code).toContain('vec2 N_d = u_pass_a_px * 2.0;');
    expect(code).toContain('texture2D(u_pass_a, N_st + vec2(N_x, N_y) * N_d).rgb');
    expect(code).toContain('for (int N_i = -8; N_i <= 8; N_i++)');
    expect(code).not.toContain('fieldfn_');
  });
  it('Anisotropic reads a Sobel first and stretches the reads along the edge', () => {
    const { code } = def().generateGLSL(n('kuwahara', 'N', 0, 0, { kind: 'anisotropic' }), { texture: 'u_pass_a' });
    expect(code.split('texture2D(').length - 1).toBe(1 + 8 + 1); // this pixel, the Sobel, the loop's one read
    expect(code).toContain('(N_t * (N_sa * N_x) + N_tn * (N_sb * N_y))');
  });
  it('the reads per pixel, and the cap', () => {
    expect(kuwaharaReads('classic', 1)).toBe(9 + 1);
    expect(kuwaharaReads('classic', 4)).toBe(81 + 1);
    expect(kuwaharaReads('generalised', 1)).toBe(5 + 1);
    expect(kuwaharaReads('anisotropic', 1)).toBe(5 + 1 + 8);
    expect(kuwaharaRadius(7, true)).toBe(KUWAHARA_FIELD_MAX_RADIUS);
    expect(kuwaharaRadius(7, false)).toBe(7);
    expect(kuwaharaRadius(0, false)).toBe(1);
  });
  it('the card says where the reads come from, and warns about a Colour chain\'s cost', () => {
    const nz = n('noise', 'nz', 0, 0, {});
    const echo = n('echo', 'ec', 0, 0, {});
    const viaNoise = n('kuwahara', 'k', 0, 0, { radius: 6 }, { colour: ['nz', 'colour'] });
    const field = kuwaharaNote(viaNoise, [nz, viaNoise], getNodeDefinitionFor);
    expect(field[0]).toMatch(/again at each neighbour/);
    expect(field[1]).toMatch(/About 50 reads per pixel at Radius 4/);
    expect(field[2]).toMatch(/works the whole Colour chain out again/);
    expect(field[2]).toMatch(/Pass/);
    const viaEcho = n('kuwahara', 'k', 0, 0, {}, { colour: ['ec', 'color'] });
    expect(kuwaharaNote(viaEcho, [echo, viaEcho], getNodeDefinitionFor)[0]).toMatch(/passes through unchanged/);
    const pa = n('pass', 'pa', 0, 0, {});
    const viaTex = n('kuwahara', 'k', 0, 0, { kind: 'classic', radius: 6 }, { texture: ['pa', 'texture'] });
    const tex = kuwaharaNote(viaTex, [pa, viaTex], getNodeDefinitionFor);
    expect(tex).toHaveLength(2);
    expect(tex[1]).toMatch(/About 170 reads per pixel at Radius 6/);
  });
});

describe('Kuwahara compiles', () => {
  const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };
  const mainOf = (fs: string) => fs.slice(fs.indexOf('void main()'));
  const sources: Record<string, () => { nodes: GraphNode[]; wire: Record<string, [string, string]> }> = {
    field: () => ({ nodes: [n('uv', 'uv', 0, 0), n('noise', 'nz', 0, 0, { dims: '2d' }, { uv: ['uv', 'uv'] })], wire: { colour: ['nz', 'colour'] } }),
    picture: () => ({ nodes: [n('textureInput', 'tx', 0, 0, {})], wire: { colour: ['tx', 'color'] } }),
    texture: () => ({
      nodes: [n('uv', 'uv', 0, 0), n('circleSDF', 'circ', 0, 0, { radius: 0.4 }, { position: ['uv', 'uv'] }), n('floatToVec3', 'rgb', 0, 0, {}, { input: ['circ', 'distance'] }), n('pass', 'pa', 0, 0, {}, { color: ['rgb', 'rgb'] })],
      wire: { texture: ['pa', 'texture'] },
    }),
    pictureTexture: () => ({ nodes: [n('textureInput', 'tx', 0, 0, {})], wire: { texture: ['tx', 'texture'] } }),
    previousFrame: () => ({ nodes: [n('echo', 'ec', 0, 0, {})], wire: { colour: ['ec', 'color'] } }),
  };
  for (const [src, make] of Object.entries(sources)) {
    for (const kind of KUWAHARA_KINDS) {
      it(`${kind} from ${src}`, () => {
        const s = make();
        const r = compileGraph({ nodes: [
          ...s.nodes,
          n('kuwahara', 'kw', 400, 0, { kind }, s.wire),
          n('floatToVec3', 'vv', 600, 200, {}, { input: ['kw', 'variance'] }),
          nv('vec3', 'add', 'sum', 700, 0, {}, { a: ['kw', 'colour'], b: ['vv', 'rgb'] }),
          n('output', 'o', 900, 0, {}, { color: ['sum', 'result'] }),
        ] });
        expect(r.errors ?? [], `${kind} ${src}`).toEqual([]);
        expect(parses(r.fragmentShader), `${kind} ${src}`).toBeNull();
        if (src === 'field' || src === 'picture') expect(r.fragmentShader).toMatch(/^vec3 fieldfn_\w+\(vec2 g_uv/m);
        if (src === 'previousFrame') expect(r.fragmentShader).not.toMatch(/fieldfn_/);
        if (src === 'texture' || src === 'pictureTexture') expect(mainOf(r.fragmentShader)).toMatch(/_px \* /);
      });
    }
  }
  it('Radius, Sharpness, Spacing and Mix are live uniforms', () => {
    for (const kind of KUWAHARA_KINDS) {
      const r = compileGraph({ nodes: [
        n('textureInput', 'tx', 0, 0, {}),
        n('kuwahara', 'kw', 400, 0, { kind }, { texture: ['tx', 'texture'] }),
        n('output', 'o', 700, 0, {}, { color: ['kw', 'colour'] }),
      ] });
      expect(r.errors ?? []).toEqual([]);
      const live = kind === 'classic' ? ['radius', 'spacing', 'mix'] : ['radius', 'sharpness', 'spacing', 'mix'];
      for (const k of live) expect(r.paramBindings[`kw::${k}`], `${kind} ${k}`).toMatch(/^u_p_/);
    }
  });
});

