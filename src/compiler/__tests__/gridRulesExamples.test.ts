/**
 * The Grid Rules examples (store/gridRulesExamples.ts): in the Simulations: grids folder, each beside
 * the wired version it rebuilds; a handful of nodes each, every one with a note; each compiles to a
 * board Pass reading its own Previous, and its board steps on the CPU (glslRun.ts) from an empty Pass.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../../store/exampleIndex';
import { GRID_RULES_EXAMPLE_KEYS } from '../../store/gridRulesExampleIndex';
import { SIM_GRID_EXAMPLE_KEYS } from '../../store/simGridExamples';
import { gridCellsId } from '../gridRulesExpand';
import { stepperFor } from './gridHarness';
import { makeBoard } from './glslRun';

describe('the Grid Rules examples', () => {
  it('sit in Simulations: grids, each beside the wired version it rebuilds', () => {
    const keys = EXAMPLE_FOLDERS.find(f => f.label === 'Simulations: grids')!.keys;
    expect(keys).toEqual(expect.arrayContaining([...GRID_RULES_EXAMPLE_KEYS, ...SIM_GRID_EXAMPLE_KEYS]));
    for (const k of GRID_RULES_EXAMPLE_KEYS) {
      expect(EXAMPLE_INDEX[k].label).toMatch(/\(Grid Rules\)$/);
      const n = EXAMPLE_INDEX[k].label.match(/^Grid sims (\d+) ·/)![1];
      if (Number(n) > SIM_GRID_EXAMPLE_KEYS.length) continue; // new ones, with no wired twin
      const wired = keys[keys.indexOf(k) + 1];
      expect(EXAMPLE_INDEX[wired].label, k).toMatch(new RegExp(`^Grid sims ${n} · .*\\(under the hood\\)$`));
    }
    for (const k of SIM_GRID_EXAMPLE_KEYS) expect(EXAMPLE_INDEX[k].label).toMatch(/\(under the hood\)$/);
  });

  it('are a few nodes each, every one with a note', () => {
    for (const k of GRID_RULES_EXAMPLE_KEYS) {
      const nodes = EXAMPLE_GRAPHS[k].nodes;
      expect(nodes.length, k).toBeLessThanOrEqual(k === 'gridRulesWire' ? 6 : 4);
      expect(nodes.filter(nd => nd.type === 'gridRules'), k).toHaveLength(1);
      for (const nd of nodes) {
        expect(getNodeDefinition(nd.type), `${k}: ${nd.type}`).toBeTruthy();
        expect(String(nd.params.__comment ?? '').length, `${k}: ${nd.id}`).toBeGreaterThan(20);
      }
      expect(EXAMPLE_GRAPHS[k].play!.notes).toMatch(/\*\*What it shows\.\*\*/);
    }
  });

  it('compile to a board that reads its own Previous, and step on the CPU', () => {
    for (const k of GRID_RULES_EXAMPLE_KEYS) {
      const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition);
      const r = compileGraph({ nodes });
      expect(r.errors, k).toBeUndefined();
      const id = nodes.find(nd => nd.type === 'gridRules')!.id;
      const board = r.passes!.find(p => p.nodeId === gridCellsId(id))!;
      expect(board.readsPrevious, k).toEqual([board.slug]);
      expect(board.live, k).toBe(true);
      const st = stepperFor(r, gridCellsId(id), 12, 9);
      // A start picture's pass (Wireworld's circuit): an empty one here.
      for (const slug of board.reads) { st.samplers[`u_pass_${slug}`] = makeBoard(12, 9); st.uniforms[`u_pass_${slug}_px`] = [0.01, 0.01]; }
      let b = st.step(makeBoard(12, 9));
      b = st.step(b, 3);
      expect([...b.data].every(Number.isFinite), k).toBe(true);
    }
  });
});
