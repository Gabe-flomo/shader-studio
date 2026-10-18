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
import { soundOutputs, soundsOf, type AudioSoundSpec } from '../../lib/audioTools/learn';
import { AT_TRIGGER_DEFAULTS, atThresholdFromSensitivity, type AtListenerSpec } from '../../play/kit/audioTools.js';
import { AC_MAX_RESONATORS, AC_SCALES, acTextureSize, type AcScale, type AcSpec } from '../../play/kit/audioChain.js';
import { p, withNewOutputs } from './helpers';

export const AUDIO_CATEGORY = 'Audio';

export const AUDIO_SOURCE_TYPE = 'audioSource';
export const AUDIO_BAND_TYPE = 'audioBand';
export const AUDIO_HIT_TYPE = 'audioHit';
export const AUDIO_SPECTRUM_TYPE = 'audioSpectrum';
export const AUDIO_SPECTROGRAM_TYPE = 'audioSpectrogram';
export const AUDIO_WAVEFORM_TYPE = 'audioWaveform';
/** The nodes that change the sound (audio in, audio out): play/kit/audioChain.js runs them. */
export const AUDIO_FILTER_TYPE = 'audioFilter';
export const AUDIO_RESONATOR_TYPE = 'audioResonator';
export const AUDIO_SPECTRAL_TYPE = 'audioSpectral';

export const AUDIO_FX_TYPES: readonly string[] = [AUDIO_FILTER_TYPE, AUDIO_RESONATOR_TYPE, AUDIO_SPECTRAL_TYPE];
export const isAudioFxType = (type: string): boolean => AUDIO_FX_TYPES.includes(type);
/** A node whose Audio output is a sound of its own: an Audio Source, or an effect. */
export const isAudioProducerType = (type: string): boolean => type === AUDIO_SOURCE_TYPE || isAudioFxType(type);

export const AUDIO_TOOL_TYPES: readonly string[] = [AUDIO_SOURCE_TYPE, AUDIO_BAND_TYPE, AUDIO_HIT_TYPE, AUDIO_SPECTRUM_TYPE, AUDIO_SPECTROGRAM_TYPE, AUDIO_WAVEFORM_TYPE, ...AUDIO_FX_TYPES];
export const isAudioToolType = (type: string): boolean => AUDIO_TOOL_TYPES.includes(type);

/** An effect's params that change what the shader declares (a bank's size is its texture's width): they recompile. */
export const AUDIO_FX_COMPILE_KEYS: ReadonlySet<string> = new Set(['count']);
const ENERGY_CHANNELS = Array.from({ length: AC_MAX_RESONATORS }, (_, k) => `e${k}`);

/** The numbers each node writes every frame (its live uniforms' channels). */
export const AUDIO_LIVE_CHANNELS: Record<string, readonly string[]> = {
  [AUDIO_SOURCE_TYPE]: ['level', 'time'],
  [AUDIO_BAND_TYPE]: ['level', 'peak'],
  [AUDIO_HIT_TYPE]: ['trigger', 'envelope', 'count', 'strength'],
  [AUDIO_FILTER_TYPE]: ['level'],
  [AUDIO_RESONATOR_TYPE]: ['level', ...ENERGY_CHANNELS, 'loudest', 'peak'],
  [AUDIO_SPECTRAL_TYPE]: ['level'],
};

/** An Audio Source's learned sounds (lib/audioTools/learn.ts), their ids kept clear of its bands'. */
export const audioSoundsOf = (params: Record<string, unknown>): AudioSoundSpec[] => soundsOf(params, new Set(bandsOf(params).map(b => b.id)));

/** An Audio Source's own outputs after Audio, Level and Time: its bands', then its learned sounds'. */
export const audioSourceExtraOutputs = (params: Record<string, unknown>) => [...bandOutputs(bandsOf(params)), ...soundOutputs(audioSoundsOf(params))];

/** The numbers a node writes every frame: its fixed channels, and an Audio Source's band and learned-sound outputs. */
export function audioLiveChannels(node: GraphNode): string[] {
  const fixed = [...(AUDIO_LIVE_CHANNELS[node.type] ?? [])];
  if (node.type !== AUDIO_SOURCE_TYPE) return fixed;
  return [...fixed, ...audioSourceExtraOutputs(node.params).map(o => o.channel)];
}

