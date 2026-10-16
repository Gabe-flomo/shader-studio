import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ── Basic SDF combiners ───────────────────────────────────────────────────────



// ── New SDF combiners ─────────────────────────────────────────────────────────





// ── Color / value combiners ───────────────────────────────────────────────────


export const MaskNode: NodeDefinition = {
  type: 'mask',
  label: 'Mask',
  category: 'Combiners',
  description: 'Wire a float SDF or mask into Mask / SDF to cut between two vec3 inputs. Threshold sets the cutoff; Edge Width softens it. Negative SDF values = inside = show A.',
  inputs: {
    a:         { type: 'vec3',  label: 'Inside' },
    b:         { type: 'vec3',  label: 'Outside' },
    mask:      { type: 'float', label: 'Mask / SDF' },
    threshold: { type: 'float', label: 'Threshold' },
    edge:      { type: 'float', label: 'Edge Width' },
  },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: { threshold: 0.0, edge: 0.02 },
  paramDefs: {
    threshold: { label: 'Threshold', type: 'float', min: -1.0, max: 1.0,  step: 0.005 },
    edge:      { label: 'Edge Width',type: 'float', min: 0.001, max: 0.5, step: 0.001 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_result`;
    const aVar   = inputVars.a         || 'vec3(1.0)';
    const bVar   = inputVars.b         || 'vec3(0.0)';
    const mVar   = inputVars.mask      || '0.0';
    const tVar   = inputVars.threshold || p(node.params.threshold, 0.0);
    const eVar   = inputVars.edge      || p(node.params.edge, 0.02);
    return {
      code: [
        `    float ${node.id}_mf = 1.0 - smoothstep(${tVar} - ${eVar}, ${tVar} + ${eVar}, ${mVar});\n`,
        `    vec3 ${outVar} = mix(${bVar}, ${aVar}, ${node.id}_mf);\n`,
      ].join(''),
      outputVars: { result: outVar },
    };
  },
};

export const AddColorNode: NodeDefinition = {
  type: 'addColor',
  label: 'Add Colors',
  category: 'Combiners',
  description: 'Additive color blend — A + B * Scale. Standard way to accumulate glow layers.',
  inputs: {
    a:     { type: 'vec3',  label: 'A' },
    b:     { type: 'vec3',  label: 'B' },
    scale: { type: 'float', label: 'Scale' },
  },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: { scale: 1.0 },
  paramDefs: {
    scale: { label: 'Scale', type: 'float', min: 0.0, max: 4.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar  = `${node.id}_result`;
    const aVar    = inputVars.a     || 'vec3(0.0)';
    const bVar    = inputVars.b     || 'vec3(0.0)';
    const sVar    = inputVars.scale || p(node.params.scale, 1.0);
    return {
      code: `    vec3 ${outVar} = ${aVar} + ${bVar} * ${sVar};\n`,
      outputVars: { result: outVar },
    };
  },
};


// ── Compound / smart combiners ────────────────────────────────────────────────

/**
 * Glow types: how a distance becomes glow (Glow Layer's Type, and the 2D Scene Builder's Look → Glow
 * type, which writes the same formulas into its Expression Blocks). i is the amount (how far the glow
 * reaches, in picture units), p the falloff. Every type but Halo and Rim is 1 inside the shape.
 */
export const GLOW_TYPES = ['halo', 'soft', 'exp', 'gauss', 'neon', 'rim', 'invsq'] as const;
export type GlowType = typeof GLOW_TYPES[number];
export const GLOW_TYPE_LABELS: Record<GlowType, { label: string; blurb: string }> = {
  halo: { label: 'Halo (inverse distance)', blurb: 'amount ÷ |distance|: a bright rim round the edge that falls off slowly. The classic glow; it goes past 1 at the edge.' },
  soft: { label: 'Soft', blurb: 'amount ÷ (distance outside + amount): the shape\'s colour inside and at the edge, fading out from there. One shape.' },
  exp: { label: 'Exponential', blurb: 'exp(−distance ÷ 3·amount): a glow that dies away evenly, with no long tail.' },
  gauss: { label: 'Gaussian', blurb: 'exp(−(distance ÷ 4·amount)²): a broad, soft bloom with a flat top that ends cleanly.' },
  neon: { label: 'Neon', blurb: 'A bright core line on the edge plus a soft halo: a neon tube.' },
  rim: { label: 'Rim (edge only)', blurb: 'Only the edge glows, inside and out: the middle stays dark.' },
  invsq: { label: 'Inverse square', blurb: '1 ÷ (1 + (distance ÷ amount)²): like light from a lamp, bright near and quickly gone.' },
};
/** The glow (a float, 0 far away) for distance `d`, amount `i` and falloff `p`, as GLSL. */
export function glowFormula(type: string, d: string, i: string, pw: string): string {
  const x = `(max(${d}, 0.0) / max(${i}, 1.0e-5))`;
  switch (type) {
    case 'soft': return `pow(1.0 / (1.0 + ${x}), ${pw})`;
    case 'exp': return `exp(-0.35 * ${x} * ${pw})`;
    case 'gauss': return `exp(-0.0625 * ${x} * ${x} * ${pw})`;
    case 'neon': return `(0.6 * pow(1.0 / (1.0 + ${x}), ${pw}) + 1.2 * exp(-abs(${d}) / max(0.35 * ${i}, 1.0e-5)))`;
    case 'rim': return `pow(1.0 / (1.0 + abs(${d}) / max(${i}, 1.0e-5)), ${pw})`;
    case 'invsq': return `pow(1.0 / (1.0 + ${x} * ${x}), ${pw})`;
    default: return `pow(${i} / max(abs(${d}), 0.0001), ${pw})`;
  }
}

export const GlowLayerNode: NodeDefinition = {
  type: 'glowLayer',
  label: 'Glow Layer',
  category: 'Combiners',
  description: 'Turns a signed distance field into a coloured glow. Type picks the formula: Halo (the classic Intensity ÷ |SDF|), Soft, Exponential, Gaussian, Neon, Rim or Inverse square. Intensity is how far it reaches, Power sharpens the falloff.',
  inputs: {
    d:         { type: 'float', label: 'SDF' },
    color:     { type: 'vec3',  label: 'Color' },
    intensity: { type: 'float', label: 'Intensity' },
    power:     { type: 'float', label: 'Power' },
  },
  outputs: { result: { type: 'vec3', label: 'Glow' } },
  defaultParams: { intensity: 0.01, power: 1.0, mode: 'halo' },
  paramDefs: {
    mode:      { label: 'Type', type: 'select', options: GLOW_TYPES.map(t => ({ value: t, label: GLOW_TYPE_LABELS[t].label })),
      hint: GLOW_TYPES.map(t => `${GLOW_TYPE_LABELS[t].label}: ${GLOW_TYPE_LABELS[t].blurb}`).join('\n') },
    intensity: { label: 'Intensity', type: 'float', min: 0.001, max: 0.2,  step: 0.001, hint: 'The amount: how far the glow reaches.' },
    power:     { label: 'Power',     type: 'float', min: 0.1,   max: 4.0,  step: 0.05, hint: 'The falloff: bigger fades faster.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const dVar    = inputVars.d         || '1.0';
    const cVar    = inputVars.color     || 'vec3(1.0)';
    const iVar    = inputVars.intensity || p(node.params.intensity, 0.01);
    const pVar    = inputVars.power     || p(node.params.power, 1.0);
    return {
      code: [
        `    float ${id}_g = ${glowFormula(String(node.params.mode ?? 'halo'), dVar, iVar, pVar)};\n`,
        `    vec3 ${id}_result = ${cVar} * ${id}_g;\n`,
      ].join(''),
      outputVars: { result: `${id}_result` },
    };
  },
};

export const DeepGlowNode: NodeDefinition = {
  type: 'deepGlow',
  label: 'Deep Glow',
  category: 'Combiners',
  description: 'After Effects-style "Deep Glow": a sharp core plus a wide, non-linear light bleed, with saturated glow color and built-in Reinhard tonemapping so the HDR falloff never clips to flat white.',
  inputs: {
    d:            { type: 'float', label: 'SDF' },
    color:        { type: 'vec3',  label: 'Color' },
    intensity:    { type: 'float', label: 'Intensity' },
    radius:       { type: 'float', label: 'Radius' },
    saturation:   { type: 'float', label: 'Saturation' },
    edgeSoftness: { type: 'float', label: 'Edge Softness' },
  },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: { intensity: 1.5, radius: 0.08, saturation: 1.2, edgeSoftness: 0.01 },
  paramDefs: {
    intensity:    { label: 'Intensity',     type: 'float', min: 0.0,  max: 5.0,  step: 0.05 },
    radius:       { label: 'Radius',        type: 'float', min: 0.01, max: 4.0,  step: 0.01, hint: 'Distance units, not pixels — scale to whatever feeds SDF. A raw SDF is usually 0.02–0.3; a raw scalar Field (e.g. Chladni) can need 1–4 for a visible bleed.' },
    saturation:   { label: 'Saturation',    type: 'float', min: 1.0,  max: 3.0,  step: 0.05 },
    edgeSoftness: { label: 'Edge Softness', type: 'float', min: 0.0,  max: 0.2,  step: 0.005 },
  },
  glslFunction: `
vec3 deep_glow(float d, vec3 baseColor, float intensity, float radius, float saturation, float edgeSoftness) {
    // Sharp core (1 inside the shape, 0 at/past the edge)
    float core = smoothstep(edgeSoftness, 0.0, d);
    // Non-linear inverse-square falloff — sharp inner halo, soft far-reaching bleed
    float glow = intensity / pow(max(d, 0.0) / max(radius, 0.0001) + 1.0, 2.0);
    // Hyper-saturate the bleed color relative to the core color
    vec3 glowColor = pow(max(baseColor, vec3(0.0)), vec3(saturation));
    vec3 hdrColor = (baseColor * core) + (glowColor * glow);
    // Reinhard tonemap — rolls off HDR values instead of clipping to white
    return hdrColor / (hdrColor + vec3(1.0));
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    // No SDF wired — treat as "fully inside the shape everywhere" (d = 0) rather
    // than "far outside" (which would make core/glow collapse to ~nothing), so a
    // bare Color input still gets the full saturated-HDR + tonemap treatment.
    const dVar = inputVars.d         || '0.0';
    const cVar = inputVars.color     || 'vec3(1.0)';
    const iVar = inputVars.intensity    || p(node.params.intensity, 1.5);
    const rVar = inputVars.radius       || p(node.params.radius, 0.08);
    const sVar = inputVars.saturation   || p(node.params.saturation, 1.2);
    const eVar = inputVars.edgeSoftness || p(node.params.edgeSoftness, 0.01);
    return {
      code: `    vec3 ${id}_result = deep_glow(${dVar}, ${cVar}, ${iVar}, ${rVar}, ${sVar}, ${eVar});\n`,
      outputVars: { result: `${id}_result` },
    };
  },
};

/**
 * One pixel of anti-aliasing for an SDF edge ("Crisp").
 *
 * fwidth(d) is how much the distance changes from one pixel to the next, which for a smooth
 * SDF is one pixel's worth of distance: the right width to soften the edge over. But where the
 * distance JUMPS — a cell border in a grid, or a block border after Pixelate, where the pixels on
 * either side measure different shapes (or the same shape from different cell centres) — the GPU's
 * 2×2 pixel quad straddles the border and fwidth measures the jump instead. Softening by a jump
 * that big paints half-strength fill on every border pixel whose distance is smaller than the
 * jump: faint 1-px lines along cell edges next to filled cells.
 *
 * A real SDF can't change by much more than a pixel per pixel, so a change several pixels big is a
 * jump. There the edge is drawn crisp (one pixel of the picture's coordinates): each pixel keeps
 * its own cell's value, which is exactly what a flat cell should look like. `px` is one pixel in
 * the standard picture coordinates (top 1, bottom −1); jumps are anything over 4 of them, so
 * coordinates scaled up a few times still get their full fwidth anti-aliasing.
 */
export function sdfPixelAA(id: string, dVar: string): string {
  return `    float ${id}_fw = fwidth(${dVar});\n`
    + `    float ${id}_px = 2.0 / max(u_resolution.y, 1.0);\n`
    + `    float ${id}_aa = max(${id}_fw > 4.0 * ${id}_px ? ${id}_px : ${id}_fw, 0.00001);\n`;
}

export const SDFFillNode: NodeDefinition = {
  type: 'sdfFill',
  label: 'SDF Fill',
  aliases: ['SDF Outline', 'Fill', 'Stroke'],
  category: 'SDF', subcategory: 'Style',
  description: 'Paints a shape from its SDF: the inside takes the `Fill` colour, an optional `Stroke` runs along the edge, and everything else stays the `Background`. `Softness` blurs both sides of the fill edge and the stroke alike; `Stroke Align` puts the stroke on the line, just inside it, or just outside.',
  inputs: {
    d:           { type: 'float', label: 'SDF', hint: 'Signed distance: negative inside the shape.' },
    fillColor:   { type: 'vec3',  label: 'Fill', hint: 'Colour inside the shape.' },
    strokeColor: { type: 'vec3',  label: 'Stroke', hint: 'Colour of the edge line. Set Stroke Width to 0 for no stroke.' },
    background:  { type: 'vec3',  label: 'Background', hint: 'Colour outside the shape. Black when empty; use the Alpha output to composite instead.' },
    strokeWidth: { type: 'float', label: 'Stroke Width' },
    antialias:   { type: 'float', label: 'Softness' },
  },
  outputs: {
    result: { type: 'vec3', label: 'Color' },
    alpha:  { type: 'float', label: 'Alpha', hint: '1 on the fill and stroke, 0 on the background — for Alpha Blend or Mask.' },
  },
  defaultParams: { strokeWidth: 0.0, antialias: 0.005, strokeAlign: 'center', aaMode: 'pixel' },
  paramDefs: {
    strokeWidth: { label: 'Stroke Width', type: 'float', min: 0.0,   max: 0.2,   step: 0.001, hint: '0 draws no stroke.' },
    aaMode:      { label: 'Edge', type: 'select', options: [
      { value: 'pixel', label: 'Crisp (one pixel, any resolution)' },
      { value: 'fixed', label: 'Softness slider' },
    ], hint: 'Crisp anti-aliases by exactly one pixel using fwidth, so it looks right at every resolution. Softness lets you blur the edge by a fixed amount.' },
    antialias:   { label: 'Softness',     type: 'float', min: 0.001, max: 0.1,   step: 0.001, hint: 'How far the fill edge and the stroke fade, on both sides.', showWhen: { param: 'aaMode', value: 'fixed' } },
    strokeAlign: { label: 'Stroke Align', type: 'select', options: [
      { value: 'center',  label: 'Centred on the edge' },
      { value: 'inside',  label: 'Inside the edge' },
      { value: 'outside', label: 'Outside the edge' },
    ], hint: 'Where the stroke sits relative to the shape\'s edge.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const dVar  = inputVars.d           || '1.0';
    const fVar  = inputVars.fillColor   || 'vec3(1.0)';
    const sVar  = inputVars.strokeColor || 'vec3(0.0)';
    const bgVar = inputVars.background  || 'vec3(0.0)';
    const swVar = inputVars.strokeWidth || p(node.params.strokeWidth, 0.0);
    const pixelAA = node.params.aaMode !== 'fixed' && !inputVars.antialias;
    const aaVar = inputVars.antialias   || p(node.params.antialias, 0.005);
    const align = typeof node.params.strokeAlign === 'string' ? node.params.strokeAlign : 'center';
    // Signed distance to the stroke band: ≤ 0 inside the band
    const band = align === 'inside'  ? `max(${id}_d, -${id}_d - ${id}_sw)`
               : align === 'outside' ? `max(-${id}_d, ${id}_d - ${id}_sw)`
               :                       `abs(${id}_d) - ${id}_sw * 0.5`;
    return {
      code: [
        `    float ${id}_d  = ${dVar};\n`,
        `    float ${id}_sw = ${swVar};\n`,
        pixelAA ? sdfPixelAA(id, `${id}_d`) : `    float ${id}_aa = max(${aaVar}, 0.00001);\n`,
        `    float ${id}_fill   = 1.0 - smoothstep(-${id}_aa, ${id}_aa, ${id}_d);\n`,
        `    float ${id}_stroke = (1.0 - smoothstep(-${id}_aa, ${id}_aa, ${band})) * step(0.000001, ${id}_sw);\n`,
        `    vec3  ${id}_result = mix(mix(${bgVar}, ${fVar}, ${id}_fill), ${sVar}, ${id}_stroke);\n`,
        `    float ${id}_alpha  = max(${id}_fill, ${id}_stroke);\n`,
      ].join(''),
      outputVars: { result: `${id}_result`, alpha: `${id}_alpha` },
    };
  },
};

// ── Alpha Blend Node ─────────────────────────────────────────────────────────

export const AlphaBlendNode: NodeDefinition = {
  type: 'alphaBlend',
  label: 'Alpha Blend',
  category: 'Combiners',
  description: "Composites a top RGBA layer over bottom using correct alpha composition. Fixes the GLSL mix() alpha bug. Mode 'corrected' = GIMP-style (recommended).",
  inputs: {
    bottom:   { type: 'vec3',  label: 'Bottom Color' },
    top:      { type: 'vec3',  label: 'Top Color'    },
    bottom_a: { type: 'float', label: 'Bottom Alpha' },
    top_a:    { type: 'float', label: 'Top Alpha'    },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
  },
  defaultParams: { blend_mode: 'corrected' },
  paramDefs: {
    blend_mode: {
      label: 'Blend Mode', type: 'select',
      options: [
        { value: 'corrected', label: 'Corrected (GIMP)' },
        { value: 'naive',     label: 'Naive'            },
        { value: 'additive',  label: 'Additive'         },
        { value: 'multiply',  label: 'Multiply'         },
      ],
    },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const bottomV  = inputVars.bottom   || 'vec3(0.0)';
    const topV     = inputVars.top      || 'vec3(0.0)';
    const bottomA  = inputVars.bottom_a || '0.0';
    const topA     = inputVars.top_a    || '0.0';
    const mode     = (node.params.blend_mode as string) ?? 'corrected';
    let colorCode: string;
    let alphaCode: string;
    switch (mode) {
      case 'naive':
        colorCode = `mix(${bottomV}, ${topV}, ${topA})`;
        alphaCode = `mix(${bottomA}, 1.0, ${topA})`;
        break;
      case 'additive':
        colorCode = `${bottomV} + ${topV} * ${topA}`;
        alphaCode = `min(${bottomA} + ${topA}, 1.0)`;
        break;
      case 'multiply':
        colorCode = `${bottomV} * ${topV}`;
        alphaCode = `${bottomA} * ${topA}`;
        break;
      default: { // corrected
        colorCode = `mix(${bottomV}, ${topV}, ${topA})`;
        alphaCode = `mix(${bottomA}, min(${topA} + ${bottomA}, 1.0), ${topA})`;
        break;
      }
    }
    return {
      code: [
        `    vec3  ${id}_color = ${colorCode};\n`,
        `    float ${id}_alpha = ${alphaCode};\n`,
      ].join(''),
      outputVars: { color: `${id}_color`, alpha: `${id}_alpha` },
    };
  },
};

// ── Point Light 2D Node ──────────────────────────────────────────────────────

export const Light2DNode: NodeDefinition = {
  type: 'light2d',
  label: 'Point Light 2D',
  category: 'Effects',
  description: '2D point light with falloff models. Connect UV as the pixel position and Light Pos as the light’s centre. Combine multiple lights with Add. Multiply combined light by scene color.',
  inputs: {
    uv:        { type: 'vec2',  label: 'UV'         },
    light_pos: { type: 'vec2',  label: 'Light Pos'  },
    color:     { type: 'vec3',  label: 'Color'      },
    intensity: { type: 'float', label: 'Intensity'  },
    radius:    { type: 'float', label: 'Radius'     },
    sdf_dist:  { type: 'float', label: 'SDF Dist'   },
  },
  outputs: {
    light:   { type: 'vec3',  label: 'Light'   },
    falloff: { type: 'float', label: 'Falloff' },
    dist:    { type: 'float', label: 'Dist'    },
  },
  defaultParams: {
    falloff_model: 'squared',
    intensity:     1.0,
    radius:        2.0,
    gamma_correct: 'false',
  },
  paramDefs: {
    falloff_model: {
      label: 'Falloff Model', type: 'select',
      options: [
        { value: 'squared', label: 'Squared (physical)' },
        { value: 'inverse', label: 'Inverse'            },
        { value: 'linear',  label: 'Linear'             },
      ],
    },
    intensity:     { label: 'Intensity', type: 'float', min: 0.0,  max: 10.0, step: 0.05 },
    radius:        { label: 'Radius',    type: 'float', min: 0.1,  max: 20.0, step: 0.1  },
    gamma_correct: { label: 'Gamma',     type: 'select', options: [
      { value: 'false', label: 'Off' },
      { value: 'true',  label: 'On'  },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uvVar   = inputVars.uv        || 'vec2(0.0)';
    const posVar  = inputVars.light_pos || 'vec2(0.0)';
    const colVar  = inputVars.color     || 'vec3(1.0)';
    const iVar    = inputVars.intensity || p(node.params.intensity, 1.0);
    const rVar    = inputVars.radius    || p(node.params.radius, 2.0);
    const model   = (node.params.falloff_model as string) ?? 'squared';
    const gamma   = (node.params.gamma_correct as string) ?? 'false';
    // If sdf_dist is connected, use it; otherwise compute length
    const distExpr = inputVars.sdf_dist
      ? inputVars.sdf_dist
      : `length(${uvVar} - ${posVar})`;
    let falloffExpr: string;
    switch (model) {
      case 'inverse':
        falloffExpr = gamma === 'true'
          ? `${iVar} * pow(1.0 / max(${id}_dist, 0.001), 1.0/2.2)`
          : `${iVar} / max(${id}_dist, 0.001)`;
        break;
      case 'linear':
        falloffExpr = `${iVar} * max(1.0 - ${id}_dist * ${rVar}, 0.0)`;
        break;
      default: // squared
        falloffExpr = `${iVar} * pow(max(1.0 - ${id}_dist * ${rVar}, 0.0), 2.0)`;
        break;
    }
    return {
      code: [
        `    float ${id}_dist    = ${distExpr};\n`,
        `    float ${id}_falloff = ${falloffExpr};\n`,
        `    vec3  ${id}_light   = ${colVar} * ${id}_falloff;\n`,
      ].join(''),
      outputVars: { light: `${id}_light`, falloff: `${id}_falloff`, dist: `${id}_dist` },
    };
  },
};

export const SDFColorizeNode: NodeDefinition = {
  type: 'sdfColorize',
  label: 'SDF Colorize',
  category: 'SDF', subcategory: 'Style',
  description: 'Turn a raw SDF float into a visualized color — fills inside with one color, outside with another, anti-aliased edge. Good for quickly visualizing any distance field.',
  inputs: {
    d:       { type: 'float', label: 'SDF' },
    inside:  { type: 'vec3',  label: 'Inside Color' },
    outside: { type: 'vec3',  label: 'Outside Color' },
    edge:    { type: 'float', label: 'Edge Softness' },
  },
  outputs: { result: { type: 'vec3', label: 'Color' } },
  defaultParams: { edge: 0.01 },
  paramDefs: {
    edge: { label: 'Edge Softness', type: 'float', min: 0.001, max: 0.1, step: 0.001 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const dVar    = inputVars.d       || '0.0';
    const inVar   = inputVars.inside  || 'vec3(1.0)';
    const outVar2 = inputVars.outside || 'vec3(0.0)';
    const eVar    = inputVars.edge    || p(node.params.edge, 0.01);
    return {
      code: [
        `    float ${id}_t = smoothstep(-${eVar}, ${eVar}, ${dVar});\n`,
        `    vec3 ${id}_result = mix(${inVar}, ${outVar2}, ${id}_t);\n`,
      ].join(''),
      outputVars: { result: `${id}_result` },
    };
  },
};
