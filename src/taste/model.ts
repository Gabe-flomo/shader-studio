/**
 * model.ts — the taste model (docs/taste.md). Pure and small: a sparse linear score over features.ts,
 * learned online, all on this device.
 *
 *  - Pairs (Evolve's picks, a kept surprise over the ones looked at): Bradley–Terry, a pairwise logistic
 *    P(a ≻ b) = σ(w·(a − b)), one gradient step per pick with L2 and a small learning rate.
 *  - Single ratings (like/dislike, or 1–5 stars mapped to −1…1) and implicit signals (kept or undone
 *    surprise, favourited, edited after keeping, opened often): a logistic step towards the rating, at a
 *    lower weight for the implicit ones.
 *  - A per-stage table: P(choice | stage), smoothed, from what was picked and liked ("you usually put an
 *    Expression Block in the space stage").
 *  - Ranking keeps ~25% exploration: Thompson-ish noise on uncertain features, and an ε share of slots
 *    filled at random, so it never collapses onto one style.
 *
 * Every function returns a new model; nothing here touches storage (store.ts does).
 */
import type { Rng } from '../lib/surprise/rng';
import { FAMILY_BY_ID, TECHNIQUE_BY_ID, type FamilyId } from '../patterns/catalogue';
import type { Features } from './features';

export const TASTE_VERSION = 1;

export type SignalKind = 'pick' | 'rating' | 'kept' | 'undone' | 'favourited' | 'edited' | 'opened';
export type RatingKind = 'graph' | 'shader' | 'example' | 'palette' | 'technique';

export interface Rating { v: number; kind: RatingKind; label?: string; at: number }

export interface TasteModel {
  version: typeof TASTE_VERSION;
  /** Feature weights. */
  w: Record<string, number>;
  /** Evidence per feature (sum of |x| over updates): how sure a weight is. */
  n: Record<string, number>;
  /** stage → choice → positive evidence. */
  stages: Record<string, Record<string, number>>;
  /** Item id (`saved:<name>`, `shader:<id>`, `example:<key>`, `palette:<hash>`, `technique:<id>`) → rating. */
  ratings: Record<string, Rating>;
  /** How many of each signal it has learned from. */
  signals: Partial<Record<SignalKind, number>>;
  /** Times each saved graph was opened (for "opened often"). */
  opens: Record<string, number>;
  /** The image embedder whose emb:* weights these are, if any. */
  embedder?: string;
}

export const LEARNING_RATE = 0.2;
export const L2 = 0.01;
/** The share of ranked slots given to exploration. */
export const EXPLORE = 0.25;

/** How much each signal teaches (a pick teaches 1). The sign is the direction. */
export const SIGNAL_WEIGHT: Record<SignalKind, number> = { pick: 1, rating: 1, kept: 0.5, undone: -0.5, favourited: 0.6, edited: 0.3, opened: 0.15 };

