/**
 * Neighbours (docs/agents-group.md "Neighbours"): the engine's grid and the node's query, run on
 * the CPU from their real GLSL (glslRun.ts): the binning vertex shader drawn as points in index
 * order (a slot pass: the last point drawn into a texel stays; the count pass: added), then the
 * Neighbours node's emitted code with the update shader's neighbour header. Checked against a
 * brute-force search over every pair: count, centre, heading, push and nearest, in 2D and 3D,
 * wrapping and not, by species; deterministic; and estimates in a crowd denser than it reads.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileFragment, type Env, type Val } from './glslRun';
import { AG_NB_BIN_VERT, AG_NB_GLSL } from '../../play/kit/agentShaders.js';
import { agNbLayout, agNbPasses, agNbTile, AG_NB_SLOTS } from '../../play/kit/agentPlan.js';
import { AgentNeighboursNode, agentNbHeader } from '../../nodes/definitions/agentNeighbours';
import { agentNbUniforms, agentStateUniform, AGENTS_GROUP_TYPE } from '../../nodes/definitions/agents';
import { compileGraph } from '../graphCompiler';
import { webAgents } from '../../play/webInput';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';

/** A float texture on the CPU (RGBA per texel). */
interface Tex { w: number; h: number; data: Float32Array }
const makeTex = (w: number, h: number): Tex => ({ w, h, data: new Float32Array(w * h * 4) });
const fetchTex = (t: Tex, x: number, y: number) => {
  const cx = Math.min(t.w - 1, Math.max(0, x)), cy = Math.min(t.h - 1, Math.max(0, y));
  const k = (cy * t.w + cx) * 4;
  return [t.data[k], t.data[k + 1], t.data[k + 2], t.data[k + 3]];
};
const ivec = (v: Val) => (v as number[]).map(Math.trunc);

/** Simple deterministic randoms. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; s ^= s >>> 12; return (s >>> 8) / 16777216; }; }

interface World { side: number; d3: boolean; aspect: number; A: Tex; B: Tex; C?: Tex; pos: number[][]; vel: number[][]; species: number[]; alive: boolean[] }

/** `count` walkers (the rest of the side² slots dead) at the given places. */
function world(o: { d3: boolean; aspect: number; side: number; place: (i: number) => number[]; vel?: (i: number) => number[]; species?: (i: number) => number; dead?: (i: number) => boolean; count: number; stateC?: boolean }): World {
  const N = o.side * o.side;
  const A = makeTex(o.side, o.side), B = makeTex(o.side, o.side), C = makeTex(o.side, o.side);
  const pos: number[][] = [], vel: number[][] = [], species: number[] = [], alive: boolean[] = [];
  for (let i = 0; i < N; i++) {
    const live = i < o.count && !o.dead?.(i);
    const p = live ? o.place(i) : [0, 0, 0];
    const v = live ? (o.vel?.(i) ?? [0, 0, 0]) : [0, 0, 0];
    const sp = o.species?.(i) ?? 0;
    pos.push([p[0], p[1], o.d3 ? p[2] : 0]); vel.push([v[0], v[1], o.d3 ? v[2] : 0]); species.push(sp); alive.push(live);
    const k = i * 4;
    // 2D: A = (pos.xy, heading, age), B = (vel.xy, speed, life); 3D: A = (pos.xyz, age), B = (vel.xyz, life).
    A.data.set(o.d3 ? [p[0], p[1], p[2], 1] : [p[0], p[1], 0.3, 1], k);
    B.data.set(o.d3 ? [v[0], v[1], v[2], live ? 1e30 : 0] : [v[0], v[1], Math.hypot(v[0], v[1]), live ? 1e30 : 0], k);
    C.data.set([sp, 0, 0, 16777215], k);
  }
  return { side: o.side, d3: o.d3, aspect: o.aspect, A, B, ...(o.stateC ? { C } : {}), pos, vel, species, alive };
}

const binProgram = compileFragment(AG_NB_BIN_VERT);

/**
 * The grid as the engine builds it: every pass of agNbPasses, each point drawn in index order
 * through the real vertex shader; a slot pass overwrites its texel (the last drawn stays), the
 * count pass adds. Returns the two atlases and the count, and the layout.
 */
