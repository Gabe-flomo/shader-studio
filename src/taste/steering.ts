/**
 * steering.ts — "Your steering" (docs/taste.md): what you tell the taste model yourself, kept apart from
 * what it learned. It never changes a learned weight (so a trace stays clean); it sits on top:
 *
 *     score(graph) = learned · x + steering · x
 *
 * Steering comes from the context box (parsed into chips, context.ts), from pins (boost / avoid / ban on a
 * feature) and from three dials: exploration, how strongly taste leans Surprise / Deep / Evolve, and the
 * Do bar's nudge. A ban is hard: the generator never picks a banned stage choice, technique, family or
 * source (bias.ts, compose.ts `planFor`). Pure.
 */
import { TECHNIQUE_BY_ID } from '../patterns/catalogue';
import { EXPLORE, type TasteModel } from './model';
import type { Features } from './features';

export type Pin = 'boost' | 'avoid' | 'ban';

/** One thing the context box understood: a phrase, the features it means, and which way. */
export interface Chip {
  /** Stable for the phrase's meaning (`syn:dark`, `tech:fbm`, …): edits are kept by it. */
  id: string;
  /** The words it read. */
  phrase: string;
  /** What it means, in words. */
  label: string;
  features: string[];
  sign: 1 | -1;
  /** The text said "no", "less", "without"… before it (the sign is already reversed for it). */
  negated?: boolean;
  /** You flipped it (its sign is reversed). */
  flipped?: boolean;
  /** You removed it (it counts for nothing). */
  off?: boolean;
}

export interface Steering {
  context: string;
  chips: Chip[];
  /** Words the context box didn't understand. */
  unknown: string[];
  pins: Record<string, Pin>;
  /** The share of ranked slots and fresh seeds given to exploration (0 … 1). */
  explore: number;
  /** How strongly taste leans Surprise, Deep and Evolve (0 = not at all, 1 = as learned, 2 = twice). */
  lean: number;
  /** The Do bar's type-ahead and node search lean on taste. */
  nudge: boolean;
}

/** What a chip adds to each of its features. */
export const CHIP_WEIGHT = 0.6;
/** What a pin adds. */
export const PIN_WEIGHT: Record<Pin, number> = { boost: 1, avoid: -1, ban: -3 };
/** A steering weight never goes past this. */
const STEER_MAX = 3;

export const defaultSteering = (): Steering => ({ context: '', chips: [], unknown: [], pins: {}, explore: EXPLORE, lean: 1, nudge: true });

export const chipSign = (c: Chip): number => (c.off ? 0 : c.flipped ? -c.sign : c.sign);
/** Whether you want what the chip's label says (else you want less of it): negation and a flip each turn it round. */
export const chipWanted = (c: Chip): boolean => !c.negated === !c.flipped;

/** The steering layer as weights (separate from the learned ones). */
export function steeringWeights(s: Steering): Record<string, number> {
  const w: Record<string, number> = {};
  for (const c of s.chips) {
    const sg = chipSign(c);
    if (!sg) continue;
    for (const f of c.features) w[f] = (w[f] ?? 0) + sg * CHIP_WEIGHT;
  }
  for (const [f, p] of Object.entries(s.pins)) w[f] = (w[f] ?? 0) + PIN_WEIGHT[p];
  for (const k of Object.keys(w)) { w[k] = Math.max(-STEER_MAX, Math.min(STEER_MAX, w[k])); if (!w[k]) delete w[k]; }
  return w;
}

export const hasSteering = (s: Steering): boolean => Object.keys(steeringWeights(s)).length > 0;

/** The features you banned. */
export function bans(s: Steering): Set<string> {
  return new Set(Object.entries(s.pins).filter(([, p]) => p === 'ban').map(([f]) => f));
}

/** Whether a feature vector has anything banned in it. */
export function isAllowed(f: Features, banned: ReadonlySet<string>): boolean {
  if (!banned.size) return true;
  for (const k in f) if (f[k] && banned.has(k)) return false;
  return true;
}

