/**
 * depthMix.ts — Depth Mix (docs/depth-mix.md): a picture with depth and a scene, put together in one of six ways.
 *
 * The Depth node gives a picture's nearness (0–1, 1 = the nearest thing in the frame). Depth Mix shapes it (a range
 * and a curve) and uses it to put a scene (2D shapes, a pattern, anything with a colour) and the picture together:
 *
 *   Size      the scene over the picture; Scale (and Sized value) grow a shape's radius on near things.
 *   Space     the scene over the picture; Depth UV moves the point by depth (parallax, a zoom or a turn).
 *   Occlude   the scene sits at one depth: it shows only where it is nearer than the picture.
 *   Fog       the scene fades out where the picture is far, into a haze of the fog colour.
 *   Light     the scene is light falling on the picture, stronger on near things.
 *   Mix       the scene and the picture blended by depth: near shows the picture (or the scene).
 *
 * Size and Space are about the outputs a scene reads (Scale, Sized value, Depth UV): wire them into a shape's radius
 * or the point the shapes are measured from. Their Color is the scene over the picture by "With the picture". A scene
 * that reads Depth UV and is also wired back into this node's Scene would be a loop, so the 2D Scene Builder builds
 * two Depth Mix nodes: one for the shapes, one for the colour.
 *
 * Gradient over depth: a cosine palette read along the shaped depth (Scale cycles, Phase shifts it; wire Time into
 * Phase to animate it), applied to the scene, the picture or both. The maths is mirrored in plain JS below for tests.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, pv3, withParamSockets } from './helpers';
import { PALETTE_PRESETS } from './color';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';

export const DEPTH_MIX_TYPE = 'depthMix';

export const DEPTH_MIX_MODES = ['size', 'space', 'occlude', 'fog', 'light', 'mix'] as const;
export type DepthMixMode = typeof DEPTH_MIX_MODES[number];

/** Each mode in plain words: the card's options, the docs and the builders use these. */
export const DEPTH_MIX_LABELS: Record<DepthMixMode, { label: string; blurb: string }> = {
  size: { label: 'Depth → size', blurb: 'Shapes grow on near things and shrink on far ones: wire Sized value (or Scale) into a shape\'s radius.' },
  space: { label: 'Depth → space', blurb: 'The point the shapes are measured from moves by depth: wire Depth UV into the shapes. Near and far parts pull them apart, so glows beam through the picture.' },
  occlude: { label: 'Occlude', blurb: 'The scene sits at one depth (Scene sits at): it shows only where it is nearer than the picture, and hides behind near things.' },
  fog: { label: 'Fog', blurb: 'The scene fades out where the picture is far, into a haze of the fog colour: it sits in the picture\'s air.' },
  light: { label: 'Light by depth', blurb: 'The scene is light falling on the picture: it lights near things most, and still glows on its own.' },
  mix: { label: 'Mix', blurb: 'The scene and the picture blended by depth: near shows the picture (or the scene), far the other.' },
};

export const DEPTH_MIX_COMBINES = ['add', 'screen', 'over', 'tint'] as const;
export type DepthMixCombine = typeof DEPTH_MIX_COMBINES[number];
export const DEPTH_MIX_COMBINE_LABELS: Record<DepthMixCombine, { label: string; blurb: string }> = {
  add: { label: 'Add (light)', blurb: 'The scene\'s light added over the picture: glows brighten it.' },
  screen: { label: 'Screen', blurb: 'Like Add, but never past white: softer highlights.' },
  over: { label: 'Over (by Scene mask)', blurb: 'The scene painted over the picture where Scene mask is 1 (unwired: everywhere).' },
  tint: { label: 'Tint by the picture', blurb: 'The scene takes the picture\'s colours: shapes look painted from the photo.' },
};

export const DEPTH_SPACE_STYLES = ['shift', 'radial', 'swirl'] as const;
export type DepthSpaceStyle = typeof DEPTH_SPACE_STYLES[number];
export const DEPTH_SPACE_LABELS: Record<DepthSpaceStyle, { label: string; blurb: string }> = {
  shift: { label: 'Shift (parallax)', blurb: 'Near and far slide apart along Direction.' },
  radial: { label: 'Zoom', blurb: 'Near things push out from the centre, far ones in.' },
  swirl: { label: 'Turn', blurb: 'The point turns round the centre by depth.' },
};

