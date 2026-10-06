/**
 * apply.ts — putting a built scene into the user's graph, and rebuilding it
 * later without trampling their edits (docs/scene-builder.md, "Rebuild").
 *
 * Every node a build makes carries its role (`_sbRole`) and the build it
 * belongs to (`_sbBuild`); the Scene Group keeps the spec and, per role, what
 * was built (its params and wires). A rebuild then knows, node by node:
 *
 *   - untouched since the build: replaced by the new build;
 *   - a setting the user changed that the new spec doesn't change: kept;
 *   - a setting both changed (a conflict), a wire the user moved, a node the
 *     user deleted or added inside the scene: can't be kept. The builder says
 *     so and offers to rebuild anyway or to build a new copy beside it.
 *
 * Ids are kept per role, so Play controls and wires from the user's own nodes
 * stay connected across rebuilds. Pure: ids come from `nextId`.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { placeInFreeSpace } from '../store/agentSetup';
import { buildSceneGraph, META_KEY, ROLE_KEY, type SceneBuilderMeta } from './build';
import type { SceneSpec } from './spec';

export const BUILD_KEY = '_sbBuild';

const IGNORED_KEYS = new Set(['__comment', ROLE_KEY, BUILD_KEY, META_KEY, 'subgraph', '_sbName']);
/** Not settings: the note, the builder's own tags, a group's inside, card state (`_fold…`), load stamps (`_schemaVersion`). */
const ignored = (k: string) => IGNORED_KEYS.has(k) || k.startsWith('_') || k.includes('::');

type Located = { node: GraphNode; parent: GraphNode | null };

/** Every node of `nodes`, the insides of groups included, with the group it is in. */
function everyNode(nodes: GraphNode[], parent: GraphNode | null = null, out: Located[] = []): Located[] {
  for (const n of nodes) {
    out.push({ node: n, parent });
    const sg = n.params.subgraph as SubgraphData | undefined;
    if (sg?.nodes) everyNode(sg.nodes, n, out);
  }
  return out;
}

const roleOf = (n: GraphNode) => (typeof n.params[ROLE_KEY] === 'string' ? n.params[ROLE_KEY] as string : '');

/** What a build made a node as: its settings and where its wires come from (by role). */
function snapshot(n: GraphNode, roleById: Map<string, string>): { type: string; params: Record<string, unknown>; wires: Record<string, string> } {
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.params)) if (!ignored(k)) params[k] = v;
  const wires: Record<string, string> = {};
  for (const [k, s] of Object.entries(n.inputs)) if (s.connection) wires[k] = `${roleById.get(s.connection.nodeId) ?? s.connection.nodeId}.${s.connection.outputKey}`;
  return { type: n.type, params, wires };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Did the user change setting `k` since the build? A key the build didn't write counts only when it
 * differs from the node's default: loading a graph fills in defaults (and newer settings), which
 * are not the user's edits.
 */
function userChanged(n: GraphNode, k: string, v: unknown, built: Record<string, unknown>): boolean {
  if (k in built) return !same(v, built[k]);
  const def = getNodeDefinition(n.type)?.defaultParams?.[k];
  return def === undefined ? v !== undefined : !same(v, def);
}

/** The nodes of one build: by role, with the Scene Group that carries its spec. */
export function findBuild(graph: GraphNode[], sceneId: string): { scene: GraphNode; meta: SceneBuilderMeta & { build?: string }; byRole: Map<string, Located>; all: Located[] } | null {
  const all = everyNode(graph);
  const scene = all.find(l => l.node.id === sceneId)?.node;
  const meta = scene?.params[META_KEY] as (SceneBuilderMeta & { build?: string }) | undefined;
  if (!scene || !meta?.spec) return null;
  const build = meta.build;
  const mine = all.filter(l => (build ? l.node.params[BUILD_KEY] === build : !!roleOf(l.node)) && roleOf(l.node));
  return { scene, meta, byRole: new Map(mine.map(l => [roleOf(l.node), l])), all };
}

/** The Scene Group a builder scene is known by, from any of its nodes (or the group itself). */
export function sceneOfBuild(graph: GraphNode[], anyId: string): string | null {
  const all = everyNode(graph);
  const hit = all.find(l => l.node.id === anyId)?.node;
  if (!hit) return null;
  if (hit.params[META_KEY]) return hit.id;
  const build = hit.params[BUILD_KEY];
  if (!build) return null;
  return all.find(l => (l.node.params[META_KEY] as { build?: string } | undefined)?.build === build)?.node.id ?? null;
}

