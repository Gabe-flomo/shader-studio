/**
 * look.ts — how things look, for the taste model (docs/taste.md "How things look"). Pure.
 *
 * A small local image+text model (src/imageModel, MobileCLIP-S0) turns a picture into a 512-d unit vector.
 * Those vectors are not fed into the sparse linear model: 512 dense numbers per graph would swamp its ~20
 * sparse features and learn slowly. Instead:
 *
 *   - Projection. Each picture's vector is projected to LOOK_DIMS (64) dimensions with a fixed Gaussian
 *     random projection (seeded, so every install has the same matrix: Johnson–Lindenstrauss keeps cosines
 *     within about ±0.1) and normalised. The projected vector rides along in a graph's features as `emb:<i>`
 *     (features.ts); the linear learner skips those keys.
 *   - Centroids. Per layer, a running weighted mean of the liked looks, of the disliked looks, and of every
 *     look learned from (`seen`). Picks, ratings and implicit signals add to them at the signal's weight.
 *   - Score. Centre on `seen` (shrunk towards 0 with a small pseudo-count, so one like already means
 *     something), then cosine to the liked centroid minus cosine to the disliked one, each weighted by how
 *     much evidence it has: n / (n + 2).
 *
 *       look(x) = LOOK_WEIGHT · [ c(nL)·cos(x − m, L − m) − c(nD)·cos(x − m, D − m) ]
 *
 * Steering words the vocabulary doesn't know ("underwater", "stained glass") become text terms, scored by
 * image–text similarity in the full 512-d space, against a neutral prompt so the score is centred:
 *
 *       text(x) = Σ sign · CHIP_WEIGHT · tanh(TEXT_GAIN · (x·t − x·t₀))
 *
 * Novelty: the distance of a picture's vector to the last few kept ones, and near-duplicates in a batch.
 */

// ── The embedder seam ────────────────────────────────────────────────────────

export interface ImageEmbedder {
  /** A short id (model + projection), stored with the look, so a change of network resets only the look. */
  id: string;
  dims: number;
  /** A small frame (RGBA, rows bottom-up as WebGL reads them) → its projected, normalised vector. */
  embed(frame: { rgba: ArrayLike<number>; w: number; h: number }): Promise<Float32Array>;
}
let embedder: ImageEmbedder | null = null;
export function registerImageEmbedder(e: ImageEmbedder | null): void { embedder = e; }
export function imageEmbedder(): ImageEmbedder | null { return embedder; }
/** The registered embedder's id, or null. */
export const imageEmbedderId = (): string | null => embedder?.id ?? null;

/** The projected dimensions. */
export const LOOK_DIMS = 64;
/** The projection's seed and version: part of the embedder id, so changing it resets the look. */
export const PROJECTION_SEED = 20261007;
export const PROJECTION_VERSION = 'rp64.1';
/** How much the look part counts against the linear score (a strong feature is worth ~1). */
export const LOOK_WEIGHT = 1;
/** The `seen` mean is shrunk towards 0 by this many pseudo-signals. */
export const MEAN_PRIOR = 2;
/** Image–text: how sharply a similarity difference turns into a score. */
export const TEXT_GAIN = 20;
/** Same as steering.ts CHIP_WEIGHT (kept here so this file stays free of imports). */
const TERM_WEIGHT = 0.6;
/** Two pictures closer than this are the same look (cosine of the full vectors). */
export const DUPLICATE_COS = 0.96;
/** Novelty is 1 − (the closest kept cosine), over this span. */
export const NOVELTY_SPAN = 0.3;

/** The prompt a look word is embedded in, and the neutral one it's measured against. */
export const lookPrompt = (phrase: string) => `an abstract image of ${phrase.trim()}`;
export const NEUTRAL_PROMPT = 'an abstract image';

/** A layer's look: weighted means (centroids) of liked, disliked and all looks learned from. */
export interface LookState {
  /** The embedder these vectors came from (model + projection); another one's centroids count for nothing. */
  embedder: string;
  dims: number;
  like: number[];
  likeW: number;
  dislike: number[];
  dislikeW: number;
  seen: number[];
  seenW: number;
}

export const emptyLook = (embedder: string, dims = LOOK_DIMS): LookState => ({
  embedder, dims, like: new Array(dims).fill(0), likeW: 0, dislike: new Array(dims).fill(0), dislikeW: 0, seen: new Array(dims).fill(0), seenW: 0,
});

// ── Vectors ──────────────────────────────────────────────────────────────────

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
export function norm(a: ArrayLike<number>): number { return Math.sqrt(dot(a, a)); }
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const d = norm(a) * norm(b);
  return d > 1e-12 ? dot(a, b) / d : 0;
}
export function normalised(a: ArrayLike<number>): Float32Array {
  const n = norm(a);
  const out = new Float32Array(a.length);
  if (n > 1e-12) for (let i = 0; i < a.length; i++) out[i] = a[i] / n;
  return out;
}

