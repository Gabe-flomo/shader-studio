/**
 * open.ts — opening the builders (docs/node-browser.md, "Builders"): from the node browser's
 * Builders section, the empty-canvas right-click menu's Builders, the Do… bar's builder phrases
 * and the Recipe chips on the cards.
 *
 *  - Scene builder (the one listed): "What kind of scene?", or the scene a builder made here
 *    (builders/sceneKinds.ts); a kind then opens one of the builders below (or the Splat builder,
 *    splatBuilder/, for a Splat scene).
 *  - 3D Scene Builder: the builder on a new scene (Build adds it to the graph).
 *  - Grid Rules: a new Grid Rules node (on the Output when the graph is empty), its editor open.
 *    (The kind page's Grid simulation opens it the same way; its Grid scene opens the Grid builder,
 *    gridScene/, which jumps to Grid Rules with "Make it a simulation".)
 *  - Agent Builder: its start page ("What are you making?"); picking a kind adds the group.
 *  - 3D Agent Builder: a new 3D rules group (agentRules/space3d.ts: Ball Emit, a volume Trail, Draw
 *    agents through an orbiting camera), its rules editor open.
 *  - Expression Builder: its window on a new chain from UV (Add to graph makes the Expression Block).
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { estimateNodeHeight } from '../store/graphLayout';
import { intoView } from '../components/NodeGraph/spawnPoint';
import { openNewSceneBuilder } from '../sceneBuilder/store';
import { editSceneInBuilder } from '../sceneBuilder/actions';
import { openNewSceneBuilder2D } from '../sceneBuilder2d/actions';
import { addGridRules } from '../suggestions/doBarGridRules';
import { toast } from '../components/ui/toastStore';
import { openExpressionBuilder } from '../exprBuilder/store';
import type { GraphNode } from '../types/nodeGraph';
import type { BuilderId } from './registry';
import { closeSceneShell, openAgentBuilder, openGridRulesEditor, showRecipeOf } from './windows';
import { readStartCells, startCellsFromGrid, type StartCells } from '../gridRules/startCells';
import { editScene2DInBuilder } from '../sceneBuilder2d/actions';
import { openSceneBuilderShell, type BuiltScene, type SceneKind } from './sceneKinds';
import { beginSceneDraft } from './sceneDraft';
import { openAgentRulesEditor } from '../agentRules/storeActions';
import { editGridSceneInBuilder, openNewGridScene } from '../gridScene/actions';
import { builderRecipeOf } from './recipe';
import type { BuilderAction } from './doBuilders';
import { editSplatSceneInBuilder, openNewSplatScene } from '../splatBuilder/actions';
import { openNewWarpBuilder } from '../warpBuilder/actions';
import { editTimeCubeInBuilder, openNewTimeCube } from '../timeCubeBuilder/actions';

/**
 * What a new Grid Rules node starts with (newGridRules): params over its defaults, and a drawn start
 * (the cells, as rows of states top first, or a StartCells), which sets Start to "Your drawing".
 * The Grid scene builder's "Make it a simulation" hands its drawn cells over this way.
 */
export interface GridRulesSeed {
  params?: Record<string, unknown>;
  startCells?: StartCells | number[][] | null;
}

/** The params a GridRulesSeed makes (a drawing that is empty is left out). Pure. */
export function gridSeedParams(seed: GridRulesSeed = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(seed.params ?? {}) };
  const sc = Array.isArray(seed.startCells) ? startCellsFromGrid(seed.startCells) : readStartCells(seed.startCells);
  if (sc) { out.start = 'cells'; out.startCells = sc; }
  return out;
}

/** Add a Grid Rules node at the top level and open its editor, optionally from a seed (params, a drawn start). Returns its id. */
export function newGridRules(seed: GridRulesSeed = {}): string {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const now = useNodeGraphStore.getState();
  const selected = now.selectedNodeIds.length ? now.selectedNodeIds : now.selectedNodeId ? [now.selectedNodeId] : [];
  const made = addGridRules(now.nodes, gridSeedParams(seed), selected.filter(id => now.nodes.some(nd => nd.id === id)), () => now.newNodeId(), { topLevel: true, heightOf: estimateNodeHeight });
  // Beside the selection or the Output; brought into the visible canvas when that is off screen.
  now.setNodesRewritten(intoView(now.nodes, made.nodes, 'ifOutOfView'), 'Added Grid Rules');
  useNodeGraphStore.getState().focusNode(made.id);
  openGridRulesEditor(made.id);
  return made.id;
}

/** Add an Agents group in rules mode (wired to the Output) and open it in the Agent Builder. */
export function newAgentRules(): string | null {
  const id = useNodeGraphStore.getState().addAgentsStarter('rules');
  if (id) openAgentBuilder(id);
  return id;
}

/** Add a 3D rules Agents group (the 3D Agent Builder's setup, from 3D template `template`, on the Output) and open it in the Agent Builder. */
export function newAgents3d(template?: string): string | null {
  const id = useNodeGraphStore.getState().addAgentsStarter('rules3d', undefined, template);
  if (id) openAgentRulesEditor(id);
  return id;
}

