/**
 * Texture tools (docs/texture-tools.md): purpose-named nodes that turn a raw texture read into the
 * number you want, so the moves of the passes guide's sections 1.8 and 1.9 ("Getting information
 * out of a texture", "Shaping what comes out") need no Expression Block.
 *
 *  - Mask (texture): one number from a texture (brightness, a channel, saturation, a hue range, a
 *    colour key), then a hard or soft threshold.
 *  - Levels (texture): gain and offset, in / out ranges, gamma, roll-off, clamp, and signed
 *    pack / unpack (0.5 reads as zero).
 *  - Flow (texture): a vec2 from the slope (uphill, downhill, along the contours) or from a
 *    direction stored in red and green: for UV warps, Displace, particles and agents.
 *  - Neighbours (texture): average, difference from average (a Laplacian), max / min (dilate /
 *    erode) and range round each pixel, in a bounded loop the Performance panel reports.
 *  - Change (texture): what changed between a texture and its Previous (a motion mask), and roughly
 *    which way it moved.
 *  - Outline (distance): outlines, glows, rings and inside / outside masks from a distance (Jump
 *    flood's Distance, an SDF, any float).
 *  - Fade (feedback): the decay of a feedback Pass, max(old × d − e, 0), with a tail in seconds
 *    (frame-rate independent through u_frameDt) and a tint per channel.
 *  - Read (texture): Sample with the read bent: zoom, turn and move round a pivot, pushed by a flow.
 *
 * Every node takes a `texture` input (any texture: a Pass and its Previous, Texture Input, Video
 * Input, Baked, Motion (texture), a Trail field's or Draw agents' Image) and an optional UV in
 * picture coordinates. Mask and Levels also take a plain Value or Color, so the same node shapes a
 * Jump flood distance, an Edges strength or any number. None declares a sampler of its own: they
 * read the sampler wired in, so the program's sampler count (MAX_SAMPLERS) is unchanged by them.
 *
 * The maths the nodes emit is mirrored in plain JS below (ttLevels, ttFadeStep…): the inline curves
 * on the cards (vizGeneric.tsx) draw with it and the tests check the GLSL against it.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, pv3 } from './helpers';
import { passPxUniform, texUv } from './passes';

export const TEXTURE_TOOLS_CATEGORY = 'Texture tools';

/** The frame's length in seconds; hosts set it every frame (0 or unset reads as 1/60). */
export const FRAME_DT_UNIFORM = 'u_frameDt';

const LUMA = 'vec3(0.299, 0.587, 0.114)';
const LUMA_W = [0.299, 0.587, 0.114] as const;

const TEX_HINT = 'Any texture: a Pass (or its Previous), Texture Input, Video Input, Baked, Motion (texture), a Trail field\'s or Draw agents\' Image.';
const UV_HINT = 'Where to read, in picture coordinates. Leave empty for this pixel; wire a warp (or Read\'s UV) to bend the read.';

// ── The maths, in plain JS (the GLSL below does the same) ───────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smoothstepJs = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** GLSL step(t, v): 0 below the threshold, 1 from it up. */
export const ttHardThreshold = (v: number, t: number) => (v < t ? 0 : 1);
/** smoothstep(t, t + w, v): a threshold with a soft edge w wide. */
export const ttSoftThreshold = (v: number, t: number, w: number) => smoothstepJs(t, t + Math.max(w, 1e-4), v);
/** x / (1 + |x| k): tames values above 1 so they don't clip (k 0: unchanged). */
export const ttRollOff = (x: number, k: number) => x / (1 + Math.abs(x) * k);
/** A signed value −1…1 stored in 0…1 (8-bit textures, displacement maps). */
export const ttPack = (v: number) => v * 0.5 + 0.5;
/** A stored 0…1 read back as −1…1 (0.5 is zero). */
export const ttUnpack = (s: number) => s * 2 - 1;
/** ln(0.01): a tail is how long a pixel left alone takes to fall to 1%. */
const LN_HUNDREDTH = -4.605170186;
/** What one frame of `dt` seconds keeps of a value whose tail is `tail` seconds. */
export const ttDecayFactor = (dt: number, tail: number) => Math.exp(LN_HUNDREDTH * dt / Math.max(tail, 1e-3));
/** One frame of Fade: max(old × d − e, 0), d from the tail, e = Clean × dt. */
export const ttFadeStep = (old: number, dt: number, tail: number, clean: number) => Math.max(old * ttDecayFactor(dt, tail) - clean * dt, 0);

export interface LevelsSettings {
  gain: number; offset: number; inBlack: number; inWhite: number; gamma: number; rollOff: number;
  outBlack: number; outWhite: number; clamp: boolean; signed: 'none' | 'unpack' | 'pack';
}
export const LEVELS_DEFAULTS: LevelsSettings = { gain: 1, offset: 0, inBlack: 0, inWhite: 1, gamma: 1, rollOff: 0, outBlack: 0, outWhite: 1, clamp: false, signed: 'none' };
/** Levels on one number, in the node's order: unpack, gain/offset, in range, gamma, roll-off, out range, pack, clamp. */
export function ttLevels(v: number, s: Partial<LevelsSettings> = {}): number {
  const o = { ...LEVELS_DEFAULTS, ...s };
  if (o.signed === 'unpack') v = ttUnpack(v);
  v = v * o.gain + o.offset;
  const span = o.inWhite - o.inBlack;
  v = (v - o.inBlack) / (Math.abs(span) < 1e-5 ? 1e-5 : span);
  v = Math.sign(v) * Math.pow(Math.abs(v), o.gamma);
  v = ttRollOff(v, o.rollOff);
  v = o.outBlack + (o.outWhite - o.outBlack) * v;
  if (o.signed === 'pack') v = ttPack(v);
  if (o.clamp) v = clamp01(v);
  return v;
}

/** Mask's threshold step on a source value. */
export function ttMaskThreshold(v: number, mode: string, t: number, w: number, invert: boolean): number {
  const m = mode === 'hard' ? ttHardThreshold(v, t) : mode === 'soft' ? ttSoftThreshold(v, t, w) : v;
  return invert ? 1 - m : m;
}

