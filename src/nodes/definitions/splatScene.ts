/**
 * Splat Scene (docs/splat-scene.md; docs/depth-and-splats-plan.md phase 2): a Gaussian splat scan from another app
 * (Polycam, Luma, Scaniverse, Postshot…: .ply, .splat, .spz), drawn through the March Camera and put together with
 * the ray-marched scene by distance.
 *
 * The splats are drawn outside the shader, as a raster pass (lib/splats/engine.ts): every splat a soft ellipse, sorted
 * back to front, into two textures this node samples at the pixel (vUv):
 *  - `u_tex_<slug>_color`: the splats' colour, premultiplied, and their alpha;
 *  - `u_tex_<slug>_depth`: red is Σ αᵢ Tᵢ dᵢ (each splat's distance from the eye, weighted as it shows), alpha the
 *    same alpha: red / alpha is the splats' distance at the pixel, the March Loop's Distance's kind.
 *
 * The camera: the Ray Origin and Ray Dir wired in (the March Camera's), read by a small probe program the compiler
 * makes (compiler/splatGraph.ts: the chain into Ray Origin, Ray Dir, Position, Rotation and Scale, ending in this node
 * as SplatProbeOut). It writes ten texels: the eye; the rays at the picture's centre, half a height right and half
 * up; the model's three columns (with Splat size and Opacity) and its offset; the ray origins half right and half up. The splat shader rebuilds the camera
 * and the placement from those, on the GPU, with no lag; the engine reads them back a frame later only to sort.
 * Sliders, Play mappings and keyframes on Position / Rotation / Scale are live uniforms the probe shares.
 *
 * Compositing (Scene, Scene distance, Scene hit wired): per pixel the nearer wins. Splats in front are laid over the
 * scene (their alpha); where the scene's surface is nearer than the splats' distance, the scene hides them, with a
 * soft edge over Edge softness. CPU mirror: splatComposite (tested).
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, pv3 } from './helpers';

export const SPLAT_SCENE_TYPE = 'splatScene';
export const SPLAT_PROBE_TYPE = 'splatProbeOut';
/** The texture slots (nodeTextures[`${id}::color`], `${id}::depth`). */
export const SPLAT_SLOTS = ['color', 'depth'] as const;
/** `// splat-scene <color sampler>`: what a web export looks for (play/exportScope.ts). */
export const SPLAT_MARK = '// splat-scene ';
/** The distance a pixel with no splat reads (far: anything is nearer). */
export const SPLAT_FAR = 1e5;

export const SPLAT_MAX_OPTIONS = [100_000, 250_000, 500_000, 1_000_000, 2_000_000, 4_000_000] as const;
export const DEFAULT_MAX_SPLATS = 2_000_000;

export type SplatSort = 'moves' | 'frame';

/** What the card keeps about the loaded file (params.splatInfo), so it shows before the file loads. */
export interface SplatFileInfo {
  count: number;
  bytes: number;
  format: string;
  shDegree: number;
  center: [number, number, number];
  radius: number;
  min: [number, number, number];
  max: [number, number, number];
}

export const splatFileOf = (node: GraphNode): string => (typeof node.params.videoId === 'string' ? node.params.videoId : '');
/** The Modifier wire (docs/splat-scene.md "Per-splat modifiers"), if any. */
export const splatModifierOf = (node: GraphNode) => node.inputs.modifier?.connection;
export const splatMaxOf = (node: GraphNode): number => {
  const v = Number(node.params.maxSplats);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_MAX_SPLATS;
};
export const splatShOf = (node: GraphNode): number => {
  const v = Number(node.params.shDegree);
  return v >= 0 && v <= 3 ? Math.floor(v) : 0;
};
export const splatSortOf = (node: GraphNode): SplatSort => (node.params.sortRate === 'frame' ? 'frame' : 'moves');
/** The resolution the splats are drawn at, as a share of the picture's. */
export const splatScaleOf = (node: GraphNode): number => (node.params.resolution === 'half' ? 0.5 : 1);
/**
 * What the scan turns and scales about (docs/splat-scene.md "Settings"): its middle (the core box's centre, the
 * engine's `info.center`), so Position is where the middle sits and turning it (a slider, or Rotation wired to Time)
 * keeps it in place; or, for graphs saved before SPLAT_PIVOT_VERSION, the file's own origin (a scan whose origin is
 * metres from its middle swung out of the picture as it turned).
 */
