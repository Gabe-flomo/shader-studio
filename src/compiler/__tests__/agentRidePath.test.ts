/**
 * Ride a path (nodes/definitions/agentRidePath.ts, docs/agents-group.md "Ride a path"): walkers riding
 * the outline of a wired shape. Its real emitted GLSL, run on the CPU (glslEval.ts) against a circle,
 * pulls a walker onto the outline, slides it along by its speed, honours Level and Ribbon width, and
 * keeps a 3D walker at its depth; wired to a Circle SDF inside a group it compiles; Ride a curve is
 * hidden but still found by its name; the examples compile with their Play controls live.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { withAgentSpace } from '../../nodes/definitions/agents';
import { isOffered } from '../../nodes/notOffered';
import { n } from '../../store/graphBuilder';
import { agentsGroup } from '../../store/agentExampleKit';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { EXAMPLE_FOLDERS } from '../../store/exampleIndex';
import { RIDE_CURVE_EXAMPLE_KEYS } from '../../store/agentRideCurveExamples';
import { collectPlayCandidates } from '../../play/playControls';
import { runGlsl, type Env, type Val } from './glslEval';
import type { GraphNode } from '../../types/nodeGraph';

const DT = 1 / 60;

/** The walker's own numbers (agRnd) as a fixed sequence: h2 0.5 (no variation), h3 0.75 (lane +0.5). */
function env(pos: number[]): Env {
  const seq = [0.5, 0.75, 0.5, 0, 0.75];
  let k = 0;
  return {
    agRnd: () => seq[k++ % seq.length],
    a_index: 0, a_count: 4, a_dt: DT, a_age: 0, u_time: 0, a_pos: pos, a_heading: 0, a_dir: [1, 0, 0],
    // A circle of radius 0.5 round the middle (an SDF's distance), as Path ƒ's function.
    fieldfn_c_v: (q: Val) => Math.hypot((q as number[])[0], (q as number[])[1]) - 0.5,
  };
}
function ride(params: Record<string, unknown>, pos: number[], d3 = false) {
  let node = n('agentRidePath', 'R', 0, 0, params);
  if (d3) node = withAgentSpace(node, true, getNodeDefinition);
  const { code, outputVars } = getNodeDefinition('agentRidePath')!.generateGLSL(node, { path: 'fieldfn_c_v' });
  // The walker's hash seed as 0 for the evaluator (agRnd above hands out a fixed sequence instead).
  const out = runGlsl(code.replace(/agHash\(uint\(a_index\) \^ 0x[0-9A-Fa-f]+u\)/, '0'), env(pos));
  return { p: out[outputVars.position] as number[], v: out[outputVars.velocity] as number[] };
}

