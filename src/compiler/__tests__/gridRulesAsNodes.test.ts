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
  ['Falling sand (dice), walls', { ruleType: 'blocks', edges: 'walls', ...BLOCK_PRESETS.sand.params }],
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

  it('turns radius 3 and up down, saying why', () => {
    expect(gridAsNodesProblem(n('gridRules', 'x', 0, 0, { neighbourhood: 'radius', radius: 3 }))).toMatch(/Radius 3 counts 48 cells/);
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
