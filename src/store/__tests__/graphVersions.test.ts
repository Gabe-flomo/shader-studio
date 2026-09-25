/**
 * Saved graphs are projects with versions: saving one that is open adds a
 * version instead of a copy, older versions stay openable, and saving an
 * older one makes it the newest again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A working localStorage (Object.keys lists what is stored, like the browser's), set before the store loads.
vi.hoisted(() => {
  const ls: Record<string, string> = {};
  const hidden = (k: string, v: unknown) => Object.defineProperty(ls, k, { value: v, enumerable: false });
  hidden('getItem', (k: string) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null));
  hidden('setItem', (k: string, v: string) => { ls[k] = String(v); });
  hidden('removeItem', (k: string) => { delete ls[k]; });
  hidden('clear', () => { for (const k of Object.keys(ls)) delete ls[k]; });
  hidden('key', (i: number) => Object.keys(ls)[i] ?? null);
  Object.defineProperty(ls, 'length', { get: () => Object.keys(ls).length, enumerable: false });
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { listVersions, MAX_VERSIONS } from '../graphVersions';

const setRadius = (r: number) => useNodeGraphStore.setState({
  nodes: [{ id: 'c', type: 'circleSDF', position: { x: 0, y: 0 }, inputs: {}, outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: r } }],
});
const radius = () => useNodeGraphStore.getState().nodes[0]?.params.radius;

describe('saved graph versions', () => {
  beforeEach(() => { localStorage.clear(); useNodeGraphStore.setState({ currentGraph: null, graphDirty: false }); });

  it('saving the open graph adds a version instead of a copy', async () => {
    const s = useNodeGraphStore.getState();
    setRadius(0.1);
    await s.saveGraph('Glow');
    expect(useNodeGraphStore.getState().currentGraph).toEqual({ name: 'Glow', version: 1, latest: true });
    setRadius(0.2);
    expect(useNodeGraphStore.getState().graphDirty).toBe(true);
    await s.saveGraph('Glow', 'bigger');
    expect(s.getSavedGraphNames()).toEqual(['Glow']);
    expect(listVersions('Glow').map(v => [v.version, v.current, v.note ?? ''])).toEqual([[2, true, 'bigger'], [1, false, '']]);
    expect(useNodeGraphStore.getState().graphDirty).toBe(false);
  });

  it('older versions open, and saving one makes it the newest', async () => {
    const s = useNodeGraphStore.getState();
    setRadius(0.1); await s.saveGraph('Glow');
    setRadius(0.2); await s.saveGraph('Glow');
    expect(s.loadGraphVersion('Glow', 1).ok).toBe(true);
    expect(radius()).toBe(0.1);
    expect(useNodeGraphStore.getState().currentGraph).toEqual({ name: 'Glow', version: 1, latest: false });
    expect(useNodeGraphStore.getState().graphDirty).toBe(false);
    await s.saveGraph('Glow', 'back to small');
    expect(listVersions('Glow').map(v => v.version)).toEqual([3, 2, 1]);
    expect(s.loadSavedGraph('Glow').ok).toBe(true);
    expect(radius()).toBe(0.1);
  });

  it('graphs saved before versions count as version 1; history is capped; deleting removes it all', async () => {
    localStorage.setItem('shader-studio:Old', JSON.stringify({ nodes: [], savedAt: 5 }));
    const s = useNodeGraphStore.getState();
    await s.saveGraph('Old');
    expect(listVersions('Old').map(v => v.version)).toEqual([2, 1]);
    for (let i = 0; i < MAX_VERSIONS + 5; i++) await s.saveGraph('Old');
    expect(listVersions('Old').length).toBe(MAX_VERSIONS + 1);
    s.deleteSavedGraph('Old');
    expect(listVersions('Old')).toEqual([]);
    expect(Object.keys(localStorage).some(k => k.includes('Old'))).toBe(false);
  });
});
