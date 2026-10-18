/**
 * envelopeGraph.ts — the sums behind the Envelope (ADSR) card's graph (EnvelopeCardViz.tsx), pure so they can be
 * tested: where each point sits for the node's Attack / Decay / Sustain / Release, what dragging a point sets, and
 * where the live value is along the curve.
 *
 * The graph is 0–1 both ways. Each timed stage has its own share of the width (Attack, Decay, Release; a short
 * Sustain plateau between Decay and Release) and its time is drawn on a log-like scale inside its share, so a
 * short time still has room to drag and the view never rescales under the pointer (dragging one point moves only
 * the points after it). Trigger mode (AD) has no Sustain or Release: Decay falls to 0 and takes their room.
 */
export type EnvelopeMode = 'gate' | 'trigger';
export interface EnvelopeParams { attack: number; decay: number; sustain: number; release: number }
export type EnvelopePointKey = 'attack' | 'decay' | 'release';

/** The longest each time can be (memory.ts paramDefs: Attack and Decay 5 s, Release 10 s). */
export const ENV_MAX = { attack: 5, decay: 5, release: 10 } as const;
/** Each stage's share of the width. */
const SHARE_GATE = { attack: 0.3, decay: 0.3, hold: 0.14, release: 0.26 };
const SHARE_TRIGGER = { attack: 0.45, decay: 0.55, hold: 0, release: 0 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The node's params, cleaned (memory.ts defaults). */
export function envelopeParams(p: Record<string, unknown>): EnvelopeParams & { mode: EnvelopeMode } {
  return {
    mode: p.mode === 'trigger' ? 'trigger' : 'gate',
    attack: Math.max(0, Math.min(ENV_MAX.attack, num(p.attack, 0.05))),
    decay: Math.max(0, Math.min(ENV_MAX.decay, num(p.decay, 0.2))),
    sustain: clamp01(num(p.sustain, 0.6)),
    release: Math.max(0, Math.min(ENV_MAX.release, num(p.release, 0.6))),
  };
}

/** Seconds where the time scale turns from even to logarithmic: short times get most of the room. */
const ENV_KNEE = 0.05;
/** Seconds ↔ the fraction of a stage's share: ln(1 + t / knee) ÷ ln(1 + max / knee), finer at short times. */
export const timeToU = (t: number, max: number): number => clamp01(Math.log1p(Math.max(0, t) / ENV_KNEE) / Math.log1p(max / ENV_KNEE));
export const uToTime = (u: number, max: number): number => Math.min(max, ENV_KNEE * Math.expm1(clamp01(u) * Math.log1p(max / ENV_KNEE)));

export interface EnvelopeLayout {
  /** The points, 0–1 (y up): the start, the attack peak, the decay's end (Sustain), the plateau's end, the release's end. */
  start: [number, number];
  attack: [number, number];
  decay: [number, number];
  hold: [number, number];
  release: [number, number];
  share: typeof SHARE_GATE;
}

export function envelopeLayout(p: EnvelopeParams, mode: EnvelopeMode): EnvelopeLayout {
  const share = mode === 'trigger' ? SHARE_TRIGGER : SHARE_GATE;
  const sus = mode === 'trigger' ? 0 : p.sustain;
  const ax = share.attack * timeToU(p.attack, ENV_MAX.attack);
  const dx = ax + share.decay * timeToU(p.decay, ENV_MAX.decay);
  const hx = dx + share.hold;
  const rx = hx + share.release * timeToU(p.release, ENV_MAX.release);
  return { start: [0, 0], attack: [ax, 1], decay: [dx, sus], hold: [hx, sus], release: [mode === 'trigger' ? dx : rx, 0], share };
}

/** Round a time to the millisecond (and a level to a percent and a tenth). */
const ms = (t: number) => Math.round(t * 1000) / 1000;
const lvl = (v: number) => Math.round(clamp01(v) * 1000) / 1000;

/**
 * Drag a point to (x, y) in the graph's 0–1 space: the attack peak sets Attack (sideways), the decay point Decay
 * (sideways) and Sustain (up / down, Gate mode), the release's end Release (sideways). Returns the params it sets.
 */
export function dragEnvelopePoint(key: EnvelopePointKey, x: number, y: number, p: EnvelopeParams, mode: EnvelopeMode): Partial<EnvelopeParams> {
  const L = envelopeLayout(p, mode), s = L.share;
  if (key === 'attack') return { attack: ms(uToTime(x / s.attack, ENV_MAX.attack)) };
  if (key === 'decay') {
    const out: Partial<EnvelopeParams> = { decay: ms(uToTime((x - L.attack[0]) / s.decay, ENV_MAX.decay)) };
    if (mode === 'gate') out.sustain = lvl(y);
    return out;
  }
  if (mode === 'trigger') return {};
  return { release: ms(uToTime((x - L.hold[0]) / Math.max(1e-6, s.release), ENV_MAX.release)) };
}

/** The point nearest (x, y) within `reach` (0–1 units, in each axis scaled by `aspect` = width ÷ height), or null. */
export function nearestEnvelopePoint(L: EnvelopeLayout, mode: EnvelopeMode, x: number, y: number, reach: number, aspect = 1): EnvelopePointKey | null {
  const keys: EnvelopePointKey[] = mode === 'trigger' ? ['attack', 'decay'] : ['attack', 'decay', 'release'];
  let best: EnvelopePointKey | null = null, bd = reach;
  for (const k of keys) {
    const [px, py] = L[k];
    const d = Math.hypot((px - x) * aspect, py - y);
    if (d <= bd) { bd = d; best = k; }
  }
  return best;
}

/**
 * Where the live value sits on the curve, from the node's state (s.x the level 0–1, s.y its stage: 0 resting,
 * 1 attack, 2 decay / sustain, 3 release). Null while resting.
 */
export function envelopePlayhead(L: EnvelopeLayout, mode: EnvelopeMode, level: number, stage: number): [number, number] | null {
  const v = clamp01(level), st = Math.round(stage);
  const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * clamp01(t), v];
  if (st === 1) return lerp(L.start, L.attack, v);
  if (st === 2) {
    const sus = L.decay[1];
    if (v > sus + 1e-3) return lerp(L.attack, L.decay, (1 - v) / Math.max(1e-6, 1 - sus));
    return mode === 'trigger' ? null : [L.decay[0] + (L.hold[0] - L.decay[0]) * 0.5, v];
  }
  if (st === 3 && mode === 'gate') {
    const sus = L.hold[1];
    return lerp(L.hold, L.release, sus > 1e-6 ? 1 - v / sus : 1 - v);
  }
  return null;
}

// ── Labels ────────────────────────────────────────────────────────────────────────────────────────────────

/** "0 ms", "332 ms", "1.25 s". */
export function fmtTime(t: number): string {
  if (t < 1) return `${Math.round(t * 1000)} ms`;
  return `${+t.toFixed(t < 10 ? 2 : 1)} s`;
}
/** A level as a percent and in dB: "60% · −4.4 dB" (0: "0% · −∞ dB"). */
export function fmtLevel(v: number): string {
  const db = v > 0 ? 20 * Math.log10(v) : -Infinity;
  return `${Math.round(v * 100)}% · ${Number.isFinite(db) ? (db === 0 ? '0' : db.toFixed(1).replace('-', '−')) : '−∞'} dB`;
}