function buildGrid(w: World, radius: number, most: number) {
  const L = agNbLayout(w.d3, w.aspect, radius, most);
  const [tw, th] = agNbTile(w.d3);
  const atlas = [makeTex(tw * AG_NB_SLOTS / 2, th), makeTex(tw * AG_NB_SLOTS / 2, th)];
  const count = makeTex(tw, th);
  for (const ps of agNbPasses(w.d3, L.slots)) {
    const into = ps.count ? count : atlas[ps.atlas];
    const samplers: Record<string, Tex> = { u_a: w.A, u_b: w.B, ...(ps.prevAtlas >= 0 ? { u_prev: atlas[ps.prevAtlas] } : {}) };
    for (let id = 0; id < w.side * w.side; id++) {
      const env: Env = {
        gl_VertexID: id, u_side: w.side, u_d3: w.d3 ? 1 : 0, u_grid: L.uniform, u_pass: [ps.x, ps.prevX, ps.prevAtlas >= 0 ? 1 : 0, ps.count ? 1 : 0], u_target: [into.w, into.h],
        u_a: 'u_a', u_b: 'u_b', u_prev: 'u_prev', ivec2: ivec,
        texelFetch: (s: Val, c: Val) => { const t = samplers[s as string]; if (!t) throw new Error(`no ${String(s)}`); const [x, y] = c as number[]; return fetchTex(t, x, y); },
      };
      binProgram.run(env);
      const gp = env.gl_Position as number[];
      if (Math.abs(gp[0]) > 1 || Math.abs(gp[1]) > 1) continue;
      const x = Math.floor((gp[0] * 0.5 + 0.5) * into.w), y = Math.floor((gp[1] * 0.5 + 0.5) * into.h);
      const k = (y * into.w + x) * 4;
      const out = env.v_out as number[];
      for (let c = 0; c < 4; c++) into.data[k + c] = ps.count ? into.data[k + c] + out[c] : out[c];
    }
  }
  return { L, atlas, count };
}

const SLUG = 'g';
const node = (params: Record<string, unknown>, d3: boolean): GraphNode => ({ id: 'nb', type: 'agentNeighbours', position: { x: 0, y: 0 }, params: { ...params, ...(d3 ? { agentSpace: '3d' } : {}) }, inputs: {}, outputs: {} });

/** The Neighbours node's real code, run for walker i over the grid: its five outputs. */
function query(w: World, grid: ReturnType<typeof buildGrid>, params: Record<string, unknown>, i: number) {
  const nd = node(params, w.d3);
  const { code, outputVars } = AgentNeighboursNode.generateGLSL(nd, {});
  const src = `${AG_NB_GLSL}\nconst int a_side = ${w.side};\n${agentNbHeader(SLUG, !!w.C, w.d3)}\nvoid main() {\n${code}\n}`;
  const prog = compileFragment(src);
  const U = agentNbUniforms(SLUG);
  const samplers: Record<string, Tex> = { [U.a]: grid.atlas[0], [U.b]: grid.atlas[1], [U.n]: grid.count, [agentStateUniform(SLUG, 'B')]: w.B, ...(w.C ? { [agentStateUniform(SLUG, 'C')]: w.C } : {}) };
  const k = i * 4;
  const env: Env = {
    ivec2: ivec, a_side: w.side, a_speciesCount: 4, a_index: i, a_species: w.species[i],
    a_pos: w.d3 ? w.pos[i] : w.pos[i].slice(0, 2), a_sA: [...w.A.data.slice(k, k + 4)], a_sB: [...w.B.data.slice(k, k + 4)],
    [U.g]: grid.L.uniform,
    texelFetch: (s: Val, c: Val) => { const t = samplers[s as string]; if (!t) throw new Error(`no ${String(s)}`); const [x, y] = c as number[]; return fetchTex(t, x, y); },
  };
  for (const s of Object.keys(samplers)) env[s] = s;
  prog.run(env);
  const get = (expr: string): number | number[] => {
    const m = /^(\w+?)(\.xy)?$/.exec(expr)!;
    const v = env[m[1]] as number | number[];
    return m[2] ? (v as number[]).slice(0, 2) : v;
  };
  return { count: get(outputVars.count) as number, centre: get(outputVars.centre) as number[], heading: get(outputVars.heading) as number[], push: get(outputVars.push) as number[], nearest: get(outputVars.nearest) as number };
}

