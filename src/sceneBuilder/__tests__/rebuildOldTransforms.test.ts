/**
 * A 3D Scene Builder scene built before moves and turns became one Transform (Translate 3D at `s1:at`,
 * Rotate 3D for a Turn) rebuilds quietly: the old node and the Transform that replaces it are the same
 * item, so nothing is reported for an untouched one, and a setting the user changed is carried onto the
 * Transform under its new name and unit (docs/transform-node.md).
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { parseRecipe } from '../recipe';
import { META_KEY, ROLE_KEY, type SceneBuilderMeta } from '../build';
import { BUILD_KEY, applyScene, checkEdits, snapshot } from '../apply';

const ids = () => { let i = 0; return () => `n${++i}`; };
const inner = (n: GraphNode | undefined): GraphNode[] => ((n?.params.subgraph as SubgraphData | undefined)?.nodes ?? []);

/** The scene as the builder made it before 2026-10-10: the Transform at `role` swapped for `old` (same id, role and wires). */
function asOldBuild(graph: GraphNode[], role: string, oldType: string, params: Record<string, unknown>, posKey: string): GraphNode[] {
  const scene = graph.find(n => n.type === 'sceneGroup')!;
  const nodes = inner(scene);
  const t = nodes.find(n => n.params[ROLE_KEY] === role)!;
  const def = getNodeDefinition(oldType)!;
  const old: GraphNode = {
    id: t.id, type: oldType, position: t.position,
    inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { ...s, ...(k === posKey ? { connection: t.inputs.p.connection } : {}) }])),
    outputs: { ...def.outputs },
    params: { ...def.defaultParams, ...params, [ROLE_KEY]: role, [BUILD_KEY]: t.params[BUILD_KEY], __comment: 'old' },
  };
  const outKey = Object.keys(def.outputs)[0];
  const swapped = nodes.map(n => (n.id === t.id ? old : {
    ...n, inputs: Object.fromEntries(Object.entries(n.inputs).map(([k, s]) => [k, s.connection?.nodeId === t.id ? { ...s, connection: { nodeId: t.id, outputKey: outKey } } : s])),
  }));
  const roleById = new Map(swapped.map(n => [n.id, String(n.params[ROLE_KEY] ?? '')]));
  const meta = structuredClone(scene.params[META_KEY]) as SceneBuilderMeta & { built: Record<string, string> };
  for (const n of swapped) if (n.params[ROLE_KEY]) meta.built[String(n.params[ROLE_KEY])] = JSON.stringify(snapshot(n, roleById));
  return graph.map(n => (n.id === scene.id ? { ...n, params: { ...n.params, [META_KEY]: meta, subgraph: { ...(n.params.subgraph as SubgraphData), nodes: swapped } } } : n));
}

describe('rebuilding a scene built with Translate / Rotate 3D', () => {
  const spec = parseRecipe('surface · box at=(1,0,0)').spec;

  it('reports nothing for an untouched old node, and rebuilds it as the Transform', () => {
    const next = ids();
    let graph = applyScene([], spec, { nextId: next }).nodes;
    const sceneId = graph.find(n => n.type === 'sceneGroup')!.id;
    graph = asOldBuild(graph, 's1:at', 'translate3D', { tx: 1, ty: 0, tz: 0 }, 'pos');
    const report = checkEdits(graph, sceneId, spec);
    expect(report).toEqual({ kept: [], lost: [] });
    const res = applyScene(graph, spec, { nextId: next, sceneId });
    const t = inner(res.nodes.find(n => n.id === sceneId)).find(n => n.params[ROLE_KEY] === 's1:at')!;
    expect([t.type, t.params.x]).toEqual(['transform', 1]);
  });

  it('carries a setting the user changed onto the Transform, and says so', () => {
    const next = ids();
    let graph = applyScene([], spec, { nextId: next }).nodes;
    const sceneId = graph.find(n => n.type === 'sceneGroup')!.id;
    graph = asOldBuild(graph, 's1:at', 'translate3D', { tx: 1, ty: 0, tz: 0 }, 'pos');
    // The user moved the box up on the old node.
    graph = graph.map(n => (n.id !== sceneId ? n : { ...n, params: { ...n.params, subgraph: { ...(n.params.subgraph as SubgraphData), nodes: inner(n).map(m => (m.type === 'translate3D' ? { ...m, params: { ...m.params, ty: 0.5 } } : m)) } } }));
    const report = checkEdits(graph, sceneId, spec);
    expect(report.lost).toEqual([]);
    expect(report.kept).toEqual(['Translate 3D · Y (kept on the Transform that replaces it)']);
    const res = applyScene(graph, spec, { nextId: next, sceneId });
    const t = inner(res.nodes.find(n => n.id === sceneId)).find(n => n.params[ROLE_KEY] === 's1:at')!;
    expect([t.type, t.params.x, t.params.y]).toEqual(['transform', 1, 0.5]);
    expect(res.kept).toContain('Translate 3D · Y');
  });

  it('a Turn built as Rotate 3D (radians) keeps a changed angle, in degrees on the Transform', () => {
    const turnSpec = parseRecipe('surface · box @turn(y 30)').spec;
    const next = ids();
    let graph = applyScene([], turnSpec, { nextId: next }).nodes;
    const sceneId = graph.find(n => n.type === 'sceneGroup')!.id;
    const role = inner(graph.find(n => n.id === sceneId)).find(n => n.type === 'transform')!.params[ROLE_KEY] as string;
    graph = asOldBuild(graph, role, 'rotate3D', { axis: 'y', angle: 30 * Math.PI / 180 }, 'pos');
    expect(checkEdits(graph, sceneId, turnSpec)).toEqual({ kept: [], lost: [] });
    graph = graph.map(n => (n.id !== sceneId ? n : { ...n, params: { ...n.params, subgraph: { ...(n.params.subgraph as SubgraphData), nodes: inner(n).map(m => (m.type === 'rotate3D' ? { ...m, params: { ...m.params, angle: Math.PI / 4 } } : m)) } } }));
    const res = applyScene(graph, turnSpec, { nextId: next, sceneId });
    const t = inner(res.nodes.find(n => n.id === sceneId)).find(n => n.params[ROLE_KEY] === role)!;
    expect(t.type).toBe('transform');
    expect(t.params.ry as number).toBeCloseTo(45, 9);
  });
});
