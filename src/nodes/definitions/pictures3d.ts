/**
 * pictures3d.ts — pictures and videos inside a ray-marched scene (docs/pictures-in-3d.md).
 *
 *  - **Picture Card** (3D Primitives): a picture or video as a thin card you place, turn and size in
 *    the scene, its shape from the picture (aspect, and a cutout from its alpha or brightness).
 *    Inside a Scene Group it is a shape (Distance); after the March Loop, a second card with the same
 *    settings at Hit Pos gives the picture's colour there (Color for the lights, Glow to add after).
 *  - **Texture Material** (3D Lighting): wraps a picture onto any shape at the hit point, read in the
 *    shape's own space: Planar X / Y / Z, Box, Sphere, Cylinder or Triplanar; Size / Repeat, Offset,
 *    Turn; Replace, Multiply or Emissive over the shape's own colour.
 *
 * Cost (the reason for the shape of the code):
 *  - The colour is read only where it is used, after the march: the card's Color / Glow / Alpha are
 *    expressions (the read happens where a node uses them), and the derivatives they need are worked
 *    out beside them. Inside the scene function nothing uses them, so the march never reads the
 *    picture for colour. The only read inside the march is the cutout's, and only when the ray is
 *    within the card's thickness plus a texel of it (one `textureLod` at level 0): a ray far from
 *    the card pays the box distance only.
 *  - Reads at the hit use `textureGrad` with the hit point's screen derivatives pushed through the
 *    mapping (planar, box and triplanar project dFdx(p) exactly; sphere and cylinder take dFdx of
 *    the angle with the wrap removed), so the mip level is right with no seam line where a face or
 *    the wrap changes, and far surfaces don't shimmer. The gradients are capped (a quarter of the
 *    picture per pixel) so a silhouette, where the neighbour pixel hit something far away, doesn't
 *    pull in the smallest mip.
 *  - Triplanar is three reads; Box, Planar, Sphere and Cylinder one.
 */
import type { GraphNode, NodeDefinition, ParamDef } from '../../types/nodeGraph';
import { p, pv3, withParamSockets } from './helpers';

const DEG = '0.017453292519943295';

/**
 * Shared helpers. Pure maths (no samplers) apart from `pt3_read`, so the tests run them on the CPU.
 * Local axes: a card faces +Z. A March Camera at Angle 0 sits on +Z looking along −Z with its
 * right along −X, so a picture reads the right way round from there when u runs along −X.
 */
export const PICTURES_3D_GLSL = `
vec2 pt3_rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x + s * v.y, -s * v.x + c * v.y); }
vec3 pt3_unturn(vec3 d, vec3 a) {
  d.xy = pt3_rot(d.xy, a.z);
  d.zx = pt3_rot(d.zx, a.y);
  d.yz = pt3_rot(d.yz, a.x);
  return d;
}
vec3 pt3_face(vec3 d, vec3 toCam, float upright) {
  vec3 f = toCam;
  if (upright > 0.5) f.y = 0.0;
  f = dot(f, f) > 1e-10 ? normalize(f) : vec3(0.0, 0.0, 1.0);
  vec3 x = abs(f.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), f));
  vec3 y = cross(f, x);
  return vec3(dot(d, x), dot(d, y), dot(d, f));
}
float pt3_box(vec3 q, vec3 b) {
  vec3 d = abs(q) - b;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}
vec2 pt3_half(float size, float aspect) {
  float a = max(aspect, 1e-3);
  return 0.5 * size * (a >= 1.0 ? vec2(1.0, 1.0 / a) : vec2(a, 1.0));
}
vec2 pt3_cardUv(vec3 q, vec2 hs) { return vec2(0.5 - q.x / (2.0 * hs.x), 0.5 + q.y / (2.0 * hs.y)); }
// The picture turned by turn (counter-clockwise) about its middle, then slid by off: where to read for the place st.
vec2 pt3_place(vec2 st, float turn, vec2 off) { return pt3_rot(st - 0.5 - off, turn) + 0.5; }
vec2 pt3_cap(vec2 g) { float l = length(g); return l > 0.25 ? g * (0.25 / l) : g; }
float pt3_luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float pt3_key(vec4 c, float mode) {
  return mode < 0.5 ? c.a : mode < 1.5 ? pt3_luma(c.rgb) * c.a : (1.0 - pt3_luma(c.rgb)) * c.a;
}
vec4 pt3_checker(vec2 st) {
  vec2 c = floor(st * 8.0);
  return vec4(vec3(mod(c.x + c.y, 2.0) * 0.6 + 0.2), 1.0);
}
vec2 pt3_sphereSt(vec3 p) {
  vec3 d = normalize(p + vec3(1e-6));
  return vec2(atan(-d.x, d.z) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
}
vec2 pt3_dewrap(vec2 g, float k) { g.x -= k * floor(g.x / k + 0.5); return g; }
vec3 pt3_faceSign(vec3 n) { return vec3(n.x < 0.0 ? -1.0 : 1.0, n.y < 0.0 ? -1.0 : 1.0, n.z < 0.0 ? -1.0 : 1.0); }
vec2 pt3_projX(vec3 v, float s) { return vec2(v.z * s, v.y); }
vec2 pt3_projY(vec3 v, float s) { return vec2(-v.x, -v.z * s); }
vec2 pt3_projZ(vec3 v, float s) { return vec2(-v.x * s, v.y); }
vec2 pt3_flat(vec2 c, float size, float aspect) { return vec2(c.x / (size * aspect), c.y / size); }`;

