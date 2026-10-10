/**
 * Depth (docs/depth-node.md): a picture in, its depth out, worked out on this device by a small model
 * (Depth Anything V2 Small; with experimental depth models on, others too: src/depthModel/).
 *
 * The model runs outside the shader, in a worker (lib/depth/engine.ts): frames of the wired texture are grabbed
 * at the model's size, the depth comes back and is uploaded to a texture this node samples. The picture never
 * waits: until the next depth arrives the last one is reused, and until the first (or before the model is
 * downloaded) the depth reads 0.
 *
 * The sampler: `u_tex_<slug>` (the store's nodeTextures[id], a half-float texture, live), or `u_vid_<slug>` once a
 * video's depth is baked (the store's videoTextures[id]: the depth video, kept on the source video's time).
 * The texture holds nearness in red: 1 is the nearest thing in the frame. With a metric model (Depth Pro, ZoeDepth)
 * green holds the distance in metres, read by the Distance output; otherwise Distance is 0 (Depth Composite and Depth
 * Light then use their Nearest / Farthest calibration).
 *
 * The node writes one comment into its code naming the texture wired into it (DEPTH_SOURCE_MARK), so the engine
 * knows which texture to read: the same way Particles' Emit from does (play/kit/gpuParticles.js).
 *
 * The maths (near mask, normals, parallax) is mirrored in plain JS below; the tests check them on synthetic depth.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';
import { DEPTH_SIDES, DEFAULT_DEPTH_MODEL_ID, isMetricModel } from '../../depthModel/config';
import { effectiveDepthModel } from '../../depthModel/experimental';

export const DEPTH_TYPE = 'depth';
/** `// depth-source <depth sampler> <wired sampler>`: what the engine reads (lib/depth/engine.ts). */
export const DEPTH_SOURCE_MARK = '// depth-source ';

export type DepthUpdate = 'live' | 'every' | 'baked';

/** A baked depth (params.depthBake): a video beside a video source, or an image beside an image. */
export interface DepthBakeInfo {
  kind: 'video' | 'image';
  /**
   * The video library id (kind video). Named as Video layers and Baked nodes name theirs, so the Library and
   * Files pages count it as a use and play files carry the video.
   */
  videoId?: string;
  /** The image library id (kind image), named as other saved things point at library images. */
  libraryId?: string;
  model: string;
  side: number;
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration: number;
  /** Smoothing over time used while baking. */
  smoothing: number;
  bytes: number;
  bakedAt: number;
  /** What it was baked from (a node's name). */
  source: string;
}

export const depthBakeOf = (node: GraphNode): DepthBakeInfo | null => {
  const b = node.params.depthBake as DepthBakeInfo | undefined;
  return b && typeof b === 'object' && (b.kind === 'video' || b.kind === 'image') && depthBakeId(b) ? b : null;
};

/** The library id a bake's file is kept under. */
export const depthBakeId = (b: DepthBakeInfo): string => String((b.kind === 'video' ? b.videoId : b.libraryId) || '');

export const depthUpdateOf = (node: GraphNode): DepthUpdate => {
  const u = node.params.update;
  return u === 'every' || u === 'baked' ? u : 'live';
};

/** The node plays a baked depth (Update: Baked, and a bake exists). */
export const depthPlaysBake = (node: GraphNode): DepthBakeInfo | null => (depthUpdateOf(node) === 'baked' ? depthBakeOf(node) : null);

/** Its sampler: a baked video plays through the video path (u_vid_), everything else is a node texture (u_tex_). */
export const depthSampler = (node: GraphNode, slug = node.id): string =>
  (depthPlaysBake(node)?.kind === 'video' ? `u_vid_${slug}` : `u_tex_${slug}`);

export const depthSideOf = (node: GraphNode): number => {
  const s = Number(node.params.resolution);
  return (DEPTH_SIDES as readonly number[]).includes(s) ? s : 384;
};

// ── The maths, in plain JS (the GLSL below does the same) ───────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The Depth output from nearness (1 near): Near is bright keeps it, Near is dark turns it over. */
export const depthOut = (near: number, nearIs: 'bright' | 'dark') => (nearIs === 'dark' ? 1 - near : near);

/** Near mask: 1 for what is nearer than the cut-off, with a soft edge `softness` wide below it. */
export const depthNearMask = (near: number, cutoff: number, softness: number) =>
  smoothstep(cutoff - Math.max(softness, 1e-4), cutoff, near);

/**
 * Normals from depth: the slope of nearness (times Relief) in picture units (x across 2 × aspect, y across 2),
 * by central differences `e` apart in 0–1 texture coordinates. z faces the viewer; near bumps face outward.
 */
