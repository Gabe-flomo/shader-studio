/**
 * controlFinder.ts — "Suggest controls": which settings are worth putting on Play (docs/suggest-controls.md).
 *
 * It extends Randomize's Focus measurer (randomizeFocus.ts: the same settings walk with the same locks
 * and skips, the same pixel difference and embedding distance) from "nudge ±¼" to a sweep: each free
 * number is drawn at FRACS (5 points) across its interesting range and the five frames are judged.
 * Nothing here draws: `io.render` is passed in, so the scoring is testable with a mocked renderer.
 *
 *   impact      mean change between neighbouring samples inside the usable run (pixel difference,
 *               blended 50/50 with the embedding distance when the image model is loaded), then
 *               divided by the biggest impact measured, then square-rooted so one outlier doesn't
 *               squash the rest (0–1).
 *   smoothness  1 − how much of the total change sits in the biggest single step, rescaled so equal
 *               steps give 1 and one jump gives 0 (a knob wants gradual change).
 *   usable      the longest run of consecutive samples that are not blank, blown out or flat
 *               (lib/surprise degenerateReason); the suggested min/max is that run, widened to hold
 *               the current value. usableFrac = run width / full width.
 *   motion      graphs that move only: the drawn frames are compared with the same frames a second
 *               later; motion = |change at one end of the run − change at the other|, normalised.
 *   distinct    the change pattern (16×16 luminance difference between the run's ends, plus the
 *               embedding difference when loaded) is compared with every setting already chosen;
 *               |cosine| ≥ SAME_EFFECT drops the weaker one.
 *
 *   score = impact · (0.5 + 0.5·smoothness) · (0.5 + 0.5·usableFrac) · (1 + 0.3·motion)
 *
 * Settings whose raw pixel impact is below MIN_IMPACT (nothing visible happens) or with fewer than
 * two usable samples score 0 and are not offered. Ties break on the target path, so a run is
 * deterministic for a given set of renders.
 */
import type { PlayCandidate } from '../play/playControls';
import { degenerateReason, frameStats } from '../lib/surprise';
import { embeddingDistance, focusItems, frameDifference, type Frame } from './randomizeFocus';
import type { GraphNode } from '../types/nodeGraph';
import type { RandomizeOptions } from './randomizeOptions';

/** Where in the interesting range (low end 0, high end 1) each setting is drawn. */
export const FRACS = [0, 0.25, 0.5, 0.75, 1] as const;
/** Raw mean pixel difference under which a setting is taken to do nothing. */
export const MIN_IMPACT = 0.004;
/** |cosine| of two change patterns from which they count as the same effect. */
export const SAME_EFFECT = 0.9;
/** Two frames of the unchanged graph this far apart (pixel difference) mean it is animated. */
export const ANIMATED_DIFF = 0.004;
export const MAX_SUGGESTIONS = 8;
const SIG_SIDE = 16;

export type SampleFrame = Frame & { w?: number; h?: number };

/** A setting the finder can try: a free float that is a live Play candidate. */
export interface ControlItem {
  /** The Play control target path, `node::key` or `group::node::key`. */
  target: string;
  nodeLabel: string;
  groupLabel?: string;
  paramLabel: string;
  hint?: string;
  step?: number;
  /** Ends of the interesting range, and the value now. */
  lo: number;
  hi: number;
  cur: number;
}

/**
 * The settings Suggest controls would try: the ones Randomize would change with these options (locks,
 * skipped nodes; groups always, face and one level in) that are free floats on the Play candidate list and not on Play already.
 * `skipped` counts those left out for being on Play.
 */
