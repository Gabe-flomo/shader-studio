/**
 * ahead.ts — a File source analysed ahead (docs/audio-tools.md "Files: analysed ahead").
 *
 * A file's whole sound is decoded in memory, so its bands' detector frames are worked out once, over the whole file,
 * in a worker (aheadWorker.ts: play/kit/audioTools.js atDetAnalyse) — the very frames the live detector runs (the
 * same window ending at each moment, every 5 ms). Then each band's hits are picked by the same peak picker as live
 * (atDetPickAll), Only (atCharFilter) keeps the noisy / tonal ones, and the engine fires each one when playback *heard*
 * reaches it (lib/audioEngine.ts heardTime: the render clock less the output's latency, plus the source's Sync
 * offset). Hits land on the sound you hear, at any frame rate; moving Sensitivity, Min interval, the Gate or Only
 * re-picks at once (milliseconds), moving a band's range or its preset analyses again.
 *
 * One AheadAnalysis per decoded buffer. `curves(cfg)` and `events(cfg, only)` return null until the band's analysis
 * is ready (the engine uses the live path meanwhile).
 */
import {
  atCharFilter, atDetAnalyse, atDetHop, atDetPickAll,
  type AtCharacter, type AtDetConfig, type AtDetCurves, type AtDetSpec, type AtEvents,
} from '../../play/kit/audioTools.js';

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

/** Works out the detector's curves for specs: in a worker in the browser, inline where there is none (tests). */
export type AheadRunner = (id: number, mono: Float32Array | null, sampleRate: number, specs: AtDetSpec[]) => Promise<AtDetCurves[]>;

let worker: Worker | null = null;
let nextReq = 1;
const waiting = new Map<number, { resolve: (c: AtDetCurves[]) => void; reject: (e: unknown) => void }>();

function workerRunner(): AheadRunner | null {
  if (typeof Worker === 'undefined') return null;
  return (id, mono, sampleRate, specs) => {
    if (!worker) {
      worker = new Worker(new URL('./aheadWorker.ts', import.meta.url), { type: 'module', name: 'audio-ahead' });
      worker.onmessage = (e: MessageEvent<{ req: number; curves?: AtDetCurves[]; error?: string }>) => {
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
      // The sound goes once per buffer (the worker keeps it by id); later requests send only specs.
      worker!.postMessage({ req, id, mono, sampleRate, specs }, mono ? [mono.buffer] : []);
    });
  };
}

const inlineRunner: AheadRunner = (() => {
  const kept = new Map<number, Float32Array>();
  return async (id, mono, sampleRate, specs) => {
    if (mono) kept.set(id, mono);
    const m = kept.get(id);
    if (!m) throw new Error('no sound');
    await new Promise(r => setTimeout(r, 0));
    return atDetAnalyse(m, sampleRate, specs);
  };
})();

/** Forget a sound in the worker. */
function dropInWorker(id: number): void { worker?.postMessage({ drop: id }); }

let nextId = 1;

/** A band's hits ahead: its picked events, and per frame the line its onset function had to beat and its Gate's line. */
export type AheadEvents = AtEvents & { line: Float32Array; gate: Float32Array };

export class AheadAnalysis {
  readonly id = nextId++;
  readonly sampleRate: number;
  readonly hop: number;
  readonly hopSeconds: number;
  readonly duration: number;
  private store = new Map<string, AtDetCurves>();
  private picks = new Map<string, { key: string; ev: AheadEvents }>();
  private queued = new Map<string, AtDetSpec>();
  private inFlight = new Set<string>();
  private sent = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private mono: Float32Array | null;
  private run: AheadRunner;
  /** Specs whose analysis failed (not asked again). */
  private failed = new Set<string>();

  readonly buffer: BufferLike;
  private onReady: () => void;

  constructor(buffer: BufferLike, onReady: () => void = () => {}, runner?: AheadRunner) {
    this.buffer = buffer;
    this.onReady = onReady;
    this.sampleRate = buffer.sampleRate;
    this.hop = atDetHop(buffer.sampleRate);
    this.hopSeconds = this.hop / buffer.sampleRate;
    this.duration = buffer.length / buffer.sampleRate;
    this.mono = monoOf(buffer);
    this.run = runner ?? workerRunner() ?? inlineRunner;
  }

  /** A band's detector curves (atDetConfig's spec), or null while they are worked out (asked for). */
  curves(cfg: AtDetConfig): AtDetCurves | null {
    const k = cfg.specKey;
    const c = this.store.get(k);
    if (c) return c;
    if (!this.inFlight.has(k) && !this.failed.has(k)) { this.queued.set(k, cfg.spec); this.schedule(); }
    return null;
  }

  /** A band's hits under its settings and Only (picked again only when they change), or null while not ready. */
  events(cfg: AtDetConfig, only?: { character?: AtCharacter; charAt?: number }): AheadEvents | null {
    const c = this.curves(cfg);
    if (!c) return null;
    const ch = only?.character && only.character !== 'any' ? `${only.character}@${only.charAt ?? ''}` : 'any';
    const key = `${cfg.preMax}|${cfg.preAvg}|${cfg.delta}|${cfg.minInterval}|${cfg.gateDb}|${cfg.trackNoise}|${ch}`;
    const pk = `${cfg.specKey}#${key}`;
    const memo = this.picks.get(pk);
    if (memo) return memo.ev;
    const all = atDetPickAll(c, this.hopSeconds, cfg);
    const kept = atCharFilter(all, c.aflat, c.arise, this.hopSeconds, only?.character ?? 'any', only?.charAt);
    const ev: AheadEvents = { times: kept.times, strengths: kept.strengths, line: all.line, gate: all.gate };
    // A few settings at a time (several bands, a slider being dragged): drop the oldest beyond a handful.
    if (this.picks.size > 24) this.picks.delete(this.picks.keys().next().value as string);
    this.picks.set(pk, { key, ev });
    return ev;
  }

  /** Specs being worked out now (or waiting to be). */
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
    const keys = entries.map(([k]) => k), specs = entries.map(([, s]) => s);
    for (const k of keys) this.inFlight.add(k);
    const mono = this.sent ? null : this.mono;
    this.sent = true;
    // Handed over (a worker takes the bytes); the inline runner keeps its own reference.
    this.mono = null;
    try {
      const curves = await this.run(this.id, mono, this.sampleRate, specs);
      if (this.disposed) return;
      keys.forEach((k, i) => this.store.set(k, curves[i]));
      for (const pk of [...this.picks.keys()]) if (keys.some(k => pk.startsWith(`${k}#`))) this.picks.delete(pk);
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
