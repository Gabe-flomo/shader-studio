/**
 * audioEngine.ts — module-level singleton for Web Audio API.
 * No React, no Zustand. Pattern mirrors scopeRegistry.ts.
 *
 * Audio graph per node:
 *   AudioBufferSourceNode → AnalyserNode → masterGainNode → ctx.destination
 *                                       ↘ recordBus → (a recording's audio track)
 *
 * The record bus carries every song at full level, whatever the listening
 * volume, and only songs: the live microphone has its own context
 * (liveAudio.ts) and never reaches it.
 */

import { audioUniformNamesByNode } from '../compiler/audioUniformNames';

interface AudioNodeState {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  analyser: AnalyserNode;
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
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
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
    let buffer: AudioBuffer;
    try {
      buffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (e) {
      // decodeAudioData rejects with a DOMException whose message is often
      // empty, so name the file and the likely cause ourselves.
      const detail = e instanceof Error && e.message ? e.message : 'unsupported or corrupt audio data';
      const error = new Error(`Could not decode audio "${fileName}": ${detail}`);
      console.error('[audioEngine]', error.message, e);
      throw error;
    }
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

    this.nodes.set(nodeId, {
      buffer,
      source: null,
      analyser,
      freqData,
      isPlaying: false,
      fileName,
      bands: [200],
      freqRange: 200,
      mode: 'band',
      startedAt: 0,
      stoppedAt: 0,
    });
  }

  /** Play from `offset` seconds into the song (looping). */
  startAudio(nodeId: string, offset = 0): void {
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
    source.loop = true;

    // Source → Analyser → MasterGain → destination
    source.connect(state.analyser);
    state.analyser.connect(this.masterGainNode!);
    state.analyser.connect(this.recordBus!);

    const dur = state.buffer.duration;
    const off = dur > 0 ? ((offset % dur) + dur) % dur : 0;
    source.start(0, off);

    state.source = source;
    state.isPlaying = true;
    state.startedAt = audioCtx.currentTime - off;
  }

  /**
   * The songs as they play, for a real-time recording's audio track. Null
   * before any song has been loaded (there is nothing to hear yet).
   */
  recordingStream(): MediaStream | null {
    if (!this.ctx || !this.recordBus || this.nodes.size === 0) return null;
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
      state.analyser.disconnect();
    }
    this.nodes.delete(nodeId);
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
      this.startAudio(nodeId);
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
    return dur > 0 ? ((t % dur) + dur) % dur : 0;
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
    const ch = state.buffer.getChannelData(0), out = new Float32Array(n), per = Math.max(1, Math.floor(ch.length / n));
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
