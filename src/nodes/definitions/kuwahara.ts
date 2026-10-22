/**
 * Kuwahara (docs/kuwahara.md): the painterly, oil-paint filter. For each pixel it looks at the regions round it,
 * picks the one whose colours vary least and uses that region's average. A region that crosses an edge varies a lot,
 * so the pixel takes its colour from the side it is on: edges stay crisp while flat areas turn into flat patches of
 * paint.
 *
 *  - Classic: four overlapping squares, (Radius + 1) reads on a side, the pixel at a shared corner. The one with the
 *    least variance wins outright.
 *  - Generalised (Papari, Petkov and Campisi, 2007, with Kyprianidis's polynomial sector weights): eight sectors of
 *    a disc, each read weighted softly by which sector it lies in and a Gaussian of how far out it is. The sectors'
 *    averages are blended, each weighted by (least variance ÷ its variance) ^ (Sharpness ÷ 2), so the calmest
 *    sector leads without hard seams. Smoother and more painterly.
 *  - Anisotropic (lite): Generalised with the disc stretched into an ellipse along the local edge, from the
 *    structure tensor of one 3 × 3 Sobel at this pixel (8 extra reads, no smoothing Pass): strokes follow the
 *    shapes. Unsmoothed, so the direction can flicker on fine noisy detail.
 *
 * Where the reads come from is Convolve's (neighbourReads.ts): a Texture at texel offsets, else the Colour ƒ chain
 * worked out again at each offset, else the colour passes through and the card says why. Radius is a live uniform:
 * the loops run to a constant bound (8 for a Texture, 4 for a Colour chain, which is worked out again at every read)
 * and skip the reads outside Radius.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { f, p, withParamSockets } from './helpers';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';
import { neighbourSource, neighbourSourceNote } from './neighbourReads';

export const KUWAHARA_KINDS = ['classic', 'generalised', 'anisotropic'] as const;
export type KuwaharaKind = typeof KUWAHARA_KINDS[number];
export const KUWAHARA_KIND_LABELS: Record<KuwaharaKind, string> = {
  classic: 'Classic (4 squares)', generalised: 'Generalised (8 soft sectors)', anisotropic: 'Anisotropic (follows edges)',
};
export const kuwaharaKindOf = (v: unknown): KuwaharaKind => ((KUWAHARA_KINDS as readonly string[]).includes(String(v)) ? String(v) as KuwaharaKind : 'generalised');

/** The largest Radius read from a Texture, and from a Colour chain (worked out again at every read, so capped lower). */
export const KUWAHARA_MAX_RADIUS = 8;
export const KUWAHARA_FIELD_MAX_RADIUS = 4;

/** The Radius the shader uses: 1 up to the cap for the source. */
export function kuwaharaRadius(radius: unknown, fromField: boolean): number {
  const r = typeof radius === 'number' && Number.isFinite(radius) ? radius : 4;
  return Math.min(Math.max(r, 1), fromField ? KUWAHARA_FIELD_MAX_RADIUS : KUWAHARA_MAX_RADIUS);
}

/** How many reads one pixel costs at this Kind and Radius (the shader's own count, as the card shows it). */
export function kuwaharaReads(kind: KuwaharaKind, radius: number): number {
  let reads = 0;
  for (let j = -KUWAHARA_MAX_RADIUS; j <= KUWAHARA_MAX_RADIUS; j++) {
    for (let i = -KUWAHARA_MAX_RADIUS; i <= KUWAHARA_MAX_RADIUS; i++) {
      if (kind === 'classic' ? Math.abs(i) <= radius && Math.abs(j) <= radius : i * i + j * j <= radius * radius) reads++;
    }
  }
  return reads + 1 + (kind === 'anisotropic' ? 8 : 0); // + this pixel, + the Sobel's 8
}

