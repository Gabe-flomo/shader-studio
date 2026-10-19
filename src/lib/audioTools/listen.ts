/**
 * listen.ts — a band's **Listen** (docs/audio-tools.md "Listen"): hear what a band listens to and when it fires.
 *
 * While a band listens, its source plays through the band's filters (the same biquads Solo uses: bandFilter.ts,
 * engine.auditionBand) and a short click plays at every hit its detector fires:
 *
 * - **A File** whose analysis is ready: each hit picked ahead (ahead.ts) is put on the audio clock against playback
 *   (`hitClockTimes`: the song time the render clock reaches it, round the loop too, plus Sync offset), a quarter of a
 *   second ahead (`ClickScheduler`), so a click lands on its sample. A seek, a restart, a new trim or new settings
 *   take back the clicks not played yet and schedule again.
 * - **Mic, Video, Live** (and a File still being analysed): the live detector's hits, clicked as each is queued to fire
 *   (`liveClickTime`: as near the moment its trigger fires as the speakers allow).
 *
 * The **Band ↔ Clicks** mix (`listenMix`): 0 the band only, 1 the clicks only, ½ both at full; remembered per band
 * (`readListenMix`). On the Mic the band's own sound starts off (feedback), so its default is clicks only.
 *
 * `ListenControl` is the window's switch: one band at a time, pressing another switches, pressing again (or Esc, or
 * closing the window) stops, and a paused source is played while it listens, then paused again.
 */
import type { AudioSourceKind } from '../../nodes/definitions/audioTools';

// ── The mix ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Band ↔ Clicks (0..1) as two gains: each at full up to the middle, then fading out towards the other end. */
export function listenMix(m: number): { band: number; clicks: number } {
  const x = Number.isFinite(m) ? Math.max(0, Math.min(1, m)) : 0.5;
  return { band: Math.min(1, 2 * (1 - x)), clicks: Math.min(1, 2 * x) };
}

/** The mix a band starts at: the middle, or clicks only on the Mic (its own sound in the speakers can feed back). */
export const listenDefaultMix = (kind: AudioSourceKind): number => (kind === 'mic' ? 1 : 0.5);

const MIX_KEY = 'pf.audioBand.listenMix';
const mixSlot = (bandId: string, kind: AudioSourceKind) => `${kind === 'mic' ? 'mic' : 'any'}:${bandId}`;

/** A band's remembered mix on this device (the Mic's apart from the rest), else the default. */
export function readListenMix(bandId: string, kind: AudioSourceKind): number {
  try {
    const v = (JSON.parse(localStorage.getItem(MIX_KEY) ?? '{}') as Record<string, number>)[mixSlot(bandId, kind)];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(1, v));
  } catch { /* storage off */ }
  return listenDefaultMix(kind);
}
export function writeListenMix(bandId: string, kind: AudioSourceKind, m: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(MIX_KEY) ?? '{}') as Record<string, number>;
    all[mixSlot(bandId, kind)] = Math.max(0, Math.min(1, m));
    localStorage.setItem(MIX_KEY, JSON.stringify(all));
  } catch { /* storage off: it just doesn't remember */ }
}

// ── The click ────────────────────────────────────────────────────────────────────────────────────────────────

/** The click: a short sine blip (CLICK_HZ), a soft 0.6 ms attack, a fast decay, faded to silence by CLICK_SECONDS. */
export const CLICK_HZ = 1320;
export const CLICK_SECONDS = 0.014;
export const CLICK_PEAK = 0.55;

export function clickSamples(sampleRate: number): Float32Array {
  const n = Math.max(8, Math.round(CLICK_SECONDS * sampleRate)), out = new Float32Array(n);
  const att = 0.0006 * sampleRate, fade = 0.002 * sampleRate, tau = 0.0032 * sampleRate;
  for (let i = 0; i < n; i++) {
    const a = i < att ? 0.5 - 0.5 * Math.cos((Math.PI * i) / att) : 1;
    const f = i > n - fade ? 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / fade) : 1;
    out[i] = CLICK_PEAK * a * f * Math.exp(-Math.max(0, i - att) / tau) * Math.sin((2 * Math.PI * CLICK_HZ * i) / sampleRate);
  }
  return out;
}

const clickBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
export function clickBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = clickBuffers.get(ctx);
  if (!b) {
    const s = clickSamples(ctx.sampleRate);
    b = ctx.createBuffer(1, s.length, ctx.sampleRate);
    b.getChannelData(0).set(s);
    clickBuffers.set(ctx, b);
  }
  return b;
}

// ── A File's hits on the audio clock ─────────────────────────────────────────────────────────────────────────

/** How a playing file maps the render clock to the song (lib/audioEngine.ts playInfo). */
export interface ListenPlay { token: number; startedAt: number; startOff: number; win: { start: number; end: number }; loop: boolean }

/**
 * The render-clock times in [from, to) at which playback reaches each hit (song seconds, sorted), plus `offset`
 * (Sync offset, s). The first pass plays from `startOff` to the window's end; each loop after it the whole window.
 * Sorted, each with the hit's index.
 */
export function hitClockTimes(times: ArrayLike<number>, play: ListenPlay, from: number, to: number, offset = 0): Array<{ t: number; i: number }> {
  const out: Array<{ t: number; i: number }> = [];
  const { start, end } = play.win, len = end - start, base = play.startedAt + offset;
  if (!(to > from) || !(len > 0)) return out;
  // Pass 0: u = h (from startOff); pass k ≥ 1 (looping): u = h + k·len.
  const kLo = play.loop ? Math.max(0, Math.floor((from - base - end) / len)) : 0;
  const kHi = play.loop ? Math.max(0, Math.ceil((to - base - start) / len)) : 0;
  for (let k = kLo; k <= kHi; k++) {
    for (let i = 0; i < times.length; i++) {
      const h = times[i];
      if (h < start || h >= end || (k === 0 && h < play.startOff - 1e-9)) continue;
      const t = base + h + k * len;
      if (t >= from && t < to) out.push({ t, i });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * A live hit queued to fire at `fireAt` (performance seconds; its trigger waits for the speakers): the render time
 * to click at so it is heard then (`latency`: the clicks' output latency), never before `ctxNow`.
 */
export function liveClickTime(fireAt: number, nowSec: number, ctxNow: number, latency: number): number {
  return Math.max(ctxNow, ctxNow + (fireAt - nowSec) - latency);
}

/** Seconds of clicks put on the clock ahead of playback. */
export const LISTEN_LOOKAHEAD = 0.25;

/**
 * Schedules clicks (one-shot buffer sources) into `dest` ahead of playback. `pump` each few tens of ms: it puts on
 * the clock the hits up to `now + lookahead`; when the run (a seek, a restart), the hits, the window or the offset
 * change, the clicks not yet played are taken back and scheduled again.
 */
export class ClickScheduler {
  private scheduled: Array<{ t: number; src: AudioBufferSourceNode; ahead: boolean }> = [];
  private until = -Infinity;
  private key = '';
  private times: ArrayLike<number> | null = null;
  /** Every click put on the clock (render times), latest last; for the window's flashes and tests. */
  readonly log: number[] = [];

  readonly ctx: BaseAudioContext;
  readonly dest: AudioNode;
  constructor(ctx: BaseAudioContext, dest: AudioNode) { this.ctx = ctx; this.dest = dest; }

  /** One click at render time `t` (now, at the earliest). `ahead`: one of pump's (a reset takes it back); a live one stays. */
  clickAt(t: number, ahead = false): void {
    const src = this.ctx.createBufferSource();
    src.buffer = clickBuffer(this.ctx);
    src.connect(this.dest);
    const at = Math.max(t, this.ctx.currentTime);
    src.start(at);
    src.onended = () => { try { src.disconnect(); } catch { /* gone */ } };
    this.scheduled.push({ t: at, src, ahead });
    this.log.push(at);
    if (this.log.length > 64) this.log.shift();
  }

  /** Put the hits up to `now + lookahead` on the clock; returns how many were added. Null `play` / `times`: nothing (and take back what's waiting). */
  pump(now: number, play: ListenPlay | null, times: ArrayLike<number> | null, offset = 0, lookahead = LISTEN_LOOKAHEAD): number {
    this.scheduled = this.scheduled.filter(c => c.t > now - 0.5);
    if (!play || !times) { this.reset(now); this.key = ''; this.times = null; return 0; }
    const key = `${play.token}|${play.win.start}|${play.win.end}|${play.loop}|${offset}`;
    if (key !== this.key || times !== this.times) { this.reset(now); this.key = key; this.times = times; }
    const from = Math.max(this.until, now), to = now + lookahead;
    if (!(to > from)) return 0;
    const hits = hitClockTimes(times, play, from, to, offset);
    for (const h of hits) this.clickAt(h.t, true);
    this.until = to;
    return hits.length;
  }

  /** Take back the clicks put on the clock ahead after `now` (not heard yet); `all`: the live ones too. */
  reset(now: number, all = false): void {
    const gone = (c: { t: number; ahead: boolean }) => c.t > now && (all || c.ahead);
    for (const c of this.scheduled) if (gone(c)) { try { c.src.stop(); } catch { /* not started */ } try { c.src.disconnect(); } catch { /* gone */ } }
    this.scheduled = this.scheduled.filter(c => !gone(c));
    this.until = -Infinity;
  }

  dispose(): void {
    this.reset(-Infinity, true);
    this.scheduled = [];
  }
}

// ── The window's switch ──────────────────────────────────────────────────────────────────────────────────────

export interface ListenTarget { nodeId: string; bandId: string }

/** What ListenControl drives: the engine's listening, and the source's Play (params.playing). */
export interface ListenDeps {
  start(nodeId: string, bandId: string, mix: number): boolean;
  stop(): void;
  setMix(m: number): void;
  /** Is the source's Play on (params.playing)? */
  isPlaying(nodeId: string): boolean;
  setPlaying(nodeId: string, on: boolean): void;
}

/**
 * One band listens at a time. `toggle` starts a band (stopping the one before), or stops it when it is the one
 * listening. A source whose Play was off is played while it listens and paused again when it stops.
 */
export class ListenControl {
  private cur: (ListenTarget & { resume: boolean }) | null = null;
  private fns = new Set<() => void>();
  private deps: ListenDeps;
  constructor(deps: ListenDeps) { this.deps = deps; }

  current(): ListenTarget | null { return this.cur ? { nodeId: this.cur.nodeId, bandId: this.cur.bandId } : null; }
  isListening(bandId: string): boolean { return this.cur?.bandId === bandId; }
  onChange(fn: () => void): () => void { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  private changed(): void { for (const fn of this.fns) fn(); }

  toggle(nodeId: string, bandId: string, mix: number): boolean {
    if (this.cur && this.cur.nodeId === nodeId && this.cur.bandId === bandId) { this.stop(); return false; }
    return this.start(nodeId, bandId, mix);
  }

  start(nodeId: string, bandId: string, mix: number): boolean {
    // Switching bands on the same source keeps what Play was before the first one.
    const prev = this.cur;
    const resume = prev && prev.nodeId === nodeId ? prev.resume : false;
    if (prev) this.stop({ keepPlaying: prev.nodeId === nodeId, quiet: true });
    let paused = false;
    if (!this.deps.isPlaying(nodeId)) { this.deps.setPlaying(nodeId, true); paused = true; }
    if (!this.deps.start(nodeId, bandId, mix)) {
      if (paused || resume) this.deps.setPlaying(nodeId, false);
      this.changed();
      return false;
    }
    this.cur = { nodeId, bandId, resume: resume || paused };
    this.changed();
    return true;
  }

  setMix(m: number): void { if (this.cur) this.deps.setMix(m); }

  /** Stop listening; a source that was paused before is paused again. */
  stop(o: { keepPlaying?: boolean; quiet?: boolean } = {}): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    this.deps.stop();
    if (c.resume && !o.keepPlaying) this.deps.setPlaying(c.nodeId, false);
    if (!o.quiet) this.changed();
  }

  /** The engine stopped it (a Solo took the sound, the band went): forget it, putting Play back. */
  lost(): void { this.stop(); }
}
