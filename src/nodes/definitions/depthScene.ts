/**
 * depthScene.ts — a picture with depth, inside a 3D scene (docs/depth-node.md "Depth in 3D scenes";
 * docs/depth-and-splats-plan.md phase 1b).
 *
 * The Depth node gives a picture's nearness (0–1, 1 = the nearest thing in the frame). These two nodes
 * place that picture in a ray-marched scene:
 *
 *  - Depth Composite: per pixel, whichever is nearer wins, the picture or the scene. So a sphere set
 *    3 units back hides behind a person standing at 2, and shows around them.
 *  - Depth Light: the picture lit by a light (or a glowing object) in the scene. Each pixel becomes a
 *    3D point (the camera's ray, out to the picture's distance), and the point's neighbours give its
 *    surface direction, so a red glow beside someone's shoulder tints the shoulder and fades with
 *    distance. With a Glowing scene wired, the glow comes from the scene's own distance field: each
 *    point asks how far the nearest glowing surface is and which way, so any shape glows on the
 *    picture and follows as it moves. With Shadows from wired, the point light's light is
 *    soft-shadowed by the scene's objects.
 *
 * Metric models (Depth Pro, ZoeDepth: experimental) give real distances: wired into Picture distance, they are used
 * as they are and Nearest / Farthest are skipped (where the distance reads 0, e.g. another model, calibration again).
 *
 * Calibration: depth models give *relative* nearness, not distances. Nearest / Farthest say where, in
 * scene units, the picture's nearest and farthest things sit; nearness is interpolated in 1/distance
 * (the models' nearness behaves like inverse depth), so the middle of the range lands where the eye
 * expects it. The scene's distance is measured along each ray (the March Loop's Distance); for a
 * picture shot with a normal lens the two agree closely enough to judge "in front or behind".
 */
import type { NodeDefinition } from '../../types/nodeGraph';
import { p, pv3 } from './helpers';

/** GLSL: the picture's distance along the ray, in scene units, from its 0–1 nearness. */
export const DEPTH_SCENE_GLSL = `float depthSceneDist(float nearness, float nearD, float farD) {
  float n = clamp(nearness, 0.0, 1.0);
  float inv = mix(1.0 / max(farD, 1e-3), 1.0 / max(nearD, 1e-3), n);
  return 1.0 / max(inv, 1e-6);
}`;

/** The picture's distance: a metric one when wired (and above 0), else the calibrated nearness. */
const pictureDist = (node: { params: Record<string, unknown> }, nearness: string, metric: string | undefined): string => {
  const cal = `depthSceneDist(${nearness}, ${p(node.params.nearD, 1.5)}, ${p(node.params.farD, 8)})`;
  return metric ? `((${metric}) > 0.0 ? (${metric}) : ${cal})` : cal;
};

const METRIC_HINT = 'From a metric model (Depth Pro, ZoeDepth): the Depth node\'s Distance, in metres. Used as it is: Nearest / Farthest are skipped. Unwired: Picture depth with calibration.';

/** The same sum on the CPU, for tests and for anything that needs to place a picture's pixel. */
export function depthSceneDist(nearness: number, nearD: number, farD: number): number {
  const n = Math.min(1, Math.max(0, nearness));
  const inv = (1 / Math.max(farD, 1e-3)) * (1 - n) + (1 / Math.max(nearD, 1e-3)) * n;
  return 1 / Math.max(inv, 1e-6);
}

const CALIBRATION = 'Where the picture sits';
const calibrationParams = {
  nearD: { label: 'Nearest', type: 'float' as const, min: 0.1, max: 20, step: 0.01, section: CALIBRATION, hint: 'How far from the camera, in scene units, the nearest thing in the picture is (nearness 1).' },
  farD: { label: 'Farthest', type: 'float' as const, min: 0.2, max: 100, step: 0.1, section: CALIBRATION, hint: 'How far the farthest thing in the picture is (nearness 0). Further spreads the picture deeper.' },
};

