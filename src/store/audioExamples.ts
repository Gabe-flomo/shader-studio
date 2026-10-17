/**
 * audioExamples.ts — the Audio folder (docs/audio-tools.md): pictures that follow sound, built from the Audio nodes.
 * Each listens to an Audio Source playing the Test loop (a drum loop made on the spot, so nothing to download and no
 * microphone permission); switch its Source to File or Microphone to use your own sound. Every node has a note.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';

export const AUDIO_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  audioKickRing: {
    label: 'Audio 1 · A ring that jumps on the kick',
    description: 'Hit listens for the kick drum in the test loop. Each hit fires an Envelope that swells the ring, and a Counter steps its colour round a palette. Bass level lights the background.',
  },
  audioSpectrumBars: {
    label: 'Audio 2 · Spectrum bars',
    description: 'Spectrum splits the sound into 64 frequencies, bass on the left. Each column is lit up to its loudness, coloured from low to high.',
  },
  audioWaterfall: {
    label: 'Audio 3 · Spectrogram waterfall',
    description: 'Spectrogram keeps the last two seconds of the spectrum: the top is now and older moments slide down. Kicks show as bright blobs on the left, hi-hats as streaks on the right.',
  },
  audioScope: {
    label: 'Audio 4 · Waveform line',
    description: 'Waveform draws the sound itself, like an oscilloscope: the last 20 milliseconds as a line across the picture. Level makes it glow when the loop is loud.',
  },
};

export const AUDIO_EXAMPLE_KEYS = Object.keys(AUDIO_EXAMPLE_INDEX);

const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });

/** An Expression Block: named inputs (wired as given), lines `type name = rhs`, a result; its note explains it. */
function expr(id: string, x: number, y: number, o: {
  label: string; outputType: 'float' | 'vec2' | 'vec3' | 'vec4';
  inputs: Array<[name: string, type: 'float' | 'vec2' | 'vec3' | 'vec4', from: [string, string]]>;
  lines: Array<[lhs: string, rhs: string]>;
  result: string; note: string[];
}): GraphNode {
  const node = n('exprNode', id, x, y, {
    label: o.label,
    inputs: o.inputs.map(([name, type]) => ({ name, type, slider: null })),
    outputType: o.outputType,
    lines: o.lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })),
    result: o.result, expr: o.result,
    ...note(o.note),
  });
  node.inputs = Object.fromEntries(o.inputs.map(([name, type, from]) => [name, { type, label: name, connection: { nodeId: from[0], outputKey: from[1] } }]));
  node.outputs = { result: { type: o.outputType, label: 'Result' } };
  return node;
}

const SOURCE_NOTE = [
  'Audio Source: plays the Test loop, a two-bar drum loop (kick, snare, hi-hats and a voice) made when the graph opens, so there is nothing to download.',
  'Switch Source to File and pick a song on the card, or to Microphone and press Start, to use your own sound. If you hear nothing, click anywhere: browsers start sound only after a click.',
];

const source = (x: number, y: number) => n('audioSource', 'src', x, y, { source: 'loop', playing: true, gain: 1, ...note(SOURCE_NOTE) });
const uvNode = (x: number, y: number) => n('uv', 'uv', x, y, note('UV: this pixel\'s place in the picture (0 in the middle, 1 at the top).'));

