/**
 * Rules with and / or, an Else, and "stays changed" (docs/grid-builder.md "Rules"), and the per-shape
 * states of "Make it a simulation". The scene function and the memory pass's functions are run on
 * the CPU (cpuGlsl.ts): the memory pass is stepped frame by frame over every cell (its Previous fed
 * back), and the scene reads its bits through a stand-in for the texture read.
 */
import { motionDecls, motionLines, motionUniforms } from './motionArgs';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { gridProgram, memorySize, shapeArgs, stickyRules } from '../glsl';
import { buildStandaloneGrid } from '../build';
import { drawnStartOf, simulationFromGrid, simRulePatch, SIM_RULES } from '../actions';
import { applyGridScene } from '../apply';
import { cellSize, emptyGridScene, newShape, ruleText, ruleProblem, type GridRule, type GridSceneSpec, type Vec3 } from '../spec';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';

type Val = number | number[];
const RED: Vec3 = [1, 0, 0];
const BLUE: Vec3 = [0, 0, 1];

function uniformsOf(spec: GridSceneSpec): Record<string, Val> {
  const u: Record<string, Val> = { pt: [spec.pattern.amount, spec.pattern.freq, spec.pattern.speed, spec.pattern.arms] };
  for (const s of spec.shapes) {
    const a = shapeArgs(s.id);
    u[a.m] = [s.motion.xy[0], s.motion.xy[1], s.motion.speed, s.motion.lag];
    u[a.l] = [s.size, s.turn * Math.PI / 180, s.spin, s.pulse];
    u[a.e] = s.outline;
    u[a.c] = [...s.color];
  }
  return { ...u, ...motionUniforms(spec) };
}
const shapeDecls = (spec: GridSceneSpec) => [...spec.shapes.flatMap(s => { const a = shapeArgs(s.id); return [`uniform vec4 ${a.m};`, `uniform vec4 ${a.l};`, `uniform float ${a.e};`, `uniform vec3 ${a.c};`]; }), ...motionDecls(spec)]
const gdLines = (data: number[]) => [`  float gd[${data.length}];`, ...data.map((v, i) => `  gd[${i}] = ${v.toFixed(1)};`)];

/**
 * The scene function at a point, as a CPU program. With rules that stay changed, the memory's bits
 * per cell come in as HELD (a global the texture read is swapped for: cell y × size + x).
 */
function sceneShader(spec: GridSceneSpec, held?: number[]): { run: (cell: [number, number], t: number) => number[] } {
  const p = gridProgram(spec);
  const N = memorySize(spec);
  let fns = p.functions;
  if (p.memory) fns = fns.replace(/(vec2 gs_held_\w+\(sampler2D lt, vec2 h\) \{)[^\n]*\}/, `$1 return vec2(HELD[int(h.y * ${N}.0 + h.x)], 0.0); }`);
  const src = ['uniform vec2 p_uv;', 'uniform float p_t;', 'uniform vec4 pt;', 'uniform sampler2D lt;', ...shapeDecls(spec), `float HELD[${N * N}];`, fns,
    'void main() {',
    ...gdLines(p.data),
    ...motionLines(spec),
    ...(held ?? []).map((v, i) => (v ? `  HELD[${i}] = ${v.toFixed(1)};` : '')).filter(Boolean),
    '  vec4 hp = vec4(0.0);',
    `  gl_FragColor = ${p.name}(p_uv, p_t, pt, ${p.args.join(', ')});`,
    '}'].join('\n');
  const sh = new CpuShader(src);
  const cs = cellSize(spec);
  return {
    run: ([cx, cy], t) => {
      const uv = [(cx - spec.cols / 2) * cs, (spec.rows / 2 - cy) * cs];
      return sh.run([0, 0], { resolution: [800, 800], time: t, uniforms: { ...uniformsOf(spec), p_uv: uv, p_t: t } })!;
    },
  };
}