export const DepthCompositeNode: NodeDefinition = {
  type: 'depthComposite',
  label: 'Depth Composite',
  aliases: ['depth mix', 'z composite', 'put behind', 'occlusion', 'objects behind people'],
  category: '3D Scene',
  description: 'A picture with depth and a 3D scene, put together by distance: per pixel the nearer one wins, so 3D objects pass behind and in front of what is in the picture. Wire the picture and the Depth node\'s Depth, and the March Loop\'s Color, Distance and Hit.',
  inputs: {
    picture: { type: 'vec3', label: 'Picture', hint: 'The picture\'s colour (a Texture Input or Video Input\'s colour).' },
    nearness: { type: 'float', label: 'Picture depth', hint: 'The Depth node\'s Depth (Near is: Bright): 1 nearest.' },
    distance: { type: 'float', label: 'Picture distance', hint: METRIC_HINT },
    scene: { type: 'vec3', label: 'Scene', hint: 'The 3D scene\'s colour (the March Loop\'s Color, or after your lighting).' },
    dist: { type: 'float', label: 'Scene distance', hint: 'The March Loop\'s Distance: how far each ray went.' },
    hit: { type: 'float', label: 'Scene hit', hint: 'The March Loop\'s Hit. Where the scene has nothing, the picture shows. Unwired: everywhere counts as hit.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The two together: the nearer one at each pixel.' },
    front: { type: 'float', label: 'Scene in front', hint: '1 where the scene is in front of the picture, 0 behind it, soft at the edge: a mask for glows or shadows on the scene\'s parts that show.' },
    pictureDist: { type: 'float', label: 'Picture distance', hint: 'The picture\'s distance along the ray, in scene units (from Nearest / Farthest).' },
  },
  defaultParams: { nearD: 1.5, farD: 8, softness: 0.08, show: 'composite' },
  paramDefs: {
    ...calibrationParams,
    softness: { label: 'Edge softness', type: 'float', min: 0, max: 1, step: 0.005, hint: 'How gently the scene fades in at the picture\'s edges, in scene units. Raise it to hide halos round hair (depth is soft there).' },
    show: { label: 'Show', type: 'select', options: [
      { value: 'composite', label: 'The composite' },
      { value: 'distances', label: 'Picture distance (to set Nearest / Farthest)' },
      { value: 'front', label: 'Where the scene is in front' },
    ], hint: 'To calibrate: show the picture\'s distance (bright = near), then set Nearest and Farthest until objects sit where you expect.' },
  },
  glslFunction: DEPTH_SCENE_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const picture = inputVars.picture || 'vec3(0.0)';
    const nearness = inputVars.nearness || '0.0';
    const scene = inputVars.scene || 'vec3(0.0)';
    const dist = inputVars.dist || '1e6';
    const hit = inputVars.hit || '1.0';
    const soft = p(node.params.softness, 0.08);
    const show = String(node.params.show ?? 'composite');
    const lines = [
      `    float ${id}_pd = ${pictureDist(node, nearness, inputVars.distance)};\n`,
      // Scene nearer than the picture: 1 (soft over Edge softness either side of equal distance)
      `    float ${id}_front = clamp(${hit}, 0.0, 1.0) * smoothstep(-max(${soft}, 1e-4), max(${soft}, 1e-4), ${id}_pd - (${dist}));\n`,
      show === 'distances'
        ? `    vec3 ${id}_color = vec3(1.0 - clamp((${id}_pd - ${p(node.params.nearD, 1.5)}) / max(${p(node.params.farD, 8)} - ${p(node.params.nearD, 1.5)}, 1e-3), 0.0, 1.0));\n`
        : show === 'front'
          ? `    vec3 ${id}_color = vec3(${id}_front);\n`
          : `    vec3 ${id}_color = mix(${picture}, ${scene}, ${id}_front);\n`,
    ];
    return { code: lines.join(''), outputVars: { color: `${id}_color`, front: `${id}_front`, pictureDist: `${id}_pd` } };
  },
};