/** The nodes that hand the picture a texture. */
export const AUDIO_TEXTURE_TYPES: ReadonlySet<string> = new Set([AUDIO_SPECTRUM_TYPE, AUDIO_SPECTROGRAM_TYPE, AUDIO_WAVEFORM_TYPE, AUDIO_RESONATOR_TYPE, AUDIO_SPECTRAL_TYPE]);

export const audioToolUniform = (slug: string, channel: string): string => `u_aud_${slug}_${channel}`;
export const audioToolSampler = (slug: string): string => `u_tex_${slug}`;

// ── Settings the engine reads ────────────────────────────────────────────────────────────────────────────────

/** Audio Source's tabs: a File, the Mic, or a Video node's own sound. Phase 1's Test loop opens as File, empty. */
export type AudioSourceKind = 'file' | 'mic' | 'video';
export const audioSourceKind = (node: GraphNode): AudioSourceKind => (node.params.source === 'mic' ? 'mic' : node.params.source === 'video' ? 'video' : 'file');

/** The graph's nodes whose video can sound for the Video tab: a Texture node playing a video file, or a Baked node. */
export const AUDIO_VIDEO_NODE_TYPES: ReadonlySet<string> = new Set(['videoInput', 'baked']);
export const isAudioVideoNode = (node: GraphNode): boolean => AUDIO_VIDEO_NODE_TYPES.has(node.type) && node.params.source !== 'webcam';

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

/**
 * A listening node's settings for one frame (play/kit/audioTools.js atStepListener): the app's engine and an exported
 * page read the same.
 */
export function listenerSpecOf(node: GraphNode): AtListenerSpec {
  const P = node.params;
  const { lo, hi } = node.type === AUDIO_BAND_TYPE || node.type === AUDIO_HIT_TYPE ? audioBandOf(node) : { lo: 0, hi: 0 };
  return {
    type: node.type, lo, hi,
    attack: num(P.attack, 0.01), release: num(P.release, 0.15), gain: Math.max(0, num(P.gain, 1)),
    threshold: num(P.threshold, typeof P.sensitivity === 'number' ? atThresholdFromSensitivity(P.sensitivity) : AT_TRIGGER_DEFAULTS.threshold),
    releaseAt: num(P.releaseAt, AT_TRIGGER_DEFAULTS.releaseAt), gate: num(P.gate, AT_TRIGGER_DEFAULTS.gate), minMs: num(P.minMs, AT_TRIGGER_DEFAULTS.minMs),
    cooldown: num(P.cooldown, 120), decay: num(P.decay, 0.3),
    layout: P.layout === 'linear' ? 'linear' : 'log', minDb: num(P.minDb, -90), maxDb: num(P.maxDb, -20), smoothing: num(P.smoothing, 0.5),
  };
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
    case AUDIO_RESONATOR_TYPE: case AUDIO_SPECTRAL_TYPE: return acTextureSize(effectSpecOf(node));
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
 * Audio Source's sockets follow its bands (lib/audioTools/bands.ts) and learned sounds (lib/audioTools/learn.ts):
 * Audio, Level and Time, then each band's Value ("Bass") and Trigger ("Kick (trigger)"), then each learned sound's
 * Trigger and Match ("Clap (trigger)", "Clap (match)"). Phase 1's Test loop opens as File (empty). Wires into an output that went
 * away are dropped by the store.
 */
export function retypeAudioSource(node: GraphNode): GraphNode {
  if (node.type !== AUDIO_SOURCE_TYPE) return node;
  let params = node.params;
  if (params.source !== 'file' && params.source !== 'mic' && params.source !== 'video') params = { ...params, source: 'file' };
  const outputs: GraphNode['outputs'] = {};
  for (const [k, s] of Object.entries(SOURCE_OUTPUTS)) outputs[k] = { type: s.type, label: s.label };
  for (const o of audioSourceExtraOutputs(params)) outputs[o.key] = { type: 'float', label: o.label };
  const cur = node.outputs ?? {};
  const curKeys = Object.keys(cur);
  const same = Object.keys(outputs).length === curKeys.length
    && Object.entries(outputs).every(([k, o], i) => curKeys[i] === k && cur[k]?.type === o.type && cur[k]?.label === o.label);
  if (same && params === node.params) return node;
  return { ...node, params, outputs: same ? node.outputs : outputs };
}

/** v1 → v2: each band's Sensitivity → a fixed Threshold (a Gate only on a trigger-only band, so a Value reads as before); the stems go. */
export function migrateAudioSourceV2(params: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...params };
  delete rest.stem; delete rest.hear; delete rest.stems;
  const bands = Array.isArray(rest.bands) ? rest.bands.map(b => {
    if (!b || typeof b !== 'object') return b;
    const { sensitivity, ...band } = b as Record<string, unknown>;
    return band.threshold !== undefined ? band : { ...band, threshold: atThresholdFromSensitivity(sensitivity), gate: band.value === false ? AT_TRIGGER_DEFAULTS.gate : 0 };
  }) : rest.bands;
  return { ...rest, ...(bands !== undefined ? { bands } : {}) };
}