export function controlItems(level: GraphNode[], opts: RandomizeOptions, candidates: readonly PlayCandidate[], taken: ReadonlySet<string>): { items: ControlItem[]; onPlay: number } {
  const byTarget = new Map(candidates.filter(c => c.kind === 'float' && typeof c.value === 'number').map(c => [c.target, c]));
  const seen = new Set<string>();
  const items: ControlItem[] = [];
  let onPlay = 0;
  // Group controls are often the ones that matter most, so Suggest controls always looks at a group's
  // face and one level in, whatever Randomize's group toggles say (Play reaches both). Locks still apply.
  for (const f of focusItems(level, { ...opts, focus: false, groupFace: true, insideGroups: true }, [], true)) {
    if (typeof f.lo !== 'number' || typeof f.hi !== 'number') continue;
    const target = [...f.path, f.nodeId, f.key].join('::');
    const c = byTarget.get(target);
    if (!c || seen.has(target)) continue;
    seen.add(target);
    if (taken.has(target)) { onPlay++; continue; }
    let lo = Math.min(f.lo, f.hi), hi = Math.max(f.lo, f.hi);
    if (c.max > c.min) { lo = Math.max(lo, c.min); hi = Math.min(hi, c.max); }
    if (!(hi - lo > 1e-9)) continue;
    items.push({
      target, nodeLabel: c.nodeLabel, groupLabel: c.groupLabel, paramLabel: c.paramLabel, hint: c.hint, step: c.step,
      lo, hi, cur: c.value as number,
    });
  }
  return { items, onPlay };
}

export interface FinderIO {
  /**
   * The frame with the item set to `value` (null item: the graph as it is), at the first (`later`
   * false) or a second time. Null: can't draw. The first, baseline, call failing aborts.
   */
  render: (item: ControlItem | null, value?: number, later?: boolean) => SampleFrame | null;
  /** Draw a chunk of items ahead of time (so the work can be done in one go off the main loop). */
  prefetch?: (items: ControlItem[], animated: boolean) => Promise<void>;
  /** Embedding of a frame when the image model is loaded (omit or null: pixels only). */
  embed?: (f: SampleFrame) => Promise<ArrayLike<number> | null>;
  budgetMs?: number;
  now?: () => number;
  onProgress?: (done: number, total: number) => void;
  yieldNow?: () => Promise<void>;
  /** Items drawn per prefetch. */
  chunk?: number;
}

/** What one setting's five frames say. Pure: exported for tests. */
export interface Analysis {
  /** Sample indices of the longest usable run (inclusive). */
  run: [number, number];
  usableFrac: number;
  /** Mean pixel change per step inside the run (raw, 0–1). */
  impactPx: number;
  impactEmb?: number;
  smoothness: number;
  /** Change patterns for distinctness. */
  signature: number[];
  embSignature?: number[];
}

const sideOf = (f: SampleFrame): { w: number; h: number } => {
  const px = f.rgba.length / 4;
  const w = f.w ?? Math.max(1, Math.round(Math.sqrt(px)));
  return { w, h: f.h ?? Math.max(1, Math.round(px / w)) };
};

/** Can this frame be shown (not blank, blown out or flat)? */
export function frameUsable(f: SampleFrame): boolean {
  const { w, h } = sideOf(f);
  return degenerateReason(frameStats(f.rgba, w, h)) === null;
}

/** 16×16 luminance of a frame, box-averaged. */
function lumaGrid(f: SampleFrame): number[] {
  const { w, h } = sideOf(f);
  const out = new Array<number>(SIG_SIDE * SIG_SIDE).fill(0), cnt = new Array<number>(SIG_SIDE * SIG_SIDE).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, k = Math.min(SIG_SIDE - 1, Math.floor(y * SIG_SIDE / h)) * SIG_SIDE + Math.min(SIG_SIDE - 1, Math.floor(x * SIG_SIDE / w));
      out[k] += (f.rgba[o] + f.rgba[o + 1] + f.rgba[o + 2]) / (3 * 255); cnt[k]++;
    }
  }
  return out.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
}

/** |cosine| of two vectors, 0 when either is flat. */
export function absCosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na > 1e-12 && nb > 1e-12 ? Math.abs(dot / Math.sqrt(na * nb)) : 0;
}

/** The longest run of true (first on ties) as [a, b] inclusive, or null. */
function longestRun(ok: boolean[]): [number, number] | null {
  let best: [number, number] | null = null, start = -1;
  for (let i = 0; i <= ok.length; i++) {
    if (i < ok.length && ok[i]) { if (start < 0) start = i; continue; }
    if (start >= 0) { if (!best || i - 1 - start > best[1] - best[0]) best = [start, i - 1]; start = -1; }
  }
  return best;
}

