/**
 * Dragging a node out of the browser onto the graph (nodeDrop.ts): where it lands at any pan and
 * zoom, inside an open group, into a wire (one undo step), and the ways a drag is cancelled.
 * The window is a bare EventTarget here: the gesture only needs its pointer, key and click events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }, key: () => null, length: 0, clear: () => store.clear(),
  });
});

import type { GraphNode } from '../../../types/nodeGraph';
import { getActiveNodes, undoManager, useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { closeRecipeOffer } from '../../../store/recipeOfferStore';
import {
  DRAG_SLOP, GRAB, LONG_PRESS_MS, beginNodeDrag, cancelNodeDrag, dropPosition, edgeInfoFromKey, edgeKeyOf, hitFromStack,
  pickInsertSockets, placeDropped, registerDropTarget, typeFitsWire, useNodeDrag, type DropPayload, type DropTarget,
} from '../nodeDrop';

const S = () => useNodeGraphStore.getState();

// ── a bare window and document ────────────────────────────────────────────────
let win: EventTarget;
let stack: Element[] = [];
const fakeEl = (attrs: Record<string, string> = {}, inside?: object): Element => ({
  getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs, inside,
}) as unknown as Element;

beforeEach(() => {
  win = new EventTarget();
  stack = [];
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { body: { style: {} as Record<string, string> }, elementsFromPoint: () => stack });
  vi.stubGlobal('navigator', {});
  vi.useFakeTimers();
  useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
  S().replaceGraph([{ id: 'out', type: 'output', position: { x: 1600, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} }]);
  closeRecipeOffer();
});
afterEach(() => {
  cancelNodeDrag();
  useNodeDrag.setState({ drag: null });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fire = (type: string, extra: Record<string, unknown>) => {
  const ev = Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, pointerType: 'mouse', buttons: 1, ...extra });
  win.dispatchEvent(ev);
  return ev;
};
const press = (x: number, y: number, payload: DropPayload, pointerType = 'mouse') =>
  beginNodeDrag({ button: 0, isPrimary: true, pointerId: 1, pointerType, clientX: x, clientY: y }, payload);

/** A canvas at (left, top) on screen, panned and zoomed like NodeGraph's: world = (screen - left - pan) / zoom. */
const canvas = (over: { pan?: { x: number; y: number }; zoom?: number; left?: number; top?: number; locked?: boolean } = {}) => {
  const { pan = { x: 0, y: 0 }, zoom = 1, left = 300, top = 40, locked = false } = over;
  const el = { contains: (e: Element) => (e as unknown as { inside?: object }).inside === el } as unknown as HTMLElement;
  const t: DropTarget = {
    el, blocked: () => locked, zoom: () => zoom,
    toWorld: (sx, sy) => ({ x: (sx - left - pan.x) / zoom, y: (sy - top - pan.y) / zoom }),
    edgeInfo: key => edgeInfoFromKey(getActiveNodes(S().nodes, S().activeGroupPath) ?? S().nodes, key),
  };
  const off = registerDropTarget(t);
  return { el, off, over: (attrs: Record<string, string> = {}) => fakeEl(attrs, el) };
};

const addPayload = (type: string, label = type): DropPayload => ({ label, type, place: pos => S().addNode(type, pos) });
const nodeById = (id: string) => (getActiveNodes(S().nodes, S().activeGroupPath) ?? S().nodes).find(n => n.id === id)!;

/** Drag from (60, 200) (the sidebar) to (x, y) and release. */
const dragTo = (payload: DropPayload, x: number, y: number) => {
  press(60, 200, payload);
  fire('pointermove', { clientX: x, clientY: y });
  fire('pointerup', { clientX: x, clientY: y });
};

