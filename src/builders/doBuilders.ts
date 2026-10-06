/**
 * doBuilders.ts — the Do… bar's builder phrases (lang/commands.ts BUILDER_COMMANDS): "new 3d
 * scene", "edit this scene", "new grid rules", "edit the rules", "open agent rules", "show the
 * recipe", "copy the recipe".
 *
 * A builder phrase is the whole sentence: lower-cased, with "the", "a", "an", "please" and
 * punctuation left out, it must be one of a command's phrases. `readBuilderCommand` finds it,
 * `planBuilderCommand` says what Enter will do on this graph (which node it opens, or why it
 * can't); builders/open.ts runs the plan. Pure.
 */
import type { GraphNode } from '../types/nodeGraph';
import { BUILDER_COMMANDS, type BuilderCommand, type BuilderCommandId } from '../lang/commands';
import { metaOf } from '../sceneBuilder/build';
import { sceneOfBuild } from '../sceneBuilder/apply';
import { isRulesGroup } from '../agentRules/apply';

const IGNORED = new Set(['the', 'a', 'an', 'please', 'now', 'just']);

/** A phrase with its glue words left out: "Open the Scene Builder!" → "open scene builder". */
export function normalisePhrase(text: string): string {
  return text.toLowerCase().replace(/[“”"'’!?.,;:…]+/g, ' ').split(/\s+/).filter(w => w && !IGNORED.has(w)).join(' ');
}

const PHRASES: Array<{ key: string; cmd: BuilderCommand }> = BUILDER_COMMANDS.flatMap(cmd => cmd.words.map(w => ({ key: normalisePhrase(w), cmd })));

/** The builder command a whole sentence is, or null. */
export function readBuilderCommand(text: string): BuilderCommand | null {
  const key = normalisePhrase(text);
  if (!key) return null;
  return PHRASES.find(p => p.key === key)?.cmd ?? null;
}

export type BuilderAction =
  | { kind: 'new-scene' }
  | { kind: 'edit-scene'; sceneId: string }
  | { kind: 'new-grid' }
  | { kind: 'open-grid'; nodeId: string }
  | { kind: 'new-agents' }
  | { kind: 'open-agents'; groupId: string }
  | { kind: 'show-recipe'; nodeId: string }
  | { kind: 'copy-recipe'; nodeId: string };

export interface BuilderPlan {
  id: BuilderCommandId;
  /** What Enter does, in a line. */
  label: string;
  /** Null when it can't run (`problem` says why). */
  action: BuilderAction | null;
  problem?: string;
}

export interface BuilderContext {
  /** The whole graph (top level, groups inside). */
  nodes: GraphNode[];
  /** Selected node ids (at the level being edited). */
  selected: string[];
}

const labelOf = (nd: GraphNode, fallback: string) => (typeof nd.params.label === 'string' && nd.params.label) || fallback;

/** Every node, the insides of groups included. */
function everyNode(nodes: GraphNode[], out: GraphNode[] = []): GraphNode[] {
  for (const nd of nodes) {
    out.push(nd);
    const sg = nd.params.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sg?.nodes) everyNode(sg.nodes, out);
  }
  return out;
}

const builtScenes = (nodes: GraphNode[]) => nodes.filter(nd => nd.type === 'sceneGroup' && metaOf(nd));
const isGrid = (nd: GraphNode) => nd.type === 'gridRules';

/** The one node of a kind: the selected one (a built scene: the scene of any selected node), else the only one in the graph. */
function pickOne(ctx: BuilderContext, all: GraphNode[], fits: (nd: GraphNode) => boolean): { node?: GraphNode; many?: number } {
  const sel = ctx.selected.map(id => all.find(nd => nd.id === id)).filter((nd): nd is GraphNode => !!nd);
  const hit = sel.find(fits);
  if (hit) return { node: hit };
  const every = all.filter(fits);
  if (every.length === 1) return { node: every[0] };
  return { many: every.length };
}

function sceneTarget(ctx: BuilderContext, all: GraphNode[]): { node?: GraphNode; many?: number } {
  for (const id of ctx.selected) {
    const sid = sceneOfBuild(ctx.nodes, id);
    const scene = sid ? all.find(nd => nd.id === sid) : undefined;
    if (scene && metaOf(scene)) return { node: scene };
  }
  const every = builtScenes(all);
  return every.length === 1 ? { node: every[0] } : { many: every.length };
}

/** What a builder command will do on this graph. */
export function planBuilderCommand(cmd: BuilderCommand, ctx: BuilderContext): BuilderPlan {
  const all = everyNode(ctx.nodes);
  const which = (many: number | undefined, what: string) => (many ? `Select the ${what} first: there are ${many}.` : `There is no ${what} in this graph.`);
  switch (cmd.id) {
    case 'open-scene-builder':
    case 'new-3d-scene':
      return { id: cmd.id, label: 'Opens the 3D Scene Builder on a new scene', action: { kind: 'new-scene' } };
    case 'edit-scene': {
      const t = sceneTarget(ctx, all);
      if (!t.node) return { id: cmd.id, label: 'Opens a built scene in the 3D Scene Builder', action: null, problem: `${which(t.many, 'scene the Scene Builder built')}${t.many ? '' : ' Scenes made by hand can be read with right-click → Describe in Scene Builder.'}` };
      return { id: cmd.id, label: `Opens “${labelOf(t.node, 'Scene Group')}” in the 3D Scene Builder`, action: { kind: 'edit-scene', sceneId: t.node.id } };
    }
    case 'new-grid-rules':
      return { id: cmd.id, label: 'Adds a Grid Rules node and opens its editor', action: { kind: 'new-grid' } };
    case 'open-grid-rules': {
      const t = pickOne(ctx, all, isGrid);
      if (t.node) return { id: cmd.id, label: `Opens the Grid Rules editor of “${labelOf(t.node, 'Grid Rules')}”`, action: { kind: 'open-grid', nodeId: t.node.id } };
      if (t.many) return { id: cmd.id, label: 'Opens a Grid Rules editor', action: null, problem: which(t.many, 'Grid Rules node') };
      return { id: cmd.id, label: 'Adds a Grid Rules node and opens its editor (there is none yet)', action: { kind: 'new-grid' } };
    }
    case 'open-agent-rules': {
      const t = pickOne(ctx, all, isRulesGroup);
      if (t.node) return { id: cmd.id, label: `Opens the rules of “${labelOf(t.node, 'Agents')}”`, action: { kind: 'open-agents', groupId: t.node.id } };
      if (t.many) return { id: cmd.id, label: 'Opens an Agents group\'s rules', action: null, problem: which(t.many, 'rules Agents group') };
      return { id: cmd.id, label: 'Adds an Agents group in rules mode and opens its rules (there is none yet)', action: { kind: 'new-agents' } };
    }
    case 'new-agent-rules':
      return { id: cmd.id, label: 'Adds an Agents group in rules mode and opens its rules', action: { kind: 'new-agents' } };
    case 'edit-rules': {
      const t = pickOne(ctx, all, nd => isGrid(nd) || isRulesGroup(nd));
      if (!t.node) return { id: cmd.id, label: 'Opens the rules', action: null, problem: which(t.many, 'Grid Rules node or rules Agents group') };
      return isGrid(t.node)
        ? { id: cmd.id, label: `Opens the Grid Rules editor of “${labelOf(t.node, 'Grid Rules')}”`, action: { kind: 'open-grid', nodeId: t.node.id } }
        : { id: cmd.id, label: `Opens the rules of “${labelOf(t.node, 'Agents')}”`, action: { kind: 'open-agents', groupId: t.node.id } };
    }
    case 'show-recipe':
    case 'copy-recipe': {
      const fits = (nd: GraphNode) => isGrid(nd) || isRulesGroup(nd) || (nd.type === 'sceneGroup' && !!metaOf(nd));
      const scene = sceneTarget(ctx, all);
      const sel = pickOne(ctx, all, fits);
      // A selected node of a built scene names its scene; else the selected (or only) builder node.
      const node = ctx.selected.some(id => sceneOfBuild(ctx.nodes, id)) ? scene.node : sel.node;
      const copy = cmd.id === 'copy-recipe';
      if (!node) return { id: cmd.id, label: copy ? 'Copies a recipe' : 'Shows a recipe', action: null, problem: which(sel.many, 'built scene, Grid Rules node or rules Agents group') };
      const what = node.type === 'sceneGroup' ? `the recipe of “${labelOf(node, 'Scene Group')}”` : node.type === 'gridRules' ? `the rule of “${labelOf(node, 'Grid Rules')}”` : `the rules of “${labelOf(node, 'Agents')}”`;
      return copy
        ? { id: cmd.id, label: `Copies ${what}`, action: { kind: 'copy-recipe', nodeId: node.id } }
        : { id: cmd.id, label: `Shows ${what} on its card`, action: { kind: 'show-recipe', nodeId: node.id } };
    }
  }
}
