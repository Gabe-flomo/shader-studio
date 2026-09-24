import { describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../exampleGraphs';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../exampleIndex';
import type { GraphNode } from '../../types/nodeGraph';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

const walk = (nodes: GraphNode[], visit: (n: GraphNode) => void) => {
  for (const n of nodes) {
    visit(n);
    const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sg?.nodes) walk(sg.nodes, visit);
  }
};

describe('bundled examples', () => {
  const keys = Object.keys(EXAMPLE_GRAPHS);

  it('are all listed in the index and filed in exactly one folder', () => {
    expect(Object.keys(EXAMPLE_INDEX).sort()).toEqual(keys.sort());
    const filed = EXAMPLE_FOLDERS.flatMap(f => f.keys);
    const missing = keys.filter(k => k !== 'blank' && !filed.includes(k));
    expect(missing, 'examples no folder shows').toEqual([]);
    expect(filed.filter((k, i) => filed.indexOf(k) !== i), 'filed twice').toEqual([]);
    expect(filed.filter(k => !EXAMPLE_GRAPHS[k]), 'folder points at a missing example').toEqual([]);
  });

  it('use only current node types (no deprecated or unknown nodes)', () => {
    const bad: string[] = [];
    for (const k of keys) {
      walk(EXAMPLE_GRAPHS[k].nodes, n => {
        const def = getNodeDefinition(n.type);
        if (!def) bad.push(`${k}: unknown ${n.type}`);
        else if (def.deprecated) bad.push(`${k}: deprecated ${n.type}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('all compile without errors', () => {
    const failures: string[] = [];
    for (const k of keys) {
      const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition);
      const r = compileGraph({ nodes });
      if (!r.success) failures.push(`${k}: ${(r.errors ?? []).join('; ').slice(0, 120)}`);
    }
    expect(failures).toEqual([]);
  });

  it('vectorised arithmetic nodes declare the type their sockets carry (the GPU compiles from params.outputType)', () => {
    const ARITH = new Set(['add', 'subtract', 'multiply', 'divide', 'mix', 'mod', 'abs', 'fractRaw', 'floor', 'ceil', 'smoothstep', 'clamp', 'max', 'minMath']);
    const bad: string[] = [];
    for (const k of keys) {
      walk(EXAMPLE_GRAPHS[k].nodes, n => {
        if (!ARITH.has(n.type)) return;
        const vec = Object.values(n.inputs).map(i => i.type).find(t => t === 'vec2' || t === 'vec3' || t === 'vec4');
        const declared = n.params?.outputType;
        if (vec && declared !== vec) bad.push(`${k}/${n.id} (${n.type}): sockets are ${vec} but params.outputType is ${String(declared)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
