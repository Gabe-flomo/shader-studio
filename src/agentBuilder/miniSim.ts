/**
 * miniSim.ts — small CPU walkers for the Agent Builder's pictures (docs/agent-builder.md): the
 * start page's moving cards and the presets' thumbnails. Not the group's simulation (that runs on
 * the GPU, and the viewport shows it live): a few thousand walkers on a small grid following the
 * same rule from the field guide (Jones: sense three points, turn toward the strongest, wobble,
 * step, deposit; the trail spreads and fades), at the trail's pixel scale (a 1024-row trail), so
 * a thumbnail is a close-up of the pattern the real setup makes.
 *
 * Also the other start-page kinds' motion: particles under gravity, a flock of arrows, orbiters.
 * Pure maths over typed arrays; drawing is to an RGBA buffer the caller puts on a canvas.
 */
import type { AgentRuleSet } from '../agentRules/spec';
import { readCards } from './cards';

export interface SpeciesSim {
  /** Feelers: distance (picture units) and angle (degrees); turn 0 = it doesn't smell. */
  distance: number; angle: number; turn: number; away: boolean;
  wobble: number; speed: number;
  /** Channel it smells and the one it lays (0–3); deposit 0 = none. */
  smell: number; lay: number; deposit: number;
  colour: [number, number, number];
}

export interface SimParams {
  species: SpeciesSim[];
  edges: 'wrap' | 'bounce' | 'slide';
  /** Seconds to fade to half, and the share blurred each step. */
  halfLife: number; diffuse: number;
  mode?: 'follow' | 'dla';
}

/** Trail pixels per picture unit: the 1024-row trail the Slime mold preset uses. */
const PX_PER_UNIT = 512;
const DT = 1 / 60;
const RAD = Math.PI / 180;

/** The picture's parameters from a rule set (each species' cards) and the Trail field's settings. */
export function simFromRules(set: AgentRuleSet, trail: { halfLife?: number; diffuse?: number } = {}): SimParams {
  return {
    edges: set.edges,
    halfLife: trail.halfLife ?? 0.06,
    diffuse: trail.diffuse ?? 1,
    species: set.species.slice(0, 4).map((s, i) => {
      const c = readCards(set, i);
      const ch = (v: 'own' | number) => (v === 'own' ? i : v);
      return {
        distance: c.senses.distance, angle: c.senses.angle, turn: c.senses.on ? c.turning.sharp : 0, away: c.senses.away,
        wobble: c.turning.wobbleOn ? c.turning.wobble : 0, speed: Math.max(c.moving.speed, 0.02),
        smell: ch(c.senses.channel), lay: ch(c.trail.channel), deposit: c.trail.on ? c.trail.amount : 0,
        colour: s.states[0]?.colour ?? [1, 0.85, 0.5],
      };
    }),
  };
}

