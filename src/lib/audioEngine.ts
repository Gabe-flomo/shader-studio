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
  bands: number[];    // array of center Hz values
  freqRange: number;  // shared half-width (0 = full spectrum in 'full' mode)
  mode: string;       // 'band' | 'full'
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
    bands: [200],
    freqRange: 200,
    mode: 'band',
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

function updateFreqParams(nodeId: string, bands: number[], range: number, mode: string): void {
  const state = nodes.get(nodeId);
  if (!state) return;
  state.bands = bands;
  state.freqRange = range;
  state.mode = mode;
}

function computeBandAmplitude(
  freqData: Float32Array,
  analyser: AnalyserNode,
  center: number,
  range: number,
): number {
  if (!ctx) return 0;
  const binCount = analyser.frequencyBinCount;
  const hzPerBin = ctx.sampleRate / analyser.fftSize;
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
 * Called every animation frame from ShaderCanvas.
 * Returns map of uniformName → amplitude (0–1) for all active audio nodes.
 */
function tick(): Map<string, number> {
  const result = new Map<string, number>();
  for (const [nodeId, state] of nodes) {
    if (!state.isPlaying) continue;
    state.analyser.getFloatFrequencyData(state.freqData as Float32Array<ArrayBuffer>);
    if (state.mode === 'full') {
      // Full spectrum — emit band_0 with range=0
      const amp = computeBandAmplitude(state.freqData, state.analyser, 0, 0);
      result.set(`u_audio_${nodeId}_0`, amp);
    } else {
      for (let i = 0; i < state.bands.length; i++) {
        const amp = computeBandAmplitude(state.freqData, state.analyser, state.bands[i], state.freqRange);
        result.set(`u_audio_${nodeId}_${i}`, amp);
      }
    }
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
