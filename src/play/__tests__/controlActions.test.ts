/**
 * A rule's Set a control and Nudge a control (Play audit P11): the value a
 * control ends at, the words, the Do list offering them with no layers, the
 * file round trip, and rules letting go of a removed control.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { controlActionText, controlActionValue, defaultControlValue, settableControls, withoutControlReactions } from '../controlActions';
import { removeFromPlay } from '../playDriven';
import { sgReactions } from '../kit/signals.js';
import { doChoices, reactionText, controlDefaults } from '../../components/play/rules/reactionChoices';
import { emptyPlayRecord, parsePlayRecord, type PlayControl, type PlayRecord } from '../../types/play';

const radius: PlayControl = { id: 'c_r', target: 'n1::radius', kind: 'float', label: 'Radius', min: 0, max: 1 };
const glow: PlayControl = { id: 'c_g', target: 'n1::glow', kind: 'float', label: 'Glow', min: 0, max: 1, toggle: true };
const tint: PlayControl = { id: 'c_t', target: 'n1::tint', kind: 'color', label: 'Tint', min: 0, max: 1 };
const burst: PlayControl = { id: 'c_b', target: 'action:L1::burst', kind: 'action', label: 'Burst', min: 0, max: 1 };
const play = (): PlayRecord => ({
  ...emptyPlayRecord(),
  controls: [radius, glow, tint, burst],
  signals: [{ id: 's1', name: 'Kick', do: [{ id: 'r1', do: 'ctlnudge', layerId: '', amount: 1, enabled: true, control: 'c_r', value: 0.25 }] }],
});

describe('the value a control action leaves', () => {
  it('Set puts it at the value, even past the slider’s range (as typing does)', () => {
    expect(controlActionValue({ do: 'ctlset', value: 0.4 }, radius, 0.9)).toBe(0.4);
    expect(controlActionValue({ do: 'ctlset', value: 3 }, radius, 0.9)).toBe(3);
  });
  it('Nudge adds and stops at the ends', () => {
    expect(controlActionValue({ do: 'ctlnudge', value: 0.25 }, radius, 0.5)).toBe(0.75);
    expect(controlActionValue({ do: 'ctlnudge', value: 0.25 }, radius, 0.9)).toBe(1);
    expect(controlActionValue({ do: 'ctlnudge', value: -0.25 }, radius, 0.1)).toBe(0);
  });
  it('Nudge with wrap goes back to the bottom past the top, and to the top past the bottom', () => {
    const steps: number[] = [];
    let v = 0;
    for (let i = 0; i < 5; i++) { v = controlActionValue({ do: 'ctlnudge', value: 0.25, key: 'wrap' }, radius, v); steps.push(v); }
    expect(steps).toEqual([0.25, 0.5, 0.75, 1, 0]);
    expect(controlActionValue({ do: 'ctlnudge', value: -0.5, key: 'wrap' }, radius, 0.2)).toBe(1);
  });
  it('a switch flips on a nudge', () => {
    expect(controlActionValue({ do: 'ctlnudge', value: 0.1 }, glow, 0)).toBe(1);
    expect(controlActionValue({ do: 'ctlnudge', value: 0.1 }, glow, 1)).toBe(0);
  });
});

describe('which controls, and in words', () => {
  it('offers sliders and switches, not colours or buttons', () => {
    expect(settableControls(play()).map(c => c.id)).toEqual(['c_r', 'c_g']);
  });
  it('starts a Set at the top and a Nudge at a tenth of the range', () => {
    expect(defaultControlValue('ctlset', radius)).toBe(1);
    expect(defaultControlValue('ctlnudge', radius)).toBe(0.1);
    expect(defaultControlValue('ctlnudge', { ...radius, max: 10, step: 1 })).toBe(1);
  });
  it('reads as a sentence', () => {
    const p = play();
    expect(controlActionText({ do: 'ctlset', control: 'c_r', value: 0.5 }, p)).toBe('Set Radius to 0.5');
    expect(controlActionText({ do: 'ctlnudge', control: 'c_r', value: 0.1, key: 'wrap' }, p)).toBe('Nudge Radius by +0.1 (wraps)');
    expect(controlActionText({ do: 'ctlnudge', control: 'c_r', value: -0.2 }, p)).toBe('Nudge Radius by -0.2');
    expect(controlActionText({ do: 'ctlnudge', control: 'c_g', value: 1 }, p)).toBe('Flip Glow');
    expect(controlActionText({ do: 'ctlset', control: 'c_g', value: 1 }, p)).toBe('Turn Glow on');
    expect(reactionText(p.signals![0].do![0], p)).toBe('Nudge Radius by +0.25');
  });
});

describe('the Do list', () => {
  it('offers Set and Nudge a control with no layers at all, before Send a signal', () => {
    const labels = doChoices(play()).map(c => c.label);
    expect(labels).toEqual(['Set a control', 'Nudge a control', 'Send a signal']);
  });
  it('leaves them out when there is no control to move', () => {
    expect(doChoices(emptyPlayRecord()).map(c => c.label)).toEqual(['Send a signal']);
  });
  it('a new one starts on the first control (or keeps the one it had)', () => {
    expect(controlDefaults('ctlset', play())).toMatchObject({ control: 'c_r', value: 1 });
    expect(controlDefaults('ctlnudge', play(), 'c_g')).toMatchObject({ control: 'c_g' });
    expect(controlDefaults('burst', play())).toEqual({});
  });
});

describe('saved and run', () => {
  it('survives a save and a load, and a reaction on a missing control is dropped', () => {
    const p = play();
    p.signals![0].do!.push({ id: 'r2', do: 'ctlset', layerId: '', amount: 1, enabled: true, control: 'gone', value: 2 });
    const back = parsePlayRecord(JSON.parse(JSON.stringify(p)));
    expect(back.signals?.[0].do).toEqual([{ id: 'r1', do: 'ctlnudge', layerId: '', amount: 1, enabled: true, control: 'c_r', value: 0.25 }]);
  });
  it('keeps wrap on a nudge', () => {
    const p = play();
    p.signals![0].do![0].key = 'wrap';
    expect(parsePlayRecord(JSON.parse(JSON.stringify(p))).signals?.[0].do?.[0].key).toBe('wrap');
  });
  it('the action runner gets the control (and its value) with the action', () => {
    const [a] = sgReactions(play().signals!);
    expect(a).toMatchObject({ do: 'ctlnudge', control: 'c_r', value: 0.25, trigger: { on: 'signal', signal: 's1' } });
  });
  it('removing the control takes the reactions on it with it', () => {
    const after = removeFromPlay(play(), 'c_r');
    expect(after.signals?.[0].do).toBeUndefined();
    expect(after.signals?.[0].name).toBe('Kick');
    expect(withoutControlReactions(play(), 'c_g')).toEqual(play());
  });
});
