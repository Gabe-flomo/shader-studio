/**
 * sceneDraft.ts — a Scene builder session (docs/scene-builder.md, "Nothing is added until Done").
 *
 * From the moment the Scene builder opens (its kind page, or any kind's own window: 2D, 3D, Grid, Splat, Time Cube,
 * Warp, and the Agent scene and Grid simulation opened from the kind page) until it closes, the graph in the store is
 * the builder's draft. The builders keep working the way they always have: the Splat, Time Cube and Agent builders
 * write into it as you edit (their picture is the main preview's), the 2D, 3D and Grid builders write into it when you
 * press Apply. Before the first change the session keeps the graph as it was (nodes, Play, datasets, the dirty mark,
 * the selection) and both undo stacks.
 *
 *  - Done (builders/finish.ts finishBuilder) keeps the draft: the undo stacks go back to how they were and the whole
 *    session becomes ONE step ("Scene builder: 3D scene"). Editing a built scene rebuilds it in place, so that step
 *    replaces it; a new one is added (after the kind page's clear, when that was chosen).
 *  - Closing any other way (×, Esc, the kind page closed, something else closing the window) puts the graph and the
 *    undo stacks back exactly as they were. With changes made in the window, × and Esc ask first (Discard / Keep
 *    editing).
 *  - Back to the kind page drops the draft too (asking the same way when there are changes), so picking another
 *    kind starts again from the graph as it was: only the scene you press Done on ends up in the graph.
 *
 * While the session is open what saves or remembers the graph waits (sceneDraftFlag.ts), and the graph canvas behind
 * the window doesn't re-render, so the draft is never seen there or saved.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { UndoSnapshot } from '../store/managers/UndoManager';
import { undoManager, useNodeGraphStore } from '../store/useNodeGraphStore';
import { askChoice } from '../components/ui/dialogStore';
import { useSceneBuilder } from '../sceneBuilder/store';
import { useSceneBuilder2D } from '../sceneBuilder2d/store';
import { useGridBuilder } from '../gridScene/store';
import { useSplatBuilder } from '../splatBuilder/store';
import { useTimeCubeBuilder } from '../timeCubeBuilder/store';
import { useWarpBuilder } from '../warpBuilder/store';
import { useCombine } from '../combine/store';
import { useBuilderWindows } from './windows';
import { sceneDraftActive, setSceneDraftActive } from './sceneDraftFlag';
import type { SceneKind } from './sceneKinds';

type GraphState = ReturnType<typeof useNodeGraphStore.getState>;

/** What closing without Done puts back. */
interface Kept {
  nodes: GraphNode[];
  looseGroups: GraphState['looseGroups'];
  play: GraphState['play'];
  datasets: GraphState['datasets'];
  graphDirty: boolean;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
}

interface Session {
  /** The graph before the session. */
  base: Kept;
  undo: UndoSnapshot;
  /** Where back to the kind page returns to, when not the base: after "Start over" took a scene away. */
  restart: { kept: Kept; undo: UndoSnapshot } | null;
  /** The kind whose window is open (null: the kind page). */
  kind: SceneKind | null;
  /** The graph and the builder's settings when that window opened: what "changes made here" compares with. */
  mark: { nodes: GraphNode[]; play: GraphState['play']; spec: string | null };
}

let session: Session | null = null;
let discarding = 0;
/** Counts sessions and their restarts (back to the kinds): what a "come back here" (Combine's New…) is tied to. */
let generation = 0;

/** Which session (and restart) this is: a return Combine set up is only good for the same one. */
export const sceneDraftGeneration = (): number => generation;

/**
 * A window that asked for a kind's builder to come back to it (Combine's New… and Edit product): × or Esc on that
 * builder goes back there instead of closing the session. True when it was handled.
 */
type CloseHook = (close: () => void) => Promise<boolean> | boolean;
let closeHook: CloseHook | null = null;
export function setSceneCloseHook(h: CloseHook | null): void { closeHook = h; }

const TITLES: Record<SceneKind, string> = {
  '2d': '2D scene', agents: 'Agent scene', grid: 'Grid scene', simulation: 'Grid simulation', '3d': '3D scene',
  splat: 'Splat scene', timecube: 'Time Cube', warp: 'Warp', combine: 'Combined scene',
};

function keptNow(): Kept {
  const s = useNodeGraphStore.getState();
  return { nodes: s.nodes, looseGroups: s.looseGroups, play: s.play, datasets: s.datasets, graphDirty: s.graphDirty, selectedNodeId: s.selectedNodeId, selectedNodeIds: s.selectedNodeIds };
}

