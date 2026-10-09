/**
 * demos.ts — the focus view's small animated demos (docs/agent-builder.md "Focus"). Pure and cheap:
 * each demo is a few CPU walkers, simulated once for its loop (30 steps a second) from the live
 * values, then drawn a frame at a time. Nothing here runs unless a focus view is open.
 *
 * Units are the picture's (y up, the picture 2 tall). The demos show the rule, not the GPU result:
 * a gravity demo throws one particle with gravity and a ghost without it; a curl demo shows the field
 * moving with a particle riding it; a flock demo runs a dozen boids with the live turn rates; and
 * so on (`makeDemo`).
 */
import type { DemoSpec } from './legend';
import { curlAt } from './diagram';
import { fieldFunction, layerSpec, rideField } from '../agentRules/fields';

export interface Pt { x: number; y: number }
export interface DemoFrame {
  paths: Array<{ pts: Pt[]; colour: string; width?: number; dashed?: boolean; opacity?: number }>;
  dots: Array<Pt & { r: number; colour: string; opacity?: number; hollow?: boolean }>;
  arrows: Array<{ from: Pt; to: Pt; colour: string; width?: number; flow?: boolean }>;
  rings: Array<Pt & { r: number; colour: string; dashed?: boolean; fill?: string }>;
  rects: Array<{ x0: number; y0: number; x1: number; y1: number; colour: string; fill?: string; dashed?: boolean }>;
}
export interface Demo {
  /** Seconds before it starts over. */
  period: number;
  /** What the panel shows (picture units). */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** The key under the demo: what each colour is. */
  key: Array<{ colour: string; label: string }>;
  frame(t: number): DemoFrame;
}

export const DEMO_FPS = 30;
const DT = 1 / DEMO_FPS;
const DEG = Math.PI / 180;
const HOT = '#ffffff';
const GHOST = 'rgba(255,255,255,0.35)';
const BOX = { x0: -1.6, y0: -1, x1: 1.6, y1: 1 };

const empty = (): DemoFrame => ({ paths: [], dots: [], arrows: [], rings: [], rects: [] });
const frameOf = (t: number, period: number) => Math.max(0, Math.min(Math.floor((((t % period) + period) % period) * DEMO_FPS), Math.round(period * DEMO_FPS)));

function rand(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Fit points (with a margin) into bounds no smaller than `min` across, the picture's shape. */
function fit(pts: Pt[], min = 1.2): Demo['bounds'] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (!isFinite(p.x) || !isFinite(p.y)) continue; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  if (!isFinite(x0)) return BOX;
  let w = Math.max(x1 - x0, min), h = Math.max(y1 - y0, min / 1.6);
  if (w / h > 1.6) h = w / 1.6; else w = h * 1.6;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { x0: cx - w * 0.56, x1: cx + w * 0.56, y0: cy - h * 0.56, y1: cy + h * 0.56 };
}

/** Turn heading `h` toward `want` (radians) by at most `max` radians. */
const turnToward = (h: number, want: number, max: number) => {
  const d = Math.atan2(Math.sin(want - h), Math.cos(want - h));
  return h + Math.max(-max, Math.min(max, d));
};
/** A rule's "degrees a step" (60 steps a second) as radians per demo step. */
const perStep = (deg: number) => Math.max(0, deg) * DEG * (60 / DEMO_FPS);
const wrap = (v: number, lo: number, hi: number) => (v < lo ? v + (hi - lo) : v > hi ? v - (hi - lo) : v);

/** Points of a track up to frame `f`. */
const upTo = (track: Pt[], f: number) => track.slice(0, Math.min(f + 1, track.length));
/** A track split where it wraps (so no line crosses the box). */
function unwrapped(pts: Pt[]): Pt[][] {
  const out: Pt[][] = [[]];
  pts.forEach((p, i) => { if (i && (Math.abs(p.x - pts[i - 1].x) > 1 || Math.abs(p.y - pts[i - 1].y) > 1)) out.push([]); out[out.length - 1].push(p); });
  return out;
}

/** One particle under a force field from `p0` with `v0`, for `period` seconds: its positions each step. */
function throwParticle(p0: Pt, v0: Pt, period: number, force: (p: Pt, t: number) => Pt, drag = 0): Pt[] {
  const out: Pt[] = [{ ...p0 }];
  let p = { ...p0 }, v = { ...v0 };
  for (let i = 1; i <= period * DEMO_FPS; i++) {
    const f = force(p, i * DT);
    v = { x: (v.x + f.x * DT) * Math.exp(-drag * DT), y: (v.y + f.y * DT) * Math.exp(-drag * DT) };
    p = { x: p.x + v.x * DT, y: p.y + v.y * DT };
    out.push(p);
  }
  return out;
}

