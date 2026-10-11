/**
 * agentSplats.ts — Draw agents' Splats look, in plain JS (docs/splat-scene.md "Agents as splats"). The GLSL is
 * kit/agentShaders.js AG_SPLAT_VERT / AG_SPLAT_FRAG / AG_SPLAT_RESOLVE_FRAG; these mirror it for the tests and the
 * runner's settings. Pure.
 */
import { SPLAT_SIZE_BY } from '../nodes/definitions/agents';

/** Size by as the shader's u_sizeBy: 0 fixed, 1 speed, 2–5 More memory x, y, z, w. */
export function splatSizeByIndex(v: unknown): number {
  const i = (SPLAT_SIZE_BY as readonly unknown[]).indexOf(v);
  return i < 0 ? 0 : i;
}

export interface WalkerSplatLook {
  splatSize: number;
  stretch: number;
  sizeBy: number;
  memScale: number;
  speedRef: number;
}

/** A walker's sigma across its motion and along it (picture units); [0, 0] when it has no size. */
export function walkerSigmas(look: WalkerSplatLook, speed: number, mem: readonly number[] = [0, 0, 0, 0]): [number, number] {
  const fast = speed / Math.max(look.speedRef, 1e-4);
  let s0 = look.splatSize;
  if (look.sizeBy === 1) s0 *= 0.35 + 0.65 * Math.min(fast, 3);
  else if (look.sizeBy >= 2) s0 = Math.max(mem[look.sizeBy - 2] ?? 0, 0) * look.memScale;
  if (!(s0 > 1e-6)) return [0, 0];
  return [s0, s0 * (1 + Math.max(look.stretch, 0) * Math.min(fast, 4))];
}

/** Σ = s0² I + (s1² − s0²) d dᵀ (row-major 3 × 3), d the unit direction of the velocity. */
export function walkerCovariance(vel: readonly number[], s0: number, s1: number): number[] {
  const sp = Math.hypot(vel[0], vel[1], vel[2] ?? 0);
  const d = sp > 1e-7 ? [vel[0] / sp, vel[1] / sp, (vel[2] ?? 0) / sp] : [1, 0, 0];
  const k = s1 * s1 - s0 * s0;
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push((r === c ? s0 * s0 : 0) + k * d[r] * d[c]);
  return out;
}

/**
 * The 2D splat's ellipse in pixels on a picture `viewH` high (2 picture units tall): the covariance (with the 0.3 px²
 * low-pass) and the quad's half axes √(2λ) (major first), as the shader spans them.
 */
export function walkerEllipse2d(cov: readonly number[], viewH: number): { a: number; b: number; c: number; major: [number, number]; minor: [number, number] } {
  const k = 0.5 * viewH;
  const a = k * k * cov[0] + 0.3, b = k * k * cov[1], c = k * k * cov[4] + 0.3;
  const mid = 0.5 * (a + c), rad = Math.hypot(0.5 * (a - c), b);
  const l1 = mid + rad, l2 = Math.max(mid - rad, 0.1);
  let dv = [b, l1 - a];
  const dl = Math.hypot(dv[0], dv[1]);
  dv = dl > 1e-12 ? [dv[0] / dl, dv[1] / dl] : (a >= c ? [1, 0] : [0, 1]);
  const M = Math.min(Math.sqrt(2 * l1), 512), m = Math.min(Math.sqrt(2 * l2), 512);
  return { a, b, c, major: [M * dv[0], M * dv[1]], minor: [m * dv[1], -m * dv[0]] };
}

/** One splat's share at a pixel: its colour, its alpha there, its depth weight and distance. */
export interface SplatFragment { rgb: [number, number, number]; alpha: number; w: number; dist: number }

/**
 * The two targets after every fragment, in any order (sums and a product), resolved as AG_SPLAT_RESOLVE_FRAG does:
 * the weighted mean colour × its cover, the cover 1 − Π(1 − α), and the distance Σαwd / Σαw (far where none).
 */
export function splatResolve(frags: readonly SplatFragment[]): { rgb: [number, number, number]; alpha: number; dist: number } {
  let r = 0, g = 0, b = 0, aw = 0, awd = 0, reveal = 1;
  for (const f of frags) {
    const a = Math.min(0.99, f.alpha);
    if (a < 1 / 1024) continue;
    const x = a * f.w;
    r += f.rgb[0] * x; g += f.rgb[1] * x; b += f.rgb[2] * x;
    aw += x; awd += x * f.dist;
    reveal *= 1 - a;
  }
  const cover = Math.min(1, Math.max(0, 1 - reveal));
  const k = aw > 1e-6 ? cover / aw : 0;
  return { rgb: [r * k, g * k, b * k], alpha: cover, dist: aw > 1e-6 ? awd / aw : 1e5 };
}

/** The depth weight a 3D splat at depth z gets (camera distance cd): (cd / z)⁴, kept in 0.01–100. */
export const splatDepthWeight = (z: number, cd: number) => Math.min(100, Math.max(0.01, (cd / Math.max(z, 1e-3)) ** 4));
