/**
 * Dither (docs/dither.md): cuts a colour down to a few levels per channel, as Posterize does, but nudges each
 * pixel's cut by a fixed pattern first, so a smooth gradient becomes a pattern of dots instead of flat bands: the
 * look of 1-bit Macs, the Game Boy, newspaper print and GIFs.
 *
 * The pattern gives every pixel (or every Pixel size block) a threshold from 0 to 1:
 *   Bayer 2×2 / 4×4 / 8×8  the ordered dither matrix, built by interleaving the bits of x and y (no table): each
 *                          size is the 2×2 one, repeated inside a coarser copy of itself, a quarter as strong.
 *   Blue noise             interleaved gradient noise (Jimenez 2014): looks random, but neighbours differ, so no clumps.
 *   White noise            a plain hash per pixel: grainy.
 *   Lines                  diagonal lines, a print halftone.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, pv3, withParamSockets } from './helpers';

const LUMA = 'vec3(0.299, 0.587, 0.114)';

/** The patterns, each a function of the (scaled, floored) pixel position returning a threshold in 0..1. */
export const DITHER_GLSL = `float ditherBayer2(vec2 a) {
    a = floor(a);
    return fract(dot(a, vec2(0.5, a.y * 0.75)));
}
float ditherBayer4(vec2 a) {
    return ditherBayer2(0.5 * a) * 0.25 + ditherBayer2(a);
}
float ditherBayer8(vec2 a) {
    return ditherBayer4(0.5 * a) * 0.25 + ditherBayer2(a);
}
float ditherIGN(vec2 a) {
    return fract(52.9829189 * fract(dot(a, vec2(0.06711056, 0.00583715))));
}
float ditherWhite(vec2 a) {
    vec3 q = fract(vec3(a.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}
float ditherLines(vec2 a) {
    return abs(fract((a.x + a.y) * 0.25) * 2.0 - 1.0);
}`;

type Pattern = 'bayer2' | 'bayer4' | 'bayer8' | 'blue' | 'white' | 'lines';
const PATTERNS: Pattern[] = ['bayer2', 'bayer4', 'bayer8', 'blue', 'white', 'lines'];
/** The threshold expression for a pattern at cell `c`; the Bayer ones are offset half a step, so they centre on 0.5. */
const thresholdOf = (pat: Pattern, c: string): string => {
  switch (pat) {
    case 'bayer2': return `(ditherBayer2(${c}) + 0.125)`;
    case 'bayer4': return `(ditherBayer4(${c}) + 0.03125)`;
    case 'bayer8': return `(ditherBayer8(${c}) + 0.0078125)`;
    case 'blue': return `ditherIGN(${c})`;
    case 'white': return `ditherWhite(${c})`;
    case 'lines': return `ditherLines(${c})`;
  }
};
type Mode = 'colour' | 'mono' | 'two' | 'four';
const MODES: Mode[] = ['colour', 'mono', 'two', 'four'];

