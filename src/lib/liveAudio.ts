/**
 * liveAudio.ts — a live audio input (a microphone, an audio interface, or a
 * virtual cable carrying Ableton's output: BlackHole on macOS, VB-CABLE on
 * Windows) analysed into a few bands for Play mappings and audio-hit triggers.
 *
 * Never connected to the speakers, so there is no feedback. Echo
 * cancellation, noise suppression and auto gain are off: this is music, not
 * a call. One analysis per rendered frame (`update(frame)`), read by band.
 *
 * With no mic at hand, `startTest` listens to a synthesised loop (played
 * aloud) or a tone (silent) instead.
 */
import { renderTestLoop } from './testLoop';

export type LiveBand = 'level' | 'bass' | 'lowmid' | 'highmid' | 'treble';
export type LiveStatus = 'off' | 'requesting' | 'on' | 'denied' | 'unsupported';

/** Hz ranges per band; `level` is the whole signal's loudness. */
export const LIVE_BANDS: Record<LiveBand, { label: string; lo: number; hi: number }> = {
  level:   { label: 'Level',    lo: 0,    hi: 0 },
  bass:    { label: 'Bass',     lo: 25,   hi: 150 },
  lowmid:  { label: 'Low-mid',  lo: 150,  hi: 600 },
  highmid: { label: 'High-mid', lo: 600,  hi: 3000 },
  treble:  { label: 'Treble',   lo: 3000, hi: 12000 },
};

/** dBFS → 0..1: −80 dB is silence, −10 dB is loud. */
export function dbToUnit(db: number): number {
  return Math.max(0, Math.min(1, (db + 80) / 70));
}

/** Mean of a band's bins in dB, as 0..1. Pure (tested). */
export function bandFromSpectrum(freqDb: Float32Array, sampleRate: number, lo: number, hi: number): number {
  const binHz = sampleRate / 2 / freqDb.length;
  const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(freqDb.length - 1, Math.ceil(hi / binHz));
  if (b < a) return 0;
  let sum = 0;
  for (let i = a; i <= b; i++) sum += Math.max(-100, freqDb[i]);
  return dbToUnit(sum / (b - a + 1));
}

/** RMS of a time-domain block as 0..1 on the same dB scale. Pure (tested). */
export function levelFromWave(wave: Float32Array): number {
  let s = 0;
  for (let i = 0; i < wave.length; i++) s += wave[i] * wave[i];
  const rms = Math.sqrt(s / Math.max(1, wave.length));
  return dbToUnit(20 * Math.log10(Math.max(1e-6, rms)));
}

class LiveAudio {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private freq: Float32Array<ArrayBuffer> | null = null;
  private wave: Float32Array<ArrayBuffer> | null = null;
  private values: Record<LiveBand, number> = { level: 0, bass: 0, lowmid: 0, highmid: 0, treble: 0 };
  private lastFrame = -1;
  private status: LiveStatus = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'off' : 'unsupported';
  private deviceId = '';
  private label = '';
  private listeners = new Set<(s: LiveStatus) => void>();
  /** A synthesised sound playing in place of an input (the test loop, or a tone), and how to stop it. */
  private test: { kind: 'loop' | 'tone'; stop: () => void; setHz?: (hz: number) => void } | null = null;
  private loopBuffer: AudioBuffer | null = null;

  getStatus(): LiveStatus { return this.status; }
  /** The device being listened to ("BlackHole 2ch", "CABLE Output"…). */
  getLabel(): string { return this.label; }
  getDeviceId(): string { return this.deviceId; }
  isOn(): boolean { return this.status === 'on'; }

  onStatus(cb: (s: LiveStatus) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private setStatus(s: LiveStatus): void {
    this.status = s;
    for (const l of this.listeners) l(s);
  }

  /** Audio inputs. Labels only appear once the browser has granted access once. */
  async devices(): Promise<Array<{ id: string; label: string }>> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
  }

