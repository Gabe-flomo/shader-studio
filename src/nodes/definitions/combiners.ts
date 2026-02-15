import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f } from './helpers';

// ── Basic SDF combiners ───────────────────────────────────────────────────────

export const SmoothMinNode: NodeDefinition = {
  type: 'smoothMin',
  label: 'Smooth Min',
  category: 'Combiners',
  description: 'Smooth minimum of two SDF values — merges two shapes with a rounded blend seam. K controls how wide the blend zone is.',
  inputs: {
    a: { type: 'float', label: 'A' },
    b: { type: 'float', label: 'B' },
    smoothness: { type: 'float', label: 'Smoothness' },
  },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { smoothness: 0.5 },
  paramDefs: {
    smoothness: { label: 'Smoothness', type: 'float', min: 0.01, max: 2, step: 0.01 },
  },
  glslFunction: `
float smin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * h * k * (1.0 / 6.0);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_result`;
    const aVar = inputVars.a || '0.0';
    const bVar = inputVars.b || '0.0';
    const kVar = inputVars.smoothness || f(typeof node.params.smoothness === 'number' ? node.params.smoothness : 0.5);
    return {
      code: `    float ${outVar} = smin(${aVar}, ${bVar}, ${kVar});\n`,
      outputVars: { result: outVar },
    };
  },
};

