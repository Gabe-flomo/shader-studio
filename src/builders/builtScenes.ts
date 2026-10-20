/**
 * builtScenes.ts — the Scene builder's kinds and what the builders already made in a graph (docs/scene-builder.md),
 * with no store: the kind list, a graph's builds (builtScenes), the build a selected node belongs to, and the nodes a
 * build is made of. builders/sceneKinds.ts re-exports these beside the routes that need the stores; the pure modules
 * (Combine's build, the examples) read them from here.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { IconName } from '../components/ui/iconPaths';
import { metaOf } from '../sceneBuilder/build';
import { allShapes } from '../sceneBuilder/spec';
import { findBuild, sceneOfBuild } from '../sceneBuilder/apply';
import { find2dBuild, meta2dOf, scene2dOfBuild } from '../sceneBuilder2d/apply';
import { gridShape } from '../gridRules/spec';
import { findGridBuild, gridMetaOf, gridSceneOfBuild } from '../gridScene/apply';
import { findSplatBuild, splatMetaOf, splatSceneOfBuild } from '../splatBuilder/apply';
import { EFFECT_INFO, scanName } from '../splatBuilder/spec';
import { findTcBuild, tcMetaOf, timeCubeOfBuild } from '../timeCubeBuilder/apply';
import { sourceName } from '../timeCubeBuilder/spec';
import { combineMetaOf, combineOfBuild, findCombineBuild } from '../combine/meta';
import { buildDetail as txDetail, findTxBuild, labOfBuild, txBuildIds, txMetaOf } from '../textureLab/meta';
import { VERBS } from '../combine/spec';
import { groupRules, isRulesGroup } from '../agentRules/apply';
import { WALKER_KINDS, kindOf } from '../agentRules/spec';

const isOutput = (n: GraphNode) => n.type === 'output' || n.type === 'vec4Output';

/** A builder group on the top level (a rules Agents group), as the "Edit this one / Start over / Add another" prompt lists it. */
export interface BuilderGroup { id: string; label: string; kind: string; d3: boolean }

/** The rules Agents groups on the top level of `nodes` (the ones the Agent Builder makes and edits). */
export function builderGroups(nodes: readonly GraphNode[]): BuilderGroup[] {
  return nodes.filter(isRulesGroup).map(g => ({
    id: g.id,
    label: (typeof g.params.label === 'string' && g.params.label) || 'Agents',
    kind: WALKER_KINDS[kindOf(groupRules(g))].label,
    d3: g.params.space === '3d',
  }));
}

/**
 * The nodes that belong to a group's setup and nothing else: the group, then (until nothing changes)
 * every node only the setup reads from (its Emit, a picture wired only into it) and every node that
 * reads only from the setup (Deposit, Trail field, its palette, Draw agents). The Output and nodes
 * with no wires at all are never part of it. Pure.
 */
export function agentSetupIds(nodes: readonly GraphNode[], groupId: string): Set<string> {
  if (!nodes.some(n => n.id === groupId)) return new Set();
  const ids = new Set<string>([groupId]);
  const sources = (n: GraphNode) => Object.values(n.inputs).map(i => i.connection?.nodeId).filter((x): x is string => !!x);
  const readers = new Map<string, string[]>();
  for (const n of nodes) for (const s of sources(n)) readers.set(s, [...(readers.get(s) ?? []), n.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (ids.has(n.id) || isOutput(n)) continue;
      const from = sources(n), to = readers.get(n.id) ?? [];
      const downstream = from.length > 0 && from.every(x => ids.has(x));
      const upstream = to.length > 0 && to.every(x => ids.has(x));
      if (downstream || upstream) { ids.add(n.id); grew = true; }
    }
  }
  return ids;
}

export type SceneKind = '2d' | 'agents' | 'grid' | 'simulation' | '3d' | 'splat' | 'timecube' | 'warp' | 'combine' | 'texture';

export interface SceneKindInfo {
  id: SceneKind;
  /** As the kind page and the window's header name it. */
  title: string;
  /** One line under the picture. */
  line: string;
  icon: IconName;
  /** The builder's own name (its window and its docs). */
  builder: string;
  /** False: not offered on a phone. */
  phone?: false;
}

