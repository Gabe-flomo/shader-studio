/**
 * apply.ts — putting a Grid scene into the user's graph and rebuilding it later, the 2D Scene
 * Builder's scheme (sceneBuilder2d/apply.ts) with the Grid builder's own keys:
 *
 *   - every node carries its role (`_gsRole`) and its build (`_gsBuild`); the UV node keeps the
 *     spec (`gridScene`) and, per role, a fingerprint of what was built;
 *   - a rebuild keeps each node's id per role (Play controls and the user's wires stay), its
 *     place on the canvas, and a setting the user changed that the new spec doesn't change.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { placeInFreeSpace } from '../store/agentSetup';
import { GS_BUILD, GS_META, GS_ROLE, buildGridScene, type GridSceneMeta } from './build';
import type { GridSceneSpec } from './spec';
import { ensureSources } from '../builders/textures';

const ignored = (k: string) => k === '__comment' || k.startsWith('_') || k.includes('::') || k === GS_META || k === 'glslFunctions' || k === 'lines' || k === 'inputs' || k === 'outputs';
const roleOf = (n: GraphNode) => (typeof n.params[GS_ROLE] === 'string' ? n.params[GS_ROLE] as string : '');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Snapshot { type: string; params: Record<string, unknown> }
const snapshot = (n: GraphNode): Snapshot => ({ type: n.type, params: Object.fromEntries(Object.entries(n.params).filter(([k]) => !ignored(k))) });

/** The scene a node holds (the UV node), if the Grid builder made it. */
export function gridMetaOf(node: GraphNode | undefined | null): GridSceneMeta | null {
  const m = node?.params?.[GS_META] as GridSceneMeta | undefined;
  return m && m.v === 1 && Array.isArray(m.spec?.cells) && Array.isArray(m.spec?.shapes) ? m : null;
}

/** The Grid scene (its UV node's id) a node belongs to, from any of its nodes. */
export function gridSceneOfBuild(graph: readonly GraphNode[], anyId: string): string | null {
  const hit = graph.find(n => n.id === anyId);
  if (!hit) return null;
  if (gridMetaOf(hit)) return hit.id;
  const build = hit.params[GS_BUILD];
  if (!build) return null;
  return graph.find(n => gridMetaOf(n)?.build === build)?.id ?? null;
}

/** The nodes of one build, by role. */
export function findGridBuild(graph: readonly GraphNode[], sceneId: string): { scene: GraphNode; meta: GridSceneMeta; byRole: Map<string, GraphNode> } | null {
  const scene = graph.find(n => n.id === sceneId);
  const meta = gridMetaOf(scene);
  if (!scene || !meta) return null;
  const mine = graph.filter(n => (meta.build ? n.params[GS_BUILD] === meta.build : n.id === scene.id) && roleOf(n));
  return { scene, meta, byRole: new Map(mine.map(n => [roleOf(n), n])) };
}

export interface ApplyGridResult {
  nodes: GraphNode[];
  sceneId: string;
  gridId: string;
  finalId: string;
  warnings: string[];
  kept: number;
  /** The spec as built: its pictures each with their node. */
  spec: GridSceneSpec;
}

/**
 * The graph with `spec` built into it: new beside what is there (`asNew`, or nothing to rebuild),
 * or replacing the build of `sceneId`. The graph's Output shows it (unless `keepOutput`).
 */
