/**
 * ahead.ts — a File source analysed ahead (docs/audio-tools.md "Files: analysed ahead").
 *
 * A file's whole sound is decoded in memory, so its bands' signals are worked out once, over the whole file, in a
 * worker (aheadWorker.ts: play/kit/audioTools.js atAnalyseFeatures, a 2048 window every 5 ms, centred on its time):
 * for each range and Detect, the value its trigger measures (the level, or a feature), the level its Gate reads and the
 * flatness its Only judges. Then the band's trigger (the same atStepTrigger as live) picks its hits from that curve,
 * Only (atCharFilter) keeps the noisy / tonal ones, and the engine fires each one when playback *heard* reaches it
 * (lib/audioEngine.ts heardTime: the render clock less the output's latency, plus the source's Sync offset). Hits land
 * on the sound you hear, at any frame rate; moving a Threshold or Only re-picks at once (milliseconds), moving a band's
 * range or changing its Detect analyses again.
 *
 * One AheadAnalysis per decoded buffer. `curve(range)` / `curves(range)` and `events(range, opts)` return null until the
 * range is ready (the engine uses the live path meanwhile).
 */
import {
  atAnalyseFeatures, atCharFilter, atDetectOf, atOfflineHop, atPickTriggers, atTriggerOpts,
  type AtCharacter, type AtDetect, type AtEvents, type AtFeatureCurves, type AtTriggerOpts,
} from '../../play/kit/audioTools.js';

/** A band's range and what it detects (Level when left out). */
export interface AheadRange { lo: number; hi: number; detect?: AtDetect }
/** Level ranges keep their old key ("30-150"); a feature adds its name ("30-150-hits"). */
export const aheadRangeKey = (r: AheadRange): string => {
  const d = atDetectOf(r.detect);
  return `${Math.round(r.lo)}-${Math.round(r.hi)}${d === 'level' ? '' : `-${d}`}`;
};

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

/** Works out curves for ranges: in a worker in the browser, inline where there is none (tests). */
export type AheadRunner = (id: number, mono: Float32Array | null, sampleRate: number, ranges: AheadRange[], hop: number) => Promise<AtFeatureCurves[]>;

let worker: Worker | null = null;
let nextReq = 1;
const waiting = new Map<number, { resolve: (c: AtFeatureCurves[]) => void; reject: (e: unknown) => void }>();

function workerRunner(): AheadRunner | null {
  if (typeof Worker === 'undefined') return null;
  return (id, mono, sampleRate, ranges, hop) => {
    if (!worker) {
      worker = new Worker(new URL('./aheadWorker.ts', import.meta.url), { type: 'module', name: 'audio-ahead' });
      worker.onmessage = (e: MessageEvent<{ req: number; curves?: AtFeatureCurves[]; error?: string }>) => {
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
    return atAnalyseFeatures(m, sampleRate, ranges, hop);
  };
})();

/** Forget a sound in the worker. */
function dropInWorker(id: number): void { worker?.postMessage({ drop: id }); }

let nextId = 1;

/** What a band's hits are picked with: its trigger's lines and its Only. */
export type AheadPick = Partial<AtTriggerOpts> & { cooldown?: number; character?: AtCharacter; charAt?: number };

export class AheadAnalysis {
  readonly id = nextId++;
  readonly sampleRate: number;
  readonly hop: number;
  readonly hopSeconds: number;
  readonly duration: number;
  private store = new Map<string, AtFeatureCurves>();
  private picks = new Map<string, { key: string; ev: AtEvents }>();
  private queued = new Map<string, AheadRange>();
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

  /** The range's curves (what its trigger measures, its level, its flatness), or null while they are worked out (asked for). */
  curves(r: AheadRange): AtFeatureCurves | null {
    const k = aheadRangeKey(r);
    const c = this.store.get(k);
    if (c) return c;
    if (!this.inFlight.has(k) && !this.failed.has(k)) { this.queued.set(k, { lo: r.lo, hi: r.hi, detect: atDetectOf(r.detect) }); this.schedule(); }
    return null;
  }

  /** What the range's trigger measures (one value per hopSeconds): its level on Level, else its Detect's feature. */
  curve(r: AheadRange): Float32Array | null { return this.curves(r)?.value ?? null; }

  /** The range's hits under a trigger's settings and Only (picked again only when they change), or null while not ready. */
  events(r: AheadRange, o: AheadPick): AtEvents | null {
    const c = this.curves(r);
    if (!c) return null;
    const opts = atTriggerOpts(o);
    const rk = aheadRangeKey(r), feature = atDetectOf(r.detect) !== 'level';
    const ch = o.character && o.character !== 'any' ? `${o.character}@${o.charAt ?? ''}` : 'any';
    const key = `${opts.threshold}|${opts.releaseAt}|${opts.gate}|${opts.minMs}|${opts.cooldownMs}|${ch}`;
    const memo = this.picks.get(rk);
    if (memo?.key === key) return memo.ev;
    // A feature's Gate reads the level; a Level band's is its own curve (as before Detect).
    const ev = atCharFilter(atPickTriggers(c.value, this.hopSeconds, opts, feature ? c.level : undefined), c.aflat, c.arise, this.hopSeconds, o.character ?? 'any', o.charAt);
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
    const entries = [...this.queued];
    this.queued.clear();
    const keys = entries.map(([k]) => k), ranges = entries.map(([, r]) => r);
    for (const k of keys) this.inFlight.add(k);
    const mono = this.sent ? null : this.mono;
    this.sent = true;
    // Handed over (a worker takes the bytes); the inline runner keeps its own reference.
    this.mono = null;
    try {
      const curves = await this.run(this.id, mono, this.sampleRate, ranges, this.hop);
      if (this.disposed) return;
      keys.forEach((k, i) => { this.store.set(k, curves[i]); this.picks.delete(k); });
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
