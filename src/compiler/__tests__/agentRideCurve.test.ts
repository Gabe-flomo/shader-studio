/**
 * Ride a curve (nodes/definitions/agentRideCurve.ts, docs/agents-group.md "Ride a curve"): walkers
 * locked onto Curve Trace's curve. It compiles in 2D and 3D with every wave and motion; its real
 * emitted GLSL, run on the CPU (glslEval.ts), puts a walker on the curve at its own place, moves
 * that place by its speed, loops it, and gives it the tangent × speed as its velocity; the group
 * keeps the place in Memory (Agent Output's Memory routed by itself when unwired); the examples
 * compile with their Play controls live.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { agentStepNodes } from '../agentGraph';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { withAgentSpace } from '../../nodes/definitions/agents';
import { n } from '../../store/graphBuilder';
import { agentsGroup } from '../../store/agentExampleKit';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { EXAMPLE_FOLDERS } from '../../store/exampleIndex';
import { RIDE_CURVE_EXAMPLE_KEYS } from '../../store/agentRideCurveExamples';
import { collectPlayCandidates } from '../../play/playControls';
import { runGlsl, type Env, type Val } from './glslEval';
import type { GraphNode } from '../../types/nodeGraph';

/** Emit → a group with Ride a curve → Draw agents → Output. */
function graph(params: Record<string, unknown>, o: { space?: '2d' | '3d'; wireMemory?: boolean } = {}): GraphNode[] {
  const inside = [
    n('agentInputs', 'in', 0, 0, { _groupOriginal: true, extraInputs: [] }),
    n('agentRideCurve', 'ride', 300, 0, params),
    n('agentOutput', 'out', 600, 0, { _groupOriginal: true }, {
      position: ['ride', 'position'], velocity: ['ride', 'velocity'],
      ...(o.wireMemory ? { memory: ['ride', 'memory'] as [string, string] } : {}),
    }),
  ];
  return [
    n('agentEmit', 'emit', 0, 0, { mode: 'fill', shape: 'screen', life: 0 }),
    agentsGroup('g', 300, 0, 'emit', inside, { space: o.space ?? '2d', tier: '64k' }),
    n('drawAgents', 'draw', 600, 0, { style: 'streaks', colorBy: 'speed' }, { agents: ['g', 'agents'] }),
    n('output', 'o', 900, 0, {}, { color: ['draw', 'color'] }),
  ];
}
const compile = (params: Record<string, unknown>, o?: Parameters<typeof graph>[1]) => compileGraph({ nodes: graph(params, o) });

const WAVES = ['sine', 'triangle', 'square', 'saw', 'custom'];
const MOTIONS = ['lateral', 'rotary', 'counter'];