export const DEPTH_GRADIENT_TARGETS = ['scene', 'picture', 'both'] as const;
export type DepthGradientTarget = typeof DEPTH_GRADIENT_TARGETS[number];
export const DEPTH_GRADIENT_HOWS = ['multiply', 'colorize', 'add'] as const;
export type DepthGradientHow = typeof DEPTH_GRADIENT_HOWS[number];

/** The gradients a Depth Mix can lay along depth: the Palette node's cosine presets, by index ('off' for none). */
export const DEPTH_GRADIENT_OPTIONS = [{ value: 'off', label: 'Off' }, ...PALETTE_PRESETS.map((pr, i) => ({ value: String(i), label: pr.name }))];

// ── The maths, in plain JS (the GLSL below does the same) ───────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Shaped depth: nearness through the range (Far end → 0, Near end → 1) and the curve (above 1 keeps only the nearest). */
export function depthMixShape(near: number, farEnd: number, nearEnd: number, curve: number): number {
  let den = nearEnd - farEnd;
  if (Math.abs(den) < 1e-4) den = 1e-4;
  return Math.pow(clamp01((near - farEnd) / den), Math.max(curve, 0.01));
}

/** Depth → size: the factor a shape's size is multiplied by. */
export const depthMixScale = (n: number, sizeFar: number, sizeNear: number) => sizeFar + (sizeNear - sizeFar) * n;

/** Depth → space: the point moved by depth (n − Focus) in one of three ways. */
export function depthMixUv(uv: [number, number], n: number, style: DepthSpaceStyle, amount: number, angleDeg: number, focus: number): [number, number] {
  const k = amount * (n - focus);
  if (style === 'radial') return [uv[0] * (1 + k), uv[1] * (1 + k)];
  if (style === 'swirl') { const a = k * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); return [c * uv[0] - s * uv[1], s * uv[0] + c * uv[1]]; }
  const a = angleDeg * Math.PI / 180;
  return [uv[0] + Math.cos(a) * k, uv[1] + Math.sin(a) * k];
}

/** Occlude: how much the scene is in front of the picture at this pixel (soft over `soft` either side). */
export const depthMixFront = (n: number, level: number, soft: number) => smoothstep(-Math.max(soft, 1e-4), Math.max(soft, 1e-4), level - n);

/** The gradient over depth at shaped depth n: a cosine palette at n × Scale + Phase. */
export function depthMixGradient(n: number, preset: number, scale: number, phase: number): [number, number, number] {
  const pr = PALETTE_PRESETS[Math.max(0, Math.min(PALETTE_PRESETS.length - 1, preset))];
  const t = n * scale + phase;
  return [0, 1, 2].map(i => pr.offset[i] + pr.amplitude[i] * Math.cos(2 * Math.PI * (pr.freq[i] * t + pr.phase[i]))) as [number, number, number];
}

// ── The node ─────────────────────────────────────────────────────────────────

const SHAPE = 'Depth range';
/** The gradient's settings show (and are read) once a gradient is picked. */
const GRADIENT_ON = { param: 'gradient', value: PALETTE_PRESETS.map((_, i) => String(i)) };
const SIZE = 'Size';
const SPACE = 'Space';
const OCCLUDE = 'Occlude';
const FOG = 'Fog';
const LIGHT = 'Light';
const MIX = 'Mix';
const GRADIENT = 'Gradient over depth';

const modeOf = (v: unknown): DepthMixMode => ((DEPTH_MIX_MODES as readonly string[]).includes(v as string) ? v as DepthMixMode : 'mix');
const combineOf = (v: unknown): DepthMixCombine => ((DEPTH_MIX_COMBINES as readonly string[]).includes(v as string) ? v as DepthMixCombine : 'add');
const styleOf = (v: unknown): DepthSpaceStyle => ((DEPTH_SPACE_STYLES as readonly string[]).includes(v as string) ? v as DepthSpaceStyle : 'shift');
const targetOf = (v: unknown): DepthGradientTarget => ((DEPTH_GRADIENT_TARGETS as readonly string[]).includes(v as string) ? v as DepthGradientTarget : 'scene');
const howOf = (v: unknown): DepthGradientHow => ((DEPTH_GRADIENT_HOWS as readonly string[]).includes(v as string) ? v as DepthGradientHow : 'multiply');
const presetOf = (v: unknown): number | null => {
  if (v === 'off' || v === undefined || v === null || v === '') return null;
  const i = parseInt(String(v), 10);
  return Number.isFinite(i) ? Math.max(0, Math.min(PALETTE_PRESETS.length - 1, i)) : null;
};
const v3 = (a: number[]) => `vec3(${a.map(x => (Number.isInteger(x) ? `${x}.0` : String(x))).join(', ')})`;

