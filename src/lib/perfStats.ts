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
/** How many isolated samples (shader, reference draw, segments) are kept. */
export const ISOLATED_HISTORY = 30;
/**
 * The reference draw (a constant colour into 64×64) takes about 0.01–0.03 ms on a desktop GPU.
 * Well above that, the timer itself reads high: the GPU is clocked down, busy with other apps,
 * or the timer is noisy, and every number in the panel is inflated by about as much.
 */
export const BASELINE_NOISY_MS = 0.1;

const cpu = new Ring(HISTORY);
/** Every timed GPU segment of a drawn frame, summed: what the timer saw the frame cost ("everything"). */
const gpu = new Ring(HISTORY);
/** The picture's program alone, timed on isolated frames (lib/gpuTimer.ts): the shader's own cost. */
const shaderIso = new Ring(ISOLATED_HISTORY);
/** A fixed tiny reference draw, timed the same way: the timer's floor right now. */
const baseline = new Ring(ISOLATED_HISTORY);
const probes = new Ring(HISTORY);
const readbacks = new Ring(HISTORY);
/** Segments timed on ordinary frames (each may include work queued before it: see gpuTimer.ts). */
const passes = new Map<string, Ring>();
/** Segments timed on isolated frames (flushed first, so each counts only its own work). */
const isoPasses = new Map<string, Ring>();
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

/** One GPU timer result as the frame loop hands it over (lib/gpuTimer.ts TimerResult). */
export interface GpuResult { name: string; ms: number; frame: number; isolated: boolean }

/** Segments that are not part of a drawn frame's work: the reference draw and the node-cost measurer. */
const OUTSIDE_FRAME = new Set(['baseline', 'cost']);

/**
 * Sums a frame's GPU segments. Timer results come back in the order they were issued, so the
 * first result of a newer frame means the older one is complete: add() returns its total then.
 * flush() hands over the last frame once nothing is outstanding.
 */
export class GpuFrameAccumulator {
  private frame: number | null = null;
  private sum = 0;
  /** Add one segment; the finished previous frame's total, or null. */
  add(r: GpuResult): number | null {
    if (OUTSIDE_FRAME.has(r.name)) return null;
    let done: number | null = null;
    if (this.frame !== null && r.frame !== this.frame) { done = this.sum; this.sum = 0; }
    this.frame = r.frame;
    this.sum += r.ms;
    return done;
  }
  flush(): number | null {
    if (this.frame === null) return null;
    const done = this.sum;
    this.frame = null; this.sum = 0;
    return done;
  }
}
const frameAcc = new GpuFrameAccumulator();

function ringOf(map: Map<string, Ring>, name: string, size: number): Ring {
  let ring = map.get(name);
  if (!ring) { ring = new Ring(size); map.set(name, ring); }
  return ring;
}

/** Resolved GPU timer queries. Call flushGpuFrame() once the timer has nothing outstanding. */
export function recordGpuResults(results: readonly GpuResult[]): void {
  if (!results.length) return;
  for (const r of results) {
    if (r.name === 'baseline') baseline.push(r.ms);
    else if (r.isolated) {
      ringOf(isoPasses, r.name, ISOLATED_HISTORY).push(r.ms);
      if (r.name === 'shader') shaderIso.push(r.ms);
    } else ringOf(passes, r.name, 60).push(r.ms);
    const total = frameAcc.add(r);
    if (total !== null) gpu.push(total);
  }
  notify();
}

