/**
 * Pass (render to texture) and the nodes that sample a Pass's texture.
 * See docs/pass-node-plan.md.
 *
 * A graph is normally one fragment shader, so no node can look at the pixel
 * next door in something the graph has just made. A Pass node changes that
 * when it is added: everything wired into it is drawn first into a texture of
 * its own, and nodes after it sample that texture anywhere (an offset, a blur,
 * edges). The compiler cuts the graph at Pass nodes (compiler/passGraph.ts);
 * a graph without one compiles exactly as before.
 *
 * Here the Pass node is only ever compiled as a SOURCE: in every program that
 * reads it, the compiler swaps it for a copy with no inputs, whose GLSL reads
 * its texture. Its own program ends in a Pass output (passOutput) instead.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { fieldFn, p, withNewOutputs } from './helpers';
import { DM_CHANNELS, DM_CHANNEL_LABELS, DM_GLSL, DM_HINTS, dmChannelGlsl } from '../../play/kit/displace.js';

/** The sampler a Pass's picture is bound to, named by its slug (as its uniforms are). */
export const passUniform = (slug: string) => `u_pass_${slug}`;
/** The sampler holding the Pass's picture from the frame before (its Previous output). */
export const passPrevUniform = (slug: string) => `u_passprev_${slug}`;
/**
 * One picture pixel in the texture's 0–1 coordinates (1 / the picture's size),
 * declared next to each Pass sampler. Sampling nodes measure offsets with it,
 * so a 4-pixel blur is 4 pixels of the final picture at any Pass Scale.
 */
export const passPxUniform = (sampler: string) => `${sampler}_px`;
/**
 * A repeated Pass's step (phase 7, Repeat): x = which repeat is drawing (0 first),
 * y = how many. A vec2 so both hosts set it as they set the `_px` uniforms.
 * Declared only by a Pass whose Repeat is above 1.
 */
export const passIterUniform = (slug: string) => `u_passiter_${slug}`;
/** Most times a Pass can repeat in a frame. */
export const MAX_PASS_REPEAT = 64;
/** A Pass's Repeat as a whole number, 1 to MAX_PASS_REPEAT (1 when unset). */
export function passRepeat(v: unknown): number {
  const n = typeof v === 'number' && isFinite(v) ? Math.round(v) : 1;
  return Math.max(1, Math.min(MAX_PASS_REPEAT, n));
}


/** Settings of a Pass that the engine reads (they never change the shader). */
export const PASS_SCALES: Record<string, number> = { '1': 1, '0.5': 0.5, '0.25': 0.25, '0.125': 0.125 };

const PASS_STEP_OUTPUTS: GraphNode['outputs'] = {
  step: { type: 'float', label: 'Step', hint: 'With Repeat above 1: which repeat is drawing, 0 on the first, Repeat − 1 on the last (0 when Repeat is 1). Use it to start a jump flood from the shape on step 0, or to halve a reach each step.' },
  steps: { type: 'float', label: 'Steps', hint: 'Repeat, as a number.' },
};

