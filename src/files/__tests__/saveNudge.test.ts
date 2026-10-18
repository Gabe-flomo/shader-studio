import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { n } from '../../store/graphBuilder';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { SAVE_NUDGE_AFTER_MS, checkSaveNudgeNow, dismissSaveNudge, installSaveNudge, shouldNudge, useSaveNudge } from '../saveNudge';

let stop: (() => void) | null = null;
afterEach(() => { stop?.(); stop = null; useSaveNudge.setState({ open: false }); });

describe('the save nudge', () => {
  it('asks only for a never-saved graph edited 15 minutes ago, once, unless waved off', () => {
    const base = { saved: false, scratch: false, since: 0, now: SAVE_NUDGE_AFTER_MS, dismissed: false, shown: false };
    expect(shouldNudge(base)).toBe(true);
    expect(shouldNudge({ ...base, now: SAVE_NUDGE_AFTER_MS - 1 })).toBe(false);
    expect(shouldNudge({ ...base, saved: true })).toBe(false);
    expect(shouldNudge({ ...base, since: null })).toBe(false);
    expect(shouldNudge({ ...base, dismissed: true })).toBe(false);
    expect(shouldNudge({ ...base, shown: true })).toBe(false);
    expect(shouldNudge({ ...base, scratch: true })).toBe(false);
  });

  it('the clock starts at the first edit of a new graph, and the dialog opens after 15 minutes', () => {
    let t = 1000;
    useNodeGraphStore.setState({ currentGraph: null, scratch: null });
    stop = installSaveNudge(() => t);
    checkSaveNudgeNow(t + SAVE_NUDGE_AFTER_MS * 2);
    expect(useSaveNudge.getState().open).toBe(false); // nothing edited yet
    useNodeGraphStore.setState({ nodes: [n('output', 'o', 0, 0, {})] });
    t += SAVE_NUDGE_AFTER_MS - 1;
    checkSaveNudgeNow(t);
    expect(useSaveNudge.getState().open).toBe(false);
    checkSaveNudgeNow(t + 1);
    expect(useSaveNudge.getState().open).toBe(true);
  });

  it('waving it off stops it for this graph; a new graph starts over', () => {
    let t = 0;
    useNodeGraphStore.setState({ currentGraph: null, scratch: null });
    stop = installSaveNudge(() => t);
    useNodeGraphStore.setState({ nodes: [n('output', 'o2', 0, 0, {})] });
    t = SAVE_NUDGE_AFTER_MS;
    checkSaveNudgeNow(t);
    dismissSaveNudge();
    checkSaveNudgeNow(t * 3);
    expect(useSaveNudge.getState().open).toBe(false);
    // Another graph loaded: a new epoch, a fresh clock
    useNodeGraphStore.setState(s => ({ graphEpoch: s.graphEpoch + 1 }));
    useNodeGraphStore.setState({ nodes: [n('output', 'o3', 0, 0, {})] });
    checkSaveNudgeNow(t + SAVE_NUDGE_AFTER_MS);
    expect(useSaveNudge.getState().open).toBe(true);
  });

  it('saving closes it and stops the clock', () => {
    let t = 0;
    useNodeGraphStore.setState({ currentGraph: null, scratch: null });
    stop = installSaveNudge(() => t);
    useNodeGraphStore.setState({ nodes: [n('output', 'o4', 0, 0, {})] });
    useSaveNudge.setState({ open: true });
    useNodeGraphStore.setState({ currentGraph: { name: 'Mine', version: 1, major: 1, minor: 0, latest: true } });
    expect(useSaveNudge.getState().open).toBe(false);
    checkSaveNudgeNow(SAVE_NUDGE_AFTER_MS * 5);
    expect(useSaveNudge.getState().open).toBe(false);
  });
});
