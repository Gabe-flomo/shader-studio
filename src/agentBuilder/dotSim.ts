/**
 * dotSim.ts — a small CPU picture of particles, flocks, crowds and orbiters run from their cards
 * (behaviours.ts), for the presets strip's thumbnails and the start page's Crowds picture. It runs
 * the rule set's actions the way generate.ts does (forces change the velocity; steering turns the
 * heading by at most so many degrees; drag; orbit; edges), on a few hundred dots with exact
 * neighbours. It is a picture of the motion, not the GPU simulation.
 */
import type { AgentRuleSet, RuleAction, RuleCondition } from '../agentRules/spec';
import { cardRule, conditionsOf } from './behaviours';
import { miniRandom } from './miniSim';
import { curlAt } from './diagram';

/** Where a preset's dots are born, for its thumbnail (the presets carry no Emit of their own). */
export interface DotEmit {
  shape: 'disc' | 'ring' | 'screen' | 'line';
  x: number; y: number; size: number;
  heading: 'up' | 'random' | 'outward' | 'right' | 'left' | 'tangent';
  /** Starting speed (picture units a second); the species' speed when missing. */
  speed?: number;
  /** Seconds each lives (0: for ever) before it is born again. */
  life?: number;
  /** Which kind (species) is born here (each in turn when missing). */
  species?: number;
}

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

/** One plain condition, as the cards' "only when" (neighbour counts and smells aren't simulated: they hold). */
function holds(c: RuleCondition | undefined, age: number, rand: () => number, dt: number, near: number): boolean {
  if (!c) return true;
  switch (c.kind) {
    case 'age': return c.cmp === '>' ? age > c.seconds : age < c.seconds;
    case 'chance': return rand() < 1 - Math.pow(1 - clamp(c.perSecond, 0, 1), dt);
    case 'neighbours': return c.cmp === '>' ? near > c.count : near < c.count;
    case 'state': return c.state === 0 ? !c.not : !!c.not;
    default: return true;
  }
}

export class DotSim {
  readonly n: number;
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array; age: Float32Array; bright: Float32Array; sp: Uint8Array;
  private t = 0;
  private rand: () => number;
  private steps: Array<Array<{ a: RuleAction; when?: RuleCondition }>>;

  readonly set: AgentRuleSet;
  readonly emits: DotEmit[];
  readonly aspect: number;

  constructor(set: AgentRuleSet, n: number, emits: DotEmit[], aspect = 1.6, seed = 5) {
    this.set = set; this.emits = emits; this.aspect = aspect;
    this.n = n;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    this.age = new Float32Array(n); this.bright = new Float32Array(n).fill(1); this.sp = new Uint8Array(n);
    this.rand = miniRandom(seed);
    this.steps = set.species.map(s => s.rules.filter(r => !r.off && cardRule(r)).flatMap(r => r.do.map(a => ({ a, when: conditionsOf(r)[0] }))));
    for (let i = 0; i < n; i++) {
      this.sp[i] = i % set.species.length;
      this.born(i);
      // Spread the births over the first life, so they don't all die together.
      const life = this.emitOf(i).life ?? 0;
      if (life > 0) this.age[i] = this.rand() * life;
    }
  }

  private emitOf(i: number): DotEmit {
    const own = this.emits.filter(e => e.species === undefined || e.species === this.sp[i]);
    return own[i % Math.max(own.length, 1)] ?? this.emits[0] ?? { shape: 'screen', x: 0, y: 0, size: 1, heading: 'random' };
  }

