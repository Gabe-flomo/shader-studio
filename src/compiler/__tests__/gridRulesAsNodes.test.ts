/**
 * Grid Rules → Open as nodes (store/gridRulesAsNodes.ts): the graph it builds compiles, every
 * node has a note (Expression Blocks explain each named line), and, stepped on the CPU from the
 * same board, it gives the same states as the compact node, step after step, for each rule type.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { n } from '../../store/graphBuilder';
import { gridAsNodesProblem, gridRulesAsNodes } from '../../store/gridRulesAsNodes';
import { COUNT_PRESETS, GRID_DEFAULTS, SMOOTH_PRESETS, STAGES_PRESETS, gridShape, gridSignature } from '../../gridRules/spec';
import { BLOCK_PRESETS, PATTERN_PRESETS } from '../../gridRules/stencils';
import { getNodeDefinition } from '../../nodes/definitions';
import { gridCellsId } from '../gridRulesExpand';
import { boardFrom, compileNodes, gridOf, randomGrid, rounded, stepperFor } from './gridHarness';
import type { GraphNode } from '../../types/nodeGraph';
import { newStackRule, type StackKind, type StackRule } from '../../gridRules/stack';
import { compileFragment, drawPass, type Board, type Env } from './glslRun';

const G = 'node_3';

function build(params: Record<string, unknown>) {
  const src = n('gridRules', G, 0, 0, { label: 'Test', rate: 1, ...params });
  let k = 100;
  const opened = gridRulesAsNodes(src, () => `node_${k++}`, { x: 0, y: 600 }, new Set(['color', 'state', 'texture']));
  const nodes: GraphNode[] = [src, ...opened.nodes, n('output', 'node_9', 0, 0, {}, { color: [opened.outputs.color!.nodeId, opened.outputs.color!.outputKey] })];
  return { src, opened, nodes };
}

const CASES: Array<[string, Record<string, unknown>]> = [
  ['Life', {}],
  ['HighLife, walls', { ...COUNT_PRESETS.highLife.params, edges: 'walls' }],
  ['Diamonds (von Neumann)', { ...COUNT_PRESETS.diamonds.params }],
  ['Larger than Life, radius 2', { neighbourhood: 'radius', radius: 2, shape: 'box', bornLo: 6, bornHi: 9, surviveLo: 5, surviveHi: 11 }],
  ['Larger than Life, radius 2 circle, walls', { neighbourhood: 'radius', radius: 2, shape: 'circle', bornLo: 4, bornHi: 6, surviveLo: 3, surviveHi: 8, edges: 'walls' }],
  ['Brian\'s Brain', { ruleType: 'stages', ...STAGES_PRESETS.briansBrain.params }],
  ['Star Wars, steps 3', { ruleType: 'stages', ...STAGES_PRESETS.starWars.params, steps: 3 }],
  ['Heat', { ruleType: 'smooth', ...SMOOTH_PRESETS.heat.params }],
  ['Ripples, walls', { ruleType: 'smooth', ...SMOOTH_PRESETS.ripples.params, edges: 'walls' }],
  ['Mitosis', { ruleType: 'smooth', ...SMOOTH_PRESETS.mitosis.params }],
  ['Wireworld, walls', { ruleType: 'patterns', edges: 'walls', ...PATTERN_PRESETS.wireworld.params }],
  ['Patterns with turns, mirrors and a count', { ruleType: 'patterns', states: 3, patterns: [
    { cells: [1, -1, -1, -1, 0, -1, -1, -1, 2], becomes: 2, symmetry: 'all' },
    { cells: [-1, -2, -1, -1, 1, -1, -1, -1, -1], becomes: 0, symmetry: 'rotate', count: { state: 2, min: 2, max: 8 } },
    { cells: [-1, -1, -1, -1, 2, -1, -1, -1, -1], becomes: 1, symmetry: 'none' },
  ] }],
  ['Falling sand (dice, Jitter 1), walls', { ruleType: 'blocks', edges: 'walls', ...BLOCK_PRESETS.sand.params, jitter: 1 }],
  ['Gas, wrap', { ruleType: 'blocks', ...BLOCK_PRESETS.gas.params }],
  ['Custom', { ruleType: 'smooth', template: 'custom', customU: 'u + 0.2 * lap_u + a * (n - s) * 0.1', customV: 'v * 0.9 + avg_u * 0.1', knobA: 0.7 }],
];

describe('Open as nodes', { timeout: 60000 }, () => {
  it('builds registered nodes, wired to real sockets, each with a note', () => {
    for (const [name, params] of CASES) {
      const { opened } = build(params);
      const byId = new Map(opened.nodes.map(x => [x.id, x]));
      const missing: string[] = [];
      for (const nd of opened.nodes) {
        expect(getNodeDefinition(nd.type), `${name}: ${nd.type}`).toBeTruthy();
        const text = String(nd.params.__comment ?? '');
        if (text.trim().length < 20) missing.push(`${name}: ${nd.id} (${nd.type})`);
        for (const [key, inp] of Object.entries(nd.inputs)) {
          if (!inp.connection) continue;
          const from = byId.get(inp.connection.nodeId);
          expect(from, `${name}: ${nd.id}.${key} wired to missing ${inp.connection.nodeId}`).toBeTruthy();
          expect(from!.outputs[inp.connection.outputKey], `${name}: ${nd.id}.${key} → ${from!.type}.${inp.connection.outputKey}`).toBeTruthy();
        }
        if (nd.type !== 'exprNode') continue;
        for (const line of (nd.params.lines ?? []) as Array<{ lhs: string }>) {
          const nm = line.lhs.trim().split(/\s+/).pop()!;
          if (!new RegExp(`(^|\\W)${nm}( = [^\\n:]*)?:`, 'm').test(text)) missing.push(`${name}/${nd.id}: line "${nm}"`);
        }
        if (!/(^|\n)result:/.test(text)) missing.push(`${name}/${nd.id}: result`);
      }
      expect(missing).toEqual([]);
    }
  });

  it('opens every rule now (big neighbourhoods are counted in one block)', () => {
    expect(gridAsNodesProblem(n('gridRules', 'x', 0, 0, { neighbourhood: 'radius', radius: 3 }))).toBeNull();
    expect(gridAsNodesProblem(n('gridRules', 'x', 0, 0, { neighbourhood: 'radius', radius: 2 }))).toBeNull();
    expect(gridAsNodesProblem(n('gridRules', 'x', 0, 0, {}))).toBeNull();
  });

  for (const [name, params] of CASES) {
    it(`gives the same board as the node, step after step: ${name}`, () => {
      const { opened, nodes } = build(params);
      const r = compileNodes(nodes);
      expect(r.errors, name).toBeUndefined();
      const shape = gridShape({ ...GRID_DEFAULTS, ...params });
      const discrete = shape.type !== 'smooth';
      const W = 9, H = 8;
      const compact = stepperFor(r, gridCellsId(G), W, H);
      const graph = stepperFor(r, opened.boardId, W, H);
      const states = shape.type === 'count' ? 1 : Number((params as { states?: number }).states ?? 3) - 1;
      const start = randomGrid(W, H, 13, 0.4, states);
      const second = discrete ? null : randomGrid(W, H, 17, 0.3);
      const wrap = shape.wrap ? 'repeat' : 'clamp';
      let a = boardFrom(start, gridSignature(shape), wrap, second);
      let b = boardFrom(start, gridSignature(shape), wrap, second);
      for (let k = 1; k <= 6; k++) {
        compact.uniforms.u_time = graph.uniforms.u_time = 1 + k / 60;
        a = compact.step(a);
        b = graph.step(b);
        if (discrete) expect(rounded(gridOf(b)), `${name}, step ${k}`).toEqual(rounded(gridOf(a)));
        const [ra, rb, ga, gb] = [gridOf(a).flat(), gridOf(b).flat(), gridOf(a, 1).flat(), gridOf(b, 1).flat()];
        ra.forEach((v, i) => expect(rb[i], `${name}, step ${k}, red ${i}`).toBeCloseTo(v, 5));
        ga.forEach((v, i) => expect(gb[i], `${name}, step ${k}, green ${i}`).toBeCloseTo(v, 5));
      }
      // The boards are alive: something changed from the start.
      if (discrete) expect(rounded(gridOf(a))).not.toEqual(start);
    });
  }
});

// ── Stacked rules open as a Pass a card, and big neighbourhoods as one counting block ────────────

const stackCard = (kind: StackKind, o: Partial<StackRule> = {}): StackRule => ({ ...newStackRule(kind), ...o });
const STILL = { bornMask: 0, surviveMask: 511 };
const STACK_CASES: Array<[string, Record<string, unknown>, number?]> = [
  ['Life + explode', { stack: [stackCard('explode', { copies: 8, distance: 2, chance: 0.5 })] }],
  ['Life + crowd moves away + drift, walls', { edges: 'walls', stack: [stackCard('crowd', { lo: 3, move: true }), stackCard('drift', { dir: 2, chance: 0.5 })] }],
  ['Brian\'s Brain + drift (any), walls', { ruleType: 'stages', ...STAGES_PRESETS.briansBrain.params, edges: 'walls', stack: [stackCard('drift', { dir: 7, any: true })] }, 2],
  ['Wireworld + cluster', { ruleType: 'patterns', ...PATTERN_PRESETS.wireworld.params, stack: [stackCard('cluster', { radius: 1, lo: 4, becomes: 0, chance: 0.6 })] }, 3],
  ['Movers: collide bounce → move, walls', { ...STILL, edges: 'walls', stack: [stackCard('collide', { act: 'bounce' }), stackCard('move', { assign: 0, act: 'bounce' })] }],
  ['Fireworks: collide explode → move → cluster', { ...STILL, stack: [stackCard('collide', { act: 'explode', fly: true }), stackCard('move', { assign: 0 }), stackCard('cluster', { radius: 2, lo: 9 })] }],
  ['Merge → move (turn), Speed ½', { ...STILL, rate: 0.5, stack: [stackCard('collide', { act: 'merge' }), stackCard('move', { assign: 0, act: 'turn' })] }],
  ['Life → move (newborns head off), headings drawn', { start: 'cells', startCells: { w: 3, h: 2, rows: ['11.', '.11'], heads: ['3..', '.76'] }, stack: [stackCard('move', { assign: 0, chance: 0.7 })] }],
];

/** Every pass of a graph stepped a frame at a time, in the order given: each reads the others' boards (this frame's, else last frame's) and Previous. */
function multiStepper(r: ReturnType<typeof compileNodes>, ids: string[], w: number, h: number) {
  const passes = ids.map(id => r.passes!.find(p => p.nodeId === id)!);
  const programs = passes.map(p => compileFragment(p.fragmentShader));
  const uniforms: Env = { ...(r.paramUniforms as Env), u_time: 1, u_frameDt: 1 / 60, u_resolution: [w, h], u_mouse: [-1000, -1000], u_mousebtn: 0 };
  for (const p of passes) uniforms[`u_pass_${p.slug}_px`] = uniforms[`u_passprev_${p.slug}_px`] = [p.scale / w, p.scale / h];
  const step = (prev: Record<string, Board>): Record<string, Board> => {
    const cur: Record<string, Board> = {};
    passes.forEach((p, i) => {
      const samplers: Record<string, Board> = {};
      for (const q of passes) { samplers[`u_pass_${q.slug}`] = cur[q.nodeId] ?? prev[q.nodeId]; samplers[`u_passprev_${q.slug}`] = prev[q.nodeId]; }
      cur[p.nodeId] = drawPass(programs[i], w, h, p.wrap === 'repeat' ? 'repeat' : 'clamp', samplers, uniforms);
    });
    return cur;
  };
  return { step, uniforms };
}

