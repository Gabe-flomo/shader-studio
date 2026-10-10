/**
 * The Texture node (docs/texture-node.md): one card over the two engine types. Old Texture
 * Input / Video Input graphs compile exactly as before; the source switch keeps the node and
 * its wires; the picture extras (tile, wrap, crop / rotate / flip) only add code when set;
 * Generate depth wires a Depth node (2D) or a Depth Composite setup (3D) beside the card.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../../compiler/graphCompiler';
import { n } from '../../../store/graphBuilder';
import { getNodeDefinition, getOfferedDefinitions } from '../../../nodes/definitions';
import { croppedAspect } from '../../../nodes/definitions/sources';
import { switchTextureKind, switchTextureKindIn, textureKindOf, webcamNodes } from '../textureSource';
import { placeBesideCard, planGenerateDepth } from '../generateDepth';
import { cameraLayerOf, ensureCameraLayer, mirrorParams, setCameraMirror, WebcamTextures } from '../webcam';
import { emptyPlayRecord } from '../../../types/play';
import type { GraphNode } from '../../../types/nodeGraph';

const picture = (params: Record<string, unknown> = {}) => [
  n('uv', 'node_1', 0, 0),
  n('textureInput', 'node_2', 0, 0, params, { uv: ['node_1', 'uv'] }),
  n('output', 'node_3', 0, 0, {}, { color: ['node_2', 'color'] }),
];
const video = (params: Record<string, unknown> = {}) => [
  n('uv', 'node_1', 0, 0),
  n('videoInput', 'node_2', 0, 0, params, { uv: ['node_1', 'uv'] }),
  n('output', 'node_3', 0, 0, {}, { color: ['node_2', 'color'] }),
];

describe('old Texture Input and Video Input graphs', () => {
  it('compile as they always did: the same sampling line, no new code', () => {
    const img = compileGraph({ nodes: picture({ fit: 'stretch', _imageAspect: 1.5, _thumbnailUrl: 'data:image/jpeg;base64,xx' }) });
    expect(img.success).toBe(true);
    expect(img.fragmentShader).toMatch(/vec4 \w+_sample = texture2D\(u_tex_\w+, clamp\(\(\w+ \/ vec2\(u_resolution\.x \/ u_resolution\.y, 1\.0\) \* 0\.5 \+ 0\.5\), 0\.0, 1\.0\)\);/);
    expect(img.fragmentShader.split('void main()')[1]).not.toMatch(/_st = |fract\(|_cst/);
    expect(Object.values(img.textureUniforms)).toEqual(['node_2']);
    const vid = compileGraph({ nodes: video({ _fileName: 'a.mp4', _hasFile: true }) });
    expect(vid.success).toBe(true);
    expect(Object.values(vid.videoUniforms)).toEqual(['node_2']);
    expect(vid.fragmentShader).not.toMatch(/_cst/);
  });

  it('the browser offers one Texture node; Video Input stays registered for saved graphs', () => {
    const offered = getOfferedDefinitions().map(d => d.type);
    expect(offered).toContain('textureInput');
    expect(getNodeDefinition('textureInput')!.label).toBe('Texture');
    expect(getNodeDefinition('videoInput')).toBeTruthy();
    expect(getNodeDefinition('textureInput')!.aliases).toEqual(expect.arrayContaining(['Texture Input', 'Video', 'Webcam']));
  });
});

describe('picture extras', () => {
  it('tile, wrap and crop / rotate / flip add code only when set', () => {
    const fs = (p: Record<string, unknown>) => compileGraph({ nodes: picture(p) }).fragmentShader;
    expect(fs({ wrap: 'repeat', tile: 3 })).toMatch(/vec2 \w+_st = fract\(\(\(.*\) - 0\.5\) \* 3\.0000 \+ 0\.5\)\);/);
    expect(fs({ wrap: 'mirror' })).toMatch(/1\.0 - abs\(mod\(/);
    const cropped = fs({ clip: { crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, rotate: 0, flipX: false, flipY: false } });
    expect(cropped).toMatch(/vec2 \w+_cst = vec2\(/);
    expect(cropped).toMatch(/texture2D\(u_tex_\w+, \w+_cst\)/);
    // An identity clip is no clip.
    expect(fs({ clip: { rotate: 0 } })).not.toMatch(/_cst/);
  });

  it('Fit and Fill keep the cropped, turned picture\'s aspect', () => {
    expect(croppedAspect(2, undefined)).toBe(2);
    expect(croppedAspect(2, { rotate: 90 })).toBeCloseTo(0.5, 5);
    expect(croppedAspect(2, { crop: { x: 0, y: 0, w: 0.5, h: 1 } })).toBeCloseTo(1, 5);
  });
});

describe('the source switch', () => {
  it('keeps the node: id, place and every wire, and the compile follows', () => {
    const nodes = picture({ libraryId: 'img_1', _imageSrc: 'data:image/png;base64,AAAA', _imageName: 'dusk', fit: 'cover', _imageAspect: 2 });
    const asVideo = switchTextureKindIn(nodes, 'node_2', 'video');
    const v = asVideo.find(x => x.id === 'node_2')!;
    expect(v.type).toBe('videoInput');
    expect(v.position).toEqual({ x: 0, y: 0 });
    expect(v.inputs.uv.connection).toEqual({ nodeId: 'node_1', outputKey: 'uv' });
    expect(asVideo.find(x => x.id === 'node_3')!.inputs.color.connection).toEqual({ nodeId: 'node_2', outputKey: 'color' });
    expect(v.params.libraryId).toBeUndefined();
    const r = compileGraph({ nodes: asVideo });
    expect(r.success).toBe(true);
    expect(Object.values(r.videoUniforms)).toEqual(['node_2']);
    // Back to the picture: what it had comes back.
    const back = switchTextureKind(v, 'image');
    expect(back.type).toBe('textureInput');
    expect(back.params).toMatchObject({ libraryId: 'img_1', _imageName: 'dusk', fit: 'cover', _imageAspect: 2 });
  });

  it('webcam is a Video Input reading the camera, mirrored by a flip', () => {
    const cam = switchTextureKind(picture()[1], 'webcam');
    expect(cam.type).toBe('videoInput');
    expect(textureKindOf(cam)).toBe('webcam');
    expect(cam.params.clip).toEqual({ flipX: true });
    expect(webcamNodes([cam, picture()[1]]).map(x => x.id)).toEqual(['node_2']);
    const fs = compileGraph({ nodes: [picture()[0], cam, picture()[2]] }).fragmentShader;
    expect(fs).toMatch(/_cst = vec2\(1\.0+ \+ -1\.0+ \* /);
    expect(mirrorParams(false)).toEqual({ mirror: false, clip: undefined });
  });
});

describe('webcam layer', () => {
  it('choosing Webcam adds one hidden Camera layer to Play (never a second)', () => {
    let id = 0;
    const made = ensureCameraLayer(emptyPlayRecord(), () => `layer_${++id}`);
    expect(made.created).toBe(true);
    expect(made.layer).toMatchObject({ kind: 'camera', visible: false, toShader: false, mirror: true });
    const again = ensureCameraLayer(made.play, () => `layer_${++id}`);
    expect(again.created).toBe(false);
    expect(again.play).toBe(made.play);
    expect(cameraLayerOf(setCameraMirror(made.play, false))!.mirror).toBe(false);
  });
});

describe('webcam texture plumbing (the camera mocked: no camera in tests or the browser pane)', () => {
  it('binds the camera into each webcam node while it is on, and lets go when it stops or the node leaves', () => {
    let el: HTMLVideoElement | null = null;
    const bound: Record<string, unknown> = {};
    const w = new WebcamTextures({ element: () => el, setTexture: (id, t) => { bound[id] = t; } });
    const cam = switchTextureKind(picture()[1], 'webcam');
    w.sync([cam]);
    expect(bound.node_2).toBeNull();
    expect(w.active()).toBe(false);
    el = { videoWidth: 1280, videoHeight: 720 } as unknown as HTMLVideoElement;
    w.sync([cam]);
    expect((bound.node_2 as { image: unknown }).image).toBe(el);
    expect(w.active()).toBe(true);
    w.sync([]);
    expect(bound.node_2).toBeNull();
    expect(w.active()).toBe(false);
  });
});

describe('Generate depth', () => {
  let k = 0;
  const nextId = () => `new_${++k}`;

  it('2D: a Depth node reading the texture, beside the card', () => {
    const nodes = picture();
    const plan = planGenerateDepth(nodes, 'node_2', nextId, { x: -100, y: -100, w: 1600, h: 900 })!;
    const depth = plan.nodes.find(x => x.id === plan.depthId)!;
    expect(depth.type).toBe('depth');
    expect(depth.inputs.texture.connection).toEqual({ nodeId: 'node_2', outputKey: 'texture' });
    expect(plan.compositeId).toBeNull();
    expect(plan.bake).toBe(false);
    expect(depth.position.x).toBeGreaterThan(0);
    expect(compileGraph({ nodes: plan.nodes }).success).toBe(true);
  });

  it('a video starts on Update: Baked and offers Bake depth; the webcam runs every 4th frame', () => {
    const v = planGenerateDepth(video(), 'node_2', nextId, null)!;
    expect(v.bake).toBe(true);
    expect(v.nodes.find(x => x.id === v.depthId)!.params.update).toBe('baked');
    const cam = switchTextureKindIn(picture(), 'node_2', 'webcam');
    const c = planGenerateDepth(cam, 'node_2', nextId, null)!;
    expect(c.nodes.find(x => x.id === c.depthId)!.params).toMatchObject({ update: 'every', every: 4 });
  });

  it('3D: a Depth Composite wired to the March Loop, and the Output shows it', () => {
    const loop = n('marchLoopGroup', 'loop', 800, 0);
    const out = n('output', 'out', 1200, 0, {}, { color: ['loop', 'color'] });
    const nodes: GraphNode[] = [n('uv', 'node_1', 0, 0), n('textureInput', 'node_2', 0, 0, {}, { uv: ['node_1', 'uv'] }), loop, out];
    const plan = planGenerateDepth(nodes, 'node_2', nextId, null)!;
    const comp = plan.nodes.find(x => x.id === plan.compositeId)!;
    expect(comp.type).toBe('depthComposite');
    expect(comp.inputs.picture.connection).toEqual({ nodeId: 'node_2', outputKey: 'color' });
    expect(comp.inputs.nearness.connection).toEqual({ nodeId: plan.depthId, outputKey: 'depth' });
    expect(comp.inputs.scene.connection).toEqual({ nodeId: 'loop', outputKey: 'color' });
    expect(comp.inputs.dist.connection).toEqual({ nodeId: 'loop', outputKey: 'dist' });
    expect(comp.inputs.hit.connection).toEqual({ nodeId: 'loop', outputKey: 'hit' });
    expect(plan.nodes.find(x => x.id === 'out')!.inputs.color.connection).toEqual({ nodeId: comp.id, outputKey: 'color' });
  });

  it('places new cards inside the view and off other cards', () => {
    const card = n('textureInput', 'c', 1000, 100);
    const blocker = n('uv', 'b', 1400, 100);
    const view = { x: 0, y: 0, w: 1500, h: 800 };
    const [a, b] = placeBesideCard(card, 2, [card, blocker], view);
    // No room on the right inside the view: to the left of the card.
    expect(a.x).toBeLessThan(1000);
    for (const p of [a, b]) {
      expect(p.x).toBeGreaterThanOrEqual(view.x);
      expect(p.x + 360).toBeLessThanOrEqual(view.x + view.w);
      expect(p.y).toBeGreaterThanOrEqual(view.y);
    }
    expect(b.y).toBeGreaterThan(a.y);
  });
});