  private born(i: number): void {
    const e = this.emitOf(i);
    const r = this.rand, A = this.aspect;
    let x = e.x, y = e.y;
    if (e.shape === 'screen') { x = (r() * 2 - 1) * A; y = r() * 2 - 1; }
    else if (e.shape === 'disc') { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * e.size; x += Math.cos(a) * d; y += Math.sin(a) * d; }
    else if (e.shape === 'ring') { const a = r() * Math.PI * 2; x += Math.cos(a) * e.size; y += Math.sin(a) * e.size; }
    else { y += (r() * 2 - 1) * e.size; }
    const speed = e.speed ?? this.set.species[this.sp[i]].speed;
    let h = r() * Math.PI * 2;
    if (e.heading === 'up') h = Math.PI / 2 + (r() - 0.5) * 0.5;
    else if (e.heading === 'right') h = (r() - 0.5) * 0.3;
    else if (e.heading === 'left') h = Math.PI + (r() - 0.5) * 0.3;
    else if (e.heading === 'outward') h = Math.atan2(y - e.y, x - e.x);
    else if (e.heading === 'tangent') h = Math.atan2(y - e.y, x - e.x) + Math.PI / 2;
    this.x[i] = x; this.y[i] = y; this.vx[i] = Math.cos(h) * speed; this.vy[i] = Math.sin(h) * speed;
    this.age[i] = 0; this.bright[i] = 1;
  }

  /** The curl flow (a stream function's curl: swirls that never bunch up), Size and Evolve as the rule set's. */
  private curl(x: number, y: number): [number, number] {
    return curlAt(x, y, this.set.flow.size, this.t * this.set.flow.evolve * 2);
  }

