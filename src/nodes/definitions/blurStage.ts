/**
 * The hidden passes of Blur and Glow (texture): one internal node per stage,
 * made by the compiler (compiler/blurPasses.ts), never in a graph. Each stage
 * is compiled as the whole of a hidden pass's program, ending in a Pass
 * output. Its id is the Blur or Glow node's own, so its Radius, Threshold
 * and Knee are the same uniforms as on the card: one slider drives every
 * stage. See docs/blur-and-glow.md.
 *
 * Stages (params, all set by the compiler):
 *  - gauss: one direction of a separable Gaussian with linear sampling
 *    (__dir 'h' | 'v'), at __work scale, σ = Radius × 0.45 × scale, less the
 *    variance the stages before it already added (__var).
 *  - down: Jimenez's 13-tap 2× downsample (with __keep: the Glow's
 *    Threshold per tap, and the Karis average).
 *  - up: a bloom level: this level's downsample weighed by its share of
 *    Radius, plus the level below read through a 9-tap tent.
 * __src / __low / __cur name hidden samplers (declared here); a stage with a
 * `texture` wire reads the Blur's own source instead of __src.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p } from './helpers';
import { passPxUniform } from './passes';
import { BL_BLOOM_W_GLSL, BL_GLSL2, BL_SIGMA_PER_RADIUS } from '../../play/kit/blur.js';

/** The shared blur functions, GLSL ES 1.00 style: one string, so a program that has it twice declares it once. */
export const BL_GLSL_GRAPH = BL_GLSL2;

export type BlurStageKind = 'gauss' | 'down' | 'up';

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const samplerDecl = (s: string) => [`uniform sampler2D ${s};`, `uniform vec2 ${passPxUniform(s)};`];

export const BlurStageNode: NodeDefinition = {
  type: 'blurStage',
  label: 'Blur stage',
  category: 'Output',
  description: 'Internal: one hidden pass of a Blur or Glow (texture).',
  inputs: {
    texture: { type: 'texture', label: 'Texture' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
  },
  // The Blur / Glow card's sliders: the same keys, so the same uniforms.
  paramDefs: {
    radius: { label: 'Radius', type: 'float', min: 0, max: 64, step: 0.5 },
    threshold: { label: 'Threshold', type: 'float', min: 0, max: 2, step: 0.01 },
    knee: { label: 'Knee', type: 'float', min: 0, max: 1, step: 0.01 },
  },
  assignable: false,
  glslFunctions: [BL_GLSL_GRAPH, BL_BLOOM_W_GLSL],
  declarationsFor: (node: GraphNode) => {
    const P = node.params;
    return [P.__src, P.__low, P.__cur].filter((s): s is string => typeof s === 'string' && !!s).flatMap(samplerDecl);
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const src = (typeof P.__src === 'string' && P.__src) || inputVars.texture;
    const radius = p(P.radius, 8);
    const thr = p(P.threshold, 0.5);
    const knee = p(P.knee, 0.1);
    const keep = P.__keep === true;
    const out = `${id}_o`;
    let code: string;
    if (!src) code = `    vec4 ${out} = vec4(0.0);\n`;
    else {
      const texel = `(${passPxUniform(src)} / ${f(num(P.__srcScale, 1))})`;
      const stage = P.__stage as BlurStageKind;
      if (stage === 'gauss') {
        const work = num(P.__work, 1);
        const dir = P.__dir === 'v' ? `vec2(0.0, ${texel}.y)` : `vec2(${texel}.x, 0.0)`;
        const sig = `${radius} * ${BL_SIGMA_PER_RADIUS.toFixed(2)} * ${f(work)}`;
        code = `    float ${id}_sg = sqrt(max(${sig} * ${sig} - ${f(num(P.__var, 0))}, 0.0));\n`
          + (keep
            ? `    vec4 ${out} = blGaussKeep(${src}, vUv, ${dir}, ${id}_sg, ${thr}, ${knee});\n`
            : `    vec4 ${out} = blGauss(${src}, vUv, ${dir}, ${id}_sg);\n`);
      } else if (stage === 'down') {
        code = keep
          ? `    vec4 ${out} = blDown13Keep(${src}, vUv, ${texel}, ${thr}, ${knee});\n`
          : `    vec4 ${out} = blDown13(${src}, vUv, ${texel});\n`;
      } else {
        // up: level k = this level's downsample (__cur) × its weight + the level below (__low) through a tent.
        const low = P.__low as string, cur = P.__cur as string;
        const k = num(P.__level, 1), levels = num(P.__levels, 2), s0 = f(num(P.__bloomScale, 1));
        const lowTexel = `(${passPxUniform(low)} / ${f(num(P.__lowScale, 1))})`;
        const lowW = P.__lowRaw === true ? ` * blBloomW(${radius}, ${s0}, ${f(levels)})` : '';
        code = `    vec4 ${out} = texture2D(${cur}, vUv) * blBloomW(${radius}, ${s0}, ${f(k)}) + blTent(${low}, vUv, ${lowTexel})${lowW};\n`;
      }
    }
    return { code, outputVars: { color: `${out}.rgb`, alpha: `${out}.a` } };
  },
};
