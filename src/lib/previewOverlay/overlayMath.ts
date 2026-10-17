/**
 * The preview Overlay's maths (docs: the Overlay button over the main preview): a coarse vec2 field
 * read back from the picture's shader is turned into a labelled grid of its real values (iso-lines
 * by marching squares) and, for the Position mode, the screen point where the field takes a value.
 *
 * Conventions: a field is `w × h` texels, two numbers per texel (x, y), row 0 at the BOTTOM (GL
 * order). Screen positions are (u, v) in 0…1, u left → right, v bottom → top; texel (i, j) sits at
 * ((i + 0.5) / w, (j + 0.5) / h).
 */

export interface Field2 {
  /** x, y per texel, row-major from the bottom row. */
  data: Float32Array;
  w: number;
  h: number;
}

/** The app's plain UV (the UV node): centred, −aspect…aspect across, −1…1 up (sources.ts UVNode). */
export function plainUvField(w: number, h: number, aspect: number): Field2 {
  const data = new Float32Array(w * h * 2);
  for (let j = 0; j < h; j++) {
    const y = ((j + 0.5) / h - 0.5) * 2;
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 2;
      data[o] = ((i + 0.5) / w - 0.5) * 2 * aspect;
      data[o + 1] = y;
    }
  }
  return { data, w, h };
}

/** Warp blend: 0 = the plain field, 1 = the chosen space, linearly between (same size fields). */
export function blendFields(plain: Field2, space: Field2, t: number, out?: Float32Array): Field2 {
  const n = space.w * space.h * 2;
  const data = out && out.length === n ? out : new Float32Array(n);
  if (t >= 1) data.set(space.data.subarray(0, n));
  else if (t <= 0) data.set(plain.data.subarray(0, n));
  else for (let k = 0; k < n; k++) data[k] = plain.data[k] + (space.data[k] - plain.data[k]) * t;
  return { data, w: space.w, h: space.h };
}

/**
 * A grid spacing for a value range: 1, 2.5 or 5 × 10ⁿ (so 1, 0.5, 0.25, 0.1…) giving about `target`
 * lines; for wide ranges (pixel spaces such as fragCoord) 1 or 5 × 10ⁿ only (10, 50, 100…).
 */
export function gridStep(min: number, max: number, target = 8): number {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  if (span >= 20) return (n < 2.2 ? 1 : n < 7 ? 5 : 10) * mag;
  return (n < 1.6 ? 1 : n < 3.5 ? 2.5 : n < 7 ? 5 : 10) * mag;
}

export interface FieldRange { minX: number; maxX: number; minY: number; maxY: number; finite: number }