export const DitherNode: NodeDefinition = withParamSockets({
  type: 'dither',
  label: 'Dither',
  category: 'Color',
  aliases: ['Bayer', 'Ordered dither', '1-bit', 'One bit', 'Game Boy', 'Retro', 'Blue noise dither', 'Pixel art', 'GIF look'],
  description: 'Cuts a colour down to a few levels, like Posterize, but with a fine pattern of dots in between the levels instead of flat bands: the 1-bit Mac, Game Boy and print look. Pick the pattern (Bayer, blue noise, white noise, lines), how many levels, and whether to keep the colour, go black and white, or map to two or four colours of your own.',
  inputs: {
    color: { type: 'vec3', label: 'Colour', hint: 'The colour to dither.' },
    position: { type: 'vec2', label: 'Position', hint: 'Where each pixel is, in screen pixels, for the pattern. Empty: this pixel on screen.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Colour', hint: 'The dithered colour.' },
    mask: { type: 'float', label: 'Mask', hint: 'The brightness after dithering, 0 to 1 in Levels steps: a 1-bit mask at 2 levels.' },
  },
  defaultParams: {
    pattern: 'bayer4', mode: 'colour', levels: 2, pixelSize: 1, strength: 1,
    darkColour: [0.06, 0.1, 0.2], lightColour: [0.95, 0.9, 0.75],
    colour1: [0.06, 0.22, 0.06], colour2: [0.19, 0.38, 0.19], colour3: [0.55, 0.67, 0.06], colour4: [0.61, 0.74, 0.06],
  },
  paramDefs: {
    pattern: { label: 'Pattern', type: 'select', hint: 'The pattern of dots between levels.', options: [
      { value: 'bayer2', label: 'Bayer 2×2 (coarse)' },
      { value: 'bayer4', label: 'Bayer 4×4' },
      { value: 'bayer8', label: 'Bayer 8×8 (fine)' },
      { value: 'blue', label: 'Blue noise' },
      { value: 'white', label: 'White noise' },
      { value: 'lines', label: 'Lines' },
    ] },
    mode: { label: 'Mode', type: 'select', hint: 'Keep the colour, go black and white, or map the brightness to two or four colours of your own.', options: [
      { value: 'colour', label: 'Colour (each channel)' },
      { value: 'mono', label: 'Black and white' },
      { value: 'two', label: 'Two colours' },
      { value: 'four', label: 'Four colours' },
    ] },
    levels: { label: 'Levels', type: 'float', min: 2, max: 16, step: 1, hint: 'How many levels each channel keeps: 2 is on or off (1-bit), 16 is nearly smooth. Four colours always uses 4.' },
    pixelSize: { label: 'Pixel size', type: 'float', min: 1, max: 16, step: 1, hint: 'How big each dot is, in screen pixels: 3–6 for a chunky retro look.' },
    strength: { label: 'Strength', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much pattern: 0 is plain flat bands (as Posterize), 1 is full dither.' },
    darkColour: { label: 'Dark colour', type: 'vec3color', section: 'Colours', hint: 'Two colours: the colour for the darkest level.', showWhen: { param: 'mode', value: 'two' } },
    lightColour: { label: 'Light colour', type: 'vec3color', section: 'Colours', hint: 'Two colours: the colour for the lightest level.', showWhen: { param: 'mode', value: 'two' } },
    colour1: { label: 'Colour 1', type: 'vec3color', section: 'Colours', hint: 'Four colours: the darkest.', showWhen: { param: 'mode', value: 'four' } },
    colour2: { label: 'Colour 2', type: 'vec3color', section: 'Colours', hint: 'Four colours: the second darkest.', showWhen: { param: 'mode', value: 'four' } },
    colour3: { label: 'Colour 3', type: 'vec3color', section: 'Colours', hint: 'Four colours: the second lightest.', showWhen: { param: 'mode', value: 'four' } },
    colour4: { label: 'Colour 4', type: 'vec3color', section: 'Colours', hint: 'Four colours: the lightest.', showWhen: { param: 'mode', value: 'four' } },
  },
  glslFunction: DITHER_GLSL,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const pat: Pattern = PATTERNS.includes(P.pattern as Pattern) ? P.pattern as Pattern : 'bayer4';
    const mode: Mode = MODES.includes(P.mode as Mode) ? P.mode as Mode : 'colour';
    const c = v.color ?? 'vec3(0.5)';
    const lines: string[] = [
      `    vec3 ${id}_in = clamp(${c}, 0.0, 1.0);\n`,
      `    vec2 ${id}_cell = floor((${v.position ?? 'gl_FragCoord.xy'}) / max(floor(${p(P.pixelSize, 1)} + 0.5), 1.0));\n`,
      // The pixel's offset: 0.5 (plain rounding) at Strength 0, the pattern's threshold at 1.
      `    float ${id}_o = mix(0.5, ${thresholdOf(pat, `${id}_cell`)}, clamp(${p(P.strength, 1)}, 0.0, 1.0));\n`,
      `    float ${id}_l = dot(${id}_in, ${LUMA});\n`,
    ];
    if (mode === 'four') {
      lines.push(
        `    float ${id}_k = clamp(floor(${id}_l * 3.0 + ${id}_o), 0.0, 3.0);\n`,
        `    float ${id}_m = ${id}_k / 3.0;\n`,
        `    vec3 ${id}_c = ${id}_k < 0.5 ? ${pv3(P.colour1, [0.06, 0.22, 0.06])} : (${id}_k < 1.5 ? ${pv3(P.colour2, [0.19, 0.38, 0.19])} : (${id}_k < 2.5 ? ${pv3(P.colour3, [0.55, 0.67, 0.06])} : ${pv3(P.colour4, [0.61, 0.74, 0.06])}));\n`,
      );
    } else {
      lines.push(
        // Steps between levels: Levels − 1 (2 levels: one step, 0 or 1).
        `    float ${id}_n = max(floor(${p(P.levels, 2)} + 0.5) - 1.0, 1.0);\n`,
        `    float ${id}_m = clamp(floor(${id}_l * ${id}_n + ${id}_o) / ${id}_n, 0.0, 1.0);\n`,
      );
      if (mode === 'colour') lines.push(`    vec3 ${id}_c = clamp(floor(${id}_in * ${id}_n + ${id}_o) / ${id}_n, 0.0, 1.0);\n`);
      else if (mode === 'mono') lines.push(`    vec3 ${id}_c = vec3(${id}_m);\n`);
      else lines.push(`    vec3 ${id}_c = mix(${pv3(P.darkColour, [0.06, 0.1, 0.2])}, ${pv3(P.lightColour, [0.95, 0.9, 0.75])}, ${id}_m);\n`);
    }
    return { code: lines.join(''), outputVars: { color: `${id}_c`, mask: `${id}_m` } };
  },
}, ['levels', 'pixelSize', 'strength']);
