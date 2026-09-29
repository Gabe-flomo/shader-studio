/**
 * macros.js — a rack's Macro Controls (docs/audio-engine.md, "Macros"): the
 * maths from a macro's value (0..1) to each of its targets' values, through
 * the target's curve and then its range. The logic both the app
 * (play/rackMacros.ts, lib/audioEngineHost.ts, the renders) and the web
 * runtime (runtime/play-runtime.js, through the inlined kit as SSKit.macros)
 * run, so a macro turns a parameter the same everywhere.
 *
 *   mcCurve        0..1 → 0..1 through a curve: linear, exp (x²), log (√x) as
 *                  the mappings have them (lib/playEngine.ts applyCurve),
 *                  scurve (smoothstep), or custom breakpoints joined by a
 *                  monotone cubic (Fritsch–Carlson: never overshoots, so the
 *                  line never leaves its neighbours' values)
 *   mcTargetValue  a macro's value → one target's value: min + (max − min) ·
 *                  curve(v); min above max inverts it
 *
 * Top-level names start with `mc` (the kit's files share one scope in exports).
 */

/** The most breakpoints a custom curve keeps. */
export const MC_POINTS_MAX = 16;

const mcClamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

/** A monotone cubic through (xs, ys) at x; held flat past the ends. */
function mcMonotone(xs, ys, x) {
  const n = xs.length;
  if (n === 0) return x;
  if (n === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  const d = [];
  for (let i = 0; i < n - 1; i++) { const h = xs[i + 1] - xs[i]; d.push(h > 0 ? (ys[i + 1] - ys[i]) / h : 0); }
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let k = 0;
  while (k < n - 2 && x > xs[k + 1]) k++;
  const h = xs[k + 1] - xs[k];
  if (!(h > 0)) return ys[k + 1];
  const t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
}

/** 0..1 → 0..1 through `curve`; `points` (custom): flat [x, y, x, y…], x ascending. */
export function mcCurve(u, curve, points) {
  const x = mcClamp01(Number.isFinite(u) ? u : 0);
  switch (curve) {
    case 'exp': return x * x;
    case 'log': return Math.sqrt(x);
    case 'scurve': return x * x * (3 - 2 * x);
    case 'custom': {
      if (!points || points.length < 4) return x;
      const xs = [], ys = [];
      for (let i = 0; i + 1 < points.length; i += 2) { xs.push(points[i]); ys.push(points[i + 1]); }
      return mcClamp01(mcMonotone(xs, ys, x));
    }
    default: return x;
  }
}

/** A macro's value (0..1) → a target's value: its curve, then its range (min above max inverts). */
export function mcTargetValue(v, target) {
  return target.min + (target.max - target.min) * mcCurve(v, target.curve, target.points);
}
