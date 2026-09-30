/**
 * signals.js — conditions, signals and axis swaps: the logic both the Play
 * engine (lib/playEngine.ts) and the web runtime (runtime/play-runtime.js,
 * through the inlined kit as SSKit.signals) run, so a setup behaves the same
 * in the app, in a take and on a website. Pure: no DOM, no clock.
 *
 *   sgGate          is a value past a threshold (below, above, equal within a
 *                   tolerance, not equal, between or outside two edges), with
 *                   hysteresis so it doesn't flicker at the edge
 *   sgCondStep      a condition over frames: opens, closes, or taps once for a
 *                   crossing (crosses up / crosses down); raw or as a share of
 *                   the value's range; has never reached
 *   sgRunActions    one frame of actions, with signals passed on down a chain:
 *                   each signal at most once a frame, and at most SG_DEPTH links
 *   sgSwapStep      the axis swap of a pair mapping: drive A until it crosses a
 *                   threshold, then B until B crosses the swap-back threshold
 *   sgParseValueRef what a condition's value path points at
 *
 * Top-level names start with `sg` (the kit's files share one scope in exports).
 */

/** Links a signal chain may pass through in one frame; what's left carries on next frame. */
export const SG_DEPTH = 8;

/**
 * Is the condition met, given whether it was met last frame? `v` null (a hand
 * out of view, a missing layer) is never met.
 *   below    opens under `threshold`, holds until above threshold + hysteresis
 *   above    opens over `threshold`, holds until below threshold − hysteresis
 *   equals   opens within `tolerance` of it, holds until tolerance + hysteresis
 *   not      the opposite of equals: opens further than `tolerance` from it,
 *            holds until back within tolerance − hysteresis
 *   between  opens inside `threshold`..`hi`, holds until hysteresis past an edge
 *   outside  opens beyond either edge, holds until hysteresis back inside
 * A crossing reads as the level it crosses into (crossUp → above). A band's
 * edges can be given either way round.
 */
export function sgGate(open, v, cmp, threshold, hysteresis, tolerance, hi) {
  if (v === null || v === undefined || !Number.isFinite(v)) return false;
  const h = Math.max(0, hysteresis || 0);
  switch (cmp) {
    case 'below': case 'crossDown':
      return open ? v <= threshold + h : v < threshold;
    case 'equals': {
      const tol = Math.max(0, tolerance || 0);
      return Math.abs(v - threshold) <= (open ? tol + h : tol);
    }
    case 'not': {
      const tol = Math.max(0, tolerance || 0);
      return Math.abs(v - threshold) > (open ? Math.max(0, tol - h) : tol);
    }
    case 'between': case 'outside': {
      const b = Number.isFinite(hi) ? hi : threshold;
      const lo = Math.min(threshold, b), up = Math.max(threshold, b);
      if (cmp === 'between') return open ? v >= lo - h && v <= up + h : v >= lo && v <= up;
      // Outside lets go only once well inside; a band narrower than twice the hysteresis lets go at its middle.
      if (!open) return v < lo || v > up;
      const inLo = Math.min(lo + h, (lo + up) / 2), inHi = Math.max(up - h, (lo + up) / 2);
      return !(v >= inLo && v <= inHi);
    }
    default:
      return open ? v >= threshold - h : v > threshold;
  }
}

/** A condition's memory between frames: met or not, whether it has a reading yet, the lowest and highest seen, and a direction's two averages. */
export function sgCondNew() {
  return { open: false, known: false, lo: Infinity, hi: -Infinity, fast: NaN, slow: NaN };
}

/** The clock went back (a rewind): forget the lowest and highest seen and the averages, so the same timeline reads the same way again. */
export function sgCondRewind(st) {
  st.lo = Infinity; st.hi = -Infinity; st.fast = NaN; st.slow = NaN;
}

/** Does this comparison look at which way the value is going (rising, falling, changing, steady)? */
export function sgIsDirection(cmp) {
  return cmp === 'rising' || cmp === 'falling' || cmp === 'changing' || cmp === 'steady';
}

/**
 * Which way a value is going: a fast average against a slow one (the idea
 * behind MACD), both following the value by the clock, so the frame rate
 * doesn't change the answer. `window` (seconds, default 0.5) is how far back
 * "before" is: the slow average's time constant. `noise` (0..1, default 0.3)
 * is the fast one's, as a share of the window: 0 is the value itself (quick,
 * but it takes the noise), higher smooths the noise away. Returns fast − slow:
 * above 0 rising, below falling. A paused clock (dt 0) holds both.
 */
