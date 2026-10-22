/**
 * Convolve (docs/convolve.md): TouchDesigner's Convolve. Every classic image filter (blur, sharpen, emboss, edges)
 * is a weighted sum of the pixels round each one: a small grid of numbers, the kernel, laid over the pixel, each
 * neighbour multiplied by the number on it and the results added up. One node with presets makes those filters
 * one click away; Custom puts the grid on the card to type into.
 *
 * Where the neighbours come from, in order:
 *  - Texture wired (a Pass, a picture's Texture): it is read at texel offsets, Spacing picture pixels apart.
 *  - Colour ƒ wired (an optional field socket, as Normal from Height's Height): the wired chain is compiled as a
 *    function of position and worked out again at each offset, so a procedural chain (noise, Voronoi, shapes) and
 *    a picture read both work with no Pass.
 *  - Colour ƒ wired to a chain that can't be a function (it reads the previous frame): only this pixel is known, so
 *    the colour passes through unchanged and the card says why (wire it through a Pass into Texture instead).
 *
 * The kernel grid is row-major from the top: index row × 5 + column, row 0 the top row, so the offset of a cell is
 * (column − 2, 2 − row) with y up the picture. A 3 × 3 kernel is the middle 9 cells. Custom's 25 weights are params
 * `k0`…`k24`, live uniforms while Preset is Custom (`liveParamKeys`), so typing a weight never recompiles. The fixed
 * presets are literals (zero weights read nothing); Emboss, Motion blur and Unsharp mask work their weights out in
 * the shader from their live sliders. `convolveKernel` is the same maths in JS: the card shows it and the tests
 * check it.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { f, p, withParamSockets } from './helpers';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';
import { neighbourSource, neighbourSourceNote } from './neighbourReads';

const LUMA = 'vec3(0.299, 0.587, 0.114)';

export const CONVOLVE_PRESETS = ['sharpen', 'unsharp', 'emboss', 'outline', 'edgeX', 'edgeY', 'box', 'gaussian', 'motion', 'custom'] as const;
export type ConvolvePreset = typeof CONVOLVE_PRESETS[number];
export const CONVOLVE_PRESET_LABELS: Record<ConvolvePreset, string> = {
  sharpen: 'Sharpen', unsharp: 'Unsharp mask', emboss: 'Emboss', outline: 'Outline (Laplacian)',
  edgeX: 'Edge X (Sobel)', edgeY: 'Edge Y (Sobel)', box: 'Box blur', gaussian: 'Gaussian blur', motion: 'Motion blur', custom: 'Custom',
};

export const presetOf = (v: unknown): ConvolvePreset => ((CONVOLVE_PRESETS as readonly string[]).includes(String(v)) ? String(v) as ConvolvePreset : 'sharpen');
export const kernelSizeOf = (v: unknown): 3 | 5 => (String(v) === '5' ? 5 : 3);
/** The param holding Custom's weight in grid cell `i` (0…24, row-major from the top). */
export const kernelKey = (i: number) => `k${i}`;
/** The grid cells a size uses: all 25 for 5 × 5, the middle 9 for 3 × 3. */
export function kernelCells(size: 3 | 5): number[] {
  const lo = size === 5 ? 0 : 1, hi = size === 5 ? 4 : 3;
  const out: number[] = [];
  for (let r = lo; r <= hi; r++) for (let c = lo; c <= hi; c++) out.push(r * 5 + c);
  return out;
}
/** A cell's offset from the middle, in reads: x to the right, y up the picture. */
export const cellOffset = (i: number): [number, number] => [(i % 5) - 2, 2 - Math.floor(i / 5)];

/** The identity kernel: 1 in the middle, so Custom starts as "the picture unchanged". */
export const IDENTITY_KERNEL: number[] = Array.from({ length: 25 }, (_, i) => (i === 12 ? 1 : 0));

// ── The kernels, in plain JS ────────────────────────────────────────────────

const B3 = [1, 2, 1], B5 = [1, 4, 6, 4, 1];
/** Lays a size × size table (rows from the top) into the 25-cell grid. */
function grid(rows: number[][]): number[] {
  const out = new Array(25).fill(0);
  const n = rows.length, o = (5 - n) / 2;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out[(r + o) * 5 + c + o] = rows[r][c];
  return out;
}
const outer = (a: number[], b: number[], s: number) => a.map(x => b.map(y => (x * y) / s));