/** Outline (distance)'s mask for distance `d` (time `t` for moving rings). */
export function ttDistanceShape(d: number, mode: string, o: { offset: number; width: number; softness: number; reach: number; spacing: number; thickness: number; fade: number; speed: number }, t = 0): number {
  const dd = d - o.offset;
  const soft = Math.max(o.softness, 1e-4);
  switch (mode) {
    case 'glow': return Math.exp(-3 * Math.max(dd, 0) / Math.max(o.reach, 1e-4));
    case 'rings': {
      const sp = Math.max(o.spacing, 1e-4);
      const x = dd / sp - t * o.speed;
      const r = Math.abs(x - Math.floor(x) - 0.5) * sp;
      return (1 - smoothstepJs(o.thickness * 0.5, o.thickness * 0.5 + soft, r)) * Math.exp(-Math.max(dd, 0) * o.fade) * (dd >= 0 ? 1 : 0);
    }
    case 'inside': return 1 - smoothstepJs(-soft * 0.5, soft * 0.5, dd);
    case 'outside': return smoothstepJs(-soft * 0.5, soft * 0.5, dd);
    default: return 1 - smoothstepJs(o.width * 0.5, o.width * 0.5 + soft, Math.abs(dd));
  }
}

/** Luminance (Rec. 601, as Edges and Glow use). */
export const ttLuma = (r: number, g: number, b: number) => r * LUMA_W[0] + g * LUMA_W[1] + b * LUMA_W[2];

// ── Shared GLSL ──────────────────────────────────────────────────────────────

const HUE_GLSL = `float ttHue(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 q1 = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q2 = mix(vec4(q1.xyw, c.r), vec4(c.r, q1.yzx), step(q1.x, c.r));
    float d = q2.x - min(q2.w, q2.y);
    return abs(q2.z + (q2.w - q2.y) / (6.0 * d + 1e-10));
}`;
const SAT_GLSL = `float ttSat(vec3 c) {
    float hi = max(c.r, max(c.g, c.b));
    return (hi - min(c.r, min(c.g, c.b))) / (hi + 1e-10);
}`;

/** The texture (or the plain Color / Value) at the read, as a vec4 named `${id}_in`. */
function readSource(id: string, inputVars: Record<string, string>): string {
  const tex = inputVars.texture;
  if (tex) return `    vec4 ${id}_in = texture2D(${tex}, ${texUv(inputVars.uv ?? 'g_uv')});\n`;
  if (inputVars.color) return `    vec4 ${id}_in = vec4(${inputVars.color}, 1.0);\n`;
  if (inputVars.value) return `    vec4 ${id}_in = vec4(vec3(${inputVars.value}), 1.0);\n`;
  return `    vec4 ${id}_in = vec4(0.0);\n`;
}

const CHANNEL_OPTIONS = [
  { value: 'brightness', label: 'Brightness' }, { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' }, { value: 'alpha', label: 'Alpha' },
];
/** One channel of a vec4 as a float expression. */
function channelOf(v: string, ch: string): string {
  switch (ch) {
    case 'red': return `${v}.r`;
    case 'green': return `${v}.g`;
    case 'blue': return `${v}.b`;
    case 'alpha': return `${v}.a`;
    default: return `dot(${v}.rgb, ${LUMA})`;
  }
}

const sel = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

// ── Mask (texture) ───────────────────────────────────────────────────────────

const SOURCE_SECTION = 'Source';
const THRESHOLD_SECTION = 'Threshold';

export const TextureMaskNode: NodeDefinition = {
  type: 'textureMask',
  label: 'Mask (texture)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Threshold (texture)', 'Threshold TOP', 'Luma key', 'Chroma key', 'Colour key', 'Color key', 'Keyer', 'Matte', 'Hue key', 'Keep the bright parts'],
  description: 'Turns a texture into a mask: one number per pixel (its brightness, one channel, its saturation, how close it is to a hue, or to a key colour), then an optional hard or soft threshold. Mask is 0–1, Color the texture kept where the mask is, Seed the start of a jump flood. Works on a plain Value or Color too (wire one instead of Texture), so it can threshold a distance or an edge strength.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
    color: { type: 'vec3', label: 'Color', hint: 'A colour from any chain, used when Texture is not wired.' },
    value: { type: 'float', label: 'Value', hint: 'A plain number (a distance, an edge strength…), used when neither Texture nor Color is wired.' },
  },
  outputs: {
    mask: { type: 'float', label: 'Mask', hint: '0–1: where the source passes the threshold (the source itself with Threshold off).' },
    color: { type: 'vec3', label: 'Color', hint: 'The texture\'s colour, kept where the mask is.' },
    value: { type: 'float', label: 'Source', hint: 'The number read before the threshold (brightness, channel, match…).' },
    seed: { type: 'vec3', label: 'Seed', hint: 'For a jump flood: this pixel\'s place and 1 where the mask is above 0.5, black elsewhere. Wire it into the Pass that Jump flood (texture) repeats.' },
  },
  defaultParams: { source: 'brightness', hue: 120, hueWidth: 30, key: [0.1, 0.8, 0.2], tolerance: 0.25, softness: 0.1, threshold: 'soft', level: 0.5, width: 0.1, invert: false },
  paramDefs: {
    source: { label: 'Source', type: 'select', section: SOURCE_SECTION, hint: 'Which number to read from each pixel.', help: 'Brightness: how light it is. Red / Green / Blue / Alpha: one channel (a channel can hold anything: a chemical, a trail, a flag). Saturation: how colourful. Hue range: how close its colour is to a hue. Colour key: how close it is to a key colour (green screen).', options: [
      ...CHANNEL_OPTIONS, { value: 'saturation', label: 'Saturation' }, { value: 'hue', label: 'Hue range' }, { value: 'key', label: 'Colour key' },
    ] },
    hue: { label: 'Hue', type: 'float', min: 0, max: 360, step: 1, section: SOURCE_SECTION, showWhen: { param: 'source', value: 'hue' }, hint: 'The hue to keep, in degrees: 0 red, 120 green, 240 blue.' },
    hueWidth: { label: 'Hue range', type: 'float', min: 1, max: 180, step: 1, section: SOURCE_SECTION, showWhen: { param: 'source', value: 'hue' }, hint: 'How far from Hue still counts, in degrees. Greys never match.' },
    key: { label: 'Key colour', type: 'vec3color', section: SOURCE_SECTION, showWhen: { param: 'source', value: 'key' }, hint: 'The colour to pick out (a green screen\'s green).' },
    tolerance: { label: 'Tolerance', type: 'float', min: 0, max: 1.5, step: 0.005, section: SOURCE_SECTION, showWhen: { param: 'source', value: 'key' }, hint: 'How far from the key colour still counts as a full match.' },
    softness: { label: 'Key softness', type: 'float', min: 0, max: 1, step: 0.005, section: SOURCE_SECTION, showWhen: { param: 'source', value: 'key' }, hint: 'How gently the match fades past Tolerance (soft hair, motion blur).' },
    threshold: { label: 'Threshold', type: 'select', section: THRESHOLD_SECTION, hint: 'Off: the source as it is. Hard: 0 or 1 (step). Soft: a soft edge Width wide (smoothstep), so it doesn\'t flicker.', options: [
      { value: 'off', label: 'Off' }, { value: 'hard', label: 'Hard' }, { value: 'soft', label: 'Soft' },
    ] },
    level: { label: 'Level', type: 'float', min: 0, max: 1, step: 0.005, section: THRESHOLD_SECTION, showWhen: { param: 'threshold', value: ['hard', 'soft'] }, hint: 'The source value where the mask turns on.' },
    width: { label: 'Width', type: 'float', min: 0, max: 1, step: 0.005, section: THRESHOLD_SECTION, showWhen: { param: 'threshold', value: 'soft' }, hint: 'How wide the soft edge is: from Level to Level + Width.' },
    invert: { label: 'Invert', type: 'bool', section: THRESHOLD_SECTION, hint: 'Swap inside and outside (1 − mask): keep everything but the key colour.' },
  },
  glslFunctions: [HUE_GLSL, SAT_GLSL],
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const source = sel(P.source, 'brightness');
    const lines = [readSource(id, inputVars)];
    if (source === 'saturation') lines.push(`    float ${id}_src = ttSat(${id}_in.rgb);\n`);
    else if (source === 'hue') {
      lines.push(
        `    float ${id}_hd = abs(fract(ttHue(${id}_in.rgb) - ${p(P.hue, 120)} / 360.0 + 0.5) - 0.5) * 360.0;\n`,
        `    float ${id}_src = clamp(1.0 - ${id}_hd / max(${p(P.hueWidth, 30)}, 0.001), 0.0, 1.0) * smoothstep(0.05, 0.2, ttSat(${id}_in.rgb));\n`,
      );
    } else if (source === 'key') {
      lines.push(`    float ${id}_src = 1.0 - smoothstep(${p(P.tolerance, 0.25)}, ${p(P.tolerance, 0.25)} + max(${p(P.softness, 0.1)}, 0.0001), distance(${id}_in.rgb, ${pv3(P.key, [0.1, 0.8, 0.2])}));\n`);
    } else lines.push(`    float ${id}_src = ${channelOf(`${id}_in`, source)};\n`);
    const th = sel(P.threshold, 'soft');
    const lv = p(P.level, 0.5);
    lines.push(`    float ${id}_mask = ${th === 'hard' ? `step(${lv}, ${id}_src)` : th === 'soft' ? `smoothstep(${lv}, ${lv} + max(${p(P.width, 0.1)}, 0.0001), ${id}_src)` : `${id}_src`};\n`);
    if (P.invert === true) lines.push(`    ${id}_mask = 1.0 - ${id}_mask;\n`);
    lines.push(
      `    vec3 ${id}_color = ${id}_in.rgb * ${id}_mask;\n`,
      `    vec3 ${id}_seed = ${id}_mask > 0.5 ? vec3(${inputVars.uv ?? 'g_uv'}, 1.0) : vec3(0.0);\n`,
    );
    return { code: lines.join(''), outputVars: { mask: `${id}_mask`, color: `${id}_color`, value: `${id}_src`, seed: `${id}_seed` } };
  },
};