export const PassNode: NodeDefinition = {
  type: 'pass',
  label: 'Pass',
  category: 'Passes',
  aliases: ['Render to texture', 'Buffer', 'TOP', 'Cache', 'FBO', 'Feedback buffer'],
  description: 'Draws everything wired into it into a texture of its own first, so the nodes after it can look around in that picture: sample it at an offset, blur it, find its edges, glow it. Wire Texture into Sample, Edges, Blur or Glow (texture). Color and Alpha are the texture at this pixel, so a Pass can also sit in an ordinary chain.',
  inputs: {
    color: { type: 'vec3', label: 'Color', hint: 'What to draw into the texture.' },
    alpha: { type: 'float', label: 'Alpha', defaultValue: 1, hint: 'Stored with the colour (1 when unwired).' },
  },
  // Color first: dropped onto a colour wire, a Pass sits in the chain (wire insert takes the first output).
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The texture at this pixel.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'The texture\'s alpha at this pixel.' },
    texture: { type: 'texture', label: 'Texture', hint: 'The picture as a texture: wire it into Sample, Edges, Blur or Glow (texture).' },
    previous: { type: 'texture', label: 'Previous', hint: 'This Pass\'s own picture from the frame before (feedback). Sample it, warp it and mix it back into this Pass\'s input for trails, smoke and reaction-diffusion. With Repeat above 1, inside the pass it is the step before.' },
    ...PASS_STEP_OUTPUTS,
  },
  defaultParams: { scale: '1', format: 'half', filter: 'linear', wrap: 'clamp', repeat: 1 },
  syncSockets: withNewOutputs(PASS_STEP_OUTPUTS),
  paramDefs: {
    repeat: { label: 'Repeat', type: 'float', min: 1, max: MAX_PASS_REPEAT, step: 1, hard: true, compileTime: true, hint: 'Draw this pass several times each frame, each time reading its own last result through Previous: a wide blur in small steps, a jump-flood distance field, a simulation stepped faster. Costs Repeat × the pass\'s time.' },
    scale: { label: 'Scale', type: 'select', hint: 'Size of the texture relative to the picture. ½ or ¼ makes wide blurs and glows cheap (and softer).', options: [
      { value: '1', label: '1 (full size)' }, { value: '0.5', label: '½' }, { value: '0.25', label: '¼' }, { value: '0.125', label: '⅛' },
    ] },
    format: { label: 'Format', type: 'select', hint: 'Half float keeps brightness above 1, so glows don\'t clip. 8-bit uses half the memory.', options: [
      { value: 'half', label: 'Half float' }, { value: 'byte', label: '8-bit' },
    ] },
    filter: { label: 'Filter', type: 'select', hint: 'Linear blends between texels; Nearest keeps them sharp (pixel art).', options: [
      { value: 'linear', label: 'Linear' }, { value: 'nearest', label: 'Nearest' },
    ] },
    wrap: { label: 'Edges', type: 'select', hint: 'What a read past the edge of the texture sees.', options: [
      { value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' },
    ] },
  },
  assignable: false,
  // Compiled as a source only (see the file comment): node.id is the slug.
  declarationsFor: (node: GraphNode) => {
    const tex = passUniform(node.id), prev = passPrevUniform(node.id);
    return [
      `uniform sampler2D ${tex};`, `uniform vec2 ${passPxUniform(tex)};`,
      `uniform sampler2D ${prev};`, `uniform vec2 ${passPxUniform(prev)};`,
      // Repeat (phase 7): only a repeated Pass declares its step, so every other program reads as before.
      ...(passRepeat(node.params.repeat) > 1 ? [`uniform vec2 ${passIterUniform(node.id)};`] : []),
    ];
  },
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    const tex = passUniform(id);
    return {
      // Reads as expressions, not statements: a program that only wants this Pass's Previous (its
      // own feedback) never reads the texture it is drawing into. vUv is 0–1 over the picture in
      // every program, whatever its size.
      code: '',
      outputVars: {
        texture: tex, color: `texture2D(${tex}, vUv).rgb`, alpha: `texture2D(${tex}, vUv).a`, previous: passPrevUniform(id),
        // Repeat: the step drawing now (a uniform the host sets before each draw), and how many.
        step: passRepeat(node.params.repeat) > 1 ? `${passIterUniform(id)}.x` : '0.0',
        steps: `${passRepeat(node.params.repeat)}.0`,
      },
    };
  },
};

