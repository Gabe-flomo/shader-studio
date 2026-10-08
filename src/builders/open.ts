/**
 * open.ts — opening the builders (docs/node-browser.md, "Builders"): from the node browser's
 * Builders section, the empty-canvas right-click menu's Builders, the Do… bar's builder phrases
 * and the Recipe chips on the cards.
 *
 *  - 3D Scene Builder: the builder on a new scene (Build adds it to the graph).
 *  - Grid Rules: a new Grid Rules node (on the Output when the graph is empty), its editor open.
 *  - Agent Rules: a new Agents group in rules mode (the Rules starter), its rules editor open.
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { estimateNodeHeight } from '../store/graphLayout';
import { openNewSceneBuilder } from '../sceneBuilder/store';
import { editSceneInBuilder } from '../sceneBuilder/actions';
import { openNewSceneBuilder2D } from '../sceneBuilder2d/actions';
import { addGridRules } from '../suggestions/doBarGridRules';
import { toast } from '../components/ui/toastStore';
import type { GraphNode } from '../types/nodeGraph';
import type { BuilderId } from './registry';
import { openAgentRulesWindow, openGridRulesEditor, showRecipeOf } from './windows';
import { builderRecipeOf } from './recipe';
import type { BuilderAction } from './doBuilders';

/** Add a Grid Rules node at the top level and open its editor. Returns its id. */
export function newGridRules(): string {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const now = useNodeGraphStore.getState();
  const selected = now.selectedNodeIds.length ? now.selectedNodeIds : now.selectedNodeId ? [now.selectedNodeId] : [];
  const made = addGridRules(now.nodes, {}, selected.filter(id => now.nodes.some(nd => nd.id === id)), () => now.newNodeId(), { topLevel: true, heightOf: estimateNodeHeight });
  now.setNodesRewritten(made.nodes, 'Added Grid Rules');
  useNodeGraphStore.getState().focusNode(made.id);
  openGridRulesEditor(made.id);
  return made.id;
}

/** Add an Agents group in rules mode (wired to the Output) and open its rules editor. */
export function newAgentRules(): string | null {
  const id = useNodeGraphStore.getState().addAgentsStarter('rules');
  if (id) openAgentRulesWindow(id);
  return id;
}

/** Open a builder from the Builders section or menu. */
export function openBuilder(id: BuilderId, at?: { x: number; y: number }): void {
  if (id === 'scene') openNewSceneBuilder(at);
  else if (id === 'scene2d') openNewSceneBuilder2D(at);
  else if (id === 'grid') newGridRules();
  else newAgentRules();
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
    case 'new-scene': openNewSceneBuilder(); return true;
    case 'edit-scene': return editSceneInBuilder(a.sceneId);
    case 'new-grid': newGridRules(); return true;
    case 'open-grid': openGridRulesEditor(a.nodeId); return true;
    case 'new-agents': return !!newAgentRules();
    case 'open-agents': openAgentRulesWindow(a.groupId); return true;
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