export function emptyModel(): TasteModel {
  return { version: TASTE_VERSION, w: {}, n: {}, stages: {}, ratings: {}, signals: {}, opens: {} };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function tasteScore(m: TasteModel, f: Features): number {
  let s = 0;
  for (const k in f) s += (m.w[k] ?? 0) * f[k];
  return s;
}

/** P(a is preferred over b). */
export function preferProb(m: TasteModel, a: Features, b: Features): number {
  return sigmoid(tasteScore(m, a) - tasteScore(m, b));
}

/** One gradient step on `x` with error `err` (target − prediction), scaled by `rate`; L2 on the touched weights. */
function step(m: TasteModel, x: Features, err: number, rate: number): TasteModel {
  const w = { ...m.w }, n = { ...m.n };
  for (const k in x) {
    const v = x[k];
    if (!v) continue;
    const cur = w[k] ?? 0;
    const next = cur + rate * (err * v - L2 * cur);
    if (Math.abs(next) < 1e-6) delete w[k]; else w[k] = next;
    n[k] = (n[k] ?? 0) + Math.abs(v);
  }
  return { ...m, w, n };
}

const diff = (a: Features, b: Features): Features => {
  const d: Features = {};
  for (const k in a) d[k] = a[k] - (b[k] ?? 0);
  for (const k in b) if (!(k in a)) d[k] = -b[k];
  return d;
};

const stageKeys = (f: Features) => Object.keys(f).filter(k => k.startsWith('st:')).map(k => {
  const [stage, choice] = k.slice(3).split('=');
  return { stage, choice };
});

/** Add evidence to the stage table (negative takes away, never below 0). */
function stageCredit(m: TasteModel, f: Features, amount: number): TasteModel {
  const keys = stageKeys(f);
  if (!keys.length || !amount) return m;
  const stages = { ...m.stages };
  for (const { stage, choice } of keys) {
    const row = { ...(stages[stage] ?? {}) };
    row[choice] = Math.max(0, (row[choice] ?? 0) + amount);
    if (!row[choice]) delete row[choice];
    stages[stage] = row;
  }
  return { ...m, stages };
}

const bump = (m: TasteModel, kind: SignalKind): TasteModel => ({ ...m, signals: { ...m.signals, [kind]: (m.signals[kind] ?? 0) + 1 } });

/** A pick: `winner` was preferred over `loser` (Bradley–Terry step). */
export function learnPair(m: TasteModel, winner: Features, loser: Features, weight = 1, kind: SignalKind | null = 'pick'): TasteModel {
  const d = diff(winner, loser);
  const p = sigmoid(tasteScore(m, d));
  let out = step(m, d, 1 - p, LEARNING_RATE * weight);
  out = stageCredit(out, winner, weight);
  // What the loser had and the winner didn't: a little less likely.
  const lost: Features = {};
  for (const k in loser) if (k.startsWith('st:') && !(k in winner)) lost[k] = 1;
  out = stageCredit(out, lost, -0.25 * weight);
  return kind ? bump(out, kind) : out;
}

/** A single rating, −1 (dislike) … 1 (like), at `weight`. */
export function learnRating(m: TasteModel, f: Features, value: number, weight = 1, kind: SignalKind = 'rating'): TasteModel {
  const v = Math.max(-1, Math.min(1, value));
  const target = (v + 1) / 2;
  const p = sigmoid(tasteScore(m, f));
  let out = step(m, f, target - p, LEARNING_RATE * weight);
  out = stageCredit(out, f, v > 0 ? v * weight : v * weight * 0.5);
  return bump(out, kind);
}

/** An implicit signal (kept, undone, favourited, edited, opened) about a graph with features `f`. */
export function learnSignal(m: TasteModel, kind: Exclude<SignalKind, 'pick' | 'rating'>, f: Features): TasteModel {
  const w = SIGNAL_WEIGHT[kind];
  return learnRating(m, f, Math.sign(w), Math.abs(w), kind);
}

/** 1–5 stars as −1 … 1. */
export const starsToValue = (stars: number) => (Math.max(1, Math.min(5, stars)) - 3) / 2;

/**
 * Rate an item: kept with the item (shown on its control), and learned from. Rating again replaces the
 * old rating's lesson (the old one is unlearned first, approximately); a value of 0 clears it.
 */
export function rateItem(m: TasteModel, item: { id: string; kind: RatingKind; label?: string }, value: number, f: Features, now = Date.now()): TasteModel {
  let out = m;
  const old = m.ratings[item.id];
  if (old && old.v) out = learnRating(out, f, -old.v, 0.5, 'rating');
  const ratings = { ...out.ratings };
  if (value) ratings[item.id] = { v: value, kind: item.kind, ...(item.label ? { label: item.label } : {}), at: now };
  else delete ratings[item.id];
  out = { ...out, ratings };
  if (value) out = learnRating(out, { ...f, [`src:${item.id}`]: 1 }, value, 1, 'rating');
  return out;
}

export const ratingOf = (m: TasteModel, id: string): number => m.ratings[id]?.v ?? 0;

/** Count a saved graph being opened; returns the model and whether it now counts as "opened often". */
export function noteOpened(m: TasteModel, id: string): { model: TasteModel; often: boolean } {
  const c = (m.opens[id] ?? 0) + 1;
  return { model: { ...m, opens: { ...m.opens, [id]: c } }, often: c >= 3 };
}

// ── The per-stage table ──────────────────────────────────────────────────────

/** P(choice | stage), add-one smoothed over `options` choices (at least the ones seen, plus one). */
export function stagePreference(m: TasteModel, stage: string, choice: string, options = 0): number {
  const row = m.stages[stage] ?? {};
  const total = Object.values(row).reduce((s, v) => s + v, 0);
  const K = Math.max(options, Object.keys(row).length + (choice in row ? 0 : 1), 1);
  return ((row[choice] ?? 0) + 1) / (total + K);
}

/** The top choice per stage, with its share and evidence. */
export function stageTops(m: TasteModel, minEvidence = 2): Array<{ stage: string; choice: string; share: number; count: number }> {
  const out: Array<{ stage: string; choice: string; share: number; count: number }> = [];
  for (const [stage, row] of Object.entries(m.stages)) {
    const total = Object.values(row).reduce((s, v) => s + v, 0);
    const best = Object.entries(row).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best && best[1] >= minEvidence) out.push({ stage, choice: best[0], share: best[1] / total, count: best[1] });
  }
  const order = ['space', 'field', 'picture', 'light', 'colour', 'post'];
  return out.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
}

