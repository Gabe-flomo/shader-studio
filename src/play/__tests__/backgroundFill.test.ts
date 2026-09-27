/**
 * Play's Colour background as a gradient or a palette: the fill the kit
 * paints (and every reader of the picture samples), its angle and bands, the
 * record keeping at most 8 stops (the Studio's Palette node keeps its 32),
 * the host handing the fill to the kit, the web player carrying it, and what
 * the capture window mounts for each render mode.
 */
import { describe, expect, it } from 'vitest';
import { PLAY_FILL_STOPS_MAX, activeFill, fitStops, parseDisplay, parsePlayRecord, type BackgroundFill, type PlayRecord } from '../../types/play';
import { defaultLayer } from '../../types/playLayers';
import { klFillAt, klFillColourAt, klFillT } from '../kit/layers.js';
import { playBackground } from '../background';
import { sampleFill } from '../../lib/backgroundLibrary';
import { STOP_PALETTE_MAX } from '../../nodes/definitions/color';
import { captureControls, captureInput, hasPlayPicture, needsWarmup, previewPixelSize } from '../../lib/backgroundCapture';
import { buildPlayHtml, type PlayHtmlInput } from '../exportHtml';

const BW: BackgroundFill = { style: 'gradient', angle: 180, stops: [{ pos: 0, color: [0, 0, 0] }, { pos: 1, color: [1, 1, 1] }] };
const near = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

describe('sampling a fill', () => {
  it('runs top to bottom at 180°, left to right at 90°, bottom to top at 0° (CSS angles)', () => {
    expect(near(klFillAt(BW, 0.5, 0, 16 / 9), [0, 0, 0])).toBe(true);
    expect(near(klFillAt(BW, 0.5, 1, 16 / 9), [1, 1, 1])).toBe(true);
    expect(near(klFillAt(BW, 0.3, 0.5, 16 / 9), [0.5, 0.5, 0.5])).toBe(true);
    const lr = { ...BW, angle: 90 };
    expect(near(klFillAt(lr, 0, 0.5, 1), [0, 0, 0])).toBe(true);
    expect(near(klFillAt(lr, 0.25, 0.9, 1), [0.25, 0.25, 0.25])).toBe(true);
    const up = { ...BW, angle: 0 };
    expect(near(klFillAt(up, 0.5, 1, 1), [0, 0, 0])).toBe(true);
  });

  it('reaches the corners on a diagonal, whatever the shape', () => {
    const d = { ...BW, angle: 135 };
    expect(klFillT(135, 0, 0, 16 / 9)).toBeCloseTo(0);
    expect(klFillT(135, 1, 1, 16 / 9)).toBeCloseTo(1);
    expect(near(klFillAt(d, 0.5, 0.5, 16 / 9), [0.5, 0.5, 0.5])).toBe(true);
  });

  it('holds each colour up to the next stop in bands', () => {
    const bands: BackgroundFill = { style: 'bands', angle: 90, stops: [{ pos: 0, color: [1, 0, 0] }, { pos: 0.5, color: [0, 1, 0] }, { pos: 0.8, color: [0, 0, 1] }] };
    expect(klFillColourAt(bands, 0.1)).toEqual([1, 0, 0]);
    expect(klFillColourAt(bands, 0.49)).toEqual([1, 0, 0]);
    expect(klFillColourAt(bands, 0.5)).toEqual([0, 1, 0]);
    expect(klFillColourAt(bands, 0.95)).toEqual([0, 0, 1]);
    expect(klFillColourAt({ ...bands, style: 'gradient' }, 0.25)).toEqual([0.5, 0.5, 0]);
  });

  it('is the same sampler the library hands out', () => {
    for (const [u, v] of [[0.1, 0.2], [0.7, 0.9], [0.5, 0.5]]) expect(sampleFill(BW, u, v, 16 / 9)).toEqual(klFillAt(BW, u, v, 16 / 9));
  });
});

