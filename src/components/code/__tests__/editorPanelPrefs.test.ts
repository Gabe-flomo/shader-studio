/**
 * The code editors' side panels (editorPanelPrefs.ts): the function palette starts closed, the
 * Inputs panel open, and both are remembered across sessions; ⌘[ / ⌘] pick the panel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }, key: () => null, length: 0, clear: () => store.clear(),
  });
  return store;
});

import { DEFAULT_EDITOR_PANELS, EDITOR_PANELS_KEY, loadEditorPanels, panelForShortcut, useEditorPanels } from '../editorPanelPrefs';

describe('editor side panels', () => {
  beforeEach(() => { storage.clear(); useEditorPanels.getState().reload(); });

  it('starts with the function palette closed and the inputs open', () => {
    expect(DEFAULT_EDITOR_PANELS).toEqual({ functions: false, inputs: true });
    expect(useEditorPanels.getState().open).toEqual({ functions: false, inputs: true });
  });

  it('remembers opening the functions across a reload (a new session)', () => {
    useEditorPanels.getState().toggle('functions');
    expect(JSON.parse(storage.get(EDITOR_PANELS_KEY)!)).toEqual({ functions: true, inputs: true });
    useEditorPanels.setState({ open: { ...DEFAULT_EDITOR_PANELS } });
    useEditorPanels.getState().reload();
    expect(useEditorPanels.getState().open.functions).toBe(true);
  });

  it('remembers closing it again, and folding the inputs', () => {
    useEditorPanels.getState().set('functions', true);
    useEditorPanels.getState().set('functions', false);
    useEditorPanels.getState().set('inputs', false);
    expect(loadEditorPanels()).toEqual({ functions: false, inputs: false });
  });

  it('falls back to the defaults for junk or partial storage, and when storage throws', () => {
    storage.set(EDITOR_PANELS_KEY, JSON.stringify({ functions: 'yes', inputs: false, extra: 1 }));
    expect(loadEditorPanels()).toEqual({ functions: false, inputs: false });
    storage.set(EDITOR_PANELS_KEY, '{not json');
    expect(loadEditorPanels()).toEqual(DEFAULT_EDITOR_PANELS);
    const setItem = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('quota'); };
    try {
      useEditorPanels.getState().toggle('functions');
      expect(useEditorPanels.getState().open.functions).toBe(true);
    } finally { localStorage.setItem = setItem; }
  });

  it('maps ⌘[ to the inputs and ⌘] to the functions, and nothing else', () => {
    const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
      panelForShortcut({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
    expect(k('[', { metaKey: true })).toBe('inputs');
    expect(k(']', { ctrlKey: true })).toBe('functions');
    expect(k(']')).toBeNull();
    expect(k(']', { metaKey: true, shiftKey: true })).toBeNull();
    expect(k('p', { metaKey: true })).toBeNull();
  });
});
