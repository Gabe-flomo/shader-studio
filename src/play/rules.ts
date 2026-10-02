/**
 * rules.ts — the older shape of a setup's wiring as rules (implementation
 * guide, phase 2): every signal a rule, When [its inputs, combined] Do [its
 * reactions].
 *
 *   a signal's `when`          its inputs: a trigger, or the signals it
 *                              combined (mirrored) with all/any/none/one
 *   a signal's `links`         on each target: an input taking this signal's
 *                              rise (or fall) after the link's delay
 *   an action on a signal      a reaction of that signal (its firing mode moves
 *                              to the reaction)
 *   any other action           a reaction of a rule for its trigger: actions
 *                              with the same trigger share one rule
 *
 * Pure and idempotent (normalizeRules(normalizeRules(x)) equals
 * normalizeRules(x)). The engine reads both shapes the same way; the golden
 * outputs check that a setup and its rules play identically.
 */
import { triggerKey } from './triggers';
import { triggerLabel } from './playSources';
import type { PlayAction, PlayReaction, PlayRecord, PlaySignal, SignalCombine, SignalInput, SignalLogic, TriggerSpec } from '../types/play';

const COMBINE_OF: Record<SignalLogic, SignalCombine> = { and: 'all', or: 'any', not: 'none', xor: 'one' };

/** An action as a reaction (its trigger's firing mode comes with it). */
export function reactionOf(a: PlayAction): PlayReaction {
  const r: PlayReaction = { id: a.id, do: a.do, layerId: a.layerId, amount: a.amount, enabled: a.enabled };
  if (a.signal !== undefined) r.signal = a.signal;
  if (a.trigger.fire) r.fire = a.trigger.fire;
  return r;
}

/** A trigger without its firing mode (rules are keyed by what fires them, not how often). */
function bare(t: TriggerSpec): TriggerSpec {
  const { fire: _f, ...rest } = t;
  void _f;
  return rest as TriggerSpec;
}

export function normalizeRules(play: PlayRecord): PlayRecord {
  const signals: PlaySignal[] = (play.signals ?? []).map(s => ({ ...s }));
  const byId = new Map(signals.map(s => [s.id, s]));
  // `when` becomes inputs.
  for (const s of signals) {
    if (!s.when) continue;
    const inputs: SignalInput[] = [];
    if (s.when.kind === 'trigger') inputs.push({ kind: 'trigger', trigger: s.when.trigger });
    else {
      for (const i of s.when.inputs) inputs.push({ kind: 'signal', signal: i, as: 'mirror' });
      if (!s.inputs?.length && COMBINE_OF[s.when.op] !== 'any') s.combine = COMBINE_OF[s.when.op];
    }
    s.inputs = [...inputs, ...(s.inputs ?? [])];
    delete s.when;
  }
  // Links become inputs on what they point at.
  for (const s of signals) {
    if (!s.links) continue;
    for (const l of s.links) {
      const to = byId.get(l.to);
      if (!to) continue;
      const input: SignalInput = { kind: 'signal', signal: s.id, as: l.on === 'fall' ? 'fall' : 'rise' };
      if (l.delay > 0) input.delay = l.delay;
      to.inputs = [...(to.inputs ?? []), input];
    }
    delete s.links;
  }
  // Actions become reactions: on the signal they fire on, or on a rule for their trigger.
  const rules = new Map<string, PlaySignal>();
  let n = 0;
  const layers = play.layers.map(l => ({ id: l.id, label: l.label }));
  for (const a of play.actions ?? []) {
    const r = reactionOf(a);
    if (a.trigger.on === 'signal' && a.trigger.signal && byId.has(a.trigger.signal)) {
      const s = byId.get(a.trigger.signal)!;
      s.do = [...(s.do ?? []), r];
      continue;
    }
    const t = bare(a.trigger);
    const key = triggerKey(t);
    let rule = rules.get(key);
    if (!rule) {
      let id = `rule_${++n}`;
      while (byId.has(id)) id = `rule_${++n}`;
      rule = { id, name: `When ${triggerLabel(t, layers, { layers, controls: play.controls, signals: play.signals })}`, inputs: [{ kind: 'trigger', trigger: t }], do: [] };
      rules.set(key, rule);
      byId.set(id, rule);
    }
    rule.do = [...(rule.do ?? []), r];
  }
  const out: PlayRecord = { ...play, signals: [...signals, ...rules.values()] };
  delete out.actions;
  if (!out.signals!.length) delete out.signals;
  return out;
}
