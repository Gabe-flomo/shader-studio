/**
 * increment.js — Increment mappings: a target that moves in steps rather than
 * following its source (docs/increment-mapping.md). The logic both the Play
 * engine (lib/playEngine.ts) and the web runtime (runtime/play-runtime.js,
 * through the inlined kit as SSKit.increment) run, so a setup steps the same
 * in the app, in a take and on a website. Pure: no DOM, no clock of its own;
 * everything comes in as arguments, so the same frames give the same steps.
 *
 *   incNew        a mapping's memory, starting at a value
 *   incThreshold  a continuous reading crossing a threshold (rising, and optionally
 *                 falling), with hysteresis so a noisy source doesn't fire twice
 *   incRepeat     a clock: every N seconds or beats, on the graph clock
 *   incAdvance    take N increments: grow the step, apply the limit, wrap back after K
 *   incGlide      one frame of the slide between steps; the value to write
 *   incStepSize   the size of the next step for a growth mode
 *   incFold       a position folded into the range (clamp, wrap or bounce)
 *
 * The position is kept unfolded (`p`), so a wrap or a bounce glides through
 * the edge instead of jumping back across the range; what's written is always
 * folded into the range.
 *
 * Top-level names start with `inc` (the kit's files share one scope in exports).
 */

/** The most increments one frame applies (a clock that jumped, a burst of presses). */
export const INC_BURST = 16;
/** Steps never grow past this (a compound step doubling for ever stays a number). */
const INC_BIG = 1e9;

/** A mapping's memory: where it is, where it glides from, how many steps since the last wrap-back. */
export function incNew(start) {
  const s = Number.isFinite(start) ? start : 0;
  return { start: s, p: s, from: s, g: 1, n: 0, count: 0, dir: 1, open: false, known: false, tick: null };
}

/** The range a mapping moves in: its outMin..outMax, either way round. */
export function incRange(outMin, outMax) {
  return outMin <= outMax ? [outMin, outMax] : [outMax, outMin];
}

/** A position folded into lo..hi: clamped, wrapped round (hi is lo again) or bounced back off the edges. */
export function incFold(p, lo, hi, limit) {
  const span = hi - lo;
  if (!(span > 0)) return lo;
  if (limit === 'wrap') { const q = (p - lo) % span; return lo + (q < 0 ? q + span : q); }
  if (limit === 'bounce') {
    const q0 = (p - lo) % (2 * span), q = q0 < 0 ? q0 + 2 * span : q0;
    return lo + (q <= span ? q : 2 * span - q);
  }
  return p < lo ? lo : p > hi ? hi : p;
}

/**
 * The size of the step after `n` steps since the last wrap-back (0 = the first), always ≥ 0:
 *   constant      step every time
 *   compound      step × factor^n (0.5, 1, 2, 4… with factor 2)
 *   additive      step + factor × n (2, 3, 4… with step 2, factor 1)
 *   proportional  step % of the current value, at least minStep (so it can leave 0)
 */
export function incStepSize(inc, n, current) {
  const step = Math.abs(inc.step);
  let s;
  switch (inc.growth) {
    case 'compound': s = step * Math.pow(inc.factor, n); break;
    case 'additive': s = step + inc.factor * n; break;
    case 'proportional': s = Math.max(Math.abs(inc.minStep || 0), Math.abs(current) * step / 100); break;
    default: s = step;
  }
  if (!Number.isFinite(s)) return INC_BIG;
  return Math.max(0, Math.min(INC_BIG, Math.abs(s)));
}

const incEase = (curve, t) => (curve === 'smooth' ? t * t * (3 - 2 * t) : curve === 'out' ? 1 - (1 - t) * (1 - t) : curve === 'in' ? t * t : t);

/** Where the glide is now, unfolded. */
function incShown(st, inc) {
  return st.g >= 1 ? st.p : st.from + (st.p - st.from) * incEase(inc.glideCurve, st.g);
}

/**
 * A threshold on a 0..1 reading: rises when `v` reaches `threshold`, and is
 * ready again only once `v` has gone back under threshold − hysteresis (that
 * fall counts too with `falling`). A value already over the threshold when it
 * starts, or a missing one, doesn't fire. Returns how many increments (0 or 1).
 */
