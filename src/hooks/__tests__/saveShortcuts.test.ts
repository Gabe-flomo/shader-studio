// @vitest-environment jsdom
/**
 * ⌘S saves (a new Minor version; the first save asks for a name), ⇧⌘S is Save as, ⇧⌘E exports
 * the .play file and ⌘A selects every node at the canvas's level (not while typing).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { DEFAULT_ACTIONS, findShortcut, loadShortcutMap, normaliseCombo, type ShortcutMap } from '../useShortcuts';
import { OPEN_SAVE_FORM, saveAsShortcut, saveShortcut, selectAllNodesAtLevel } from '../../components/shell/graphShortcuts';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';

const defaults = (): ShortcutMap => Object.fromEntries(DEFAULT_ACTIONS.map(a => [a.id, a.defaultCombo]));
const combo = (id: string) => normaliseCombo(DEFAULT_ACTIONS.find(a => a.id === id)!.defaultCombo);

describe('save / export / select-all defaults', () => {
  beforeEach(() => localStorage.clear());

  it('⌘S saves, ⇧⌘S is Save as, ⇧⌘E exports, ⌘A selects all', () => {
    expect(combo('save')).toBe('cmd+s');
    expect(combo('saveAs')).toBe('cmd+shift+s');
    expect(combo('export')).toBe('cmd+shift+e');
    expect(combo('selectAll')).toBe('cmd+a');
    expect(findShortcut(defaults(), 'cmd+s')).toBe('save');
    expect(findShortcut(defaults(), 'shift+cmd+s')).toBe('saveAs');
    expect(findShortcut(defaults(), 'cmd+shift+e')).toBe('export');
    expect(DEFAULT_ACTIONS.find(a => a.id === 'selectAll')!.label).toBe('Select all nodes');
  });

  it('no two defaults share a combo', () => {
    const combos = DEFAULT_ACTIONS.map(a => normaliseCombo(a.defaultCombo));
    expect(new Set(combos).size).toBe(combos.length);
  });

  it('⌘A and ⌘S do nothing while typing in a field', () => {
    expect(findShortcut(defaults(), 'cmd+a', true)).toBeNull();
    expect(findShortcut(defaults(), 'cmd+s', true)).toBeNull();
  });

  it('a stored map from before the move follows it: export on ⌘S becomes ⇧⌘E', () => {
    localStorage.setItem('shader-studio:shortcuts', JSON.stringify({ ...defaults(), export: 'cmd+s', save: undefined, saveAs: undefined }));
    const map = loadShortcutMap();
    expect(map.export).toBe('cmd+shift+e');
    expect(findShortcut(map, 'cmd+s')).toBe('save');
  });

  it('a rebinding the user chose is kept', () => {
    localStorage.setItem('shader-studio:shortcuts', JSON.stringify({ ...defaults(), export: 'cmd+shift+x' }));
    expect(loadShortcutMap().export).toBe('cmd+shift+x');
  });
});

describe('saveShortcut', () => {
  it('with nothing saved yet, opens the save form asking for a name', async () => {
    useNodeGraphStore.setState({ currentGraph: null });
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_SAVE_FORM, on);
    expect(await saveShortcut()).toBe('form');
    window.removeEventListener(OPEN_SAVE_FORM, on);
    expect(seen).toEqual([{ asNew: true }]);
  });

  it('with a saved graph open, saves its next Minor version straight away', async () => {
    const saveGraph = vi.fn(async () => ({ ok: true as const }));
    useNodeGraphStore.setState({ currentGraph: { name: 'Waves', major: 2, minor: 3, latest: true } as never, saveGraph: saveGraph as never });
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_SAVE_FORM, on);
    expect(await saveShortcut()).toBe('saved');
    window.removeEventListener(OPEN_SAVE_FORM, on);
    expect(saveGraph).toHaveBeenCalledWith('Waves', '', 'minor');
    expect(seen).toEqual([]);
  });

  it('Save as always opens the form on "save under a name"', () => {
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_SAVE_FORM, on);
    saveAsShortcut();
    window.removeEventListener(OPEN_SAVE_FORM, on);
    expect(seen).toEqual([{ asNew: true }]);
  });
});

describe('selectAllNodesAtLevel', () => {
  const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode =>
    ({ id, type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {}, ...extra }) as GraphNode;

  it('selects every top-level node', () => {
    useNodeGraphStore.setState({ nodes: [node('a'), node('b'), node('c')], activeGroupPath: [], selectedNodeIds: [] });
    expect(selectAllNodesAtLevel()).toBe(3);
    expect(useNodeGraphStore.getState().selectedNodeIds).toEqual(['a', 'b', 'c']);
  });

  it('inside a group, selects only that group’s nodes', () => {
    const g = node('g', { type: 'group', params: { subgraph: { nodes: [node('x'), node('y')], edges: [] } } as never });
    useNodeGraphStore.setState({ nodes: [node('a'), g], activeGroupPath: ['g'], selectedNodeIds: [] });
    selectAllNodesAtLevel();
    expect(useNodeGraphStore.getState().selectedNodeIds).toEqual(['x', 'y']);
    useNodeGraphStore.setState({ activeGroupPath: [] });
  });
});