// ── Levels (texture) ─────────────────────────────────────────────────────────

export const TextureLevelsNode: NodeDefinition = {
  type: 'textureLevels',
  label: 'Levels (texture)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Level TOP', 'Grade (texture)', 'Gain and offset', 'Gamma', 'Roll-off', 'Remap (texture)', 'Pack signed', 'Unpack signed', 'Math TOP'],
  description: 'Shapes the numbers a texture holds: Gain and Offset (v × gain + offset), an in range (what becomes 0 and 1), Gamma (pow: below 1 lifts faint values, above 1 crushes them), Roll-off (x / (1 + x·k): tames values above 1 so glows don\'t clip), an out range and Clamp. Signed unpacks a stored value (0.5 reads as 0) or packs a −1…1 value for an 8-bit texture. Works on a plain Value or Color too.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
    color: { type: 'vec3', label: 'Color', hint: 'A colour from any chain, used when Texture is not wired.' },
    value: { type: 'float', label: 'Value', hint: 'A plain number (a distance, a chemical, an edge strength…), used when neither Texture nor Color is wired.' },
  },
  outputs: {
    value: { type: 'float', label: 'Value', hint: 'The shaped number (the shaped colour\'s brightness when Channel is All).' },
    color: { type: 'vec3', label: 'Color', hint: 'The shaped colour (grey when one channel is shaped).' },
  },
  defaultParams: { channel: 'all', signed: 'none', gain: 1, offset: 0, inBlack: 0, inWhite: 1, gamma: 1, rollOff: 0, outBlack: 0, outWhite: 1, clamp: false },
  paramDefs: {
    channel: { label: 'Channel', type: 'select', section: 'Levels', hint: 'Shape every channel of the colour, or one number from it.', options: [
      { value: 'all', label: 'All (colour)' }, ...CHANNEL_OPTIONS,
    ] },
    gain: { label: 'Gain', type: 'float', min: 0, max: 10, step: 0.01, section: 'Levels', hint: 'Multiplies the value first (v × Gain + Offset): raise it for faint edges or a weak trail.' },
    offset: { label: 'Offset', type: 'float', min: -1, max: 1, step: 0.005, section: 'Levels', hint: 'Added after Gain: lifts or lowers everything.' },
    inBlack: { label: 'In black', type: 'float', min: -1, max: 1, step: 0.005, section: 'Levels', hint: 'The value that becomes 0.', pair: { with: 'inWhite', label: 'In range' } },
    inWhite: { label: 'In white', type: 'float', min: 0, max: 4, step: 0.005, section: 'Levels', hint: 'The value that becomes 1.' },
    gamma: { label: 'Gamma', type: 'float', min: 0.05, max: 5, step: 0.01, section: 'Shape', hint: 'A curve, pow(v, Gamma): below 1 lifts faint values, above 1 crushes them.' },
    rollOff: { label: 'Roll-off', type: 'float', min: 0, max: 4, step: 0.01, section: 'Shape', hint: 'x / (1 + x × Roll-off): bends values above 1 down so bright parts don\'t clip to flat white. 0 is off.' },
    outBlack: { label: 'Out black', type: 'float', min: -1, max: 1, step: 0.005, section: 'Output', hint: 'What 0 becomes.', pair: { with: 'outWhite', label: 'Out range' } },
    outWhite: { label: 'Out white', type: 'float', min: -1, max: 4, step: 0.005, section: 'Output', hint: 'What 1 becomes.' },
    clamp: { label: 'Clamp 0–1', type: 'bool', section: 'Output', hint: 'Keep the result between 0 and 1.' },
    signed: { label: 'Signed', type: 'select', section: 'Output', hint: 'For values that can be negative stored in 0–1.', help: 'Unpack: read a stored value as s × 2 − 1 first, so 0.5 is 0 (displacement maps, 8-bit flows). Pack: store the result as v × 0.5 + 0.5 at the end, for an 8-bit Pass. Half-float Passes keep negatives as they are and need neither.', options: [
      { value: 'none', label: 'Off' }, { value: 'unpack', label: 'Unpack (0.5 = zero)' }, { value: 'pack', label: 'Pack (−1…1 → 0…1)' },
    ] },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const ch = sel(P.channel, 'all');
    const signed = sel(P.signed, 'none');
    const v = `${id}_v`;
    const inB = p(P.inBlack, 0), inW = p(P.inWhite, 1);
    const lines = [
      readSource(id, inputVars),
      `    vec3 ${v} = ${ch === 'all' ? `${id}_in.rgb` : `vec3(${channelOf(`${id}_in`, ch)})`};\n`,
      signed === 'unpack' ? `    ${v} = ${v} * 2.0 - 1.0;\n` : '',
      `    ${v} = ${v} * ${p(P.gain, 1)} + ${p(P.offset, 0)};\n`,
      `    float ${id}_span = ${inW} - ${inB};\n`,
      `    ${v} = (${v} - ${inB}) / (abs(${id}_span) < 0.00001 ? 0.00001 : ${id}_span);\n`,
      `    ${v} = sign(${v}) * pow(abs(${v}), vec3(max(${p(P.gamma, 1)}, 0.001)));\n`,
      `    ${v} = ${v} / (1.0 + abs(${v}) * ${p(P.rollOff, 0)});\n`,
      `    ${v} = mix(vec3(${p(P.outBlack, 0)}), vec3(${p(P.outWhite, 1)}), ${v});\n`,
      signed === 'pack' ? `    ${v} = ${v} * 0.5 + 0.5;\n` : '',
      P.clamp === true ? `    ${v} = clamp(${v}, 0.0, 1.0);\n` : '',
      `    float ${id}_value = dot(${v}, ${LUMA});\n`,
    ];
    return { code: lines.join(''), outputVars: { value: `${id}_value`, color: v } };
  },
};