export interface EditReport {
  /** Settings the user changed that a rebuild keeps. */
  kept: string[];
  /** What a rebuild can't keep. */
  lost: string[];
}

const nameOf = (n: GraphNode) => (typeof n.params.label === 'string' && n.params.label) || getNodeDefinition(n.type)?.label || n.type;
const paramName = (n: GraphNode, k: string) => getNodeDefinition(n.type)?.paramDefs?.[k]?.label ?? k;

/** What the user changed in a built scene, measured against what the new spec would build. */
export function checkEdits(graph: GraphNode[], sceneId: string, next: SceneSpec): EditReport {
  const found = findBuild(graph, sceneId);
  const report: EditReport = { kept: [], lost: [] };
  if (!found?.meta.built) return report;
  const { byRole, meta, all } = found;
  const roleById = new Map([...byRole.values()].map(l => [l.node.id, roleOf(l.node)]));
  const fresh = buildSceneGraph(next, role => byRole.get(role)?.node.id ?? `new:${role}`);
  const freshAll = new Map(everyNode(fresh.nodes).map(l => [roleOf(l.node), l.node]));
  const freshRoleById = new Map([...freshAll.values()].map(n => [n.id, roleOf(n)]));
  for (const [role, json] of Object.entries(meta.built ?? {})) {
    const was = JSON.parse(json) as ReturnType<typeof snapshot>;
    const here = byRole.get(role)?.node;
    if (!here) { report.lost.push(`You deleted ${was.type === 'sceneGroup' ? 'the Scene Group' : `a ${getNodeDefinition(was.type)?.label ?? was.type}`} (${role}); a rebuild makes it again.`); continue; }
    const now = snapshot(here, roleById);
    const will = freshAll.get(role);
    for (const [k, v] of Object.entries(now.params)) {
      if (ignored(k)) continue;
      if (!userChanged(here, k, v, was.params)) continue;
      const nextV = will ? snapshot(will, freshRoleById).params[k] : undefined;
      if (will && will.type === here.type && same(nextV, was.params[k])) report.kept.push(`${nameOf(here)} · ${paramName(here, k)}`);
      else report.lost.push(`${nameOf(here)} · ${paramName(here, k)}: you set it on the node, and the builder sets it too.`);
    }
    for (const [k, w] of Object.entries(now.wires)) if (w !== was.wires[k]) report.lost.push(`${nameOf(here)} · ${here.inputs[k]?.label ?? k}: you rewired it.`);
    for (const k of Object.keys(was.wires)) if (!now.wires[k]) report.lost.push(`${nameOf(here)} · ${here.inputs[k]?.label ?? k}: you unwired it.`);
  }
  // Nodes the user added inside the build's groups.
  const groups = new Set([...byRole.values()].filter(l => l.node.params.subgraph).map(l => l.node.id));
  for (const l of all) if (l.parent && groups.has(l.parent.id) && !roleOf(l.node)) report.lost.push(`${nameOf(l.node)} you added inside ${nameOf(l.parent)}.`);
  return report;
}

export interface ApplyResult {
  nodes: GraphNode[];
  sceneId: string;
  /** The node to show (the march loop). */
  focusId: string;
  warnings: string[];
  kept: string[];
}

/**
 * The graph with `spec` built into it: as a new scene beside what is there
 * (`asNew`, or nothing to rebuild), or replacing the build of `sceneId`,
 * keeping the user's own settings where the new spec doesn't change them.
 * The graph's Output shows the scene.
 */
