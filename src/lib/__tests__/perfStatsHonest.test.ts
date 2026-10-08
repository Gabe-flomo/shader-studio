/**
 * The Performance panel's honest GPU numbers: isolated shader samples, whole-frame sums,
 * the reference draw's noise check, and the timer's flush-before-begin (lib/gpuTimer.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BASELINE_NOISY_MS, GpuFrameAccumulator, frameSegments, getPerfSnapshot, median, percentile,
  recordGpuResults, flushGpuFrame, resetFrameHistory, shaderReading, timerHealth,
} from '../perfStats';
import { GpuTimer } from '../gpuTimer';

const r = (name: string, ms: number, frame: number, isolated = false) => ({ name, ms, frame, isolated });

describe('median / percentile', () => {
  it('median ignores one hiccup', () => {
    expect(median([0.05, 0.05, 9, 0.06, 0.05])).toBe(0.05);
    expect(median([1, 3])).toBe(2);
    expect(median([])).toBeNull();
  });
  it('percentile picks the slow tail', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('timerHealth', () => {
  it('flags a reference draw far above its normal floor', () => {
    expect(timerHealth([0.02, 0.3, 0.45]).noisy).toBe(false);
    expect(timerHealth([0.9, 1, 0.95])).toEqual({ baselineMs: 0.95, noisy: true });
    expect(timerHealth([BASELINE_NOISY_MS]).noisy).toBe(false);
  });
  it('says nothing before a reference was timed', () => {
    expect(timerHealth([])).toEqual({ baselineMs: null, noisy: false });
  });
});

describe('shaderReading', () => {
  it('reports the median and marks a result at the timer floor', () => {
    const tiny = shaderReading([0.04, 0.05, 0.05], [0.02, 0.02]);
    expect(tiny.ms).toBe(0.05);
    expect(tiny.atFloor).toBe(true);
    const real = shaderReading([4, 4.2, 3.9], [0.02, 0.02]);
    expect(real.atFloor).toBe(false);
    expect(real.samples).toBe(3);
  });
  it('is empty before any isolated sample', () => {
    expect(shaderReading([], []).ms).toBeNull();
  });
});

describe('GpuFrameAccumulator', () => {
  it('sums the segments of a frame and hands the total over when the next frame starts', () => {
    const acc = new GpuFrameAccumulator();
    expect(acc.add(r('shader', 1, 1))).toBeNull();
    expect(acc.add(r('present', 0.5, 1))).toBeNull();
    expect(acc.add(r('main', 2, 2))).toBeCloseTo(1.5);
    expect(acc.flush()).toBe(2);
    expect(acc.flush()).toBeNull();
  });
  it('keeps the reference draw and node-cost runs out of the frame total', () => {
    const acc = new GpuFrameAccumulator();
    acc.add(r('shader', 1, 1));
    expect(acc.add(r('baseline', 0.02, 1))).toBeNull();
    expect(acc.add(r('cost', 7, 9))).toBeNull();
    expect(acc.flush()).toBe(1);
  });
});

describe('frameSegments', () => {
  it('prefers isolated medians and drops the all-in-one span once they exist', () => {
    const rows = frameSegments(
      new Map([['main', [3, 3]], ['echo', [1]]]),
      new Map([['shader', [0.05, 0.06, 0.05]], ['present', [0.02]]]),
    );
    expect(rows.map(s => s.name).sort()).toEqual(['echo', 'present', 'shader']);
    expect(rows.find(s => s.name === 'shader')).toEqual({ name: 'shader', ms: 0.05, isolated: true });
    expect(rows.find(s => s.name === 'echo')?.isolated).toBe(false);
  });
  it('shows the ordinary span until an isolated sample arrives', () => {
    const rows = frameSegments(new Map([['main', [2, 4]]]), new Map());
    expect(rows).toEqual([{ name: 'main', ms: 3, isolated: false }]);
  });
});

describe('snapshot', () => {
  it('keeps isolated shader time apart from the whole frame', () => {
    resetFrameHistory();
    // Ordinary frames read high (earlier work leaks into the timer); isolated ones read the shader alone.
    for (let f = 1; f <= 5; f++) recordGpuResults([r('main', 3, f)]);
    recordGpuResults([r('shader', 0.05, 6, true), r('present', 0.02, 6, true), r('baseline', 0.02, 6, true)]);
    flushGpuFrame();
    const s = getPerfSnapshot();
    expect(s.shader.ms).toBe(0.05);
    expect(s.gpu.last).toBeCloseTo(0.07);
    expect(s.gpu.avg).toBeGreaterThan(s.shader.ms!);
    expect(s.timer.baselineMs).toBe(0.02);
    expect(s.timer.noisy).toBe(false);
  });
});

describe('GpuTimer isolation', () => {
  function fakeGl() {
    const calls: string[] = [];
    const gl = {
      calls,
      flush: () => calls.push('flush'),
      createQuery: () => ({}),
      beginQuery: () => calls.push('begin'),
      endQuery: () => calls.push('end'),
      deleteQuery: () => {},
      getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
      getParameter: () => false,
      getQueryParameter: (_q: unknown, p: unknown) => (p === 'avail' ? true : 2_000_000),
      QUERY_RESULT_AVAILABLE: 'avail', QUERY_RESULT: 'result',
    };
    return gl;
  }
  it('flushes before beginQuery only when isolated, and tags the result', () => {
    vi.stubGlobal('WebGL2RenderingContext', class {});
    const gl = fakeGl();
    Object.setPrototypeOf(gl, (globalThis as { WebGL2RenderingContext: { prototype: object } }).WebGL2RenderingContext.prototype);
    const t = new GpuTimer(gl as unknown as WebGL2RenderingContext);
    expect(t.supported).toBe(true);
    t.begin('main'); t.end();
    expect(gl.calls).toEqual(['begin', 'end']);
    gl.calls.length = 0;
    t.frame = 7; t.isolate = true;
    t.begin('shader'); t.end();
    expect(gl.calls).toEqual(['flush', 'begin', 'end']);
    const res = t.poll();
    expect(res).toEqual([
      { name: 'main', ms: 2, frame: 0, isolated: false },
      { name: 'shader', ms: 2, frame: 7, isolated: true },
    ]);
    vi.unstubAllGlobals();
  });
});