/** "You usually put an Expression Block in the space stage", for stages with a clear favourite. */
export function stageSuggestions(m: TasteModel): string[] {
  return stageTops(m, 3).filter(t => t.share >= 0.5).map(t => `You usually put ${article(t.choice)} in the ${t.stage} stage`);
}
const article = (s: string) => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`);

// ── Biasing the generator ────────────────────────────────────────────────────

/** How much the model knows: 0 with no signals, towards 1 after ~20. */
export function confidence(m: TasteModel): number {
  const n = Object.values(m.signals).reduce((s, v) => s + (v ?? 0), 0);
  return n / (n + 10);
}

/**
 * The lean on a stage's choice for the inspired generator: K·P(choice | stage) and the feature weight,
 * kept between ~0.4 and ~2.5 and mixed with a flat 0.25, so nothing becomes impossible.
 */
export function stageMultiplier(m: TasteModel, stage: string, choice: string, family?: string): number {
  const row = m.stages[stage];
  const k = row ? Math.max(2, Object.keys(row).length + 1) : 2;
  const p = row ? stagePreference(m, stage, choice, k) * k : 1;
  const w = (m.w[`st:${stage}=${choice}`] ?? 0) + (family && family !== 'code' ? (m.w[`fam:${family}`] ?? 0) * 0.5 : 0);
  const lean = Math.max(0.4, Math.min(2.5, p * Math.exp(Math.max(-1, Math.min(1, w)))));
  return 0.25 + 0.75 * lean;
}

/** A source's weight: a liked graph or shader 3×, a disliked one 0.3×, and what picks taught about it. */
export function sourceWeight(m: TasteModel, id: string): number {
  const r = ratingOf(m, id);
  const fromRating = r > 0 ? 1 + 2 * r : r < 0 ? 1 + 0.7 * r : 1;
  return fromRating * Math.exp(Math.max(-1, Math.min(1, m.w[`src:${id}`] ?? 0)));
}

/** How much the model likes a node type, −1 … 1 (through its hashed bucket). */
export function nodeLean(m: TasteModel, bucket: string): number {
  return Math.tanh(m.w[bucket] ?? 0);
}

// ── Ranking with exploration ─────────────────────────────────────────────────

/** Thompson-ish: the score with noise on features the model is unsure of. */
export function sampledScore(m: TasteModel, f: Features, rng: Rng, tau = 0.5): number {
  let s = 0;
  for (const k in f) {
    const sd = tau / Math.sqrt(1 + (m.n[k] ?? 0));
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng.next()))) * Math.cos(2 * Math.PI * rng.next());
    s += ((m.w[k] ?? 0) + sd * z) * f[k];
  }
  return s;
}

/**
 * Order items best first: each slot is, with probability `explore`, a random remaining item (marked
 * explored), else the best by `score` (plus Thompson noise when `noisy` gives it).
 */
export function rankWithExploration<T>(items: readonly T[], score: (item: T, rng: Rng) => number, rng: Rng, explore = EXPLORE): Array<{ item: T; explored: boolean }> {
  const left = items.map(item => ({ item, s: score(item, rng) }));
  const out: Array<{ item: T; explored: boolean }> = [];
  while (left.length) {
    if (left.length > 1 && rng.chance(explore)) {
      const i = Math.floor(rng.next() * left.length);
      out.push({ item: left.splice(i, 1)[0].item, explored: true });
      continue;
    }
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (left[i].s > left[bi].s) bi = i;
    out.push({ item: left.splice(bi, 1)[0].item, explored: false });
  }
  return out;
}

/** Deep's score blended with taste: the taste part grows with confidence, at most ~0.3 of a Deep score's range. */
export function blendScore(deep: number, taste: number, m: TasteModel): number {
  return deep + 0.3 * confidence(m) * Math.tanh(taste);
}

// ── Words ────────────────────────────────────────────────────────────────────

const SETTING_WORD: Record<string, string> = { lo: 'low', mid: 'medium', hi: 'high' };
const IMG_WORD: Record<string, [string, string]> = {
  colourful: ['colourful', 'muted colour'], contrast: ['high contrast', 'low contrast'], detail: ['fine detail', 'simple shapes'],
  motion: ['lots of motion', 'stillness'], structure: ['symmetry', 'asymmetry'], novelty: ['new looks', 'familiar looks'],
};

/** A feature in words, or null for one that means nothing to a person (hashed buckets, the bias). */
export function featureLabel(key: string, positive = true): string | null {
  const [kind, rest = ''] = key.split(/:(.*)/s);
  if (kind === 'st') { const [, choice] = rest.split('='); return choice.charAt(0).toLowerCase() + choice.slice(1); }
  if (kind === 'fam') return FAMILY_BY_ID.get(rest as FamilyId)?.name.toLowerCase() ?? rest;
  if (kind === 'tech') return TECHNIQUE_BY_ID.get(rest)?.name.toLowerCase() ?? rest;
  if (kind === 'pal') return `${rest} palettes`;
  if (kind === 'look') return `${rest} pictures`;
  if (kind === 'code') return rest === 'yes' ? 'code blocks' : 'plain nodes';
  if (kind === 'set') { const [k, b] = rest.split('='); return `${SETTING_WORD[b] ?? b} ${k}`; }
  if (kind === 'img') return IMG_WORD[rest]?.[positive ? 0 : 1] ?? null;
  return null;
}

/** The clearest likes (and dislikes), in words, strongest first. */
export function learnedTraits(m: TasteModel, k = 3, sign: 1 | -1 = 1): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const entries = Object.entries(m.w).filter(([key, v]) => v * sign > 0.05 && featureLabel(key) !== null)
    .sort((a, b) => sign * (b[1] - a[1]) || a[0].localeCompare(b[0]));
  for (const [key, v] of entries) {
    const label = key.startsWith('img:') ? featureLabel(key, v > 0) : featureLabel(key);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= k) break;
  }
  return out;
}

/** The tiny "learned: …" line. */
export function learnedLine(m: TasteModel): string {
  const likes = learnedTraits(m, 3, 1);
  if (!likes.length) return 'still learning: pick the one you like';
  return `you prefer ${likes.length > 1 ? `${likes.slice(0, -1).join(', ')} and ${likes[likes.length - 1]}` : likes[0]}`;
}

/** Why a candidate fits the taste: its features that the model likes most (for why-chips). */
export function tasteWhy(m: TasteModel, f: Features, k = 2): string[] {
  return Object.keys(f).map(key => ({ key, c: (m.w[key] ?? 0) * f[key] }))
    .filter(x => x.c > 0.04 && featureLabel(x.key) !== null && !x.key.startsWith('img:'))
    .sort((a, b) => b.c - a.c).map(x => `your: ${featureLabel(x.key)}`)
    .filter((w, i, all) => all.indexOf(w) === i).slice(0, k);
}
