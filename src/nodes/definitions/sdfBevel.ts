/**
 * SDF Bevel (docs/sdf-bevel.md): lights a flat 2D shape as if it were raised (or engraved), so a logo, a button or a
 * tile looks 3D. The shape's distance becomes a height through a bevel profile: inside, height =
 * profile(clamp(−distance ÷ Width, 0, 1)) × Depth, 0 outside; the slope of that height is the surface's tilt, lit by
 * the same lamp as Normal from Height (lampGLSL in normalFromHeight.ts).
 *
 * Distance ƒ is an optional field socket: when the wired chain can be a function of position, the node reads the
 * distance one pixel to each side of the point for an exact slope, and once more towards the light for a soft drop
 * shadow. When it can't, it takes the slope from the next pixel on screen (dFdx / dFdy) and draws no shadow.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { fieldFn, p, pv3, withParamSockets } from './helpers';
import { lampGLSL, litColourGLSL } from './normalFromHeight';

export const BEVEL_PROFILES = ['chamfer', 'round', 'cove', 'ogee', 'pillow', 'steps'] as const;
export type BevelProfile = typeof BEVEL_PROFILES[number];
type Mode = 'lit' | 'normal' | 'height';

const profileOf = (n: GraphNode): BevelProfile =>
  ((BEVEL_PROFILES as readonly string[]).includes(String(n.params.profile)) ? String(n.params.profile) as BevelProfile : 'round');
const modeOf = (n: GraphNode): Mode => (['lit', 'normal', 'height'].includes(String(n.params.mode)) ? String(n.params.mode) as Mode : 'lit');

/**
 * Each profile's curve, 0 at the outline (t = 0) to 1 at Width in (t = 1), as GLSL statements ending in a return,
 * with t already clamped to 0..1 and n the Steps count.
 */
export const BEVEL_PROFILE_BODY: Record<BevelProfile, string> = {
  // A straight ramp.
  chamfer: 'return t;',
  // A quarter circle, bulging out: steep at the outline, flat on top.
  round: 'float u = 1.0 - t;\n  return sqrt(max(1.0 - u * u, 0.0));',
  // A quarter circle, scooped in: flat at the outline, steep near the top.
  cove: 'return 1.0 - sqrt(max(1.0 - t * t, 0.0));',
  // An S: scooped in at the bottom, rounded over at the top, steepest half way.
  ogee: 'return 0.5 - 0.5 * cos(t * 3.14159265);',
  // A soft dome: rises at the outline and eases to flat, gentler than Round.
  pillow: 'return t * (2.0 - t);',
  // Terraces: n flat levels, each with a short soft ramp up to it.
  steps: 'float k = max(floor(n + 0.5), 1.0);\n  float s = min(t, 0.9999) * k;\n  return (floor(s) + smoothstep(0.0, 0.3, fract(s))) / k;',
};

/** The GLSL function name for a profile: sdfBevelRound(distance, width, steps). */
export const bevelProfileFn = (pr: BevelProfile) => `sdfBevel${pr[0].toUpperCase()}${pr.slice(1)}`;

/** The profile's GLSL helper: height 0..1 from a distance, the Width and the Steps count. */
export function bevelProfileGLSL(pr: BevelProfile): string {
  return `float ${bevelProfileFn(pr)}(float d, float w, float n) {\n  float t = clamp(-d / max(w, 1.0e-5), 0.0, 1.0);\n  ${BEVEL_PROFILE_BODY[pr]}\n}`;
}