/** Every pair: the reference. */
function brute(w: World, i: number, r: number, o: { wrap: boolean; which?: string }) {
  const box = [w.aspect, 1, 1];
  let n = 0, near = r;
  const sum = [0, 0, 0], vel = [0, 0, 0], push = [0, 0, 0];
  for (let j = 0; j < w.pos.length; j++) {
    if (j === i || !w.alive[j]) continue;
    const which = o.which ?? 'all';
    if (which === 'own' && w.species[j] !== w.species[i]) continue;
    if (which === 'others' && w.species[j] === w.species[i]) continue;
    if (/^\d$/.test(which) && w.species[j] !== Number(which) - 1) continue;
    const d = [0, 1, 2].map(a => {
      let x = w.pos[j][a] - w.pos[i][a];
      if (o.wrap) x -= 2 * box[a] * Math.floor(x / (2 * box[a]) + 0.5);
      return x;
    });
    const l = Math.hypot(...d);
    if (l >= r) continue;
    n++;
    for (let a = 0; a < 3; a++) { sum[a] += d[a]; vel[a] += w.vel[j][a]; if (l > 1e-6) push[a] -= d[a] * r / (l * l); }
    near = Math.min(near, l);
  }
  const centre = n ? w.pos[i].map((p, a) => p + sum[a] / n) : w.pos[i];
  return { count: n, centre, heading: n ? vel.map(v => v / n) : [0, 0, 0], push, nearest: near };
}

function expectMatch(got: ReturnType<typeof query>, want: ReturnType<typeof brute>, dims: number, what: string) {
  expect(got.count, `${what} count`).toBeCloseTo(want.count, 4);
  expect(got.nearest, `${what} nearest`).toBeCloseTo(want.nearest, 4);
  for (let a = 0; a < dims; a++) {
    expect(got.centre[a], `${what} centre ${a}`).toBeCloseTo(want.centre[a], 4);
    expect(got.heading[a], `${what} heading ${a}`).toBeCloseTo(want.heading[a], 4);
    expect(got.push[a], `${what} push ${a}`).toBeCloseTo(want.push[a], 3);
  }
}

/** The most walkers in one cell (for picking cases with no overflow). */
function fullest(grid: ReturnType<typeof buildGrid>): number { let m = 0; for (let k = 0; k < grid.count.data.length; k += 4) m = Math.max(m, grid.count.data[k]); return m; }

describe('Neighbours: the layout', () => {
  it('cells are at least the radius across on every axis, capped; slots follow Max neighbours', () => {
    const L = agNbLayout(false, 16 / 9, 0.05, 36);
    expect(L.nx).toBe(Math.floor(2 * 16 / 9 / 0.05));
    expect(L.ny).toBe(40);
    expect(2 * 16 / 9 / L.nx).toBeGreaterThanOrEqual(0.05);
    expect(L.slots).toBe(4);
    expect(agNbLayout(false, 1, 0.001, 500).nx).toBe(256);
    expect(agNbLayout(false, 1, 0.001, 500).slots).toBe(8);
    const L3 = agNbLayout(true, 16 / 9, 0.05, 36);
    expect([L3.nx, L3.ny, L3.nz]).toEqual([48, 40, 40]);
    expect(L3.slots).toBe(2);
    // Each slot peels below the one before it, in the other atlas.
    expect(agNbPasses(false, 3).map(p => [p.count, p.atlas, p.x, p.prevAtlas, p.prevX])).toEqual([[true, -1, 0, -1, 0], [false, 0, 0, -1, 0], [false, 1, 0, 0, 0], [false, 0, 256, 1, 0]]);
  });
});

