/**
 * features.ts — what the taste model sees of a graph (docs/taste.md). Pure: nodes in, a sparse feature
 * vector out. No image network: hand-made features, plus Deep's cheap image metrics when a picture was
 * drawn, plus an optional image embedding (the seam below) that nothing fills yet.
 *
 *   fam:<family>            a technique family is present (pattern discovery, src/patterns)
 *   tech:<id>               a technique is present
 *   st:<stage>=<choice>     what fills a stage of the plan: "st:light=Exp falloff", "st:space=Expression Block"
 *   nh:<bucket>             node-type counts, hashed into 64 buckets (log-scaled)
 *   set:<key>=<lo|mid|hi>   where a common setting sits in its interesting range
 *   code:yes / code:no      the graph carries code (an Expression Block or a Custom Function)
 *   pal:<dark|mid|light>, pal:<vivid|muted>   the palette's colours
 *   src:<id>                a source it was inspired by (or the rated item itself)
 *   img:<metric>            Deep's image metrics (colourful, contrast, detail, motion, structure, novelty), centred
 *   look:<dark|bright>      the picture's brightness, from its colour signature
 *   emb:<i>                 an image embedding's dimensions (none yet)
 *   _bias                   always 1 (absorbs "likes everything" in single ratings; cancels in pairs)
 */
import type { GraphNode } from '../types/nodeGraph';
import { analyseGraph } from '../patterns/patternIndex';
import { TECHNIQUE_BY_ID } from '../patterns/catalogue';
import { fragmentsOf, stageChoice, type Stage } from '../lang/inspired/fragments';
import type { Composition } from '../lang/inspired/compose';
import { getNodeDefinition } from '../nodes/definitions';
import { interestingRange } from '../lib/surprise/ranges';
import type { Metrics, Signature } from '../lib/surprise/score';

export type Features = Record<string, number>;

/** The settings whose place in their range says something about a look. */
export const COMMON_SETTINGS = [
  'frequency', 'freq', 'falloff', 'radius', 'octaves', 'scale', 'speed', 'intensity', 'glow', 'count', 'density', 'warp', 'amount',
  'smoothness', 'sharpness', 'contrast', 'saturation', 'exposure', 'gamma', 'repeats', 'repeat', 'width', 'thickness', 'strength', 'zoom',
] as const;
const SETTING_SET = new Set<string>(COMMON_SETTINGS);
const NODE_BUCKETS = 64;

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};
/** The hashed bucket a node type counts into. */
export const nodeBucket = (type: string) => `nh:${fnv(type) % NODE_BUCKETS}`;

const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const sat = (c: readonly number[]) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

/** Palette features from a list of colours (0–1 RGB). */
export function paletteFeatures(colours: ReadonlyArray<readonly number[]>): Features {
  if (!colours.length) return {};
  const L = colours.reduce((s, c) => s + lum(c), 0) / colours.length;
  const S = colours.reduce((s, c) => s + sat(c), 0) / colours.length;
  return { [`pal:${L < 0.35 ? 'dark' : L > 0.65 ? 'light' : 'mid'}`]: 1, [`pal:${S > 0.35 ? 'vivid' : 'muted'}`]: 1 };
}

const vec3 = (v: unknown, d: number[]): number[] => (Array.isArray(v) && v.length >= 3 ? v.slice(0, 3).map(Number) : d);

/** A palette node's colours, sampled (cosine palettes at 8 points; Stops Palettes' stops). */
export function paletteColoursOf(n: GraphNode): number[][] {
  if (n.type === 'stopPalette') {
    const count = Math.max(2, Math.min(32, Math.round(Number(n.params.stops) || 5)));
    const out: number[][] = [];
    for (let i = 0; i < count; i++) { const v = n.params[`color${i}`]; if (Array.isArray(v) && v.length >= 3) out.push(v.slice(0, 3).map(Number)); }
    return out;
  }
  if (n.type === 'palette') {
    const a = vec3(n.params.offset, [0.5, 0.5, 0.5]), b = vec3(n.params.amplitude, [0.5, 0.5, 0.5]), c = vec3(n.params.freq, [1, 1, 1]), d = vec3(n.params.phase, [0, 0.33, 0.67]);
    return Array.from({ length: 8 }, (_, k) => [0, 1, 2].map(i => Math.max(0, Math.min(1, a[i] + b[i] * Math.cos(6.28318 * (c[i] * (k / 8) + d[i]))))));
  }
  return [];
}

/** Where a setting sits in its interesting range (thirds, on a log scale when the range is). */
export function settingBucket(key: string, value: number, nodeType: string): 'lo' | 'mid' | 'hi' | null {
  const pd = getNodeDefinition(nodeType)?.paramDefs?.[key];
  const r = interestingRange(key, { min: pd?.min, max: pd?.max, step: pd?.step, int: pd?.type === 'int' }, nodeType);
  if (!r || !(r.hi > r.lo)) return null;
  const t = r.log && r.lo > 0 && value > 0 ? (Math.log(value) - Math.log(r.lo)) / (Math.log(r.hi) - Math.log(r.lo)) : (value - r.lo) / (r.hi - r.lo);
  return t < 1 / 3 ? 'lo' : t > 2 / 3 ? 'hi' : 'mid';
}

/** The last word of a param key, lower-cased ("glowFalloff" → "falloff"). */
const settingWord = (key: string) => {
  const k = key.replace(/[_\d]+$/, '').replace(/[XYZ]$/, '');
  const words = k.split(/(?=[A-Z])|_/).filter(Boolean);
  return (words[words.length - 1] ?? k).toLowerCase();
};