/** mulberry32: a tiny seeded generator (the projection must be the same everywhere). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const matrices = new Map<string, Float32Array>();
/** The fixed projection, `out` rows of `inDims` Gaussian numbers / √out (row-major), from the seed. */
export function projectionMatrix(inDims: number, out = LOOK_DIMS, seed = PROJECTION_SEED): Float32Array {
  const key = `${inDims}:${out}:${seed}`;
  const hit = matrices.get(key);
  if (hit) return hit;
  const rnd = mulberry32(seed);
  const m = new Float32Array(inDims * out);
  const s = 1 / Math.sqrt(out);
  for (let i = 0; i < m.length; i += 2) {
    // Box–Muller: two normals per pair of uniforms.
    const u = Math.max(1e-12, rnd()), v = rnd();
    const r = Math.sqrt(-2 * Math.log(u));
    m[i] = r * Math.cos(2 * Math.PI * v) * s;
    if (i + 1 < m.length) m[i + 1] = r * Math.sin(2 * Math.PI * v) * s;
  }
  matrices.set(key, m);
  return m;
}

/** A full embedding projected to LOOK_DIMS and normalised. */
export function project(full: ArrayLike<number>, out = LOOK_DIMS, seed = PROJECTION_SEED): Float32Array {
  const m = projectionMatrix(full.length, out, seed);
  const y = new Float32Array(out);
  for (let r = 0; r < out; r++) {
    let s = 0;
    const o = r * full.length;
    for (let i = 0; i < full.length; i++) s += m[o + i] * full[i];
    y[r] = s;
  }
  return normalised(y);
}

// ── Features ─────────────────────────────────────────────────────────────────

/** The projected vector as `emb:<i>` features. */
export function lookFeatures(proj: ArrayLike<number>): Record<string, number> {
  const f: Record<string, number> = {};
  for (let i = 0; i < proj.length; i++) f[`emb:${i}`] = proj[i];
  return f;
}

export const isEmbKey = (k: string) => k.charCodeAt(0) === 101 /* e */ && k.startsWith('emb:');

/** The projected vector inside a feature vector, or null when it has none. */
export function embOf(f: Record<string, number>): number[] | null {
  let n = -1;
  for (const k in f) if (isEmbKey(k)) { const i = Number(k.slice(4)); if (i > n) n = i; }
  if (n < 0) return null;
  const x = new Array(n + 1).fill(0);
  for (const k in f) if (isEmbKey(k)) x[Number(k.slice(4))] = f[k];
  return x;
}

// ── Centroids ────────────────────────────────────────────────────────────────

const mix = (mean: number[], w: number, x: ArrayLike<number>, k: number): number[] => {
  const t = w + k;
  if (t <= 1e-12) return mean.map(() => 0);
  return mean.map((m, i) => (m * w + (x[i] ?? 0) * k) / t);
};

/**
 * Learn a look: `value` > 0 adds it to the liked centroid, < 0 to the disliked one, at |value|·weight; every
 * look learned from joins `seen`.
 */
export function lookLearn(s: LookState, x: ArrayLike<number>, value: number, weight = 1): LookState {
  const k = Math.abs(value) * weight;
  if (!k || x.length !== s.dims) return s;
  const out = { ...s, seen: mix(s.seen, s.seenW, x, weight), seenW: s.seenW + weight };
  if (value > 0) return { ...out, like: mix(s.like, s.likeW, x, k), likeW: s.likeW + k };
  return { ...out, dislike: mix(s.dislike, s.dislikeW, x, k), dislikeW: s.dislikeW + k };
}

const sure = (n: number) => n / (n + 2);

/** The look part of a score (0 when nothing is learned or the vector is missing). */
export function lookScore(s: LookState | undefined, x: ArrayLike<number> | null): number {
  if (!s || !x || x.length !== s.dims || (s.likeW <= 0 && s.dislikeW <= 0)) return 0;
  const shrink = s.seenW / (s.seenW + MEAN_PRIOR);
  const m = s.seen.map(v => v * shrink);
  const xc = Array.from(x, (v, i) => v - m[i]);
  let out = 0;
  if (s.likeW > 0) out += sure(s.likeW) * cosine(xc, s.like.map((v, i) => v - m[i]));
  if (s.dislikeW > 0) out -= sure(s.dislikeW) * cosine(xc, s.dislike.map((v, i) => v - m[i]));
  return LOOK_WEIGHT * out;
}

