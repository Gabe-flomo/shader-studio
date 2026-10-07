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
import { surpriseGroupRules } from '../../agentRules/storeActions';
import { randomizedGraph } from '../../nodes/randomizeParams';
import { announceSurprise } from './announce';

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
  useSurpriseSeeds.setState(x => ({ agents: { ...x.agents, [groupId]: seed } }));
  announceSurprise({
    title: 'Surprise rules', seed, message: s.summary,
    stillCurrent: stillTop(),
    undo: undoGraph,
    reroll: () => { undoGraph(); surpriseAgentsAction(groupId, newSeed()); },
  });
}

/** Randomise all settings in this graph (the level on screen), from `seed`, one undo step. */
export function randomizeGraphAction(seed: number = newSeed()): void {
  const st = useNodeGraphStore.getState();
  const path = st.activeGroupPath;
  const level = path.length ? getActiveNodes(st.nodes, path) : st.nodes;
  if (!level) return;
  const r = randomizedGraph(level, seed);
  if (!r.changed) return finishNothing();
  const nodes = path.length ? setActiveNodes(st.nodes, path, r.nodes) : r.nodes;
  if (!nodes) return;
  st.setNodesRewritten(nodes, `Randomised ${r.changed} settings (seed ${seed})`);
  finish(seed, r.changed);
}

function finishNothing() {
  toast.info('Nothing to randomise', { message: 'No free sliders on this level of the graph.' });
}

function finish(seed: number, changed: number) {
  useSurpriseSeeds.setState({ graph: seed });
  announceSurprise({
    title: `Randomised ${changed} setting${changed === 1 ? '' : 's'}`, seed,
    message: 'Every free slider on this level, inside its interesting range. Wired, keyframed and excluded sliders are kept.',
    stillCurrent: stillTop(),
    undo: undoGraph,
    reroll: () => { undoGraph(); randomizeGraphAction(newSeed()); },
  });
}