/** What Kuwahara reads from and what it costs, in words for its card (components/NodeGraph/KuwaharaCard.tsx). */
export function kuwaharaNote(node: GraphNode, nodes: readonly GraphNode[], defOf: (n: GraphNode) => NodeDefinition | undefined): string[] {
  const src = neighbourSourceNote(node, nodes, defOf);
  if (src.kind === 'none' || src.kind === 'blocked') return [src.text];
  const fromField = src.kind === 'field';
  const kind = kuwaharaKindOf(node.params.kind);
  const wired = node.inputs.radius?.connection;
  const r = kuwaharaRadius(node.params.radius, fromField);
  const lines = [src.text];
  lines.push(wired
    ? `Radius is wired: up to ${kuwaharaReads(kind, fromField ? KUWAHARA_FIELD_MAX_RADIUS : KUWAHARA_MAX_RADIUS)} reads per pixel.`
    : `About ${kuwaharaReads(kind, r)} reads per pixel at Radius ${Math.floor(r * 100) / 100}.`);
  if (fromField) {
    lines.push(`Each read works the whole Colour chain out again, so a heavy chain gets slow fast. Radius stops at ${KUWAHARA_FIELD_MAX_RADIUS} here: for a bigger brush, raise Spacing, or send the chain through a Pass and wire its Texture into Texture (Radius up to ${KUWAHARA_MAX_RADIUS}).`);
  }
  return lines;
}

// ── The node ────────────────────────────────────────────────────────────────

/** cos(π / 8) and sin(π / 8)²: the sector polynomials' shape for 8 sectors (Kyprianidis). */
const COS_PI_8 = '0.92387953', SIN2_PI_8 = '0.14644661';

