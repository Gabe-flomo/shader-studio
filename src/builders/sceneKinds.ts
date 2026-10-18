/**
 * sceneKinds.ts — the one Scene builder (docs/scene-builder.md): its kinds (2D scene, Agent scene,
 * Grid scene, Grid simulation, 3D scene, Splat scene), what a builder already made in a graph, and the routes between the
 * kind page and each kind's own builder. The builders keep their code where it is; this only
 * routes to them:
 *
 *  - 2D scene → the 2D Scene Builder (sceneBuilder2d), on a new scene or on a build's saved spec;
 *  - Agent scene → the Agent Builder (agentBuilder), on its "What are you making?" page or a group;
 *  - Grid scene → the Grid builder (gridScene), on a new scene or a build's saved spec;
 *  - Grid simulation → Grid Rules (a new Grid Rules node, its editor open), or a Grid Rules node in its
 *    editor. The Grid builder's "Make it a simulation" jumps there too, and "Pattern grid" jumps back;
 *  - 3D scene → the 3D Scene Builder (sceneBuilder), on a new scene or on a build's saved spec;
 *  - Splat scene → the Splat builder (splatBuilder), on a new scan (built at once: its picture is the main preview's)
 *    or on a build's saved spec;
 *  - Time Cube → the Time Cube builder (timeCubeBuilder): a Time Cube shown as a Time Cube View or a Frame Stack,
 *    built at once like a splat scene, or a build as it is now.
 *
 * Opening the Scene builder: a graph a builder made reopens that scene ("Edit this one / Start
 * over / Add another", the Agent Builder's prompt for every kind); any other graph goes to the
 * kind page, which keeps the graph by default (clearing, its own undo step, is the default only for the untouched starter).
 */
import type { GraphNode } from '../types/nodeGraph';
import { BLANK_GRAPH } from '../store/exampleIndex';
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
import { findGridBuild, gridMetaOf, gridSceneOfBuild } from '../gridScene/apply';
import { useGridBuilder } from '../gridScene/store';
import { closeAgentBuilder, closeGridRulesEditor, openSceneShell, useBuilderWindows } from './windows';
import { findSplatBuild, splatMetaOf, splatSceneOfBuild } from '../splatBuilder/apply';
import { useSplatBuilder } from '../splatBuilder/store';
import { closeSplatBuilder } from '../splatBuilder/actions';
import { EFFECT_INFO, scanName } from '../splatBuilder/spec';
import { useWarpBuilder } from '../warpBuilder/store';
import { findTcBuild, tcMetaOf, timeCubeOfBuild } from '../timeCubeBuilder/apply';
import { useTimeCubeBuilder } from '../timeCubeBuilder/store';
import { closeTimeCubeBuilder } from '../timeCubeBuilder/actions';
import { sourceName } from '../timeCubeBuilder/spec';

export type SceneKind = '2d' | 'agents' | 'grid' | 'simulation' | '3d' | 'splat' | 'timecube' | 'warp';

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
  { id: 'grid', title: 'Grid scene', line: 'Shapes you draw on cells, with motion, patterns, warps and rules between them', icon: 'grid', builder: 'Grid builder' },
  { id: 'simulation', title: 'Grid simulation', line: 'Cells that follow a rule every step: Life, sand, heat, Wireworld, smooth patterns', icon: 'loop', builder: 'Grid Rules' },
  { id: '3d', title: '3D scene', line: 'Shapes in space, combined and bent, lit and seen through a camera', icon: 'cube', builder: '3D Scene Builder' },
  { id: 'splat', title: 'Splat scene', line: 'A Gaussian splat scan, placed, dissolved, exploded or tinted, in a world of its own', icon: 'spark', builder: 'Splat builder' },
  { id: 'timecube', title: 'Time Cube', line: 'A video as a box of time or a stack of cards: slices, flow, colour keys, a camera', icon: 'layers', builder: 'Time Cube builder' },
  { id: 'warp', title: 'Warp', line: 'Bend space by dragging tiles: sin onto X, a slider, the clock. Blocks stack, warp on warp', icon: 'wave', builder: 'Warp Builder' },
];

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
    const hit = all.find(b => b.id === s2 || b.id === s3 || b.id === sg || b.id === ss || b.id === tc);
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
  if (useGridBuilder.getState().open) return 'grid';
  if (useSplatBuilder.getState().open) return 'splat';
  if (useTimeCubeBuilder.getState().open) return 'timecube';
  if (useWarpBuilder.getState().open) return 'warp';
  if (w.agentBuilder) return 'agents';
  if (w.gridRules) return 'simulation';
  return null;
}

/** Close whichever kind's builder window is open (the Scene builder's ‹ back to the kinds). */
export function closeSceneKinds(): void {
  if (useSceneBuilder2D.getState().open) useSceneBuilder2D.getState().close();
  if (useSceneBuilder.getState().open) useSceneBuilder.getState().close();
  if (useGridBuilder.getState().open) useGridBuilder.getState().close();
  if (useSplatBuilder.getState().open) closeSplatBuilder();
  if (useTimeCubeBuilder.getState().open) closeTimeCubeBuilder();
  if (useWarpBuilder.getState().open) useWarpBuilder.getState().close();
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

/** A card as the starter would have it: its type, its settings and what its inputs are wired to (by type). */
function starterKey(nodes: readonly GraphNode[]): string[] {
  const typeOf = new Map(nodes.map(n => [n.id, n.type]));
  return nodes.map(n => JSON.stringify([
    n.type,
    Object.entries(n.params ?? {}).filter(([k]) => !k.startsWith('_')).sort(([a], [b]) => a.localeCompare(b)),
    Object.entries(n.inputs ?? {}).filter(([, i]) => i.connection).map(([k, i]) => [k, typeOf.get(i.connection!.nodeId), i.connection!.outputKey]).sort(),
  ])).sort();
}
const STARTER = starterKey(BLANK_GRAPH.nodes);

/**
 * Whether the graph is still the starter a new graph opens with (UV → Circle SDF → Light → Output,
 * settings untouched; where the cards sit doesn't count). The kind page clears that by default and
 * keeps anything else (UX audit §4.6).
 */
export function isStarterGraph(nodes: readonly GraphNode[]): boolean {
  if (nodes.length !== STARTER.length) return false;
  const key = starterKey(nodes);
  return key.every((k, i) => k === STARTER[i]);
}

/** The kind page's "Clear the graph first?" when nobody picked: clear only an untouched starter (or nothing to clear). */
export function defaultClearChoice(nodes: readonly GraphNode[], keep: boolean): 'clear' | 'keep' {
  if (keep || builderMade(nodes as GraphNode[])) return 'keep';
  return isStarterGraph(nodes) ? 'clear' : 'keep';
}
