/**
 * LogRulerSlider — the ruler for a setting on a log scale (Hz, ms, grains a second): the same drag, keys and typing
 * as RulerSlider, but a drag moves by a ratio, not an amount, so 20 Hz → 40 Hz is as far as 2 kHz → 4 kHz. The chip
 * shows and takes the real value (`format` writes it, e.g. "1.2k"); the ruler underneath runs on its logarithm.
 */
import { useMemo } from 'react';
import { RulerSlider } from './RulerSlider';

/** The inner (log) value of `v`, with `lo` (> 0) standing in for anything at or below it. */
export const toLog = (v: number, lo: number) => Math.log(Math.max(lo, v));
/** Back from the log scale, rounded the way a setting with this step shows it. */
export function fromLog(t: number, step: number): number {
  const v = Math.exp(t);
  return step >= 1 || v >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
}

export function LogRulerSlider({ value, min, max, step = 0.01, defaultValue, onChange, ariaLabel, format, disabled, touch, hard = true }: {
  value: number;
  /** The low end; a zero or negative low end is taken as a tenth (a log scale never reaches 0). */
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  /** How the chip writes a real value (with its unit); the plain number by default. */
  format?: (v: number) => string;
  disabled?: boolean;
  touch?: boolean;
  hard?: boolean;
}) {
  const lo = min > 0 ? min : 0.1;
  const display = useMemo(() => ({
    show: (t: number) => { const v = fromLog(t, step); return format ? format(v) : String(v); },
    parse: (typed: number) => toLog(typed, lo),
  }), [format, step, lo]);
  return (
    <RulerSlider
      value={toLog(value, lo)} min={toLog(lo, lo)} max={toLog(max, lo)} step={0.0005}
      defaultValue={defaultValue === undefined ? undefined : toLog(defaultValue, lo)}
      onChange={t => onChange(fromLog(t, step))} ariaLabel={ariaLabel} display={display} disabled={disabled} touch={touch} hard={hard}
    />
  );
}