/** v1 → v2: Hit's Sensitivity → a fixed Threshold, with the new lines' defaults. */
export function migrateAudioHitV2(params: Record<string, unknown>): Record<string, unknown> {
  const { sensitivity, ...rest } = params;
  if (rest.threshold !== undefined) return rest;
  return { ...rest, threshold: atThresholdFromSensitivity(sensitivity), releaseAt: AT_TRIGGER_DEFAULTS.releaseAt, gate: AT_TRIGGER_DEFAULTS.gate, minMs: AT_TRIGGER_DEFAULTS.minMs };
}

export const AudioSourceNode: NodeDefinition = {
  type: AUDIO_SOURCE_TYPE,
  label: 'Audio Source',
  category: AUDIO_CATEGORY,
  aliases: ['Audio', 'Sound', 'Music', 'Song', 'Microphone', 'Mic', 'Audio file', 'Audio In', 'Line in', 'Frequency bands', 'Kick trigger', 'Learn a sound', 'Sound match', 'Clap detect', 'Video sound', 'Beat trigger', 'Threshold trigger', 'Noise gate'],
  description: 'Where the sound comes from: a File (Load a sound on the card; it is kept in the library, so it comes back after a reload), the Mic (or an audio interface), or a Video node\'s own sound (the Video tab: a Texture node playing a video, or a Baked node), picked with the tabs on the card. The card\'s transport plays or pauses it, Restarts it, Mutes it (silent, but still listened to: its triggers keep firing) and sets its Volume; it stays on the card when the card is folded. Open ↗ shows the whole file to trim, and a live spectrum where you pick frequency bands: each band becomes an output here, its level or a trigger each time it rises above a Threshold line you set (watch it on the trigger scope; a Gate keeps noise out). A File is analysed ahead, so its triggers fire when you hear each hit. Learn a sound there too (select one clap, press Learn): it fires a trigger whenever a sound like it plays. Wire Audio into Band level, Hit, Spectrum, Spectrogram or Waveform; Level is how loud it is right now (0–1) and Time the seconds it has played.',
  inputs: {},
  outputs: SOURCE_OUTPUTS,
  // volume / muted: what you hear (after the analysis: a muted source still triggers). syncOffset: ms added to when its
  // triggers fire (on top of the output's own latency, which is taken off by itself).
  defaultParams: { source: 'file', playing: true, loop: true, gain: 1, volume: 1, muted: false, syncOffset: 0, _fileName: '', sampleId: '', videoNode: '', bands: [], sounds: [], trimIn: 0, trimOut: 0 },
  paramDefs: {
    playing: { label: 'Play', type: 'bool', hint: 'Plays the file or the video\'s sound (heard through the speakers), or listens to the Mic.' },
    loop: { label: 'Loop', type: 'bool', showWhen: { param: 'source', value: 'file' }, hint: 'Start again at the trim\'s end (or the file\'s). Off: it stops there.' },
    gain: { label: 'Gain', type: 'float', min: 0, max: 8, step: 0.01, hint: 'How loud the listening nodes and the bands hear it (not how loud you hear it): raise it for a quiet microphone.' },
  },
  assignable: false,
  // 2: fixed-threshold triggers (a band's Sensitivity became its Threshold) and no stems (Separate is gone: a stem
  // picked plays and is analysed as the full mix).
  version: 2,
  migrateParams: (params, fromVersion) => (fromVersion < 2 ? migrateAudioSourceV2(params) : params),
  syncSockets: retypeAudioSource,
  generateGLSL: (node: GraphNode) => ({ code: '', outputVars: { audio: '0.0', ...liveOutputs(node) } }),
};

