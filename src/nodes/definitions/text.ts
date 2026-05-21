import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

export const PRINT_FLOAT_GLSL = `
float ssChar(float enc, vec2 p) {
    if (p.x < 0.0 || p.x >= 4.0 || p.y < 0.0 || p.y >= 5.0) return 0.0;
    float bit = floor(p.x) + floor(p.y) * 4.0;
    return floor(mod(enc / pow(2.0, bit), 2.0));
}

float ssEncoding(int ch) {
    if (ch == 0)  return 480599.0;
    if (ch == 1)  return 736788.0;
    if (ch == 2)  return 476951.0;
    if (ch == 3)  return 476999.0;
    if (ch == 4)  return 350394.0;
    if (ch == 5)  return 459671.0;
    if (ch == 6)  return 460759.0;
    if (ch == 7)  return 272927.0;
    if (ch == 8)  return 481111.0;
    if (ch == 9)  return 481095.0;
    if (ch == 10) return 3584.0;
    if (ch == 11) return 262144.0;
    return 0.0;
}

float ssPrintFloat(vec2 uv, vec2 origin, float charH, float value, int decimals) {
    float charW  = charH * 0.6;
    float gap    = charH * 0.12;
    float adv    = charW + gap;

    // py in [0,1]: 0=bottom of char, 1=top of char (UV y increases upward)
    float py = (uv.y - origin.y) / charH;
    if (py < 0.0 || py >= 1.0) return 0.0;
    // Glyph row 0=top, row 4=bottom — flip py so top of screen = row 0
    float glyphY = (1.0 - py) * 5.0;

    float xOff  = uv.x - origin.x;
    float result = 0.0;
    float cursor = 0.0;

    bool  negative = value < 0.0;
    float absVal   = abs(value);

    if (negative) {
        float glyphX = (xOff - cursor * adv) / charW * 4.0;
        result = max(result, ssChar(ssEncoding(10), vec2(glyphX, glyphY)));
        cursor += 1.0;
    }

    float ipart = floor(absVal);
    int   nInt  = (ipart < 1.0) ? 1 : (int(floor(log(ipart + 0.5) / log(10.0))) + 1);
    for (int d = 0; d < 6; d++) {
        if (d >= nInt) break;
        float place  = pow(10.0, float(nInt - 1 - d));
        int   digit  = int(mod(floor(absVal / place), 10.0));
        float glyphX = (xOff - (cursor + float(d)) * adv) / charW * 4.0;
        result = max(result, ssChar(ssEncoding(digit), vec2(glyphX, glyphY)));
    }
    cursor += float(nInt);

    if (decimals > 0) {
        float glyphX = (xOff - cursor * adv) / charW * 4.0;
        result = max(result, ssChar(ssEncoding(11), vec2(glyphX, glyphY)));
        cursor += 1.0;

        float fpart = absVal - ipart;
        for (int d = 0; d < 4; d++) {
            if (d >= decimals) break;
            fpart *= 10.0;
            int   digit   = int(mod(floor(fpart), 10.0));
            float glyphX2 = (xOff - (cursor + float(d)) * adv) / charW * 4.0;
            result = max(result, ssChar(ssEncoding(digit), vec2(glyphX2, glyphY)));
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
    const decInt   = `int(${decVar})`;

    const outVar   = `${id}_mask`;
    return {
      code: `    float ${outVar} = ssPrintFloat(${uvVar}, ${posVar}, ${sizeVar}, ${valueVar}, ${decInt});\n`,
      outputVars: { mask: outVar },
    };
  },
};
