/**
 * The Audio nodes (docs/audio-tools.md, plan in docs/audio-tools-plan.md): an Audio Source and the nodes that
 * listen to it (Band level, Hit, Spectrum, Spectrogram, Waveform). They replace the retired Audio Input.
 *
 * Nothing here is heard in the shader: the `audio` wire only says which source a node listens to. The listening
 * runs on the CPU once per frame (lib/audioTools/engine.ts) and reaches the picture two ways:
 *  - numbers as live uniforms, `u_aud_<slug>_<channel>`, written through the input bus (lib/inputBus.ts);
 *  - pictures of the sound as small 8-bit textures, `u_tex_<slug>` (the store's nodeTextures[id]), with the
 *    `_px` define the texture tools read, so Sample (texture) and friends take them as they take a Pass.
 * Every setting is read by the engine, so none becomes a uniform (compiler/uniformPatcher.ts SKIP_UNIFORM_TYPES).
 */
import type { GraphNode, NodeDefinition, ParamDef } from '../../types/nodeGraph';
import { texUv } from './passes';
import { bandOutputs, bandsOf } from '../../lib/audioTools/bands';

export const AUDIO_CATEGORY = 'Audio';

export const AUDIO_SOURCE_TYPE = 'audioSource';
export const AUDIO_BAND_TYPE = 'audioBand';
export const AUDIO_HIT_TYPE = 'audioHit';
export const AUDIO_SPECTRUM_TYPE = 'audioSpectrum';
export const AUDIO_SPECTROGRAM_TYPE = 'audioSpectrogram';
export const AUDIO_WAVEFORM_TYPE = 'audioWaveform';

export const AUDIO_TOOL_TYPES: readonly string[] = [AUDIO_SOURCE_TYPE, AUDIO_BAND_TYPE, AUDIO_HIT_TYPE, AUDIO_SPECTRUM_TYPE, AUDIO_SPECTROGRAM_TYPE, AUDIO_WAVEFORM_TYPE];
export const isAudioToolType = (type: string): boolean => AUDIO_TOOL_TYPES.includes(type);

/** The numbers each node writes every frame (its live uniforms' channels). */
export const AUDIO_LIVE_CHANNELS: Record<string, readonly string[]> = {
  [AUDIO_SOURCE_TYPE]: ['level', 'time'],
  [AUDIO_BAND_TYPE]: ['level', 'peak'],
  [AUDIO_HIT_TYPE]: ['trigger', 'envelope', 'count', 'strength'],
};

/** The numbers a node writes every frame: its fixed channels, and an Audio Source's band outputs. */
export function audioLiveChannels(node: GraphNode): string[] {
  const fixed = [...(AUDIO_LIVE_CHANNELS[node.type] ?? [])];
  if (node.type !== AUDIO_SOURCE_TYPE) return fixed;
  return [...fixed, ...bandOutputs(bandsOf(node.params)).map(o => o.channel)];
}

/** The nodes that hand the picture a texture. */
export const AUDIO_TEXTURE_TYPES: ReadonlySet<string> = new Set([AUDIO_SPECTRUM_TYPE, AUDIO_SPECTROGRAM_TYPE, AUDIO_WAVEFORM_TYPE]);

export const audioToolUniform = (slug: string, channel: string): string => `u_aud_${slug}_${channel}`;
export const audioToolSampler = (slug: string): string => `u_tex_${slug}`;

// ── Settings the engine reads ────────────────────────────────────────────────────────────────────────────────

/** Audio Source's tabs. (A Video's sound is a later tab.) Phase 1's Test loop opens as File, empty. */
export type AudioSourceKind = 'file' | 'mic';
export const audioSourceKind = (node: GraphNode): AudioSourceKind => (node.params.source === 'mic' ? 'mic' : 'file');

/** Band level's bands, in Hz. */
export const BAND_PRESETS: Record<string, { label: string; lo: number; hi: number }> = {
  sub: { label: 'Sub (20–60 Hz)', lo: 20, hi: 60 },
  bass: { label: 'Bass (60–250 Hz)', lo: 60, hi: 250 },
  lowmid: { label: 'Low mid (250–500 Hz)', lo: 250, hi: 500 },
  mid: { label: 'Mid (500 Hz–2 kHz)', lo: 500, hi: 2000 },
  high: { label: 'High (2–6 kHz)', lo: 2000, hi: 6000 },
  air: { label: 'Air (6–16 kHz)', lo: 6000, hi: 16000 },
};

