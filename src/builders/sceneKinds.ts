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
 *  - Combine → the Combine window (combine/, docs/combine.md): what the other kinds made, put together by verbs (a
 *    photo in a 3D scene, people replaced by a 2D build), the glue built from ordinary nodes. Not on a phone.
 *
 * Opening the Scene builder: a graph a builder made reopens that scene ("Edit this one / Start
 * over / Add another", the Agent Builder's prompt for every kind); any other graph goes to the
 * kind page, which keeps the graph by default (clearing is the default only for the untouched starter).
 *
 * The whole visit is one session (sceneDraft.ts): whatever the kinds build goes into a draft, and only Done puts it in
 * the graph, as one undo step. Back to the kinds, or closing without Done, leaves the graph as it was.
 */
import type { GraphNode } from '../types/nodeGraph';
import { BLANK_GRAPH } from '../store/exampleIndex';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { useSceneBuilder } from '../sceneBuilder/store';
import { useSceneBuilder2D } from '../sceneBuilder2d/store';
import { clearableCount, clearGraphForBuilder, removeSetupNodes } from '../agentBuilder/actions';
import { useGridBuilder } from '../gridScene/store';
import { closeAgentBuilder, closeAgentRulesWindow, closeGridRulesEditor, openSceneShell, useBuilderWindows } from './windows';
import { beginSceneDraft, confirmDiscardScene, discardingWhile, openSceneKind as openKind, resetSceneDraft, sceneDraftChanged } from './sceneDraft';
import { clearDraft } from './drafts';
import { useSplatBuilder } from '../splatBuilder/store';
import { closeSplatBuilder } from '../splatBuilder/actions';
import { useWarpBuilder } from '../warpBuilder/store';
import { useTimeCubeBuilder } from '../timeCubeBuilder/store';
import { closeTimeCubeBuilder } from '../timeCubeBuilder/actions';
import { useCombine } from '../combine/store';

export {
  SCENE_KINDS, sceneKindsFor, sceneKindInfo, builtScenes, builderMade, selectedBuiltScene, builtSceneIds,
  type SceneKind, type SceneKindInfo, type BuiltScene,
} from './builtScenes';
import { builderMade, builtSceneIds, type BuiltScene } from './builtScenes';

// ── Store side ───────────────────────────────────────────────────────────────

/** Which kind's builder window is open now (null: none). */
export const openSceneKind = openKind;

/** Close whichever kind's builder window is open (the Scene builder's ‹ back to the kinds). */
export function closeSceneKinds(): void {
  if (useSceneBuilder2D.getState().open) useSceneBuilder2D.getState().close();
  if (useSceneBuilder.getState().open) useSceneBuilder.getState().close();
  if (useGridBuilder.getState().open) useGridBuilder.getState().close();
  if (useSplatBuilder.getState().open) closeSplatBuilder();
  if (useTimeCubeBuilder.getState().open) closeTimeCubeBuilder();
  if (useWarpBuilder.getState().open) useWarpBuilder.getState().close();
  if (useCombine.getState().open) useCombine.getState().close();
  if (useBuilderWindows.getState().agentBuilder) closeAgentBuilder();
  if (useBuilderWindows.getState().agentRules) closeAgentRulesWindow();
  if (useBuilderWindows.getState().gridRules) closeGridRulesEditor();
}

/**
 * Open the Scene builder (the side list's one entry): a graph (or a selected group) a builder made
 * reopens it (Edit this one / Start over / Add another); any other graph, the kind page. The session
 * starts here: nothing reaches the graph until Done (sceneDraft.ts).
 */
export function openSceneBuilderShell(): void {
  beginSceneDraft();
  const nodes = useNodeGraphStore.getState().nodes;
  closeSceneKinds();
  openSceneShell(builderMade(nodes) ? { page: 'existing' } : { page: 'kinds' });
}

/**
 * Back to the kind page from a kind's builder: the scene goes (asking first when you changed something), the graph is
 * as it was before the Scene builder opened, and another kind starts from there. True when it went back.
 */
export async function backToSceneKinds(): Promise<boolean> {
  if (sceneDraftChanged() && !(await confirmDiscardScene())) return false;
  const kind = openKind();
  const target = kind === '2d' ? useSceneBuilder2D.getState().targetSceneId : kind === '3d' ? useSceneBuilder.getState().targetSceneId : kind === 'grid' ? useGridBuilder.getState().targetSceneId : null;
  beginSceneDraft();
  discardingWhile(closeSceneKinds);
  // An unbuilt draft the window kept as it closed (builders/drafts.ts) is discarded with the rest.
  if (kind === '2d' || kind === '3d' || kind === 'grid') clearDraft(kind, target);
  resetSceneDraft();
  openSceneShell({ page: 'kinds' });
  return true;
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
