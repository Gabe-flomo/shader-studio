/**
 * apply.ts — putting a built 2D scene into the user's graph, and rebuilding it later without
 * trampling their edits (docs/scene-builder-2d-plan.md, "Rebuild"). The same scheme as the 3D
 * builder (sceneBuilder/apply.ts), for a graph with no groups inside:
 *
 *   - every node of a build carries its role (`_sbRole`) and the build it belongs to (`_sbBuild`);
 *   - the UV node keeps the scene and, per role, what was built (its params and wires);
 *   - a rebuild keeps each node's id per role (Play controls and the user's own wires stay
 *     connected), keeps a setting the user changed that the new scene doesn't change, and with
 *     `restore` (Rebuild from recipe) drops the changes made by hand.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { placeInFreeSpace } from '../store/agentSetup';
import { BUILD_KEY } from '../sceneBuilder/apply';
import { buildScene2D, META_KEY_2D, ROLE_KEY, type Scene2DMeta } from './build';
import type { Scene2D } from './spec';

const IGNORED_KEYS = new Set(['__comment', ROLE_KEY, BUILD_KEY, META_KEY_2D, 'subgraph', '_sbName']);
const ignored = (k: string) => IGNORED_KEYS.has(k) || k.startsWith('_') || k.includes('::');
const roleOf = (n: GraphNode) => (typeof n.params[ROLE_KEY] === 'string' ? n.params[ROLE_KEY] as string : '');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Snapshot { type: string; params: Record<string, unknown>; wires: Record<string, string> }

function snapshot(n: GraphNode, roleById: Map<string, string>): Snapshot {
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.params)) if (!ignored(k)) params[k] = v;
  const wires: Record<string, string> = {};
  for (const [k, s] of Object.entries(n.inputs)) if (s.connection) wires[k] = `${roleById.get(s.connection.nodeId) ?? s.connection.nodeId}.${s.connection.outputKey}`;
  return { type: n.type, params, wires };
}

function userChanged(n: GraphNode, k: string, v: unknown, built: Record<string, unknown>): boolean {
  if (k in built) return !same(v, built[k]);
  const def = getNodeDefinition(n.type)?.defaultParams?.[k];
  return def === undefined ? v !== undefined : !same(v, def);
}

/** The scene a node holds (the UV node), if the 2D builder made it. */
export function meta2dOf(node: GraphNode | undefined | null): Scene2DMeta | null {
  const m = node?.params?.[META_KEY_2D] as Scene2DMeta | undefined;
  return m && m.v === 1 && Array.isArray(m.spec?.layers) ? m : null;
}

/** The builder scene (its UV node's id) a node belongs to, from any of its nodes. */
export function scene2dOfBuild(graph: GraphNode[], anyId: string): string | null {
  const hit = graph.find(n => n.id === anyId);
  if (!hit) return null;
  if (meta2dOf(hit)) return hit.id;
  const build = hit.params[BUILD_KEY];
  if (!build) return null;
  return graph.find(n => meta2dOf(n)?.build === build)?.id ?? null;
}

/** The nodes of one build, by role. */
export function find2dBuild(graph: GraphNode[], sceneId: string): { scene: GraphNode; meta: Scene2DMeta; byRole: Map<string, GraphNode> } | null {
  const scene = graph.find(n => n.id === sceneId);
  const meta = meta2dOf(scene);
  if (!scene || !meta) return null;
  const mine = graph.filter(n => (meta.build ? n.params[BUILD_KEY] === meta.build : true) && roleOf(n));
  return { scene, meta, byRole: new Map(mine.map(n => [roleOf(n), n])) };
}

export interface Apply2DResult {
  nodes: GraphNode[];
  sceneId: string;
  focusId: string;
  warnings: string[];
  kept: string[];
}

const paramName = (n: GraphNode, k: string) => getNodeDefinition(n.type)?.paramDefs?.[k]?.label ?? k;
const nameOf = (n: GraphNode) => (typeof n.params.label === 'string' && n.params.label) || getNodeDefinition(n.type)?.label || n.type;