const sameNodes = (a: readonly GraphNode[], b: readonly GraphNode[]) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Which kind's builder window is open now (null: none). */
export function openSceneKind(): SceneKind | null {
  const w = useBuilderWindows.getState();
  if (useSceneBuilder2D.getState().open) return '2d';
  if (useSceneBuilder.getState().open) return '3d';
  if (useGridBuilder.getState().open) return 'grid';
  if (useSplatBuilder.getState().open) return 'splat';
  if (useTimeCubeBuilder.getState().open) return 'timecube';
  if (useWarpBuilder.getState().open) return 'warp';
  if (useCombine.getState().open) return 'combine';
  if (w.agentBuilder) return 'agents';
  if (w.gridRules) return 'simulation';
  return null;
}

/** How many kinds' windows are open at once (more than one: a window opened from another, like Warp from 2D). */
export function openKindCount(): number {
  const w = useBuilderWindows.getState();
  return [useSceneBuilder2D.getState().open, useSceneBuilder.getState().open, useGridBuilder.getState().open, useSplatBuilder.getState().open,
    useTimeCubeBuilder.getState().open, useWarpBuilder.getState().open, useCombine.getState().open, !!w.agentBuilder, !!w.gridRules].filter(Boolean).length;
}

/** The open kind's own settings, as text (null for the kinds that keep theirs in the graph: agents, simulation). */
function specKey(kind: SceneKind | null): string | null {
  switch (kind) {
    case '2d': return JSON.stringify(useSceneBuilder2D.getState().scene);
    case '3d': return JSON.stringify(useSceneBuilder.getState().spec);
    case 'grid': return JSON.stringify(useGridBuilder.getState().spec);
    case 'splat': return JSON.stringify(useSplatBuilder.getState().spec);
    case 'timecube': return JSON.stringify(useTimeCubeBuilder.getState().spec);
    case 'warp': return JSON.stringify(useWarpBuilder.getState().spec);
    case 'combine': return JSON.stringify(useCombine.getState().spec);
    default: return null;
  }
}

/** A window that keeps the session open: the kind page, a kind's window, or the Agent Builder's advanced rules. */
function sessionWindowOpen(): boolean {
  const w = useBuilderWindows.getState();
  return openSceneKind() !== null || !!w.sceneShell || !!w.agentRules;
}

/** A window that starts a session when it opens (the Agent Builder and Grid Rules also open from their cards: not a session). */
function startingWindowOpen(): boolean {
  return !!useBuilderWindows.getState().sceneShell || useSceneBuilder2D.getState().open || useSceneBuilder.getState().open || useGridBuilder.getState().open
    || useSplatBuilder.getState().open || useTimeCubeBuilder.getState().open || useWarpBuilder.getState().open || useCombine.getState().open;
}

function remark(s: Session): void {
  const kind = openSceneKind();
  s.kind = kind;
  s.mark = { nodes: useNodeGraphStore.getState().nodes, play: useNodeGraphStore.getState().play, spec: specKey(kind) };
}

// ── Watching the windows ─────────────────────────────────────────────────────

let watching = false;
let checkQueued = false;

function onWindows(): void {
  if (!session && startingWindowOpen()) beginSceneDraft();
  // A kind's window opening (closing keeps the kind: Done's step is named after it).
  const kind = session ? openSceneKind() : null;
  if (session && kind !== null && kind !== session.kind) remark(session);
  // Every window closed (a kind's window closing and the next one opening is one moment): the draft goes.
  if (session && !checkQueued) {
    checkQueued = true;
    queueMicrotask(() => {
      checkQueued = false;
      if (session && !sessionWindowOpen()) discardSceneDraft();
    });
  }
}

/** Watch the builder windows (once): a window opening starts a session; all of them closed without Done drops it. */
export function watchSceneDraft(): void {
  if (watching) return;
  watching = true;
  for (const s of [useSceneBuilder2D, useSceneBuilder, useGridBuilder, useSplatBuilder, useTimeCubeBuilder, useWarpBuilder, useCombine, useBuilderWindows] as Array<{ subscribe: (fn: () => void) => () => void }>) s.subscribe(onWindows);
}

// ── The session ──────────────────────────────────────────────────────────────

/** Start a session on the graph as it is now (nothing when one is open already). Call it before a builder writes anything. */
export function beginSceneDraft(): void {
  watchSceneDraft();
  if (session) return;
  const base = keptNow();
  generation++;
  session = { base, undo: undoManager.snapshot(), restart: null, kind: null, mark: { nodes: base.nodes, play: base.play, spec: null } };
  setSceneDraftActive(true);
  remark(session);
}

/** A kind that builds as it opens (Splat, Time Cube): what is there now is where its changes start from. */
export function markSceneDraft(): void {
  if (session) remark(session);
}