/** The end of a Pass's own program: what it draws into its texture. Made by the compiler; never in a graph. */
export const PassOutputNode: NodeDefinition = {
  type: 'passOutput',
  label: 'Pass output',
  category: 'Output',
  description: 'Internal: the colour and alpha a Pass draws into its texture.',
  inputs: {
    color: { type: 'vec3', label: 'Color' },
    alpha: { type: 'float', label: 'Alpha', defaultValue: 1 },
  },
  outputs: {},
  generateGLSL: (_node: GraphNode, inputVars) => ({
    code: `    gl_FragColor = vec4(${inputVars.color || 'vec3(0.0)'}, ${inputVars.alpha || '1.0'});\n`,
    outputVars: {},
  }),
};

// ── Sampling nodes ───────────────────────────────────────────────────────────
// Each takes a `texture` input: the sampler name a Pass (or its Previous
// output) hands it. Unwired, it reads transparent black. UV works as on
// Texture Input: the picture's centred coordinates (g_uv) by default, so a
// warp wired into UV warps the read.

const LUMA = 'vec3(0.299, 0.587, 0.114)';
const TEX_HINT = 'A Pass\'s Texture (or Previous) output. Unwired, this reads black.';
const UV_HINT = 'Where to read, in picture coordinates. Leave empty for this pixel; wire a warp to bend the read.';

/** `uv` (centred picture coordinates) → 0–1 texture coordinates. */
const texUv = (uv: string) => `(${uv} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5)`;

/** A blur's Vogel-disc taps, Gaussian-weighted: `${id}_acc` ends up the blurred texel. */
function vogelBlur(id: string, tex: string, uv: string, radius: string, taps: number, sample: (s: string) => string = s => s): string {
  return [
    `    vec4 ${id}_acc = vec4(0.0);\n`,
    `    float ${id}_wsum = 0.0;\n`,
    `    for (int ${id}_i = 0; ${id}_i < ${taps}; ${id}_i++) {\n`,
    `        float ${id}_r = sqrt((float(${id}_i) + 0.5) / ${taps}.0);\n`,
    `        float ${id}_a = float(${id}_i) * 2.39996323;\n`,
    `        float ${id}_w = exp(-2.5 * ${id}_r * ${id}_r);\n`,
    `        vec4 ${id}_t = texture2D(${tex}, ${uv} + vec2(cos(${id}_a), sin(${id}_a)) * ${id}_r * ${radius} * ${passPxUniform(tex)});\n`,
    `        ${id}_acc += ${sample(`${id}_t`)} * ${id}_w;\n`,
    `        ${id}_wsum += ${id}_w;\n`,
    `    }\n`,
    `    ${id}_acc /= ${id}_wsum;\n`,
  ].join('');
}

const QUALITY = { label: 'Quality', type: 'select' as const, hint: 'Taps per pixel: more is smoother and slower. For wide blurs, set the Pass upstream to ½ instead.', options: [
  { value: '12', label: 'Draft (12)' }, { value: '24', label: 'Good (24)' }, { value: '48', label: 'Best (48)' },
] };
const tapsOf = (v: unknown) => (v === '12' || v === '48' ? Number(v) : 24);

export const SampleTextureNode: NodeDefinition = {
  type: 'sampleTexture',
  label: 'Sample (texture)',
  category: 'Passes',
  aliases: ['Read texture', 'Texture lookup', 'Offset', 'texture2D'],
  description: 'Reads a Pass\'s texture at this pixel, shifted by Offset (in picture pixels), or wherever UV says. The building block for displacement and feedback: warp the UV, or read a Pass\'s Previous output.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
  },
  defaultParams: { offsetX: 0, offsetY: 0 },
  paramDefs: {
    offsetX: { label: 'Offset X', type: 'float', min: -50, max: 50, step: 0.5, hint: 'Shift the read sideways, in picture pixels.' },
    offsetY: { label: 'Offset Y', type: 'float', min: -50, max: 50, step: 0.5, hint: 'Shift the read up or down, in picture pixels.' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const tex = inputVars.texture;
    const code = tex
      ? `    vec4 ${id}_s = texture2D(${tex}, ${texUv(inputVars.uv ?? 'g_uv')} + vec2(${p(node.params.offsetX, 0)}, ${p(node.params.offsetY, 0)}) * ${passPxUniform(tex)});\n`
      : `    vec4 ${id}_s = vec4(0.0);\n`;
    return { code, outputVars: { color: `${id}_s.rgb`, alpha: `${id}_s.a` } };
  },
};

