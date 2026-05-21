import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// Shared GLSL helpers for texture-based bitmap font rendering.
// u_fontTexture is a 1024×1024 canvas texture with a 16×16 grid of ASCII chars
// (64px×64px per cell), generated at startup and always available as a uniform.
//
// ssChar(localU, localV, id):
//   localU ∈ [0,1] left→right within the character cell
//   localV ∈ [0,1] bottom→top within the character cell
//   id     = ASCII code as float (32.0-126.0)
// Returns a [0,1] coverage value sampled from u_fontTexture.
export const PRINT_FLOAT_GLSL = `
float ssChar(float localU, float localV, float id) {
    vec2 cell = vec2(mod(id, 16.0), 15.0 - floor(id / 16.0));
    vec2 uv   = (vec2(localU, localV) + cell) / 16.0;
    vec2 b    = step(0.0, vec2(localU, localV)) * (1.0 - step(1.0, vec2(localU, localV)));
    return texture2D(u_fontTexture, uv).r * b.x * b.y;
}

float ssPrintFloat(vec2 uv, vec2 origin, float charH, float value, int decimals) {
    float charW = charH * 0.56;
    float gap   = charH * 0.04;
    float adv   = charW + gap;

    float py = (uv.y - origin.y) / charH;
    if (py < 0.0 || py >= 1.0) return 0.0;

    float xOff  = uv.x - origin.x;
    float result = 0.0;
    float cursor = 0.0;

    bool  negative = value < 0.0;
    float absVal   = abs(value);

    if (negative) {
        result = max(result, ssChar((xOff - cursor * adv) / charW, py, 45.0));
        cursor += 1.0;
    }

    float ipart = floor(absVal);
    int   nInt  = (ipart < 1.0) ? 1 : (int(floor(log(ipart + 0.5) / log(10.0))) + 1);
    for (int d = 0; d < 6; d++) {
        if (d >= nInt) break;
        float place = pow(10.0, float(nInt - 1 - d));
        float digit = mod(floor(absVal / place), 10.0);
        result = max(result, ssChar((xOff - (cursor + float(d)) * adv) / charW, py, 48.0 + digit));
    }
    cursor += float(nInt);

    if (decimals > 0) {
        result = max(result, ssChar((xOff - cursor * adv) / charW, py, 46.0));
        cursor += 1.0;

        float fpart = absVal - ipart;
        for (int d = 0; d < 4; d++) {
            if (d >= decimals) break;
            fpart *= 10.0;
            float digit = mod(floor(fpart), 10.0);
            result = max(result, ssChar((xOff - (cursor + float(d)) * adv) / charW, py, 48.0 + digit));
        }
    }

    return clamp(result, 0.0, 1.0);
}`;

export const PrintFloatNode: NodeDefinition = {
  type: 'printFloat',
  label: 'Print Float',
  category: 'Utility',
  description: 'Renders a float value as bitmap text on the canvas. Output is a 0/1 mask — wire into a Mix or Blend node with your desired text color.',

  inputs: {
    uv:    { type: 'vec2',  label: 'UV' },
    value: { type: 'float', label: 'Value' },
    pos:   { type: 'vec2',  label: 'Position' },
  },

  outputs: {
    mask: { type: 'float', label: 'Text Mask' },
  },

  defaultParams: {
    posX:     0.0,
    posY:     0.0,
    charSize: 0.08,
    decimals: 2,
  },

  paramDefs: {
    posX:     { label: 'X',        type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    posY:     { label: 'Y',        type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    charSize: { label: 'Size',     type: 'float', min: 0.01, max: 0.5, step: 0.005 },
    decimals: { label: 'Decimals', type: 'float', min: 0,   max: 4,   step: 1 },
  },

  glslFunction: PRINT_FLOAT_GLSL,

  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const uvVar    = inputVars.uv    ?? '(vUv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0) * 2.0';
    const valueVar = inputVars.value ?? '0.0';
    const px       = p(node.params.posX,     0.0);
    const py       = p(node.params.posY,     0.0);
    const posVar   = inputVars.pos   ?? `vec2(${px}, ${py})`;
    const sizeVar  = p(node.params.charSize, 0.08);
    const decVar   = p(node.params.decimals, 2);
    const outVar   = `${id}_mask`;

    return {
      code: `    float ${outVar} = ssPrintFloat(${uvVar}, ${posVar}, ${sizeVar}, ${valueVar}, int(${decVar}));\n`,
      outputVars: { mask: outVar },
    };
  },
};

export const PrintTextNode: NodeDefinition = {
  type: 'printText',
  label: 'Print Text',
  category: 'Utility',
  description: 'Renders a static string as bitmap text using the built-in font texture. Full ASCII 32–126. Output is a 0/1 mask — multiply by a color to tint.',

  inputs: {
    uv:  { type: 'vec2', label: 'UV' },
    pos: { type: 'vec2', label: 'Position' },
  },

  outputs: {
    mask: { type: 'float', label: 'Text Mask' },
  },

  defaultParams: {
    text:     'hello',
    posX:     0.0,
    posY:     0.0,
    charSize: 0.08,
  },

  paramDefs: {
    text:     { label: 'Text',     type: 'string' },
    posX:     { label: 'X',        type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    posY:     { label: 'Y',        type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    charSize: { label: 'Size',     type: 'float', min: 0.01, max: 0.5, step: 0.005 },
  },

  glslFunction: PRINT_FLOAT_GLSL,

  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uvExpr  = inputVars.uv  ?? '(vUv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0) * 2.0';
    const px      = p(node.params.posX,     0.0);
    const py      = p(node.params.posY,     0.0);
    const posExpr = inputVars.pos ?? `vec2(${px}, ${py})`;
    const size    = p(node.params.charSize, 0.08);
    const text    = typeof node.params.text === 'string' ? node.params.text : '';
    const outVar  = `${id}_mask`;

    const charW = `${id}_cW`;
    const adv   = `${id}_adv`;
    const rowV  = `${id}_py`;
    const xOff  = `${id}_xO`;

    const charLines = text.split('').map((ch, i) => {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) return '';
      return `        ${outVar} = max(${outVar}, ssChar((${xOff} - ${i}.0 * ${adv}) / ${charW}, ${rowV}, ${code}.0));`;
    }).filter(Boolean).join('\n');

    return {
      code: `
    float ${charW} = ${size} * 0.56;
    float ${adv}   = ${charW} + ${size} * 0.04;
    float ${rowV}  = ((${uvExpr}).y - (${posExpr}).y) / ${size};
    float ${outVar} = 0.0;
    if (${rowV} >= 0.0 && ${rowV} < 1.0) {
        float ${xOff} = (${uvExpr}).x - (${posExpr}).x;
${charLines}
    }\n`,
      outputVars: { mask: outVar },
    };
  },
};