/** The read, apart from the maths so the CPU tests can leave it out. */
const READ_GLSL = `
vec4 pt3_read(sampler2D t, vec2 st, vec2 dx, vec2 dy, float rep) {
  vec2 s = rep > 0.5 ? fract(st) : clamp(st, 0.0, 1.0);
  return textureGrad(t, s, pt3_cap(dx), pt3_cap(dy));
}
float pt3_aspect(sampler2D t) { vec2 s = vec2(textureSize(t, 0)); return s.y > 0.0 ? s.x / s.y : 1.0; }`;

const LUMA_HINT = 'Alpha: transparent parts of the picture (a PNG with transparency) are cut away. Bright: dark parts are cut away (a luminance key: glowing things on black). Dark: bright parts are cut away (a white background).';

// ─── Picture Card ─────────────────────────────────────────────────────────────

const CARD_PARAMS: Record<string, ParamDef> = {
  center: { section: 'Place', label: 'Position', type: 'vec3', axes: 'xyz', min: -10, max: 10, step: 0.01, hint: 'Where the card\'s middle is, in scene units.' },
  rotation: { section: 'Place', label: 'Rotation (deg)', type: 'vec3', axes: 'xyz', min: -180, max: 180, step: 0.5, hint: 'Turns the card about X, then Y, then Z. At 0 it faces +Z: a March Camera at Angle 0 sees it straight on, the right way round.' },
  size: { section: 'Place', label: 'Size', type: 'float', min: 0.05, max: 10, step: 0.01, hint: 'The card\'s longer side, in scene units. The other side follows the aspect.' },
  facing: { section: 'Place', label: 'Facing', type: 'select', options: [
    { value: 'fixed', label: 'As turned' }, { value: 'camera', label: 'Billboard: faces the camera' }, { value: 'upright', label: 'Billboard: turns round, stays upright' },
  ], hint: 'Billboard: the card always turns to the camera (wire March Camera → Ray Origin into Camera). Upright turns it only round the up axis, like a sign. Rotation Z still tilts it.' },
  aspectFrom: { section: 'Shape', label: 'Aspect', type: 'select', options: [
    { value: 'picture', label: 'From the picture' }, { value: 'custom', label: 'Custom' },
  ], hint: 'From the picture: the card has the picture\'s width ÷ height (a video\'s too). Custom: Width ÷ height below, and the picture stretches to it.' },
  aspect: { section: 'Shape', label: 'Width ÷ height', type: 'float', min: 0.1, max: 5, step: 0.01, showWhen: { param: 'aspectFrom', value: 'custom' }, hint: 'The card\'s shape: 1 square, 1.78 for 16:9, 0.75 for a portrait 3:4.' },
  thickness: { section: 'Shape', label: 'Thickness', type: 'float', min: 0.001, max: 0.5, step: 0.001, hint: 'How thick the card is. Thin reads as a print; thicker as a panel (its edges take the picture\'s edge colour).' },
  cutout: { section: 'Shape', label: 'Cutout', type: 'select', options: [
    { value: 'none', label: 'None (a rectangle)' }, { value: 'alpha', label: 'Alpha' }, { value: 'bright', label: 'Bright (key out dark)' }, { value: 'dark', label: 'Dark (key out light)' },
  ], hint: LUMA_HINT },
  threshold: { section: 'Shape', label: 'Threshold', type: 'float', min: 0, max: 1, step: 0.005, showWhen: { param: 'cutout', value: ['alpha', 'bright', 'dark'] }, hint: 'Where the cut falls: parts whose alpha (or brightness) is below this are cut away.' },
  back: { section: 'Look', label: 'Back', type: 'select', options: [
    { value: 'through', label: 'The picture, as seen through' }, { value: 'readable', label: 'The picture, the right way round' }, { value: 'colour', label: 'A plain colour' },
  ], hint: 'What the back of the card shows. As seen through: mirrored, matching the cutout. The right way round: flipped so text reads from behind. A plain colour: Back colour.' },
  backColor: { section: 'Look', label: 'Back colour', type: 'vec3color', showWhen: { param: 'back', value: 'colour' }, hint: 'The back of the card.' },
  emissive: { section: 'Look', label: 'Emissive', type: 'float', min: 0, max: 1, step: 0.01, hint: '0: the picture is printed on the card and catches the scene\'s light and shadows like any shape (Color into the lights). 1: it glows like a screen, the same in the dark (Glow, added after the lights). In between, some of each.' },
  brightness: { section: 'Look', label: 'Glow brightness', type: 'float', min: 0, max: 8, step: 0.01, hint: 'How bright the glowing part is. Above 1 it blooms with Glow / Tone Map.' },
};

