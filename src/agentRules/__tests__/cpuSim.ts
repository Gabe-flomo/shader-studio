/**
 * Test helper: runs a rules group's generated inside on the CPU, through the nodes' own emitted
 * GLSL (glslEval), so the tests check the code the GPU runs rather than a copy of its maths.
 * Each node's generateGLSL is called in topological order with its wired inputs' variables, as
 * the assembler does; the walker globals are set as the agent prelude sets them (the same seed
 * hash), and Agent Output's wired values are read back as the new walker.
 */
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { topologicalSort } from '../../compiler/topoSort';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import { runGlsl, type Env, type Val } from '../../compiler/__tests__/glslEval';

export const agHash = (x0: number): number => {
  let x = x0 >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0; x ^= x >>> 16;
  return x >>> 0;
};

export interface Walker {
  pos: number[]; heading: number | number[]; speed: number; age: number; life: number; species: number; index: number;
  mem: number[]; alive: number; dep: number[]; colour: number[];
}

export interface SimOptions {
  d3?: boolean; dt?: number; seed?: number; aspect?: number;
  /** The trail's four channels at a 0–1 texture place. */
  trail?: (uv: number[]) => number[];
  /** Mask ports' values where a walker stands (number masks). */
  masks?: (pos: number[]) => number[];
  /** The flow field's force at a walker (in place of the Curl noise node's code). */
  flow?: (pos: number[]) => number[];
  mouse?: number[];
}

export interface Program {
  code: string; out: Record<string, string>; inputsId: string; flowId?: string;
  /** Neighbours nodes (their loops are the GPU's, tested on their own in agentNeighbours.test.ts): their settings, by variable prefix. */
  neighbours: Array<{ prefix: string; radius: number; species: string; wrap: boolean }>;
}

/** The inside's code (Agent Output left out) and the variables wired into Agent Output. */
export function programOf(inside: GraphNode[]): Program {
  const vars = new Map<string, Record<string, string>>();
  let code = '';
  const inputsId = inside.find(nd => nd.type === 'agentInputs')!.id;
  const flowId = inside.find(nd => nd.type === 'agentCurl')?.id;
  let out: Record<string, string> = {};
  const neighbours: Program['neighbours'] = [];
  for (const nd of topologicalSort(inside)) {
    if (nd.type === 'agentNeighbours') {
      // A brute force over every walker stands in for the grid (the same answers while no cell overflows).
      const prefix = `NB${neighbours.length}`;
      neighbours.push({ prefix, radius: Number(nd.params.radius ?? 0.05), species: String(nd.params.species ?? 'all'), wrap: nd.params.edges !== 'stop' });
      vars.set(nd.id, { count: `${prefix}_count`, centre: `${prefix}_centre`, heading: `${prefix}_heading`, push: `${prefix}_push`, nearest: `${prefix}_nearest` });
      continue;
    }
    const inputVars: Record<string, string> = {};
    for (const [k, inp] of Object.entries(nd.inputs)) {
      const c = inp.connection;
      const v = c ? vars.get(c.nodeId)?.[c.outputKey] : undefined;
      if (v) inputVars[k] = v;
    }
    if (nd.type === 'agentOutput') { out = inputVars; continue; }
    if (nd.type === 'agentCurl') { vars.set(nd.id, { force: 'FLOW' }); continue; }
    const r = getNodeDefinitionFor(nd)!.generateGLSL(nd, inputVars);
    code += r.code;
    vars.set(nd.id, nd.type === 'agentInputs' ? { ...r.outputVars, trail: 'TRAIL', mask1: 'MASK1', mask2: 'MASK2' } : r.outputVars);
  }
  // The rules' random numbers: the hash with `^` and `>>` as a function of the salt (glslEval has no bit operators).
  code = code.replace(/float\(agHash\(a_seed \^ 0x([0-9A-F]+)u\) >> 8\) \/ 16777216\.0/g, (_, h: string) => `agDice(${parseInt(h, 16)}.0)`);
  return { code, out, inputsId, flowId, neighbours };
}