export function sgDirStep(st, x, window, noise, dt) {
  if (!Number.isFinite(st.fast)) { st.fast = x; st.slow = x; return 0; }
  const w = Math.max(0.01, window > 0 ? window : 0.5);
  const tf = Math.max(0, Math.min(1, noise === undefined || noise === null ? 0.3 : noise)) * w;
  const d = dt > 0 ? dt : 0;
  st.fast = tf > 0 ? st.fast + (x - st.fast) * (1 - Math.exp(-d / tf)) : x;
  st.slow += (x - st.slow) * (1 - Math.exp(-d / w));
  return st.fast - st.slow;
}

/**
 * A direction's gate on `diff` (fast − slow), `dead` the dead-band (how big a
 * change counts as moving; the condition's threshold) with hysteresis `h`:
 * rising opens over it and holds down to dead − h; falling mirrors it;
 * changing is either way; steady is changing turned round.
 */
export function sgDirGate(open, diff, cmp, dead, h) {
  const d = Math.max(0, dead || 0), hh = Math.max(0, h || 0);
  const lo = Math.max(0, d - hh);
  switch (cmp) {
    case 'rising': return open ? diff > lo : diff > d;
    case 'falling': return open ? diff < -lo : diff < -d;
    case 'changing': return open ? Math.abs(diff) > lo : Math.abs(diff) > d;
    default: return open ? Math.abs(diff) <= d + hh : Math.abs(diff) <= d;
  }
}

/** Does this comparison look at the history (the lowest or highest seen) rather than the value now? */
export function sgIsHistory(cmp) {
  return cmp === 'neverAbove' || cmp === 'neverBelow';
}

/**
 * `v` as a share of a range: (v − lo) / (hi − lo). A range of nothing reads
 * 0; a reversed range (hi < lo) works too. `range` is [lo, hi], or null for
 * the range seen so far (unbounded readings: a speed, a count, a distance).
 */
export function sgPct(v, lo, hi) {
  return hi === lo ? 0 : (v - lo) / (hi - lo);
}

/** Does this comparison fire on the crossing only (a tap), rather than while it holds? */
export function sgIsCrossing(cmp) {
  return cmp === 'crossUp' || cmp === 'crossDown';
}

/**
 * One frame of a condition (`c`: { cmp, threshold, hi, hysteresis,
 * tolerance, unit }) reading `v`. Returns what happened:
 *   'open'   a level condition became true (a press that is held)
 *   'close'  it stopped being true (the release)
 *   'tap'    a crossing happened: a press and its release in one frame
 *   null     nothing changed
 * A crossing needs to have seen the other side first: a value already above
 * when it starts doesn't count as crossing up.
 *
 * `c.unit` 'pct': the thresholds (and hysteresis and tolerance) are shares of
 * the value's range, 0..1: `range` ([lo, hi], the host's: a control's or a
 * layer property's own), else the range seen so far. Has never reached
 * (neverAbove / neverBelow) holds while the highest (lowest) value seen has
 * stayed under (over) the threshold; it needs one reading first.
 *
 * Rising / falling / changing / steady (sgDirStep) compare a fast average
 * with a slow one over `c.window` seconds, `c.noise` smoothing the fast one;
 * the threshold is the dead-band. They follow the clock: `dt` is the frame
 * step in seconds (1/60 when not given).
 */
export function sgCondStep(st, v, c, range, dt) {
  const was = st.open;
  const ok = v !== null && v !== undefined && Number.isFinite(v);
  if (ok) { if (v < st.lo) st.lo = v; if (v > st.hi) st.hi = v; }
  const pct = c.unit === 'pct';
  const lo = range ? range[0] : st.lo, hi = range ? range[1] : st.hi;
  const unit = x => (pct ? sgPct(x, lo, hi) : x);
  let now;
  if (sgIsDirection(c.cmp)) now = ok && sgDirGate(was, sgDirStep(st, unit(v), c.window, c.noise, dt === undefined ? 1 / 60 : dt), c.cmp, c.threshold, c.hysteresis);
  else if (sgIsHistory(c.cmp)) now = st.hi >= st.lo && (c.cmp === 'neverAbove' ? unit(st.hi) < c.threshold : unit(st.lo) > c.threshold);
  else now = sgGate(was, ok ? unit(v) : v, c.cmp, c.threshold, c.hysteresis, c.tolerance, c.hi);
  st.open = now;
  if (sgIsCrossing(c.cmp)) {
    const seen = st.known;
    st.known = ok;
    return now && !was && seen ? 'tap' : null;
  }
  st.known = v !== null && v !== undefined;
  if (now && !was) return 'open';
  if (!now && was) return 'close';
  return null;
}

