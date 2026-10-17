/**
 * Segment (docs/segment-node.md): people, objects, or whatever you click, cut out of a picture or video as a mask,
 * on this device. Plan: docs/segmentation-plan.md.
 *
 * The model runs outside the shader (lib/segment/engine.ts, a MediaPipe worker): each frame the wired texture is
 * copied at the model's size, segmented, and the confidence (0–1) comes back and is uploaded to an 8-bit texture,
 * `u_tex_<slug>` (the store's nodeTextures[id]). The shader turns it into the mask: Threshold and Softness, Grow
 * (or shrink) by the nearest of eight taps, Invert; and the cut-out, the source times the mask.
 *
 * The node writes one comment naming the texture wired into it (SEGMENT_SOURCE_MARK), as Depth and Blob Track do.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';

export const SEGMENT_TYPE = 'segment';
/** `// segment-source <its sampler> <wired sampler>`: what the engine reads (lib/segment/engine.ts). */
export const SEGMENT_SOURCE_MARK = '// segment-source ';
/** What a finished Bake wrote: the masks as a grey video (or a still as a grey image) in the library. */
export interface SegmentBakeInfo {
  kind: 'video' | 'image';
  /** The video library id (kind video). */
  videoId?: string;
  /** The image library id (kind image). */
  libraryId?: string;
  mode: SegmentModeName;
  side: number;
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration: number;
  smoothing: number;
  bytes: number;
  bakedAt: number;
  /** What it was baked from (a node's name). */
  source: string;
}

export const segmentBakeOf = (node: GraphNode): SegmentBakeInfo | null => {
  const b = node.params.segmentBake as SegmentBakeInfo | undefined;
  return b && typeof b === 'object' && (b.kind === 'video' || b.kind === 'image') && segmentBakeId(b) ? b : null;
};
/** The library id a bake's file is kept under. */
export const segmentBakeId = (b: SegmentBakeInfo): string => String((b.kind === 'video' ? b.videoId : b.libraryId) || '');
/** The node plays a baked mask (Update: Baked, and a bake exists). */
export const segmentPlaysBake = (node: GraphNode): SegmentBakeInfo | null => (node.params.update === 'baked' ? segmentBakeOf(node) : null);

/** Its sampler: a baked video plays through the video path (u_vid_), everything else is the node's texture (u_tex_). */
export const segmentSampler = (slug: string, node?: GraphNode): string =>
  (node && segmentPlaysBake(node)?.kind === 'video' ? `u_vid_${slug}` : `u_tex_${slug}`);

export type SegmentModeName = 'people' | 'objects' | 'click';
export const segmentModeOf = (n: GraphNode): SegmentModeName => (n.params.mode === 'objects' || n.params.mode === 'click' ? n.params.mode : 'people');

/** DeepLab v3's Pascal VOC classes (the model's labels, background left out), with names for the card. */
export const SEGMENT_CLASSES: readonly { key: string; label: string }[] = [
  { key: 'person', label: 'Person' }, { key: 'cat', label: 'Cat' }, { key: 'dog', label: 'Dog' }, { key: 'bird', label: 'Bird' },
  { key: 'horse', label: 'Horse' }, { key: 'sheep', label: 'Sheep' }, { key: 'cow', label: 'Cow' }, { key: 'car', label: 'Car' },
  { key: 'bus', label: 'Bus' }, { key: 'bicycle', label: 'Bicycle' }, { key: 'motorbike', label: 'Motorbike' }, { key: 'train', label: 'Train' },
  { key: 'boat', label: 'Boat' }, { key: 'aeroplane', label: 'Aeroplane' }, { key: 'bottle', label: 'Bottle' }, { key: 'chair', label: 'Chair' },
  { key: 'diningtable', label: 'Table' }, { key: 'pottedplant', label: 'Potted plant' }, { key: 'sofa', label: 'Sofa' }, { key: 'tv', label: 'TV / screen' },
];

/** The kinds grouped for the card's Add list (Objects mode). */
export const SEGMENT_CLASS_GROUPS: readonly { label: string; keys: readonly string[] }[] = [
  { label: 'People & animals', keys: ['person', 'cat', 'dog', 'bird', 'horse', 'sheep', 'cow'] },
  { label: 'Vehicles', keys: ['car', 'bus', 'bicycle', 'motorbike', 'train', 'boat', 'aeroplane'] },
  { label: 'Things', keys: ['bottle', 'chair', 'diningtable', 'pottedplant', 'sofa', 'tv'] },
];

/** The chosen classes, from the comma list in params.classes. */
export const segmentClassesOf = (n: GraphNode): string[] =>
  String(n.params.classes ?? 'person').split(',').map(s => s.trim().toLowerCase()).filter(k => SEGMENT_CLASSES.some(c => c.key === k));