export const splatPivotsAtMiddle = (node: GraphNode): boolean => node.params.pivot !== 'origin';
/**
 * The probe's uniform for the scan's middle in its own coordinates. One name for every probe: each Splat Scene's probe
 * is its own program, and the engine sets the value just before drawing it (lib/splats/engine.ts).
 */
export const SPLAT_PIVOT_UNIFORM = 'u_splatPivot';
/** The schema version that turns about the scan's middle: older saved nodes load with `pivot: 'origin'`. */
export const SPLAT_PIVOT_VERSION = 2;

/** Is the scan turned over (y and z flipped: 3DGS scans have y down)? */
export const splatFlipOf = (node: GraphNode): boolean => node.params.up !== 'y';

// ── Compositing, in plain JS (the GLSL below does the same) ──────────────────

const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * One pixel: the splats (premultiplied colour, alpha, distance) and the scene (colour, distance, hit). The nearer wins:
 * where the scene's surface is nearer than the splats, it hides them (over `soft`); else the splats lie over it.
 */
export function splatComposite(
  splat: { rgb: [number, number, number]; alpha: number; dist: number },
  scene: { rgb: [number, number, number]; dist: number; hit: number },
  soft = 0.05,
): { rgb: [number, number, number]; front: number; dist: number } {
  const s = Math.max(soft, 1e-4);
  const sceneD = scene.hit > 0.5 ? scene.dist : SPLAT_FAR;
  const front = smoothstep(-s, s, splat.dist - sceneD) * (scene.hit > 0.5 ? 1 : 0);
  const over = splat.rgb.map((c, i) => c + (1 - splat.alpha) * scene.rgb[i]);
  const rgb = over.map((c, i) => c + (scene.rgb[i] - c) * front) as [number, number, number];
  return { rgb, front, dist: Math.min(splat.alpha > 0.5 ? splat.dist : SPLAT_FAR, sceneD) };
}

// ── The node ─────────────────────────────────────────────────────────────────

const PLACE = 'Place';
const LOOK = 'Look';
const QUALITY = 'Quality';
const COMPOSITE = 'Compositing';