/** The memory pass on the CPU: one texel per cell, stepped at each time (its Previous fed back). Returns its bits per cell (r + 256 g). */
function runMemory(spec: GridSceneSpec, times: number[], o: { resetAt?: number } = {}): number[] {
  const p = gridProgram(spec);
  const mem = p.memory!;
  const N = mem.size;
  const call = mem.latchArgs.map(a => (a === 'h' ? 'hU' : a === 't' ? 'p_t' : a === 'pv' ? 'pvU' : a === 'reset' ? 'resetU' : a));
  const src = ['uniform vec2 hU;', 'uniform float p_t;', 'uniform vec4 pvU;', 'uniform float resetU;', ...shapeDecls(spec), mem.latchFunctions,
    'void main() {', ...gdLines(p.data), ...motionLines(spec), `  gl_FragColor = vec4(${mem.latchName}(${call.join(', ')}), 1.0);`, '}'].join('\n');
  const sh = new CpuShader(src);
  let tex: number[][] = Array.from({ length: N * N }, () => [0, 0, 0, 0]);
  for (const t of times) {
    tex = tex.map((pv, i) => sh.run([0, 0], { resolution: [N, N], time: t, uniforms: { ...uniformsOf(spec), hU: [i % N, Math.floor(i / N)], p_t: t, pvU: pv, resetU: o.resetAt === t ? 1 : 0 } })!);
  }
  return tex.map(v => Math.round(v[0] * 255) + 256 * Math.round(v[1] * 255));
}

const near = (a: number[], b: readonly number[]) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) < 1e-3);

/** Four still circles A at (1, 1), (3, 1), (1, 3), (3, 3) on a 5 × 5 grid, no glow. */
function fourCells(rule: Omit<GridRule, 'id' | 'on'>): GridSceneSpec {
  const s = emptyGridScene();
  s.cols = 5; s.rows = 5;
  s.look.glow = false;
  s.shapes = [newShape('A', { kind: 'circle', size: 0.6, color: [0.2, 0.9, 0.3] })];
  for (const [x, y] of [[1, 1], [3, 1], [1, 3], [3, 3]]) s.cells.push({ x, y, s: 'A' });
  s.rules = [{ id: 'r1', on: true, ...rule }];
  return s;
}

