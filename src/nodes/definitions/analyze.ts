/**
 * Analyze (docs/analyze-node.md): a whole picture measured into numbers, TouchDesigner's Analyze TOP and TOP to CHOP:
 * its average colour and brightness, how much of it is lit and where, its brightest point, its contrast, and how
 * much it changed since the last frame.
 *
 * The measuring runs outside the shader (lib/analyze/engine.ts): each frame the wired texture is read back small,
 * measured on the CPU (lib/analyze/stats.ts) and uploaded to a 4 × 1 float texture, `u_tex_<slug>` (the store's
 * nodeTextures[id]). The node reads it with texelFetch, so every output is one number for the whole picture.
 *
 * The node writes one comment naming the texture wired into it (ANALYZE_SOURCE_MARK), as Blob Track does.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';

export const ANALYZE_TYPE = 'analyze';
/** `// analyze-source <its sampler> <wired sampler>`: what the engine reads (lib/analyze/engine.ts). */
export const ANALYZE_SOURCE_MARK = '// analyze-source ';
export const ANALYZE_SIDES = [32, 64, 128] as const;

export const analyzeSampler = (slug: string): string => `u_tex_${slug}`;
export const analyzeSideOf = (node: GraphNode): number => {
  const s = Number(node.params.resolution);
  return (ANALYZE_SIDES as readonly number[]).includes(s) ? s : 64;
};

export const AnalyzeNode: NodeDefinition = withParamSockets({
  type: ANALYZE_TYPE,
  label: 'Analyze',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Analyze TOP', 'TOP to CHOP', 'Average colour', 'Average brightness', 'Picture to numbers', 'Luminance meter', 'Motion amount', 'Brightest point', 'Centroid'],
  description: 'Measures a whole picture into numbers you can wire anywhere: its average Colour and Brightness, how much of it is lit (Coverage) and the middle of the lit part (Centre), its Brightest point, its Contrast, and how much it changed since the last frame (Motion). Wire a Video Input (or the camera), an image, a Pass. Each output is one value for the whole picture, the same at every pixel.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'The picture to measure: a Video Input (or the camera), Texture Input, Baked, a Pass, a Shader Texture. Empty: the picture itself (a frame late).' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Colour', hint: 'The picture\'s average colour.' },
    brightness: { type: 'float', label: 'Brightness', hint: 'Its average brightness, 0–1.' },
    coverage: { type: 'float', label: 'Coverage', hint: 'How much of it is brighter than Threshold, 0–1.' },
    centre: { type: 'vec2', label: 'Centre', hint: 'The middle of the part brighter than Threshold, in picture coordinates (as UV): where the light is. The picture\'s centre when nothing is.' },
    brightest: { type: 'vec2', label: 'Brightest point', hint: 'Where its single brightest pixel is, in picture coordinates.' },
    peak: { type: 'float', label: 'Peak', hint: 'How bright that brightest pixel is, 0–1.' },
    contrast: { type: 'float', label: 'Contrast', hint: 'How much brightness varies across it (0 flat; about 0.5 at most).' },
    motion: { type: 'float', label: 'Motion', hint: 'How much it changed since the last frame, times Motion gain: near 0 when still, up when things move.' },
    texture: { type: 'texture', label: 'Numbers', hint: 'The numbers as a 4 × 1 float texture, for code.' },
  },
  defaultParams: { resolution: '64', threshold: 0.5, smoothing: 0.3, motionGain: 10 },
  paramDefs: {
    resolution: { label: 'Resolution', type: 'select', hint: 'The long side it is read at. 64 is plenty for averages; higher finds a small bright point more exactly.', options: ANALYZE_SIDES.map(s => ({ value: String(s), label: `${s} px` })) },
    threshold: { label: 'Threshold', type: 'float', min: 0, max: 1, step: 0.01, compileTime: true, hint: 'Coverage and Centre count the pixels brighter than this.' },
    smoothing: { label: 'Smoothing', type: 'float', min: 0, max: 0.95, step: 0.01, compileTime: true, hint: 'Blends each frame\'s numbers with the last, so they flicker less (and lag a little).' },
    motionGain: { label: 'Motion gain', type: 'float', min: 0, max: 100, step: 0.1, hint: 'Scales Motion: the raw change is small (a few hundredths), so 10 makes ordinary movement about 0.1–1.' },
  },
  declarationsFor: (node: GraphNode) => [`#define ${analyzeSampler(node.id)}_px (vec2(1.0) / vec2(4.0, 1.0))`],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, S = analyzeSampler(id), src = inputVars.texture;
    const code = [
      // What the engine measures (lib/analyze/engine.ts); empty: the picture.
      `    ${ANALYZE_SOURCE_MARK}${S} ${src ?? 'picture'}\n`,
      `    vec4 ${id}_a = texelFetch(${S}, ivec2(0, 0), 0);\n`,
      `    vec4 ${id}_b = texelFetch(${S}, ivec2(1, 0), 0);\n`,
      `    vec4 ${id}_c = texelFetch(${S}, ivec2(2, 0), 0);\n`,
      `    vec2 ${id}_asp = vec2(u_resolution.x / u_resolution.y, 1.0);\n`,
      `    vec2 ${id}_ctr = (${id}_b.xy * 2.0 - 1.0) * ${id}_asp;\n`,
      `    vec2 ${id}_hot = (${id}_c.xy * 2.0 - 1.0) * ${id}_asp;\n`,
      `    float ${id}_mo = ${id}_c.w * ${p(node.params.motionGain, 10)};\n`,
    ].join('');
    return {
      code,
      outputVars: {
        color: `${id}_a.rgb`, brightness: `${id}_a.w`, coverage: `${id}_b.z`, centre: `${id}_ctr`, brightest: `${id}_hot`,
        peak: `${id}_b.w`, contrast: `${id}_c.z`, motion: `${id}_mo`, texture: S,
      },
    };
  },
}, ['motionGain']);
