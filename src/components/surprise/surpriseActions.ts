/**
 * surpriseActions.ts — Surprise me for Grid Rules and Agent Rules, and Randomise all settings
 * in this graph (docs/surprise.md). Each is one undo step of the graph and shows its seed in a
 * toast with Reroll and Undo.
 */
import { create } from 'zustand';
import { newSeed, makeRng } from '../../lib/surprise';
import { getActiveNodes, setActiveNodes, undoManager, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { toast } from '../ui/toastStore';
import { surpriseGrid } from '../../gridRules/surprise';
import type { GridRuleType } from '../../gridRules/spec';
import { surpriseAgents } from '../../agentRules/surprise';
import { surpriseForKind } from '../../agentBuilder/surprise';
import { groupRules } from '../../agentRules/apply';
import { kindOf } from '../../agentRules/spec';
import { surpriseGroupRules } from '../../agentRules/storeActions';
import { lockedItems, randomizedGraph, type RandomChange } from '../../nodes/randomizeParams';
import { getRandomizeOptions, optionsSummary, type RandomizeOptions } from '../../nodes/randomizeOptions';
import { focusItems } from '../../nodes/randomizeFocus';
import { focusWeights } from './focusWeights';
import { announceSurprise } from './announce';
import { restartAgents } from '../../lib/agentRunner';
import { compileGraph } from '../../compiler/graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';

/** The last seed per builder window (by node id) and for the whole graph. */
export const useSurpriseSeeds = create<{ grid: Record<string, number>; agents: Record<string, number>; graph: number | null }>(() => ({ grid: {}, agents: {}, graph: null }));

const undoGraph = () => useNodeGraphStore.getState().undo();
/** Still the last thing done: nothing was pushed onto the graph's undo history since. */
const stillTop = () => { const top = undoManager.top(); return () => undoManager.top() === top; };

/** Grid Rules → Surprise me: a rule that stays alive on the CPU test board, with a start and colours. */
export function surpriseGridAction(nodeId: string, seed: number, type?: GridRuleType): void {
  const st = useNodeGraphStore.getState();
  if (!st.nodes.some(n => n.id === nodeId)) return;
  const res = surpriseGrid(seed, { type });
  st.setNodesRewritten(st.nodes.map(n => (n.id === nodeId ? { ...n, params: { ...n.params, ...res.value.patch } } : n)), `Surprise: ${res.value.summary}`);
  useSurpriseSeeds.setState(s => ({ grid: { ...s.grid, [nodeId]: res.seed } }));
  announceSurprise({
    title: `Surprise: ${res.value.summary}`, seed: res.seed,
    message: res.rejected.length ? `Skipped ${res.rejected.length} rule${res.rejected.length === 1 ? '' : 's'} that died, filled or froze on a test board.` : 'Stays alive on a test board.',
    stillCurrent: stillTop(),
    undo: undoGraph,
    reroll: () => { undoGraph(); surpriseGridAction(nodeId, newSeed(), type); },
  });
}

/** Agent Rules → Surprise me: a random rule set, the trail's decay and colours. */
export function surpriseAgentsAction(groupId: string, seed: number): void {
  const g = useNodeGraphStore.getState().nodes.find(n => n.id === groupId);
  if (!g) return;
  const s = surpriseAgents(makeRng(seed), { d3: g.params.space === '3d' });
  if (!surpriseGroupRules(groupId, s, `Surprise: ${s.summary}`)) return;
  // A new rule set starts from a fresh board: the last one's walkers may be piled up or gone.
  restartAgents(groupId);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('agents-restart'));
  useSurpriseSeeds.setState(x => ({ agents: { ...x.agents, [groupId]: seed } }));
  announceSurprise({
    title: 'Surprise rules', seed, message: s.summary,
    stillCurrent: stillTop(),
    undo: undoGraph,
    reroll: () => { undoGraph(); surpriseAgentsAction(groupId, newSeed()); },
  });
}

/**
 * Agent Builder → Surprise me (agentBuilder/surprise.ts): a random rule set of the group's own kind
 * (so the builder keeps its sections), its trail's numbers and colours, one undo step, with the seed
 * in a toast (Reroll, Undo). A shape's Collide is kept, as a preset keeps it.
 */
