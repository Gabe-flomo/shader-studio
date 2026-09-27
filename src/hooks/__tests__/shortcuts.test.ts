import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIONS, displayCombo, findShortcut, normaliseCombo, type ShortcutMap } from '../useShortcuts';

const defaults = (): ShortcutMap => Object.fromEntries(DEFAULT_ACTIONS.map(a => [a.id, a.defaultCombo]));

describe('Rebuild shortcut', () => {
  it('is registered as ⌘⇧↵ in the View group', () => {
    const a = DEFAULT_ACTIONS.find(x => x.id === 'rebuild');
    expect(a).toBeDefined();
    expect(a!.group).toBe('View');
    expect(normaliseCombo(a!.defaultCombo)).toBe('cmd+shift+enter');
    expect(displayCombo(a!.defaultCombo)).toBe('⌘⇧↵');
  });

  it('clashes with no other default, nor with browser reload (⌘R, ⌘⇧R)', () => {
    const combos = DEFAULT_ACTIONS.map(a => normaliseCombo(a.defaultCombo));
    expect(new Set(combos).size).toBe(combos.length);
    const rebuild = normaliseCombo(DEFAULT_ACTIONS.find(a => a.id === 'rebuild')!.defaultCombo);
    for (const reload of ['cmd+r', 'cmd+shift+r', 'ctrl+r', 'ctrl+shift+r', 'f5']) expect(rebuild).not.toBe(normaliseCombo(reload));
  });

  it('fires from the pressed combo whatever the modifier order', () => {
    expect(findShortcut(defaults(), 'shift+cmd+enter')).toBe('rebuild');
    expect(findShortcut(defaults(), 'cmd+enter')).toBeNull();
  });

  it('also fires while typing in a code editor; graph shortcuts do not', () => {
    expect(findShortcut(defaults(), 'cmd+shift+enter', true)).toBe('rebuild');
    expect(findShortcut(defaults(), 'cmd+z', true)).toBeNull();
    expect(findShortcut(defaults(), 'a', true)).toBeNull();
    expect(findShortcut(defaults(), 'a', false)).toBe('addNode');
  });

  it('follows a rebinding', () => {
    const map = { ...defaults(), rebuild: 'shift+b' };
    expect(findShortcut(map, 'shift+b')).toBe('rebuild');
    expect(findShortcut(map, 'cmd+shift+enter')).toBeNull();
  });
});