describe('Grid scene rules: and / or, else', () => {
  it('and: both conditions; else: the rest', () => {
    const s = fourCells({ when: { kind: 'column', a: 'A', x: 1 }, also: [{ join: 'and', when: { kind: 'row', y: 1 } }], do: { kind: 'colour', color: RED }, else: { kind: 'colour', color: BLUE } });
    expect(ruleText(s.rules[0])).toBe('When A is in the column 1 and is in the row 1, A changes colour, else A changes colour');
    const sh = sceneShader(s);
    expect(near(sh.run([1.5, 1.5], 0), RED)).toBe(true);
    expect(near(sh.run([3.5, 1.5], 0), BLUE)).toBe(true);
    expect(near(sh.run([1.5, 3.5], 0), BLUE)).toBe(true);
    expect(near(sh.run([3.5, 3.5], 0), BLUE)).toBe(true);
  });

  it('or: either condition; no else leaves the shape as it is', () => {
    const s = fourCells({ when: { kind: 'column', a: 'A', x: 1 }, also: [{ join: 'or', when: { kind: 'row', y: 1 } }], do: { kind: 'colour', color: RED } });
    const sh = sceneShader(s);
    expect(near(sh.run([1.5, 1.5], 0), RED)).toBe(true);
    expect(near(sh.run([3.5, 1.5], 0), RED)).toBe(true);
    expect(near(sh.run([1.5, 3.5], 0), RED)).toBe(true);
    expect(near(sh.run([3.5, 3.5], 0), [0.2, 0.9, 0.3])).toBe(true);
  });

  it('joins run left to right: (column 1 or row 1) and cell (3, 1)', () => {
    const s = fourCells({ when: { kind: 'column', a: 'A', x: 1 }, also: [{ join: 'or', when: { kind: 'row', y: 1 } }, { join: 'and', when: { kind: 'cell', x: 3, y: 1 } }], do: { kind: 'colour', color: RED } });
    const sh = sceneShader(s);
    expect(near(sh.run([3.5, 1.5], 0), RED)).toBe(true);
    expect(near(sh.run([1.5, 1.5], 0), RED)).toBe(false);
  });

  it('an and with a partner: near another shape, in a row', () => {
    const s = fourCells({ when: { kind: 'row', a: 'A', y: 1 }, also: [{ join: 'and', when: { kind: 'near', b: 'B', dist: 1.2 } }], do: { kind: 'hide' } });
    s.shapes.push(newShape('B', { kind: 'square', size: 0.3, color: [1, 1, 1] }));
    s.cells.push({ x: 4, y: 1, s: 'B' }, { x: 4, y: 3, s: 'B' });
    const sh = sceneShader(s);
    // (3, 1): in row 1 and next to a B: hidden, so the nearest shape is elsewhere (not A's colour inside).
    expect(sh.run([3.5, 1.5], 0)[3]).toBeGreaterThan(0);
    // (3, 3) is next to a B but not in row 1; (1, 1) is in row 1 but far from a B: both drawn.
    expect(sh.run([3.5, 3.5], 0)[3]).toBeLessThan(0);
    expect(sh.run([1.5, 1.5], 0)[3]).toBeLessThan(0);
  });

  it('old rules (no also, else or sticky) still read and build as before', () => {
    const s = fourCells({ when: { kind: 'column', a: 'A', x: 3 }, do: { kind: 'colour', color: RED } });
    expect(ruleProblem(s, s.rules[0])).toBeNull();
    expect(gridProgram(s).memory).toBeNull();
    const g = buildStandaloneGrid(s);
    expect(g.nodes.some(n => n.type === 'pass')).toBe(false);
    expect(near(sceneShader(s).run([3.5, 1.5], 0), RED)).toBe(true);
  });

  it('an Else can\'t swap, and a become in it needs its shape', () => {
    const s = fourCells({ when: { kind: 'column', a: 'A', x: 1 }, do: { kind: 'hide' }, else: { kind: 'swap' } });
    expect(ruleProblem(s, s.rules[0])).toMatch(/Else/);
    s.rules[0].else = { kind: 'become', shape: 'Z' };
    expect(ruleProblem(s, s.rules[0])).toMatch(/Else/);
  });
});

/** Shape A travels right along row 2 of an 8 × 5 grid, a cell a second from column 0 (at t it is at the middle of column t); the rule turns it red in column 3. */
function traveller(sticky: boolean): GridSceneSpec {
  const s = emptyGridScene();
  s.cols = 8; s.rows = 5;
  s.look.glow = false;
  s.shapes = [newShape('A', { kind: 'circle', size: 0.6, color: [0.2, 0.9, 0.3], motion: { path: 'travel', xy: [1, 0], speed: 1, lag: 0 } })];
  s.cells.push({ x: 0, y: 2, s: 'A' });
  s.rules = [{ id: 'r1', on: true, when: { kind: 'column', a: 'A', x: 3 }, do: { kind: 'colour', color: RED }, ...(sticky ? { sticky: true } : {}) }];
  return s;
}
const frames = (to: number, dt = 0.5) => Array.from({ length: Math.round(to / dt) + 1 }, (_, i) => i * dt);