// ── Flow (texture) ───────────────────────────────────────────────────────────

export const TextureFlowNode: NodeDefinition = {
  type: 'textureFlow',
  label: 'Flow (texture)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Slope (texture)', 'Gradient (texture)', 'Slope TOP', 'Vector field from texture', 'Direction field', 'Contour flow', 'Normal map (2D)'],
  description: 'A direction at every pixel, from a texture: which way its brightness (or a channel) rises, falls, or runs along the contours, or a direction stored in its red and green. Flow is a vec2 in picture units, ready to push a UV (Read, Texture Input), drive Displace or steer particles and agents; UV is this pixel moved by it.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
  },
  outputs: {
    flow: { type: 'vec2', label: 'Flow', hint: 'The direction × Strength, in picture units (the picture is 2 tall).' },
    amount: { type: 'float', label: 'Steepness', hint: 'How steep the slope is here (how much the value changes over Reach), or the stored direction\'s length.' },
    uv: { type: 'vec2', label: 'UV', hint: 'This pixel pushed along Flow: wire it into a UV to warp a picture along the texture.' },
  },
  defaultParams: { channel: 'brightness', direction: 'uphill', length: 'unit', strength: 0.05, reach: 2 },
  paramDefs: {
    channel: { label: 'From', type: 'select', hint: 'What the flow is worked out from.', help: 'A slope source (brightness or a channel) gives the way that value rises. Stored direction reads a direction kept in red and green (a velocity trail, a flow Pass): as it is in a half-float texture, or centred on 0.5 in an 8-bit one.', options: [
      ...CHANNEL_OPTIONS, { value: 'stored', label: 'Stored direction (red, green)' }, { value: 'stored8', label: 'Stored direction, 8-bit (0.5 = still)' },
    ] },
    direction: { label: 'Direction', type: 'select', hint: 'Which way the arrows point.', options: [
      { value: 'uphill', label: 'Uphill (towards brighter)' }, { value: 'downhill', label: 'Downhill (towards darker)' },
      { value: 'along', label: 'Along the contours' }, { value: 'alongReverse', label: 'Along the contours, reversed' },
    ] },
    length: { label: 'Length', type: 'select', hint: 'Unit: every arrow as long as Strength wherever there is a slope. Raw: steeper slopes give longer arrows.', options: [
      { value: 'unit', label: 'Unit (same length)' }, { value: 'raw', label: 'Raw (by steepness)' },
    ] },
    strength: { label: 'Strength', type: 'float', min: -1, max: 1, step: 0.001, hint: 'How long the arrows are, in picture units (0.05 is 2.5% of the picture\'s height). Negative turns them round.' },
    reach: { label: 'Reach', type: 'float', min: 0.5, max: 32, step: 0.5, hint: 'How far apart the slope is measured, in picture pixels: wider is smoother and ignores fine grain.' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const tex = inputVars.texture;
    const here = inputVars.uv ?? 'g_uv';
    const ch = sel(P.channel, 'brightness');
    const strength = p(P.strength, 0.05);
    const lines: string[] = [];
    if (!tex) {
      lines.push(`    vec2 ${id}_g = vec2(0.0);\n`);
    } else if (ch === 'stored' || ch === 'stored8') {
      lines.push(`    vec2 ${id}_g = texture2D(${tex}, ${texUv(here)}).rg${ch === 'stored8' ? ' * 2.0 - 1.0' : ''};\n`);
    } else {
      const at = (dx: number, dy: number) => channelOf(`texture2D(${tex}, ${id}_st + vec2(${dx}.0, ${dy}.0) * ${id}_d)`, ch);
      lines.push(
        `    vec2 ${id}_st = ${texUv(here)};\n`,
        `    vec2 ${id}_d = ${passPxUniform(tex)} * ${p(P.reach, 2)};\n`,
        `    vec2 ${id}_g = vec2(${at(1, 0)} - ${at(-1, 0)}, ${at(0, 1)} - ${at(0, -1)}) * 0.5;\n`,
      );
    }
    const dir = sel(P.direction, 'uphill');
    if (dir === 'downhill') lines.push(`    ${id}_g = -${id}_g;\n`);
    else if (dir === 'along') lines.push(`    ${id}_g = vec2(-${id}_g.y, ${id}_g.x);\n`);
    else if (dir === 'alongReverse') lines.push(`    ${id}_g = vec2(${id}_g.y, -${id}_g.x);\n`);
    lines.push(`    float ${id}_amount = length(${id}_g);\n`);
    lines.push(sel(P.length, 'unit') === 'raw'
      ? `    vec2 ${id}_flow = ${id}_g * ${strength};\n`
      : `    vec2 ${id}_flow = (${id}_amount > 0.00001 ? ${id}_g / ${id}_amount : vec2(0.0)) * ${strength};\n`);
    lines.push(`    vec2 ${id}_uv = ${here} + ${id}_flow;\n`);
    return { code: lines.join(''), outputVars: { flow: `${id}_flow`, amount: `${id}_amount`, uv: `${id}_uv` } };
  },
};