describe('Neighbours: grid binning against a brute force', () => {
  it('2D, wrapping: every output matches every pair, for every walker', () => {
    const r = rng(7);
    const w = world({ d3: false, aspect: 1.5, side: 16, count: 180, place: () => [(r() * 2 - 1) * 1.5, r() * 2 - 1], vel: () => [r() - 0.5, r() - 0.5], dead: i => i % 17 === 3 });
    const grid = buildGrid(w, 0.25, 72);
    expect(fullest(grid)).toBeLessThanOrEqual(8);
    for (let i = 0; i < 180; i++) {
      if (!w.alive[i]) continue;
      expectMatch(query(w, grid, { radius: 0.25, max: 72, edges: 'wrap' }, i), brute(w, i, 0.25, { wrap: true }), 2, `walker ${i}`);
    }
  });

  it('2D, edges as walls: no wrapping round', () => {
    const r = rng(11);
    const w = world({ d3: false, aspect: 1, side: 12, count: 90, place: () => [r() * 2 - 1, r() * 2 - 1], vel: () => [r(), -r()] });
    const grid = buildGrid(w, 0.3, 72);
    expect(fullest(grid)).toBeLessThanOrEqual(8);
    for (let i = 0; i < 90; i += 3) expectMatch(query(w, grid, { radius: 0.3, max: 72, edges: 'stop' }, i), brute(w, i, 0.3, { wrap: false }), 2, `walker ${i}`);
    // A walker at the right edge sees across with Wrap and not with Stop.
    const edge = world({ d3: false, aspect: 1, side: 2, count: 2, place: i => (i ? [-0.98, 0] : [0.98, 0]) });
    const g2 = buildGrid(edge, 0.1, 9);
    expect(query(edge, g2, { radius: 0.1, max: 9, edges: 'wrap' }, 0).count).toBe(1);
    expect(query(edge, g2, { radius: 0.1, max: 9, edges: 'stop' }, 0).count).toBe(0);
  });

  it('3D: the 27 cells round it, wrapping in depth too', () => {
    const r = rng(3);
    const w = world({ d3: true, aspect: 1.2, side: 12, count: 140, place: () => [(r() * 2 - 1) * 1.2, r() * 2 - 1, r() * 2 - 1], vel: () => [r() - 0.5, r() - 0.5, r() - 0.5] });
    const grid = buildGrid(w, 0.45, 216);
    expect(fullest(grid)).toBeLessThanOrEqual(8);
    for (let i = 0; i < 140; i += 2) expectMatch(query(w, grid, { radius: 0.45, max: 216, edges: 'wrap' }, i), brute(w, i, 0.45, { wrap: true }), 3, `walker ${i}`);
  });

  it('a grid only 1 or 2 cells across (a radius near the box) never counts a walker twice', () => {
    const r = rng(5);
    const w = world({ d3: false, aspect: 1, side: 4, count: 8, place: () => [r() * 2 - 1, r() * 2 - 1] });
    for (const radius of [0.9, 1.5]) {
      const grid = buildGrid(w, radius, 72);
      expect(grid.L.nx).toBeLessThan(3);
      for (let i = 0; i < 8; i++) expectMatch(query(w, grid, { radius, max: 72, edges: 'wrap' }, i), brute(w, i, radius, { wrap: true }), 2, `r ${radius} walker ${i}`);
    }
  });

  it('by species: its own kind, other kinds, one species (from state C, or the index)', () => {
    const r = rng(9);
    for (const stateC of [false, true]) {
      const w = world({ d3: false, aspect: 1, side: 10, count: 100, stateC, place: () => [r() * 2 - 1, r() * 2 - 1], species: i => (stateC ? (i * 7) % 3 : i % 4) });
      const grid = buildGrid(w, 0.35, 72);
      for (const which of ['own', 'others', '2']) {
        for (let i = 0; i < 100; i += 7) {
          const got = query(w, grid, { radius: 0.35, max: 72, species: which }, i);
          const want = brute(w, i, 0.35, { wrap: true, which });
          if (fullest(grid) <= 8) expectMatch(got, want, 2, `${which} walker ${i}`);
        }
      }
    }
  });
});

describe('Neighbours: deterministic, and estimates past what it reads', () => {
  it('the grid is the same on every build, and each cell keeps its highest-numbered walkers, highest first', () => {
    const r = rng(21);
    const w = world({ d3: false, aspect: 1, side: 16, count: 256, place: () => [r() * 0.3 - 0.15, r() * 0.3 - 0.15] });
    const a = buildGrid(w, 0.2, 72), b = buildGrid(w, 0.2, 72);
    expect([...a.atlas[0].data]).toEqual([...b.atlas[0].data]);
    expect([...a.atlas[1].data]).toEqual([...b.atlas[1].data]);
    expect([...a.count.data]).toEqual([...b.count.data]);
    // The walkers' cells, from the same function the shaders use.
    const L = a.L;
    const cellOf = (p: number[]) => [Math.min(L.nx - 1, Math.max(0, Math.floor((p[0] / L.uniform[3] * 0.5 + 0.5) * L.nx))), Math.min(L.ny - 1, Math.max(0, Math.floor((p[1] * 0.5 + 0.5) * L.ny)))];
    const byCell = new Map<string, number[]>();
    w.pos.forEach((p, i) => { if (!w.alive[i]) return; const key = cellOf(p).join(','); byCell.set(key, [...(byCell.get(key) ?? []), i]); });
    const [tw] = agNbTile(false);
    for (const [key, ids] of byCell) {
      const [cx, cy] = key.split(',').map(Number);
      expect(fetchTex(a.count, cx, cy)[0]).toBe(ids.length);
      const kept = [];
      for (let k = 0; k < a.L.slots; k++) { const v = fetchTex(a.atlas[k & 1], cx + (k >> 1) * tw, cy)[3]; if (v > 0) kept.push(v - 1); }
      expect(kept).toEqual([...ids].sort((x, y) => y - x).slice(0, a.L.slots));
    }
  });

  it('a crowd denser than it reads: Count is estimated from the sample (and exact once it reads them all)', () => {
    const r = rng(33);
    // 400 walkers in a small square: dozens per cell.
    const w = world({ d3: false, aspect: 1, side: 20, count: 400, place: () => [r() * 0.4 - 0.2, r() * 0.4 - 0.2], vel: () => [1, 0] });
    const grid = buildGrid(w, 0.15, 72);
    expect(fullest(grid)).toBeGreaterThan(8);
    let err = 0, m = 0;
    for (let i = 0; i < 400; i += 10) {
      const got = query(w, grid, { radius: 0.15, max: 72 }, i);
      const want = brute(w, i, 0.15, { wrap: true });
      err += Math.abs(got.count - want.count); m += want.count;
      // Everyone flies the same way: the heading is exact whatever the sample.
      expect(got.heading[0]).toBeCloseTo(1, 5);
      expect(got.heading[1]).toBeCloseTo(0, 5);
      // The centre is near the true one (within a fraction of the radius).
      expect(Math.hypot(got.centre[0] - want.centre[0], got.centre[1] - want.centre[1])).toBeLessThan(0.05);
    }
    // On average within 15% of the true count.
    expect(err / m).toBeLessThan(0.15);
  });
});

