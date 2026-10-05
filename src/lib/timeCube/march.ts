/**
 * Time Cube View's march (docs/time-cube.md, "How it is drawn"). Pure maths, no GL: the same
 * functions the view's GLSL writes out (nodes/definitions/timeCube.ts, `tcRayRoundBox`,
 * `tcCombNext`, `tcFreeFlight`), so the tests can check them. Kept in step with the GLSL by hand.
 *
 * - Where a ray meets the rounded box, exactly (not by sphere tracing, which runs out of steps on
 *   rays that skim a face and cut a wedge out of the box there).
 * - Where the next highlighted frame is along a ray, so the march can stop on it and draw it as a
 *   sheet at its own depth, not smeared over the steps either side of it.
 * - Where in a step to read the volume: near the step's start when it is nearly solid (so a solid
 *   face shows its surface, not a pixel or two inside it), anywhere in it when it is thin.
 */

type V3 = readonly number[];

/**
 * Where a ray (rd of unit length) first meets a box of half size `b` whose edges are rounded by
 * `r` (r ≤ min b): the distance along it, or -1 when it misses (or the box is behind it). After
 * Inigo Quilez's rounded-box intersection: the bounding box first; a hit on a flat face is the
 * answer, else the nearest of the corner sphere and the three edge cylinders, in the first octant.
 */
export function rayRoundBoxEnter(ro: V3, rd: V3, b: V3, r: number): number {
  const size = [b[0] - r, b[1] - r, b[2] - r];
  const m = rd.map(x => 1 / (Math.abs(x) < 1e-12 ? 1e-12 : x));
  let tN = -Infinity, tF = Infinity;
  for (let i = 0; i < 3; i++) {
    const n = m[i] * ro[i], k = Math.abs(m[i]) * b[i];
    tN = Math.max(tN, -n - k);
    tF = Math.min(tF, -n + k);
  }
  if (tN > tF || tF < 0) return -1;
  const s = [0, 1, 2].map(i => (ro[i] + tN * rd[i] >= 0 ? 1 : -1));
  const o = [0, 1, 2].map(i => ro[i] * s[i]);
  const d = [0, 1, 2].map(i => rd[i] * s[i]);
  const pos = [0, 1, 2].map(i => o[i] + tN * d[i] - size[i]);
  const mx = [Math.max(pos[0], pos[1]), Math.max(pos[1], pos[2]), Math.max(pos[2], pos[0])];
  if (Math.min(mx[0], mx[1], mx[2]) < 0) return tN;
  const oc = [o[0] - size[0], o[1] - size[1], o[2] - size[2]];
  const dd = d.map(x => x * x), oo = oc.map(x => x * x), od = [oc[0] * d[0], oc[1] * d[1], oc[2] * d[2]];
  const ra2 = r * r;
  let t = 1e20;
  {
    const bb = od[0] + od[1] + od[2], c = oo[0] + oo[1] + oo[2] - ra2, h = bb * bb - c;
    if (h > 0) t = -bb - Math.sqrt(h);
  }
  for (let ax = 0; ax < 3; ax++) {
    const j = (ax + 1) % 3, k = (ax + 2) % 3;
    const a = dd[j] + dd[k], bb = od[j] + od[k], c = oo[j] + oo[k] - ra2;
    let h = bb * bb - a * c;
    if (h > 0 && a > 1e-12) {
      h = (-bb - Math.sqrt(h)) / a;
      if (h > 0 && h < t && Math.abs(o[ax] + d[ax] * h) < size[ax]) t = h;
    }
  }
  return t > 1e19 ? -1 : t;
}

/** Where a ray goes into and comes out of the rounded box: [enter, exit] (enter 0 from inside), or null. */
export function rayRoundBox(ro: V3, rd: V3, b: V3, r: number): [number, number] | null {
  // The far side: the same test from beyond the box, looking back.
  let far = Infinity;
  for (let i = 0; i < 3; i++) {
    const inv = 1 / (Math.abs(rd[i]) < 1e-12 ? 1e-12 : rd[i]);
    far = Math.min(far, Math.max((-b[i] - ro[i]) * inv, (b[i] - ro[i]) * inv));
  }
  if (!(far > 0)) return null;
  const T = far + 1;
  const back = rayRoundBoxEnter([ro[0] + rd[0] * T, ro[1] + rd[1] * T, ro[2] + rd[2] * T], [-rd[0], -rd[1], -rd[2]], b, r);
  if (back < 0) return null;
  const exit = T - back;
  if (exit <= 0) return null;
  const enter = rayRoundBoxEnter(ro, rd, b, r);
  return [enter < 0 ? 0 : enter, exit];
}

/**
 * The next highlighted frame after box time g going `dir` (+1 later, −1 earlier), strictly beyond g;
 * Infinity (or −Infinity) when there is none. hl = (start, spacing, count, loop): Count frames
 * Spacing apart from Start; looping, the comb repeats every whole box (GLSL tcCombNext).
 */
export function combNext(g: number, dir: number, hl: readonly [number, number, number, number]): number {
  const S = Math.max(hl[1], 1e-4), n = Math.max(Math.floor(hl[2] + 0.5), 1);
  const one = (base: number) => {
    const x = (g - base) / S;
    // Rounding can land k on the frame at g itself: then step on to the next (strictly beyond g).
    if (dir > 0) {
      let k = Math.max(Math.floor(x) + 1, 0);
      if (base + k * S <= g) k++;
      return k > n - 1 ? Infinity : base + k * S;
    }
    let k = Math.min(Math.ceil(x) - 1, n - 1);
    if (base + k * S >= g) k--;
    return k < 0 ? -Infinity : base + k * S;
  };
  if (hl[3] < 0.5) return one(hl[0]);
  const m0 = Math.floor(g - hl[0]);
  let best = dir > 0 ? Infinity : -Infinity;
  for (let m = -1; m <= 1; m++) {
    const c = one(hl[0] + m0 + m);
    if (dir > 0 ? c < best : c > best) best = c;
  }
  return best;
}

/**
 * Where in a step of length `len` to read the volume, as a distance from its start: a free flight
 * through a medium of density `sigma` (so many optical depths per unit length), at random number j
 * (0–1). Thin: anywhere in the step, evenly. Solid: right at its start (GLSL tcFreeFlight).
 */
export function freeFlight(j: number, sigma: number, len: number): number {
  const tau = sigma * len;
  if (tau < 1e-4) return j * len;
  return Math.min(-Math.log(1 - j * (1 - Math.exp(-tau))) / sigma, len);
}
