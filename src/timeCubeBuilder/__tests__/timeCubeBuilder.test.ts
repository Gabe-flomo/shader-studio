/**
 * The Time Cube builder (docs/timecube-builder.md): every node setting is in one of its sections; each section writes
 * the right node's params, live (no rewire); Cube ⇄ Stack and the LFO rewire keeping ids; every preset and Surprise me
 * compiles (Surprise is the same for the same seed, one undo step); a card's change is taken back; Done closes with
 * the session one undo step; Edit this one reopens the build as it is; the kind page lists it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import { compileGraph } from '../../compiler/graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { paramBindingKey } from '../../compiler/uniformPatcher';
import { applyTimeCube, findTcBuild, specOfBuild } from '../apply';
import { TC_PRESETS, presetNow, presetSpec, withPreset } from '../presets';
import { surpriseTimeCube } from '../surprise';
import { DRIVE_TARGETS, TC_SECTIONS, blankSpec, defsOf, groupsFor, sectionSummary, shownKeys, visibleNow, type TcDisplay, type TimeCubeSpec } from '../spec';
import { useTimeCubeBuilder } from '../store';
import { adoptFromGraph, closeTimeCubeBuilder, editTimeCubeInBuilder, finishTimeCubeBuilder, openNewTimeCube, syncTimeCubeBuilder } from '../actions';
import { SCENE_KINDS, builtSceneIds, builtScenes, selectedBuiltScene, openSceneKind } from '../../builders/sceneKinds';
import { editBuiltScene, startSceneKind } from '../../builders/open';

const output = (): GraphNode => ({ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color' } } as GraphNode['inputs'], outputs: {}, params: {} });
let n = 0;
const nextId = () => `t${++n}`;
const nodes = () => useNodeGraphStore.getState().nodes;
const role = (r: string) => { const id = useTimeCubeBuilder.getState().targetId!; return findTcBuild(nodes(), id)!.byRole.get(r); };

function compiles(spec: TimeCubeSpec) {
  const r = applyTimeCube([output()], spec, { nextId });
  const c = compileGraph({ nodes: r.nodes });
  expect(c.errors ?? []).toEqual([]);
  expect(c.success).toBe(true);
  return r;
}

beforeEach(() => {
  undoManager.clear('test');
  useNodeGraphStore.setState({ nodes: [output()], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useTimeCubeBuilder.setState({ open: false, targetId: null, past: [], future: [] });
});

describe('the sections hold every setting the nodes have', () => {
  it.each(['source', 'view', 'stack'] as const)('%s: every param with a card section is in exactly one builder section', r => {
    const want = Object.entries(defsOf(r)).filter(([, pd]) => pd.section).map(([k]) => k).sort();
    const got = shownKeys(r);
    expect([...got].sort()).toEqual(want);
    expect(new Set(got).size).toBe(got.length);
  });
  it('the sections are Source, Shape, Time, Colour, Highlights & motion, Space, Camera, Look; each has settings for both displays (Space: the box only)', () => {
    expect(TC_SECTIONS).toEqual(['source', 'shape', 'time', 'colour', 'motion', 'space', 'camera', 'look']);
    for (const s of TC_SECTIONS) for (const d of ['cube', 'stack'] as TcDisplay[]) {
      if (s === 'space' && d === 'stack') expect(groupsFor(s, d)).toEqual([]);
      else expect(groupsFor(s, d).length, `${s} ${d}`).toBeGreaterThan(0);
    }
  });
  it('Space holds Repeat, Each copy, Warp and Far & fog, from the View', () => {
    expect(groupsFor('space', 'cube').map(g => `${g.role}:${g.title}`)).toEqual(['view:Repeat', 'view:Each copy', 'view:Warp', 'view:Far & fog']);
    expect(groupsFor('space', 'cube')[0].keys[0]).toBe('repeat');
  });
  it('the Space presets switch on Repeat and Warp (Infinite hall of cubes, Twisted time, Time train)', () => {
    expect(presetSpec('hall').view).toMatchObject({ repeat: true, repAxes: 'xz', repCount: 0 });
    expect(presetSpec('twisted').view).toMatchObject({ warp: 'twist' });
    expect(presetSpec('train').view).toMatchObject({ repeat: true, repAxes: 'z', warp: 'wave', warpWhere: 'space' });
    expect(sectionSummary(presetSpec('hall'), 'space')).toBe('repeat a floor');
    expect(sectionSummary(presetSpec('twisted'), 'space')).toBe('twist');
    expect(sectionSummary(blankSpec('cube'), 'space')).toBe('One box, no warp');
  });
});

describe('spec → graph', () => {
  it.each(TC_PRESETS.map(p => [p.key]))('preset %s compiles and is what its example is', key => {
    const spec = presetSpec(key);
    const r = compiles(spec);
    const p = TC_PRESETS.find(x => x.key === key)!;
    expect(r.nodes.some(x => x.type === (p.display === 'cube' ? 'timeCubeView' : 'frameStack'))).toBe(true);
    expect(presetNow(spec)).toBe(key);
  });
  it('the Box of time preset sweeps the slice with a triangle LFO, as its example does', () => {
    const r = compiles(presetSpec('box'));
    const view = r.nodes.find(x => x.type === 'timeCubeView')!;
    const lfo = r.nodes.find(x => x.type === 'lfo')!;
    expect(view.inputs.slice.connection).toEqual({ nodeId: lfo.id, outputKey: 'value' });
    expect(lfo.params).toMatchObject({ waveform: 'triangle', freq: 0.07, amplitude: 0.47, offset: 0.5 });
    expect(view.inputs.volume.connection?.nodeId).toBe(r.sourceId);
    expect(r.nodes.find(x => x.id === 'out')!.inputs.color.connection).toEqual({ nodeId: view.id, outputKey: 'color' });
  });
  it.each(Object.entries(DRIVE_TARGETS).flatMap(([d, ts]) => ts.map(t => [d, t.value])))('%s: an LFO on %s compiles', (d, target) => {
    const s = blankSpec(d as TcDisplay);
    s.drive = { ...s.drive, on: true, target };
    const r = compiles(s);
    expect(r.nodes.find(x => x.id === r.displayId)!.inputs[target].connection?.nodeId).toBe(r.driveId);
  });
  it('a preset keeps your video and its clip', () => {
    const s = blankSpec();
    Object.assign(s.source, { source: 'library', videoId: 'v1', fileName: 'mine.mp4', _meta: { width: 640, height: 360, duration: 4 }, segments: [{ in: 1, out: 2 }] });
    const p = withPreset(s, 'exposure');
    expect(p.source).toMatchObject({ source: 'library', videoId: 'v1', fileName: 'mine.mp4', segments: [{ in: 1, out: 2 }], combine: 'max' });
  });
});

describe('Surprise me', () => {
  it.each([[1], [7], [42], [1234], [99999]])('seed %i compiles, is the same each time and keeps your video', seed => {
    const base = blankSpec();
    base.source.fileName = 'mine.mp4';
    const a = surpriseTimeCube(seed, base);
    expect(surpriseTimeCube(seed, base)).toEqual(a);
    expect(a.source.fileName).toBe('mine.mp4');
    compiles(a);
  });
  it('is one undo step of the builder', () => {
    openNewTimeCube();
    const was = useTimeCubeBuilder.getState().spec;
    useTimeCubeBuilder.getState().surprise(5);
    expect(useTimeCubeBuilder.getState().surpriseSeed).toBe(5);
    useTimeCubeBuilder.getState().undo();
    expect(useTimeCubeBuilder.getState().spec).toEqual(was);
    closeTimeCubeBuilder();
  });
});

describe('live in the graph', () => {
  it('opening builds at once, one undo step', () => {
    const id = openNewTimeCube();
    expect(id).toBeTruthy();
    expect(nodes().map(x => x.type).sort()).toEqual(['lfo', 'output', 'timeCube', 'timeCubeView']);
    expect(openSceneKind()).toBe('timecube');
    closeTimeCubeBuilder();
    useNodeGraphStore.getState().undo();
    expect(nodes().map(x => x.type)).toEqual(['output']);
  });

  it.each(TC_SECTIONS.flatMap(s => (['cube', 'stack'] as TcDisplay[]).filter(d => !(s === 'space' && d === 'stack')).map(d => [s, d])))('%s (%s): a slider writes its node\'s param, no rewire', (section, display) => {
    const start = blankSpec(display as TcDisplay);
    // Sections whose settings sit behind a switch: switched on.
    if (section === 'motion' && display === 'cube') start.view.highlights = true;
    if (section === 'look' && display === 'stack') start.stack.dof = 'distance';
    openNewTimeCube(undefined, start);
    const groups = groupsFor(section as never, display as TcDisplay);
    // The first number of the section.
    const spec = useTimeCubeBuilder.getState().spec;
    const shown = (r: 'source' | 'view' | 'stack', k: string) => defsOf(r)[k].type === 'float' && visibleNow(defsOf(r)[k], spec[r], r) && !(spec.drive.on && spec.drive.target === k);
    const g = groups.find(x => x.keys.some(k => shown(x.role, k)))!;
    const key = g.keys.find(k => shown(g.role, k))!;
    const pd = defsOf(g.role)[key];
    const v = (pd.min ?? 0) + ((pd.max ?? 1) - (pd.min ?? 0)) * 0.37;
    const ids = nodes().map(x => x.id).sort();
    const wires = JSON.stringify(nodes().map(x => x.inputs));
    useTimeCubeBuilder.getState().edit(d => { d[g.role][key] = v; });
    syncTimeCubeBuilder();
    expect(role(g.role)!.params[key]).toBe(v);
    expect(nodes().map(x => x.id).sort()).toEqual(ids);
    expect(JSON.stringify(nodes().map(x => x.inputs))).toBe(wires);
    closeTimeCubeBuilder();
  });

  it('a float slider of the View writes its uniform too (no recompile)', () => {
    openNewTimeCube();
    const view = role('view')!;
    useNodeGraphStore.getState().compile();
    const name = useNodeGraphStore.getState().paramBindings[paramBindingKey(view.id, 'roundness')];
    expect(name).toBeTruthy();
    useTimeCubeBuilder.getState().edit(d => { d.view.roundness = 0.77; });
    syncTimeCubeBuilder();
    expect(useNodeGraphStore.getState().paramUniforms[name]).toBe(0.77);
    closeTimeCubeBuilder();
  });

  it('Cube ⇄ Stack and the LFO rewire, keeping the Time Cube and the LFO by role', () => {
    openNewTimeCube();
    const src = role('source')!.id, lfo = role('drive')!.id;
    useTimeCubeBuilder.getState().edit(d => { d.display = 'stack'; d.drive.target = 'scan'; });
    syncTimeCubeBuilder();
    expect(role('view')).toBeUndefined();
    const stack = role('stack')!;
    expect(stack.inputs.volume.connection?.nodeId).toBe(src);
    expect(stack.inputs.scan.connection?.nodeId).toBe(lfo);
    expect(nodes().filter(x => x.type === 'timeCubeView')).toHaveLength(0);
    expect(nodes().find(x => x.id === 'out')!.inputs.color.connection?.nodeId).toBe(stack.id);
    useTimeCubeBuilder.getState().edit(d => { d.drive.on = false; });
    syncTimeCubeBuilder();
    expect(role('drive')).toBeUndefined();
    expect(role('stack')!.inputs.scan.connection).toBeUndefined();
    closeTimeCubeBuilder();
  });

  it('a change on a built node elsewhere (its card, Choose video) is taken back into the builder', () => {
    openNewTimeCube();
    const src = role('source')!;
    useNodeGraphStore.getState().updateNodeParams(src.id, { frames: 48, fileName: 'x' });
    expect(adoptFromGraph()).toBe(true);
    expect(useTimeCubeBuilder.getState().spec.source.frames).toBe(48);
    syncTimeCubeBuilder();
    expect(role('source')!.params.frames).toBe(48);
    closeTimeCubeBuilder();
  });

  it('Done closes, and the session (the build and its edits) is one undo step', () => {
    const before = nodes();
    openNewTimeCube();
    useTimeCubeBuilder.getState().edit(d => { d.view.roundness = 0.9; });
    useTimeCubeBuilder.getState().edit(d => { d.view.rimStrength = 1.2; });
    finishTimeCubeBuilder();
    expect(useTimeCubeBuilder.getState().open).toBe(false);
    const view = nodes().find(x => x.type === 'timeCubeView')!;
    expect(view.params).toMatchObject({ roundness: 0.9, rimStrength: 1.2 });
    // A Scene builder session (builders/sceneDraft.ts): one undo takes the whole new scene away.
    useNodeGraphStore.getState().undo();
    expect(nodes()).toEqual(before);
  });
});

describe('reopen: Edit this one', () => {
  it('reopens the build as it is now (the display, the LFO, every setting)', () => {
    openNewTimeCube(undefined, presetSpec('ring'));
    useTimeCubeBuilder.getState().edit(d => { d.stack.cards = 33; d.drive.freq = 0.2; });
    const made = useTimeCubeBuilder.getState().spec;
    finishTimeCubeBuilder();
    const id = builtScenes(nodes()).find(b => b.kind === 'timecube')!.id;
    expect(specOfBuild(nodes(), id)).toEqual(made);
    expect(editBuiltScene({ kind: 'timecube', id })).toBe(true);
    expect(useTimeCubeBuilder.getState().open).toBe(true);
    expect(useTimeCubeBuilder.getState().targetId).toBe(id);
    expect(useTimeCubeBuilder.getState().spec).toEqual(made);
    closeTimeCubeBuilder();
  });
  it('the kind page lists it, and any node of it picks it', () => {
    expect(SCENE_KINDS.some(k => k.id === 'timecube')).toBe(true);
    startSceneKind('timecube');
    expect(useTimeCubeBuilder.getState().open).toBe(true);
    const id = useTimeCubeBuilder.getState().targetId!;
    const lfo = role('drive')!.id;
    closeTimeCubeBuilder();
    expect(builtScenes(nodes()).map(b => [b.kind, b.id])).toEqual([['timecube', id]]);
    expect(selectedBuiltScene(nodes(), [lfo])?.id).toBe(id);
    expect([...builtSceneIds(nodes(), { kind: 'timecube', id })].sort()).toEqual(nodes().filter(x => x.type !== 'output').map(x => x.id).sort());
    expect(editTimeCubeInBuilder(lfo)).toBe(true);
    closeTimeCubeBuilder();
  });
});
