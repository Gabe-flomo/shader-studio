/**
 * Autosave as versions, the rules (files/versionAutosave.ts): on a timer, only when the graph
 * changed, only for a saved graph, ending when you leave it, waiting while something holds the
 * graph, and pausing when a save fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from '../autosave';
import {
  AUTOSAVE_SPAN_MS, HELD_RETRY_MS, VersionAutosave, nextInLabel, parseAutosaveDefaultOn, parseAutosaveMinutes,
  type AutosaveGraph, type AutosaveSaveResult,
} from '../versionAutosave';

const fakeTimers = (): Timers => ({
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: h => clearInterval(h as ReturnType<typeof setInterval>),
});

const MIN = 60_000;

function setup(opts: { minutes?: number; defaultOn?: boolean; result?: () => AutosaveSaveResult } = {}) {
  const g: AutosaveGraph = { name: null, dirty: false, busy: false };
  let minor = 0;
  const save = vi.fn(async (_name: string): Promise<AutosaveSaveResult> => {
    const r = opts.result?.() ?? { ok: true as const };
    if (r.ok) { g.dirty = false; minor++; return { ok: true, label: `1.${minor}` }; }
    return r;
  });
  const onPaused = vi.fn();
  const onEnded = vi.fn();
  const a = new VersionAutosave({ graph: () => ({ ...g }), save, timers: fakeTimers(), onPaused, onEnded }, { minutes: opts.minutes ?? 5, defaultOn: opts.defaultOn });
  const open = (name: string | null) => { g.name = name; g.dirty = false; a.graphChanged(); };
  return { g, a, save, open, onPaused, onEnded };
}

describe('the settings', () => {
  it('reads the interval (5 min by default) and the default-on switch', () => {
    expect(parseAutosaveMinutes(null)).toBe(5);
    expect(parseAutosaveMinutes('junk')).toBe(5);
    expect(parseAutosaveMinutes('0')).toBe(5);
    for (const m of [2, 5, 10, 15]) expect(parseAutosaveMinutes(String(m))).toBe(m);
    expect(parseAutosaveMinutes('0.25')).toBe(0.25); // a dev override
    expect(parseAutosaveDefaultOn(null)).toBe(true);
    expect(parseAutosaveDefaultOn('off')).toBe(false);
  });

  it('says when the next one is', () => {
    expect(nextInLabel(null, 0)).toBe('');
    expect(nextInLabel(40_000, 0)).toBe('next in 40 s');
    expect(nextInLabel(150_000, 0)).toBe('next in 3 min');
  });
});

describe('autosave as versions', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('saves on the interval, only when the graph changed', async () => {
    const { g, a, save, open } = setup();
    open('Glow');
    expect(a.status).toMatchObject({ graph: 'Glow', on: true });
    expect(a.status.nextAt).toBe(Date.now() + 5 * MIN);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(save).not.toHaveBeenCalled(); // nothing changed
    g.dirty = true;
    await vi.advanceTimersByTimeAsync(5 * MIN - 1000);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('Glow');
    expect(a.status.last).toEqual({ label: '1.1', at: Date.now() });
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(save).toHaveBeenCalledTimes(1); // no change since
    g.dirty = true;
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(save).toHaveBeenCalledTimes(2);
    expect(a.status.last?.label).toBe('1.2');
    a.dispose();
  });

  it('follows the interval setting (2, 10, 15 min)', async () => {
    const { g, a, save, open } = setup({ minutes: 2 });
    open('Glow'); g.dirty = true;
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(save).toHaveBeenCalledTimes(1);
    a.setMinutes(15); g.dirty = true;
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(save).toHaveBeenCalledTimes(2);
    a.dispose();
  });

  it('an untitled graph never autosaves, and turning it on does nothing', async () => {
    const { g, a, save, open } = setup();
    open(null); g.dirty = true;
    a.setOn(true);
    expect(a.status.on).toBe(false);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(save).not.toHaveBeenCalled();
  });

  it('starts when a named graph is opened or first saved, and stops when you leave it', async () => {
    const { g, a, save, open } = setup();
    open(null); g.dirty = true;
    // Saving the untitled graph gives it a name: autosave starts for it.
    g.name = 'Fresh'; a.graphChanged();
    expect(a.status).toMatchObject({ graph: 'Fresh', on: true });
    // Leaving it (a new graph, an example): it stops and nothing is saved into "Fresh".
    open(null); g.dirty = true;
    expect(a.status).toMatchObject({ graph: null, on: false, nextAt: null });
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(save).not.toHaveBeenCalled();
  });

  it('is on for this graph only: turned off here, it is on again for the next graph', async () => {
    const { g, a, save, open } = setup();
    open('A'); a.setOn(false); g.dirty = true;
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(save).not.toHaveBeenCalled();
    open('B'); g.dirty = true;
    expect(a.status.on).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(save).toHaveBeenCalledWith('B');
    a.dispose();
  });

  it('can start off by default', () => {
    const { a, open } = setup({ defaultOn: false });
    open('Glow');
    expect(a.status).toMatchObject({ graph: 'Glow', on: false, nextAt: null });
  });

  it('"For 30 minutes" ends on its own', async () => {
    const { g, a, save, open, onEnded } = setup();
    open('Glow');
    a.setOn(true, '30m');
    expect(a.status.until).toBe(Date.now() + AUTOSAVE_SPAN_MS);
    for (let i = 0; i < 6; i++) { g.dirty = true; await vi.advanceTimersByTimeAsync(5 * MIN); }
    expect(save).toHaveBeenCalledTimes(6);
    expect(onEnded).toHaveBeenCalledWith('Glow');
    expect(a.status.on).toBe(false);
    g.dirty = true;
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(save).toHaveBeenCalledTimes(6);
  });

  it('a save by hand starts the countdown again', async () => {
    const { g, a, save, open } = setup();
    open('Glow'); g.dirty = true;
    await vi.advanceTimersByTimeAsync(4 * MIN);
    g.dirty = false; a.saved(); // saved by hand
    g.dirty = true;
    await vi.advanceTimersByTimeAsync(4 * MIN);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    expect(save).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it('waits while something holds the graph (a scratch graph, a recording)', async () => {
    const { g, a, save, open } = setup();
    open('Glow'); g.dirty = true; g.busy = true;
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HELD_RETRY_MS * 3);
    expect(save).not.toHaveBeenCalled();
    g.busy = false;
    await vi.advanceTimersByTimeAsync(HELD_RETRY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it('a failed save pauses it with the reason, until resumed or a save by hand works', async () => {
    let full = true;
    const { g, a, save, open, onPaused } = setup({ result: () => (full ? { ok: false, error: 'Browser storage is full.' } : { ok: true }) });
    open('Glow'); g.dirty = true;
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onPaused).toHaveBeenCalledWith('Glow', 'Browser storage is full.');
    expect(a.status).toMatchObject({ on: true, paused: 'Browser storage is full.', nextAt: null });
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(save).toHaveBeenCalledTimes(1); // paused: no retry storm
    full = false;
    a.resume();
    expect(a.status.paused).toBeNull();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(save).toHaveBeenCalledTimes(2);
    // Fails again, then a save by hand lifts the pause.
    full = true; g.dirty = true;
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(a.status.paused).not.toBeNull();
    a.saved();
    expect(a.status.paused).toBeNull();
    expect(a.status.nextAt).toBe(Date.now() + 5 * MIN);
    a.dispose();
  });
});
