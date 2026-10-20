/**
 * actions.ts — Texture Lab joined to the graph (docs/texture-lab.md), as the Time Cube builder is:
 *
 *   - opening on a new build builds it at once (its picture is the main preview's), in a Scene builder session
 *     (builders/sceneDraft.ts): nothing reaches your graph until Done;
 *   - each change after that is synced quietly, once a frame at most: a setting or an Amount only writes params and
 *     their uniforms (no recompile); adding, moving or muting… rewires, keeping each node's id by role;
 *   - a change that would add a pass past the lock (10) is refused before it is made, with the same toast as the graph's;
 *   - the preview (before / after, a block on its own) is built while the window is open and taken out on Done, which
 *     leaves the stack as plain nodes, one undo step.
 */
import type { GraphNode } from '../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../store/useNodeGraphStore';
import { intoView } from '../components/NodeGraph/spawnPoint';
import { finishBuilder } from '../builders/finish';
import { beginSceneDraft, markSceneDraft } from '../builders/sceneDraft';
import { paramDiff } from '../splatBuilder/apply';
import { writeParams } from '../splatBuilder/actions';
import { HARD_MAX_PASSES, MAX_PASSES, passBudget, passLockMessage } from '../compiler/passBudget';
import { toast, useToastStore } from '../components/ui/toastStore';
import { requestShowPasses } from '../store/passLock';
import { useTextureLab } from './store';
import { applyTextureLab, findTxBuild, labOfBuild, specOfBuild, txBuildIds } from './apply';
import { BLOCKS } from './blocks';
import { newBlock, type TextureLabSpec } from './spec';
import { withPreset } from './presets';

let session: { spec: string } | null = null;
let lastSynced: TextureLabSpec | null = null;

const startSession = () => { session = { spec: JSON.stringify(useTextureLab.getState().spec) }; };

/** What a new Texture Lab opens on: the Room and cat photo as a relief. */
export const firstSpec = (): TextureLabSpec => withPreset({ v: 1, source: { kind: 'room' }, blocks: [] }, 'relief');

/** Open Texture Lab on a new build, built into the graph at once. */
export function openNewTextureLab(at?: { x: number; y: number }, spec: TextureLabSpec = firstSpec()): string | null {
  beginSceneDraft();
  useTextureLab.getState().openWith(spec, { at: at ?? null });
  useTextureLab.getState().setSplit(0.5);
  const id = syncTextureLab({ first: true });
  markSceneDraft();
  startSession();
  return id;
}

/** Open Texture Lab on the build `nodeId` belongs to, as it is now. False when it isn't one. */
export function editTextureLabInBuilder(nodeId: string): boolean {
  beginSceneDraft();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const id = labOfBuild(nodes, nodeId);
  const spec = id ? specOfBuild(nodes, id) : null;
  if (!id || !spec) return false;
  useTextureLab.getState().openWith(spec, { targetId: id });
  // Reopened: the picture as you left it (the divider is a click away).
  useTextureLab.getState().setSplit(null);
  lastSynced = null;
  syncTextureLab();
  markSceneDraft();
  startSession();
  return true;
}

/** The source node of the Texture Lab build a top-level node belongs to, or null. */
export const builderLabOf = (nodeId: string): string | null => labOfBuild(useNodeGraphStore.getState().nodes, nodeId);

const ids = () => useNodeGraphStore.getState().newNodeId();

/** The graph with `spec` built in, as the open window would build it (with its preview unless `final`). */
function applied(spec: TextureLabSpec, nodes: GraphNode[], final = false) {
  const tb = useTextureLab.getState();
  const target = tb.targetId && findTxBuild(nodes, tb.targetId) ? tb.targetId : null;
  return applyTextureLab(nodes, spec, {
    nextId: ids, sourceId: target, at: tb.at ?? undefined,
    preview: final ? undefined : { split: tb.split, upTo: tb.upTo },
  });
}

/**
 * Build the window's stack into the graph: the first time as an undo step of its own, afterwards quietly (params only
 * when nothing is rewired). `final`: without the preview (Done). Returns the source node's id.
 */
export function syncTextureLab(o: { first?: boolean; final?: boolean } = {}): string | null {
  const tb = useTextureLab.getState();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const target = tb.targetId && findTxBuild(nodes, tb.targetId) ? tb.targetId : null;
  const result = applied(tb.spec, nodes, o.final);
  if (!target) {
    const placed = intoView(nodes, result.nodes, tb.at ? 'ifOutOfView' : 'centre');
    if (o.first) useNodeGraphStore.getState().setNodesRewritten(placed, 'Texture Lab: built a texture stack');
    else undoManager.quietly(() => useNodeGraphStore.getState().setNodesRewritten(placed));
  } else {
    const diff = paramDiff(nodes, result.nodes);
    if (!diff) undoManager.quietly(() => useNodeGraphStore.getState().setNodesRewritten(result.nodes));
    else if (diff.length) writeParams(diff);
  }
  lastSynced = useTextureLab.getState().spec;
  if (tb.targetId !== result.sourceId) useTextureLab.getState().setTarget(result.sourceId);
  return result.sourceId;
}

/** Whether the spec in the window is built yet. */
export const labInSync = () => lastSynced === useTextureLab.getState().spec;

// ── The lock ─────────────────────────────────────────────────────────────────

/** Passes the graph would use with `spec` built in (the preview never adds one). */
export function passesWith(spec: TextureLabSpec): number {
  return passBudget(applied(spec, useNodeGraphStore.getState().nodes, true).nodes).used;
}

/** Passes the graph uses now. */
export const passesNow = (): number => passBudget(useNodeGraphStore.getState().nodes).used;