/** Open a builder from the Builders section or menu. */
export function openBuilder(id: BuilderId, at?: { x: number; y: number }): void {
  if (id === 'scenes') openSceneBuilderShell();
  else if (id === 'scene') { beginSceneDraft(); openNewSceneBuilder(at); }
  else if (id === 'scene2d') { beginSceneDraft(); openNewSceneBuilder2D(at); }
  else if (id === 'grid') newGridRules();
  else if (id === 'agents3d') newAgents3d();
  else if (id === 'expr') openExpressionBuilder({ place: at });
  // The Agent Builder opens on its start page ("What are you making?"): nothing is added until a kind is picked.
  else openAgentBuilder(null);
}

/**
 * The Scene builder's kind page picked a kind: its builder, on a new scene. `fromShell` tells the
 * Agent Builder the kind page already asked about clearing the graph.
 */
export function startSceneKind(kind: SceneKind, o: { at?: { x: number; y: number }; fromShell?: boolean } = {}): void {
  // Part of the Scene builder's session (sceneDraft.ts): nothing it builds is in the graph until Done.
  beginSceneDraft();
  closeSceneShell();
  if (kind === '3d') openNewSceneBuilder(o.at);
  else if (kind === '2d') openNewSceneBuilder2D(o.at);
  else if (kind === 'grid') openNewGridScene(o.at);
  else if (kind === 'simulation') newGridRules();
  else if (kind === 'splat') openNewSplatScene(o.at);
  else if (kind === 'timecube') openNewTimeCube(o.at);
  else if (kind === 'warp') openNewWarpBuilder();
  else openAgentBuilder(null, { fromShell: o.fromShell });
}

/** "Edit this one": a built scene in its own builder, as it was built (its saved spec, its node, its group). */
export function editBuiltScene(b: Pick<BuiltScene, 'kind' | 'id'>): boolean {
  // Done rebuilds it in place as one undo step; closing without Done leaves it as it was (sceneDraft.ts).
  beginSceneDraft();
  closeSceneShell();
  if (b.kind === '3d') return editSceneInBuilder(b.id);
  if (b.kind === '2d') return editScene2DInBuilder(b.id);
  if (b.kind === 'splat') return editSplatSceneInBuilder(b.id);
  if (b.kind === 'timecube') return editTimeCubeInBuilder(b.id);
  if (b.kind === 'grid' && useNodeGraphStore.getState().nodes.some(nd => nd.id === b.id && nd.type !== 'gridRules')) return editGridSceneInBuilder(b.id);
  if (b.kind === 'grid' || b.kind === 'simulation') {
    const st = useNodeGraphStore.getState();
    if (st.activeGroupPath.length) st.exitToRoot();
    useNodeGraphStore.getState().focusNode(b.id);
    openGridRulesEditor(b.id);
    return true;
  }
  openAgentBuilder(b.id);
  return true;
}

/** Copy a builder-made node's recipe (a scene's recipe, a Grid Rules rule, a group's rules as sentences). */
export function copyRecipeOf(nodeId: string): boolean {
  const nodes = useNodeGraphStore.getState().nodes;
  const find = (list: GraphNode[]): GraphNode | undefined => {
    for (const nd of list) {
      if (nd.id === nodeId) return nd;
      const inner = (nd.params.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes;
      const hit = inner && find(inner);
      if (hit) return hit;
    }
    return undefined;
  };
  const node = find(nodes);
  const r = node ? builderRecipeOf(node, nodes) : null;
  if (!r) return false;
  const text = r.kind === 'agents' || r.kind === 'scene' ? r.lines : r.text;
  const done = () => toast.success(r.kind === 'scene' ? 'Recipe copied' : r.kind === 'grid' ? 'Rule copied' : 'Rules copied', {
    message: r.kind === 'scene' ? 'Paste it into the Scene Builder\'s Recipe tab to build it again.' : undefined,
  });
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clip) { toast.info('Can\'t reach the clipboard', { message: text }); return false; }
  void clip.writeText(text).then(done, () => toast.info('Can\'t reach the clipboard', { message: text }));
  return true;
}

/** Run a Do… bar builder plan's action (builders/doBuilders.ts). */
export function runBuilderAction(a: BuilderAction): boolean {
  const st = useNodeGraphStore.getState();
  switch (a.kind) {
    case 'open-scenes': openSceneBuilderShell(); return true;
    case 'new-grid-scene': beginSceneDraft(); openNewGridScene(); return true;
    case 'new-scene': beginSceneDraft(); openNewSceneBuilder(); return true;
    case 'new-scene2d': beginSceneDraft(); openNewSceneBuilder2D(); return true;
    case 'new-expression': openExpressionBuilder(); return true;
    case 'edit-scene': beginSceneDraft(); return editSceneInBuilder(a.sceneId);
    case 'new-grid': newGridRules(); return true;
    case 'open-grid': openGridRulesEditor(a.nodeId); return true;
    case 'new-agents': openAgentBuilder(null); return true;
    case 'new-agents3d': return !!newAgents3d(a.template);
    case 'open-agents': openAgentRulesEditor(a.groupId); return true;
    case 'show-recipe': {
      // A node on the top level: go there and bring its card into view.
      if (st.nodes.some(nd => nd.id === a.nodeId)) {
        if (st.activeGroupPath.length) st.exitToRoot();
        useNodeGraphStore.getState().focusNode(a.nodeId);
      }
      showRecipeOf(a.nodeId);
      return true;
    }
    case 'copy-recipe': return copyRecipeOf(a.nodeId);
  }
}
