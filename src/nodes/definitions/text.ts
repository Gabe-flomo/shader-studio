/**
 * Text (docs/text-node.md): words drawn in the shader, TouchDesigner's Text TOP, from the preview's font atlas
 * (u_fontTexture: ASCII in a 16 × 16 grid of 64 px cells, a bold monospace drawn at +6 px, flipped in y; the
 * same atlas Blob Track's labels use, and web pages carry).
 *
 * The text is compile-time: each line becomes a constant array of character codes. `{}` in it is a live number:
 * the Value input (or slider), formatted to Decimals and padded to Number width so the line never jumps.
 * Lines are Size high, characters 0.6 of that wide (times Spacing), placed at Position by Align.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, pv3, withParamSockets } from './helpers';

export const TEXT_TYPE = 'text';
const PLACE = '{}';
const MAX_CHARS = 512;

/** The glyph helpers: one character's coverage at a point of its cell (0–1, y up), four taps for smooth edges. */
export const TEXT_GLSL = `float tx_glyph1(int code, vec2 lp) {
  if (code <= 32 || code > 126 || lp.x < 0.0 || lp.x > 1.0 || lp.y < 0.0 || lp.y > 1.0) return 0.0;
  float col = float(code % 16), row = float(code / 16);
  vec2 uv = vec2((col * 64.0 + 6.0 + lp.x * 32.0) / 1024.0, 1.0 - (row * 64.0 + 6.0 + (1.0 - lp.y) * 56.0) / 1024.0);
  return textureLod(u_fontTexture, uv, 0.0).r;
}
float tx_glyph(int code, vec2 lp, vec2 o) {
  return 0.25 * (tx_glyph1(code, lp - o) + tx_glyph1(code, lp + vec2(o.x, -o.y)) + tx_glyph1(code, lp + vec2(-o.x, o.y)) + tx_glyph1(code, lp + o));
}
// Character k (0 = leftmost) of v formatted to d decimals, right-aligned in w characters (spaces before, '-' when negative).
int tx_numChar(float v, int d, int w, int k) {
  float a = abs(v);
  float r = floor(a * pow(10.0, float(d)) + 0.5);
  int intDigits = 1;
  float ip = floor(r / pow(10.0, float(d)));
  for (int i = 0; i < 9; i++) { if (ip >= pow(10.0, float(intDigits))) intDigits++; }
  int len = intDigits + (d > 0 ? d + 1 : 0) + (v < 0.0 && r > 0.0 ? 1 : 0);
  int j = k - (w - len);
  if (j < 0) return 32;
  if (v < 0.0 && r > 0.0) { if (j == 0) return 45; j -= 1; }
  if (j < intDigits) return 48 + int(mod(floor(ip / pow(10.0, float(intDigits - 1 - j))), 10.0));
  if (j == intDigits) return 46;
  int f = j - intDigits - 1;
  return 48 + int(mod(floor(r / pow(10.0, float(d - 1 - f))), 10.0));
}`;

/** The text split into lines, each a list of character codes (-1 marks the number's place, Number width long). */
export function textLines(text: string, numWidth: number): number[][] {
  const lines = String(text ?? '').replace(/\r/g, '').replace(/\\n/g, '\n').split('\n');
  let total = 0;
  return lines.map(line => {
    const codes: number[] = [];
    const parts = line.split(PLACE);
    parts.forEach((part, i) => {
      for (const ch of part) { const c = ch.charCodeAt(0); codes.push(c >= 32 && c <= 126 ? c : 63); }
      if (i < parts.length - 1) for (let k = 0; k < numWidth; k++) codes.push(-1 - k);
    });
    const room = Math.max(0, MAX_CHARS - total);
    total += Math.min(codes.length, room);
    return codes.slice(0, room);
  });
}

