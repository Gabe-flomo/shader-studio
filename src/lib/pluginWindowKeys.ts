/**
 * pluginWindowKeys.ts — computer-keyboard notes while a plug-in window has
 * focus (desktop; docs/audio-engine.md, "Computer keyboard").
 *
 * A native plug-in window isn't the WebView, so its keys never reach the DOM.
 * While a rack plays from the keyboard, rackKeyboard asks the native side to
 * forward (`ae_keys_forward`); every key the plug-in's view doesn't use (so
 * never typing into its text fields) comes back as `plugin-window:key` with
 * the DOM event's fields (`code`, `key`, modifiers, `repeat`) and goes through
 * the same RackKeyboard.handleKeyDown / handleKeyUp as a DOM key: the same
 * notes, octave, velocity, sustain, and Esc giving the keyboard back. "blur"
 * (the plug-in window lost focus) lets go of held notes.
 */
import type { KeyLike, RackKeyboard } from './rackKeyboard';

export const PLUGIN_KEY_EVENT = 'plugin-window:key';

export interface PluginKey {
  type: 'down' | 'up' | 'blur';
  code: string;
  key: string;
  repeat: boolean;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  /** The plug-in window's "rack/slot". */
  window: string;
}

/** The event's payload, checked; null for anything else. */
export function parsePluginKey(raw: unknown): PluginKey | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== 'down' && o.type !== 'up' && o.type !== 'blur') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  if (o.type !== 'blur' && !str(o.code)) return null;
  return {
    type: o.type,
    code: str(o.code),
    key: str(o.key),
    repeat: o.repeat === true,
    shift: o.shift === true,
    meta: o.meta === true,
    ctrl: o.ctrl === true,
    alt: o.alt === true,
    window: str(o.window),
  };
}

/** The key as RackKeyboard reads a DOM KeyboardEvent (no DOM target: never a typing field). */
export function pluginKeyLike(p: PluginKey): KeyLike {
  return {
    code: p.code, key: p.key, repeat: p.repeat,
    shiftKey: p.shift, metaKey: p.meta, ctrlKey: p.ctrl, altKey: p.alt,
    target: null,
    preventDefault() {},
    stopImmediatePropagation() {},
  };
}

/** A key from a plug-in window, played exactly like the same key in the app's window. */
export function applyPluginKey(kb: RackKeyboard, p: PluginKey): void {
  if (p.type === 'blur') kb.blur();
  else if (p.type === 'down') kb.handleKeyDown(pluginKeyLike(p));
  else kb.handleKeyUp(pluginKeyLike(p));
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type Listen = (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;

/** Join a RackKeyboard to the desktop app: forwarding follows its listening; forwarded keys play it. */
export async function wirePluginWindowKeys(kb: RackKeyboard, bridge: { invoke: Invoke; listen: Listen }): Promise<() => void> {
  const unlisten = await bridge.listen(PLUGIN_KEY_EVENT, e => {
    const p = parsePluginKey(e.payload);
    if (p) applyPluginKey(kb, p);
  });
  kb.configure({ forward: on => { void bridge.invoke('ae_keys_forward', { on }).catch(() => {}); } });
  return unlisten;
}