/** Impact, smoothness, usable run and change pattern of the frames drawn at FRACS. Null when fewer than two neighbours are usable. */
export function analyseSamples(frames: SampleFrame[], emb?: Array<ArrayLike<number> | null>): Analysis | null {
  if (frames.length !== FRACS.length) return null;
  const run = longestRun(frames.map(frameUsable));
  if (!run || run[1] - run[0] < 1) return null;
  const [a, b] = run;
  const steps: number[] = [], eSteps: number[] = [];
  for (let i = a; i < b; i++) {
    steps.push(frameDifference(frames[i].rgba, frames[i + 1].rgba));
    const e0 = emb?.[i], e1 = emb?.[i + 1];
    if (e0 && e1) eSteps.push(embeddingDistance(e0, e1));
  }
  const sum = steps.reduce((x, y) => x + y, 0), n = steps.length;
  const impactPx = sum / n;
  let smoothness = 0;
  if (sum > 0) smoothness = n === 1 ? 0.5 : Math.min(1, Math.max(0, 1 - (Math.max(...steps) / sum - 1 / n) / (1 - 1 / n)));
  const ga = lumaGrid(frames[a]), gb = lumaGrid(frames[b]);
  const ea = emb?.[a], eb = emb?.[b];
  return {
    run: [a, b], usableFrac: (b - a) / (FRACS.length - 1), impactPx, smoothness,
    ...(eSteps.length === n ? { impactEmb: eSteps.reduce((x, y) => x + y, 0) / n } : {}),
    signature: gb.map((v, i) => v - ga[i]),
    ...(ea && eb ? { embSignature: Array.from(eb, (v, i) => v - ea[i]) } : {}),
  };
}

export interface Suggestion {
  target: string;
  /** "Node · Setting" (the deterministic label; the naming hook may offer a friendlier one). */
  label: string;
  nodeLabel: string;
  groupLabel?: string;
  paramLabel: string;
  hint?: string;
  /** Suggested slider range: the usable sub-range, widened to hold the current value. */
  min: number;
  max: number;
  step?: number;
  value: number;
  /** 0–1 each. */
  impact: number;
  smoothness: number;
  /** Share of the interesting range that gives a usable picture. */
  usable: number;
  motion: number;
  score: number;
  /** Frames across the usable range (2–5), as drawn. */
  frames: SampleFrame[];
  /** Dropped settings this one stands in for (same effect, weaker). */
  similar: string[];
}

export interface FinderResult {
  suggestions: Suggestion[];
  /** Settings tried / offered to try. */
  measured: number;
  total: number;
  /** Everything was reached inside the time box. */
  complete: boolean;
  animated: boolean;
  usedEmbedding: boolean;
}

/** "Node · Setting", with the group in front for a setting inside one (same as the Play panel's default). */
export function controlLabel(c: Pick<ControlItem, 'nodeLabel' | 'groupLabel' | 'paramLabel'>): string {
  return `${c.groupLabel ? `${c.groupLabel} › ` : ''}${c.nodeLabel} · ${c.paramLabel}`;
}

/** A range end tidied for a slider: 3 decimals (or the step's), never collapsing the range. */
function tidy(v: number, step?: number): number {
  const d = step && step > 0 ? Math.max(0, Math.min(6, Math.ceil(-Math.log10(step) - 1e-9))) : 3;
  return +v.toFixed(d);
}

interface Measured {
  item: ControlItem;
  an: Analysis;
  frames: SampleFrame[];
  motionRaw: number;
}

/**
 * Rank the free settings by how much, how smoothly and how usefully they change the picture. Null when
 * nothing could be drawn or nothing moved it. Stops at the time budget (default 2.5 s); settings not
 * reached are simply not offered (`complete` false).
 */