describe('stops on Play', () => {
  it('keeps at most 8 stops on Play (resampled, ends kept); the Studio’s Palette node still has 32', () => {
    expect(PLAY_FILL_STOPS_MAX).toBe(8);
    expect(STOP_PALETTE_MAX).toBe(32);
    const stops = Array.from({ length: 20 }, (_, i) => ({ pos: i / 19, color: [i / 19, 0.5, 0] as [number, number, number] }));
    const d = parseDisplay({ picture: true, backdrop: [0, 0, 0], source: 'colour', colourMode: 'gradient', fill: { style: 'gradient', angle: 45, stops } })!;
    expect(d.fill!.stops).toHaveLength(8);
    expect(d.fill!.stops[0]).toEqual({ pos: 0, color: [0, 0.5, 0] });
    expect(d.fill!.stops[7].pos).toBeCloseTo(1);
    expect(d.fill!.angle).toBe(45);
    expect(fitStops(stops, 32)).toHaveLength(20);
  });

  it('reads a gradient only with the colour source and a mode; a solid colour keeps the fill for later', () => {
    const rec = parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [], display: { picture: true, backdrop: [0, 0, 0], source: 'colour', colourMode: 'palette', fill: { ...BW, paletteId: 'preset:ink', name: 'Ink' } } });
    expect(activeFill(rec.display)).toMatchObject({ paletteId: 'preset:ink', name: 'Ink' });
    const solid = parseDisplay({ picture: true, backdrop: [0, 0, 0], source: 'colour', fill: BW })!;
    expect(solid.fill).toBeTruthy();
    expect(activeFill(solid)).toBeNull();
    expect(activeFill({ ...solid, source: 'shader', colourMode: 'gradient' })).toBeNull();
    expect(parseDisplay({ picture: true, backdrop: [0, 0, 0], colourMode: 'gradient' })).toBeUndefined();
  });

  it('keeps a library image’s id beside the embedded picture', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    const d = parseDisplay({ picture: true, backdrop: [0, 0, 0], source: 'image', image: { name: 'Dusk', src: PNG, libraryId: 'img_1' } })!;
    expect(d.image).toEqual({ name: 'Dusk', src: PNG, libraryId: 'img_1' });
    const rec = parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [{ ...defaultLayer('background', 'bg', 'Background'), sources: [{ id: 's1', kind: 'image', name: 'Dusk', src: PNG, libraryId: 'img_1' }] }] });
    const l = rec.layers[0] as { sources: Array<{ libraryId?: string }> };
    expect(l.sources[0].libraryId).toBe('img_1');
  });
});

describe('the picture source', () => {
  it('hands the kit the fill in place of the flat colour while Play shows it', () => {
    const display = { picture: true, backdrop: [0.2, 0.2, 0.2] as [number, number, number], source: 'colour' as const, colourMode: 'gradient' as const, fill: BW };
    playBackground.setRecord({ display, layers: [] });
    const release = playBackground.claim();
    expect(playBackground.kitBackground()).toEqual({ el: null, fit: 'cover', colour: [0.2, 0.2, 0.2], fill: BW });
    playBackground.setRecord({ display: { ...display, colourMode: undefined }, layers: [] });
    expect(playBackground.kitBackground()?.fill).toBeNull();
    release();
    playBackground.setRecord({ display: undefined, layers: [] });
  });

  it('carries the fill into web pages (the player paints it the same way)', () => {
    const play: PlayRecord = { version: 1, controls: [], mappings: [], layers: [], display: { picture: true, backdrop: [0, 0, 0], source: 'colour', colourMode: 'gradient', fill: BW } };
    const html = buildPlayHtml({ title: 'T', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play, aspect: 'free' });
    expect(html).toContain('"colourMode":"gradient"');
    expect(html).toContain('function klPaintFill');
    expect(html).toContain('renderAt(t, o)');
  });
});