describe('Ride a curve compiles', () => {
  for (const space of ['2d', '3d'] as const) {
    it.each(WAVES)(`${space}: wave %s`, wave => {
      const r = compile({ waveX: wave, waveY: wave, waveZ: wave, exprX: 'sin(3.0 * t) + time * 0.0', exprY: 'cos(2.0 * t)', exprZ: '0.2 * sin(5.0 * t)' }, { space });
      expect(r.errors).toBeUndefined();
      expect(r.agents!.groups[0].live).toBe(true);
      expect(r.agents!.groups[0].stateC).toBe(true);
      expect(!!r.agents!.groups[0].space3d).toBe(space === '3d');
    });
    it.each(MOTIONS)(`${space}: motion %s, with Morph, each Loop, both ways`, mode => {
      for (const loop of ['wrap', 'pingpong', 'respawn']) {
        const r = compile({ mode, loop, morphOn: true, direction: 'both', spread: 'even', damping: 0.05, wander: 0.5 }, { space });
        expect(r.errors, `${mode} ${loop}`).toBeUndefined();
        expect(r.agents!.groups[0].live).toBe(true);
      }
    });
  }

  it('3D adds Z (its own wave) and gives a direction as the heading', () => {
    const fs = compile({}, { space: '3d' }).agents!.groups[0].fragmentShader;
    expect(fs).toMatch(/vec3 \w+_c = vec3\(/);
    expect(fs).toMatch(/vec3 \w+_h = length\(\w+_v\) > 1e-6 \? normalize\(\w+_v\) : a_dir;/);
  });

  it('keeps its place in Memory: Agent Output\'s Memory takes the node\'s by itself, or as wired', () => {
    const g = graph({}).find(x => x.type === 'agentsGroup')!;
    expect(agentStepNodes(g).sink.inputs.memory.connection).toEqual({ nodeId: 'ride', outputKey: 'memory' });
    expect(agentStepNodes(g).stateC).toBe(true);
    const wired = graph({}, { wireMemory: true }).find(x => x.type === 'agentsGroup')!;
    expect(agentStepNodes(wired).sink.inputs.memory.connection).toEqual({ nodeId: 'ride', outputKey: 'memory' });
    // The update shader writes it into state C.
    expect(compile({}).agents!.groups[0].fragmentShader).toMatch(/o_c = vec4\(a_species, \w+_mem,/);
  });

  it('a custom formula with statement characters is refused', () => {
    const r = compile({ waveX: 'custom', exprX: 'sin(t); } float x = 1.0; {' });
    expect(r.success).toBe(false);
    expect(String(r.errors)).toMatch(/can't use/);
  });
});

// ── The emitted GLSL on the CPU ──

const DT = 1 / 60;
const TAU = 6.2831853;
/** The walker's own numbers (agRnd) as a fixed sequence, and the header's constants. */
function env(o: { index?: number; mem?: number[]; seq?: number[]; age?: number }): Env {
  const seq = o.seq ?? [0.25, 0.5, 0.75, 0.5, 0, 0.75];
  let k = 0;
  return {
    agRnd: () => seq[k++ % seq.length],
    a_index: o.index ?? 0, a_count: 4, a_dt: DT, a_mem: o.mem ?? [0, 0], a_age: o.age ?? 0, u_time: 0,
    a_heading: 0, a_dir: [1, 0, 0],
    cross: (a: Val, b: Val) => { const x = a as number[], y = b as number[]; return [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]; },
  };
}
function run(params: Record<string, unknown>, e: Env, d3 = false) {
  let node = n('agentRideCurve', 'R', 0, 0, params);
  if (d3) node = withAgentSpace(node, true, getNodeDefinition);
  const { code, outputVars } = getNodeDefinition('agentRideCurve')!.generateGLSL(node, {});
  // The walker's hash seed as 0 for the evaluator (agRnd below hands out a fixed sequence instead).
  const out = runGlsl(code.replace(/agHash\(uint\(a_index\) \^ 0x[0-9A-Fa-f]+u\)/, '0'), e);
  return { p: out[outputVars.position] as number[], v: out[outputVars.velocity] as number[], along: out[outputVars.along] as number, mem: out[outputVars.memory] as number[] };
}
/** The default 3 : 2 Lissajous (2D): X 0.9 sin(3t + π/2), Y 0.7 sin(2t). */
const lis = (t: number) => [0.9 * Math.sin(3 * t + 1.5708), 0.7 * Math.sin(2 * t)];
const dLis = (t: number) => [0.9 * 3 * Math.cos(3 * t + 1.5708), 0.7 * 2 * Math.cos(2 * t)];

describe('Ride a curve on the CPU', () => {
  it('a new walker starts at its Spread place, moves by its speed, and stands on the curve (no width)', () => {
    // h1 = 0.25: a quarter of the way round; h2 = 0.5: no variation; s0 = 0.25 × 2π.
    const r = run({ width: 0, speed: 0.1, speedVar: 0.3 }, env({}));
    const s = 0.25 * TAU + 0.1 * TAU * DT;
    expect(r.mem[0]).toBeCloseTo(s + 1, 5);
    expect(r.along).toBeCloseTo(s / TAU, 5);
    lis(s).forEach((x, i) => expect(r.p[i]).toBeCloseTo(x, 4));
  });

  it('an old walker goes on from its Memory; Memory.y passes through', () => {
    const r = run({ width: 0, speed: 0.1 }, env({ mem: [2.5, 7] }));
    const s = 1.5 + 0.1 * TAU * DT;
    expect(r.mem[0]).toBeCloseTo(s + 1, 5);
    expect(r.mem[1]).toBe(7);
    lis(s).forEach((x, i) => expect(r.p[i]).toBeCloseTo(x, 4));
  });

  it('its velocity is the tangent × its speed (t a second)', () => {
    const r = run({ width: 0, speed: 0.1, speedVar: 0 }, env({ mem: [2.5, 0] }));
    const s = 1.5 + 0.1 * TAU * DT;
    dLis(s).forEach((x, i) => expect(r.v[i]).toBeCloseTo(x * 0.1 * TAU, 3));
  });

  it('Spread evenly places walkers by Index; Spread over 0 starts them all at the start', () => {
    const even = run({ width: 0, speed: 0, spread: 'even' }, env({ index: 1 }));
    expect(even.along).toBeCloseTo(1.5 / 4, 5);
    const start = run({ width: 0, speed: 0, spreadOver: 0 }, env({}));
    expect(start.along).toBeCloseTo(0, 6);
  });

  it('Ribbon width moves it across the curve\'s normal, by its own lane', () => {
    // h3 = 0.75: lane +0.5 of the width; Wander 0.
    const r = run({ width: 0.1, speed: 0, wander: 0 }, env({ mem: [2.5, 0] }));
    const c = lis(1.5), d = dLis(1.5), l = Math.hypot(d[0], d[1]);
    const nrm = [-d[1] / l, d[0] / l];
    r.p.forEach((x, i) => expect(x).toBeCloseTo(c[i] + nrm[i] * 0.05, 4));
  });

  it('Loop: Wrap goes on round, Ping-pong turns back (and so does the velocity), Respawn returns to the start', () => {
    const L = TAU;
    const near = L - 0.001 + 1;
    const wrap = run({ width: 0, speed: 0.5, speedVar: 0, loop: 'wrap' }, env({ mem: [near, 0] }));
    expect(wrap.along).toBeLessThan(0.1);
    const pp = run({ width: 0, speed: 0.5, speedVar: 0, loop: 'pingpong' }, env({ mem: [near, 0] }));
    expect(pp.along).toBeGreaterThan(0.99);
    const s = L - 0.001 + 0.5 * TAU * DT, t = L - (s - L);
    dLis(t).forEach((x, i) => expect(pp.v[i]).toBeCloseTo(-x * 0.5 * TAU, 2));
    const re = run({ width: 0, speed: 0.5, speedVar: 0, loop: 'respawn' }, env({ mem: [near, 0] }));
    expect(re.along).toBe(0);
  });

  it('Direction Random sends about half of them backward', () => {
    const back = run({ width: 0, speed: 0.1, speedVar: 0, direction: 'both' }, env({ mem: [2.5, 0], seq: [0.25, 0.5, 0.75, 0.5, 0, 0.25] }));
    expect(back.mem[0]).toBeCloseTo(2.5 - 0.1 * TAU * DT, 5);
  });

  it('3D: on the knot, a tube of Ribbon width round it', () => {
    const r = run({ width: 0.1, speed: 0 }, env({ mem: [2.5, 0] }), true);
    const c = [0.9 * Math.sin(3 * 1.5 + 1.5708), 0.7 * Math.sin(2 * 1.5), 0.5 * Math.sin(5 * 1.5 + 0.7854)];
    // h3 = 0.75: radius 0.1 × √0.75 from the curve.
    expect(Math.hypot(...r.p.map((x, i) => x - c[i]))).toBeCloseTo(0.1 * Math.sqrt(0.75), 4);
  });
});

describe('Ride a curve examples', () => {
  it('are in the Simulation folder', () => {
    const keys = EXAMPLE_FOLDERS.find(f => f.label === 'Simulation')!.keys;
    for (const k of RIDE_CURVE_EXAMPLE_KEYS) expect(keys).toContain(k);
    expect(RIDE_CURVE_EXAMPLE_KEYS).toEqual(['agentRideHarmonograph', 'agentRideMorph']);
  });
  it.each(RIDE_CURVE_EXAMPLE_KEYS)('%s compiles, every program live, its Play controls live', k => {
    const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition);
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.agents!.groups.every(g => g.live)).toBe(true);
    expect(r.agents!.trails.every(t => t.live)).toBe(true);
    expect(r.agents!.groups[0].stateC).toBe(true);
    const live = new Set(collectPlayCandidates(nodes, r.paramBindings).map(c => c.target));
    for (const c of EXAMPLE_GRAPHS[k].play!.controls) expect(live.has(c.target), `${c.label} → ${c.target}`).toBe(true);
  });
  it('the morphing ribbon\'s Morph amount comes from the LFO', () => {
    const fs = compileGraph({ nodes: EXAMPLE_GRAPHS.agentRideMorph.nodes }).agents!.groups[0].fragmentShader;
    expect(fs).toMatch(/mix\(vec2\([^;]*, vec2\([^;]*, clamp\(\w+_value, 0\.0, 1\.0\)\)/);
  });
});