export function buildAudioExamples(): Record<string, ExampleGraph> {
  const g: Record<string, ExampleGraph> = {};

  // ── 1 · Hit (kick) → Envelope (size) and Counter (colour); Band level (bass) → background ──
  g.audioKickRing = {
    ...AUDIO_EXAMPLE_INDEX.audioKickRing,
    counter: 40,
    nodes: [
      source(40, 300),
      n('audioHit', 'kick', 340, 140, { sound: 'kick', sensitivity: 0.5, cooldown: 150, decay: 0.3, ...note([
        'Hit, Sound Kick: listens between 30 and 150 Hz for a sudden rise louder than the moments before it: a kick drum.',
        'Trigger is 1 for one frame on each kick: exactly what Envelope and Counter want. Cooldown stops one kick counting twice.',
      ]) }, { audio: ['src', 'audio'] }),
      n('envelope', 'env', 640, 60, { mode: 'trigger', attack: 0.01, decay: 0.4, ...note([
        'Envelope, Trigger mode: each kick plays a quick rise (Attack) and a fall to 0 (Decay).',
        'Hit has its own Envelope output too; this one lets you shape the rise as well.',
      ]) }, { gate: ['kick', 'trigger'] }),
      n('counter', 'count', 640, 260, { stepBy: 1, min: 0, max: 7, limit: 'wrap', ...note('Counter: adds 1 on each kick, 0 → 7, then wraps round. Its Fraction picks the colour.') }, { trigger: ['kick', 'trigger'] }),
      n('palette', 'hue', 940, 260, note('Palette: a colour for each count, round the wheel.'), { value: ['count', 'fraction'] }),
      n('audioBand', 'bass', 340, 480, { band: 'bass', attack: 0.01, release: 0.25, gain: 1, ...note('Band level, Bass: how loud 60–250 Hz is, smoothed by Attack and Release. It lights the background.') }, { audio: ['src', 'audio'] }),
      uvNode(640, 480),
      expr('look', 1240, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['e', 'float', ['env', 'value']], ['c', 'vec3', ['hue', 'color']], ['b', 'float', ['bass', 'level']]],
        lines: [
          ['float r', '0.25 + e * 0.25'],
          ['float ring', '1.0 - smoothstep(0.01, 0.02 + e * 0.03, abs(length(uv) - r))'],
          ['float halo', 'exp(-abs(length(uv) - r) * 6.0) * e'],
        ],
        result: 'vec3(0.03, 0.03, 0.05) * (1.0 + b * 4.0) + (ring + halo * 0.8) * c * (0.4 + e)',
        note: [
          'Expression Block: a ring that jumps on each kick, in the count\'s colour.',
          'r: the radius, bigger while the envelope is up.',
          'ring: the ring itself, thicker at the peak.',
          'halo: a glow round it, only just after a kick.',
          'Result: the background brightens with the bass level.',
        ],
      }),
      n('output', 'out', 1540, 300, note('Output: the ring on the kick.'), { color: ['look', 'result'] }),
    ],
  };

  // ── 2 · Spectrum (64 bins) → bars ──
  g.audioSpectrumBars = {
    ...AUDIO_EXAMPLE_INDEX.audioSpectrumBars,
    counter: 40,
    nodes: [
      source(40, 300),
      uvNode(40, 560),
      n('audioSpectrum', 'spec', 340, 300, { bins: '64', layout: 'log', minDb: -90, maxDb: -25, smoothing: 0.6, ...note([
        'Spectrum: the sound split into 64 frequencies, low on the left. Log layout gives each octave the same width, as we hear it.',
        'Value is the loudness of the frequency at this pixel\'s left-right place (0–1): every pixel in a column gets the same number.',
        'Smoothing calms the bars; Min dB and Max dB set what counts as silent and as full.',
      ]) }, { audio: ['src', 'audio'], uv: ['uv', 'uv'] }),
      expr('look', 700, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['v', 'float', ['spec', 'value']]],
        lines: [
          ['float x', '(uv.x / (u_resolution.x / u_resolution.y)) * 0.5 + 0.5'],
          ['float y', 'uv.y * 0.5 + 0.5'],
          ['float gap', 'step(0.12, fract(x * 64.0))'],
          ['float bar', 'step(y, v) * gap'],
          ['vec3 col', '0.55 + 0.45 * cos(6.28318 * (x * 0.8 + vec3(0.0, 0.33, 0.67)))'],
        ],
        result: 'vec3(0.03, 0.03, 0.05) + bar * col * (0.5 + y)',
        note: [
          'Expression Block: draws the bars.',
          'x and y: this pixel across and up, 0 to 1.',
          'gap: a thin dark line between the 64 columns.',
          'bar: lit where the pixel is below the column\'s loudness.',
          'col: a colour that runs from low to high frequencies.',
        ],
      }),
      n('output', 'out', 1000, 300, note('Output: the spectrum bars.'), { color: ['look', 'result'] }),
    ],
  };

  // ── 3 · Spectrogram → Palette ──
  g.audioWaterfall = {
    ...AUDIO_EXAMPLE_INDEX.audioWaterfall,
    counter: 40,
    nodes: [
      source(40, 300),
      uvNode(40, 560),
      n('audioSpectrogram', 'gram', 340, 300, { bins: '128', history: '128', layout: 'log', minDb: -95, maxDb: -25, ...note([
        'Spectrogram: the spectrum over time. Across is frequency (low on the left), the top row is now, and every frame the rows slide down one.',
        'History 128 keeps about two seconds. Value is the loudness at this pixel.',
      ]) }, { audio: ['src', 'audio'], uv: ['uv', 'uv'] }),
      n('palette', 'heat', 640, 300, note('Palette: turns the loudness (0–1) into colour, dark for quiet, bright for loud.'), { value: ['gram', 'value'] }),
      expr('look', 940, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['c', 'vec3', ['heat', 'color']], ['v', 'float', ['gram', 'value']]],
        lines: [],
        result: 'c * smoothstep(0.02, 0.6, v)',
        note: ['Expression Block: the palette colour, faded to black where it is quiet, so the hits stand out.'],
      }),
      n('output', 'out', 1240, 300, note('Output: the waterfall.'), { color: ['look', 'result'] }),
    ],
  };

  // ── 4 · Waveform → a glowing line; Level → glow ──
  g.audioScope = {
    ...AUDIO_EXAMPLE_INDEX.audioScope,
    counter: 40,
    nodes: [
      { ...source(40, 300), params: { ...source(40, 300).params, gain: 1.5, ...note([...SOURCE_NOTE, 'Gain 1.5 makes the wave a little taller (only for what the Audio nodes hear).']) } },
      uvNode(40, 560),
      n('audioWaveform', 'wave', 340, 300, { samples: '1024', ...note([
        'Waveform: the last 1024 samples of the sound (about 21 ms), newest on the right.',
        'Value is the wave at this pixel\'s left-right place, from −1 to 1 (0 is silence).',
      ]) }, { audio: ['src', 'audio'], uv: ['uv', 'uv'] }),
      expr('look', 700, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['w', 'float', ['wave', 'value']], ['l', 'float', ['src', 'level']]],
        lines: [
          ['float d', 'abs(uv.y - w * 0.7)'],
          ['float line', '1.0 - smoothstep(0.004, 0.012, d)'],
          ['float glow', 'exp(-d * 30.0) * l'],
        ],
        result: 'vec3(0.02, 0.03, 0.04) + line * vec3(0.6, 1.0, 0.8) + glow * vec3(0.2, 0.9, 0.5)',
        note: [
          'Expression Block: draws the wave as a line.',
          'd: how far this pixel is from the wave\'s height here.',
          'line: a thin bright line along it.',
          'glow: a soft green glow, stronger when the source\'s Level is high.',
        ],
      }),
      n('output', 'out', 1000, 300, note('Output: the oscilloscope.'), { color: ['look', 'result'] }),
    ],
  };

  return g;
}
