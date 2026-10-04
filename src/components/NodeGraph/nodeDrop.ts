/**
 * nodeDrop — drag a node out of the browser (or search results) and drop it on the graph.
 *
 * Pointer events, not HTML5 drag-and-drop: the desktop app's webviews intercept native drags (file
 * drops), and touch and pen have no HTML5 drag at all. A press on a row starts a gesture; past a few
 * pixels (mouse and pen) or after a long press (touch) a ghost follows the pointer; over the graph
 * the ghost shows the card where it will land, and over a wire the wire lights up and the node goes
 * into it. Release over the graph drops, release anywhere else or Esc cancels.
 *
 * The drop goes through the same add as a double-click (the payload's `place`), so recipes, the 3D
 * scene, the Agents question and the rest still happen. A drop into a wire is one undo step.
 *
 * This file is the logic; the ghost is NodeDragGhost, the target is registered by NodeGraph.
 */
import { create } from 'zustand';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { NODE_ALIASES, getNodeDefinition, getNodeDefinitionFor } from '../../nodes/definitions';
import { getActiveNodes, undoManager, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { closeRecipeOffer } from '../../store/recipeOfferStore';
import { typesCompatible } from '../../lib/typesCompatible';
import type { GraphNode } from '../../types/nodeGraph';
import type { EdgeInfo } from './WireLayer';

export interface Pt { x: number; y: number }

/** Where the pointer sits on the dropped card, in world units: middle of the header, so a card lands under the pointer. */
export const GRAB: Pt = { x: 180, y: 14 };
/** A typical card, for the ghost outline (world units). */
export const GHOST_CARD = { w: 360, h: 120 };
/** Mouse and pen: pixels moved before a press becomes a drag. */
export const DRAG_SLOP = 5;
/** Touch: how long a still press takes to pick a row up, and how far it may wander meanwhile. */
export const LONG_PRESS_MS = 380;
export const LONG_PRESS_SLOP = 9;

/** What a row drags: its name, the node type (for the wire-fit check) and how to add it at a position. */
export interface DropPayload {
  label: string;
  /** The node type, when the drop adds one node of it (lets a wire be checked before the drop). */
  type?: string;
  /** Add it with its top-left here (the store's addNode, or a preset's instantiate). The new node's id, if one was made. */
  place: (position: Pt) => string | null | undefined;
}

/** What the graph canvas offers to a drag. */
export interface DropTarget {
  el: HTMLElement | null;
  /** The graph is read-only (a Play-locked view). */
  blocked: () => boolean;
  toWorld: (sx: number, sy: number) => Pt;
  zoom: () => number;
  /** The wire a `data-edge` key names, as it is now. */
  edgeInfo: (key: string) => EdgeInfo | null;
}

let target: DropTarget | null = null;
export function registerDropTarget(t: DropTarget): () => void {
  target = t;
  return () => { if (target === t) target = null; };
}
export const getDropTarget = () => target;

// ── What the ghost and the wires show ─────────────────────────────────────────
export interface DragView {
  label: string;
  x: number; y: number;
  /** Over the graph. */
  overCanvas: boolean;
  /** Over the graph but it takes no drops (locked). */
  blocked: boolean;
  /** The `data-edge` key of the wire under the pointer that the node would go into. */
  edge: string | null;
  /** Over a wire the node does not fit. */
  wireMisfit: boolean;
  zoom: number;
}
export const useNodeDrag = create<{ drag: DragView | null }>(() => ({ drag: null }));

// ── Wires ─────────────────────────────────────────────────────────────────────
/** Same format NodeGraph uses for spotlightEdges. */
export const edgeKeyOf = (fromNodeId: string, fromOutputKey: string, toNodeId: string, toInputKey: string) =>
  `${fromNodeId}:${fromOutputKey}→${toNodeId}:${toInputKey}`;

/** The wire a key names, among `nodes` (the level on screen), with its socket types. */
export function edgeInfoFromKey(nodes: GraphNode[], key: string): EdgeInfo | null {
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const node of nodes) {
    for (const [inputKey, input] of Object.entries(node.inputs)) {
      const c = input.connection;
      if (!c || edgeKeyOf(c.nodeId, c.outputKey, node.id, inputKey) !== key) continue;
      const src = byId.get(c.nodeId);
      if (!src) return null;
      const fromType = src.outputs[c.outputKey]?.type ?? getNodeDefinitionFor(src)?.outputs[c.outputKey]?.type ?? 'float';
      return { fromNodeId: c.nodeId, fromOutputKey: c.outputKey, toNodeId: node.id, toInputKey: inputKey, fromType, toType: input.type as string };
    }
  }
  return null;
}

