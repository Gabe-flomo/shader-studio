// Slider ranges that always hold their value. Free of React and of the UI, so the importer,
// Play and the sliders all use the same rule.

/** The smallest 1, 2 or 5 × 10^k at or above `x` (x > 0): a round number a range can end on. */
export function niceCeil(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 5, 10]) if (m * p >= x * (1 - 1e-9)) return parseFloat((m * p).toPrecision(6));
  return 10 * p;
}

/**
 * A slider's range, widened so it holds `value`. The value shown is always the real one, and
 * a drag starts from it: a value past the declared range (an imported 107 on a 0–1 slider, an
 * old save with a wider range) pushes that end out to a round number with some room to spare,
 * instead of the first touch clamping it back into the range. A value inside leaves it alone.
 */
export function rangeIncluding(value: number, min: number, max: number): { min: number; max: number } {
  let lo = Math.min(min, max), hi = Math.max(min, max);
  if (!Number.isFinite(value)) return { min: lo, max: hi };
  if (value > hi) hi = value <= 0 ? 0 : Math.max(niceCeil(value * 1.5), value);
  if (value < lo) lo = value >= 0 ? 0 : Math.min(-niceCeil(-value * 1.5), value);
  if (hi === lo) hi = lo + 1;
  return { min: lo, max: hi };
}

/**
 * What typing a number into a slider's value chip does to its range. A number past the max
 * becomes the max and the range runs 0 → N (a min above zero, like a radius's 0.01, drops to
 * 0; a negative min stays); on a bidirectional slider (one whose range is symmetric about
 * zero) it runs −N → N. A number below the min of a one-way slider becomes the min likewise
 * (N → 0, or N → the old max when that's above zero). A number inside the range is just the
 * value: typing a smaller number never shrinks the range on its own (only a "Reset range"
 * does). A `hard` limit (opacity, an audio unit's range) clamps the number instead.
 */
export function rangeAfterTyping(typed: number, min: number, max: number, hard = false): { value: number; min: number; max: number; extended: boolean } {
  const lo = Math.min(min, max), hi = Math.max(min, max);
  if (!Number.isFinite(typed)) return { value: lo, min: lo, max: hi, extended: false };
  if (hard) return { value: Math.min(hi, Math.max(lo, typed)), min: lo, max: hi, extended: false };
  if (typed >= lo && typed <= hi) return { value: typed, min: lo, max: hi, extended: false };
  const bidir = lo === -hi && hi > 0;
  if (bidir) { const a = Math.abs(typed); return { value: typed, min: -a, max: a, extended: true }; }
  return typed > hi
    ? { value: typed, min: Math.min(lo, 0), max: typed, extended: true }
    : { value: typed, min: typed, max: Math.max(hi, 0), extended: true };
}

/**
 * A range for a value that came without one (a number in pasted code, a constant freed into a
 * slider): 0–1 (or −1–1) for small values, else 0 to about twice the value, on a round number
 * (107 → 0–500, −3 → −10–10); negative values get a range symmetric around zero. The step
 * suits the size, so a drag moves it by readable amounts.
 */
export function rangeForValue(v: number): { min: number; max: number; step: number } {
  const a = Math.abs(v);
  if (!Number.isFinite(v) || a <= 1) return { min: v < 0 ? -1 : 0, max: 1, step: 0.01 };
  const top = niceCeil(a * 2);
  return { min: v < 0 ? -top : 0, max: top, step: top >= 100 ? 1 : top >= 10 ? 0.1 : 0.01 };
}
