/**
 * Agent Builder wave 3 (docs/agent-builder.md "Dragging the diagrams", "Wiring three ways", "Text
 * as a shape or a wall"): the drag-to-value maths of every diagram, the Sensors demo's walker
 * catching the trail, the stroke font (and the blocky one still loading), wiring from the graph,
 * from a group or new, and text compiling as food and as a wall.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear(),
  });
});
import type { GraphNode } from '../../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { groupRules } from '../../agentRules/apply';
import { rulesTemplateNodes } from '../../agentRules/templates';
import { applyGroupRules, endRulesBurst } from '../../agentRules/storeActions';
import { setSensors } from '../cards';
import { endSetupBurst, setSetupParam, setupOf } from '../actions';
import { lensFor, along, toward, picToView } from '../diagram';
import {
  angleLeftOfUp, dragBornSize, dragForce, dragMargin, dragPictureRadius, dragRadius, dragSensor, dragTurn, dragWobble, moved, snap, toPicture,
} from '../diagramDrag';
import { SENSES_TRAIL, sensesWalk } from '../demos';
import { DEFAULT_WEIGHT, STROKE_GLYPHS, layoutStrokes, strokeDistance, textDistance } from '../strokeFont';
import { cleanText, madeShapeDistance, madeShapeNode, madeShapeParams, newMadeShape, normalizeMadeShape, readMadeShape, shapeLines, shapeSliders } from '../madeShapes';
import { foodResult, listRegions } from '../where';
import { foodNow, newRegionGroup, setFoodChannel, setWhere, takeCreated, whereNow } from '../whereActions';

const nodes = () => useNodeGraphStore.getState().nodes;
const group = () => nodes().find(x => x.type === 'agentsGroup')!;
const compiles = (all: GraphNode[] = nodes()) => {
  const r = compileGraph({ nodes: all });
  expect(r.errors).toBeUndefined();
  expect(r.success).toBe(true);
  return r;
};

beforeEach(() => {
  useNodeGraphStore.setState({ nodes: rulesTemplateNodes('slime', 't'), activeGroupPath: [] });
  undoManager.clear();
  endRulesBurst();
  endSetupBurst();
});

describe('drag-to-value maths, per diagram', () => {
  const lens = lensFor(800, 600, 0.03);
  it('senses: a feeler out or in is How far ahead; sideways is How wide (0–90°)', () => {
    const w = lens.walker;
    // The left feeler dragged to 30° left, twice its length: distance 0.06, angle 30.
    const p = along(w, 0.06 * lens.scale, 30);
    expect(dragSensor(w, lens.scale, p, 'left')).toEqual({ distance: 0.06, angle: 30 });
    // The right feeler mirrors it.
    expect(dragSensor(w, lens.scale, along(w, 0.02 * lens.scale, -45), 'right')).toEqual({ distance: 0.02, angle: 45 });
    // The centre feeler moves only the distance; the angle never passes 90 or 0, the distance never 0.
    expect(dragSensor(w, lens.scale, along(w, 0.045 * lens.scale, 20), 'centre')).toEqual({ distance: 0.045 });
    expect(dragSensor(w, lens.scale, along(w, 0.05 * lens.scale, 150), 'left').angle).toBe(90);
    expect(dragSensor(w, lens.scale, along(w, 0.05 * lens.scale, -20), 'left').angle).toBe(0);
    expect(dragSensor(w, lens.scale, w, 'centre').distance).toBe(0.001);
  });
  it('turn and wobble arcs: round the walker, in degrees, to the slider\'s step', () => {
    const w = { x: 100, y: 100 };
    expect(angleLeftOfUp(w, along(w, 50, 37))).toBeCloseTo(37, 6);
    expect(dragTurn(w, along(w, 80, 33.2))).toBe(33);
    expect(dragTurn(w, along(w, 80, -20))).toBe(0);
    expect(dragTurn(w, along(w, 80, 120))).toBe(90);
    expect(dragWobble(w, along(w, 80, -12.26))).toBe(12.5);
    expect(dragWobble(w, along(w, 80, 70))).toBe(45);
  });
  it('the view ring: its radius in picture units through the lens', () => {
    expect(dragRadius({ x: 0, y: 0 }, { x: 30, y: 40 }, 1000)).toBe(0.05);
    expect(dragRadius({ x: 0, y: 0 }, { x: 0, y: 0 }, 1000)).toBe(0.005);
  });
  it('force arrows: the tip sets the direction and the strength (the arrow drawn 18 px + 70 a unit); a negative force keeps its sign', () => {
    const P = { x: 300, y: 300 };
    expect(dragForce(P, toward(P, 18 + 70 * 0.5, -90))).toEqual({ angle: -90, strength: 0.5 });
    expect(dragForce(P, toward(P, 18 + 70 * 1.2, 30))).toEqual({ angle: 30, strength: 1.2 });
    expect(dragForce(P, toward(P, 18 + 70 * 0.3, 180), -1)).toEqual({ angle: 180, strength: -0.3 });
    expect(dragForce(P, toward(P, 5, 0)).strength).toBe(0);
  });
  it('Born: moved by the pointer\'s travel; sized by its edge or corner; picture points round-trip', () => {
    const im = { x: 100, y: 50, w: 640, h: 400 };
    expect(toPicture(im, picToView(im, { x: 0.4, y: -0.25 }))).toEqual({ x: 0.4, y: -0.25 });
    // 100 px right and 50 px up on a 400 px tall picture: +0.5 across, +0.25 up.
    expect(moved(im, { x: 0.1, y: 0.1 }, { x: 300, y: 300 }, { x: 400, y: 250 })).toEqual({ x: 0.6, y: 0.35 });
    const c = { x: 420, y: 250 };
    expect(dragBornSize('disc', c, { x: 420 + 60, y: 250 + 80 }, 400)).toBe(0.5);
    expect(dragBornSize('box', c, { x: 420 + 40, y: 250 - 100 }, 400)).toBe(0.5);
    expect(dragBornSize('line', c, { x: 420 + 40, y: 250 - 100 }, 400)).toBe(0.2);
    expect(dragBornSize('ring', c, c, 400)).toBe(0.01);
  });
  it('orbits, field layers and Avoid edges: radii and margins in picture units', () => {
    expect(dragPictureRadius({ x: 0, y: 0 }, { x: 120, y: 0 }, 400)).toBe(0.6);
    expect(dragMargin(740, { x: 700, y: 10 }, 400)).toBe(0.2);
    expect(dragMargin(740, { x: 760, y: 10 }, 400)).toBe(0.005);
    expect(snap(0.1 + 0.2, 0.1)).toBe(0.3);
  });
});

describe('one undo step per drag', () => {
  it('rule edits and setup settings over a long drag fold into the one step the drag marked', () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const id = group().id;
    const emit = setupOf(nodes(), id).emit!;
    const d0 = groupRules(group()).sensor.distance;
    const before = undoManager.canUndo;
    const mark = undoManager.top()?.id ?? 0;
    let set = groupRules(group());
    for (let i = 1; i <= 6; i++) {
      set = setSensors(set, { distance: 0.03 + i * 0.002 });
      applyGroupRules(id, set, 'Agent Builder: edited');
      setSetupParam(emit.id, { x: i * 0.05 });
      now += 2000; // a pause longer than a burst
    }
    expect(undoManager.canUndo).toBeGreaterThan(before + 1);
    undoManager.collapseSince(mark, { label: 'Agent Builder: dragged the feelers' });
    endRulesBurst();
    endSetupBurst();
    expect(undoManager.canUndo).toBe(before + 1);
    expect(undoManager.top()?.label).toBe('Agent Builder: dragged the feelers');
    // The step holds the graph from before the drag.
    const st = useNodeGraphStore.getState();
    st.undo();
    expect(groupRules(group()).sensor.distance).toBe(d0);
    expect(setupOf(nodes(), id).emit!.params.x).toBe(emit.params.x);
    spy.mockRestore();
  });
});

describe('the Sensors demo', () => {
  it('with the slime\'s settings the walker catches the trail and rides along it', () => {
    const { track } = sensesWalk({ angle: 40, turn: 45, away: false, distance: 0.03 }, 120);
    const off = (i: number) => Math.abs(track[i].y - SENSES_TRAIL(track[i].x));
    expect(off(0)).toBeGreaterThan(0.3);
    // Within two seconds it is on the trail, and it stays on it, going the same way (to the right).
    for (const i of [60, 75, 90, 105]) expect(off(i)).toBeLessThan(0.12);
    expect(track[90].x).toBeGreaterThan(track[60].x);
  });
  it('follows the live values: a longer reach and a narrower angle still catch it', () => {
    for (const s of [{ angle: 22.5, turn: 45, distance: 0.035 }, { angle: 10, turn: 20, distance: 0.01 }]) {
      const { track, D } = sensesWalk({ ...s, away: false }, 120);
      expect(D).toBeCloseTo(Math.min(0.7, Math.max(0.1, 0.3 * s.distance / 0.03)), 6);
      expect(Math.abs(track[90].y - SENSES_TRAIL(track[90].x))).toBeLessThan(0.12);
    }
  });
});

describe('text in the stroke font', () => {
  it('every glyph has strokes inside its box; the layout is centred; the distance is below 0 on a stroke', () => {
    for (const [ch, g] of Object.entries(STROKE_GLYPHS)) if (ch !== ' ') expect(g.length).toBeGreaterThan(0);
    const l = layoutStrokes('HI');
    const xs = l.strokes.flatMap(s => (s.k === 'L' ? [s.a[0], s.b[0]] : s.k === 'P' ? [s.p[0]] : [s.c[0]]));
    expect(Math.min(...xs)).toBeCloseTo(-l.halfWidth, 6);
    expect(textDistance('I', 0, 0)).toBeCloseTo(-DEFAULT_WEIGHT, 6);
    expect(textDistance('I', 0.5, 0)).toBeGreaterThan(0.3);
    // An arc: O's top is on the letters, its middle is not.
    expect(textDistance('O', 0, 1)).toBeLessThan(0);
    expect(textDistance('O', 0, 0)).toBeGreaterThan(0);
    expect(strokeDistance({ k: 'A', c: [0, 0], r: 1, a0: 0, a1: 90 }, -1, 0)).toBeCloseTo(Math.SQRT2, 6);
  });
  it('a new text is the stroke font: its lines are one per stroke, its weight a slider; the CPU sign matches inside and out', () => {
    const s = { ...newMadeShape('text', 0.2, -0.1), text: 'AB' };
    expect(s.font).toBe('stroke');
    const { lines, result } = shapeLines(s);
    expect(result).toBe('(d - wt) * s');
    expect(lines.filter(l => l.lhs === 'd').length).toBe(layoutStrokes('AB').strokes.length);
    expect(shapeSliders(s).map(x => x.name)).toEqual(['cx', 'cy', 's', 'wt']);
    expect(madeShapeDistance(s, 0.2 + (-0.6 - 0.85) * 0.2 / 1, -0.1)).toBeLessThan(0.05);
    expect(madeShapeDistance(s, 1.5, 0.9)).toBeGreaterThan(0);
    // Read back from its node, with its weight from the slider.
    const node = madeShapeNode('tx', s, 0, 0);
    node.params.wt = 0.25;
    expect(readMadeShape(node)).toMatchObject({ shape: 'text', font: 'stroke', text: 'AB', weight: 0.25 });
  });
  it('text made before (no font) keeps its blocky letters and reads back', () => {
    const old = { shape: 'text', x: 0, y: 0, size: 0.2, text: 'HI' };
    const s = normalizeMadeShape(old)!;
    expect(s.font).toBe('blocky');
    // A node as phase 3 saved it: its params without font or weight.
    const params = madeShapeParams(s);
    delete (params.whereShape as Record<string, unknown>).font;
    expect(shapeSliders(s).map(x => x.name)).toEqual(['cx', 'cy', 's']);
    const node = { ...madeShapeNode('old', s, 0, 0), params };
    expect(readMadeShape(node)).toMatchObject({ shape: 'text', font: 'blocky', text: 'HI' });
    expect(String(params.lines && (params.lines as Array<{ rhs: string }>)[2].rhs)).toBe('1e5');
    expect(cleanText('hi there!', 'stroke')).toBe('HI THERE!');
  });
});

/** A made text shape for a use (one undo step, the node wired). */
function textFor(use: 'food' | 'obstacle' | 'born', text = 'HELLO') {
  const set = setWhere(group().id, use, { make: { ...newMadeShape('text', 0, 0, 0.18), text } }, use === 'food' ? { channel: 0 } : {});
  expect(set).toBeTruthy();
  return nodes().find(x => x.params.whereShape)!;
}