describe('Grid scene rules: stays changed', () => {
  it('only a sticky rule adds the memory pass: one texel a cell, Nearest, half float, reading its own Previous', () => {
    expect(buildStandaloneGrid(traveller(false)).nodes.some(n => n.type === 'pass')).toBe(false);
    const s = traveller(true);
    expect(stickyRules(s).map(r => r.id)).toEqual(['r1']);
    const g = buildStandaloneGrid(s);
    const pass = g.nodes.find(n => n.type === 'pass')!;
    expect(pass.params).toMatchObject({ __size: 8, filter: 'nearest', format: 'half' });
    const latch = g.nodes.find(n => n.params._gsRole === 'latch')!;
    expect(latch.inputs.prev.connection).toEqual({ nodeId: pass.id, outputKey: 'previous' });
    expect(pass.inputs.color.connection).toEqual({ nodeId: latch.id, outputKey: 'result' });
    const grid = g.nodes.find(n => n.params._gsRole === 'grid')!;
    expect(grid.inputs.lt.connection).toEqual({ nodeId: pass.id, outputKey: 'texture' });
    const r = compileGraph({ nodes: g.nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.passes).toHaveLength(1);
    expect(r.passes![0]).toMatchObject({ size: 8, filter: 'nearest', format: 'half', previous: true, live: true });
    expect(r.fragmentShader).toContain(`u_pass_${r.passes![0].slug}`);
  });

  it('a rebuild keeps the memory pass and its wires (apply.ts)', () => {
    const def = getNodeDefinition('output')!;
    const out: GraphNode = { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label } }, outputs: {}, params: {} };
    let k = 0;
    const nextId = () => `n${++k}`;
    const a = applyGridScene([out], traveller(true), { nextId });
    const b = applyGridScene(a.nodes, traveller(true), { nextId, sceneId: a.sceneId });
    const passes = b.nodes.filter(n => n.type === 'pass');
    expect(passes).toHaveLength(1);
    expect(compileGraph({ nodes: b.nodes }).success).toBe(true);
    // Turned off: the pass goes.
    const c = applyGridScene(b.nodes, traveller(false), { nextId, sceneId: a.sceneId });
    expect(c.nodes.filter(n => n.type === 'pass')).toHaveLength(0);
    expect(compileGraph({ nodes: c.nodes }).success).toBe(true);
  });

  it('the memory sets the cell\'s bit when the rule fires and keeps it after', () => {
    const s = traveller(true);
    const N = memorySize(s);
    const home = 2 * N + 0;
    // Before column 3: not yet.
    expect(runMemory(s, frames(2))[home]).toBe(0);
    // Through column 3 and beyond: set, and kept at t = 5 (column 5).
    const bits = runMemory(s, frames(5));
    expect(bits[home]).toBe(1);
    // No other cell holds a shape: none set.
    expect(bits.filter((v, i) => i !== home && v)).toEqual([]);
    // A reset forgets; so does the clock going back.
    expect(runMemory(s, [...frames(5), 6], { resetAt: 6 })[home]).toBe(0);
    expect(runMemory(s, [...frames(5), 0.5])[home]).toBe(0);
  }, 30000);

  it('the scene keeps the change after the condition ends (and a plain rule does not)', () => {
    const plain = sceneShader(traveller(false));
    // At t = 5 the shape is in column 5: a plain rule shows its own colour again.
    expect(near(plain.run([5.5, 2.5], 5), [0.2, 0.9, 0.3])).toBe(true);
    expect(near(plain.run([3.5, 2.5], 3), RED)).toBe(true);
    const s = traveller(true);
    const before = sceneShader(s, runMemory(s, frames(2)));
    expect(near(before.run([2.5, 2.5], 2), [0.2, 0.9, 0.3])).toBe(true);
    const after = sceneShader(s, runMemory(s, frames(5)));
    expect(near(after.run([5.5, 2.5], 5), RED)).toBe(true);
  }, 30000);

  it('sticky rules take a bit each, an Else applies until the rule has fired', () => {
    const s = traveller(true);
    s.shapes.push(newShape('B', { kind: 'star', size: 0.5 }));
    s.rules.push({ id: 'r2', on: true, when: { kind: 'column', a: 'A', x: 5 }, do: { kind: 'grow', amount: 1.2 }, sticky: true, else: { kind: 'colour', color: BLUE } });
    const N = memorySize(s);
    expect(runMemory(s, frames(4))[2 * N]).toBe(1);
    expect(runMemory(s, frames(6))[2 * N]).toBe(3);
    // r1 fired (red) and r2 not yet: its Else (blue) runs after r1, top to bottom.
    const sh = sceneShader(s, runMemory(s, frames(4)));
    expect(near(sh.run([4.5, 2.5], 4), BLUE)).toBe(true);
    expect(ruleText(s.rules[1])).toBe('When A is in the column 5, A grows ×1.2 and stays changed, else A changes colour');
  }, 60000);
});

