/**
 * Synthetic scans for the tests (nothing downloaded): a ring of coloured Gaussians, generated.
 */
import type { SplatData } from '../format';

/**
 * `n` splats on a ring of radius `r` in the x–z plane, centred on `center`: hue round the ring, each splat a flat
 * ellipsoid (scales 0.08, 0.02, 0.05) turned to follow the ring, opacity 0.9. With `shDegree` > 0 the harmonics are
 * small known values (coefficient j of channel c of splat i: ((i + j + c) % 7 − 3) / 10).
 */
export function ringScan(n = 24, r = 1, center: [number, number, number] = [0, 0, 0], shDegree = 0): SplatData {
  const K = shDegree <= 0 ? 0 : (shDegree + 1) ** 2 - 1;
  const positions = new Float32Array(n * 3), scales = new Float32Array(n * 3), rotations = new Float32Array(n * 4), colors = new Uint8Array(n * 4);
  const sh = K ? new Float32Array(n * K * 3) : undefined;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    positions[i * 3] = center[0] + r * Math.cos(a);
    positions[i * 3 + 1] = center[1];
    positions[i * 3 + 2] = center[2] + r * Math.sin(a);
    scales[i * 3] = 0.08; scales[i * 3 + 1] = 0.02; scales[i * 3 + 2] = 0.05;
    // Turned about y by −a (w, x, y, z).
    rotations[i * 4] = Math.cos(-a / 2); rotations[i * 4 + 2] = Math.sin(-a / 2);
    const h = i / n;
    colors[i * 4] = Math.round(255 * (0.5 + 0.5 * Math.cos(2 * Math.PI * h)));
    colors[i * 4 + 1] = Math.round(255 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (h - 1 / 3))));
    colors[i * 4 + 2] = Math.round(255 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (h - 2 / 3))));
    colors[i * 4 + 3] = 230;
    if (sh) for (let j = 0; j < K; j++) for (let c = 0; c < 3; c++) sh[(i * K + j) * 3 + c] = (((i + j + c) % 7) - 3) / 10;
  }
  return { count: n, positions, scales, rotations, colors, shDegree: K ? shDegree : 0, ...(sh ? { sh } : {}), format: 'ply' };
}
