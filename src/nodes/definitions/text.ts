import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

export const PRINT_FLOAT_GLSL = `
// 5x7 bitmap font. enc.x = rows 0-3 (20 bits), enc.y = rows 4-6 (15 bits).
// Bit position within each half: col + row_within_half * 5
float ssBit(vec2 enc, float cx, float cy) {
    if (cx < 0.0 || cx >= 5.0 || cy < 0.0 || cy >= 7.0) return 0.0;
    float e   = (cy < 4.0) ? enc.x : enc.y;
    float row = (cy < 4.0) ? cy    : cy - 4.0;
    return floor(mod(e / pow(2.0, cx + row * 5.0), 2.0));
}

float ssChar(vec2 enc, vec2 p) {
    if (p.x < 0.0 || p.x >= 5.0 || p.y < 0.0 || p.y >= 7.0) return 0.0;
    vec2 pi = floor(p);
    vec2 pf = fract(p);
    float b00 = ssBit(enc, pi.x,       pi.y      );
    float b10 = ssBit(enc, pi.x + 1.0, pi.y      );
    float b01 = ssBit(enc, pi.x,       pi.y + 1.0);
    float b11 = ssBit(enc, pi.x + 1.0, pi.y + 1.0);
    vec2 t = smoothstep(0.1, 0.9, pf);
    return mix(mix(b00, b10, t.x), mix(b01, b11, t.x), t.y);
}

vec2 ssEncoding(int ch) {
    if (ch == 0)  return vec2( 575022.0,  14897.0);  // 0
    if (ch == 1)  return vec2( 135364.0,  14468.0);  // 1
    if (ch == 2)  return vec2( 410158.0,  31778.0);  // 2
    if (ch == 3)  return vec2( 934446.0,  14896.0);  // 3
    if (ch == 4)  return vec2( 305544.0,   8479.0);  // 4
    if (ch == 5)  return vec2( 539711.0,  14896.0);  // 5
    if (ch == 6)  return vec2( 492590.0,  14897.0);  // 6
    if (ch == 7)  return vec2( 139807.0,   2114.0);  // 7
    if (ch == 8)  return vec2( 476718.0,  14897.0);  // 8
    if (ch == 9)  return vec2(1001006.0,  14864.0);  // 9
    if (ch == 10) return vec2(1015808.0,     0.0);   // -
    if (ch == 11) return vec2(      0.0,   6336.0);  // .
    return vec2(0.0);
}

float ssPrintFloat(vec2 uv, vec2 origin, float charH, float value, int decimals) {
    float charW  = charH * (5.0 / 7.0);
    float gap    = charH * 0.1;
    float adv    = charW + gap;

    float py = (uv.y - origin.y) / charH;
    if (py < 0.0 || py >= 1.0) return 0.0;
    float glyphY = (1.0 - py) * 7.0;

    float xOff  = uv.x - origin.x;
    float result = 0.0;
    float cursor = 0.0;

    bool  negative = value < 0.0;
    float absVal   = abs(value);

    if (negative) {
        float glyphX = (xOff - cursor * adv) / charW * 5.0;
        result = max(result, ssChar(ssEncoding(10), vec2(glyphX, glyphY)));
        cursor += 1.0;
    }

    float ipart = floor(absVal);
    int   nInt  = (ipart < 1.0) ? 1 : (int(floor(log(ipart + 0.5) / log(10.0))) + 1);
    for (int d = 0; d < 6; d++) {
        if (d >= nInt) break;
        float place  = pow(10.0, float(nInt - 1 - d));
        int   digit  = int(mod(floor(absVal / place), 10.0));
        float glyphX = (xOff - (cursor + float(d)) * adv) / charW * 5.0;
        result = max(result, ssChar(ssEncoding(digit), vec2(glyphX, glyphY)));
    }
    cursor += float(nInt);

    if (decimals > 0) {
        float glyphX = (xOff - cursor * adv) / charW * 5.0;
        result = max(result, ssChar(ssEncoding(11), vec2(glyphX, glyphY)));
        cursor += 1.0;

        float fpart = absVal - ipart;
        for (int d = 0; d < 4; d++) {
            if (d >= decimals) break;
            fpart *= 10.0;
            int   digit   = int(mod(floor(fpart), 10.0));
            float glyphX2 = (xOff - (cursor + float(d)) * adv) / charW * 5.0;
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