/** The card's local point, half size and picture place: shared by the shape and the colour. */
function cardCore(node: GraphNode, iv: Record<string, string>): { code: string; q: string; hs: string; uv: string } {
  const id = node.id, P = node.params;
  const pos = iv.pos || 'vec3(0.0)';
  const tex = iv.picture;
  const center = pv3(P.center, [0, 0, 0]);
  const rot = pv3(P.rotation, [0, 0, 0]);
  const facing = String(P.facing ?? 'fixed');
  const lines: string[] = [`    vec3 ${id}_d = ${pos} - ${center};\n`];
  if (facing === 'camera' || facing === 'upright') {
    const cam = iv.camera || 'vec3(0.0, 0.0, 10.0)';
    lines.push(`    vec3 ${id}_q = pt3_face(${id}_d, ${cam} - ${center}, ${facing === 'upright' ? '1.0' : '0.0'});\n`);
    lines.push(`    ${id}_q.xy = pt3_rot(${id}_q.xy, ${rot}.z * ${DEG});\n`);
  } else {
    lines.push(`    vec3 ${id}_q = pt3_unturn(${id}_d, ${rot} * ${DEG});\n`);
  }
  const aspect = P.aspectFrom === 'custom' || !tex ? p(P.aspect, 1) : `pt3_aspect(${tex})`;
  lines.push(`    vec2 ${id}_hs = pt3_half(${p(P.size, 1.5)}, ${aspect});\n`);
  lines.push(`    vec2 ${id}_uv = pt3_cardUv(${id}_q, ${id}_hs);\n`);
  return { code: lines.join(''), q: `${id}_q`, hs: `${id}_hs`, uv: `${id}_uv` };
}

const KEY_MODE: Record<string, string> = { alpha: '0.0', bright: '1.0', dark: '2.0' };

