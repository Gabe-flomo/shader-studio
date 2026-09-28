/**
 * Keys from a focused plug-in window (lib/pluginWindowKeys.ts): the native
 * side's `plugin-window:key` payloads play a rack exactly as the same DOM
 * keys do, Esc gives the keyboard back, blur lets go, and forwarding follows
 * whether a rack has the keyboard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RackKeyboard, useRackKeyboard, type KeyLike } from '../rackKeyboard';
import { applyPluginKey, parsePluginKey, pluginKeyLike, wirePluginWindowKeys, PLUGIN_KEY_EVENT, type PluginKey } from '../pluginWindowKeys';

type Listener = (e: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const fakeWindow = {
  addEventListener(type: string, l: Listener) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(l); },
  removeEventListener(type: string, l: Listener) { listeners.get(type)?.delete(l); },
};
const dispatch = (type: string, e: unknown) => { for (const l of listeners.get(type) ?? []) l(e); };

const dom = (code: string, over: Partial<KeyLike> = {}): KeyLike => ({
  code, repeat: false, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, target: null,
  preventDefault() {}, stopImmediatePropagation() {}, ...over,
});
const native = (type: PluginKey['type'], code: string, over: Partial<PluginKey> = {}): PluginKey =>
  ({ type, code, key: '', repeat: false, shift: false, meta: false, ctrl: false, alt: false, window: 'rk_a/inst', ...over });

/** A played sequence: [down|up, code, shift?, repeat?]. */
type Step = ['down' | 'up', string, boolean?, boolean?];
const SEQUENCE: Step[] = [
  ['down', 'KeyA'], ['down', 'KeyA', false, true], ['down', 'KeyW'], ['down', 'KeyK'], ['up', 'KeyA'], ['up', 'KeyW'], ['up', 'KeyK'],
  ['down', 'KeyZ'], ['up', 'KeyZ'], ['down', 'KeyC'], ['up', 'KeyC'], ['down', 'KeyD'], ['up', 'KeyD'],
  ['down', 'KeyX'], ['down', 'KeyX'], ['down', 'KeyV'],
  ['down', 'ShiftLeft', true], ['down', 'KeyJ', true], ['up', 'KeyJ', true], ['down', 'Semicolon', true], ['up', 'ShiftLeft'], ['up', 'Semicolon'],
  ['down', 'Space'], ['up', 'Space'], ['down', 'Digit1'], ['down', 'KeyS', false], ['up', 'KeyS'],
];

function play(via: 'dom' | 'native'): Array<[string, number[]]> {
  listeners.clear();
  const kb = new RackKeyboard();
  const sent: Array<[string, number[]]> = [];
  kb.configure({ send: (id, bytes) => sent.push([id, bytes]) });
  kb.setTarget('rk_a', 'Keys'); kb.setPage(true);
  for (const [t, code, shift = false, repeat = false] of SEQUENCE) {
    if (via === 'dom') dispatch(t === 'down' ? 'keydown' : 'keyup', dom(code, { shiftKey: shift, repeat }));
    else applyPluginKey(kb, native(t, code, { shift, repeat }));
  }
  const state = useRackKeyboard.getState();
  sent.push(['state', [state.octave, state.velocity]]);
  kb.resetForTests();
  return sent;
}

beforeEach(() => { listeners.clear(); vi.stubGlobal('window', fakeWindow); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('keys from a plug-in window', () => {
  it('play exactly as the same keys in the app window (notes, octave, velocity, sustain)', () => {
    const fromDom = play('dom');
    const fromPlugin = play('native');
    expect(fromPlugin).toEqual(fromDom);
    expect(fromDom.length).toBeGreaterThan(8);
    expect(fromDom[0]).toEqual(['rk_a', [0x90, 60, 100]]);
  });

  it('parse the native payload and nothing else', () => {
    expect(parsePluginKey({ type: 'down', code: 'KeyA', key: 'a', repeat: true, shift: true, meta: false, ctrl: false, alt: false, window: 'rk_1/inst' }))
      .toEqual({ type: 'down', code: 'KeyA', key: 'a', repeat: true, shift: true, meta: false, ctrl: false, alt: false, window: 'rk_1/inst' });
    expect(parsePluginKey({ type: 'blur' })).toMatchObject({ type: 'blur', code: '' });
    expect(parsePluginKey({ type: 'down' })).toBeNull();
    expect(parsePluginKey({ type: 'press', code: 'KeyA' })).toBeNull();
    expect(parsePluginKey('KeyA')).toBeNull();
    expect(parsePluginKey(null)).toBeNull();
    const k = pluginKeyLike(native('down', 'KeyA', { shift: true }));
    expect(k).toMatchObject({ code: 'KeyA', shiftKey: true, target: null });
  });

  it('Esc gives the keyboard back; blur lets go of held notes and keeps it; ⌘ combos are left alone', () => {
    const kb = new RackKeyboard();
    const sent: Array<[string, number[]]> = [];
    const released: string[] = [];
    kb.configure({ send: (id, b) => sent.push([id, b]), release: id => released.push(id) });
    kb.setTarget('rk_a', 'Keys'); kb.setPage(true);
    applyPluginKey(kb, native('down', 'KeyS', { meta: true }));
    expect(sent).toEqual([]);
    applyPluginKey(kb, native('down', 'KeyA'));
    applyPluginKey(kb, native('blur', ''));
    expect(sent).toEqual([['rk_a', [0x90, 60, 100]], ['rk_a', [0x80, 60, 0]]]);
    expect(kb.active()).toBe('rk_a');
    applyPluginKey(kb, native('down', 'KeyD'));
    applyPluginKey(kb, native('down', 'Escape'));
    expect(sent.at(-1)).toEqual(['rk_a', [0x80, 64, 0]]);
    expect(released).toEqual(['rk_a']);
    expect(kb.active()).toBe('');
    kb.resetForTests();
  });

  it('forwarding follows whether a rack has the keyboard, and the event plays it', async () => {
    const kb = new RackKeyboard();
    const sent: Array<[string, number[]]> = [];
    kb.configure({ send: (id, b) => sent.push([id, b]) });
    const calls: Array<[string, unknown]> = [];
    let handler: ((e: { payload: unknown }) => void) | null = null;
    const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => { calls.push([cmd, args]); });
    const listen = vi.fn(async (ev: string, cb: (e: { payload: unknown }) => void) => { expect(ev).toBe(PLUGIN_KEY_EVENT); handler = cb; return () => { handler = null; }; });
    const unlisten = await wirePluginWindowKeys(kb, { invoke, listen });
    expect(calls).toEqual([]);
    kb.setTarget('rk_a'); kb.setPage(true);
    expect(calls).toEqual([['ae_keys_forward', { on: true }]]);
    handler!({ payload: { type: 'down', code: 'KeyG', key: 'g' } });
    expect(sent).toEqual([['rk_a', [0x90, 67, 100]]]);
    handler!({ payload: { junk: true } });
    expect(sent).toHaveLength(1);
    kb.setTarget('');
    expect(calls.at(-1)).toEqual(['ae_keys_forward', { on: false }]);
    unlisten();
    kb.resetForTests();
  });
});