export const DepthLightNode: NodeDefinition = {
  type: 'depthLight',
  label: 'Depth Light',
  aliases: ['relight', 'light the picture', 'glow on picture', 'picture lighting'],
  category: '3D Scene',
  description: 'The picture lit by a light in the 3D scene, such as a glowing sphere: each pixel is placed in 3D along the camera\'s ray at the picture\'s depth, and faces the way its neighbours say. Light adds to the picture where it faces the light, fading with distance. "Link to scene object…" makes the light follow a shape or Translate inside a Scene Group; "Add a light" chains another, linked to another object.',
  inputs: {
    picture: { type: 'vec3', label: 'Picture', hint: 'The colour to light: the picture, or a Depth Composite\'s Color (only the picture\'s pixels are lit).' },
    nearness: { type: 'float', label: 'Picture depth', hint: 'The Depth node\'s Depth (Near is: Bright).' },
    distance: { type: 'float', label: 'Picture distance', hint: METRIC_HINT },
    ro: { type: 'vec3', label: 'Ray Origin', hint: 'The March Camera\'s Ray Origin (the same camera as the scene).' },
    rd: { type: 'vec3', label: 'Ray Dir', hint: 'The March Camera\'s Ray Dir.' },
    lightPos: { type: 'vec3', label: 'Light position', hint: 'Where the light is: a glowing sphere\'s centre, a point in the scene. "Link to scene object…" on the card wires it from a shape or Translate in a Scene Group, so the light follows it.' },
    lightColor: { type: 'vec3', label: 'Light colour', hint: 'The light\'s colour (a glow\'s tint). A link wires it from the object\'s colour when it has one.' },
    mask: { type: 'float', label: 'Where', hint: 'Light only here (1) and not there (0). Wire 1 − Depth Composite\'s Scene in front so the 3D objects aren\'t relit as if they were the picture. Unwired: everywhere.' },
    glow: { type: 'scene3d', label: 'Glowing scene', hint: 'A Scene Group of the glowing objects: their light reaches the picture from wherever they are, whatever their shape, and follows them as they move. Wire the same Scene the March Loop draws, or a Scene Group of only the glowing parts.' },
    occluders: { type: 'scene3d', label: 'Shadows from', hint: 'A Scene whose objects cast soft shadows of the Light position\'s light onto the picture. Usually the scene the March Loop draws.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The picture with this light added (dimmed first by Own light).' },
    light: { type: 'vec3', label: 'Light', hint: 'Only the light that lands on the picture: add it yourself, or blur it for a soft glow.' },
    point: { type: 'vec3', label: 'Picture point', hint: 'Where each pixel sits in the scene (its 3D position).' },
    normal: { type: 'vec3', label: 'Picture normal', hint: 'Which way each pixel faces in the scene.' },
  },
  defaultParams: { nearD: 1.5, farD: 8, lightPos: [0.6, 0.4, 2.0], lightColor: [1.0, 0.35, 0.2], intensity: 2, range: 1.5, wrap: 0.2, own: 1, glowColor: [0.4, 0.7, 1.0], glowIntensity: 2, glowReach: 0.6, shadowSoftness: 12, lightRadius: 0.05 },
  paramDefs: {
    ...calibrationParams,
    lightPos: { label: 'Light position', type: 'vec3', min: -10, max: 10, step: 0.01, hint: 'Where the light is in the scene (x right, y up, z away from a default camera).' },
    lightColor: { label: 'Light colour', type: 'vec3color', hint: 'The light\'s colour.' },
    intensity: { label: 'Intensity', type: 'float', min: 0, max: 20, step: 0.01, hint: 'How bright the light is.' },
    range: { label: 'Reach', type: 'float', min: 0.05, max: 20, step: 0.01, hint: 'How far it reaches: at this distance it has fallen to a quarter.' },
    wrap: { label: 'Wrap', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Lets light reach round onto surfaces turned slightly away: softer, more like skin and cloth.' },
    own: { label: 'Own light', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much of the picture\'s own lighting stays: 1 all of it (the light adds), lower darkens it first, for a night relight.' },
    glowColor: { label: 'Glow colour', type: 'vec3color', section: 'Glowing scene', hint: 'The colour the Glowing scene\'s objects give off (with Glowing scene wired).' },
    glowIntensity: { label: 'Glow strength', type: 'float', min: 0, max: 20, step: 0.01, section: 'Glowing scene', hint: 'How brightly they light the picture.' },
    glowReach: { label: 'Glow reach', type: 'float', min: 0.02, max: 10, step: 0.01, section: 'Glowing scene', hint: 'How far from their surfaces the glow reaches before it has faded to about a third.' },
    shadowSoftness: { label: 'Shadow sharpness', type: 'float', min: 1, max: 64, step: 0.5, section: 'Shadows', hint: 'With Shadows from wired: higher is a crisper shadow edge, lower a softer one.' },
    lightRadius: { label: 'Light size', type: 'float', min: 0, max: 3, step: 0.01, section: 'Shadows', hint: 'How big the light is: the shadow ray stops this far from it, so a glowing sphere around the light doesn\'t shadow its own light. Set it to the sphere\'s radius.' },
  },
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const picture = inputVars.picture || 'vec3(0.0)';
    const nearness = inputVars.nearness || '0.0';
    const ro = inputVars.ro || 'vec3(0.0, 0.0, -3.0)';
    const rd = inputVars.rd || 'normalize(vec3(g_uv, 1.5))';
    const lightPos = inputVars.lightPos || pv3(node.params.lightPos, [0.6, 0.4, 2.0]);
    const lightColor = inputVars.lightColor || pv3(node.params.lightColor, [1.0, 0.35, 0.2]);
    const mask = inputVars.mask || '1.0';
    const glowFn = inputVars.glow;
    const occFn = inputVars.occluders;
    const code = [
      `    float ${id}_pd = ${pictureDist(node, nearness, inputVars.distance)};\n`,
      `    vec3 ${id}_point = (${ro}) + normalize(${rd}) * ${id}_pd;\n`,
      // The surface's direction from its neighbours (screen-space slopes of the 3D point), facing the camera
      `    vec3 ${id}_n = cross(dFdx(${id}_point), dFdy(${id}_point));\n`,
      `    ${id}_n = length(${id}_n) > 1e-9 ? normalize(${id}_n) : -normalize(${rd});\n`,
      `    if (dot(${id}_n, normalize(${rd})) > 0.0) ${id}_n = -${id}_n;\n`,
      `    vec3 ${id}_toL = (${lightPos}) - ${id}_point;\n`,
      `    float ${id}_dl = length(${id}_toL);\n`,
      `    float ${id}_w = ${p(node.params.wrap, 0.2)};\n`,
      `    float ${id}_face = max((dot(${id}_n, ${id}_toL / max(${id}_dl, 1e-5)) + ${id}_w) / (1.0 + ${id}_w), 0.0);\n`,
      // Falls to a quarter at Reach (inverse square, softened near the light)
      `    float ${id}_r = max(${p(node.params.range, 1.5)}, 1e-3);\n`,
      `    float ${id}_att = 1.0 / (1.0 + 3.0 * (${id}_dl * ${id}_dl) / (${id}_r * ${id}_r));\n`,
      `    float ${id}_shadow = 1.0;\n`,
      // Shadows: a soft-shadow march from the picture's point towards the light, through Shadows from
      ...(occFn ? [
        `    {\n`,
        `      vec3 ${id}_L = ${id}_toL / max(${id}_dl, 1e-5);\n`,
        `      float ${id}_t = 0.02;\n`,
        `      float ${id}_stop = ${id}_dl - ${p(node.params.lightRadius, 0.05)};\n`,
        `      for (int ${id}_i = 0; ${id}_i < 48; ${id}_i++) {\n`,
        `        if (${id}_t >= ${id}_stop) break;\n`,
        `        float ${id}_h = ${occFn}(${id}_point + ${id}_L * ${id}_t);\n`,
        `        if (${id}_h < 0.001) { ${id}_shadow = 0.0; break; }\n`,
        `        ${id}_shadow = min(${id}_shadow, ${p(node.params.shadowSoftness, 12)} * ${id}_h / ${id}_t);\n`,
        `        ${id}_t += clamp(${id}_h, 0.01, 0.3);\n`,
        `      }\n`,
        `      ${id}_shadow = clamp(${id}_shadow, 0.0, 1.0);\n`,
        `    }\n`,
      ] : []),
      `    vec3 ${id}_light = (${lightColor}) * ${p(node.params.intensity, 2)} * ${id}_face * ${id}_att * ${id}_shadow * clamp(${mask}, 0.0, 1.0);\n`,
      // Glowing scene: light from the nearest glowing surface, along the direction the field falls towards it
      ...(glowFn ? [
        `    {\n`,
        `      float ${id}_gd = max(${glowFn}(${id}_point), 0.0);\n`,
        `      const vec2 ${id}_k = vec2(1.0, -1.0);\n`,
        `      float ${id}_e = 0.01;\n`,
        `      vec3 ${id}_grad = ${id}_k.xyy * ${glowFn}(${id}_point + ${id}_k.xyy * ${id}_e) + ${id}_k.yyx * ${glowFn}(${id}_point + ${id}_k.yyx * ${id}_e)`,
        ` + ${id}_k.yxy * ${glowFn}(${id}_point + ${id}_k.yxy * ${id}_e) + ${id}_k.xxx * ${glowFn}(${id}_point + ${id}_k.xxx * ${id}_e);\n`,
        `      vec3 ${id}_toG = length(${id}_grad) > 1e-9 ? -normalize(${id}_grad) : -normalize(${rd});\n`,
        `      float ${id}_gface = max((dot(${id}_n, ${id}_toG) + ${id}_w) / (1.0 + ${id}_w), 0.0);\n`,
        `      ${id}_light += ${inputVars.glowColor || pv3(node.params.glowColor, [0.4, 0.7, 1.0])} * ${p(node.params.glowIntensity, 2)} * exp(-${id}_gd / max(${p(node.params.glowReach, 0.6)}, 1e-3)) * ${id}_gface * clamp(${mask}, 0.0, 1.0);\n`,
        `    }\n`,
      ] : []),
      `    vec3 ${id}_color = (${picture}) * mix(1.0, ${p(node.params.own, 1)}, clamp(${mask}, 0.0, 1.0)) + (${picture}) * ${id}_light;\n`,
    ].join('');
    return { code, outputVars: { color: `${id}_color`, light: `${id}_light`, point: `${id}_point`, normal: `${id}_n` } };
  },
  glslFunction: DEPTH_SCENE_GLSL,
};

