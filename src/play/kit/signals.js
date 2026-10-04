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

/** A repeatable 0..1 for (seed, n): the same timeline rolls the same way. */
export function sgHash01(seed, n) {
  let h = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A signal's timing and chance, between frames. */
export function sgShapeNew() {
  return { onAt: -1, lastOn: -Infinity, held: false, n: 0, pass: true, q: [], out: false, gated: false };
}

/** The clock went back: forget the rolls and what was on its way, so the same timeline plays the same. */
export function sgShapeRewind(st) {
  st.onAt = -1; st.lastOn = -Infinity; st.held = false; st.n = 0; st.pass = true; st.q.length = 0; st.out = false; st.gated = false;
}

/** Does a signal have timing or chance to work out (sgShapeStep)? */
export function sgShaped(o) {
  return !!o && ((o.delay || 0) > 0 || (o.hold || 0) > 0 || (o.linger || 0) > 0 || (typeof o.chance === 'number' && o.chance < 1));
}

/**
 * A signal's level through its timing and chance, at `t` (seconds, the
 * setup's clock): `raw` is what its definition says (or whether it was sent).
 *   hold     it must stay true this long before it counts (a debounce, an on-delay)
 *   linger   it stays true this long after it stops (an off-delay)
 *   chance   0..1: each time it starts, a seeded roll decides whether this
 *            whole activation goes out (no level, no rise, no fall if not)
 *   delay    its rise and its fall both arrive this much later (at most 64
 *            on the way; the oldest drop)
 * Returns the level everything downstream sees.
 */
export function sgShapeStep(st, raw, t, o) {
  const hold = Math.max(0, o.hold || 0), linger = Math.max(0, o.linger || 0);
  if (raw) { if (st.onAt < 0) st.onAt = t; st.lastOn = t; } else st.onAt = -1;
  const held = raw ? t - st.onAt >= hold - 1e-9 : st.held && t - st.lastOn < linger - 1e-9;
  if (held && !st.held) { st.n++; const c = typeof o.chance === 'number' ? o.chance : 1; st.pass = c >= 1 || sgHash01(o.seed || 0, st.n) < c; }
  st.held = held;
  const gated = held && st.pass;
  const d = Math.max(0, o.delay || 0);
  if (d <= 0) { st.q.length = 0; st.out = gated; }
  else {
    if (gated !== st.gated) { st.q.push([t + d, gated]); if (st.q.length > 64) st.q.shift(); }
    while (st.q.length && st.q[0][0] <= t + 1e-9) st.out = st.q.shift()[1];
  }
  st.gated = gated;
  return st.out;
}

/**
 * A value delayed by `delay` seconds (a mapping's Delay): a ring of the last
 * values with their times, read at t − delay between the two nearest. Null
 * until it has something that old (the mapping then writes nothing yet). At
 * most `delay` × 120 + 2 samples kept.
 */
export function sgLagNew() {
  return { t: [], v: [] };
}
export function sgLagStep(st, t, v, delay) {
  if (st.t.length && t < st.t[st.t.length - 1]) { st.t.length = 0; st.v.length = 0; } // the clock went back
  st.t.push(t); st.v.push(v);
  const at = t - delay;
  // Keep one sample older than what is read, and a bounded ring.
  while (st.t.length > 2 && st.t[1] <= at) { st.t.shift(); st.v.shift(); }
  const cap = Math.ceil(delay * 120) + 2;
  while (st.t.length > cap) { st.t.shift(); st.v.shift(); }
  if (st.t[0] > at + 1e-9) return null;
  if (st.t.length === 1 || st.t[1] === st.t[0]) return st.v[0];
  const k = Math.max(0, Math.min(1, (at - st.t[0]) / (st.t[1] - st.t[0])));
  return st.v[0] + (st.v[1] - st.v[0]) * k;
}

// ── Signals as rules: inputs, combine, reactions (implementation guide, phase 2) ─

const SG_COMBINE_OP = { any: 'or', all: 'and', none: 'not', one: 'xor' };

/**
 * Each signal's level inputs and how they combine, from its `inputs` (a
 * trigger: true while held or met; a signal mirrored: its level) and the older
 * `when` (a trigger, or a combination of signals). Rise and fall inputs are
 * pulses, not levels (sgPulseLinks). [{ id, level: [{ kind: 'trigger',
 * trigger } | { kind: 'signal', signal }], op: 'or' | 'and' | 'not' | 'xor' }]
 */
export function sgSignalPlan(signals) {
  const out = [];
  for (const s of signals) {
    const level = [];
    let op = SG_COMBINE_OP[s.combine || 'any'] || 'or';
    const w = s.when;
    if (w && w.kind === 'trigger') level.push({ kind: 'trigger', trigger: w.trigger });
    if (w && w.kind === 'logic') {
      for (const i of w.inputs) level.push({ kind: 'signal', signal: i });
      if (!s.inputs || !s.inputs.length) op = w.op;
    }
    for (const x of s.inputs || []) {
      if (x.kind === 'trigger') level.push({ kind: 'trigger', trigger: x.trigger });
      else if (x.kind === 'signal' && x.as === 'mirror') level.push({ kind: 'signal', signal: x.signal });
    }
    out.push({ id: s.id, level, op });
  }
  return out;
}

/** What a signal's level reads, as the ordering wants it (sgSignalOrder): the signals it mirrors. */
export function sgLevelDeps(plan) {
  return plan.map(p => ({ id: p.id, when: { kind: 'logic', inputs: p.level.filter(x => x.kind === 'signal').map(x => x.signal) } }));
}

/**
 * Signals with the links their rise and fall inputs make: B listening to A's
 * rise, 0.5 s late, is A linking to B after 0.5 s (sgLinkPlan finds the loops).
 * The older `links` are kept as they are.
 */
export function sgPulseLinks(signals) {
  const extra = new Map();
  for (const s of signals) for (const x of s.inputs || []) {
    if (x.kind !== 'signal' || x.as === 'mirror') continue;
    if (!extra.has(x.signal)) extra.set(x.signal, []);
    extra.get(x.signal).push({ to: s.id, delay: x.delay || 0, on: x.as });
  }
  if (!extra.size) return signals;
  return signals.map(s => (extra.has(s.id) ? Object.assign({}, s, { links: (s.links || []).concat(extra.get(s.id)) }) : s));
}

/**
 * A signal's reactions as actions on it (the action runner, sgRunActions, runs
 * them): each fires by its own mode on the signal's rise, level or fall.
 */
export function sgReactions(signals) {
  const out = [];
  for (const s of signals) for (const r of s.do || []) {
    const trigger = { on: 'signal', signal: s.id };
    if (r.fire) trigger.fire = r.fire;
    const a = { id: r.id, trigger, do: r.do, layerId: r.layerId || '', amount: r.amount, enabled: r.enabled !== false };
    if (r.signal !== undefined) a.signal = r.signal;
    if (r.notes) a.notes = r.notes;
    // A Look action (finish.js fnLookAct): the setting, value and seconds it carries.
    if (r.key !== undefined) a.key = r.key;
    if (r.value !== undefined) a.value = r.value;
    if (r.seconds !== undefined) a.seconds = r.seconds;
    // A Splash at a point (Water): where.
    if (r.x !== undefined) a.x = r.x;
    if (r.y !== undefined) a.y = r.y;
    out.push(a);
  }
  return out;
}

// ── Links and loops ──────────────────────────────────────────────────────────

/** Pulses a loop may have on their way at once (a branch inside a loop would double them every lap). */
export const SG_LOOP_PULSES = 16;
const SG_LINK_QUEUE = 256;

/**
 * Links between signals and the loops they make, worked out when the setup
 * changes: each signal's `links` ({ to, delay, on: 'rise' | 'fall' }) are
 * edges; a strongly connected group of them (Tarjan's algorithm) is a loop,
 * with its settings from `loopSettings` (by key: its members' ids, sorted,
 * joined by '|'): speed (scales every delay in it), laps (0 endless), running,
 * policy for a start while it runs ('ignore', 'add', 'restart').
 */
export function sgLinkPlan(signals, loopSettings) {
  const ids = new Set(signals.map(s => s.id));
  const edges = [], byFrom = new Map();
  for (const s of signals) for (const l of s.links || []) {
    if (!l || !ids.has(l.to)) continue;
    const e = { from: s.id, to: l.to, delay: Math.max(0, +l.delay || 0), on: l.on === 'fall' ? 'fall' : 'rise' };
    edges.push(e);
    if (!byFrom.has(s.id)) byFrom.set(s.id, []);
    byFrom.get(s.id).push(e);
  }
  // Tarjan's strongly connected components over the links.
  let index = 0;
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], groups = [];
  const visit = v => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); onStack.add(v);
    for (const e of byFrom.get(v) || []) {
      if (!idx.has(e.to)) { visit(e.to); low.set(v, Math.min(low.get(v), low.get(e.to))); }
      else if (onStack.has(e.to)) low.set(v, Math.min(low.get(v), idx.get(e.to)));
    }
    if (low.get(v) === idx.get(v)) {
      const g = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); g.push(w); } while (w !== v);
      if (g.length > 1 || (byFrom.get(v) || []).some(e => e.to === v)) groups.push(g);
    }
  };
  for (const s of signals) if (!idx.has(s.id)) visit(s.id);
  const settings = new Map((loopSettings || []).map(x => [x.key, x]));
  const loops = [], loopOf = new Map();
  for (const g of groups) {
    const members = g.slice().sort();
    const key = members.join('|');
    const set = settings.get(key) || {};
    const inLoop = new Set(members);
    // The time around: follow the first link to another member from the first member until back.
    let period = 0, at = members[0];
    for (let i = 0; i < members.length + 1; i++) {
      const e = (byFrom.get(at) || []).find(x => inLoop.has(x.to));
      if (!e) break;
      period += e.delay; at = e.to;
      if (at === members[0]) break;
    }
    const speed = typeof set.speed === 'number' && set.speed > 0 ? set.speed : 1;
    const loop = { key, members, entry: members[0], period: period / speed, speed, laps: Math.max(0, set.laps | 0), running: set.running !== false, policy: set.policy === 'add' || set.policy === 'restart' ? set.policy : 'ignore', branches: members.some(m => (byFrom.get(m) || []).filter(e => inLoop.has(e.to)).length > 1) };
    loops.push(loop);
    for (const m of members) loopOf.set(m, loop);
  }
  return { edges, byFrom, loops, loopOf };
}

