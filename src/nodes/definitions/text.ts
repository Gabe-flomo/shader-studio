import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// 5x7 bitmap font helpers shared by PrintFloat and PrintText.
// Encoding: enc.x = rows 0-3 (20 bits), enc.y = rows 4-6 (15 bits).
// Bit layout within each half: col + row_within_half * 5
// ssEncoding takes ASCII codes 32-126 directly.
export const PRINT_FLOAT_GLSL = `
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
    // ASCII 32-47
    if (ch == 32) return vec2(      0.0,      0.0);  // space
    if (ch == 33) return vec2( 135300.0,   4100.0);  // !
    if (ch == 34) return vec2(    330.0,      0.0);  // "
    if (ch == 35) return vec2(1027050.0,     10.0);  // #
    if (ch == 36) return vec2( 464836.0,   4596.0);  // $
    if (ch == 37) return vec2( 139875.0,  25378.0);  // %
    if (ch == 38) return vec2( 202022.0,  22837.0);  // &
    if (ch == 39) return vec2(   2180.0,      0.0);  // '
    if (ch == 40) return vec2(  33860.0,   4161.0);  // (
    if (ch == 41) return vec2( 540932.0,   4368.0);  // )
    if (ch == 42) return vec2( 480384.0,    149.0);  // *
    if (ch == 43) return vec2(1020032.0,    132.0);  // +
    if (ch == 44) return vec2(      0.0,   2182.0);  // ,
    if (ch == 45) return vec2(1015808.0,      0.0);  // -
    if (ch == 46) return vec2(      0.0,   6336.0);  // .
    if (ch == 47) return vec2( 139792.0,   1058.0);  // /
    // ASCII 48-57: digits 0-9
    if (ch == 48) return vec2( 575022.0,  14897.0);  // 0
    if (ch == 49) return vec2( 135364.0,  14468.0);  // 1
    if (ch == 50) return vec2( 410158.0,  31778.0);  // 2
    if (ch == 51) return vec2( 934446.0,  14896.0);  // 3
    if (ch == 52) return vec2( 305544.0,   8479.0);  // 4
    if (ch == 53) return vec2( 539711.0,  14896.0);  // 5
    if (ch == 54) return vec2( 492590.0,  14897.0);  // 6
    if (ch == 55) return vec2( 139807.0,   2114.0);  // 7
    if (ch == 56) return vec2( 476718.0,  14897.0);  // 8
    if (ch == 57) return vec2(1001006.0,  14864.0);  // 9
    // ASCII 58-64
    if (ch == 58) return vec2(   6336.0,    198.0);  // :
    if (ch == 59) return vec2(   6336.0,   2182.0);  // ;
    if (ch == 60) return vec2(  34952.0,   8322.0);  // <
    if (ch == 61) return vec2(  31744.0,     31.0);  // =
    if (ch == 62) return vec2( 532610.0,   2184.0);  // >
    if (ch == 63) return vec2( 279086.0,   4100.0);  // ?
    if (ch == 64) return vec2( 718382.0,  14397.0);  // @
    // ASCII 65-90: A-Z
    if (ch == 65) return vec2(1033774.0,  17969.0);  // A
    if (ch == 66) return vec2( 509487.0,  15921.0);  // B
    if (ch == 67) return vec2(  34350.0,  14881.0);  // C
    if (ch == 68) return vec2( 575023.0,  15921.0);  // D
    if (ch == 69) return vec2( 492607.0,  31777.0);  // E
    if (ch == 70) return vec2( 492607.0,   1057.0);  // F
    if (ch == 71) return vec2( 951854.0,  14897.0);  // G
    if (ch == 72) return vec2(1033777.0,  17969.0);  // H
    if (ch == 73) return vec2( 135327.0,  31876.0);  // I
    if (ch == 74) return vec2( 270623.0,   6440.0);  // J
    if (ch == 75) return vec2( 103729.0,  17701.0);  // K
    if (ch == 76) return vec2(  33825.0,  31777.0);  // L
    if (ch == 77) return vec2( 579441.0,  17969.0);  // M
    if (ch == 78) return vec2( 644913.0,  17969.0);  // N
    if (ch == 79) return vec2( 575022.0,  14897.0);  // O
    if (ch == 80) return vec2( 509487.0,   1057.0);  // P
    if (ch == 81) return vec2( 575022.0,  31349.0);  // Q
    if (ch == 82) return vec2( 509487.0,  17701.0);  // R
    if (ch == 83) return vec2( 460334.0,  14896.0);  // S
    if (ch == 84) return vec2( 135327.0,   4228.0);  // T
    if (ch == 85) return vec2( 575025.0,  14897.0);  // U
    if (ch == 86) return vec2( 575025.0,   4433.0);  // V
    if (ch == 87) return vec2( 706097.0,  18293.0);  // W
    if (ch == 88) return vec2( 141873.0,  17962.0);  // X
    if (ch == 89) return vec2( 141873.0,   4228.0);  // Y
    if (ch == 90) return vec2( 139807.0,  31778.0);  // Z
    // ASCII 91-96
    if (ch == 91) return vec2(  67662.0,  14402.0);  // [
    if (ch == 92) return vec2( 133153.0,  16904.0);  // backslash
    if (ch == 93) return vec2( 270606.0,  14600.0);  // ]
    if (ch == 94) return vec2(  17732.0,      0.0);  // ^
    if (ch == 95) return vec2(      0.0,  31744.0);  // _
    if (ch == 96) return vec2(    260.0,      0.0);  // backtick
    // ASCII 97-122: a-z
    if (ch == 97)  return vec2( 538624.0,  31294.0);  // a
    if (ch == 98)  return vec2( 572449.0,  15921.0);  // b
    if (ch == 99)  return vec2(  47104.0,  14369.0);  // c
    if (ch == 100) return vec2( 588304.0,  31281.0);  // d
    if (ch == 101) return vec2( 571392.0,  14399.0);  // e
    if (ch == 102) return vec2(  80972.0,   2114.0);  // f
    if (ch == 103) return vec2( 575424.0,  14878.0);  // g
    if (ch == 104) return vec2( 635937.0,  17969.0);  // h
    if (ch == 105) return vec2( 137220.0,  14468.0);  // i
    if (ch == 106) return vec2( 548880.0,  14896.0);  // j
    if (ch == 107) return vec2( 103713.0,  17701.0);  // k
    if (ch == 108) return vec2( 135302.0,  14468.0);  // l
    if (ch == 109) return vec2( 699392.0,  17973.0);  // m
    if (ch == 110) return vec2( 635904.0,  17969.0);  // n
    if (ch == 111) return vec2( 571392.0,  14897.0);  // o
    if (ch == 112) return vec2( 576928.0,   1071.0);  // p
    if (ch == 113) return vec2( 575424.0,  16926.0);  // q
    if (ch == 114) return vec2( 111616.0,   1057.0);  // r
    if (ch == 115) return vec2(  63488.0,  15886.0);  // s
    if (ch == 116) return vec2( 162948.0,   8324.0);  // t
    if (ch == 117) return vec2( 574464.0,  31281.0);  // u
    if (ch == 118) return vec2( 574464.0,   4433.0);  // v
    if (ch == 119) return vec2( 574464.0,  18293.0);  // w
    if (ch == 120) return vec2( 345088.0,  17732.0);  // x
    if (ch == 121) return vec2( 574464.0,  14878.0);  // y
    if (ch == 122) return vec2( 293888.0,  31812.0);  // z
    // ASCII 123-126
    if (ch == 123) return vec2(  69784.0,  24708.0);  // {
    if (ch == 124) return vec2( 135300.0,   4228.0);  // |
    if (ch == 125) return vec2( 266371.0,   3204.0);  // }
    if (ch == 126) return vec2( 283712.0,      0.0);  // ~
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
        result = max(result, ssChar(ssEncoding(45), vec2(glyphX, glyphY)));
        cursor += 1.0;
    }

    float ipart = floor(absVal);
    int   nInt  = (ipart < 1.0) ? 1 : (int(floor(log(ipart + 0.5) / log(10.0))) + 1);
    for (int d = 0; d < 6; d++) {
        if (d >= nInt) break;
        float place  = pow(10.0, float(nInt - 1 - d));
        int   digit  = int(mod(floor(absVal / place), 10.0));
        float glyphX = (xOff - (cursor + float(d)) * adv) / charW * 5.0;
        result = max(result, ssChar(ssEncoding(48 + digit), vec2(glyphX, glyphY)));
    }
    cursor += float(nInt);

    if (decimals > 0) {
        float glyphX = (xOff - cursor * adv) / charW * 5.0;
        result = max(result, ssChar(ssEncoding(46), vec2(glyphX, glyphY)));
        cursor += 1.0;

        float fpart = absVal - ipart;
        for (int d = 0; d < 4; d++) {
            if (d >= decimals) break;
            fpart *= 10.0;
            int   digit   = int(mod(floor(fpart), 10.0));
            float glyphX2 = (xOff - (cursor + float(d)) * adv) / charW * 5.0;
            result = max(result, ssChar(ssEncoding(48 + digit), vec2(glyphX2, glyphY)));
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

export const PrintTextNode: NodeDefinition = {
  type: 'printText',
  label: 'Print Text',
  category: 'Utility',
  description: 'Renders a static string as bitmap text on the canvas. Supports full ASCII (letters, digits, symbols). Output is a 0/1 mask — wire into a Mix or color multiply for the text color.',

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

    const charW = `${id}_charW`;
    const adv   = `${id}_adv`;
    const gY    = `${id}_glyphY`;
    const xOff  = `${id}_xOff`;

    const charLines = text.split('').map((ch, i) => {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) return '';
      return `    ${outVar} = max(${outVar}, ssChar(ssEncoding(${code}), vec2((${xOff} - ${i}.0 * ${adv}) / ${charW} * 5.0, ${gY})));`;
    }).filter(Boolean).join('\n');

    return {
      code: `
    float ${charW} = ${size} * (5.0 / 7.0);
    float ${adv} = ${charW} + ${size} * 0.1;
    float ${id}_py = ((${uvExpr}).y - (${posExpr}).y) / ${size};
    float ${outVar} = 0.0;
    if (${id}_py >= 0.0 && ${id}_py < 1.0) {
        float ${gY} = (1.0 - ${id}_py) * 7.0;
        float ${xOff} = (${uvExpr}).x - (${posExpr}).x;
${charLines}
    }\n`,
      outputVars: { mask: outVar },
    };
  },
};
