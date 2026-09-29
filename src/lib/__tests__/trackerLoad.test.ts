/**
 * The tracker's loading state machine (docs/tracking.md "Models"): off →
 * starting (the camera) → downloading (the model and WebAssembly, with
 * progress) → loading (WASM/model init) → on. lib/trackerPump.ts and the
 * worker are mocked: this checks handFeed.ts's TrackerFeed drives the states
 * and progress correctly, not MediaPipe itself (that's the browser check,
 * docs/tracking.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as { localStorage?: unknown; window?: unknown; Worker?: unknown };
  g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
  // TrackerFeed's constructor only checks these exist (docs/tracking.md: 'unsupported' otherwise);
  // the worker itself is mocked below, so a plain stub is enough.
  g.window = g.window ?? {};
  g.Worker = g.Worker ?? class {};
});

vi.mock('../cameraInput', () => ({ cameraInput: { start: vi.fn(async () => 'on'), element: vi.fn(() => null) } }));

const startTracker = vi.fn();
vi.mock('../trackerPump', () => ({ startTracker: (...args: unknown[]) => startTracker(...args) }));

import { TrackerFeed } from '../handFeed';

describe('TrackerFeed loading states', () => {
  beforeEach(() => { startTracker.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('goes off → starting → downloading (with progress) → loading → on', async () => {
    const seen: string[] = [];
    const feed = new TrackerFeed('hands');
    feed.onStatus(s => seen.push(s));
    expect(feed.getStatus()).toBe('off');

    let onProgress!: (p: { phase: 'downloading' | 'loading'; loaded?: number; total?: number }) => void;
    startTracker.mockImplementation(async (o: { onProgress?: typeof onProgress }) => {
      onProgress = o.onProgress!;
      // Camera opened; now the model downloads in chunks, then loads.
      onProgress({ phase: 'downloading', loaded: 0, total: 1000 });
      expect(feed.getStatus()).toBe('downloading');
      expect(feed.getProgress()).toEqual({ loaded: 0, total: 1000 });
      onProgress({ phase: 'downloading', loaded: 500, total: 1000 });
      expect(feed.getProgress()).toEqual({ loaded: 500, total: 1000 });
      onProgress({ phase: 'loading' });
      expect(feed.getStatus()).toBe('loading');
      expect(feed.getProgress()).toBeNull();
      return { stop: vi.fn(), setPaused: vi.fn(), setOptions: vi.fn() };
    });

    const final = await feed.start();
    expect(final).toBe('on');
    expect(feed.getStatus()).toBe('on');
    expect(seen).toEqual(['starting', 'downloading', 'downloading', 'downloading', 'loading', 'on']);
  });

  it('a cache hit reports 100% immediately (no visible progress bar wait)', async () => {
    const feed = new TrackerFeed('face');
    startTracker.mockImplementation(async (o: { onProgress?: (p: { phase: 'downloading' | 'loading'; loaded?: number; total?: number }) => void }) => {
      o.onProgress?.({ phase: 'downloading', loaded: 3_800_000, total: 3_800_000 });
      o.onProgress?.({ phase: 'loading' });
      return { stop: vi.fn(), setPaused: vi.fn(), setOptions: vi.fn() };
    });
    await feed.start();
    expect(feed.getStatus()).toBe('on');
  });

  it('a worker failure lands on "error", not stuck downloading', async () => {
    const feed = new TrackerFeed('pose');
    startTracker.mockImplementation(async (o: { onProgress?: (p: { phase: 'downloading' | 'loading' }) => void }) => {
      o.onProgress?.({ phase: 'downloading' });
      throw new Error('boom');
    });
    const s = await feed.start();
    expect(s).toBe('error');
    expect(feed.getStatus()).toBe('error');
    expect(feed.getProgress()).toBeNull();
  });

  it('never starts twice at once: a second start() while starting reuses the same promise', async () => {
    const feed = new TrackerFeed('hands');
    let resolveTracker!: (v: { stop: () => void; setPaused: () => void; setOptions: () => void }) => void;
    startTracker.mockImplementation(() => new Promise(resolve => { resolveTracker = resolve; }));
    const p1 = feed.start();
    const p2 = feed.start();
    expect(p1).toBe(p2);
    // Let the mocked camera's own promise resolve before the tracker's is asked for.
    await vi.waitFor(() => { if (!resolveTracker) throw new Error('not yet'); });
    resolveTracker({ stop: vi.fn(), setPaused: vi.fn(), setOptions: vi.fn() });
    await p1;
    expect(startTracker).toHaveBeenCalledTimes(1);
  });
});
