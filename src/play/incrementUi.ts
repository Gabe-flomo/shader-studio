/**
 * incrementUi.ts — words for Increment mappings (docs/increment-mapping.md):
 * the one-line summary a folded mapping row shows, and the pickers' options.
 */
import type { IncrementGlideCurve, IncrementGrowth, IncrementLimit, IncrementOn, IncrementWrapBack, PlayIncrement, PlayMapping, PlaySignal } from '../types/play';
import { signalName, sourceLabel, triggerLabel } from './playSources';

const num = (n: number) => `${Math.round(n * 1000) / 1000}`;

/** "+0.5 ×2 on beat, wrap 8", "−2 every 0.5 s, bounce", "+10% on Hit", "+1 +1 at 0.6, glide 200 ms". */
export function incrementSummary(inc: PlayIncrement, signals: ReadonlyArray<PlaySignal> = [], layers: ReadonlyArray<{ id: string; label: string }> = []): string {
  const sign = inc.direction < 0 ? '−' : '+';
  let s = `${sign}${num(Math.abs(inc.step))}${inc.growth === 'proportional' ? '%' : ''}`;
  if (inc.growth === 'compound') s += ` ×${num(inc.factor)}`;
  else if (inc.growth === 'additive') s += ` ${inc.factor < 0 ? '−' : '+'}${num(Math.abs(inc.factor))}`;
  if (inc.on === 'repeat') {
    s += inc.unit === 'beats' ? (inc.every === 1 ? ' on beat' : ` every ${num(inc.every)} beats`) : ` every ${num(inc.every)} s`;
    if (inc.when) s += ' (while)';
  } else if (inc.on === 'threshold') s += ` at ${num(inc.threshold)}${inc.falling ? ' ↕' : ''}`;
  else s += ` on ${inc.trigger.on === 'signal' ? signalName(inc.trigger.signal, signals) : triggerLabel(inc.trigger, layers, { signals })}`;
  const extra: string[] = [];
  if (inc.limit === 'wrap') extra.push('wraps round');
  if (inc.limit === 'bounce') extra.push('bounce');
  if (inc.wrapAfter > 0) extra.push(`${inc.wrapBack === 'pingpong' ? 'ping-pong' : 'wrap'} ${inc.wrapAfter}`);
  if (inc.glideMs > 0) extra.push(`glide ${Math.round(inc.glideMs)} ms`);
  return extra.length ? `${s}, ${extra.join(', ')}` : s;
}

/** What drives a control, in words: "Increment" (with `full`, its summary: "Increment +0.5 on beat"), else its source's name. */
export function mappingLabel(m: { source: PlayMapping['source']; increment?: PlayIncrement }, play: { controls: ReadonlyArray<{ id: string; label: string }>; layers: ReadonlyArray<{ id: string; label: string }>; signals?: ReadonlyArray<PlaySignal> }, full = false): string {
  if (m.increment) return full ? `Increment ${incrementSummary(m.increment, play.signals, play.layers)}` : 'Increment';
  return sourceLabel(m.source, play.controls, play.layers);
}

export const INCREMENT_ON_OPTIONS: { value: IncrementOn; label: string; title: string }[] = [
  { value: 'trigger', label: 'Trigger', title: 'A signal, an action’s signal, a key, a note, a beat…' },
  { value: 'threshold', label: 'Threshold', title: 'The source reaching a level' },
  { value: 'repeat', label: 'Repeat', title: 'Every N seconds or beats' },
];

export const INCREMENT_GROWTH_OPTIONS: { value: IncrementGrowth; label: string; title: string }[] = [
  { value: 'constant', label: 'Constant', title: 'The same step every time' },
  { value: 'compound', label: 'Compound', title: 'The step is multiplied by the factor each time' },
  { value: 'additive', label: 'Additive', title: 'The step grows by the factor each time' },
  { value: 'proportional', label: '% of value', title: 'The step is a percentage of the current value' },
];

export const INCREMENT_LIMIT_OPTIONS: { value: IncrementLimit; label: string; title: string }[] = [
  { value: 'clamp', label: 'Clamp', title: 'Stop at the ends of the range' },
  { value: 'wrap', label: 'Wrap', title: 'Come round the other side' },
  { value: 'bounce', label: 'Bounce', title: 'Turn back at the ends' },
];

export const INCREMENT_WRAP_OPTIONS: { value: IncrementWrapBack; label: string; title: string }[] = [
  { value: 'snap', label: 'Snap', title: 'Jump back to the start' },
  { value: 'glide', label: 'Glide', title: 'Slide back to the start over the glide time' },
  { value: 'pingpong', label: 'Ping-pong', title: 'Walk back step by step' },
];

export const INCREMENT_CURVE_OPTIONS: { value: IncrementGlideCurve; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'in', label: 'Ease in' },
  { value: 'out', label: 'Ease out' },
];