/** Every slider is wireable (docs/wireable-sliders.md): a wire takes its place, sockets come out on demand. */
export const DepthMixNode: NodeDefinition = withParamSockets({
  type: DEPTH_MIX_TYPE,
  label: 'Depth Mix',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['depth blend', 'depth combine', 'picture with depth', 'depth fog', 'depth occlude', 'depth light', 'depth gradient', 'depth size', 'depth parallax', 'mix by depth'],
  description: 'A picture with depth and a scene, put together: Depth → size (shapes grow on near things), Depth → space (the shapes\' point moves by depth: glows beam through), Occlude (the scene only where it is nearer), Fog (it fades where the picture is far), Light by depth, or Mix (blend by depth). Plus a gradient laid along depth, on the scene, the picture or both. Wire the picture\'s colour, the Depth node\'s Depth and the scene\'s colour.',
  inputs: {
    picture: { type: 'vec3', label: 'Picture', hint: 'The picture\'s colour (a Texture Input\'s Color, or a Sample (texture)).' },
    depth: { type: 'float', label: 'Depth', hint: 'The Depth node\'s Depth (Near is: Bright): 1 nearest.' },
    scene: { type: 'vec3', label: 'Scene', hint: 'The scene\'s colour: shapes, a glow, a pattern. Unwired: black (use the outputs only).' },
    coverage: { type: 'float', label: 'Scene mask', hint: 'Where the scene has something (1) and where it is empty (0), for With the picture: Over and for Occlude. Unwired: everywhere.' },
    uv: { type: 'vec2', label: 'UV', hint: 'The point Depth UV moves (Depth → space). Unwired: this pixel.' },
    value: { type: 'float', label: 'Value', hint: 'A size to scale by depth (a radius): Sized value is Value × Scale. Unwired: 1.' },
    phase: { type: 'float', label: 'Phase', hint: 'Added to the gradient\'s Phase: wire Time to make the colours flow along depth.' },
    direction: { type: 'vec2', label: 'Direction', hint: 'Depth → space, Shift: which way near things move (overrides Direction°). Wire the Mouse to look around.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The scene and the picture put together by the Mode.' },
    depth: { type: 'float', label: 'Shaped depth', hint: 'The depth after the range and curve: 0 far, 1 near.' },
    scale: { type: 'float', label: 'Scale', hint: 'Depth → size: Size far … Size near by depth. Multiply a radius by it (or wire it into a Transform\'s Grow).' },
    sized: { type: 'float', label: 'Sized value', hint: 'Value × Scale: wire a shape\'s radius through Value and take this into the shape.' },
    uv: { type: 'vec2', label: 'Depth UV', hint: 'Depth → space: UV moved by depth. Wire it into the shapes\' position for parallax and beams.' },
    nearMask: { type: 'float', label: 'Near mask', hint: '1 where the picture is nearer than Scene sits at (soft over Softness): what hides the scene in Occlude.' },
    front: { type: 'float', label: 'Scene shows', hint: 'How much of the scene shows at this pixel (Occlude: in front; Fog: not fogged; else the Scene mask).' },
    gradient: { type: 'vec3', label: 'Gradient', hint: 'The gradient over depth at this pixel (black with Gradient: Off).' },
  },
  socketsOnDemand: { direction: ['angle'] },
  defaultParams: {
    mode: 'mix', combine: 'add', pictureAmount: 1,
    farEnd: 0, nearEnd: 1, curve: 1,
    sizeFar: 0.4, sizeNear: 1.6,
    spaceStyle: 'shift', spaceAmount: 0.15, angle: 0, focus: 0,
    level: 0.5, softness: 0.05,
    fogDensity: 0.9, haze: 0.35, fogColor: [0.72, 0.78, 0.9],
    lightStrength: 2, ambient: 0.55, glowKeep: 1,
    mixNear: 'picture', mixAmount: 1,
    gradient: 'off', gradientTo: 'scene', gradientHow: 'multiply', gradientAmount: 0.8, gradientScale: 1, gradientPhase: 0,
  },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', hint: 'How the scene and the picture go together. Size and Space are about the outputs (Sized value, Depth UV) your shapes read.', options: DEPTH_MIX_MODES.map(m => ({ value: m, label: DEPTH_MIX_LABELS[m].label })) },
    combine: { label: 'With the picture', type: 'select', hint: 'How the scene goes over the picture in Size, Space, Occlude and Fog.', options: DEPTH_MIX_COMBINES.map(c => ({ value: c, label: DEPTH_MIX_COMBINE_LABELS[c].label })) },
    pictureAmount: { label: 'Picture', type: 'float', min: 0, max: 2, step: 0.01, hint: 'How bright the picture shows under the scene: 0 hides it (the scene alone).' },
    farEnd: { label: 'Far end', type: 'float', min: 0, max: 1, step: 0.005, section: SHAPE, pair: { with: 'nearEnd', label: 'Depth range' }, hint: 'The nearness that counts as farthest (0): raise it to treat the background as flat.' },
    nearEnd: { label: 'Near end', type: 'float', min: 0, max: 1, step: 0.005, section: SHAPE, hint: 'The nearness that counts as nearest (1): lower it so more of the picture counts as near.' },
    curve: { label: 'Curve', type: 'float', min: 0.2, max: 5, step: 0.01, section: SHAPE, hint: 'Above 1 only the nearest things count; below 1 everything but the far background does.' },
    sizeFar: { label: 'Size far', type: 'float', min: 0, max: 4, step: 0.01, section: SIZE, hint: 'Depth → size: how big shapes are on the farthest things (× their own size).' },
    sizeNear: { label: 'Size near', type: 'float', min: 0, max: 4, step: 0.01, section: SIZE, hint: 'How big shapes are on the nearest things.' },
    spaceStyle: { label: 'Move by', type: 'select', section: SPACE, hint: 'Depth → space: how depth moves the point the shapes are measured from.', options: DEPTH_SPACE_STYLES.map(s => ({ value: s, label: DEPTH_SPACE_LABELS[s].label })) },
    spaceAmount: { label: 'Amount', type: 'float', min: -1, max: 1, step: 0.005, section: SPACE, hint: 'How far depth moves it. Small is parallax; large beams glows through the picture.' },
    angle: { label: 'Direction°', type: 'float', min: -180, max: 180, step: 1, section: SPACE, hint: 'Shift: which way near things move, in degrees (0 right, 90 up).' },
    focus: { label: 'Focus', type: 'float', min: 0, max: 1, step: 0.01, section: SPACE, hint: 'The depth that stays still: nearer moves one way, farther the other.' },
    level: { label: 'Scene sits at', type: 'float', min: 0, max: 1, step: 0.005, section: OCCLUDE, hint: 'Occlude: the scene\'s depth (0 far, 1 near). The picture hides it wherever the picture is nearer.' },
    softness: { label: 'Softness', type: 'float', min: 0, max: 0.5, step: 0.005, section: OCCLUDE, hint: 'How gently the scene fades in and out at that depth (depth is soft round hair and edges).' },
    fogDensity: { showWhen: { param: 'mode', value: 'fog' }, label: 'Density', type: 'float', min: 0, max: 1, step: 0.01, section: FOG, hint: 'Fog: how much the scene fades on the farthest things (1: gone).' },
    haze: { showWhen: { param: 'mode', value: 'fog' }, label: 'Haze', type: 'float', min: 0, max: 1, step: 0.01, section: FOG, hint: 'How much fog colour hangs in the far part of the picture itself.' },
    fogColor: { showWhen: { param: 'mode', value: 'fog' }, label: 'Fog colour', type: 'vec3color', section: FOG, hint: 'The haze\'s colour.' },
    lightStrength: { showWhen: { param: 'mode', value: 'light' }, label: 'Strength', type: 'float', min: 0, max: 10, step: 0.01, section: LIGHT, hint: 'Light by depth: how strongly the scene lights the picture (most on near things).' },
    ambient: { showWhen: { param: 'mode', value: 'light' }, label: 'Own light', type: 'float', min: 0, max: 1.5, step: 0.01, section: LIGHT, hint: 'How much of the picture\'s own light stays: lower for a night relight.' },
    glowKeep: { showWhen: { param: 'mode', value: 'light' }, label: 'Glow', type: 'float', min: 0, max: 2, step: 0.01, section: LIGHT, hint: 'How much of the scene still shows as itself, on top.' },
    mixNear: { showWhen: { param: 'mode', value: 'mix' }, label: 'Near shows', type: 'select', section: MIX, hint: 'Mix: what the near things show.', options: [{ value: 'picture', label: 'The picture' }, { value: 'scene', label: 'The scene' }] },
    mixAmount: { showWhen: { param: 'mode', value: 'mix' }, label: 'Amount', type: 'float', min: 0, max: 1, step: 0.01, section: MIX, hint: 'How far the blend goes: 1 is all the way.' },
    gradient: { label: 'Gradient', type: 'select', section: GRADIENT, hint: 'A palette laid along depth: the colour shifts as the picture gets deeper.', options: DEPTH_GRADIENT_OPTIONS },
    gradientTo: { showWhen: GRADIENT_ON, label: 'On', type: 'select', section: GRADIENT, hint: 'What the gradient colours.', options: [{ value: 'scene', label: 'The scene' }, { value: 'picture', label: 'The picture' }, { value: 'both', label: 'Both' }] },
    gradientHow: { showWhen: GRADIENT_ON, label: 'How', type: 'select', section: GRADIENT, hint: 'Multiply tints; Colorize keeps only brightness and takes the gradient\'s colour; Add lays it on as light.', options: [{ value: 'multiply', label: 'Multiply' }, { value: 'colorize', label: 'Colorize' }, { value: 'add', label: 'Add' }] },
    gradientAmount: { showWhen: GRADIENT_ON, label: 'Amount', type: 'float', min: 0, max: 1, step: 0.01, section: GRADIENT, hint: 'How strong the gradient is.' },
    gradientScale: { showWhen: GRADIENT_ON, label: 'Cycles', type: 'float', min: 0, max: 8, step: 0.01, section: GRADIENT, hint: 'How many times the palette repeats from far to near.' },
    gradientPhase: { showWhen: GRADIENT_ON, label: 'Phase', type: 'float', min: -2, max: 2, step: 0.005, section: GRADIENT, hint: 'Shifts the colours along depth. Wire Time into the Phase socket to make them flow.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const mode = modeOf(P.mode);
    const combine = combineOf(P.combine);
    const style = styleOf(P.spaceStyle);
    const preset = presetOf(P.gradient);
    const pic = inputVars.picture || 'vec3(0.0)';
    const dep = inputVars.depth || '0.0';
    const scene = inputVars.scene || 'vec3(0.0)';
    const cov = inputVars.coverage || '1.0';
    const uv = inputVars.uv || 'g_uv';
    const val = inputVars.value || '1.0';
    const pa = p(P.pictureAmount, 1);
    const L: string[] = [];
    const line = (s: string) => L.push(`    ${s}\n`);
    // Shaped depth: through the range, then the curve
    line(`float ${id}_den = ${p(P.nearEnd, 1)} - ${p(P.farEnd, 0)};`);
    line(`${id}_den = abs(${id}_den) < 1e-4 ? 1e-4 : ${id}_den;`);
    line(`float ${id}_n = pow(clamp(((${dep}) - ${p(P.farEnd, 0)}) / ${id}_den, 0.0, 1.0), max(${p(P.curve, 1)}, 0.01));`);
    // Size and space: ready for any shape to read
    line(`float ${id}_scale = mix(${p(P.sizeFar, 0.4)}, ${p(P.sizeNear, 1.6)}, ${id}_n);`);
    line(`float ${id}_sized = (${val}) * ${id}_scale;`);
    line(`float ${id}_k = ${p(P.spaceAmount, 0.15)} * (${id}_n - ${p(P.focus, 0)});`);
    if (style === 'radial') line(`vec2 ${id}_uv = (${uv}) * (1.0 + ${id}_k);`);
    else if (style === 'swirl') {
      line(`float ${id}_a = ${id}_k * 6.2831853;`);
      line(`vec2 ${id}_uv = mat2(cos(${id}_a), sin(${id}_a), -sin(${id}_a), cos(${id}_a)) * (${uv});`);
    } else {
      const dir = inputVars.direction || `vec2(cos(radians(${p(P.angle, 0)})), sin(radians(${p(P.angle, 0)})))`;
      line(`vec2 ${id}_uv = (${uv}) + (${dir}) * ${id}_k;`);
    }
    line(`float ${id}_soft = max(${p(P.softness, 0.05)}, 1e-4);`);
    line(`float ${id}_near = smoothstep(-${id}_soft, ${id}_soft, ${id}_n - ${p(P.level, 0.5)});`);
    // The gradient over depth (a cosine palette along the shaped depth)
    if (preset !== null) {
      const pr = PALETTE_PRESETS[preset];
      const phase = inputVars.phase ? `${p(P.gradientPhase, 0)} + (${inputVars.phase})` : p(P.gradientPhase, 0);
      line(`vec3 ${id}_grad = ${v3(pr.offset)} + ${v3(pr.amplitude)} * cos(6.2831853 * (${v3(pr.freq)} * (${id}_n * ${p(P.gradientScale, 1)} + ${phase}) + ${v3(pr.phase)}));`);
    } else line(`vec3 ${id}_grad = vec3(0.0);`);
    const amt = p(P.gradientAmount, 0.8);
    const how = howOf(P.gradientHow);
    const tint = (x: string) => (how === 'colorize'
      ? `mix(${x}, ${id}_grad * max(max(${x}.r, ${x}.g), ${x}.b), ${amt})`
      : how === 'add' ? `(${x} + ${id}_grad * ${amt})` : `mix(${x}, ${x} * ${id}_grad, ${amt})`);
    const target = targetOf(P.gradientTo);
    const on = (t: DepthGradientTarget) => preset !== null && (target === t || target === 'both');
    line(`vec3 ${id}_pic = ${on('picture') ? tint(`(${pic})`) : `(${pic})`} * ${pa};`);
    line(`vec3 ${id}_sc = ${on('scene') ? tint(`(${scene})`) : `(${scene})`};`);
    // The scene over the picture, by With the picture; k is how much of the scene shows
    const over = (k: string) => {
      switch (combine) {
        case 'screen': return `(vec3(1.0) - (vec3(1.0) - clamp(${id}_pic, 0.0, 1.0)) * (vec3(1.0) - clamp(${id}_sc * (${k}), 0.0, 1.0)))`;
        case 'over': return `mix(${id}_pic, ${id}_sc, clamp((${cov}) * (${k}), 0.0, 1.0))`;
        case 'tint': return `(${id}_pic + ${id}_sc * (${k}) * (${pic}) * 2.0)`;
        default: return `(${id}_pic + ${id}_sc * (${k}))`;
      }
    };
    switch (mode) {
      case 'occlude':
        // The scene in front where it sits nearer than the picture (and where it has something)
        line(`float ${id}_front = (1.0 - ${id}_near)${combine === 'over' ? '' : ` * clamp(${cov}, 0.0, 1.0)`};`);
        line(`vec3 ${id}_color = ${over(`${id}_front`)};`);
        break;
      case 'fog': {
        line(`float ${id}_fog = clamp(${p(P.fogDensity, 0.9)} * (1.0 - ${id}_n), 0.0, 1.0);`);
        line(`float ${id}_front = 1.0 - ${id}_fog;`);
        line(`vec3 ${id}_color = mix(${over(`${id}_front`)}, ${pv3(P.fogColor, [0.72, 0.78, 0.9])}, clamp(${p(P.haze, 0.35)} * (1.0 - ${id}_n), 0.0, 1.0));`);
        break;
      }
      case 'light':
        line(`float ${id}_front = clamp(${cov}, 0.0, 1.0);`);
        line(`vec3 ${id}_color = ${id}_pic * (${p(P.ambient, 0.55)} + ${p(P.lightStrength, 2)} * ${id}_sc * ${id}_n) + ${id}_sc * ${p(P.glowKeep, 1)};`);
        break;
      case 'mix': {
        const w = P.mixNear === 'scene' ? `(1.0 - ${id}_n)` : `${id}_n`;
        line(`float ${id}_front = 1.0 - clamp(${w} * ${p(P.mixAmount, 1)}, 0.0, 1.0);`);
        line(`vec3 ${id}_color = mix(${id}_pic, ${id}_sc, ${id}_front);`);
        break;
      }
      default:
        line(`float ${id}_front = clamp(${cov}, 0.0, 1.0);`);
        line(`vec3 ${id}_color = ${over('1.0')};`);
    }
    return {
      code: L.join(''),
      outputVars: { color: `${id}_color`, depth: `${id}_n`, scale: `${id}_scale`, sized: `${id}_sized`, uv: `${id}_uv`, nearMask: `${id}_near`, front: `${id}_front`, gradient: `${id}_grad` },
    };
  },
}, ['pictureAmount', 'farEnd', 'nearEnd', 'curve', 'sizeFar', 'sizeNear', 'spaceAmount', 'angle', 'focus', 'level', 'softness', 'fogDensity', 'haze', 'fogColor', 'lightStrength', 'ambient', 'glowKeep', 'mixAmount', 'gradientAmount', 'gradientScale', 'gradientPhase']);
