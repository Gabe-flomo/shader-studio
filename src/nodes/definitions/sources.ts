import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { audioUniformName } from '../../compiler/audioUniformNames';
import { p, withNewOutputs } from './helpers';
import { clipGlsl, clipOutputSize, cleanTransform, isIdentity, parseSavedClip } from '../../lib/media/clip';

/**
 * Loop Index — outputs the current iteration counter `i` when placed inside
 * an iterated group (iterations > 1).  The compiler replaces the placeholder
 * GLSL with the actual loop variable at code-generation time.
 * Outside an iterated group it safely outputs 0.0.
 */
export const LoopIndexNode: NodeDefinition = {
  type: 'loopIndex',
  label: 'Loop Index',
  category: 'Sources',
  description: 'Current iteration index (float i) — place inside a group with iterations > 1. Use with an iterated group or Loop Carry; outside a loop it always outputs 0.',
  inputs: {},
  outputs: {
    i: { type: 'float', label: 'i' },
  },
  generateGLSL: (node: GraphNode) => {
    // Default codegen (single-pass / preview context): emit 0.0.
    // The iterated-group compiler overrides nodeOutputs for this node type
    // before calling generateGLSL, so this fallback is rarely reached.
    const outVar = `${node.id}_loopidx`;
    return {
      code: `    float ${outVar} = 0.0;\n`,
      outputVars: { i: outVar },
    };
  },
};

