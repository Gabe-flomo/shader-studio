/**
 * Guided Convert, the pixel check on the CPU (docs/guided-convert.md, "Recognised patterns"): a built
 * graph's compiled shader against the original, run by the small GLSL interpreter (cpuGlsl.ts) on a
 * grid of pixels at two moments. It decides whether a recognised pattern whose library node isn't the
 * same arithmetic (a Palette's 6.28318 against the shader's 6.2831853, the FBM node's own noise) is
 * offered: only when the picture stays the same. The page's GPU check (RenderPair) still runs after.
 */
import { CpuShader, type CpuInputs } from './cpuGlsl';
import type { Analysis } from './analyse';
import type { GuidedBuild } from './build';

/** Same picture: no colour component further apart than this (1.5 of 255). */
export const SAME = 1.5 / 255;

const RES: [number, number] = [96, 72];
const MOMENTS = [1.3, 4.7];
const GRID: [number, number] = [8, 6];

type Value = number | number[];

/** Sample two compiled programs; the largest difference of any colour component, Infinity when only one discards. */
function difference(A: CpuShader, B: CpuShader, ua: Record<string, Value>, ub: Record<string, Value>, budgetMs: number): number | null {
  const t0 = performance.now();
  let max = 0;
  for (const time of MOMENTS) {
    for (let j = 0; j < GRID[1]; j++) for (let i = 0; i < GRID[0]; i++) {
      const p: [number, number] = [(i + 0.5) * RES[0] / GRID[0], (j + 0.5) * RES[1] / GRID[1]];
      const base: CpuInputs = { resolution: RES, time, mouse: [RES[0] * 0.3, RES[1] * 0.6] };
      const ca = A.run(p, { ...base, uniforms: ua }), cb = B.run(p, { ...base, uniforms: ub });
      if (!ca || !cb) { if (ca !== cb) return Infinity; continue; }
      for (let k = 0; k < 4; k++) {
        if (Number.isNaN(ca[k]) || Number.isNaN(cb[k])) { if (Number.isNaN(ca[k]) !== Number.isNaN(cb[k])) return Infinity; continue; }
        // Both past the ends of the display range show the same.
        const x = Math.min(1, Math.max(0, ca[k])), y = Math.min(1, Math.max(0, cb[k]));
        max = Math.max(max, Math.abs(x - y));
      }
      if (performance.now() - t0 > budgetMs) return null;
    }
  }
  return max;
}

const programs = new Map<string, CpuShader | null>();
function program(code: string): CpuShader | null {
  if (programs.has(code)) return programs.get(code)!;
  let p: CpuShader | null = null;
  try { p = new CpuShader(code); } catch { p = null; }
  if (programs.size > 64) programs.clear();
  programs.set(code, p);
  return p;
}

/**
 * How far a graph's picture is from another's (or from the original shader's), 0 to 1; null when the
 * interpreter can't run one of them (a texture, a mat3, a loop too long for the time budget).
 */
export function graphDifference(a: Analysis, built: GuidedBuild, against?: GuidedBuild, budgetMs = 400): number | null {
  if (!built.compiled) return null;
  const B = program(built.compiled.fragmentShader);
  const A = against ? (against.compiled ? program(against.compiled.fragmentShader) : null) : program(a.norm);
  if (!A || !B) return null;
  const ua: Record<string, Value> = against ? { ...against.compiled!.paramUniforms } : Object.fromEntries((built.report.uniforms ?? []).map(u => [u.name, u.value]));
  try { return difference(A, B, ua, { ...built.compiled.paramUniforms }, budgetMs); } catch { return null; }
}