/** The 1st…99th percentile range of each component (a few wild texels don't blow the step up). */
export function fieldRange(f: Field2): FieldRange {
  const xs: number[] = [], ys: number[] = [];
  const n = f.w * f.h;
  const stride = Math.max(1, Math.floor(n / 4000));
  for (let k = 0; k < n; k += stride) {
    const x = f.data[k * 2], y = f.data[k * 2 + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
  }
  if (!xs.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1, finite: 0 };
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  return { minX: q(xs, 0.01), maxX: q(xs, 0.99), minY: q(ys, 0.01), maxY: q(ys, 0.99), finite: xs.length };
}

/** The steps for x and y: shared (a square grid) unless one axis would get fewer than 3 lines. */
export function gridSteps(r: FieldRange, target = 8): { sx: number; sy: number } {
  const spanX = r.maxX - r.minX, spanY = r.maxY - r.minY;
  const s = gridStep(0, Math.max(spanX, spanY), target);
  const sx = spanX / s < 3 ? gridStep(r.minX, r.maxX, 4) : s;
  const sy = spanY / s < 3 ? gridStep(r.minY, r.maxY, 4) : s;
  return { sx, sy };
}

/** The levels k·step inside [min, max], at most `cap` of them (the step doubles until they fit). */
export function gridLevels(min: number, max: number, step: number, cap = 60): { levels: number[]; step: number } {
  if (!(step > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return { levels: [], step };
  while ((max - min) / step > cap) step *= 2;
  const out: number[] = [];
  for (let k = Math.ceil(min / step); k * step <= max; k++) out.push(roundTo(k * step, step));
  return { levels: out, step };
}

const roundTo = (v: number, step: number) => {
  const d = Math.max(0, -Math.floor(Math.log10(step)) + 3);
  const r = Number(v.toFixed(Math.min(12, d)));
  return Object.is(r, -0) ? 0 : r;
};

/** A level as a short label: 0.25, −1, 120 (no trailing noise). */
export function formatLevel(v: number, step: number): string {
  let d = 0;
  while (d < 6 && Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) > 1e-6 * 10 ** d) d++;
  let s = v.toFixed(d);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s.replace('-', '−');
}

/**
 * One component of the field, padded by a ring extrapolated to the frame's edges, so iso-lines
 * reach the border: column 0 sits at u = 0, column w + 1 at u = 1 (likewise rows).
 */
export interface Padded { g: Float32Array; w: number; h: number; us: Float32Array; vs: Float32Array }

export function padComponent(f: Field2, c: 0 | 1): Padded {
  const W = f.w + 2, H = f.h + 2;
  const g = new Float32Array(W * H);
  const at = (i: number, j: number) => f.data[(j * f.w + i) * 2 + c];
  const ext = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) ? 1.5 * a - 0.5 * b : a);
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) g[(j + 1) * W + i + 1] = at(i, j);
  for (let j = 1; j <= f.h; j++) {
    g[j * W] = f.w > 1 ? ext(g[j * W + 1], g[j * W + 2]) : g[j * W + 1];
    g[j * W + W - 1] = f.w > 1 ? ext(g[j * W + W - 2], g[j * W + W - 3]) : g[j * W + W - 2];
  }
  for (let i = 0; i < W; i++) {
    g[i] = f.h > 1 ? ext(g[W + i], g[2 * W + i]) : g[W + i];
    g[(H - 1) * W + i] = f.h > 1 ? ext(g[(H - 2) * W + i], g[(H - 3) * W + i]) : g[(H - 2) * W + i];
  }
  const us = new Float32Array(W), vs = new Float32Array(H);
  for (let i = 0; i < W; i++) us[i] = i === 0 ? 0 : i === W - 1 ? 1 : (i - 0.5) / f.w;
  for (let j = 0; j < H; j++) vs[j] = j === 0 ? 0 : j === H - 1 ? 1 : (j - 0.5) / f.h;
  return { g, w: W, h: H, us, vs };
}

/**
 * Marching squares: the segments where the padded component equals `level`, as flat
 * [u0, v0, u1, v1, …]. Cells spanning more than `jump` (a fract()/mod() seam, not a slope) and
 * cells with a non-finite corner are skipped.
 */
export function isoSegments(p: Padded, level: number, jump = Infinity): number[] {
  const out: number[] = [];
  const { g, w, us, vs } = p;
  for (let j = 0; j < p.h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = g[j * w + i], b = g[j * w + i + 1], c = g[(j + 1) * w + i + 1], d = g[(j + 1) * w + i];
      if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
      const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      if (level < lo || level > hi || lo === hi || hi - lo > jump) continue;
      const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const u0 = us[i], u1 = us[i + 1], v0 = vs[j], v1 = vs[j + 1];
      const lerp = (x: number, y: number) => (y === x ? 0.5 : (level - x) / (y - x));
      // Edge crossings: bottom (a→b), right (b→c), top (d→c), left (a→d)
      const B = (): [number, number] => [u0 + (u1 - u0) * lerp(a, b), v0];
      const R = (): [number, number] => [u1, v0 + (v1 - v0) * lerp(b, c)];
      const T = (): [number, number] => [u0 + (u1 - u0) * lerp(d, c), v1];
      const L = (): [number, number] => [u0, v0 + (v1 - v0) * lerp(a, d)];
      const seg = (p0: [number, number], p1: [number, number]) => out.push(p0[0], p0[1], p1[0], p1[1]);
      switch (code) {
        case 1: case 14: seg(L(), B()); break;
        case 2: case 13: seg(B(), R()); break;
        case 3: case 12: seg(L(), R()); break;
        case 4: case 11: seg(R(), T()); break;
        case 6: case 9: seg(B(), T()); break;
        case 7: case 8: seg(L(), T()); break;
        case 5: case 10: {
          // Saddle: the centre's side decides which corners join
          const centre = (a + b + c + d) / 4 >= level;
          if ((code === 5) === centre) { seg(L(), T()); seg(B(), R()); } else { seg(L(), B()); seg(R(), T()); }
          break;
        }
      }
    }
  }
  return out;
}