  /** Start listening (asks for permission the first time). Call from a click. */
  async start(deviceId = ''): Promise<LiveStatus> {
    if (this.status === 'unsupported') return this.status;
    this.stop(false);
    this.setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const ctx = this.ctx ?? new AudioContext();
      this.ctx = ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      ctx.createMediaStreamSource(stream).connect(analyser);
      this.stream = stream;
      this.analyser = analyser;
      this.freq = new Float32Array(analyser.frequencyBinCount);
      this.wave = new Float32Array(analyser.fftSize);
      const track = stream.getAudioTracks()[0];
      this.deviceId = track?.getSettings().deviceId ?? deviceId;
      this.label = track?.label ?? '';
      this.setStatus('on');
    } catch (e) {
      console.warn('[liveAudio] could not open the input', e);
      this.setStatus('denied');
    }
    return this.status;
  }

  /** Listening to the test loop or a test tone (not an input). */
  testing(): 'loop' | 'tone' | null { return this.test?.kind ?? null; }

  /**
   * Listen to a synthesised sound instead of an input: `loop` the test loop
   * (kick, snare, hi-hats and a voice, played aloud), or a sine tone at `hz`
   * (silent: for checking readers). Call from a click (browsers start sound
   * only after one).
   */
  async startTest(kind: 'loop' | 'tone', hz = 60): Promise<LiveStatus> {
    if (typeof AudioContext === 'undefined') return this.status;
    this.stop(false);
    this.setStatus('requesting');
    const ctx = this.ctx ?? new AudioContext();
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.55;
    if (kind === 'loop') {
      this.loopBuffer ??= await renderTestLoop(ctx.sampleRate);
      const src = ctx.createBufferSource(), vol = ctx.createGain();
      src.buffer = this.loopBuffer; src.loop = true;
      vol.gain.value = 0.6;
      src.connect(analyser);
      src.connect(vol).connect(ctx.destination);
      src.start();
      this.test = { kind, stop: () => { try { src.stop(); } catch { /* already stopped */ } src.disconnect(); vol.disconnect(); } };
      this.label = 'Test loop';
    } else {
      const osc = ctx.createOscillator(), amp = ctx.createGain();
      osc.frequency.value = hz; amp.gain.value = 0.3;
      osc.connect(amp).connect(analyser);
      osc.start();
      this.test = {
        kind, stop: () => { try { osc.stop(); } catch { /* already stopped */ } osc.disconnect(); amp.disconnect(); },
        setHz: f => { osc.frequency.setValueAtTime(f, ctx.currentTime); this.label = `Test tone ${Math.round(f)} Hz`; },
      };
      this.label = `Test tone ${Math.round(hz)} Hz`;
    }
    this.analyser = analyser;
    this.freq = new Float32Array(analyser.frequencyBinCount);
    this.wave = new Float32Array(analyser.fftSize);
    this.deviceId = '';
    this.setStatus('on');
    return this.status;
  }

  /** Retune the test tone (no-op otherwise). */
  setTestHz(hz: number): void { this.test?.setHz?.(hz); }

  stop(announce = true): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.test?.stop();
    this.test = null;
    this.analyser = null;
    this.values = { level: 0, bass: 0, lowmid: 0, highmid: 0, treble: 0 };
    if (announce && this.status !== 'unsupported') this.setStatus('off');
  }

  /** Analyse once per rendered frame; repeated calls in one frame are free. */
  update(frame: number): void {
    if (frame === this.lastFrame || !this.analyser || !this.freq || !this.wave || !this.ctx) return;
    this.lastFrame = frame;
    this.analyser.getFloatFrequencyData(this.freq);
    this.analyser.getFloatTimeDomainData(this.wave);
    const sr = this.ctx.sampleRate;
    this.values.level = levelFromWave(this.wave);
    for (const band of ['bass', 'lowmid', 'highmid', 'treble'] as const) this.values[band] = bandFromSpectrum(this.freq, sr, LIVE_BANDS[band].lo, LIVE_BANDS[band].hi);
  }

  /** The waveform and spectrum right now (for the audio layer), or null while no input is open. */
  raw(): { wave: Float32Array; freq: Float32Array; sampleRate: number } | null {
    if (this.status !== 'on' || !this.analyser || !this.freq || !this.wave || !this.ctx) return null;
    const now = performance.now();
    if (now - this.rawAt > 8) { this.rawAt = now; this.analyser.getFloatFrequencyData(this.freq); this.analyser.getFloatTimeDomainData(this.wave); }
    return { wave: this.wave, freq: this.freq, sampleRate: this.ctx.sampleRate };
  }
  private rawAt = 0;

  /** 0..1 for a band, or null while no input is open. */
  value(band: LiveBand): number | null {
    return this.status === 'on' ? this.values[band] : null;
  }
}

export const liveAudio = new LiveAudio();

// Development: drive the input from the console or a test (`__liveAudio.startTest('tone', 60)`).
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __liveAudio?: LiveAudio }).__liveAudio = liveAudio;
