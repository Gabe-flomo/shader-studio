/**
 * The fast flow (implementation guide, phase 3): the verb catalog, smart
 * connection defaults and the rule edits Quick rule and the Rules page make.
 */
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { subjectOf, verbOf, verbSentence, verbsFor } from '../signalVerbs';
import { connectDefaults, describeConnection, type ConnectFrom, type ConnectTo } from '../connectDefaults';
import { addReaction, addRule, asRules, defaultReaction, inputOf, normalizeRules, patchReaction, patchRule, removeReaction, ruleName, setRuleVerb, sharedFire } from '../rules';
import { defaultLayer, emptyPlayRecord, type PlayLayer, type PlayRecord, type TriggerSpec } from '../../types/play';

const sparks = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;
const base = (): PlayRecord => ({ ...emptyPlayRecord(), layers: [sparks()], controls: [{ id: 'c', target: 'n::c', kind: 'float', label: 'Radius', min: 0, max: 10 }] });

describe('the verb catalog', () => {
  const cases: Array<[TriggerSpec, string, string[]]> = [
    [{ on: 'key', code: 'Space' }, 'Space', ['is pressed', 'is released', 'is held']],
    [{ on: 'hand', side: 'right', gesture: 'pinch' }, 'Right · Pinch', ['closes', 'opens', 'stays closed']],
    [{ on: 'hand', side: 'left', gesture: 'fist' }, 'Left · Fist', ['starts', 'stops', 'is held']],
    [{ on: 'audio', band: 'bass', threshold: 0.6 }, 'the bass', ['hits', 'drops back', 'stays loud']],
    [{ on: 'note', channel: 0, note: 36 }, 'C2', ['is played', 'is released', 'is held']],
    [{ on: 'mouse' }, 'the mouse', ['clicks', 'is let go', 'is held down']],
    [{ on: 'value', value: 'ax:x:pointer', cmp: 'below', threshold: 0.5, unit: 'pct', hysteresis: 0.05, tolerance: 0.01 }, 'the pointer', ['moves to the left half', 'moves to the right half']],
    [{ on: 'value', value: 'ctl:c', cmp: 'above', threshold: 5, hysteresis: 0.5, tolerance: 0.1 }, 'Radius', ['goes above 5', 'goes below 5', 'stays above 5']],
  ];
  it.each(cases)('offers sentences for %j', (t, subject, labels) => {
    expect(subjectOf(t, { controls: base().controls })).toBe(subject);
    expect(verbsFor(t).map(v => v.label)).toEqual(labels);
  });

  it('reads a trigger and a firing mode back as its verb, whatever order the keys are in', () => {
    const t: TriggerSpec = { on: 'key', code: 'KeyA' };
    expect(verbOf(t, undefined)?.id).toBe('rise');
    expect(verbOf(t, { mode: 'release', every: 3, unit: 'frames' })?.id).toBe('fall');
    const learned: TriggerSpec = { on: 'value', value: 'mouse:x', cmp: 'above', threshold: 0.5, unit: 'pct', hysteresis: 0.05, tolerance: 0.01 };
    const shuffled = JSON.parse('{"tolerance":0.01,"unit":"pct","threshold":0.5,"on":"value","hysteresis":0.05,"cmp":"above","value":"mouse:x"}') as TriggerSpec;
    expect(verbOf(shuffled, undefined)?.id).toBe(verbOf(learned, undefined)?.id);
    expect(verbSentence({ on: 'hand', side: 'right', gesture: 'pinch' }, undefined)).toBe('When Right · Pinch closes');
  });
});

describe('connection defaults', () => {
  const table: Array<[ConnectFrom, ConnectTo, string]> = [
    ['number', 'slider', 'route:add'], ['boolean', 'slider', 'route:replace'], ['position', 'slider', 'route:replace'], ['signal', 'slider', 'route:replace'], ['signalValue', 'slider', 'set'],
    ['number', 'button', 'fire'], ['boolean', 'button', 'fire'], ['position', 'button', 'none'], ['signal', 'button', 'fire'],
    ['number', 'when', 'question'], ['boolean', 'when', 'mirror'], ['position', 'when', 'region'], ['signal', 'when', 'mirror'], ['signalValue', 'when', 'mirror'],
    ['signal', 'do', 'reaction'], ['signalValue', 'do', 'set'], ['position', 'do', 'set'], ['number', 'do', 'none'],
  ];
  it.each(table)('%s to a %s', (from, to, want) => {
    const c = connectDefaults(from, to);
    expect(c.kind === 'route' ? `route:${c.mode}` : c.kind).toBe(want);
  });

  it('asks a pinch for below 20%, a sound for above 60%, anything else above 50%; says what it did', () => {
    expect(connectDefaults('number', 'when', 'pinch')).toEqual({ kind: 'question', cmp: 'below', threshold: 0.2, exit: 0.3 });
    expect(connectDefaults('number', 'when', 'audio')).toMatchObject({ cmp: 'above', threshold: 0.6 });
    expect(connectDefaults('number', 'slider')).toEqual({ kind: 'route', mode: 'add', swing: 0.5 });
    expect(describeConnection(connectDefaults('number', 'slider'), 'Pinch', 'Radius')).toBe('Pinch now drives Radius, adding up to 50% of its range');
    expect(connectDefaults('boolean', 'slider')).toMatchObject({ glideMs: 120 });
  });
});

