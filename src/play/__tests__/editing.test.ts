/**
 * On-picture editing and the layer helpers around it: handle maths (resize
 * from the opposite corner, Shift keeps the shape, rotation), web font links,
 * emoji-safe glyph ramps, and layer renames carrying their controls along.
 */
import { describe, it, expect } from 'vitest';
import { dragHandle, handleAt, handlePoints, insideBounds, patchFor, type Bounds } from '../transform';
import { klGlyphList, klParseFontUrl } from '../kit/layers.js';
import { addNullFor, driveWithNull, duplicateLayer, pairedKey, renameLayer, resetLayer } from '../../components/play/layerOps';
import { defaultLayer, emptyPlayRecord, type PlayLayer } from '../../types/play';
import { applySolo } from '../../components/play/playUi';
import { candidateFor, findTargetNode, readControlValue } from '../playControls';

const W = 1600, H = 900;
const box: Bounds = { x: 0.5, y: 0.5, w: 0.4, h: 0.2, rot: 0, uniform: false, turns: true };
const mods = { proportional: false, centred: false, snap: false };

describe('transform handles', () => {
  it('sit on the corners, edges and above the top', () => {
    const pts = handlePoints(box, W, H);
    expect(pts).toHaveLength(9);
    const tr = pts.find(p => p.handle.kind === 'scale' && p.handle.sx === 1 && p.handle.sy === -1)!;
    expect(tr.x).toBeCloseTo(800 + 0.2 * 900);
    expect(tr.y).toBeCloseTo(450 - 0.1 * 900);
    expect(handleAt(box, tr.x + 3, tr.y - 3, W, H)).toEqual({ kind: 'scale', sx: 1, sy: -1 });
    expect(insideBounds(box, 800, 450, W, H)).toBe(true);
    expect(insideBounds(box, 800, 200, W, H)).toBe(false);
  });

  it('resize from the opposite corner, and Shift keeps the shape', () => {
    // Drag the top-right corner 90 px right: 0.1 picture heights wider, left edge still.
    const tr = handlePoints(box, W, H).find(p => p.handle.kind === 'scale' && p.handle.sx === 1 && p.handle.sy === -1)!;
    const b = dragHandle(box, { kind: 'scale', sx: 1, sy: -1 }, tr.x + 90, tr.y, W, H, mods);
    expect(b.w).toBeCloseTo(0.5); expect(b.h).toBeCloseTo(0.2);
    expect(b.x * W - (b.w / 2) * H).toBeCloseTo(box.x * W - (box.w / 2) * H);
    const p = dragHandle(box, { kind: 'scale', sx: 1, sy: -1 }, tr.x + 90, tr.y, W, H, { ...mods, proportional: true });
    expect(p.w / p.h).toBeCloseTo(box.w / box.h);
    // Alt: the centre stays.
    const c = dragHandle(box, { kind: 'scale', sx: 1, sy: 0 }, 800 + 0.3 * 900, 450, W, H, { ...mods, centred: true });
    expect(c.x).toBeCloseTo(0.5); expect(c.w).toBeCloseTo(0.6);
  });

  it('turn with the rotation knob (Shift snaps to 15°)', () => {
    expect(dragHandle(box, { kind: 'rotate' }, 800 + 100, 450, W, H, mods).rot).toBeCloseTo(90);
    expect(dragHandle(box, { kind: 'rotate' }, 800 + 100, 450 - 8, W, H, { ...mods, snap: true }).rot).toBe(90);
  });

  it('turn a drag into the right layer properties', () => {
    const text = { ...defaultLayer('text', 't', 'T'), size: 0.2 } as PlayLayer;
    const v = (l: PlayLayer, k: string) => (l as unknown as Record<string, number>)[k];
    const out = patchFor(text, { ...box, uniform: true }, { ...box, uniform: true, w: 0.8, h: 0.4 }, v);
    expect(out.size).toBeCloseTo(0.4);
    const poly = { ...defaultLayer('shape', 's', 'S'), shape: 'polygon', w: 0.4, h: 0.2, points: [-0.2, 0.1, 0.2, 0.1, 0, -0.1] } as PlayLayer;
    const scaled = patchFor(poly, box, { ...box, w: 0.8 }, v);
    expect(scaled.points).toEqual([-0.4, 0.1, 0.4, 0.1, 0, -0.1]);
  });
});