export const SdfBevelNode: NodeDefinition = withParamSockets({
  type: 'sdfBevel',
  label: 'SDF Bevel',
  category: 'SDF', subcategory: 'Style',
  aliases: ['Bevel', 'Emboss', 'Bevel and emboss', 'Raised', 'Engrave', 'Engraved', 'Button', 'Inner bevel', 'Chamfer', 'Drop shadow', '3D shape'],
  description: 'Lights a flat shape as if it were raised, so logos, text, buttons and tiles look 3D. The shape\'s Distance becomes a height through a bevel Profile (Chamfer, Round, Cove, S-curve, Pillow, Steps), Width in from the outline and Depth high, lit by one lamp with a shiny highlight and a soft drop shadow. Invert engraves it instead. Colour is the lit shape over Background; Normal, Height and Shaded are there for your own lighting.',
  inputs: {
    d: { type: 'float', label: 'Distance ƒ', field: true, fieldOptional: true, hint: 'Any 2D shape\'s distance (Circle SDF, Shape SDF, a Union…), negative inside. Read a little to each side for the exact slope and towards the light for the shadow; if the chain can\'t be read elsewhere (it reads the previous frame), the slope comes from the next pixel on screen and there is no shadow.' },
    fill: { type: 'vec3', label: 'Fill', hint: 'The shape\'s own colour (a palette, a picture), lit by the lamp. Empty: the Fill colour below.' },
    background: { type: 'vec3', label: 'Background', hint: 'What is round the shape; the drop shadow falls on it. Empty: the Background colour below.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the distance, in picture coordinates. Empty: this pixel.' },
  },
  outputs: {
    colour: { type: 'vec3', label: 'Colour', hint: 'What Mode picks: the lit shape over Background with its shadow and outline, the normal as colour, or the height as grey.' },
    shaded: { type: 'float', label: 'Shaded', hint: 'The light alone, 0 (dark) to 1 (fully lit, highlight included), the shadow taken off: multiply your own colours by it.' },
    normal: { type: 'vec3', label: 'Normal', hint: 'Which way the surface faces, length 1 (x across, y up the picture, z out of the screen). Straight out off the shape and on its flat top.' },
    height: { type: 'float', label: 'Height', hint: 'How high the surface is: 0 outside and at the outline, Depth on the flat top (below 0 when engraved).' },
    mask: { type: 'float', label: 'Mask', hint: '1 on the shape, 0 outside, soft over Edge softness: for Mask or Alpha Blend.' },
  },
  glslFunctionsFor: node => [bevelProfileGLSL(profileOf(node))],
  defaultParams: {
    profile: 'round', steps: 4, width: 0.06, depth: 0.04, invert: false,
    lightAngle: 135, lightHeight: 40, lightColour: [1, 0.97, 0.9],
    ambient: 0.25, specular: 0.4, shininess: 32,
    edge: 1, outlineWidth: 0, outlineColour: [0.05, 0.05, 0.06],
    shadow: 0.5, shadowDistance: 0.025, shadowSoftness: 0.02,
    fill: [0.82, 0.84, 0.88], background: [0.16, 0.17, 0.2], mode: 'lit',
  },
  paramDefs: {
    profile: { label: 'Profile', type: 'select', section: 'Bevel', hint: 'The shape of the bevel\'s edge, from the outline in.', options: [
      { value: 'chamfer', label: 'Chamfer (straight)' },
      { value: 'round', label: 'Round (quarter circle)' },
      { value: 'cove', label: 'Cove (scooped in)' },
      { value: 'ogee', label: 'S-curve (ogee)' },
      { value: 'pillow', label: 'Pillow (soft dome)' },
      { value: 'steps', label: 'Steps (terraces)' },
    ] },
    steps: { label: 'Steps', type: 'float', min: 1, max: 12, step: 1, section: 'Bevel', hint: 'How many terraces the bevel climbs in.', showWhen: { param: 'profile', value: 'steps' } },
    width: { label: 'Width', type: 'float', min: 0.005, max: 0.5, step: 0.001, section: 'Bevel', hint: 'How far in from the outline the bevel goes, in picture units (the picture is 2 high). Wider than the shape is thick makes a dome with no flat top.' },
    depth: { label: 'Depth', type: 'float', min: 0, max: 0.3, step: 0.001, section: 'Bevel', hint: 'How high the top stands, in picture units: about Width gives a 45° chamfer; less is gentler, more is steeper. 0 is flat.' },
    invert: { label: 'Invert', type: 'bool', section: 'Bevel', hint: 'Engraved instead of raised: the shape is cut into the surface, and the shadow falls inside it.' },
    lightAngle: { label: 'Light from', type: 'float', min: 0, max: 360, step: 0.5, section: 'Light', hint: 'Which way the light comes from, in degrees: 0 from the right, 90 from the top, 180 from the left.' },
    lightHeight: { label: 'Light height', type: 'float', min: 1, max: 90, step: 0.5, section: 'Light', hint: 'How high the lamp is, in degrees: low (10–30) makes strong light and dark sides; 90 is straight in front.' },
    lightColour: { label: 'Light colour', type: 'vec3color', section: 'Light', hint: 'The lamp\'s colour, for the lit side and the highlight.' },
    ambient: { label: 'Ambient', type: 'float', min: 0, max: 1, step: 0.01, section: 'Light', hint: 'Light that reaches the dark side too: 0 is black.' },
    specular: { label: 'Specular', type: 'float', min: 0, max: 2, step: 0.01, section: 'Light', hint: 'How bright the shiny highlight is: 0 is matt (stone, paper), 1 is glossy (plastic, metal).' },
    shininess: { label: 'Shininess', type: 'float', min: 1, max: 256, step: 1, section: 'Light', hint: 'How small and sharp the highlight is: low is a broad sheen, high a tight sparkle.' },
    shadow: { label: 'Shadow', type: 'float', min: 0, max: 1, step: 0.01, section: 'Shadow', hint: 'How dark the drop shadow is: 0 is none. Only when the distance can be read elsewhere.' },
    shadowDistance: { label: 'Shadow distance', type: 'float', min: 0, max: 0.2, step: 0.001, section: 'Shadow', hint: 'How far the shadow falls from the shape, away from the light, in picture units.' },
    shadowSoftness: { label: 'Shadow softness', type: 'float', min: 0, max: 0.2, step: 0.001, section: 'Shadow', hint: 'How blurred the shadow\'s edge is, in picture units.' },
    edge: { label: 'Edge softness', type: 'float', min: 0, max: 8, step: 0.05, section: 'Look', hint: 'How soft the shape\'s outline is, in pixels: 1 is smooth with no jaggies; more blurs it.' },
    outlineWidth: { label: 'Outline', type: 'float', min: 0, max: 0.1, step: 0.001, section: 'Look', hint: 'A line along the outline, this wide in picture units: 0 is none.' },
    outlineColour: { label: 'Outline colour', type: 'vec3color', section: 'Look', hint: 'The outline\'s colour.' },
    fill: { label: 'Fill', type: 'vec3color', section: 'Look', hint: 'The shape\'s colour when nothing is wired into Fill.' },
    background: { label: 'Background', type: 'vec3color', section: 'Look', hint: 'The colour round the shape when nothing is wired into Background.' },
    mode: { label: 'Mode', type: 'select', section: 'Look', hint: 'What the Colour output shows.', options: [
      { value: 'lit', label: 'Lit shape' },
      { value: 'normal', label: 'Normal as colour' },
      { value: 'height', label: 'Height as grey' },
    ] },
  },
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const fn = fieldFn(v.d);
    const pr = profileOf(node);
    const F = bevelProfileFn(pr);
    const invert = P.invert === true || P.invert === 'true';
    const N = pr === 'steps' ? `(${p(P.steps, 4)})` : '1.0';
    const depth = `${invert ? '-' : ''}(${p(P.depth, 0.04)})`;
    const prof = (d: string) => `${F}(${d}, ${id}_w, ${N})`;
    const outs = { colour: `${id}_c`, shaded: `${id}_lt`, normal: `${id}_n`, height: `${id}_h`, mask: `${id}_m` };
    const at = (off: string) => `${fn}(${id}_q + ${off}, vec2(0.0), 1.0, 0.0)`;
    const lines: string[] = [];
    if (fn) lines.push(`    vec2 ${id}_q = ${v.uv ?? 'g_uv'};\n`);
    lines.push(
      `    float ${id}_px = 2.0 / u_resolution.y;\n`,
      `    float ${id}_dist = ${fn ? `${fn}(${id}_q, vec2(0.0), 1.0, 0.0)` : v.d ?? '1.0'};\n`,
      `    float ${id}_w = max(${p(P.width, 0.06)}, 1.0e-4);\n`,
      `    float ${id}_pr = ${prof(`${id}_dist`)};\n`,
      `    float ${id}_h = ${id}_pr * ${depth};\n`,
    );
    if (fn) {
      // A field: the height one pixel to each side of the point (the distance read there, through the profile).
      lines.push(`    vec2 ${id}_g = vec2(${prof(at(`vec2(${id}_px, 0.0)`))} - ${prof(at(`vec2(-${id}_px, 0.0)`))}, ${prof(at(`vec2(0.0, ${id}_px)`))} - ${prof(at(`vec2(0.0, -${id}_px)`))}) * ${depth} / (2.0 * ${id}_px);\n`);
    } else if (v.d) {
      // A plain value: how the height changes to the next pixel on screen, per picture unit.
      lines.push(`    vec2 ${id}_g = vec2(dFdx(${id}_h), dFdy(${id}_h)) * (u_resolution.y * 0.5);\n`);
    } else {
      lines.push(`    vec2 ${id}_g = vec2(0.0);\n`);
    }
    lines.push(
      `    vec3 ${id}_n = normalize(vec3(-${id}_g, 1.0));\n`,
      ...lampGLSL(id, P),
      `    float ${id}_aa = max(${p(P.edge, 1)}, 0.01) * ${id}_px;\n`,
      `    float ${id}_m = 1.0 - smoothstep(-${id}_aa, ${id}_aa, ${id}_dist);\n`,
    );
    if (fn) {
      // The drop shadow: the shape read again, moved towards the light. Raised, the shape shades the ground beside it,
      // away from the light; engraved, the surround shades the floor of the cut on the side the light comes from.
      lines.push(
        `    vec2 ${id}_sd = vec2(cos(radians(${p(P.lightAngle, 135)})), sin(radians(${p(P.lightAngle, 135)}))) * (${p(P.shadowDistance, 0.025)});\n`,
        `    float ${id}_sb = max(${p(P.shadowSoftness, 0.02)}, ${id}_aa);\n`,
        `    float ${id}_cast = 1.0 - smoothstep(-${id}_sb, ${id}_sb, ${at(`${id}_sd`)});\n`,
        `    float ${id}_sh = ${invert ? `(1.0 - ${id}_cast) * ${id}_m` : `${id}_cast * (1.0 - ${id}_m)`} * clamp(${p(P.shadow, 0.5)}, 0.0, 1.0);\n`,
      );
    } else {
      lines.push(`    float ${id}_sh = 0.0;\n`);
    }
    lines.push(`    float ${id}_lt = ${id}_s * (1.0 - ${id}_sh);\n`);
    const mode = modeOf(node);
    if (mode === 'normal') lines.push(`    vec3 ${id}_c = ${id}_n * 0.5 + 0.5;\n`);
    else if (mode === 'height') lines.push(`    vec3 ${id}_c = vec3(${invert ? `1.0 - ${id}_pr` : `${id}_pr`});\n`);
    else {
      const fill = v.fill ?? pv3(P.fill, [0.82, 0.84, 0.88]);
      const bg = v.background ?? pv3(P.background, [0.16, 0.17, 0.2]);
      const lit = `(${litColourGLSL(id, P, fill)})`;
      lines.push(
        invert
          ? `    vec3 ${id}_c = mix(${bg}, ${lit} * (1.0 - ${id}_sh), ${id}_m);\n`
          : `    vec3 ${id}_c = mix(${bg} * (1.0 - ${id}_sh), ${lit}, ${id}_m);\n`,
        `    float ${id}_ow = ${p(P.outlineWidth, 0)};\n`,
        `    float ${id}_ol = (1.0 - smoothstep(-${id}_aa, ${id}_aa, abs(${id}_dist) - ${id}_ow * 0.5)) * step(1.0e-6, ${id}_ow);\n`,
        `    ${id}_c = mix(${id}_c, ${pv3(P.outlineColour, [0.05, 0.05, 0.06])}, ${id}_ol);\n`,
      );
    }
    return { code: lines.join(''), outputVars: outs };
  },
}, ['width', 'depth', 'lightAngle', 'lightHeight', 'ambient', 'specular']);
