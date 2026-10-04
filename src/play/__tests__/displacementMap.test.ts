/**
 * The Displacement Map (After Effects' effect; play/kit/displace.js): channel
 * extraction, the push (mid-grey = none, Max in pixels of a 1080-tall
 * picture), map behaviours and edges, a layer's Displace in the record, the
 * Look's Displace By channels (older stacks unchanged), and the Studio node.
 */
import { describe, it, expect } from 'vitest';
import {
  DM_CHANNELS, DM_GLSL, dmApplyAt, dmBoxOf, dmChannel, dmChannelGlsl, dmChannelIndex, dmMapUv, dmOffset, dmSettings, dmSourceUv,
} from '../kit/displace.js';
import { fnBuildFinal, fnDefaultEffect, fnDisplaceChannels, fnMapKeys, type FnEffect } from '../kit/finish.js';
import { newFinishEffect, parseFinishEffect } from '../../types/playFinish';
import { defaultLayer, emptyPlayRecord, layerNumericProps, parseLayer, type PlayLayer, type PlayRecord } from '../../types/play';
import { DISP_PROPS, displaceUsers, parseDisplace, runsWhileHidden } from '../../types/playLayers';
import { addDisplace, patchDisplace, removeDisplace } from '../mattes';
import { kitScript } from '../exportHtml';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { getNodeDefinition } from '../../nodes/definitions';
import { buildDisplacementExamples } from '../../store/displacementExamples';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('channels', () => {
  const c = [0.8, 0.2, 0.4, 1];
  it('reads red, green, blue, alpha', () => {
    close(dmChannel(c, 'red'), 0.8); close(dmChannel(c, 'green'), 0.2); close(dmChannel(c, 'blue'), 0.4);
    close(dmChannel([0.1, 0.1, 0.1, 0.3], 'alpha'), 0.3);
  });
  it('luminance (Rec. 709), lightness, saturation and hue (HSL)', () => {
    close(dmChannel(c, 'luminance'), 0.2126 * 0.8 + 0.7152 * 0.2 + 0.0722 * 0.4);
    close(dmChannel(c, 'lightness'), 0.5);
    close(dmChannel(c, 'saturation'), 0.6 / (1 - Math.abs(2 * 0.5 - 1)), 1e-5);
    close(dmChannel([1, 0, 0, 1], 'hue'), 0);
    close(dmChannel([0, 1, 0, 1], 'hue'), 1 / 3);
    close(dmChannel([0, 0, 1, 1], 'hue'), 2 / 3);
    close(dmChannel([0.5, 0.5, 0.5, 1], 'saturation'), 0);
    close(dmChannel([0.5, 0.5, 0.5, 1], 'hue'), 0);
  });
  it('Full is 1, Half and Off are 0.5 (no push), whatever the map', () => {
    for (const m of [[0, 0, 0, 0], [1, 1, 1, 1], [0.3, 0.9, 0.1, 0.5]]) {
      expect(dmChannel(m, 'full')).toBe(1);
      expect(dmChannel(m, 'half')).toBe(0.5);
      expect(dmChannel(m, 'off')).toBe(0.5);
    }
  });
  it('colour channels fade to 0.5 where the map is empty; alpha reads 0 there', () => {
    for (const ch of ['red', 'green', 'blue', 'luminance', 'hue', 'lightness', 'saturation']) close(dmChannel([1, 1, 1, 0], ch), 0.5);
    close(dmChannel([1, 1, 1, 0.5], 'red'), 0.75);
    expect(dmChannel([1, 1, 1, 0], 'alpha')).toBe(0);
  });
  it('every channel has a shader index and expression', () => {
    expect(DM_CHANNELS).toEqual(['red', 'green', 'blue', 'alpha', 'luminance', 'hue', 'lightness', 'saturation', 'full', 'half', 'off']);
    DM_CHANNELS.forEach((ch, i) => expect(dmChannelIndex(ch)).toBe(i));
    expect(dmChannelIndex('nonsense')).toBe(DM_CHANNELS.indexOf('off'));
    expect(dmChannelGlsl('full', 'm')).toBe('1.0');
    expect(dmChannelGlsl('off', 'm')).toBe('0.5');
    expect(dmChannelGlsl('half', 'm')).toBe('0.5');
    expect(dmChannelGlsl('luminance', 'm')).toBe('dmChan(m, 4.0)');
    expect(DM_GLSL).toMatch(/float dmChan\(vec4 c, float k\)/);
    expect(DM_GLSL).toMatch(/vec2 dmOffset\(/);
  });
});

describe('the push', () => {
  it('mid-grey is zero; white is +Max, black −Max, in pixels of a 1080-tall picture', () => {
    const z = dmOffset(0.5, 0.5, 100, 100, 16 / 9);
    expect(z.x).toBe(0); expect(z.y).toBe(0);
    const w = dmOffset(1, 1, 100, 100, 16 / 9);
    close(w.x * 1920, 100, 1e-9); close(w.y * 1080, 100, 1e-9);
    const b = dmOffset(0, 0, 100, 50, 16 / 9);
    close(b.x * 1920, -100, 1e-9); close(b.y * 1080, -50, 1e-9);
    // Negative Max turns it round.
    close(dmOffset(1, 0.5, -40, 0, 1).x * 1080, -40, 1e-9);
  });
  it('a white map with Max 100 moves the picture 100 px right (a black one 100 px left)', () => {
    const W = 1920, H = 1080, aspect = W / H;
    // A source with one lit column at x = 960 px.
    const src = (uv: { x: number; y: number }) => (Math.abs(uv.x * W - 960) < 0.5 ? [1, 1, 1, 1] : [0, 0, 0, 1]);
    const s = { h: 'red', v: 'off', maxH: 100, maxV: 0 } as const;
    expect(dmApplyAt({ x: 1060 / W, y: 0.5 }, src, () => [1, 1, 1, 1], s, aspect)).toEqual([1, 1, 1, 1]);
    expect(dmApplyAt({ x: 960 / W, y: 0.5 }, src, () => [1, 1, 1, 1], s, aspect)).toEqual([0, 0, 0, 1]);
    expect(dmApplyAt({ x: 860 / W, y: 0.5 }, src, () => [0, 0, 0, 1], s, aspect)).toEqual([1, 1, 1, 1]);
    // Mid-grey: where it was.
    expect(dmApplyAt({ x: 960 / W, y: 0.5 }, src, () => [0.5, 0.5, 0.5, 1], s, aspect)).toEqual([1, 1, 1, 1]);
    // Vertical: white moves up (y up), by Max px.
    const row = (uv: { x: number; y: number }) => (Math.abs(uv.y * H - 540) < 0.5 ? [1, 0, 0, 1] : null);
    expect(dmApplyAt({ x: 0.5, y: 640 / H }, row, () => [1, 1, 1, 1], { h: 'off', v: 'green', maxH: 0, maxV: 100 }, aspect)).toEqual([1, 0, 0, 1]);
  });
});

describe('behaviours and edges', () => {
  const box = { x0: 0.25, y0: 0.5, x1: 0.5, y1: 1 };
  it('Center reads in place; Stretch fits the box to the picture; Tile repeats it', () => {
    expect(dmMapUv({ x: 0.1, y: 0.2 }, box, 'center')).toEqual({ x: 0.1, y: 0.2 });
    expect(dmMapUv({ x: 0, y: 0 }, box, 'stretch')).toEqual({ x: 0.25, y: 0.5 });
    expect(dmMapUv({ x: 1, y: 1 }, box, 'stretch')).toEqual({ x: 0.5, y: 1 });
    expect(dmMapUv({ x: 0.5, y: 0.5 }, box, 'stretch')).toEqual({ x: 0.375, y: 0.75 });
    const t = dmMapUv({ x: 0.8, y: 0.1 }, box, 'tile');
    close(t.x, 0.3); close(t.y, 0.6);
    // Without a box (a full-picture map) every behaviour reads in place.
    for (const b of ['center', 'stretch', 'tile']) expect(dmMapUv({ x: 0.3, y: 0.7 }, null, b)).toEqual({ x: 0.3, y: 0.7 });
  });
  it('Wrap pixels around reads the other side; otherwise past the edge is empty', () => {
    expect(dmSourceUv({ x: 0.05, y: 0.5 }, { x: 0.1, y: 0 }, false)).toBeNull();
    const w = dmSourceUv({ x: 0.05, y: 0.5 }, { x: 0.1, y: 0 }, true)!;
    close(w.x, 0.95); close(w.y, 0.5);
    expect(dmSourceUv({ x: 0.5, y: 0.5 }, { x: 0, y: 0 }, false)).toEqual({ x: 0.5, y: 0.5 });
  });
  it('a map’s visible box from its alpha', () => {
    const w = 8, h = 4, g = new Uint8ClampedArray(w * h * 4);
    g[(1 * w + 2) * 4 + 3] = 255; g[(2 * w + 5) * 4 + 3] = 255;
    expect(dmBoxOf(g, w, h)).toEqual({ x0: 2 / 8, x1: 6 / 8, y0: 1 - 3 / 4, y1: 1 - 1 / 4 });
    expect(dmBoxOf(new Uint8ClampedArray(w * h * 4), w, h)).toBeNull();
  });
  it('settings fall back to After Effects’ defaults', () => {
    expect(dmSettings({ h: 'purple', v: 'alpha', behaviour: 'zoom', maxH: NaN, maxV: 7 })).toEqual({ h: 'red', v: 'alpha', behaviour: 'center', wrap: false, maxH: 50, maxV: 7 });
  });
});

describe('a layer’s Displace in the record', () => {
  const rec = (layers: PlayLayer[]): PlayRecord => ({ ...emptyPlayRecord(), layers });
  it('parses, clamps and keeps it; absent stays absent', () => {
    const raw = { ...defaultLayer('text', 't', 'T'), displace: { on: true, map: 'layer', layerId: 'm', h: 'alpha', v: 'hue', behaviour: 'tile', wrap: true }, disp_maxH: 99999, disp_maxV: -12 };
    const l = parseLayer(raw)! as PlayLayer & Record<string, unknown>;
    expect(l.displace).toEqual({ on: true, map: 'layer', layerId: 'm', h: 'alpha', v: 'hue', behaviour: 'tile', wrap: true });
    expect(l.disp_maxH).toBe(DISP_PROPS.disp_maxH.hi);
    expect(l.disp_maxV).toBe(-12);
    expect(parseLayer(defaultLayer('text', 't', 'T'))!.displace).toBeUndefined();
    // Odd values fall back; a map that is the layer itself reads the picture.
    expect(parseDisplace({ map: 'layer', layerId: 't', h: 'x', v: 3, behaviour: 'no' }, 't')).toEqual({ on: true, map: 'picture', layerId: '', h: 'red', v: 'green', behaviour: 'center', wrap: false });
    // Missing maxima get their defaults.
    const d = parseLayer({ ...defaultLayer('shape', 's', 'S'), displace: {} })! as PlayLayer & Record<string, unknown>;
    expect(d.disp_maxH).toBe(DISP_PROPS.disp_maxH.value);
    // Not on kinds that can't be matted.
    expect(parseLayer({ ...defaultLayer('null', 'n', 'N'), displace: {} })!.displace).toBeUndefined();
  });
  it('its maxima are numbers a control can drive', () => {
    const l = parseLayer({ ...defaultLayer('text', 't', 'T'), displace: {} })!;
    expect(layerNumericProps(l).map(p => p.key)).toEqual(expect.arrayContaining(['disp_maxH', 'disp_maxV']));
    expect(layerNumericProps(defaultLayer('text', 't', 'T')).some(p => p.key.startsWith('disp_'))).toBe(false);
  });
  it('adding hides the map layer (like a matte), which keeps running; removing takes its controls', () => {
    let p = rec([defaultLayer('text', 't', 'T'), defaultLayer('shape', 'm', 'Map')]);
    p = addDisplace(p, 't', 'm');
    const t = p.layers[0] as PlayLayer & Record<string, unknown>;
    expect(t.displace).toMatchObject({ map: 'layer', layerId: 'm', h: 'red', v: 'green' });
    expect(t.disp_maxH).toBe(50);
    expect(p.layers[1].visible).toBe(false);
    expect(displaceUsers(p.layers, 'm').map(l => l.id)).toEqual(['t']);
    expect(runsWhileHidden(p.layers, 'm')).toBe(true);
    p = patchDisplace(p, 't', { layerId: 't', map: 'layer' });
    expect(p.layers[0].displace).toMatchObject({ map: 'picture', layerId: '' });
    p = { ...p, controls: [{ id: 'c', target: 'layer:t::disp_maxH', kind: 'float', label: 'x', min: 0, max: 1 }] };
    p = removeDisplace(p, 't');
    expect(p.layers[0].displace).toBeUndefined();
    expect('disp_maxH' in p.layers[0]).toBe(false);
    expect(p.controls).toEqual([]);
  });
  it('the kit and the export carry it', () => {
    const k = kitScript();
    expect(k).toContain('function dmCreate(');
    expect(k).toContain('displaceLayer(o, off, l)');
  });
});

describe('the Look’s Displace', () => {
  const fx = (extra: Record<string, unknown> = {}): FnEffect => Object.assign(fnDefaultEffect('displace', 'd'), extra);
  it('older stacks are unchanged: no Push saved, the same shader as before', () => {
    for (const map of ['noise', 'picture', 'layer', 'motion']) {
      const old = fx({ map, layerId: 'blob' });
      expect(fnDisplaceChannels(old)).toBe(false);
      const src = fnBuildFinal([old]).src;
      expect(src).not.toContain('dmOffset');
      expect(src).not.toContain('uDispBox');
      expect(src).toContain('q += d * displace_amount * 0.08');
      expect(fnBuildFinal([fx({ map, layerId: 'blob', dispMode: 'direction' })]).src).toBe(src);
      const parsed = parseFinishEffect({ id: 'd', kind: 'displace', map, layerId: 'blob', amount: 0.4 })!;
      expect('dispMode' in parsed).toBe(false);
      expect(parsed.amount).toBe(0.4);
    }
    expect('dispMode' in newFinishEffect('displace', 'd')).toBe(false);
  });
  it('By channels reads the map’s channels (a layer, or the picture)', () => {
    const lay = fx({ map: 'layer', layerId: 'blob', dispMode: 'channels', chanH: 'alpha', chanV: 'off', behaviour: 'tile', wrap: true });
    expect(fnDisplaceChannels(lay)).toBe(true);
    expect(fnMapKeys([lay])).toEqual(['layer:blob']);
    const src = fnBuildFinal([lay]).src;
    expect(src).toContain('uniform vec4 uDispBox;');
    expect(src).toContain('texture(uM0, dmMapUv(q, uDispBox, 2.0))');
    expect(src).toContain('q -= dmOffset(dmChan(m, 3.0), 0.5, vec2(displace_maxH, displace_maxV), uAspect);');
    expect(src).toContain('q = fract(q);');
    const pic = fnBuildFinal([fx({ map: 'picture', dispMode: 'channels', chanH: 'luminance', chanV: 'full' })]).src;
    expect(pic).toContain('vec4 ds = scene(q);');
    expect(pic).toContain('q -= dmOffset(dmChan(m, 4.0), 1.0,');
    // Noise and motion maps keep the old push even with By channels saved.
    expect(fnDisplaceChannels(fx({ map: 'noise', dispMode: 'channels' }))).toBe(false);
  });
  it('the file keeps By channels and its options', () => {
    const e = parseFinishEffect({ id: 'd', kind: 'displace', map: 'layer', layerId: 'w', dispMode: 'channels', chanH: 'hue', chanV: 'nope', behaviour: 'stretch', wrap: true, maxH: -80 })!;
    expect(e).toMatchObject({ dispMode: 'channels', chanH: 'hue', chanV: 'green', behaviour: 'stretch', wrap: true, maxH: -80, maxV: 50 });
  });
});

describe('the Studio node', () => {
  const graph = (wires: Record<string, [string, string]>, params: Record<string, unknown> = {}) => compileGraph({
    nodes: [
      n('uv', 'uv', 0, 0),
      n('truchet', 'tiles', 0, 0, {}, { uv: ['uv', 'uv'] }),
      n('fbm', 'noise', 0, 0, {}, { uv: ['uv', 'uv'] }),
      n('displacementMap', 'disp', 0, 0, params, wires),
      n('output', 'out', 0, 0, {}, { color: ['disp', 'color'] }),
    ],
  });
  it('is registered', () => {
    expect(getNodeDefinition('displacementMap')?.label).toBe('Displacement Map');
  });
  it('reads a field chain at the pushed position', () => {
    const r = graph({ source: ['tiles', 'color'], map: ['noise', 'value'] }, { hChan: 'luminance', vChan: 'off' });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/fieldfn_\w+\(\w+_q, vec2\(0\.0\), 0\.0, 0\.0\)/);
    expect(r.fragmentShader).toContain('dmOffset(dmChan(');
    expect(r.fragmentShader).toMatch(/float dmChan\(vec4 c, float k\)/);
  });
  it('compiles with nothing wired (black, its sliders still read)', () => {
    const r = graph({});
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toContain('dmOffset(');
  });
  it('reads a Pass texture as the Source and as the Map', () => {
    const r = compileGraph({
      nodes: [
        n('uv', 'uv', 0, 0),
        n('truchet', 'tiles', 0, 0, {}, { uv: ['uv', 'uv'] }),
        n('pass', 'pic', 0, 0, {}, { color: ['tiles', 'color'] }),
        n('fbm', 'noise', 0, 0, {}, { uv: ['uv', 'uv'] }),
        n('pass', 'map', 0, 0, {}, { color: ['noise', 'value'] }),
        n('displacementMap', 'disp', 0, 0, { edges: 'wrap' }, { sourceTex: ['pic', 'texture'], mapTex: ['map', 'texture'] }),
        n('output', 'out', 0, 0, {}, { color: ['disp', 'color'] }),
      ],
    });
    expect(r.success).toBe(true);
    expect(r.passes?.length).toBe(2);
    expect(r.fragmentShader).toMatch(/texture2D\(u_pass_\w+, \w+_q\)/);
    expect(r.fragmentShader).toMatch(/\w+_q = fract\(\w+_q\);/);
  });
  it('the example compiles', () => {
    const ex = buildDisplacementExamples().displaceNoiseMap;
    expect(compileGraph({ nodes: ex.nodes }).success).toBe(true);
  });
});