export const EdgesTextureNode: NodeDefinition = {
  type: 'edgesTexture',
  label: 'Edges (texture)',
  category: 'Passes',
  aliases: ['Sobel (texture)', 'Edge detect', 'Outline', 'Find edges', 'Contours'],
  description: 'Finds the edges in a Pass\'s texture: a 3×3 Sobel filter on its brightness, reading the pixels around this one. Edges is how strong the edge is here (0–1), Direction which way the brightness rises, Color the picture\'s own colour on its edges. Feed it into another Pass to blur or glow the outlines.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
  },
  outputs: {
    edges: { type: 'float', label: 'Edges', hint: 'Edge strength, 0–1.' },
    direction: { type: 'vec2', label: 'Direction', hint: 'Which way the brightness rises (unit length on an edge, zero on flat areas).' },
    color: { type: 'vec3', label: 'Color', hint: 'The texture\'s colour, kept only on its edges.' },
  },
  defaultParams: { strength: 2, width: 1 },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: 0, max: 10, step: 0.05, hint: 'Gain on the edge strength. Raise it for faint edges.' },
    width: { label: 'Width', type: 'float', min: 0.5, max: 8, step: 0.25, hint: 'How far apart the 3×3 reads are, in picture pixels: wider finds bolder, softer edges.' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const tex = inputVars.texture;
    if (!tex) {
      return {
        code: `    float ${id}_edges = 0.0;\n    vec2 ${id}_dir = vec2(0.0);\n    vec3 ${id}_color = vec3(0.0);\n`,
        outputVars: { edges: `${id}_edges`, direction: `${id}_dir`, color: `${id}_color` },
      };
    }
    const at = (i: number, j: number) => `dot(texture2D(${tex}, ${id}_uv + vec2(${i}.0, ${j}.0) * ${id}_d).rgb, ${LUMA})`;
    const code = [
      `    vec2 ${id}_uv = ${texUv(inputVars.uv ?? 'g_uv')};\n`,
      `    vec2 ${id}_d = ${passPxUniform(tex)} * ${p(node.params.width, 1)};\n`,
      `    float ${id}_tl = ${at(-1, 1)}; float ${id}_t = ${at(0, 1)}; float ${id}_tr = ${at(1, 1)};\n`,
      `    float ${id}_l = ${at(-1, 0)}; float ${id}_r = ${at(1, 0)};\n`,
      `    float ${id}_bl = ${at(-1, -1)}; float ${id}_b = ${at(0, -1)}; float ${id}_br = ${at(1, -1)};\n`,
      `    vec2 ${id}_g = vec2(${id}_tr + 2.0 * ${id}_r + ${id}_br - ${id}_tl - 2.0 * ${id}_l - ${id}_bl,\n`,
      `                        ${id}_tl + 2.0 * ${id}_t + ${id}_tr - ${id}_bl - 2.0 * ${id}_b - ${id}_br);\n`,
      `    float ${id}_glen = length(${id}_g);\n`,
      `    float ${id}_edges = clamp(${id}_glen * ${p(node.params.strength, 2)}, 0.0, 1.0);\n`,
      `    vec2 ${id}_dir = ${id}_glen > 1e-5 ? ${id}_g / ${id}_glen : vec2(0.0);\n`,
      `    vec3 ${id}_color = texture2D(${tex}, ${id}_uv).rgb * ${id}_edges;\n`,
    ].join('');
    return { code, outputVars: { edges: `${id}_edges`, direction: `${id}_dir`, color: `${id}_color` } };
  },
};