/**
 * One frame of actions. `fires(a)` says how many times action `a` fires now
 * (its trigger's firing mode, capped by the caller); `run(a)` carries out an
 * ordinary action; `emit(id)` presses signal `id` (its "When signal fires"
 * triggers see it at once). An action whose `do` is 'signal' emits its
 * `signal` instead of running.
 *
 * After the first pass, actions triggered by a signal get another look, so a
 * chain (A fires B, B fires C) runs within the frame. Each signal fires at
 * most once a frame and a chain stops after SG_DEPTH passes, so a loop (A
 * fires B fires A) can't hang the page. Returns the signals fired, in order.
 * `stats` (optional) gets the deepest pass reached and whether the guard stopped a chain.
 */
export function sgRunActions(actions, fires, run, emit, stats) {
  const fired = new Set();
  const order = [];
  let wave = actions;
  for (let depth = 0; depth < SG_DEPTH && wave.length; depth++) {
    if (stats) stats.depth = Math.max(stats.depth, depth + 1);
    let emitted = false;
    for (const a of wave) {
      const n = fires(a);
      for (let i = 0; i < n; i++) {
        if (a.do === 'signal') {
          if (a.signal && !fired.has(a.signal)) { fired.add(a.signal); order.push(a.signal); emit(a.signal); emitted = true; }
        } else run(a);
      }
    }
    if (!emitted) break;
    wave = actions.filter(a => a.trigger && a.trigger.on === 'signal');
    // The guard stops a chain that still had signals to pass on (for the Performance panel).
    if (stats && depth === SG_DEPTH - 1 && wave.length) stats.tripped = true;
  }
  return order;
}

/**
 * A combination of signals' levels: and (all true; nothing combined is
 * never true), or (any), not (none of them), xor (exactly one).
 */
export function sgLogic(op, levels) {
  let n = 0;
  for (const x of levels) if (x) n++;
  switch (op) {
    case 'or': return n > 0;
    case 'not': return n === 0;
    case 'xor': return n === 1;
    default: return levels.length > 0 && n === levels.length;
  }
}

/**
 * The order to work signals out in each frame: a combination after the
 * signals it reads (a topological sort, done when the setup changes). A loop
 * (A reads B reads A) can't be ordered: its members are listed in `cyclic`,
 * and each reads the others' levels from the frame before (a unit delay).
 * `signals`: [{ id, when }].
 */
export function sgSignalOrder(signals) {
  const byId = new Map(signals.map(s => [s.id, s]));
  const state = new Map(); // 1 visiting, 2 done
  const order = [], cyclic = new Set();
  const visit = (id, path) => {
    const st = state.get(id);
    if (st === 2) return;
    if (st === 1) { for (let i = path.lastIndexOf(id); i < path.length; i++) cyclic.add(path[i]); return; }
    state.set(id, 1);
    const s = byId.get(id);
    const w = s && s.when;
    if (w && w.kind === 'logic') { path.push(id); for (const i of w.inputs) if (byId.has(i)) visit(i, path); path.pop(); }
    state.set(id, 2);
    order.push(id);
  };
  for (const s of signals) visit(s.id, []);
  return { order, cyclic };
}

/** An axis swap's memory: the axis being driven and each axis's last driven value. */
export function sgSwapNew() {
  return { axis: 'a', prevA: null, prevB: null };
}

function sgCrossed(prev, v, at, dir) {
  if (prev === null || v === null || v === undefined) return false;
  return dir === 'down' ? prev > at && v <= at : prev < at && v >= at;
}