describe('what the capture window mounts', () => {
  const input = (): PlayHtmlInput => ({
    title: 'G', fragmentShader: 'void main(){}', uniforms: { u_a: 1 }, paramBindings: { 'n::a': 'u_a' }, aspect: 'free',
    play: {
      version: 1,
      controls: [
        { id: 'c1', target: 'n::a', kind: 'float', label: 'A', min: 0, max: 2 },
        { id: 'c2', target: 'layer:t1::opacity', kind: 'float', label: 'Text opacity', min: 0, max: 1 },
        { id: 'c3', target: 'layer:p1::burst', kind: 'action', label: 'Burst', min: 0, max: 1 },
      ],
      mappings: [
        { id: 'm1', controlId: 'c1', enabled: true, source: { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 } },
        { id: 'm2', controlId: 'c2', enabled: true, source: { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 } },
      ] as PlayRecord['mappings'],
      layers: [defaultLayer('text', 't1', 'Text')],
      display: { picture: true, backdrop: [0, 0, 0], source: 'colour' },
    },
  });

  it('Graph: the shader alone, with only the controls that reach it', () => {
    const g = captureInput(input(), 'graph');
    expect(g.play.layers).toEqual([]);
    expect(g.play.display).toBeUndefined();
    expect(g.play.controls.map(c => c.id)).toEqual(['c1']);
    expect(g.play.mappings.map(m => m.id)).toEqual(['m1']);
    expect(captureControls(input(), 'graph').map(c => c.id)).toEqual(['c1']);
  });

  it('Play: everything, minus action controls in the panel', () => {
    expect(captureInput(input(), 'play')).toEqual(input());
    expect(captureControls(input(), 'play').map(c => c.id)).toEqual(['c1', 'c2']);
    expect(hasPlayPicture(input())).toBe(true);
    const bare = input(); bare.play.layers = []; delete bare.play.display;
    expect(hasPlayPicture(bare)).toBe(false);
  });

  it('warms up only what depends on earlier frames', () => {
    // A text layer swung by an LFO is a function of the time: no warm-up.
    expect(needsWarmup(input(), 'play')).toBe(false);
    expect(needsWarmup(input(), 'graph')).toBe(false);
    expect(needsWarmup({ ...input(), passes: { stateful: true, echo: null, particles: [] } }, 'graph')).toBe(true);
    // Layers that simulate do.
    const particles = input(); particles.play.layers.push(defaultLayer('particles', 'p1', 'Dust'));
    expect(needsWarmup(particles, 'play')).toBe(true);
    expect(needsWarmup(particles, 'graph')).toBe(false);
    for (const kind of ['brush', 'bodies', 'script'] as const) {
      const i = input(); i.play.layers = [defaultLayer(kind, 'x', kind)];
      expect(needsWarmup(i, 'play')).toBe(true);
    }
    // So does a static layer driven with a memory: smoothing, or a trigger's envelope.
    const smoothed = input(); smoothed.play.mappings[1].smoothMs = 200;
    expect(needsWarmup(smoothed, 'play')).toBe(true);
    const triggered = input(); triggered.play.mappings[1].source = { kind: 'trigger', on: 'key', key: 'a', mode: 'envelope', attack: 10, decay: 100, sustain: 0.5, release: 200 } as unknown as PlayRecord['mappings'][number]['source'];
    expect(needsWarmup(triggered, 'play')).toBe(true);
    expect(needsWarmup({ ...input(), play: { ...input().play, layers: [] } }, 'play')).toBe(false);
  });

  it('previews at the shown size, no bigger than the capture or 1280 a side', () => {
    const hd = { w: 1920, h: 1080 };
    expect(previewPixelSize(hd, 0.25, 2, false)).toEqual({ w: 960, h: 540 });
    // A phone: 1.5× density at most.
    expect(previewPixelSize(hd, 0.2, 3, true)).toEqual({ w: 576, h: 324 });
    // Shown large on a dense screen: capped by the side.
    expect(previewPixelSize(hd, 0.5, 2, false)).toEqual({ w: 1280, h: 720 });
    // Never more than the capture; a shape kept.
    expect(previewPixelSize({ w: 600, h: 400 }, 1, 2, false)).toEqual({ w: 600, h: 400 });
    expect(previewPixelSize({ w: 1080, h: 1920 }, 0.3, 2, false)).toEqual({ w: 648, h: 1152 });
    // Unmeasured yet: the capture's shape at the cap.
    expect(previewPixelSize({ w: 3840, h: 2160 }, 0, 2, false)).toEqual({ w: 1280, h: 720 });
  });
});
