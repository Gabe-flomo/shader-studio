// Generates an original landscape picture (ridges at dusk) as a 24-bit BMP.
import { writeFileSync } from 'node:fs';
const W = 960, H = 540;
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v) => Math.max(0, Math.min(1, v));
const px = new Float32Array(W * H * 3);
const sun = { x: 0.68, y: 0.36 };
// Ridges from far (light, hazy) to near (dark).
const ridges = [
  { base: 0.52, amp: 0.16, freq: 2.2, seed: 1, col: [0.72, 0.52, 0.62] },
  { base: 0.60, amp: 0.18, freq: 3.0, seed: 7, col: [0.50, 0.33, 0.48] },
  { base: 0.70, amp: 0.16, freq: 3.8, seed: 13, col: [0.30, 0.18, 0.32] },
  { base: 0.82, amp: 0.14, freq: 5.0, seed: 21, col: [0.14, 0.08, 0.16] },
];
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const x = i / W, y = j / H; // y down
    // Sky: warm at the horizon, deep blue above, with thin clouds.
    const t = clamp(y / 0.6);
    let r = mix(0.12, 1.0, t ** 1.6), g = mix(0.14, 0.62, t ** 1.8), b = mix(0.34, 0.46, t);
    const cl = clamp((fbm(x * 4 + 3, y * 14) - 0.55) * 3) * (1 - t) * 0.5;
    r = mix(r, 0.95, cl * 0.6); g = mix(g, 0.7, cl * 0.6); b = mix(b, 0.75, cl * 0.6);
    const dx = (x - sun.x) * (W / H), dy = y - sun.y, d = Math.hypot(dx, dy);
    const glow = Math.exp(-d * 6) * 0.9 + (d < 0.05 ? 1 : 0) * 0.8 + Math.exp(-d * 30) * 0.5;
    r += glow; g += glow * 0.8; b += glow * 0.45;
    for (const k of ridges) {
      const h = k.base - k.amp * (fbm(x * k.freq + k.seed, k.seed * 0.37) * 1.6 - 0.3);
      if (y > h) {
        const depth = clamp((y - h) * 6);
        const tex = fbm(x * 24 + k.seed, y * 24) * 0.1;
        const rim = Math.exp(-(y - h) * 180) * 0.35 * clamp(1 - Math.abs(x - sun.x) * 1.2);
        r = k.col[0] * (1 - depth * 0.35) + tex + rim; g = k.col[1] * (1 - depth * 0.35) + tex * 0.8 + rim * 0.7; b = k.col[2] * (1 - depth * 0.3) + tex * 0.9 + rim * 0.4;
      }
    }
    // Film grain.
    const n = (hash(i * 0.73, j * 1.31) - 0.5) * 0.015;
    const o = (j * W + i) * 3;
    px[o] = clamp(r + n); px[o + 1] = clamp(g + n); px[o + 2] = clamp(b + n);
  }
}
const row = W * 3, pad = (4 - (row % 4)) % 4, size = 54 + (row + pad) * H;
const buf = Buffer.alloc(size);
buf.write('BM', 0); buf.writeUInt32LE(size, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
buf.writeInt32LE(W, 18); buf.writeInt32LE(H, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE((row + pad) * H, 34);
let p = 54;
for (let j = H - 1; j >= 0; j--) {
  for (let i = 0; i < W; i++) { const o = (j * W + i) * 3; buf[p++] = Math.round(px[o + 2] * 255); buf[p++] = Math.round(px[o + 1] * 255); buf[p++] = Math.round(px[o] * 255); }
  p += pad;
}
writeFileSync(process.argv[2], buf);
