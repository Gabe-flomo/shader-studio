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