/** Whether a session is open. */
export const sceneDraftOpen = (): boolean => session !== null;

/** Whether the open window has changes of yours: the graph or the builder's settings moved since it opened. */
export function sceneDraftChanged(): boolean {
  const s = session;
  if (!s) return false;
  const st = useNodeGraphStore.getState();
  if (!sameNodes(st.nodes, s.mark.nodes) || st.play !== s.mark.play) return true;
  const kind = openSceneKind();
  return kind !== null && kind === s.kind && specKey(kind) !== s.mark.spec;
}

/** The graph as it was before the session (the kind page counts its nodes for "Clear the graph first?"). */
export const sceneDraftBase = (): GraphNode[] | null => session?.base.nodes ?? null;

function putBack(b: Kept, undo: UndoSnapshot): void {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  useNodeGraphStore.setState({
    nodes: b.nodes, looseGroups: b.looseGroups, play: b.play, datasets: b.datasets, graphDirty: b.graphDirty,
    selectedNodeId: b.selectedNodeId, selectedNodeIds: b.selectedNodeIds,
  });
  undoManager.restore(undo);
  useNodeGraphStore.getState().compile();
}

/** "Start over" took a scene away on the kind page: back from the next kind comes to the graph without it. */
export function markSceneDraftRestart(): void {
  if (session) session.restart = { kept: keptNow(), undo: undoManager.snapshot() };
}

/** Back to the kind page: the graph and the undo stacks as they were before the session (or its Start over), which stays open. */
export function resetSceneDraft(): void {
  const s = session;
  if (!s) return;
  generation++;
  const to = s.restart ?? { kept: s.base, undo: s.undo };
  const st = useNodeGraphStore.getState();
  if (st.nodes !== to.kept.nodes || st.play !== to.kept.play || undoManager.top() !== to.undo.history[to.undo.history.length - 1]) putBack(to.kept, to.undo);
  remark(s);
}

/** Closed without Done: the graph and the undo stacks exactly as they were, and the session ends. */
export function discardSceneDraft(): void {
  const s = session;
  if (!s) return;
  putBack(s.base, s.undo);
  session = null;
  setSceneDraftActive(false);
}

/** Forget the session without touching the graph (tests, and a graph loaded over it). */
export function forgetSceneDraft(): void {
  session = null;
  setSceneDraftActive(false);
}

/**
 * Done: the draft is the graph now, as one undo step (none when nothing changed). False when there was no session (or
 * it is being discarded).
 */
export function commitSceneDraft(): boolean {
  const s = session;
  if (!s || discarding > 0) return false;
  session = null;
  const now = useNodeGraphStore.getState();
  undoManager.restore(s.undo);
  const nodesChanged = !sameNodes(now.nodes, s.base.nodes);
  const playChanged = now.play !== s.base.play;
  const kind = s.kind ?? openSceneKind();
  if (nodesChanged || playChanged) undoManager.push(s.base.nodes, { label: `Scene builder: ${kind ? TITLES[kind] : 'a scene'}` }, playChanged ? s.base.play : undefined);
  setSceneDraftActive(false);
  // What saves the graph waited through the session: show it the graph it has now.
  if (nodesChanged) useNodeGraphStore.setState({ nodes: now.nodes.slice() });
  return true;
}

/** Whether a close is part of a discard (the builders' own close prompts stay quiet then). */
export const sceneDraftDiscarding = (): boolean => discarding > 0;

/** Run `close` as part of a discard. */
export function discardingWhile(close: () => void): void {
  discarding++;
  try { close(); } finally { discarding--; }
}

/** "Discard this scene?": true for Discard. */
export async function confirmDiscardScene(): Promise<boolean> {
  const choice = await askChoice('Discard this scene?', [
    { id: 'keep', label: 'Keep editing', variant: 'ghost' },
    { id: 'discard', label: 'Discard', variant: 'danger' },
  ], { message: 'Nothing you did here is in the graph yet: Done puts it there. Discard closes the builder and leaves your graph as it was.', cancel: false });
  return choice === 'discard';
}

/**
 * A Scene builder window's × or Esc (StudioShell): outside a session just `close`. In one, changes made here ask
 * first; then the window closes and the graph goes back to how it was. True when it closed.
 */
export async function closeSceneWindow(close: () => void): Promise<boolean> {
  if (closeHook && session && (await closeHook(close))) return true;
  // A window over another kind's (the Warp Builder on the 2D builder's blocks): closing it goes back to that one.
  if (!session || !sceneDraftActive() || openKindCount() > 1) { close(); return true; }
  if (sceneDraftChanged() && !(await confirmDiscardScene())) return false;
  discardingWhile(close);
  discardSceneDraft();
  return true;
}