/** Hit's sounds: where each lives, in Hz. */
export const HIT_PRESETS: Record<string, { label: string; lo: number; hi: number }> = {
  kick: { label: 'Kick (30–150 Hz)', lo: 30, hi: 150 },
  snare: { label: 'Snare (200 Hz–5 kHz)', lo: 200, hi: 5000 },
  hihat: { label: 'Hi-hat (6–16 kHz)', lo: 6000, hi: 16000 },
  any: { label: 'Any (30 Hz–16 kHz)', lo: 30, hi: 16000 },
};

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The Hz a Band level or Hit listens between: its preset's, or Low…High for Custom. */
export function audioBandOf(node: GraphNode): { lo: number; hi: number } {
  const table = node.type === AUDIO_HIT_TYPE ? HIT_PRESETS : BAND_PRESETS;
  const key = String(node.type === AUDIO_HIT_TYPE ? node.params.sound : node.params.band);
  const p = table[key];
  if (p) return { lo: p.lo, hi: p.hi };
  const lo = Math.max(1, num(node.params.low, 60)), hi = Math.max(lo + 1, num(node.params.high, 250));
  return { lo, hi };
}

const pick = (v: unknown, allowed: readonly number[], d: number): number => {
  const n = Number(v);
  return allowed.includes(n) ? n : d;
};
export const SPECTRUM_BINS = [64, 128, 256, 512] as const;
export const SPECTROGRAM_BINS = [64, 128, 256] as const;
export const SPECTROGRAM_ROWS = [64, 128, 256] as const;
export const WAVEFORM_SAMPLES = [256, 512, 1024, 2048] as const;

/** A texture node's size in texels: width × height. */
export function audioTextureSize(node: GraphNode): { w: number; h: number } {
  switch (node.type) {
    case AUDIO_SPECTRUM_TYPE: return { w: pick(node.params.bins, SPECTRUM_BINS, 128), h: 1 };
    case AUDIO_SPECTROGRAM_TYPE: return { w: pick(node.params.bins, SPECTROGRAM_BINS, 128), h: pick(node.params.history, SPECTROGRAM_ROWS, 128) };
    case AUDIO_WAVEFORM_TYPE: return { w: pick(node.params.samples, WAVEFORM_SAMPLES, 512), h: 1 };
    default: return { w: 1, h: 1 };
  }
}

// ── Shared pieces ────────────────────────────────────────────────────────────────────────────────────────────

const AUDIO_IN = { audio: { type: 'audio' as const, label: 'Audio', hint: 'The sound to listen to: wire an Audio Source\'s Audio.' } };
const UV_IN = { type: 'vec2' as const, label: 'UV', hint: 'Where to read, in picture coordinates. Unwired: this pixel.' };

const secs = (label: string, hint: string, max: number, step = 0.01): ParamDef => ({ label, type: 'float', min: 0, max, step, hint });
const selectOf = (label: string, hint: string, values: readonly number[], unit: string): ParamDef => ({
  label, type: 'select', hint, options: values.map(v => ({ value: String(v), label: `${v} ${unit}` })),
});
const LAYOUT: ParamDef = { label: 'Layout', type: 'select', hint: 'Log: equal room for every octave, as music is heard (bass gets most of the width). Linear: equal Hz per step (the highs take most of it).', options: [
  { value: 'log', label: 'Log (musical)' }, { value: 'linear', label: 'Linear' },
] };
const MIN_DB: ParamDef = { label: 'Min dB', type: 'float', min: -140, max: 0, step: 1, hint: 'Quieter than this reads 0.' };
const MAX_DB: ParamDef = { label: 'Max dB', type: 'float', min: -100, max: 0, step: 1, hint: 'Louder than this reads 1.' };

/** The `_px` define a texture tool reads beside the sampler (one texel, in texture coordinates). */
const pxDefine = (node: GraphNode): string[] => {
  const { w, h } = audioTextureSize(node);
  return [`#define ${audioToolSampler(node.id)}_px (vec2(1.0) / vec2(${w.toFixed(1)}, ${h.toFixed(1)}))`];
};

const liveOutputs = (node: GraphNode): Record<string, string> =>
  Object.fromEntries(audioLiveChannels(node).map(ch => [ch, audioToolUniform(node.id, ch)]));

// ── Audio Source ─────────────────────────────────────────────────────────────────────────────────────────────

const SOURCE_OUTPUTS = {
  audio: { type: 'audio' as const, label: 'Audio', hint: 'The sound, for the Audio nodes that listen to it.' },
  level: { type: 'float' as const, label: 'Level', hint: 'How loud it is right now, 0–1 (its RMS on a dB scale).' },
  time: { type: 'float' as const, label: 'Time', hint: 'Seconds into the file (round each loop of the trim); the Mic counts from when it started.' },
};