export async function findControls(items: ControlItem[], io: FinderIO): Promise<FinderResult | null> {
  const now = io.now ?? (() => performance.now());
  const t0 = now();
  const budget = io.budgetMs ?? 2500;
  const yieldNow = io.yieldNow ?? (() => new Promise<void>(r => setTimeout(r, 0)));
  const chunkSize = io.chunk ?? 6;
  if (!items.length) return null;
  const base = io.render(null);
  if (!base) return null;
  const later = io.render(null, undefined, true);
  const animated = !!later && frameDifference(base.rgba, later.rgba) > ANIMATED_DIFF;
  const valueAt = (it: ControlItem, i: number) => it.lo + (it.hi - it.lo) * FRACS[i];

  const measured: Measured[] = [];
  let done = 0, usedEmbedding = false, reached = 0;
  for (let c = 0; c < items.length; c += chunkSize) {
    if (now() - t0 > budget) break;
    const chunk = items.slice(c, c + chunkSize);
    await io.prefetch?.(chunk, animated);
    for (const it of chunk) {
      reached++;
      const frames = FRACS.map((_, i) => io.render(it, valueAt(it, i)));
      if (frames.some(f => !f)) { io.onProgress?.(++done, items.length); continue; }
      const fr = frames as SampleFrame[];
      let emb: Array<ArrayLike<number> | null> | undefined;
      if (io.embed && now() - t0 < budget * 0.8) {
        const got = await Promise.all(fr.map(f => io.embed!(f).catch(() => null)));
        if (got.every(Boolean)) { emb = got; usedEmbedding = true; }
      }
      const an = analyseSamples(fr, emb);
      if (an && an.impactPx >= MIN_IMPACT) {
        let motionRaw = 0;
        if (animated) {
          const m = (i: number) => {
            const l = io.render(it, valueAt(it, i), true);
            return l ? frameDifference(fr[i].rgba, l.rgba) : 0;
          };
          motionRaw = Math.abs(m(an.run[0]) - m(an.run[1]));
        }
        measured.push({ item: it, an, frames: fr.slice(an.run[0], an.run[1] + 1), motionRaw });
      }
      io.onProgress?.(++done, items.length);
    }
    await yieldNow();
  }
  if (!measured.length) return reached ? { suggestions: [], measured: reached, total: items.length, complete: reached === items.length, animated, usedEmbedding } : null;

  const maxP = Math.max(...measured.map(m => m.an.impactPx));
  const maxE = Math.max(0, ...measured.map(m => m.an.impactEmb ?? 0));
  const maxM = Math.max(0, ...measured.map(m => m.motionRaw));
  const scored = measured.map(m => {
    const pn = maxP > 0 ? m.an.impactPx / maxP : 0;
    // Square root: one outlier setting must not squash every other into the bottom tenth.
    const impact = Math.sqrt(m.an.impactEmb !== undefined && maxE > 0 ? 0.5 * pn + 0.5 * (m.an.impactEmb / maxE) : pn);
    const motion = maxM > 0 ? m.motionRaw / maxM : 0;
    const score = impact * (0.5 + 0.5 * m.an.smoothness) * (0.5 + 0.5 * m.an.usableFrac) * (1 + 0.3 * motion);
    return { m, impact, motion, score };
  }).sort((x, y) => y.score - x.score || (x.m.item.target < y.m.item.target ? -1 : 1));

  const picked: Array<{ s: (typeof scored)[number]; similar: string[] }> = [];
  for (const s of scored) {
    if (picked.length >= MAX_SUGGESTIONS) break;
    const twin = picked.find(p => {
      const px = absCosine(p.s.m.an.signature, s.m.an.signature);
      const e = p.s.m.an.embSignature && s.m.an.embSignature ? absCosine(p.s.m.an.embSignature, s.m.an.embSignature) : null;
      return (e === null ? px : (px + e) / 2) >= SAME_EFFECT;
    });
    if (twin) twin.similar.push(controlLabel(s.m.item)); else picked.push({ s, similar: [] });
  }

  const suggestions: Suggestion[] = picked.map(({ s, similar }) => {
    const it = s.m.item, [a, b] = s.m.an.run;
    let min = Math.min(valueAt(it, a), it.cur), max = Math.max(valueAt(it, b), it.cur);
    min = tidy(min, it.step); max = tidy(max, it.step);
    if (!(max > min)) { min = valueAt(it, a); max = valueAt(it, b); }
    return {
      target: it.target, label: controlLabel(it), nodeLabel: it.nodeLabel, groupLabel: it.groupLabel, paramLabel: it.paramLabel,
      hint: it.hint, min, max, ...(it.step ? { step: it.step } : {}), value: it.cur,
      impact: s.impact, smoothness: s.m.an.smoothness, usable: s.m.an.usableFrac, motion: s.motion, score: s.score,
      frames: s.m.frames, similar,
    };
  });
  return { suggestions, measured: reached, total: items.length, complete: reached === items.length, animated, usedEmbedding };
}