/**
 * One frame of an axis swap (`sw`: { at, dir, backAt, backDir }). `va` and
 * `vb` are the values the axes were just driven to (null for the one not
 * driven). While driving A, A crossing `at` (going `dir`) swaps to B; while
 * driving B, B crossing `backAt` (going `backDir`) swaps back. Returns 'toB',
 * 'toA' or null. The axis just swapped to has no previous value, so it needs
 * a frame before it can swap again.
 */
export function sgSwapStep(st, va, vb, sw) {
  if (st.axis === 'a') {
    const hit = sgCrossed(st.prevA, va, sw.at, sw.dir);
    st.prevA = va === undefined ? null : va;
    if (hit) { st.axis = 'b'; st.prevB = null; return 'toB'; }
  } else {
    const hit = sgCrossed(st.prevB, vb, sw.backAt, sw.backDir);
    st.prevB = vb === undefined ? null : vb;
    if (hit) { st.axis = 'a'; st.prevA = null; return 'toA'; }
  }
  return null;
}

/**
 * What a condition's value path points at:
 *   ctl:<controlId>            a control on the panel, in its own units
 *   layer:<id>::<key>          a layer's property (a mapping may drive it)
 *   finish:<effect>::<key>     a Finish effect's number
 *   audiofx:<chain>:<effect>::<key>  an audio effect's number (kept under 'audiofx:<chain>:<effect>')
 *   map:<mappingId>            a mapping's source reading, 0..1
 *   mouse:x · mouse:y          the pointer, 0..1 (y up)
 *   dist:<A>|<B>               how far apart two anchors are, in picture heights
 * An anchor is a layer id, a hand point (hand:<side>:<point>), the pointer
 * (mouse) or a point on the picture (pt:<x>,<y>, 0..1 with y up).
 */
export function sgParseValueRef(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  if (ref.startsWith('ctl:')) return ref.length > 4 ? { kind: 'control', id: ref.slice(4) } : null;
  if (ref.startsWith('map:')) return ref.length > 4 ? { kind: 'mapping', id: ref.slice(4) } : null;
  if (ref === 'mouse:x' || ref === 'mouse:y') return { kind: 'mouse', axis: ref.slice(6) };
  if (ref.startsWith('dist:')) {
    const i = ref.indexOf('|');
    if (i < 6 || i === ref.length - 1) return null;
    return { kind: 'distance', a: ref.slice(5, i), b: ref.slice(i + 1) };
  }
  if (ref.startsWith('layer:') || ref.startsWith('finish:')) {
    const fin = ref.startsWith('finish:');
    const rest = ref.slice(fin ? 7 : 6);
    const i = rest.lastIndexOf('::');
    if (i <= 0 || i + 2 >= rest.length) return null;
    return { kind: 'prop', layerId: (fin ? 'finish:' : '') + rest.slice(0, i), key: rest.slice(i + 2) };
  }
  // A layer's reading (what it measures: hover, fill, speed…), as its sensors report it.
  if (ref.startsWith('read:')) {
    const rest = ref.slice(5), i = rest.lastIndexOf('::');
    if (i <= 0 || i + 2 >= rest.length) return null;
    return { kind: 'reading', layerId: rest.slice(0, i), read: rest.slice(i + 2) };
  }
  if (ref.startsWith('audiofx:')) {
    const i = ref.lastIndexOf('::');
    if (i <= 8 || i + 2 >= ref.length) return null;
    return { kind: 'prop', layerId: ref.slice(0, i), key: ref.slice(i + 2) };
  }
  return null;
}

/** A point on the picture from `pt:<x>,<y>`, or null. */
export function sgScreenPoint(ref) {
  const m = /^pt:(-?[0-9.]+),(-?[0-9.]+)$/.exec(ref || '');
  if (!m) return null;
  const x = Number(m[1]), y = Number(m[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** The trigger key a value condition counts its presses under (its identity, not its firing mode). */
export function sgValueKey(t) {
  // A band's upper edge, the percent unit and a direction's window and noise only when set, so keys of older conditions stay as they were.
  return 'val:' + t.value + ':' + t.cmp + ':' + t.threshold + ':' + t.hysteresis + ':' + t.tolerance
    + (Number.isFinite(t.hi) ? ':' + t.hi : '') + (t.unit === 'pct' ? ':pct' : '')
    + (Number.isFinite(t.window) ? ':w' + t.window : '') + (Number.isFinite(t.noise) ? ':n' + t.noise : '');
}
