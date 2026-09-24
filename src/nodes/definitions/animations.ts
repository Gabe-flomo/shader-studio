import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ─── Sine LFO ─────────────────────────────────────────────────────────────────
// ─── LFO (one node, four waveforms) ──────────────────────────────────────────
// sineLFO / squareLFO / sawtoothLFO / triangleLFO were the same node with one
// expression swapped; they load as this node through ./aliases.ts.

const LFO_WAVE = (wave: string, t: string, freq: string, ph: string): string => {
  switch (wave) {
    case 'square':   return `sign(sin(${t} * ${freq} * 6.2831853 + ${ph}))`;
    // fract(t*freq + phase/TWO_PI) is a [0,1] ramp; * 2 - 1 spans [-1,1]
    case 'sawtooth': return `(fract(${t} * ${freq} + ${ph} / 6.2831853) * 2.0 - 1.0)`;
    case 'triangle': return `(abs(fract(${t} * ${freq} + ${ph} / 6.2831853) * 2.0 - 1.0) * 2.0 - 1.0)`;
    default:         return `sin(${t} * ${freq} * 6.2831853 + ${ph})`;
  }
};

export const LFONode: NodeDefinition = {
  type: 'lfo',
  label: 'LFO',
  aliases: ['sine', 'square', 'sawtooth', 'triangle', 'oscillator', 'wave'],
  category: 'Animation',
  description: 'Low-frequency oscillator: a sine, square, sawtooth or triangle wave of Time, scaled by amplitude and shifted by offset.',
  inputs: {
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    value: { type: 'float', label: 'Value' },
  },
  defaultParams: { waveform: 'sine', freq: 1.0, phase: 0.0, amplitude: 1.0, offset: 0.0 },
  paramDefs: {
    waveform:  { label: 'Waveform', type: 'select', options: [
      { value: 'sine',     label: 'Sine' },
      { value: 'square',   label: 'Square' },
      { value: 'sawtooth', label: 'Sawtooth' },
      { value: 'triangle', label: 'Triangle' },
    ]},
    freq:      { label: 'Frequency',  type: 'float', min: 0.01, max: 20.0,   step: 0.01 },
    phase:     { label: 'Phase',      type: 'float', min: 0.0,  max: 6.2832, step: 0.01 },
    amplitude: { label: 'Amplitude',  type: 'float', min: 0.0,  max: 2.0,    step: 0.01 },
    offset:    { label: 'Offset',     type: 'float', min: -1.0, max: 1.0,    step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const t    = inputVars.time ?? 'u_time';
    const freq = inputVars.freq ?? p(node.params.freq, 1.0);
    const ph   = p(node.params.phase, 0.0);
    const amp  = p(node.params.amplitude, 1.0);
    const off  = p(node.params.offset, 0.0);
    const wave = typeof node.params.waveform === 'string' ? node.params.waveform : 'sine';
    return {
      code: `    float ${id}_value = ${LFO_WAVE(wave, t, freq, ph)} * ${amp} + ${off};\n`,
      outputVars: { value: `${id}_value` },
    };
  },
};

// ─── BPM Sync ─────────────────────────────────────────────────────────────────
export const BPMSyncNode: NodeDefinition = {
  type: 'bpmSync',
  label: 'BPM Sync',
  category: 'Animation',
  description: 'Outputs a 0–1 sawtooth phase synced to a BPM. Wire into an LFO\'s phase input for tempo-synced animation.',
  inputs: {
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    phase: { type: 'float', label: 'Phase (0–1)' },
  },
  defaultParams: { bpm: 120.0, beats: 1.0 },
  paramDefs: {
    bpm:   { label: 'BPM',          type: 'float', min: 20.0,  max: 300.0, step: 0.5  },
    beats: { label: 'Beats/Cycle',  type: 'float', min: 0.125, max: 16.0,  step: 0.125 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const t     = inputVars.time ?? 'u_time';
    const bpm   = p(node.params.bpm, 120.0);
    const beats = p(node.params.beats, 1.0);
    return {
      code: `    float ${id}_phase = fract(${t} * (${bpm} / 60.0) / ${beats});\n`,
      outputVars: { phase: `${id}_phase` },
    };
  },
};
