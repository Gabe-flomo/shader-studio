/**
 * controlActions — a rule's Set a control and Nudge a control (Play audit
 * P11): the control's own value moves, as if its slider were dragged, so a
 * rule can do something with no layers at all ("when the kick hits, nudge
 * Radius up"). Pure; the Play page writes the value (PlayPage's writeControl)
 * and the web runtime does the same with its own panel (play-runtime.js).
 *
 *   Set     the control to the reaction's `value`
 *   Nudge   the control by `value` (negative takes away), stopping at the
 *           ends of its range; with `key` 'wrap', past the top it goes back
 *           to the bottom (and past the bottom to the top), for stepping
 *           through. A switch (a toggle control) flips instead.
 */
import {
  CONTROL_NUDGE_ACTION, CONTROL_SET_ACTION, parseActionTarget, parseReaderTarget, type ControlActionKind, type PlayControl, type PlayReaction, type PlayRecord,
} from '../types/play';
import { parseGrainsTarget } from '../types/playAudioEngine';

/** Controls a rule can set or nudge: plain sliders and switches (not buttons, colours or readouts a reader drives). */
export function settableControls(play: Pick<PlayRecord, 'controls'>): PlayControl[] {
  return play.controls.filter(c => c.kind === 'float' && !parseActionTarget(c.target) && !parseReaderTarget(c.target) && !parseGrainsTarget(c.target));
}

/** A new reaction's value: Set goes to the top of the range (a switch: on); Nudge steps a tenth of it (or its step). */
export function defaultControlValue(kind: ControlActionKind, c: PlayControl | undefined): number {
  if (!c) return kind === CONTROL_SET_ACTION ? 1 : 0.1;
  if (kind === CONTROL_SET_ACTION) return c.max;
  const span = c.max - c.min;
  const tenth = span > 0 ? +(span / 10).toPrecision(2) : 0.1;
  return c.step && c.step > 0 ? Math.max(c.step, tenth) : tenth;
}

/** The value a control action leaves the control at, from `current`. */
export function controlActionValue(a: Pick<PlayReaction, 'do' | 'value' | 'key'>, c: Pick<PlayControl, 'min' | 'max' | 'toggle'>, current: number): number {
  const v = typeof a.value === 'number' && Number.isFinite(a.value) ? a.value : 0;
  if (a.do === CONTROL_SET_ACTION) return v;
  if (a.do !== CONTROL_NUDGE_ACTION) return current;
  const lo = Math.min(c.min, c.max), hi = Math.max(c.min, c.max);
  // A switch flips: off to on, on to off.
  if (c.toggle) return current >= (lo + hi) / 2 ? c.min : c.max;
  // Rounded, so steps of 0.05 stay 0.05s and don't drift (0.22299999…).
  const next = Math.round((current + v) * 1e6) / 1e6;
  if (a.key === 'wrap') return next > hi + 1e-9 ? lo : next < lo - 1e-9 ? hi : next;
  return Math.max(lo, Math.min(hi, next));
}

const fmt = (n: number) => String(+n.toFixed(3));

/** "Set Radius to 0.5", "Nudge Radius by +0.1 (wraps)", "Flip Glow": a control action in words. */
export function controlActionText(r: Pick<PlayReaction, 'do' | 'value' | 'key' | 'control'>, play: Pick<PlayRecord, 'controls'>): string {
  const c = play.controls.find(x => x.id === r.control);
  const name = c?.label ?? 'a removed control';
  const v = typeof r.value === 'number' ? r.value : 0;
  if (r.do === CONTROL_SET_ACTION) return c?.toggle ? `Turn ${name} ${v >= (c.min + c.max) / 2 ? 'on' : 'off'}` : `Set ${name} to ${fmt(v)}`;
  if (c?.toggle) return `Flip ${name}`;
  return `Nudge ${name} by ${v >= 0 ? '+' : ''}${fmt(v)}${r.key === 'wrap' ? ' (wraps)' : ''}`;
}

/** Rules that set or nudge a control that's gone lose those reactions (a rule left with none keeps its When). */
export function withoutControlReactions(play: PlayRecord, controlId: string): PlayRecord {
  if (!play.signals?.some(s => s.do?.some(r => r.control === controlId))) return play;
  return {
    ...play,
    signals: play.signals.map(s => {
      if (!s.do?.some(r => r.control === controlId)) return s;
      const left = s.do.filter(r => r.control !== controlId);
      const { do: _gone, ...rest } = s;
      void _gone;
      return left.length ? { ...s, do: left } : rest;
    }),
  };
}