export const BlurTextureNode: NodeDefinition = {
  type: 'blurTexture',
  label: 'Blur (texture)',
  category: 'Passes',
  aliases: ['Gaussian blur (texture)', 'Soften', 'Defocus', 'Blur this frame'],
  description: 'Blurs a Pass\'s texture in the same frame (the older Gaussian Blur reads last frame\'s picture). Radius is in picture pixels. For wide blurs, set the Pass feeding it to ½ or ¼: it is cheaper and softer.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
  },
  defaultParams: { radius: 8, quality: '24' },
  paramDefs: {
    radius: { label: 'Radius', type: 'float', min: 0, max: 64, step: 0.5, hint: 'How far the blur reaches, in picture pixels. Past about 12, set the Pass upstream to ½ for speed.' },
    quality: QUALITY,
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const tex = inputVars.texture;
    if (!tex) return { code: `    vec4 ${id}_acc = vec4(0.0);\n`, outputVars: { color: `${id}_acc.rgb`, alpha: `${id}_acc.a` } };
    const code = `    vec2 ${id}_uv = ${texUv(inputVars.uv ?? 'g_uv')};\n` + vogelBlur(id, tex, `${id}_uv`, p(node.params.radius, 8), tapsOf(node.params.quality));
    return { code, outputVars: { color: `${id}_acc.rgb`, alpha: `${id}_acc.a` } };
  },
};

export const GlowTextureNode: NodeDefinition = {
  type: 'glowTexture',
  label: 'Glow (texture)',
  category: 'Passes',
  aliases: ['Bloom (texture)', 'Halo', 'Light bleed', 'Glow this frame'],
  description: 'A glow from a Pass\'s texture, in the same frame: only the parts brighter than Threshold are kept, blurred by Radius (picture pixels) and scaled by Intensity. Add the result over your picture (Add Colors, Blend Modes: Add or Screen). The older Bloom reads last frame\'s picture.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
  },
  outputs: {
    glow: { type: 'vec3', label: 'Glow', hint: 'The light to add over the picture.' },
  },
  defaultParams: { threshold: 0.5, radius: 12, intensity: 1.5, quality: '24' },
  paramDefs: {
    threshold: { label: 'Threshold', type: 'float', min: 0, max: 2, step: 0.01, hint: 'Brightness a part needs to glow. 0 makes everything glow; above 1 only what is brighter than white (needs a half-float Pass).' },
    radius: { label: 'Radius', type: 'float', min: 0, max: 64, step: 0.5, hint: 'How far the glow spreads, in picture pixels. Past about 12, set the Pass upstream to ½ for speed.' },
    intensity: { label: 'Intensity', type: 'float', min: 0, max: 8, step: 0.05, hint: 'How bright the glow is.' },
    quality: QUALITY,
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const tex = inputVars.texture;
    if (!tex) return { code: `    vec3 ${id}_glow = vec3(0.0);\n`, outputVars: { glow: `${id}_glow` } };
    const thr = p(node.params.threshold, 0.5);
    // Each tap keeps only what is over the threshold (a soft knee 0.1 wide, so the cut doesn't ring).
    const keep = (s: string) => `vec4(${s}.rgb * smoothstep(${thr}, ${thr} + 0.1, dot(${s}.rgb, ${LUMA})), ${s}.a)`;
    const code = `    vec2 ${id}_uv = ${texUv(inputVars.uv ?? 'g_uv')};\n`
      + vogelBlur(id, tex, `${id}_uv`, p(node.params.radius, 12), tapsOf(node.params.quality), keep)
      + `    vec3 ${id}_glow = ${id}_acc.rgb * ${p(node.params.intensity, 1.5)};\n`;
    return { code, outputVars: { glow: `${id}_glow` } };
  },
};