// ── The seam for a small local image embedding ────────────────────────────────
//
// A later step can plug in a tiny on-device network (e.g. MobileNetV3-small via onnxruntime-web) that
// turns a candidate's small frame into a vector. Nothing is registered now and no dependency is added:
// `imageEmbedder()` is null, and `graphFeatures` takes `embedding` when a caller has one.

export interface ImageEmbedder {
  /** A short id, stored with the model so a change of network resets the emb:* weights. */
  id: string;
  dims: number;
  embed(frame: { rgba: ArrayLike<number>; w: number; h: number }): Promise<Float32Array>;
}
let embedder: ImageEmbedder | null = null;
export function registerImageEmbedder(e: ImageEmbedder | null): void { embedder = e; }
export function imageEmbedder(): ImageEmbedder | null { return embedder; }

export interface FeatureExtras {
  /** The plan's stages, when the graph is a composition (more exact than reading the graph). */
  stages?: ReadonlyArray<{ stage: Stage | string; choice: string }>;
  /** Sources it was inspired by. */
  sources?: readonly string[];
  /** Deep's image metrics, when it was drawn. */
  metrics?: Metrics;
  signature?: Signature;
  /** An image embedding (see ImageEmbedder). */
  embedding?: ArrayLike<number>;
  /** An id for the analysis cache. */
  id?: string;
}

/** Mean brightness from a colour signature (a 4×4×4 histogram). */
export function signatureBrightness(sig: Signature): number {
  let L = 0;
  for (let i = 0; i < sig.colour.length; i++) {
    const r = (i >> 4) & 3, g = (i >> 2) & 3, b = i & 3;
    L += sig.colour[i] * lum([(r + 0.5) / 4, (g + 0.5) / 4, (b + 0.5) / 4]);
  }
  return L;
}

/** The feature vector of a graph's top level (and the extras a caller knows). */
export function graphFeatures(nodes: readonly GraphNode[], x: FeatureExtras = {}): Features {
  const f: Features = { _bias: 1 };
  const id = x.id ?? 'taste:graph';
  // Techniques and families.
  try {
    const gp = analyseGraph({ id, label: id, origin: 'open', nodes });
    for (const t of gp.techniques) {
      f[`tech:${t}`] = 1;
      const fam = TECHNIQUE_BY_ID.get(t)?.family;
      if (fam) f[`fam:${fam}`] = 1;
    }
  } catch { /* no techniques */ }
  // What fills each stage: the plan's own when known, else every fragment the graph has.
  if (x.stages) for (const s of x.stages) f[`st:${s.stage}=${s.choice}`] = 1;
  else {
    try {
      for (const fr of fragmentsOf({ id, label: id, kind: 'graph', nodes })) f[`st:${fr.stage}=${stageChoice(fr)}`] = 1;
    } catch { /* no stages */ }
  }
  // Node types (hashed), code, settings, palettes.
  const counts = new Map<string, number>();
  let code = false;
  const colours: number[][] = [];
  for (const n of nodes) {
    counts.set(nodeBucket(n.type), (counts.get(nodeBucket(n.type)) ?? 0) + 1);
    if (n.type === 'exprNode' || n.type === 'customFn') code = true;
    colours.push(...paletteColoursOf(n));
    for (const [k, v] of Object.entries(n.params ?? {})) {
      if (typeof v !== 'number' || !Number.isFinite(v) || k.startsWith('__')) continue;
      const w = settingWord(k);
      if (!SETTING_SET.has(w)) continue;
      const b = settingBucket(k, v, n.type);
      if (b) f[`set:${w === 'freq' ? 'frequency' : w === 'repeat' ? 'repeats' : w}=${b}`] = 1;
    }
  }
  for (const [b, c] of counts) f[b] = Math.log1p(c) / 2;
  f[code ? 'code:yes' : 'code:no'] = 1;
  Object.assign(f, paletteFeatures(colours));
  for (const s of x.sources ?? []) f[`src:${s}`] = 1;
  if (x.metrics) for (const [k, v] of Object.entries(x.metrics)) f[`img:${k}`] = v - 0.5;
  if (x.signature) {
    const L = signatureBrightness(x.signature);
    if (L < 0.3) f['look:dark'] = 1; else if (L > 0.6) f['look:bright'] = 1;
  }
  if (x.embedding) for (let i = 0; i < x.embedding.length; i++) f[`emb:${i}`] = x.embedding[i];
  return normalise(f);
}

/** A composition's features: its plan's stages and its sources are known exactly. */
export function compositionFeatures(c: Pick<Composition, 'nodes' | 'stages' | 'inspirations'>, x: Omit<FeatureExtras, 'stages' | 'sources'> = {}): Features {
  return graphFeatures(c.nodes, { ...x, stages: c.stages, sources: c.inspirations.map(i => i.id) });
}

/** A technique card's features (rating a technique in the Patterns tab). */
export function techniqueFeatures(techniqueId: string): Features {
  const t = TECHNIQUE_BY_ID.get(techniqueId);
  return t ? { _bias: 1, [`tech:${t.id}`]: 1, [`fam:${t.family}`]: 1 } : { _bias: 1 };
}

/** A node type's features (starring a node). */
export function nodeTypeFeatures(type: string): Features {
  return { _bias: 1, [nodeBucket(type)]: 1, [type === 'exprNode' || type === 'customFn' ? 'code:yes' : 'code:no']: 0.5 };
}

/** Scale a long vector down, so a big graph doesn't learn faster than a small one. */
function normalise(f: Features): Features {
  const nnz = Object.keys(f).length;
  if (nnz <= 12) return f;
  const k = Math.sqrt(12 / nnz);
  const out: Features = {};
  for (const [key, v] of Object.entries(f)) out[key] = key === '_bias' ? v : v * k;
  return out;
}
