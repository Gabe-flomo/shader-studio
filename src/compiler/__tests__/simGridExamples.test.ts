/**
 * The Simulations: grids examples (docs/simulations-grids.md): a folder of their own, built only
 * from existing nodes, every node with a plain-language note (Expression Blocks explaining each
 * named line), each compiling to a board Pass that reads its own Previous, and each Play control
 * aimed at a live param (examples.test.ts checks the targets for every example).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../../store/exampleIndex';
import { SIM_GRID_EXAMPLE_KEYS } from '../../store/simGridExamples';
import type { GraphNode } from '../../types/nodeGraph';

const walk = (nodes: GraphNode[], visit: (nd: GraphNode) => void) => {
  for (const nd of nodes) { visit(nd); const sg = nd.params?.subgraph as { nodes?: GraphNode[] } | undefined; if (sg?.nodes) walk(sg.nodes, visit); }
};

describe('the Simulations: grids examples', () => {
  it('are a folder of their own and listed in the index', () => {
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Simulations: grids')?.keys).toEqual(SIM_GRID_EXAMPLE_KEYS);
    expect(SIM_GRID_EXAMPLE_KEYS.length).toBeGreaterThanOrEqual(7);
    for (const k of SIM_GRID_EXAMPLE_KEYS) {
      expect(EXAMPLE_INDEX[k]?.label, k).toBeTruthy();
      expect(EXAMPLE_GRAPHS[k], k).toBeTruthy();
    }
  });

  it('use only registered node types, with unique ids and wires to real sockets', () => {
    for (const k of SIM_GRID_EXAMPLE_KEYS) {
      const nodes = EXAMPLE_GRAPHS[k].nodes;
      const ids = new Set<string>();
      for (const nd of nodes) {
        expect(getNodeDefinition(nd.type), `${k}: ${nd.type}`).toBeTruthy();
        expect(ids.has(nd.id), `${k}: duplicate id ${nd.id}`).toBe(false);
        ids.add(nd.id);
      }
      const byId = new Map(nodes.map(nd => [nd.id, nd]));
      for (const nd of nodes) for (const [key, inp] of Object.entries(nd.inputs)) {
        if (!inp.connection) continue;
        const from = byId.get(inp.connection.nodeId);
        expect(from, `${k}: ${nd.id}.${key} wired to missing ${inp.connection.nodeId}`).toBeTruthy();
        expect(from!.outputs[inp.connection.outputKey], `${k}: ${nd.id}.${key} wired to missing output ${inp.connection.nodeId}.${inp.connection.outputKey}`).toBeTruthy();
      }
    }
  });

  it('compile, with a board Pass that reads its own Previous', () => {
    for (const k of SIM_GRID_EXAMPLE_KEYS) {
      const r = compileGraph({ nodes: resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition) });
      expect(r.errors, k).toBeUndefined();
      expect(r.success, k).toBe(true);
      const passes = (r as { passes?: Array<{ previous: boolean; live: boolean; readsPrevious: string[]; slug: string }> }).passes ?? [];
      expect(passes.length, k).toBeGreaterThan(0);
      expect(passes.some(p => p.previous && p.live && p.readsPrevious.includes(p.slug)), `${k}: a Pass fed back through its Previous`).toBe(true);
    }
  });

  it('every node has a plain-language note, and Expression Blocks explain each named line', () => {
    const missing: string[] = [];
    for (const k of SIM_GRID_EXAMPLE_KEYS) walk(EXAMPLE_GRAPHS[k].nodes, nd => {
      const text = String(nd.params?.__comment ?? '');
      if (text.trim().length < 20) missing.push(`${k}: ${nd.id} (${nd.type})`);
      if (nd.type !== 'exprNode') return;
      for (const line of (nd.params.lines ?? []) as Array<{ lhs: string }>) {
        const name = line.lhs.trim().split(/\s+/).pop()!;
        if (!new RegExp(`(^|\\W)${name}( = [^\\n:]*)?:`, 'm').test(text)) missing.push(`${k}/${nd.id}: line "${name}"`);
      }
      if (!/(^|\n)result:/.test(text)) missing.push(`${k}/${nd.id}: result`);
    });
    expect(missing).toEqual([]);
  });

  it('each has Play notes and at least two controls', () => {
    for (const k of SIM_GRID_EXAMPLE_KEYS) {
      const play = EXAMPLE_GRAPHS[k].play!;
      expect(play.notes, k).toMatch(/\*\*What it shows\.\*\*/);
      expect(play.controls.length, k).toBeGreaterThanOrEqual(2);
    }
  });
});
