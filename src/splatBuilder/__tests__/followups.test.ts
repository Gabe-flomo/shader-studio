/**
 * The Splat builder's follow-ups (docs/splat-builder.md): effects measured relative to the scan (and old graphs as
 * they were), Surprise me standing the scan on its floor, turning about any axis, your own nodes kept in the stack
 * through a rebuild, the main preview at the builder's own size, and the same-frame bloom.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { splatModUniformNames } from '../../compiler/splatGraph';
import type { GraphNode } from '../../types/nodeGraph';
import { migrateNodeParams } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import { splatModifiersNodes, splatDissolvePlayNodes } from '../../store/splatExamples';
import { addSplatModifier, splatModifierChain } from '../../nodes/recipes/splatModifierRecipes';
import { buildSplatStandalone } from '../build';
import { adoptCustomChains, applySplatScene, findSplatBuild } from '../apply';
import { surpriseSplatScene, EXAMPLE_BOX } from '../surprise';
import { keepMiddle, scanBottom, scanCenter, turnAbout, turnDegrees, turnMatrix, type ScanBox } from '../place';
import { moveEffect, newEffect, starterSplatScene, type SplatBuilderSpec } from '../spec';
import { readSplatRecipe, splatRecipe } from '../recipe';
import { previewSizeOverride, setPreviewSizeOverride } from '../../lib/previewSize';

const output = (): GraphNode => ({ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color' } } as GraphNode['inputs'], outputs: {}, params: {} });
let k = 0;
const nextId = () => `f${++k}`;

describe('effects relative to the scan', () => {
  const modOf = (nodes: GraphNode[]) => {
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    return r.splats![0].modifier!;
  };

  it('the builder\'s nodes measure in the scan\'s size: the program reads its box', () => {
    const s = starterSplatScene();
    s.effects = [newEffect('dissolve', 'e1'), newEffect('explode', 'e2'), newEffect('wave', 'e3'), newEffect('crop', 'e4')];
    const g = buildSplatStandalone(s);
    for (const t of ['splatDissolve', 'splatExplode', 'splatWave', 'splatCrop']) expect(g.nodes.find(x => x.type === t)!.params.relative).toBe(true);
    const mod = modOf(g.nodes);
    const u = splatModUniformNames(g.scanId);
    expect(mod.uniforms).toEqual(u);
    expect(mod.fragmentShader).toContain(`uniform vec4 ${u.box};`);
    expect(mod.fragmentShader).toContain('sp_unit = max(');
    expect(mod.fragmentShader).toMatch(/\(sp_local - sp_mid\) \/ sp_unit/);
    expect(mod.fragmentShader).toContain('* sp_unit)');
  });

  it('a node with Relative off compiles as before (no box in its code)', () => {
    const scan = (fx: GraphNode) => [fx, n('splatScene', 'scan', 0, 0, {}, { modifier: [fx.id, 'splat'] }), n('output', 'out', 0, 0, {}, { color: ['scan', 'color'] })];
    const uses = (fs: string) => (fs.match(/\bsp_(unit|mid|midW)\b/g) ?? []).length;
    const prelude = uses(modOf(scan(n('splatColor', 'fx', 0, 0))).fragmentShader);
    for (const t of ['splatDissolve', 'splatExplode', 'splatWave', 'splatCrop']) {
      expect(uses(modOf(scan(n(t, 'fx', 0, 0, { relative: false }))).fragmentShader)).toBe(prelude);
      expect(uses(modOf(scan(n(t, 'fx', 0, 0))).fragmentShader)).toBeGreaterThan(prelude);
    }
  });

  it('old saved nodes load with it off; new nodes have it on; the examples keep scene units', () => {
    const def = (t: string) => getNodeDefinition(t);
    // A node saved before (no schema stamp, or version 1) keeps measuring in scene units.
    for (const t of ['splatDissolve', 'splatExplode', 'splatWave', 'splatCrop']) {
      const { relative: _r, _schemaVersion: _v, ...old } = def(t)!.defaultParams as Record<string, unknown>;
      const saved: GraphNode = { id: 'a', type: t, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { ...old } };
      expect(migrateNodeParams(saved, getNodeDefinition).params.relative).toBe(false);
      expect(migrateNodeParams({ ...saved, params: { ...old, _schemaVersion: 1 } }, getNodeDefinition).params.relative).toBe(false);
      // A node made now (from its defaults) keeps it on through a save and a load.
      const made = n(t, 'b', 0, 0);
      expect(migrateNodeParams(made, getNodeDefinition).params.relative).toBe(true);
    }
    for (const x of [...splatModifiersNodes(), ...splatDissolvePlayNodes()]) if ('relative' in x.params) expect(x.params.relative).toBe(false);
    // The card's Add a modifier makes new nodes: relative.
    const g = addSplatModifier([n('splatScene', 's', 0, 0)], 's', 'splatWave', nextId)!;
    expect(g.find(x => x.type === 'splatWave')!.params.relative).toBe(true);
  });
});

describe('Surprise me stands the scan on its floor', () => {
  const box: ScanBox = { center: [0, 2, 0], radius: 3, coreMin: [-1, 0.5, -1], coreMax: [1, 3.5, 1] };
  it('when it adds a world, the scan\'s lowest point is on the floor (with the scan\'s box, or the example\'s)', () => {
    let worlds = 0;
    for (let seed = 1; seed < 400 && worlds < 6; seed++) {
      const s = surpriseSplatScene(seed, undefined, box);
      if (!s.world.on) continue;
      worlds++;
      expect(scanBottom(s.place, box)).toBeCloseTo(s.world.floor.y, 2);
      const e = surpriseSplatScene(seed);
      expect(scanBottom(e.place, EXAMPLE_BOX)).toBeCloseTo(e.world.floor.y, 2);
    }
    expect(worlds).toBeGreaterThan(0);
  });
});

describe('turning about any axis', () => {
  it('a turn reads back as the same degrees; a ring turn adds to that axis; the middle stays', () => {
    for (const r of [[0, 0, 0], [10, 20, 30], [-45, 60, 170], [80, -30, -120]] as Array<[number, number, number]>) {
      turnDegrees(turnMatrix(r)).forEach((v, i) => expect(v).toBeCloseTo(r[i], 1));
    }
    const box: ScanBox = { center: [1, 2, 3], radius: 2, coreMin: [0, 0, 0], coreMax: [2, 4, 6] };
    const p0 = { ...starterSplatScene().place, position: [0.5, 0, -1] as [number, number, number] };
    const mid = scanCenter(p0, box);
    for (const axis of [0, 1, 2] as const) {
      const p = turnAbout(p0, box, axis, 30);
      expect(p.rotation[axis]).toBeCloseTo(30, 1);
      scanCenter(p, box).forEach((v, i) => expect(v).toBeCloseTo(mid[i], 2));
    }
    // About the world's Y after a turn about X: not just Y + 30 (a real turn about the world axis).
    const tilted = keepMiddle(p0, box, { rotation: [40, 0, 0] });
    const both = turnAbout(tilted, box, 1, 30);
    const want = turnMatrix([0, 30, 0]), got = turnMatrix(both.rotation), was = turnMatrix([40, 0, 0]);
    const mul = (a: number[], b: number[]) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
    mul(want, was).forEach((v, i) => expect(got[i]).toBeCloseTo(v, 3));
  });
});

describe('your own nodes stay in the stack through a rebuild', () => {
  /** A build with Dissolve → Wave, then your nodes added on the card: Splat Attributes → Set Splat at the end. */
  function setup() {
    const spec = starterSplatScene();
    spec.effects = [newEffect('dissolve', 'e1'), newEffect('wave', 'e2')];
    const r = applySplatScene([output()], spec, { nextId });
    const withMine = addSplatModifier(r.nodes, r.scanId, 'custom', nextId)!;
    const attrs = withMine.find(x => x.type === 'splatAttributes')!, set = withMine.find(x => x.type === 'splatSet')!;
    // Your own wiring inside the run: Attributes' colour into Set Splat.
    const nodes = withMine.map(x => (x.id === set.id ? { ...x, inputs: { ...x.inputs, color: { ...x.inputs.color, connection: { nodeId: attrs.id, outputKey: 'color' } } } } : x));
    return { spec, scanId: r.scanId, nodes, attrs: attrs.id, set: set.id };
  }
  const order = (nodes: GraphNode[], id: string) => splatModifierChain(nodes, id).map(x => x.type).reverse();

  it('Edit this one adopts them as "Your nodes", in their place', () => {
    const { spec, scanId, nodes, set } = setup();
    const adopted = adoptCustomChains(nodes, scanId, spec);
    expect(adopted.effects.map(e => [e.kind, e.tail ?? null])).toEqual([['dissolve', null], ['wave', null], ['custom', set]]);
    expect(adopted.effects[2].label).toBe('Splat Attributes → Set Splat');
    // Twice is the same (nothing new to adopt).
    expect(adoptCustomChains(nodes, scanId, adopted)).toEqual(adopted);
  });

  it('a rebuild keeps them, their own wiring and their ids; moving the card moves them in the chain', () => {
    const { spec, scanId, nodes, attrs, set } = setup();
    const adopted = adoptCustomChains(nodes, scanId, spec);
    // A setting changed: the chain is as it was, your nodes included.
    let r = applySplatScene(nodes, { ...adopted, camera: { ...adopted.camera, dist: 5 } }, { nextId, scanId });
    expect(order(r.nodes, scanId)).toEqual(['splatDissolve', 'splatWave', 'splatSet']);
    const setNow = () => r.nodes.find(x => x.id === set)!, attrsNow = () => r.nodes.find(x => x.id === attrs)!;
    expect(setNow().inputs.color.connection).toEqual({ nodeId: attrs, outputKey: 'color' });
    const wave = r.nodes.find(x => x.type === 'splatWave')!.id;
    expect(attrsNow().inputs.splat.connection?.nodeId).toBe(wave);
    // Your nodes first: they read the splat as loaded; Dissolve reads from them.
    const custom = adopted.effects.find(e => e.kind === 'custom')!.id;
    const first = { ...adopted, effects: moveEffect(adopted.effects, custom, -2) };
    r = applySplatScene(r.nodes, first, { nextId, scanId });
    expect(order(r.nodes, scanId)).toEqual(['splatSet', 'splatDissolve', 'splatWave']);
    expect(setNow().inputs.splat.connection).toBeUndefined();
    expect(attrsNow().inputs.splat.connection).toBeUndefined();
    expect(r.nodes.find(x => x.type === 'splatDissolve')!.inputs.splat.connection).toEqual({ nodeId: set, outputKey: 'splat' });
    expect(setNow().inputs.color.connection).toEqual({ nodeId: attrs, outputKey: 'color' });
    // In the middle, after removing an effect: still there, between the others.
    const mid = { ...first, effects: [first.effects[1], first.effects[0]] };
    r = applySplatScene(r.nodes, mid, { nextId, scanId });
    expect(order(r.nodes, scanId)).toEqual(['splatDissolve', 'splatSet']);
    expect(r.nodes.some(x => x.type === 'splatWave')).toBe(false);
    expect(setNow().inputs.splat.connection?.nodeId).toBe(r.nodes.find(x => x.type === 'splatDissolve')!.id);
    // Off: left out of the chain, the nodes stay on the graph.
    r = applySplatScene(r.nodes, { ...mid, effects: mid.effects.map(e => (e.kind === 'custom' ? { ...e, on: false } : e)) }, { nextId, scanId });
    expect(order(r.nodes, scanId)).toEqual(['splatDissolve']);
    expect(r.nodes.some(x => x.id === set) && r.nodes.some(x => x.id === attrs)).toBe(true);
    expect(compileGraph({ nodes: r.nodes }).success).toBe(true);
    // Builder nodes are marked by role; yours aren't.
    const b = findSplatBuild(r.nodes, scanId)!;
    expect([...b.byRole.values()].some(x => x.id === set || x.id === attrs)).toBe(false);
  });

  it('templates, Surprise me and the recipe keep them', async () => {
    const { spec, scanId, nodes } = setup();
    const adopted: SplatBuilderSpec = adoptCustomChains(nodes, scanId, spec);
    const { withTemplate, splatTemplate } = await import('../templates');
    expect(withTemplate(adopted, splatTemplate('hologram')!).effects.at(-1)?.kind).toBe('custom');
    expect(surpriseSplatScene(5, adopted).effects.at(-1)?.kind).toBe('custom');
    const back = readSplatRecipe(splatRecipe(adopted), adopted);
    expect(back.errors).toEqual([]);
    expect(back.spec.effects).toEqual(adopted.effects);
  });
});