describe('Open as nodes: stacked rules (a Pass a card) and big neighbourhoods', { timeout: 120000 }, () => {
  it('builds the base and one Pass a card, in order, the base reading the last card\'s Previous', () => {
    const { opened } = build({ stack: [stackCard('explode'), stackCard('drift')] });
    expect(opened.stageIds).toHaveLength(2);
    const passes = opened.nodes.filter(x => x.type === 'pass').map(x => x.id);
    expect(passes).toEqual(expect.arrayContaining([opened.boardId, ...opened.stageIds]));
    // Nothing reads the base's own Previous; the reads a step ago are the last card's.
    const prevReads = opened.nodes.flatMap(x => Object.values(x.inputs).filter(i => i.connection?.outputKey === 'previous').map(i => i.connection!.nodeId));
    expect(prevReads.length).toBeGreaterThan(0);
    expect(new Set(prevReads)).toEqual(new Set([opened.stageIds[1]]));
    // Card 2's block reads card 1's Pass; the board output is the last card's.
    const card2 = opened.nodes.find(x => x.type === 'exprNode' && String(x.params.label).startsWith('Card 2'))!;
    expect(card2.inputs.board.connection!.nodeId).toBe(opened.stageIds[0]);
    expect(opened.outputs.board!.nodeId).toBe(opened.stageIds[1]);
    expect(gridAsNodesProblem(n('gridRules', 'x', 0, 0, { stack: [stackCard('move')] }))).toBeNull();
  });

  it('every stacked graph\'s nodes have notes and real sockets', () => {
    for (const [name, params] of STACK_CASES) {
      const { opened } = build(params);
      const byId = new Map(opened.nodes.map(x => [x.id, x]));
      for (const nd of opened.nodes) {
        expect(String(nd.params.__comment ?? '').length, `${name}: ${nd.id} (${nd.type})`).toBeGreaterThan(20);
        for (const [key, inp] of Object.entries(nd.inputs)) {
          if (!inp.connection) continue;
          expect(byId.get(inp.connection.nodeId)?.outputs[inp.connection.outputKey], `${name}: ${nd.id}.${key}`).toBeTruthy();
        }
      }
    }
  });

  for (const [name, params, maxState] of STACK_CASES) {
    it(`gives the same board as the node, step after step: ${name}`, () => {
      const { opened, nodes } = build(params);
      const r = compileNodes(nodes);
      expect(r.errors, name).toBeUndefined();
      const shape = gridShape({ ...GRID_DEFAULTS, ...params });
      const W = 11, H = 9;
      const compactPass = r.passes!.find(p => p.nodeId === gridCellsId(G))!;
      const compact = stepperFor(r, gridCellsId(G), W, H);
      const graph = multiStepper(r, [opened.boardId, ...opened.stageIds], W, H);
      const last = opened.stageIds[opened.stageIds.length - 1];
      const start = randomGrid(W, H, 21 + name.length, 0.35, maxState ?? 1);
      // A few cells start with headings (red's fraction), as a drawn or moving board has them.
      start.forEach((row, y) => row.forEach((v, x) => { if (v && (x + y) % 3) row[x] = v + (1 + ((x * 7 + y) % 8)) / 32; }));
      const wrap = shape.wrap ? 'repeat' : 'clamp';
      let a = boardFrom(start, gridSignature(shape), wrap);
      let boards: Record<string, Board> = Object.fromEntries([opened.boardId, ...opened.stageIds].map(id => [id, boardFrom(start, gridSignature(shape), wrap)]));
      const repeat = compactPass.repeat ?? 1;
      for (let k = 1; k <= 6; k++) {
        compact.uniforms.u_time = graph.uniforms.u_time = 1 + k / 60;
        let cur = a;
        for (let i = 0; i < repeat; i++) { compact.uniforms[`u_passiter_${compactPass.slug}`] = [i, repeat]; cur = compact.step(cur); }
        a = cur;
        boards = graph.step(boards);
        const b = boards[last];
        const [ra, rb, ga, gb] = [gridOf(a).flat(), gridOf(b).flat(), gridOf(a, 1).flat(), gridOf(b, 1).flat()];
        ra.forEach((v, i) => expect(rb[i], `${name}, step ${k}, red ${i}`).toBeCloseTo(v, 5));
        ga.forEach((v, i) => expect(gb[i], `${name}, step ${k}, green ${i}`).toBeCloseTo(v, 5));
      }
      expect(gridOf(a)).not.toEqual(start);
    });
  }

  it('a new board deals the drawing\'s headings as the node does', () => {
    const params = STACK_CASES.find(c => c[0].includes('headings drawn'))![1];
    const { opened, nodes } = build(params);
    const r = compileNodes(nodes);
    const compact = stepperFor(r, gridCellsId(G), 9, 7);
    const compactPass = r.passes!.find(p => p.nodeId === gridCellsId(G))!;
    compact.uniforms[`u_passiter_${compactPass.slug}`] = [0, compactPass.repeat ?? 1];
    const graph = multiStepper(r, [opened.boardId, ...opened.stageIds], 9, 7);
    const empty = boardFrom(Array.from({ length: 7 }, () => Array(9).fill(0)), 0);
    const a = compact.step(empty);
    const b = graph.step(Object.fromEntries([opened.boardId, ...opened.stageIds].map(id => [id, empty])))[opened.boardId];
    expect(gridOf(b)).toEqual(gridOf(a));
    expect(gridOf(a).flat().filter(v => v % 1 !== 0)).toHaveLength(3);
  });

  for (const [name, params] of [
    ['radius 3 (48 cells), counted in one block', { neighbourhood: 'radius', radius: 3, shape: 'box', bornLo: 10, bornHi: 16, surviveLo: 8, surviveHi: 20 }],
    ['your own 7×7 neighbourhood (48 cells, weighted)', { neighbourhood: 'custom', stencil: { size: 7, cells: Array.from({ length: 49 }, (_, i) => (i === 24 ? 0 : 1 + (i % 3 === 0 ? 1 : 0))) }, bornLo: 14, bornHi: 22, surviveLo: 10, surviveHi: 28 }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`opens and steps as the node: ${name}`, () => {
      expect(gridAsNodesProblem(n('gridRules', 'x', 0, 0, params))).toBeNull();
      const { opened, nodes } = build(params);
      expect(opened.nodes.filter(x => x.type === 'sampleTexture').length).toBeLessThan(5);
      const r = compileNodes(nodes);
      expect(r.errors, name).toBeUndefined();
      const W = 13, H = 11;
      const compact = stepperFor(r, gridCellsId(G), W, H);
      const graph = stepperFor(r, opened.boardId, W, H);
      const shape = gridShape({ ...GRID_DEFAULTS, ...params });
      const start = randomGrid(W, H, 5, 0.45);
      let a = boardFrom(start, gridSignature(shape)), b = boardFrom(start, gridSignature(shape));
      for (let k = 1; k <= 5; k++) {
        compact.uniforms.u_time = graph.uniforms.u_time = 1 + k / 60;
        a = compact.step(a); b = graph.step(b);
        expect(rounded(gridOf(b)), `${name}, step ${k}`).toEqual(rounded(gridOf(a)));
      }
      expect(rounded(gridOf(a))).not.toEqual(start);
    });
  }
});