/** The long side a mode reads frames at, unless Resolution says otherwise. */
export function segmentSideOf(n: GraphNode): number {
  const r = Number(n.params.resolution);
  if ([256, 384, 512].includes(r)) return r;
  return segmentModeOf(n) === 'click' ? 512 : 256;
}

const MASK = 'Mask';
const FIND = 'Find';

export const SegmentNode: NodeDefinition = withParamSockets({
  type: SEGMENT_TYPE,
  label: 'Segment',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Segmentation', 'Mask person', 'Background removal', 'Remove background', 'Rotoscope', 'Keyer', 'Cut out', 'Select object', 'Magic select', 'Matte'],
  description: 'Cuts people, objects, or whatever you click out of a picture or video as a mask, on this device, no green screen. People finds everyone; Objects finds the kinds you choose (person, cat, dog, car…); Click finds what is under a point you pick on the preview, and follows it as it moves. Mask is 1 on it; Cut-out is the picture there; Mask texture feeds Blob Track, Particles, a Cache or the Texture tools.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'The picture to cut from: a Video Input (or the camera), Texture Input, Baked, a Pass.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the mask, in picture coordinates. Empty: this pixel.' },
  },
  outputs: {
    mask: { type: 'float', label: 'Mask', hint: '1 on what was found, 0 elsewhere, soft at the edge (Threshold, Softness, Grow, Invert).' },
    cutout: { type: 'vec3', label: 'Cut-out', hint: 'The picture times the mask: what was found, on black.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'The same as Mask, to lay the Cut-out over something with Alpha Blend or Mix.' },
    edge: { type: 'float', label: 'Edge', hint: 'Bright along the mask\'s edge: for an outline or a glow round what was found.' },
    texture: { type: 'texture', label: 'Mask texture', hint: 'The model\'s confidence (red, 0–1, before Threshold) as a texture: for Blob Track, Particles\' Emit from, a Pass, a Cache, Blur, the Texture tools.' },
  },
  defaultParams: { mode: 'people', classes: 'person', pointX: 0.5, pointY: 0.5, follow: true, resolution: 'auto', update: 'live', every: 2, smoothing: 0.3, threshold: 0.5, softness: 0.1, grow: 0, invert: false, refine: 'off', refineReach: 1.5, refineColour: 0.12 },
  paramDefs: {
    mode: { label: 'Find', type: 'select', section: FIND, hint: 'People: everyone in the picture. Objects: the kinds you choose. Click: what is under the point you pick.', options: [
      { value: 'people', label: 'People' }, { value: 'objects', label: 'Objects' }, { value: 'click', label: 'Click (pick a point)' },
    ] },
    pointX: { label: 'Point X', type: 'float', min: 0, max: 1, step: 0.001, section: FIND, compileTime: true, showWhen: { param: 'mode', value: 'click' }, hint: 'Where to find the object, across the picture (0 left, 1 right). Pick on the card sets it.' },
    pointY: { label: 'Point Y', type: 'float', min: 0, max: 1, step: 0.001, section: FIND, compileTime: true, showWhen: { param: 'mode', value: 'click' }, hint: 'Up the picture (0 bottom, 1 top).' },
    follow: { label: 'Follow', type: 'bool', section: FIND, showWhen: { param: 'mode', value: 'click' }, hint: 'In a moving picture, look next frame where the object is now (the middle of its mask), so it stays selected as it moves.' },
    resolution: { label: 'Resolution', type: 'select', section: FIND, hint: 'The long side frames are read at. Auto: the model\'s own (256 for People and Objects, 512 for Click).', options: [
      { value: 'auto', label: 'Auto' }, { value: '256', label: '256 px' }, { value: '384', label: '384 px' }, { value: '512', label: '512 px' },
    ] },
    update: { label: 'Update', type: 'select', section: FIND, hint: 'Live: as fast as the model goes. Every Nth frame: lighter. Baked: the masks Bake worked out once for the whole video (smooth, exact in exports and web pages); press Bake on the card first.', options: [
      { value: 'live', label: 'Live' }, { value: 'every', label: 'Every Nth frame' }, { value: 'baked', label: 'Baked' },
    ] },
    every: { label: 'Every', type: 'int', min: 1, max: 30, step: 1, section: FIND, showWhen: { param: 'update', value: 'every' }, hint: 'Run the model once every this many frames.' },
    smoothing: { label: 'Smoothing', type: 'float', min: 0, max: 0.95, step: 0.01, section: FIND, compileTime: true, hint: 'Blends each new mask with the last: less flicker, a little lag.' },
    threshold: { label: 'Threshold', type: 'float', min: 0, max: 1, step: 0.01, section: MASK, hint: 'How sure the model must be: higher keeps only the clearest parts.' },
    softness: { label: 'Softness', type: 'float', min: 0, max: 0.5, step: 0.005, section: MASK, hint: 'How soft the mask\'s edge is.' },
    grow: { label: 'Grow', type: 'float', min: -20, max: 20, step: 0.5, section: MASK, hint: 'Pixels to grow the mask by (negative shrinks it).' },
    invert: { label: 'Invert', type: 'bool', section: MASK, hint: 'Everything except what was found (the background).' },
    refine: { label: 'Edge refine', type: 'select', section: MASK, hint: 'Off: the model\'s mask as it is, a little blocky (it is worked out at 256–512 px). On: the mask\'s edge snaps to the picture\'s own edges (where the colour changes), so it follows hair, fingers and outlines at full size. Needs a Texture wired.', options: [
      { value: 'off', label: 'Off' }, { value: 'on', label: 'On (snap to the picture)' },
    ] },
    refineReach: { label: 'Refine reach', type: 'float', min: 0.5, max: 4, step: 0.05, section: MASK, showWhen: { param: 'refine', value: 'on' }, hint: 'How far round each pixel it looks, in the mask\'s own pixels: wider fixes blockier masks, too wide blurs fine detail.' },
    refineColour: { label: 'Colour difference', type: 'float', min: 0.01, max: 1, step: 0.005, section: MASK, showWhen: { param: 'refine', value: 'on' }, hint: 'How different a colour must be to count as the other side of an edge: lower follows faint edges, higher only strong ones.' },
  },
  declarationsFor: (node: GraphNode) => [`#define ${segmentSampler(node.id, node)}_px (vec2(1.0) / u_resolution)`],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, P = node.params, S = segmentSampler(id, node), src = inputVars.texture;
    const st = `${id}_st`;
    const g = p(P.grow, 0);
    const refine = P.refine === 'on' && !!src;
    const code = [
      // What the engine reads (lib/segment/engine.ts); empty: the picture.
      `    ${SEGMENT_SOURCE_MARK}${S} ${src ?? 'picture'}\n`,
      `    vec2 ${st} = clamp(${texUv(inputVars.uv ?? 'g_uv')}, 0.0, 1.0);\n`,
      `    float ${id}_c = texture2D(${S}, ${st}).r;\n`,
      // Edge refine: the low-resolution mask, re-weighted by how alike the picture's colour is (a joint bilateral
      // upsample): mask texels across an edge in the picture count for little, so the edge lands where the picture's is.
      refine ? [
        `    {\n`,
        `      vec2 rt = ${p(P.refineReach, 1.5)} / vec2(textureSize(${S}, 0));\n`,
        `      vec3 c0 = texture2D(${src}, ${st}).rgb;\n`,
        `      float sig = max(${p(P.refineColour, 0.12)}, 0.005);\n`,
        `      float wsum = 0.0, msum = 0.0;\n`,
        `      for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {\n`,
        `        vec2 q = clamp(${st} + vec2(float(i), float(j)) * rt, 0.0, 1.0);\n`,
        `        vec3 dc = texture2D(${src}, q).rgb - c0;\n`,
        `        float w = exp(-dot(dc, dc) / (2.0 * sig * sig)) * exp(-float(i * i + j * j) / 4.5);\n`,
        `        wsum += w; msum += w * texture2D(${S}, q).r;\n`,
        `      }\n`,
        `      ${id}_c = msum / max(wsum, 1e-5);\n`,
        `    }\n`,
      ].join('') : '',
      // Grow / shrink: the most (or least) confident of eight taps Grow pixels away.
      `    if (abs(${g}) > 0.01) {\n`,
      `      vec2 r = abs(${g}) / u_resolution;\n`,
      `      for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; float t = texture2D(${S}, ${st} + vec2(cos(a), sin(a)) * r).r; ${id}_c = ${g} > 0.0 ? max(${id}_c, t) : min(${id}_c, t); }\n`,
      `    }\n`,
      `    float ${id}_m = smoothstep(${p(P.threshold, 0.5)} - ${p(P.softness, 0.1)} - 1e-4, ${p(P.threshold, 0.5)} + ${p(P.softness, 0.1)}, ${id}_c);\n`,
      P.invert === true ? `    ${id}_m = 1.0 - ${id}_m;\n` : '',
      `    vec3 ${id}_cut = ${src ? `texture2D(${src}, ${st}).rgb * ${id}_m` : `vec3(${id}_m)`};\n`,
      `    float ${id}_edge = clamp(4.0 * ${id}_m * (1.0 - ${id}_m), 0.0, 1.0);\n`,
    ].join('');
    return { code, outputVars: { mask: `${id}_m`, cutout: `${id}_cut`, alpha: `${id}_m`, edge: `${id}_edge`, texture: S } };
  },
}, ['threshold', 'softness', 'grow']);