export const KuwaharaNode: NodeDefinition = withParamSockets({
  type: 'kuwahara',
  label: 'Kuwahara',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Oil paint', 'Oil painting', 'Painterly', 'Paint filter', 'Kuwahara filter', 'Generalised Kuwahara', 'Anisotropic Kuwahara', 'Watercolour', 'Brush strokes', 'Edge-preserving smoothing'],
  description: 'The oil-paint filter: for each pixel, look at the regions round it, pick the one whose colours vary least and use its average. Edges stay crisp while flat areas turn into patches of paint. Classic uses 4 squares; Generalised 8 soft sectors, smoother and more painterly; Anisotropic stretches them along the edges. Wire a Texture, or any colour chain into Colour ƒ (worked out again at every read: slow at a big Radius).',
  inputs: {
    colour: { type: 'vec3', label: 'Colour ƒ', field: true, fieldOptional: true, hint: 'Any colour chain (noise, Voronoi, a picture read): worked out again at every read, up to 80 times a pixel, so keep it light or use Texture. Radius stops at 4 here. A chain that reads the previous frame can\'t be, and passes through unchanged: send it through a Pass into Texture instead.' },
    texture: { type: 'texture', label: 'Texture', hint: 'A Pass\'s Texture or a picture\'s: read at neighbouring pixels, the cheap way to paint with a big Radius (up to 8). Used before Colour ƒ when both are wired.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where "here" is, in picture coordinates. Leave empty for this pixel.' },
  },
  outputs: {
    colour: { type: 'vec3', label: 'Colour', hint: 'The painted colour, blended with the original by Mix.' },
    variance: { type: 'float', label: 'Variance', hint: 'How much the colours vary in the region it chose (the three channels added): near 0 on flat areas, higher on edges and fine detail. A detail mask.' },
  },
  defaultParams: { kind: 'generalised', radius: 4, sharpness: 8, spacing: 1, mix: 1 },
  paramDefs: {
    kind: { label: 'Kind', type: 'select', hint: 'Which regions it compares round each pixel.', help: 'Classic: 4 overlapping squares; the calmest one wins outright. Blocky, crisp. Generalised: 8 soft sectors of a disc, blended by how calm each is. Smoother, more like brush strokes. Anisotropic: Generalised with the disc stretched along the nearby edge, so strokes follow the shapes (8 more reads).', options: KUWAHARA_KINDS.map(v => ({ value: v, label: KUWAHARA_KIND_LABELS[v] })) },
    radius: { label: 'Radius', type: 'float', min: 1, max: 8, step: 0.5, hint: 'How far it looks, in reads: the size of the brush. Reads grow with its square (Radius 4 is about 50 to 80). A Colour chain stops at 4.' },
    sharpness: { label: 'Sharpness', type: 'float', min: 1, max: 16, step: 0.5, showWhen: { param: 'kind', value: ['generalised', 'anisotropic'] }, hint: 'How strongly the calmest sector wins: low blends them all (softer, blurrier), high picks one (crisper strokes).' },
    spacing: { label: 'Spacing', type: 'float', min: 0.25, max: 8, step: 0.25, hint: 'Pixels between reads: a bigger brush for the same cost, with gaps on fine detail.' },
    mix: { label: 'Mix', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much of the result: 0 is the original, 1 the painted colour.' },
  },
  searchOptions: ['kind'],
  assignable: false,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const kind = kuwaharaKindOf(P.kind);
    const outs = { colour: `${id}_out`, variance: `${id}_var` };
    // The reads (neighbourReads.ts): a Texture at texel offsets, else the Colour ƒ chain again at each offset.
    const src = neighbourSource(id, v, p(P.spacing, 1));
    if (!src) {
      // Only this pixel is known (a plain value, or nothing): pass it through.
      return { code: `    vec3 ${id}_out = ${v.colour ?? 'vec3(0.0)'};\n    float ${id}_var = 0.0;\n`, outputVars: outs };
    }
    const M = src.from === 'texture' ? KUWAHARA_MAX_RADIUS : KUWAHARA_FIELD_MAX_RADIUS;
    const L: string[] = [...src.lines, `    float ${id}_r = clamp(${p(P.radius, 4)}, 1.0, ${f(M)});\n`];
    // Constant bounds; rows and reads outside Radius are skipped.
    const open = [
      `    for (int ${id}_j = -${M}; ${id}_j <= ${M}; ${id}_j++) {\n`,
      `      float ${id}_y = float(${id}_j);\n`,
      `      if (abs(${id}_y) > ${id}_r) continue;\n`,
      `      for (int ${id}_i = -${M}; ${id}_i <= ${M}; ${id}_i++) {\n`,
      `        float ${id}_x = float(${id}_i);\n`,
    ];
    const close = '      }\n    }\n';
    const regions = kind === 'classic' ? 4 : 8;
    for (let k = 0; k < regions; k++) L.push(`    vec3 ${id}_m${k} = vec3(0.0);\n    vec3 ${id}_s${k} = vec3(0.0);\n    float ${id}_n${k} = 0.0;\n`);

    if (kind === 'classic') {
      // Region k's share of a read: 1 inside its square, 0 outside (the axes belong to two).
      const shares = [[`${id}_lf`, `${id}_up`], [`${id}_rt`, `${id}_up`], [`${id}_lf`, `${id}_dn`], [`${id}_rt`, `${id}_dn`]];
      L.push(
        ...open,
        `        if (abs(${id}_x) > ${id}_r) continue;\n`,
        `        vec3 ${id}_a = ${src.read(`vec2(${id}_x, ${id}_y)`)};\n`,
        `        vec3 ${id}_a2 = ${id}_a * ${id}_a;\n`,
        `        float ${id}_lf = step(${id}_x, 0.0);\n        float ${id}_rt = step(0.0, ${id}_x);\n`,
        `        float ${id}_dn = step(${id}_y, 0.0);\n        float ${id}_up = step(0.0, ${id}_y);\n`,
        ...shares.map(([a, b], k) => `        ${id}_m${k} += ${id}_a * (${a} * ${b}); ${id}_s${k} += ${id}_a2 * (${a} * ${b}); ${id}_n${k} += ${a} * ${b};\n`),
        close,
      );
      // The calmest square wins: its average, its variance.
      const sigma = (k: number) => `dot(abs(${id}_s${k} / ${id}_n${k} - ${id}_mu * ${id}_mu), vec3(1.0))`;
      L.push(`    vec3 ${id}_mu = ${id}_m0 / ${id}_n0;\n    vec3 ${id}_k = ${id}_mu;\n    float ${id}_var = ${sigma(0)};\n    float ${id}_sg = 0.0;\n`);
      for (let k = 1; k < 4; k++) {
        L.push(`    ${id}_mu = ${id}_m${k} / ${id}_n${k};\n    ${id}_sg = ${sigma(k)};\n    if (${id}_sg < ${id}_var) { ${id}_var = ${id}_sg; ${id}_k = ${id}_mu; }\n`);
      }
    } else {
      L.push(
        `    float ${id}_zeta = 2.0 / ${id}_r;\n`,
        `    float ${id}_eta = (${id}_zeta + ${COS_PI_8}) / ${SIN2_PI_8};\n`,
      );
      let offset = `vec2(${id}_x, ${id}_y)`;
      if (kind === 'anisotropic') {
        // The structure tensor from a 3 × 3 Sobel at this pixel: t runs along the edge; an says how one-way the edge is.
        const taps: Array<[number, number]> = [[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [0, -1], [1, -1]];
        taps.forEach(([x, y], k) => L.push(`    vec3 ${id}_t${k} = ${src.read(`vec2(${f(x)}, ${f(y)})`)};\n`));
        L.push(
          `    vec3 ${id}_gx = (${id}_t2 + 2.0 * ${id}_t4 + ${id}_t7) - (${id}_t0 + 2.0 * ${id}_t3 + ${id}_t5);\n`,
          `    vec3 ${id}_gy = (${id}_t0 + 2.0 * ${id}_t1 + ${id}_t2) - (${id}_t5 + 2.0 * ${id}_t6 + ${id}_t7);\n`,
          `    float ${id}_tE = dot(${id}_gx, ${id}_gx);\n    float ${id}_tF = dot(${id}_gx, ${id}_gy);\n    float ${id}_tG = dot(${id}_gy, ${id}_gy);\n`,
          `    float ${id}_root = sqrt((${id}_tE - ${id}_tG) * (${id}_tE - ${id}_tG) + 4.0 * ${id}_tF * ${id}_tF);\n`,
          `    float ${id}_l1 = 0.5 * (${id}_tE + ${id}_tG + ${id}_root);\n    float ${id}_l2 = 0.5 * (${id}_tE + ${id}_tG - ${id}_root);\n`,
          `    vec2 ${id}_t = vec2(${id}_l1 - ${id}_tE, -${id}_tF);\n`,
          `    ${id}_t = dot(${id}_t, ${id}_t) > 1.0e-12 ? normalize(${id}_t) : vec2(0.0, 1.0);\n`,
          `    vec2 ${id}_tn = vec2(-${id}_t.y, ${id}_t.x);\n`,
          `    float ${id}_an = ${id}_l1 + ${id}_l2 > 1.0e-8 ? (${id}_l1 - ${id}_l2) / (${id}_l1 + ${id}_l2) : 0.0;\n`,
          `    float ${id}_sa = 1.0 + ${id}_an;\n    float ${id}_sb = 1.0 / (1.0 + ${id}_an);\n`,
        );
        offset = `(${id}_t * (${id}_sa * ${id}_x) + ${id}_tn * (${id}_sb * ${id}_y))`;
      }
      const w = (k: number) => `${id}_w${k}`;
      const sector = (k: number, along: string, cross: string) => `        float ${w(k)} = max(0.0, ${along} + ${cross});\n        ${w(k)} *= ${w(k)};\n`;
      L.push(
        ...open,
        `        if (${id}_x * ${id}_x + ${id}_y * ${id}_y > ${id}_r * ${id}_r) continue;\n`,
        `        vec2 ${id}_v = vec2(${id}_x, ${id}_y) / ${id}_r;\n`,
        `        vec3 ${id}_a = ${src.read(offset)};\n`,
        `        vec3 ${id}_a2 = ${id}_a * ${id}_a;\n`,
        // Each sector's soft share of this read (polynomials, no texture), then a Gaussian of how far out it is.
        `        float ${id}_xx = ${id}_zeta - ${id}_eta * ${id}_v.x * ${id}_v.x;\n        float ${id}_yy = ${id}_zeta - ${id}_eta * ${id}_v.y * ${id}_v.y;\n`,
        sector(0, `${id}_v.y`, `${id}_xx`), sector(2, `-${id}_v.x`, `${id}_yy`), sector(4, `-${id}_v.y`, `${id}_xx`), sector(6, `${id}_v.x`, `${id}_yy`),
        `        vec2 ${id}_u = 0.70710678 * vec2(${id}_v.x - ${id}_v.y, ${id}_v.x + ${id}_v.y);\n`,
        `        ${id}_xx = ${id}_zeta - ${id}_eta * ${id}_u.x * ${id}_u.x;\n        ${id}_yy = ${id}_zeta - ${id}_eta * ${id}_u.y * ${id}_u.y;\n`,
        sector(1, `${id}_u.y`, `${id}_xx`), sector(3, `-${id}_u.x`, `${id}_yy`), sector(5, `-${id}_u.y`, `${id}_xx`), sector(7, `${id}_u.x`, `${id}_yy`),
        `        float ${id}_g = exp(-3.125 * dot(${id}_v, ${id}_v)) / max(${[0, 1, 2, 3, 4, 5, 6, 7].map(w).join(' + ')}, 1.0e-6);\n`,
        ...[0, 1, 2, 3, 4, 5, 6, 7].map(k => `        ${w(k)} *= ${id}_g; ${id}_m${k} += ${id}_a * ${w(k)}; ${id}_s${k} += ${id}_a2 * ${w(k)}; ${id}_n${k} += ${w(k)};\n`),
        close,
      );
      // Each sector's average and variance; blended, each weighted by (least variance ÷ its own) ^ (Sharpness ÷ 2).
      for (let k = 0; k < 8; k++) {
        L.push(
          `    ${id}_n${k} = max(${id}_n${k}, 1.0e-6);\n    ${id}_m${k} /= ${id}_n${k};\n`,
          `    float ${id}_sg${k} = dot(abs(${id}_s${k} / ${id}_n${k} - ${id}_m${k} * ${id}_m${k}), vec3(1.0));\n`,
        );
      }
      const sg = (k: number) => `${id}_sg${k}`;
      L.push(
        `    float ${id}_lo = min(min(min(${sg(0)}, ${sg(1)}), min(${sg(2)}, ${sg(3)})), min(min(${sg(4)}, ${sg(5)}), min(${sg(6)}, ${sg(7)})));\n`,
        `    float ${id}_hq = 0.5 * ${p(P.sharpness, 8)};\n`,
        `    vec3 ${id}_k = vec3(0.0);\n    float ${id}_ws = 0.0;\n    float ${id}_var = 0.0;\n    float ${id}_wk = 0.0;\n`,
        ...[0, 1, 2, 3, 4, 5, 6, 7].map(k => `    ${id}_wk = pow((${id}_lo + 0.0001) / (${sg(k)} + 0.0001), ${id}_hq); ${id}_k += ${id}_m${k} * ${id}_wk; ${id}_ws += ${id}_wk; ${id}_var += ${sg(k)} * ${id}_wk;\n`),
        `    ${id}_k /= ${id}_ws;\n    ${id}_var /= ${id}_ws;\n`,
      );
    }
    L.push(`    vec3 ${id}_out = mix(${id}_c, ${id}_k, ${p(P.mix, 1)});\n`);
    return { code: L.join(''), outputVars: outs };
  },
}, ['radius', 'sharpness', 'spacing', 'mix']);
