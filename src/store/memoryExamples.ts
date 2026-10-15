/**
 * memoryExamples.ts — the Memory folder (docs/memory-nodes.md): numbers that remember last frame. Lag and
 * Spring following the mouse; an Envelope and a Counter on a beat. Built from the node definitions (graphBuilder.ts);
 * every node carries a note saying what it does and why.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import type { PlayRecord } from '../types/play';
import { ctl, n } from './graphBuilder';

export const MEMORY_EXAMPLE_INDEX: Record<string, { label: string; description: string; play?: true }> = {
  memFollow: {
    label: 'Memory 1 · Lag and Spring follow the mouse',
    description: 'Move the mouse over the picture. The orange disc follows it: across with a Lag (a smooth glide that slows as it arrives), up and down with a Spring (it overshoots and wobbles into place). The grey ring is the mouse itself.',
  },
  memBeat: {
    label: 'Memory 2 · A beat with Envelope and Counter', play: true,
    description: 'A square LFO is a steady beat. An Envelope turns each beat into a quick swell and a slow fade (attack, decay, sustain, release) that sizes and lights a ring; a Counter counts the beats 0–7 and steps the ring\'s colour round a palette.',
  },
  memReadout: {
    label: 'Memory 3 · A timer and a beat counter, as text', play: true,
    description: 'Text nodes show live numbers: {} in the text is the Value input. One shows a Timer\'s seconds (looping every 10), the other a Counter counting the beats of a square LFO, flashed by an Envelope.',
  },
};

export const MEMORY_EXAMPLE_KEYS = Object.keys(MEMORY_EXAMPLE_INDEX);

const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });

function playRecord(controls: PlayRecord['controls'], notes: string): PlayRecord {
  return { version: 1, controls, mappings: [], layers: [], notes };
}

/** An Expression Block: named inputs (wired as given), lines `type name = rhs`, a result; its note explains every named line. */
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