export const SCENE_KINDS: readonly SceneKindInfo[] = [
  { id: '2d', title: '2D scene', line: 'Shapes, rings of rings, kaleidoscopes, motion and glow, flat on the picture', icon: 'mask', builder: '2D Scene Builder' },
  { id: 'agents', title: 'Agent scene', line: 'Many small walkers, one big pattern: slime, particles, flocks, crowds, orbiters', icon: 'swarm', builder: 'Agent Builder' },
  { id: 'grid', title: 'Grid scene', line: 'Shapes you draw on cells, with motion, patterns, warps and rules between them', icon: 'grid', builder: 'Grid builder' },
  { id: 'simulation', title: 'Grid simulation', line: 'Cells that follow a rule every step: Life, sand, heat, Wireworld, smooth patterns', icon: 'loop', builder: 'Grid Rules' },
  { id: '3d', title: '3D scene', line: 'Shapes in space, combined and bent, lit and seen through a camera', icon: 'cube', builder: '3D Scene Builder' },
  { id: 'splat', title: 'Splat scene', line: 'A Gaussian splat scan, placed, dissolved, exploded or tinted, in a world of its own', icon: 'spark', builder: 'Splat builder' },
  { id: 'timecube', title: 'Time Cube', line: 'A video as a box of time or a stack of cards: slices, flow, colour keys, a camera', icon: 'layers', builder: 'Time Cube builder' },
  { id: 'warp', title: 'Warp', line: 'Bend space by dragging tiles: sin onto X, a slider, the clock. Blocks stack, warp on warp', icon: 'wave', builder: 'Warp Builder' },
  { id: 'combine', title: 'Combine', line: 'Put what you made together: a photo in 3D, a scene on a photo, people replaced by anything', icon: 'layers', builder: 'Combine', phone: false },
  { id: 'texture', title: 'Texture Lab', line: 'A photo or video through a stack of texture tools: edges, glow, trails, relief, outlines', icon: 'image', builder: 'Texture Lab', phone: false },
];

/** The kinds a phone offers: Combine and Texture Lab are off there (docs/combine-plan.md [D9]; a graph they made opens as plain nodes). */
export const sceneKindsFor = (phone: boolean): readonly SceneKindInfo[] => (phone ? SCENE_KINDS.filter(k => k.phone !== false) : SCENE_KINDS);

export const sceneKindInfo = (k: SceneKind): SceneKindInfo => SCENE_KINDS.find(x => x.id === k)!;

/** Something a builder made, as the "Edit this one" prompt lists it. `id` is what its builder opens on. */
export interface BuiltScene {
  kind: SceneKind;
  /** 3D: the Scene Group; 2D and a Grid scene: the UV node holding the spec; a Grid simulation: the Grid Rules node; agents: the rules group; a splat scene: its Splat Scene. */
  id: string;
  label: string;
  /** "Trail followers · 2D", "3 shapes"… */
  detail: string;
}

const labelOf = (n: GraphNode, fallback: string) => (typeof n.params.label === 'string' && n.params.label.trim()) || fallback;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** What the builders made on the top level of `nodes`: 2D builds, rules Agents groups, Grid Rules nodes, 3D builds. Pure. */
export function builtScenes(nodes: readonly GraphNode[]): BuiltScene[] {
  const out: BuiltScene[] = [];
  // Combine builds first: reopening a graph Combine made offers the whole stack before its parts.
  for (const n of nodes) {
    const mc = combineMetaOf(n);
    if (!mc) continue;
    const verbs = [...new Set(mc.spec.layers.filter(l => l.verb !== 'base').map(l => VERBS[l.verb as keyof typeof VERBS]?.label).filter(Boolean))];
    out.push({ kind: 'combine', id: n.id, label: labelOf(n, 'Combined scene'), detail: `${plural(mc.spec.layers.length, 'layer')}${verbs.length ? ` · ${verbs.join(', ')}` : ''}` });
  }
  for (const n of nodes) {
    const m2 = meta2dOf(n);
    if (m2) out.push({ kind: '2d', id: n.id, label: '2D scene', detail: `${plural(m2.spec.layers.length, 'layer')}${m2.spec.grid ? ' · a grid' : ''}` });
  }
  for (const n of nodes) {
    const mg = gridMetaOf(n);
    if (mg) out.push({ kind: 'grid', id: n.id, label: 'Grid scene', detail: `${mg.spec.cols} × ${mg.spec.rows} · ${plural(mg.spec.cells.length, 'cell')} drawn` });
  }
  for (const g of builderGroups(nodes)) out.push({ kind: 'agents', id: g.id, label: g.label, detail: `${g.kind} · ${g.d3 ? '3D' : '2D'}` });
  for (const n of nodes) {
    if (n.type === 'gridRules') out.push({ kind: 'simulation', id: n.id, label: labelOf(n, 'Grid simulation'), detail: `${gridShape(n.params).type} rules` });
  }
  for (const n of nodes) {
    const m = n.type === 'sceneGroup' ? metaOf(n) : null;
    if (m) out.push({ kind: '3d', id: n.id, label: labelOf(n, '3D scene'), detail: `${m.spec.look.mode} · ${plural(allShapes(m.spec).length, 'shape')}` });
  }
  for (const n of nodes) {
    const ms = splatMetaOf(n);
    if (!ms) continue;
    const fx = ms.spec.effects.filter(e => e.on).map(e => EFFECT_INFO[e.kind]?.label).filter(Boolean);
    out.push({ kind: 'splat', id: n.id, label: labelOf(n, 'Splat scene'), detail: `${scanName(ms.spec.scan.source)}${fx.length ? ` · ${fx.join(', ')}` : ''}` });
  }
  for (const n of nodes) {
    if (!tcMetaOf(n)) continue;
    const b = findTcBuild(nodes, n.id);
    out.push({ kind: 'timecube', id: n.id, label: labelOf(n, 'Time Cube'), detail: `${sourceName(n.params)} · ${b?.byRole.has('stack') ? 'a stack of cards' : 'a box of time'}` });
  }
  for (const n of nodes) {
    const mt = txMetaOf(n);
    if (mt) out.push({ kind: 'texture', id: n.id, label: 'Texture Lab', detail: txDetail(mt.spec) });
  }
  return out;
}

