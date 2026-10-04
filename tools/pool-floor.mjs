// Generates an original picture (the floor of a swimming pool: small glazed tiles, a dark lane line,
// a few pebbles and dappled light) as a 24-bit BMP, for the Water example: refraction shows best on
// straight lines and fine detail. node tools/pool-floor.mjs out.bmp, then convert to JPEG.
import { writeFileSync } from 'node:fs';
const W = 960, H = 540;
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
const mix = (a, b, t) => a + (b - a) * t;
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const px = new Float32Array(W * H * 3);
const TILE = 27; // px per tile
const pebbles = Array.from({ length: 9 }, (_, i) => ({ x: 0.08 + hash(i, 3) * 0.84, y: 0.1 + hash(i, 9) * 0.8, r: 0.025 + hash(i, 5) * 0.03, s: hash(i, 7) }));
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const x = i / W, y = j / H; // y down
    const tx = Math.floor(i / TILE), ty = Math.floor(j / TILE);
    const fx = (i % TILE) / TILE, fy = (j % TILE) / TILE;
    // Each glazed tile its own shade of aqua; the grout between them pale.
    const k = hash(tx, ty);
    let r = mix(0.1, 0.2, k), g = mix(0.55, 0.7, k), b = mix(0.72, 0.85, k);
    // A dark blue lane line across the middle, and a stripe of darker tiles near the top.
    if (ty >= 9 && ty <= 10) { r = 0.05 + k * 0.04; g = 0.16 + k * 0.05; b = 0.42 + k * 0.08; }
    if (ty === 2) { r *= 0.6; g *= 0.75; }
    const grout = Math.max(smooth(0.9, 0.97, fx) + smooth(0.1, 0.03, fx), smooth(0.9, 0.97, fy) + smooth(0.1, 0.03, fy));
    r = mix(r, 0.86, grout * 0.85); g = mix(g, 0.92, grout * 0.85); b = mix(b, 0.92, grout * 0.85);
    // Pebbles lying on the floor, with a soft shadow.
    for (const p of pebbles) {
      const dx = (x - p.x) * (W / H), dy = y - p.y;
      const sd = Math.hypot(dx - 0.008, dy - 0.012) - p.r;
      if (sd < 0.01) { const sh = 1 - 0.35 * smooth(0.01, -0.005, sd); r *= sh; g *= sh; b *= sh; }
      const d = Math.hypot(dx, dy * (1.2 + p.s * 0.4)) - p.r;
      if (d < 0) {
        const lit = 0.75 + 0.35 * clamp(-(dx + dy) / p.r);
        const c = [mix(0.55, 0.8, p.s), mix(0.48, 0.68, p.s), mix(0.42, 0.6, p.s)].map(v => v * lit + (fbm(x * 90, y * 90) - 0.5) * 0.12);
        const e = smooth(0, -0.004, d);
        r = mix(r, c[0], e); g = mix(g, c[1], e); b = mix(b, c[2], e);
      }
    }
    // Dappled light from the surface, and a little more light toward the top.
    const dap = Math.pow(clamp(1 - Math.abs(fbm(x * 9, y * 9 + 4) * 2 - 1) * 3.2), 3) * 0.35;
    const light = 0.82 + 0.28 * (1 - y) + dap;
    const o = (j * W + i) * 3;
    const n = (hash(i * 0.73, j * 1.31) - 0.5) * 0.006;
    px[o] = clamp(r * light + n); px[o + 1] = clamp(g * light + n); px[o + 2] = clamp(b * light + n);
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
