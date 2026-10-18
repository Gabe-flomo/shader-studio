// @vitest-environment jsdom
/**
 * The browser warns before leaving with unsaved changes (beforeunload), and a tab left that way
 * offers its work back on the next load (a CLOSED_UNSAVED session, not a crash).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { hasUnsavedWork, installUnsavedGuard, useAutosave } from '../recovery';
import { CLOSED_UNSAVED, newSessionMarker, reasonWords, recoverDecision, type SnapshotMeta } from '../autosave';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';

const leave = () => {
  const e = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

describe('beforeunload', () => {
  let off: (() => void) | null = null;
  afterEach(() => { off?.(); off = null; useNodeGraphStore.setState({ graphDirty: false, scratch: null }); });

  it('asks before leaving only when there are unsaved changes', () => {
    useAutosave.setState({ mode: 'off' });
    off = installUnsavedGuard();
    useNodeGraphStore.setState({ graphDirty: false });
    expect(hasUnsavedWork()).toBe(false);
    expect(leave()).toBe(false);
    useNodeGraphStore.setState({ graphDirty: true });
    expect(hasUnsavedWork()).toBe(true);
    expect(leave()).toBe(true);
  });

  it('an untitled graph counts once it was edited after it opened; opening another starts over', () => {
    useAutosave.setState({ mode: 'off' });
    off = installUnsavedGuard();
    useNodeGraphStore.getState().loadExampleGraph('blank');
    expect(useNodeGraphStore.getState().currentGraph).toBeNull();
    expect(leave()).toBe(false);
    useNodeGraphStore.getState().addNode('time', { x: 0, y: 600 });
    expect(useNodeGraphStore.getState().graphDirty).toBe(false);
    expect(leave()).toBe(true);
    useNodeGraphStore.getState().loadExampleGraph('blank');
    expect(leave()).toBe(false);
  });

  it('a GLSL conversion’s scratch graph is not the project', () => {
    useNodeGraphStore.setState({ graphDirty: true, scratch: {} as never });
    expect(hasUnsavedWork()).toBe(false);
  });

  it('gone after uninstall', () => {
    off = installUnsavedGuard();
    off();
    off = null;
    useNodeGraphStore.setState({ graphDirty: true });
    expect(leave()).toBe(false);
  });
});

describe('a tab left with unsaved changes', () => {
  it('is offered back on the next load, worded as a closed tab, not a crash', () => {
    const prev = { ...newSessionMarker('s1', 1000), cleanExit: false, reason: CLOSED_UNSAVED };
    const snap: SnapshotMeta = { file: 'autosave-2000.json', at: 2000, session: 's1', project: { name: null, version: null, dirty: true }, work: 5 };
    const d = recoverDecision(prev, [snap], null, () => '12:00');
    expect(d.offer).toBe(true);
    if (d.offer) expect(d.message).toMatch(/^The tab closed with unsaved changes while “Untitled” was open/);
    expect(reasonWords(CLOSED_UNSAVED)).toMatch(/closed or reloaded/);
  });
});