/**
 * Audio Source's sockets follow its bands (lib/audioTools/bands.ts): Audio, Level and Time, then each band's Value
 * ("Bass") and Trigger ("Kick (trigger)"). Phase 1's Test loop opens as File (empty). Wires into an output that went
 * away are dropped by the store.
 */
export function retypeAudioSource(node: GraphNode): GraphNode {
  if (node.type !== AUDIO_SOURCE_TYPE) return node;
  let params = node.params;
  if (params.source !== 'file' && params.source !== 'mic') params = { ...params, source: 'file' };
  const outputs: GraphNode['outputs'] = {};
  for (const [k, s] of Object.entries(SOURCE_OUTPUTS)) outputs[k] = { type: s.type, label: s.label };
  for (const o of bandOutputs(bandsOf(params))) outputs[o.key] = { type: 'float', label: o.label };
  const cur = node.outputs ?? {};
  const curKeys = Object.keys(cur);
  const same = Object.keys(outputs).length === curKeys.length
    && Object.entries(outputs).every(([k, o], i) => curKeys[i] === k && cur[k]?.type === o.type && cur[k]?.label === o.label);
  if (same && params === node.params) return node;
  return { ...node, params, outputs: same ? node.outputs : outputs };
}

export const AudioSourceNode: NodeDefinition = {
  type: AUDIO_SOURCE_TYPE,
  label: 'Audio Source',
  category: AUDIO_CATEGORY,
  aliases: ['Audio', 'Sound', 'Music', 'Song', 'Microphone', 'Mic', 'Audio file', 'Audio In', 'Line in', 'Frequency bands', 'Kick trigger'],
  description: 'Where the sound comes from: a File (Load a sound on the card) or the Mic (or an audio interface), picked with the tabs on the card. Open ↗ shows the whole file to trim, and a live spectrum where you pick frequency bands: each band becomes an output here, its level or a trigger on each hit in it. Wire Audio into Band level, Hit, Spectrum, Spectrogram or Waveform; Level is how loud it is right now (0–1) and Time the seconds it has played.',
  inputs: {},
  outputs: SOURCE_OUTPUTS,
  defaultParams: { source: 'file', playing: true, loop: true, gain: 1, _fileName: '', bands: [], trimIn: 0, trimOut: 0 },
  paramDefs: {
    playing: { label: 'Play', type: 'bool', hint: 'Plays the file (heard through the speakers), or listens to the Mic.' },
    loop: { label: 'Loop', type: 'bool', showWhen: { param: 'source', value: 'file' }, hint: 'Start again at the trim\'s end (or the file\'s). Off: it stops there.' },
    gain: { label: 'Gain', type: 'float', min: 0, max: 8, step: 0.01, hint: 'How loud the listening nodes and the bands hear it (not how loud you hear it): raise it for a quiet microphone.' },
  },
  assignable: false,
  syncSockets: retypeAudioSource,
  generateGLSL: (node: GraphNode) => ({ code: '', outputVars: { audio: '0.0', ...liveOutputs(node) } }),
};

// ── Band level ───────────────────────────────────────────────────────────────────────────────────────────────