// ── Band level ───────────────────────────────────────────────────────────────────────────────────────────────

export const AudioBandNode: NodeDefinition = {
  type: AUDIO_BAND_TYPE,
  label: 'Band Level',
  category: AUDIO_CATEGORY,
  aliases: ['Band level', 'Audio band', 'Frequency band', 'Bass level', 'EQ band', 'Audio level', 'Envelope follower'],
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
  description: 'Finds hits in the sound (a kick, a snare, a hi-hat): each time its band\'s level rises above Threshold, a line that stays put. It fires once per rise and re-arms only when the level falls back below Release (a fraction of Threshold), so a held note fires once. Below Gate the band counts as silence (noise never fires it); Min time is how long the level must stay above Threshold; Cooldown is the shortest gap between two hits. Trigger is 1 for one frame per hit (wire it into Envelope, Counter or Sample & Hold), Envelope jumps to 1 and falls in Decay, Count counts the hits, Strength is how loud the last one was.',
  inputs: { ...AUDIO_IN },
  outputs: {
    trigger: { type: 'float', label: 'Trigger', hint: '1 on the frame of a hit, 0 otherwise: a rising edge the memory nodes count.' },
    envelope: { type: 'float', label: 'Envelope', hint: '1 on a hit, falling to 0 in Decay.' },
    count: { type: 'float', label: 'Count', hint: 'Hits so far (from when the graph loaded).' },
    strength: { type: 'float', label: 'Strength', hint: 'How loud the band was at the last hit, 0–1.' },
  },
  defaultParams: { sound: 'kick', low: 30, high: 150, threshold: AT_TRIGGER_DEFAULTS.threshold, releaseAt: AT_TRIGGER_DEFAULTS.releaseAt, gate: AT_TRIGGER_DEFAULTS.gate, minMs: AT_TRIGGER_DEFAULTS.minMs, cooldown: 120, decay: 0.3 },
  paramDefs: {
    sound: { label: 'Sound', type: 'select', hint: 'Which sound to listen for: each lives in its own band.', options: [
      ...Object.entries(HIT_PRESETS).map(([value, p]) => ({ value, label: p.label })), { value: 'custom', label: 'Custom (Low – High)' },
    ] },
    low: { label: 'Low', type: 'float', min: 20, max: 20000, step: 1, showWhen: { param: 'sound', value: 'custom' }, hint: 'The band\'s bottom, in Hz.' },
    high: { label: 'High', type: 'float', min: 20, max: 20000, step: 1, showWhen: { param: 'sound', value: 'custom' }, hint: 'The band\'s top, in Hz.' },
    threshold: { label: 'Threshold', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Fires when the band\'s level (0–1, as Band level reads it) rises above this line. Lower catches quieter hits.' },
    releaseAt: { label: 'Release', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Re-arms once the level falls below Threshold × this: a held note or a swell fires only once. Nearer 1 re-arms sooner.' },
    gate: { label: 'Gate', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Below this level the band is silence: noise under it never fires. 0 is off.' },
    minMs: { label: 'Min time', type: 'float', min: 0, max: 200, step: 1, hint: 'Milliseconds the level must stay above Threshold to fire: stops a single noisy blip.' },
    cooldown: { label: 'Cooldown', type: 'float', min: 40, max: 2000, step: 1, hint: 'Milliseconds after a hit before the next can count: stops one drum counting twice.' },
    decay: secs('Decay', 'Seconds the Envelope takes to fall from 1 to 0.', 5),
  },
  assignable: false,
  // 2: a fixed Threshold (with Release, Gate, Min time) instead of Sensitivity's moving one.
  version: 2,
  migrateParams: (params, fromVersion) => (fromVersion < 2 ? migrateAudioHitV2(params) : params),
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

/** How the Spectrogram's Field reads past the history's edges. */
const FIELD_EDGES: Record<string, (q: string) => string> = {
  clamp: q => `clamp(${q}, 0.0, 1.0)`,
  repeat: q => `fract(${q})`,
  mirror: q => `(1.0 - abs(1.0 - mod(${q}, 2.0)))`,
};
const FIELD_OUTPUT = { field: { type: 'float' as const, label: 'Field' } };

export const AudioSpectrogramNode: NodeDefinition = {
  type: AUDIO_SPECTROGRAM_TYPE,
  label: 'Spectrogram',
  category: AUDIO_CATEGORY,
  aliases: ['Waterfall', 'Spectrum history', 'Sonogram', 'Audio history', 'Sound field', 'Spectrogram field'],
  description: 'The Spectrum over time, as a waterfall: across is frequency, the newest moment is at the top and older ones slide down (History rows of them). Value is the loudness at this pixel (0–1); Texture is the whole picture for Sample (texture). Field is the same history as a function of position, with its own Scale, Offset, Gain and Edges: wire it into a field socket (ƒ: Ride a path, Height Light, Sense, Shape Field, Grid Pattern) or add it to a picture\'s UV to warp it, or threshold it into shapes. Layout, Min dB and Max dB work as on Spectrum.',
  inputs: { ...AUDIO_IN, uv: UV_IN },
  outputs: {
    value: { type: 'float', label: 'Value', hint: 'Loudness at this pixel: frequency across, time down (the top is now).' },
    texture: { type: 'texture', label: 'Texture', hint: 'The history: across is frequency, up is newer.' },
    field: { type: 'float', label: 'Field', hint: 'The history as a function of position (x: frequency, on the Layout; y: time, the newest at the top), zoomed by Scale, moved by Offset, times Gain. Wired into a field socket (ƒ) it is read wherever that node asks.' },
  },
  defaultParams: { bins: '128', history: '128', layout: 'log', minDb: -90, maxDb: -20, fieldScale: 1, fieldOffsetX: 0, fieldOffsetY: 0, fieldGain: 1, fieldEdges: 'clamp' },
  paramDefs: {
    bins: selectOf('Bins', 'How many frequency steps across.', SPECTROGRAM_BINS, 'bins'),
    history: selectOf('History', 'How many moments it keeps (one a frame: 128 is about 2 seconds).', SPECTROGRAM_ROWS, 'rows'),
    layout: LAYOUT,
    // Read by the engine, not the shader (the Field's settings below are the uniforms).
    minDb: { ...MIN_DB, compileTime: true },
    maxDb: { ...MAX_DB, compileTime: true },
    fieldScale: { label: 'Scale', type: 'float', min: 0.1, max: 8, step: 0.01, section: 'Field', hint: 'Field only: how much of the history fills the picture. 1: all of it; 2: the middle half, twice as big.' },
    fieldOffsetX: { label: 'Offset X', type: 'float', min: -1, max: 1, step: 0.001, section: 'Field', hint: 'Field only: slides it across (positive brings the highs in).' },
    fieldOffsetY: { label: 'Offset Y', type: 'float', min: -1, max: 1, step: 0.001, section: 'Field', hint: 'Field only: slides it in time (negative shows older moments).' },
    fieldGain: { label: 'Gain', type: 'float', min: 0, max: 4, step: 0.01, section: 'Field', hint: 'Field only: multiplies it (a stronger warp, a taller height).' },
    fieldEdges: { label: 'Edges', type: 'select', section: 'Field', hint: 'Field only, past the history\'s edges: Clamp holds the edge, Repeat tiles it, Mirror tiles it flipped (no seams).', options: [
      { value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' },
    ] },
  },
  assignable: false,
  // Saved before the Field output: the card gains it.
  syncSockets: withNewOutputs(FIELD_OUTPUT),
  declarationsFor: pxDefine,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, S = audioToolSampler(id), P = node.params;
    const edge = FIELD_EDGES[String(P.fieldEdges)] ?? FIELD_EDGES.clamp;
    // Inside a field function (a ƒ socket) g_uv is the position asked about, so the Field is read there.
    return {
      code: `    float ${id}_v = texture2D(${S}, clamp(${st(inputVars)}, 0.0, 1.0)).r;\n`
        + `    vec2 ${id}_fq = (${st(inputVars)} - 0.5) / max(${p(P.fieldScale, 1)}, 0.001) + 0.5 + vec2(${p(P.fieldOffsetX, 0)}, ${p(P.fieldOffsetY, 0)});\n`
        + `    float ${id}_f = texture2D(${S}, ${edge(`${id}_fq`)}).r * ${p(P.fieldGain, 1)};\n`,
      outputVars: { value: `${id}_v`, texture: S, field: `${id}_f` },
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

// ── Audio → audio: Filter, Resonator bank, Spectral (play/kit/audioChain.js) ────────────────────────────────

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking'] as const;
const SPECTRAL_MODES = ['freeze', 'blur', 'gate'] as const;
export const RESONATOR_COUNTS = [4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/**
 * An effect's settings for one frame (play/kit/audioChain.js acBuild / acStepEffect): the app's engine and an exported
 * page read the same. `over` gives a number driven this frame (a Play control), by param key.
 */
export function effectSpecOf(node: GraphNode, over?: (key: string) => number | undefined): AcSpec {
  const P = node.params;
  const f = (k: string, d: number): number => { const o = over?.(k); return o !== undefined && Number.isFinite(o) ? o : num(P[k], d); };
  const filterType = FILTER_TYPES.find(t => t === P.filterType) ?? 'lowpass';
  const mode = SPECTRAL_MODES.find(m => m === P.mode) ?? 'freeze';
  const scale = (typeof P.scale === 'string' && P.scale in AC_SCALES ? P.scale : 'minor') as AcScale;
  return {
    type: (isAudioFxType(node.type) ? node.type : AUDIO_FILTER_TYPE) as AcSpec['type'],
    filterType, frequency: Math.max(10, f('frequency', 1000)), q: Math.max(0.01, f('q', 0.707)), gain: f('gain', 6),
    count: pick(P.count, RESONATOR_COUNTS, 8), root: f('root', 45), scale, decay: Math.max(0.01, f('decay', 1)),
    brightness: Math.max(0, Math.min(1, f('brightness', 0.5))), mix: Math.max(0, Math.min(1, f('mix', node.type === AUDIO_RESONATOR_TYPE ? 0.7 : 1))),
    mode, freeze: P.freeze === true, amount: Math.max(0, Math.min(0.99, f('amount', 0.8))), threshold: f('threshold', -50),
  };
}

const AUDIO_THROUGH = {
  audio: { type: 'audio' as const, label: 'Audio', hint: 'The sound, changed: wire it into the next effect, or into Hit, Spectrum, Spectrogram… to listen to the changed sound.' },
};
const AUDIO_FX_IN = { audio: { type: 'audio' as const, label: 'Audio', hint: 'The sound to change: an Audio Source\'s Audio, or another effect\'s.' } };
const LEVEL_OUT = { type: 'float' as const, label: 'Level', hint: 'How loud the changed sound is right now, 0–1.' };
const LISTEN: ParamDef = {
  label: 'Listen', type: 'bool',
  hint: 'Hear this node: the last node with Listen on in each chain plays (the ones before it, and the Audio Source\'s own sound, go quiet). All off: you hear the Audio Source as it is. A Mic chain is never played (it would feed back).',
};
const MIX = (d: string): ParamDef => ({ label: 'Mix', type: 'float', min: 0, max: 1, step: 0.01, hint: `Dry (0) to all ${d} (1).` });

const fxOutputs = (node: GraphNode, extra: Record<string, string> = {}) => ({ audio: '0.0', ...liveOutputs(node), ...extra });

export const AudioFilterNode: NodeDefinition = {
  type: AUDIO_FILTER_TYPE,
  label: 'Filter',
  category: AUDIO_CATEGORY,
  aliases: ['Audio filter', 'Low-pass', 'Lowpass', 'High-pass', 'Highpass', 'Band-pass', 'Notch', 'EQ', 'Peak EQ', 'Cutoff', 'Resonant filter', 'Biquad'],
  description: 'Changes the sound: Low-pass keeps what is under Frequency, High-pass what is over it, Band-pass only around it, Notch takes it out, Peak boosts or cuts around it by Gain. Resonance (Q) sharpens it into a ring. Drag across the curve on the card to sweep Frequency (it moves evenly through the octaves). Wire its Audio on into Hit, Spectrum and friends, or another effect; Level is how loud the filtered sound is. Listen plays it.',
  inputs: { ...AUDIO_FX_IN },
  outputs: { ...AUDIO_THROUGH, level: LEVEL_OUT },
  defaultParams: { filterType: 'lowpass', frequency: 800, q: 0.707, gain: 6, listen: true },
  paramDefs: {
    filterType: { label: 'Type', type: 'select', hint: 'What it keeps.', options: [
      { value: 'lowpass', label: 'Low-pass' }, { value: 'highpass', label: 'High-pass' }, { value: 'bandpass', label: 'Band-pass' },
      { value: 'notch', label: 'Notch' }, { value: 'peaking', label: 'Peak' },
    ] },
    frequency: { label: 'Frequency', type: 'float', min: 20, max: 20000, step: 1, hint: 'Where it bites, Hz. Drag across the curve on the card for an even sweep through the octaves.' },
    q: { label: 'Resonance', type: 'float', min: 0.1, max: 30, step: 0.01, hint: 'Q: 0.71 is smooth; higher rings at Frequency (Band-pass and Notch get narrower).' },
    gain: { label: 'Gain', type: 'float', min: -24, max: 24, step: 0.1, showWhen: { param: 'filterType', value: 'peaking' }, hint: 'Peak: dB added (or taken) around Frequency.' },
    listen: LISTEN,
  },
  assignable: false,
  generateGLSL: (node: GraphNode) => ({ code: '', outputVars: fxOutputs(node) }),
};

export const AudioResonatorNode: NodeDefinition = {
  type: AUDIO_RESONATOR_TYPE,
  label: 'Resonator Bank',
  category: AUDIO_CATEGORY,
  aliases: ['Resonator bank', 'Resonators', 'Resonator', 'Tuned resonators', 'Comb', 'Sympathetic strings', 'Ringing filters', 'Note energies', 'Chord resonator'],
  description: 'Rings along with the sound: 4–12 resonators tuned to notes from Root up a Scale (minor, major, pentatonic, a chord, stacked fifths, or the harmonic series), each ringing when the sound has energy at its note. Decay is how long they ring, Brightness tilts the high ones louder or quieter, Mix blends them with the dry sound. For the picture: Energies (resonators 1–4, then 5–8 and 9–12) is how hard each one rings, 0–1; Loudest is the index of the one ringing most (0 is the root); Texture holds them all as a strip, one texel each.',
  inputs: { ...AUDIO_FX_IN },
  outputs: {
    ...AUDIO_THROUGH,
    level: LEVEL_OUT,
    energies: { type: 'vec4', label: 'Energies 1–4', hint: 'How hard resonators 1–4 ring, 0–1 (x is the root).' },
    energies2: { type: 'vec4', label: 'Energies 5–8', hint: 'Resonators 5–8 (0 past Count).' },
    energies3: { type: 'vec4', label: 'Energies 9–12', hint: 'Resonators 9–12 (0 past Count).' },
    loudest: { type: 'float', label: 'Loudest', hint: 'Which resonator rings most: 0 (the root) to Count − 1.' },
    peak: { type: 'float', label: 'Peak', hint: 'The loudest resonator\'s energy, 0–1.' },
    texture: { type: 'texture', label: 'Texture', hint: 'The energies as a strip, Count texels across (the root on the left), grey is how hard each rings.' },
  },
  defaultParams: { count: '8', root: 45, scale: 'minor', decay: 1, brightness: 0.5, mix: 0.7, listen: true },
  paramDefs: {
    count: selectOf('Count', 'How many resonators (each a note).', RESONATOR_COUNTS, 'notes'),
    root: { label: 'Root', type: 'float', min: 24, max: 96, step: 1, hint: 'The lowest note, as a MIDI number: 45 is A2, 48 C3, 57 A3, 60 C4.' },
    scale: { label: 'Scale', type: 'select', hint: 'The notes above the root.', options: [
      { value: 'minor', label: 'Minor' }, { value: 'major', label: 'Major' }, { value: 'pentatonic', label: 'Pentatonic' },
      { value: 'minorPentatonic', label: 'Minor pentatonic' }, { value: 'minorChord', label: 'Minor chord' }, { value: 'majorChord', label: 'Major chord' },
      { value: 'fifths', label: 'Fifths (stacked)' }, { value: 'harmonic', label: 'Harmonic series' },
    ] },
    decay: { label: 'Decay', type: 'float', min: 0.05, max: 6, step: 0.01, hint: 'Seconds a resonator rings after a hit (until it is 60 dB down). Longer is a sharper, more singing tone.' },
    brightness: { label: 'Brightness', type: 'float', min: 0, max: 1, step: 0.01, hint: '0.5 rings every note evenly; lower darkens the high ones, higher makes them louder.' },
    mix: MIX('resonators'),
    listen: LISTEN,
  },
  assignable: false,
  declarationsFor: pxDefine,
  generateGLSL: (node: GraphNode) => {
    const id = node.id, u = (ch: string) => audioToolUniform(id, ch);
    const vec = (k: number) => `vec4(${[0, 1, 2, 3].map(i => u(`e${k * 4 + i}`)).join(', ')})`;
    return {
      code: `    vec4 ${id}_ea = ${vec(0)};\n    vec4 ${id}_eb = ${vec(1)};\n    vec4 ${id}_ec = ${vec(2)};\n`,
      outputVars: fxOutputs(node, { energies: `${id}_ea`, energies2: `${id}_eb`, energies3: `${id}_ec`, texture: audioToolSampler(id) }),
    };
  },
};

export const AudioSpectralNode: NodeDefinition = {
  type: AUDIO_SPECTRAL_TYPE,
  label: 'Spectral',
  category: AUDIO_CATEGORY,
  aliases: ['Spectral freeze', 'Freeze', 'Spectral blur', 'Spectral gate', 'FFT effect', 'Hold sound', 'Drone'],
  description: 'Changes the sound in its spectrum (an FFT, 1024 samples a frame): Freeze holds the sound as it was the moment Freeze went on, a drone that goes on until it is off; Blur smears each frequency over time (Amount); Gate lets through only the frequencies louder than Threshold, cleaning a sound down to its strongest notes. Mix blends with the dry sound. Texture is the spectrum of what comes out (log, low on the left).',
  inputs: { ...AUDIO_FX_IN },
  outputs: {
    ...AUDIO_THROUGH,
    level: LEVEL_OUT,
    texture: { type: 'texture', label: 'Texture', hint: 'The changed sound\'s spectrum as a strip: across is frequency (log), grey is loudness.' },
  },
  defaultParams: { mode: 'freeze', freeze: false, amount: 0.8, threshold: -45, mix: 1, listen: true },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', hint: 'What happens to the spectrum.', options: [
      { value: 'freeze', label: 'Freeze' }, { value: 'blur', label: 'Blur' }, { value: 'gate', label: 'Gate' },
    ] },
    freeze: { label: 'Freeze', type: 'bool', showWhen: { param: 'mode', value: 'freeze' }, hint: 'On: hold the sound as it is now (a drone) until it is off again.' },
    amount: { label: 'Amount', type: 'float', min: 0, max: 0.99, step: 0.01, showWhen: { param: 'mode', value: 'blur' }, hint: 'How long each frequency lingers: 0 none, 0.99 a long wash.' },
    threshold: { label: 'Threshold', type: 'float', min: -100, max: 0, step: 0.5, showWhen: { param: 'mode', value: 'gate' }, hint: 'dB: frequencies quieter than this are silenced (0 is a full-scale tone).' },
    mix: MIX('changed sound'),
    listen: LISTEN,
  },
  assignable: false,
  declarationsFor: pxDefine,
  generateGLSL: (node: GraphNode) => ({ code: '', outputVars: fxOutputs(node, { texture: audioToolSampler(node.id) }) }),
};

export const AUDIO_TOOL_NODES: Record<string, NodeDefinition> = {
  [AUDIO_SOURCE_TYPE]: AudioSourceNode,
  [AUDIO_BAND_TYPE]: AudioBandNode,
  [AUDIO_HIT_TYPE]: AudioHitNode,
  [AUDIO_SPECTRUM_TYPE]: AudioSpectrumNode,
  [AUDIO_SPECTROGRAM_TYPE]: AudioSpectrogramNode,
  [AUDIO_WAVEFORM_TYPE]: AudioWaveformNode,
  [AUDIO_FILTER_TYPE]: AudioFilterNode,
  [AUDIO_RESONATOR_TYPE]: AudioResonatorNode,
  [AUDIO_SPECTRAL_TYPE]: AudioSpectralNode,
};
