/**
 * routes.js — Sources and Routes (implementation guide, phase 1), the part of
 * a frame both the Play engine (lib/playEngine.ts) and the web runtime
 * (runtime/play-runtime.js, through the inlined kit as SSKit.routes) run:
 *
 *   rtSourcesOf   a record's sources: its own (record.sources) and one per
 *                 old mapping (same id, one Replace route with the mapping's
 *                 range, curve, channel, smoothing and delay; an Increment
 *                 becomes a Step output over the same range)
 *   rtStep        one frame: read each source once (host.read), step its Step
 *                 outputs (host.step), then each route's value through its
 *                 range, curve, delay and smoothing; returns the writes in
 *                 record order
 *   rtFrame       both, source by source in record order (a source reading
 *                 another control sees this frame's value): Replace routes
 *                 write as they come (the last on a control wins, as mappings
 *                 did), Add routes are summed on top of the control's value
 *                 (its last Replace, else its slider) and kept in range
 *
 * A source can exist with no routes (it is still read: `src:<id>`), and one
 * source can drive many controls. Top-level names start with `rt`.
 */
import { sgLagNew, sgLagStep } from './signals.js';

/** A unit reading through a curve: linear, exp (x²), log (√x), or a drawn one (`curveY`, evenly spaced). */
export function rtCurve(u, curve, curveY) {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  if (curve === 'exp') return x * x;
  if (curve === 'log') return Math.sqrt(x);
  if (curve === 'custom' && curveY && curveY.length > 1) {
    const pos = x * (curveY.length - 1);
    const i = Math.min(curveY.length - 2, Math.floor(pos));
    return curveY[i] + (curveY[i + 1] - curveY[i]) * (pos - i);
  }
  return x;
}

/** A unit reading onto a route's range: outMin at 0, outMax at 1 (a Replace's value, an Add's delta). */
export function rtMap(u, r) {
  return r.outMin + (r.outMax - r.outMin) * rtCurve(u, r.curve, r.curveY);
}

/** The route an old mapping becomes (same id, so its smoothing and delay state carry over). */
function rtRouteOf(m) {
  const r = { id: m.id, to: m.controlId, mode: 'replace', outMin: m.outMin, outMax: m.outMax, curve: m.curve, smoothMs: m.smoothMs || 0, enabled: true };
  if (m.curveY) r.curveY = m.curveY;
  if (m.channel === 0 || m.channel === 1 || m.channel === 2) r.channel = m.channel;
  if (m.delayMs > 0) r.delayMs = m.delayMs;
  return r;
}

/**
 * Every source of a record, old mappings first (each a source with its own
 * id), then the record's own. Cached per record by the caller.
 */
export function rtSourcesOf(record) {
  const out = [];
  for (const m of record.mappings || []) {
    const route = rtRouteOf(m);
    const output = m.increment
      ? { kind: 'step', step: m.increment, lo: m.outMin, hi: m.outMax, routes: [route] }
      : { kind: 'value', routes: [route] };
    out.push({ id: m.id, enabled: m.enabled !== false, source: m.source, outputs: [output], fromMapping: m });
  }
  for (const s of record.sources || []) out.push(s);
  return out;
}

/** Per-source and per-route memory between frames: last readings, smoothing, delay lines. */
export function rtNew() {
  return { values: new Map(), smooth: new Map(), lag: new Map() };
}

/** The clock went back: delay lines start over. */
export function rtRewind(st) {
  for (const l of st.lag.values()) { l.t.length = 0; l.v.length = 0; }
}

/** A Step output's value onto a route: as it is when the route spans the step's own range (an old Increment), else remapped. */
function rtFromStep(v, o, r) {
  if (r.outMin === o.lo && r.outMax === o.hi && (!r.curve || r.curve === 'linear')) return v;
  const span = o.hi - o.lo;
  return rtMap(span ? (v - o.lo) / span : 0, r);
}

/**
 * One frame of sources and routes. `host`:
 *   has(controlId)        is the control there
 *   read(source, dt)      the source's unit reading now, or null (a trigger source keeps its own state by source id)
 *   step(source, output, dt)  a Step output's value in its range, or null
 * Returns [{ route, value }] in record order. A source whose routes all point
 * at missing controls isn't read (as a mapping without its control wasn't).
 */
export function rtStep(st, sources, host, dt, time) {
  const writes = [];
  for (const s of sources) rtStepOne(st, s, host, dt, time, writes);
  return writes;
}