export const PictureCardNode: NodeDefinition = withParamSockets({
  type: 'pictureCard',
  label: 'Picture Card',
  category: '3D Primitives',
  aliases: ['Image plane', 'Picture plane', 'Video card', 'Video screen', 'Billboard', 'Sprite 3D', 'Photo in 3D', 'Cutout', 'Card'],
  description: 'A picture or video as a thin card in a 3D scene: place, turn and size it, its shape from the picture (its aspect, and a Cutout from its alpha or brightness, so a PNG with transparency is cut out, not a rectangle). Inside a Scene Group it is a shape: lit, shadowed and reflected like any other. After the March Loop, a second card with the same settings at Hit Pos gives the picture there: Color for the lights, Glow to add after them (Emissive).',
  brief: {
    summary: 'A picture or video as a card in a ray-marched scene, lit like a shape or glowing like a screen.',
    start: [
      'In a Scene Group: Scene Pos → Picture Card → Scene Output; bring the picture in through a group port and on to Picture.',
      'After the March Loop: a second Picture Card with the same settings, Hit Pos into Position and the same picture: Color goes into the lights (as the surface colour), Glow is added after them.',
      'Billboard: Facing → faces the camera, and March Camera → Ray Origin into Camera (on both cards).',
    ],
  },
  inputs: {
    pos: { type: 'vec3', label: 'Position', hint: 'Inside a Scene Group: Scene Pos (the point being measured). After the March Loop: Hit Pos, for the picture\'s colour there.' },
    picture: { type: 'texture', label: 'Picture', hint: 'A Texture node\'s Texture output (a picture, a video, the webcam) or any texture. Unwired, a grey checker.' },
    camera: { type: 'vec3', label: 'Camera', hint: 'For Billboard: where the camera is (March Camera → Ray Origin).' },
  },
  outputs: {
    dist: { type: 'float', label: 'Distance', hint: 'The distance to the card: into Scene Output (or a union).' },
    color: { type: 'vec3', label: 'Color', hint: 'The picture where the ray hit, times (1 − Emissive): the surface colour for the lights. Use it after the March Loop.' },
    glow: { type: 'vec3', label: 'Glow', hint: 'The picture times Emissive × Glow brightness: add it after the lights, so it shines in the dark.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'The picture\'s alpha (or its key, with a Cutout) where the ray hit.' },
    uv: { type: 'vec2', label: 'Picture UV', hint: 'Where on the picture the point is (0–1, as seen from the front).' },
    side: { type: 'float', label: 'Front', hint: '1 on the front of the card, 0 on the back.' },
  },
  defaultParams: {
    center: [0, 0, 0], rotation: [0, 0, 0], size: 1.5, facing: 'fixed', aspectFrom: 'picture', aspect: 1.5, thickness: 0.01,
    cutout: 'none', threshold: 0.5, back: 'through', backColor: [0.12, 0.12, 0.14], emissive: 0, brightness: 1,
  },
  paramDefs: CARD_PARAMS,
  assignable: false,
  glslFunctions: [PICTURES_3D_GLSL, READ_GLSL],
  generateGLSL: (node, iv) => {
    const id = node.id, P = node.params;
    const tex = iv.picture;
    const core = cardCore(node, iv);
    const th = `(0.5 * ${p(P.thickness, 0.01)})`;
    const lines = [core.code, `    float ${id}_dist = pt3_box(${core.q}, vec3(${core.hs}, ${th}));\n`,
      // The look's numbers as plain statements (cheap; the reads that use them happen after the march).
      `    float ${id}_thr = ${p(P.threshold, 0.5)};\n`,
      `    float ${id}_e = clamp(${p(P.emissive, 0)}, 0.0, 1.0);\n`,
      `    float ${id}_gk = ${id}_e * ${p(P.brightness, 1)};\n`];
    // Cutout: only near the card (its thickness plus a texel), one read at level 0, never per step elsewhere.
    const cut = String(P.cutout ?? 'none');
    if (tex && KEY_MODE[cut]) {
      lines.push(
        `    float ${id}_tx = 2.0 * ${core.hs}.y / max(float(textureSize(${tex}, 0).y), 1.0);\n`,
        `    if (${id}_dist < ${th} + ${id}_tx) {\n`,
        `      if (pt3_key(textureLod(${tex}, clamp(${core.uv}, 0.0, 1.0), 0.0), ${KEY_MODE[cut]}) < ${id}_thr)\n`,
        `        ${id}_dist = max(${id}_dist, max(abs(${core.q}.z) - ${th}, 0.0) + max(2.0 * ${th}, ${id}_tx));\n`,
        `    }\n`,
      );
    }
    // The colour's place and derivatives: cheap, and only used after the march (no read happens here).
    const back = String(P.back ?? 'through');
    lines.push(
      `    float ${id}_front = ${core.q}.z >= 0.0 ? 1.0 : 0.0;\n`,
      back === 'readable'
        ? `    vec2 ${id}_cuv = ${id}_front > 0.5 ? ${core.uv} : vec2(1.0 - ${core.uv}.x, ${core.uv}.y);\n`
        : `    vec2 ${id}_cuv = ${core.uv};\n`,
      `    vec2 ${id}_dx = dFdx(${id}_cuv);\n`,
      `    vec2 ${id}_dy = dFdy(${id}_cuv);\n`,
    );
    const pic = tex ? `pt3_read(${tex}, ${id}_cuv, ${id}_dx, ${id}_dy, 0.0)` : `pt3_checker(${id}_cuv)`;
    const backOnly = back === 'colour' ? `(1.0 - ${id}_front)` : '0.0';
    const e = `${id}_e`;
    const color = back === 'colour'
      ? `mix(${pic}.rgb * (1.0 - ${e}), ${pv3(P.backColor, [0.12, 0.12, 0.14])}, ${backOnly})`
      : `(${pic}.rgb * (1.0 - ${e}))`;
    const glow = `(${pic}.rgb * ${id}_gk${back === 'colour' ? ` * ${id}_front` : ''})`;
    const alpha = `pt3_key(${pic}, ${KEY_MODE[cut] ?? '0.0'})`;
    return {
      code: lines.join(''),
      outputVars: { dist: `${id}_dist`, color, glow, alpha, uv: `${id}_cuv`, side: `${id}_front` },
    };
  },
}, ['size', 'thickness', 'threshold', 'emissive', 'brightness', 'center', 'rotation']);