// ── Neighbours (texture) ─────────────────────────────────────────────────────

/** Sizes of the neighbourhood: reads across (a disc inside that square). */
export const NEIGHBOUR_SIZES = ['3', '5', '7', '9'] as const;
const sizeOf = (v: unknown) => (NEIGHBOUR_SIZES as readonly string[]).includes(String(v)) ? Number(v) : 3;
/** How many texture reads a Neighbours size makes per pixel (the disc inside the square). */
export function neighbourTaps(size: number): number {
  const R = (size - 1) / 2;
  let n = 0;
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) if (x * x + y * y <= R * R + R) n++;
  return n;
}

export const TextureNeighboursNode: NodeDefinition = {
  type: 'textureNeighbours',
  label: 'Neighbours (texture)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Neighbors (texture)', 'Erode', 'Dilate', 'Grow mask', 'Shrink mask', 'Laplacian', 'Min / max filter', 'Morphology', 'Local contrast', 'Box blur (texture)'],
  description: 'Looks at the pixels round each one, in a small disc: their Average (a light blur), this pixel\'s Difference from that average (a Laplacian: edges, ridges, and how reaction-diffusion spreads), the Max or Min round it (grow or shrink a mask: dilate, erode), or the Range (max − min: an outline of any shape). Size is how many reads across; Spacing spreads them out.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The result per channel.' },
    value: { type: 'float', label: 'Value', hint: 'The result as one number (its brightness).' },
    alpha: { type: 'float', label: 'Alpha', hint: 'The result for the alpha channel.' },
  },
  defaultParams: { mode: 'average', size: '3', spacing: 1, strength: 1 },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', hint: 'What to work out from the neighbours.', help: 'Average: their mean (a small blur). Difference from average: average − this pixel, positive in dips, negative on bumps (a Laplacian). Max: the brightest round it, so bright shapes grow (dilate). Min: the darkest, so bright shapes shrink (erode). Range: max − min, bright on every edge.', options: [
      { value: 'average', label: 'Average around' }, { value: 'difference', label: 'Difference from average' },
      { value: 'max', label: 'Max around (grow)' }, { value: 'min', label: 'Min around (shrink)' }, { value: 'range', label: 'Range (max − min)' },
    ] },
    size: { label: 'Size', type: 'select', compileTime: true, hint: 'Reads across (a disc in that square): 3 is 9 reads, 5 is 21, 7 is 37, 9 is 69 per pixel. For a wider reach raise Spacing, or set the Pass upstream to ½.', options: [
      { value: '3', label: '3 × 3' }, { value: '5', label: '5 × 5' }, { value: '7', label: '7 × 7' }, { value: '9', label: '9 × 9' },
    ] },
    spacing: { label: 'Spacing', type: 'float', min: 0.5, max: 16, step: 0.25, hint: 'Picture pixels between reads: wider grows or shrinks further for the same cost, with gaps on fine detail.' },
    strength: { label: 'Strength', type: 'float', min: 0, max: 20, step: 0.05, showWhen: { param: 'mode', value: ['difference', 'range'] }, hint: 'Gain on the difference or range: small differences are faint.' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const tex = inputVars.texture;
    const mode = sel(P.mode, 'average');
    if (!tex) {
      return { code: `    vec4 ${id}_r = vec4(0.0);\n    float ${id}_value = 0.0;\n`, outputVars: { color: `${id}_r.rgb`, value: `${id}_value`, alpha: `${id}_r.a` } };
    }
    const size = sizeOf(P.size);
    const R = (size - 1) / 2;
    const taps = size * size;
    const f1 = (n: number) => `${n}.0`;
    const lines = [
      `    vec2 ${id}_st = ${texUv(inputVars.uv ?? 'g_uv')};\n`,
      `    vec2 ${id}_d = ${passPxUniform(tex)} * ${p(P.spacing, 1)};\n`,
      `    vec4 ${id}_c = texture2D(${tex}, ${id}_st);\n`,
      `    vec4 ${id}_sum = vec4(0.0);\n`,
      `    vec4 ${id}_hi = vec4(-1e9);\n`,
      `    vec4 ${id}_lo = vec4(1e9);\n`,
      `    float ${id}_n = 0.0;\n`,
      // One loop with a literal bound (the Performance panel reports it): the square, minus its corners.
      `    for (int ${id}_k = 0; ${id}_k < ${taps}; ${id}_k++) {\n`,
      `        vec2 ${id}_o = vec2(mod(float(${id}_k), ${f1(size)}), floor(float(${id}_k) / ${f1(size)})) - ${f1(R)};\n`,
      `        if (dot(${id}_o, ${id}_o) > ${f1(R * R + R)}) continue;\n`,
      `        vec4 ${id}_s = texture2D(${tex}, ${id}_st + ${id}_o * ${id}_d);\n`,
      `        ${id}_sum += ${id}_s; ${id}_hi = max(${id}_hi, ${id}_s); ${id}_lo = min(${id}_lo, ${id}_s); ${id}_n += 1.0;\n`,
      `    }\n`,
    ];
    const strength = p(P.strength, 1);
    const result = {
      average: `${id}_sum / ${id}_n`,
      difference: `(${id}_sum / ${id}_n - ${id}_c) * ${strength}`,
      max: `${id}_hi`,
      min: `${id}_lo`,
      range: `(${id}_hi - ${id}_lo) * ${strength}`,
    }[mode] ?? `${id}_sum / ${id}_n`;
    lines.push(`    vec4 ${id}_r = ${result};\n`, `    float ${id}_value = dot(${id}_r.rgb, ${LUMA});\n`);
    return { code: lines.join(''), outputVars: { color: `${id}_r.rgb`, value: `${id}_value`, alpha: `${id}_r.a` } };
  },
};

// ── Change (texture) ─────────────────────────────────────────────────────────