export function incThreshold(st, v, inc) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 0;
  const th = inc.threshold, h = Math.max(0, inc.hysteresis || 0);
  if (!st.known) { st.known = true; st.open = v >= th; return 0; }
  if (!st.open && v >= th) { st.open = true; return 1; }
  if (st.open && v < th - h) { st.open = false; return inc.falling ? 1 : 0; }
  return 0;
}

/** Seconds between a repeat's increments: `every` seconds, or `every` beats at `bpm`. */
export function incPeriod(inc) {
  const every = Math.max(0.01, inc.every || 0);
  return inc.unit === 'beats' ? every * 60 / Math.max(1, inc.bpm || 120) : every;
}

/**
 * A repeat on the graph clock: one increment each time `time` passes a
 * multiple of the period. The first frame only looks; a clock sent back just
 * looks again (the caller starts the mapping over). `allowed` false (its
 * condition doesn't hold) lets the ticks pass without stepping.
 */
export function incRepeat(st, time, inc, allowed) {
  const idx = Math.floor(time / incPeriod(inc) + 1e-9);
  if (st.tick === null || idx < st.tick) { st.tick = idx; return 0; }
  const n = idx - st.tick;
  st.tick = idx;
  return allowed ? Math.min(INC_BURST, n) : 0;
}

/**
 * Take `count` increments. Each is a step of the growth mode's size in the
 * mapping's direction (turned round while ping-ponging), clamped, wrapped or
 * bounced at lo..hi, gliding from wherever the value is now. After `wrapAfter`
 * steps (0 = never) the next increment returns to the start instead (snap or
 * glide) and starts the growth over; ping-pong turns round and starts the
 * growth over instead, so it walks back to the start in as many steps.
 * Returns what happened, in order: 'step' and 'reset'.
 */
export function incAdvance(st, inc, lo, hi, count) {
  const out = [];
  const span = hi - lo;
  for (let i = 0; i < Math.min(INC_BURST, count); i++) {
    const shown = incShown(st, inc);
    if (inc.wrapAfter > 0 && st.n >= inc.wrapAfter) {
      st.n = 0;
      out.push('reset');
      if (inc.wrapBack === 'pingpong') st.dir = -st.dir;
      else {
        // Straight back from what shows now to the start.
        st.from = incFold(shown, lo, hi, inc.limit);
        st.p = st.start;
        st.g = inc.wrapBack === 'glide' && inc.glideMs > 0 ? 0 : 1;
        continue;
      }
    }
    const size = incStepSize(inc, st.n, incFold(st.p, lo, hi, inc.limit));
    st.from = shown;
    st.p += (inc.direction < 0 ? -1 : 1) * st.dir * size;
    if (inc.limit !== 'wrap' && inc.limit !== 'bounce') { st.p = incFold(st.p, lo, hi, 'clamp'); st.from = incFold(st.from, lo, hi, 'clamp'); }
    else if (span > 0) {
      // Keep the unfolded numbers small: move both ends by whole periods.
      const period = inc.limit === 'wrap' ? span : 2 * span;
      const k = Math.floor((st.p - lo) / period);
      if (k) { st.p -= k * period; st.from -= k * period; }
    }
    st.g = inc.glideMs > 0 ? 0 : 1;
    st.n++;
    st.count++;
    out.push('step');
  }
  return out;
}

/** Back to the start: the value, the growth, the direction, and (with `rearm`) the triggers too. */
export function incReset(st, start, rearm) {
  const s = Number.isFinite(start) ? start : st.start;
  st.start = s; st.p = s; st.from = s; st.g = 1; st.n = 0; st.count = 0; st.dir = 1;
  if (rearm) { st.open = false; st.known = false; st.tick = null; }
}

/** One frame of the glide (`dt` seconds); returns the value to write, folded into lo..hi. */
export function incGlide(st, inc, lo, hi, dt) {
  if (st.g < 1) st.g = inc.glideMs > 0 ? Math.min(1, st.g + (dt * 1000) / inc.glideMs) : 1;
  return incFold(incShown(st, inc), lo, hi, inc.limit);
}

/** Is it mid-glide (the render loop keeps drawing)? */
export function incGliding(st) {
  return st.g < 1;
}
