/**
 * spread.js — the Spread control's maths (docs/spread-control.md): a group of
 * controls in an order, each offset by the group's Amount times a curve of
 * its place in the order. Plain math, so the app (lib/playEngine.ts) and
 * website exports (runtime/play-runtime.js, through the inlined kit as
 * SSKit.spread) compute the same values. Every top-level name starts
 * `sp`/`SP_` (the kit's files share one scope in exports).
 *
 *   spCurve(u, curve, curveY, invert)  how much of Amount a place gets, 0..1
 *   spWeight(i, n, shift, …)           member i's share, with the order rotated
 *                                      by `shift` (fractional: between places)
 *   spValue(base, lo, hi, amount, w)   base + amount × w × range, clamped
 */

/** The curves: how much of Amount each place in the order gets, first (0) to last (1). */
export const SP_CURVES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'exp', 'sine', 'custom'];
/** Custom curves: this many breakpoints by default, evenly across the order. */
export const SP_POINTS = 5;
export const SP_MAX_MEMBERS = 64;

/** A curve's value at u (0..1), 0..1; `invert` turns it upside down (1 − c). */
export function spCurve(u, curve, curveY, invert) {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  let c;
  switch (curve) {
    case 'easeIn': c = x * x; break;
    case 'easeOut': c = 1 - (1 - x) * (1 - x); break;
    case 'easeInOut': c = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x); break;
    case 'exp': c = x <= 0 ? 0 : (Math.pow(2, 10 * (x - 1)) - Math.pow(2, -10)) / (1 - Math.pow(2, -10)); break;
    // A hump: the middle of the order gets the most, both ends none.
    case 'sine': c = Math.sin(Math.PI * x); break;
    case 'custom': {
      if (!curveY || curveY.length < 2) { c = x; break; }
      const pos = x * (curveY.length - 1);
      const i = Math.min(curveY.length - 2, Math.floor(pos));
      const f = pos - i;
      c = curveY[i] + (curveY[i + 1] - curveY[i]) * f;
      break;
    }
    default: c = x;
  }
  if (!isFinite(c)) c = 0;
  c = c < 0 ? 0 : c > 1 ? 1 : c;
  return invert ? 1 - c : c;
}

/** Where place k (0..n−1) sits along the curve: the first at 0, the last at 1 (a single member at 1, so it gets the whole Amount). */
export function spPlace(k, n) { return n <= 1 ? 1 : k / (n - 1); }

/** k mod n, always 0..n. */
function spMod(k, n) { const r = k % n; return r < 0 ? r + n : r; }

/**
 * Member i's share (0..1) of Amount: its place in the order after rotating it
 * by `shift` (shift 1 makes member 1 the first), along the curve. A
 * fractional shift blends between two places, so an animated shift glides;
 * past the last place it blends back round to the first.
 */
export function spWeight(i, n, shift, curve, curveY, invert) {
  if (n <= 0) return 0;
  const k = spMod(i - (isFinite(shift) ? shift : 0), n);
  const k0 = Math.floor(k), f = k - k0;
  const a = spCurve(spPlace(k0 % n, n), curve, curveY, invert);
  if (f < 1e-9) return a;
  const b = spCurve(spPlace((k0 + 1) % n, n), curve, curveY, invert);
  return a + (b - a) * f;
}

/** Every member's share, in the order. */
export function spWeights(n, shift, curve, curveY, invert) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(spWeight(i, n, shift, curve, curveY, invert));
  return out;
}

/** A member's value: its base plus Amount × its share × its range, kept inside its range. */
export function spValue(base, lo, hi, amount, w) {
  const a = Math.min(lo, hi), b = Math.max(lo, hi);
  const v = base + amount * w * (b - a);
  return v < a ? a : v > b ? b : v;
}