describe('editing rules', () => {
  it('Quick rule: one trigger and one reaction make a rule named for its sentence', () => {
    const r = addRule(base(), [inputOf({ on: 'hand', side: 'right', gesture: 'pinch' })], [defaultReaction(base())]);
    expect(r.play.signals).toEqual([{ id: 'rule_1', name: 'When Right · Pinch closes', inputs: [{ kind: 'trigger', trigger: { on: 'hand', side: 'right', gesture: 'pinch' } }], do: [expect.objectContaining({ do: 'burst', layerId: 'p', amount: 60, enabled: true })] }]);
    expect(inputOf({ on: 'signal', signal: 's' })).toEqual({ kind: 'signal', signal: 's', as: 'mirror' });
  });

  it('a second reaction is one edit; a verb sets the trigger and every reaction’s firing', () => {
    let p = addRule(base(), [inputOf({ on: 'key', code: 'KeyA' })], [defaultReaction(base())]).play;
    p = addReaction(p, 'rule_1', { ...defaultReaction(p), id: 'r2', do: 'scatter', amount: 2 });
    expect(p.signals![0].do).toHaveLength(2);
    p = setRuleVerb(p, 'rule_1', 0, { on: 'key', code: 'KeyA' }, { mode: 'release', every: 3, unit: 'frames' });
    expect(sharedFire(p.signals![0])?.mode).toBe('release');
    expect(p.signals![0].name).toBe('When A is released');
    p = patchReaction(p, 'rule_1', 'r2', { fire: { mode: 'once', every: 3, unit: 'frames' } });
    expect(sharedFire(p.signals![0])).toBeNull();
    expect(p.signals![0].do![1].fire).toBeUndefined();
    p = removeReaction(removeReaction(p, 'rule_1', 'r2'), 'rule_1', p.signals![0].do![0].id);
    expect(p.signals![0].do).toBeUndefined();
    expect(patchRule(p, 'rule_1', { combine: 'any' }).signals![0].combine).toBeUndefined();
  });

  it('an edit turns the older wiring into rules first; an action added later joins the rule for its trigger', () => {
    const old: PlayRecord = { ...base(), actions: [{ id: 'a', trigger: { on: 'key', code: 'Space' }, do: 'burst', layerId: 'p', amount: 1, enabled: true }] };
    const p = patchRule(old, 'rule_1', { name: 'Go' });
    expect(p.actions).toBeUndefined();
    expect(p.signals).toEqual([expect.objectContaining({ id: 'rule_1', name: 'Go', do: [expect.objectContaining({ id: 'a' })] })]);
    const later = asRules({ ...p, actions: [{ id: 'b', trigger: { on: 'key', code: 'Space' }, do: 'scatter', layerId: 'p', amount: 2, enabled: true }] });
    expect(later.signals).toHaveLength(1);
    expect(later.signals![0].do!.map(r => r.id)).toEqual(['a', 'b']);
    expect(normalizeRules(later)).toEqual(later);
  });

  it('names several inputs by how they combine', () => {
    const p = base();
    expect(ruleName(p, [inputOf({ on: 'key', code: 'KeyA' }), inputOf({ on: 'key', code: 'KeyB' })], undefined, 'all')).toBe('When all of: Key A, Key B');
  });
});

describe('the engine hears a rule', () => {
  it('binds the keys a rule’s inputs use (and a level signal’s own key)', async () => {
    const { playEngine } = await import('../../lib/playEngine');
    playEngine.setRecord(addRule(base(), [inputOf({ on: 'key', code: 'KeyS' })]).play);
    expect(playEngine.keyIsBound('KeyS')).toBe(true);
    playEngine.setRecord({ ...base(), signals: [{ id: 's', name: 'S', when: { kind: 'trigger', trigger: { on: 'key', code: 'KeyQ' } } }] });
    expect(playEngine.keyIsBound('KeyQ')).toBe(true);
    expect(playEngine.keyIsBound('KeyZ')).toBe(false);
    playEngine.setRecord(emptyPlayRecord());
  });
});
