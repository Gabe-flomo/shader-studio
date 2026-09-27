/**
 * Track mattes and masks: their saved form (and files from before them),
 * loops that can't be made or loaded, the record edits, the compositing maths
 * (alpha, luma, invert, add / subtract / intersect) on pixel values, where a
 * mask sits when its layer moves and turns, the kit's drawing order on a
 * recording canvas, and that web pages carry all of it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultLayer, parseLayer, parsePlayRecord, layerNumericProps, emptyPlayRecord, type PlayLayer, type PlayRecord } from '../../types/play';
import { MASK_DEFAULTS, maskKey, maskKeyParts, matteCandidates, matteWouldCycle, repairMattes } from '../../types/playLayers';
import { addMask, addMatteShape, maskFromOutline, moveMask, patchMask, removeMask, setTrackMatte } from '../mattes';
import { removeLayer, resetLayer } from '../../components/play/layerOps';
import { KM_MASK_DEFAULTS, kmLumaToAlpha, kmMaskLocal, kmMaskPlacement, kmMaskStart, kmMatteSources, kmMatteValue, kmMix, kmWouldCycle } from '../kit/mattes.js';
import { maskBounds, maskPatchFor } from '../transform';
import { createLayerKit } from '../kit/kit.js';
import { buildPlayHtml, kitScript } from '../exportHtml';

const L = (kind: PlayLayer['kind'], id: string, over: Record<string, unknown> = {}) => ({ ...defaultLayer(kind, id, id), ...over } as PlayLayer);
const rec = (layers: PlayLayer[]): PlayRecord => ({ ...emptyPlayRecord(), layers });
const num = (l: PlayLayer, k: string) => (l as unknown as Record<string, number>)[k];

describe('saved form', () => {
  it('a matte and masks round-trip, with every mask number', () => {
    let p = rec([L('image', 'img'), L('shape', 'win')]);
    p = setTrackMatte(p, 'img', 'win', { mode: 'luma', invert: true });
    p = addMask(p, 'img', 'ellipse', { x: 0.1, y: -0.05, w: 0.4, h: 0.3 }).play;
    p = addMask(p, 'img', 'polygon', { x: 0, y: 0, w: 0.2, h: 0.2, points: [-0.5, -0.5, 0.5, -0.5, 0, 0.5] }, 'subtract').play;
    const back = parsePlayRecord(JSON.parse(JSON.stringify(p)));
    expect(back.layers).toEqual(p.layers);
    const img = back.layers[0];
    expect(img.trackMatte).toEqual({ id: 'win', mode: 'luma', invert: true });
    expect(img.masks?.map(m => [m.id, m.shape, m.op])).toEqual([['m1', 'ellipse', 'add'], ['m2', 'polygon', 'subtract']]);
    expect(num(img, maskKey('m1', 'x'))).toBe(0.1);
    expect(num(img, maskKey('m2', 'feather'))).toBe(0);
  });

  it('a file from before mattes loads unchanged: no matte, no masks', () => {
    const old = { id: 't', kind: 'text', label: 'Old', text: 'HI', matte: 'reveal' };
    const l = parseLayer(old)!;
    expect(l.trackMatte).toBeUndefined();
    expect(l.masks).toBeUndefined();
    expect(Object.keys(l).some(k => k.startsWith('mask_'))).toBe(false);
    // The picture matte is untouched.
    expect((l as { matte: string }).matte).toBe('reveal');
  });

  it('bad values fall back: junk masks dropped, numbers clamped, stray mask keys and self-mattes gone', () => {
    const l = parseLayer({
      id: 'a', kind: 'shape',
      trackMatte: { id: 'a', mode: 'alpha' },
      masks: [
        { id: 'm1', shape: 'ellipse', op: 'nope', invert: 'yes' },
        { id: 'm1', shape: 'rect' }, // duplicate id
        { id: 'bad id', shape: 'rect' },
        { id: 'm3', shape: 'polygon', points: [0, 0, 1, 1] }, // too few corners: a rectangle
        'junk',
      ],
      mask_m1_feather: 99, mask_m1_x: 'left', mask_m9_x: 0.3,
    })!;
    expect(l.trackMatte).toBeUndefined();
    expect(l.masks).toEqual([
      { id: 'm1', shape: 'ellipse', points: [], op: 'add', invert: false },
      { id: 'm3', shape: 'rect', points: [], op: 'add', invert: false },
    ]);
    expect(num(l, 'mask_m1_feather')).toBe(0.5);
    expect(num(l, 'mask_m1_x')).toBe(MASK_DEFAULTS.x);
    expect(num(l, 'mask_m9_x')).toBeUndefined();
  });

  it('nulls and the Background layer never carry a matte or masks', () => {
    const n = parseLayer({ id: 'n', kind: 'null', trackMatte: { id: 'x' }, masks: [{ id: 'm1', shape: 'rect' }] })!;
    expect(n.trackMatte).toBeUndefined();
    expect(n.masks).toBeUndefined();
  });

  it('mask numbers are layer numbers a control can drive', () => {
    const p = addMask(rec([L('text', 't')]), 't', 'rect', { x: 0, y: 0, w: 0.3, h: 0.2 }).play;
    const keys = layerNumericProps(p.layers[0]).map(d => d.key);
    expect(keys).toContain('mask_m1_feather');
    expect(keys).toContain('mask_m1_x');
    expect(layerNumericProps(p.layers[0]).find(d => d.key === 'mask_m1_feather')?.label).toBe('Mask 1 · Feather');
    expect(maskKeyParts('mask_m12_expand')).toEqual({ id: 'm12', prop: 'expand' });
    expect(maskKeyParts('mask_m1_colour')).toBeNull();
  });

  it('the kit and the types agree on mask defaults', () => {
    expect(KM_MASK_DEFAULTS).toEqual(MASK_DEFAULTS);
  });
});

describe('loops', () => {
  const chain = () => rec([
    L('text', 'a', { trackMatte: { id: 'b', mode: 'alpha', invert: false } }),
    L('shape', 'b', { trackMatte: { id: 'c', mode: 'alpha', invert: false } }),
    L('particles', 'c'),
    L('null', 'n'),
  ]);

  it('a chain is fine; closing it is a loop, in the types and in the kit alike', () => {
    const p = chain();
    for (const [who, what, loops] of [['c', 'a', true], ['c', 'b', true], ['a', 'a', true], ['c', 'n', false], ['a', 'c', false]] as const) {
      expect(matteWouldCycle(p.layers, who, what), `${who}→${what}`).toBe(loops);
      expect(kmWouldCycle(p.layers, who, what), `${who}→${what} (kit)`).toBe(loops);
    }
  });

  it('the matte picker leaves out nulls, itself and anything that loops', () => {
    const ids = matteCandidates(chain().layers, 'c').map(l => l.id);
    expect(ids).toEqual([]);
    expect(matteCandidates(chain().layers, 'a').map(l => l.id)).toEqual(['b', 'c']);
  });

  it('setting a loop does nothing', () => {
    const p = chain();
    expect(setTrackMatte(p, 'c', 'a')).toBe(p);
  });

  it('a file with a loop or a missing matte loads with that link dropped', () => {
    const p = rec([
      L('text', 'a', { trackMatte: { id: 'b', mode: 'alpha', invert: false } }),
      L('text', 'b', { trackMatte: { id: 'a', mode: 'alpha', invert: false } }),
      L('text', 'c', { trackMatte: { id: 'gone', mode: 'alpha', invert: false } }),
      L('text', 'd', { trackMatte: { id: 'n', mode: 'alpha', invert: false } }),
      L('null', 'n'),
    ]);
    const back = parsePlayRecord(JSON.parse(JSON.stringify(p)));
    const t = Object.fromEntries(back.layers.map(l => [l.id, l.trackMatte?.id ?? '']));
    expect(t).toEqual({ a: '', b: 'a', c: '', d: '', n: '' });
    expect(repairMattes(back.layers)).toBe(back.layers);
  });
});

describe('record edits', () => {
  it('a layer used as a matte for the first time is hidden; the matted layer keeps its visibility', () => {
    const p = setTrackMatte(rec([L('image', 'img'), L('particles', 'dust')]), 'img', 'dust');
    expect(p.layers.map(l => l.visible)).toEqual([true, false]);
    // Shown again by hand, it stays shown when a second layer uses it.
    const shown = { ...p, layers: [...p.layers.map(l => (l.id === 'dust' ? { ...l, visible: true } : l)), L('text', 't')] };
    expect(setTrackMatte(shown, 't', 'dust').layers.find(l => l.id === 'dust')?.visible).toBe(true);
  });

  it('New shape: a hidden, solid box right above the layer, hooked up as its alpha matte', () => {
    const { play, id } = addMatteShape(rec([L('image', 'img'), L('text', 'top')]), 'img', 16 / 9);
    expect(play.layers.map(l => l.id)).toEqual(['img', id, 'top']);
    const s = play.layers[1] as PlayLayer & Record<string, unknown>;
    expect(s).toMatchObject({ kind: 'shape', shape: 'box', x: 0.5, y: 0.5, visible: false, fillOpacity: 1, strokeWidth: 0, action: 'none' });
    expect(play.layers[0].trackMatte).toEqual({ id, mode: 'alpha', invert: false });
  });

  it('removing a matte layer unhooks the layers that used it', () => {
    const p = setTrackMatte(rec([L('image', 'img'), L('shape', 's')]), 'img', 's');
    expect(removeLayer(p, 's').layers[0].trackMatte).toBeUndefined();
  });

  it('removing a mask takes its numbers, its controls and their mappings', () => {
    let p = addMask(rec([L('text', 't')]), 't', 'rect', { x: 0, y: 0, w: 0.3, h: 0.2 }).play;
    p = addMask(p, 't', 'ellipse', { x: 0, y: 0, w: 0.3, h: 0.2 }).play;
    p = { ...p, controls: [{ id: 'c', target: 'layer:t::mask_m1_feather', kind: 'float', label: 'F', min: 0, max: 0.3 }], mappings: [{ id: 'm', controlId: 'c', source: { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 }, outMin: 0, outMax: 0.3, curve: 'linear', smoothMs: 0, enabled: true }] };
    const out = removeMask(p, 't', 'm1');
    expect(out.layers[0].masks?.map(m => m.id)).toEqual(['m2']);
    expect(Object.keys(out.layers[0]).filter(k => k.startsWith('mask_m1_'))).toEqual([]);
    expect(out.controls).toEqual([]);
    expect(out.mappings).toEqual([]);
    // The next mask gets a new id, never m1 again while m2 is there.
    expect(addMask(out, 't', 'rect', { x: 0, y: 0, w: 0.1, h: 0.1 }).maskId).toBe('m3');
  });

  it('mask order and settings change; reset keeps the matte and masks', () => {
    let p = setTrackMatte(rec([L('text', 't', { size: 0.5 }), L('shape', 's')]), 't', 's');
    p = addMask(p, 't', 'rect', { x: 0, y: 0, w: 0.3, h: 0.2 }).play;
    p = addMask(p, 't', 'ellipse', { x: 0, y: 0, w: 0.3, h: 0.2 }).play;
    p = moveMask(patchMask(p, 't', 'm2', { op: 'intersect', invert: true }, { feather: 0.1 }), 't', 'm2', -1);
    expect(p.layers[0].masks?.map(m => `${m.id}:${m.op}:${m.invert}`)).toEqual(['m2:intersect:true', 'm1:add:false']);
    expect(num(p.layers[0], 'mask_m2_feather')).toBe(0.1);
    const r = resetLayer(p, 't').layers[0];
    expect(num(r, 'size')).toBe(num(defaultLayer('text', 'x', 'x'), 'size'));
    expect(r.trackMatte?.id).toBe('s');
    expect(r.masks?.length).toBe(2);
    expect(num(r, 'mask_m2_feather')).toBe(0.1);
  });
});

describe('compositing maths', () => {
  it('alpha, luma and invert', () => {
    expect(kmMatteValue(1, 0, 0, 0.5, 'alpha', false)).toBe(0.5);
    expect(kmMatteValue(1, 0, 0, 0.5, 'alpha', true)).toBe(0.5);
    expect(kmMatteValue(0, 0, 0, 1, 'alpha', true)).toBe(0);
    // Luma is the brightness over black: white counts fully, black and clear not at all.
    expect(kmMatteValue(1, 1, 1, 1, 'luma', false)).toBeCloseTo(1);
    expect(kmMatteValue(0, 0, 0, 1, 'luma', false)).toBe(0);
    expect(kmMatteValue(1, 1, 1, 0, 'luma', false)).toBe(0);
    expect(kmMatteValue(1, 1, 1, 0.5, 'luma', false)).toBeCloseTo(0.5);
    expect(kmMatteValue(0, 1, 0, 1, 'luma', false)).toBeCloseTo(0.587);
    expect(kmMatteValue(0, 0, 0, 0, 'luma', true)).toBe(1);
  });

  it('luma to alpha on pixels matches the per-pixel value', () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 128, 0, 255, 0, 255, 10, 20, 30, 0]);
    const want = [];
    for (let i = 0; i < px.length; i += 4) want.push(Math.round(kmMatteValue(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, px[i + 3] / 255, 'luma', false) * 255));
    const d = new Uint8ClampedArray(px);
    kmLumaToAlpha(d, false);
    expect([...d].filter((_, i) => i % 4 === 3)).toEqual(want);
    expect([...d].filter((_, i) => i % 4 !== 3).every(v => v === 255)).toBe(true);
    const inv = new Uint8ClampedArray(px);
    kmLumaToAlpha(inv, true);
    expect([...inv].filter((_, i) => i % 4 === 3)).toEqual(want.map(a => 255 - a));
  });

  it('add, subtract and intersect, and what they start from', () => {
    expect(kmMix(0, 1, 'add')).toBe(1);
    expect(kmMix(0.5, 0.5, 'add')).toBe(0.75);
    expect(kmMix(1, 0.25, 'subtract')).toBe(0.75);
    expect(kmMix(0.5, 0.5, 'intersect')).toBe(0.25);
    expect(kmMaskStart([{ op: 'add' }, { op: 'subtract' }])).toBe(0);
    expect(kmMaskStart([{ op: 'subtract' }])).toBe(1);
    expect(kmMaskStart([{ op: 'intersect' }])).toBe(1);
    // A ring: a big mask, the small one inside subtracted. On a row of pixels: outside, ring, hole.
    const big = [0, 1, 1], small = [0, 0, 1];
    const ring = big.map((b, i) => kmMix(kmMix(kmMaskStart([{ op: 'add' }]), b, 'add'), small[i], 'subtract'));
    expect(ring).toEqual([0, 1, 0]);
    // Opacity and invert go into the mask before it combines: a 50% inverted mask subtracting.
    expect(kmMix(1, (1 - 0) * 0.5, 'subtract')).toBe(0.5);
  });
});

describe('where a mask sits', () => {
  const v = (l: PlayLayer) => (k: string) => num(l, k);

  it('it hangs from the layer: moves and turns with it, and back again', () => {
    let p = addMask(rec([L('text', 't', { x: 0.3, y: 0.6, rotation: 90 })]), 't', 'rect', { x: 0.2, y: 0, w: 0.3, h: 0.1, rotation: 10 }).play;
    const l = p.layers[0], m = l.masks![0];
    const at = kmMaskPlacement(l as never, m, v(l), 2);
    // 0.2 picture heights to the layer's right, turned 90° clockwise, is 0.2 below it.
    expect(at.x).toBeCloseTo(0.3);
    expect(at.y).toBeCloseTo(0.4);
    expect(at.rotation).toBe(100);
    const back = kmMaskLocal(l as never, v(l), 2, at.x, at.y, at.rotation);
    expect(back.x).toBeCloseTo(0.2); expect(back.y).toBeCloseTo(0); expect(back.rotation).toBeCloseTo(10);
    // Handles: the bounds on the picture and the patch they make agree.
    const b = maskBounds(l, m, (x, k) => num(x, k), 2);
    const patch = maskPatchFor(l, m, { ...b, x: b.x + 0.05, w: 0.5 }, (x, k) => num(x, k), 2);
    p = { ...p, layers: [{ ...l, ...patch } as PlayLayer] };
    const moved = kmMaskPlacement(p.layers[0] as never, m, v(p.layers[0]), 2);
    expect(moved.x).toBeCloseTo(0.35); expect(moved.y).toBeCloseTo(0.4); expect(moved.w).toBeCloseTo(0.5);
  });

  it('layers without a place hang masks from the middle of the picture', () => {
    const l = addMask(rec([L('particles', 'p')]), 'p', 'ellipse', { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }).play.layers[0];
    const at = kmMaskPlacement(l as never, l.masks![0], v(l), 1);
    expect(at.x).toBeCloseTo(0.6); expect(at.y).toBeCloseTo(0.6);
  });

  it('a drawn outline becomes a polygon in its own box', () => {
    const place = maskFromOutline([0.4, 0.4, 0.6, 0.4, 0.5, 0.6], 2, (x, y, r) => ({ x: (x - 0.5) * 2, y: y - 0.5, rotation: r }))!;
    expect(place.w).toBeCloseTo(0.4); expect(place.h).toBeCloseTo(0.2);
    expect(place.x).toBeCloseTo(0); expect(place.y).toBeCloseTo(0);
    expect(place.points!.map(n => Math.round(n * 100) / 100)).toEqual([-0.5, -0.5, 0.5, -0.5, 0, 0.5]);
  });
});

describe('which layers are mattes', () => {
  it('mattes of drawn layers, down the chain; not those of hidden layers', () => {
    const layers = [
      L('text', 'a', { trackMatte: { id: 'b', mode: 'alpha', invert: false } }),
      L('shape', 'b', { visible: false, trackMatte: { id: 'c', mode: 'luma', invert: false } }),
      L('particles', 'c', { visible: false }),
      L('text', 'd', { visible: false, trackMatte: { id: 'e', mode: 'alpha', invert: false } }),
      L('shape', 'e', { visible: false }),
    ];
    expect([...kmMatteSources(layers, l => l.visible)].sort()).toEqual(['b', 'c']);
  });
});

// ── The kit, drawing on canvases that record what is done to them ─────────────

type Call = { fn: string; op: string; src?: FakeCanvas };
interface FakeCanvas { width: number; height: number; calls: Call[]; getContext: () => unknown }
function fakeCanvas(): FakeCanvas {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { globalCompositeOperation: 'source-over', globalAlpha: 1 };
  const ctx: unknown = new Proxy(state, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'getImageData' || k === 'createImageData') return (...a: number[]) => { const w = a.length > 2 ? a[2] : a[0], h = a.length > 2 ? a[3] : a[1]; return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'isPointInStroke' || k === 'isPointInPath') return () => false;
      return (...args: unknown[]) => { calls.push({ fn: k, op: String(t.globalCompositeOperation), src: args[0] as FakeCanvas }); };
    },
    set(t, k: string, v) { t[k] = v; return true; },
  });
  return { width: 0, height: 0, calls, getContext: () => ctx };
}

describe('the kit draws a matted layer on its own canvas', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, Path2D: g.Path2D };
  beforeAll(() => {
    g.document = { createElement: () => fakeCanvas() };
    g.Path2D = class { moveTo() {} lineTo() {} arcTo() {} closePath() {} };
  });
  afterAll(() => { g.document = saved.document; g.Path2D = saved.Path2D; });

  const run = (layers: PlayLayer[]) => {
    const kit = createLayerKit();
    const main = fakeCanvas();
    const env = {
      gl: fakeCanvas(), W: 64, H: 36, dpr: 1, time: 0, dt: 1 / 60, value: (l: PlayLayer, k: string) => num(l, k),
      pointer: { x: 0.5, y: 0.5, over: false, down: false }, markers: false, editing: false, hidden: false, backdrop: [0, 0, 0] as [number, number, number],
      audio: null, camera: null, image: () => null, sensor: () => {}, override: () => {},
    };
    kit.frame(main.getContext() as CanvasRenderingContext2D, rec(layers), env as never);
    return main;
  };
  const shape = (id: string, over: Record<string, unknown> = {}) => L('shape', id, { action: 'none', fillOpacity: 1, strokeWidth: 0, ...over });

  it('alpha: cut by the matte with destination-in; the hidden matte never reaches the picture', () => {
    const main = run([shape('a', { trackMatte: { id: 'b', mode: 'alpha', invert: false } }), shape('b', { visible: false })]);
    const blits = main.calls.filter(c => c.fn === 'drawImage');
    expect(blits).toHaveLength(1);
    expect(main.calls.some(c => c.fn === 'fill')).toBe(false);
    const own = blits[0].src!;
    const cut = own.calls.find(c => c.fn === 'drawImage')!;
    expect(cut.op).toBe('destination-in');
    // The matte's canvas holds the matte shape.
    expect(cut.src!.calls.some(c => c.fn === 'fill')).toBe(true);
  });

  it('invert uses destination-out; luma reads the matte back as alpha first', () => {
    const inv = run([shape('a', { trackMatte: { id: 'b', mode: 'alpha', invert: true } }), shape('b', { visible: false })]);
    expect(inv.calls.find(c => c.fn === 'drawImage')!.src!.calls.find(c => c.fn === 'drawImage')!.op).toBe('destination-out');
    const luma = run([shape('a', { trackMatte: { id: 'b', mode: 'luma', invert: false } }), shape('b', { visible: false })]);
    const cut = luma.calls.find(c => c.fn === 'drawImage')!.src!.calls.find(c => c.fn === 'drawImage')!;
    expect(cut.op).toBe('destination-in');
    expect(cut.src!.calls.map(c => c.fn)).toContain('putImageData');
  });

  it('a shown matte is drawn on the picture too; masks cut with their own canvas; plain layers draw straight on', () => {
    const shown = run([shape('a', { trackMatte: { id: 'b', mode: 'alpha', invert: false } }), shape('b')]);
    expect(shown.calls.filter(c => c.fn === 'drawImage')).toHaveLength(2);
    const masked = addMask(rec([shape('a')]), 'a', 'ellipse', { x: 0, y: 0, w: 0.2, h: 0.2 }).play.layers;
    const m = run(masked);
    const own = m.calls.find(c => c.fn === 'drawImage')!.src!;
    const cut = own.calls.find(c => c.fn === 'drawImage')!;
    expect(cut.op).toBe('destination-in');
    const plain = run([shape('a')]);
    expect(plain.calls.some(c => c.fn === 'fill')).toBe(true);
    expect(plain.calls.some(c => c.fn === 'drawImage')).toBe(false);
  });

  it('a loop in a record that skipped the parser still draws, unmatted, without hanging', () => {
    const main = run([shape('a', { trackMatte: { id: 'b', mode: 'alpha', invert: false } }), shape('b', { trackMatte: { id: 'a', mode: 'alpha', invert: false } })]);
    expect(main.calls.filter(c => c.fn === 'drawImage').length).toBeGreaterThan(0);
  });
});

describe('web pages', () => {
  it('carry the matte code and the record’s mattes and masks', () => {
    let p = setTrackMatte(rec([L('image', 'img'), L('shape', 'win')]), 'img', 'win');
    p = addMask(p, 'img', 'ellipse', { x: 0, y: 0, w: 0.4, h: 0.3 }).play;
    p = patchMask(p, 'img', 'm1', {}, { feather: 0.08 });
    const html = buildPlayHtml({ title: 'M', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play: p, aspect: '16:9' });
    expect(html).toContain('"trackMatte":{"id":"win","mode":"alpha","invert":false}');
    expect(html).toContain('"mask_m1_feather":0.08');
    expect(html).toContain('function kmApplyTrack');
    expect(html).toContain('function kmMaskCanvas');
    // The inlined kit is one valid script.
    expect(() => new Function(kitScript())).not.toThrow();
  });
});