const dirOf = (deg: number): Pt => ({ x: Math.cos(deg * DEG), y: Math.sin(deg * DEG) });

/** The demo a focus view plays for a legend entry. */
export function makeDemo(spec: DemoSpec, colour = '#ff9a6b'): Demo {
  switch (spec.kind) {
    case 'gravity': case 'wind': {
      // Thrown across the force and a little against it: with it the path bends, without it is straight.
      const period = 3;
      const d = dirOf(spec.angle), s = spec.strength;
      const perp = { x: -d.y, y: d.x };
      const side = perp.x < -0.01 ? -1 : 1; // throw rightward where we can
      const v0 = { x: (perp.x * side * 0.6 - d.x * 0.45 * Math.sign(s || 1)), y: (perp.y * side * 0.6 - d.y * 0.45 * Math.sign(s || 1)) };
      const gust = (t: number) => (spec.kind === 'wind' ? 1 + 0.6 * Math.sin(t * 2.6) : 1);
      const withF = throwParticle({ x: 0, y: 0 }, v0, period, (_p, t) => ({ x: d.x * s * gust(t), y: d.y * s * gust(t) }));
      const without = throwParticle({ x: 0, y: 0 }, v0, period, () => ({ x: 0, y: 0 }));
      const bounds = fit([...withF, ...without]);
      return {
        period, bounds,
        key: [{ colour, label: `with ${spec.kind}` }, { colour: GHOST, label: 'without' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          fr.paths.push({ pts: upTo(without, f), colour: GHOST, dashed: true }, { pts: upTo(withF, f), colour, width: 2.5 });
          // Seconds marks on both paths: the gap between them grows like t².
          for (let k = DEMO_FPS; k <= f; k += DEMO_FPS) fr.dots.push({ ...withF[k], r: 3, colour, opacity: 0.8 }, { ...without[k], r: 3, colour: GHOST });
          fr.dots.push({ ...without[f], r: 5, colour: GHOST }, { ...withF[f], r: 6, colour: HOT });
          // The force on it, as an arrow.
          const L = 0.12 + Math.min(Math.abs(s), 2) * 0.12 * gust(f * DT);
          fr.arrows.push({ from: withF[f], to: { x: withF[f].x + d.x * L * Math.sign(s || 0), y: withF[f].y + d.y * L * Math.sign(s || 0) }, colour });
          return fr;
        },
      };
    }
    case 'curl': {
      const period = 6;
      const field = (p: Pt, t: number) => { const [x, y] = curlAt(p.x, p.y, spec.eddies, t * spec.evolve * 4); return { x, y }; };
      const riders = [{ x: -1.1, y: 0.3 }, { x: 0.2, y: -0.5 }, { x: 0.9, y: 0.6 }].map(p0 => {
        const out: Pt[] = [p0];
        let p = { ...p0 }, v = { x: 0, y: 0 };
        for (let i = 1; i <= period * DEMO_FPS; i++) {
          const f = field(p, i * DT);
          v = { x: (v.x + f.x * spec.strength * 3 * DT) * Math.exp(-1.5 * DT), y: (v.y + f.y * spec.strength * 3 * DT) * Math.exp(-1.5 * DT) };
          p = { x: wrap(p.x + v.x * DT, BOX.x0, BOX.x1), y: wrap(p.y + v.y * DT, BOX.y0, BOX.y1) };
          out.push(p);
        }
        return out;
      });
      return {
        period, bounds: BOX,
        key: [{ colour, label: 'the currents (moving)' }, { colour: HOT, label: 'particles riding them' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          const cols = 13, rows = 8;
          for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            const p = { x: BOX.x0 + (i + 0.5) * (BOX.x1 - BOX.x0) / cols, y: BOX.y0 + (j + 0.5) * (BOX.y1 - BOX.y0) / rows };
            const v = field(p, f * DT);
            const m = Math.hypot(v.x, v.y) || 1;
            const L = 0.1 * Math.min(1, m / 1.2 + 0.3);
            fr.arrows.push({ from: { x: p.x - v.x / m * L, y: p.y - v.y / m * L }, to: { x: p.x + v.x / m * L, y: p.y + v.y / m * L }, colour, width: 1.3, flow: true });
          }
          for (const r of riders) {
            for (const seg of unwrapped(r.slice(Math.max(0, f - 45), f + 1))) fr.paths.push({ pts: seg, colour: HOT, width: 1.8, opacity: 0.7 });
            fr.dots.push({ ...r[f], r: 5, colour: HOT });
          }
          return fr;
        },
      };
    }
    case 'field': {
      // The field in motion (its arrows at the clock, so a drifting or spinning layer moves; the
      // dashes march) with particles riding it as the card does (ridden or pushed).
      const period = 6;
      const lit = spec.layer !== undefined ? layerSpec(spec.spec, spec.layer) : spec.spec;
      const fn = fieldFunction(lit);
      const all = fieldFunction(spec.spec);
      const r = rand(7);
      const starts = Array.from({ length: 14 }, () => ({ x: BOX.x0 + r() * (BOX.x1 - BOX.x0), y: BOX.y0 + r() * (BOX.y1 - BOX.y0) }));
      const riders = rideField(all, starts, { seconds: period, strength: spec.strength, grip: spec.grip, box: BOX, fps: DEMO_FPS });
      const masks = lit.layers.filter(l => !l.off && l.mask).map(l => l.mask!);
      return {
        period, bounds: BOX,
        key: [{ colour, label: spec.layer !== undefined ? 'this layer (moving)' : 'the field (moving)' }, { colour: HOT, label: 'particles riding the whole field' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          const cols = 13, rows = 8;
          const pts: Array<{ p: Pt; v: Pt; m: number }> = [];
          let top = 1e-6;
          for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            const p = { x: BOX.x0 + (i + 0.5) * (BOX.x1 - BOX.x0) / cols, y: BOX.y0 + (j + 0.5) * (BOX.y1 - BOX.y0) / rows };
            const [vx, vy] = fn(p.x, p.y, f * DT);
            const m = Math.hypot(vx, vy);
            top = Math.max(top, m);
            pts.push({ p, v: { x: vx, y: vy }, m });
          }
          for (const { p, v, m } of pts) {
            if (m < 1e-6) continue;
            const L = 0.1 * Math.min(1, m / top + 0.3);
            fr.arrows.push({ from: { x: p.x - v.x / m * L, y: p.y - v.y / m * L }, to: { x: p.x + v.x / m * L, y: p.y + v.y / m * L }, colour, width: 1.3, flow: true });
          }
          for (const m of masks) {
            if (m.shape === 'circle') fr.rings.push({ x: m.x, y: m.y, r: m.size, colour, dashed: true });
            else fr.rects.push({ x0: m.x - m.size, y0: m.y - m.size, x1: m.x + m.size, y1: m.y + m.size, colour, dashed: true });
          }
          for (const tr of riders) {
            for (const seg of unwrapped(tr.slice(Math.max(0, f - 45), f + 1))) fr.paths.push({ pts: seg, colour: HOT, width: 1.6, opacity: 0.6 });
            fr.dots.push({ ...tr[f], r: 4, colour: HOT });
          }
          return fr;
        },
      };
    }
    case 'attract': {
      const period = 3.5;
      const P = { x: 0, y: 0 };
      const force = (p: Pt) => { const dx = P.x - p.x, dy = P.y - p.y, d = Math.hypot(dx, dy) || 1; return { x: dx / d * spec.strength, y: dy / d * spec.strength }; };
      const starts = [0.55, 0.25, -0.4].map(y => ({ x: -1.45, y }));
      const tracks = starts.map(p0 => throwParticle(p0, { x: 0.85, y: 0 }, period, force));
      const ghosts = starts.map(p0 => throwParticle(p0, { x: 0.85, y: 0 }, period, () => ({ x: 0, y: 0 })));
      return {
        period, bounds: BOX,
        key: [{ colour, label: spec.strength >= 0 ? 'pulled toward the point' : 'pushed away from the point' }, { colour: GHOST, label: 'without it' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          fr.rings.push({ ...P, r: 0.05, colour, fill: colour });
          ghosts.forEach(g => fr.paths.push({ pts: upTo(g, f), colour: GHOST, dashed: true }));
          tracks.forEach(tr => { fr.paths.push({ pts: upTo(tr, f), colour, width: 2.2 }); fr.dots.push({ ...tr[f], r: 5, colour: HOT }); });
          return fr;
        },
      };
    }
    case 'drag': {
      const period = 3;
      const a = throwParticle({ x: -1.4, y: 0.3 }, { x: 1.1, y: 0 }, period, () => ({ x: 0, y: 0 }), spec.amount);
      const b = throwParticle({ x: -1.4, y: -0.3 }, { x: 1.1, y: 0 }, period, () => ({ x: 0, y: 0 }));
      return {
        period, bounds: fit([...a, ...b, { x: -1.5, y: 0.6 }, { x: 2, y: -0.6 }]),
        key: [{ colour, label: `with drag (keeps ${Math.round(Math.exp(-spec.amount) * 100)}% a second)` }, { colour: GHOST, label: 'without' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          fr.paths.push({ pts: upTo(b, f), colour: GHOST, dashed: true }, { pts: upTo(a, f), colour, width: 2.5 });
          // Where each was every half second: the marks bunch up as it slows.
          for (let k = DEMO_FPS / 2; k <= f; k += DEMO_FPS / 2) fr.dots.push({ ...a[k], r: 3, colour, opacity: 0.8 }, { ...b[k], r: 3, colour: GHOST });
          fr.dots.push({ ...b[f], r: 5, colour: GHOST }, { ...a[f], r: 6, colour: HOT });
          return fr;
        },
      };
    }
    case 'sum': {
      const period = 3;
      const force = (p: Pt, t: number) => {
        let x = 0, y = 0;
        for (const fo of spec.forces) {
          if (fo.field === 'gravity' || fo.field === 'wind') { const d = dirOf(fo.angle ?? (fo.field === 'gravity' ? -90 : 0)); const g = fo.field === 'wind' ? 1 + 0.6 * Math.sin(t * 2.6) : 1; x += d.x * fo.strength * g; y += d.y * fo.strength * g; }
          else if (fo.field === 'curl') { const [cx, cy] = curlAt(p.x, p.y, spec.eddies); x += cx * fo.strength; y += cy * fo.strength; }
          else { const tx = fo.field === 'mouse' ? 0 : fo.x ?? 0, ty = fo.field === 'mouse' ? 0 : fo.y ?? 0; const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; x += dx / d * fo.strength; y += dy / d * fo.strength; }
        }
        return { x, y };
      };
      const starts = [{ x: -0.35, y: 0.15 }, { x: 0.3, y: 0.4 }, { x: -0.8, y: -0.3 }];
      const tracks = starts.map(p0 => throwParticle(p0, { x: 0, y: 0 }, period, force, spec.drag));
      return {
        period, bounds: fit(tracks.flat()),
        key: [{ colour, label: 'particles under all the forces at once' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          tracks.forEach(tr => { fr.paths.push({ pts: upTo(tr, f), colour, width: 2.2 }); fr.dots.push({ ...tr[f], r: 5, colour: HOT }); });
          return fr;
        },
      };
    }
    case 'life': {
      const end = spec.dies ?? null;
      const period = Math.max(2, end ?? 0, spec.fade ?? 0, 3) + 1;
      const speed = 2.6 / (period - 1);
      const at = (s: number) => ({ x: -1.3 + s * speed, y: 0 });
      const bright = (s: number) => (end !== null && s > end ? 0 : spec.fade && spec.fade > 0 ? Math.max(0, 1 - s / spec.fade) : 1);
      return {
        period, bounds: { x0: -1.6, y0: -0.6, x1: 1.6, y1: 0.6 },
        key: [{ colour, label: 'one particle as it ages (brightness = its colour)' }, ...(end !== null ? [{ colour: '#ff7a7a', label: `dies at ${Math.round(end * 100) / 100} s` }] : [])],
        frame(t) {
          const s = (((t % period) + period) % period), fr = empty();
          for (let k = 0; k <= Math.floor(s * 4); k++) { const a = k / 4; if (end !== null && a > end) break; fr.dots.push({ ...at(a), r: 3.2, colour, opacity: 0.15 + 0.85 * bright(a) }); }
          // A second mark every second.
          for (let k = 1; k < period; k++) fr.paths.push({ pts: [{ x: at(k).x, y: -0.12 }, { x: at(k).x, y: -0.2 }], colour: GHOST });
          if (end !== null) fr.paths.push({ pts: [{ x: at(end).x, y: -0.35 }, { x: at(end).x, y: 0.35 }], colour: '#ff7a7a', width: 2 });
          if (end === null || s <= end) fr.dots.push({ ...at(s), r: 7, colour: HOT, opacity: 0.1 + 0.9 * bright(s) });
          return fr;
        },
      };
    }
    case 'flock': {
      const period = 8, N = 16, R = 0.5, speed = 0.55;
      const r = rand(11);
      let boids = Array.from({ length: N }, () => ({ x: (r() - 0.5) * 2.4, y: (r() - 0.5) * 1.5, h: (r() - 0.5) * 2.4 }));
      const frames: Array<typeof boids> = [boids.map(b => ({ ...b }))];
      const look = (b: typeof boids[number], all: typeof boids) => {
        const near = all.filter(o => o !== b && Math.hypot(o.x - b.x, o.y - b.y) < R);
        const n = near.length || 1;
        const centre = { x: near.reduce((s, o) => s + o.x, 0) / n, y: near.reduce((s, o) => s + o.y, 0) / n };
        const heading = Math.atan2(near.reduce((s, o) => s + Math.sin(o.h), 0), near.reduce((s, o) => s + Math.cos(o.h), 0));
        const push = near.filter(o => Math.hypot(o.x - b.x, o.y - b.y) < R * 0.5).reduce((s, o) => { const dx = b.x - o.x, dy = b.y - o.y, d2 = dx * dx + dy * dy || 1e-4; return { x: s.x + dx / d2, y: s.y + dy / d2 }; }, { x: 0, y: 0 });
        return { near, centre, heading, push };
      };
      for (let i = 1; i <= period * DEMO_FPS; i++) {
        boids = boids.map(b => {
          const s = look(b, boids);
          let h = b.h;
          if (s.near.length) {
            if (s.push.x || s.push.y) h = turnToward(h, Math.atan2(s.push.y, s.push.x), perStep(spec.separate));
            h = turnToward(h, s.heading, perStep(spec.match));
            h = turnToward(h, Math.atan2(s.centre.y - b.y, s.centre.x - b.x), perStep(spec.cohere));
          }
          return { x: wrap(b.x + Math.cos(h) * speed * DT, BOX.x0, BOX.x1), y: wrap(b.y + Math.sin(h) * speed * DT, BOX.y0, BOX.y1), h };
        });
        frames.push(boids.map(b => ({ ...b })));
      }
      const ruleColour = { separate: '#ff9a6b', match: '#57b6ff', cohere: '#7ad38a' }[spec.rule];
      return {
        period, bounds: BOX,
        key: [{ colour: ruleColour, label: spec.rule === 'separate' ? 'its push away from the close ones' : spec.rule === 'match' ? 'the way its neighbours go' : 'the middle of its neighbours' }, { colour: '#7f9cff', label: 'what it sees' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          const now = frames[f];
          now.forEach((b, i) => {
            const tail: Pt[] = [];
            for (let k = Math.max(0, f - 12); k <= f; k++) tail.push(frames[k][i]);
            for (const seg of unwrapped(tail)) fr.paths.push({ pts: seg, colour: i === 0 ? HOT : 'rgba(255,255,255,0.5)', width: i === 0 ? 2 : 1.2 });
            fr.arrows.push({ from: b, to: { x: b.x + Math.cos(b.h) * 0.09, y: b.y + Math.sin(b.h) * 0.09 }, colour: i === 0 ? HOT : 'rgba(255,255,255,0.75)', width: i === 0 ? 2.4 : 1.6 });
          });
          const me = now[0], s = look(me, now);
          fr.rings.push({ x: me.x, y: me.y, r: R, colour: '#7f9cff', dashed: true, fill: 'rgba(127,156,255,0.08)' });
          s.near.forEach(o => fr.dots.push({ x: o.x, y: o.y, r: 3.5, colour: '#7f9cff', hollow: true }));
          if (s.near.length) {
            if (spec.rule === 'separate') { const m = Math.hypot(s.push.x, s.push.y); if (m > 0) fr.arrows.push({ from: me, to: { x: me.x + s.push.x / m * 0.3, y: me.y + s.push.y / m * 0.3 }, colour: ruleColour, width: 3 }); }
            if (spec.rule === 'match') fr.arrows.push({ from: me, to: { x: me.x + Math.cos(s.heading) * 0.3, y: me.y + Math.sin(s.heading) * 0.3 }, colour: ruleColour, width: 3 });
            if (spec.rule === 'cohere') { fr.arrows.push({ from: me, to: s.centre, colour: ruleColour, width: 3 }); fr.dots.push({ ...s.centre, r: 4, colour: ruleColour }); }
          }
          return fr;
        },
      };
    }
    case 'goal': {
      const period = 4, G = { x: 1.15, y: 0 };
      const r = rand(5);
      const tracks = Array.from({ length: 5 }, (_, i) => {
        let p = { x: -1.35, y: -0.7 + i * 0.35 }, h = (r() - 0.5) * 2.5;
        const out: Pt[] = [p];
        for (let k = 1; k <= period * DEMO_FPS; k++) {
          h = turnToward(h, Math.atan2(G.y - p.y, G.x - p.x), perStep(spec.degrees));
          p = { x: p.x + Math.cos(h) * 0.7 * DT, y: p.y + Math.sin(h) * 0.7 * DT };
          out.push(p);
        }
        return out;
      });
      return {
        period, bounds: BOX, key: [{ colour, label: 'each turns toward the goal' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          fr.rings.push({ ...G, r: 0.08, colour, dashed: true }, { ...G, r: 0.025, colour, fill: colour });
          tracks.forEach(tr => { fr.paths.push({ pts: upTo(tr, f), colour, width: 2 }); fr.dots.push({ ...tr[f], r: 4.5, colour: HOT }); });
          return fr;
        },
      };
    }
    case 'slow': {
      const period = 6, R = 0.35;
      const r = rand(3);
      const crowd = Array.from({ length: Math.min(40, Math.max(6, Math.round(spec.jam))) }, () => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.4; return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8 }; });
      const track: Pt[] = [];
      const counts: number[] = [];
      let x = -1.45;
      for (let k = 0; k <= period * DEMO_FPS; k++) {
        const c = crowd.filter(o => Math.hypot(o.x - x, o.y) < R).length;
        track.push({ x, y: 0 }); counts.push(c);
        x = Math.min(1.5, x + 0.6 * Math.max(0.08, 1 - c / Math.max(1, spec.jam)) * DT);
      }
      return {
        period, bounds: BOX, key: [{ colour, label: 'one walks through a crowd and slows' }, { colour: '#7f9cff', label: 'the ones it counts' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          const me = track[f];
          crowd.forEach(o => fr.dots.push({ ...o, r: 3.5, colour: Math.hypot(o.x - me.x, o.y) < R ? '#7f9cff' : GHOST, hollow: Math.hypot(o.x - me.x, o.y) >= R }));
          fr.rings.push({ ...me, r: R, colour: '#7f9cff', dashed: true });
          for (let k = 0; k <= f; k += 6) fr.dots.push({ ...track[k], r: 2.5, colour, opacity: 0.8 });
          fr.dots.push({ ...me, r: 6, colour: HOT });
          return fr;
        },
      };
    }
    case 'avoidEdges': {
      const period = 6, m = Math.min(Math.max(spec.margin, 0), 0.9);
      let p = { x: 0, y: 0 }, h = 20 * DEG;
      const track: Pt[] = [p];
      for (let k = 1; k <= period * DEMO_FPS; k++) {
        if (p.x > BOX.x1 - m || p.x < BOX.x0 + m || p.y > BOX.y1 - m || p.y < BOX.y0 + m) h = turnToward(h, Math.atan2(-p.y, -p.x), perStep(spec.degrees));
        p = { x: Math.max(BOX.x0, Math.min(BOX.x1, p.x + Math.cos(h) * 0.8 * DT)), y: Math.max(BOX.y0, Math.min(BOX.y1, p.y + Math.sin(h) * 0.8 * DT)) };
        track.push(p);
      }
      return {
        period, bounds: BOX, key: [{ colour, label: 'turns back inside the band' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          fr.rects.push({ x0: BOX.x0, y0: BOX.y0, x1: BOX.x1, y1: BOX.y1, colour: GHOST }, { x0: BOX.x0 + m, y0: BOX.y0 + m, x1: BOX.x1 - m, y1: BOX.y1 - m, colour, dashed: true });
          fr.paths.push({ pts: upTo(track, f), colour, width: 2 });
          fr.dots.push({ ...track[f], r: 5, colour: HOT });
          return fr;
        },
      };
    }
    case 'wander': {
      const period = 5;
      const tracks = [0.4, 0, -0.4].map((y, i) => {
        const r = rand(21 + i);
        let p = { x: -1.4, y }, h = 0;
        const out: Pt[] = [p];
        for (let k = 1; k <= period * DEMO_FPS; k++) {
          h += ((r() * 2 - 1) + (r() * 2 - 1)) * spec.degrees * DEG;
          p = { x: p.x + Math.cos(h) * 0.55 * DT, y: p.y + Math.sin(h) * 0.55 * DT };
          out.push(p);
        }
        return out;
      });
      return {
        period, bounds: fit([...tracks.flat(), { x: -1.5, y: 0 }, { x: 1.4, y: 0 }]), key: [{ colour, label: 'random turns each step' }, { colour: GHOST, label: 'straight on' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          tracks.forEach(tr => { fr.paths.push({ pts: [tr[0], { x: tr[0].x + 0.55 * f * DT, y: tr[0].y }], colour: GHOST, dashed: true }); fr.paths.push({ pts: upTo(tr, f), colour, width: 2 }); fr.dots.push({ ...tr[f], r: 4.5, colour: HOT }); });
          return fr;
        },
      };
    }
    case 'view': {
      const period = 6, R = 0.45;
      const r = rand(9);
      const others = Array.from({ length: 46 }, () => ({ x: (r() - 0.5) * 3.1, y: (r() - 0.5) * 1.9 }));
      return {
        period, bounds: BOX, key: [{ colour, label: 'its view (the ring)' }, { colour: HOT, label: `counted (at most ${Math.round(spec.max)})` }],
        frame(t) {
          const s = ((t % period) + period) % period, fr = empty();
          const me = { x: -1.4 + (2.8 * s) / period, y: Math.sin(s * 1.1) * 0.25 };
          let counted = 0;
          others.forEach(o => {
            const inside = Math.hypot(o.x - me.x, o.y - me.y) < R;
            const lit = inside && counted < spec.max;
            if (lit) counted++;
            fr.dots.push({ ...o, r: lit ? 4 : 3, colour: lit ? HOT : inside ? colour : GHOST, hollow: !lit });
          });
          fr.rings.push({ ...me, r: R, colour, fill: 'rgba(127,156,255,0.1)' });
          fr.dots.push({ ...me, r: 6, colour: HOT });
          return fr;
        },
      };
    }
    case 'senses': {
      // A trail along a wave; three feelers read it, and it turns toward (or away from) the strongest.
      const period = 6, D = 0.32, speed = 0.5;
      const curve = (x: number) => 0.35 * Math.sin(x * 1.7);
      const smell = (p: Pt) => Math.exp(-((p.y - curve(p.x)) ** 2) / 0.02);
      const a = Math.max(0, spec.angle) * DEG;
      let p = { x: -1.4, y: -0.55 }, h = 25 * DEG;
      const track: Array<Pt & { h: number; read: [number, number, number] }> = [];
      const rnd = rand(4);
      for (let k = 0; k <= period * DEMO_FPS; k++) {
        const feel = [h + a, h, h - a].map(q => smell({ x: p.x + Math.cos(q) * D, y: p.y + Math.sin(q) * D })) as [number, number, number];
        track.push({ ...p, h, read: feel });
        const [L, C, Rr] = feel;
        const step = perStep(spec.turn) * (spec.away ? -1 : 1);
        if (C > L && C > Rr) { /* straight on */ } else if (L > C && Rr > C) h += step * (rnd() < 0.5 ? 1 : -1); else if (L > Rr) h += step; else if (Rr > L) h -= step;
        p = { x: p.x + Math.cos(h) * speed * DT, y: p.y + Math.sin(h) * speed * DT };
        if (p.x > 1.55) p = { x: -1.55, y: p.y };
        p.y = Math.max(-0.95, Math.min(0.95, p.y));
      }
      const wave = Array.from({ length: 65 }, (_, i) => { const x = BOX.x0 + (i / 64) * (BOX.x1 - BOX.x0); return { x, y: curve(x) }; });
      return {
        period, bounds: BOX, key: [{ colour: '#e8a33a', label: 'the trail' }, { colour, label: 'its three feelers (bright: smells more)' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          fr.paths.push({ pts: wave, colour: '#e8a33a', width: 14, opacity: 0.25 }, { pts: wave, colour: '#e8a33a', width: 2.5, opacity: 0.8 });
          for (const seg of unwrapped(track.slice(Math.max(0, f - 60), f + 1))) fr.paths.push({ pts: seg, colour: HOT, width: 1.6, opacity: 0.6 });
          const me = track[f];
          [me.h + a, me.h, me.h - a].forEach((q, i) => {
            const end = { x: me.x + Math.cos(q) * D, y: me.y + Math.sin(q) * D };
            fr.paths.push({ pts: [me, end], colour, dashed: i !== 1 });
            fr.dots.push({ ...end, r: 5, colour, opacity: 0.3 + 0.7 * me.read[i], hollow: me.read[i] < 0.2 });
          });
          fr.arrows.push({ from: me, to: { x: me.x + Math.cos(me.h) * 0.1, y: me.y + Math.sin(me.h) * 0.1 }, colour: HOT, width: 3 });
          return fr;
        },
      };
    }
    case 'orbit': {
      const period = 8, R = 0.6, speed = 0.6;
      const tracks = [{ x: 1.3, y: 0.1 }, { x: -0.25, y: 0.15 }].map(p0 => {
        let p = { ...p0 }, h = Math.PI / 2;
        const out: Pt[] = [p];
        for (let k = 1; k <= period * DEMO_FPS; k++) {
          const r = Math.hypot(p.x, p.y) || 1e-3, out_ = { x: p.x / r, y: p.y / r };
          const tang = spec.cw ? { x: out_.y, y: -out_.x } : { x: -out_.y, y: out_.x };
          const k2 = Math.max(-1, Math.min(1, (r - R) / R * 2));
          h = turnToward(h, Math.atan2(tang.y - out_.y * k2, tang.x - out_.x * k2), perStep(spec.degrees));
          p = { x: p.x + Math.cos(h) * speed * DT, y: p.y + Math.sin(h) * speed * DT };
          out.push(p);
        }
        return out;
      });
      return {
        period, bounds: fit([...tracks.flat(), { x: -R, y: -R }, { x: R, y: R }]), key: [{ colour, label: 'its circle' }, { colour: HOT, label: 'walkers turning onto it' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          fr.rings.push({ x: 0, y: 0, r: R, colour, dashed: true }, { x: 0, y: 0, r: 0.03, colour, fill: colour });
          tracks.forEach(tr => { fr.paths.push({ pts: tr.slice(Math.max(0, f - 90), f + 1), colour: HOT, width: 2, opacity: 0.75 }); fr.dots.push({ ...tr[f], r: 5, colour: HOT }); });
          return fr;
        },
      };
    }
    case 'speed': {
      const period = 4, v = Math.max(0, spec.speed);
      const span = Math.max(0.6, v * period);
      return {
        period, bounds: fit([{ x: 0, y: -0.3 }, { x: span, y: 0.3 }]), key: [{ colour, label: 'where it was each ¼ second' }],
        frame(t) {
          const s = ((t % period) + period) % period, fr = empty();
          for (let k = 0; k <= s * 4; k++) fr.dots.push({ x: v * k / 4, y: 0, r: 3, colour, opacity: 0.8 });
          for (let k = 0; k <= period; k++) fr.paths.push({ pts: [{ x: v * k, y: -0.12 }, { x: v * k, y: -0.2 }], colour: GHOST });
          fr.arrows.push({ from: { x: v * s, y: 0 }, to: { x: v * s + span * 0.05, y: 0 }, colour: HOT, width: 3 });
          return fr;
        },
      };
    }
    case 'edges': {
      const period = 5;
      let p = { x: 0.2, y: -0.1 }, v = { x: 0.9, y: 0.45 };
      const track: Pt[] = [p];
      for (let k = 1; k <= period * DEMO_FPS; k++) {
        p = { x: p.x + v.x * DT, y: p.y + v.y * DT };
        if (spec.edges === 'wrap') p = { x: wrap(p.x, BOX.x0, BOX.x1), y: wrap(p.y, BOX.y0, BOX.y1) };
        else if (spec.edges === 'bounce') {
          if (p.x > BOX.x1 || p.x < BOX.x0) { v = { ...v, x: -v.x }; p.x = Math.max(BOX.x0, Math.min(BOX.x1, p.x)); }
          if (p.y > BOX.y1 || p.y < BOX.y0) { v = { ...v, y: -v.y }; p.y = Math.max(BOX.y0, Math.min(BOX.y1, p.y)); }
        } else p = { x: Math.max(BOX.x0, Math.min(BOX.x1, p.x)), y: Math.max(BOX.y0, Math.min(BOX.y1, p.y)) };
        track.push(p);
      }
      return {
        period, bounds: { x0: -1.75, y0: -1.12, x1: 1.75, y1: 1.12 }, key: [{ colour, label: spec.edges === 'wrap' ? 'out one side, in the other' : spec.edges === 'bounce' ? 'turns back at the edge' : 'runs along the edge' }],
        frame(t) {
          const f = frameOf(t, period), fr = empty();
          fr.rects.push({ x0: BOX.x0, y0: BOX.y0, x1: BOX.x1, y1: BOX.y1, colour: GHOST, dashed: true });
          for (const seg of unwrapped(upTo(track, f))) fr.paths.push({ pts: seg, colour, width: 2 });
          fr.dots.push({ ...track[f], r: 5, colour: HOT });
          return fr;
        },
      };
    }
    case 'trail': {
      const period = 4, speed = 0.7;
      const at = (s: number) => ({ x: -1.4 + speed * s, y: 0.3 * Math.sin(s * 1.6) });
      const half = Math.max(spec.halfLife, 0.005);
      return {
        period, bounds: BOX, key: [{ colour, label: `what it left: half gone every ${Math.round(half * 1000) / 1000} s` }],
        frame(t) {
          const s = ((t % period) + period) % period, fr = empty();
          for (let k = 0; k <= s * DEMO_FPS; k += 2) {
            const age = s - k * DT;
            const v = Math.min(1, spec.amount) * Math.pow(2, -age / half);
            if (v < 0.02) continue;
            fr.dots.push({ ...at(k * DT), r: 3 + spec.diffuse * Math.min(age, 2) * 5, colour, opacity: v });
          }
          fr.arrows.push({ from: at(s), to: at(s + 0.12), colour: HOT, width: 3 });
          return fr;
        },
      };
    }
    case 'born': {
      const period = 3, n = 70, r = rand(2);
      const pts = Array.from({ length: n }, (): Pt => {
        const a = r() * Math.PI * 2, u = r(), S = 0.6;
        switch (spec.shape) {
          case 'ring': case 'sphere': return { x: Math.cos(a) * S, y: Math.sin(a) * S };
          case 'box': return { x: (u - 0.5) * 2 * S, y: (r() - 0.5) * 2 * S };
          case 'line': return { x: (u - 0.5) * 2 * S, y: 0 };
          case 'point': return { x: Math.cos(a) * 0.01, y: Math.sin(a) * 0.01 };
          case 'screen': return { x: (u - 0.5) * 3.1, y: (r() - 0.5) * 1.9 };
          default: return { x: Math.cos(a) * Math.sqrt(u) * S, y: Math.sin(a) * Math.sqrt(u) * S };
        }
      });
      return {
        period, bounds: BOX, key: [{ colour, label: 'born in its shape, then off they go' }],
        frame(t) {
          const s = ((t % period) + period) % period, fr = empty();
          pts.forEach((p, i) => { const b = (i / n) * 1.2; if (s >= b) fr.dots.push({ ...p, r: 3, colour: i % 7 ? colour : HOT, opacity: Math.min(1, (s - b) * 4) }); });
          return fr;
        },
      };
    }
  }
}