// ─── Texture Material ─────────────────────────────────────────────────────────

export const TEXTURE_MAPPINGS = ['planarX', 'planarY', 'planarZ', 'box', 'sphere', 'cylinder', 'triplanar'] as const;
export type TextureMapping = typeof TEXTURE_MAPPINGS[number];
const WRAPS: readonly string[] = ['sphere', 'cylinder'];
const SIZED: readonly string[] = ['planarX', 'planarY', 'planarZ', 'box', 'cylinder', 'triplanar'];

const MAT_PARAMS: Record<string, ParamDef> = {
  mapping: { section: 'Mapping', label: 'Mapping', type: 'select', options: [
    { value: 'triplanar', label: 'Triplanar (seamless)' }, { value: 'box', label: 'Box (one side each)' },
    { value: 'planarZ', label: 'Planar Z (front)' }, { value: 'planarX', label: 'Planar X (side)' }, { value: 'planarY', label: 'Planar Y (top)' },
    { value: 'sphere', label: 'Sphere (a globe)' }, { value: 'cylinder', label: 'Cylinder (a label)' },
  ], hint: 'How the picture is laid on the shape. Triplanar: three projections blended by which way the surface faces, no stretching or seams on any shape. Box: each side the projection that faces it, crisp edges. Planar: one projection through the shape, like a slide projector. Sphere: wrapped round like a globe. Cylinder: round the sides like a label, Planar Y on the caps.' },
  size: { section: 'Mapping', label: 'Size', type: 'float', min: 0.05, max: 20, step: 0.01, showWhen: { param: 'mapping', value: [...SIZED] }, hint: 'How tall one picture is, in scene units (the width follows its aspect). Smaller repeats it more.' },
  repeat: { section: 'Mapping', label: 'Repeat round', type: 'float', min: 1, max: 16, step: 1, showWhen: { param: 'mapping', value: [...WRAPS] }, hint: 'How many times the picture goes round. Whole numbers meet without a seam.' },
  sharpness: { section: 'Mapping', label: 'Blend sharpness', type: 'float', min: 1, max: 32, step: 0.5, showWhen: { param: 'mapping', value: 'triplanar' }, hint: 'Triplanar: how quickly one projection gives way to the next where the surface turns. 1 a soft blend, 32 nearly the crisp edges of Box.' },
  offset: { section: 'Mapping', label: 'Offset', type: 'vec3', axes: 'xyz', min: -1, max: 1, step: 0.01, hint: 'Slides the picture across (X) and up (Y), in pictures (1 is a whole picture). Z is not used.' },
  turn: { section: 'Mapping', label: 'Turn (deg)', type: 'float', min: -180, max: 180, step: 0.5, hint: 'Turns the picture about its middle.' },
  edges: { section: 'Mapping', label: 'Edges', type: 'select', options: [
    { value: 'repeat', label: 'Repeat (tiles)' }, { value: 'once', label: 'Once (the shape\'s colour round it)' },
  ], hint: 'Repeat: the picture tiles with no seam. Once: one picture, and the shape\'s own colour outside it.' },
  aspectFrom: { section: 'Mapping', label: 'Aspect', type: 'select', options: [
    { value: 'picture', label: 'From the picture' }, { value: 'custom', label: 'Custom' },
  ], hint: 'From the picture: one picture keeps its shape. Custom: Width ÷ height.' },
  aspect: { section: 'Mapping', label: 'Width ÷ height', type: 'float', min: 0.1, max: 5, step: 0.01, showWhen: { param: 'aspectFrom', value: 'custom' } },
  combine: { section: 'Material', label: 'Combine', type: 'select', options: [
    { value: 'replace', label: 'Replace the colour' }, { value: 'multiply', label: 'Multiply (tint)' }, { value: 'emissive', label: 'Emissive (glows)' },
  ], hint: 'Replace: the picture is the surface colour, lit by the scene. Multiply: the shape\'s Base colour tinted by the picture. Emissive: the shape keeps its colour and the picture glows on it (Glow, added after the lights).' },
  amount: { section: 'Material', label: 'Amount', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much of the picture: 0 the shape\'s own colour, 1 all picture.' },
  glowAmount: { section: 'Material', label: 'Glow brightness', type: 'float', min: 0, max: 8, step: 0.01, showWhen: { param: 'combine', value: 'emissive' }, hint: 'How bright the glowing picture is.' },
};