const merge = (a: number[], wa: number, b: number[], wb: number, k: number): { v: number[]; w: number } => {
  const w = wa + k * wb;
  if (w <= 1e-9) return { v: a.map(() => 0), w: 0 };
  return { v: a.map((x, i) => (x * wa + k * (b[i] ?? 0) * wb) / w), w };
};

/**
 * Two layers' looks together (weighted by evidence, as layers add up). `k` = −1 takes `b` away (a lesson's
 * change). Another embedder's look counts for nothing: the newer one (`b`) wins.
 */
export function addLook(a: LookState | undefined, b: LookState | undefined, k = 1): LookState | undefined {
  if (!b) return a;
  if (!a || a.embedder !== b.embedder || a.dims !== b.dims) return k > 0 ? b : a;
  const L = merge(a.like, a.likeW, b.like, b.likeW, k), D = merge(a.dislike, a.dislikeW, b.dislike, b.dislikeW, k), S = merge(a.seen, a.seenW, b.seen, b.seenW, k);
  return { embedder: a.embedder, dims: a.dims, like: L.v, likeW: L.w, dislike: D.v, dislikeW: D.w, seen: S.v, seenW: S.w };
}

export const isEmptyLook = (s: LookState | undefined) => !s || (s.likeW <= 1e-9 && s.dislikeW <= 1e-9 && s.seenW <= 1e-9);

/** Read a stored look (centroids and their evidence); null when it isn't one. */
export function parseLook(v: unknown): LookState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const dims = Number(o.dims);
  const vec = (x: unknown) => (Array.isArray(x) && x.length === dims && x.every(n => typeof n === 'number' && Number.isFinite(n)) ? (x as number[]) : null);
  const like = vec(o.like), dislike = vec(o.dislike), seen = vec(o.seen);
  const w = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
  if (typeof o.embedder !== 'string' || !(dims > 0) || !like || !dislike || !seen) return undefined;
  return { embedder: o.embedder, dims, like, likeW: w(o.likeW), dislike, dislikeW: w(o.dislikeW), seen, seenW: w(o.seenW) };
}

/** A look for a file: the same centroids, rounded to 5 places. */
export function lookForFile(s: LookState | undefined): LookState | undefined {
  if (!s || isEmptyLook(s)) return undefined;
  const r = (a: number[]) => a.map(x => Math.round(x * 1e5) / 1e5);
  return { ...s, like: r(s.like), dislike: r(s.dislike), seen: r(s.seen) };
}

// ── Steering by look (text) ──────────────────────────────────────────────────

export interface LookTerm { text: string; sign: number; emb: ArrayLike<number> }

/** What words-by-look add to a picture's score: image–text similarity against a neutral prompt. */
export function textLookScore(full: ArrayLike<number> | null | undefined, terms: readonly LookTerm[], neutral: ArrayLike<number> | null): number {
  if (!full || !terms.length) return 0;
  const base = neutral ? dot(full, neutral) : 0;
  let s = 0;
  for (const t of terms) if (t.sign) s += t.sign * TERM_WEIGHT * Math.tanh(TEXT_GAIN * (dot(full, t.emb) - base));
  return s;
}

/** Each term's raw similarity difference (for showing why). */
export function textLookParts(full: ArrayLike<number>, terms: readonly LookTerm[], neutral: ArrayLike<number> | null): Array<{ text: string; d: number }> {
  const base = neutral ? dot(full, neutral) : 0;
  return terms.map(t => ({ text: t.text, d: dot(full, t.emb) - base }));
}

// ── Novelty ──────────────────────────────────────────────────────────────────

/** 1 when nothing was kept yet; else how far the picture is from the closest kept one (0 the same … 1). */
export function lookNovelty(x: ArrayLike<number>, recent: ReadonlyArray<ArrayLike<number>>, span = NOVELTY_SPAN): number {
  if (!recent.length) return 1;
  const closest = Math.max(...recent.map(r => cosine(x, r)));
  return Math.max(0, Math.min(1, (1 - closest) / span));
}

/**
 * Drop near-duplicates, keeping order: an item whose vector is within `threshold` (cosine) of one already
 * kept goes. Items without a vector are kept.
 */
export function dropLookalikes<T>(items: readonly T[], vec: (t: T) => ArrayLike<number> | null | undefined, threshold = DUPLICATE_COS): { kept: T[]; dropped: T[] } {
  const kept: T[] = [], dropped: T[] = [];
  const seen: ArrayLike<number>[] = [];
  for (const it of items) {
    const v = vec(it);
    if (v && seen.some(s => cosine(s, v) >= threshold)) { dropped.push(it); continue; }
    kept.push(it);
    if (v) seen.push(v);
  }
  return { kept, dropped };
}