export const UVNode: NodeDefinition = {
  type: 'uv',
  label: 'UV',
  category: 'Sources',
  description: 'Centered, aspect-corrected UV coordinates',
  inputs: {},
  outputs: {
    uv: { type: 'vec2', label: 'UV' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_uv`;
    // Inside a field function (a chain wired into a field socket) the UV is
    // the function's position parameter, which is named g_uv.
    if (inputVars?.__inField === '1') return { code: `    vec2 ${outVar} = g_uv;\n`, outputVars: { uv: outVar } };
    return {
      code: `    vec2 ${outVar} = (vUv - 0.5) * 2.0;\n    ${outVar}.x *= u_resolution.x / u_resolution.y;\n`,
      outputVars: { uv: outVar },
    };
  },
};

export const TimeNode: NodeDefinition = {
  type: 'time',
  label: 'Time',
  category: 'Sources',
  description: 'Current time in seconds',
  inputs: {},
  outputs: {
    time: { type: 'float', label: 'Time' },
  },
  generateGLSL: (node: GraphNode) => {
    const outVar = `${node.id}_time`;
    return {
      code: `    float ${outVar} = u_time;\n`,
      outputVars: { time: outVar },
    };
  },
};

export const PixelUVNode: NodeDefinition = {
  type: 'pixelUV',
  label: 'Pixel UV',
  category: 'Sources',
  description: 'Raw screen UV: fragCoord / resolution.y. Origin at bottom-left, x reaches aspect ratio. Use this for shaders that work in pixel-ratio space rather than centered UV.',
  inputs: {},
  outputs: {
    uv: { type: 'vec2', label: 'UV' },
  },
  generateGLSL: (node: GraphNode) => {
    const outVar = `${node.id}_uv`;
    return {
      code: `    vec2 ${outVar} = gl_FragCoord.xy / u_resolution.y;\n`,
      outputVars: { uv: outVar },
    };
  },
};

export const MouseNode: NodeDefinition = {
  type: 'mouse',
  label: 'Mouse',
  category: 'Sources',
  description: 'Mouse position in the same centered UV space as the UV node (aspect-corrected, origin = center). Returns vec2 UV, X float, and Y float, and the position in pixels (the space of Pixel Coordinates).',
  inputs: {},
  outputs: {
    uv: { type: 'vec2',  label: 'Mouse UV' },
    x:  { type: 'float', label: 'X'        },
    y:  { type: 'float', label: 'Y'        },
    px: { type: 'vec2',  label: 'Pixels'   },
  },
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    // u_mouse is in pixel coords (0=bottom-left, same as gl_FragCoord).
    // Convert to the same centered + aspect-corrected space as the UV node.
    // In a smaller Pass's program u_resolution is the pass's size, u_mouse still the picture's
    // pixels: the compiler hands the pass's scale (__pictureScale) so UV lands where the pointer is.
    // Pixels stays in picture pixels, as before.
    const sc = typeof node.params.__pictureScale === 'number' && node.params.__pictureScale !== 1 ? node.params.__pictureScale : null;
    const m = sc ? `(u_mouse * ${Number.isInteger(sc) ? `${sc}.0` : sc})` : 'u_mouse';
    return {
      code: [
        `    vec2 ${id}_uv = (${m} / u_resolution.y - vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5) * 2.0;\n`,
        `    float ${id}_x = ${id}_uv.x;\n`,
        `    float ${id}_y = ${id}_uv.y;\n`,
        `    vec2 ${id}_px = u_mouse;\n`,
      ].join(''),
      outputVars: { uv: `${id}_uv`, x: `${id}_x`, y: `${id}_y`, px: `${id}_px` },
    };
  },
};

export const FragCoordNode: NodeDefinition = {
  type: 'fragCoord',
  label: 'Pixel Coordinates', aliases: ['Frag Coord'],
  category: 'Sources',
  description: 'Raw fragment pixel coordinates (gl_FragCoord.xy). Origin at bottom-left corner, in pixels.',
  inputs: {},
  outputs: {
    coord: { type: 'vec2', label: 'Coord' },
  },
  generateGLSL: (node: GraphNode) => {
    const outVar = `${node.id}_coord`;
    return {
      code: `    vec2 ${outVar} = gl_FragCoord.xy;\n`,
      outputVars: { coord: outVar },
    };
  },
};

export const ResolutionNode: NodeDefinition = {
  type: 'resolution',
  label: 'Resolution',
  category: 'Sources',
  description: 'Canvas resolution in pixels (width, height).',
  inputs: {},
  outputs: {
    res:    { type: 'vec2',  label: 'Resolution' },
    width:  { type: 'float', label: 'Width'      },
    height: { type: 'float', label: 'Height'     },
  },
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    return {
      code: [
        `    vec2  ${id}_res    = u_resolution;\n`,
        `    float ${id}_width  = u_resolution.x;\n`,
        `    float ${id}_height = u_resolution.y;\n`,
      ].join(''),
      outputVars: { res: `${id}_res`, width: `${id}_width`, height: `${id}_height` },
    };
  },
};

export const PrevFrameNode: NodeDefinition = {
  type: 'prevFrame',
  label: 'Previous Frame (Feedback)', aliases: ['Prev Frame'],
  category: 'Post Processing',
  description: 'Samples the previous frame\'s rendered output. Enables stateful effects like trails, reaction-diffusion, and fluid simulation. Use with Mix or Max to blend it under the current frame for trails; requires the stateful feedback pass.',
  inputs: {
    uv: { type: 'vec2', label: 'UV', hint: 'Where to sample last frame. Warp it slightly to make trails drift.' },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
    uv:    { type: 'vec2',  label: 'UV (pass-through)' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const uvVar = inputVars.uv ?? 'g_uv';
    // Convert centered UV back to [0,1] for texture sampling
    const samplerUV = `(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5)`;
    return {
      code: [
        `    vec4 ${id}_prev = texture2D(u_prevFrame, clamp(${samplerUV}, 0.0, 1.0));\n`,
        `    vec3 ${id}_color = ${id}_prev.rgb;\n`,
        `    float ${id}_alpha = ${id}_prev.a;\n`,
      ].join(''),
      outputVars: { color: `${id}_color`, alpha: `${id}_alpha`, uv: uvVar },
    };
  },
};

/** Phase 7 (docs/pass-node-plan.md): the image or video itself as a texture, straight into the sampling nodes. */
const TEXTURE_INPUT_TEXTURE: GraphNode['outputs'] = {
  texture: { type: 'texture', label: 'Texture', hint: 'The image itself as a texture: wire it into Sample, Edges, Blur, Glow or Displace (texture), a Texture tool (Mask, Levels, Flow, Neighbours), or Particles\' Emit from, with no copy Pass in between. It covers the picture as Stretch does (Fit doesn\'t apply).' },
};
const VIDEO_INPUT_TEXTURE: GraphNode['outputs'] = {
  texture: { type: 'texture', label: 'Texture', hint: 'The video itself as a texture: wire it into Sample, Edges, Blur, Glow or Displace (texture), a Texture tool (Mask for a colour key, Levels, Neighbours), or Particles\' Emit from, with no copy Pass in between. For Change (what moved), draw it into a Pass first.' },
};

/**
 * The Texture node (docs/texture-node.md): one card for a picture, a video or the webcam.
 *
 * It keeps the two engine types it always had: a picture is a `textureInput` (sampler
 * `u_tex_<slug>`), a video or the webcam a `videoInput` (sampler `u_vid_<slug>`). The
 * card's Image / Video / Webcam switch swaps the type in place (lib/texture/textureSource.ts):
 * same id, same sockets, wires kept. Only Texture Input is offered by the node browser
 * (labelled Texture); Video Input stays registered for every saved graph and for the switch.
 *
 * Picture extras (crop / rotate / flip in `clip`, `tile`, `wrap`, `filter`) emit code only when
 * set, so every graph saved before compiles to the same shader.
 */
export const TEXTURE_WRAPS = ['clamp', 'repeat', 'mirror'] as const;
export type TextureWrap = typeof TEXTURE_WRAPS[number];
export const textureWrapOf = (v: unknown): TextureWrap => (v === 'repeat' || v === 'mirror' ? v : 'clamp');
export const textureTileOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(64, v) : 1);

/** The picture's aspect after its crop / rotate (what Fit and Fill keep). */
export function croppedAspect(aspect: number, rawClip: unknown): number {
  const c = parseSavedClip(rawClip);
  const xf = c ? cleanTransform(c) : null;
  if (!xf || isIdentity(xf)) return aspect;
  const [w, h] = clipOutputSize(aspect * 1000, 1000, xf);
  return h > 0 ? w / h : aspect;
}

export const TextureInputNode: NodeDefinition = {
  type: 'textureInput',
  label: 'Texture',
  aliases: ['Texture Input', 'Image', 'Picture', 'Video', 'Webcam', 'Camera', 'Shadertoy channel'],
  category: 'Sources',
  description: 'A picture, a video or the webcam as a texture. Upload or drop a file, pick one from the library, paste an image URL, or turn the webcam on. Wire to UV for where to sample. Fit: Stretch fills the UV space exactly (may distort), Fit shows the whole picture with padding, Fill covers the space and crops.',
  inputs: {
    uv: { type: 'vec2', label: 'UV' },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
    uv:    { type: 'vec2',  label: 'UV (pass-through)' },
    ...TEXTURE_INPUT_TEXTURE,
  },
  syncSockets: withNewOutputs(TEXTURE_INPUT_TEXTURE),
  defaultParams: { fit: 'stretch', _imageAspect: 1 },
  paramDefs: {
    fit: { label: 'Fit', type: 'select', hint: 'Stretch fills exactly, Fit shows the whole image with padding, Fill crops to cover.', options: [
      { value: 'stretch', label: 'Stretch' },
      { value: 'contain', label: 'Fit (no crop)' },
      { value: 'cover',   label: 'Fill (crop)' },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar = inputVars.uv ?? 'g_uv';
    // Map from centered [-aspect,aspect] × [-1,1] UV back to [0,1] UV for texture sampling
    const samplerUV = `(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5)`;
    const fit = typeof node.params.fit === 'string' ? node.params.fit : 'stretch';
    const rawAspect = typeof node.params._imageAspect === 'number' && node.params._imageAspect > 0
      ? node.params._imageAspect : 1;
    const imageAspect = croppedAspect(rawAspect, node.params.clip);

    let fitUV = samplerUV;
    let fitLines = '';
    if (fit === 'contain' || fit === 'cover') {
      // relAspect = image aspect relative to the current canvas aspect (the
      // canvas can change at runtime — window resize — so this is computed
      // in GLSL; which formula/axis to apply is a compile-time choice, so
      // no runtime branch is needed for stretch vs contain vs cover).
      const isContain = fit === 'contain';
      const scaleX = isContain
        ? `${id}_relAspect < 1.0 ? 1.0 / ${id}_relAspect : 1.0`
        : `${id}_relAspect > 1.0 ? 1.0 / ${id}_relAspect : 1.0`;
      const scaleY = isContain
        ? `${id}_relAspect > 1.0 ? ${id}_relAspect : 1.0`
        : `${id}_relAspect < 1.0 ? ${id}_relAspect : 1.0`;
      fitLines = [
        `    float ${id}_relAspect = ${imageAspect.toFixed(6)} / (u_resolution.x / u_resolution.y);\n`,
        `    vec2 ${id}_fitScale = vec2(${scaleX}, ${scaleY});\n`,
        `    vec2 ${id}_fitUV = (${samplerUV} - 0.5) * ${id}_fitScale + 0.5;\n`,
      ].join('');
      fitUV = `${id}_fitUV`;
    }
    // Tiling, wrap and the crop / rotate / flip: only when set (older graphs compile as before).
    const tile = textureTileOf(node.params.tile);
    const wrap = textureWrapOf(node.params.wrap);
    const xf = clipGlsl(id, `${id}_st`, node.params.clip);
    let sampleUV = `clamp(${fitUV}, 0.0, 1.0)`;
    let extra = '';
    if (tile !== 1 || wrap !== 'clamp' || xf.code) {
      const tiled = tile !== 1 ? `((${fitUV} - 0.5) * ${tile.toFixed(4)} + 0.5)` : fitUV;
      const wrapped = wrap === 'repeat' ? `fract(${tiled})`
        : wrap === 'mirror' ? `(1.0 - abs(mod(${tiled}, 2.0) - 1.0))`
          : `clamp(${tiled}, 0.0, 1.0)`;
      extra = `    vec2 ${id}_st = ${wrapped};\n${xf.code}`;
      sampleUV = xf.st;
    }
    return {
      code: [
        fitLines,
        extra,
        `    vec4 ${id}_sample = texture2D(u_tex_${id}, ${sampleUV});\n`,
        `    vec3 ${id}_color = ${id}_sample.rgb;\n`,
        `    float ${id}_alpha = ${id}_sample.a;\n`,
      ].join(''),
      // Texture: the image itself, for Sample / Edges / Blur / Glow / Displace (texture) and Particles' Emit
      // from, without a copy Pass (phase 7). Its `_px` is declared by the compiler only when this is wired.
      outputVars: { color: `${id}_color`, alpha: `${id}_alpha`, uv: uvVar, texture: `u_tex_${id}` },
    };
  },
};

export const AudioInputNode: NodeDefinition = {
  type: 'audioInput',
  label: 'Audio Input',
  category: 'Sources',
  description: 'Load an audio file and output per-band frequency amplitudes as floats (0–1). Add multiple bands or use Full Spectrum mode for overall volume.',
  inputs: {
    band_0_center: { type: 'float', label: 'Band 0 Hz', hint: 'Wire a float to move the band\'s center frequency live.' },
  },
  outputs: {
    amplitude_0: { type: 'float', label: 'Band 0' },
  },
  defaultParams: {
    freq_range:  200.0,
    mode: 'band',
    _bands: [200],
    _soloedBand: -1,
    _fileName: '',
    _hasFile: false,
  },
  paramDefs: {
    freq_range: { label: 'Freq Range (Hz)', type: 'float', min: 0, max: 10000, step: 1, hint: 'Frequency in Hz the band listens to. Bass sits near 60-250, highs above 4000.' },
    mode: { label: 'Mode', type: 'select', hint: 'Frequency Band reads one band; Full Spectrum outputs overall loudness.', options: [
      { value: 'band', label: 'Frequency Band' },
      { value: 'full', label: 'Full Spectrum'  },
    ]},
  },
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    const rawBands = node.params._bands;
    const bands: number[] = Array.isArray(rawBands) ? rawBands as number[] : [200];
    const soloedBand = typeof node.params._soloedBand === 'number' ? node.params._soloedBand : -1;
    const lines: string[] = [];
    const outputVars: Record<string, string> = {};
    for (let i = 0; i < bands.length; i++) {
      const outVar = `${id}_amplitude_${i}`;
      const muted = soloedBand >= 0 && soloedBand !== i;
      lines.push(`    float ${outVar} = ${muted ? '0.0' : audioUniformName(id, i)};\n`);
      outputVars[`amplitude_${i}`] = outVar;
    }
    return { code: lines.join(''), outputVars };
  },
};

export const VideoInputNode: NodeDefinition = {
  type: 'videoInput',
  // The Texture node's video and webcam side (see TextureInputNode): not offered by the browser.
  label: 'Texture',
  aliases: ['Video Input'],
  category: 'Sources',
  description: 'A video file played frame by frame, or the webcam (Source: Webcam), as a texture. Wire to UV for sampling position.',
  inputs: {
    uv: { type: 'vec2', label: 'UV' },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
    uv:    { type: 'vec2',  label: 'UV (pass-through)' },
    ...VIDEO_INPUT_TEXTURE,
  },
  syncSockets: withNewOutputs(VIDEO_INPUT_TEXTURE),
  defaultParams: {
    _fileName: '',
    _hasFile: false,
    _isPlaying: false,
    _loop: true,
    _speed: 1.0,
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uvVar = inputVars.uv ?? 'g_uv';
    const samplerUV = `(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5)`;
    // Clip settings' crop / rotate / flip (docs/clip-editor.md): only with a clip that turns or crops,
    // so every graph without one compiles exactly as before.
    const xf = clipGlsl(id, `${id}_vst`, node.params.clip);
    if (xf.code) {
      return {
        code: [
          `    vec2 ${id}_vst = clamp(${samplerUV}, 0.0, 1.0);\n`,
          xf.code,
          `    vec4 ${id}_sample = texture2D(u_vid_${id}, ${xf.st});\n`,
          `    vec3 ${id}_color = ${id}_sample.rgb;\n`,
          `    float ${id}_alpha = ${id}_sample.a;\n`,
        ].join(''),
        outputVars: { color: `${id}_color`, alpha: `${id}_alpha`, uv: uvVar, texture: `u_vid_${id}` },
      };
    }
    return {
      code: [
        `    vec4 ${id}_sample = texture2D(u_vid_${id}, clamp(${samplerUV}, 0.0, 1.0));\n`,
        `    vec3 ${id}_color = ${id}_sample.rgb;\n`,
        `    float ${id}_alpha = ${id}_sample.a;\n`,
      ].join(''),
      outputVars: { color: `${id}_color`, alpha: `${id}_alpha`, uv: uvVar, texture: `u_vid_${id}` },
    };
  },
};

export const ConstantNode: NodeDefinition = {
  type: 'constant',
  label: 'Constant',
  category: 'Sources',
  description: 'A constant value — float, or a vec2/vec3/vec4 built from sliders (pick the type on the card). Wire the input to override.',
  inputs: {
    value: { type: 'float', label: 'Value', hint: 'Overrides the slider when wired.' },
  },
  outputs: {
    value: { type: 'float', label: 'Value' },
  },
  // `outputType` is what the type pills on the card write (see
  // VECTORIZABLE_NODES / changeNodeVectorType); the sliders shown follow it.
  defaultParams: { value: 1.0, x: 0.0, y: 0.0, z: 0.0, w: 1.0, outputType: 'float' },
  // v2 added `outputType`. Constants saved before it were float-only, and without the param
  // every showWhen below fails: the Value slider disappears and `value` stops being a
  // fast-path uniform, so each slider tick recompiled the shader.
  version: 2,
  migrateParams: (params, fromVersion) =>
    fromVersion < 2 && typeof params.outputType !== 'string' ? { ...params, outputType: 'float' } : params,
  paramDefs: {
    value: { label: 'Value', type: 'float', step: 0.01, showWhen: { param: 'outputType', value: 'float' }, hint: 'The output when nothing is wired to the input.' },
    x:     { label: 'X',     type: 'float', step: 0.01, showWhen: { param: 'outputType', value: ['vec2', 'vec3', 'vec4'] }, hint: 'First component of the vector.' },
    y:     { label: 'Y',     type: 'float', step: 0.01, showWhen: { param: 'outputType', value: ['vec2', 'vec3', 'vec4'] }, hint: 'Second component of the vector.' },
    z:     { label: 'Z',     type: 'float', step: 0.01, showWhen: { param: 'outputType', value: ['vec3', 'vec4'] }, hint: 'Third component of the vector.' },
    w:     { label: 'W',     type: 'float', step: 0.01, showWhen: { param: 'outputType', value: 'vec4' }, hint: 'Fourth component of the vector. Often alpha.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_value`;
    const vt = (node.outputs.value?.type as string) || (node.params.outputType as string) || 'float';
    let val: string;
    if (inputVars.value) {
      val = inputVars.value;
    } else if (vt === 'vec2') {
      val = `vec2(${p(node.params.x, 0.0)}, ${p(node.params.y, 0.0)})`;
    } else if (vt === 'vec3') {
      val = `vec3(${p(node.params.x, 0.0)}, ${p(node.params.y, 0.0)}, ${p(node.params.z, 0.0)})`;
    } else if (vt === 'vec4') {
      val = `vec4(${p(node.params.x, 0.0)}, ${p(node.params.y, 0.0)}, ${p(node.params.z, 0.0)}, ${p(node.params.w, 1.0)})`;
    } else {
      val = p(node.params.value, 1.0);
    }
    const glslType = vt === 'vec2' || vt === 'vec3' || vt === 'vec4' ? vt : 'float';
    return {
      code: `    ${glslType} ${outVar} = ${val};\n`,
      outputVars: { value: outVar },
    };
  },
};