/** The 2D place on the picture before Offset / Turn, its screen derivatives, and the read: per mapping. */
function mapCode(id: string, mapping: TextureMapping, pos: string, nrm: string, size: string, rep: string, aspect: string, sharp: string, read: (st: string, dx: string, dy: string) => string, place: (st: string) => string, turnG: (g: string) => string): string[] {
  const L: string[] = [];
  const flat = (c: string) => `(pt3_flat(${c}, ${size}, ${aspect}) + 0.5)`;
  const flatG = (c: string) => `pt3_flat(${c}, ${size}, ${aspect})`;
  const projRead = (axis: 'X' | 'Y' | 'Z', s: string, k: string) => {
    L.push(`    vec2 ${id}_st${k} = ${place(flat(`pt3_proj${axis}(${pos}, ${s})`))};\n`);
    L.push(`    vec4 ${id}_c${k} = ${read(`${id}_st${k}`, turnG(flatG(`pt3_proj${axis}(${id}_dpx, ${s})`)), turnG(flatG(`pt3_proj${axis}(${id}_dpy, ${s})`)))};\n`);
  };
  if (mapping === 'planarX' || mapping === 'planarY' || mapping === 'planarZ') {
    projRead(mapping.slice(-1) as 'X' | 'Y' | 'Z', '1.0', '');
    L.push(`    vec4 ${id}_pic = ${id}_c;\n    vec2 ${id}_uv = ${id}_st;\n`);
  } else if (mapping === 'box') {
    // One side each: the axis the surface faces most, read the right way round from outside.
    L.push(`    vec3 ${id}_an = abs(${nrm});\n`);
    L.push(`    float ${id}_ax = ${id}_an.x >= ${id}_an.y && ${id}_an.x >= ${id}_an.z ? 0.0 : (${id}_an.y >= ${id}_an.z ? 1.0 : 2.0);\n`);
    L.push(`    vec3 ${id}_sg = pt3_faceSign(${nrm});\n`);
    L.push(`    vec2 ${id}_bc = ${id}_ax < 0.5 ? pt3_projX(${pos}, ${id}_sg.x) : ${id}_ax < 1.5 ? pt3_projY(${pos}, ${id}_sg.y) : pt3_projZ(${pos}, ${id}_sg.z);\n`);
    L.push(`    vec2 ${id}_bgx = ${id}_ax < 0.5 ? pt3_projX(${id}_dpx, ${id}_sg.x) : ${id}_ax < 1.5 ? pt3_projY(${id}_dpx, ${id}_sg.y) : pt3_projZ(${id}_dpx, ${id}_sg.z);\n`);
    L.push(`    vec2 ${id}_bgy = ${id}_ax < 0.5 ? pt3_projX(${id}_dpy, ${id}_sg.x) : ${id}_ax < 1.5 ? pt3_projY(${id}_dpy, ${id}_sg.y) : pt3_projZ(${id}_dpy, ${id}_sg.z);\n`);
    L.push(`    vec2 ${id}_uv = ${place(flat(`${id}_bc`))};\n`);
    L.push(`    vec4 ${id}_pic = ${read(`${id}_uv`, turnG(flatG(`${id}_bgx`)), turnG(flatG(`${id}_bgy`)))};\n`);
  } else if (mapping === 'triplanar') {
    L.push(`    vec3 ${id}_sg = pt3_faceSign(${nrm});\n`);
    projRead('X', `${id}_sg.x`, 'x');
    projRead('Y', `${id}_sg.y`, 'y');
    projRead('Z', `${id}_sg.z`, 'z');
    L.push(`    vec3 ${id}_w = pow(abs(${nrm}), vec3(${sharp}));\n    ${id}_w /= max(${id}_w.x + ${id}_w.y + ${id}_w.z, 1e-5);\n`);
    L.push(`    vec4 ${id}_pic = ${id}_cx * ${id}_w.x + ${id}_cy * ${id}_w.y + ${id}_cz * ${id}_w.z;\n`);
    L.push(`    vec2 ${id}_uv = ${id}_w.x >= ${id}_w.y && ${id}_w.x >= ${id}_w.z ? ${id}_stx : (${id}_w.y >= ${id}_w.z ? ${id}_sty : ${id}_stz);\n`);
  } else if (mapping === 'sphere') {
    L.push(`    vec2 ${id}_s0 = pt3_sphereSt(${pos}) * vec2(${rep}, 1.0);\n`);
    L.push(`    vec2 ${id}_uv = ${place(`${id}_s0`)};\n`);
    L.push(`    vec2 ${id}_gx = pt3_dewrap(dFdx(${id}_s0), ${rep});\n    vec2 ${id}_gy = pt3_dewrap(dFdy(${id}_s0), ${rep});\n`);
    L.push(`    vec4 ${id}_pic = ${read(`${id}_uv`, turnG(`${id}_gx`), turnG(`${id}_gy`))};\n`);
  } else {
    // Cylinder (about Y): round the sides like a label, Planar Y on the caps.
    L.push(`    float ${id}_cap = abs(${nrm}.y) > 0.7071 ? 1.0 : 0.0;\n`);
    L.push(`    float ${id}_sy = ${nrm}.y < 0.0 ? -1.0 : 1.0;\n`);
    L.push(`    vec2 ${id}_s0 = vec2(pt3_sphereSt(vec3(${pos}.x, 0.0, ${pos}.z)).x * ${rep}, ${pos}.y / ${size} + 0.5);\n`);
    L.push(`    vec2 ${id}_s1 = pt3_flat(pt3_projY(${pos}, ${id}_sy), ${size}, ${aspect}) + 0.5;\n`);
    L.push(`    vec2 ${id}_gx = ${id}_cap > 0.5 ? pt3_flat(pt3_projY(${id}_dpx, ${id}_sy), ${size}, ${aspect}) : pt3_dewrap(dFdx(${id}_s0), ${rep});\n`);
    L.push(`    vec2 ${id}_gy = ${id}_cap > 0.5 ? pt3_flat(pt3_projY(${id}_dpy, ${id}_sy), ${size}, ${aspect}) : pt3_dewrap(dFdy(${id}_s0), ${rep});\n`);
    L.push(`    vec2 ${id}_uv = ${place(`(${id}_cap > 0.5 ? ${id}_s1 : ${id}_s0)`)};\n`);
    L.push(`    vec4 ${id}_pic = ${read(`${id}_uv`, turnG(`${id}_gx`), turnG(`${id}_gy`))};\n`);
  }
  return L;
}

