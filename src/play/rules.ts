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
import { verbSentence } from './signalVerbs';
import { actionsForLayer, REACTIONS_PER_SIGNAL_MAX, SIGNAL_ACTION, SIGNALS_MAX, SIGNAL_INPUTS_MAX, type FireSpec, type PlayAction, type PlayReaction, type PlayRecord, type PlaySignal, type SignalCombine, type SignalInput, type SignalLogic, type TriggerSpec } from '../types/play';

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
  // A rule already made for a trigger takes more reactions on it (an action added since, say).
  for (const s of signals) {
    const k = plainRuleKey(s);
    if (k && !rules.has(k)) rules.set(k, s);
  }
  let n = 0;
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
      rule = { id, name: ruleName(play, [{ kind: 'trigger', trigger: t }]), inputs: [{ kind: 'trigger', trigger: t }], do: [] };
      rules.set(key, rule);
      byId.set(id, rule);
    }
    rule.do = [...(rule.do ?? []), r];
  }
  const out: PlayRecord = { ...play, signals: [...signals, ...[...rules.values()].filter(r => !signals.includes(r))] };
  delete out.actions;
  if (!out.signals!.length) delete out.signals;
  return out;
}

/** A rule made for one trigger (`rule_…`, one trigger input, nothing else): its trigger's key. */
function plainRuleKey(s: PlaySignal): string | null {
  if (!s.id.startsWith('rule_') || s.when || s.links?.length || s.combine) return null;
  if (s.inputs?.length !== 1 || s.inputs[0].kind !== 'trigger') return null;
  return triggerKey(bare(s.inputs[0].trigger));
}

// ── Editing rules (the Rules page and Quick rule) ────────────────────────────

/** The record with its wiring as rules (unchanged when it already is). */
export function asRules(play: PlayRecord): PlayRecord {
  const old = !!play.actions?.length || !!play.signals?.some(s => s.when || s.links?.length);
  return old ? normalizeRules(play) : play;
}

/** A rule's id not yet taken. */
export function newRuleId(play: PlayRecord): string {
  const taken = new Set((play.signals ?? []).map(s => s.id));
  let n = taken.size + 1;
  while (taken.has(`rule_${n}`)) n++;
  return `rule_${n}`;
}

/** The likely first reaction: the last layer's first action (a burst of 60), or send a signal when there are no layers. */
export function defaultReaction(play: PlayRecord, layerId?: string): PlayReaction {
  const l = play.layers.find(x => x.id === layerId) ?? play.layers[play.layers.length - 1];
  const id = `re_${Date.now().toString(36)}_${(++reSeq).toString(36)}`;
  if (!l) return { id, do: SIGNAL_ACTION, layerId: '', amount: 1, enabled: true, signal: '' };
  return { id, do: actionsForLayer(l)[0], layerId: l.id, amount: l.kind === 'drumpad' ? 1 : 60, enabled: true };
}
let reSeq = 0;

/** A new rule: When `inputs`, Do `reactions`; named for its first input. Empty id when the setup is full. */
export function addRule(play: PlayRecord, inputs: SignalInput[], reactions: PlayReaction[] = [], name?: string): { play: PlayRecord; id: string } {
  const p = asRules(play);
  if ((p.signals?.length ?? 0) >= SIGNALS_MAX) return { play, id: '' };
  const id = newRuleId(p);
  const rule: PlaySignal = { id, name: name ?? ruleName(p, inputs, reactions[0]?.fire), inputs: inputs.slice(0, SIGNAL_INPUTS_MAX) };
  if (reactions.length) rule.do = reactions.slice(0, REACTIONS_PER_SIGNAL_MAX);
  return { play: { ...p, signals: [...(p.signals ?? []), rule] }, id };
}

/** A trigger as a rule's input: a signal is mirrored, anything else followed. */
export function inputOf(t: TriggerSpec): SignalInput {
  return t.on === 'signal' ? { kind: 'signal', signal: t.signal, as: 'mirror' } : { kind: 'trigger', trigger: bare(t) };
}

