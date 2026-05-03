import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ── Grid UV ────────────────────────────────────────────────────────────────────

export const GridUVNode: NodeDefinition = {
  type: 'gridUV',
  label: 'Grid UV',
  category: 'Halftone',
  description: 'Tile UV space into a grid of cells. Returns per-cell UV (0→1) and integer cell index. Enable Stagger to offset every other row by half a cell for denser packing.',
  inputs: {
    uv:    { type: 'vec2',  label: 'UV' },
    scale: { type: 'float', label: 'Scale' },
  },
  outputs: {
    cellUV:    { type: 'vec2', label: 'Cell UV' },
    cellIndex: { type: 'vec2', label: 'Cell Index' },
  },
  defaultParams: { scale: 12.0, stagger: 0 },
  paramDefs: {
    scale:   { label: 'Scale',        type: 'float', min: 1.0, max: 80.0, step: 0.5 },
    stagger: { label: 'Stagger rows', type: 'bool' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const uvVar    = inputVars.uv    || 'vec2(0.5)';
    const scaleVar = inputVars.scale || p(node.params.scale, 12.0);
    const staggerP = p(node.params.stagger, 0);
    return {
      code: [
        `    float ${id}_sOdd = step(0.5, ${staggerP}) * mod(floor(${uvVar}.y * ${scaleVar}), 2.0);\n`,
        `    vec2  ${id}_sUV = ${uvVar} + vec2(${id}_sOdd * (0.5 / ${scaleVar}), 0.0);\n`,
        `    vec2  ${id}_cellUV    = fract(${id}_sUV * ${scaleVar});\n`,
        `    vec2  ${id}_cellIndex = floor(${id}_sUV * ${scaleVar});\n`,
      ].join(''),
      outputVars: { cellUV: `${id}_cellUV`, cellIndex: `${id}_cellIndex` },
    };
  },
};

// ── Pixelate ───────────────────────────────────────────────────────────────────

export const PixelateNode: NodeDefinition = {
  type: 'pixelate',
  label: 'Pixelate',
  category: 'Halftone',
  description: 'Snap UV coordinates to a pixel grid using floor. Feeds a matching pixelated UV into texture nodes so each grid cell samples a single flat color — the key step for applying halftone over an image.',
  inputs: {
    uv:        { type: 'vec2',  label: 'UV' },
    pixelSize: { type: 'float', label: 'Pixel Size' },
  },
  outputs: {
    uv: { type: 'vec2', label: 'Pixelated UV' },
  },
  defaultParams: { pixelSize: 0.05 },
  paramDefs: {
    pixelSize: { label: 'Pixel Size', type: 'float', min: 0.005, max: 0.25, step: 0.005 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uvVar   = inputVars.uv        || 'vec2(0.5)';
    const sizeVar = inputVars.pixelSize || p(node.params.pixelSize, 0.05);
    return {
      code: `    vec2 ${id}_uv = floor(${uvVar} / ${sizeVar}) * ${sizeVar};\n`,
      outputVars: { uv: `${id}_uv` },
    };
  },
};

// ── Dot Mask ───────────────────────────────────────────────────────────────────

export const DotMaskNode: NodeDefinition = {
  type: 'dotMask',
  label: 'Dot Mask',
  category: 'Halftone',
  description: 'Generate a circular dot mask within a grid cell. Returns 1 inside the dot, 0 outside. Wire cellUV from a Grid UV node. Modulate Radius with a Luma Radius node to make dots grow with brightness.',
  inputs: {
    cellUV:   { type: 'vec2',  label: 'Cell UV' },
    radius:   { type: 'float', label: 'Radius' },
    softness: { type: 'float', label: 'Softness' },
  },
  outputs: {
    mask: { type: 'float', label: 'Mask' },
  },
  defaultParams: { radius: 0.38, softness: 0.01 },
  paramDefs: {
    radius:   { label: 'Radius',   type: 'float', min: 0.0, max: 0.7,  step: 0.01  },
    softness: { label: 'Softness', type: 'float', min: 0.0, max: 0.1,  step: 0.005 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const cellVar = inputVars.cellUV   || 'vec2(0.5)';
    const radVar  = inputVars.radius   || p(node.params.radius,   0.38);
    const softVar = inputVars.softness || p(node.params.softness, 0.01);
    return {
      code: [
        `    float ${id}_dist = length(${cellVar} - 0.5);\n`,
        `    float ${id}_mask = 1.0 - smoothstep(${radVar} - ${softVar}, ${radVar} + ${softVar}, ${id}_dist);\n`,
      ].join(''),
      outputVars: { mask: `${id}_mask` },
    };
  },
};

// ── SDF Mask ───────────────────────────────────────────────────────────────────

export const SdfMaskNode: NodeDefinition = {
  type: 'sdfMask',
  label: 'SDF Mask',
  category: 'Halftone',
  description: 'Threshold any float SDF value into a 0/1 mask via smoothstep. Connect any SDF node (Ring, Box, Shape…) to the SDF input to use custom shapes as halftone dots.',
  inputs: {
    sdf:       { type: 'float', label: 'SDF' },
    threshold: { type: 'float', label: 'Threshold' },
    softness:  { type: 'float', label: 'Softness' },
  },
  outputs: {
    mask: { type: 'float', label: 'Mask' },
  },
  defaultParams: { threshold: 0.07, softness: 0.01 },
  paramDefs: {
    threshold: { label: 'Threshold', type: 'float', min: -0.5, max: 1.0, step: 0.005 },
    softness:  { label: 'Softness',  type: 'float', min: 0.0,  max: 0.1, step: 0.005 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const sdfVar  = inputVars.sdf       || '0.0';
    const thrVar  = inputVars.threshold || p(node.params.threshold, 0.07);
    const softVar = inputVars.softness  || p(node.params.softness,  0.01);
    return {
      code: `    float ${id}_mask = 1.0 - smoothstep(${thrVar} - ${softVar}, ${thrVar} + ${softVar}, ${sdfVar});\n`,
      outputVars: { mask: `${id}_mask` },
    };
  },
};

// ── Luma Radius ────────────────────────────────────────────────────────────────

export const LumaRadiusNode: NodeDefinition = {
  type: 'lumaRadius',
  label: 'Luma Radius',
  category: 'Halftone',
  description: 'Scale a dot radius by the luminance of a color — brighter pixels produce larger dots, recreating the classic halftone tonal illusion. Wire output into the Radius input of a Dot Mask node.',
  inputs: {
    color:      { type: 'vec3',  label: 'Color' },
    baseRadius: { type: 'float', label: 'Base Radius' },
  },
  outputs: {
    radius: { type: 'float', label: 'Radius' },
    luma:   { type: 'float', label: 'Luma' },
  },
  defaultParams: { baseRadius: 0.44, minScale: 0.05, maxScale: 0.95 },
  paramDefs: {
    baseRadius: { label: 'Base Radius', type: 'float', min: 0.1, max: 0.7, step: 0.01  },
    minScale:   { label: 'Min Scale',   type: 'float', min: 0.0, max: 1.0, step: 0.01  },
    maxScale:   { label: 'Max Scale',   type: 'float', min: 0.0, max: 1.0, step: 0.01  },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const colorVar = inputVars.color      || 'vec3(0.5)';
    const baseVar  = inputVars.baseRadius || p(node.params.baseRadius, 0.44);
    const minVar   = p(node.params.minScale,  0.05);
    const maxVar   = p(node.params.maxScale,  0.95);
    return {
      code: [
        `    float ${id}_luma   = dot(vec3(0.2126, 0.7152, 0.0722), clamp(${colorVar}, 0.0, 1.0));\n`,
        `    float ${id}_radius = ${baseVar} * (${minVar} + ${id}_luma * (${maxVar} - ${minVar}));\n`,
      ].join(''),
      outputVars: { radius: `${id}_radius`, luma: `${id}_luma` },
    };
  },
};

// ── RGB → CMYK ─────────────────────────────────────────────────────────────────

export const RGBToCMYKNode: NodeDefinition = {
  type: 'rgbToCMYK',
  label: 'RGB → CMYK',
  category: 'Halftone',
  description: 'Decompose an RGB color into its CMYK channels. Wire each float output into a separate Grid UV + Dot Mask chain (each at a different angle) to build a manual CMYK halftone.',
  inputs: {
    color: { type: 'vec3', label: 'RGB Color' },
  },
  outputs: {
    cmyk: { type: 'vec4',  label: 'CMYK' },
    c:    { type: 'float', label: 'Cyan' },
    m:    { type: 'float', label: 'Magenta' },
    y:    { type: 'float', label: 'Yellow' },
    k:    { type: 'float', label: 'Key (Black)' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const colorVar = inputVars.color || 'vec3(0.5)';
    return {
      code: [
        `    float ${id}_k    = 1.0 - max(max(${colorVar}.r, ${colorVar}.g), ${colorVar}.b);\n`,
        `    float ${id}_dn   = max(1.0 - ${id}_k, 0.0001);\n`,
        `    float ${id}_c    = clamp((1.0 - ${colorVar}.r - ${id}_k) / ${id}_dn, 0.0, 1.0);\n`,
        `    float ${id}_m    = clamp((1.0 - ${colorVar}.g - ${id}_k) / ${id}_dn, 0.0, 1.0);\n`,
        `    float ${id}_y    = clamp((1.0 - ${colorVar}.b - ${id}_k) / ${id}_dn, 0.0, 1.0);\n`,
        `    vec4  ${id}_cmyk = vec4(${id}_c, ${id}_m, ${id}_y, ${id}_k);\n`,
      ].join(''),
      outputVars: { cmyk: `${id}_cmyk`, c: `${id}_c`, m: `${id}_m`, y: `${id}_y`, k: `${id}_k` },
    };
  },
};

// ── CMYK Halftone ─────────────────────────────────────────────────────────────

export const CMYKHalftoneNode: NodeDefinition = {
  type: 'cmykHalftone',
  label: 'CMYK Halftone',
  category: 'Halftone',
  description: 'Full CMYK halftone effect. Decomposes the input color into C, M, Y, K channels and renders each as a rotated dot grid at the traditional screen angles (C=15°, M=75°, Y=0°, K=45°), then composites them subtractively on a paper color.',
  inputs: {
    color: { type: 'vec3', label: 'Color' },
    uv:    { type: 'vec2', label: 'UV' },
  },
  outputs: {
    result: { type: 'vec3', label: 'Result' },
  },
  defaultParams: {
    gridSize:   22.0,
    dotRadius:  0.48,
    softness:   0.01,
    paperColor: [0.97, 0.95, 0.90],
    angleC:     15.0,
    angleM:     75.0,
    angleY:      0.0,
    angleK:     45.0,
  },
  paramDefs: {
    gridSize:   { label: 'Grid Size',   type: 'float', min: 4.0,  max: 60.0, step: 1.0   },
    dotRadius:  { label: 'Dot Radius',  type: 'float', min: 0.1,  max: 0.65, step: 0.01  },
    softness:   { label: 'Softness',    type: 'float', min: 0.0,  max: 0.05, step: 0.005 },
    paperColor: { label: 'Paper Color', type: 'vec3color' },
    angleC:     { label: 'Angle C',     type: 'float', min: -90,  max: 90,   step: 1.0   },
    angleM:     { label: 'Angle M',     type: 'float', min: -90,  max: 90,   step: 1.0   },
    angleY:     { label: 'Angle Y',     type: 'float', min: -90,  max: 90,   step: 1.0   },
    angleK:     { label: 'Angle K',     type: 'float', min: -90,  max: 90,   step: 1.0   },
  },
  glslFunctions: [
`vec2 cmykHT_rot(vec2 uv, float a) {
  float s = sin(a); float c = cos(a);
  vec2 q = uv - 0.5;
  return vec2(c*q.x - s*q.y, s*q.x + c*q.y) + 0.5;
}`,
`float cmykHT_dot(vec2 uv, float ch, float gs, float r, float soft, float a) {
  vec2 cell = fract(cmykHT_rot(uv, a) * gs);
  float d = length(cell - 0.5);
  return 1.0 - smoothstep(r*ch - soft, r*ch + soft, d);
}`,
  ],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id        = node.id;
    const colorVar  = inputVars.color || 'vec3(0.5)';
    const uvVar     = inputVars.uv    || 'vec2(0.5)';
    const gsVar     = p(node.params.gridSize,  22.0);
    const rVar      = p(node.params.dotRadius, 0.48);
    const softVar   = p(node.params.softness,  0.01);
    const angleCVar = p(node.params.angleC, 15.0);
    const angleMVar = p(node.params.angleM, 75.0);
    const angleYVar = p(node.params.angleY,  0.0);
    const angleKVar = p(node.params.angleK, 45.0);
    const paperArr  = Array.isArray(node.params.paperColor)
      ? (node.params.paperColor as number[])
      : [0.97, 0.95, 0.90];
    const paperVar  = `vec3(${paperArr.map((n: number) => n.toFixed(3)).join(', ')})`;
    return {
      code: [
        `    float ${id}_k  = 1.0 - max(max(${colorVar}.r, ${colorVar}.g), ${colorVar}.b);\n`,
        `    float ${id}_dn = max(1.0 - ${id}_k, 0.0001);\n`,
        `    float ${id}_c  = clamp((1.0 - ${colorVar}.r - ${id}_k) / ${id}_dn, 0.0, 1.0);\n`,
        `    float ${id}_m  = clamp((1.0 - ${colorVar}.g - ${id}_k) / ${id}_dn, 0.0, 1.0);\n`,
        `    float ${id}_y  = clamp((1.0 - ${colorVar}.b - ${id}_k) / ${id}_dn, 0.0, 1.0);\n`,
        `    vec3 ${id}_result = ${paperVar};\n`,
        `    ${id}_result *= mix(vec3(1.0), vec3(0.0, 1.0, 1.0), cmykHT_dot(${uvVar}, ${id}_c, ${gsVar}, ${rVar}, ${softVar}, radians(${angleCVar})));\n`,
        `    ${id}_result *= mix(vec3(1.0), vec3(1.0, 0.0, 1.0), cmykHT_dot(${uvVar}, ${id}_m, ${gsVar}, ${rVar}, ${softVar}, radians(${angleMVar})));\n`,
        `    ${id}_result *= mix(vec3(1.0), vec3(1.0, 1.0, 0.0), cmykHT_dot(${uvVar}, ${id}_y, ${gsVar}, ${rVar}, ${softVar}, radians(${angleYVar})));\n`,
        `    ${id}_result *= mix(vec3(1.0), vec3(0.0),           cmykHT_dot(${uvVar}, ${id}_k, ${gsVar}, ${rVar}, ${softVar}, radians(${angleKVar})));\n`,
      ].join(''),
      outputVars: { result: `${id}_result` },
    };
  },
};