export function buildMemoryExamples(): Record<string, ExampleGraph> {
  const g: Record<string, ExampleGraph> = {};

  // ── 1 · Mouse → Lag (x) and Spring (y) → a disc that follows ──
  g.memFollow = {
    label: MEMORY_EXAMPLE_INDEX.memFollow.label, description: MEMORY_EXAMPLE_INDEX.memFollow.description,
    counter: 40,
    nodes: [
      n('mouse', 'mouse', 40, 300, note('Mouse: where the pointer is over the picture, in picture coordinates (X across, Y up).')),
      n('lag', 'lag', 340, 160, { rise: 0.35, fall: 0.35, ...note([
        'Lag: follows the mouse\'s X slowly. Each frame it moves a share of the way there, so it glides and slows as it arrives.',
        'Rise and Fall: seconds to get 63% of the way, going right and going left. Set Fall longer for a quick move out and a slow drift back.',
        'It remembers where it was last frame (in a shared one-pixel-per-node texture), which a shader alone can\'t.',
      ]) }, { input: ['mouse', 'x'] }),
      n('spring', 'spring', 340, 460, { frequency: 1.6, damping: 0.18, ...note([
        'Spring: follows the mouse\'s Y like a weight on a spring: it shoots past and wobbles into place.',
        'Frequency: swings a second. Damping: how fast the wobble dies (1 settles without overshooting).',
      ]) }, { input: ['mouse', 'y'] }),
      n('makeVec2', 'follow', 640, 300, note('Make Vec2: the Lag\'s X and the Spring\'s Y, as one position.'), { x: ['lag', 'value'], y: ['spring', 'value'] }),
      n('uv', 'uv', 640, 560, note('UV: this pixel\'s place in the picture.')),
      expr('look', 940, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['m', 'vec2', ['mouse', 'uv']], ['f', 'vec2', ['follow', 'xy']], ['vy', 'float', ['spring', 'velocity']]],
        lines: [
          ['float ring', '1.0 - smoothstep(0.004, 0.012, abs(length(uv - m) - 0.06))'],
          ['float disc', '1.0 - smoothstep(0.09, 0.1, length(uv - f))'],
          ['float glow', 'exp(-length(uv - f) * 6.0) * min(abs(vy), 2.0) * 0.25'],
        ],
        result: 'vec3(0.05, 0.06, 0.09) + glow * vec3(1.0, 0.5, 0.2) + disc * vec3(1.0, 0.55, 0.2) + ring * 0.5',
        note: [
          'Expression Block: draws the mouse and its follower.',
          'ring: a thin grey ring where the mouse is.',
          'disc: the orange disc at the followed position.',
          'glow: a halo that grows with the Spring\'s Velocity, so it flares as it swings.',
        ],
      }),
      n('output', 'out', 1240, 300, note('Output: the follower and the mouse.'), { color: ['look', 'result'] }),
    ],
  };

  // ── 2 · Square LFO (the beat) → Envelope (size, light) and Counter (colour) ──
  g.memBeat = {
    ...MEMORY_EXAMPLE_INDEX.memBeat,
    counter: 40,
    nodes: [
      n('lfo', 'beat', 40, 300, { waveform: 'square', freq: 1.5, amplitude: 1, offset: 0, ...note('LFO, Square: a steady beat, +1 for half of each cycle and −1 for the other half (1.5 beats a second). A MIDI note, a kick from Audio or a mouse button work the same way.') }),
      n('envelope', 'env', 340, 160, { mode: 'gate', attack: 0.03, decay: 0.25, sustain: 0.35, release: 0.45, ...note([
        'Envelope (ADSR): while the beat is on (above 0.5) it rises to 1 in Attack, falls to Sustain in Decay and holds there; when the beat goes off it fades to 0 in Release.',
        'A fast attack and slower release make each beat a punch and a tail.',
      ]) }, { gate: ['beat', 'value'] }),
      n('counter', 'count', 340, 460, { stepBy: 1, min: 0, max: 7, limit: 'wrap', ...note([
        'Counter: adds 1 each time the beat goes on, 0 → 7, then wraps back to 0.',
        'Its Fraction (0–1 across Min…Max) picks the colour below.',
      ]) }, { trigger: ['beat', 'value'] }),
      n('palette', 'hue', 640, 460, note('Palette: a colour for each count, round the wheel.'), { value: ['count', 'fraction'] }),
      n('uv', 'uv', 640, 160, note('UV: this pixel\'s place in the picture.')),
      expr('look', 940, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['e', 'float', ['env', 'value']], ['c', 'vec3', ['hue', 'color']]],
        lines: [
          ['float r', '0.25 + e * 0.2'],
          ['float ring', '1.0 - smoothstep(0.01, 0.02 + e * 0.02, abs(length(uv) - r))'],
          ['float halo', 'exp(-abs(length(uv) - r) * 8.0) * e'],
        ],
        result: 'vec3(0.04, 0.04, 0.06) + (ring + halo * 0.8) * c * (0.4 + e)',
        note: [
          'Expression Block: a ring that swells and lights with the envelope, in the count\'s colour.',
          'r: the ring\'s radius, bigger while the envelope is high.',
          'ring: the ring itself, thicker at the peak.',
          'halo: a soft glow round it, only while the envelope is up.',
        ],
      }),
      n('output', 'out', 1240, 300, note('Output: the ring on the beat.'), { color: ['look', 'result'] }),
    ],
    play: playRecord([
      ctl('tempo', 'beat::freq', 'Beats a second', 0.2, 6, 0.05),
    ], `**What it shows.** Two memory nodes on one beat: an Envelope (ADSR) shaping each beat into a swell and fade, and a Counter counting beats.

**How it is built.** Square LFO → Envelope (gate) → the ring's size and light; the same LFO → Counter (0–7, wrap) → Palette → its colour.

**Try.** Change the beat. On the Envelope, a long Release makes beats blur together; Trigger mode needs only a tap. Wire a MIDI Input's Gate or a Mouse button into the Envelope instead.`),
  };

  // ── 3 · Timer → Text "time {} s"; square LFO → Counter → Text "beat {}", flashed by an Envelope ──
  g.memReadout = {
    ...MEMORY_EXAMPLE_INDEX.memReadout,
    counter: 40,
    nodes: [
      n('timer', 'timer', 40, 160, { length: 10, loop: true, ...note('Timer: counts seconds, 0 → 10, then starts over (Loop).') }),
      n('text', 'clock', 340, 160, { text: 'time {} s', decimals: 2, numWidth: 5, size: 0.16, align: 'center', posX: 0, posY: 0.3, color: [0.9, 0.95, 1], ...note([
        'Text: "time {} s". {} is replaced by Value: here the Timer\'s Seconds, with 2 decimals, in 5 characters so the line doesn\'t shift as the digits change.',
      ]) }, { value: ['timer', 'seconds'] }),
      n('lfo', 'beat', 40, 460, { waveform: 'square', freq: 2, amplitude: 1, offset: 0, ...note('LFO, Square: a beat, two a second.') }),
      n('counter', 'count', 340, 400, { stepBy: 1, min: 0, max: 99, limit: 'wrap', ...note('Counter: adds 1 on each beat, up to 99, then wraps to 0.') }, { trigger: ['beat', 'value'] }),
      n('envelope', 'flash', 340, 620, { mode: 'trigger', attack: 0.01, decay: 0.3, ...note('Envelope, Trigger: a quick flash on each beat (Attack, then Decay to 0).') }, { gate: ['beat', 'value'] }),
      n('text', 'beats', 640, 420, { text: 'beat {}', decimals: 0, numWidth: 2, size: 0.3, align: 'center', posX: 0, posY: -0.05, color: [1, 0.55, 0.2], ...note('Text: "beat {}", Value from the Counter, no decimals, big and orange.') }, { value: ['count', 'count'] }),
      expr('look', 940, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['a', 'vec3', ['clock', 'color']], ['b', 'vec3', ['beats', 'color']], ['f', 'float', ['flash', 'value']]],
        lines: [],
        result: 'vec3(0.04, 0.05, 0.08) + a + b * (0.5 + f)',
        note: [
          'Expression Block: both texts on a dark background.',
          'Result: the timer in white, the beat count in orange, brighter on each beat by the Envelope.',
        ],
      }),
      n('output', 'out', 1240, 300, note('Output: a clock and a beat counter.'), { color: ['look', 'result'] }),
    ],
    play: playRecord([
      ctl('tempo', 'beat::freq', 'Beats a second', 0.2, 8, 0.05),
    ], `**What it shows.** Text nodes showing live numbers from memory nodes: {} in the text is replaced by the Value input.

**How it is built.** Timer → Text ("time {} s"). Square LFO → Counter → Text ("beat {}"), flashed by an Envelope on each beat.

**Try.** Change the beat. Wire an Analyze reading or a Blob Track's Count into a Text's Value for a live readout over a video.`),
  };

  return g;
}