describe('the builder\'s own preview size', () => {
  it('holds the main preview to a size and lets go', () => {
    setPreviewSizeOverride({ width: 812.4, height: 721 });
    expect(previewSizeOverride()).toEqual({ width: 812, height: 721 });
    setPreviewSizeOverride({ width: 4, height: 4 });
    expect(previewSizeOverride()).toBeNull();
    setPreviewSizeOverride(null);
    expect(previewSizeOverride()).toBeNull();
  });
});

describe('your nodes as the card adds them (Splat Attributes beside Set Splat, not wired in yet)', () => {
  it('both are one run: named together, and both follow the card when it moves', () => {
    const spec = starterSplatScene();
    spec.effects = [newEffect('dissolve', 'e1'), newEffect('wave', 'e2')];
    const r0 = applySplatScene([output()], spec, { nextId });
    const nodes = addSplatModifier(r0.nodes, r0.scanId, 'custom', nextId)!;
    const attrs = nodes.find(x => x.type === 'splatAttributes')!.id, set = nodes.find(x => x.type === 'splatSet')!.id;
    const adopted = adoptCustomChains(nodes, r0.scanId, spec);
    expect(adopted.effects.at(-1)?.label).toBe('Splat Attributes → Set Splat');
    const c = adopted.effects.at(-1)!.id;
    const r = applySplatScene(nodes, { ...adopted, effects: moveEffect(adopted.effects, c, -1) }, { nextId, scanId: r0.scanId });
    const dis = r.nodes.find(x => x.type === 'splatDissolve')!.id;
    expect(r.nodes.find(x => x.id === set)!.inputs.splat.connection?.nodeId).toBe(dis);
    expect(r.nodes.find(x => x.id === attrs)!.inputs.splat.connection?.nodeId).toBe(dis);
    expect(r.nodes.find(x => x.type === 'splatWave')!.inputs.splat.connection?.nodeId).toBe(set);
  });
});