describe('text as the pattern (food) and as a wall, in 2D', () => {
  it('food: the text feeds the Trail field\'s Add through a Food block in the channel they smell; it compiles', () => {
    const t = textFor('food');
    const trail = setupOf(nodes(), group().id).trail!;
    const add = trail.inputs.add.connection!;
    const adapter = nodes().find(x => x.id === add.nodeId)!;
    expect(adapter.params.result).toBe(foodResult('shape', 0));
    expect(adapter.inputs.v.connection).toEqual({ nodeId: t.id, outputKey: 'result' });
    expect(foodNow(nodes(), group().id)).toMatchObject({ adapter: adapter.id, channel: 0, amount: 600 });
    expect(whereNow(nodes(), group().id, 'food').region).toMatchObject({ nodeId: t.id, kind: 'shape', made: { shape: 'text', text: 'HELLO' } });
    compiles();
    // Into another channel: the block's result is rewritten (one undo step).
    setFoodChannel(group().id, 1);
    expect(nodes().find(x => x.id === adapter.id)!.params.result).toBe(foodResult('shape', 1));
    compiles();
    // None: the Add is unwired and the Food block goes.
    setWhere(group().id, 'food', null);
    expect(setupOf(nodes(), group().id).trail!.inputs.add.connection).toBeUndefined();
    expect(nodes().some(x => x.id === adapter.id)).toBe(false);
  });
  it('food from a texture reads it through a Sample (texture); compiles', () => {
    const trailId = setupOf(nodes(), group().id).trail!.id;
    setWhere(group().id, 'food', { create: 'shaderTexture' }, { channel: 0 });
    const st = nodes().find(x => x.type === 'shaderTexture')!;
    expect(takeCreated()).toBe(st.id);
    const add = nodes().find(x => x.id === trailId)!.inputs.add.connection!;
    const adapter = nodes().find(x => x.id === add.nodeId)!;
    const sample = nodes().find(x => x.id === adapter.inputs.c.connection!.nodeId)!;
    expect(sample.type).toBe('sampleTexture');
    expect(sample.inputs.texture.connection).toEqual({ nodeId: st.id, outputKey: 'texture' });
    expect(whereNow(nodes(), group().id, 'food').region?.nodeId).toBe(st.id);
    compiles();
  });
  it('a wall: the text\'s distance straight into Move\'s Obstacle ƒ; compiles', () => {
    const t = textFor('obstacle', 'WALL');
    expect(group().inputs.obstacle.connection).toEqual({ nodeId: t.id, outputKey: 'result' });
    expect(groupRules(group()).obstacle).toEqual({ on: 'turn' });
    compiles();
  });
  it('born inside the text compiles too; the old blocky text still compiles as a wall', () => {
    textFor('born', 'HI');
    compiles();
    const s = normalizeMadeShape({ shape: 'text', x: 0, y: 0, size: 0.2, text: 'OK' })!;
    setWhere(group().id, 'obstacle', { make: s });
    compiles();
  });
});

