/**
 * perfStats — the preview's performance counters, in one place.
 *
 * The frame loop (ShaderCanvas) records CPU frame time, GPU pass times from
 * timer queries, probe cost and readback counts; the store records how long
 * the graph took to turn into GLSL; the shader swap records GPU compile time.
 * The Performance panel reads a snapshot a few times a second through
 * subscribePerf — a plain listener set, so nothing here re-renders React per
 * frame. Same pattern as timeTick.ts.
 */

class Ring {
  private buf: number[] = [];
  private readonly size: number;
  constructor(size: number) { this.size = size; }
  push(v: number): void { this.buf.push(v); if (this.buf.length > this.size) this.buf.shift(); }
  get values(): readonly number[] { return this.buf; }
  get last(): number | null { return this.buf.length ? this.buf[this.buf.length - 1] : null; }
  get avg(): number | null { return this.buf.length ? this.buf.reduce((a, b) => a + b, 0) / this.buf.length : null; }
  percentile(p: number): number | null {
    if (!this.buf.length) return null;
    const s = [...this.buf].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  }
  clear(): void { this.buf = []; }
}

const HISTORY = 120;
const cpu = new Ring(HISTORY);
const gpu = new Ring(HISTORY);
const probes = new Ring(HISTORY);
const readbacks = new Ring(HISTORY);
const passes = new Map<string, Ring>();
const compileTimes: number[] = []; // timestamps of graph compiles, for a per-minute rate
let graphCompileMs: number | null = null;
let gpuCompileMs: number | null = null;
let fps = 0;
let width = 0;
let height = 0;
let gpuTimer: 'unknown' | 'supported' | 'unsupported' = 'unknown';

type Listener = () => void;
const listeners = new Set<Listener>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
const NOTIFY_EVERY_MS = 250;

function notify(): void {
  if (listeners.size === 0 || notifyTimer) return;
  notifyTimer = setTimeout(() => { notifyTimer = null; for (const cb of listeners) cb(); }, NOTIFY_EVERY_MS);
}

export function subscribePerf(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function hasPerfListeners(): boolean { return listeners.size > 0; }

/** One drawn frame. `probeMs` is the CPU time spent in probes and readbacks after the main draw. */
export function recordFrame(f: { cpuMs: number; probeMs: number; readbacks: number; fps: number; width: number; height: number }): void {
  cpu.push(f.cpuMs);
  probes.push(f.probeMs);
  readbacks.push(f.readbacks);
  fps = f.fps; width = f.width; height = f.height;
  notify();
}

/** A resolved GPU timer query. `main` also feeds the GPU frame history. */
export function recordGpuPass(name: string, ms: number): void {
  let ring = passes.get(name);
  if (!ring) { ring = new Ring(60); passes.set(name, ring); }
  ring.push(ms);
  if (name === 'main') gpu.push(ms);
  notify();
}

export function setGpuTimerSupport(supported: boolean): void {
  gpuTimer = supported ? 'supported' : 'unsupported';
  notify();
}

export function recordGraphCompile(ms: number): void {
  graphCompileMs = ms;
  const now = Date.now();
  compileTimes.push(now);
  while (compileTimes.length && now - compileTimes[0] > 60_000) compileTimes.shift();
  notify();
}

export function recordGpuCompile(ms: number): void { gpuCompileMs = ms; notify(); }

/** Forget the frame history (a new shader changes what the numbers mean). */
export function resetFrameHistory(): void { cpu.clear(); gpu.clear(); probes.clear(); readbacks.clear(); for (const r of passes.values()) r.clear(); }

export interface PerfSnapshot {
  cpu: { last: number | null; avg: number | null; p95: number | null; history: readonly number[] };
  gpu: { last: number | null; avg: number | null; p95: number | null; history: readonly number[] };
  passes: { name: string; avg: number }[];
  probeMs: number | null;
  readbacks: number | null;
  fps: number;
  width: number;
  height: number;
  gpuTimer: 'unknown' | 'supported' | 'unsupported';
  graphCompileMs: number | null;
  gpuCompileMs: number | null;
  compilesPerMinute: number;
}

export function getPerfSnapshot(): PerfSnapshot {
  const now = Date.now();
  return {
    cpu: { last: cpu.last, avg: cpu.avg, p95: cpu.percentile(0.95), history: cpu.values },
    gpu: { last: gpu.last, avg: gpu.avg, p95: gpu.percentile(0.95), history: gpu.values },
    passes: [...passes.entries()].filter(([, r]) => r.avg !== null).map(([name, r]) => ({ name, avg: r.avg! })),
    probeMs: probes.avg,
    readbacks: readbacks.avg,
    fps, width, height, gpuTimer,
    graphCompileMs, gpuCompileMs,
    compilesPerMinute: compileTimes.filter(t => now - t <= 60_000).length,
  };
}

// ── Node cost measurement hook ───────────────────────────────────────────────
// ShaderCanvas registers a function that compiles a shader off to the side,
// draws it a few times into an offscreen target and returns the median GPU
// milliseconds per frame (CPU-with-finish when timer queries are missing).
// nodeCost.ts drives it once per node.
export type ShaderCostMeasurer = (fragmentShader: string, vertexShader: string, signal?: AbortSignal) => Promise<number | null>;
let measurer: ShaderCostMeasurer | null = null;

export function registerShaderCostMeasurer(fn: ShaderCostMeasurer | null): void { measurer = fn; }
export function getShaderCostMeasurer(): ShaderCostMeasurer | null { return measurer; }
