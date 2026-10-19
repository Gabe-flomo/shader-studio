/**
 * The example ↔ node-type index (exampleNodeIndexBuild.ts → exampleNodes.json → exampleNodeIndex.ts).
 * WRITE_EXAMPLE_NODES=1 rewrites the JSON from the current examples; otherwise this fails when the
 * shipped table is stale, and checks it covers every listed example and ranks as documented.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { EXAMPLE_GRAPHS } from '../exampleGraphs';
import { EXAMPLE_FOLDERS, HIDDEN_EXAMPLE_KEYS, RETIRED_EXAMPLE_KEYS } from '../exampleIndex';
import { buildExampleNodeTable, scoreTypes, typesIn } from '../exampleNodeIndexBuild';
import { EXAMPLE_NODE_TABLE, examplesForCategory, examplesForType, examplesForTypes } from '../exampleNodeIndex';
import shipped from '../exampleNodes.json';
import { nodesOfRow } from '../../components/NodeGraph/libraryRows';

const showcase = EXAMPLE_FOLDERS.filter(f => !f.course).flatMap(f => f.keys);
const courses = EXAMPLE_FOLDERS.filter(f => f.course).flatMap(f => f.keys);
const built = buildExampleNodeTable({ graphs: EXAMPLE_GRAPHS, showcase, courses, retired: RETIRED_EXAMPLE_KEYS });
const write = !!(import.meta.env as Record<string, unknown>).WRITE_EXAMPLE_NODES;

describe('example ↔ node index', () => {
  it('writes the table when asked', async () => {
    if (!write) return;
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync: (f: URL, s: string) => void };
    fs.writeFileSync(new URL('../exampleNodes.json', import.meta.url), JSON.stringify(built) + '\n');
  });

  it('is fresh (regenerate with WRITE_EXAMPLE_NODES=1)', () => {
    if (write) return;
    expect(shipped).toEqual(built);
  });

  it('covers every listed example (showcase folders and courses), and no hidden one', () => {
    const t = write ? built : EXAMPLE_NODE_TABLE;
    for (const k of [...showcase, ...courses]) {
      if (!EXAMPLE_GRAPHS[k]) continue;
      expect(t.examples[k], k).toBeDefined();
    }
    for (const k of HIDDEN_EXAMPLE_KEYS) if (!showcase.includes(k) && !courses.includes(k)) expect(t.examples[k]).toBeUndefined();
    for (const k of showcase) if (t.examples[k]) expect(t.examples[k].tier).toBe(0);
  });

  it('keeps a retired example only for types no listed example uses', () => {
    const listed = new Set(Object.values(built.examples).filter(e => e.tier < 2).flatMap(e => e.t));
    for (const e of Object.values(built.examples)) if (e.tier === 2) for (const t of e.t) expect(listed.has(t)).toBe(false);
  });

  it('walks groups and resolves aliases', () => {
    const g = [
      { id: 'o', type: 'output', inputs: { color: { connection: { nodeId: 'g' } } } },
      { id: 'g', type: 'group', inputs: {}, params: { subgraph: { nodes: [{ id: 'm', type: 'smoothMin', inputs: {} }], outputPorts: [{ fromNodeId: 'm' }] } } },
    ];
    expect([...typesIn(g)].sort()).toEqual(['group', 'sdfUnion']);
    // Near the Output scores higher than far from it.
    const rows = Object.fromEntries(scoreTypes(g));
    expect(rows.group).toBeGreaterThan(rows.sdfUnion);
  });

  it('a node near the Output in a small graph is central; one off to the side is incidental', () => {
    const g = [
      { id: 'o', type: 'output', inputs: { color: { connection: { nodeId: 'l' } } } },
      { id: 'l', type: 'light', inputs: { distance: { connection: { nodeId: 'c' } } } },
      { id: 'c', type: 'circleSDF', inputs: {} },
      { id: 'x', type: 'fbm', inputs: {} },
    ];
    const rows = Object.fromEntries(scoreTypes(g));
    expect(rows.circleSDF).toBeGreaterThan(rows.fbm);
  });

  it('a graph that is only the new-graph starter (a Play or data example) is not a Circle SDF example', () => {
    const g = [
      { id: 'o', type: 'output', inputs: { color: { connection: { nodeId: 'l' } } } },
      { id: 'l', type: 'light', inputs: { distance: { connection: { nodeId: 'c' } } } },
      { id: 'c', type: 'circleSDF', inputs: { position: { connection: { nodeId: 'u' } } } },
      { id: 'u', type: 'uv', inputs: {} },
    ];
    expect(scoreTypes(g)).toEqual([]);
  });

  it('Circle SDF has examples, curated keeps first', () => {
    const hits = examplesForType('circleSDF', 4);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].tier).toBe(0);
    for (let i = 1; i < hits.length; i++) expect(hits[i].tier).toBeGreaterThanOrEqual(hits[i - 1].tier);
    expect(hits.every(h => h.types.includes('circleSDF'))).toBe(true);
  });

  it('retired examples are not shown when listed ones use the node', () => {
    const retired = new Set(RETIRED_EXAMPLE_KEYS);
    for (const type of ['circleSDF', 'fbm', 'palette', 'light']) {
      expect(examplesForType(type, 20).some(h => retired.has(h.key)), type).toBe(false);
    }
    expect(examplesForTypes(['circleSDF', 'fbm'], 20).some(h => retired.has(h.key))).toBe(false);
  });

  it('a category has examples', () => {
    const types = nodesOfRow('Noise').map(d => d.type);
    const hits = examplesForCategory(types, 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.types.some(t => types.includes(t)))).toBe(true);
  });
});