  step(dt = 1 / 60): void {
    this.t += dt;
    const { n, x, y, vx, vy, set } = this;
    const A = this.aspect;
    const R = set.neighbours?.radius ?? 0.05;
    const kind = set.kind ?? 'trail';
    const particles = kind === 'particles';
    for (let i = 0; i < n; i++) {
      const s = this.sp[i];
      this.age[i] += dt;
      const life = this.emitOf(i).life ?? 0;
      if (life > 0 && this.age[i] > life) { this.born(i); continue; }
      let spd = Math.hypot(vx[i], vy[i]);
      let h = Math.atan2(vy[i], vx[i]);
      if (!particles) spd = set.species[s].speed;
      let bright = 1;
      // Neighbours (exact, within the reach of the widest reading), counted once per step.
      const reach = (r?: number) => (r && r > 0 ? r : R) * 1.6;
      let near = 0;
      const turnTo = (dx: number, dy: number, deg: number) => {
        if (Math.hypot(dx, dy) < 1e-6) return;
        const d = ((Math.atan2(dy, dx) - h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        h += clamp(d, -deg * DEG, deg * DEG);
      };
      const look = (who: string, r?: number) => {
        let c = 0, cx = 0, cy = 0, ax = 0, ay = 0, px = 0, py = 0;
        const rr = reach(r);
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          if (who === 'own' && this.sp[j] !== s) continue;
          if (who === 'others' && this.sp[j] === s) continue;
          const dx = x[j] - x[i], dy = y[j] - y[i];
          const l = Math.hypot(dx, dy);
          if (l > rr || l < 1e-6) continue;
          c++; cx += dx; cy += dy; ax += vx[j]; ay += vy[j];
          px -= dx / (l * l); py -= dy / (l * l);
        }
        return { c, cx: c ? cx / c : 0, cy: c ? cy / c : 0, ax, ay, px, py };
      };
      for (const { a, when } of this.steps[s] ?? []) {
        if (when?.kind === 'neighbours') near = look(when.who, when.radius).c;
        if (!holds(when, this.age[i], this.rand, dt, near)) continue;
        switch (a.kind) {
          case 'force': {
            let fx = 0, fy = 0;
            if (a.field === 'gravity' || a.field === 'wind') {
              const ang = (a.angle ?? (a.field === 'gravity' ? -90 : 0)) * DEG;
              const gust = a.field === 'wind' ? 1 + 0.6 * Math.sin(this.t * 1.3 + y[i] * 2) * Math.sin(this.t * 0.37) : 1;
              fx = Math.cos(ang) * a.strength * gust; fy = Math.sin(ang) * a.strength * gust;
            } else if (a.field === 'curl') { const c = this.curl(x[i], y[i]); fx = c[0] * a.strength; fy = c[1] * a.strength; }
            else { const tx = a.field === 'mouse' ? 0 : a.x ?? 0, ty = a.field === 'mouse' ? 0 : a.y ?? 0; const dx = tx - x[i], dy = ty - y[i], l = Math.hypot(dx, dy) || 1; fx = dx / l * a.strength; fy = dy / l * a.strength; }
            const nvx = Math.cos(h) * spd + fx * dt, nvy = Math.sin(h) * spd + fy * dt;
            spd = Math.hypot(nvx, nvy); if (spd > 1e-6) h = Math.atan2(nvy, nvx);
            break;
          }
          case 'drag': spd *= Math.exp(-Math.max(a.amount, 0) * dt); break;
          case 'fade': bright *= clamp(1 - this.age[i] / Math.max(a.seconds, 1e-3), 0, 1); break;
          case 'die': this.born(i); break;
          case 'wander': h += (this.rand() * 2 - 1) * a.degrees * DEG; break;
          case 'separate': { const o = look(a.who, a.radius); if (o.c) turnTo(o.px, o.py, a.degrees); break; }
          case 'match': { const o = look(a.who, a.radius); if (o.c) turnTo(o.ax, o.ay, a.degrees); break; }
          case 'cohere': { const o = look(a.who, a.radius); if (o.c) turnTo(o.cx, o.cy, a.degrees); break; }
          case 'slow': { const o = look(a.who, a.radius); spd *= 1 - Math.min(o.c / Math.max(a.jam, 1), 0.92); break; }
          case 'avoidEdges': {
            const m = a.margin;
            turnTo(x[i] > A - m ? -1 : x[i] < m - A ? 1 : 0, y[i] > 1 - m ? -1 : y[i] < m - 1 ? 1 : 0, a.degrees);
            break;
          }
          case 'turn': {
            if (a.toward === 'trail') break;
            const tx = a.toward === 'point' ? a.x ?? 0 : 0, ty = a.toward === 'point' ? a.y ?? 0 : 0;
            turnTo(a.away ? x[i] - tx : tx - x[i], a.away ? y[i] - ty : ty - y[i], a.degrees);
            break;
          }
          case 'orbit': {
            const tx = a.target === 'point' ? a.x ?? 0 : 0, ty = a.target === 'point' ? a.y ?? 0 : 0;
            const ox = x[i] - tx, oy = y[i] - ty, r = Math.max(Math.hypot(ox, oy), 1e-5), D = Math.max(a.distance, 1e-3);
            const sg = a.cw ? -1 : 1, k = clamp((r - D) / D, -1, 1);
            turnTo(-oy * sg / r - ox / r * k, ox * sg / r - oy / r * k, a.degrees);
            break;
          }
          case 'speed': spd = a.mode === 'set' ? a.value : spd + a.value * dt; break;
          default: break;
        }
      }
      vx[i] = Math.cos(h) * spd; vy[i] = Math.sin(h) * spd;
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
      this.bright[i] = bright;
      // Edges.
      const e = set.edges;
      if (e === 'wrap') { if (x[i] > A) x[i] -= 2 * A; else if (x[i] < -A) x[i] += 2 * A; if (y[i] > 1) y[i] -= 2; else if (y[i] < -1) y[i] += 2; }
      else {
        if (Math.abs(x[i]) > A) { x[i] = Math.sign(x[i]) * A; if (e === 'bounce') vx[i] = -vx[i]; else vx[i] = 0; }
        if (Math.abs(y[i]) > 1) { y[i] = Math.sign(y[i]); if (e === 'bounce') vy[i] = -vy[i]; else vy[i] = 0; }
      }
    }
  }

  /** The dots onto a 2D canvas (picture units → pixels), each in its kind's colour times its brightness. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, size = 1.6): void {
    const cols = this.set.species.map(s => s.states[0]?.colour ?? [1, 0.8, 0.5]);
    for (let i = 0; i < this.n; i++) {
      const b = this.bright[i];
      if (b <= 0.01) continue;
      const c = cols[this.sp[i]];
      const px = (this.x[i] / this.aspect * 0.5 + 0.5) * w, py = (0.5 - this.y[i] * 0.5) * h;
      ctx.fillStyle = `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${(0.85 * b).toFixed(3)})`;
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }
  }
}
