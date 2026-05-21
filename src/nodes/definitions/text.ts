import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ─── Bitmap font helper (unchanged) ───────────────────────────────────────────
// Used by PrintText for arbitrary ASCII characters.
// u_fontTexture is a 1024×1024 canvas texture with a 16×16 grid of ASCII chars.
export const BITMAP_FONT_GLSL = `
float ssChar(float localU, float localV, float id) {
    vec2 cell = vec2(mod(id, 16.0), 15.0 - floor(id / 16.0));
    vec2 uv   = (vec2(localU, localV) + cell) / 16.0;
    vec2 b    = step(0.0, vec2(localU, localV)) * (1.0 - step(1.0, vec2(localU, localV)));
    return texture2D(u_fontTexture, uv).r * b.x * b.y;
}`;

// Keep old export name so any other code referencing it still compiles.
export const PRINT_FLOAT_GLSL = BITMAP_FONT_GLSL;

// ─── Procedural digit font ────────────────────────────────────────────────────
// 4-wide × 5-tall pixel grid per character, no texture required.
// Encoding: bit (row*4 + col) of the integer pattern is 1 if that pixel is lit.
// col 0 = left, row 0 = bottom.
//
// Digit patterns (verified):
//   0=432534   1=143918   2=427551   3=953998   4=352068
//   5=989063   6=399254   7=1016866  8=431766   9=433798
//   10=1536 (minus)   11=2 (decimal point)
export const PROC_FLOAT_GLSL = `
float procDigitPat(float d) {
    if (d < 0.5)  return 432534.0;
    if (d < 1.5)  return 143918.0;
    if (d < 2.5)  return 427551.0;
    if (d < 3.5)  return 953998.0;
    if (d < 4.5)  return 352068.0;
    if (d < 5.5)  return 989063.0;
    if (d < 6.5)  return 399254.0;
    if (d < 7.5)  return 1016866.0;
    if (d < 8.5)  return 431766.0;
    if (d < 9.5)  return 433798.0;
    if (d < 10.5) return   1536.0;
    return 2.0;
}

float procCharPx(vec2 uv, float pat) {
    vec2 g = floor(vec2(uv.x * 4.0, uv.y * 5.0));
    if (g.x < 0.0 || g.x > 3.0 || g.y < 0.0 || g.y > 4.0) return 0.0;
    float bit = g.y * 4.0 + g.x;
    return mod(floor(pat / pow(2.0, bit)), 2.0);
}

float procPrintFloat(vec2 uv, vec2 origin, float charH, float value, int decimals) {
    float charW = charH * 0.8;
    float adv   = charH * 0.95;
    float py    = (uv.y - origin.y) / charH;
    if (py < 0.0 || py >= 1.0) return 0.0;
    float xOff  = uv.x - origin.x;
    float res   = 0.0;
    float cur   = 0.0;
    bool  neg   = value < 0.0;
    float av    = abs(value);
    float ip    = floor(av);
    if (neg) {
        res = max(res, procCharPx(vec2((xOff - cur*adv)/charW, py), procDigitPat(10.0)));
        cur += 1.0;
    }
    int ni = 1;
    if (ip >= 10.0)    ni = 2;
    if (ip >= 100.0)   ni = 3;
    if (ip >= 1000.0)  ni = 4;
    if (ip >= 10000.0) ni = 5;
    for (int d = 0; d < 5; d++) {
        if (d >= ni) break;
        float place = pow(10.0, float(ni - 1 - d));
        float digit = mod(floor(av / place), 10.0);
        res = max(res, procCharPx(vec2((xOff - (cur+float(d))*adv)/charW, py), procDigitPat(digit)));
    }
    cur += float(ni);
    if (decimals > 0) {
        res = max(res, procCharPx(vec2((xOff - cur*adv)/charW, py), procDigitPat(11.0)));
        cur += 1.0;
        for (int d = 0; d < 4; d++) {
            if (d >= decimals) break;
            float digit = mod(floor(av * pow(10.0, float(d+1)) + 0.00001), 10.0);
            res = max(res, procCharPx(vec2((xOff - (cur+float(d))*adv)/charW, py), procDigitPat(digit)));
        }
    }
    return clamp(res, 0.0, 1.0);
}`;

