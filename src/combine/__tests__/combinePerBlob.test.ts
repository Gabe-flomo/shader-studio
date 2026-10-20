/**
 * Combine, phase 3 (docs/combine.md "Per blob", docs/combine-plan.md §9): Replace mask with, per blob. Each listed
 * blob gets its own Blob Space (One blob, By order or By ID) and Select; the rest's fill goes on every other blob;
 * a muted fill gives its blob back to the rest; a missing product leaves its blob to the rest and says so; ids stay
 * by role when a fill moves blob or product. The attach-by semantics are checked on the CPU mirror: by order a fill
 * passes to the next blob when an older one goes; by ID it stays on its blob.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { applyScene } from '../../sceneBuilder/apply';
import { parseRecipe } from '../../sceneBuilder/recipe';
import { applyScene2D } from '../../sceneBuilder2d/apply';
import { parseRecipe2D } from '../../sceneBuilder2d/recipe';
import { applyCombine, removeCombine } from '../apply';
import { cbRoleOf } from '../meta';
import { resolveProduct } from '../products';
import { verbLine, type CombineLayer, type CombineSpec, type FillSpec, type ProductRef } from '../spec';
import { addFill, fillProducts, fillSummary, nextFillKey, removeFill, setAttachBy, setFillKey, toOneForAll, toPerBlob, updateFill, withFillIds } from '../fills';
import { presetGraph } from '../presets';
import { blobSpaceAt, type CpuBlob } from '../../nodes/definitions/blobSpace';
import { emptyTrackState, trackBlobs, visibleTracks, type Blob } from '../../lib/blobs/track';

let k = 0;
const nextId = () => `t${++k}`;
beforeEach(() => { k = 0; });

/** A photo, a second photo, a 2D build, a 3D build and the Output. */
function world() {
  let nodes: GraphNode[] = [n('output', 'out', 2000, 0)];
  const r3 = applyScene(nodes, parseRecipe('sphere r=0.5 name=Ball\ncamera dist=3').spec, { nextId, asNew: true });
  nodes = r3.nodes;
  const r2 = applyScene2D(nodes, parseRecipe2D('ring r=0.3 th=0.02 color=cyan · background night').scene, { nextId, asNew: true });
  nodes = r2.nodes;
  nodes.push(n('textureInput', 'photo', -400, 0, { fit: 'stretch' }), n('textureInput', 'photo2', -400, 300, { fit: 'stretch' }));
  return { nodes, scene: r3.sceneId, twoD: r2.sceneId };
}

const PHOTO2: ProductRef = { kind: 'node', nodeId: 'photo2', output: 'color' };

function stack(fills: FillSpec, product: ProductRef = PHOTO2): CombineSpec {
  return { v: 1, layers: [
    { id: 'L1', product: { kind: 'node', nodeId: 'photo', output: 'color' }, verb: 'base', settings: {} },
    { id: 'L2', product: { kind: 'mask', find: 'objects', classes: 'person,cat' }, verb: 'replaceMask', settings: { maxBlobs: 3 } },
    { id: 'L3', product, verb: 'replaceMask', settings: { stick: 'blobs' }, fills },
  ] };
}

function compiles(nodes: GraphNode[]) {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  return r;
}

const byRole = (glue: GraphNode[], role: string) => glue.find(g => cbRoleOf(g) === role);