describe('wiring three ways', () => {
  it('from the graph, and from a group: a plain group\'s output is listed from that group and wires like any output', () => {
    const g = newRegionGroup('pg', 'pgIn', -900, 0);
    useNodeGraphStore.setState({ nodes: [...nodes(), { ...g, params: { ...g.params, label: 'My shapes' } }, n('circleSDF', 'gc', -900, 400, {})] });
    const list = listRegions(nodes(), group().id);
    expect(list.find(r => r.nodeId === 'gc')?.from).toBeUndefined();
    expect(list.find(r => r.nodeId === 'pg')).toMatchObject({ outputKey: 'out0', kind: 'shape', from: 'My shapes', inside: 'pg' });
    setWhere(group().id, 'obstacle', { region: { nodeId: 'pg', outputKey: 'out0' } });
    expect(group().inputs.obstacle.connection).toEqual({ nodeId: 'pg', outputKey: 'out0' });
    expect(whereNow(nodes(), group().id, 'obstacle').region).toMatchObject({ from: 'My shapes', inside: 'pg' });
    compiles();
  });
  it('another Agents group\'s trail is listed from that group', () => {
    const other = rulesTemplateNodes('slime', 'o').map(x => (x.type === 'agentsGroup' ? { ...x, params: { ...x.params, label: 'Prey' } } : x));
    useNodeGraphStore.setState({ nodes: [...nodes(), ...other] });
    const list = listRegions(nodes(), group().id);
    const oTrail = other.find(x => x.type === 'trailField')!;
    expect(list.find(r => r.nodeId === oTrail.id)?.from).toBe('Prey');
    expect(list.find(r => r.nodeId === setupOf(nodes(), group().id).trail!.id)?.from).toBeUndefined();
  });
  it('create new: a Shader Texture (a texture use) or a group, top level, wired, and kept for opening; one undo step', () => {
    const before = undoManager.canUndo;
    setWhere(group().id, 'born', { create: 'shaderTexture' });
    const st = nodes().find(x => x.type === 'shaderTexture')!;
    expect(takeCreated()).toBe(st.id);
    expect(takeCreated()).toBeNull();
    const emit = setupOf(nodes(), group().id).emit!;
    expect(emit.params.shape).toBe('picture');
    expect(emit.inputs.picture.connection).toEqual({ nodeId: st.id, outputKey: 'texture' });
    expect(undoManager.canUndo).toBe(before + 1);
    compiles();
    // Walls can't read a texture: no Shader Texture there.
    expect(setWhere(group().id, 'obstacle', { create: 'shaderTexture' })).toBeNull();
    setWhere(group().id, 'obstacle', { create: 'group' });
    const pg = nodes().find(x => x.type === 'group')!;
    expect(takeCreated()).toBe(pg.id);
    expect(pg.outputs.out0.type).toBe('float');
    expect(group().inputs.obstacle.connection).toEqual({ nodeId: pg.id, outputKey: 'out0' });
    expect(String(pg.params.__comment)).toMatch(/Distance output is a region/);
    compiles();
  });
});