export function surpriseBuilderAction(groupId: string, seed: number): boolean {
  const g = useNodeGraphStore.getState().nodes.find(n => n.id === groupId);
  if (!g) return false;
  const was = groupRules(g);
  // A rule set that doesn't compile would leave the old program drawing a still picture: it is taken
  // back and the next seed tried (a graph that didn't compile before isn't the surprise's fault).
  const before = useNodeGraphStore.getState().nodes;
  let brokenBefore: boolean | undefined;
  let failure: string | null = null;
  for (let i = 0; i < SURPRISE_TRIES; i++) {
    const sd = i ? nextSeed(seed, i) : seed;
    const s = surpriseForKind(makeRng(sd), kindOf(was), { d3: g.params.space === '3d' });
    const set = was.collide ? { ...s.set, collide: was.collide } : s.set;
    if (!surpriseGroupRules(groupId, { ...s, set }, `Surprise: ${s.summary}`)) return false;
    const err = graphCompileError(useNodeGraphStore.getState().nodes);
    if (err && !(brokenBefore ??= graphCompileError(before) !== null)) {
      undoGraph();
      failure = err;
      continue;
    }
    // A new rule set starts from a fresh board (the runner keeps the request until the new rule has compiled).
    restartAgents(groupId);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('agents-restart'));
    useSurpriseSeeds.setState(x => ({ agents: { ...x.agents, [groupId]: sd } }));
    announceSurprise({
      title: 'Surprise', seed: sd, message: failure ? `${s.summary} (skipped ${i} that didn't compile)` : s.summary,
      stillCurrent: stillTop(),
      undo: undoGraph,
      reroll: () => { undoGraph(); surpriseBuilderAction(groupId, newSeed()); },
    });
    return true;
  }
  if (failure) toast.error('Surprise didn\'t compile', { message: 'The random rules were taken back; the scene is as it was. Try again for another seed.', details: failure });
  return false;
}

/** Tries before a Surprise gives up on rule sets that don't compile. */
const SURPRISE_TRIES = 4;
/** The seed tried after `seed` fails `i` times (deterministic, so the same seed gives the same result). */
const nextSeed = (seed: number, i: number) => (seed + i * 7919) % 2147483647;
/** The graph's first compile error, or null. */
function graphCompileError(nodes: GraphNode[]): string | null {
  try {
    const r = compileGraph({ nodes });
    return r.errors?.length ? r.errors[0] : null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** The options as used for one randomize (the saved ones, unless a caller overrides). */
const currentOptions = (o?: Partial<RandomizeOptions>): RandomizeOptions => ({ ...getRandomizeOptions(), ...o });

/**
 * Randomise all settings in this graph (the level on screen), from `seed`, with the saved options
 * (strength, locks, groups, Focus), one undo step. With Focus on, the graph is first drawn small
 * with each setting nudged (about a second at most, progress in the dice's popover); if that can't
 * be done every setting is weighted evenly. The same seed, options and graph give the same result.
 */
export async function randomizeGraphAction(seed: number = newSeed(), override?: Partial<RandomizeOptions>): Promise<void> {
  const opts = currentOptions(override);
  const st0 = useNodeGraphStore.getState();
  const path = st0.activeGroupPath;
  let weights: Record<string, number> | null = null;
  if (opts.focus) {
    const level0 = path.length ? getActiveNodes(st0.nodes, path) : st0.nodes;
    if (level0) weights = await focusWeights(st0.nodes, path, focusItems(level0, opts), opts);
  }
  const st = useNodeGraphStore.getState();
  const level = path.length ? getActiveNodes(st.nodes, path) : st.nodes;
  if (!level) return;
  const r = randomizedGraph(level, seed, opts, weights);
  if (!r.changed) return finishNothing();
  const nodes = path.length ? setActiveNodes(st.nodes, path, r.nodes) : r.nodes;
  if (!nodes) return;
  st.setNodesRewritten(nodes, `Randomised ${r.changed} settings (seed ${seed})`);
  finish(seed, r.changed, r.changes, opts, !!weights, override);
}

function finishNothing() {
  toast.info('Nothing to randomise', { message: 'No free settings on this level of the graph, or they are all locked.' });
}

function finish(seed: number, changed: number, changes: RandomChange[], opts: RandomizeOptions, measured: boolean, override?: Partial<RandomizeOptions>) {
  useSurpriseSeeds.setState({ graph: seed });
  const top = changes.slice(0, 3).map(c => c.label).join(', ');
  announceSurprise({
    title: `Randomised ${changed} setting${changed === 1 ? '' : 's'}`, seed,
    message: (opts.focus ? (measured ? `Focused on what changes the picture${top ? `: ${top}${changes.length > 3 ? ' and more' : ''}` : ''}. ` : 'Focus could not draw the graph, so every setting was weighted evenly. ') : '')
      + `${optionsSummary(opts, lockedItems(useNodeGraphStore.getState().nodes).length)}. Wired, keyframed and locked settings are kept.`,
    stillCurrent: stillTop(),
    undo: undoGraph,
    reroll: () => { undoGraph(); void randomizeGraphAction(newSeed(), override); },
  });
}

/**
 * A node card's Randomize: the saved options apply (strength, choices, colours, locks, Focus).
 * With Focus on, only this node's settings are measured.
 */
export async function randomizeNodeAction(nodeId: string): Promise<void> {
  const opts = getRandomizeOptions();
  const st = useNodeGraphStore.getState();
  let weights: Record<string, number> | null = null;
  if (opts.focus) {
    const node = (st.activeGroupPath.length ? getActiveNodes(st.nodes, st.activeGroupPath) ?? st.nodes : st.nodes).find(n => n.id === nodeId);
    if (node && node.type !== 'group') weights = await focusWeights(st.nodes, st.activeGroupPath, focusItems([node], { ...opts, groupFace: false, insideGroups: false }), opts);
  }
  useNodeGraphStore.getState().randomizeNodeParams(nodeId, weights);
}
