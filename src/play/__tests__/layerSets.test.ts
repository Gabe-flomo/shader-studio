/**
 * Layer sets (docs/presets.md): what a set captures and what it leaves out
 * (listed), loading with fresh ids and every reference rewired (mappings,
 * actions, signals, mattes, relationships, pairs, readers, folders), control
 * names deduped, the Background's matte, shader knobs this graph lacks, the
 * list in storage, the Files page, a .playfile round trip, and one undo step.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  g.addEventListener = () => undefined;
  g.removeEventListener = () => undefined;
  const mem = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import { captureLayerSet, loadLayerSet, loadLayerSets, parseLayerSet, saveLayerSet, deleteLayerSet, renameLayerSet, LAYER_SETS_KEY, type ListKV, type LayerSet } from '../layerSets';
import { defaultLayer, emptyPlayRecord, layerTarget, actionTarget, type PlayRecord, type PlayLayer } from '../../types/play';
import type { RelationshipLayer, VideoLayer } from '../../types/playLayers';
import { buildInventory } from '../../files/inventory';
import { memoryKV } from '../../files/mutate';
import { buildBundle, videoIdsIn } from '../../playfile/bundle';
import { writePlayfile } from '../../playfile/writer';
import { readPlayfile } from '../../playfile/reader';
import { applyImport, planImport, type ImportEnv } from '../../playfile/importer';
import { installMerge } from '../../files/profileZip';

function mapKV(init: Record<string, string> = {}): ListKV & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, get: k => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}

const L = (kind: Parameters<typeof defaultLayer>[0], id: string, label: string, over: Record<string, unknown> = {}) =>
  ({ ...defaultLayer(kind, id, label), ...over }) as PlayLayer;

/**
 * A: a shape, B: particles (matted by A), R: a relationship of A and C, V: a
 * video with readers on its sound, C: a text layer that stays out of the set.
 */
