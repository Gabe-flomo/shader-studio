/**
 * demo.ts — a generated scan (no file): two interlocking rings of coloured Gaussians, for the example graph and for
 * timing (a Splat Scene with params.demo = 'rings' and params.demoCount draws it; docs/splat-scene.md).
 *
 * In the 3DGS convention (y down), like a real scan, so "Up is: −Y" shows it the right way up.
 */
import type { SplatData } from './format';

/** A small fast hash in [0, 1). */
const hash = (i: number, k: number) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

export const DEMO_RING = { radius: 0.8, tube: 0.14 };

/**
 * `count` splats on two tori: one flat (in x–z), one standing (in x–y, moved 0.8 along x so they link). Each splat
 * sits on the tube's surface, flattened along its normal (a surfel, as trained scans are), hue round the ring.
 */
export function demoRings(count: number): SplatData {
  const n = Math.max(1, Math.floor(count));
  const positions = new Float32Array(n * 3), scales = new Float32Array(n * 3), rotations = new Float32Array(n * 4), colors = new Uint8Array(n * 4);
  const { radius: R, tube: r } = DEMO_RING;
  // Surface area of both tori over n splats: each splat's footprint.
  const area = 2 * (4 * Math.PI * Math.PI * R * r);
  const s = Math.sqrt(area / n) * 0.85;
  for (let i = 0; i < n; i++) {
    const second = i % 2 === 1;
    const u = hash(i, 1) * Math.PI * 2, v = hash(i, 2) * Math.PI * 2;
    // Torus in its own frame (ring in x–z), then the second one stood up in x–y and moved along x.
    const cx = Math.cos(u), sx = Math.sin(u);
    const nx = Math.cos(v) * cx, ny = Math.sin(v), nz = Math.cos(v) * sx;
    let px = (R + r * Math.cos(v)) * cx, py = r * Math.sin(v), pz = (R + r * Math.cos(v)) * sx;
    const qx = nx;
    let qy = ny, qz = nz;
    if (second) { [px, py, pz] = [px + R, pz, -py]; [qy, qz] = [qz, -qy]; }
    positions[i * 3] = px; positions[i * 3 + 1] = py; positions[i * 3 + 2] = pz;
    // Flat along the normal: rotate z onto the normal (shortest arc), scales (s, s, s / 5).
    const dot = qz, w = 1 + dot;
    let rw = w, rx = -qy, ry = qx, rz = 0;
    if (w < 1e-6) { rw = 0; rx = 1; ry = 0; rz = 0; }
    const l = Math.hypot(rw, rx, ry, rz);
    rotations[i * 4] = rw / l; rotations[i * 4 + 1] = rx / l; rotations[i * 4 + 2] = ry / l; rotations[i * 4 + 3] = rz / l;
    scales[i * 3] = s; scales[i * 3 + 1] = s; scales[i * 3 + 2] = s / 5;
    const h = u / (Math.PI * 2) + (second ? 0.5 : 0);
    const shade = 0.75 + 0.25 * ny;
    colors[i * 4] = Math.round(255 * shade * (0.5 + 0.5 * Math.cos(2 * Math.PI * h)));
    colors[i * 4 + 1] = Math.round(255 * shade * (0.5 + 0.5 * Math.cos(2 * Math.PI * (h - 1 / 3))));
    colors[i * 4 + 2] = Math.round(255 * shade * (0.5 + 0.5 * Math.cos(2 * Math.PI * (h - 2 / 3))));
    colors[i * 4 + 3] = 235;
  }
  return { count: n, positions, scales, rotations, colors, shDegree: 0, format: 'splat' };
}
