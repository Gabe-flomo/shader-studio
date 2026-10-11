/**
 * The Splat builder (docs/splat-builder.md): every template and every effect builds a graph that compiles (the
 * picture, the splat probe and the modifier program); the effect stack is the Modifier chain in order; a build
 * reopens as built (Edit this one); Surprise me is the same for the same seed; the recipe reads back; the live sync
 * writes params without rewiring and makes a session one undo step; the kind page lists it; the Place maths.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import { compileGraph } from '../../compiler/graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { splatModifierChain } from '../../nodes/recipes/splatModifierRecipes';
import { fitParams } from '../../lib/splats/fit';
import { SP_META, buildSplatStandalone, splatMetaOf } from '../build';
import { applySplatScene, findSplatBuild, paramDiff, splatSceneOfBuild } from '../apply';
import { SPLAT_TEMPLATES, splatTemplate, withTemplate } from '../templates';
import { surpriseSplatScene } from '../surprise';
import { readSplatRecipe, splatRecipe } from '../recipe';
import { centrePlace, fitPlace, keepMiddle, onFloorPlace, scanBottom, scanCenter, type ScanBox } from '../place';
import {
  EFFECT_KINDS, EFFECT_TYPE, animateFor, moveEffect, newEffect, placeEffect, sectionSummary, starterSplatScene, type SplatBuilderSpec,
} from '../spec';
import { useSplatBuilder } from '../store';
import { closeSplatBuilder, editSplatSceneInBuilder, openNewSplatScene, syncSplatBuilder } from '../actions';
import { SCENE_KINDS, builtSceneIds, builtScenes, selectedBuiltScene } from '../../builders/sceneKinds';
import { editBuiltScene } from '../../builders/open';
import { paramBindingKey } from '../../compiler/uniformPatcher';

function compiles(spec: SplatBuilderSpec) {
  const g = buildSplatStandalone(spec);
  const r = compileGraph({ nodes: g.nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  expect(r.splats?.length).toBe(1);
  const on = spec.effects.filter(e => e.on).length;
  expect(!!r.splats![0].modifier).toBe(on > 0);
  return { g, r };
}

const output = (): GraphNode => ({ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color' } } as GraphNode['inputs'], outputs: {}, params: {} });
let n = 0;
const nextId = () => `t${++n}`;

describe('spec → graph compiles', () => {
  it.each(SPLAT_TEMPLATES.map(t => [t.key]))('template %s', key => { compiles(splatTemplate(key)!.make()); });

  it.each(EFFECT_KINDS.map(k => [k]))('effect %s alone, and animated', kind => {
    const s = starterSplatScene();
    s.effects = [newEffect(kind, 'e1')];
    const { g } = compiles(s);
    const fx = g.nodes.find(x => x.type === EFFECT_TYPE[kind])!;
    expect(fx.inputs.splat.connection).toBeUndefined();
    s.effects[0].animate = animateFor(kind);
    const { g: g2 } = compiles(s);
    const fx2 = g2.nodes.find(x => x.type === EFFECT_TYPE[kind])!;
    const lfo = g2.nodes.find(x => x.type === 'lfo')!;
    expect(fx2.inputs[`__param_${s.effects[0].animate!.param}`].connection).toEqual({ nodeId: lfo.id, outputKey: 'value' });
  });

  it('every effect at once, a world, each background, tone and bloom', () => {
    for (const bg of ['solid', 'gradient'] as const) {
      for (const world of [false, true]) {
        const s = starterSplatScene();
        s.effects = EFFECT_KINDS.map((k, i) => newEffect(k, `e${i + 1}`));
        s.background.kind = bg;
        s.world.on = world;
        s.world.props = world ? [{ id: 'p1', kind: 'torus', at: [1, 0, 0], size: 0.4, color: [1, 0, 0] }] : [];
        s.look = { tone: 'agx', bloom: { on: true, intensity: 1, threshold: 0.5, radius: 30 } };
        const { g } = compiles(s);
        const scan = g.nodes.find(x => x.type === 'splatScene')!;
        expect(!!scan.inputs.dist.connection).toBe(world);
        // The same-frame bloom (Pass → Glow → Add glow), then the tone map; never the frame-before Bloom node.
        expect(g.nodes.some(x => x.type === 'bloom')).toBe(false);
        const tone = g.nodes.find(x => x.params._spRole === 'tone')!;
        expect(g.nodes.find(x => x.id === 'out')!.inputs.color.connection?.nodeId).toBe(tone.id);
        const add = g.nodes.find(x => x.id === tone.inputs.color.connection?.nodeId)!;
        expect(add.params.label).toBe('Add glow');
        expect(g.nodes.find(x => x.id === add.inputs.glow.connection?.nodeId)?.type).toBe('glowTexture');
      }
    }
  });

  it('a file scan keeps its file on the node; an off effect is left out of the chain', () => {
    const s = starterSplatScene();
    s.scan.source = { kind: 'file', videoId: 'vid1', fileName: 'train.splat', bytes: 1234 };
    s.effects = [newEffect('wave', 'e1'), { ...newEffect('color', 'e2'), on: false }];
    const { g } = compiles(s);
    const scan = g.nodes.find(x => x.type === 'splatScene')!;
    expect(scan.params).toMatchObject({ videoId: 'vid1', fileName: 'train.splat', bytes: 1234 });
    expect(scan.params.demo).toBeUndefined();
    expect(g.nodes.some(x => x.type === 'splatColor')).toBe(false);
  });
});

describe('the effect stack is the Modifier chain, in order', () => {
  it('first applies first; reordering rewires and keeps each effect\'s node', () => {
    const s = starterSplatScene();
    s.effects = [newEffect('dissolve', 'e1'), newEffect('wave', 'e2'), newEffect('color', 'e3')];
    let r = applySplatScene([output()], s, { nextId });
    const order = (nodes: GraphNode[], id: string) => splatModifierChain(nodes, id).map(x => x.type).reverse();
    expect(order(r.nodes, r.scanId)).toEqual(['splatDissolve', 'splatWave', 'splatColor']);
    const ids = splatModifierChain(r.nodes, r.scanId).map(x => x.id).sort();
    const s2 = { ...s, effects: moveEffect(s.effects, 'e3', -2) };
    r = applySplatScene(r.nodes, s2, { nextId, scanId: r.scanId });
    expect(order(r.nodes, r.scanId)).toEqual(['splatColor', 'splatDissolve', 'splatWave']);
    expect(splatModifierChain(r.nodes, r.scanId).map(x => x.id).sort()).toEqual(ids);
    expect(placeEffect(s2.effects, 'e2', 'e3').map(e => e.id)).toEqual(['e2', 'e3', 'e1']);
    expect(placeEffect(s2.effects, 'e3', null).map(e => e.id)).toEqual(['e1', 'e2', 'e3']);
    // Removing one rewires round it.
    r = applySplatScene(r.nodes, { ...s2, effects: s2.effects.filter(e => e.id !== 'e1') }, { nextId, scanId: r.scanId });
    expect(order(r.nodes, r.scanId)).toEqual(['splatColor', 'splatWave']);
    expect(r.nodes.some(x => x.type === 'splatDissolve')).toBe(false);
  });
});

describe('reopen as built', () => {
  beforeEach(() => {
    undoManager.clear('test');
    useNodeGraphStore.setState({ nodes: [output()], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
    useSplatBuilder.setState({ open: false, targetId: null });
  });

  it('the Splat Scene carries the spec; the Scene builder lists it and Edit this one opens it as it was', () => {
    const spec = withTemplate(starterSplatScene(), splatTemplate('hologram')!);
    const r = applySplatScene(useNodeGraphStore.getState().nodes, spec, { nextId });
    useNodeGraphStore.setState({ nodes: r.nodes });
    expect(splatMetaOf(r.nodes.find(x => x.id === r.scanId))!.spec).toEqual(spec);
    const built = builtScenes(r.nodes);
    expect(built).toEqual([{ kind: 'splat', id: r.scanId, label: 'Splat scene', detail: 'Example: lumpy ball · Points, Colour grade, Crop, Wave' }]);
    // Any node of the build finds it.
    const fx = r.nodes.find(x => x.type === 'splatCrop')!;
    expect(splatSceneOfBuild(r.nodes, fx.id)).toBe(r.scanId);
    expect(selectedBuiltScene(r.nodes, [fx.id])?.id).toBe(r.scanId);
    // Start over takes every node of the build, never the Output.
    const gone = builtSceneIds(r.nodes, built[0]);
    expect(gone.has('out')).toBe(false);
    expect([...findSplatBuild(r.nodes, r.scanId)!.byRole.values()].every(x => gone.has(x.id))).toBe(true);
    expect(editBuiltScene(built[0])).toBe(true);
    expect(useSplatBuilder.getState().open).toBe(true);
    expect(useSplatBuilder.getState().targetId).toBe(r.scanId);
    expect(useSplatBuilder.getState().spec).toEqual(spec);
    closeSplatBuilder();
    // Nothing changed: no undo step.
    expect(undoManager.canUndo).toBe(0);
  });

  it('a rebuild keeps a setting changed by hand on a node, unless the builder changes it', () => {
    const spec = starterSplatScene();
    spec.effects = [newEffect('wave', 'e1')];
    let r = applySplatScene([output()], spec, { nextId });
    const wave = r.nodes.find(x => x.type === 'splatWave')!;
    const hand = r.nodes.map(x => (x.id === wave.id ? { ...x, params: { ...x.params, frequency: 9 } } : x));
    r = applySplatScene(hand, { ...spec, camera: { ...spec.camera, dist: 5 } }, { nextId, scanId: r.scanId });
    expect(r.kept).toBe(1);
    expect(r.nodes.find(x => x.id === wave.id)!.params.frequency).toBe(9);
    expect(r.nodes.find(x => x.type === 'marchCamera')!.params.camDist).toBe(5);
  });
});

describe('the live sync', () => {
  beforeEach(() => {
    undoManager.clear('test');
    useNodeGraphStore.setState({ nodes: [output()], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
    useSplatBuilder.setState({ open: false, targetId: null });
  });

  it('opening builds it (one step); settings only write params; a new effect rewires; closing is one step', () => {
    const id = openNewSplatScene()!;
    expect(useSplatBuilder.getState().targetId).toBe(id);
    expect(undoManager.canUndo).toBe(1);
    const afterBuild = useNodeGraphStore.getState().nodes;
    const out = afterBuild.find(x => x.id === 'out')!;
    expect(out.inputs.color.connection?.nodeId).toBe(id);

    // A slider: the same nodes and wires, the param written.
    useSplatBuilder.getState().edit(d => { d.place.scale = 2; d.camera.dist = 6; });
    const before = useNodeGraphStore.getState().nodes;
    const next = applySplatScene(before, useSplatBuilder.getState().spec, { nextId, scanId: id }).nodes;
    const diff = paramDiff(before, next)!;
    expect(diff).not.toBeNull();
    expect(diff.find(d => d.id === id)!.live).toEqual({ scale: 2 });
    expect(diff.find(d => d.id === id)!.silent).toHaveProperty(SP_META);
    syncSplatBuilder();
    const scan = useNodeGraphStore.getState().nodes.find(x => x.id === id)!;
    expect(scan.params.scale).toBe(2);
    expect(splatMetaOf(scan)!.spec.place.scale).toBe(2);
    expect(useNodeGraphStore.getState().nodes.map(x => x.id).sort()).toEqual(afterBuild.map(x => x.id).sort());
    expect(undoManager.canUndo).toBe(1);

    // An effect: rewired, still quietly.
    useSplatBuilder.getState().edit(d => { d.effects.push(newEffect('dissolve', 'e1')); });
    expect(paramDiff(useNodeGraphStore.getState().nodes, applySplatScene(useNodeGraphStore.getState().nodes, useSplatBuilder.getState().spec, { nextId, scanId: id }).nodes)).toBeNull();
    syncSplatBuilder();
    expect(splatModifierChain(useNodeGraphStore.getState().nodes, id).map(x => x.type)).toEqual(['splatDissolve']);
    expect(undoManager.canUndo).toBe(1);

    closeSplatBuilder();
    expect(useSplatBuilder.getState().open).toBe(false);
    expect(undoManager.canUndo).toBe(2);
    act(() => useNodeGraphStore.getState().undo());
    expect(useNodeGraphStore.getState().nodes.find(x => x.id === id)!.params.scale).toBe(1);
    act(() => useNodeGraphStore.getState().undo());
    expect(useNodeGraphStore.getState().nodes.map(x => x.id)).toEqual(['out']);
  });

  it('a slider drag doesn\'t rebuild the graph: one store write a tick, the uniforms pushed, no compile (now or later)', () => {
    vi.useFakeTimers();
    try {
      openNewSplatScene();
      useNodeGraphStore.getState().compile();
      const st0 = useNodeGraphStore.getState();
      const cam = st0.nodes.find(x => x.type === 'marchCamera')!;
      const uName = st0.paramBindings[paramBindingKey(cam.id, 'camDist')];
      expect(uName && uName in st0.paramUniforms).toBe(true);
      const compile = vi.spyOn(useNodeGraphStore.getState(), 'compile');
      const before = useNodeGraphStore.getState().nodes;
      let writes = 0;
      const off = useNodeGraphStore.subscribe(() => { writes++; });
      for (let i = 1; i <= 5; i++) {
        useSplatBuilder.getState().edit(d => { d.camera.dist = 3 + i; });
        syncSplatBuilder();
        // The picture has the new value at once (a live uniform), not after the drag.
        expect(useNodeGraphStore.getState().paramUniforms[uName]).toBe(3 + i);
      }
      off();
      expect(writes).toBe(5);
      vi.advanceTimersByTime(2000);
      expect(compile).not.toHaveBeenCalled();
      // The same nodes and wires; nodes the slider doesn't set are the very same objects.
      const after = useNodeGraphStore.getState().nodes;
      expect(after.map(x => x.id)).toEqual(before.map(x => x.id));
      const wires = (ns: readonly GraphNode[]) => JSON.stringify(ns.map(x => Object.entries(x.inputs).map(([k, v]) => [k, v.connection?.nodeId, v.connection?.outputKey])));
      expect(wires(after)).toBe(wires(before));
      const touched = after.filter((x, i) => x !== before[i]).map(x => x.type).sort();
      expect(touched).toEqual(['marchCamera', 'splatScene']);
      expect(after.find(x => x.id === cam.id)!.params.camDist).toBe(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closing builds a change the frame hasn\'t yet', () => {
    const id = openNewSplatScene()!;
    useSplatBuilder.getState().edit(d => { d.place.opacity = 0.5; });
    closeSplatBuilder();
    expect(useNodeGraphStore.getState().nodes.find(x => x.id === id)!.params.opacity).toBe(0.5);
    expect(editSplatSceneInBuilder(id)).toBe(true);
    expect(useSplatBuilder.getState().spec.place.opacity).toBe(0.5);
  });
});

const act = (fn: () => void) => fn();

describe('Surprise me', () => {
  it('the same seed gives the same scene; seeds differ; every one compiles; your scan stays', () => {
    expect(surpriseSplatScene(4242)).toEqual(surpriseSplatScene(4242));
    const seen = new Set<string>();
    for (const seed of [1, 7, 99, 1234, 55555, 777777, 31337, 2026]) {
      const s = surpriseSplatScene(seed);
      seen.add(JSON.stringify(s));
      expect(s.effects.length).toBeGreaterThan(0);
      compiles(s);
    }
    expect(seen.size).toBe(8);
    const mine = starterSplatScene();
    mine.scan.source = { kind: 'file', videoId: 'v', fileName: 'nike.ply', bytes: 9 };
    mine.place.scale = 0.4;
    for (const seed of [12, 13, 14, 15, 16, 17, 18, 19, 20]) {
      const s = surpriseSplatScene(seed, mine);
      expect(s.scan).toEqual(mine.scan);
      // With a world, only its height changes: it stands on the floor.
      expect({ ...s.place, position: [s.place.position[0], 0, s.place.position[2]] }).toEqual(mine.place);
    }
  });

  it('is one undo step in the builder', () => {
    useSplatBuilder.getState().openWith(starterSplatScene());
    const was = useSplatBuilder.getState().spec;
    useSplatBuilder.getState().surprise(321);
    expect(useSplatBuilder.getState().surpriseSeed).toBe(321);
    useSplatBuilder.getState().undo();
    expect(useSplatBuilder.getState().spec).toEqual(was);
    useSplatBuilder.setState({ open: false });
  });
});

describe('templates and the recipe', () => {
  it('a template keeps your own scan and where you put it', () => {
    const mine = starterSplatScene();
    mine.scan.source = { kind: 'file', videoId: 'v', fileName: 'plush.ply', bytes: 9 };
    mine.place.position = [0, 1, 0];
    const s = withTemplate(mine, splatTemplate('dissolve')!);
    expect(s.scan.source).toEqual(mine.scan.source);
    expect(s.place.position).toEqual([0, 1, 0]);
    expect(s.effects.map(e => e.kind)).toEqual(['dissolve']);
    // On the example scan, the template's own placement.
    expect(withTemplate(starterSplatScene(), splatTemplate('world')!).place.position).toEqual([0, -0.15, 0]);
  });

  it.each([...SPLAT_TEMPLATES.map(t => [t.key, t.make()] as const), ['surprise', surpriseSplatScene(808)] as const])('%s reads back from its recipe', (_k, spec) => {
    const text = splatRecipe(spec);
    const back = readSplatRecipe(text, starterSplatScene());
    expect(back.errors).toEqual([]);
    expect(back.spec).toEqual(spec);
  });

  it('says what it can\'t read, and applies the rest', () => {
    const r = readSplatRecipe('dissolve amount=0.7 sparkle=2\nfrobnicate\nwave off amplitude=0.1 animate=amplitude:0.2:0:0.1\nscan file="mine.ply"');
    expect(r.errors.length).toBe(3);
    expect(r.spec.effects.map(e => [e.kind, e.on])).toEqual([['dissolve', true], ['wave', false]]);
    expect(r.spec.effects[0].params.amount).toBe(0.7);
    expect(r.spec.effects[1].animate).toEqual({ param: 'amplitude', speed: 0.2, from: 0, to: 0.1 });
  });

  it('the left nav sums each section up', () => {
    const s = splatTemplate('world')!.make();
    expect(sectionSummary(s, 'scene')).toBe('floor, 2 shapes, sunset');
    expect(sectionSummary(s, 'effects')).toBe('none yet');
    expect(sectionSummary(splatTemplate('hologram')!.make(), 'effects')).toBe('Points → Colour grade → Crop → Wave');
    expect(sectionSummary(s, 'camera')).toBe('4.6 away · 25° · turntable 6°/s');
  });
});

describe('the kind page and Place', () => {
  it('lists the Splat scene with a line', () => {
    const k = SCENE_KINDS.find(x => x.id === 'splat')!;
    expect(k.title).toBe('Splat scene');
    expect(k.line.length).toBeGreaterThan(20);
    expect(SCENE_KINDS.map(x => x.id)).toEqual(['2d', 'agents', 'grid', '3d', 'splat']);
  });

  const box: ScanBox = { center: [2, -1, 3], radius: 4, coreMin: [0, -3, 1], coreMax: [4, 1, 5] };
  it('Fit to view matches the card\'s Fit to the scene', () => {
    const place = { ...starterSplatScene().place, rotation: [10, 30, 0] as [number, number, number] };
    const fit = fitPlace(place, box);
    const card = fitParams({ id: 'x', type: 'splatScene', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { rotation: place.rotation, up: 'minusY' } }, box.center, box.radius);
    expect(fit.scale).toBe(card.scale);
    fit.position.forEach((v, i) => expect(v).toBeCloseTo(card.position[i], 2));
    scanCenter(fit, box).forEach(v => expect(v).toBeCloseTo(0, 2));
  });

  it('Centre, turns and sizes keep the middle; Stand on the floor puts its bottom on it', () => {
    const p0 = { ...starterSplatScene().place, position: [1, 2, 3] as [number, number, number] };
    scanCenter(centrePlace(p0, box), box).forEach(v => expect(v).toBeCloseTo(0, 2));
    const mid = scanCenter(p0, box);
    const turned = keepMiddle(p0, box, { rotation: [0, 90, 0], scale: 0.5 });
    scanCenter(turned, box).forEach((v, i) => expect(v).toBeCloseTo(mid[i], 2));
    expect(scanBottom(onFloorPlace(p0, box, -1), box)).toBeCloseTo(-1, 2);
  });
});
