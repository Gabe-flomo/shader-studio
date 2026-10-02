/**
 * The Background layer: a queue of sources under every layer. Its index and
 * offset math, the Change background actions (fired live, captured by a take,
 * replayed by a fresh kit frame for frame), the crossfade, the rule that ties
 * it to the header's Background setting, its file format, and what web pages
 * carry of it (graphs compiled into the bundle).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// The graph store (queueGraphs migrates nodes through it) reads saved presets on load.
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { ACTION_KINDS, actionsForLayer, backgroundLayerOf, defaultLayer, emptyPlayRecord, parsePlayRecordAsSaved, parseTake, queueSlot, type BackgroundItem, type BackgroundLayer, type PlayRecord } from '../../types/play';
import { BACKGROUND_QUEUE_MAX } from '../../types/playLayers';
import { bqAct, bqPlan, bqSlot, bqState } from '../kit/queue.js';
import { createLayerKit } from '../kit/kit.js';
import { addBackground, addSources, headerBackground, moveSource, removeSource, renameSource, updateSource } from '../backgroundQueue';
import { buildPlayHtml, kitScript, leftBehind, mediaCarried, playBundle, type PlayHtmlInput } from '../exportHtml';
import { compiledQueueGraph, queueGraphsForWeb } from '../queueGraphs';
import { BLANK_GRAPH } from '../../store/exampleIndex';
import { TakeCapture, takeApplier } from '../../lib/takes';
import { playOverlay } from '../overlay';
import { playBackground } from '../background';
import { playEngine } from '../../lib/playEngine';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29t';

const src = (id: string, kind: BackgroundItem['kind'], extra: Partial<BackgroundItem> = {}): BackgroundItem => ({ id, kind, name: id.toUpperCase(), ...extra });
const QUEUE: BackgroundItem[] = [
  src('a', 'graph', { graph: 'this' }),
  src('b', 'image', { src: PNG }),
  src('c', 'colour', { colour: [1, 0, 0] }),
];
function layer(over: Partial<BackgroundLayer> = {}): BackgroundLayer {
  return { ...(defaultLayer('background', 'bg', 'Background') as BackgroundLayer), sources: QUEUE, ...over };
}
const valueOf = (l: BackgroundLayer, live: Record<string, number> = {}) => (k: string) => (k in live ? live[k] : (l as unknown as Record<string, number>)[k]);

describe('which source shows', () => {
  it('index + steps + offset, wrapped both ways', () => {
    expect(queueSlot(0, 0, 0, 3)).toBe(0);
    expect(queueSlot(2, 1, 0, 3)).toBe(0);
    expect(queueSlot(0, -1, 0, 3)).toBe(2);
    expect(queueSlot(0, 0, 1, 3)).toBe(1);
    expect(queueSlot(1, 0, -4, 3)).toBe(0);
    // A mapped index lands on the nearest source.
    expect(queueSlot(1.6, 0, 0, 3)).toBe(2);
    expect(queueSlot(0, 0, 0, 0)).toBe(-1);
    // The kit's copy agrees.
    for (const [i, s, o] of [[0, 0, 0], [2, 5, -1], [-3, 1, 7], [1.49, 0, 2]]) expect(bqSlot(i, s, o, 3)).toBe(queueSlot(i, s, o, 3));
  });

  it('Next, Previous, Go to N and Reset step the queue; Random never repeats', () => {
    const l = layer();
    const v = valueOf(l);
    const st = bqState();
    const at = () => bqSlot(v('index'), st.step, v('offset'), 3);
    bqAct(st, l, v, { do: 'next' }, Math.random); expect(at()).toBe(1);
    bqAct(st, l, v, { do: 'next' }, Math.random); bqAct(st, l, v, { do: 'next' }, Math.random); expect(at()).toBe(0);
    bqAct(st, l, v, { do: 'prev' }, Math.random); expect(at()).toBe(2);
    bqAct(st, l, v, { do: 'goto', amount: 2 }, Math.random); expect(at()).toBe(1);
    // Go to counts from 1 and stays in the queue.
    bqAct(st, l, v, { do: 'goto', amount: 99 }, Math.random); expect(at()).toBe(2);
    for (let i = 0; i < 20; i++) { const before = at(); bqAct(st, l, v, { do: 'shuffle' }, Math.random); expect(at()).not.toBe(before); }
    bqAct(st, l, v, { do: 'reset' }, Math.random); expect(at()).toBe(0);
    // Go to N means the Nth source whatever the offset.
    const off = layer({ offset: 1 }); const vo = valueOf(off); const s2 = bqState();
    bqAct(s2, off, vo, { do: 'goto', amount: 3 }, Math.random);
    expect(bqSlot(vo('index'), s2.step, vo('offset'), 3)).toBe(2);
    expect(bqAct(s2, off, vo, { do: 'toggle' }, Math.random)).toBe(false);
  });

  it('cuts, or crossfades over the duration on the graph clock', () => {
    const cut = layer({ transition: 'cut' });
    const st = bqState();
    expect(bqPlan(st, cut, valueOf(cut), 0, true).items.map(i => i.item.id)).toEqual(['a']);
    const p = bqPlan(st, cut, valueOf(cut, { index: 1 }), 1, true);
    expect(p.items).toEqual([{ item: QUEUE[1], alpha: 1 }]);
    expect(p.fading).toBe(false);

    const fade = layer({ transition: 'fade', duration: 2 });
    const f = bqState();
    bqPlan(f, fade, valueOf(fade), 0, true);
    const mid = bqPlan(f, fade, valueOf(fade, { index: 2 }), 10, true);
    expect(mid.items.map(i => [i.item.id, i.alpha])).toEqual([['a', 1], ['c', 0]]);
    // Asking again at the same time answers the same (the host asks, then the kit).
    expect(bqPlan(f, fade, valueOf(fade, { index: 2 }), 10, true).items).toEqual(mid.items);
    expect(bqPlan(f, fade, valueOf(fade, { index: 2 }), 11, true).items.map(i => [i.item.id, i.alpha])).toEqual([['a', 1], ['c', 0.5]]);
    const done = bqPlan(f, fade, valueOf(fade, { index: 2 }), 12, true);
    expect(done.items.map(i => i.item.id)).toEqual(['c']);
    expect(done.fading).toBe(false);
    // The clock sent back mid-fade finishes the change.
    bqPlan(f, fade, valueOf(fade, { index: 0 }), 20, true);
    expect(bqPlan(f, fade, valueOf(fade, { index: 0 }), 5, true).items.map(i => i.item.id)).toEqual(['a']);
  });

  it('draws one untransformed graph straight to the GL canvas; anything else is composed', () => {
    const l = layer();
    expect(bqPlan(bqState(), l, valueOf(l), 0, true, true).direct).toBe(true);
    expect(bqPlan(bqState(), l, valueOf(l), 0, true, false).direct).toBe(false);
    expect(bqPlan(bqState(), l, valueOf(l, { scale: 1.5 }), 0, true, true).direct).toBe(false);
    expect(bqPlan(bqState(), l, valueOf(l, { index: 1 }), 0, true, true).direct).toBe(false);
    // Hidden: nothing shows (the colour alone).
    expect(bqPlan(bqState(), l, valueOf(l), 0, false, true).items).toEqual([]);
  });
});

describe('the kit', () => {
  const record = (l: BackgroundLayer = layer()): PlayRecord => ({ ...emptyPlayRecord(), layers: [l, defaultLayer('text', 't', 'Words')] });
  const env = (time: number) => ({ time, value: (l: { id: string }, k: string) => (l as unknown as Record<string, number>)[k], allowDirect: true });

  it('carries out Change background actions and leaves the others for their layers', () => {
    const kit = createLayerKit();
    const rec = record();
    expect(kit.background(rec, env(0))!.slot).toBe(0);
    kit.act({ do: 'next', layerId: 'bg', amount: 1 });
    kit.act({ do: 'next', layerId: 't', amount: 1 });
    expect(kit.background(rec, env(1))!.slot).toBe(1);
    kit.act({ do: 'goto', layerId: 'bg', amount: 3 });
    expect(kit.background(rec, env(2))!.slot).toBe(2);
    kit.act({ do: 'hide', layerId: 'bg', amount: 1 });
    expect(kit.background(rec, env(3))!.items).toEqual([]);
    expect(kit.background({ ...emptyPlayRecord(), layers: [] }, env(4))).toBeNull();
  });

  it('a fresh kit given the same actions at the same times makes the same changes, Random too', () => {
    const rec = record(layer({ transition: 'fade', duration: 0.5 }));
    const script: [number, string, number][] = [[0.2, 'next', 1], [0.9, 'shuffle', 1], [1.3, 'goto', 1], [2.1, 'shuffle', 1], [2.2, 'prev', 1]];
    const run = () => {
      const kit = createLayerKit();
      kit.reset(12345);
      const out: string[] = [];
      for (let f = 0; f <= 180; f++) {
        const t = f / 60;
        for (const [at, d, amount] of script) if (Math.abs(at - t) < 1e-9 || (at > t - 1 / 60 && at <= t)) kit.act({ do: d as 'next', layerId: 'bg', amount });
        const p = kit.background(rec, env(t))!;
        out.push(p.items.map(i => `${i.item.id}:${i.alpha.toFixed(3)}`).join(','));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('is moving while it crossfades or a sketch shows', () => {
    const kit = createLayerKit();
    const rec = record(layer({ sources: [...QUEUE, src('s', 'script', { code: 'function draw(s) {}' })] }));
    kit.background(rec, env(0));
    expect(kit.isAnimated(rec)).toBe(false);
    kit.act({ do: 'goto', layerId: 'bg', amount: 4 });
    kit.background(rec, env(1));
    expect(kit.isAnimated(rec)).toBe(true);
  });
});

describe('takes', () => {
  afterEach(() => { playOverlay.setRecord(emptyPlayRecord()); });

  it('record Change background actions, and a render replays them at their times', () => {
    const rec: PlayRecord = { ...emptyPlayRecord(), layers: [layer()] };
    playOverlay.setRecord(rec);
    vi.spyOn(playEngine, 'liveValue').mockImplementation(() => undefined);
    const c = new TakeCapture(rec);
    c.sample(1);
    playOverlay.act({ do: 'next', layerId: 'bg', amount: 1 });
    c.sample(1.5);
    playOverlay.act({ do: 'goto', layerId: 'bg', amount: 3 });
    c.sample(2);
    c.sample(3);
    const take = c.toTake('Changes')!;
    c.dispose();
    expect(take.events).toEqual([{ t: 0.5, do: 'next', layerId: 'bg', amount: 1 }, { t: 1, do: 'goto', layerId: 'bg', amount: 3 }]);
    // Saved and read back, the Go to survives.
    expect(parseTake(JSON.parse(JSON.stringify(take)))!.events).toEqual(take.events);
    // A render: the take's events by frame, into a fresh kit.
    const ap = takeApplier(take, { setUniform: () => {}, width: 1, height: 1 });
    const kit = createLayerKit();
    const slots: number[] = [];
    for (let f = 0; f <= 60; f++) {
      const t = 1 + f / 30;
      for (const a of ap.apply(t)) kit.act(a);
      slots.push(kit.background(rec, { time: t, value: (l, k) => (l as unknown as Record<string, number>)[k] })!.slot);
    }
    expect(slots[0]).toBe(0);
    expect(slots[15]).toBe(1);
    expect(slots[30]).toBe(2);
    expect(slots[60]).toBe(2);
  });
});

describe('the header and the layer', () => {
  it('choosing an image adds a Background layer with it first; at most one, always at the bottom', () => {
    const p0: PlayRecord = { ...emptyPlayRecord(), layers: [defaultLayer('text', 't', 'Words')], display: { picture: true, backdrop: [0, 0, 0], source: 'colour' } };
    expect(headerBackground(p0)).toBe('colour');
    const { play: p1, id } = addBackground(p0, [src('img', 'image', { src: PNG })]);
    expect(p1.layers[0].id).toBe(id);
    expect(backgroundLayerOf(p1)!.sources.map(s => s.id)).toEqual(['img']);
    expect(headerBackground(p1)).toBe('layer');
    // A second one adds to the first instead.
    const { play: p2, id: again } = addBackground(p1, [src('g', 'graph', { graph: 'this' })]);
    expect(again).toBe(id);
    expect(p2.layers.filter(l => l.kind === 'background')).toHaveLength(1);
    expect(backgroundLayerOf(p2)!.sources.map(s => s.id)).toEqual(['img', 'g']);
    // Removing the layer gives the picture back to the header's setting, untouched.
    const p3 = { ...p2, layers: p2.layers.filter(l => l.kind !== 'background') };
    expect(headerBackground(p3)).toBe('colour');
    expect(p3.display).toEqual(p0.display);
  });

  it('edits the queue: rename, change, remove and reorder keep the showing source', () => {
    let p = addBackground(emptyPlayRecord(), QUEUE).play;
    p = { ...p, layers: [{ ...(p.layers[0] as BackgroundLayer), index: 2 }] };
    p = renameSource(p, 'b', '  Sky  ');
    expect(backgroundLayerOf(p)!.sources[1].name).toBe('Sky');
    p = updateSource(p, 'c', { colour: [0, 0, 1], kind: 'image' } as Partial<BackgroundItem>);
    expect(backgroundLayerOf(p)!.sources[2]).toMatchObject({ kind: 'colour', colour: [0, 0, 1] });
    p = moveSource(p, 'c', 0);
    expect(backgroundLayerOf(p)!.sources.map(s => s.id)).toEqual(['c', 'a', 'b']);
    expect(backgroundLayerOf(p)!.index).toBe(0);
    p = removeSource(p, 'a');
    expect(backgroundLayerOf(p)!.sources.map(s => s.id)).toEqual(['c', 'b']);
    expect(backgroundLayerOf(p)!.index).toBe(0);
    p = addSources(p, Array.from({ length: 40 }, (_, i) => src(`x${i}`, 'colour', { colour: [0, 0, 0] })));
    expect(backgroundLayerOf(p)!.sources).toHaveLength(BACKGROUND_QUEUE_MAX);
  });

  it('offers Change background actions on the layer', () => {
    expect(actionsForLayer(layer())).toEqual(['next', 'prev', 'shuffle', 'goto', 'reset', 'toggle', 'show', 'hide']);
    expect(ACTION_KINDS).toContain('goto');
  });
});

describe('files', () => {
  it('a record round-trips: every kind of source, the settings, and Go to actions', () => {
    const l = layer({
      index: 2, offset: 1, x: 0.4, y: 0.6, scale: 1.2, rotation: 15, fit: 'contain', colour: [0.1, 0.2, 0.3], transition: 'cut', duration: 1.5,
      sources: [
        src('a', 'graph', { graph: 'this' }),
        src('e', 'graph', { graph: 'example:fractalRings' }),
        src('s', 'graph', { graph: 'saved:My graph', nodes: BLANK_GRAPH.nodes }),
        src('k', 'script', { code: 'function draw(s) {}' }),
        src('i', 'image', { src: PNG }),
        src('v', 'video', { src: MP4, bytes: 12, loop: false, muted: false, rate: 2 }),
        src('c', 'colour', { colour: [1, 0.5, 0] }),
      ],
    });
    const rec: PlayRecord = { ...emptyPlayRecord(), layers: [l], actions: [{ id: 'a1', trigger: { on: 'key', code: 'Digit2' }, do: 'goto', layerId: 'bg', amount: 2, enabled: true }] };
    const back = parsePlayRecordAsSaved(JSON.parse(JSON.stringify(rec)));
    expect(back.layers[0]).toEqual(l);
    expect(back.actions).toEqual(rec.actions);
  });

  it('keeps one Background layer, first; drops sources that aren’t valid', () => {
    const rec = parsePlayRecordAsSaved({
      version: 1, controls: [], mappings: [],
      layers: [
        defaultLayer('text', 't', 'Words'),
        { ...layer(), sources: [
          ...QUEUE,
          { id: 'x', kind: 'image', src: 'https://example.com/a.png' },
          { id: 'y', kind: 'graph', graph: 'saved:Gone' },
          { id: 'a', kind: 'colour', colour: [1, 1, 1] },
          { id: 'z', kind: 'hologram' },
          { id: 'v', kind: 'video', name: 'big.mov', src: '', bytes: 99_000_000 },
        ] },
        { ...layer(), id: 'bg2' },
      ],
    });
    expect(rec.layers.map(l => l.id)).toEqual(['bg', 't']);
    expect((rec.layers[0] as BackgroundLayer).sources.map(s => s.id)).toEqual(['a', 'b', 'c', 'v']);
    // A video too big to keep keeps its name and size: the panel asks for it again.
    expect((rec.layers[0] as BackgroundLayer).sources[3]).toMatchObject({ src: '', bytes: 99_000_000 });
  });
});

describe('web pages and presentations', () => {
  const rec = (sources: BackgroundItem[]): PlayRecord => ({ ...emptyPlayRecord(), layers: [layer({ sources })] });
  const input = (play: PlayRecord, backgroundGraphs?: PlayHtmlInput['backgroundGraphs']): PlayHtmlInput => ({ title: 'T', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play, aspect: 'free' as PlayHtmlInput['aspect'], ...(backgroundGraphs ? { backgroundGraphs } : {}) });

  it('compiles a saved graph source into the bundle (and leaves its nodes out)', () => {
    const play = rec([src('a', 'graph', { graph: 'this' }), src('s', 'graph', { graph: 'saved:Glow', nodes: BLANK_GRAPH.nodes })]);
    const c = compiledQueueGraph(backgroundLayerOf(play)!.sources[1]);
    expect(c && c !== 'loading' && !('error' in c) && c.fragmentShader.length).toBeGreaterThan(50);
    const { graphs, missing } = queueGraphsForWeb(play);
    expect(Object.keys(graphs)).toEqual(['s']);
    expect(missing).toEqual([]);
    const b = playBundle(input(play, graphs));
    expect(b.backgroundGraphs?.s.fragmentShader).toBe(graphs.s.fragmentShader);
    expect((b.play.layers[0] as BackgroundLayer).sources[1].nodes).toBeUndefined();
    expect(leftBehind(play, undefined, { graphs })).toEqual([]);
    expect(buildPlayHtml(input(play, graphs))).toContain('bqPlan');
  });

  it('lists what stays behind: a graph that didn’t compile, a video too big to keep', () => {
    const play = rec([src('e', 'graph', { graph: 'example:fractalRings' }), src('v', 'video', { src: '', bytes: 9_000_000 })]);
    const left = leftBehind(play, undefined, { graphs: {} });
    expect(left.map(l => l.what)).toEqual(['The background graph “E”', 'The background video “V” (8.6 MB)']);
  });

  it('carries the queue’s images and videos, and not the header’s while the layer decides', () => {
    const play: PlayRecord = { ...rec([src('i', 'image', { src: PNG }), src('v', 'video', { src: MP4, bytes: 12 })]), display: { picture: true, backdrop: [0, 0, 0], source: 'image', image: { name: 'old.png', src: PNG } } };
    expect(mediaCarried(undefined, undefined, play)).toEqual([{ what: 'Background image “I”', bytes: PNG.length }, { what: 'Background video “V”', bytes: MP4.length }]);
    const b = playBundle(input(play));
    expect(b.play.display?.image).toBeUndefined();
    expect(b.play.display?.source).toBeUndefined();
  });

  it('puts the queue code in the page', () => {
    expect(kitScript()).toContain('function bqCompose');
  });
});

describe('the host', () => {
  it('lets the layer decide only on the Play page, and not the header', () => {
    playBackground.setRecord({ display: { picture: false, backdrop: [0, 0, 0], source: 'image' }, layers: [layer()] });
    expect(playBackground.layerActive()).toBe(false);
    const release = playBackground.claim();
    expect(playBackground.layerActive()).toBe(true);
    expect(playBackground.active()).toBe(false);
    expect(playBackground.hidden()).toBe(false);
    expect(playBackground.kitBackground()).toBeNull();
    release();
    playBackground.setRecord({ display: undefined, layers: [] });
  });
});