export const DisplaceTextureNode: NodeDefinition = {
  type: 'displaceTexture',
  label: 'Displace (texture)',
  category: 'Passes',
  aliases: ['Displace by texture', 'Displacement map', 'Warp by texture', 'Refract'],
  description: 'Reads Texture with its UV pushed by a second texture, Map: Map\'s red and green, centred on 0.5, move the read sideways and up by Amount (in picture pixels). Heat haze, glass and liquid looks; with a Pass\'s Previous as Texture, smoke and flow.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    map: { type: 'texture', label: 'Map', hint: 'A Pass whose red and green say where to push the read (0.5 = stay). Unwired, nothing moves.' },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
  },
  defaultParams: { amount: 20 },
  paramDefs: {
    amount: { label: 'Amount', type: 'float', min: -100, max: 100, step: 0.5, hint: 'How far the map pushes the read, in picture pixels, for a full swing of red or green.' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const tex = inputVars.texture;
    if (!tex) return { code: `    vec4 ${id}_s = vec4(0.0);\n`, outputVars: { color: `${id}_s.rgb`, alpha: `${id}_s.a` } };
    const map = inputVars.map;
    const code = [
      `    vec2 ${id}_uv = ${texUv(inputVars.uv ?? 'g_uv')};\n`,
      map
        ? `    vec2 ${id}_push = (texture2D(${map}, ${id}_uv).rg - 0.5) * 2.0 * ${p(node.params.amount, 20)} * ${passPxUniform(tex)};\n`
        : `    vec2 ${id}_push = vec2(0.0);\n`,
      `    vec4 ${id}_s = texture2D(${tex}, ${id}_uv + ${id}_push);\n`,
    ].join('');
    return { code, outputVars: { color: `${id}_s.rgb`, alpha: `${id}_s.a` } };
  },
};

// ── Displacement Map (After Effects) ─────────────────────────────────────────

const DM_CHANNEL_SELECT = DM_CHANNELS.map(c => ({ value: c, label: DM_CHANNEL_LABELS[c] }));

/**
 * After Effects' Displacement Map: the Source is read where the Map's channels
 * push it (play/kit/displace.js has the rules, shared with Play's layers and
 * the Look). The Source is either a texture (a Pass, or anything that hands a
 * sampler) or a field chain read at the shifted position (field sockets: any
 * chain that is a pure function of position, such as noise, shapes, Texture
 * Input). A chain that isn't (previous frame, particles, Play layers) is
 * refused on the card: put a Pass after it and wire its Texture instead.
 */