/** The fixed kernels (no slider changes them). */
export function fixedKernel(preset: 'sharpen' | 'outline' | 'edgeX' | 'edgeY' | 'box' | 'gaussian', size: 3 | 5): number[] {
  const n = size;
  switch (preset) {
    case 'box': return grid(Array.from({ length: n }, () => new Array(n).fill(1 / (n * n))));
    case 'gaussian': return grid(n === 3 ? outer(B3, B3, 16) : outer(B5, B5, 256));
    case 'sharpen': {
      // 3 × 3: the classic cross, 5 in the middle. 5 × 5: twice the pixel minus its Gaussian blur.
      if (n === 3) return grid([[0, -1, 0], [-1, 5, -1], [0, -1, 0]]);
      const g = fixedKernel('gaussian', 5);
      return g.map((w, i) => (i === 12 ? 2 - w : -w));
    }
    case 'outline': {
      const k = new Array(25).fill(0);
      for (const i of kernelCells(n)) k[i] = -1;
      k[12] = n * n - 1;
      return k;
    }
    case 'edgeX': case 'edgeY': {
      // Sobel: a smoothing across times a difference along. The 5 × 5 one is scaled (÷ 16) so a ramp reads as
      // strongly as through the 3 × 3.
      const smooth = n === 3 ? B3 : B5;
      const diff = n === 3 ? [-1, 0, 1] : [-1, -2, 0, 2, 1];
      const s = n === 3 ? 1 : 16;
      // Edge X: rows (top to bottom) smooth, columns (left to right) the difference. Edge Y: rows from the top are
      // the difference reversed (brighter upwards is positive), columns smooth.
      return grid(preset === 'edgeX'
        ? smooth.map(a => diff.map(b => (a * b) / s))
        : [...diff].reverse().map(a => smooth.map(b => (a * b) / s)));
    }
  }
}

/** Emboss: the neighbours towards the light (Angle, 0 right, 90 up) count negative, the ones away positive, the middle 1. */
export function embossKernel(size: 3 | 5, angleDeg: number): number[] {
  const a = (angleDeg * Math.PI) / 180, R = (size - 1) / 2;
  const k = new Array(25).fill(0);
  for (const i of kernelCells(size)) {
    const [x, y] = cellOffset(i);
    k[i] = i === 12 ? 1 : -(x * Math.cos(a) + y * Math.sin(a)) / R;
  }
  return k;
}

/** Motion blur: each read weighed by how close it is to the line through the middle along Angle, adding up to 1. */
export function motionKernel(size: 3 | 5, angleDeg: number): number[] {
  const a = (angleDeg * Math.PI) / 180;
  const k = new Array(25).fill(0);
  let s = 0;
  for (const i of kernelCells(size)) {
    const [x, y] = cellOffset(i);
    k[i] = Math.max(1 - Math.abs(-x * Math.sin(a) + y * Math.cos(a)), 0);
    s += k[i];
  }
  return k.map(w => w / s);
}