export const TextureChangeNode: NodeDefinition = {
  type: 'textureChange',
  label: 'Change (texture)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Motion (texture)', 'Frame difference', 'Motion detect', 'Difference matte', 'Time difference', 'What moved', 'Optical flow (rough)'],
  description: 'What changed between Texture (now) and Before (a frame ago): Motion is a mask, bright where something moved; Change is the signed difference in brightness; Direction roughly which way it moved. Wire a Pass\'s Texture and its own Previous. For a video, draw the video into a Pass first and wire that Pass\'s Texture and Previous (the starter offer sets it up).',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'Now: a Pass\'s Texture (or any texture).' },
    before: { type: 'texture', label: 'Before', hint: 'A frame ago: the same Pass\'s Previous output. Unwired, nothing has changed.' },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
  },
  outputs: {
    motion: { type: 'float', label: 'Motion', hint: '0–1: how much changed here, after Amount and Threshold.' },
    change: { type: 'float', label: 'Change', hint: 'Signed: positive where it got brighter, negative where darker.' },
    direction: { type: 'vec2', label: 'Direction', hint: 'Roughly which way things moved, in picture pixels a frame (only across edges: a moving edge can\'t show motion along itself).' },
    color: { type: 'vec3', label: 'Color', hint: 'Now\'s colour, kept where something moved.' },
  },
  defaultParams: { measure: 'brightness', amount: 4, level: 0.05, width: 0.2 },
  paramDefs: {
    measure: { label: 'Measure', type: 'select', hint: 'Brightness ignores colour shifts of the same brightness; Colour counts any change.', options: [
      { value: 'brightness', label: 'Brightness' }, { value: 'colour', label: 'Colour' },
    ] },
    amount: { label: 'Amount', type: 'float', min: 0, max: 40, step: 0.05, hint: 'Gain on the difference: small, slow movements need more.' },
    level: { label: 'Threshold', type: 'float', min: 0, max: 1, step: 0.005, hint: 'Ignore changes below this (camera noise, flicker).' },
    width: { label: 'Softness', type: 'float', min: 0, max: 1, step: 0.005, hint: 'How gently Motion fades in above Threshold.' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const tex = inputVars.texture;
    const lv = p(P.level, 0.05), w = p(P.width, 0.2), amount = p(P.amount, 4);
    if (!tex) {
      return {
        code: `    float ${id}_change = 0.0;\n    float ${id}_motion = 0.0;\n    vec2 ${id}_dir = vec2(0.0);\n    vec3 ${id}_color = vec3(0.0);\n`,
        outputVars: { motion: `${id}_motion`, change: `${id}_change`, direction: `${id}_dir`, color: `${id}_color` },
      };
    }
    const before = inputVars.before;
    const lum = (s: string) => `dot(${s}.rgb, ${LUMA})`;
    const at = (dx: number, dy: number) => lum(`texture2D(${tex}, ${id}_st + vec2(${dx}.0, ${dy}.0) * ${passPxUniform(tex)})`);
    const lines = [
      `    vec2 ${id}_st = ${texUv(inputVars.uv ?? 'g_uv')};\n`,
      `    vec4 ${id}_now = texture2D(${tex}, ${id}_st);\n`,
      `    vec4 ${id}_was = ${before ? `texture2D(${before}, ${id}_st)` : `${id}_now`};\n`,
      `    float ${id}_change = ${lum(`${id}_now`)} - ${lum(`${id}_was`)};\n`,
      `    float ${id}_size = ${sel(P.measure, 'brightness') === 'colour' ? `length(${id}_now.rgb - ${id}_was.rgb)` : `abs(${id}_change)`};\n`,
      `    float ${id}_motion = smoothstep(${lv}, ${lv} + max(${w}, 0.0001), ${id}_size * ${amount});\n`,
      // Normal flow (the across-edge part of the motion): v = −dI/dt · ∇I / |∇I|², in picture pixels.
      `    vec2 ${id}_g = vec2(${at(1, 0)} - ${at(-1, 0)}, ${at(0, 1)} - ${at(0, -1)}) * 0.5;\n`,
      `    vec2 ${id}_dir = -${id}_change * ${id}_g / (dot(${id}_g, ${id}_g) + 0.0001) * ${id}_motion;\n`,
      `    vec3 ${id}_color = ${id}_now.rgb * ${id}_motion;\n`,
    ];
    return { code: lines.join(''), outputVars: { motion: `${id}_motion`, change: `${id}_change`, direction: `${id}_dir`, color: `${id}_color` } };
  },
};

// ── Outline (distance) ───────────────────────────────────────────────────────

const MODE_OUTLINE = 'outline';