export function applyScene(graph: GraphNode[], spec: SceneSpec, opts: { nextId: () => string; sceneId?: string | null; asNew?: boolean; at?: { x: number; y: number } }): ApplyResult {
  const found = !opts.asNew && opts.sceneId ? findBuild(graph, opts.sceneId) : null;
  // Fresh ids never reuse one the graph already has.
  const taken = new Set(everyNode(graph).map(l => l.node.id));
  const nextId = () => { let id = opts.nextId(); while (taken.has(id)) id = opts.nextId(); taken.add(id); return id; };
  const buildKey = found?.meta.build ?? `b${nextId()}`;
  const idOfRole = new Map<string, string>();
  const idFor = (role: string) => {
    if (!idOfRole.has(role)) idOfRole.set(role, found?.byRole.get(role)?.node.id ?? nextId());
    return idOfRole.get(role)!;
  };
  const built = buildSceneGraph(spec, idFor);
  const kept: string[] = [];
  const located = everyNode(built.nodes);
  const roleById = new Map(located.map(l => [l.node.id, roleOf(l.node)]));
  const snapshots: Record<string, string> = {};
  for (const { node } of located) {
    const role = roleOf(node);
    // The user's own settings, where the new spec leaves them as the last build made them.
    const old = found?.byRole.get(role)?.node;
    const was = found?.meta.built?.[role] ? JSON.parse(found.meta.built[role]) as ReturnType<typeof snapshot> : null;
    const fresh = snapshot(node, roleById);
    snapshots[role] = JSON.stringify(fresh);
    if (old && found?.byRole.get(role)?.parent) node.position = { ...old.position };
    if (old && was && old.type === node.type) {
      for (const [k, v] of Object.entries(old.params)) {
        if (ignored(k)) continue;
        if (userChanged(old, k, v, was.params) && same(fresh.params[k], was.params[k])) { node.params[k] = v; kept.push(`${nameOf(node)} · ${paramName(node, k)}`); }
      }
      // Card-level state that isn't a setting (its folds, a probe) stays as it was.
      for (const [k, v] of Object.entries(old.params)) if (k.includes('::') || k.startsWith('_fold')) node.params[k] = v;
    }
    node.params[BUILD_KEY] = buildKey;
  }
  const scene = located.find(l => l.node.id === built.sceneId)!.node;
  scene.params[META_KEY] = { v: 1, spec: structuredClone(spec), build: buildKey, built: snapshots } satisfies SceneBuilderMeta & { build: string };

  // Where it goes: the old build's place, or free space.
  let top = built.nodes;
  let rest = graph;
  if (found) {
    const oldIds = new Set([...found.byRole.values()].filter(l => !l.parent).map(l => l.node.id));
    const oldCam = found.byRole.get('camera')?.node.position;
    const newCam = built.nodes.find(n => roleOf(n) === 'camera')!.position;
    const dx = (oldCam?.x ?? 0) - newCam.x, dy = (oldCam?.y ?? 0) - newCam.y;
    top = built.nodes.map(n => {
      const old = found.byRole.get(roleOf(n))?.node;
      return { ...n, position: old && !found.byRole.get(roleOf(n))?.parent ? { ...old.position } : { x: n.position.x + dx, y: n.position.y + dy } };
    });
    rest = graph.filter(n => !oldIds.has(n.id));
  } else {
    top = placeInFreeSpace(graph, built.nodes, opts.at ?? { x: 0, y: 0 });
  }
  const ids = new Set(everyNode(top).map(l => l.node.id));
  const oldFinal = found ? new Set([...found.byRole.values()].map(l => l.node.id)) : new Set<string>();
  // Wires from the user's nodes into the old build: kept where the node is still there, else dropped.
  rest = rest.map(n => {
    let changed = false;
    const inputs = { ...n.inputs };
    for (const [k, s] of Object.entries(inputs)) {
      const c = s.connection;
      if (!c || !oldFinal.has(c.nodeId) || ids.has(c.nodeId)) continue;
      inputs[k] = { ...s, connection: undefined };
      changed = true;
    }
    return changed ? { ...n, inputs } : n;
  });
  // The Output shows the scene (a new 3D scene takes it over, as adding one does).
  let output = rest.find(n => (n.type === 'output' || n.type === 'vec4Output') && n.inputs.color);
  if (!output) {
    const def = getNodeDefinition('output')!;
    const last = top.find(n => n.id === built.final.nodeId)!;
    output = { id: nextId(), type: 'output', position: { x: last.position.x + 440, y: last.position.y }, inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label } }, outputs: {}, params: {} };
    rest = [...rest, output];
  }
  const outId = output.id;
  rest = rest.map(n => (n.id === outId ? { ...n, inputs: { ...n.inputs, color: { ...n.inputs.color, connection: { ...built.final } } } } : n));
  const focusId = top.find(n => roleOf(n) === 'march')?.id ?? built.sceneId;
  return { nodes: [...rest, ...top], sceneId: built.sceneId, focusId, warnings: built.warnings, kept };
}