/** "When Space is pressed", "When any of: Hover, Click". */
export function ruleName(play: PlayRecord, inputs: readonly SignalInput[], fire?: FireSpec, combine: SignalCombine = 'any'): string {
  const ctx = { layers: play.layers, controls: play.controls, signals: play.signals };
  if (!inputs.length) return 'New rule';
  const one = (x: SignalInput) => (x.kind === 'trigger' ? x.trigger : ({ on: 'signal', signal: x.signal } as TriggerSpec));
  if (inputs.length === 1) {
    const x = inputs[0];
    if (x.kind === 'signal') return `When ${play.signals?.find(s => s.id === x.signal)?.name ?? 'a signal'} ${x.as === 'rise' ? 'starts' : x.as === 'fall' ? 'stops' : 'is on'}`;
    return verbSentence(one(x), fire, ctx);
  }
  const words = { any: 'any of', all: 'all of', none: 'none of', one: 'one of' }[combine];
  const name = (id: string) => play.signals?.find(s => s.id === id)?.name ?? 'a missing rule';
  const part = (x: SignalInput) => (x.kind === 'trigger' ? triggerLabel(x.trigger, play.layers, ctx) : x.as === 'mirror' ? name(x.signal) : `${name(x.signal)} ${x.as === 'rise' ? 'starts' : 'stops'}`);
  return `When ${words}: ${inputs.map(part).join(', ')}`;
}

type RulePatch = Partial<Pick<PlaySignal, 'name' | 'inputs' | 'combine' | 'do'>>;

/** Change one rule (the record turned into rules first). */
export function patchRule(play: PlayRecord, id: string, patch: RulePatch | ((s: PlaySignal) => RulePatch)): PlayRecord {
  const p = asRules(play);
  return { ...p, signals: (p.signals ?? []).map(s => {
    if (s.id !== id) return s;
    const change = typeof patch === 'function' ? patch(s) : patch;
    const n: PlaySignal = { ...s, ...change };
    // A name that was its sentence follows the sentence.
    const said = (x: PlaySignal) => ruleName(p, x.inputs ?? [], sharedFire(x) ?? undefined, x.combine);
    if (change.name === undefined && s.name === said(s)) n.name = said(n);
    if (!n.combine || n.combine === 'any') delete n.combine;
    if (n.do && !n.do.length) delete n.do;
    if (n.inputs && !n.inputs.length) delete n.inputs;
    return n;
  }) };
}

export function addReaction(play: PlayRecord, ruleId: string, r: PlayReaction): PlayRecord {
  return patchRule(play, ruleId, s => ({ do: [...(s.do ?? []), r].slice(0, REACTIONS_PER_SIGNAL_MAX) }));
}
export function patchReaction(play: PlayRecord, ruleId: string, reactionId: string, patch: Partial<PlayReaction>): PlayRecord {
  return patchRule(play, ruleId, s => ({ do: (s.do ?? []).map(r => {
    if (r.id !== reactionId) return r;
    const n = { ...r, ...patch };
    if (!n.fire || n.fire.mode === 'once') delete n.fire;
    if (n.do !== SIGNAL_ACTION) delete n.signal;
    return n;
  }) }));
}
export function removeReaction(play: PlayRecord, ruleId: string, reactionId: string): PlayRecord {
  return patchRule(play, ruleId, s => ({ do: (s.do ?? []).filter(r => r.id !== reactionId) }));
}

/** Pick a verb for a one-trigger rule: its input's trigger, and how every reaction fires. */
export function setRuleVerb(play: PlayRecord, ruleId: string, inputIndex: number, trigger: TriggerSpec, fire: FireSpec | undefined): PlayRecord {
  return patchRule(play, ruleId, s => ({
    inputs: (s.inputs ?? []).map((x, i) => (i === inputIndex && x.kind === 'trigger' ? { kind: 'trigger' as const, trigger: bare(trigger) } : x)),
    do: (s.do ?? []).map(r => { const n = { ...r }; if (fire && fire.mode !== 'once') n.fire = fire; else delete n.fire; return n; }),
  }));
}

/** The firing mode a rule's reactions share (undefined: once; null: they differ). */
export function sharedFire(s: PlaySignal): FireSpec | undefined | null {
  const list = s.do ?? [];
  if (!list.length) return undefined;
  const k = (f?: FireSpec) => JSON.stringify(f ?? null);
  return list.every(r => k(r.fire) === k(list[0].fire)) ? list[0].fire : null;
}