export const AudioBandNode: NodeDefinition = {
  type: AUDIO_BAND_TYPE,
  label: 'Band level',
  category: AUDIO_CATEGORY,
  aliases: ['Audio band', 'Frequency band', 'Bass level', 'EQ band', 'Audio level', 'Envelope follower'],
  description: 'How loud one band of the sound is, 0–1: pick a Band (Sub, Bass, Low mid, Mid, High, Air) or Custom between Low and High. Attack and Release smooth it (rise and fall times); Gain scales it. Peak holds the highest Level for a moment, then falls.',
  inputs: { ...AUDIO_IN },
  outputs: {
    level: { type: 'float', label: 'Level', hint: 'The band\'s loudness, 0–1, smoothed.' },
    peak: { type: 'float', label: 'Peak', hint: 'The highest Level lately: holds for 0.6 s, then falls.' },
  },
  defaultParams: { band: 'bass', low: 60, high: 250, attack: 0.01, release: 0.15, gain: 1 },
  paramDefs: {
    band: { label: 'Band', type: 'select', hint: 'Which frequencies to listen to.', options: [
      ...Object.entries(BAND_PRESETS).map(([value, p]) => ({ value, label: p.label })), { value: 'custom', label: 'Custom (Low – High)' },
    ] },
    low: { label: 'Low', type: 'float', min: 20, max: 20000, step: 1, showWhen: { param: 'band', value: 'custom' }, hint: 'The band\'s bottom, in Hz.' },
    high: { label: 'High', type: 'float', min: 20, max: 20000, step: 1, showWhen: { param: 'band', value: 'custom' }, hint: 'The band\'s top, in Hz.' },
    attack: secs('Attack', 'Seconds to rise: 0 jumps at once, more makes it swell.', 2),
    release: secs('Release', 'Seconds to fall back: longer leaves a tail after each hit.', 4),
    gain: { label: 'Gain', type: 'float', min: 0, max: 8, step: 0.01, hint: 'Scales the Level (it stops at 1).' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode) => ({ code: '', outputVars: liveOutputs(node) }),
};

// ── Hit ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const AudioHitNode: NodeDefinition = {
  type: AUDIO_HIT_TYPE,
  label: 'Hit',
  category: AUDIO_CATEGORY,
  aliases: ['Onset', 'Beat detect', 'Kick detect', 'Transient', 'Drum trigger', 'Audio trigger', 'Beat'],
  description: 'Finds hits in the sound (a kick, a snare, a hi-hat): a sudden rise in its band, louder than what came just before. Trigger is 1 for one frame per hit (wire it into Envelope, Counter or Sample & Hold), Envelope jumps to 1 and falls in Decay, Count counts the hits, Strength is how loud the last one was. Sensitivity catches quieter hits; Cooldown is the shortest gap between two.',
  inputs: { ...AUDIO_IN },
  outputs: {
    trigger: { type: 'float', label: 'Trigger', hint: '1 on the frame of a hit, 0 otherwise: a rising edge the memory nodes count.' },
    envelope: { type: 'float', label: 'Envelope', hint: '1 on a hit, falling to 0 in Decay.' },
    count: { type: 'float', label: 'Count', hint: 'Hits so far (from when the graph loaded).' },
    strength: { type: 'float', label: 'Strength', hint: 'How loud the band was at the last hit, 0–1.' },
  },
  defaultParams: { sound: 'kick', low: 30, high: 150, sensitivity: 0.5, cooldown: 120, decay: 0.3 },
  paramDefs: {
    sound: { label: 'Sound', type: 'select', hint: 'Which sound to listen for: each lives in its own band.', options: [
      ...Object.entries(HIT_PRESETS).map(([value, p]) => ({ value, label: p.label })), { value: 'custom', label: 'Custom (Low – High)' },
    ] },
    low: { label: 'Low', type: 'float', min: 20, max: 20000, step: 1, showWhen: { param: 'sound', value: 'custom' }, hint: 'The band\'s bottom, in Hz.' },
    high: { label: 'High', type: 'float', min: 20, max: 20000, step: 1, showWhen: { param: 'sound', value: 'custom' }, hint: 'The band\'s top, in Hz.' },
    sensitivity: { label: 'Sensitivity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Higher catches quieter hits (and more false ones); lower only the clear ones.' },
    cooldown: { label: 'Cooldown', type: 'float', min: 40, max: 2000, step: 1, hint: 'Milliseconds after a hit before the next can count: stops one drum counting twice.' },
    decay: secs('Decay', 'Seconds the Envelope takes to fall from 1 to 0.', 5),
  },
  assignable: false,
  generateGLSL: (node: GraphNode) => ({ code: '', outputVars: liveOutputs(node) }),
};

// ── Spectrum, Spectrogram, Waveform ──────────────────────────────────────────────────────────────────────────

const st = (inputVars: Record<string, string>) => texUv(inputVars.uv ?? 'g_uv');

export const AudioSpectrumNode: NodeDefinition = {
  type: AUDIO_SPECTRUM_TYPE,
  label: 'Spectrum',
  category: AUDIO_CATEGORY,
  aliases: ['FFT', 'Frequency spectrum', 'Equalizer', 'Spectrum bars', 'Audio spectrum', 'Frequencies'],
  description: 'The sound split into frequencies, low to high across the picture: Value is how loud the frequency at this pixel\'s left-right place is (0–1), so comparing it with the height draws bars. Texture is the same as a strip (Bins wide) for Sample (texture): across is frequency. Layout spaces them Log (musical) or Linear; Min dB and Max dB set what reads 0 and 1; Smoothing calms it.',
  inputs: { ...AUDIO_IN, uv: UV_IN },
  outputs: {
    value: { type: 'float', label: 'Value', hint: 'Loudness of the frequency at this pixel\'s left-right place, 0–1.' },
    texture: { type: 'texture', label: 'Texture', hint: 'The spectrum as a strip: across is frequency (low on the left), grey is loudness.' },
  },
  defaultParams: { bins: '128', layout: 'log', minDb: -90, maxDb: -20, smoothing: 0.5 },
  paramDefs: {
    bins: selectOf('Bins', 'How many frequency steps across.', SPECTRUM_BINS, 'bins'),
    layout: LAYOUT,
    minDb: MIN_DB,
    maxDb: MAX_DB,
    smoothing: { label: 'Smoothing', type: 'float', min: 0, max: 0.95, step: 0.01, hint: 'Blends each frame with the last: higher moves more calmly.' },
  },
  assignable: false,
  declarationsFor: pxDefine,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, S = audioToolSampler(id);
    return {
      code: `    float ${id}_v = texture2D(${S}, vec2(clamp(${st(inputVars)}.x, 0.0, 1.0), 0.5)).r;\n`,
      outputVars: { value: `${id}_v`, texture: S },
    };
  },
};

