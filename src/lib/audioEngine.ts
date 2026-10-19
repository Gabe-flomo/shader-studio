/**
 * audioEngine.ts — module-level singleton for Web Audio API.
 * No React, no Zustand. Pattern mirrors scopeRegistry.ts.
 *
 * Audio graph per node (the effect chains: lib/audioFx.ts):
 *   AudioBufferSourceNode → inlet → [its chain] → mix → [master chain] → post → masterGainNode → ctx.destination
 *                                  ↘ AnalyserNode (after its chain, or before)       ↘ recordBus → (a recording's audio track)
 *
 * The record bus carries every song at full level, whatever the listening
 * volume, and only songs: the live microphone has its own context
 * (liveAudio.ts) and never reaches it.
 */

import { audioUniformNamesByNode } from '../compiler/audioUniformNames';
import { forgetMedia, mediaSource, rememberMedia, restoreMedia } from './mediaSources';
import { audioFxHost } from './audioFx';
import { layerChainId, nodeChainId } from '../types/playAudioFx';

/** The effect chain a track goes through: an audio layer's (`layer:<id>`) or an Audio Input node's. */
export const trackChainId = (key: string) => (key.startsWith('layer:') ? layerChainId(key.slice(6)) : nodeChainId(key));

interface AudioNodeState {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  analyser: AnalyserNode;
  /** The source plays into this; its effect chain takes it to the mix. */
  inlet: GainNode;
  /** Takes the track's chain out again. */
  unplug: () => void;
  freqData: Float32Array;
  isPlaying: boolean;
  fileName: string;
  bands: number[];    // array of center Hz values
  freqRange: number;  // shared half-width (0 = full spectrum in 'full' mode)
  mode: string;       // 'band' | 'full'
  /** ctx.currentTime when the song's 0 would have played (so position = now − startedAt, looped). */
  startedAt: number;
  /** Where it stopped, while stopped. */
  stoppedAt: number;
  /** A downsampled overview of the waveform, cached per resolution. */
  peaks?: { n: number; data: Float32Array };
  /** The trim it plays within (an Audio Source's In / Out), and whether it loops there; unset: the whole song. */
  win?: { start: number; end: number; loop: boolean };
  /** Its chain's way to the mix, after the analyser's tap: the track's Volume (0 while Muted), so the analysis hears it whatever. */
  out: GainNode;
  /** The track's Volume (0..1) and Mute: what you hear, not what the Audio nodes read. */
  volume: number;
  muted: boolean;
  /** Where the latest start began in the song (seconds), for positionAt before it is heard. */
  startOff: number;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
  /** Every track and outside source sums here, before the master chain. */
  private mix: GainNode | null = null;
  private recordBus: GainNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private masterVolume = 0.7;
  private masterPaused = false;
  private pausedNodeIds = new Set<string>(); // nodes that were playing when pauseAll was called
  private nodes = new Map<string, AudioNodeState>();
  // nodeId → uniform name per band, from the last compile (see setUniformNames).
  // The compiler names uniforms by GLSL slug, not node id, so tick() can only
  // address the shader through this map.
  private uniformNames = new Map<string, string[]>();

  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      this.masterGainNode = this.ctx.createGain();
      this.masterGainNode.gain.value = this.masterVolume;
      this.masterGainNode.connect(this.ctx.destination);
      this.recordBus = this.ctx.createGain();
      // mix → master chain → post: heard through the master volume, and recorded at full level.
      this.mix = this.ctx.createGain();
      const post = this.ctx.createGain();
      post.connect(this.masterGainNode);
      post.connect(this.recordBus);
      audioFxHost.attach(this.ctx, 'master', this.mix, post);
    }
    return this.ctx;
  }

  /**
   * Decode `arrayBuffer` and register it for `nodeId`. Rejects with a
   * descriptive Error when the browser can't decode the data (unsupported
   * codec, corrupt file); the previous audio for the node is left untouched
   * in that case.
   */
  async loadAudio(nodeId: string, arrayBuffer: ArrayBuffer, fileName: string): Promise<void> {
    const audioCtx = this.getCtx();
    // Copied for web exports (see mediaSources.ts) before decoding detaches the buffer; the old file stays if this one fails.
    const previous = mediaSource(nodeId);
    rememberMedia(nodeId, 'audio', fileName, '', arrayBuffer);
    let buffer: AudioBuffer;
    try {
      buffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (e) {
      // decodeAudioData rejects with a DOMException whose message is often
      // empty, so name the file and the likely cause ourselves.
      const detail = e instanceof Error && e.message ? e.message : 'unsupported or corrupt audio data';
      const error = new Error(`Could not decode audio "${fileName}": ${detail}`);
      console.error('[audioEngine]', error.message, e);
      restoreMedia(nodeId, previous);
      throw error;
    }
    this.register(nodeId, buffer, fileName);
  }

  private register(nodeId: string, buffer: AudioBuffer, fileName: string): void {
    const audioCtx = this.getCtx();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;              // 1024 frequency bins
    analyser.smoothingTimeConstant = 0.8; // temporal smoothing for smooth shader animation

    const freqData = new Float32Array(analyser.frequencyBinCount);

    // Stop existing source if any
    const existing = this.nodes.get(nodeId);
    if (existing?.isPlaying && existing.source) {
      try { existing.source.stop(); } catch (_) { /* already stopped */ }
      existing.source.disconnect();
    }
    existing?.unplug();

    const inlet = audioCtx.createGain();
    const out = audioCtx.createGain();
    out.connect(this.mix!);
    const unplugChain = audioFxHost.attach(audioCtx, trackChainId(nodeId), inlet, out, analyser);
    const unplug = () => { unplugChain(); try { out.disconnect(); } catch { /* gone */ } };

    this.nodes.set(nodeId, {
      buffer,
      source: null,
      analyser,
      inlet,
      unplug,
      freqData,
      isPlaying: false,
      fileName,
      bands: [200],
      freqRange: 200,
      mode: 'band',
      startedAt: 0,
      stoppedAt: 0,
      out,
      volume: existing?.volume ?? 1,
      muted: existing?.muted ?? false,
      startOff: 0,
    });
    this.applyVolume(this.nodes.get(nodeId)!);
  }

  // ── Volume and Mute (after the analysis tap) ─────────────────────────────────────────────────────────

  /** What you hear of a track: Volume 0..1, and Mute (silent, still analysed). */
  setVolume(nodeId: string, volume: number, muted: boolean): void {
    const state = this.nodes.get(nodeId);
    if (!state) return;
    state.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    state.muted = muted;
    this.applyVolume(state);
  }

  private applyVolume(state: AudioNodeState): void {
    const g = state.muted ? 0 : state.volume;
    const p = state.out.gain;
    if (this.ctx && typeof p.setTargetAtTime === 'function') p.setTargetAtTime(g, this.ctx.currentTime, 0.01);
    else p.value = g;
  }

  /**
   * Play from `offset` seconds into the song (looping, unless `loop` is false: then it stops at its end). With `win`
   * (an Audio Source's trim) it plays only between its start and end, looping there; an offset outside starts at the start.
   */
  startAudio(nodeId: string, offset = 0, loop = true, win?: { start: number; end: number }): void {
    const state = this.nodes.get(nodeId);
    if (!state) return;
    const audioCtx = this.getCtx();

    // Resume context if suspended (browser autoplay policy)
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    // Stop any existing source first
    if (state.isPlaying && state.source) {
      try { state.source.stop(); } catch (_) { /* already stopped */ }
      state.source.disconnect();
    }

    // AudioBufferSourceNode is single-use — always create fresh
    const source = audioCtx.createBufferSource();
    source.buffer = state.buffer;
    source.loop = loop;
    if (!loop) source.onended = () => {
      // Played to its end (a stop() has already let go of the source, so this one is not current then).
      if (state.source !== source) return;
      source.disconnect();
      state.source = null; state.isPlaying = false; state.stoppedAt = 0;
    };

    // Source → inlet → its chain → the mix (the analyser taps the chain: audioFx.ts)
    source.connect(state.inlet);

    const when = audioCtx.currentTime;
    const dur = state.buffer.duration;
    let off = dur > 0 ? ((offset % dur) + dur) % dur : 0;
    if (win && dur > 0 && win.end > win.start) {
      const w = { start: Math.max(0, Math.min(dur, win.start)), end: Math.max(0, Math.min(dur, win.end)) };
      if (!(off >= w.start && off < w.end)) off = w.start;
      state.win = { ...w, loop };
      if (loop) { source.loopStart = w.start; source.loopEnd = w.end; source.start(when, off); }
      else source.start(when, off, Math.max(0, w.end - off));
    } else {
      state.win = undefined;
      source.start(when, off);
    }

    state.source = source;
    state.isPlaying = true;
    state.startedAt = when - off;
    state.startOff = off;
  }

  /** Outside sources joined to the output (a Video layer's sound): counted so a recording takes them too. */
  private outside = 0;

  /** The shared context, made on first use. Outside sources (a Video layer's sound) are made in it. */
  context(): AudioContext {
    return this.getCtx();
  }

  /**
   * An outside source joins the songs: through the master volume to the
   * speakers, and onto the record bus. Returns the way to take it off again.
   */
  connectOutside(node: AudioNode): () => void {
    this.getCtx();
    node.connect(this.mix!);
    this.outside++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.outside = Math.max(0, this.outside - 1);
      try { node.disconnect(this.mix!); } catch { /* already off */ }
    };
  }

  /**
   * The songs as they play, for a real-time recording's audio track. Null
   * before any song has been loaded (there is nothing to hear yet).
   */
  recordingStream(): MediaStream | null {
    if (!this.ctx || !this.recordBus || (this.nodes.size === 0 && this.outside === 0)) return null;
    if (!this.recordDest) {
      this.recordDest = this.ctx.createMediaStreamDestination();
      this.recordBus.connect(this.recordDest);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.recordDest.stream;
  }

  /** The decoded song of a track, for an offline mix. */
  buffer(nodeId: string): AudioBuffer | null {
    return this.nodes.get(nodeId)?.buffer ?? null;
  }

  stopAudio(nodeId: string): void {
    const state = this.nodes.get(nodeId);
    if (!state?.isPlaying || !state.source) return;
    state.stoppedAt = this.position(nodeId) ?? 0;
    try { state.source.stop(); } catch (_) { /* already stopped */ }
    state.source.disconnect();
    state.source = null;
    state.isPlaying = false;
  }

  removeAudio(nodeId: string): void {
    this.stopAudio(nodeId);
    const state = this.nodes.get(nodeId);
    if (state) {
      state.unplug();
      state.analyser.disconnect();
    }
    this.nodes.delete(nodeId);
    forgetMedia(nodeId);
  }

  updateFreqParams(nodeId: string, bands: number[], range: number, mode: string): void {
    const state = this.nodes.get(nodeId);
    if (!state) return;
    state.bands = bands;
    state.freqRange = range;
    state.mode = mode;
  }

  private computeBandAmplitude(
    freqData: Float32Array,
    analyser: AnalyserNode,
    center: number,
    range: number,
  ): number {
    if (!this.ctx) return 0;
    const binCount = analyser.frequencyBinCount;
    const hzPerBin = this.ctx.sampleRate / analyser.fftSize;
    let binLow: number;
    let binHigh: number;
    if (range <= 0) {
      binLow = 0; binHigh = binCount - 1;
    } else {
      binLow  = Math.max(0,          Math.round((center - range) / hzPerBin));
      binHigh = Math.min(binCount - 1, Math.round((center + range) / hzPerBin));
    }
    if (binLow > binHigh) binLow = binHigh;
    let sum = 0;
    for (let i = binLow; i <= binHigh; i++) sum += freqData[i];
    const avgDb = sum / (binHigh - binLow + 1);
    return Math.max(0, Math.min(1, (avgDb + 100) / 100));
  }

  /**
   * Give the engine the compiled `audioUniforms` map (uniform name → node id)
   * so tick() emits the names the shader actually declares. Called by
   * ShaderCanvas whenever a compile changes the map; cheap enough to call on
   * every recompile since it only walks the audio uniforms.
   */
  setUniformNames(audioUniforms: Record<string, string>): void {
    this.uniformNames = audioUniformNamesByNode(audioUniforms);
  }

  /**
   * Called every animation frame from ShaderCanvas.
   * Returns map of uniformName → amplitude (0–1) for all active audio nodes.
   * Nodes the last compile declared no uniforms for (unwired, or not yet
   * compiled) are skipped.
   */
  // Reused across frames: tick() runs every animation frame, and its result
  // is consumed synchronously by the caller, so one Map serves every call.
  // Uniform names come pre-built from setUniformNames, so no strings are
  // allocated here.
  private tickResult = new Map<string, number>();

  /** What the last tick() wrote (uniform name → amplitude), for a take recording it. */
  lastAmps(): ReadonlyMap<string, number> {
    return this.tickResult;
  }

  tick(): Map<string, number> {
    const result = this.tickResult;
    result.clear();
    for (const [nodeId, state] of this.nodes) {
      if (!state.isPlaying) continue;
      const names = this.uniformNames.get(nodeId);
      if (!names) continue;
      state.analyser.getFloatFrequencyData(state.freqData as Float32Array<ArrayBuffer>);
      if (state.mode === 'full') {
        // Full spectrum — emit band 0 with range=0
        if (names[0] === undefined) continue;
        const amp = this.computeBandAmplitude(state.freqData, state.analyser, 0, 0);
        result.set(names[0], amp);
      } else {
        const n = Math.min(state.bands.length, names.length);
        for (let i = 0; i < n; i++) {
          const name = names[i];
          if (name === undefined) continue;
          const amp = this.computeBandAmplitude(state.freqData, state.analyser, state.bands[i], state.freqRange);
          result.set(name, amp);
        }
      }
    }
    return result;
  }

  /**
   * One band's amplitude (0–1) for a Play mapping, whether or not the node is
   * wired into the shader. `band` is the index into the node's band list.
   * Null while the node isn't playing or has no such band.
   */
  bandLevel(nodeId: string, band: number): number | null {
    const state = this.nodes.get(nodeId);
    if (!state || !state.isPlaying) return null;
    state.analyser.getFloatFrequencyData(state.freqData as Float32Array<ArrayBuffer>);
    if (state.mode === 'full') return band === 0 ? this.computeBandAmplitude(state.freqData, state.analyser, 0, 0) : null;
    const center = state.bands[band];
    if (center === undefined) return null;
    return this.computeBandAmplitude(state.freqData, state.analyser, center, state.freqRange);
  }

  /** Ids of the nodes that currently have audio loaded (for the mappings drawer). */
  loadedNodeIds(): string[] {
    return [...this.nodes.keys()];
  }

  setMasterVolume(level: number): void {
    this.masterVolume = Math.max(0, Math.min(1, level));
    if (this.masterGainNode) {
      this.masterGainNode.gain.value = this.masterVolume;
    }
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  pauseAll(): void {
    this.masterPaused = true;
    this.pausedNodeIds.clear();
    for (const [nodeId, state] of this.nodes) {
      if (state.isPlaying) {
        this.pausedNodeIds.add(nodeId);
        this.stopAudio(nodeId);
      }
    }
  }

  resumeAll(): void {
    this.masterPaused = false;
    for (const nodeId of this.pausedNodeIds) {
      // A trimmed song (an Audio Source's In / Out) picks up inside its trim, where it stopped.
      const w = this.nodes.get(nodeId)?.win;
      if (w) this.startAudio(nodeId, this.nodes.get(nodeId)!.stoppedAt, w.loop, w);
      else this.startAudio(nodeId);
    }
    this.pausedNodeIds.clear();
  }

  isMasterPaused(): boolean {
    return this.masterPaused;
  }

  /** Seconds into the song now (where it stopped, while stopped), or null when nothing is loaded. */
  position(nodeId: string): number | null {
    return this.ctx ? this.positionAt(nodeId, this.ctx.currentTime) : this.nodes.get(nodeId)?.stoppedAt ?? null;
  }

  /**
   * Seconds into the song at context time `ctxTime` (where it stopped, while stopped), or null when nothing is loaded.
   * Before the latest start is heard it reads earlier than where it started (so a trigger at the start still fires).
   */
  positionAt(nodeId: string, ctxTime: number): number | null {
    const state = this.nodes.get(nodeId);
    if (!state) return null;
    if (!state.isPlaying || !this.ctx) return state.stoppedAt;
    const dur = state.buffer.duration;
    const t = ctxTime - state.startedAt;
    if (t < state.startOff) return t;
    const w = state.win;
    if (w && w.end > w.start) {
      // startedAt is when 0 would have played: past the window's end it goes round inside the window.
      if (t < w.end) return Math.max(w.start, t);
      if (!w.loop) return w.end;
      const len = w.end - w.start;
      return w.start + (((t - w.start) % len) + len) % len;
    }
    return dur > 0 ? ((t % dur) + dur) % dur : 0;
  }

  /**
   * The context time the speakers play right now: the render clock less the output's latency (getOutputTimestamp
   * when the browser has it, else baseLatency + outputLatency). What a trigger lines up with.
   */
  heardTime(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0 && ctx.state === 'running') {
      const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      // A stale or odd timestamp: fall back to the latencies.
      if (t <= ctx.currentTime + 1e-3 && ctx.currentTime - t < 1) return t;
    }
    return ctx.currentTime - this.outputLatency();
  }

  /** Seconds between the render clock and the speakers (baseLatency + outputLatency; 0 where a browser doesn't say). */
  outputLatency(): number {
    const ctx = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    if (!ctx) return 0;
    const v = (Number(ctx.baseLatency) || 0) + (Number(ctx.outputLatency) || 0);
    return Number.isFinite(v) && v > 0 && v < 1 ? v : 0;
  }

  /**
   * How a playing track maps the render clock to the song (null while stopped): song time `u = t − startedAt`, from
   * `startOff` on; inside `win` until its end, then round it again while `loop` (positionAt's sums). What a band's
   * Listen schedules its clicks with (lib/audioTools/listen.ts hitClockTimes).
   */
  playInfo(nodeId: string): { token: number; startedAt: number; startOff: number; win: { start: number; end: number }; loop: boolean } | null {
    const st = this.nodes.get(nodeId);
    if (!st?.isPlaying) return null;
    const dur = st.buffer.duration;
    const w = st.win && st.win.end > st.win.start ? st.win : { start: 0, end: dur, loop: st.source?.loop ?? true };
    return { token: st.startedAt, startedAt: st.startedAt, startOff: st.startOff, win: { start: w.start, end: w.end }, loop: w.loop };
  }

  /** Changes on every start (or seek) of a track: a new run of its position. */
  playToken(nodeId: string): number {
    const st = this.nodes.get(nodeId);
    return st?.isPlaying ? st.startedAt : NaN;
  }

  /** Back to `at` seconds (a trim's In): playing on from there, or waiting there while stopped. */
  seek(nodeId: string, at: number): void {
    const state = this.nodes.get(nodeId);
    if (!state) return;
    if (state.isPlaying) this.startAudio(nodeId, at, state.win?.loop ?? (state.source?.loop ?? true), state.win);
    else state.stoppedAt = Math.max(0, at);
  }

  /** The song's length in seconds (0 when nothing is loaded). */
  duration(nodeId: string): number {
    return this.nodes.get(nodeId)?.buffer.duration ?? 0;
  }

  /** The loudest sample in each of `n` slices of the song (0..1), for a waveform overview. */
  peaks(nodeId: string, n: number): Float32Array | null {
    const state = this.nodes.get(nodeId);
    if (!state) return null;
    if (state.peaks?.n === n) return state.peaks.data;
    const ch = state.buffer.getChannelData(0), out = new Float32Array(n), per = Math.max(1, Math.floor(state.buffer.length / n));
    for (let i = 0; i < n; i++) {
      let m = 0;
      const end = Math.min(ch.length, (i + 1) * per);
      for (let j = i * per; j < end; j += 4) { const a = Math.abs(ch[j]); if (a > m) m = a; }
      out[i] = m;
    }
    state.peaks = { n, data: out };
    return out;
  }

  isLoaded(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  isPlaying(nodeId: string): boolean {
    return this.nodes.get(nodeId)?.isPlaying ?? false;
  }

  getFileName(nodeId: string): string {
    return this.nodes.get(nodeId)?.fileName ?? '';
  }

  /**
   * Returns the AnalyserNode for a given nodeId, or null.
   * Used by ShaderCanvas to draw live spectrum in AudioInputModal.
   */
  getAnalyser(nodeId: string): AnalyserNode | null {
    return this.nodes.get(nodeId)?.analyser ?? null;
  }
}

export const audioEngine = new AudioEngine();
