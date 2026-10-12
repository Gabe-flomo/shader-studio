/**
 * blurPasses.ts — the hidden passes behind Blur and Glow (texture)
 * (docs/blur-and-glow.md).
 *
 * A Smooth blur is two 1D Gaussians (across, then down), and a Bloom glow is
 * a chain of downsamples and upsamples: neither fits in the one program the
 * node lands in. So the compiler gives each such node a few passes of its
 * own, drawn just before the first program that has the node, and the node
 * then reads the last of them. They are ordinary pass programs to both hosts
 * (passRunner, kit/passHost.js), marked `hidden`: they don't count towards a
 * graph's MAX_PASSES Pass nodes (there is a separate MAX_HIDDEN_PASSES), and
 * the Performance panel lists them under the node's name.
 *
 * Pure planning here (which stages, what they read, their sizes); passGraph.ts
 * compiles them.
 */
import type { GraphNode } from '../types/nodeGraph';
import { blBloomPlan, blSmoothPlan } from '../play/kit/blur.js';
import { RF_PASSES } from '../play/kit/rays.js';
import { dgLevels, dgScales } from '../play/kit/deepglow.js';

export const BLUR_NODE_TYPES = new Set(['blurTexture', 'glowTexture']);
/** Radial Fast Blur (Light rays): its log-step passes are hidden passes too (planRays). */
export const RAYS_NODE_TYPE = 'radialFastBlur';
/** Deep Glow: its mip chain is hidden passes too (planDeepGlow). */
export const DEEP_GLOW_NODE_TYPE = 'deepGlowTexture';
/** Every node type with hidden passes. */
export const HIDDEN_PASS_TYPES = new Set([...BLUR_NODE_TYPES, RAYS_NODE_TYPE, DEEP_GLOW_NODE_TYPE]);
/** Node types whose sliders are sockets of their own (withParamSockets): every hidden pass computes what is wired into them. */
export const SOCKETED_HIDDEN_TYPES = new Set([RAYS_NODE_TYPE, DEEP_GLOW_NODE_TYPE]);
/** Most hidden passes a graph's blurs and glows may add; a node past it draws in one pass (its Fast look). */
export const MAX_HIDDEN_PASSES = 48;

export type BlurMethod = 'smooth' | 'bloom' | 'fast';

/**
 * A Blur / Glow (texture) node's method. A node saved before Method (no `method`) is Smooth: a
 * true Gaussian with the same Radius units, so an old graph keeps its look without the copies and
 * rings. A Glow added now starts as a Bloom chain (its defaultParams); Bloom on Blur reads as Smooth.
 */
export function blurMethod(node: Pick<GraphNode, 'type' | 'params'>): BlurMethod {
  const m = node.params?.method;
  if (m === 'fast' || m === 'smooth') return m;
  if (m === 'bloom' && node.type === 'glowTexture') return 'bloom';
  return 'smooth';
}

/** One hidden pass. `reads`: 'source' (the node's own Texture wire) or the keys of earlier stages. */
export interface BlurStagePlan {
  key: string;
  scale: number;
  label: string;
  reads: string[];
  /** The stage node's internal params (__stage, __dir, …); samplers are filled in by key → slug. */
  params: Record<string, unknown>;
  /** Params naming other stages' samplers: param → stage key. */
  samplers: Record<string, string>;
}

export interface BlurPlan {
  method: Exclude<BlurMethod, 'fast'> | 'rays' | 'deepGlow';
  /** The internal node type each stage compiles as (blurStage when absent). */
  stageType?: string;
  stages: BlurStagePlan[];
  /** The stage the node reads, and its scale. */
  out: string;
  outScale: number;
  /** Read it through the 4-tap cubic (it is smaller than the picture). */
  cubic: boolean;
  /** Bloom: the chain's level count (the node divides by the levels' total weight). */
  levels?: number;
}

const SCALE_NAME = (s: number) => (s >= 1 ? '1' : s === 0.5 ? '½' : s === 0.25 ? '¼' : s === 0.125 ? '⅛' : `1/${Math.round(1 / s)}`);

/**
 * The hidden passes for a node with this method, Radius and source scale (the
 * Pass it reads; 1 for anything else). Null for Fast, which needs none.
 */