// ─── PrintFloat node ──────────────────────────────────────────────────────────

export const PrintFloatNode: NodeDefinition = {
  type: 'printFloat',
  label: 'Print Float',
  category: 'Utility',
  description: 'Renders a float value as crisp procedural pixel text. Output is a 0/1 mask — wire into Mix/Blend with your text color.',

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

  glslFunction: PROC_FLOAT_GLSL,

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
      code: `    float ${outVar} = procPrintFloat(${uvVar}, ${posVar}, ${sizeVar}, ${valueVar}, int(${decVar}));\n`,
      outputVars: { mask: outVar },
    };
  },
};

// ─── PrintText node ───────────────────────────────────────────────────────────

export const PrintTextNode: NodeDefinition = {
  type: 'printText',
  label: 'Print Text',
  category: 'Utility',
  description: 'Renders a static string as bitmap text. Optional value input appends a crisp float number after the text.',

  inputs: {
    uv:    { type: 'vec2',  label: 'UV' },
    pos:   { type: 'vec2',  label: 'Position' },
    value: { type: 'float', label: 'Value' },
  },

  outputs: {
    mask: { type: 'float', label: 'Text Mask' },
  },

  defaultParams: {
    text:     'hello',
    posX:     0.0,
    posY:     0.0,
    charSize: 0.08,
    decimals: 2,
  },

  paramDefs: {
    text:     { label: 'Text',     type: 'string' },
    posX:     { label: 'X',        type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    posY:     { label: 'Y',        type: 'float', min: -2.0, max: 2.0, step: 0.01 },
    charSize: { label: 'Size',     type: 'float', min: 0.01, max: 0.5, step: 0.005 },
    decimals: { label: 'Decimals', type: 'float', min: 0,   max: 4,   step: 1 },
  },

  // Both helpers needed: bitmap for text chars, proc for the optional float value.
  glslFunctions: [BITMAP_FONT_GLSL, PROC_FLOAT_GLSL],

  generateGLSL: (node: GraphNode, inputVars) => {
    const id      = node.id;
    const uvExpr  = inputVars.uv  ?? '(vUv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0) * 2.0';
    const px      = p(node.params.posX,     0.0);
    const py      = p(node.params.posY,     0.0);
    const posExpr = inputVars.pos ?? `vec2(${px}, ${py})`;
    const size    = p(node.params.charSize, 0.08);
    const text    = typeof node.params.text === 'string' ? node.params.text : '';
    const dec     = p(node.params.decimals, 2);
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

    // Bitmap text portion
    let code = `
    float ${charW} = ${size} * 0.56;
    float ${adv}   = ${charW} + ${size} * 0.04;
    float ${rowV}  = ((${uvExpr}).y - (${posExpr}).y) / ${size};
    float ${outVar} = 0.0;
    if (${rowV} >= 0.0 && ${rowV} < 1.0) {
        float ${xOff} = (${uvExpr}).x - (${posExpr}).x;
${charLines}
    }\n`;

    // Proc float suffix if value input is connected
    if (inputVars.value !== undefined) {
      const validChars = text.split('').filter(ch => { const c = ch.charCodeAt(0); return c >= 32 && c <= 126; });
      const textWidth = validChars.length;
      // Offset origin for the float: textWidth * adv past the text origin
      // adv for bitmap = size * 0.60; for proc = size * 0.76. Add a half-char gap between.
      const floatOrigin = `(${posExpr}) + vec2(${textWidth}.0 * ${size} * 0.60 + ${size} * 0.2, 0.0)`;
      code += `    ${outVar} = max(${outVar}, procPrintFloat(${uvExpr}, ${floatOrigin}, ${size}, ${inputVars.value}, int(${dec})));\n`;
    }

    return { code, outputVars: { mask: outVar } };
  },
};
