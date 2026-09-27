/**
 * Full screen's state helpers: the shortcut (⌘⇧F anywhere, F alone where it
 * doesn't fit the graph and not while typing), how to go full screen (the
 * Fullscreen API, or pinning the element over the window where the API isn't
 * there, as in the desktop app), and the state after entering and leaving.
 */
import { describe, expect, it } from 'vitest';
import { fullscreenAfter, fullscreenMethod, isFullscreenKey, isTyping } from '../fullscreen';

describe('isFullscreenKey', () => {
  const where = { typing: false, plainF: true };
  it('F alone, where F is free and not while typing', () => {
    expect(isFullscreenKey({ key: 'f' }, where)).toBe(true);
    expect(isFullscreenKey({ key: 'F' }, where)).toBe(true);
    expect(isFullscreenKey({ key: 'f' }, { typing: true, plainF: true })).toBe(false);
    // The Studio's F fits the graph in view.
    expect(isFullscreenKey({ key: 'f' }, { typing: false, plainF: false })).toBe(false);
  });
  it('⌘⇧F or Ctrl+Shift+F anywhere, even while typing', () => {
    expect(isFullscreenKey({ key: 'F', metaKey: true, shiftKey: true }, { typing: true, plainF: false })).toBe(true);
    expect(isFullscreenKey({ key: 'f', ctrlKey: true, shiftKey: true }, { typing: false, plainF: false })).toBe(true);
  });
  it('not other combinations, not a held key', () => {
    expect(isFullscreenKey({ key: 'f', shiftKey: true }, where)).toBe(false); // Add Float node
    expect(isFullscreenKey({ key: 'f', metaKey: true }, where)).toBe(false); // find
    expect(isFullscreenKey({ key: 'f', altKey: true, metaKey: true, shiftKey: true }, where)).toBe(false);
    expect(isFullscreenKey({ key: 'f', repeat: true }, where)).toBe(false);
    expect(isFullscreenKey({ key: 'g' }, where)).toBe(false);
  });
});

describe('isTyping', () => {
  it('fields and editable elements', () => {
    expect(isTyping({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe('fullscreenMethod', () => {
  it('the API when the page may use it', () => {
    expect(fullscreenMethod({ apiEnabled: true, hasRequest: true, tauri: false })).toBe('api');
    expect(fullscreenMethod({ apiEnabled: true, hasRequest: true, tauri: true })).toBe('api');
  });
  it('otherwise the element pinned over the window (and the window full screen in the app)', () => {
    expect(fullscreenMethod({ apiEnabled: false, hasRequest: true, tauri: true })).toBe('window');
    expect(fullscreenMethod({ apiEnabled: true, hasRequest: false, tauri: false })).toBe('window');
  });
});

describe('fullscreenAfter', () => {
  it('entering names the target and how; leaving clears both', () => {
    expect(fullscreenAfter({ type: 'enter', target: 'canvas', how: 'api' })).toEqual({ target: 'canvas', how: 'api' });
    expect(fullscreenAfter({ type: 'enter', target: 'present', how: 'window' })).toEqual({ target: 'present', how: 'window' });
    expect(fullscreenAfter({ type: 'exit' })).toEqual({ target: null, how: null });
  });
});