export const AudioSpectrogramNode: NodeDefinition = {
  type: AUDIO_SPECTROGRAM_TYPE,
  label: 'Spectrogram',
  category: AUDIO_CATEGORY,
  aliases: ['Waterfall', 'Spectrum history', 'Sonogram', 'Audio history'],
  description: 'The Spectrum over time, as a waterfall: across is frequency, the newest moment is at the top and older ones slide down (History rows of them). Value is the loudness at this pixel (0–1); Texture is the whole picture for Sample (texture). Layout, Min dB and Max dB work as on Spectrum.',
  inputs: { ...AUDIO_IN, uv: UV_IN },
  outputs: {
    value: { type: 'float', label: 'Value', hint: 'Loudness at this pixel: frequency across, time down (the top is now).' },
    texture: { type: 'texture', label: 'Texture', hint: 'The history: across is frequency, up is newer.' },
  },
  defaultParams: { bins: '128', history: '128', layout: 'log', minDb: -90, maxDb: -20 },
  paramDefs: {
    bins: selectOf('Bins', 'How many frequency steps across.', SPECTROGRAM_BINS, 'bins'),
    history: selectOf('History', 'How many moments it keeps (one a frame: 128 is about 2 seconds).', SPECTROGRAM_ROWS, 'rows'),
    layout: LAYOUT,
    minDb: MIN_DB,
    maxDb: MAX_DB,
  },
  assignable: false,
  declarationsFor: pxDefine,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, S = audioToolSampler(id);
    return {
      code: `    float ${id}_v = texture2D(${S}, clamp(${st(inputVars)}, 0.0, 1.0)).r;\n`,
      outputVars: { value: `${id}_v`, texture: S },
    };
  },
};

export const AudioWaveformNode: NodeDefinition = {
  type: AUDIO_WAVEFORM_TYPE,
  label: 'Waveform',
  category: AUDIO_CATEGORY,
  aliases: ['Oscilloscope', 'Scope', 'Audio wave', 'Wave shape', 'Samples'],
  description: 'The sound\'s last few milliseconds as a line, like an oscilloscope: Value is the wave at this pixel\'s left-right place (−1 to 1; 0 is silence), so comparing it with the height draws the line. Samples sets how much sound fits across; Texture holds it for Sample (texture), 0.5 grey being silence.',
  inputs: { ...AUDIO_IN, uv: UV_IN },
  outputs: {
    value: { type: 'float', label: 'Value', hint: 'The wave at this pixel\'s left-right place, −1 to 1.' },
    texture: { type: 'texture', label: 'Texture', hint: 'The wave as a strip: across is time (newest on the right), grey is the wave (0.5 silence).' },
  },
  defaultParams: { samples: '1024' },
  paramDefs: {
    samples: selectOf('Samples', 'How much sound fits across: 1024 is about 21 ms.', WAVEFORM_SAMPLES, 'samples'),
  },
  assignable: false,
  declarationsFor: pxDefine,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, S = audioToolSampler(id);
    return {
      code: `    float ${id}_v = texture2D(${S}, vec2(clamp(${st(inputVars)}.x, 0.0, 1.0), 0.5)).r * 2.0 - 1.0;\n`,
      outputVars: { value: `${id}_v`, texture: S },
    };
  },
};

export const AUDIO_TOOL_NODES: Record<string, NodeDefinition> = {
  [AUDIO_SOURCE_TYPE]: AudioSourceNode,
  [AUDIO_BAND_TYPE]: AudioBandNode,
  [AUDIO_HIT_TYPE]: AudioHitNode,
  [AUDIO_SPECTRUM_TYPE]: AudioSpectrumNode,
  [AUDIO_SPECTROGRAM_TYPE]: AudioSpectrogramNode,
  [AUDIO_WAVEFORM_TYPE]: AudioWaveformNode,
};