/** The Neighbours node's outputs for walker w over every other live walker (as the step began): count, centre, heading, push, nearest. */
function neighboursOf(w: Walker, all: Walker[], nb: Program['neighbours'][number], d3: boolean, aspect: number): Record<string, Val> {
  const dims = d3 ? 3 : 2;
  const box = [aspect, 1, 1];
  let n = 0, near = nb.radius;
  const sum = [0, 0, 0], vel = [0, 0, 0], push = [0, 0, 0];
  for (const o of all) {
    if (o === w || o.alive < 0.5) continue;
    if (nb.species === 'own' && o.species !== w.species) continue;
    if (nb.species === 'others' && o.species === w.species) continue;
    if (/^\d$/.test(nb.species) && o.species !== Number(nb.species) - 1) continue;
    const d = [0, 1, 2].slice(0, dims).map(a => {
      let x = o.pos[a] - w.pos[a];
      if (nb.wrap) x -= 2 * box[a] * Math.floor(x / (2 * box[a]) + 0.5);
      return x;
    });
    const l = Math.hypot(...d);
    if (l >= nb.radius) continue;
    const v = d3 ? (o.heading as number[]).map(x => x * o.speed) : [Math.cos(o.heading as number) * o.speed, Math.sin(o.heading as number) * o.speed];
    n++;
    for (let a = 0; a < dims; a++) { sum[a] += d[a]; vel[a] += v[a]; if (l > 1e-6) push[a] -= d[a] * nb.radius / (l * l); }
    near = Math.min(near, l);
  }
  const cut = (v: number[]) => v.slice(0, dims);
  return {
    [`${nb.prefix}_count`]: n, [`${nb.prefix}_nearest`]: near,
    [`${nb.prefix}_centre`]: n ? cut(w.pos.map((p, a) => p + sum[a] / n)) : [...w.pos],
    [`${nb.prefix}_heading`]: n ? cut(vel.map(x => x / n)) : cut([0, 0, 0]),
    [`${nb.prefix}_push`]: cut(push),
  };
}

export const insideOf = (g: GraphNode) => (g.params.subgraph as SubgraphData).nodes;