describe('where a dropped node lands', () => {
  it('puts the pointer on the header, whatever the zoom and pan', () => {
    for (const [zoom, pan] of [[1, { x: 0, y: 0 }], [0.25, { x: -120, y: 80 }], [2, { x: -900, y: -400 }], [0.15, { x: 50, y: 50 }]] as const) {
      const c = canvas({ zoom, pan });
      stack = [c.over()];
      const before = new Set(S().nodes.map(n => n.id));
      dragTo(addPayload('time'), 840, 460);
      const added = S().nodes.find(n => !before.has(n.id))!;
      const world = { x: (840 - 300 - pan.x) / zoom, y: (460 - 40 - pan.y) / zoom };
      expect(added.position).toEqual({ x: Math.round(world.x - GRAB.x), y: Math.round(world.y - GRAB.y) });
      c.off();
    }
  });

  it('shows the same position on screen as it uses: ghost corner = card corner', () => {
    const zoom = 0.5, pan = { x: 30, y: -20 };
    const world = { x: (700 - 300 - pan.x) / zoom, y: (300 - 40 - pan.y) / zoom };
    const p = dropPosition(world);
    // the card's top-left, back on screen, is the ghost's top-left: pointer - GRAB * zoom
    expect(p.x * zoom + pan.x + 300).toBeCloseTo(700 - GRAB.x * zoom, 0);
    expect(p.y * zoom + pan.y + 40).toBeCloseTo(300 - GRAB.y * zoom, 0);
  });

  it('adds through the ordinary add: undo labels it, one step', () => {
    const c = canvas();
    stack = [c.over()];
    const steps = undoManager.canUndo;
    dragTo(addPayload('time', 'Time'), 600, 300);
    expect(undoManager.canUndo).toBe(steps + 1);
    expect(undoManager.top()?.label).toMatch(/Added/);
    S().undo();
    expect(S().nodes.map(n => n.type)).toEqual(['output']);
  });

  it('adds inside the open group', () => {
    const g = S().addNode('group', { x: 0, y: 300 })!;
    S().enterGroup(g);
    const c = canvas({ zoom: 0.7, pan: { x: 20, y: 20 } });
    stack = [c.over()];
    dragTo(addPayload('time'), 700, 400);
    const inside = getActiveNodes(S().nodes, S().activeGroupPath)!;
    expect(inside.some(n => n.type === 'time')).toBe(true);
    expect(S().nodes.some(n => n.type === 'time')).toBe(false); // not on the top level
  });
});

describe('cancelling', () => {
  it('releasing over the sidebar (outside the canvas) adds nothing', () => {
    const c = canvas();
    stack = [fakeEl()]; // not inside the canvas
    dragTo(addPayload('time'), 100, 300);
    expect(S().nodes).toHaveLength(1);
    expect(useNodeDrag.getState().drag).toBeNull();
    c.off();
  });

  it('Esc mid-drag cancels, and the Esc is swallowed', () => {
    const c = canvas();
    stack = [c.over()];
    press(60, 200, addPayload('time'));
    fire('pointermove', { clientX: 700, clientY: 300 });
    expect(useNodeDrag.getState().drag?.overCanvas).toBe(true);
    const esc = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    win.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(useNodeDrag.getState().drag).toBeNull();
    fire('pointerup', { clientX: 700, clientY: 300 });
    expect(S().nodes).toHaveLength(1);
    c.off();
  });

  it('pointercancel cancels', () => {
    const c = canvas();
    stack = [c.over()];
    press(60, 200, addPayload('time'));
    fire('pointermove', { clientX: 700, clientY: 300 });
    fire('pointercancel', {});
    fire('pointerup', { clientX: 700, clientY: 300 });
    expect(S().nodes).toHaveLength(1);
    c.off();
  });

  it('a press that barely moves is a click, not a drag', () => {
    const c = canvas();
    stack = [c.over()];
    press(60, 200, addPayload('time'));
    fire('pointermove', { clientX: 60 + DRAG_SLOP - 1, clientY: 200 });
    expect(useNodeDrag.getState().drag).toBeNull();
    fire('pointerup', { clientX: 60, clientY: 200 });
    expect(S().nodes).toHaveLength(1);
    c.off();
  });

  it('a locked graph takes no drops', () => {
    const c = canvas({ locked: true });
    stack = [c.over()];
    press(60, 200, addPayload('time'));
    fire('pointermove', { clientX: 700, clientY: 300 });
    expect(useNodeDrag.getState().drag?.blocked).toBe(true);
    fire('pointerup', { clientX: 700, clientY: 300 });
    expect(S().nodes).toHaveLength(1);
    c.off();
  });

  it('a button released outside the window ends the drag without a drop', () => {
    const c = canvas();
    stack = [c.over()];
    press(60, 200, addPayload('time'));
    fire('pointermove', { clientX: 700, clientY: 300 });
    fire('pointermove', { clientX: 710, clientY: 300, buttons: 0 });
    expect(useNodeDrag.getState().drag).toBeNull();
    expect(S().nodes).toHaveLength(1);
    c.off();
  });

  it('ignores a right-button press', () => {
    const c = canvas();
    stack = [c.over()];
    beginNodeDrag({ button: 2, isPrimary: true, pointerId: 1, pointerType: 'mouse', clientX: 60, clientY: 200 }, addPayload('time'));
    fire('pointermove', { clientX: 700, clientY: 300 });
    expect(useNodeDrag.getState().drag).toBeNull();
    c.off();
  });
});

