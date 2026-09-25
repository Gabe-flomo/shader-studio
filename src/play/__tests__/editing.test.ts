/**
 * On-picture editing and the layer helpers around it: handle maths (resize
 * from the opposite corner, Shift keeps the shape, rotation), web font links,
 * emoji-safe glyph ramps, and layer renames carrying their controls along.
 */
import { describe, it, expect } from 'vitest';
import { dragHandle, handleAt, handlePoints, insideBounds, patchFor, type Bounds } from '../transform';
import { klGlyphList, klParseFontUrl } from '../kit/layers.js';
import { addNullFor, duplicateLayer, renameLayer, resetLayer } from '../../components/play/layerOps';
import { defaultLayer, emptyPlayRecord, type PlayLayer } from '../../types/play';

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
