/**
 * ahead.ts — a File source analysed ahead (docs/audio-tools.md "Files: analysed ahead").
 *
 * A file's whole sound is decoded in memory, so its bands' levels are worked out once, over the whole file, in a
 * worker (aheadWorker.ts: play/kit/audioTools.js atAnalyseLevels, a 2048 window every 5 ms, centred on its time). Then
 * the band's trigger (the same atStepTrigger as live) picks its hits from that curve, and the engine fires each one when
 * playback *heard* reaches it (lib/audioEngine.ts heardTime: the render clock less the output's latency, plus the
 * source's Sync offset). Hits land on the sound you hear, at any frame rate; moving a Threshold re-picks at once
 * (milliseconds), moving a band's range analyses that range again.
 *
 * One AheadAnalysis per decoded buffer. `curve(range)` and `events(range, opts)` return null until the range is ready
 * (the engine uses the live path meanwhile).
 */
import { atAnalyseLevels, atOfflineHop, atPickTriggers, atTriggerOpts, type AtEvents, type AtTriggerOpts } from '../../play/kit/audioTools.js';

export interface AheadRange { lo: number; hi: number }
export const aheadRangeKey = (r: AheadRange): string => `${Math.round(r.lo)}-${Math.round(r.hi)}`;

interface BufferLike { numberOfChannels: number; length: number; sampleRate: number; getChannelData(c: number): Float32Array }

/** The channels' average. */
export function monoOf(buf: BufferLike): Float32Array {
  const out = new Float32Array(buf.length), n = buf.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / n;
  }
  return out;
}

/** Works out levels for ranges: in a worker in the browser, inline where there is none (tests). */
export type AheadRunner = (id: number, mono: Float32Array | null, sampleRate: number, ranges: AheadRange[], hop: number) => Promise<Float32Array[]>;

let worker: Worker | null = null;
let nextReq = 1;
const waiting = new Map<number, { resolve: (c: Float32Array[]) => void; reject: (e: unknown) => void }>();

function workerRunner(): AheadRunner | null {
  if (typeof Worker === 'undefined') return null;
  return (id, mono, sampleRate, ranges, hop) => {
    if (!worker) {
      worker = new Worker(new URL('./aheadWorker.ts', import.meta.url), { type: 'module', name: 'audio-ahead' });
      worker.onmessage = (e: MessageEvent<{ req: number; curves?: Float32Array[]; error?: string }>) => {
        const w = waiting.get(e.data.req);
        if (!w) return;
        waiting.delete(e.data.req);
        if (e.data.curves) w.resolve(e.data.curves); else w.reject(new Error(e.data.error ?? 'analysis failed'));
      };
      worker.onerror = () => { for (const w of waiting.values()) w.reject(new Error('analysis worker failed')); waiting.clear(); worker?.terminate(); worker = null; };
    }
    const req = nextReq++;
    return new Promise((resolve, reject) => {
      waiting.set(req, { resolve, reject });
      // The sound goes once per buffer (the worker keeps it by id); later requests send only ranges.
      worker!.postMessage({ req, id, mono, sampleRate, ranges, hop }, mono ? [mono.buffer] : []);
    });
  };
}

const inlineRunner: AheadRunner = (() => {
  const kept = new Map<number, Float32Array>();
  return async (id, mono, sampleRate, ranges, hop) => {
    if (mono) kept.set(id, mono);
    const m = kept.get(id);
    if (!m) throw new Error('no sound');
    await new Promise(r => setTimeout(r, 0));
    return atAnalyseLevels(m, sampleRate, ranges, hop);
  };
})();

/** Forget a sound in the worker. */
function dropInWorker(id: number): void { worker?.postMessage({ drop: id }); }

let nextId = 1;

export class AheadAnalysis {
  readonly id = nextId++;
  readonly sampleRate: number;
  readonly hop: number;
  readonly hopSeconds: number;
  readonly duration: number;
  private curves = new Map<string, Float32Array>();
  private picks = new Map<string, { key: string; ev: AtEvents }>();
  private queued = new Set<string>();
  private inFlight = new Set<string>();
  private sent = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private mono: Float32Array | null;
  private run: AheadRunner;
  /** Ranges whose analysis failed (not asked again). */
  private failed = new Set<string>();

  readonly buffer: BufferLike;
  private onReady: () => void;

  constructor(buffer: BufferLike, onReady: () => void = () => {}, runner?: AheadRunner) {
    this.buffer = buffer;
    this.onReady = onReady;
    this.sampleRate = buffer.sampleRate;
    this.hop = atOfflineHop(buffer.sampleRate);
    this.hopSeconds = this.hop / buffer.sampleRate;
    this.duration = buffer.length / buffer.sampleRate;
    this.mono = monoOf(buffer);
    this.run = runner ?? workerRunner() ?? inlineRunner;
  }

  /** The range's level curve (one value per hopSeconds), or null while it is being worked out (it is asked for). */
  curve(r: AheadRange): Float32Array | null {
    const k = aheadRangeKey(r);
    const c = this.curves.get(k);
    if (c) return c;
    if (!this.inFlight.has(k) && !this.failed.has(k)) { this.queued.add(k); this.schedule(); }
    return null;
  }

  /** The range's hits under a trigger's settings (picked again only when they change), or null while not ready. */
  events(r: AheadRange, o: Partial<AtTriggerOpts> & { cooldown?: number }): AtEvents | null {
    const c = this.curve(r);
    if (!c) return null;
    const opts = atTriggerOpts(o);
    const rk = aheadRangeKey(r), key = `${opts.threshold}|${opts.releaseAt}|${opts.gate}|${opts.minMs}|${opts.cooldownMs}`;
    const memo = this.picks.get(rk);
    if (memo?.key === key) return memo.ev;
    const ev = atPickTriggers(c, this.hopSeconds, opts);
    this.picks.set(rk, { key, ev });
    return ev;
  }

  /** Ranges being worked out now (or waiting to be). */
  busy(): boolean { return this.queued.size > 0 || this.inFlight.size > 0; }

  private schedule(): void {
    if (this.timer || this.disposed) return;
    // A band's edge being dragged asks for many ranges: wait for it to settle.
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 120);
  }

  private async flush(): Promise<void> {
    if (this.disposed || !this.queued.size) return;
    const keys = [...this.queued];
    this.queued.clear();
    for (const k of keys) this.inFlight.add(k);
    const ranges = keys.map(k => { const [lo, hi] = k.split('-').map(Number); return { lo, hi }; });
    const mono = this.sent ? null : this.mono;
    this.sent = true;
    // Handed over (a worker takes the bytes); the inline runner keeps its own reference.
    this.mono = null;
    try {
      const curves = await this.run(this.id, mono, this.sampleRate, ranges, this.hop);
      if (this.disposed) return;
      keys.forEach((k, i) => { this.curves.set(k, curves[i]); this.picks.delete(k); });
    } catch (e) {
      console.warn('[audio tools] analysing ahead', e);
      for (const k of keys) this.failed.add(k);
    } finally {
      for (const k of keys) this.inFlight.delete(k);
    }
    if (!this.disposed) this.onReady();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.sent) dropInWorker(this.id);
  }
}