describe('touch', () => {
  it('picks a row up after a still long press, then drops on release', () => {
    const c = canvas();
    stack = [c.over()];
    press(60, 200, addPayload('time'), 'touch');
    expect(useNodeDrag.getState().drag).toBeNull();
    vi.advanceTimersByTime(LONG_PRESS_MS + 5);
    expect(useNodeDrag.getState().drag).not.toBeNull();
    fire('pointermove', { clientX: 700, clientY: 300, pointerType: 'touch', buttons: 1 });
    fire('pointerup', { clientX: 700, clientY: 300, pointerType: 'touch' });
    expect(S().nodes.some(n => n.type === 'time')).toBe(true);
    c.off();
  });

  it('moving before the long press is a scroll, not a drag', () => {
    const c = canvas();
    stack = [c.over()];
    press(60, 200, addPayload('time'), 'touch');
    fire('pointermove', { clientX: 60, clientY: 260, pointerType: 'touch' });
    vi.advanceTimersByTime(LONG_PRESS_MS + 5);
    expect(useNodeDrag.getState().drag).toBeNull();
    fire('pointerup', { clientX: 60, clientY: 260, pointerType: 'touch' });
    expect(S().nodes).toHaveLength(1);
    c.off();
  });
});

describe('dropping onto a wire', () => {
  /** time → floatToVec3 → output.color; returns the keys of the first wire. */
  const wired = () => {
    const t = S().addNode('time', { x: 0, y: 0 })!;
    const f = S().addNode('floatToVec3', { x: 500, y: 0 })!;
    S().connectNodes(t, Object.keys(nodeById(t).outputs)[0], f, Object.keys(nodeById(f).inputs)[0]);
    S().connectNodes(f, Object.keys(nodeById(f).outputs)[0], 'out', 'color');
    const inKey = Object.keys(nodeById(f).inputs)[0];
    const key = edgeKeyOf(t, Object.keys(nodeById(t).outputs)[0], f, inKey);
    return { t, f, key, inKey };
  };

  it('finds the wire under the pointer (a card in front hides it) and names its types', () => {
    const { key, f } = wired();
    const c = canvas();
    expect(hitFromStack(getTarget(c), [c.over({ 'data-edge': key })])).toEqual({ overCanvas: true, edgeKey: key });
    expect(hitFromStack(getTarget(c), [c.over({ 'data-node-id': f }), c.over({ 'data-edge': key })]).edgeKey).toBeNull();
    expect(hitFromStack(getTarget(c), [fakeEl()])).toEqual({ overCanvas: false, edgeKey: null });
    expect(edgeInfoFromKey(S().nodes, key)).toMatchObject({ fromType: 'float', toType: 'float', toNodeId: f });
    c.off();
  });

  it('lights the wire on hover, and the drop wires the node in as ONE undo step', () => {
    const { t, f, key, inKey } = wired();
    const c = canvas();
    stack = [c.over({ 'data-edge': key })];
    const steps = undoManager.canUndo;
    press(60, 200, addPayload('sin', 'Sin'));
    fire('pointermove', { clientX: 700, clientY: 300 });
    expect(useNodeDrag.getState().drag?.edge).toBe(key);
    fire('pointerup', { clientX: 700, clientY: 300 });

    const sin = S().nodes.find(n => n.type === 'sin')!;
    const into = Object.values(sin.inputs).find(i => i.connection)!;
    expect(into.connection?.nodeId).toBe(t);
    expect(nodeById(f).inputs[inKey].connection?.nodeId).toBe(sin.id);
    expect(undoManager.canUndo).toBe(steps + 1);
    expect(undoManager.top()?.label).toBe('Inserted Sin into a wire');

    S().undo();
    expect(S().nodes.some(n => n.type === 'sin')).toBe(false);
    expect(nodeById(f).inputs[inKey].connection?.nodeId).toBe(t);
    c.off();
  });

  it('a node that does not fit the wire is added where it lands, the wire left alone', () => {
    const { t, f, key, inKey } = wired();
    const c = canvas();
    stack = [c.over({ 'data-edge': key })];
    press(60, 200, addPayload('output', 'Output'));
    fire('pointermove', { clientX: 700, clientY: 300 });
    expect(useNodeDrag.getState().drag).toMatchObject({ edge: null, wireMisfit: true });
    fire('pointerup', { clientX: 700, clientY: 300 });
    expect(nodeById(f).inputs[inKey].connection?.nodeId).toBe(t);
    c.off();
  });

  it('placeDropped with a stale wire (it went away) just adds', () => {
    const { key } = wired();
    const info = edgeInfoFromKey(S().nodes, key)!;
    S().disconnectInput(info.toNodeId, info.toInputKey);
    const r = placeDropped(addPayload('sin'), { x: 0, y: 0 }, info);
    expect(r.inserted).toBe(false);
    expect(r.id).toBeTruthy();
  });

  it('goes into a wire inside an open group', () => {
    const g = S().addNode('group', { x: 0, y: 300 })!;
    S().enterGroup(g);
    const a = S().addNode('time', { x: 0, y: 0 })!;
    const b = S().addNode('floatToVec3', { x: 500, y: 0 })!;
    const lvl = () => getActiveNodes(S().nodes, S().activeGroupPath)!;
    const aOut = Object.keys(lvl().find(n => n.id === a)!.outputs)[0];
    const bIn = Object.keys(lvl().find(n => n.id === b)!.inputs)[0];
    S().connectNodes(a, aOut, b, bIn);
    const info = edgeInfoFromKey(lvl(), edgeKeyOf(a, aOut, b, bIn))!;
    const r = placeDropped(addPayload('sin', 'Sin'), { x: 300, y: 100 }, info);
    expect(r.inserted).toBe(true);
    expect(lvl().find(n => n.id === b)!.inputs[bIn].connection?.nodeId).toBe(r.id);
    expect(S().nodes.some(n => n.type === 'sin')).toBe(false);
  });
});