describe('Neighbours: in the compile and on web pages', () => {
  const graph = (d3: boolean) => {
    const inside = [
      n('agentInputs', 'in', 0, 0, { extraInputs: [] }),
      n('agentNeighbours', 'nbr', 300, 0, { radius: 0.06, max: 36 }),
      n('exprNode', 'steer', 600, 0, { inputs: [{ name: 'push', type: d3 ? 'vec3' : 'vec2', slider: null }], outputType: d3 ? 'vec3' : 'vec2', lines: [], result: 'push', expr: 'push' }),
      n('agentOutput', 'out', 900, 0, {}, { velocity: ['steer', 'result'] }),
    ];
    inside[2].inputs = { push: { type: d3 ? 'vec3' : 'vec2', label: 'push', connection: { nodeId: 'nbr', outputKey: 'push' } } };
    inside[2].outputs = { result: { type: d3 ? 'vec3' : 'vec2', label: 'Result' } };
    return [
      n(AGENTS_GROUP_TYPE, 'grp', 0, 0, { tier: '64k', space: d3 ? '3d' : '2d', subgraph: { nodes: inside, inputPorts: [], outputPorts: [] } }),
      n('drawAgents', 'draw', 400, 0, {}, { agents: ['grp', 'agents'] }),
      n('output', 'o', 800, 0, {}, { color: ['draw', 'color'] }),
    ];
  };
  for (const d3 of [false, true]) {
    it(`a group with Neighbours compiles${d3 ? ' in 3D' : ''}: its grid's samplers, the helpers, and what the engine needs`, () => {
      const r = compileGraph({ nodes: graph(d3) });
      expect(r.success, String(r.errors)).toBe(true);
      const g = r.agents!.groups[0];
      expect(g.neighbours?.radius).toHaveLength(1);
      expect(g.neighbours?.max).toHaveLength(1);
      const U = agentNbUniforms(g.slug);
      for (const name of [U.a, U.b, U.n]) expect(g.fragmentShader).toContain(`uniform highp sampler2D ${name};`);
      expect(g.fragmentShader).toContain(`uniform vec4 ${U.g};`);
      expect(g.fragmentShader).toContain('agNbSlot(float(');
      expect(g.fragmentShader).toContain(d3 ? '< 27; ' : '< 9; ');
      const web = webAgents(r.agents!);
      expect(web.groups[0].u.nb).toEqual(U);
      expect(web.groups[0].neighbours).toEqual(g.neighbours);
    });
  }
  it('a group without one has no grid', () => {
    const nodes = graph(false);
    const sg = nodes[0].params.subgraph as { nodes: GraphNode[] };
    sg.nodes = sg.nodes.filter(x => x.type !== 'agentNeighbours' && x.type !== 'exprNode');
    sg.nodes.find(x => x.type === 'agentOutput')!.inputs = {};
    const r = compileGraph({ nodes });
    expect(r.success, String(r.errors)).toBe(true);
    expect(r.agents!.groups[0].neighbours).toBeUndefined();
    expect(r.agents!.groups[0].fragmentShader).not.toContain('agNb');
  });
});