describe('web fonts', () => {
  it('read Google Fonts links, pasted tags, specimen pages, names and font files', () => {
    expect(klParseFontUrl('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap')?.family).toBe('Space Grotesk');
    expect(klParseFontUrl('<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&amp;display=swap" rel="stylesheet">')?.css).toContain('family=Bebas+Neue&display');
    expect(klParseFontUrl('https://fonts.google.com/specimen/Roboto+Mono')?.family).toBe('Roboto Mono');
    expect(klParseFontUrl('Playfair Display')?.css).toBe('https://fonts.googleapis.com/css2?family=Playfair+Display&display=swap');
    expect(klParseFontUrl('https://example.com/fonts/Neat-Font.woff2')).toEqual({ family: 'SS Neat-Font', file: 'https://example.com/fonts/Neat-Font.woff2' });
    // Anything else is not fetched.
    expect(klParseFontUrl('https://evil.example/style.css')).toBeNull();
    expect(klParseFontUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('glyph ramps', () => {
  it('keep emoji whole', () => {
    expect(klGlyphList('🌑🌒🌓')).toEqual(['🌑', '🌒', '🌓']);
    expect(klGlyphList(' .#')).toEqual([' ', '.', '#']);
    expect(klGlyphList('👍🏽🇯🇵').length).toBe(2);
  });
});

describe('layer operations', () => {
  const base = () => {
    const p = emptyPlayRecord();
    p.layers = [defaultLayer('particles', 'p1', 'Sparks')];
    p.controls = [
      { id: 'c1', target: 'layer:p1::speed', kind: 'float', label: 'Sparks · Speed', min: 0, max: 3 },
      { id: 'c2', target: 'layer:p1::size', kind: 'float', label: 'My size knob', min: 0, max: 3 },
    ];
    return p;
  };
  it('renaming a layer renames the controls still named after it', () => {
    const r = renameLayer(base(), 'p1', 'Embers');
    expect(r.layers[0].label).toBe('Embers');
    expect(r.controls.map(c => c.label)).toEqual(['Embers · Speed', 'My size knob']);
  });
  it('reset keeps the id and name; duplicate copies; a null can be made for a property', () => {
    const p = base();
    p.layers[0] = { ...p.layers[0], speed: 2.5 } as PlayLayer;
    const r = resetLayer(p, 'p1');
    expect((r.layers[0] as { speed: number }).speed).toBe(1);
    expect(r.layers[0].label).toBe('Sparks');
    const d = duplicateLayer(p, 'p1');
    expect(d.play.layers).toHaveLength(2);
    expect(d.play.layers[1].label).toBe('Sparks copy');
    const n = addNullFor(p, 'p1', 'nullId');
    expect(n.play.layers.find(l => l.id === n.id)?.kind).toBe('null');
    expect((n.play.layers[0] as { nullId: string }).nullId).toBe(n.id);
  });
});

describe('action controls', () => {
  it('fire their action on a press and each time a mapping rises past the middle', async () => {
    const { playEngine } = await import('../../lib/playEngine');
    const { actionTarget } = await import('../../types/play');
    const p = emptyPlayRecord();
    p.layers = [defaultLayer('bodies', 'b', 'Letters')];
    p.controls = [{ id: 'drop', target: actionTarget('b', 'drop'), kind: 'action', label: 'Drop', min: 0, max: 1, amount: 1 }];
    p.mappings = [{ id: 'm', controlId: 'drop', source: { kind: 'lfo', shape: 'square', rate: 1, phase: 0 }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }];
    playEngine.setRecord(p);
    const fired: string[] = [];
    const off = playEngine.onAction(a => fired.push(`${a.do}:${a.layerId}`));
    playEngine.fireControl('drop');
    expect(fired).toEqual(['drop:b']);
    // A square LFO at 1 Hz: high for half a second, low for half. Two seconds = two rises.
    for (let t = 0; t <= 2.0; t += 0.05) playEngine.tickInputs(0.05, t, () => {});
    off();
    expect(fired.length).toBeGreaterThanOrEqual(3);
    expect(fired.length).toBeLessThanOrEqual(4);
  });
});

describe('driving controls with a null', () => {
  it('pairs X with Y keys, and only real X/Y endings', () => {
    expect(pairedKey('posX')).toEqual({ axis: 'x', other: 'posY' });
    expect(pairedKey('centerY')).toEqual({ axis: 'y', other: 'centerX' });
    expect(pairedKey('x')).toEqual({ axis: 'x', other: 'y' });
    expect(pairedKey('radius')).toBeNull();
  });

  it('adds the controls, one null where the values are, and a mapping per axis', () => {
    const p = emptyPlayRecord();
    const { play, nullId, controlIds } = driveWithNull(p, [
      { target: 'c::posX', label: 'Circle · X', min: -1, max: 1, value: 0.5, axis: 'x' },
      { target: 'c::posY', label: 'Circle · Y', min: -1, max: 1, value: -1, axis: 'y' },
    ], 'Circle null');
    const nul = play.layers.find(l => l.id === nullId)!;
    expect(nul.kind).toBe('null');
    expect(nul.label).toBe('Circle null');
    expect((nul as { x: number }).x).toBeCloseTo(0.75);
    expect((nul as { y: number }).y).toBeCloseTo(0.03); // kept on the picture
    expect(play.controls.map(c => c.target)).toEqual(['c::posX', 'c::posY']);
    expect(play.mappings.map(m => [m.controlId, m.source, m.outMin, m.outMax])).toEqual([
      [controlIds[0], { kind: 'null', layerId: nullId, axis: 'x' }, -1, 1],
      [controlIds[1], { kind: 'null', layerId: nullId, axis: 'y' }, -1, 1],
    ]);
  });

  it('reuses a control already on the panel, with its own range', () => {
    const p = { ...emptyPlayRecord(), controls: [{ id: 'k', target: 'g::brightness', kind: 'float' as const, label: 'Glow', min: 2, max: 10 }] };
    const { play } = driveWithNull(p, [{ target: 'g::brightness', label: 'x', min: 0, max: 100, value: 6, axis: 'x' }], 'Glow null');
    expect(play.controls).toHaveLength(1);
    expect(play.mappings[0]).toMatchObject({ controlId: 'k', outMin: 2, outMax: 10 });
    expect((play.layers[0] as { x: number }).x).toBeCloseTo(0.5); // 6 is halfway along 2..10
  });
});

describe('solo', () => {
  it('shows only soloed layers (nulls stay) and runs only soloed mappings, without touching the record', () => {
    const p = {
      ...emptyPlayRecord(),
      layers: [defaultLayer('text', 'a', 'A'), defaultLayer('shape', 'b', 'B'), defaultLayer('null', 'n', 'N')],
      mappings: [
        { id: 'm1', controlId: 'c', source: { kind: 'lfo' as const, shape: 'sine' as const, rate: 1, phase: 0 }, outMin: 0, outMax: 1, curve: 'linear' as const, smoothMs: 0, enabled: true },
        { id: 'm2', controlId: 'c', source: { kind: 'lfo' as const, shape: 'sine' as const, rate: 1, phase: 0 }, outMin: 0, outMax: 1, curve: 'linear' as const, smoothMs: 0, enabled: true },
      ],
    };
    expect(applySolo(p, new Set(), new Set())).toBe(p);
    const s = applySolo(p, new Set(['a']), new Set(['m2']));
    expect(s.layers.map(l => l.visible)).toEqual([true, false, true]);
    expect(s.mappings.map(m => m.enabled)).toEqual([false, true]);
    expect(p.layers.every(l => l.visible) && p.mappings.every(m => m.enabled)).toBe(true);
  });
});

describe('a new null keeps clear of the others', () => {
  it('moves a one-slider null off a null already at the middle', () => {
    const p = { ...emptyPlayRecord(), layers: [{ ...defaultLayer('null', 'e', 'Emitter'), x: 0.3, y: 0.5 } as PlayLayer] };
    const { play, nullId } = driveWithNull(p, [{ target: 'g::speed', label: 'Speed', min: 0, max: 2, value: 0.6, axis: 'x' }], 'Speed null');
    const n = play.layers.find(l => l.id === nullId) as { x: number; y: number };
    expect(n.x).toBeCloseTo(0.3);
    expect(n.y).toBeCloseTo(0.3);
  });
});

describe('controls inside groups', () => {
  const leaf = { id: 'c1', type: 'circleSDF', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { radius: 0.3 } };
  const inner = { id: 'g1', type: 'group', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { 'c1::radius': 0.4, subgraph: { nodes: [leaf], edges: [] } } };
  const outer = { id: 'g0', type: 'group', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { subgraph: { nodes: [inner], edges: [] } } };
  const nodes = [outer] as unknown as import('../../types/nodeGraph').GraphNode[];

  it('reads a slider two groups deep, the outer group’s override winning', () => {
    expect(readControlValue(nodes, 'g0::g1::c1::radius')).toBe(0.4);
    const overridden = [{ ...outer, params: { ...outer.params, 'g1::c1::radius': 0.9 } }] as unknown as typeof nodes;
    expect(readControlValue(overridden, 'g0::g1::c1::radius')).toBe(0.9);
    expect(findTargetNode(nodes, 'g0::g1::c1::radius')?.id).toBe('c1');
    expect(readControlValue(nodes, 'g0::missing::c1::radius')).toBeUndefined();
  });

  it('finds a group card slider by its inner path', () => {
    const cands = [
      { target: 'g0::g1::c1::radius', kind: 'float' as const, nodeLabel: 'Circle', paramLabel: 'Radius', min: 0, max: 1, value: 0.4 },
      { target: 'g9::c1::radius', kind: 'float' as const, nodeLabel: 'Circle', paramLabel: 'Radius', min: 0, max: 1, value: 0.1 },
    ];
    expect(candidateFor(cands, 'g0', 'g1::c1::radius')?.target).toBe('g0::g1::c1::radius');
    expect(candidateFor(cands, 'g0', 'c1::radius')).toBeUndefined();
    expect(candidateFor(cands, 'c1', 'radius')?.target).toBe('g0::g1::c1::radius');
  });
});