type Sockets = Record<string, { type: string }>;

/**
 * The input and output a node would be wired by when it goes into a wire from `fromType` to
 * `toType`: the first of each that matches exactly, else the first the graph can promote between.
 */
export function pickInsertSockets(inputs: Sockets, outputs: Sockets, fromType: string, toType: string): { inKey: string; outKey: string } | null {
  const ins = Object.keys(inputs), outs = Object.keys(outputs);
  const inKey = ins.find(k => inputs[k].type === fromType) ?? ins.find(k => typesCompatible(fromType, inputs[k].type));
  const outKey = outs.find(k => outputs[k].type === toType) ?? outs.find(k => typesCompatible(outputs[k].type, toType));
  return inKey && outKey ? { inKey, outKey } : null;
}

/** Expression blocks and custom functions get their sockets from their params, so a definition can't say. */
const DYNAMIC_SOCKET_TYPES = new Set(['exprNode', 'customFn']);

/** Could a node of `type` go into `edge`? (Checked on hover, before the node exists.) */
export function typeFitsWire(type: string | undefined, edge: EdgeInfo): boolean {
  if (!type) return false;
  if (DYNAMIC_SOCKET_TYPES.has(type)) return true;
  const def = getNodeDefinition(NODE_ALIASES[type]?.to ?? type);
  return !!def && pickInsertSockets(def.inputs, def.outputs, edge.fromType, edge.toType) !== null;
}

// ── The drop ──────────────────────────────────────────────────────────────────
/** The node position for a card dropped with the pointer at world point `world`: the pointer lands on its header. */
export function dropPosition(world: Pt): Pt {
  return { x: Math.round(world.x - GRAB.x), y: Math.round(world.y - GRAB.y) };
}

/**
 * Add the payload with the pointer at world point `world` (the level on screen: inside an open
 * group the store adds to the group), and, when `edge` is set and the node fits, wire it into that
 * wire. The add is the ordinary one; the wire-up folds into it as a single undo step.
 */
export function placeDropped(payload: DropPayload, world: Pt, edge: EdgeInfo | null): { id: string | null; inserted: boolean } {
  const mark = undoManager.top()?.id ?? 0;
  const before = useNodeGraphStore.getState();
  const had = new Set((getActiveNodes(before.nodes, before.activeGroupPath) ?? before.nodes).map(n => n.id));
  const id = payload.place(dropPosition(world)) ?? null;
  if (!id || !edge) return { id, inserted: false };

  const st = useNodeGraphStore.getState();
  const level = getActiveNodes(st.nodes, st.activeGroupPath) ?? st.nodes;
  // A node of its own on this level (not a group the add put it inside, or one already there).
  const node = had.has(id) ? undefined : level.find(n => n.id === id);
  const dest = level.find(n => n.id === edge.toNodeId);
  const stillThere = dest?.inputs[edge.toInputKey]?.connection?.nodeId === edge.fromNodeId;
  const pick = node && stillThere ? pickInsertSockets(node.inputs, node.outputs, edge.fromType, edge.toType) : null;
  if (!node || !pick) return { id, inserted: false };

  st.connectNodes(edge.fromNodeId, edge.fromOutputKey, id, pick.inKey);
  st.connectNodes(id, pick.outKey, edge.toNodeId, edge.toInputKey); // replaces the wire it sits on
  closeRecipeOffer(); // a node placed on a wire is already wired; no starter to offer
  undoManager.collapseSince(mark, { label: `Inserted ${payload.label} into a wire`, nodeIds: [id] });
  return { id, inserted: true };
}

// ── Hit-testing ───────────────────────────────────────────────────────────────
export interface Hit { overCanvas: boolean; edgeKey: string | null }

/** What the elements under the pointer (front to back) mean for a drop target. */
export function hitFromStack(t: DropTarget | null, stack: Element[]): Hit {
  const top = stack[0];
  if (!t || !top || !t.el?.contains(top)) return { overCanvas: false, edgeKey: null };
  // Only a wire the pointer is over before any card: a card on top of a wire hides it.
  for (const el of stack) {
    const key = el.getAttribute?.('data-edge');
    if (key) return { overCanvas: true, edgeKey: key };
    if (el.hasAttribute?.('data-node-id')) break;
  }
  return { overCanvas: true, edgeKey: null };
}

function elementsAt(x: number, y: number): Element[] {
  return typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
}