export const MinNode: NodeDefinition = {
  type: 'min',
  label: 'Min (Union)',
  category: 'Combiners',
  description: 'SDF union — minimum of two distance fields. Combines two shapes into one.',
  inputs: {
    a: { type: 'float', label: 'A' },
    b: { type: 'float', label: 'B' },
  },
  outputs: { result: { type: 'float', label: 'Result' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_result`;
    return {
      code: `    float ${outVar} = min(${inputVars.a || '0.0'}, ${inputVars.b || '0.0'});\n`,
      outputVars: { result: outVar },
    };
  },
};

// ── New SDF combiners ─────────────────────────────────────────────────────────

export const MaxNode2: NodeDefinition = {
  type: 'sdfMax',
  label: 'Max (Intersect)',
  category: 'Combiners',
  description: 'SDF intersection — maximum of two distance fields. Keeps only the region where both shapes overlap.',
  inputs: {
    a: { type: 'float', label: 'A' },
    b: { type: 'float', label: 'B' },
  },
  outputs: { result: { type: 'float', label: 'Result' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_result`;
    return {
      code: `    float ${outVar} = max(${inputVars.a || '0.0'}, ${inputVars.b || '0.0'});\n`,
      outputVars: { result: outVar },
    };
  },
};

export const SubtractNode2: NodeDefinition = {
  type: 'sdfSubtract',
  label: 'Subtract (Cut)',
  category: 'Combiners',
  description: 'SDF subtraction — cuts shape B out of shape A. Result is max(A, -B).',
  inputs: {
    a: { type: 'float', label: 'Shape' },
    b: { type: 'float', label: 'Cutter' },
  },
  outputs: { result: { type: 'float', label: 'Result' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_result`;
    return {
      code: `    float ${outVar} = max(${inputVars.a || '0.0'}, -(${inputVars.b || '0.0'}));\n`,
      outputVars: { result: outVar },
    };
  },
};

export const SmoothMaxNode: NodeDefinition = {
  type: 'smoothMax',
  label: 'Smooth Max',
  category: 'Combiners',
  description: 'Smooth intersection — blended maximum of two SDFs. Like Smooth Min but keeps the overlap region with a soft edge.',
  inputs: {
    a: { type: 'float', label: 'A' },
    b: { type: 'float', label: 'B' },
    smoothness: { type: 'float', label: 'Smoothness' },
  },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { smoothness: 0.3 },
  paramDefs: {
    smoothness: { label: 'Smoothness', type: 'float', min: 0.01, max: 2, step: 0.01 },
  },
  glslFunction: `
float smax(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return max(a, b) + h * h * h * k * (1.0 / 6.0);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_result`;
    const kVar = inputVars.smoothness || f(typeof node.params.smoothness === 'number' ? node.params.smoothness : 0.3);
    return {
      code: `    float ${outVar} = smax(${inputVars.a || '0.0'}, ${inputVars.b || '0.0'}, ${kVar});\n`,
      outputVars: { result: outVar },
    };
  },
};

export const SmoothSubtractNode: NodeDefinition = {
  type: 'smoothSubtract',
  label: 'Smooth Subtract',
  category: 'Combiners',
  description: 'Smooth SDF subtraction — cuts shape B from A with a rounded chamfered edge.',
  inputs: {
    a: { type: 'float', label: 'Shape' },
    b: { type: 'float', label: 'Cutter' },
    smoothness: { type: 'float', label: 'Smoothness' },
  },
  outputs: { result: { type: 'float', label: 'Result' } },
  defaultParams: { smoothness: 0.3 },
  paramDefs: {
    smoothness: { label: 'Smoothness', type: 'float', min: 0.01, max: 2, step: 0.01 },
  },
  glslFunction: `
float ssubtract(float a, float b, float k) {
    float h = max(k - abs(-b - a), 0.0) / k;
    return max(a, -b) + h * h * h * k * (1.0 / 6.0);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_result`;
    const kVar = inputVars.smoothness || f(typeof node.params.smoothness === 'number' ? node.params.smoothness : 0.3);
    return {
      code: `    float ${outVar} = ssubtract(${inputVars.a || '0.0'}, ${inputVars.b || '0.0'}, ${kVar});\n`,
      outputVars: { result: outVar },
    };
  },
};

// ── Color / value combiners ───────────────────────────────────────────────────

export const BlendNode: NodeDefinition = {
  type: 'blend',
  label: 'Blend',
  category: 'Combiners',
  description: 'Blend two vec3 colors or values by a factor (0=A, 1=B). Wire an SDF or mask to Factor for shape-driven blending.',
  inputs: {
    a:      { type: 'vec3',  label: 'A' },
    b:      { type: 'vec3',  label: 'B' },
    factor: { type: 'float', label: 'Factor' },
  },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  defaultParams: { factor: 0.5 },
  paramDefs: {
    factor: { label: 'Factor', type: 'float', min: 0.0, max: 1.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar  = `${node.id}_result`;
    const aVar    = inputVars.a      || 'vec3(0.0)';
    const bVar    = inputVars.b      || 'vec3(1.0)';
    const tVar    = inputVars.factor || f(typeof node.params.factor === 'number' ? node.params.factor : 0.5);
    return {
      code: `    vec3 ${outVar} = mix(${aVar}, ${bVar}, clamp(${tVar}, 0.0, 1.0));\n`,
      outputVars: { result: outVar },
    };
  },
};

export const MaskNode: NodeDefinition = {
  type: 'mask',
  label: 'Mask',
  category: 'Combiners',
  description: 'Use a float SDF/mask to cut between two vec3 inputs. Threshold sets the cutoff; Edge Width softens it. Negative SDF values = inside = show A.',
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
    const tVar   = inputVars.threshold || f(typeof node.params.threshold === 'number' ? node.params.threshold : 0.0);
    const eVar   = inputVars.edge      || f(typeof node.params.edge      === 'number' ? node.params.edge      : 0.02);
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
    const sVar    = inputVars.scale || f(typeof node.params.scale === 'number' ? node.params.scale : 1.0);
    return {
      code: `    vec3 ${outVar} = ${aVar} + ${bVar} * ${sVar};\n`,
      outputVars: { result: outVar },
    };
  },
};

export const ScreenBlendNode: NodeDefinition = {
  type: 'screenBlend',
  label: 'Screen Blend',
  category: 'Combiners',
  description: 'Screen blend mode: 1-(1-A)*(1-B). Lightens without blowing out — perfect for layering glows and light effects.',
  inputs: {
    a: { type: 'vec3', label: 'A' },
    b: { type: 'vec3', label: 'B' },
  },
  outputs: { result: { type: 'vec3', label: 'Result' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_result`;
    const aVar   = inputVars.a || 'vec3(0.0)';
    const bVar   = inputVars.b || 'vec3(0.0)';
    return {
      code: `    vec3 ${outVar} = 1.0 - (1.0 - ${aVar}) * (1.0 - ${bVar});\n`,
      outputVars: { result: outVar },
    };
  },
};

// ── Compound / smart combiners ────────────────────────────────────────────────

export const GlowLayerNode: NodeDefinition = {
  type: 'glowLayer',
  label: 'Glow Layer',
  category: 'Combiners',
  description: 'The classic SDF glow pattern: intensity / |d|. Converts a signed distance field into a colored glow halo. Intensity controls brightness, Power sharpens the falloff.',
  inputs: {
    d:         { type: 'float', label: 'SDF' },
    color:     { type: 'vec3',  label: 'Color' },
    intensity: { type: 'float', label: 'Intensity' },
    power:     { type: 'float', label: 'Power' },
  },
  outputs: { result: { type: 'vec3', label: 'Glow' } },
  defaultParams: { intensity: 0.01, power: 1.0 },
  paramDefs: {
    intensity: { label: 'Intensity', type: 'float', min: 0.001, max: 0.2,  step: 0.001 },
    power:     { label: 'Power',     type: 'float', min: 0.1,   max: 4.0,  step: 0.05  },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const dVar    = inputVars.d         || '1.0';
    const cVar    = inputVars.color     || 'vec3(1.0)';
    const iVar    = inputVars.intensity || f(typeof node.params.intensity === 'number' ? node.params.intensity : 0.01);
    const pVar    = inputVars.power     || f(typeof node.params.power     === 'number' ? node.params.power     : 1.0);
    return {
      code: [
        `    float ${id}_g = pow(${iVar} / max(abs(${dVar}), 0.0001), ${pVar});\n`,
        `    vec3 ${id}_result = ${cVar} * ${id}_g;\n`,
      ].join(''),
      outputVars: { result: `${id}_result` },
    };
  },
};

export const SDFOutlineNode: NodeDefinition = {
  type: 'sdfOutline',
  label: 'SDF Outline',
  category: 'Combiners',
  description: 'Draws a colored filled shape + optional outline from a single SDF. Fill color inside, stroke color at the edge band, transparent outside.',
  inputs: {
    d:           { type: 'float', label: 'SDF' },
    fillColor:   { type: 'vec3',  label: 'Fill' },
    strokeColor: { type: 'vec3',  label: 'Stroke' },
    strokeWidth: { type: 'float', label: 'Stroke Width' },
    antialias:   { type: 'float', label: 'AA Width' },
  },
  outputs: { result: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
  defaultParams: { strokeWidth: 0.02, antialias: 0.005 },
  paramDefs: {
    strokeWidth: { label: 'Stroke Width', type: 'float', min: 0.0,   max: 0.2,   step: 0.001 },
    antialias:   { label: 'AA Width',     type: 'float', min: 0.001, max: 0.05,  step: 0.001 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const dVar = inputVars.d           || '1.0';
    const fVar = inputVars.fillColor   || 'vec3(1.0)';
    const sVar = inputVars.strokeColor || 'vec3(0.0)';
    const swVar= inputVars.strokeWidth || f(typeof node.params.strokeWidth === 'number' ? node.params.strokeWidth : 0.02);
    const aaVar= inputVars.antialias   || f(typeof node.params.antialias   === 'number' ? node.params.antialias   : 0.005);
    return {
      code: [
        `    float ${id}_fill   = 1.0 - smoothstep(-${aaVar}, ${aaVar}, ${dVar});\n`,
        `    float ${id}_stroke = (1.0 - smoothstep(-${aaVar}, ${aaVar}, abs(${dVar}) - ${swVar})) * (1.0 - ${id}_fill);\n`,
        `    vec3  ${id}_result = mix(${fVar}, ${sVar}, ${id}_stroke / max(${id}_fill + ${id}_stroke, 0.001));\n`,
        `    float ${id}_alpha  = clamp(${id}_fill + ${id}_stroke, 0.0, 1.0);\n`,
      ].join(''),
      outputVars: { result: `${id}_result`, alpha: `${id}_alpha` },
    };
  },
};

export const SDFColorizeNode: NodeDefinition = {
  type: 'sdfColorize',
  label: 'SDF Colorize',
  category: 'Combiners',
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
    const eVar    = inputVars.edge    || f(typeof node.params.edge === 'number' ? node.params.edge : 0.01);
    return {
      code: [
        `    float ${id}_t = smoothstep(-${eVar}, ${eVar}, ${dVar});\n`,
        `    vec3 ${id}_result = mix(${inVar}, ${outVar2}, ${id}_t);\n`,
      ].join(''),
      outputVars: { result: `${id}_result` },
    };
  },
};
