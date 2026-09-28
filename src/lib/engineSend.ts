/**
 * engineSend.ts — a web sound through a rack's Audio Unit effects (desktop;
 * docs/audio-engine.md, "Web sounds through Audio Units"). A rack whose
 * `source` is set has no instrument: its source is the page's sound, sent
 * one way into the native engine.
 *
 *   the chain's output ─(audioFxHost.divert)─→ AudioWorklet (SEND_FRAMES a chunk, resampled to the engine's rate)
 *     ─→ ae_rack_feed (raw bytes) ─→ the rack's input ring ─→ its AU effects ─→ rack mixer ─→ the engine's output
 *
 * Diverting the chain takes the sound off the page's output (and off the
 * record bus): it's heard through the engine only, and the engine's tap
 * carries it in recordings. Latency one way is the chunk, the IPC hop, the
 * cushion of silence the ring starts with (SEND_CUSHION_FRAMES) and the
 * engine's own I/O buffer: about 40–50 ms at 48 kHz. There is no way back:
 * the page's audio readers on that sound keep reading it before the send
 * (put the readers on the rack instead).
 */
import { audioFxHost } from './audioFx';
import { MASTER_CHAIN, layerChainId } from '../types/playAudioFx';
import type { PlayLayer } from '../types/play';

/** Frames per chunk sent (at the engine's rate): 512 is 10.7 ms at 48 kHz, about 94 chunks a second. */
export const SEND_FRAMES = 512;
/** Silence the ring starts with, so a late chunk plays late rather than as a hole: 21 ms at 48 kHz. */
export const SEND_CUSHION_FRAMES = 1024;
/** The ring's size: a second. */
export const SEND_CAPACITY = 48000;

export type Feed = (rackId: string, pcm: Float32Array) => void;

/** The processor: gathers stereo frames, resamples to the engine's rate by linear interpolation, posts each full chunk. */
const SEND_SOURCE = `
class PlayfieldSend extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = (o && o.processorOptions) || {};
    this.ratio = p.ratio > 0 ? p.ratio : 1;
    this.frames = p.frames > 0 ? p.frames : 512;
    this.chunk = new Float32Array(this.frames * 2);
    this.n = 0;
    this.pos = 0;
    this.pl = 0; this.pr = 0;
    this.on = true;
    this.port.onmessage = e => { if (e.data === 'stop') this.on = false; };
  }
  push(l, r) {
    this.chunk[this.n * 2] = l; this.chunk[this.n * 2 + 1] = r;
    if (++this.n >= this.frames) { const c = this.chunk; this.chunk = new Float32Array(this.frames * 2); this.n = 0; this.port.postMessage(c, [c.buffer]); }
  }
  process(inputs) {
    if (!this.on) return false;
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const l = inp[0], r = inp[1] || inp[0], n = l.length;
    if (this.ratio === 1) { for (let i = 0; i < n; i++) this.push(l[i], r[i]); return true; }
    // Output positions step 1/ratio input frames; pos is where the next output lands, counted from the previous frame (index -1).
    const step = 1 / this.ratio;
    let p = this.pos;
    while (p < n) {
      const i = Math.floor(p), f = p - i;
      const al = i < 0 ? this.pl : l[i], ar = i < 0 ? this.pr : r[i];
      const bl = i + 1 < n ? l[i + 1] : l[n - 1], br = i + 1 < n ? r[i + 1] : r[n - 1];
      this.push(al + (bl - al) * f, ar + (br - ar) * f);
      p += step;
    }
    this.pos = p - n;
    this.pl = l[n - 1]; this.pr = r[n - 1];
    return true;
  }
}
registerProcessor('playfield-engine-send', PlayfieldSend);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();
function loadSend(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx);
  if (!p) {
    p = (async () => {
      try {
        if (!ctx.audioWorklet || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
        const url = URL.createObjectURL(new Blob([SEND_SOURCE], { type: 'application/javascript' }));
        try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        return true;
      } catch { return false; }
    })();
    loaded.set(ctx, p);
  }
  return p;
}

interface Live { source: string; node: AudioWorkletNode; ctx: BaseAudioContext }

/** The sends running now (one per rack). */
class EngineSend {
  private live = new Map<string, Live>();
  private feed: Feed | null = null;

  configure(o: { feed: Feed | null }): void { this.feed = o.feed; }

  /** Send `source` (a chain id) into the rack; the error when it can't (null when it runs). */
  async start(ctx: AudioContext, rackId: string, source: string, engineRate: number): Promise<string | null> {
    const had = this.live.get(rackId);
    if (had?.source === source) return null;
    if (had) this.stop(rackId);
    if (!(await loadSend(ctx))) return 'This browser can’t capture the sound (no AudioWorklet).';
    if (this.live.has(rackId)) return null; // started meanwhile
    const ratio = engineRate > 0 && ctx.sampleRate > 0 ? engineRate / ctx.sampleRate : 1;
    let node: AudioWorkletNode;
    try {
      node = new AudioWorkletNode(ctx, 'playfield-engine-send', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit', processorOptions: { ratio, frames: SEND_FRAMES } });
    } catch (e) { return `Couldn’t make the send: ${e instanceof Error ? e.message : String(e)}`; }
    node.port.onmessage = e => { if (e.data instanceof Float32Array) this.feed?.(rackId, e.data); };
    this.live.set(rackId, { source, node, ctx });
    // The cushion first, so the engine's reader starts behind the page by a little and a late chunk is late, not a hole.
    this.feed?.(rackId, new Float32Array(SEND_CUSHION_FRAMES * 2));
    audioFxHost.divert(ctx, source, node);
    if (ctx.state === 'suspended') void ctx.resume();
    return null;
  }

  stop(rackId: string): void {
    const l = this.live.get(rackId);
    if (!l) return;
    this.live.delete(rackId);
    audioFxHost.divert(l.ctx, l.source, null);
    try { l.node.port.postMessage('stop'); } catch { /* gone */ }
    try { l.node.disconnect(); } catch { /* gone */ }
  }

  stopAll(): void { for (const id of [...this.live.keys()]) this.stop(id); }

  /** The source a rack is sending now ('' for none). */
  sourceOf(rackId: string): string { return this.live.get(rackId)?.source ?? ''; }
}

export const engineSend = new EngineSend();

// ── What can be sent ────────────────────────────────────────────────────────

export interface SendChoice { value: string; label: string }

/** The sounds a rack can take instead of an instrument: everything, or one layer's sound (by its chain id). */
export function sendChoices(layers: readonly PlayLayer[]): SendChoice[] {
  const out: SendChoice[] = [{ value: MASTER_CHAIN, label: 'Everything the page plays' }];
  for (const l of layers) {
    const kind = l.kind as string;
    if (kind === 'audio' && (l as { input?: string }).input === 'file') out.push({ value: layerChainId(l.id), label: `${l.label} · song` });
    else if (kind === 'video' && (l as { sound?: string }).sound === 'play') out.push({ value: layerChainId(l.id), label: `${l.label} · video sound` });
    else if (kind === 'drumpad') out.push({ value: layerChainId(l.id), label: `${l.label} · drum pads` });
  }
  return out;
}

/** "Everything the page plays", "Beat · drum pads", or the id when the layer is gone. */
export function sendLabel(source: string, layers: readonly PlayLayer[]): string {
  return sendChoices(layers).find(c => c.value === source)?.label ?? (source === MASTER_CHAIN ? 'Everything the page plays' : `${source} (gone)`);
}