export const TextNode: NodeDefinition = withParamSockets({
  type: TEXT_TYPE,
  label: 'Text',
  category: '2D Primitives',
  aliases: ['Text TOP', 'Type', 'Label', 'Words', 'Title', 'Caption', 'Number display', 'Counter display', 'Readout'],
  description: 'Draws text in the picture. Type {} where a live number should go: the Value input (wire an Analyze reading, a Counter, a Timer, an LFO) shown to Decimals places. Mask is 1 on the letters; Color is them in Colour. \\n in the text starts a new line.',
  inputs: {
    uv: { type: 'vec2', label: 'UV', hint: 'Where to draw, in picture coordinates. Empty: this pixel. Wire a warp to bend the text.' },
    position: { type: 'vec2', label: 'Position', hint: 'Where the text sits (picture coordinates): its left, centre or right edge by Align, at the top of the first line. Unwired: Position X, Y.' },
  },
  outputs: {
    mask: { type: 'float', label: 'Mask', hint: '1 on the letters, 0 elsewhere, soft at the edges.' },
    color: { type: 'vec3', label: 'Color', hint: 'The letters in Colour, black elsewhere.' },
  },
  defaultParams: { text: 'Playfield {}', value: 0, valueAt: 'text', decimals: 2, numWidth: 6, size: 0.12, spacing: 1, lineHeight: 1.2, align: 'center', posX: 0, posY: 0.06, color: [1, 1, 1] },
  paramDefs: {
    text: { label: 'Text', type: 'string', hint: 'The words. {} is replaced by Value; \\n starts a new line. Letters, digits and ASCII symbols.' },
    value: { label: 'Value', type: 'float', min: -1000, max: 1000, step: 0.01, hint: 'The number shown where {} is. Its socket takes any single float: an Analyze reading, a Counter, a Timer, an LFO, a Blob Track Count.' },
    valueAt: { label: 'Value at', type: 'select', hint: 'With a wire into Value: Text reads it once, at the text\'s Position, so a value that changes across the picture (an SDF, a noise) shows as one steady number. Each pixel: every pixel of the letters shows its own value (a glitchy look).', options: [
      { value: 'text', label: 'The text\'s position' }, { value: 'pixel', label: 'Each pixel' },
    ] },
    decimals: { label: 'Decimals', type: 'int', min: 0, max: 6, step: 1, hint: 'Places after the point.' },
    numWidth: { label: 'Number width', type: 'int', min: 1, max: 16, step: 1, hint: 'Characters kept for the number (right-aligned), so the text doesn\'t shift as it changes.' },
    size: { label: 'Size', type: 'float', min: 0.01, max: 1, step: 0.005, hint: 'A line\'s height, in picture units (the picture is 2 high).' },
    spacing: { label: 'Spacing', type: 'float', min: 0.5, max: 3, step: 0.01, hint: 'Letter spacing: 1 is the font\'s own.' },
    lineHeight: { label: 'Line height', type: 'float', min: 0.5, max: 3, step: 0.01, hint: 'Distance between lines, in lines.' },
    align: { label: 'Align', type: 'select', hint: 'Which edge of each line sits at Position.', options: [
      { value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' },
    ] },
    posX: { label: 'Position X', type: 'float', min: -2, max: 2, step: 0.005, hint: 'Unwired Position: across.' },
    posY: { label: 'Position Y', type: 'float', min: -1, max: 1, step: 0.005, hint: 'Unwired Position: up (the top of the first line).' },
    color: { label: 'Colour', type: 'vec3color', hint: 'The letters\' colour (Color output).' },
  },
  glslFunctions: [TEXT_GLSL],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, P = node.params;
    const numWidth = Math.max(1, Math.min(16, Math.round(Number(P.numWidth) || 6)));
    const decimals = Math.max(0, Math.min(6, Math.round(Number(P.decimals ?? 2))));
    const lines = textLines(String(P.text ?? ''), numWidth);
    const flat = lines.flat();
    const starts: number[] = [];
    let at = 0;
    for (const l of lines) { starts.push(at); at += l.length; }
    const uv = inputVars.uv ?? 'g_uv';
    const pos = inputVars.position ?? `vec2(${p(P.posX, 0)}, ${p(P.posY, 0.06)})`;
    const al = P.align === 'left' ? '0.0' : P.align === 'right' ? '1.0' : '0.5';
    if (!flat.length) return { code: `    float ${id}_m = 0.0;\n`, outputVars: { mask: `${id}_m`, color: 'vec3(0.0)' } };
    const arr = (name: string, xs: number[]) => `    const int ${name}[${xs.length}] = int[${xs.length}](${xs.join(', ')});\n`;
    const code = [
      arr(`${id}_T`, flat),
      arr(`${id}_S`, starts),
      arr(`${id}_L`, lines.map(l => l.length)),
      `    float ${id}_h = max(${p(P.size, 0.12)}, 1e-4);\n`,
      `    float ${id}_cw = ${id}_h * 0.6 * ${p(P.spacing, 1)};\n`,
      // Down from the top of the first line, in lines; across in characters.
      `    vec2 ${id}_d = ${uv} - ${pos};\n`,
      `    float ${id}_ly = -${id}_d.y / (${id}_h * ${p(P.lineHeight, 1.2)});\n`,
      `    int ${id}_li = int(floor(${id}_ly));\n`,
      `    float ${id}_m = 0.0;\n`,
      // Antialiasing taps: a quarter of a screen pixel, in glyph-cell units (worked out before any branch).
      `    vec2 ${id}_o = 0.25 * fwidth(${id}_d) / vec2(${id}_cw, ${id}_h);\n`,
      `    if (${id}_li >= 0 && ${id}_li < ${lines.length}) {\n`,
      `      float lineLen = float(${id}_L[${id}_li]);\n`,
      `      float cx = (${id}_d.x + lineLen * ${id}_cw * ${al}) / ${id}_cw;\n`,
      `      int k = int(floor(cx));\n`,
      `      float vy = 1.0 - (${id}_ly - float(${id}_li)) * ${p(P.lineHeight, 1.2)};\n`,
      `      if (k >= 0 && float(k) < lineLen && vy >= 0.0 && vy <= 1.0) {\n`,
      `        int c = ${id}_T[${id}_S[${id}_li] + k];\n`,
      `        if (c < 0) c = tx_numChar(${p(P.value, 0)}, ${decimals}, ${numWidth}, -1 - c);\n`,
      `        vec2 lp = vec2((fract(cx) - 0.5) / ${p(P.spacing, 1)} + 0.5, vy);\n`,
      `        ${id}_m = tx_glyph(c, lp, ${id}_o);\n`,
      `      }\n`,
      `    }\n`,
    ].join('');
    return { code, outputVars: { mask: `${id}_m`, color: `(${pv3(P.color, [1, 1, 1])} * ${id}_m)` } };
  },
}, ['value', 'size', 'spacing', 'posX', 'posY'], ['value']);
