/**
 * subset.ts — Max splats: a scan thinned to at most `max` splats, evenly through the file (not just its first part,
 * which tools often order by place or size), each kept splat as it was.
 */
import { shCoeffs, type SplatData } from './format';

export function subsetSplats(d: SplatData, max: number): SplatData {
  const m = Math.floor(max);
  if (!(m > 0) || d.count <= m) return d;
  const K = shCoeffs(d.shDegree);
  const positions = new Float32Array(m * 3), scales = new Float32Array(m * 3), rotations = new Float32Array(m * 4), colors = new Uint8Array(m * 4);
  const sh = d.sh ? new Float32Array(m * K * 3) : undefined;
  const step = d.count / m;
  for (let j = 0; j < m; j++) {
    const i = Math.min(d.count - 1, Math.floor(j * step));
    positions.set(d.positions.subarray(i * 3, i * 3 + 3), j * 3);
    scales.set(d.scales.subarray(i * 3, i * 3 + 3), j * 3);
    rotations.set(d.rotations.subarray(i * 4, i * 4 + 4), j * 4);
    colors.set(d.colors.subarray(i * 4, i * 4 + 4), j * 4);
    if (sh && d.sh) sh.set(d.sh.subarray(i * K * 3, (i + 1) * K * 3), j * K * 3);
  }
  return { ...d, count: m, positions, scales, rotations, colors, ...(sh ? { sh } : {}) };
}