export interface GridLine { axis: 'x' | 'y'; level: number; segs: number[]; major: boolean }

/** The whole grid for a field: x = const and y = const lines at nice steps; the 0 lines are major. */
export function gridLines(f: Field2, target = 8): { lines: GridLine[]; sx: number; sy: number; range: FieldRange } {
  const range = fieldRange(f);
  const st = gridSteps(range, target);
  const lines: GridLine[] = [];
  const doAxis = (c: 0 | 1, min: number, max: number, step0: number) => {
    const { levels, step } = gridLevels(min - step0 * 1.5, max + step0 * 1.5, step0);
    const p = padComponent(f, c);
    for (const lv of levels) {
      const segs = isoSegments(p, lv, step * 3);
      if (segs.length) lines.push({ axis: c === 0 ? 'x' : 'y', level: lv, segs, major: lv === 0 });
    }
    return step;
  };
  const sx = doAxis(0, range.minX, range.maxX, st.sx);
  const sy = doAxis(1, range.minY, range.maxY, st.sy);
  return { lines, sx, sy, range };
}

export interface EdgeLabel { u: number; v: number; text: string; axis: 'x' | 'y'; edge: 'left' | 'right' | 'top' | 'bottom' | 'inside'; major: boolean }

/**
 * Where to write each line's value: where it meets the frame (x lines prefer the bottom and top
 * edges, y lines the left and right), else at the middle of its first segment.
 */
export function edgeLabels(lines: GridLine[], sx: number, sy: number): EdgeLabel[] {
  const out: EdgeLabel[] = [];
  const E = 1e-4;
  for (const ln of lines) {
    const text = formatLevel(ln.level, ln.axis === 'x' ? sx : sy);
    const found: EdgeLabel[] = [];
    for (let k = 0; k < ln.segs.length; k += 2) {
      const u = ln.segs[k], v = ln.segs[k + 1];
      const edge = v <= E ? 'bottom' : v >= 1 - E ? 'top' : u <= E ? 'left' : u >= 1 - E ? 'right' : null;
      if (edge && !found.some(l => l.edge === edge && Math.abs(l.u - u) + Math.abs(l.v - v) < 0.02)) found.push({ u, v, text, axis: ln.axis, edge, major: ln.major });
    }
    const pref = ln.axis === 'x' ? ['bottom', 'top', 'left', 'right'] : ['left', 'right', 'bottom', 'top'];
    found.sort((a, b) => pref.indexOf(a.edge) - pref.indexOf(b.edge));
    if (found.length) out.push(found[0]);
    else if (ln.segs.length >= 4) out.push({ u: (ln.segs[0] + ln.segs[2]) / 2, v: (ln.segs[1] + ln.segs[3]) / 2, text, axis: ln.axis, edge: 'inside', major: ln.major });
  }
  return out;
}

/** Axis-aligned boxes; greedy: a label whose box overlaps an earlier one is dropped. */
export function declutter<T extends { box: [number, number, number, number] }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const it of items) {
    const [x, y, w, h] = it.box;
    if (kept.some(k => x < k.box[0] + k.box[2] && x + w > k.box[0] && y < k.box[1] + k.box[3] && y + h > k.box[1])) continue;
    kept.push(it);
  }
  return kept;
}

// ── Position lookup ──────────────────────────────────────────────────────────