/** A repeatable random number stream. */
function rng(seed: number) {
  let x = (seed * 0x9E3779B1) >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

export class TrailSim {
  readonly w: number; readonly h: number;
  /** Four channels, one after another. */
  trail: Float32Array;
  private tmp: Float32Array;
  private x: Float32Array; private y: Float32Array; private a: Float32Array; private sp: Uint8Array; private stuck: Uint8Array;
  private rand: () => number;
  p: SimParams;
  constructor(w: number, h: number, count: number, p: SimParams, seed = 1) {
    this.w = w; this.h = h; this.p = p;
    this.trail = new Float32Array(w * h * 4);
    this.tmp = new Float32Array(w * h);
    this.x = new Float32Array(count); this.y = new Float32Array(count); this.a = new Float32Array(count);
    this.sp = new Uint8Array(count); this.stuck = new Uint8Array(count);
    this.rand = rng(seed);
    const ns = Math.max(1, p.species.length);
    for (let i = 0; i < count; i++) {
      this.x[i] = this.rand() * w; this.y[i] = this.rand() * h; this.a[i] = this.rand() * Math.PI * 2; this.sp[i] = i % ns;
    }
    if (p.mode === 'dla') {
      // The seed: a few stuck walkers in the middle.
      for (let i = 0; i < Math.min(8, count); i++) { this.x[i] = w / 2 + (i % 3) - 1; this.y[i] = h / 2 + Math.floor(i / 3) - 1; this.stuck[i] = 1; this.deposit(i, 0, 3); }
    }
  }

  private read(ch: number, px: number, py: number): number {
    const { w, h } = this;
    let ix = Math.floor(px), iy = Math.floor(py);
    ix = ((ix % w) + w) % w; iy = ((iy % h) + h) % h;
    return this.trail[(ch * h + iy) * w + ix];
  }
  private deposit(i: number, ch: number, amount: number) {
    const ix = Math.floor(this.x[i]), iy = Math.floor(this.y[i]);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    this.trail[(ch * this.h + iy) * this.w + ix] += amount;
  }

  step(): void {
    const { w, h, p } = this;
    const dla = p.mode === 'dla';
    for (let i = 0; i < this.x.length; i++) {
      if (this.stuck[i]) continue;
      const s = p.species[this.sp[i]] ?? p.species[0];
      let a = this.a[i];
      if (dla) {
        if (this.read(0, this.x[i] + 1, this.y[i]) + this.read(0, this.x[i] - 1, this.y[i]) + this.read(0, this.x[i], this.y[i] + 1) + this.read(0, this.x[i], this.y[i] - 1) > 0.5) {
          this.stuck[i] = 1; this.deposit(i, 0, 3); continue;
        }
      } else if (s.turn > 0) {
        const d = s.distance * PX_PER_UNIT, sa = s.angle * RAD;
        const sign = s.away ? -1 : 1;
        const L = sign * this.read(s.smell, this.x[i] + Math.cos(a + sa) * d, this.y[i] + Math.sin(a + sa) * d);
        const C = sign * this.read(s.smell, this.x[i] + Math.cos(a) * d, this.y[i] + Math.sin(a) * d);
        const R = sign * this.read(s.smell, this.x[i] + Math.cos(a - sa) * d, this.y[i] + Math.sin(a - sa) * d);
        const t = s.turn * RAD;
        if (C > L && C > R) { /* keep straight */ } else if (C < L && C < R) a += this.rand() < 0.5 ? t : -t;
        else if (L > R) a += t; else if (R > L) a -= t;
      }
      if (s.wobble > 0) a += (this.rand() * 2 - 1) * s.wobble * RAD;
      const step = s.speed * DT * PX_PER_UNIT;
      let nx = this.x[i] + Math.cos(a) * step, ny = this.y[i] + Math.sin(a) * step;
      if (p.edges === 'wrap') { nx = ((nx % w) + w) % w; ny = ((ny % h) + h) % h; }
      else {
        if (nx < 0 || nx >= w) { if (p.edges === 'bounce') a = Math.PI - a; nx = Math.min(Math.max(nx, 0), w - 0.01); }
        if (ny < 0 || ny >= h) { if (p.edges === 'bounce') a = -a; ny = Math.min(Math.max(ny, 0), h - 0.01); }
      }
      this.x[i] = nx; this.y[i] = ny; this.a[i] = a;
      if (!dla && s.deposit > 0) this.deposit(i, s.lay, s.deposit);
    }
    if (dla) return;
    // Spread (a mix toward the 3×3 mean) and fade.
    const keep = Math.pow(2, -DT / Math.max(p.halfLife, 0.005));
    const mixK = Math.min(Math.max(p.diffuse, 0), 1);
    for (let ch = 0; ch < 4; ch++) {
      const o = ch * w * h;
      let any = false;
      for (let k = 0; k < w * h; k++) if (this.trail[o + k] !== 0) { any = true; break; }
      if (!any) continue;
      for (let y = 0; y < h; y++) {
        const ym = ((y - 1 + h) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
        for (let x = 0; x < w; x++) {
          const xm = (x - 1 + w) % w, xp = (x + 1) % w;
          const t = this.trail;
          const mean = (t[o + ym + xm] + t[o + ym + x] + t[o + ym + xp] + t[o + y0 + xm] + t[o + y0 + x] + t[o + y0 + xp] + t[o + yp + xm] + t[o + yp + x] + t[o + yp + xp]) / 9;
          const v = t[o + y0 + x];
          this.tmp[y0 + x] = (v + (mean - v) * mixK) * keep;
        }
      }
      this.trail.set(this.tmp, o);
    }
  }

  /** The picture into an RGBA buffer (w × h): each channel in its species' colour over `bg`. */
  draw(out: Uint8ClampedArray, bg: [number, number, number] = [10, 10, 16], gain = 0.35): void {
    const { w, h, p } = this;
    const cols = [0, 1, 2, 3].map(ch => p.species.find(s => s.lay === ch)?.colour ?? p.species[ch]?.colour ?? [1, 0.85, 0.5]);
    for (let k = 0; k < w * h; k++) {
      let r = bg[0], g = bg[1], b = bg[2];
      for (let ch = 0; ch < 4; ch++) {
        const v = this.trail[ch * w * h + k];
        if (v <= 0) continue;
        const s = 1 - Math.exp(-v * gain);
        const c = cols[ch];
        r += (255 * c[0] - r) * s; g += (255 * c[1] - g) * s; b += (255 * c[2] - b) * s;
      }
      // Flip: the picture's y goes up.
      const row = h - 1 - Math.floor(k / w), col = k % w, j = (row * w + col) * 4;
      out[j] = r; out[j + 1] = g; out[j + 2] = b; out[j + 3] = 255;
    }
    if (p.mode === 'dla') {
      for (let i = 0; i < this.x.length; i++) {
        if (this.stuck[i]) continue;
        const col = Math.floor(this.x[i]), row = h - 1 - Math.floor(this.y[i]);
        const j = (row * w + col) * 4;
        if (j >= 0 && j < out.length) { out[j] = Math.max(out[j], 90); out[j + 1] = Math.max(out[j + 1], 90); out[j + 2] = Math.max(out[j + 2], 110); }
      }
    }
  }
}

/** Walkers for a grid: the trail's density of the real setup (about 1 in 7 trail pixels), capped. */
export const walkersFor = (w: number, h: number) => Math.min(6000, Math.round(w * h * 0.14));

// ── The other kinds' start-page pictures ─────────────────────────────────────

export interface Dot { x: number; y: number; vx: number; vy: number; age: number }

/** Particles: a fountain under gravity, each living 2 s. Positions 0–1 (y up). */
export function stepParticles(dots: Dot[], dt: number, rand: () => number): void {
  for (const d of dots) {
    d.age += dt;
    if (d.age > 2) { d.x = 0.5 + (rand() - 0.5) * 0.04; d.y = 0.08; d.vx = (rand() - 0.5) * 0.35; d.vy = 0.75 + rand() * 0.35; d.age = rand() * 0.2; }
    d.vy -= 0.9 * dt; d.vx += Math.sin(d.y * 9 + d.age * 3) * 0.06 * dt;
    d.x += d.vx * dt; d.y += d.vy * dt;
  }
}

/** A flock: separate, align, cohere within a radius; wraps. */
export function stepFlock(dots: Dot[], dt: number): void {
  const r = 0.12;
  for (const d of dots) {
    let n = 0, cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0;
    for (const o of dots) {
      if (o === d) continue;
      let dx = o.x - d.x, dy = o.y - d.y;
      dx -= Math.round(dx); dy -= Math.round(dy);
      const l = Math.hypot(dx, dy);
      if (l > r) continue;
      n++; cx += dx; cy += dy; ax += o.vx; ay += o.vy;
      if (l < r * 0.35 && l > 1e-6) { sx -= dx / (l * l); sy -= dy / (l * l); }
    }
    if (n) {
      d.vx += (cx / n * 1.2 + (ax / n - d.vx) * 1.5 + sx * 0.0015) * dt * 4;
      d.vy += (cy / n * 1.2 + (ay / n - d.vy) * 1.5 + sy * 0.0015) * dt * 4;
    }
    const s = Math.hypot(d.vx, d.vy) || 1, want = 0.22;
    d.vx = d.vx / s * want; d.vy = d.vy / s * want;
  }
  for (const d of dots) { d.x = (d.x + d.vx * dt + 1) % 1; d.y = (d.y + d.vy * dt + 1) % 1; }
}

/** Orbiters: circling the middle at their own radius, nudged toward it. */
export function stepOrbit(dots: Dot[], dt: number): void {
  for (const d of dots) {
    const dx = d.x - 0.5, dy = d.y - 0.5, l = Math.hypot(dx, dy) || 1e-3;
    const v = 0.35 / Math.sqrt(Math.max(l, 0.05));
    d.vx = -dy / l * v * 0.3; d.vy = dx / l * v * 0.3;
    d.x += d.vx * dt; d.y += d.vy * dt;
  }
}

/** `n` dots for a kind's picture (repeatable). */
export function dotsFor(kind: 'particles' | 'flock' | 'orbit', n: number, seed = 3): Dot[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    if (kind === 'orbit') {
      const a = r() * Math.PI * 2, d = 0.06 + Math.pow(r(), 0.7) * 0.36;
      return { x: 0.5 + Math.cos(a) * d, y: 0.5 + Math.sin(a) * d, vx: 0, vy: 0, age: 0 };
    }
    // Particles wait their turn: each is born when its age passes 2 s, so births are spread out.
    if (kind === 'particles') return { x: 0.5, y: -1, vx: 0, vy: 0, age: r() * 2 };
    const a = r() * Math.PI * 2;
    return { x: r(), y: r(), vx: Math.cos(a) * 0.2, vy: Math.sin(a) * 0.2, age: 0 };
  });
}

export { rng as miniRandom };