const norm = (v: number[]) => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const agAcross = (h: number[], a: number) => {
  const e1 = norm(cross(h, Math.abs(h[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0]));
  const e2 = cross(h, e1);
  return e1.map((x, i) => Math.cos(a) * x + Math.sin(a) * e2[i]);
};
const agTurn3 = (h: number[], s: number[], a: number) => norm(h.map((x, i) => Math.cos(a) * x + Math.sin(a) * s[i]));

/** One step of every walker (the prelude's globals, the inside's code, Agent Output's values back). */
export function stepWalkers(p: Program, walkers: Walker[], step: number, o: SimOptions = {}): Walker[] {
  const dt = o.dt ?? 1 / 60;
  const aspect = o.aspect ?? 16 / 9;
  const res = [720 * aspect, 720];
  return walkers.map(w => {
    if (w.alive < 0.5) return w;
    const seed = agHash((Math.imul(w.index, 0x9E3779B1) >>> 0) ^ agHash((step ^ Math.imul(Math.max(o.seed ?? 1, 0), 0x85EBCA6B)) >>> 0));
    const age = w.age + dt;
    const env: Env = {
      a_pos: [...w.pos], a_heading: typeof w.heading === 'number' ? w.heading : Math.atan2(w.heading[1], w.heading[0]),
      a_speed: w.speed, a_age: age, a_life: w.life, a_species: w.species, a_index: w.index,
      a_seed: seed, a_random: (seed >>> 8) / 16777216, a_mem: [...w.mem], a_colour: [...w.colour], a_dt: dt, a_step: step,
      a_ownChannels: [1, 0, 0, 0], u_resolution: res, u_time: step * dt, u_mouse: o.mouse ?? [res[0] / 2, res[1] / 2],
      TRAIL: 0, MASK1: o.masks?.(w.pos)[0] ?? 0, MASK2: o.masks?.(w.pos)[1] ?? 0, FLOW: o.flow?.(w.pos) ?? (o.d3 ? [1, 0, 0] : [1, 0]),
      agDice: (salt: Val) => (agHash((seed ^ (salt as number)) >>> 0) >>> 8) / 16777216,
      agHash: (x: Val) => agHash(x as number),
      texture: (_s: Val, uv: Val) => o.trail?.(uv as number[]) ?? [0, 0, 0, 0],
      textureSize: () => [512 * aspect, 512],
      agUv: (q: Val) => [(q as number[])[0] / aspect * 0.5 + 0.5, (q as number[])[1] * 0.5 + 0.5],
      step: (e: Val, x: Val) => ((x as number) >= (e as number) ? 1 : 0),
      pow: (a: Val, b: Val) => Math.pow(a as number, b as number),
      acos: (a: Val) => Math.acos(a as number),
      equal: (a: Val, b: Val) => (a as number[]).map((x, i) => (x === (b as number[])[i] ? 1 : 0)),
      agTurn3: (h: Val, s: Val, a: Val) => agTurn3(h as number[], s as number[], a as number),
      agAcross: (h: Val, a: Val) => agAcross(h as number[], a as number),
    };
    for (const nb of p.neighbours) Object.assign(env, neighboursOf(w, walkers, nb, !!o.d3, aspect));
    if (o.d3) {
      const dir = w.heading as number[];
      env.a_dir = [...dir];
      env.a_vel = dir.map(x => x * w.speed);
      env.a_across = agAcross(dir, (agHash((seed ^ 0x27D4EB2D) >>> 0) >>> 8) / 16777216 * 6.2831853);
    } else env.a_vel = [Math.cos(env.a_heading as number) * w.speed, Math.sin(env.a_heading as number) * w.speed];
    runGlsl(p.code, env);
    const get = (k: string) => (p.out[k] ? runGlsl(`float OUT_V = 0.0; OUT_V = ${p.out[k]};`, env).OUT_V : undefined);
    const heading = get('heading') as number | number[];
    return {
      ...w, age,
      pos: get('position') as number[],
      heading: o.d3 ? norm(heading as number[]) : heading,
      speed: get('speed') as number,
      mem: (get('memory') as number[] | undefined) ?? w.mem,
      alive: (get('alive') as number | undefined) ?? 1,
      dep: (get('deposit') as number[] | undefined) ?? w.dep,
      colour: (get('colour') as number[] | undefined) ?? w.colour,
    };
  });
}

/** `count` newborn walkers spread over the picture (repeatable), species by index. */
export function walkersFor(count: number, o: { d3?: boolean; species?: number; speed?: number } = {}): Walker[] {
  return Array.from({ length: count }, (_, i) => {
    const h = agHash(i * 7919 + 13);
    const a = (h >>> 8) / 16777216 * Math.PI * 2;
    return {
      pos: o.d3 ? [((h & 255) / 255 - 0.5) * 2, (((h >>> 8) & 255) / 255 - 0.5) * 1.6, (((h >>> 16) & 255) / 255 - 0.5)] : [((h & 255) / 255 - 0.5) * 2, (((h >>> 8) & 255) / 255 - 0.5) * 1.6],
      heading: o.d3 ? norm([Math.cos(a), Math.sin(a), 0.3]) : a,
      speed: o.speed ?? 0, age: 0, life: 1e30, species: i % (o.species ?? 1), index: i,
      mem: [0, 0], alive: 1, dep: [0, 0, 0, 0], colour: [1, 1, 1],
    };
  });
}

/** Run `steps` steps. */
export function simulate(p: Program, walkers: Walker[], steps: number, o: SimOptions = {}): Walker[] {
  let ws = walkers;
  for (let k = 0; k < steps; k++) ws = stepWalkers(p, ws, k, o);
  return ws;
}