const commonParams: NodeDefinition['paramDefs'] = {
  position: { label: 'Position', type: 'vec3', axes: 'xyz', min: -20, max: 20, step: 0.01, section: PLACE, hint: 'Where the scan\'s middle sits in the scene (it turns and scales about its middle).' },
  rotation: { label: 'Rotation', type: 'vec3', axes: 'xyz', min: -360, max: 360, step: 0.5, section: PLACE, hint: 'Turns the scan, in degrees: X, then Y, then Z (the Transform node\'s order).' },
  scale: { label: 'Scale', type: 'float', min: 0.01, max: 20, step: 0.01, section: PLACE, hint: 'Its size in the scene: 1 keeps the scan\'s own units (most apps: metres).' },
  up: { label: 'Up is', type: 'select', section: PLACE, hint: 'Most scans (3DGS, Polycam, Luma exports) have y pointing down: −Y turns them the right way up. Pick +Y if yours comes in upside down.', options: [
    { value: 'minusY', label: '−Y (most scans)' }, { value: 'y', label: '+Y' },
  ] },
  splatSize: { label: 'Splat size', type: 'float', min: 0.05, max: 4, step: 0.01, section: LOOK, hint: 'Scales every splat: below 1 thins the scan into dots, above 1 softens it.' },
  opacity: { label: 'Opacity', type: 'float', min: 0, max: 2, step: 0.01, section: LOOK, hint: 'Multiplies every splat\'s opacity: lower to see through the scan.' },
  maxSplats: { label: 'Max splats', type: 'select', section: QUALITY, hint: 'Draw at most this many (spread evenly through the scan): fewer is faster.', options: SPLAT_MAX_OPTIONS.map(n => ({ value: String(n), label: n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}k` })) },
  sortRate: { label: 'Sort', type: 'select', section: QUALITY, hint: 'Splats are sorted far to near so they blend right. When the camera moves: only when it (or the scan) moves. Every frame: always (for cameras driven by something the sort can\'t see).', options: [
    { value: 'moves', label: 'When the camera moves' }, { value: 'frame', label: 'Every frame' },
  ] },
  shDegree: { label: 'SH degree', type: 'select', section: QUALITY, hint: 'View-dependent colour (spherical harmonics): 0 is flat colour and fastest; 1–3 add the shine that changes as you move round, when the file has them (.ply and .spz can, .splat never).', options: [
    { value: '0', label: '0 (flat colour)' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3 (all)' },
  ] },
  resolution: { label: 'Resolution', type: 'select', section: QUALITY, hint: 'Draw the splats at the picture\'s size, or at half (four times fewer pixels to fill: faster, softer).', options: [
    { value: 'full', label: 'Full' }, { value: 'half', label: 'Half' },
  ] },
  softness: { label: 'Edge softness', type: 'float', min: 0, max: 1, step: 0.005, section: COMPOSITE, hint: 'With a Scene wired: how gently the scene and the splats cross where they meet, in scene units.' },
  hitAt: { label: 'Solid at', type: 'float', min: 0.01, max: 1, step: 0.01, section: COMPOSITE, hint: 'The splats\' alpha from which a pixel counts as a hit (Hit, and the Distance the composite passes on).' },
};

export const splatDefaults: Record<string, unknown> = {
  position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, up: 'minusY', splatSize: 1, opacity: 1,
  maxSplats: String(DEFAULT_MAX_SPLATS), sortRate: 'moves', shDegree: '3', resolution: 'full', softness: 0.05, hitAt: 0.5,
  pivot: 'middle', _schemaVersion: SPLAT_PIVOT_VERSION,
};

const placeInputs: NodeDefinition['inputs'] = {
  position: { type: 'vec3', label: 'Position', hint: 'Where the scan sits. Unwired: the Position sliders.' },
  rotation: { type: 'vec3', label: 'Rotation', hint: 'Its turn in degrees (X, Y, Z). Unwired: the Rotation sliders.' },
  scale: { type: 'float', label: 'Scale', hint: 'Its size. Unwired: the Scale slider.' },
};

export const SplatSceneNode: NodeDefinition = {
  type: SPLAT_SCENE_TYPE,
  label: 'Splat Scene',
  category: '3D Scene',
  aliases: ['Gaussian splats', 'Gaussian splatting', '3DGS', 'Splat', '.ply scan', '.splat', '.spz', 'Polycam', 'Luma', 'Scaniverse', 'Postshot', '3D scan', 'Point cloud'],
  description: 'A Gaussian splat scan (.ply, .splat or .spz from Polycam, Luma, Scaniverse, Postshot…) drawn through the March Camera, so it sits in the same space as your ray-marched shapes. Wire the camera\'s Ray Origin and Ray Dir; wire the March Loop\'s Color, Distance and Hit into Scene, and the nearer one wins at each pixel: a sphere passes through the scan, hidden where the scan is in front.',
  inputs: {
    ro: { type: 'vec3', label: 'Ray Origin', hint: 'The March Camera\'s Ray Origin: the scan is seen through the same camera as the scene.' },
    rd: { type: 'vec3', label: 'Ray Dir', hint: 'The March Camera\'s Ray Dir.' },
    scene: { type: 'vec3', label: 'Scene', hint: 'The ray-marched scene\'s colour (the March Loop\'s Color, or after your lighting). Unwired: the splats over black.' },
    dist: { type: 'float', label: 'Scene distance', hint: 'The March Loop\'s Distance: how far each ray went.' },
    hit: { type: 'float', label: 'Scene hit', hint: 'The March Loop\'s Hit. Unwired: everywhere counts as hit.' },
    ...placeInputs,
    modifier: { type: 'splat', label: 'Modifier', hint: 'A chain of splat nodes (Dissolve, Explode, Wave, Colour, Crop… or Splat Attributes → your nodes → Set Splat) run once for every splat before it is drawn. Unwired: the scan as loaded.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The scan and the scene put together by distance (the splats over black with no Scene wired).' },
    alpha: { type: 'float', label: 'Alpha', hint: 'How much of the scan shows at this pixel (0 where the scene hides it).' },
    distance: { type: 'float', label: 'Distance', hint: 'How far the nearer surface is: the splats\' or the scene\'s. Far (100 000) where neither.' },
    hit: { type: 'float', label: 'Hit', hint: '1 where the splats or the scene are solid here.' },
    front: { type: 'float', label: 'Scene in front', hint: '1 where the scene\'s surface hides the splats.' },
    splatDistance: { type: 'float', label: 'Splat distance', hint: 'The splats\' own distance at this pixel (far where none).' },
    texture: { type: 'texture', label: 'Splats texture', hint: 'The splats alone (premultiplied colour, alpha) as a texture: for Sample, Blur and the Texture tools.' },
  },
  socketsOnDemand: { position: ['position'], rotation: ['rotation'], scale: ['scale'] },
  version: SPLAT_PIVOT_VERSION,
  migrateParams: (params: Record<string, unknown>, fromVersion: number) => (fromVersion < SPLAT_PIVOT_VERSION && !('pivot' in params) ? { ...params, pivot: 'origin' } : params),
  // Compositing only acts with a scene wired: without one the card dims it and says why.
  sectionNeeds: (name, node) => (name === COMPOSITE && !node.inputs.scene?.connection ? 'Add a world to blend the scan with it.' : null),
  textureSlots: [...SPLAT_SLOTS],
  defaultParams: splatDefaults,
  paramDefs: commonParams,
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const C = `u_tex_${id}_color`, D = `u_tex_${id}_depth`;
    const P = node.params;
    const hitAt = p(P.hitAt, 0.5);
    const lines = [
      `    ${SPLAT_MARK}${C}\n`,
      `    vec4 ${id}_c = texture2D(${C}, vUv);\n`,
      `    vec4 ${id}_d = texture2D(${D}, vUv);\n`,
      `    float ${id}_a = clamp(${id}_c.a, 0.0, 1.0);\n`,
      `    float ${id}_sd = ${id}_d.a > 1e-4 ? ${id}_d.r / ${id}_d.a : ${SPLAT_FAR.toFixed(1)};\n`,
      `    float ${id}_sh = step(${hitAt}, ${id}_a);\n`,
    ];
    let color = `${id}_c.rgb`, alpha = `${id}_a`, dist = `mix(${SPLAT_FAR.toFixed(1)}, ${id}_sd, ${id}_sh)`, hit = `${id}_sh`, front = '0.0';
    if (v.scene) {
      const sceneHit = v.hit ?? '1.0';
      const sceneDist = v.dist ?? SPLAT_FAR.toFixed(1);
      lines.push(
        `    float ${id}_sceneHit = step(0.5, ${sceneHit});\n`,
        `    float ${id}_sceneD = mix(${SPLAT_FAR.toFixed(1)}, ${sceneDist}, ${id}_sceneHit);\n`,
        `    float ${id}_soft = max(${p(P.softness, 0.05)}, 1e-4);\n`,
        `    float ${id}_front = smoothstep(-${id}_soft, ${id}_soft, ${id}_sd - ${id}_sceneD) * ${id}_sceneHit;\n`,
        `    vec3 ${id}_over = ${id}_c.rgb + (1.0 - ${id}_a) * ${v.scene};\n`,
        `    vec3 ${id}_col = mix(${id}_over, ${v.scene}, ${id}_front);\n`,
      );
      color = `${id}_col`;
      alpha = `(${id}_a * (1.0 - ${id}_front))`;
      dist = `min(mix(${SPLAT_FAR.toFixed(1)}, ${id}_sd, ${id}_sh), ${id}_sceneD)`;
      hit = `max(${id}_sh, ${id}_sceneHit)`;
      front = `${id}_front`;
    }
    return {
      code: lines.join(''),
      outputVars: { color, alpha, distance: dist, hit, front, splatDistance: `${id}_sd`, texture: C },
    };
  },
};

/**
 * The probe's end (made by compiler/splatGraph.ts; never in a graph): the Splat Scene node itself, compiled into a
 * small program over a 10 × 1 target. Same id and params as the node, so its slider uniforms are the node's own.
 * Texel 0 the eye, 1–3 the rays at g_uv (0, 0), (0.5, 0), (0, 0.5) (the compiler sets g_uv per texel), 4–6 the
 * model's columns (w: Splat size, Opacity, 0), 7 its offset, 8–9 the ray origins at (0.5, 0) and (0, 0.5).
 */
export const SplatProbeOutNode: NodeDefinition = {
  type: SPLAT_PROBE_TYPE,
  label: 'Splat probe output',
  category: 'Output',
  description: 'Internal: a Splat Scene\'s camera and placement, for its raster pass.',
  inputs: {
    ro: { type: 'vec3', label: 'Ray Origin' },
    rd: { type: 'vec3', label: 'Ray Dir' },
    ...placeInputs,
  },
  outputs: {},
  defaultParams: splatDefaults,
  paramDefs: commonParams,
  glslFunctionsFor: (node: GraphNode) => (splatPivotsAtMiddle(node) ? [`uniform vec3 ${SPLAT_PIVOT_UNIFORM};`] : []),
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id, P = node.params;
    const pos = v.position ?? pv3(P.position, [0, 0, 0]);
    const rot = v.rotation ?? pv3(P.rotation, [0, 0, 0]);
    const scale = v.scale ?? p(P.scale, 1);
    // Unwired: a camera 3 back on +z looking at the origin (lens 1.5), as an unwired March Camera would.
    const ro = v.ro ?? 'vec3(0.0, 0.0, 3.0)';
    const rd = v.rd ?? 'normalize(vec3(g_uv, -1.5))';
    const flip = splatFlipOf(node) ? 'mat3(1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, -1.0)' : 'mat3(1.0)';
    // Turned about the scan's middle (its own coordinates, a uniform the engine sets): T = Position − M · middle.
    const pivot = splatPivotsAtMiddle(node) ? ` - ${id}_M * ${SPLAT_PIVOT_UNIFORM}` : '';
    return {
      code: [
        `    int ${id}_i = int(gl_FragCoord.x);\n`,
        `    vec3 ${id}_r = radians(${rot});\n`,
        `    float ${id}_cx = cos(${id}_r.x), ${id}_sx = sin(${id}_r.x), ${id}_cy = cos(${id}_r.y), ${id}_sy = sin(${id}_r.y), ${id}_cz = cos(${id}_r.z), ${id}_sz = sin(${id}_r.z);\n`,
        // Column-major: R = Rz · Ry · Rx (X first).
        `    mat3 ${id}_Rx = mat3(1.0, 0.0, 0.0, 0.0, ${id}_cx, ${id}_sx, 0.0, -${id}_sx, ${id}_cx);\n`,
        `    mat3 ${id}_Ry = mat3(${id}_cy, 0.0, -${id}_sy, 0.0, 1.0, 0.0, ${id}_sy, 0.0, ${id}_cy);\n`,
        `    mat3 ${id}_Rz = mat3(${id}_cz, ${id}_sz, 0.0, -${id}_sz, ${id}_cz, 0.0, 0.0, 0.0, 1.0);\n`,
        `    mat3 ${id}_M = ${id}_Rz * ${id}_Ry * ${id}_Rx * ${flip} * (${scale});\n`,
        `    vec4 ${id}_o = vec4(0.0);\n`,
        `    if (${id}_i == 0) ${id}_o = vec4(${ro}, 1.0);\n`,
        `    else if (${id}_i <= 3) ${id}_o = vec4(normalize(${rd}), 1.0);\n`,
        `    else if (${id}_i == 4) ${id}_o = vec4(${id}_M[0], ${p(P.splatSize, 1)});\n`,
        `    else if (${id}_i == 5) ${id}_o = vec4(${id}_M[1], ${p(P.opacity, 1)});\n`,
        `    else if (${id}_i == 6) ${id}_o = vec4(${id}_M[2], 0.0);\n`,
        `    else if (${id}_i == 7) ${id}_o = vec4(${pos}${pivot}, 1.0);\n`,
        // The ray origins half right and half up: an Orthographic or Reverse camera's spread out (docs/camera-projections.md).
        `    else ${id}_o = vec4(${ro}, 1.0);\n`,
        `    gl_FragColor = ${id}_o;\n`,
      ].join(''),
      outputVars: {},
    };
  },
};
