/**
 * tempoFollower.ts — Live's tempo and beat, followed smoothly (docs/live-connector-plan.md,
 * "Tempo and beat: following Live").
 *
 * The Live connector sends `/pf/transport` (song time in beats, tempo, playing) 20–30 times a
 * second, with some jitter from Live's main thread and our event loop. Reading the last sample
 * would make a beat that stutters; this keeps an estimate `beats(now) = b0 + (now − t0) × rate`
 * and steers it towards each new sample (a small phase-locked loop):
 *
 * - The error between a sample and the estimate is corrected by speeding up or slowing down a
 *   little (at most ±`maxSlew` of the tempo) over `horizonMs`, never by jumping, so the beat
 *   never runs backwards while Live plays.
 * - A jump of more than `snapBeats` (the playhead moved, a loop wrapped, Live started or
 *   stopped) snaps instead of easing.
 * - Stopped: the position holds where Live stopped.
 *
 * Pure (times are passed in), so tests drive it with a fake transport stream.
 */

export interface TempoFollowerOptions {
  /** How long a phase error takes to be corrected, ms. */
  horizonMs?: number;
  /** The most the estimate runs fast or slow while correcting (0.08 = 8%). */
  maxSlew?: number;
  /** An error bigger than this (beats) snaps instead of easing. */
  snapBeats?: number;
}

export class TempoFollower {
  private has = false;
  private b0 = 0;
  private t0 = 0;
  /** Beats per ms at Live's tempo, and the corrected rate the estimate runs at. */
  private nominal = 120 / 60000;
  private rate = 120 / 60000;
  private readonly horizonMs: number;
  private readonly maxSlew: number;
  private readonly snapBeats: number;
  playing = false;
  tempo = 120;
  sigNum = 4;
  sigDen = 4;
  /** When the last sample arrived (ms), 0 before any. */
  lastSample = 0;

  constructor(o: TempoFollowerOptions = {}) {
    this.horizonMs = o.horizonMs ?? 300;
    this.maxSlew = o.maxSlew ?? 0.08;
    this.snapBeats = o.snapBeats ?? 0.25;
  }

  /** Has Live's transport been heard yet? */
  ready(): boolean { return this.has; }

  reset(): void {
    this.has = false;
    this.playing = false;
    this.lastSample = 0;
  }

  /** One `/pf/transport` sample, received at `now` (ms). */
  sample(now: number, beats: number, tempo: number, playing: boolean, sigNum = this.sigNum, sigDen = this.sigDen): void {
    if (!Number.isFinite(beats) || !Number.isFinite(tempo) || tempo <= 0) return;
    this.tempo = tempo;
    this.sigNum = Math.max(1, Math.round(sigNum) || 4);
    this.sigDen = Math.max(1, Math.round(sigDen) || 4);
    this.nominal = tempo / 60000;
    this.lastSample = now;
    const wasPlaying = this.playing;
    if (!this.has || !playing || !wasPlaying) { this.playing = playing; this.snap(now, beats); return; }
    const predicted = this.beatsAt(now);
    const err = beats - predicted;
    if (Math.abs(err) > this.snapBeats) { this.snap(now, beats); return; }
    // Carry on from where the estimate is (no jump), at a rate that closes the gap over the horizon.
    this.b0 = predicted;
    this.t0 = now;
    const slew = Math.max(-this.maxSlew, Math.min(this.maxSlew, err / (this.nominal * this.horizonMs)));
    this.rate = this.nominal * (1 + slew);
  }

  private snap(now: number, beats: number): void {
    this.has = true;
    this.b0 = beats;
    this.t0 = now;
    this.rate = this.nominal;
  }

  /** Song position in beats at `now` (ms). Held while stopped. */
  beatsAt(now: number): number {
    if (!this.has) return 0;
    if (!this.playing) return this.b0;
    return this.b0 + Math.max(0, now - this.t0) * this.rate;
  }

  /** Where in the bar (0..1) at `now`, with Live's time signature (a bar is sigNum beats of 4/sigDen quarter notes). */
  barPhase(now: number): number {
    const b = this.beatsAt(now) / quartersPerBar(this.sigNum, this.sigDen);
    return b - Math.floor(b);
  }
}

/** Quarter notes (Live's song-time beats) in a bar of `num`/`den`. */
export function quartersPerBar(num: number, den: number): number {
  return Math.max(1, num) * (4 / Math.max(1, den));
}

/** A beat trigger following Live: its running count and whether it's in the short gate after each pulse. */
export function liveBeatAt(beats: number, tempo: number, every: number): { count: number; gate: boolean } {
  const per = Math.max(0.0625, every);
  const count = Math.floor(beats / per) + 1;
  const intoBeats = beats - (count - 1) * per;
  const intoSeconds = (intoBeats * 60) / Math.max(1, tempo);
  const period = (per * 60) / Math.max(1, tempo);
  return { count, gate: intoSeconds < Math.min(0.12, period / 4) };
}
