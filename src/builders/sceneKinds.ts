/**
 * sceneKinds.ts — the one Scene builder (docs/scene-builder.md): its four kinds (2D scene, Agent
 * scene, Grid scene, 3D scene), what a builder already made in a graph, and the routes between the
 * kind page and each kind's own builder. The builders keep their code where it is; this only
 * routes to them:
 *
 *  - 2D scene → the 2D Scene Builder (sceneBuilder2d), on a new scene or on a build's saved spec;
 *  - Agent scene → the Agent Builder (agentBuilder), on its "What are you making?" page or a group;
 *  - Grid scene → Grid Rules (gridRules): a new node and its editor, or a node's editor;
 *  - 3D scene → the 3D Scene Builder (sceneBuilder), on a new scene or on a build's saved spec.
 *
 * Opening the Scene builder: a graph a builder made reopens that scene ("Edit this one / Start
 * over / Add another", the Agent Builder's prompt for every kind); any other graph goes to the
 * kind page, which clears the graph by default (its own undo step), with "Keep my graph" beside it.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { IconName } from '../components/ui/iconPaths';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { metaOf } from '../sceneBuilder/build';
import { allShapes } from '../sceneBuilder/spec';
import { findBuild, sceneOfBuild } from '../sceneBuilder/apply';
import { find2dBuild, meta2dOf, scene2dOfBuild } from '../sceneBuilder2d/apply';
import { useSceneBuilder } from '../sceneBuilder/store';
import { useSceneBuilder2D } from '../sceneBuilder2d/store';
import { agentSetupIds, builderGroups, clearableCount, clearGraphForBuilder, removeSetupNodes } from '../agentBuilder/actions';
import { gridShape } from '../gridRules/spec';
import { closeAgentBuilder, closeGridRulesEditor, openSceneShell, useBuilderWindows } from './windows';

export type SceneKind = '2d' | 'agents' | 'grid' | '3d';

export interface SceneKindInfo {
  id: SceneKind;
  /** As the kind page and the window's header name it. */
  title: string;
  /** One line under the picture. */
  line: string;
  icon: IconName;
  /** The builder's own name (its window and its docs). */
  builder: string;
}

export const SCENE_KINDS: readonly SceneKindInfo[] = [
  { id: '2d', title: '2D scene', line: 'Shapes, rings of rings, kaleidoscopes, motion and glow, flat on the picture', icon: 'mask', builder: '2D Scene Builder' },
  { id: 'agents', title: 'Agent scene', line: 'Many small walkers, one big pattern: slime, particles, flocks, crowds, orbiters', icon: 'swarm', builder: 'Agent Builder' },
  { id: 'grid', title: 'Grid scene', line: 'Cells and rules: Life, sand, heat, waves, Wireworld', icon: 'grid', builder: 'Grid Rules' },
  { id: '3d', title: '3D scene', line: 'Shapes in space, combined and bent, lit and seen through a camera', icon: 'cube', builder: '3D Scene Builder' },
];

export const sceneKindInfo = (k: SceneKind): SceneKindInfo => SCENE_KINDS.find(x => x.id === k)!;

/** Something a builder made, as the "Edit this one" prompt lists it. `id` is what its builder opens on. */
export interface BuiltScene {
  kind: SceneKind;
  /** 3D: the Scene Group; 2D: the UV node holding the spec; grid: the Grid Rules node; agents: the rules group. */
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
  for (const n of nodes) {
    const m2 = meta2dOf(n);
    if (m2) out.push({ kind: '2d', id: n.id, label: '2D scene', detail: `${plural(m2.spec.layers.length, 'layer')}${m2.spec.grid ? ' · a grid' : ''}` });
  }
  for (const g of builderGroups(nodes)) out.push({ kind: 'agents', id: g.id, label: g.label, detail: `${g.kind} · ${g.d3 ? '3D' : '2D'}` });
  for (const n of nodes) {
    if (n.type === 'gridRules') out.push({ kind: 'grid', id: n.id, label: labelOf(n, 'Grid Rules'), detail: `${gridShape(n.params).type} rules` });
  }
  for (const n of nodes) {
    const m = n.type === 'sceneGroup' ? metaOf(n) : null;
    if (m) out.push({ kind: '3d', id: n.id, label: labelOf(n, '3D scene'), detail: `${m.spec.look.mode} · ${plural(allShapes(m.spec).length, 'shape')}` });
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
    const hit = all.find(b => b.id === s2 || b.id === s3);
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
  }
  const ids = new Set<string>();
  for (const s of seeds) for (const id of agentSetupIds(nodes, s)) ids.add(id);
  for (const s of seeds) if (top.has(s)) ids.add(s);
  for (const n of nodes) if (n.type === 'output' || n.type === 'vec4Output') ids.delete(n.id);
  return ids;
}

// ── Store side ───────────────────────────────────────────────────────────────

/** Which kind's builder window is open now (null: none). */
export function openSceneKind(): SceneKind | null {
  const w = useBuilderWindows.getState();
  if (useSceneBuilder2D.getState().open) return '2d';
  if (useSceneBuilder.getState().open) return '3d';
  if (w.agentBuilder) return 'agents';
  if (w.gridRules) return 'grid';
  return null;
}

/** Close whichever kind's builder window is open (the Scene builder's ‹ back to the kinds). */
export function closeSceneKinds(): void {
  if (useSceneBuilder2D.getState().open) useSceneBuilder2D.getState().close();
  if (useSceneBuilder.getState().open) useSceneBuilder.getState().close();
  if (useBuilderWindows.getState().agentBuilder) closeAgentBuilder();
  if (useBuilderWindows.getState().gridRules) closeGridRulesEditor();
}

/**
 * Open the Scene builder (the side list's one entry): a graph (or a selected group) a builder made
 * reopens it (Edit this one / Start over / Add another); any other graph, the kind page.
 */
export function openSceneBuilderShell(): void {
  const nodes = useNodeGraphStore.getState().nodes;
  closeSceneKinds();
  openSceneShell(builderMade(nodes) ? { page: 'existing' } : { page: 'kinds' });
}

/** Back to the kind page from a kind's builder: its window closes (its work is already in the graph). */
export function backToSceneKinds(): void {
  closeSceneKinds();
  // Something built stays by default; a graph no builder made clears by default, as on opening.
  openSceneShell({ page: 'kinds', keep: builderMade(useNodeGraphStore.getState().nodes) });
}

/** "Clear and start over": everything but the Output, one undo step of its own. Returns the graph as it was. */
export function clearForScene(): GraphNode[] | null {
  if (clearableCount(useNodeGraphStore.getState().nodes) === 0) return null;
  return clearGraphForBuilder('Scene builder: cleared the graph');
}

/** "Start over": take a built scene away (builtSceneIds), one undo step. */
export function removeBuiltScene(b: Pick<BuiltScene, 'kind' | 'id'>): boolean {
  return removeSetupNodes(builtSceneIds(useNodeGraphStore.getState().nodes, b), 'Scene builder: started over');
}
