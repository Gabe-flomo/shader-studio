import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutosaveScheduler, CHANGE_DEBOUNCE_MS, CHANGE_MAX_WAIT_MS, buildSnapshot, graphHasContent, newSessionMarker, parseAutosaveMode,
  parsePluginCrash, parseSessionMarker, parseSnapshot, planRotation, recoverDecision, snapshotFileName, snapshotFileTime,
  type SessionMarker, type SnapshotMeta, type Timers,
} from '../autosave';

const fakeTimers = (): Timers => ({
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: h => clearInterval(h as ReturnType<typeof setInterval>),
});

describe('the autosave setting', () => {
  it('defaults to every 5 minutes and reads the four modes', () => {
    expect(parseAutosaveMode(null)).toBe('5m');
    expect(parseAutosaveMode('nonsense')).toBe('5m');
    for (const m of ['off', '1m', '5m', 'change'] as const) expect(parseAutosaveMode(m)).toBe(m);
  });
});

describe('the scheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_700_000_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('every 5 minutes: writes on the tick only when something changed', async () => {
    const write = vi.fn();
    const s = new AutosaveScheduler({ mode: '5m', write, timers: fakeTimers() });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(write).not.toHaveBeenCalled(); // nothing changed
    s.changed(); s.changed();
    await vi.advanceTimersByTimeAsync(299_000);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(write).toHaveBeenCalledTimes(1); // no change since
    s.dispose();
  });

  it('every minute ticks every 60 s', async () => {
    const write = vi.fn();
    const s = new AutosaveScheduler({ mode: '1m', write, timers: fakeTimers() });
    s.changed();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(write).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it('on every change: 2 s after the last change, one write for a burst', async () => {
    const write = vi.fn();
    const s = new AutosaveScheduler({ mode: 'change', write, timers: fakeTimers() });
    s.changed();
    await vi.advanceTimersByTimeAsync(1_500);
    s.changed();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS - 1_500);
    expect(write).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it('on every change: a stream of changes is still written within 10 s', async () => {
    const write = vi.fn();
    const s = new AutosaveScheduler({ mode: 'change', write, timers: fakeTimers() });
    for (let t = 0; t < CHANGE_MAX_WAIT_MS + 1_000; t += 500) { s.changed(); await vi.advanceTimersByTimeAsync(500); }
    expect(write).toHaveBeenCalled();
    s.dispose();
  });

  it('off writes nothing, and switching to it stops the timers', async () => {
    const write = vi.fn();
    const s = new AutosaveScheduler({ mode: '1m', write, timers: fakeTimers() });
    s.setMode('off');
    s.changed();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(write).not.toHaveBeenCalled();
    expect(await s.flush()).toBe(false);
    s.setMode('change'); // a pending change is written soon after switching on
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS);
    expect(write).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it('waits while held (a render), then writes', async () => {
    const write = vi.fn();
    let held = true;
    const s = new AutosaveScheduler({ mode: 'change', write, held: () => held, timers: fakeTimers() });
    s.changed();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(write).not.toHaveBeenCalled();
    expect(s.hasPending).toBe(true);
    held = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(write).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it('a failed write stays pending', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const s = new AutosaveScheduler({ mode: '1m', write, timers: fakeTimers() });
    s.changed();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.hasPending).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(s.hasPending).toBe(false);
    s.dispose();
  });
});

describe('snapshots', () => {
  it('names sort by time, and the newest 3 are kept', () => {
    const files = [1000000000001, 1000000000005, 1000000000003, 1000000000002].map(snapshotFileName);
    const { keep, remove } = planRotation([...files, 'session.json', 'autosave-x.json']);
    expect(keep.map(snapshotFileTime)).toEqual([1000000000005, 1000000000003, 1000000000002]);
    expect(remove).toEqual([snapshotFileName(1000000000001)]);
    expect(planRotation(files.slice(0, 2)).remove).toEqual([]);
  });

  it('round-trips the graph file exactly and says which project it was', () => {
    const graph = { nodes: [{ id: 'n1', type: 'uv', params: { a: 1 } }], looseGroups: [], play: { controls: [] }, layout: 3 };
    const { file, body } = buildSnapshot(JSON.stringify(graph, null, 2), { name: null, version: null, dirty: true }, 's1', 1_700_000_000_000);
    const snap = parseSnapshot(file, body)!;
    expect(snap.graph).toEqual(graph);
    expect(snap.project).toEqual({ name: null, version: null, dirty: true });
    expect(snap.session).toBe('s1');
    expect(snap.at).toBe(1_700_000_000_000);
    expect(parseSnapshot(file, '{"format":"playfield-autosave","graph":{}}')).toBeNull();
    expect(parseSnapshot(file, 'not json')).toBeNull();
  });

  it('an empty canvas with no Play setup has nothing worth keeping', () => {
    expect(graphHasContent({ nodes: [] })).toBe(false);
    expect(graphHasContent({ nodes: [{}] })).toBe(true);
    expect(graphHasContent({ nodes: [], play: { layers: [] } })).toBe(true);
  });
});

describe('the recover decision', () => {
  const fmt = () => '12:41';
  const prev: SessionMarker = { ...newSessionMarker('s1', 1000), project: { name: null, version: null, dirty: true } };
  const snap: SnapshotMeta = { file: snapshotFileName(5000), at: 5000, session: 's1', project: { name: null, version: null, dirty: true } };

  it('offers an unclean session’s unsaved snapshot', () => {
    const d = recoverDecision(prev, snap, null, fmt);
    expect(d.offer).toBe(true);
    if (d.offer) expect(d.message).toBe('Playfield closed unexpectedly while “Untitled” was open (last autosaved 12:41).');
  });

  it('names the plug-in that was loading', () => {
    const crash = parsePluginCrash({ name: 'Kontakt 7', code: 'aumu/Ni$D/-NI-', at: 4000, stage: 'load' });
    const d = recoverDecision(prev, { ...snap, project: { name: 'Rings', version: 2, dirty: true } }, crash, fmt);
    expect(d.offer && d.message).toContain('while loading Kontakt 7, with “Rings” open (last autosaved 12:41)');
  });

  it('does not offer after a clean quit, without a snapshot, for another session, with nothing unsaved, or after a later save', () => {
    expect(recoverDecision(null, snap, null, fmt)).toMatchObject({ offer: false, reason: 'no-session' });
    expect(recoverDecision({ ...prev, cleanExit: true }, snap, null, fmt)).toMatchObject({ offer: false, reason: 'clean' });
    expect(recoverDecision(prev, null, null, fmt)).toMatchObject({ offer: false, reason: 'no-snapshot' });
    expect(recoverDecision(prev, { ...snap, session: 's0' }, null, fmt)).toMatchObject({ offer: false, reason: 'other-session' });
    expect(recoverDecision(prev, { ...snap, project: { ...snap.project, dirty: false } }, null, fmt)).toMatchObject({ offer: false, reason: 'nothing-unsaved' });
    expect(recoverDecision({ ...prev, lastSaveAt: 6000 }, snap, null, fmt)).toMatchObject({ offer: false, reason: 'saved-since' });
    expect(recoverDecision({ ...prev, lastSaveAt: 4000 }, snap, null, fmt).offer).toBe(true);
  });

  it('reads markers defensively', () => {
    expect(parseSessionMarker('{"id":"a","cleanExit":true,"lastSaveAt":5}')).toMatchObject({ id: 'a', cleanExit: true, lastSaveAt: 5 });
    expect(parseSessionMarker('nope')).toBeNull();
    expect(parseSessionMarker({ id: '' })).toBeNull();
    expect(parsePluginCrash({ name: 'X' })).toBeNull();
    expect(parsePluginCrash({ code: 'aufx/abcd/efgh' })).toMatchObject({ name: 'aufx/abcd/efgh', at: 0 });
  });
});
