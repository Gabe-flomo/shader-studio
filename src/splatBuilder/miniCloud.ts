/**
 * miniCloud.ts — a small point cloud on the CPU for the Splat builder's pictures (docs/splat-builder.md): each
 * effect card's live mini preview, the template cards and the kind page's picture. A lumpy ball of a few hundred
 * points (the generated example scan's shape), each effect applied with the same settings as its node, roughly
 * (the node's GLSL is the real thing; this only has to read the same at a glance).
 *
 * Pure: no DOM. components/splatBuilder/MiniCloud.tsx draws it.
 */
import type { EffectSpec, ParamValue, Vec3 } from './spec';

export interface Pt { p: Vec3; c: Vec3; a: number; s: number; dot: boolean; rand: number }

const hash = (i: number, k: number) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

/** `n` points on a lumpy ball, coloured warm to cool by height (+Y up). */
export function cloudPoints(n = 700): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const u = hash(i, 1) * 2 - 1, t = hash(i, 2) * Math.PI * 2;
    const r0 = Math.sqrt(1 - u * u);
    const d: Vec3 = [r0 * Math.cos(t), u, r0 * Math.sin(t)];
    const lump = 0.85 + 0.12 * Math.sin(d[0] * 5 + 1) * Math.sin(d[1] * 4) * Math.cos(d[2] * 3 + 2);
    const p: Vec3 = [d[0] * lump, d[1] * lump, d[2] * lump];
    const h = u * 0.5 + 0.5;
    const shade = 0.7 + 0.3 * (lump - 0.73) / 0.24;
    const c: Vec3 = [(0.25 + 0.7 * h) * shade, (0.45 + 0.2 * Math.sin(h * 3)) * shade, (0.95 - 0.7 * h) * shade];
    out.push({ p, c, a: 1, s: 1, dot: false, rand: hash(i, 3) });
  }
  return out;
}

/** Cheap smooth 3D noise in 0..1 (sums of sines: enough for a picture). */
const noise3 = (x: number, y: number, z: number) =>
  0.5 + 0.25 * Math.sin(x * 1.7 + Math.sin(y * 2.3 + z)) * Math.cos(y * 1.3 - Math.sin(z * 1.9 + x)) + 0.2 * Math.sin(z * 2.1 + x * 0.7 + y * 1.1) * Math.cos(x * 2.7 - z * 0.5);

const num = (v: ParamValue | undefined, d: number) => (typeof v === 'number' ? v : d);
const vec = (v: ParamValue | undefined, d: Vec3): Vec3 => (Array.isArray(v) ? v : d);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / ((b - a) || 1e-6))); return t * t * (3 - 2 * t); };
const AX: Record<string, number> = { x: 0, y: 1, z: 2 };

/** The value an animated setting has at time `t` (the LFO's sine). */
export function animatedParams(e: EffectSpec, t: number): Record<string, ParamValue> {
  if (!e.animate) return e.params;
  const { param, speed, from, to } = e.animate;
  const v = (from + to) / 2 + (to - from) / 2 * Math.sin(t * speed * Math.PI * 2);
  return { ...e.params, [param]: v };
}

function hueTurn(c: Vec3, deg: number): Vec3 {
  const a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), k = 1 / 3, sq = Math.sqrt(k);
  const m = [
    cs + (1 - cs) * k, k * (1 - cs) - sq * sn, k * (1 - cs) + sq * sn,
    k * (1 - cs) + sq * sn, cs + k * (1 - cs), k * (1 - cs) - sq * sn,
    k * (1 - cs) - sq * sn, k * (1 - cs) + sq * sn, cs + k * (1 - cs),
  ];
  return [m[0] * c[0] + m[1] * c[1] + m[2] * c[2], m[3] * c[0] + m[4] * c[1] + m[5] * c[2], m[6] * c[0] + m[7] * c[1] + m[8] * c[2]];
}