/** Links' pulses on their way, and each loop's pulses in flight, laps done and where it was started. */
export function sgLinkNew() {
  return { q: [], inFlight: new Map(), laps: new Map(), entry: new Map() };
}

/** The clock went back, or a reset: nothing on its way. */
export function sgLinkClear(st, loopKey) {
  if (loopKey === undefined) { st.q.length = 0; st.inFlight.clear(); st.laps.clear(); st.entry.clear(); return; }
  st.q = st.q.filter(p => p.loop !== loopKey);
  st.inFlight.delete(loopKey); st.laps.delete(loopKey); st.entry.delete(loopKey);
}

/**
 * Signal `id` rose (edge 'rise') or fell ('fall') at `t`: its links send on,
 * each after its delay (a loop's scaled by its speed). `external`: not a link
 * arriving (a key, a condition): in a loop that is a start, and while pulses
 * are in flight the loop's policy decides (ignore it, add another pulse, or
 * restart). Inside a loop: at most SG_LOOP_PULSES in flight; a pulse arriving
 * back where the loop was started is a lap, and at its Laps it stops; a
 * stopped loop sends nothing round.
 */
export function sgLinkFire(st, plan, id, t, edge, external) {
  const out = plan.byFrom.get(id);
  const here = plan.loopOf.get(id);
  if (here && external) {
    const busy = (st.inFlight.get(here.key) || 0) > 0;
    if (busy && here.policy === 'ignore') return;
    if (busy && here.policy === 'restart') sgLinkClear(st, here.key);
    // A fresh start (nothing going round) counts its laps from here.
    if (!busy || here.policy === 'restart') { st.laps.delete(here.key); st.entry.set(here.key, id); }
  }
  if (!out) return;
  for (const e of out) {
    if (e.on !== edge) continue;
    const loop = here && plan.loopOf.get(e.to) === here ? here : null;
    let d = e.delay;
    if (loop) {
      if (!loop.running) continue;
      d = d / loop.speed;
      const n = st.inFlight.get(loop.key) || 0;
      if (n >= SG_LOOP_PULSES) continue;
      if (e.to === (st.entry.get(loop.key) || loop.entry)) {
        const laps = (st.laps.get(loop.key) || 0) + 1;
        st.laps.set(loop.key, laps);
        if (loop.laps > 0 && laps >= loop.laps) continue;
      }
      st.inFlight.set(loop.key, n + 1);
    }
    st.q.push({ at: t + d, to: e.to, loop: loop ? loop.key : '' });
    if (st.q.length > SG_LINK_QUEUE) { const old = st.q.shift(); if (old.loop) st.inFlight.set(old.loop, Math.max(0, (st.inFlight.get(old.loop) || 1) - 1)); }
  }
}

