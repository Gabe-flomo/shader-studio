/**
 * audioEngine.ts — module-level singleton for Web Audio API.
 * No React, no Zustand. Pattern mirrors scopeRegistry.ts.
 *
 * Audio graph per node:
 *   AudioBufferSourceNode → AnalyserNode → masterGainNode → ctx.destination
 */

interface AudioNodeState {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  analyser: AnalyserNode;
  freqData: Float32Array;
  isPlaying: boolean;
  fileName: string;
  freqCenter: number;
  freqRange: number;  // 0 = full spectrum
}

let ctx: AudioContext | null = null;
let masterGainNode: GainNode | null = null;
let _masterVolume = 0.7;
let _masterPaused = false;
const _pausedNodeIds = new Set<string>(); // nodes that were playing when pauseAll was called

const nodes = new Map<string, AudioNodeState>();

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    masterGainNode = ctx.createGain();
    masterGainNode.gain.value = _masterVolume;
    masterGainNode.connect(ctx.destination);
  }
  return ctx;
}

async function loadAudio(nodeId: string, arrayBuffer: ArrayBuffer, fileName: string): Promise<void> {
  const audioCtx = getCtx();
  const buffer = await audioCtx.decodeAudioData(arrayBuffer);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;              // 1024 frequency bins
  analyser.smoothingTimeConstant = 0.8; // temporal smoothing for smooth shader animation

  const freqData = new Float32Array(analyser.frequencyBinCount);

  // Stop existing source if any
  const existing = nodes.get(nodeId);
  if (existing?.isPlaying && existing.source) {
    try { existing.source.stop(); } catch (_) { /* already stopped */ }
    existing.source.disconnect();
  }

  nodes.set(nodeId, {
    buffer,
    source: null,
    analyser,
    freqData,
    isPlaying: false,
    fileName,
    freqCenter: 200,
    freqRange: 200,
  });
}

function startAudio(nodeId: string): void {
  const state = nodes.get(nodeId);
  if (!state) return;
  const audioCtx = getCtx();

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
  state.analyser.connect(masterGainNode!);

  source.start(0);

  state.source = source;
  state.isPlaying = true;
}

function stopAudio(nodeId: string): void {
  const state = nodes.get(nodeId);
  if (!state?.isPlaying || !state.source) return;
  try { state.source.stop(); } catch (_) { /* already stopped */ }
  state.source.disconnect();
  state.source = null;
  state.isPlaying = false;
}

function removeAudio(nodeId: string): void {
  stopAudio(nodeId);
  const state = nodes.get(nodeId);
  if (state) {
    state.analyser.disconnect();
  }
  nodes.delete(nodeId);
}

function updateFreqParams(nodeId: string, freqCenter: number, freqRange: number): void {
  const state = nodes.get(nodeId);
  if (!state) return;
  state.freqCenter = freqCenter;
  state.freqRange = freqRange;
}

function getAmplitude(nodeId: string, freqCenter: number, freqRange: number): number {
  const state = nodes.get(nodeId);
  if (!state?.isPlaying) return 0;
  if (!ctx) return 0;

  state.analyser.getFloatFrequencyData(state.freqData as Float32Array<ArrayBuffer>);

  const binCount = state.analyser.frequencyBinCount; // fftSize / 2 = 1024
  const hzPerBin = ctx.sampleRate / state.analyser.fftSize; // ~21.5 Hz/bin at 44100

  let binLow: number;
  let binHigh: number;

  if (freqRange <= 0) {
    // Full spectrum mode: average all bins
    binLow = 0;
    binHigh = binCount - 1;
  } else {
    binLow  = Math.max(0,          Math.round((freqCenter - freqRange) / hzPerBin));
    binHigh = Math.min(binCount - 1, Math.round((freqCenter + freqRange) / hzPerBin));
  }

  if (binLow > binHigh) binLow = binHigh;

  // Average dB values across the band.
  // getFloatFrequencyData returns values in dB, typically -160 to 0.
  let sum = 0;
  for (let i = binLow; i <= binHigh; i++) {
    sum += state.freqData[i];
  }
  const avgDb = sum / (binHigh - binLow + 1);

  // Normalize: -100 dB → 0.0, 0 dB → 1.0. Clamp to [0, 1].
  return Math.max(0, Math.min(1, (avgDb + 100) / 100));
}

/**
 * Called every animation frame from ShaderCanvas.
 * Returns map of uniformName → amplitude (0–1) for all active audio nodes.
 */
function tick(): Map<string, number> {
  const result = new Map<string, number>();
  for (const [nodeId, state] of nodes) {
    if (!state.isPlaying) continue;
    const amp = getAmplitude(nodeId, state.freqCenter, state.freqRange);
    result.set(`u_audio_${nodeId}`, amp);
  }
  return result;
}

function setMasterVolume(level: number): void {
  _masterVolume = Math.max(0, Math.min(1, level));
  if (masterGainNode) {
    masterGainNode.gain.value = _masterVolume;
  }
}

function getMasterVolume(): number {
  return _masterVolume;
}

function pauseAll(): void {
  _masterPaused = true;
  _pausedNodeIds.clear();
  for (const [nodeId, state] of nodes) {
    if (state.isPlaying) {
      _pausedNodeIds.add(nodeId);
      stopAudio(nodeId);
    }
  }
}

function resumeAll(): void {
  _masterPaused = false;
  for (const nodeId of _pausedNodeIds) {
    startAudio(nodeId);
  }
  _pausedNodeIds.clear();
}

function isMasterPaused(): boolean {
  return _masterPaused;
}

function isLoaded(nodeId: string): boolean {
  return nodes.has(nodeId);
}

function isPlaying(nodeId: string): boolean {
  return nodes.get(nodeId)?.isPlaying ?? false;
}

function getFileName(nodeId: string): string {
  return nodes.get(nodeId)?.fileName ?? '';
}

/**
 * Returns the AnalyserNode for a given nodeId, or null.
 * Used by ShaderCanvas to draw live spectrum in AudioInputModal.
 */
function getAnalyser(nodeId: string): AnalyserNode | null {
  return nodes.get(nodeId)?.analyser ?? null;
}

export const audioEngine = {
  loadAudio,
  startAudio,
  stopAudio,
  removeAudio,
  tick,
  updateFreqParams,
  setMasterVolume,
  getMasterVolume,
  pauseAll,
  resumeAll,
  isMasterPaused,
  isLoaded,
  isPlaying,
  getFileName,
  getAnalyser,
};