describe('what fits a wire', () => {
  it('picks exact socket types first, then promotable ones', () => {
    expect(pickInsertSockets({ a: { type: 'vec2' }, b: { type: 'float' } }, { o: { type: 'vec3' }, p: { type: 'float' } }, 'float', 'float')).toEqual({ inKey: 'b', outKey: 'p' });
    expect(pickInsertSockets({ a: { type: 'vec2' } }, { o: { type: 'vec3' } }, 'float', 'vec3')).toEqual({ inKey: 'a', outKey: 'o' });
    expect(pickInsertSockets({ a: { type: 'texture' } }, { o: { type: 'float' } }, 'float', 'float')).toBeNull();
  });
  it('checks a type before it exists', () => {
    const e = { fromNodeId: 'a', fromOutputKey: 'x', toNodeId: 'b', toInputKey: 'y', fromType: 'float', toType: 'float' };
    expect(typeFitsWire('sin', e)).toBe(true);
    expect(typeFitsWire('output', e)).toBe(false);
    expect(typeFitsWire('customFn', e)).toBe(true);
    expect(typeFitsWire(undefined, e)).toBe(false); // a preset group: no wire insert
  });
});

describe('undoManager.collapseSince', () => {
  it('folds the steps after a mark into the first of them', () => {
    const nodes: GraphNode[] = [];
    undoManager.push(nodes, { label: 'before' });
    const mark = undoManager.top()!.id;
    undoManager.push(nodes, { label: 'a' });
    undoManager.push(nodes, { label: 'b' });
    undoManager.push(nodes, { label: 'c' });
    const n = undoManager.canUndo;
    undoManager.collapseSince(mark, { label: 'one' });
    expect(undoManager.canUndo).toBe(n - 2);
    expect(undoManager.top()?.label).toBe('one');
    expect(undoManager.done()[undoManager.canUndo - 2]?.label).toBe('before');
  });
});

function getTarget(c: ReturnType<typeof canvas>): DropTarget {
  return { el: c.el, blocked: () => false, toWorld: () => ({ x: 0, y: 0 }), zoom: () => 1, edgeInfo: () => null };
}