/** The links that arrive by `t`, oldest first (their signals are sent now). */
export function sgLinkDue(st, t) {
  if (!st.q.length) return [];
  const due = [], keep = [];
  for (const p of st.q) {
    if (p.at <= t + 1e-9) {
      due.push(p.to);
      if (p.loop) st.inFlight.set(p.loop, Math.max(0, (st.inFlight.get(p.loop) || 1) - 1));
    } else keep.push(p);
  }
  st.q = keep;
  return due;
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
  // A source's reading this frame, 0 to 1 (a source of the record, or an old mapping by its id).
  if (ref.startsWith('src:')) return ref.length > 4 ? { kind: 'source', id: ref.slice(4) } : null;
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
  // The picture's brightness: `pic:<lum|r|g|b>:all`, or around a position (a layer's centre, a hand point, the pointer): `pic:lum:<anchor>`.
  if (ref.startsWith('pic:')) {
    const m = /^pic:(lum|r|g|b):(.+)$/.exec(ref);
    return m ? { kind: 'picture', ch: m[1], region: m[2] } : null;
  }
  // One axis of a position (an anchor): `ax:x:<anchor>` or `ax:y:<anchor>` (a region test is a band on each).
  if (ref.startsWith('ax:x:') || ref.startsWith('ax:y:')) return ref.length > 5 ? { kind: 'axis', axis: ref[3], anchor: ref.slice(5) } : null;
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