export const DisplacementMapNode: NodeDefinition = {
  type: 'displacementMap',
  label: 'Displacement Map',
  category: 'Passes',
  aliases: ['Displace by map', 'AE displacement map', 'Displace channels', 'Displacement', 'Map displace'],
  description: 'After Effects’ Displacement Map: moves the Source by the Map’s colours. One channel of the Map (red, green, blue, alpha, luminance, hue, lightness, saturation, or a fixed amount) pushes sideways, another up and down; mid-grey stays put, white pushes the full Max, black the full Max the other way. Source can be a texture (a Pass) or any colour chain that is a function of position (noise, shapes, Texture Input), read at the pushed place. A chain that reads the previous frame or particles can’t be read elsewhere: put a Pass after it and wire its Texture.',
  inputs: {
    source: { type: 'vec3', label: 'Source ƒ', field: true, hint: 'A colour chain (noise, shapes, Texture Input…), read at the pushed position. Used when Source texture is not wired. A Pass\'s Color here reads this pixel only: wire its Texture into Source texture instead.' },
    sourceTex: { type: 'texture', label: 'Source texture', hint: 'A Pass\'s Texture: the picture to push. Wins over Source ƒ.' },
    map: { type: 'vec3', label: 'Map', hint: 'The colour whose channels push the Source, at this pixel (any chain). Unwired: mid-grey, nothing moves.' },
    mapAlpha: { type: 'float', label: 'Map alpha', defaultValue: 1, hint: 'The Map\'s alpha (the Alpha channel reads it; colour channels fade to no push where it is 0). 1 when unwired.' },
    mapTex: { type: 'texture', label: 'Map texture', hint: 'A Pass\'s Texture as the Map (its colour and alpha). Wins over Map.' },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The Source, pushed.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'The Source texture\'s alpha where it was read (1 for a Source ƒ chain).' },
  },
  defaultParams: { hChan: 'red', vChan: 'green', maxH: 50, maxV: 50, edges: 'clamp' },
  paramDefs: {
    hChan: { label: 'Horizontal', type: 'select', options: DM_CHANNEL_SELECT, hint: 'Use for horizontal displacement.', help: `${DM_HINTS.h} ${DM_HINTS.channels}` },
    vChan: { label: 'Vertical', type: 'select', options: DM_CHANNEL_SELECT, hint: 'Use for vertical displacement.', help: `${DM_HINTS.v} ${DM_HINTS.channels}` },
    maxH: { label: 'Max horizontal', type: 'float', min: -300, max: 300, step: 0.5, hint: 'Pixels (of a 1080-tall picture) a full channel pushes sideways.', help: DM_HINTS.maxH },
    maxV: { label: 'Max vertical', type: 'float', min: -300, max: 300, step: 0.5, hint: 'Pixels (of a 1080-tall picture) a full channel pushes up or down.', help: DM_HINTS.maxV },
    edges: { label: 'Edges', type: 'select', hint: 'What a read pushed past the edge of the picture sees.', help: 'Clamp: the nearest edge pixel (a texture) or the chain past the edge (a Source ƒ chain goes on forever). Wrap pixels around: the other side of the picture, as After Effects\' Wrap Pixels Around.', options: [
      { value: 'clamp', label: 'Clamp' }, { value: 'wrap', label: 'Wrap pixels around' },
    ] },
  },
  glslFunction: DM_GLSL,
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const base = inputVars.uv ?? 'g_uv';
    const aspect = '(u_resolution.x / u_resolution.y)';
    const wrap = node.params.edges === 'wrap';
    const m = `${id}_m`;
    const lines: string[] = [];
    lines.push(inputVars.mapTex
      ? `    vec4 ${m} = texture2D(${inputVars.mapTex}, ${texUv(base)});\n`
      : `    vec4 ${m} = vec4(${inputVars.map ?? 'vec3(0.5)'}, ${inputVars.mapAlpha ?? '1.0'});\n`);
    // How far, in 0–1 picture coordinates (y up); mid-grey = 0.
    lines.push(`    vec2 ${id}_d = dmOffset(${dmChannelGlsl(String(node.params.hChan ?? 'red'), m)}, ${dmChannelGlsl(String(node.params.vChan ?? 'green'), m)}, vec2(${p(node.params.maxH, 50)}, ${p(node.params.maxV, 50)}), ${aspect});\n`);
    const fn = fieldFn(inputVars.source);
    if (inputVars.sourceTex) {
      lines.push(`    vec2 ${id}_q = ${texUv(base)} - ${id}_d;\n`);
      lines.push(wrap ? `    ${id}_q = fract(${id}_q);\n` : `    ${id}_q = clamp(${id}_q, 0.0, 1.0);\n`);
      lines.push(`    vec4 ${id}_s = texture2D(${inputVars.sourceTex}, ${id}_q);\n`);
    } else if (fn) {
      // The chain at the pushed place, in the picture's centred coordinates (a picture height = 2).
      lines.push(`    vec2 ${id}_q = ${base} - ${id}_d * vec2(2.0 * ${aspect}, 2.0);\n`);
      if (wrap) lines.push(`    ${id}_q = mod(${id}_q + vec2(${aspect}, 1.0), vec2(2.0 * ${aspect}, 2.0)) - vec2(${aspect}, 1.0);\n`);
      lines.push(`    vec4 ${id}_s = vec4(${fn}(${id}_q, vec2(0.0), 0.0, 0.0), 1.0);\n`);
    } else {
      // Nothing to push: transparent black (the push is still worked out, so its sliders stay live).
      lines.push(`    vec4 ${id}_s = vec4(0.0, 0.0, 0.0, 0.0 * ${id}_d.x);\n`);
    }
    return { code: lines.join(''), outputVars: { color: `${id}_s.rgb`, alpha: `${id}_s.a` } };
