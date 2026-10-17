/**
 * audioExamples.ts — the Audio folder (docs/audio-tools.md): pictures that follow sound, built from the Audio nodes.
 * Each opens with its Audio Source on the File tab and nothing loaded ("Load a sound, or switch to Mic."): load any
 * song on the card, or switch to the Mic tab. Every node has a note.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';

export const AUDIO_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  audioKickRing: {
    label: 'Audio 1 · A ring that jumps on the kick',
    description: 'Load a sound (or switch to Mic) on the Audio Source. Its Kick band fires a trigger on each kick drum: an Envelope swells the ring and a Counter steps its colour round a palette. Its Bass band lights the background.',
  },
  audioSpectrumBars: {
    label: 'Audio 2 · Spectrum bars',
    description: 'Load a sound (or switch to Mic) on the Audio Source. Spectrum splits it into 64 frequencies, bass on the left. Each column is lit up to its loudness, coloured from low to high.',
  },
  audioWaterfall: {
    label: 'Audio 3 · Spectrogram waterfall',
    description: 'Load a sound (or switch to Mic) on the Audio Source. Spectrogram keeps the last two seconds of the spectrum: the top is now and older moments slide down. Kicks show as bright blobs on the left, hi-hats as streaks on the right.',
  },
  audioLearnClap: {
    label: 'Audio 5 · Learn a clap',
    description: 'Load a song, select one clap in the window, press Learn. The Audio Source learns that sound and fires a trigger whenever a sound like it plays: each clap bursts a star and steps its colour; how close the match was makes it glow.',
  },
  audioScope: {
    label: 'Audio 4 · Waveform line',
    description: 'Load a sound (or switch to Mic) on the Audio Source. Waveform draws the sound itself, like an oscilloscope: the last 20 milliseconds as a line across the picture. Level makes it glow when it is loud.',
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
  'Audio Source: opens on the File tab with nothing loaded, so the picture waits in silence. Press Load a sound… on the card and pick any song, or switch to the Mic tab and press Start.',
  'Open ↗ on the card shows the whole file to trim (it loops inside the trim) and a live spectrum to pick bands on. If you hear nothing, click anywhere: browsers start sound only after a click.',
];

const source = (x: number, y: number, extra: Record<string, unknown> = {}, more: string[] = []) =>
  n('audioSource', 'src', x, y, { source: 'file', playing: true, gain: 1, ...extra, ...note([...SOURCE_NOTE, ...more]) });
const uvNode = (x: number, y: number) => n('uv', 'uv', x, y, note('UV: this pixel\'s place in the picture (0 in the middle, 1 at the top).'));

export function buildAudioExamples(): Record<string, ExampleGraph> {
  const g: Record<string, ExampleGraph> = {};

  // ── 1 · Audio Source's Kick band (trigger) → Envelope (size) and Counter (colour); its Bass band → background ──
  g.audioKickRing = {
    ...AUDIO_EXAMPLE_INDEX.audioKickRing,
    counter: 40,
    nodes: [
      source(40, 300, {
        bands: [
          { id: 'kick', name: 'Kick', color: '#f38ba8', lo: 30, hi: 150, value: false, trigger: true, attack: 0.01, release: 0.15, gain: 1, sensitivity: 0.5, cooldown: 150 },
          { id: 'bass', name: 'Bass', color: '#89b4fa', lo: 60, hi: 250, value: true, trigger: false, attack: 0.01, release: 0.25, gain: 1, sensitivity: 0.5, cooldown: 120 },
        ],
      }, [
        'Two bands, picked on Open ↗: Kick (30–150 Hz) sends a trigger, 1 for one frame on each kick drum (Cooldown stops one kick counting twice); Bass (60–250 Hz) sends its level, 0–1.',
        'Each band is an output here: Kick (trigger) and Bass. Add more with the quick bands (Snare, Hi-hat…) or by dragging across the spectrum.',
      ]),
      n('envelope', 'env', 400, 160, { mode: 'trigger', attack: 0.01, decay: 0.4, ...note([
        'Envelope, Trigger mode: each kick plays a quick rise (Attack) and a fall to 0 (Decay).',
        'It fires when its Gate goes above 0.5: the Kick (trigger) is 1 for exactly one frame per kick.',
      ]) }, { gate: ['src', 'kick_t'] }),
      n('counter', 'count', 400, 340, { stepBy: 1, min: 0, max: 7, limit: 'wrap', ...note('Counter: adds 1 on each kick, 0 → 7, then wraps round. Its Fraction picks the colour.') }, { trigger: ['src', 'kick_t'] }),
      n('palette', 'hue', 700, 340, note('Palette: a colour for each count, round the wheel.'), { value: ['count', 'fraction'] }),
      uvNode(700, 520),
      expr('look', 1000, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['e', 'float', ['env', 'value']], ['c', 'vec3', ['hue', 'color']], ['b', 'float', ['src', 'bass_v']]],
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
          'Result: the background brightens with the Bass band\'s level (b).',
        ],
      }),
      n('output', 'out', 1300, 300, note('Output: the ring on the kick.'), { color: ['look', 'result'] }),
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
      source(40, 300, { gain: 1.5 }, ['Gain 1.5 makes the wave a little taller (only for what the Audio nodes hear).']),
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

  // ── 5 · A learned sound (Clap) → Envelope (burst) and Counter (colour); its Match → glow ──
  g.audioLearnClap = {
    ...AUDIO_EXAMPLE_INDEX.audioLearnClap,
    counter: 40,
    nodes: [
      source(40, 300, {
        // A learned sound with nothing learned yet: its outputs are here (and wired), it fires once you press Learn.
        sounds: [{ id: 'clap', name: 'Clap', color: '#f9e2af', match: 0.8, cooldown: 150, trigger: true, matchOut: true, spec: [], env: [] }],
      }, [
        'Load a song, select one clap in the window, press Learn: press Open ↗, switch the waveform to Drag: Select, drag across one clap, then press Learn on the Clap row (under Learned sounds).',
        'From then on Clap (trigger) is 1 for one frame whenever a sound like that clap plays, and Clap (match) says how close the last hit was (0–1, fading).',
        'Match on the row is how close a hit has to be to fire: raise it if other drums fire it too, lower it if it misses claps. On the Mic, clap into it and press Learn last hit.',
      ]),
      n('envelope', 'env', 400, 160, { mode: 'trigger', attack: 0.005, decay: 0.35, ...note([
        'Envelope, Trigger mode: each clap plays a quick rise and a fall to 0 (Decay).',
        'Its Gate is the Clap (trigger): 1 for one frame on each clap the Audio Source recognises.',
      ]) }, { gate: ['src', 'clap_t'] }),
      n('counter', 'count', 400, 340, { stepBy: 1, min: 0, max: 5, limit: 'wrap', ...note('Counter: adds 1 on each clap, 0 → 5, then wraps round. Its Fraction picks the colour.') }, { trigger: ['src', 'clap_t'] }),
      n('palette', 'hue', 700, 340, note('Palette: a colour for each count, round the wheel.'), { value: ['count', 'fraction'] }),
      uvNode(700, 520),
      expr('look', 1000, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['e', 'float', ['env', 'value']], ['c', 'vec3', ['hue', 'color']], ['m', 'float', ['src', 'clap_m']]],
        lines: [
          ['float r', 'length(uv)'],
          ['float arms', 'min(abs(uv.x), abs(uv.y))'],
          ['float disc', 'smoothstep(0.02, 0.0, r - (0.08 + e * 0.15))'],
          ['float star', 'disc + exp(-arms * 60.0) * e * smoothstep(0.7, 0.0, r)'],
          ['float glow', 'exp(-r * 5.0) * m * 0.5'],
        ],
        result: 'vec3(0.02, 0.02, 0.04) + star * c * (0.3 + e) + glow * c',
        note: [
          'Expression Block: a star that bursts on each clap, in the count\'s colour.',
          'r: this pixel\'s distance from the middle; arms: its distance from the nearer of the two centre lines.',
          'disc: a dot in the middle that swells while the envelope is up.',
          'star: the dot, plus four thin arms of light along the centre lines that flash with the envelope and fade outwards.',
          'glow: a soft light in the middle, as bright as the last hit was close to the clap (Clap (match)).',
        ],
      }),
      n('output', 'out', 1300, 300, note('Output: the star on each clap.'), { color: ['look', 'result'] }),
    ],
  };

  return g;
}