describe('Ride a path', () => {
  it('is offered; Ride a curve (curves built in) is hidden, and searching its name finds Ride a path', () => {
    const def = getNodeDefinition('agentRidePath')!;
    expect(def.label).toBe('Ride a Path');
    expect(def.inputs.path.field).toBe(true);
    expect(def.aliases).toContain('Ride a curve');
    expect(isOffered('agentRidePath')).toBe(true);
    expect(isOffered('agentRideCurve')).toBe(false);
    // No curve of its own: nothing but riding settings.
    expect(Object.keys(def.paramDefs ?? {})).toEqual(['speed', 'speedVar', 'direction', 'level', 'width', 'wander', 'wanderRate']);
  });
  it('a walker off the outline is pulled onto it, then slides along it by its speed (counter-clockwise)', () => {
    const r = ride({ width: 0, speed: 0.5, speedVar: 0 }, [0.8, 0]);
    expect(Math.hypot(r.p[0], r.p[1])).toBeCloseTo(0.5, 3);
    expect(r.p[1]).toBeGreaterThan(0);
    expect(Math.hypot(r.v[0], r.v[1])).toBeCloseTo(0.5, 3);
    expect(r.v[0] * r.p[0] + r.v[1] * r.p[1]).toBeCloseTo(0, 2);
    // The arc travelled is speed × dt.
    expect(Math.atan2(r.p[1], r.p[0]) * 0.5).toBeCloseTo(0.5 * DT, 3);
  });
  it('Level picks another outline; Ribbon width sets it across by its lane', () => {
    const lv = ride({ width: 0, speed: 0.5, speedVar: 0, level: 0.1 }, [0.3, 0.1]);
    expect(Math.hypot(lv.p[0], lv.p[1])).toBeCloseTo(0.6, 3);
    // Lane +0.5: out by width × 0.5.
    const w = ride({ width: 0.1, speed: 0.5, speedVar: 0 }, [0.5, 0]);
    expect(Math.hypot(w.p[0], w.p[1])).toBeCloseTo(0.55, 3);
  });
  it('3D: the outline at the walker\'s own depth', () => {
    const r = ride({ width: 0, speed: 0.5, speedVar: 0 }, [0, 0.7, 0.3], true);
    expect(Math.hypot(r.p[0], r.p[1])).toBeCloseTo(0.5, 3);
    expect(r.p[2]).toBeCloseTo(0.3, 6);
    expect(r.v[2]).toBe(0);
  });
  it('unwired, the walkers stay where they are', () => {
    const { code, outputVars } = getNodeDefinition('agentRidePath')!.generateGLSL(n('agentRidePath', 'R', 0, 0, {}), {});
    const out = runGlsl(code, env([0.2, 0.3]));
    expect(out[outputVars.position]).toEqual([0.2, 0.3]);
    expect(out[outputVars.velocity]).toEqual([0, 0]);
  });
  it('wired to a Circle SDF inside a group, it compiles and calls the shape\'s function', () => {
    const inside: GraphNode[] = [
      n('agentInputs', 'in', 0, 0, { _groupOriginal: true, extraInputs: [] }),
      n('circleSDF', 'circ', 150, 200, { radius: 0.5 }),
      n('agentRidePath', 'ride', 300, 0, {}, { path: ['circ', 'distance'] }),
      n('agentOutput', 'out', 600, 0, { _groupOriginal: true }, { position: ['ride', 'position'], velocity: ['ride', 'velocity'] }),
    ];
    const nodes = [
      n('agentEmit', 'emit', 0, 0, { mode: 'fill', shape: 'screen', life: 0 }),
      agentsGroup('g', 300, 0, 'emit', inside, { space: '2d', tier: '64k' }),
      n('drawAgents', 'draw', 600, 0, { style: 'streaks', colorBy: 'speed' }, { agents: ['g', 'agents'] }),
      n('output', 'o', 900, 0, {}, { color: ['draw', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.agents!.groups[0].fragmentShader).toMatch(/fieldfn_\w+\(/);
  });
});

describe('Ride a path examples', () => {
  it('are in the Simulation folder', () => {
    const keys = EXAMPLE_FOLDERS.find(f => f.label === 'Simulation')!.keys;
    for (const k of RIDE_CURVE_EXAMPLE_KEYS) expect(keys).toContain(k);
    expect(RIDE_CURVE_EXAMPLE_KEYS).toEqual(['agentRideHarmonograph', 'agentRidePath', 'agentRideMorph']);
  });
  it.each(RIDE_CURVE_EXAMPLE_KEYS)('%s rides a wired shape, compiles, every program live, its Play controls live', k => {
    const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition);
    const inside = (nodes.find(x => x.type === 'agentsGroup')!.params.subgraph as { nodes: GraphNode[] }).nodes;
    expect(inside.some(x => x.type === 'agentRideCurve')).toBe(false);
    expect(inside.find(x => x.type === 'agentRidePath')!.inputs.path.connection).toBeTruthy();
    const r = compileGraph({ nodes });
    expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
    expect(r.agents!.groups.every(g => g.live)).toBe(true);
    expect(r.agents!.trails.every(t => t.live)).toBe(true);
    const live = new Set(collectPlayCandidates(nodes, r.paramBindings).map(c => c.target));
    for (const c of EXAMPLE_GRAPHS[k].play!.controls) expect(live.has(c.target), `${c.label} → ${c.target}`).toBe(true);
  });
});