export const JumpFloodTextureNode: NodeDefinition = {
  type: 'jumpFloodTexture',
  label: 'Jump flood (texture)',
  category: 'Passes',
  aliases: ['JFA', 'Jump flooding', 'Distance field (texture)', 'Nearest seed', 'Voronoi (texture)'],
  description: 'One step of a jump flood, the fast way to turn a shape into a distance field: reads the texture at this pixel and 8 places Reach picture pixels round it, where each pixel holds the place of a seed (red, green: a point in picture coordinates; blue 1: a seed is known), and keeps the nearest. Put it in a Pass that reads its own Previous with Repeat set (8 to 11), halving Reach each step, and every pixel ends up knowing the nearest point of the shape. Use a half-float Pass with Filter Nearest.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'A Pass whose pixels hold seeds (usually its own Previous). Unwired, nothing is found.' },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
    reach: { type: 'float', label: 'Reach', hint: 'How far the 8 reads are, in picture pixels. In a repeated Pass wire a reach that halves each Step (from about half the picture down to 1 pass pixel).' },
  },
  outputs: {
    seed: { type: 'vec3', label: 'Seed', hint: 'The nearest seed found: its place (x, y, picture coordinates) and 1 in z, or 0 everywhere when none was. Wire it back into the Pass.' },
    distance: { type: 'float', label: 'Distance', hint: 'How far this pixel is from that seed, in picture units (the picture is 2 tall). 4 when none was found.' },
  },
  defaultParams: { reach: 1 },
  paramDefs: {
    reach: { label: 'Reach', type: 'float', min: 0, max: 1024, step: 1, hint: 'How far the 8 reads are, in picture pixels (when Reach isn\'t wired).' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const tex = inputVars.texture;
    if (!tex) return { code: `    vec3 ${id}_seed = vec3(0.0);\n    float ${id}_dist = 4.0;\n`, outputVars: { seed: `${id}_seed`, distance: `${id}_dist` } };
    const here = inputVars.uv ?? 'g_uv';
    const code = [
      `    vec2 ${id}_here = ${here};\n`,
      `    vec2 ${id}_uv = ${texUv(here)};\n`,
      `    vec2 ${id}_step = ${passPxUniform(tex)} * ${inputVars.reach ?? p(node.params.reach, 1)};\n`,
      `    vec3 ${id}_seed = vec3(0.0);\n`,
      `    float ${id}_best = 1e9;\n`,
      `    for (int ${id}_j = -1; ${id}_j <= 1; ${id}_j++) {\n`,
      `        for (int ${id}_i = -1; ${id}_i <= 1; ${id}_i++) {\n`,
      `            vec3 ${id}_s = texture2D(${tex}, ${id}_uv + vec2(float(${id}_i), float(${id}_j)) * ${id}_step).rgb;\n`,
      `            vec2 ${id}_d = ${id}_s.xy - ${id}_here;\n`,
      `            float ${id}_dd = dot(${id}_d, ${id}_d);\n`,
      `            if (${id}_s.z > 0.5 && ${id}_dd < ${id}_best) { ${id}_best = ${id}_dd; ${id}_seed = vec3(${id}_s.xy, 1.0); }\n`,
      `        }\n`,
      `    }\n`,
      `    float ${id}_dist = ${id}_seed.z > 0.5 ? sqrt(${id}_best) : 4.0;\n`,
    ].join('');
    return { code, outputVars: { seed: `${id}_seed`, distance: `${id}_dist` } };
  },
};