function refuse(used: number): void {
  const title = passLockMessage(used);
  if (useToastStore.getState().toasts.some(t => t.title === title)) return;
  toast.warning(title, {
    message: 'Remove or mute a block that uses passes, or pick one that needs none. Passes 9 and 10 already run at lower quality in the preview.',
    action: { label: 'Show passes', onClick: requestShowPasses },
  });
}

/**
 * A change that can add passes (adding, moving, duplicating a block, another source): refused, with the lock's toast,
 * when it would take the graph past HARD_MAX_PASSES and add passes. True when made.
 */
export function editLab(fn: (d: TextureLabSpec) => void, o: { structural?: boolean; coalesce?: string } = {}): boolean {
  const tb = useTextureLab.getState();
  if (o.structural) {
    const next = structuredClone(tb.spec);
    fn(next);
    const used = passesWith(next);
    if (used > HARD_MAX_PASSES && used > passesNow()) { refuse(used); return false; }
  }
  tb.edit(fn, o.coalesce);
  return true;
}

/** What adding each block (after `after`, or at the end) would cost, and whether the lock refuses it. */
export interface AddCost { type: string; adds: number; total: number; grace: boolean; locked: boolean }

export function addCosts(after: string | null): Map<string, AddCost> {
  const spec = useTextureLab.getState().spec;
  const now = passesNow();
  const out = new Map<string, AddCost>();
  for (const def of BLOCKS) {
    const next = structuredClone(spec);
    const at = after ? next.blocks.findIndex(b => b.id === after) + 1 : next.blocks.length;
    next.blocks.splice(at <= 0 ? next.blocks.length : at, 0, newBlock(next, def.type));
    let total = now;
    try { total = passesWith(next); } catch { total = now; }
    out.set(def.type, { type: def.type, adds: Math.max(0, total - now), total, grace: total > MAX_PASSES, locked: total > HARD_MAX_PASSES && total > now });
  }
  return out;
}

/** Add a block after `after` (or at the end) and show its card. False when the lock refused it. */
export function addBlock(type: string, after: string | null): boolean {
  let id = '';
  const ok = editLab(d => {
    const b = newBlock(d, type);
    id = b.id;
    const at = after ? d.blocks.findIndex(x => x.id === after) + 1 : d.blocks.length;
    d.blocks.splice(at <= 0 ? d.blocks.length : at, 0, b);
  }, { structural: true });
  if (ok) useTextureLab.getState().select(id);
  return ok;
}

/** Move a block one place up (−1) or down (1). */
export function moveBlock(id: string, by: -1 | 1): boolean {
  return editLab(d => {
    const i = d.blocks.findIndex(b => b.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= d.blocks.length) return;
    const [b] = d.blocks.splice(i, 1);
    d.blocks.splice(j, 0, b);
  }, { structural: true });
}

/** Move a block to index `to` (a drag in the stack). */
export function moveBlockTo(id: string, to: number): boolean {
  return editLab(d => {
    const i = d.blocks.findIndex(b => b.id === id);
    if (i < 0) return;
    const [b] = d.blocks.splice(i, 1);
    d.blocks.splice(Math.max(0, Math.min(d.blocks.length, to)), 0, b);
  }, { structural: true });
}

export function removeBlock(id: string): void {
  const tb = useTextureLab.getState();
  const i = tb.spec.blocks.findIndex(b => b.id === id);
  tb.edit(d => { d.blocks = d.blocks.filter(b => b.id !== id); });
  if (tb.upTo === id) tb.setUpTo(null);
  if (tb.selected === id) tb.select(useTextureLab.getState().spec.blocks[Math.max(0, i - 1)]?.id ?? 'source');
}

export function duplicateBlock(id: string): boolean {
  let made = '';
  const ok = editLab(d => {
    const i = d.blocks.findIndex(b => b.id === id);
    if (i < 0) return;
    const copy = { ...structuredClone(d.blocks[i]), id: newBlock(d, d.blocks[i].type).id };
    made = copy.id;
    d.blocks.splice(i + 1, 0, copy);
  }, { structural: true });
  if (ok && made) useTextureLab.getState().select(made);
  return ok;
}

// ── Closing ──────────────────────────────────────────────────────────────────

/** Close the window (the Scene builder session decides what the graph keeps). */
export function closeTextureLab(): void {
  const tb = useTextureLab.getState();
  if (tb.open && lastSynced !== tb.spec) syncTextureLab();
  session = null;
  tb.close();
}

/** Done: build the stack without the preview, close, and frame it on the graph. */
export function finishTextureLab(): void {
  const tb = useTextureLab.getState();
  if (tb.open) syncTextureLab({ final: true });
  const id = useTextureLab.getState().targetId;
  const keep = txBuildIds(useNodeGraphStore.getState().nodes, id);
  session = null;
  finishBuilder(() => useTextureLab.getState().close(), keep);
}

/** Open as nodes: Done, with the last block selected. */
export function openTextureLabAsNodes(): void {
  const tb = useTextureLab.getState();
  const last = tb.spec.blocks[tb.spec.blocks.length - 1];
  finishTextureLab();
  const id = useTextureLab.getState().targetId;
  const b = id ? findTxBuild(useNodeGraphStore.getState().nodes, id) : null;
  const show = (last && b?.byRole.get(`${last.id}:main`)) ?? b?.source;
  if (show && useNodeGraphStore.getState().nodes.some(nd => nd.id === show.id)) useNodeGraphStore.getState().focusNode(show.id);
}

/** Whether the window has changes since it opened (the builders' "changed" checks). */
export const labChanged = () => !!session && session.spec !== JSON.stringify(useTextureLab.getState().spec);