export function planBlur(method: BlurMethod, radius: number, srcScale: number, glow: boolean): BlurPlan | null {
  if (method === 'fast') return null;
  const s = srcScale > 0 ? srcScale : 1;
  if (method === 'bloom') {
    const plan = blBloomPlan(radius, s);
    const stages: BlurStagePlan[] = [];
    for (let k = 1; k <= plan.levels; k++) {
      const prevScale = k === 1 ? s : plan.scales[k - 2];
      stages.push({
        key: `d${k}`, scale: plan.scales[k - 1], label: `down ${SCALE_NAME(plan.scales[k - 1])}`,
        reads: [k === 1 ? 'source' : `d${k - 1}`],
        params: { __stage: 'down', __srcScale: prevScale, ...(k === 1 ? { __keep: true } : {}) },
        samplers: k === 1 ? {} : { __src: `d${k - 1}` },
      });
    }
    for (let k = plan.levels - 1; k >= 1; k--) {
      const lowKey = k === plan.levels - 1 ? `d${plan.levels}` : `u${k + 1}`;
      stages.push({
        key: `u${k}`, scale: plan.scales[k - 1], label: `up ${SCALE_NAME(plan.scales[k - 1])}`,
        reads: [`d${k}`, lowKey],
        params: { __stage: 'up', __level: k, __levels: plan.levels, __bloomScale: s, __lowScale: plan.scales[k], __srcScale: plan.scales[k - 1], ...(lowKey.startsWith('d') ? { __lowRaw: true } : {}) },
        samplers: { __src: `d${k}`, __cur: `d${k}`, __low: lowKey },
      });
    }
    return { method: 'bloom', stages, out: 'u1', outScale: plan.scales[0], cubic: true, levels: plan.levels };
  }
  const plan = blSmoothPlan(radius, s);
  const stages: BlurStagePlan[] = [];
  let scale = s, last = 'source';
  for (let i = 1; i <= plan.downs; i++) {
    stages.push({
      key: `d${i}`, scale: scale / 2, label: `down ${SCALE_NAME(scale / 2)}`, reads: [last],
      params: { __stage: 'down', __srcScale: scale, ...(glow && i === 1 ? { __keep: true } : {}) },
      samplers: last === 'source' ? {} : { __src: last },
    });
    scale /= 2;
    last = `d${i}`;
  }
  const keepInGauss = glow && plan.downs === 0;
  stages.push({
    key: 'h', scale, label: `across ${SCALE_NAME(scale)}`, reads: [last],
    params: { __stage: 'gauss', __dir: 'h', __work: scale, __srcScale: scale, __var: plan.variance, ...(keepInGauss ? { __keep: true } : {}) },
    samplers: last === 'source' ? {} : { __src: last },
  });
  stages.push({
    key: 'v', scale, label: `down the picture ${SCALE_NAME(scale)}`, reads: ['h'],
    params: { __stage: 'gauss', __dir: 'v', __work: scale, __srcScale: scale, __var: plan.variance },
    samplers: { __src: 'h' },
  });
  return { method: 'smooth', stages, out: 'v', outScale: scale, cubic: plan.cubic };
}

/**
 * A Radial Fast Blur's hidden passes (play/kit/rays.js): RF_PASSES log-step passes at the source's
 * scale, the first reading the node's own texture (and applying Threshold), each later one the pass
 * before, RF_TAPS times further apart.
 */
export function planRays(srcScale: number): BlurPlan {
  const s = srcScale > 0 ? srcScale : 1;
  const stages: BlurStagePlan[] = [];
  for (let k = 0; k < RF_PASSES; k++) {
    stages.push({
      key: `r${k}`, scale: s, label: `streak ${k + 1}/${RF_PASSES}`, reads: [k === 0 ? 'source' : `r${k - 1}`],
      params: { __k: k }, samplers: k === 0 ? {} : { __src: `r${k - 1}` },
    });
  }
  return { method: 'rays', stageType: 'radialFastBlurStage', stages, out: `r${RF_PASSES - 1}`, outScale: s, cubic: false };
}

/**
 * A Deep Glow's mip chain (play/kit/deepglow.js): the prefilter (Threshold, halved: d1, reading the
 * node's own texture), downs to the smallest level, then ups back to d1's size, each adding the level
 * below (upsampled) to its own weighed level. 2 × levels − 1 passes; the node reads u1.
 */
export function planDeepGlow(srcScale: number): BlurPlan {
  const s = srcScale > 0 ? srcScale : 1;
  const levels = dgLevels(s);
  const scales = dgScales(s, levels);
  const stages: BlurStagePlan[] = [];
  for (let k = 1; k <= levels; k++) {
    stages.push({
      key: `d${k}`, scale: scales[k - 1], label: `${k === 1 ? 'threshold' : 'down'} ${SCALE_NAME(scales[k - 1])}`,
      reads: [k === 1 ? 'source' : `d${k - 1}`],
      params: { __stage: k === 1 ? 'pre' : 'down', __srcScale: k === 1 ? s : scales[k - 2] },
      samplers: k === 1 ? {} : { __src: `d${k - 1}` },
    });
  }
  for (let k = levels - 1; k >= 1; k--) {
    const lowKey = k === levels - 1 ? `d${levels}` : `u${k + 1}`;
    stages.push({
      key: `u${k}`, scale: scales[k - 1], label: `up ${SCALE_NAME(scales[k - 1])}`,
      reads: [`d${k}`, lowKey],
      params: { __stage: 'up', __level: k, __levels: levels, __bloomScale: s, __lowScale: scales[k], ...(lowKey.startsWith('d') ? { __lowRaw: true } : {}) },
      samplers: { __cur: `d${k}`, __low: lowKey },
    });
  }
  return { method: 'deepGlow', stageType: 'deepGlowTextureStage', stages, out: 'u1', outScale: scales[0], cubic: false, levels };
}

/** A hidden stage's slug: the node's slug and the stage key (no double underscores: GLSL reserves them). */
export const hiddenSlug = (nodeSlug: string, key: string) => `${nodeSlug.replace(/_+$/, '')}Bl${key}`;

/** Does the graph have a Smooth or Bloom-chain Blur / Glow (texture) with a Texture wired (top level)? Then it compiles as a pass graph. */
export function hasHiddenBlur(nodes: readonly GraphNode[]): boolean {
  return nodes.some(n => (SOCKETED_HIDDEN_TYPES.has(n.type) || (BLUR_NODE_TYPES.has(n.type) && blurMethod(n) !== 'fast')) && !!n.inputs.texture?.connection);
}