/** Every query issued so far has come back: the last frame's total is complete. */
export function flushGpuFrame(): void {
  const total = frameAcc.flush();
  if (total !== null) { gpu.push(total); notify(); }
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

/** Forget the frame history (a new shader changes what the numbers mean). The reference draw is about the GPU, so it stays. */
export function resetFrameHistory(): void {
  cpu.clear(); gpu.clear(); shaderIso.clear(); probes.clear(); readbacks.clear();
  for (const r of passes.values()) r.clear();
  for (const r of isoPasses.values()) r.clear();
  frameAcc.flush();
}

// ── Reading the timer honestly ───────────────────────────────────────────────

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

export interface TimerHealth {
  /** The reference draw's median, or null before one was timed. */
  baselineMs: number | null;
  /** The timer reads high right now (see BASELINE_NOISY_MS). */
  noisy: boolean;
}

export function timerHealth(baselineSamples: readonly number[], noisyMs = BASELINE_NOISY_MS): TimerHealth {
  const b = median(baselineSamples);
  return { baselineMs: b, noisy: b !== null && b > noisyMs };
}

export interface ShaderReading {
  /** Median of the isolated samples: one slow sample (a hiccup) doesn't move it. */
  ms: number | null;
  /** Slowest 5% of the isolated samples. */
  p95: number | null;
  samples: number;
  /** Within 3× of the reference draw (or under 0.02 ms): too small for the timer to tell apart from nothing. */
  atFloor: boolean;
}

export function shaderReading(shaderSamples: readonly number[], baselineSamples: readonly number[]): ShaderReading {
  const ms = median(shaderSamples);
  const b = median(baselineSamples);
  return {
    ms, p95: percentile(shaderSamples, 0.95), samples: shaderSamples.length,
    atFloor: ms !== null && ms <= Math.max(3 * (b ?? 0), 0.02),
  };
}

/**
 * The rows of "Where the frame goes": each segment's isolated median where there is one
 * (it counts only its own work), else its ordinary average. 'main' is the all-in-one span of
 * ordinary frames (picture + echo + copy to screen, plus whatever was queued before it); it is
 * dropped once the isolated rows exist.
 */
export function frameSegments(ordinary: ReadonlyMap<string, readonly number[]>, isolated: ReadonlyMap<string, readonly number[]>): { name: string; ms: number; isolated: boolean }[] {
  const names = new Set<string>([...isolated.keys(), ...ordinary.keys()]);
  if (isolated.get('shader')?.length) names.delete('main');
  const out: { name: string; ms: number; isolated: boolean }[] = [];
  for (const name of names) {
    const iso = isolated.get(name);
    if (iso?.length) { out.push({ name, ms: median(iso)!, isolated: true }); continue; }
    const ord = ordinary.get(name);
    if (ord?.length) out.push({ name, ms: ord.reduce((a, b) => a + b, 0) / ord.length, isolated: false });
  }
  return out;
}

export interface PerfSnapshot {
  cpu: { last: number | null; avg: number | null; p95: number | null; history: readonly number[] };
  /** Frame GPU work: every timed segment of a frame summed ("everything"). */
  gpu: { last: number | null; avg: number | null; p95: number | null; history: readonly number[] };
  /** The shader on its own (isolated samples). */
  shader: ShaderReading & { history: readonly number[] };
  timer: TimerHealth;
  passes: { name: string; avg: number; isolated: boolean }[];
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

const valuesOf = (m: Map<string, Ring>) => new Map([...m].map(([k, r]) => [k, r.values] as const));

export function getPerfSnapshot(): PerfSnapshot {
  const now = Date.now();
  return {
    cpu: { last: cpu.last, avg: cpu.avg, p95: cpu.percentile(0.95), history: cpu.values },
    gpu: { last: gpu.last, avg: gpu.avg, p95: gpu.percentile(0.95), history: gpu.values },
    shader: { ...shaderReading(shaderIso.values, baseline.values), history: shaderIso.values },
    timer: timerHealth(baseline.values),
    passes: frameSegments(valuesOf(passes), valuesOf(isoPasses)).map(s => ({ name: s.name, avg: s.ms, isolated: s.isolated })),
    probeMs: probes.avg,
    readbacks: readbacks.avg,
    fps, width, height, gpuTimer,
    graphCompileMs, gpuCompileMs,
    compilesPerMinute: compileTimes.filter(t => now - t <= 60_000).length,
  };
}

// ── Play's share of the frame ────────────────────────────────────────────────
// The Play engine (lib/playEngine.ts) and the overlay (play/overlay.ts) time
// their stages and each layer, only while someone is watching (the panel is
// open: playPerfOn()). Two performance.now() calls per stage.

export type PlayStage = 'inputs' | 'conditions' | 'actions' | 'mappings' | 'overlay';
export const PLAY_STAGES: readonly PlayStage[] = ['inputs', 'conditions', 'actions', 'mappings', 'overlay'];
const playStages = new Map<PlayStage, Ring>(PLAY_STAGES.map(s => [s, new Ring(HISTORY)]));
const playLayers = new Map<string, { ring: Ring; seen: number }>();
const playConditions = new Ring(HISTORY);
const playSignals = new Ring(HISTORY);
const playDepth = new Ring(HISTORY);
let playGuardTrips = 0;
let playFrameNo = 0;

/** Is anyone watching? The engine and the overlay skip their timers when not. */
export function playPerfOn(): boolean { return listeners.size > 0; }

export function recordPlayStage(stage: PlayStage, ms: number): void { playStages.get(stage)!.push(ms); }

/** One layer's step and draw this frame (the kit's drawLayer). Layers not seen for a while drop off. */
export function recordPlayLayer(id: string, ms: number): void {
  let e = playLayers.get(id);
  if (!e) { e = { ring: new Ring(60), seen: 0 }; playLayers.set(id, e); }
  e.ring.push(ms);
  e.seen = playFrameNo;
}

/** The engine's counts for one frame: conditions evaluated, signals fired, how deep a chain went and whether the depth guard stopped one. */
export function recordPlayCounts(c: { conditions: number; signals: number; depth: number; guardTripped: boolean }): void {
  playFrameNo++;
  playConditions.push(c.conditions);
  playSignals.push(c.signals);
  playDepth.push(c.depth);
  if (c.guardTripped) playGuardTrips++;
  for (const [id, e] of playLayers) if (playFrameNo - e.seen > 120) playLayers.delete(id);
  notify();
}

export function resetPlayStats(): void {
  for (const r of playStages.values()) r.clear();
  playLayers.clear(); playConditions.clear(); playSignals.clear(); playDepth.clear();
  playGuardTrips = 0;
}

export interface PlayPerfSnapshot {
  /** Average ms per stage (null before the first timed frame). */
  stages: { stage: PlayStage; avg: number | null }[];
  /** Average ms per layer, slowest first. */
  layers: { id: string; avg: number }[];
  conditions: number | null;
  signals: number | null;
  /** Deepest chain in the last 120 frames. */
  maxDepth: number;
  guardTrips: number;
}

export function getPlayPerfSnapshot(): PlayPerfSnapshot {
  return {
    stages: PLAY_STAGES.map(stage => ({ stage, avg: playStages.get(stage)!.avg })),
    layers: [...playLayers.entries()].filter(([, e]) => e.ring.avg !== null).map(([id, e]) => ({ id, avg: e.ring.avg! })).sort((a, b) => b.avg - a.avg),
    conditions: playConditions.avg,
    signals: playSignals.avg,
    maxDepth: playDepth.values.reduce((m, v) => Math.max(m, v), 0),
    guardTrips: playGuardTrips,
  };
}

// ── Node cost measurement hook ───────────────────────────────────────────────
// ShaderCanvas registers a function that compiles a shader off to the side,
// draws it a few times into an offscreen target and returns the median GPU
// milliseconds per frame (CPU-with-finish when timer queries are missing).
// nodeCost.ts drives it once per node. With Pass nodes (docs/pass-node-plan.md) it is handed the
// pass programs as well and times the whole frame's list: each pass drawn at its own size, then the
// picture, so a node's cost by absence counts the pass it is in.
export interface CostPassProgram { fragmentShader: string; scale: number; live: boolean }
export type ShaderCostMeasurer = (fragmentShader: string, vertexShader: string, signal?: AbortSignal, passes?: readonly CostPassProgram[]) => Promise<number | null>;
let measurer: ShaderCostMeasurer | null = null;

export function registerShaderCostMeasurer(fn: ShaderCostMeasurer | null): void { measurer = fn; }
export function getShaderCostMeasurer(): ShaderCostMeasurer | null { return measurer; }
