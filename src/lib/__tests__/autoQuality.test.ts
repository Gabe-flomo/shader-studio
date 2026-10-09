/** Auto resolution (lib/autoQuality.ts): steps down when the frame stalls the page, back up only when it would fit. */
import { describe, it, expect } from 'vitest';
import { autoQualityStep, newAutoState, HEAVY_MS } from '../autoQuality';

const run = (readings: Array<{ gpuMs: number | null; fps?: number }>, start = 1) => {
  const st = newAutoState();
  let scale = start;
  const seen: number[] = [];
  readings.forEach((r, i) => {
    scale = autoQualityStep(st, scale, { gpuMs: r.gpuMs, floorMs: 0, fps: r.fps ?? 60, drawing: true }, 10_000 + i * 1000);
    seen.push(scale);
  });
  return seen;
};

describe('Auto preview resolution', () => {
  it('steps down after two heavy seconds, then waits for the averages to settle', () => {
    const seen = run([{ gpuMs: 30 }, { gpuMs: 30 }, { gpuMs: 30 }, { gpuMs: 30 }, { gpuMs: 30 }]);
    expect(seen.slice(0, 2)).toEqual([1, 1 / 2]);
    expect(seen[2]).toBe(1 / 2); // settling
  });

  it('one heavy second (a hiccup) changes nothing', () => {
    expect(run([{ gpuMs: 30 }, { gpuMs: 5 }, { gpuMs: 30 }, { gpuMs: 5 }])).toEqual([1, 1, 1, 1]);
  });

  it('steps up only when the level above would fit, so it doesn\'t bounce', () => {
    // 3 ms at half: 12 ms at full (over LIGHT_MS): stays at half
    expect(run(Array(8).fill({ gpuMs: 3 }), 1 / 2).at(-1)).toBe(1 / 2);
    // 1.5 ms at half: 6 ms at full: goes back up
    expect(run(Array(8).fill({ gpuMs: 1.5 }), 1 / 2).at(-1)).toBe(1);
  });

  it('a still picture or a background window says nothing about cost', () => {
    const st = newAutoState();
    let scale = 1;
    for (let i = 0; i < 5; i++) scale = autoQualityStep(st, scale, { gpuMs: HEAVY_MS * 3, floorMs: 0, fps: 2, drawing: false }, i * 1000);
    expect(scale).toBe(1);
  });

  it('without a GPU timer, goes by the frame rate', () => {
    expect(run([{ gpuMs: null, fps: 20 }, { gpuMs: null, fps: 20 }])).toEqual([1, 1 / 2]);
    expect(run(Array(12).fill({ gpuMs: null, fps: 60 }), 1 / 2).at(-1)).toBe(1);
  });
});