export function depthNormal(sample: (u: number, v: number) => number, u: number, v: number, e: number, relief: number, aspect = 1): [number, number, number] {
  const dx = (sample(u + e, v) - sample(u - e, v)) / (2 * e * 2 * aspect);
  const dy = (sample(u, v + e) - sample(u, v - e)) / (2 * e * 2);
  const x = -dx * relief, y = -dy * relief, z = 1;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Parallax UV: the picture point moved along `dir` by Shift × (nearness − Focus): near things move, far ones the other way. */
export const depthParallax = (uv: [number, number], near: number, dir: [number, number], shift: number, focus: number): [number, number] =>
  [uv[0] + dir[0] * shift * (near - focus), uv[1] + dir[1] * shift * (near - focus)];

// ── The node ─────────────────────────────────────────────────────────────────

const MODEL_SECTION = 'Model';
const MASK_SECTION = 'Near mask';
const SHAPE_SECTION = 'Normals and parallax';

export const DepthNode: NodeDefinition = {
  type: DEPTH_TYPE,
  label: 'Depth',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Depth estimation', 'Depth map', 'Depth Anything', 'MiDaS', 'Monocular depth', 'Z depth', '2.5D', 'Parallax', 'Cut out subject'],
  description: 'Works out how far away each part of a picture is, on this device, with a small model (downloaded once, when you first use it). Wire an Image, a Video, a Pass or Baked into Texture; leave it empty for the picture itself. Depth is 0–1 (near is bright); Near mask cuts out what is close (a subject); Normals turn the flat picture into a surface the lighting nodes can light; Parallax UV moves near and far apart for a 2.5D camera shift. Bake depth runs a video once and keeps its depth as a video beside it, smooth and exact for recordings and web pages.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'The picture to find depth in: Texture Input, Video Input, Baked or a Pass. Empty: the picture itself (a frame late).' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the depth, in picture coordinates. Empty: this pixel.' },
    direction: { type: 'vec2', label: 'Parallax direction', hint: 'Which way Parallax UV moves near things (default: right). Wire the Mouse or an LFO to look around.' },
  },
  outputs: {
    depth: { type: 'float', label: 'Depth', hint: '0–1 at this pixel. Near is bright unless Near is: Dark. Relative: 1 is the nearest thing in the frame, not a distance.' },
    texture: { type: 'texture', label: 'Depth texture', hint: 'The depth as a texture (nearness in grey, 1 near): for Sample, Blur, Edges, Displace, the Texture tools and Particles\' Emit from.' },
    nearMask: { type: 'float', label: 'Near mask', hint: '1 where the picture is nearer than Cut-off, fading over Softness: cut out a subject, or replace the background.' },
    normal: { type: 'vec3', label: 'Normals', hint: 'The surface direction from the depth\'s slopes (−1…1, z towards you): wire into a lighting node to relight a flat picture.' },
    parallaxUv: { type: 'vec2', label: 'Parallax UV', hint: 'This pixel\'s UV moved by its depth: wire into the picture\'s Texture Input UV for a small 2.5D camera shift.' },
    distance: { type: 'float', label: 'Distance (metric)', hint: 'With a metric model (Depth Pro or ZoeDepth, experimental): how far this pixel is, in metres. Wire it into Depth Composite\'s or Depth Light\'s Picture distance. 0 with other models and with a bake.' },
  },
  socketsOnDemand: { direction: ['shift'] },
  defaultParams: {
    model: DEFAULT_DEPTH_MODEL_ID, resolution: '384', update: 'live', every: 4, nearIs: 'bright', smoothing: 0.5,
    cutoff: 0.6, softness: 0.1, relief: 0.3, shift: 0.04, focus: 0.5,
  },
  paramDefs: {
    // model: picked on the card (DepthCardBody) only while experimental depth models are on; otherwise Small runs.
    resolution: { label: 'Resolution', type: 'select', section: MODEL_SECTION, hint: 'The long side of the frame the model sees. Smaller is faster, larger finer. (The experimental MiDaS, ZoeDepth and Depth Pro run at their own fixed size.)', options: DEPTH_SIDES.map(s => ({ value: String(s), label: `${s} px` })) },
    update: { label: 'Update', type: 'select', section: MODEL_SECTION, hint: 'Live: a new depth as fast as the model goes. Every Nth frame: lighter. Baked: play the depth Bake depth stored (smooth and exact; web pages need it).', options: [
      { value: 'live', label: 'Live' }, { value: 'every', label: 'Every Nth frame' }, { value: 'baked', label: 'Baked' },
    ] },
    every: { label: 'Every', type: 'int', min: 1, max: 60, step: 1, section: MODEL_SECTION, showWhen: { param: 'update', value: 'every' }, hint: 'Run the model once every this many frames.' },
    nearIs: { label: 'Near is', type: 'select', section: MODEL_SECTION, hint: 'Which way the Depth output runs. The mask, normals and parallax don\'t change.', options: [
      { value: 'bright', label: 'Bright' }, { value: 'dark', label: 'Dark' },
    ] },
    smoothing: { label: 'Smoothing', type: 'float', min: 0, max: 0.95, step: 0.01, section: MODEL_SECTION, compileTime: true, hint: 'For video: blend each new depth with the last, so it flickers less (and lags a little).' },
    cutoff: { label: 'Cut-off', type: 'float', min: 0, max: 1, step: 0.005, section: MASK_SECTION, hint: 'Nearness where Near mask turns on: higher keeps only the nearest things.' },
    softness: { label: 'Softness', type: 'float', min: 0, max: 0.5, step: 0.005, section: MASK_SECTION, hint: 'How gently the mask fades below Cut-off.' },
    relief: { label: 'Relief', type: 'float', min: 0, max: 2, step: 0.01, section: SHAPE_SECTION, hint: 'How strongly the depth bends the Normals: 0 flat, higher deeper bumps.' },
    shift: { label: 'Shift', type: 'float', min: 0, max: 0.2, step: 0.001, section: SHAPE_SECTION, hint: 'How far Parallax UV moves near things (in picture units). Small is convincing.' },
    focus: { label: 'Focus', type: 'float', min: 0, max: 1, step: 0.01, section: SHAPE_SECTION, hint: 'The nearness that stays still in Parallax UV: things nearer move one way, farther the other.' },
  },
  assignable: false,
  // The Depth texture's `_px` (sampling nodes measure their offsets with it): one picture pixel, as a Texture Input's.
  declarationsFor: (node: GraphNode) => [`#define ${depthSampler(node)}_px (vec2(1.0) / u_resolution)`],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const S = depthSampler(node);
    const uv = inputVars.uv ?? 'g_uv';
    const bake = depthPlaysBake(node);
    const side = bake ? Math.max(bake.width, bake.height) : depthSideOf(node);
    const e = (1.5 / Math.max(side, 16)).toFixed(6);
    const dir = inputVars.direction ?? 'vec2(1.0, 0.0)';
    const near = (st: string) => `texture2D(${S}, ${st}).r`;
    const lines = [
      // Which texture the engine reads (lib/depth/engine.ts); empty: the picture.
      ...(inputVars.texture ? [`    ${DEPTH_SOURCE_MARK}${S} ${inputVars.texture}\n`] : [`    ${DEPTH_SOURCE_MARK}${S} picture\n`]),
      `    vec2 ${id}_st = clamp(${texUv(uv)}, 0.0, 1.0);\n`,
      `    float ${id}_near = ${near(`${id}_st`)};\n`,
      `    float ${id}_depth = ${P.nearIs === 'dark' ? `1.0 - ${id}_near` : `${id}_near`};\n`,
      `    float ${id}_mask = smoothstep(${p(P.cutoff, 0.6)} - max(${p(P.softness, 0.1)}, 0.0001), ${p(P.cutoff, 0.6)}, ${id}_near);\n`,
      `    vec2 ${id}_e = vec2(${e});\n`,
      `    float ${id}_dx = (${near(`${id}_st + vec2(${id}_e.x, 0.0)`)} - ${near(`${id}_st - vec2(${id}_e.x, 0.0)`)}) / (4.0 * ${id}_e.x * (u_resolution.x / u_resolution.y));\n`,
      `    float ${id}_dy = (${near(`${id}_st + vec2(0.0, ${id}_e.y)`)} - ${near(`${id}_st - vec2(0.0, ${id}_e.y)`)}) / (4.0 * ${id}_e.y);\n`,
      `    vec3 ${id}_normal = normalize(vec3(-${id}_dx * ${p(P.relief, 0.3)}, -${id}_dy * ${p(P.relief, 0.3)}, 1.0));\n`,
      `    vec2 ${id}_par = ${uv} + ${dir} * ${p(P.shift, 0.04)} * (${id}_near - ${p(P.focus, 0.5)});\n`,
    ];
    // A metric model's distance (metres) is in green; a bake keeps only nearness.
    const metric = !bake && isMetricModel(effectiveDepthModel(P.model));
    if (metric) lines.push(`    float ${id}_dist = texture2D(${S}, ${id}_st).g;\n`);
    return {
      code: lines.join(''),
      outputVars: { depth: `${id}_depth`, texture: S, nearMask: `${id}_mask`, normal: `${id}_normal`, parallaxUv: `${id}_par`, distance: metric ? `${id}_dist` : '0.0' },
    };
  },
};
