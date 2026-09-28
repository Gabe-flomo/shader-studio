/**
 * The computer keyboard playing an Audio engine rack (lib/rackKeyboard.ts):
 * musical typing, the claim that makes shortcuts and key mappings wait, Esc
 * and leaving Play giving it back, and the record's one-rack-at-a-time toggle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RackKeyboard, RACK_KEYS, useRackKeyboard, type KeyLike } from '../rackKeyboard';
import { keyboardClaimed, keyboardOwner } from '../keyboardClaim';

type Listener = (e: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const fakeWindow = {
  addEventListener(type: string, l: Listener) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(l); },
  removeEventListener(type: string, l: Listener) { listeners.get(type)?.delete(l); },
};
const dispatch = (type: string, e: unknown) => { for (const l of listeners.get(type) ?? []) l(e); };

function key(code: string, over: Partial<KeyLike> = {}): KeyLike & { defaulted: boolean; stopped: boolean } {
  const e = {
    code, repeat: false, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, target: null,
    defaulted: false, stopped: false,
    preventDefault() { e.defaulted = true; },
    stopImmediatePropagation() { e.stopped = true; },
    ...over,
  };
  return e;
}

let kb: RackKeyboard;
let sent: Array<[string, number[]]>;
let released: string[];

beforeEach(() => {
  listeners.clear();
  vi.stubGlobal('window', fakeWindow);
  kb = new RackKeyboard();
  sent = []; released = [];
  kb.configure({ send: (id, bytes) => sent.push([id, bytes]), release: id => released.push(id) });
});
afterEach(() => { kb.resetForTests(); vi.unstubAllGlobals(); });

describe('taking the keyboard', () => {
  it('listens only while the Play page shows and the record gives a rack the keyboard', () => {
    kb.setTarget('rk_a', 'Keys');
    expect(kb.active()).toBe('');
    expect(keyboardClaimed()).toBe(false);
    kb.setPage(true);
    expect(kb.active()).toBe('rk_a');
    expect(keyboardOwner()).toBe('rk_a');
    expect(useRackKeyboard.getState()).toMatchObject({ rackId: 'rk_a', rackName: 'Keys', octave: 4, velocity: 100 });
    expect(listeners.get('keydown')?.size).toBe(1);
    // The rack loses it (removed, or toggled off): nothing listens, the claim is gone.
    kb.setTarget('');
    expect(kb.active()).toBe('');
    expect(keyboardClaimed()).toBe(false);
    expect(useRackKeyboard.getState().rackId).toBe('');
    expect(listeners.get('keydown')?.size).toBe(0);
  });

  it('plays notes DAW-style: home row white keys, the row above black, with octave, velocity and sustain keys', () => {
    kb.setTarget('rk_a', 'Keys'); kb.setPage(true);
    const a = key('KeyA');
    dispatch('keydown', a);
    expect(sent).toEqual([['rk_a', [0x90, 60, 100]]]);
    expect(a.defaulted && a.stopped).toBe(true);
    expect(useRackKeyboard.getState().held).toEqual([60]);
    dispatch('keydown', key('KeyA', { repeat: true }));
    expect(sent).toHaveLength(1); // a held key doesn't retrigger
    dispatch('keydown', key('KeyW')); // C#
    dispatch('keydown', key('KeyK')); // C an octave up
    expect(sent.slice(1)).toEqual([['rk_a', [0x90, 61, 100]], ['rk_a', [0x90, 72, 100]]]);
    dispatch('keyup', key('KeyA'));
    expect(sent.at(-1)).toEqual(['rk_a', [0x80, 60, 0]]);
    dispatch('keyup', key('KeyW')); dispatch('keyup', key('KeyK'));
    sent.length = 0;
    // Z/X octave, C/V velocity.
    dispatch('keydown', key('KeyZ')); dispatch('keyup', key('KeyZ'));
    dispatch('keydown', key('KeyC')); dispatch('keyup', key('KeyC'));
    expect(useRackKeyboard.getState()).toMatchObject({ octave: 3, velocity: 84 });
    dispatch('keydown', key('KeyD')); // E3
    expect(sent).toEqual([['rk_a', [0x90, 52, 84]]]);
    dispatch('keyup', key('KeyD'));
    dispatch('keydown', key('KeyX')); dispatch('keydown', key('KeyX')); dispatch('keydown', key('KeyV')); dispatch('keydown', key('KeyV'));
    expect(useRackKeyboard.getState()).toMatchObject({ octave: 5, velocity: 116 });
    // Every semitone of the layout is there, in order.
    expect(Object.values(RACK_KEYS)).toEqual(Array.from({ length: 18 }, (_, i) => i));
    // Shift sustains: a released key keeps sounding until Shift goes up.
    sent.length = 0;
    dispatch('keydown', key('ShiftLeft', { shiftKey: true }));
    dispatch('keydown', key('KeyA', { shiftKey: true }));
    dispatch('keyup', key('KeyA', { shiftKey: true }));
    expect(sent).toEqual([['rk_a', [0x90, 72, 116]]]);
    expect(useRackKeyboard.getState()).toMatchObject({ sustain: true, held: [72] });
    dispatch('keyup', key('ShiftLeft'));
    expect(sent.at(-1)).toEqual(['rk_a', [0x80, 72, 0]]);
    expect(useRackKeyboard.getState().held).toEqual([]);
  });

  it('claims every plain key and lets ⌘ combos, Tab and typing in fields through', () => {
    kb.setTarget('rk_a'); kb.setPage(true);
    const f = key('KeyF'); // "fit view" in the Studio, a note here? No: F is a white key (F4).
    dispatch('keydown', f);
    expect(f.stopped).toBe(true);
    expect(sent).toEqual([['rk_a', [0x90, 65, 100]]]);
    const one = key('Digit1'); // not a piano key, still swallowed so no shortcut fires
    dispatch('keydown', one);
    expect(one.stopped && one.defaulted).toBe(true);
    const save = key('KeyS', { metaKey: true });
    dispatch('keydown', save);
    expect(save.stopped).toBe(false);
    expect(keyboardClaimed(save)).toBe(false);
    const tab = key('Tab');
    dispatch('keydown', tab);
    expect(tab.stopped).toBe(false);
    const typing = key('KeyA', { target: { tagName: 'INPUT' } as unknown as EventTarget });
    dispatch('keydown', typing);
    expect(typing.stopped).toBe(false);
    expect(keyboardClaimed(typing)).toBe(false);
    expect(sent).toHaveLength(1);
    // What the other handlers ask.
    expect(keyboardClaimed(key('KeyA'))).toBe(true);
    expect(keyboardClaimed(key('Space'))).toBe(true);
  });

  it('Esc gives the keyboard back: notes off, the claim gone, the record told', () => {
    kb.setTarget('rk_a', 'Keys'); kb.setPage(true);
    dispatch('keydown', key('KeyA'));
    dispatch('keydown', key('KeyS'));
    sent.length = 0;
    const esc = key('Escape');
    dispatch('keydown', esc);
    expect(esc.stopped).toBe(true);
    expect(sent.sort()).toEqual([['rk_a', [0x80, 60, 0]], ['rk_a', [0x80, 62, 0]]]);
    expect(released).toEqual(['rk_a']);
    expect(kb.active()).toBe('');
    expect(keyboardClaimed()).toBe(false);
    // The record follows (keyboard: false), and says so.
    kb.setTarget('');
    expect(useRackKeyboard.getState().rackId).toBe('');
  });

  it('leaving the Play page gives it back too, and a rack change lets go of its notes', () => {
    kb.setTarget('rk_a'); kb.setPage(true);
    dispatch('keydown', key('KeyA'));
    kb.setPage(false);
    expect(sent.at(-1)).toEqual(['rk_a', [0x80, 60, 0]]);
    expect(released).toEqual(['rk_a']);
    expect(keyboardClaimed()).toBe(false);
    // Back on Play, with another rack taking over mid-note.
    kb.setPage(true); kb.setTarget('rk_b', 'Bass');
    sent.length = 0;
    dispatch('keydown', key('KeyH'));
    expect(sent).toEqual([['rk_b', [0x90, 69, 100]]]);
    kb.setTarget('rk_c', 'Lead');
    expect(sent.at(-1)).toEqual(['rk_b', [0x80, 69, 0]]);
    expect(keyboardOwner()).toBe('rk_c');
    // The window losing focus lets go of everything.
    dispatch('keydown', key('KeyJ'));
    dispatch('blur', {});
    expect(sent.at(-1)).toEqual(['rk_c', [0x80, 71, 0]]);
    expect(useRackKeyboard.getState().held).toEqual([]);
  });

  it('the card can set the octave and velocity too', () => {
    kb.setTarget('rk_a'); kb.setPage(true);
    kb.setOctave(2); kb.setVelocity(500);
    expect(useRackKeyboard.getState()).toMatchObject({ octave: 2, velocity: 127 });
    dispatch('keydown', key('KeyA'));
    expect(sent).toEqual([['rk_a', [0x90, 36, 127]]]);
  });
});