// ── Picture Environment ──────────────────────────────────────────────────────

/**
 * GLSL: a direction → where to read it in the picture (0–1 texture coordinates), the picture taken as the backdrop the
 * camera sees. In the frame it is the camera's own projection (a direction that points at a pixel reads that pixel);
 * past the frame's edge it carries on evenly in angle, mirrored back and forth (so it never runs out); behind the
 * camera it is the mirror image of in front (|z|). F, R, U: the camera's axes; fov: its FOV (screen distance);
 * aspect: width / height.
 */
export const PICTURE_ENV_GLSL = `float pictureEnvAxis(float a, float h) {
  float s = abs(a) <= h ? tan(a) / tan(h) : sign(a) * (1.0 + (abs(a) - h) / max(h, 1e-3));
  float t = s * 0.5 + 0.5;
  return 1.0 - abs(1.0 - mod(t, 2.0));
}
vec2 pictureEnvUv(vec3 d, vec3 F, vec3 R, vec3 U, float fov, float aspect) {
  d = normalize(d);
  float z = max(abs(dot(d, F)), 1e-4);
  float ax = atan(dot(d, R), z);
  float ay = atan(dot(d, U), z);
  return vec2(pictureEnvAxis(ax, atan(aspect / fov)), pictureEnvAxis(ay, atan(1.0 / fov)));
}`;