export const DistanceShapeNode: NodeDefinition = {
  type: 'distanceShape',
  label: 'Outline (distance)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Outline from distance', 'Rings from distance', 'Stroke', 'Contours', 'Offset outline', 'Distance glow', 'Grow / shrink (distance)', 'Iso lines'],
  description: 'Draws from a distance: Jump flood\'s Distance, an SDF, or any float that grows away from a shape. Outline (a line Width wide), Glow (falling off over Reach), Rings (lines every Spacing, moving with Speed), Inside or Outside (a mask). Offset moves the edge out (or in, below 0) first. Mask is 0–1; Light is Tint where the mask is, to add over a picture.',
  inputs: {
    distance: { type: 'float', label: 'Distance', hint: 'How far this pixel is from the shape, in picture units (Jump flood\'s Distance, an SDF). Wins over Texture.' },
    texture: { type: 'texture', label: 'Texture', hint: 'A texture holding a distance in red (a half-float Pass that stored one), used when Distance is not wired.' },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
  },
  outputs: {
    mask: { type: 'float', label: 'Mask', hint: '0–1: the outline, glow, rings or region.' },
    light: { type: 'vec3', label: 'Light', hint: 'Tint × mask: add it over a picture (Add Colors, Blend Modes: Screen).' },
  },
  defaultParams: { mode: MODE_OUTLINE, offset: 0.02, width: 0.01, softness: 0.005, reach: 0.15, spacing: 0.08, thickness: 0.01, fade: 3, speed: 0.5, tint: [1, 0.75, 0.35] },
  paramDefs: {
    mode: { label: 'Draw', type: 'select', hint: 'What to draw from the distance.', options: [
      { value: 'outline', label: 'Outline' }, { value: 'glow', label: 'Glow' }, { value: 'rings', label: 'Rings' },
      { value: 'inside', label: 'Inside (grown shape)' }, { value: 'outside', label: 'Outside' },
    ] },
    offset: { label: 'Offset', type: 'float', min: -0.5, max: 1, step: 0.001, hint: 'Moves the edge out by this much first (picture units; the picture is 2 tall). Below 0 moves it in (an SDF only: a jump flood is 0 inside).' },
    width: { label: 'Width', type: 'float', min: 0, max: 0.5, step: 0.001, showWhen: { param: 'mode', value: 'outline' }, hint: 'The outline\'s thickness, in picture units.' },
    softness: { label: 'Softness', type: 'float', min: 0, max: 0.2, step: 0.001, showWhen: { param: 'mode', value: ['outline', 'rings', 'inside', 'outside'] }, hint: 'How soft the edges are, in picture units (about 0.003 is one pixel of a 720-tall picture).' },
    reach: { label: 'Reach', type: 'float', min: 0.001, max: 2, step: 0.001, showWhen: { param: 'mode', value: 'glow' }, hint: 'How far the glow spreads before it is nearly gone, in picture units.' },
    spacing: { label: 'Spacing', type: 'float', min: 0.005, max: 1, step: 0.001, showWhen: { param: 'mode', value: 'rings' }, hint: 'Distance between rings, in picture units.' },
    thickness: { label: 'Thickness', type: 'float', min: 0, max: 0.2, step: 0.001, showWhen: { param: 'mode', value: 'rings' }, hint: 'Each ring\'s thickness, in picture units.' },
    fade: { label: 'Fade', type: 'float', min: 0, max: 20, step: 0.05, showWhen: { param: 'mode', value: 'rings' }, hint: 'Rings dim further out: 0 keeps them all as bright.' },
    speed: { label: 'Speed', type: 'float', min: -4, max: 4, step: 0.01, showWhen: { param: 'mode', value: 'rings' }, hint: 'Rings a second moving outwards (negative: inwards).' },
    tint: { label: 'Tint', type: 'vec3color', hint: 'The colour of the Light output.' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const d = inputVars.distance
      ?? (inputVars.texture ? `texture2D(${inputVars.texture}, ${texUv(inputVars.uv ?? 'g_uv')}).r` : '4.0');
    const soft = `max(${p(P.softness, 0.005)}, 0.0001)`;
    const dd = `${id}_d`;
    const mode = sel(P.mode, MODE_OUTLINE);
    const lines = [`    float ${dd} = ${d} - ${p(P.offset, 0.02)};\n`];
    if (mode === 'glow') lines.push(`    float ${id}_mask = exp(-3.0 * max(${dd}, 0.0) / max(${p(P.reach, 0.15)}, 0.0001));\n`);
    else if (mode === 'rings') {
      lines.push(
        `    float ${id}_sp = max(${p(P.spacing, 0.08)}, 0.0001);\n`,
        `    float ${id}_r = abs(fract(${dd} / ${id}_sp - u_time * ${p(P.speed, 0.5)}) - 0.5) * ${id}_sp;\n`,
        `    float ${id}_mask = (1.0 - smoothstep(${p(P.thickness, 0.01)} * 0.5, ${p(P.thickness, 0.01)} * 0.5 + ${soft}, ${id}_r)) * exp(-max(${dd}, 0.0) * ${p(P.fade, 3)}) * step(0.0, ${dd});\n`,
      );
    } else if (mode === 'inside') lines.push(`    float ${id}_mask = 1.0 - smoothstep(-${soft} * 0.5, ${soft} * 0.5, ${dd});\n`);
    else if (mode === 'outside') lines.push(`    float ${id}_mask = smoothstep(-${soft} * 0.5, ${soft} * 0.5, ${dd});\n`);
    else lines.push(`    float ${id}_mask = 1.0 - smoothstep(${p(P.width, 0.01)} * 0.5, ${p(P.width, 0.01)} * 0.5 + ${soft}, abs(${dd}));\n`);
    lines.push(`    vec3 ${id}_light = ${pv3(P.tint, [1, 0.75, 0.35])} * ${id}_mask;\n`);
    return { code: lines.join(''), outputVars: { mask: `${id}_mask`, light: `${id}_light` } };
  },
};

// ── Fade (feedback) ──────────────────────────────────────────────────────────

export const TextureFadeNode: NodeDefinition = {
  type: 'textureFade',
  label: 'Fade (feedback)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Decay', 'Feedback fade', 'Trails fade', 'Persistence', 'Afterimage', 'Fade and add'],
  description: 'Fades last frame\'s picture for a feedback Pass: max(old × d − e, 0) each frame, where Tail sets d (seconds for a lone bright pixel to fade to 1%, the same at any frame rate) and Clean subtracts a little so it really reaches black. Tint gives each channel its own tail (red shorter: tails cool to blue). Fresh paint is added on top. Wire the Pass\'s Previous into Texture and the result back into the Pass.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'Last frame: the feedback Pass\'s Previous output.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read last frame (Read\'s UV for a drift: zoom, swirl, push). Leave empty for this pixel.' },
    fresh: { type: 'vec3', label: 'Fresh', hint: 'This frame\'s new paint, laid over the faded picture.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The faded picture with the fresh paint: wire it into the Pass.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'Last frame\'s alpha, faded the same way.' },
  },
  defaultParams: { tail: 1.5, clean: 0.2, tint: [1, 1, 1], combine: 'add' },
  paramDefs: {
    tail: { label: 'Tail', type: 'float', min: 0.02, max: 20, step: 0.01, hint: 'Seconds for a pixel left alone to fade to 1%. Long tails for comet trails, short for sparks.' },
    clean: { label: 'Clean', type: 'float', min: 0, max: 2, step: 0.005, hint: 'Taken off every second (the e in max(old × d − e, 0)), so faint trails reach black instead of lingering as a haze.' },
    tint: { label: 'Tint', type: 'vec3color', hint: 'Each channel\'s tail, as a share of Tail: white fades evenly; less red fades red first, so tails cool to blue.' },
    combine: { label: 'Fresh paint', type: 'select', hint: 'How the fresh paint meets the faded picture.', options: [
      { value: 'add', label: 'Add (light builds up)' }, { value: 'max', label: 'Brighter of the two' }, { value: 'over', label: 'Over (replace where painted)' },
    ] },
  },
  assignable: false,
  declarationsFor: () => [`uniform float ${FRAME_DT_UNIFORM};`],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const tex = inputVars.texture;
    const fresh = inputVars.fresh ?? 'vec3(0.0)';
    const combine = sel(P.combine, 'add');
    const lines = [
      `    vec4 ${id}_old = ${tex ? `texture2D(${tex}, ${texUv(inputVars.uv ?? 'g_uv')})` : 'vec4(0.0)'};\n`,
      `    float ${id}_dt = ${FRAME_DT_UNIFORM} > 0.0 ? ${FRAME_DT_UNIFORM} : 1.0 / 60.0;\n`,
      `    vec3 ${id}_tail = max(${p(P.tail, 1.5)} * ${pv3(P.tint, [1, 1, 1])}, vec3(0.001));\n`,
      `    vec3 ${id}_keep = exp(${LN_HUNDREDTH} * ${id}_dt / ${id}_tail);\n`,
      `    vec3 ${id}_faded = max(${id}_old.rgb * ${id}_keep - ${p(P.clean, 0.2)} * ${id}_dt, 0.0);\n`,
      `    float ${id}_alpha = ${id}_old.a * exp(${LN_HUNDREDTH} * ${id}_dt / max(${p(P.tail, 1.5)}, 0.001));\n`,
      `    vec3 ${id}_color = ${combine === 'max' ? `max(${id}_faded, ${fresh})` : combine === 'over' ? `mix(${id}_faded, ${fresh}, clamp(max(${fresh}.r, max(${fresh}.g, ${fresh}.b)), 0.0, 1.0))` : `${id}_faded + ${fresh}`};\n`,
    ];
    return { code: lines.join(''), outputVars: { color: `${id}_color`, alpha: `${id}_alpha` } };
  },
};