/** The field at a screen point by bilinear interpolation, extrapolated linearly beyond the texel centres. */
export function sampleBilinear(f: Field2, u: number, v: number): [number, number] {
  const fx = u * f.w - 0.5, fy = v * f.h - 0.5;
  const i0 = f.w > 1 ? Math.max(0, Math.min(f.w - 2, Math.floor(fx))) : 0;
  const j0 = f.h > 1 ? Math.max(0, Math.min(f.h - 2, Math.floor(fy))) : 0;
  const i1 = Math.min(f.w - 1, i0 + 1), j1 = Math.min(f.h - 1, j0 + 1);
  const tx = f.w > 1 ? fx - i0 : 0, ty = f.h > 1 ? fy - j0 : 0;
  const r: [number, number] = [0, 0];
  for (let c = 0; c < 2; c++) {
    const a = f.data[(j0 * f.w + i0) * 2 + c], b = f.data[(j0 * f.w + i1) * 2 + c];
    const d = f.data[(j1 * f.w + i0) * 2 + c], e = f.data[(j1 * f.w + i1) * 2 + c];
    r[c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
  }
  return r;
}

export interface Located {
  /** Screen point (may lie outside 0…1 when the value is off-screen). */
  u: number; v: number;
  onScreen: boolean;
  /** False when the space never comes close to the value (a warp that can't reach it). */
  found: boolean;
}

/**
 * The screen point where the field equals `p`: the nearest texel, then Newton steps on the
 * bilinear field (exact for a plain or affine space, also off-screen by extrapolation).
 */
export function locateValue(f: Field2, p: [number, number]): Located {
  let best = -1, bestD = Infinity;
  for (let k = 0; k < f.w * f.h; k++) {
    const dx = f.data[k * 2] - p[0], dy = f.data[k * 2 + 1] - p[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = k; }
  }
  if (best < 0) return { u: 0.5, v: 0.5, onScreen: false, found: false };
  let u = ((best % f.w) + 0.5) / f.w, v = (Math.floor(best / f.w) + 0.5) / f.h;
  const hu = 1 / f.w, hv = 1 / f.h;
  for (let it = 0; it < 12; it++) {
    const F = sampleBilinear(f, u, v);
    const rx = p[0] - F[0], ry = p[1] - F[1];
    const Fu = sampleBilinear(f, u + hu * 0.5, v), Fu0 = sampleBilinear(f, u - hu * 0.5, v);
    const Fv = sampleBilinear(f, u, v + hv * 0.5), Fv0 = sampleBilinear(f, u, v - hv * 0.5);
    const a = (Fu[0] - Fu0[0]) / hu, c = (Fu[1] - Fu0[1]) / hu;
    const b = (Fv[0] - Fv0[0]) / hv, d = (Fv[1] - Fv0[1]) / hv;
    const det = a * d - b * c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    let du = (d * rx - b * ry) / det, dv = (a * ry - c * rx) / det;
    // Inside the picture keep each step within a couple of cells (a warp's Newton can overshoot)
    const lim = 4 * Math.max(hu, hv);
    const inside = u > 0 && u < 1 && v > 0 && v < 1;
    const m = Math.hypot(du, dv);
    if (inside && m > lim && bestD > 0) { du *= lim / m; dv *= lim / m; }
    u += du; v += dv;
    if (Math.hypot(du / hu, dv / hv) < 1e-4) break;
  }
  const F = sampleBilinear(f, u, v);
  // "Found": the residual is small next to the field's change across a cell
  const Fn = sampleBilinear(f, u + hu, v + hv);
  const cell = Math.hypot(Fn[0] - F[0], Fn[1] - F[1]) || 1e-6;
  const res = Math.hypot(p[0] - F[0], p[1] - F[1]);
  const found = Number.isFinite(u) && Number.isFinite(v) && res < cell * 0.75;
  return { u, v, onScreen: found && u >= 0 && u <= 1 && v >= 0 && v <= 1, found };
}

/** An off-screen point's arrow: the point on the frame towards it from the centre (inset by `pad`, 0…0.5). */
export function edgePoint(u: number, v: number, pad = 0.04): { u: number; v: number; angle: number } {
  const dx = u - 0.5, dy = v - 0.5;
  const s = Math.min(Math.abs(dx) > 1e-9 ? (0.5 - pad) / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? (0.5 - pad) / Math.abs(dy) : Infinity);
  return { u: 0.5 + dx * s, v: 0.5 + dy * s, angle: Math.atan2(dy, dx) };
}