/** Whether a stage's choice (from the inspired generator) is banned: its stage choice, technique, family, or code. */
export function isBannedChoice(banned: ReadonlySet<string>, stage: string, choice: string, family: string): boolean {
  if (!banned.size) return false;
  if (banned.has(`st:${stage}=${choice}`) || banned.has(`fam:${family}`)) return true;
  if (family === 'code' && banned.has('code:yes')) return true;
  for (const k of banned) {
    if (!k.startsWith('tech:')) continue;
    const t = TECHNIQUE_BY_ID.get(k.slice(5));
    if (t && (t.name === choice)) return true;
  }
  return false;
}

/**
 * The model the generators use: learned + steering, times the lean. The learned model is not touched (a
 * new object comes back). A lean of 0 gives an empty model (no lean at all, as with nothing learned).
 */
export function effectiveModel(m: TasteModel, s: Steering): TasteModel {
  const sw = steeringWeights(s);
  if (s.lean <= 0) return { ...m, w: {}, stages: {}, ratings: {}, steered: 0 };
  if (!Object.keys(sw).length && s.lean === 1) return m;
  const w: Record<string, number> = {};
  for (const k of new Set([...Object.keys(m.w), ...Object.keys(sw)])) {
    const v = s.lean * ((m.w[k] ?? 0) + (sw[k] ?? 0));
    if (v) w[k] = v;
  }
  return { ...m, w, steered: Object.keys(sw).length };
}

export interface Contribution { key: string; x: number; learned: number; steering: number }
export interface ScoreBreakdown { learned: number; steering: number; total: number; top: Contribution[] }

/** A graph's score, split into what was learned and what you steered, with its top contributing features. */
export function scoreBreakdown(m: TasteModel, s: Steering, f: Features, k = 8): ScoreBreakdown {
  const sw = steeringWeights(s);
  let learned = 0, steering = 0;
  const all: Contribution[] = [];
  for (const key in f) {
    const x = f[key];
    const l = (m.w[key] ?? 0) * x, st = (sw[key] ?? 0) * x;
    learned += l; steering += st;
    if (l || st) all.push({ key, x, learned: l, steering: st });
  }
  all.sort((a, b) => Math.abs(b.learned + b.steering) - Math.abs(a.learned + a.steering) || a.key.localeCompare(b.key));
  return { learned, steering, total: learned + steering, top: all.slice(0, k) };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const PINS = new Set<Pin>(['boost', 'avoid', 'ban']);

/** Read stored steering (whatever is unreadable falls back to the default). */
export function parseSteering(v: unknown): Steering {
  const d = defaultSteering();
  if (!isRecord(v)) return d;
  const chips: Chip[] = [];
  if (Array.isArray(v.chips)) for (const c of v.chips) {
    if (!isRecord(c) || typeof c.id !== 'string' || !Array.isArray(c.features)) continue;
    chips.push({
      id: c.id, phrase: String(c.phrase ?? ''), label: String(c.label ?? c.id), features: c.features.filter((x): x is string => typeof x === 'string'),
      sign: c.sign === -1 ? -1 : 1, ...(c.negated ? { negated: true } : {}), ...(c.flipped ? { flipped: true } : {}), ...(c.off ? { off: true } : {}),
    });
  }
  const pins: Record<string, Pin> = {};
  if (isRecord(v.pins)) for (const [k, p] of Object.entries(v.pins)) if (PINS.has(p as Pin)) pins[k] = p as Pin;
  const num = (x: unknown, lo: number, hi: number, def: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : def);
  return {
    context: typeof v.context === 'string' ? v.context : '',
    chips,
    unknown: Array.isArray(v.unknown) ? v.unknown.filter((x): x is string => typeof x === 'string') : [],
    pins,
    explore: num(v.explore, 0, 1, d.explore),
    lean: num(v.lean, 0, 2, d.lean),
    nudge: typeof v.nudge === 'boolean' ? v.nudge : d.nudge,
  };
}