const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The same mapping on the CPU (tests). */
export function pictureEnvUv(d: [number, number, number], F: number[], R: number[], U: number[], fov: number, aspect: number): [number, number] {
  const l = Math.hypot(...d) || 1;
  const n = d.map(v => v / l);
  const z = Math.max(Math.abs(dot3(n, F)), 1e-4);
  const axis = (a: number, h: number) => {
    const s = Math.abs(a) <= h ? Math.tan(a) / Math.tan(h) : Math.sign(a) * (1 + (Math.abs(a) - h) / Math.max(h, 1e-3));
    const t = s * 0.5 + 0.5;
    const m = ((t % 2) + 2) % 2;
    return 1 - Math.abs(1 - m);
  };
  return [axis(Math.atan2(dot3(n, R), z), Math.atan(aspect / fov)), axis(Math.atan2(dot3(n, U), z), Math.atan(1 / fov))];
}

export const PictureEnvironmentNode: NodeDefinition = {
  type: 'pictureEnvironment',
  label: 'Picture Environment',
  aliases: ['environment map', 'reflect the picture', 'chrome', 'image based lighting', 'ibl', 'ambient from picture', 'reflections'],
  category: '3D Scene',
  description: 'The picture as the world around the 3D objects: a colour for any direction, so a chrome sphere shows the room, and the picture\'s average colour as ambient light. Wire the picture\'s Texture, a direction (reflect(Ray Dir, Normal) for reflections, the Normal for soft light) and the March Camera\'s Forward, Right and Up. The picture is only what the camera saw: directions outside the frame are mirrored back in, behind the camera is the front mirrored.',
  inputs: {
    picture: { type: 'texture', label: 'Picture', hint: 'The picture\'s Texture (a Texture Input\'s Texture output).' },
    dir: { type: 'vec3', label: 'Direction', hint: 'Which way to look: reflect(Ray Dir, Normal) for a mirror, the Normal for diffuse light. Unwired: the ray\'s own direction (the picture, as the backdrop).' },
    forward: { type: 'vec3', label: 'Forward', hint: 'The March Camera\'s Forward. Unwired: looking along +z.' },
    right: { type: 'vec3', label: 'Right', hint: 'The March Camera\'s Right. Unwired: +x.' },
    up: { type: 'vec3', label: 'Up', hint: 'The March Camera\'s Up. Unwired: +y.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The picture\'s colour in that direction (softened by Blur).' },
    ambient: { type: 'vec3', label: 'Ambient', hint: 'The picture\'s average colour: multiply a surface by it for light that matches the room.' },
    uv: { type: 'vec2', label: 'Picture UV', hint: 'Where in the picture (0–1) the direction lands.' },
  },
  defaultParams: { fov: 1.5, blur: 0, strength: 1 },
  paramDefs: {
    fov: { label: 'Camera FOV', type: 'float', min: 0.5, max: 3.14, step: 0.05, hint: 'The March Camera\'s FOV, so a direction lands where the camera saw it.' },
    blur: { label: 'Blur', type: 'float', min: 0, max: 0.3, step: 0.005, hint: 'Softens the reflection (rough metal): reads a small patch round the point instead of one pixel.' },
    strength: { label: 'Strength', type: 'float', min: 0, max: 4, step: 0.01, hint: 'Scales Color and Ambient.' },
  },
  glslFunction: PICTURE_ENV_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const tex = inputVars.picture;
    const dir = inputVars.dir || 'normalize(vec3(g_uv, 1.5))';
    const F = inputVars.forward || 'vec3(0.0, 0.0, 1.0)';
    const R = inputVars.right || 'vec3(1.0, 0.0, 0.0)';
    const U = inputVars.up || 'vec3(0.0, 1.0, 0.0)';
    const k = p(node.params.strength, 1);
    if (!tex) {
      return { code: `    vec2 ${id}_uv = vec2(0.5);\n`, outputVars: { color: 'vec3(0.0)', ambient: 'vec3(0.0)', uv: `${id}_uv` } };
    }
    const code = [
      `    vec2 ${id}_uv = pictureEnvUv(${dir}, ${F}, ${R}, ${U}, max(${p(node.params.fov, 1.5)}, 0.05), u_resolution.x / u_resolution.y);\n`,
      // Blur: the point and 8 round it, Blur apart (in picture units); 0 reads the one pixel nine times (cheap enough).
      `    vec3 ${id}_color = vec3(0.0);\n`,
      `    for (int ${id}_i = 0; ${id}_i < 9; ${id}_i++) {\n`,
      `      vec2 ${id}_o = vec2(mod(float(${id}_i), 3.0) - 1.0, floor(float(${id}_i) / 3.0) - 1.0) * ${p(node.params.blur, 0)};\n`,
      `      ${id}_color += texture2D(${tex}, clamp(${id}_uv + ${id}_o, 0.0, 1.0)).rgb;\n`,
      `    }\n`,
      `    ${id}_color *= ${k} / 9.0;\n`,
      // Ambient: the mean of a 5 × 5 grid over the whole picture
      `    vec3 ${id}_amb = vec3(0.0);\n`,
      `    for (int ${id}_j = 0; ${id}_j < 25; ${id}_j++) {\n`,
      `      vec2 ${id}_g = (vec2(mod(float(${id}_j), 5.0), floor(float(${id}_j) / 5.0)) + 0.5) / 5.0;\n`,
      `      ${id}_amb += texture2D(${tex}, ${id}_g).rgb;\n`,
      `    }\n`,
      `    ${id}_amb *= ${k} / 25.0;\n`,
    ].join('');
    return { code, outputVars: { color: `${id}_color`, ambient: `${id}_amb`, uv: `${id}_uv` } };
  },
};