export function applyGridScene(graph: GraphNode[], spec0: GridSceneSpec, opts: { nextId: () => string; sceneId?: string | null; asNew?: boolean; at?: { x: number; y: number }; keepOutput?: boolean }): ApplyGridResult {
  const found = !opts.asNew && opts.sceneId ? findGridBuild(graph, opts.sceneId) : null;
  const taken = new Set(graph.map(n => n.id));
  const nextId = () => { let id = opts.nextId(); while (taken.has(id)) id = opts.nextId(); taken.add(id); return id; };
  // Every picture the scene reads has a node (builders/textures.ts).
  const ensured = ensureSources(graph, spec0.textures, nextId, found?.byRole.get('uv')?.position ?? opts.at ?? { x: 0, y: 0 });
  const spec: GridSceneSpec = spec0.textures?.length ? { ...spec0, textures: ensured.sources } : spec0;
  graph = [...graph, ...ensured.added];
  const buildKey = found?.meta.build ?? `g${nextId()}`;
  const idOfRole = new Map<string, string>();
  const idFor = (role: string) => {
    if (!idOfRole.has(role)) idOfRole.set(role, found?.byRole.get(role)?.id ?? nextId());
    return idOfRole.get(role)!;
  };
  const built = buildGridScene(spec, idFor);
  const prints: Record<string, string> = {};
  let kept = 0;
  for (const node of built.nodes) {
    const role = roleOf(node);
    const fresh = snapshot(node);
    prints[role] = JSON.stringify(fresh);
    const old = found?.byRole.get(role);
    const was = found?.meta.built?.[role] ? JSON.parse(found.meta.built[role]) as Snapshot : null;
    if (old && was && old.type === node.type) {
      // A setting changed on the node by hand, which the new spec leaves as it was built: keep it.
      for (const [k, v] of Object.entries(old.params)) {
        if (ignored(k)) { if (k.includes('::') || k.startsWith('_fold')) node.params[k] = v; continue; }
        if (k in was.params && !same(v, was.params[k]) && same(fresh.params[k], was.params[k])) { node.params[k] = v; kept++; }
      }
    }
    node.params[GS_BUILD] = buildKey;
  }
  const scene = built.nodes.find(n => n.id === built.sceneId)!;
  scene.params[GS_META] = { v: 1, spec: structuredClone(spec), build: buildKey, built: prints } satisfies GridSceneMeta;

  let top = built.nodes;
  let rest = graph;
  if (found) {
    const oldIds = new Set([...found.byRole.values()].map(n => n.id));
    const oldUv = found.byRole.get('uv')?.position;
    const newUv = built.nodes.find(n => roleOf(n) === 'uv')!.position;
    const dx = (oldUv?.x ?? 0) - newUv.x, dy = (oldUv?.y ?? 0) - newUv.y;
    top = built.nodes.map(n => {
      const o = found.byRole.get(roleOf(n));
      return { ...n, position: o ? { ...o.position } : { x: n.position.x + dx, y: n.position.y + dy } };
    });
    rest = graph.filter(n => !oldIds.has(n.id));
    // Wires from the user's nodes into a node the rebuild no longer makes: dropped.
    const now = new Set(top.map(n => n.id));
    rest = rest.map(n => {
      let changed = false;
      const inputs = { ...n.inputs };
      for (const [k, s] of Object.entries(inputs)) {
        if (s.connection && oldIds.has(s.connection.nodeId) && !now.has(s.connection.nodeId)) { inputs[k] = { ...s, connection: undefined }; changed = true; }
      }
      return changed ? { ...n, inputs } : n;
    });
  } else {
    top = placeInFreeSpace(graph, built.nodes, opts.at ?? { x: 0, y: 0 });
  }
  if (!opts.keepOutput) {
    let output = rest.find(n => (n.type === 'output' || n.type === 'vec4Output') && n.inputs.color);
    if (!output) {
      const def = getNodeDefinition('output')!;
      const last = top.find(n => n.id === built.final.nodeId)!;
      output = { id: nextId(), type: 'output', position: { x: last.position.x + 440, y: last.position.y }, inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label } }, outputs: {}, params: {} };
      rest = [...rest, output];
    }
    const outId = output.id;
    rest = rest.map(n => (n.id === outId ? { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: { ...built.final } } } } : n));
  }
  return { nodes: [...rest, ...top], sceneId: built.sceneId, gridId: built.gridId, finalId: built.final.nodeId, warnings: built.warnings, kept, spec };
}

/** The node whose colour is the scene's picture (what the Output shows): its last node. */
export function gridFinalOf(graph: readonly GraphNode[], sceneId: string): { nodeId: string; outputKey: string } | null {
  const b = findGridBuild(graph, sceneId);
  if (!b) return null;
  const tone = b.byRole.get('tone');
  if (tone) return { nodeId: tone.id, outputKey: 'color' };
  const fill = b.byRole.get('fill');
  return fill ? { nodeId: fill.id, outputKey: 'result' } : null;
}

/** A built node's param, for the Grid builder's Play menu: the node with role `role` in the build of `sceneId`, or why there is none. */
export type ParamTarget = { nodeId: string; key: string } | { missing: string };

export function gridParamTarget(nodes: readonly GraphNode[], sceneId: string | null, role: string, key: string): ParamTarget {
  if (!sceneId) return { missing: 'Build the scene first: the Play menu sets the built node.' };
  const node = findGridBuild(nodes, sceneId)?.byRole.get(role);
  if (!node) return { missing: 'Not in the built scene yet: Build to add it.' };
  if (!(key in node.params)) return { missing: 'Not on the built node yet: Build to add it.' };
  return { nodeId: node.id, key };
}

