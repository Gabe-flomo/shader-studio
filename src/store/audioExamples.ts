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
  audioFilterSweep: {
    label: 'Audio 6 · Filter sweep',
    description: 'Load a sound on the Audio Source. A Filter (low-pass) takes away everything over its Frequency, and you hear the filtered sound. The Spectrum listens after the Filter, so the bars past the cutoff go dark; drag across the curve on the Filter\'s card to sweep it. The Filter\'s Level lights the background.',
  },
  audioResonatorRings: {
    label: 'Audio 7 · Resonator rings',
    description: 'Load a sound on the Audio Source. A Resonator bank of eight notes (A minor) rings along with it, and each ring in the picture is one note: it lights up and thickens as hard as that note rings, the loudest one outlined in white. Change Root or Scale and the rings follow the new notes.',
  },
  audioSpectralFreeze: {
    label: 'Audio 8 · Spectral freeze',
    description: 'Load a sound on the Audio Source and turn Freeze on on the Spectral node: the sound holds as it was that moment, a drone, until you turn it off. The waterfall listens after Spectral, so a freeze shows as one held row streaming down.',
  },
  audioSpectrogramField: {
    label: 'Audio 9 · Sound landscape',
    description: 'Load a sound on the Audio Source. The Spectrogram\'s Field (the last two seconds of the spectrum as a function of position) is the height of a lit landscape (Height Light\'s Height ƒ), and it bends a pattern of stripes laid over it: loud moments rise as ridges and push the stripes aside.',
  },
  audioHitBand: {
    label: 'Audio 10 · Hit and Band Level',
    description: 'Load a sound (or switch to Mic) on the Audio Source. Hit listens for the kick drum: its Envelope jumps to 1 on each kick and falls away, and its Count steps the colour. Band Level follows how loud the bass is, smoothed: it fills the background.',
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
          { id: 'kick', name: 'Kick', color: '#f38ba8', lo: 40, hi: 130, value: false, trigger: true, attack: 0.005, release: 0.12, gain: 1, preset: 'kick', sensitivity: 0.5 },
          { id: 'bass', name: 'Bass', color: '#89b4fa', lo: 60, hi: 250, value: true, trigger: false, attack: 0.01, release: 0.25, gain: 1, preset: 'custom', sensitivity: 0.5 },
        ],
      }, [
        'Two bands, picked on Open ↗: Kick (What to catch: Kick, 40–130 Hz) sends its hits, 1 for one frame on each kick, even over a held bass; Bass (60–250 Hz) sends how loud it is, 0–1.',
        'Each band is an output here: Kick (trigger) and Bass. Sensitivity sets how eager Kick is; add more with the quick bands (Snare, Hats, Notes…) or by dragging across the spectrum.',
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

  // ── 6 · Source → Filter (low-pass) → Spectrum bars; the Filter's Level → background ──
  g.audioFilterSweep = {
    ...AUDIO_EXAMPLE_INDEX.audioFilterSweep,
    counter: 40,
    nodes: [
      source(40, 300),
      n('audioFilter', 'filt', 340, 300, { filterType: 'lowpass', frequency: 600, q: 4, gain: 6, listen: true, ...note([
        'Filter, Low-pass: keeps what is under Frequency (600 Hz) and takes away what is over it. Resonance 4 adds a ring right at the cutoff.',
        'Listen is on, so what you hear is the filtered sound (the Audio Source\'s own sound goes quiet). Turn it off to hear the song as it is again.',
        'Drag across the curve on the card to sweep the Frequency evenly through the octaves; right-click Frequency to put it on a Play control.',
      ]) }, { audio: ['src', 'audio'] }),
      uvNode(340, 600),
      n('audioSpectrum', 'spec', 680, 300, { bins: '64', layout: 'log', minDb: -90, maxDb: -25, smoothing: 0.6, ...note([
        'Spectrum, listening after the Filter: it hears the filtered sound, so the bars above the cutoff fall away as the Filter closes.',
        'Wire its Audio from the Audio Source instead to compare with the sound before the Filter.',
      ]) }, { audio: ['filt', 'audio'], uv: ['uv', 'uv'] }),
      expr('look', 1000, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['v', 'float', ['spec', 'value']], ['l', 'float', ['filt', 'level']]],
        lines: [
          ['float x', '(uv.x / (u_resolution.x / u_resolution.y)) * 0.5 + 0.5'],
          ['float y', 'uv.y * 0.5 + 0.5'],
          ['float bar', 'step(y, v) * step(0.12, fract(x * 64.0))'],
          ['vec3 col', 'mix(vec3(1.0, 0.45, 0.2), vec3(0.3, 0.6, 1.0), x)'],
        ],
        result: 'vec3(0.04, 0.02, 0.06) * (1.0 + l * 6.0) + bar * col * (0.4 + y)',
        note: [
          'Expression Block: the filtered spectrum as bars, warm in the bass, cool in the highs.',
          'x and y: this pixel across and up, 0 to 1. bar: lit below the column\'s loudness, with a thin gap between columns.',
          'Result: the background glows with the Filter\'s Level (l), how loud the filtered sound is.',
        ],
      }),
      n('output', 'out', 1300, 300, note('Output: the filtered spectrum.'), { color: ['look', 'result'] }),
    ],
  };

  // ── 7 · Source → Resonator bank (8 notes) → each note a ring, lit by its energy ──
  g.audioResonatorRings = {
    ...AUDIO_EXAMPLE_INDEX.audioResonatorRings,
    counter: 40,
    nodes: [
      source(40, 300),
      n('audioResonator', 'res', 340, 300, { count: '8', root: 45, scale: 'minor', decay: 1.2, brightness: 0.5, mix: 0.6, listen: true, ...note([
        'Resonator bank: eight resonators tuned from Root A2 (MIDI 45) up the minor scale, A B C D E F G A. Each rings when the sound has energy at its note, for about Decay (1.2 s) after.',
        'Mix 0.6 blends the ringing with the song (Listen is on: you hear it). Brightness tilts the high notes louder or quieter.',
        'Energies 1–4 and 5–8 are how hard each note rings (0–1); Loudest is which one rings most (0 is the root). Try Scale Major chord, or Harmonic series.',
      ]) }, { audio: ['src', 'audio'] }),
      uvNode(340, 640),
      expr('look', 720, 300, {
        label: 'Rings', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['ea', 'vec4', ['res', 'energies']], ['eb', 'vec4', ['res', 'energies2']], ['loud', 'float', ['res', 'loudest']]],
        lines: [
          ['float r', 'length(uv)'],
          ['float k', 'floor(r / 0.11)'],
          ['float e', 'dot(ea, vec4(equal(vec4(k), vec4(0.0, 1.0, 2.0, 3.0)))) + dot(eb, vec4(equal(vec4(k), vec4(4.0, 5.0, 6.0, 7.0))))'],
          ['float d', 'abs(r - (k + 0.5) * 0.11)'],
          ['float ring', '(1.0 - smoothstep(0.0, 0.008 + 0.04 * e, d)) * step(k, 7.0)'],
          ['vec3 col', '0.55 + 0.45 * cos(6.28318 * (k / 8.0 + vec3(0.0, 0.33, 0.67)))'],
          ['float top', '(1.0 - step(0.5, abs(k - loud))) * step(0.05, e)'],
        ],
        result: 'vec3(0.02, 0.02, 0.035) + ring * col * (0.12 + 1.3 * e) + top * (1.0 - smoothstep(0.0, 0.004, abs(d - 0.012 - 0.04 * e))) * vec3(1.0)',
        note: [
          'Expression Block: one ring per note, the root in the middle and the highest outside.',
          'r: this pixel\'s distance from the middle; k: which ring it is in (0–7).',
          'e: that ring\'s energy, picked out of Energies 1–4 (ea) or 5–8 (eb) by k (a vector of 0s with a 1 at k, dotted with the energies).',
          'd: how far the pixel is from the ring\'s centre line; ring: the ring, thicker the harder its note rings.',
          'col: a colour per note, round the wheel. top: 1 on the loudest ring, which gets a thin white outline.',
        ],
      }),
      n('output', 'out', 1100, 300, note('Output: the ringing notes.'), { color: ['look', 'result'] }),
    ],
  };

  // ── 8 · Source → Spectral (Freeze) → Spectrogram waterfall ──
  g.audioSpectralFreeze = {
    ...AUDIO_EXAMPLE_INDEX.audioSpectralFreeze,
    counter: 40,
    nodes: [
      source(40, 300),
      n('audioSpectral', 'spx', 340, 300, { mode: 'freeze', freeze: false, amount: 0.8, threshold: -45, mix: 1, listen: true, ...note([
        'Spectral, Freeze: turn Freeze on and the sound holds as it was at that moment (every frequency keeps its loudness and goes on turning), a drone, until you turn it off.',
        'Mode Blur smears each frequency over time instead (Amount); Gate keeps only the frequencies louder than Threshold.',
        'Listen is on: you hear the frozen sound. Its Texture is the spectrum of what comes out.',
      ]) }, { audio: ['src', 'audio'] }),
      uvNode(340, 640),
      n('audioSpectrogram', 'gram', 680, 300, { bins: '128', history: '128', layout: 'log', minDb: -95, maxDb: -25, ...note([
        'Spectrogram, listening after Spectral: while frozen every new row is the same, so the held sound streams down as straight lines.',
      ]) }, { audio: ['spx', 'audio'], uv: ['uv', 'uv'] }),
      n('palette', 'heat', 980, 300, note('Palette: the loudness as colour.'), { value: ['gram', 'value'] }),
      expr('look', 1260, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['c', 'vec3', ['heat', 'color']], ['v', 'float', ['gram', 'value']]],
        lines: [],
        result: 'c * smoothstep(0.02, 0.6, v)',
        note: ['Expression Block: the palette colour, faded to black where it is quiet.'],
      }),
      n('output', 'out', 1540, 300, note('Output: the waterfall of the frozen sound.'), { color: ['look', 'result'] }),
    ],
  };

  // ── 9 · Spectrogram Field → Height Light (Height ƒ) and a warp of stripes ──
  g.audioSpectrogramField = {
    ...AUDIO_EXAMPLE_INDEX.audioSpectrogramField,
    counter: 40,
    nodes: [
      source(40, 300),
      n('audioSpectrogram', 'gram', 340, 300, {
        bins: '128', history: '128', layout: 'log', minDb: -95, maxDb: -25, fieldScale: 1.2, fieldOffsetX: 0, fieldOffsetY: 0, fieldGain: 1, fieldEdges: 'mirror',
        ...note([
          'Spectrogram: the last two seconds of the spectrum. Its Field output is that history as a function of position: across is frequency (log), up is time (the top is now).',
          'Wired into a field socket (ƒ) it is read wherever that node asks: Height Light reads it a little to each side of every pixel to find the slope.',
          'Scale 1.2 zooms in a little; Edges Mirror tiles it flipped past its edges, so nothing is cut off. Try Offset Y to look further back in time.',
        ]),
      }, { audio: ['src', 'audio'] }),
      n('palette', 'pal', 640, 520, note('Palette: a colour for each height, so the ridges change colour as they rise.'), { value: ['gram', 'field'] }),
      n('heightLight', 'hl', 680, 300, { relief: 0.12, spacing: 1.5, sunAngle: 135, sunHeight: 30, ambient: 0.25, ...note([
        'Height Light: the Field as the height of a landscape (Height ƒ), lit by a low sun from the top left. Loud moments stand up as ridges.',
        'Its colour comes from the Palette; Relief 0.12 sets how tall the ridges stand.',
      ]) }, { height: ['gram', 'field'], colour: ['pal', 'color'] }),
      uvNode(680, 640),
      expr('look', 1000, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['f', 'float', ['gram', 'field']], ['land', 'vec3', ['hl', 'color']]],
        lines: [
          ['float y', 'uv.y + f * 0.25'],
          ['float stripes', '0.5 + 0.5 * sin(y * 60.0)'],
        ],
        result: 'land * (0.75 + 0.25 * stripes)',
        note: [
          'Expression Block: stripes bent by the Field, laid over the lit landscape.',
          'y: the height, pushed up by the Field (f) here: where the sound is loud the stripes bend aside.',
          'stripes: fine bands along that bent height. Result: the landscape, a little darker between the bands.',
        ],
      }),
      n('output', 'out', 1300, 300, note('Output: the sound as a landscape.'), { color: ['look', 'result'] }),
    ],
  };

  // ── 10 · Audio Source → Hit (kick: Envelope, Count) and Band Level (bass) → a pulsing disc ──
  g.audioHitBand = {
    ...AUDIO_EXAMPLE_INDEX.audioHitBand,
    counter: 40,
    nodes: [
      source(40, 300),
      n('audioHit', 'kick', 400, 160, { sound: 'kick', sensitivity: 0.5, decay: 0.35, ...note([
        'Hit, Sound Kick (40–130 Hz): listens to the Audio Source for kick drums; Sensitivity sets how eager it is.',
        'Envelope: 1 on each kick, falling to 0 over Decay (0.35 s). Count: the kicks so far. Trigger is 1 on the frame of a kick only, for the memory nodes.',
      ]) }, { audio: ['src', 'audio'] }),
      n('audioBand', 'bass', 400, 420, { band: 'bass', attack: 0.01, release: 0.25, ...note('Band Level, Bass (60–250 Hz): how loud the low end is, 0 to 1, rising fast (Attack) and falling slowly (Release).') }, { audio: ['src', 'audio'] }),
      uvNode(400, 620),
      expr('look', 760, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['e', 'float', ['kick', 'envelope']], ['n', 'float', ['kick', 'count']], ['b', 'float', ['bass', 'level']]],
        lines: [
          ['float r', '0.2 + e * 0.2'],
          ['float disc', '1.0 - smoothstep(r - 0.01, r + 0.01, length(uv))'],
          ['vec3 hue', '0.55 + 0.45 * cos(6.28318 * (n * 0.13 + vec3(0.0, 0.33, 0.67)))'],
        ],
        result: 'vec3(0.02, 0.02, 0.04) + vec3(0.1, 0.05, 0.2) * b * 3.0 + disc * hue * (0.5 + e)',
        note: [
          'Expression Block: a disc that jumps on each kick over a background that breathes with the bass.',
          'r: the radius, bigger while the kick\'s Envelope is up.',
          'disc: the disc itself, with a soft edge.',
          'hue: a colour that steps round the wheel with each kick (Count).',
          'Result: the background brightens with the bass Level (b).',
        ],
      }),
      n('output', 'out', 1060, 300, note('Output: the disc on the kick, the bass behind it.'), { color: ['look', 'result'] }),
    ],
  };

  return g;
}