describe('per blob: the glue', () => {
  it('by order: one Blob Space per fill, each on one slot, chained by Select over the picture', () => {
    const w = world();
    const spec = stack({ mode: 'perBlob', by: 'order', blobs: [
      { id: 'F1', key: 0, fill: { kind: 'build', scene: '2d', id: w.twoD } },
      { id: 'F2', key: 1, fill: PHOTO2, fit: 'circle', scale: 1.4 },
    ] });
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    const glue = r.build.glue.filter(g => cbRoleOf(g).startsWith('L3:'));
    expect(glue.map(g => g.type)).toEqual(['blobTrack', 'blobSpace', 'multiply', 'select', 'blobSpace', 'multiply', 'select']);
    const s1 = byRole(glue, 'L3:fill:F1:space')!, s2 = byRole(glue, 'L3:fill:F2:space')!;
    expect(s1.params).toMatchObject({ only: 'one', onlyBy: 'order', onlyIndex: 0 });
    expect(s2.params).toMatchObject({ only: 'one', onlyBy: 'order', onlyIndex: 1, fit: 'circle', scale: 1.4 });
    // #1 a 2D chain through the Fill field; #2 a photo through Fill texture.
    expect(s1.inputs.fill.connection).toBeTruthy();
    expect(s2.inputs.fillTexture.connection).toEqual({ nodeId: 'photo2', outputKey: 'texture' });
    // Both read the same Blob data; #2's Select sits on #1's.
    const bt = byRole(glue, 'L3:blobs')!;
    expect(s1.inputs.blobs.connection?.nodeId).toBe(bt.id);
    expect(s2.inputs.blobs.connection?.nodeId).toBe(bt.id);
    const sel1 = byRole(glue, 'L3:fill:F1:show')!, sel2 = byRole(glue, 'L3:fill:F2:show')!;
    expect(sel2.inputs.ifFalse.connection).toEqual({ nodeId: sel1.id, outputKey: 'result' });
    expect(r.build.result).toEqual({ nodeId: sel2.id, outputKey: 'result' });
    expect(String(s1.params.__comment)).toMatch(/only blob #1/);
    expect(r.build.layers.L3.passes).toBe(0);
    const res = compiles(r.nodes);
    expect(res.fragmentShader).toMatch(/fieldfn_/);
  });

  it('by ID: each Blob Space picks its tracked ID', () => {
    const w = world();
    const r = applyCombine(w.nodes, stack({ mode: 'perBlob', by: 'id', blobs: [{ id: 'F1', key: 2, fill: PHOTO2 }, { id: 'F2', key: 5, fill: { kind: 'build', scene: '2d', id: w.twoD } }] }), { nextId });
    expect(r.build.warnings).toEqual([]);
    expect(byRole(r.build.glue, 'L3:fill:F1:space')!.params).toMatchObject({ only: 'one', onlyBy: 'id', onlyIndex: 2 });
    expect(byRole(r.build.glue, 'L3:fill:F2:space')!.params).toMatchObject({ only: 'one', onlyBy: 'id', onlyIndex: 5 });
    expect(String(byRole(r.build.glue, 'L3:fill:F1:space')!.params.__comment)).toMatch(/until it is lost/);
    compiles(r.nodes);
  });

  it('the rest: a Blob Space on every blob, cut off the listed ones, under the fills', () => {
    const w = world();
    const order = applyCombine(w.nodes, stack({ mode: 'perBlob', by: 'order', rest: PHOTO2, blobs: [{ id: 'F1', key: 0, fill: { kind: 'build', scene: '2d', id: w.twoD } }, { id: 'F2', key: 2, fill: PHOTO2 }] }), { nextId });
    expect(order.build.warnings).toEqual([]);
    const rest = byRole(order.build.glue, 'L3:rest:space')!;
    expect(rest.params.only ?? 'all').toBe('all');
    const keep = byRole(order.build.glue, 'L3:rest:keep')!;
    expect(keep.type).toBe('simpleExpr');
    expect(keep.params.expr).toBe('a * step(0.5, abs(s - 0.0)) * step(0.5, abs(s - 2.0))');
    expect(keep.inputs.in2.connection).toEqual({ nodeId: rest.id, outputKey: 'slot' });
    // The rest goes on first; fill #1's Select sits on it.
    expect(byRole(order.build.glue, 'L3:fill:F1:show')!.inputs.ifFalse.connection).toEqual({ nodeId: byRole(order.build.glue, 'L3:rest:show')!.id, outputKey: 'result' });
    compiles(order.nodes);
    // By ID, the rest reads the blob's ID.
    const id = applyCombine(w.nodes, stack({ mode: 'perBlob', by: 'id', rest: PHOTO2, blobs: [{ id: 'F1', key: 1, fill: PHOTO2 }] }), { nextId });
    expect(byRole(id.build.glue, 'L3:rest:keep')!.inputs.in2.connection?.outputKey).toBe('id');
    expect(byRole(id.build.glue, 'L3:rest:keep')!.params.expr).toBe('a * step(0.5, abs(s - 1.0))');
    compiles(id.nodes);
  });

  it('a muted fill is left out: its blob gets the rest', () => {
    const w = world();
    const r = applyCombine(w.nodes, stack({ mode: 'perBlob', by: 'order', rest: PHOTO2, blobs: [{ id: 'F1', key: 0, fill: PHOTO2 }, { id: 'F2', key: 1, fill: PHOTO2, muted: true }] }), { nextId });
    expect(byRole(r.build.glue, 'L3:fill:F2:space')).toBeUndefined();
    expect(byRole(r.build.glue, 'L3:rest:keep')!.params.expr).toBe('a * step(0.5, abs(s - 0.0))');
    compiles(r.nodes);
  });

  it('a missing fill product says so; the other fills still build', () => {
    const w = world();
    const r = applyCombine(w.nodes, stack({ mode: 'perBlob', by: 'order', blobs: [{ id: 'F1', key: 0, fill: { kind: 'node', nodeId: 'gone', output: 'color' } }, { id: 'F2', key: 1, fill: PHOTO2 }] }), { nextId });
    expect(r.build.warnings.join(' ')).toMatch(/Fill #1: Product missing/);
    expect(byRole(r.build.glue, 'L3:fill:F1:space')).toBeUndefined();
    expect(byRole(r.build.glue, 'L3:fill:F2:space')).toBeTruthy();
    compiles(r.nodes);
  });

  it('a 3D fill renders in its blob (its camera UV from that Blob Space); the same scene twice is refused with a note', () => {
    const w = world();
    const s3: ProductRef = { kind: 'build', scene: '3d', id: w.scene };
    const r = applyCombine(w.nodes, stack({ mode: 'perBlob', by: 'order', blobs: [{ id: 'F1', key: 0, fill: PHOTO2 }, { id: 'F2', key: 1, fill: s3 }, { id: 'F3', key: 2, fill: s3 }] }), { nextId });
    const cam = resolveProduct(s3, r.nodes).cam!;
    const space = byRole(r.build.glue, 'L3:fill:F2:space')!;
    expect(r.nodes.find(x => x.id === cam)!.inputs.uv.connection).toEqual({ nodeId: space.id, outputKey: 'localUv' });
    expect(byRole(r.build.glue, 'L3:fill:F3:space')).toBeUndefined();
    expect(r.build.warnings.join(' ')).toMatch(/Fill #3: .* already fills another blob/);
    compiles(r.nodes);
    expect(removeCombine(r.nodes, r.anchorId!).find(x => x.id === cam)!.inputs.uv.connection).toBeUndefined();
  });

  it('Amount as a line (ƒ): one Simple Expression wired into every fill\'s Multiply', () => {
    const w = world();
    const spec = stack({ mode: 'perBlob', by: 'order', rest: PHOTO2, blobs: [{ id: 'F1', key: 0, fill: PHOTO2 }, { id: 'F2', key: 1, fill: PHOTO2 }] });
    spec.layers[2].exprs = { amount: '0.5 + 0.5 * sin(t)' };
    const r = applyCombine(w.nodes, spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    const x = byRole(r.build.glue, 'L3:x:amount')!;
    expect(x.type).toBe('simpleExpr');
    for (const role of ['L3:rest:amount', 'L3:fill:F1:amount', 'L3:fill:F2:amount']) expect(byRole(r.build.glue, role)!.inputs.b.connection).toEqual({ nodeId: x.id, outputKey: 'result' });
    compiles(r.nodes);
  });

  it('keeps node ids by role when a fill moves blob or product (wires and Play controls stay)', () => {
    const w = world();
    const spec = stack({ mode: 'perBlob', by: 'order', blobs: [{ id: 'F1', key: 0, fill: PHOTO2 }, { id: 'F2', key: 1, fill: { kind: 'build', scene: '2d', id: w.twoD } }] });
    const first = applyCombine(w.nodes, spec, { nextId });
    const next = structuredClone(spec);
    next.layers[2].fills = setFillKey(updateFill(next.layers[2].fills!, 'F2', { fill: PHOTO2 }), 'F2', 0);
    const again = applyCombine(first.nodes, next, { nextId, anchorId: first.anchorId });
    for (const role of ['L3:fill:F1:space', 'L3:fill:F2:space', 'L3:fill:F2:show']) expect(byRole(again.build.glue, role)!.id).toBe(byRole(first.build.glue, role)!.id);
    // F2 took blob #1, so F1 swapped to #2.
    expect(byRole(again.build.glue, 'L3:fill:F2:space')!.params.onlyIndex).toBe(0);
    expect(byRole(again.build.glue, 'L3:fill:F1:space')!.params.onlyIndex).toBe(1);
    compiles(again.nodes);
  });

  it('the preset "Two blobs, two looks": rings on #1, a 3D scene on #2, compiles', () => {
    const made = presetGraph('twoLooks', [n('output', 'out', 0, 0)], nextId)!;
    const r = applyCombine(made.nodes, made.spec, { nextId });
    expect(r.build.warnings).toEqual([]);
    expect(r.build.glue.filter(g => g.type === 'blobSpace').map(g => g.params.onlyIndex)).toEqual([0, 1]);
    expect(verbLine(made.spec.layers[2])).toBe('Per blob · 2 fills by order');
    compiles(r.nodes);
  });
});

describe('per blob: editing the list (fills.ts)', () => {
  const layer = (fills?: FillSpec): CombineLayer => ({ id: 'L3', product: PHOTO2, verb: 'replaceMask', settings: {}, ...(fills ? { fills } : {}) });

  it('Per blob starts with the layer\'s product on #1; One for all keeps the list for later', () => {
    const f = toPerBlob(layer());
    expect(f).toEqual({ mode: 'perBlob', by: 'order', blobs: [{ id: 'F1', key: 0, fill: PHOTO2 }] });
    const back = toOneForAll(layer(f))!;
    expect(back.mode).toBe('all');
    expect(toPerBlob(layer(back)).blobs).toEqual(f.blobs);
    expect(fillSummary(layer(f), { stick: 'blobs', fit: 'square' })).toBe('per blob by order · 1 fill');
    expect(fillSummary(layer(), { stick: 'frame', fit: 'square' })).toBe('whole mask · square');
  });

  it('Attach by order ↔ ID keeps each fill on the same blob (slot k ↔ ID k + 1)', () => {
    const f: FillSpec = { mode: 'perBlob', by: 'order', blobs: [{ id: 'F1', key: 0, fill: PHOTO2 }, { id: 'F2', key: 1, fill: PHOTO2 }] };
    const id = setAttachBy(f, 'id');
    expect(id.blobs.map(b => b.key)).toEqual([1, 2]);
    expect(setAttachBy(id, 'order').blobs.map(b => b.key)).toEqual([0, 1]);
  });

  it('adds on the next free blob, swaps when two would share one, removes, gives old entries ids', () => {
    let f: FillSpec = { mode: 'perBlob', by: 'order', blobs: [{ id: 'F1', key: 0, fill: PHOTO2 }, { id: 'F2', key: 2, fill: PHOTO2 }] };
    expect(nextFillKey(f)).toBe(1);
    f = addFill(f, PHOTO2)!;
    expect(f.blobs[2]).toMatchObject({ id: 'F3', key: 1 });
    f = setFillKey(f, 'F3', 0);
    expect(f.blobs.map(b => [b.id, b.key])).toEqual([['F1', 1], ['F2', 2], ['F3', 0]]);
    expect(removeFill(f, 'F2').blobs.map(b => b.id)).toEqual(['F1', 'F3']);
    expect(nextFillKey({ by: 'id', blobs: [] })).toBe(1);
    expect(withFillIds({ mode: 'perBlob', by: 'order', blobs: [{ key: 0, fill: PHOTO2 }, { id: 'F1', key: 1, fill: PHOTO2 }] }).blobs.map(b => b.id)).toEqual(['F2', 'F1']);
    expect(fillProducts(layer({ ...f, rest: { kind: 'node', nodeId: 'photo', output: 'color' } }))).toHaveLength(4);
  });
});

describe('attach by: when a blob goes (the CPU mirror)', () => {
  const box = (cx: number, cy: number, s = 0.1): Blob => ({ cx, cy, x0: cx - s, y0: cy - s, x1: cx + s, y1: cy + s, area: s * s * 4 });
  const cpu = (t: { cx: number; cy: number; x0: number; x1: number; y0: number; y1: number; id: number }): CpuBlob => ({ x: t.cx, y: t.cy, w: t.x1 - t.x0, h: t.y1 - t.y0, id: t.id });
  const res: [number, number] = [400, 400];

  it('the slots stay oldest first; by order #1 passes to the next blob, by ID a fill stays on its blob', () => {
    let st = emptyTrackState();
    st = trackBlobs(st, [box(0.2, 0.5), box(0.5, 0.5), box(0.8, 0.5)]);
    const seen1 = visibleTracks(st);
    expect(seen1.map(t => t.id)).toEqual([1, 2, 3]);
    // The first blob leaves; the other two stay where they were.
    st = trackBlobs(st, [box(0.5, 0.5), box(0.8, 0.5)], { memory: 0 });
    const seen2 = visibleTracks(st);
    expect(seen2.map(t => t.id)).toEqual([2, 3]);
    const blobs = seen2.map(cpu);
    // By order, fill #1 (slot 0) is now on the blob at 0.5 (ID 2), and #2 on ID 3.
    expect(blobSpaceAt([0.5, 0.5], blobs, res, { only: 'one', onlyBy: 'order', onlyIndex: 0 }).inside).toBe(1);
    expect(blobSpaceAt([0.8, 0.5], blobs, res, { only: 'one', onlyBy: 'order', onlyIndex: 1 }).id).toBe(3);
    // By ID, the fill on ID 2 stays on that blob; the fill on ID 1 shows nowhere (lost).
    expect(blobSpaceAt([0.5, 0.5], blobs, res, { only: 'one', onlyBy: 'id', onlyIndex: 2 }).inside).toBe(1);
    expect(blobSpaceAt([0.2, 0.5], blobs, res, { only: 'one', onlyBy: 'id', onlyIndex: 1 }).inside).toBe(0);
    expect(blobSpaceAt([0.5, 0.5], blobs, res, { only: 'one', onlyBy: 'id', onlyIndex: 1 }).inside).toBe(0);
    // A new blob gets a new ID (the rest's), never a lost one.
    st = trackBlobs(st, [box(0.5, 0.5), box(0.8, 0.5), box(0.2, 0.2)], { memory: 0 });
    expect(visibleTracks(st).map(t => t.id)).toEqual([2, 3, 4]);
  });
});