function setup(): PlayRecord {
  const rel = L('relationship', 'R', 'Chase') as RelationshipLayer;
  rel.members = [{ id: 'A', role: 'chaser', mass: 1, picture: 'off', channel: 'brightness', layerId: '', radius: 0.06 }, { id: 'C', role: 'prey', mass: 1, picture: 'off', channel: 'brightness', layerId: '', radius: 0.06 }];
  (rel as unknown as Record<string, unknown>).catchSignal = 'sigCatch';
  const video = L('video', 'V', 'Clip', { videoId: 'vid_1', fileName: 'clip.mp4' }) as VideoLayer;
  return {
    ...emptyPlayRecord(),
    layers: [
      L('background', 'bg', 'Background'),
      L('shape', 'A', 'Ring', { trackMatte: { id: 'C', mode: 'alpha', invert: false } }),
      L('particles', 'B', 'Sparks', { trackMatte: { id: 'A', mode: 'alpha', invert: false } }),
      rel,
      video,
      L('text', 'C', 'Title'),
    ],
    groups: [{ id: 'g1', label: 'Pair', colour: 'teal', layers: ['A', 'B'] }],
    controls: [
      { id: 'c1', target: layerTarget('A', 'size'), kind: 'float', label: 'Ring · Size', min: 0, max: 1 },
      { id: 'c2', target: layerTarget('B', 'opacity'), kind: 'float', label: 'Sparks · Opacity', min: 0, max: 1 },
      { id: 'c3', target: layerTarget('C', 'opacity'), kind: 'float', label: 'Radius', min: 0, max: 1 },
      { id: 'c4', target: 'node1::scale', kind: 'float', label: 'Scale', min: 0, max: 4 },
      { id: 'c5', target: actionTarget('B', 'burst'), kind: 'action', label: 'Sparks · Burst', min: 0, max: 1, amount: 60 },
      { id: 'c6', target: 'reader:rd1::level', kind: 'float', label: 'Lows', min: 0, max: 1 },
      { id: 'c7', target: 'finish:fx1::amount', kind: 'float', label: 'Glow', min: 0, max: 1 },
    ],
    mappings: [
      // Inside: A's fill drives B's opacity.
      { id: 'm1', controlId: 'c2', source: { kind: 'sensor', layerId: 'A', read: 'fill', otherId: '' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      // Its source is a shader knob: the knob comes along.
      { id: 'm2', controlId: 'c1', source: { kind: 'control', controlId: 'c4' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      // Out: Lows (a reader on the video, in) → Radius (C, out).
      { id: 'm3', controlId: 'c3', source: { kind: 'control', controlId: 'c6' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      // Inside: a MIDI knob, no setup references at all.
      { id: 'm4', controlId: 'c1', source: { kind: 'midi', signal: 'cc', channel: 0, cc: 1 }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      // Out: reads C's position.
      { id: 'm5', controlId: 'c2', source: { kind: 'sensor', layerId: 'C', read: 'hover', otherId: '' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      // Inside: the reader drives its control.
      { id: 'm6', controlId: 'c6', source: { kind: 'reader', readerId: 'rd1' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      // Out: the Finish stack.
      { id: 'm7', controlId: 'c7', source: { kind: 'sensor', layerId: 'A', read: 'fill', otherId: '' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
    ],
    actions: [
      { id: 'a1', trigger: { on: 'zone', layerId: 'A', event: 'click', threshold: 0.5 }, do: 'burst', layerId: 'B', amount: 40, enabled: true },
      { id: 'a2', trigger: { on: 'key', code: 'KeyT' }, do: 'toggle', layerId: 'C', amount: 1, enabled: true },
      { id: 'a3', trigger: { on: 'zone', layerId: 'C', event: 'click', threshold: 0.5 }, do: 'burst', layerId: 'B', amount: 40, enabled: true },
      { id: 'a4', trigger: { on: 'signal', signal: 'sigCatch' }, do: 'signal', layerId: '', amount: 1, enabled: true, signal: 'sigPop' },
      { id: 'a5', trigger: { on: 'signal', signal: 'sigPop' }, do: 'reset', layerId: 'B', amount: 1, enabled: true },
    ],
    signals: [{ id: 'sigCatch', name: 'Caught' }, { id: 'sigPop', name: 'Pop' }, { id: 'sigOther', name: 'Other' }],
    pairs: [
      { id: 'p1', label: 'Ring and sparks', a: 'c1', b: 'c2', position: false },
      { id: 'p2', label: 'Half out', a: 'c1', b: 'c3', position: false },
    ],
    audioReaders: { input: 'video:V', readers: [{ id: 'rd1', name: 'Lows', hz: 80, width: 1 / 3, gain: 20, attack: 5, release: 150, colour: [1, 0.5, 0.2] }] },
    backgroundMatte: { id: 'A', mode: 'luma', feather: 4 },
  };
}

const PICK = ['A', 'B', 'R', 'V'];

describe('layer sets: capture', () => {
  it('takes the picked layers with the pieces wholly inside, and lists what touches the set but is left out', () => {
    const cap = captureLayerSet(setup(), PICK);
    const p = cap.play;
    expect(p.layers.map(l => l.id)).toEqual(['A', 'B', 'R', 'V']);
    // Controls on set layers, the reader's control, and the shader knob a carried mapping reads.
    expect(p.controls.map(c => c.id).sort()).toEqual(['c1', 'c2', 'c4', 'c5', 'c6']);
    expect(p.mappings.map(m => m.id).sort()).toEqual(['m1', 'm2', 'm4', 'm6']);
    expect(p.actions?.map(a => a.id).sort()).toEqual(['a1', 'a4', 'a5']);
    expect(p.signals?.map(s => s.id).sort()).toEqual(['sigCatch', 'sigPop']);
    expect(p.pairs?.map(x => x.id)).toEqual(['p1']);
    expect(p.audioReaders?.readers.map(r => r.id)).toEqual(['rd1']);
    expect(p.groups?.map(g => g.id)).toEqual(['g1']);
    expect(cap.backgroundMatte?.id).toBe('A');
    expect(cap.media).toEqual([{ id: 'vid_1', kind: 'video', linked: false, name: 'clip.mp4', layer: 'Clip' }]);
    // B's matte (A) is inside; A's matte (C) and C's place in the relationship are cut.
    expect(p.layers.find(l => l.id === 'B')?.trackMatte?.id).toBe('A');
    expect(p.layers.find(l => l.id === 'A')?.trackMatte).toBeUndefined();
    expect((p.layers.find(l => l.id === 'R') as RelationshipLayer).members.map(m => m.id)).toEqual(['A']);
    const words = cap.excluded.join('\n');
    expect(words).toContain('mapping Lows → Radius (“Radius” isn\'t in the set)');
    expect(words).toContain('“Ring”: its matte, “Title”');
    expect(words).toContain('“Chase”: a member, “Title”');
    expect(words).toContain('mapping Title hover → Sparks · Opacity (“Title” isn\'t in the set)');
    expect(words).toContain('mapping Ring fill → Glow');
    expect(words).toContain('action “burst” on “Sparks” (“Title” isn\'t in the set)');
    expect(words).toContain('pair “Half out”');
    // An action that doesn't touch the set isn't mentioned.
    expect(words).not.toContain('toggle');
  });

  it('leaves the readers out when they listen to something outside the set', () => {
    const p = setup();
    p.audioReaders = { ...p.audioReaders!, input: '' };
    const cap = captureLayerSet(p, PICK);
    expect(cap.play.audioReaders).toBeUndefined();
    expect(cap.play.controls.some(c => c.id === 'c6')).toBe(false);
    expect(cap.play.mappings.some(m => m.source.kind === 'reader')).toBe(false);
  });
});

describe('layer sets: load', () => {
  let n = 0;
  const newId = (k: string) => `${k}_new${++n}`;

  function target(): PlayRecord {
    return {
      ...emptyPlayRecord(),
      layers: [L('background', 'bg2', 'Background'), L('shape', 'X', 'Ring')],
      controls: [{ id: 'cx', target: layerTarget('X', 'size'), kind: 'float', label: 'Scale', min: 0, max: 1 }],
      signals: [{ id: 'mine', name: 'Pop' }],
    };
  }

  it('gives every piece a fresh id and points every reference at the new ids', () => {
    const cap = captureLayerSet(setup(), PICK);
    const r = loadLayerSet(target(), { name: 'Sparky', ...cap }, { newId });
    const p = r.play;
    const newIds = r.layerIds;
    expect(newIds).toHaveLength(4);
    for (const id of newIds) expect(['A', 'B', 'R', 'V']).not.toContain(id);
    const byOld = (label: string) => p.layers.find(l => l.label === label)!;
    const A = byOld('Ring (2)'), B = byOld('Sparks'), R = byOld('Chase') as RelationshipLayer, V = byOld('Clip');
    // Placed at the top of the list, under the Background, in a folder named after the set.
    expect(p.layers.map(l => l.id)).toEqual(['bg2', A.id, B.id, R.id, V.id, 'X']);
    const folder = p.groups!.find(g => g.label === 'Sparky')!;
    expect(folder.layers.sort()).toEqual([R.id, V.id].sort());
    const inner = p.groups!.find(g => g.label === 'Pair')!;
    expect(inner.parent).toBe(folder.id);
    expect(inner.layers).toEqual([A.id, B.id]);
    // Matte and relationship.
    expect(B.trackMatte?.id).toBe(A.id);
    expect(R.members.map(m => m.id)).toEqual([A.id]);
    // Controls: targets on the new layers, names following the renamed layer and deduped.
    const ctl = (label: string) => p.controls.find(c => c.label === label)!;
    expect(ctl('Ring (2) · Size').target).toBe(layerTarget(A.id, 'size'));
    expect(ctl('Sparks · Burst').target).toBe(actionTarget(B.id, 'burst'));
    expect(ctl('Scale (2)').target).toBe('node1::scale');
    expect(ctl('Scale').id).toBe('cx');
    // Mappings.
    const m1 = p.mappings.find(m => m.source.kind === 'sensor')!;
    expect(m1.source).toMatchObject({ layerId: A.id });
    expect(m1.controlId).toBe(ctl('Sparks · Opacity').id);
    const m2 = p.mappings.find(m => m.source.kind === 'control')!;
    expect(m2.source).toMatchObject({ controlId: ctl('Scale (2)').id });
    expect(m2.controlId).toBe(ctl('Ring (2) · Size').id);
    // Actions and signals: "Pop" is the setup's own signal; "Caught" is new; the relationship sends the new one.
    const caught = p.signals!.find(s => s.name === 'Caught')!;
    expect(p.signals!.filter(s => s.name === 'Pop')).toEqual([{ id: 'mine', name: 'Pop' }]);
    expect((R as unknown as Record<string, unknown>).catchSignal).toBe(caught.id);
    const acts = p.actions!;
    expect(acts.find(a => a.do === 'burst')).toMatchObject({ layerId: B.id, trigger: { on: 'zone', layerId: A.id } });
    expect(acts.find(a => a.do === 'signal')).toMatchObject({ signal: 'mine', trigger: { on: 'signal', signal: caught.id } });
    expect(acts.find(a => a.do === 'reset')).toMatchObject({ layerId: B.id, trigger: { on: 'signal', signal: 'mine' } });
    // Pair, readers, Background matte.
    expect(p.pairs![0]).toMatchObject({ a: ctl('Ring (2) · Size').id, b: ctl('Sparks · Opacity').id });
    expect(p.audioReaders?.input).toBe(`video:${V.id}`);
    const rd = p.audioReaders!.readers[0];
    expect(rd.id).not.toBe('rd1');
    expect(ctl('Lows').target).toBe(`reader:${rd.id}::level`);
    expect(p.mappings.find(m => m.source.kind === 'reader')?.source).toMatchObject({ readerId: rd.id });
    expect(p.backgroundMatte).toEqual({ id: A.id, mode: 'luma', feather: 4 });
    expect(r.notes).toEqual([]);
    // Loading twice gives two independent copies.
    const again = loadLayerSet(p, { name: 'Sparky', ...cap }, { newId });
    expect(new Set(again.play.layers.map(l => l.id)).size).toBe(again.play.layers.length);
    expect(again.play.groups!.some(g => g.label === 'Sparky (2)')).toBe(true);
    expect(again.notes.join()).toContain('readers');
    expect(again.notes.join()).toContain('Background');
  });

  it('places the layers after the selected layer', () => {
    const cap = captureLayerSet(setup(), ['B']);
    const t = target();
    t.layers.push(L('text', 'Y', 'Words'));
    const r = loadLayerSet(t, { name: 'One', ...cap }, { newId, after: 'X' });
    expect(r.play.layers.map(l => l.id)).toEqual(['bg2', 'X', r.layerIds[0], 'Y']);
  });

  it('drops a shader knob this graph doesn\'t have, and what used it', () => {
    const cap = captureLayerSet(setup(), PICK);
    const r = loadLayerSet(target(), { name: 'S', ...cap }, { newId, graphHas: () => false });
    expect(r.play.controls.some(c => c.target === 'node1::scale')).toBe(false);
    expect(r.play.mappings.some(m => m.source.kind === 'control' && !r.play.controls.some(c => c.id === (m.source as { controlId: string }).controlId))).toBe(false);
    expect(r.notes.join('\n')).toContain('“Scale”');
  });
});

describe('layer sets: storage, the Files page and the .playfile', () => {
  it('saves, reads back, renames and deletes', () => {
    const kv = mapKV();
    const cap = captureLayerSet(setup(), PICK);
    const { result, set } = saveLayerSet('Sparky', cap, { note: 'Two layers that play together', poster: 'data:image/jpeg;base64,AAAA' }, kv);
    expect(result.ok).toBe(true);
    const list = loadLayerSets(kv);
    expect(list).toHaveLength(1);
    expect(list[0].note).toBe('Two layers that play together');
    expect(list[0].poster).toBe('data:image/jpeg;base64,AAAA');
    expect(list[0].play.mappings).toHaveLength(4);
    // Same name replaces, keeping the id.
    saveLayerSet('Sparky', captureLayerSet(setup(), ['A']), {}, kv);
    expect(loadLayerSets(kv).map(s => [s.id, s.play.layers.length])).toEqual([[set!.id, 1]]);
    renameLayerSet(set!.id, 'Ring', kv);
    expect(loadLayerSets(kv)[0].name).toBe('Ring');
    deleteLayerSet(set!.id, kv);
    expect(loadLayerSets(kv)).toEqual([]);
    expect(parseLayerSet({ id: 'x', play: { layers: [] } })).toBeNull();
  });

  it('round-trips through a .playfile: listed under Presets → Layer sets, bundled with its video, imported and loaded wired', async () => {
    const cap = captureLayerSet(setup(), PICK);
    const kvList = mapKV();
    const { set } = saveLayerSet('Sparky', cap, { poster: 'data:image/jpeg;base64,AAAA' }, kvList);
    const kv = memoryKV({ [LAYER_SETS_KEY]: kvList.data.get(LAYER_SETS_KEY)! });
    const inv = await buildInventory(kv);
    expect(inv.byId.get('section:presets/layer-sets')?.label).toBe('Layer sets');
    const node = inv.byId.get(`lset:${set!.id}`)!;
    expect(node.detail).toBe('4 layers · 5 controls · 4 mappings · 3 actions');
    expect(node.thumb).toBe('data:image/jpeg;base64,AAAA');
    expect(inv.sections.find(s => s.section === 'graphs')?.children).toEqual([]);
    const bundle = await buildBundle(kv, inv, [node.id], { dependencies: false });
    expect(bundle.items.map(i => i.kind)).toEqual(['library']);
    expect(videoIdsIn(bundle.items)).toEqual(['vid_1']);
    const { bytes } = await writePlayfile(bundle.items, { author: 'Ada' });
    // Another machine.
    const other = memoryKV({});
    const env = { kv: other, can: () => true, installProfile: async (pr: Parameters<typeof installMerge>[0]) => installMerge(pr, other), now: () => 1 } as unknown as ImportEnv;
    const plan = await planImport(await readPlayfile(bytes), env);
    await applyImport(plan, {}, env);
    const back = loadLayerSets({ get: k => other.get(k), set: (k, v) => { other.set(k, v); } });
    expect(back.map(s => s.name)).toEqual(['Sparky']);
    const loaded: LayerSet = back[0];
    expect(loaded.play).toEqual(set!.play);
    const r = loadLayerSet({ ...emptyPlayRecord() }, loaded);
    expect(r.play.layers).toHaveLength(4);
    expect(r.play.mappings).toHaveLength(4);
    const A = r.play.layers.find(l => l.label === 'Ring')!;
    expect(r.play.mappings.find(m => m.source.kind === 'sensor')?.source).toMatchObject({ layerId: A.id });
  });
});

describe('layer sets: undo', () => {
  it('loading is one undo step', async () => {
    const { useNodeGraphStore, undoManager } = await import('../../store/useNodeGraphStore');
    undoManager.clear();
    const start = setup();
    useNodeGraphStore.setState({ play: start } as never);
    const cap = captureLayerSet(start, ['A', 'B']);
    useNodeGraphStore.getState().setPlay(p => loadLayerSet(p, { name: 'Two', ...cap }).play, { label: 'Added the set “Two”' });
    expect(useNodeGraphStore.getState().play.layers.length).toBe(start.layers.length + 2);
    expect(undoManager.done()).toHaveLength(1);
    useNodeGraphStore.getState().undo();
    expect(useNodeGraphStore.getState().play).toEqual(start);
  });
});
