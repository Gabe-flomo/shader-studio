/**
 * randomizeFocus.ts — "Focus on what changes the picture" for Randomize.
 *
 * Each setting's sensitivity is measured by drawing a small frame of the graph with the setting
 * nudged down and up (a quarter of the way to the low and high ends of its interesting range) and
 * comparing it with the unchanged frame: the mean absolute pixel difference. When the image model
 * is loaded the embedding distance (1 − cosine) is blended in. Results are normalised to 0–1 by the
 * biggest measured setting. The work is time-boxed; settings not reached have no weight (they are
 * randomized as without Focus). Nothing here draws by itself: `render` is passed in, so the
 * weighting is testable with a mocked sensitivity (see ../__tests__/randomizeFocus.test.ts).
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinitionFor } from './definitions';
import { isNodeSkipped, randomizedParams, weightKey } from './randomizeParams';
import type { RandomizeOptions } from './randomizeOptions';

/** A setting to measure and the two values to draw it at. */
export interface FocusItem {
  /** Key into the weights map (see weightKey). */
  weightKey: string;
  /** Groups to open to reach the node (empty: the level itself). */
  path: string[];
  nodeId: string;
  /** The key on the node's params. */
  key: string;
  /** The binding key `${nodeId}::${key}` of the uniform that carries it. */
  binding: string;
  down: unknown;
  up: unknown;
  /** The whole interesting range (the low and high ends Randomize at strength 1 reaches) and the current value; the control finder samples across it. */
  lo?: unknown;
  hi?: unknown;
  cur?: unknown;
}

/** Number or number[] that is `t` of the way from `cur` to `to`. */
function toward(cur: unknown, to: unknown, t: number): unknown {
  if (typeof to === 'number') return typeof cur === 'number' ? cur + (to - cur) * t : to;
  if (Array.isArray(to)) return to.map((x, i) => toward(Array.isArray(cur) ? cur[i] : undefined, x, t));
  return undefined;
}

const numeric = (v: unknown): boolean => typeof v === 'number' || (Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'number'));

/**
 * The settings Randomize all would change with these options (same walk, same locks), each with
 * its down and up probe values. Choices have no numeric probe and are left out.
 */
export function focusItems(level: GraphNode[], opts: RandomizeOptions, path: string[] = []): FocusItem[] {
  const out: FocusItem[] = [];
  const probe = (n: GraphNode, face: boolean) => {
    const def = getNodeDefinitionFor(n);
    if (!def && !face) return;
    const o = { ...opts, strength: 1, focus: false };
    const lo = randomizedParams(n, def ?? ({} as never), () => 0, o);
    const hi = randomizedParams(n, def ?? ({} as never), () => 0.999, o);
    for (const key of Object.keys(lo)) {
      const cur = n.params[key] ?? def?.defaultParams?.[key];
      if (!numeric(lo[key]) || !numeric(cur)) continue;
      const wk = face ? key : weightKey(n.id, key);
      // A group's override key `inner::param` (or `group::inner::param`) is bound by its last two parts.
      const binding = face ? key.split('::').slice(-2).join('::') : wk;
      out.push({ weightKey: wk, path, nodeId: n.id, key, binding, down: toward(cur, lo[key], 0.25), up: toward(cur, hi[key], 0.25), lo: lo[key], hi: hi[key], cur });
    }
  };
  for (const n of level) {
    if (isNodeSkipped(n)) continue;
    if (n.type !== 'group') { probe(n, false); continue; }
    if (opts.groupFace) probe(n, true);
    const sg = n.params.subgraph as SubgraphData | undefined;
    if (opts.insideGroups && sg && Array.isArray(sg.nodes)) out.push(...focusItems(sg.nodes, opts, [...path, n.id]));
  }
  return out;
}

/** Set one param on a node found by group path and id (a copy; the rest shared). */
export function setParamAtPath(nodes: GraphNode[], path: string[], nodeId: string, key: string, value: unknown): GraphNode[] {
  return nodes.map(n => {
    if (path.length === 0) return n.id === nodeId ? { ...n, params: { ...n.params, [key]: value } } : n;
    if (n.id !== path[0]) return n;
    const sg = n.params.subgraph as SubgraphData | undefined;
    if (!sg || !Array.isArray(sg.nodes)) return n;
    return { ...n, params: { ...n.params, subgraph: { ...sg, nodes: setParamAtPath(sg.nodes, path.slice(1), nodeId, key, value) } } };
  });
}

/** Mean absolute difference of two RGBA frames, 0–1 (alpha ignored). */
export function frameDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / ((n / 4) * 3 * 255);
}

/** 1 − cosine of two embeddings (unit vectors), 0–2. */
export function embeddingDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? Math.max(0, 1 - dot / Math.sqrt(na * nb)) : 0;
}

export interface Frame { rgba: ArrayLike<number> }

export interface MeasureIO {
  /**
   * The frame with the item's value set to `value` (null item: unchanged). Null: can't draw.
   * Called synchronously; the first call (the baseline) failing aborts the whole measurement.
   */
  render: (item: FocusItem | null, value?: unknown) => Frame | null;
  /** Embedding of a frame when the image model is loaded (omit or null: pixels only). */
  embed?: (f: Frame) => Promise<ArrayLike<number> | null>;
  budgetMs?: number;
  now?: () => number;
  /** Called with (done, total) after each item. */
  onProgress?: (done: number, total: number) => void;
  /** Let the page breathe between items. Default: a macrotask. */
  yieldNow?: () => Promise<void>;
}

/**
 * Sensitivity of each item, 0–1 (1 = the one that changes the picture most), keyed by weightKey.
 * Null when nothing could be drawn or nothing moved the picture at all (use even weights then).
 * Stops at the time budget (default 1 s); items not reached are absent.
 */
export async function measureSensitivity(items: FocusItem[], io: MeasureIO): Promise<Record<string, number> | null> {
  const now = io.now ?? (() => performance.now());
  const t0 = now();
  const budget = io.budgetMs ?? 1000;
  const yieldNow = io.yieldNow ?? (() => new Promise<void>(r => setTimeout(r, 0)));
  if (!items.length) return null;
  const base = io.render(null);
  if (!base) return null;
  const baseEmb = io.embed ? await io.embed(base).catch(() => null) : null;
  const pix: Array<[string, number]> = [];
  const emb = new Map<string, number>();
  let done = 0;
  for (const it of items) {
    if (now() - t0 > budget) break;
    const dn = io.render(it, it.down), up = io.render(it, it.up);
    if (!dn || !up) { io.onProgress?.(++done, items.length); continue; }
    pix.push([it.weightKey, (frameDifference(base.rgba, dn.rgba) + frameDifference(base.rgba, up.rgba)) / 2]);
    if (baseEmb && io.embed && now() - t0 < budget) {
      const [ed, eu] = await Promise.all([io.embed(dn).catch(() => null), io.embed(up).catch(() => null)]);
      if (ed && eu) emb.set(it.weightKey, (embeddingDistance(baseEmb, ed) + embeddingDistance(baseEmb, eu)) / 2);
    }
    io.onProgress?.(++done, items.length);
    await yieldNow();
  }
  if (!pix.length) return null;
  const maxP = Math.max(...pix.map(p => p[1]));
  const maxE = Math.max(0, ...emb.values());
  if (maxP <= 0 && maxE <= 0) return null;
  const out: Record<string, number> = {};
  for (const [k, p] of pix) {
    const pn = maxP > 0 ? p / maxP : 0;
    const e = emb.get(k);
    out[k] = e !== undefined && maxE > 0 ? 0.5 * pn + 0.5 * (e / maxE) : pn;
  }
  return out;
}
