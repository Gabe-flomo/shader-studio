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
export const segmentSampler = (slug: string): string => `u_tex_${slug}`;

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
  defaultParams: { mode: 'people', classes: 'person', pointX: 0.5, pointY: 0.5, follow: true, resolution: 'auto', update: 'live', every: 2, smoothing: 0.3, threshold: 0.5, softness: 0.1, grow: 0, invert: false },
  paramDefs: {
    mode: { label: 'Find', type: 'select', section: FIND, hint: 'People: everyone in the picture. Objects: the kinds you choose. Click: what is under the point you pick.', options: [
      { value: 'people', label: 'People' }, { value: 'objects', label: 'Objects' }, { value: 'click', label: 'Click (pick a point)' },
    ] },
    classes: { label: 'Kinds', type: 'string', section: FIND, showWhen: { param: 'mode', value: 'objects' }, hint: 'Which kinds of object, comma-separated: person, cat, dog, bird, horse, car, bus, bicycle, bottle, chair, sofa, tv… (pick them on the card).' },
    pointX: { label: 'Point X', type: 'float', min: 0, max: 1, step: 0.001, section: FIND, compileTime: true, showWhen: { param: 'mode', value: 'click' }, hint: 'Where to find the object, across the picture (0 left, 1 right). Pick on the card sets it.' },
    pointY: { label: 'Point Y', type: 'float', min: 0, max: 1, step: 0.001, section: FIND, compileTime: true, showWhen: { param: 'mode', value: 'click' }, hint: 'Up the picture (0 bottom, 1 top).' },
    follow: { label: 'Follow', type: 'bool', section: FIND, showWhen: { param: 'mode', value: 'click' }, hint: 'In a moving picture, look next frame where the object is now (the middle of its mask), so it stays selected as it moves.' },
    resolution: { label: 'Resolution', type: 'select', section: FIND, hint: 'The long side frames are read at. Auto: the model\'s own (256 for People and Objects, 512 for Click).', options: [
      { value: 'auto', label: 'Auto' }, { value: '256', label: '256 px' }, { value: '384', label: '384 px' }, { value: '512', label: '512 px' },
    ] },
    update: { label: 'Update', type: 'select', section: FIND, hint: 'Live: as fast as the model goes. Every Nth frame: lighter.', options: [
      { value: 'live', label: 'Live' }, { value: 'every', label: 'Every Nth frame' },
    ] },
    every: { label: 'Every', type: 'int', min: 1, max: 30, step: 1, section: FIND, showWhen: { param: 'update', value: 'every' }, hint: 'Run the model once every this many frames.' },
    smoothing: { label: 'Smoothing', type: 'float', min: 0, max: 0.95, step: 0.01, section: FIND, compileTime: true, hint: 'Blends each new mask with the last: less flicker, a little lag.' },
    threshold: { label: 'Threshold', type: 'float', min: 0, max: 1, step: 0.01, section: MASK, hint: 'How sure the model must be: higher keeps only the clearest parts.' },
    softness: { label: 'Softness', type: 'float', min: 0, max: 0.5, step: 0.005, section: MASK, hint: 'How soft the mask\'s edge is.' },
    grow: { label: 'Grow', type: 'float', min: -20, max: 20, step: 0.5, section: MASK, hint: 'Pixels to grow the mask by (negative shrinks it).' },
    invert: { label: 'Invert', type: 'bool', section: MASK, hint: 'Everything except what was found (the background).' },
  },
  declarationsFor: (node: GraphNode) => [`#define ${segmentSampler(node.id)}_px (vec2(1.0) / u_resolution)`],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, P = node.params, S = segmentSampler(id), src = inputVars.texture;
    const st = `${id}_st`;
    const g = p(P.grow, 0);
    const code = [
      // What the engine reads (lib/segment/engine.ts); empty: the picture.
      `    ${SEGMENT_SOURCE_MARK}${S} ${src ?? 'picture'}\n`,
      `    vec2 ${st} = clamp(${texUv(inputVars.uv ?? 'g_uv')}, 0.0, 1.0);\n`,
      `    float ${id}_c = texture2D(${S}, ${st}).r;\n`,
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
