import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ─── Sine LFO ─────────────────────────────────────────────────────────────────
export const SineLFONode: NodeDefinition = {
  type: 'sineLFO',
  label: 'Sine LFO',
  category: 'Animation',
  description: 'Sine-wave oscillator driven by u_time. Outputs a value in [-amplitude, amplitude] + offset.',
  inputs: {
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    value: { type: 'float', label: 'Value' },
  },
  defaultParams: { freq: 1.0, phase: 0.0, amplitude: 1.0, offset: 0.0 },
  paramDefs: {
    freq:      { label: 'Frequency',  type: 'float', min: 0.01, max: 20.0,  step: 0.01 },
    phase:     { label: 'Phase',      type: 'float', min: 0.0,  max: 6.2832, step: 0.01 },
    amplitude: { label: 'Amplitude',  type: 'float', min: 0.0,  max: 2.0,   step: 0.01 },
    offset:    { label: 'Offset',     type: 'float', min: -1.0, max: 1.0,   step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const t    = inputVars.time ?? 'u_time';
    const freq = inputVars.freq ?? p(node.params.freq, 1.0);
    const ph   = p(node.params.phase, 0.0);
    const amp  = p(node.params.amplitude, 1.0);
    const off  = p(node.params.offset, 0.0);
    return {
      code: `    float ${id}_value = sin(${t} * ${freq} * 6.2831853 + ${ph}) * ${amp} + ${off};\n`,
      outputVars: { value: `${id}_value` },
    };
  },
};

// ─── Square LFO ───────────────────────────────────────────────────────────────
export const SquareLFONode: NodeDefinition = {
  type: 'squareLFO',
  label: 'Square LFO',
  category: 'Animation',
  description: 'Square-wave oscillator. Alternates between -amplitude and +amplitude.',
  inputs: {
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    value: { type: 'float', label: 'Value' },
  },
  defaultParams: { freq: 1.0, phase: 0.0, amplitude: 1.0, offset: 0.0 },
  paramDefs: {
    freq:      { label: 'Frequency', type: 'float', min: 0.01, max: 20.0,   step: 0.01 },
    phase:     { label: 'Phase',     type: 'float', min: 0.0,  max: 6.2832, step: 0.01 },
    amplitude: { label: 'Amplitude', type: 'float', min: 0.0,  max: 2.0,   step: 0.01 },
    offset:    { label: 'Offset',    type: 'float', min: -1.0, max: 1.0,   step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const t    = inputVars.time ?? 'u_time';
    const freq = inputVars.freq ?? p(node.params.freq, 1.0);
    const ph   = p(node.params.phase, 0.0);
    const amp  = p(node.params.amplitude, 1.0);
    const off  = p(node.params.offset, 0.0);
    return {
      code: `    float ${id}_value = sign(sin(${t} * ${freq} * 6.2831853 + ${ph})) * ${amp} + ${off};\n`,
      outputVars: { value: `${id}_value` },
    };
  },
};

// ─── Sawtooth LFO ─────────────────────────────────────────────────────────────
export const SawtoothLFONode: NodeDefinition = {
  type: 'sawtoothLFO',
  label: 'Sawtooth LFO',
  category: 'Animation',
  description: 'Sawtooth-wave oscillator — ramps from -1 to +1 linearly per cycle.',
  inputs: {
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    value: { type: 'float', label: 'Value' },
  },
  defaultParams: { freq: 1.0, phase: 0.0, amplitude: 1.0, offset: 0.0 },
  paramDefs: {
    freq:      { label: 'Frequency', type: 'float', min: 0.01, max: 20.0,   step: 0.01 },
    phase:     { label: 'Phase',     type: 'float', min: 0.0,  max: 6.2832, step: 0.01 },
    amplitude: { label: 'Amplitude', type: 'float', min: 0.0,  max: 2.0,   step: 0.01 },
    offset:    { label: 'Offset',    type: 'float', min: -1.0, max: 1.0,   step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const t    = inputVars.time ?? 'u_time';
    const freq = inputVars.freq ?? p(node.params.freq, 1.0);
    const ph   = p(node.params.phase, 0.0);
    const amp  = p(node.params.amplitude, 1.0);
    const off  = p(node.params.offset, 0.0);
    // fract(t*freq + phase/TWO_PI) gives [0,1] sawtooth; * 2 - 1 gives [-1,1]
    return {
      code: `    float ${id}_value = (fract(${t} * ${freq} + ${ph} / 6.2831853) * 2.0 - 1.0) * ${amp} + ${off};\n`,
      outputVars: { value: `${id}_value` },
    };
  },
};

// ─── Triangle LFO ─────────────────────────────────────────────────────────────
export const TriangleLFONode: NodeDefinition = {
  type: 'triangleLFO',
  label: 'Triangle LFO',
  category: 'Animation',
  description: 'Triangle-wave oscillator — linearly ramps up then down each cycle.',
  inputs: {
    time: { type: 'float', label: 'Time' },
  },
  outputs: {
    value: { type: 'float', label: 'Value' },
  },
  defaultParams: { freq: 1.0, phase: 0.0, amplitude: 1.0, offset: 0.0 },
  paramDefs: {
    freq:      { label: 'Frequency', type: 'float', min: 0.01, max: 20.0,   step: 0.01 },
    phase:     { label: 'Phase',     type: 'float', min: 0.0,  max: 6.2832, step: 0.01 },
    amplitude: { label: 'Amplitude', type: 'float', min: 0.0,  max: 2.0,   step: 0.01 },
    offset:    { label: 'Offset',    type: 'float', min: -1.0, max: 1.0,   step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const t    = inputVars.time ?? 'u_time';
    const freq = inputVars.freq ?? p(node.params.freq, 1.0);
    const ph   = p(node.params.phase, 0.0);
    const amp  = p(node.params.amplitude, 1.0);
    const off  = p(node.params.offset, 0.0);
    // abs(fract(t*freq + phase/TWO_PI) * 2 - 1) gives [0,1] triangle; * 2 - 1 gives [-1,1]
    return {
      code: `    float ${id}_value = (abs(fract(${t} * ${freq} + ${ph} / 6.2831853) * 2.0 - 1.0) * 2.0 - 1.0) * ${amp} + ${off};\n`,
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