describe('Make it a simulation: a state per shape', () => {
  function walls(): GridSceneSpec {
    const s = emptyGridScene();
    s.cols = 4; s.rows = 3;
    s.shapes = [newShape('A'), newShape('B'), newShape('C')];
    // Row 0: A A . .   row 1: B . C .   row 2: . . B B
    s.cells.push({ x: 0, y: 0, s: 'A' }, { x: 1, y: 0, s: 'A' }, { x: 0, y: 1, s: 'B' }, { x: 2, y: 1, s: 'C' }, { x: 2, y: 2, s: 'B' }, { x: 3, y: 2, s: 'B' });
    return s;
  }

  it('every shape is state 1 unless picked', () => {
    expect(drawnStartOf(walls())!.rows).toEqual(['11..', '1.1.', '..11']);
  });

  it('picked states go into the rows (digits, a–f above 9), 0 leaves a shape out', () => {
    const s = walls();
    s.simStates = { A: 2, B: 12 };
    expect(drawnStartOf(s)!.rows).toEqual(['22..', 'c.1.', '..cc']);
    s.simStates = { A: 0, C: 3 };
    // A left out: cropped to what is left.
    expect(drawnStartOf(s)).toMatchObject({ w: 4, h: 2, rows: ['1.3.', '..11'] });
    s.simStates = { A: 0, B: 0, C: 0 };
    expect(drawnStartOf(s)).toBeNull();
  });

  it('the jump uses the picked states and rule; a later jump keeps the rule unless one is picked', () => {
    const def = getNodeDefinition('output')!;
    const out: GraphNode = { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label } }, outputs: {}, params: {} };
    let k = 0;
    const nextId = () => `n${++k}`;
    const s = walls();
    s.simStates = { A: 1, B: 3 };
    const built = applyGridScene([out], s, { nextId });
    const first = simulationFromGrid(built.nodes, built.sceneId, nextId, { rule: 'stages:briansBrain' })!;
    const gr = first.nodes.find(n => n.id === first.gridRulesId)!;
    expect((gr.params.startCells as { rows: string[] }).rows).toEqual(['11..', '3.1.', '..33']);
    expect(gr.params).toMatchObject({ ruleType: 'stages', states: 3 });
    // The scene remembers the states (it is on the UV node's spec).
    expect((built.nodes.find(n => n.id === built.sceneId)!.params.gridScene as { spec: GridSceneSpec }).spec.simStates).toEqual({ A: 1, B: 3 });
    const again = simulationFromGrid(first.nodes, built.sceneId, nextId)!;
    expect(again.gridRulesId).toBe(first.gridRulesId);
    expect(again.nodes.find(n => n.id === first.gridRulesId)!.params).toMatchObject({ ruleType: 'stages', states: 3 });
    const life = simulationFromGrid(first.nodes, built.sceneId, nextId, { rule: 'count:life' })!;
    expect(life.nodes.find(n => n.id === first.gridRulesId)!.params.ruleType).toBe('count');
  });

  it('every listed rule has a patch', () => {
    expect(SIM_RULES.length).toBeGreaterThan(8);
    for (const r of SIM_RULES) expect(simRulePatch(r.key)).not.toBeNull();
    expect(simRulePatch('nope:x')).toBeNull();
  });
});
