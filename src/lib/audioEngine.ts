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
  /** Its chain's way to the mix (a gain: quiet while its stem is heard instead). */
  out: GainNode;
  /**
   * A separated stem of the song (an Audio Source's Stem, lib/audioTools/stems.ts), played in step with it: started
   * at the same moment and offset, within the same trim. Its own analyser is what the Audio nodes read then.
   */
  stem?: StemState;
  /** The speakers play the stem instead of the song. */
  hearStem: boolean;
}

interface StemState {
  buffer: AudioBuffer;
  peaks?: { n: number; data: Float32Array };
  source: AudioBufferSourceNode | null;
  inlet: GainNode;
  out: GainNode;
  analyser: AnalyserNode;
  unplug: () => void;
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

    if (existing) this.dropStem(existing);
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
      hearStem: false,
    });
  }

  // ── Stems ──────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Give a track its stem (or none): played in step with the song from now on (restarted together when playing),
   * through the same effect chain, and read by its own analyser.
   */
  setStem(nodeId: string, buffer: AudioBuffer | null): void {
    const state = this.nodes.get(nodeId);
    if (!state) return;
    if (state.stem?.buffer === buffer) return;
    const pos = state.isPlaying ? this.position(nodeId) ?? 0 : null;
    this.dropStem(state);
    if (buffer) {
      const ctx = this.getCtx();
      const inlet = ctx.createGain(), out = ctx.createGain(), analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      out.connect(this.mix!);
      const unplugChain = audioFxHost.attach(ctx, trackChainId(nodeId), inlet, out, analyser);
      state.stem = { buffer, source: null, inlet, out, analyser, unplug: () => { unplugChain(); try { out.disconnect(); } catch { /* gone */ } } };
    }
    this.applyHear(state);
    // Playing: start both again together, where the song was.
    if (pos !== null) this.startAudio(nodeId, pos, state.win?.loop ?? true, state.win);
  }

  /** The speakers play the stem (true) or the song (false); the analysers read on either way. */
  setHearStem(nodeId: string, on: boolean): void {
    const state = this.nodes.get(nodeId);
    if (!state) return;
    state.hearStem = on;
    this.applyHear(state);
  }

  private applyHear(state: AudioNodeState): void {
    const stem = !!state.stem && state.hearStem;
    state.out.gain.value = stem ? 0 : 1;
    if (state.stem) state.stem.out.gain.value = stem ? 1 : 0;
  }

  private dropStem(state: AudioNodeState): void {
    const st = state.stem;
    if (!st) return;
    if (st.source) { try { st.source.stop(); } catch { /* stopped */ } st.source.disconnect(); }
    st.unplug();
    st.analyser.disconnect();
    state.stem = undefined;
    this.applyHear(state);
  }

  /** The stem's analyser (null without a stem). */
  stemAnalyser(nodeId: string): AnalyserNode | null { return this.nodes.get(nodeId)?.stem?.analyser ?? null; }

  /** The stem's decoded sound (null without a stem). */
  stemBuffer(nodeId: string): AudioBuffer | null { return this.nodes.get(nodeId)?.stem?.buffer ?? null; }

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
    if (state.stem?.source) { try { state.stem.source.stop(); } catch { /* stopped */ } state.stem.source.disconnect(); state.stem.source = null; }

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

    // The stem (when there is one) starts with the song: same moment, same offset, same loop.
    const stem = state.stem ? audioCtx.createBufferSource() : null;
    if (stem && state.stem) { stem.buffer = state.stem.buffer; stem.loop = loop; stem.connect(state.stem.inlet); state.stem.source = stem; }
    const when = audioCtx.currentTime;
    const dur = state.buffer.duration;
    let off = dur > 0 ? ((offset % dur) + dur) % dur : 0;
    if (win && dur > 0 && win.end > win.start) {
      const w = { start: Math.max(0, Math.min(dur, win.start)), end: Math.max(0, Math.min(dur, win.end)) };
      if (!(off >= w.start && off < w.end)) off = w.start;
      state.win = { ...w, loop };
      for (const s of stem ? [source, stem] : [source]) {
        if (loop) { s.loopStart = w.start; s.loopEnd = w.end; s.start(when, off); }
        else s.start(when, off, Math.max(0, w.end - off));
      }
    } else {
      state.win = undefined;
      source.start(when, off);
      if (stem) { if (loop) { stem.loopStart = 0; stem.loopEnd = dur; } stem.start(when, off, loop ? undefined : Math.max(0, dur - off)); }
    }

    state.source = source;
    state.isPlaying = true;
    state.startedAt = when - off;
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
    if (state.stem?.source) { try { state.stem.source.stop(); } catch { /* stopped */ } state.stem.source.disconnect(); state.stem.source = null; }
  }

  removeAudio(nodeId: string): void {
    this.stopAudio(nodeId);
    const state = this.nodes.get(nodeId);
    if (state) {
      this.dropStem(state);
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
    const state = this.nodes.get(nodeId);
    if (!state) return null;
    if (!state.isPlaying || !this.ctx) return state.stoppedAt;
    const dur = state.buffer.duration;
    const t = this.ctx.currentTime - state.startedAt;
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

  /** The song's length in seconds (0 when nothing is loaded). */
  duration(nodeId: string): number {
    return this.nodes.get(nodeId)?.buffer.duration ?? 0;
  }

  /** The loudest sample in each of `n` slices of the song (0..1), for a waveform overview; `stem`: its stem's. */
  peaks(nodeId: string, n: number, stem = false): Float32Array | null {
    const state = this.nodes.get(nodeId);
    if (!state) return null;
    const holder: { buffer: AudioBuffer; peaks?: { n: number; data: Float32Array } } | undefined = stem ? state.stem : state;
    if (!holder) return null;
    if (holder.peaks?.n === n) return holder.peaks.data;
    // Over the song's length (a stem may be a few samples longer or shorter): the two line up.
    const ch = holder.buffer.getChannelData(0), out = new Float32Array(n), per = Math.max(1, Math.floor(state.buffer.length / n));
    for (let i = 0; i < n; i++) {
      let m = 0;
      const end = Math.min(ch.length, (i + 1) * per);
      for (let j = i * per; j < end; j += 4) { const a = Math.abs(ch[j]); if (a > m) m = a; }
      out[i] = m;
    }
    holder.peaks = { n, data: out };
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