/** Whether a builder made (part of) this graph: then the Scene builder reopens it rather than clearing. */
export const builderMade = (nodes: readonly GraphNode[]) => builtScenes(nodes).length > 0;

/** The built scene a selected node belongs to (a node of a 2D or 3D build, the group, the Grid Rules node). Pure. */
export function selectedBuiltScene(nodes: readonly GraphNode[], selected: readonly string[]): BuiltScene | null {
  const all = builtScenes(nodes);
  for (const id of selected) {
    const direct = all.find(b => b.id === id);
    if (direct) return direct;
    const s2 = scene2dOfBuild(nodes as GraphNode[], id);
    const s3 = sceneOfBuild(nodes as GraphNode[], id);
    const sg = gridSceneOfBuild(nodes, id);
    const ss = splatSceneOfBuild(nodes, id);
    const tc = timeCubeOfBuild(nodes, id);
    const cb = combineOfBuild(nodes, id);
    const tx = labOfBuild(nodes, id);
    const hit = all.find(b => b.id === cb) ?? all.find(b => b.id === s2 || b.id === s3 || b.id === sg || b.id === ss || b.id === tc || b.id === tx);
    if (hit) return hit;
  }
  return null;
}

/**
 * The top-level nodes a built scene is made of, with what reads only from them or feeds only them
 * (its picture, its Draw agents): what Start over takes away. The Output never goes. Pure.
 */
export function builtSceneIds(nodes: readonly GraphNode[], b: Pick<BuiltScene, 'kind' | 'id'>): Set<string> {
  const top = new Set(nodes.map(n => n.id));
  const seeds: string[] = [b.id];
  if (b.kind === '3d') {
    const found = findBuild(nodes as GraphNode[], b.id);
    if (found) for (const l of found.byRole.values()) if (top.has(l.node.id)) seeds.push(l.node.id);
  } else if (b.kind === '2d') {
    const found = find2dBuild(nodes as GraphNode[], b.id);
    if (found) for (const n of found.byRole.values()) seeds.push(n.id);
  } else if (b.kind === 'grid') {
    const found = findGridBuild(nodes, b.id);
    if (found) for (const n of found.byRole.values()) seeds.push(n.id);
  } else if (b.kind === 'splat') {
    const found = findSplatBuild(nodes, b.id);
    if (found) for (const n of found.byRole.values()) seeds.push(n.id);
  } else if (b.kind === 'timecube') {
    const found = findTcBuild(nodes, b.id);
    if (found) for (const n of found.byRole.values()) seeds.push(n.id);
  } else if (b.kind === 'combine') {
    // Combine owns only its glue: the products stay (each is its own build) unless they are started over too.
    const found = findCombineBuild(nodes, b.id);
    const ids = new Set(found ? [...found.byRole.values()].map(n => n.id) : [b.id]);
    for (const n of nodes) if (n.type === 'output' || n.type === 'vec4Output') ids.delete(n.id);
    return ids;
  } else if (b.kind === 'texture') {
    // A source of yours (a picture you had) stays: only the builder's own nodes go.
    const own = findTxBuild(nodes, b.id) ? txBuildIds(nodes, b.id) : [];
    return new Set(own.filter(id => top.has(id) && !nodes.some(n => n.id === id && isOutput(n))));
  }
  const ids = new Set<string>();
  for (const s of seeds) for (const id of agentSetupIds(nodes, s)) ids.add(id);
  for (const s of seeds) if (top.has(s)) ids.add(s);
  for (const n of nodes) if (n.type === 'output' || n.type === 'vec4Output') ids.delete(n.id);
  return ids;
}