export const TextureMaterialNode: NodeDefinition = withParamSockets({
  type: 'textureMaterial',
  label: 'Texture Material',
  category: '3D Lighting',
  aliases: ['Texture 3D', 'Triplanar', 'Triplanar mapping', 'Box mapping', 'UV map 3D', 'Wrap picture', 'Image on shape', 'Video on shape', 'Decal', 'Material texture'],
  description: 'Wraps a picture or video onto any shape, at the hit point after the March Loop: Planar X / Y / Z, Box, Sphere, Cylinder or Triplanar (seamless, with Blend sharpness). Size or Repeat round, Offset and Turn place it; Combine says how it meets the shape\'s Base colour (Replace, Multiply, Emissive). Read in the shape\'s own space: wire the point the shape measures (Hit Pos through the same Transform as the shape), so the picture moves and turns with it.',
  brief: {
    summary: 'A picture or video wrapped onto a 3D shape: planar, box, sphere, cylinder or triplanar.',
    start: [
      'After the March Loop: Hit Pos → (the shape\'s own Transform, if it has one) → Position; Texture → Picture.',
      'Base is the shape\'s colour (or the colour so far); Color goes into the lights as the surface colour, Glow is added after them.',
      'Several shapes: wire Material Select\'s Blend (or any 0–1) into Mask, so the picture lands only on its shape.',
    ],
  },
  inputs: {
    pos: { type: 'vec3', label: 'Position', hint: 'The hit point in the shape\'s own space: the March Loop\'s Hit Pos, through the same Transform the shape\'s point goes through, so the picture moves and turns with the shape.' },
    picture: { type: 'texture', label: 'Picture', hint: 'A Texture node\'s Texture output (a picture, a video, the webcam) or any texture. Unwired, a grey checker.' },
    normal: { type: 'vec3', label: 'Normal', hint: 'Which way the surface faces, in the same space as Position (the March Loop\'s Normal for a shape that isn\'t turned). Unwired, worked out from Position (always in its space, a little blocky at the edges).' },
    base: { type: 'vec3', label: 'Base', hint: 'The shape\'s own colour (or the colour so far): what Combine starts from. Unwired, white.' },
    mask: { type: 'float', label: 'Mask', hint: 'Where the picture goes (0–1): Material Select\'s Blend, or a Hit, so it lands only on its shape. Unwired, everywhere.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The surface colour for the lights: Base with the picture combined in.' },
    glow: { type: 'vec3', label: 'Glow', hint: 'With Combine Emissive: the glowing picture, to add after the lights. Otherwise black.' },
    picture: { type: 'vec3', label: 'Picture', hint: 'The picture alone where the ray hit.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'The picture\'s alpha there (0 outside it with Edges: Once).' },
    uv: { type: 'vec2', label: 'Picture UV', hint: 'Where on the picture the point is (Triplanar: the projection that counts most).' },
  },
  defaultParams: { mapping: 'triplanar', size: 1, repeat: 1, sharpness: 4, offset: [0, 0, 0], turn: 0, edges: 'repeat', aspectFrom: 'picture', aspect: 1, combine: 'replace', amount: 1, glowAmount: 1 },
  paramDefs: MAT_PARAMS,
  assignable: false,
  glslFunctions: [PICTURES_3D_GLSL, READ_GLSL],
  generateGLSL: (node, iv) => {
    const id = node.id, P = node.params;
    const tex = iv.picture;
    const mapping = ((TEXTURE_MAPPINGS as readonly string[]).includes(String(P.mapping)) ? P.mapping : 'triplanar') as TextureMapping;
    const pos = `${id}_p`;
    const base = iv.base || 'vec3(1.0)';
    const once = P.edges === 'once';
    const aspect = P.aspectFrom === 'custom' || !tex ? p(P.aspect, 1) : `pt3_aspect(${tex})`;
    const lines: string[] = [
      `    vec3 ${pos} = ${iv.pos || 'vec3(0.0)'};\n`,
      `    vec3 ${id}_dpx = dFdx(${pos});\n`,
      `    vec3 ${id}_dpy = dFdy(${pos});\n`,
      `    float ${id}_asp = ${aspect};\n`,
      `    float ${id}_t = ${p(P.turn, 0)} * ${DEG};\n`,
      `    vec2 ${id}_off = ${pv3(P.offset, [0, 0, 0])}.xy;\n`,
    ];
    // Unwired, the normal comes from how the point changes across the screen (its own space). The cross of the
    // derivatives points away from the camera (March Camera's right is cross(up, forward)), so it is turned round.
    const nrm = iv.normal ? `${id}_n` : `${id}_n`;
    lines.push(iv.normal
      ? `    vec3 ${nrm} = normalize(${iv.normal} + vec3(1e-6));\n`
      : `    vec3 ${nrm} = -normalize(cross(${id}_dpx, ${id}_dpy) + vec3(1e-9));\n`);
    const read = (st: string, dx: string, dy: string) => tex ? `pt3_read(${tex}, ${st}, ${dx}, ${dy}, ${once ? '0.0' : '1.0'})` : `pt3_checker(${once ? `clamp(${st}, 0.0, 1.0)` : `fract(${st})`})`;
    const place = (st: string) => `pt3_place(${st}, ${id}_t, ${id}_off)`;
    const turnG = (g: string) => `pt3_rot(${g}, ${id}_t)`;
    lines.push(...mapCode(id, mapping, pos, nrm, `max(${p(P.size, 1)}, 1e-3)`, `max(floor(${p(P.repeat, 1)} + 0.5), 1.0)`, `${id}_asp`, `max(${p(P.sharpness, 4)}, 1.0)`, read, place, turnG));
    if (once) lines.push(`    ${id}_pic *= all(greaterThanEqual(${id}_uv, vec2(0.0))) && all(lessThanEqual(${id}_uv, vec2(1.0))) ? 1.0 : 0.0;\n`);
    const m = `${id}_m`;
    lines.push(`    float ${m} = clamp(${p(P.amount, 1)}, 0.0, 1.0) * ${id}_pic.a${iv.mask ? ` * clamp(${iv.mask}, 0.0, 1.0)` : ''};\n`);
    const combine = String(P.combine ?? 'replace');
    if (combine === 'multiply') {
      lines.push(`    vec3 ${id}_col = ${base} * mix(vec3(1.0), ${id}_pic.rgb, ${m});\n    vec3 ${id}_glow = vec3(0.0);\n`);
    } else if (combine === 'emissive') {
      lines.push(`    vec3 ${id}_col = ${base};\n    vec3 ${id}_glow = ${id}_pic.rgb * ${m} * ${p(P.glowAmount, 1)};\n`);
    } else {
      lines.push(`    vec3 ${id}_col = mix(${base}, ${id}_pic.rgb, ${m});\n    vec3 ${id}_glow = vec3(0.0);\n`);
    }
    return {
      code: lines.join(''),
      outputVars: { color: `${id}_col`, glow: `${id}_glow`, picture: `${id}_pic.rgb`, alpha: `${id}_pic.a`, uv: `${id}_uv` },
    };
  },
}, ['size', 'repeat', 'sharpness', 'turn', 'amount', 'glowAmount', 'offset']);