/**
 * The graph with `spec` built into it: as a new scene beside what is there (`asNew`, or nothing to
 * rebuild), or replacing the build of `sceneId`, keeping the user's own settings where the new
 * spec doesn't change them. The graph's Output shows the scene.
 */
export function applyScene2D(graph: GraphNode[], spec: Scene2D, opts: { nextId: () => string; sceneId?: string | null; asNew?: boolean; at?: { x: number; y: number }; restore?: boolean }): Apply2DResult {
  const found = !opts.asNew && opts.sceneId ? find2dBuild(graph, opts.sceneId) : null;
  const taken = new Set(graph.map(n => n.id));
  const nextId = () => { let id = opts.nextId(); while (taken.has(id)) id = opts.nextId(); taken.add(id); return id; };
  const buildKey = found?.meta.build ?? `b${nextId()}`;
  const idOfRole = new Map<string, string>();
  const idFor = (role: string) => {
    if (!idOfRole.has(role)) idOfRole.set(role, found?.byRole.get(role)?.id ?? nextId());
    return idOfRole.get(role)!;
  };
  const built = buildScene2D(spec, idFor);
  const kept: string[] = [];
  const roleById = new Map(built.nodes.map(n => [n.id, roleOf(n)]));
  const snapshots: Record<string, string> = {};
  for (const node of built.nodes) {
    const role = roleOf(node);
    const old = found?.byRole.get(role);
    const was = found?.meta.built?.[role] ? JSON.parse(found.meta.built[role]) as Snapshot : null;
    snapshots[role] = JSON.stringify(snapshot(node, roleById));
    if (old && was && old.type === node.type && !opts.restore) {
      const fresh = snapshot(node, roleById);
      for (const [k, v] of Object.entries(old.params)) {
        if (ignored(k)) continue;
        if (userChanged(old, k, v, was.params) && same(fresh.params[k], was.params[k])) { node.params[k] = v; kept.push(`${nameOf(node)} · ${paramName(node, k)}`); }
      }
      for (const [k, v] of Object.entries(old.params)) if (k.includes('::') || k.startsWith('_fold')) node.params[k] = v;
    }
    node.params[BUILD_KEY] = buildKey;
  }
  const scene = built.nodes.find(n => n.id === built.sceneId)!;
  scene.params[META_KEY_2D] = { v: 1, spec: structuredClone(spec), build: buildKey, built: snapshots } satisfies Scene2DMeta;

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
  } else {
    top = placeInFreeSpace(graph, built.nodes, opts.at ?? { x: 0, y: 0 });
  }
  const ids = new Set(top.map(n => n.id));
  const oldFinal = found ? new Set([...found.byRole.values()].map(n => n.id)) : new Set<string>();
  // Wires from the user's nodes into the old build: kept where the node is still there, else dropped.
  rest = rest.map(n => {
    let changed = false;
    const inputs = { ...n.inputs };
    for (const [k, s] of Object.entries(inputs)) {
      const cn = s.connection;
      if (!cn || !oldFinal.has(cn.nodeId) || ids.has(cn.nodeId)) continue;
      inputs[k] = { ...s, connection: undefined };
      changed = true;
    }
    return changed ? { ...n, inputs } : n;
  });
  // The Output shows the scene.
  let output = rest.find(n => (n.type === 'output' || n.type === 'vec4Output') && n.inputs.color);
  if (!output) {
    const def = getNodeDefinition('output')!;
    const last = top.find(n => n.id === built.final.nodeId)!;
    output = { id: nextId(), type: 'output', position: { x: last.position.x + 440, y: last.position.y }, inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label } }, outputs: {}, params: {} };
    rest = [...rest, output];
  }
  const outId = output.id;
  rest = rest.map(n => (n.id === outId ? { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: { ...built.final } } } } : n));
  return { nodes: [...rest, ...top], sceneId: built.sceneId, focusId: built.sceneId, warnings: built.warnings, kept };
}