/** One effect on the points (in place), at time `t`. */
export function applyEffect(pts: Pt[], e: EffectSpec, t: number): void {
  if (!e.on) return;
  const P = animatedParams(e, t);
  switch (e.kind) {
    case 'dissolve': {
      const amt = num(P.amount, 0.4), sc = num(P.scale, 1.5), ev = num(P.evolve, 0.1), soft = Math.max(0.005, num(P.softness, 0.08));
      const edge = num(P.edge, 0.06), glow = num(P.glow, 4), ec = vec(P.edgeColor, [1, 0.45, 0.12]), drift = num(P.drift, 0.25), mode = String(P.mode ?? 'both');
      for (const q of pts) {
        const n = noise3(q.p[0] * sc + t * ev, q.p[1] * sc, q.p[2] * sc - t * ev);
        const keep = smooth(amt - soft, amt + soft, n);
        const band = edge > 0 ? 1 - smooth(0, edge, Math.abs(n - amt)) : 0;
        q.c = [q.c[0] + ec[0] * band * glow * 0.25, q.c[1] + ec[1] * band * glow * 0.25, q.c[2] + ec[2] * band * glow * 0.25];
        if (mode !== 'shrink') q.a *= keep;
        if (mode !== 'fade') q.s *= keep;
        q.p = [q.p[0], q.p[1] + drift * (1 - keep), q.p[2]];
      }
      return;
    }
    case 'explode': {
      const amt = num(P.amount, 0.5) * (1 - num(P.returnHome, 0)), dist = num(P.distance, 1.5), ctr = vec(P.center, [0, 0, 0]);
      const scat = num(P.scatter, 0.35), stag = num(P.stagger, 0.5), spin = num(P.spin, 0.25);
      for (const q of pts) {
        const k = Math.max(0, Math.min(1, amt * (1 + stag) - q.rand * stag));
        const d0 = [q.p[0] - ctr[0], q.p[1] - ctr[1], q.p[2] - ctr[2]];
        const l = Math.hypot(d0[0], d0[1], d0[2]) || 1;
        const rd = [hash(q.rand * 1e6, 4) * 2 - 1, hash(q.rand * 1e6, 5) * 2 - 1, hash(q.rand * 1e6, 6) * 2 - 1];
        const dir = [d0[0] / l * (1 - scat) + rd[0] * scat, d0[1] / l * (1 - scat) + rd[1] * scat, d0[2] / l * (1 - scat) + rd[2] * scat];
        let p: Vec3 = [q.p[0] + dir[0] * dist * k, q.p[1] + dir[1] * dist * k, q.p[2] + dir[2] * dist * k];
        const a = spin * k * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
        p = [p[0] * cs - p[2] * sn, p[1], p[0] * sn + p[2] * cs];
        q.p = p;
      }
      return;
    }
    case 'wave': {
      const amp = num(P.amplitude, 0.06), fr = num(P.frequency, 3), sp = num(P.speed, 1.5), mode = String(P.mode ?? 'wave');
      const along = String(P.along ?? 'x'), push = String(P.push ?? 'y');
      for (const q of pts) {
        if (mode === 'twist') {
          const a = amp * q.p[1] * Math.PI * 2 + 0 * t, cs = Math.cos(a + sp * t * 0.2), sn = Math.sin(a + sp * t * 0.2);
          q.p = [q.p[0] * cs - q.p[2] * sn, q.p[1], q.p[0] * sn + q.p[2] * cs];
        } else if (mode === 'wobble') {
          q.p = [q.p[0] + amp * (noise3(q.p[0] * fr + t * sp, q.p[1] * fr, 0) - 0.5) * 4, q.p[1] + amp * (noise3(0, q.p[1] * fr - t * sp, q.p[2] * fr) - 0.5) * 4, q.p[2] + amp * (noise3(q.p[2] * fr, 0, q.p[0] * fr + t * sp) - 0.5) * 4];
        } else {
          const x = along === 'radial' ? Math.hypot(q.p[0], q.p[1], q.p[2]) : q.p[AX[along] ?? 0];
          const w = amp * Math.sin(x * fr * Math.PI * 2 - t * sp * 2);
          if (push === 'out') { const l = Math.hypot(...q.p) || 1; q.p = [q.p[0] * (1 + w / l), q.p[1] * (1 + w / l), q.p[2] * (1 + w / l)]; }
          else { const p = [...q.p] as Vec3; p[AX[push] ?? 1] += w; q.p = p; }
        }
      }
      return;
    }
    case 'color': {
      const hue = num(P.hue, 0), sat = num(P.saturation, 1), br = num(P.brightness, 1), con = num(P.contrast, 1), tint = vec(P.tint, [1, 0.6, 0.3]), ta = num(P.tintAmount, 0);
      for (const q of pts) {
        let c = hueTurn(q.c, hue);
        const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
        c = c.map(v => (l + (v - l) * sat)) as Vec3;
        c = c.map(v => ((v * br - 0.5) * con + 0.5)) as Vec3;
        const l2 = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
        q.c = c.map((v, i) => v + (tint[i] * l2 * 1.6 - v) * ta) as Vec3;
      }
      return;
    }
    case 'crop': {
      const shape = String(P.shape ?? 'plane'), keep = String(P.keep ?? 'inside'), ctr = vec(P.center, [0, 0, 0]), size = vec(P.size, [1, 1, 1]);
      const nrm = vec(P.normal, [0, 1, 0]), off = num(P.offset, 0), soft = Math.max(0.005, num(P.softness, 0.05)), edge = num(P.edge, 0.03), glow = num(P.glow, 2), ec = vec(P.edgeColor, [0.3, 0.8, 1]);
      const nl = Math.hypot(...nrm) || 1;
      for (const q of pts) {
        const d0: Vec3 = [q.p[0] - ctr[0], q.p[1] - ctr[1], q.p[2] - ctr[2]];
        let sd: number;
        if (shape === 'sphere') sd = Math.hypot(...d0) - (size[0] + off);
        else if (shape === 'box') sd = Math.max(Math.abs(d0[0]) - size[0], Math.abs(d0[1]) - size[1], Math.abs(d0[2]) - size[2]) - off;
        else sd = (d0[0] * nrm[0] + d0[1] * nrm[1] + d0[2] * nrm[2]) / nl - off;
        if (keep === 'outside') sd = -sd;
        const k = 1 - smooth(-soft, soft, sd);
        const band = edge > 0 ? 1 - smooth(0, edge, Math.abs(sd)) : 0;
        q.a *= k;
        q.c = [q.c[0] + ec[0] * band * glow * 0.3, q.c[1] + ec[1] * band * glow * 0.3, q.c[2] + ec[2] * band * glow * 0.3];
      }
      return;
    }
    case 'look': {
      const size = num(P.size, 1), op = num(P.opacity, 1), floor = num(P.floor, 0), keepShare = num(P.keep, 1);
      for (const q of pts) {
        q.s *= size;
        q.a = Math.max(q.a * op, floor * Math.sign(q.a));
        if (q.rand > keepShare) q.a = 0;
      }
      return;
    }
    case 'points': {
      if (num(P.on, 1) < 0.5) return;
      const solid = num(P.solid, 1);
      for (const q of pts) { q.dot = true; q.s *= num(P.dotSize, 2) / 2.2; q.a = q.a * (1 - solid) + Math.min(1, q.a * 4) * solid; }
      return;
    }
  }
}

/** The cloud with a stack of effects, at time `t`. */
export function cloudWith(base: readonly Pt[], effects: readonly EffectSpec[], t: number): Pt[] {
  const pts = base.map(q => ({ ...q, p: [...q.p] as Vec3, c: [...q.c] as Vec3 }));
  for (const e of effects) applyEffect(pts, e, t);
  return pts;
}