// ── Read (texture) ───────────────────────────────────────────────────────────

export const ReadTextureNode: NodeDefinition = {
  type: 'readTexture',
  label: 'Read (texture)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Transform (texture)', 'Transform TOP', 'Zoom (texture)', 'Feedback drift', 'Warp read', 'Bend the read', 'Lookup (texture)'],
  description: 'Reads a texture with the read bent: zoomed, turned and moved round a Pivot, and pushed along a Flow. You never move pixels in a texture, only where each one reads from: Zoom above 1 makes the picture grow, Turn spins it, Move slides it. On a Pass\'s Previous it is the drift of a feedback trail; with Flow (texture) wired, it pushes the picture along the flow. UV is the bent place, for another read.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
    flow: { type: 'vec2', label: 'Flow', hint: 'Pushes the picture along this (picture units): Flow (texture)\'s Flow, a noise, a mouse drag.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The texture at the bent place.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'Its alpha there.' },
    uv: { type: 'vec2', label: 'UV', hint: 'The bent place in picture coordinates: wire it into another read\'s UV (Fade, Sample) so both read the same way.' },
  },
  defaultParams: { zoom: 1, turn: 0, moveX: 0, moveY: 0, pivotX: 0, pivotY: 0, flowAmount: 1, edges: 'texture' },
  paramDefs: {
    zoom: { label: 'Zoom', type: 'float', min: 0.5, max: 2, step: 0.001, hint: 'Above 1 the picture grows from the pivot (reads nearer it); below 1 it shrinks. 1.01 on a Previous: trails stream outwards.' },
    turn: { label: 'Turn', type: 'float', min: -180, max: 180, step: 0.05, hint: 'Degrees the picture turns round the pivot (anticlockwise). A degree or two on a Previous: trails swirl.' },
    moveX: { label: 'Move X', type: 'float', min: -50, max: 50, step: 0.25, hint: 'Slides the picture right by this many picture pixels (it reads from the left).', pair: { with: 'moveY', label: 'Move' } },
    moveY: { label: 'Move Y', type: 'float', min: -50, max: 50, step: 0.25, hint: 'Slides the picture up by this many picture pixels.' },
    pivotX: { label: 'Pivot X', type: 'float', min: -2, max: 2, step: 0.005, hint: 'The point it zooms and turns round, in picture coordinates (0, 0 is the centre).', pair: { with: 'pivotY', label: 'Pivot' } },
    pivotY: { label: 'Pivot Y', type: 'float', min: -1, max: 1, step: 0.005, hint: 'The pivot\'s height (−1 bottom, 1 top).' },
    flowAmount: { label: 'Flow amount', type: 'float', min: -10, max: 10, step: 0.01, hint: 'How far the Flow input pushes the picture (1: as given). Only used when Flow is wired.' },
    edges: { label: 'Edges', type: 'select', hint: 'What a read past the edge of the picture sees.', options: [
      { value: 'texture', label: 'As the texture' }, { value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' },
    ] },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const tex = inputVars.texture;
    const here = inputVars.uv ?? 'g_uv';
    const lines = [
      `    vec2 ${id}_pv = vec2(${p(P.pivotX, 0)}, ${p(P.pivotY, 0)});\n`,
      `    float ${id}_a = radians(${p(P.turn, 0)});\n`,
      // Reading turned by −a and nearer the pivot by 1/zoom makes the picture turn by a and grow.
      `    vec2 ${id}_p = (${here} - ${id}_pv) / (abs(${p(P.zoom, 1)}) < 0.0001 ? 0.0001 : ${p(P.zoom, 1)});\n`,
      `    vec2 ${id}_q = ${id}_pv + vec2(cos(${id}_a) * ${id}_p.x + sin(${id}_a) * ${id}_p.y, -sin(${id}_a) * ${id}_p.x + cos(${id}_a) * ${id}_p.y);\n`,
      inputVars.flow ? `    ${id}_q -= ${inputVars.flow} * ${p(P.flowAmount, 1)};\n` : '',
      // Move is in picture pixels: one is 2 / the picture's height in these coordinates.
      `    ${id}_q -= vec2(${p(P.moveX, 0)}, ${p(P.moveY, 0)}) * 2.0 * ${tex ? `${passPxUniform(tex)}.y` : '(1.0 / u_resolution.y)'};\n`,
    ];
    if (!tex) {
      lines.push(`    vec4 ${id}_s = vec4(0.0);\n`);
    } else {
      const edges = sel(P.edges, 'texture');
      const st = texUv(`${id}_q`);
      const wrapped = edges === 'clamp' ? `clamp(${st}, 0.0, 1.0)` : edges === 'repeat' ? `fract(${st})` : edges === 'mirror' ? `1.0 - abs(1.0 - mod(${st}, 2.0))` : st;
      lines.push(`    vec4 ${id}_s = texture2D(${tex}, ${wrapped});\n`);
    }
    return { code: lines.join(''), outputVars: { color: `${id}_s.rgb`, alpha: `${id}_s.a`, uv: `${id}_q` } };
  },
};

/** Every Texture tools node type, in palette order. */
export const TEXTURE_TOOL_TYPES = [
  'textureMask', 'textureLevels', 'textureFlow', 'textureNeighbours', 'textureChange', 'distanceShape', 'textureFade', 'readTexture',
] as const;