/** Unsharp mask: original + Amount × (original − blur), the blur a Gaussian Radius reads wide; adds up to 1. */
export function unsharpKernel(size: 3 | 5, amount: number, radius: number): number[] {
  const r2 = 2 * Math.max(radius, 0.05) ** 2;
  const g = new Array(25).fill(0);
  let s = 0;
  for (const i of kernelCells(size)) {
    const [x, y] = cellOffset(i);
    g[i] = Math.exp(-(x * x + y * y) / r2);
    s += g[i];
  }
  return g.map((w, i) => (i === 12 ? 1 + amount : 0) - (amount * w) / s);
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The 25 weights a node's settings use (cells outside a 3 × 3 are 0): what the card shows and the shader sums. */
export function convolveKernel(params: Record<string, unknown>): number[] {
  const preset = presetOf(params.preset);
  const size = kernelSizeOf(params.size);
  switch (preset) {
    case 'custom': {
      const used = new Set(kernelCells(size));
      return Array.from({ length: 25 }, (_, i) => (used.has(i) ? num(params[kernelKey(i)], IDENTITY_KERNEL[i]) : 0));
    }
    case 'emboss': return embossKernel(size, num(params.angle, 135));
    case 'motion': return motionKernel(size, num(params.angle, 0));
    case 'unsharp': return unsharpKernel(size, num(params.amount, 1), num(params.radius, 1));
    default: return fixedKernel(preset, size);
  }
}

/** What Convolve reads its neighbours from, in words for the card (components/NodeGraph/ConvolveCard.tsx). */
export function convolveSourceNote(node: GraphNode, nodes: readonly GraphNode[], defOf: (n: GraphNode) => NodeDefinition | undefined): string {
  return neighbourSourceNote(node, nodes, defOf).text;
}

// ── The node ────────────────────────────────────────────────────────────────

const SHOW_ANGLE = { param: 'preset', value: ['emboss', 'motion'] };
const SHOW_UNSHARP = { param: 'preset', value: 'unsharp' };

export const ConvolveNode: NodeDefinition = withParamSockets({
  type: 'convolve',
  label: 'Convolve',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Convolution', 'Kernel', 'Convolution kernel', 'Image filter', 'Sharpen (picture)', 'Unsharp mask', 'Clarity', 'Emboss filter', 'Laplacian filter', 'Sobel filter', 'Motion blur (kernel)', 'Box blur (kernel)', 'Weighted sum'],
  description: 'Every classic picture filter in one node: each pixel becomes a weighted sum of the pixels round it, the weights a small grid of numbers (the kernel). Presets for Sharpen, Unsharp mask, Emboss, Outline, Edge X / Y, Box, Gaussian and Motion blur; Custom lets you type the grid. Wire a Texture, or any colour chain into Colour ƒ, which is worked out again at each neighbour.',
  inputs: {
    colour: { type: 'vec3', label: 'Colour ƒ', field: true, fieldOptional: true, hint: 'Any colour chain (noise, Voronoi, a picture read): worked out again at each neighbour. A chain that reads the previous frame can\'t be, and passes through unchanged: send it through a Pass into Texture instead.' },
    texture: { type: 'texture', label: 'Texture', hint: 'A Pass\'s Texture or a picture\'s: read at neighbouring pixels. Used before Colour ƒ when both are wired.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where "here" is, in picture coordinates. Leave empty for this pixel.' },
  },
  outputs: {
    colour: { type: 'vec3', label: 'Colour', hint: 'The filtered colour, blended with the original by Mix.' },
    luma: { type: 'float', label: 'Luma', hint: 'The filtered colour\'s brightness, as one number.' },
  },
  defaultParams: {
    preset: 'sharpen', size: '3', spacing: 1, mix: 1, amount: 1, radius: 1, angle: 135,
    normalize: true, bias: 0, absolute: false,
    ...Object.fromEntries(IDENTITY_KERNEL.map((w, i) => [kernelKey(i), w])),
  },
  paramDefs: {
    preset: { label: 'Preset', type: 'select', hint: 'Which kernel. Custom: type the weights into the grid on the card.', help: 'Sharpen: the pixel minus its neighbours, crisper detail. Unsharp mask: the original plus Amount × (original − a blur), the photographer\'s sharpen. Emboss: lit from one side like a stamped relief. Outline (Laplacian): bright where the pixel differs from all round it, 0 on flat areas. Edge X / Edge Y (Sobel): how fast the brightness changes across / up, signed. Box and Gaussian blur: averages (Gaussian is softer). Motion blur: an average along a line. Custom: your own grid.', options: CONVOLVE_PRESETS.map(v => ({ value: v, label: CONVOLVE_PRESET_LABELS[v] })) },
    size: { label: 'Size', type: 'select', compileTime: true, hint: 'How many reads across: 3 × 3 (9 reads) or 5 × 5 (25 reads), wider and slower.', options: [
      { value: '3', label: '3 × 3' }, { value: '5', label: '5 × 5' },
    ] },
    spacing: { label: 'Spacing', type: 'float', min: 0.25, max: 16, step: 0.25, hint: 'Pixels between reads: wider reaches further for the same cost (bolder edges, longer streaks), with gaps on fine detail.' },
    amount: { label: 'Amount', type: 'float', min: 0, max: 5, step: 0.01, showWhen: SHOW_UNSHARP, hint: 'How much of the difference from the blur is added back: 0 is the original, 1 doubles the fine detail.' },
    radius: { label: 'Radius', type: 'float', min: 0.25, max: 3, step: 0.05, showWhen: SHOW_UNSHARP, hint: 'How wide the blur it compares with is, in reads: small sharpens fine detail, large adds local contrast ("clarity").' },
    angle: { label: 'Angle', type: 'float', min: 0, max: 360, step: 0.5, showWhen: SHOW_ANGLE, hint: 'Emboss: which way the light comes from (0 right, 90 up). Motion blur: which way the streaks run.' },
    normalize: { label: 'Normalize', type: 'bool', showWhen: { param: 'preset', value: 'custom' }, hint: 'Divide by the sum of the weights (when it isn\'t 0), so a blur of all 1s keeps the brightness. The presets already add up to 1 or 0.' },
    absolute: { label: 'Absolute value', type: 'bool', hint: 'Turn negative results positive: an edge shows bright on both sides, light-to-dark and dark-to-light.' },
    bias: { label: 'Add bias', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Added after the sum: 0.5 lifts Emboss and the edges to mid grey, so negative results show as darker than grey.' },
    mix: { label: 'Mix', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much of the result: 0 is the original, 1 the filtered colour.' },
  },
  searchOptions: ['preset'],
  // Custom's weights are typed on the card's grid (components/NodeGraph/ConvolveCard.tsx): live uniforms, no recompile.
  liveParamKeys: params => (presetOf(params.preset) === 'custom' ? kernelCells(kernelSizeOf(params.size)).map(kernelKey) : []),
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const preset = presetOf(P.preset);
    const size = kernelSizeOf(P.size);
    const outs = { colour: `${id}_out`, luma: `${id}_luma` };
    const lines: string[] = [];
    // The neighbours (neighbourReads.ts): a Texture at texel offsets, else the Colour ƒ chain again at each offset.
    const src = neighbourSource(id, v, p(P.spacing, 1));
    if (!src) {
      // Only this pixel is known (a plain value, or nothing): pass it through.
      lines.push(`    vec3 ${id}_out = ${v.colour ?? 'vec3(0.0)'};\n`, `    float ${id}_luma = dot(${id}_out, ${LUMA});\n`);
      return { code: lines.join(''), outputVars: outs };
    }
    lines.push(...src.lines);
    const read = (x: number, y: number) => src.read(`vec2(${f(x)}, ${f(y)})`);
    const at = (i: number) => (i === 12 ? `${id}_c` : read(...cellOffset(i)));
    const cells = kernelCells(size);
    lines.push(`    vec3 ${id}_acc = vec3(0.0);\n`);
    let result: string;
    if (preset === 'custom') {
      lines.push(`    float ${id}_ws = 0.0;\n`);
      for (const i of cells) {
        const w = p(P[kernelKey(i)], IDENTITY_KERNEL[i]);
        lines.push(`    ${id}_acc += ${at(i)} * ${w}; ${id}_ws += ${w};\n`);
      }
      const normalize = P.normalize !== false && P.normalize !== 'false';
      result = normalize ? `(abs(${id}_ws) > 0.0001 ? ${id}_acc / ${id}_ws : ${id}_acc)` : `${id}_acc`;
    } else if (preset === 'emboss') {
      const R = (size - 1) / 2;
      lines.push(`    vec2 ${id}_dir = vec2(cos(radians(${p(P.angle, 135)})), sin(radians(${p(P.angle, 135)}))) * ${f(-1 / R)};\n`);
      for (const i of cells) {
        const [x, y] = cellOffset(i);
        lines.push(i === 12 ? `    ${id}_acc += ${id}_c;\n` : `    ${id}_acc += ${at(i)} * dot(vec2(${f(x)}, ${f(y)}), ${id}_dir);\n`);
      }
      result = `${id}_acc`;
    } else if (preset === 'motion') {
      lines.push(`    vec2 ${id}_n = vec2(-sin(radians(${p(P.angle, 0)})), cos(radians(${p(P.angle, 0)})));\n`, `    float ${id}_ws = 0.0;\n    float ${id}_w = 0.0;\n`);
      for (const i of cells) {
        const [x, y] = cellOffset(i);
        lines.push(i === 12
          ? `    ${id}_acc += ${id}_c; ${id}_ws += 1.0;\n`
          : `    ${id}_w = max(1.0 - abs(dot(vec2(${f(x)}, ${f(y)}), ${id}_n)), 0.0); ${id}_acc += ${at(i)} * ${id}_w; ${id}_ws += ${id}_w;\n`);
      }
      result = `${id}_acc / ${id}_ws`;
    } else if (preset === 'unsharp') {
      lines.push(`    float ${id}_r2 = 2.0 * max(${p(P.radius, 1)}, 0.05) * max(${p(P.radius, 1)}, 0.05);\n`, `    float ${id}_ws = 0.0;\n    float ${id}_w = 0.0;\n`);
      for (const i of cells) {
        const [x, y] = cellOffset(i);
        lines.push(`    ${id}_w = exp(${f(-(x * x + y * y))} / ${id}_r2); ${id}_acc += ${at(i)} * ${id}_w; ${id}_ws += ${id}_w;\n`);
      }
      result = `${id}_c + ${p(P.amount, 1)} * (${id}_c - ${id}_acc / ${id}_ws)`;
    } else {
      const k = fixedKernel(preset, size);
      for (const i of cells) if (k[i] !== 0) lines.push(`    ${id}_acc += ${at(i)} * ${f(k[i])};\n`);
      result = `${id}_acc`;
    }
    const absolute = P.absolute === true || P.absolute === 'true';
    lines.push(
      `    vec3 ${id}_r = ${absolute ? `abs(${result})` : result} + ${p(P.bias, 0)};\n`,
      `    vec3 ${id}_out = mix(${id}_c, ${id}_r, ${p(P.mix, 1)});\n`,
      `    float ${id}_luma = dot(${id}_out, ${LUMA});\n`,
    );
    return { code: lines.join(''), outputVars: outs };
  },
}, ['spacing', 'mix', 'amount', 'radius', 'angle', 'bias']);