// ── The gesture ───────────────────────────────────────────────────────────────
let current: { cancel: () => void } | null = null;

/** Stop whatever drag is in flight (a new press, a closed browser). */
export function cancelNodeDrag(): void { current?.cancel(); }

type PressEvent = Pick<PointerEvent, 'button' | 'isPrimary' | 'pointerId' | 'pointerType' | 'clientX' | 'clientY'>;

/** A pointer-down on a row that can be dragged. Does nothing for a secondary button. */
export function beginNodeDrag(e: PressEvent, payload: DropPayload, onDrop?: () => void): void {
  if (e.button !== 0 || !e.isPrimary) return;
  cancelNodeDrag();
  const touch = e.pointerType === 'touch';
  const id = e.pointerId;
  const start = { x: e.clientX, y: e.clientY };
  let dragging = false;
  let last = { ...start };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let bodyUserSelect = '';

  const update = () => {
    const t = target;
    const hit = hitFromStack(t, elementsAt(last.x, last.y));
    const blocked = hit.overCanvas && !!t?.blocked();
    const info = hit.edgeKey && t && !blocked ? t.edgeInfo(hit.edgeKey) : null;
    const fits = !!info && typeFitsWire(payload.type, info);
    useNodeDrag.setState({ drag: {
      label: payload.label, x: last.x, y: last.y, overCanvas: hit.overCanvas, blocked,
      edge: fits ? hit.edgeKey : null, wireMisfit: !!info && !fits, zoom: t?.zoom() ?? 1,
    } });
    return { hit, blocked, info: fits ? info : null };
  };

  const begin = () => {
    if (dragging) return;
    dragging = true;
    bodyUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    if (touch) { try { navigator.vibrate?.(8); } catch { /* not everywhere */ } }
    update();
  };

  const stopClick = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };

  const finish = (drop: boolean) => {
    if (timer) { clearTimeout(timer); timer = null; }
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onCancel);
    window.removeEventListener('touchmove', onTouchMove, true);
    window.removeEventListener('contextmenu', onContext, true);
    if (current === handle) current = null;
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = bodyUserSelect;
    document.body.style.cursor = '';
    // The click that follows a release on the row it started from would toggle its preview.
    window.addEventListener('click', stopClick, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stopClick, true), 60);
    const res = drop ? update() : null;
    useNodeDrag.setState({ drag: null });
    if (res && res.hit.overCanvas && !res.blocked && target) {
      placeDropped(payload, target.toWorld(last.x, last.y), res.info);
      onDrop?.();
    }
  };

  function onMove(ev: PointerEvent) {
    if (ev.pointerId !== id) return;
    last = { x: ev.clientX, y: ev.clientY };
    if (!dragging) {
      const d = Math.hypot(last.x - start.x, last.y - start.y);
      if (touch) { if (d > LONG_PRESS_SLOP) finish(false); return; } // it is a scroll
      if (d < DRAG_SLOP) return;
      begin();
    }
    // A button released outside the window: the release never reached us.
    if (ev.pointerType === 'mouse' && ev.buttons === 0) { finish(false); return; }
    update();
  }
  function onUp(ev: PointerEvent) {
    if (ev.pointerId !== id) return;
    last = { x: ev.clientX, y: ev.clientY };
    finish(true);
  }
  function onCancel() { finish(false); }
  function onKey(ev: KeyboardEvent) {
    if (ev.key !== 'Escape') return;
    if (dragging) { ev.preventDefault(); ev.stopPropagation(); }
    finish(false);
  }
  // A picked-up touch must not scroll the list under the finger.
  function onTouchMove(ev: TouchEvent) { if (dragging && ev.cancelable) ev.preventDefault(); }
  function onContext(ev: Event) { if (touch) ev.preventDefault(); }
  const handle = { cancel: () => finish(false) };

  current = handle;
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onCancel);
  window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  window.addEventListener('contextmenu', onContext, true);
  if (touch) timer = setTimeout(() => { timer = null; begin(); }, LONG_PRESS_MS);
}

/** Props for a row that drags a node: spread them on the pressable element. `null` payload: not draggable. */
export function nodeDragProps(payload: DropPayload | null, onDrop?: () => void) {
  if (!payload) return {};
  return {
    onPointerDown: (e: ReactPointerEvent) => beginNodeDrag(e.nativeEvent, payload, onDrop),
  };
}

/** Styles that keep a press from selecting text or raising the touch callout. */
export const nodeDragStyle = {
  userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
} as const;
