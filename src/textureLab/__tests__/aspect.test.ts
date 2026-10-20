/**
 * Texture Lab and Combine show a photo at its own shape (LiveViewport `aspect`, ownSizeRect), not stretched to the
 * window; the built source's colour and texture line up (Stretch); Height Light in Texture Lab starts as a clean relief
 * on a picture (brightness ranges 0…1, flat parts keep their tone).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { ownSizeRect } from '../../lib/previewSize';
import { nodePictureAspect } from '../../components/builders/studio/usePictureAspect';
import { adoptPreviewCanvas, placeLentCanvas, setPreviewCanvas } from '../../lib/previewMirror';
import { HeightLightNode } from '../../nodes/definitions/heightLight';
import { blockDef } from '../blocks';
import { TX_PRESETS, withPreset } from '../presets';
import { blankSpec, newBlock, txSourceAspect } from '../spec';
import { applyTextureLab } from '../apply';

describe('ownSizeRect', () => {
  it('no aspect: the whole box (the Splat builder, as before)', () => {
    expect(ownSizeRect({ w: 800, h: 600 })).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(ownSizeRect({ w: 800, h: 600 }, null)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(ownSizeRect({ w: 800, h: 600 }, 0)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(ownSizeRect({ w: 800, h: 600 }, Number.NaN)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it('a 16:9 photo in a near-square box: full width, letterboxed top and bottom, centred', () => {
    const r = ownSizeRect({ w: 816, h: 636.6 }, 1280 / 720);
    expect(r).toEqual({ x: 0, y: 89, w: 816, h: 459 });
    expect(r.w / r.h).toBeCloseTo(16 / 9, 2);
  });

  it('a tall photo in a wide box: full height, pillarboxed, centred', () => {
    const r = ownSizeRect({ w: 1000, h: 600 }, 768 / 1024);
    expect(r).toEqual({ x: 275, y: 0, w: 450, h: 600 });
  });

  it('whole pixels, never past the box', () => {
    for (const [w, h, a] of [[333.3, 211.7, 1.7777], [97, 1003, 0.75], [1, 1, 3]] as const) {
      const r = ownSizeRect({ w, h }, a);
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
      expect(r.x + r.w).toBeLessThanOrEqual(Math.round(w));
      expect(r.y + r.h).toBeLessThanOrEqual(Math.round(h));
      expect(r.w).toBeGreaterThan(0);
    }
  });

  it('nothing measured yet: nothing to draw', () => {
    expect(ownSizeRect({ w: 0, h: 0 }, 1.5)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('the lent canvas', () => {
  it('sits where the viewport puts it, and goes back as it was', () => {
    const home = { insertBefore: vi.fn(), removeChild: vi.fn() };
    const style: Record<string, string> = { position: '', left: '', top: '', pointerEvents: '' };
    const canvas = { parentNode: home, nextSibling: null, style, remove: vi.fn() } as unknown as HTMLCanvasElement;
    const host = { insertBefore: vi.fn(), firstChild: null } as unknown as HTMLElement;
    const other = { insertBefore: vi.fn(), firstChild: null } as unknown as HTMLElement;
    setPreviewCanvas(canvas);
    const give = adoptPreviewCanvas(host)!;
    expect(give).toBeTypeOf('function');
    expect([style.left, style.top]).toEqual(['0', '0']);
    placeLentCanvas(host, 12.4, 89);
    expect([style.left, style.top]).toEqual(['12px', '89px']);
    placeLentCanvas(other, 5, 5); // not lent to it: nothing
    expect([style.left, style.top]).toEqual(['12px', '89px']);
    give();
    expect([style.left, style.top, style.position]).toEqual(['', '', '']);
    placeLentCanvas(host, 1, 1); // given back: nothing
    expect(style.left).toBe('');
    setPreviewCanvas(null);
  });
});

describe('the source picture\'s shape', () => {
  it('the built-in photos and clip, a Texture Input of yours; unknown otherwise', () => {
    expect(txSourceAspect({ source: { kind: 'room' } }, [])).toBeCloseTo(1280 / 720);
    expect(txSourceAspect({ source: { kind: 'walkway' } }, [])).toBeCloseTo(768 / 1024);
    expect(txSourceAspect({ source: { kind: 'ball' } }, [])).toBeCloseTo(960 / 540);
    const pic = n('textureInput', 'pic', 0, 0, { _imageAspect: 0.5 });
    const vid = n('videoInput', 'vid', 0, 0);
    expect(txSourceAspect({ source: { kind: 'node', nodeId: 'pic' } }, [pic])).toBe(0.5);
    expect(txSourceAspect({ source: { kind: 'node', nodeId: 'vid' } }, [vid])).toBeNull();
    expect(txSourceAspect({ source: { kind: 'node', nodeId: 'gone' } }, [])).toBeNull();
    expect(nodePictureAspect(pic)).toBe(0.5);
    expect(nodePictureAspect(vid)).toBeNull();
    expect(nodePictureAspect(n('textureInput', 'bad', 0, 0, { _imageAspect: -1 }))).toBeNull();
  });
});

describe('the built source', () => {
  let c = 0;
  const nextId = () => `a${++c}`;
  it('a photo is Stretch, so its colour and its texture (what Height Light, Blur, Segment read) line up', () => {
    const spec = blankSpec({ kind: 'room' });
    spec.blocks.push(newBlock(spec, 'heightLight'));
    const r = applyTextureLab([n('output', 'out', 800, 0)], spec, { nextId });
    const src = r.nodes.find(x => x.id === r.sourceId)!;
    expect(src.params.fit).toBe('stretch');
    // A build made before (Fill kept on its source) is put right on the next rebuild.
    const old = r.nodes.map(x => (x.id === r.sourceId ? { ...x, params: { ...x.params, fit: 'cover' } } : x));
    const again = applyTextureLab(old, spec, { nextId, sourceId: r.sourceId });
    expect(again.nodes.find(x => x.id === r.sourceId)!.params.fit).toBe('stretch');
  });
});

describe('Height Light on a picture', () => {
  it('Texture Lab starts it as a relief: brightness, a gentle relief, flat parts kept, ranges for 0…1', () => {
    const def = blockDef('heightLight')!;
    expect(def.start).toMatchObject({ channel: 'bright', keepFlat: true });
    expect(Number(def.start!.relief)).toBeLessThanOrEqual(0.1);
    expect(def.ranges?.low).toMatchObject({ min: 0, max: 1 });
    expect(def.ranges?.high).toMatchObject({ min: 0, max: 1 });
    const relief = TX_PRESETS.find(p => p.key === 'relief')!;
    const preset = withPreset(blankSpec(), relief.key);
    expect(preset.blocks[0].params).toMatchObject({ keepFlat: true, low: 0, high: 1 });
  });

  it('the node keeps its old look unless Keep flat parts is on; on, it divides by the light flat ground gets', () => {
    expect(HeightLightNode.defaultParams?.keepFlat).toBe(false);
    const glsl = (keepFlat: boolean) => HeightLightNode.generateGLSL!(
      { ...n('heightLight', 'hl', 0, 0, { channel: 'bright', keepFlat }) },
      { texture: 'u_tex' } as Record<string, string>,
    ).code;
    expect(glsl(false)).not.toContain('/ max(0.3');
    expect(glsl(true)).toContain('/ max(0.3 + (1.0 - 0.3) * sin(radians(35.0)), 1e-3)');
  });

  it('with Keep flat parts on, it compiles in a built stack', () => {
    const spec = withPreset(blankSpec({ kind: 'room' }), 'relief');
    let k = 0;
    const r = applyTextureLab([n('output', 'out', 800, 0)], spec, { nextId: () => `k${++k}` });
    const c = compileGraph({ nodes: r.nodes });
    expect(c.errors ?? []).toEqual([]);
    expect(c.success).toBe(true);
  });
});