/** One source's routes this frame, pushed onto `out`. */
function rtStepOne(st, s, host, dt, time, out) {
  if (!s.enabled) return;
  let live = false, free = true;
  for (const o of s.outputs) for (const r of o.routes) { free = false; if (r.enabled !== false && host.has(r.to)) live = true; }
  if (!live && !free) return;
  let reading;
  for (const o of s.outputs) {
    let stepV = null;
    if (o.kind === 'step') { stepV = host.step(s, o, dt); if (stepV === null) continue; }
    else {
      if (reading === undefined) { reading = host.read(s, dt); st.values.set(s.id, reading); }
      if (reading === null) continue;
    }
    for (const r of o.routes) {
      if (r.enabled === false || !host.has(r.to)) continue;
      // Set writes the captured number itself; everything else goes through the range and curve.
      let target = o.kind === 'step' ? rtFromStep(stepV, o, r) : s.source.kind === 'captured' ? reading : rtMap(reading, r);
      // Delay: the value arrives late (before the smoothing); nothing is written until it has that much.
      if (r.delayMs > 0) {
        let lag = st.lag.get(r.id);
        if (!lag) { lag = sgLagNew(); st.lag.set(r.id, lag); }
        const late = sgLagStep(lag, time, target, r.delayMs / 1000);
        if (late === null) continue;
        target = late;
      }
      let v = target;
      // Step outputs glide by their own settings; smoothing is for values.
      if (o.kind !== 'step') {
        const prev = st.smooth.get(r.id);
        if (r.smoothMs > 0 && prev !== undefined) {
          v = prev + (target - prev) * (1 - Math.exp(-(dt * 1000) / r.smoothMs));
          // Settle exactly so a held knob stops producing sub-epsilon churn.
          if (Math.abs(v - target) < 1e-4 * Math.max(1, Math.abs(r.outMax - r.outMin))) v = target;
        }
        st.smooth.set(r.id, v);
      }
      out.push({ route: r, value: v });
    }
  }
}

/**
 * One frame of sources and routes, read and written source by source in
 * record order, so a source that reads another control (a `control` source)
 * sees what was written to it earlier in the frame, as mappings always did.
 * `apply` (the host's writer):
 *   kind(controlId)               'float' | 'color' | 'action'
 *   write(controlId, route, v)    as a mapping wrote it (a colour channel or brightness, a button's edge, a number)
 *   base(controlId)               the control's own value (its slider), for Add
 *   range(controlId)              [min, max], for Add
 * Replace routes write as they come (the last on a control wins). Add routes
 * on a number sum their deltas on top of the control's last Replace this
 * frame (else its slider) and stay in its range, written at the end; on a
 * colour or a button an Add writes as a Replace.
 */
export function rtFrame(st, sources, read, apply, dt, time) {
  let adds = null, replaced = null;
  const one = [];
  for (const s of sources) {
    one.length = 0;
    rtStepOne(st, s, read, dt, time, one);
    for (const w of one) {
      const id = w.route.to, num = apply.kind(id) === 'float';
      if (w.route.mode === 'add' && num) { (adds || (adds = new Map())).set(id, (adds.get(id) || 0) + w.value); continue; }
      apply.write(id, w.route, w.value);
      if (num && (adds || w.route.mode === 'replace')) (replaced || (replaced = new Map())).set(id, w.value);
    }
  }
  if (!adds) return;
  for (const [id, delta] of adds) {
    const from = replaced && replaced.has(id) ? replaced.get(id) : apply.base(id);
    const [lo, hi] = apply.range(id);
    const a = Math.min(lo, hi), b = Math.max(lo, hi);
    apply.write(id, null, Math.max(a, Math.min(b, (typeof from === 'number' ? from : a) + delta)));
  }
}

/**
 * A new Add route's swing: half the control's range either way, so a source
 * at 0.5 adds nothing and its full travel covers the whole range.
 */
export function rtAddSwing(min, max) {
  const h = (max - min) / 2;
  return { outMin: -h, outMax: h };
}

/**
 * The triggers a record's own sources listen to (a trigger source, a Step
 * that counts a trigger, a Step's reset signal), so the host binds their keys
 * and ticks their conditions as it does for mappings.
 */
export function rtTriggersOf(sources) {
  const out = [];
  for (const s of sources || []) {
    if (!s || s.enabled === false || s.fromMapping) continue;
    if (s.source.kind === 'trigger') out.push(s.source.trigger);
    for (const o of s.outputs || []) {
      if (o.kind !== 'step') continue;
      if (o.step.on === 'trigger') out.push(o.step.trigger);
      if (o.step.resetOn) out.push({ on: 'signal', signal: o.step.resetOn });
      if (o.step.on === 'repeat' && o.step.when) out.push({ on: 'value', ...o.step.when });
    }
  }
  return out;
}
