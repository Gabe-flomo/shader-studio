/**
 * playExamples.ts — the Play folder: one example per Play technique, in the
 * order you would learn them. Each is a small graph (a glowing circle, an
 * FBM landscape, or the Layers node into SDF Glow) with a Play setup that
 * shows one idea, and notes on the Play page that say what it shows, how it
 * is built, and what to try.
 *
 * Built from helpers so every record is exactly what the parser produces
 * (the examples test checks that nothing is dropped on load).
 */
import type { GraphNode } from '../types/nodeGraph';
import type { ExampleGraph } from './exampleIndex';
import { PLAY_EXAMPLE_INDEX } from './playExampleIndex';
import {
  defaultLayer, type ActionKind, type LfoShape, type LiveAudioBand, type NoiseType, type PlayAction, type PlayControl, type PlayDisplay,
  type PlayLayer, type PlayLayerKind, type PlayMapping, type PlayRecord, type PlaySource, type SensorRead, type TriggerMode, type TriggerSpec,
} from '../types/play';

// ── Record helpers ───────────────────────────────────────────────────────────

function layer<K extends PlayLayerKind>(kind: K, id: string, label: string, over: Partial<Extract<PlayLayer, { kind: K }>> = {}): PlayLayer {
  return { ...defaultLayer(kind, id, label), ...over } as PlayLayer;
}
const ctl = (id: string, target: string, label: string, min: number, max: number, step?: number): PlayControl =>
  ({ id, target, kind: 'float', label, min, max, ...(step ? { step } : {}) });
const colourCtl = (id: string, target: string, label: string): PlayControl => ({ id, target, kind: 'color', label, min: 0, max: 1 });
const map = (id: string, controlId: string, source: PlaySource, outMin: number, outMax: number, opts: Partial<PlayMapping> = {}): PlayMapping =>
  ({ id, controlId, source, outMin, outMax, curve: 'linear', smoothMs: 0, enabled: true, ...opts });

const S = {
  mouse: (axis: 'x' | 'y' | 'down'): PlaySource => ({ kind: 'mouse', axis }),
  key: (code: string): PlaySource => ({ kind: 'key', code }),
  lfo: (shape: LfoShape, rate: number, phase = 0): PlaySource => ({ kind: 'lfo', shape, rate, phase }),
  clock: (shape: LfoShape, bpm: number, beats: number): PlaySource => ({ kind: 'clock', shape, bpm, beats }),
  noise: (type: NoiseType, rate: number, seed: number, steps = 0): PlaySource => ({ kind: 'noise', type, rate, seed, steps }),
  control: (controlId: string): PlaySource => ({ kind: 'control', controlId }),
  live: (band: LiveAudioBand, gain = 1): PlaySource => ({ kind: 'live', band, gain }),
  midi: (signal: 'note' | 'velocity' | 'gate' | 'bend' | 'cc', cc?: number): PlaySource => (signal === 'cc' ? { kind: 'midi', signal, channel: 0, cc: cc ?? 1 } : { kind: 'midi', signal, channel: 0 }),
  osc: (address: string): PlaySource => ({ kind: 'osc', address, arg: 0, min: 0, max: 1 }),
  tilt: (axis: 'beta' | 'gamma' | 'alpha'): PlaySource => ({ kind: 'tilt', axis }),
  nul: (layerId: string, axis: 'x' | 'y'): PlaySource => ({ kind: 'null', layerId, axis }),
  sensor: (layerId: string, read: SensorRead, otherId = ''): PlaySource => ({ kind: 'sensor', layerId, read, otherId }),
  trig: (trigger: TriggerSpec, mode: TriggerMode = 'envelope', o: { attack?: number; decay?: number; sustain?: number; release?: number; steps?: number; velocity?: boolean } = {}): PlaySource => ({
    kind: 'trigger', trigger, mode, attack: o.attack ?? 10, decay: o.decay ?? 200, sustain: o.sustain ?? 0.5, release: o.release ?? 400, steps: o.steps ?? 4, velocity: o.velocity ?? false,
  }),
};
const T = {
  key: (code: string): TriggerSpec => ({ on: 'key', code }),
  click: (): TriggerSpec => ({ on: 'mouse' }),
  beat: (bpm: number, beats: number): TriggerSpec => ({ on: 'beat', bpm, beats }),
  audio: (band: LiveAudioBand, threshold: number): TriggerSpec => ({ on: 'audio', band, threshold }),
  note: (note = -1): TriggerSpec => ({ on: 'note', channel: 0, note }),
  osc: (address: string): TriggerSpec => ({ on: 'osc', address }),
  zone: (layerId: string, event: 'click' | 'enter' | 'fill', threshold = 0.5): TriggerSpec => ({ on: 'zone', layerId, event, threshold }),
};
const act = (id: string, trigger: TriggerSpec, kind: ActionKind, layerId: string, amount = 1): PlayAction => ({ id, trigger, do: kind, layerId, amount, enabled: true });

function play(p: { layers?: PlayLayer[]; controls?: PlayControl[]; mappings?: PlayMapping[]; actions?: PlayAction[]; display?: PlayDisplay; notes: string }): PlayRecord {
  const out: PlayRecord = { version: 1, controls: p.controls ?? [], mappings: p.mappings ?? [], layers: p.layers ?? [] };
  if (p.actions?.length) out.actions = p.actions;
  out.notes = p.notes;
  if (p.display) out.display = p.display;
  return out;
}

// ── Graphs ───────────────────────────────────────────────────────────────────

const uvNode = (x = 60): GraphNode => ({ id: 'uv', type: 'uv', position: { x, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} });
const toneOut = (from: string, fromKey: string, x: number): GraphNode[] => [
  { id: 'tone', type: 'toneMap', position: { x, y: 200 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: from, outputKey: fromKey } } }, outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
  { id: 'out', type: 'output', position: { x: x + 400, y: 200 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone', outputKey: 'color' } } }, outputs: {}, params: {} },
];
const glowNode = (from: string, fromKey: string, o: { falloff?: number; tint?: [number, number, number]; mode?: string; ringFreq?: number } = {}): GraphNode => ({
  id: 'glow', type: 'light', position: { x: 900, y: 200 },
  inputs: {
    distance: { type: 'float', label: 'Distance', connection: { nodeId: from, outputKey: fromKey } },
    brightness: { type: 'float', label: 'Brightness' },
    tint: { type: 'vec3', label: 'Tint' },
  },
  outputs: { glow: { type: 'float', label: 'Glow' }, inner: { type: 'float', label: 'Inner' }, tinted: { type: 'vec3', label: 'Tinted' } },
  params: { mode: o.mode ?? 'glow', brightness: o.falloff ?? 8, ringFreq: o.ringFreq ?? 8, tint: o.tint ?? [1, 0.6, 0.25], innerFalloff: 8 },
});

/** UV → Circle SDF → SDF Glow → Tone Map → Output. Controls can reach circ::radius / posX / posY, glow::brightness / tint. */
function glowGraph(o: { radius?: number; posX?: number; posY?: number; falloff?: number; tint?: [number, number, number]; mode?: string; ringFreq?: number; comment?: string } = {}): GraphNode[] {
  return [
    uvNode(),
    {
      id: 'circ', type: 'circleSDF', position: { x: 480, y: 200 },
      inputs: {
        position: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } },
        radius: { type: 'float', label: 'Radius' },
        offset: { type: 'vec2', label: 'Center' },
      },
      outputs: { distance: { type: 'float', label: 'Distance' } },
      params: { radius: o.radius ?? 0.3, posX: o.posX ?? 0, posY: o.posY ?? 0, ...(o.comment ? { __comment: o.comment } : {}) },
    },
    glowNode('circ', 'distance', o),
    ...toneOut('glow', 'tinted', 1320),
  ];
}

/** A slowly drifting FBM landscape: a picture with plenty of light and dark for layers to read. */
function fbmGraph(o: { scale?: number; timeScale?: number; preset?: string } = {}): GraphNode[] {
  return [
    uvNode(40),
    { id: 'time', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
    {
      id: 'fbm', type: 'fbm', position: { x: 280, y: 200 },
      inputs: {
        uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } },
        time: { type: 'float', label: 'Time', connection: { nodeId: 'time', outputKey: 'time' } },
        scale: { type: 'float', label: 'Scale' },
        time_scale: { type: 'float', label: 'Time Scale' },
      },
      outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
      params: { octaves: 5, lacunarity: 2, gain: 0.5, scale: o.scale ?? 2, time_scale: o.timeScale ?? 0.05 },
    },
    {
      id: 'pal', type: 'palettePreset', position: { x: 560, y: 200 },
      inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm', outputKey: 'value' } } },
      outputs: { color: { type: 'vec3', label: 'Color' } },
      params: { preset: o.preset ?? '4' },
    },
    ...toneOut('pal', 'color', 780),
  ];
}

/** UV → Layers → SDF Glow → Tone Map → Output: whatever the layers draw glows. */
function layersGlowGraph(o: { falloff?: number; tint?: [number, number, number] } = {}): GraphNode[] {
  return [
    uvNode(),
    {
      id: 'layers', type: 'playLayers', position: { x: 420, y: 200 },
      inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } } },
      outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' }, distance: { type: 'float', label: 'Distance' } },
      params: {},
    },
    glowNode('layers', 'distance', { falloff: o.falloff ?? 40, tint: o.tint ?? [1, 0.55, 0.3] }),
    ...toneOut('glow', 'tinted', 1320),
  ];
}

/** A dim, small glow: a quiet backdrop when the layers are the point. */
const quietGraph = () => glowGraph({ radius: 0.05, falloff: 30, tint: [0.25, 0.3, 0.5] });

// A star, as an SVG data URL, for the image example.
const STAR_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><polygon points="100,8 124,74 194,74 138,116 160,186 100,144 40,186 62,116 6,74 76,74" fill="#fff"/></svg>');

type Ex = { key: string; nodes: GraphNode[]; play: PlayRecord };
const ex = (key: string, nodes: GraphNode[], p: PlayRecord): Ex => ({ key, nodes, play: p });

// ── The examples, in learning order ──────────────────────────────────────────

const LIST: Ex[] = [
  // ─ Controls and inputs ─
  ex('playControls', glowGraph({ comment: 'The glowing circle. Its Radius is a Play control; this note shows up on the control\'s ⓘ.' }), play({
    controls: [ctl('radius', 'circ::radius', 'Radius', 0.05, 0.8), ctl('falloff', 'glow::brightness', 'Falloff', 1, 30), colourCtl('tint', 'glow::tint', 'Tint')],
    notes: `**What it shows.** A Play control is a slider (or colour) for one live param of the graph. Moving it changes the picture without recompiling.

**How it's built.** Add control lists every live float and colour in the graph. Radius, Falloff and Tint are the Circle SDF's radius and SDF Glow's falloff and tint.

**Try this.**
• Drag the sliders and pick a tint.
• Hover the ⓘ on Radius: it shows the param's hint and the comment written on the node in the Studio.
• Click a control's name to rename it; drag its range ends to change min and max.
• Add control → pick another param, like the circle's position.`,
  })),
  ex('playMouse', glowGraph(), play({
    controls: [ctl('x', 'circ::posX', 'Position X', -1.2, 1.2), ctl('falloff', 'glow::brightness', 'Falloff', 2, 30)],
    mappings: [map('mx', 'x', S.mouse('x'), -1, 1, { smoothMs: 120 }), map('my', 'falloff', S.mouse('y'), 24, 3, { curve: 'exp', smoothMs: 120 })],
    notes: `**What it shows.** A mapping connects a source (the mouse) to a control. Source 0 → the range's start, 1 → its end.

**How it's built.** Mouse X → Position X over −1…1. Mouse Y → Falloff over 24…3 (inverted: higher mouse, softer glow), Exp curve, 120 ms smoothing.

**Try this.**
• Move the mouse over the page.
• Open Mappings: set Smooth to 0 and feel the difference.
• Swap a range's ends (⇄) to invert it.
• Turn a mapping off with its switch: the slider takes back over.`,
  })),
  ex('playCurves', glowGraph(), play({
    controls: [ctl('radius', 'circ::radius', 'Radius (drawn steps)', 0.05, 0.7), ctl('falloff', 'glow::brightness', 'Falloff (log)', 2, 30)],
    mappings: [
      map('steps', 'radius', S.mouse('x'), 0.05, 0.7, { curve: 'custom', curveY: [0, 0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.75, 0.75, 0.75, 0.75, 0.75, 1, 1, 1] }),
      map('log', 'falloff', S.mouse('y'), 30, 2, { curve: 'log', smoothMs: 80 }),
    ],
    notes: `**What it shows.** Between the source and the control sits a curve. Exp is gentle then steep, Log steep then gentle, and Draw is any shape you like.

**How it's built.** Mouse X → Radius through a drawn staircase, so the circle snaps between five sizes. Mouse Y → Falloff through Log.

**Try this.**
• Move the mouse left to right and watch the radius jump in steps.
• Open the first mapping: drag across the curve pad to draw a new shape (the dot shows where the mouse is on it).
• Switch the second mapping between Linear, Exp and Log.`,
  })),
  ex('playLfo', glowGraph(), play({
    controls: [ctl('radius', 'circ::radius', 'Radius', 0.05, 0.6), ctl('x', 'circ::posX', 'Position X', -1, 1), colourCtl('tint', 'glow::tint', 'Tint')],
    mappings: [
      map('breathe', 'radius', S.lfo('sine', 0.25), 0.2, 0.4),
      map('sway', 'x', S.lfo('triangle', 0.1, 0.25), -0.6, 0.6),
      map('pulse', 'tint', S.clock('saw', 120, 1), 1, 0.3, { curve: 'log' }),
    ],
    notes: `**What it shows.** An LFO is a wave at a rate in Hz (sine, triangle, saw, square, random). A Clock is the same wave locked to a tempo: one cycle every N beats at a BPM.

**How it's built.** A sine breathes the radius, a triangle sways it side to side, and a 120 BPM saw pulses the tint's brightness once per beat.

**Try this.**
• Change the clock's BPM to your track's tempo.
• Try the Square and Random shapes on the sway.
• Phase (0–1) offsets a wave: two LFOs at 0 and 0.25 phase trace a circle.`,
  })),
  ex('playNoise', glowGraph({ radius: 0.2 }), play({
    controls: [ctl('x', 'circ::posX', 'X (drift)', -1, 1), ctl('y', 'circ::posY', 'Y (smooth)', -0.8, 0.8), ctl('radius', 'circ::radius', 'Radius (stepped)', 0.08, 0.35), ctl('falloff', 'glow::brightness', 'Falloff (random)', 6, 14)],
    mappings: [
      map('drift', 'x', S.noise('drift', 0.3, 3), -0.8, 0.8),
      map('smooth', 'y', S.noise('smooth', 0.5, 7), -0.5, 0.5),
      map('stepped', 'radius', S.noise('stepped', 2, 11, 4), 0.08, 0.35),
      map('random', 'falloff', S.noise('random', 1, 5), 6, 14),
    ],
    notes: `**What it shows.** Noise is random motion with character:
• **Smooth** glides between random points.
• **Drift** wanders slowly with a finer wobble on top.
• **Random** is a new value every frame (jitter).
• **Stepped** holds a value, then jumps, snapped to a few levels (posterised time).

**Try this.**
• Change each row's rate.
• Give two rows the same seed: they move together.
• Set Stepped's steps to 0 for unsnapped jumps.`,
  })),
  ex('playCrossMod', glowGraph(), play({
    controls: [ctl('radius', 'circ::radius', 'Radius (you)', 0.05, 0.7), ctl('falloff', 'glow::brightness', 'Falloff (follows Radius)', 2, 30)],
    mappings: [map('follow', 'falloff', S.control('radius'), 30, 3, { smoothMs: 200 })],
    notes: `**What it shows.** "Another control" is a source: it reads a control as 0–1 across its range, so one gesture can move several things.

**How it's built.** The Falloff control is mapped from the Radius control, inverted and smoothed: a bigger circle gets a softer glow.

**Try this.**
• Drag Radius and watch Falloff follow (its slider is locked while driven).
• Map an LFO onto Radius: now both move.
• Chain a third control from Falloff.`,
  })),
  ex('playColour', glowGraph({ tint: [0.3, 0.5, 1] }), play({
    controls: [colourCtl('tint', 'glow::tint', 'Tint')],
    mappings: [
      map('red', 'tint', S.mouse('x'), 0, 1, { channel: 0, smoothMs: 80 }),
      map('blue', 'tint', S.lfo('sine', 0.2), 0.2, 1, { channel: 2 }),
      map('beat', 'tint', S.clock('saw', 100, 1), 1, 0.4, { curve: 'log' }),
    ],
    notes: `**What it shows.** A colour control takes mappings too. A mapping with Channel set to Red, Green or Blue writes that channel; one set to Brightness scales the whole colour.

**How it's built.** Mouse X sets red, an LFO sweeps blue, and a clock pulses the brightness on the beat. Green comes from the picker.

**Try this.**
• Move the mouse left to right.
• Pick a new tint while it's driven: the picker sets the colour the mappings start from, and the little swatch shows the live result.`,
  })),

  // ─ Triggers and actions ─
  ex('playKeys', glowGraph(), play({
    controls: [ctl('radius', 'circ::radius', 'Radius (hold A)', 0.15, 0.55), ctl('y', 'circ::posY', 'Jump (Space)', -0.2, 0.8)],
    mappings: [
      map('hold', 'radius', S.key('KeyA'), 0.2, 0.5, { smoothMs: 150 }),
      map('jump', 'y', S.trig(T.key('Space'), 'envelope', { attack: 20, decay: 300, sustain: 0.4, release: 600 }), 0, 0.6),
    ],
    notes: `**What it shows.** A Key source is 1 while the key is held and 0 otherwise. A Trigger fires an envelope on each press: Attack up to the peak, Decay down to Sustain while held, Release after you let go (all in ms).

**Try this.**
• Hold **A**; tap and hold **Space**.
• Change the ADSR numbers and watch the little envelope drawing.
• Click Learn (✦) on a row, then press any key to use that key instead.`,
  })),
  ex('playTriggerModes', glowGraph({ radius: 0.2 }), play({
    controls: [ctl('x', 'circ::posX', 'Toggle (T)', -0.6, 0.6), ctl('radius', 'circ::radius', 'Steps (S)', 0.1, 0.5), ctl('y', 'circ::posY', 'Random (R)', -0.6, 0.6)],
    mappings: [
      map('toggle', 'x', S.trig(T.key('KeyT'), 'toggle'), -0.6, 0.6, { smoothMs: 200 }),
      map('steps', 'radius', S.trig(T.key('KeyS'), 'step', { steps: 4 }), 0.1, 0.5, { smoothMs: 120 }),
      map('random', 'y', S.trig(T.key('KeyR'), 'random'), -0.6, 0.6, { smoothMs: 200 }),
    ],
    notes: `**What it shows.** What a trigger does each time it fires:
• **Toggle** flips between 0 and 1.
• **Step** walks through even steps, then wraps.
• **Random** jumps to a new random value.
A little smoothing turns the jumps into glides.

**Try this.** Press **T**, **S** and **R**. Set Steps to 8, or smoothing to 0 for hard cuts.`,
  })),
  ex('playBeat', glowGraph(), play({
    controls: [ctl('radius', 'circ::radius', 'Kick', 0.15, 0.5), colourCtl('tint', 'glow::tint', 'Tint')],
    mappings: [
      map('kick', 'radius', S.trig(T.beat(120, 1), 'envelope', { attack: 5, decay: 250, sustain: 0, release: 100 }), 0.2, 0.45),
      map('bar', 'tint', S.trig(T.beat(120, 4), 'step', { steps: 4 }), 0.4, 1),
    ],
    notes: `**What it shows.** A Beat trigger fires every N beats at a BPM, like a drum machine, so an envelope becomes a kick and a step counts bars.

**How it's built.** Every beat at 120 BPM punches the radius (a short decay, no sustain). Every 4 beats the tint steps brighter, wrapping each bar of four.

**Try this.**
• Set the BPM to your music.
• Change "every 1 beats" to 0.5 for eighth notes.`,
  })),
  ex('playLiveAudio', glowGraph(), play({
    layers: [layer('audio', 'bars', 'Spectrum', { style: 'bars', y: 0.12, w: 1.6, h: 0.18, colour: 'palette', palette: 3, opacity: 0.8 })],
    controls: [ctl('radius', 'circ::radius', 'Radius (bass)', 0.1, 0.6), ctl('falloff', 'glow::brightness', 'Falloff (treble)', 3, 20), ctl('y', 'circ::posY', 'Hit (kick)', 0, 0.5)],
    mappings: [
      map('bass', 'radius', S.live('bass', 1.2), 0.15, 0.55, { smoothMs: 60 }),
      map('treble', 'falloff', S.live('treble', 1.5), 18, 4, { smoothMs: 80 }),
      map('hit', 'y', S.trig(T.audio('bass', 0.6), 'envelope', { attack: 5, decay: 200, sustain: 0, release: 100 }), 0, 0.35),
    ],
    notes: `**What it shows.** Live audio listens to a microphone, an audio interface, or your DAW through a virtual cable. Each band (level, bass, low-mid, high-mid, treble) is a 0–1 source. An Audio hit trigger fires when a band crosses a threshold.

**Try this.**
• Press **Listen** in a mapping (the browser asks for the mic once), then play music.
• To use Ableton, see Mappings → ⓘ → Ableton · Audio (BlackHole or VB-Cable).
• Raise the hit threshold if it fires too often.`,
  })),
  ex('playMidi', glowGraph(), play({
    controls: [ctl('radius', 'circ::radius', 'Radius (CC 1, mod wheel)', 0.05, 0.7), ctl('x', 'circ::posX', 'X (note)', -1, 1), ctl('flash', 'glow::brightness', 'Flash (note on)', 2, 20)],
    mappings: [
      map('cc', 'radius', S.midi('cc', 1), 0.05, 0.7, { smoothMs: 40 }),
      map('note', 'x', S.midi('note'), -1, 1, { smoothMs: 80 }),
      map('hit', 'flash', S.trig(T.note(-1), 'envelope', { attack: 5, decay: 300, sustain: 0.3, release: 400, velocity: true }), 16, 3),
    ],
    notes: `**What it shows.** MIDI sources: a CC (knob or fader), the last note played, its velocity, a gate or pitch bend. A Note trigger fires on every note, harder hits peaking higher when Velocity is on.

**Try this.**
• Plug in a controller (Chrome and Edge support Web MIDI).
• Turn the mod wheel and play notes.
• Click Learn (✦) on a row and move any knob to use it instead.
• From Ableton: Mappings → ⓘ → Ableton · MIDI.`,
  })),
  ex('playOsc', glowGraph(), play({
    controls: [ctl('radius', 'circ::radius', 'Radius (/1/fader1)', 0.05, 0.7), ctl('y', 'circ::posY', 'Hit (/1/push1)', 0, 0.5)],
    mappings: [
      map('fader', 'radius', S.osc('/1/fader1'), 0.05, 0.7, { smoothMs: 40 }),
      map('push', 'y', S.trig(T.osc('/1/push1')), 0, 0.4),
    ],
    notes: `**What it shows.** An OSC source reads a number from a message address. An OSC trigger fires when a message arrives (or goes above 0.5).

**Try this.**
• In the desktop app, press **Start listening** in a mapping, and send to UDP port 9000.
• In a browser, download the small bridge (the mapping offers it) and run it.
• Click Learn and move a fader in TouchOSC to pick up its address.
• Ableton setup: Mappings → ⓘ → Ableton · OSC.`,
  })),
  ex('playTilt', glowGraph({ radius: 0.2 }), play({
    controls: [ctl('x', 'circ::posX', 'X (tilt left/right)', -1, 1), ctl('y', 'circ::posY', 'Y (tilt front/back)', -0.8, 0.8)],
    mappings: [map('lr', 'x', S.tilt('gamma'), -1, 1, { smoothMs: 100 }), map('fb', 'y', S.tilt('beta'), 0.8, -0.8, { smoothMs: 100 })],
    notes: `**What it shows.** Phone orientation: left/right, front/back and compass, each 0–1.

**Try this.** Open this on a phone: the app on the phone, or Put it on a website → Download page and open that there. iPhones ask for motion permission from a button. Tilt to roll the glow around.`,
  })),

  // ─ Layers ─
  ex('playNull', glowGraph({ radius: 0.15 }), play({
    layers: [layer('null', 'pin', 'Pin', { x: 0.65, y: 0.6, size: 10 })],
    controls: [ctl('x', 'circ::posX', 'Circle X', -1.8, 1.8), ctl('y', 'circ::posY', 'Circle Y', -1, 1)],
    mappings: [map('nx', 'x', S.nul('pin', 'x'), -1.78, 1.78), map('ny', 'y', S.nul('pin', 'y'), -1, 1)],
    notes: `**What it shows.** A null is a draggable point. Its X and Y (0–1 across and up the picture) are sources, so dragging it can move anything.

**How it's built.** Null X and Null Y are mapped onto the circle's position, over ranges that match the picture, so the glow sits under the marker.

**Try this.**
• Drag the blue marker on the picture.
• In Layers, press the + next to the null's X to make it a control, then map an LFO onto it: the null (and the glow) moves on its own.`,
  })),
  ex('playSpringNull', glowGraph({ radius: 0.12 }), play({
    layers: [
      layer('null', 'lead', 'Lead', { follow: 'mouse', spring: 0.6, wobble: 0.2, color: '#ffb86b' }),
      layer('null', 'tail', 'Tail', { follow: 'null', followId: 'lead', spring: 0.25, wobble: 0.7 }),
    ],
    controls: [ctl('x', 'circ::posX', 'Circle X', -1.8, 1.8), ctl('y', 'circ::posY', 'Circle Y', -1, 1)],
    mappings: [map('tx', 'x', S.nul('tail', 'x'), -1.78, 1.78), map('ty', 'y', S.nul('tail', 'y'), -1, 1)],
    notes: `**What it shows.** A null can follow the mouse or another null on a spring. **Spring** is how hard it's pulled; **Wobble** is how much it overshoots before settling. Anything mapped from it inherits that organic motion.

**How it's built.** Lead chases the mouse, Tail chases Lead, and the glow rides Tail.

**Try this.**
• Flick the mouse across the picture.
• Turn Tail's Wobble up to 1, or its Spring down, in Layers.`,
  })),
  ex('playNullDistance', glowGraph(), play({
    layers: [layer('null', 'a', 'A', { x: 0.35, y: 0.5, color: '#ffb86b' }), layer('null', 'b', 'B', { x: 0.65, y: 0.5 })],
    controls: [ctl('radius', 'circ::radius', 'Radius (distance)', 0.05, 0.8), ctl('falloff', 'glow::brightness', 'Falloff (distance)', 3, 30)],
    mappings: [map('dist', 'radius', S.sensor('a', 'distance', 'b'), 0.05, 0.8), map('soft', 'falloff', S.sensor('a', 'distance', 'b'), 30, 3)],
    notes: `**What it shows.** Layer sensors are sources that measure something. A null's **Distance** to another null is 0 when they touch and 1 at a picture height apart.

**Try this.**
• Drag A and B apart and together: the glow grows and softens.
• Make one of them follow the mouse (Layers → A → Follows: Mouse).`,
  })),
  ex('playTextMattes', fbmGraph(), play({
    layers: [
      layer('text', 'over', 'Over', { text: 'OVER', y: 0.78, size: 0.2, blend: 'overlay' }),
      layer('text', 'reveal', 'Reveal', { text: 'REVEAL', y: 0.5, size: 0.2, matte: 'reveal', color: [0.05, 0.05, 0.08], opacity: 0.85 }),
      layer('text', 'luma', 'Luma', { text: 'LUMA', y: 0.2, size: 0.2, matte: 'luma' }),
    ],
    notes: `**What it shows.**
• **Over** draws the text on top with a blend mode.
• **Reveal** shows the picture only inside the letters, with a colour everywhere else.
• **Luma** makes the text as solid as the picture is bright, so it glows where the picture is light.

**Try this.**
• In Layers, change blend modes on Over.
• Change Reveal's backdrop colour and opacity.
• Make any number a control with its + and map it.`,
  })),
  ex('playLayersOnly', fbmGraph({ scale: 2.5 }), play({
    layers: [
      layer('text', 'word', 'Word', { text: 'SHADER', size: 0.3, matte: 'reveal' }),
      layer('particles', 'dust', 'Dust', { count: 900, field: 'noise', speed: 0.8, size: 2.5, trail: 0.5, reveal: true }),
    ],
    display: { picture: false, backdrop: [0.03, 0.03, 0.05] },
    notes: `**What it shows.** Picture → **Layers only** covers the shader with a backdrop colour, but it keeps rendering underneath. A Reveal matte and particles with **Mask** on show it only where they are.

**Try this.**
• Switch Picture back to Shown to see what's underneath.
• Change the backdrop colour.
• Turn Mask off on the particles.`,
  })),
  ex('playTextSequence', fbmGraph({ preset: '6' }), play({
    layers: [layer('text', 'lyrics', 'Lyrics', { text: 'ONE LINE\nAT A TIME\nPRESS N\nOR WAIT', size: 0.16, sequence: true, interval: 2.5, transition: 'type' })],
    actions: [act('next', T.key('KeyN'), 'next', 'lyrics'), act('prev', T.key('KeyP'), 'prev', 'lyrics'), act('shuffle', T.key('KeyS'), 'shuffle', 'lyrics')],
    notes: `**What it shows.** A text layer with **Lines** on shows one line at a time. Actions step it (Next, Previous, Random line), and **Every** steps it on a timer. It arrives with a cut, fade, rise or typewriter effect.

**How it's built.** Three actions (at the bottom of the Layers tab): N → next, P → previous, S → random. Every is 2.5 s.

**Try this.**
• Press N, P and S.
• Set Every to 0 so only the keys step it.
• Change the action's trigger to a Beat, or a MIDI note from your keyboard, for lyrics on the music.`,
  })),
  ex('playImage', fbmGraph({ preset: '2' }), play({
    layers: [layer('image', 'star', 'Star', { src: STAR_SVG, scale: 0.8, matte: 'reveal', color: [0.04, 0.04, 0.07] })],
    controls: [ctl('spin', 'layer:star::rotation', 'Star · Rotation', -180, 180, 1)],
    mappings: [map('spin', 'spin', S.lfo('saw', 0.05), -180, 180)],
    notes: `**What it shows.** An image layer, here an SVG star, travels inside the play file. It uses the same mattes as text; this one is Reveal, so the picture shows inside the star.

**How it's built.** The star's Rotation was made a control (the + in Layers), and a slow saw LFO turns it.

**Try this.**
• In Layers → Star, press Replace and pick an image of your own (PNG with transparency works best).
• Switch the matte to Over or Luma.`,
  })),
  ex('playCamera', glowGraph({ radius: 0.2, tint: [0.4, 0.8, 1] }), play({
    layers: [
      layer('camera', 'cam', 'Camera', { opacity: 0.25 }),
      layer('glyphs', 'ascii', 'ASCII', { readFrom: 'camera', cell: 10, colour: 'tint', color: [0.6, 1, 0.7], cover: false }),
    ],
    controls: [ctl('radius', 'circ::radius', 'Radius (motion)', 0.1, 0.8)],
    mappings: [map('motion', 'radius', S.sensor('cam', 'motion'), 0.1, 0.8, { smoothMs: 150 })],
    notes: `**What it shows.** A Camera layer is your webcam. Particles, glyphs and contours can read it instead of the shader, and its **Motion** (how much is moving) is a sensor source.

**Try this.**
• Layers → Camera → **Turn on camera** (the browser asks once).
• Wave at it: the glow swells with the motion.
• Change the glyphs' style to Dots.`,
  })),
  ex('playBrush', quietGraph(), play({
    layers: [
      layer('particles', 'rain', 'Rain', { count: 700, field: 'none', attractor: 'none', speed: 0.8, angle: -90, spawn: 'edges', edges: 'respawn', size: 1.5, colour: 'tint', color: [0.6, 0.8, 1], trail: 0.4, flock: 0 }),
      layer('brush', 'paint', 'Paint', { walls: true, fade: 10, size: 12 }),
    ],
    actions: [act('clear', T.key('KeyC'), 'clear', 'paint')],
    notes: `**What it shows.** A Brush layer paints with the mouse (drag), wherever the pointer goes (hover), or along a moving null. Strokes fade after Fade seconds. With **Walls** on, particles and bodies bump into them.

**How it's built.** The particles have no field, so they coast; Direction makes them fall. C clears the strokes.

**Try this.**
• Drag on the picture to draw ledges and cups for the particles.
• Press C to clear.
• Set Paint to Hover.`,
  })),
  ex('playAudioLayer', layersGlowGraph({ falloff: 30, tint: [0.4, 0.7, 1] }), play({
    layers: [
      layer('audio', 'ring', 'Ring', { style: 'ring', y: 0.5, w: 0.9, h: 0.9, bars: 64, colour: 'palette', palette: 1, thickness: 3 }),
      layer('audio', 'wave', 'Wave', { style: 'wave', y: 0.12, w: 1.6, h: 0.15, opacity: 0.8, toShader: false }),
    ],
    notes: `**What it shows.** Audio layers draw the live input: **Wave** (the waveform), **Bars** (the spectrum, low to high), **Ring** (the spectrum around a circle) and **Blob** (a shape that swells). Here the ring also glows through the Layers node.

**Try this.**
• Press **Listen** on a layer and play music.
• Try the Blob style.
• Raise Gain for quiet inputs, and Smooth for calmer motion.`,
  })),
  ex('playGlyphs', fbmGraph({ scale: 1.5, timeScale: 0.1 }), play({
    layers: [layer('glyphs', 'ascii', 'ASCII', { cell: 12, colour: 'picture', contrast: 1.4 })],
    controls: [ctl('cell', 'layer:ascii::cell', 'ASCII · Cell', 6, 30, 1)],
    mappings: [map('zoom', 'cell', S.mouse('x'), 6, 28, { smoothMs: 150 })],
    notes: `**What it shows.** Glyphs picks a character for each grid cell by the brightness under it. Other styles draw halftone dots, squares, lines or crosses sized by it.

**Try this.**
• Move the mouse left to right: the cell size follows.
• Switch the style to Dots for halftone.
• Type your own ramp in Characters, from dark to bright.
• Colour by Palette.`,
  })),
  ex('playContours', fbmGraph({ scale: 1.8 }), play({
    layers: [layer('contours', 'lines', 'Lines', { levels: 12, flow: 0.25, palette: 6 })],
    display: { picture: false, backdrop: [0.02, 0.02, 0.04] },
    notes: `**What it shows.** Contour lines join points of equal brightness, like a map's height lines. **Flow** drifts the levels so lines crawl up and down the slopes.

**Try this.**
• Set Picture back to Shown to see what they trace.
• Try 4 levels, or 30.
• Set Flow to 0 to hold them still.`,
  })),
  ex('playLens', fbmGraph({ scale: 3 }), play({
    layers: [layer('lens', 'loupe', 'Loupe', { effect: 'magnify', amount: 2.5, radius: 0.2 })],
    notes: `**What it shows.** A Lens changes the shader under a circle. It follows the mouse, a null, or stays put.

**Try this.**
• Move the mouse over the picture.
• Switch Effect to Pixelate, Blur, Invert, Black and white or Mirror.
• Make Radius a control and map the mouse button onto it, so it opens while you press.`,
  })),

  // ─ Particles ─
  ex('playFlow', glowGraph({ radius: 0.25, falloff: 5, tint: [0.5, 0.6, 1] }), play({
    layers: [layer('particles', 'flow', 'Flow', { count: 1200, field: 'flow', turns: 1, speed: 1, size: 1.4, trail: 0.7, colour: 'palette', palette: 1, paletteBy: 'heading', blend: 'screen' })],
    controls: [ctl('dir', 'layer:flow::angle', 'Flow · Direction', -180, 180, 1), ctl('turns', 'layer:flow::turns', 'Flow · Turns', 0, 4)],
    mappings: [map('turn', 'dir', S.lfo('triangle', 0.02), -90, 90)],
    notes: `**What it shows.** In the **Flow** field each particle reads the brightness under it and turns it into a heading. Black points right, and the heading turns **Turns** full circles from black to white.

**Why they skate around bright shapes.** At Turns 1, black and white point the same way and mid grey the opposite. A particle heading into a bright shape is turned along its outline near 25% brightness and never gets inside.

**Try this.**
• Drag Turns from 0 to 4.
• Watch Direction slowly turn the whole field (an LFO drives it).
• Colour is by heading, so each direction has its own colour.`,
  })),
  ex('playClimb', glowGraph({ mode: 'ring', ringFreq: 10, falloff: 3, tint: [0.4, 0.5, 0.9] }), play({
    layers: [
      layer('particles', 'up', 'Climb · settle', { count: 800, field: 'climb', flat: 'settle', speed: 0.8, size: 1.6, color: [1, 0.85, 0.5], trail: 0.3 }),
      layer('particles', 'down', 'Descend · wander', { count: 800, field: 'descend', flat: 'wander', speed: 0.8, size: 1.6, color: [1, 0.4, 0.7], trail: 0.3 }),
    ],
    notes: `**What it shows.** **Climb** moves particles uphill in brightness (toward light), **Descend** downhill (toward dark). Where the picture is flat there is no slope:
• **Settle** lets particles slow and freeze, drawing patterns along the edges (gold).
• **Wander** keeps them drifting on noise until they find a slope (pink).

**Try this.**
• Swap the two layers' On flat areas settings.
• Try Detail: Fine so the thin rings steer them more precisely.`,
  })),
  ex('playNoiseField', quietGraph(), play({
    layers: [layer('particles', 'smoke', 'Smoke', { count: 1500, field: 'noise', noiseScale: 2.5, noiseEvolve: 0.3, speed: 0.9, steer: 0.4, size: 1.2, trail: 0.8, colour: 'palette', palette: 4, paletteBy: 'speed', blend: 'screen' })],
    controls: [ctl('swirl', 'layer:smoke::noiseScale', 'Smoke · Swirl size', 0.5, 8)],
    mappings: [map('m', 'swirl', S.mouse('x'), 0.8, 7, { smoothMs: 300 })],
    notes: `**What it shows.** The **Noise** field is an evolving flow of smooth swirling lanes, independent of the picture. **Swirl size** sets how busy it is; **Evolve** how fast it changes.

**Try this.**
• Move the mouse left to right to change the swirl size.
• Set Evolve to 0 for frozen lanes.
• Turn Steering down for floaty particles.`,
  })),
  ex('playAttractor', quietGraph(), play({
    layers: [layer('particles', 'swarm', 'Swarm', { count: 1200, field: 'noise', speed: 0.8, attractor: 'mouse', force: 'spiral', strength: 1.5, catchRadius: 0.03, size: 1.5, trail: 0.6, colour: 'palette', palette: 3, paletteBy: 'speed', blend: 'screen' })],
    notes: `**What it shows.** An attractor pulls particles on top of their field: strongly close by, weakly far away. **Gravitate** pulls straight in, **Spiral** pulls while orbiting, **Repel** pushes away. Particles that reach it (within **Catch**) respawn.

**Try this.**
• Move the mouse over the picture.
• Switch Force to Gravitate or Repel.
• Set Pulled by to **Press**, so it only pulls while you hold the button.
• Pull by a null and drag it instead.`,
  })),
  ex('playEmitAbsorb', quietGraph(), play({
    layers: [
      layer('null', 'plus', 'Emitter', { x: 0.3, y: 0.5, color: '#ffb86b', role: 'emitter', radius: 0.04, strength: 1 }),
      layer('null', 'minus', 'Absorber', { x: 0.7, y: 0.5, role: 'absorber', radius: 0.04, strength: 4 }),
      layer('particles', 'field', 'Field lines', { count: 600, field: 'none', speed: 0.5, steer: 0.2, edges: 'respawn', size: 1.3, trail: 0.85, colour: 'palette', palette: 1, paletteBy: 'age', life: 0, blend: 'screen' }),
    ],
    notes: `**What it shows.** A null (or a shape) can have a particle role. An **Emitter** births particles inside its ring and launches them outward; particles that leave the picture come back out of it. An **Absorber** pulls them straight in and swallows them, and they are reborn at the emitter. Together they draw curved lines, like a magnet's field.

**Try this.**
• Drag the two nulls around.
• Add a second absorber.
• Raise the emitter's Strength.
• Set the absorber to follow the mouse.`,
  })),
  ex('playFlock', quietGraph(), play({
    layers: [layer('particles', 'birds', 'Flock', { count: 600, field: 'noise', noiseScale: 1.2, noiseEvolve: 0.1, speed: 1, steer: 0.1, flock: 0.8, flockRadius: 0.08, flockAlign: 1.2, flockCohere: 0.8, flockSeparate: 1.2, flockSpace: 0.35, shape: 'triangle', rotate: 'heading', size: 3, sizeJitter: 0.2, edges: 'wrap', colour: 'palette', palette: 5, paletteBy: 'heading', trail: 0.2 })],
    controls: [
      ctl('flock', 'layer:birds::flock', 'Flock · Amount', 0, 1),
      ctl('sight', 'layer:birds::flockRadius', 'Flock · Sight', 0.02, 0.25),
      ctl('align', 'layer:birds::flockAlign', 'Flock · Alignment', 0, 2),
      ctl('cohere', 'layer:birds::flockCohere', 'Flock · Cohesion', 0, 2),
      ctl('sep', 'layer:birds::flockSeparate', 'Flock · Separation', 0, 2),
      ctl('space', 'layer:birds::flockSpace', 'Flock · Personal space', 0.05, 1),
    ],
    notes: `**What it shows.** Flocking (boids) makes each particle steer by the neighbours it can see, within **Sight**:
• **Alignment**: fly the way they fly.
• **Cohesion**: head for their middle.
• **Separation**: back off from anyone inside your **Personal space**.
It adds to the field, attractors and zones, so a flock can still follow the picture or the mouse. **Amount** says how much the flock wins over everything else.

**How it's built.** A weak noise field (Steer 0.1) gives the flock somewhere to wander. Everything else comes from the six flocking controls here.

**Good starting points.**
• **Starlings**: Sight 0.08, Alignment 1.2, Cohesion 0.8, Separation 1.2, Personal space 0.35 (what loads).
• **Fish school**: Sight 0.15, Alignment 2, Cohesion 0.4, Personal space 0.25. Long, orderly streams.
• **Swarm of gnats**: Alignment 0, Cohesion 1.5, Personal space 0.5. They buzz around a middle without flying together.
• **Scattered pairs**: Sight 0.03, Cohesion 2. Tiny groups that meet and split.

**Try this.**
• Set Alignment to 0 and watch the formations melt.
• Turn Personal space down to 0.1 for tight balls; up to 1 for an even spread.
• Raise Sight slowly: small flocks merge into rivers.`,
  })),
  ex('playBursts', quietGraph(), play({
    layers: [layer('particles', 'pop', 'Pop', { count: 1500, emit: 'burst', spawn: 'center', spawnRadius: 0.02, field: 'none', speed: 1.2, life: 1.2, fade: 0.6, size: 2.2, sizeJitter: 0.6, colour: 'palette', palette: 3, paletteBy: 'age', trail: 0.4, blend: 'screen' })],
    actions: [act('beat', T.beat(110, 1), 'burst', 'pop', 60), act('space', T.key('Space'), 'burst', 'pop', 300)],
    notes: `**What it shows.** With **Emit: Bursts** a particles layer starts empty. A **Burst** action throws out a handful, which live for their Life, fade and vanish.

**How it's built.** Two actions: a Beat (110 BPM) bursts 60, Space bursts 300.

**Try this.**
• Press Space.
• Change the beat action's trigger to an Audio hit on the bass, or a MIDI note.
• Set Born to At a null and drag the null.`,
  })),
  ex('playPlexus', quietGraph(), play({
    layers: [layer('particles', 'net', 'Net', { count: 260, field: 'noise', noiseScale: 1.2, speed: 0.4, collide: 0.6, links: 0.12, size: 2.5, color: [0.7, 0.85, 1], trail: 0, attractor: 'press', strength: 1.5 })],
    notes: `**What it shows.** **Collide** makes particles push each other apart instead of passing through. **Links** join particles closer than a distance with lines that fade as they stretch: the plexus look.

**Try this.**
• Hold the mouse button to pull them together (the attractor is set to Press).
• Raise Links.
• Links check up to 1,500 particles, so keep Count modest.`,
  })),
  ex('playLooks', quietGraph(), play({
    layers: [
      layer('null', 'lens', 'Magnet', { x: 0.5, y: 0.5, size: 10 }),
      layer('particles', 'stars', 'Stars', { count: 700, field: 'noise', speed: 0.5, shape: 'star', rotate: 'spin', size: 3, sizeJitter: 0.5, sizeBy: 'null', sizeAmount: 3, falloff: 0.35, nullId: 'lens', opacityBy: 'age', opacityAmount: -0.5, life: 6, colour: 'palette', palette: 7, paletteBy: 'speed', trail: 0 }),
    ],
    notes: `**What it shows.** How particles look:
• **Shape**: dot, square, triangle, streak, ring, star, or your own PNG/SVG.
• **Rotate**: face their motion, spin, or stay upright.
• **Colour**: tint, the picture's colour, or a palette.
• **Size follows** and **Opacity follows**: brightness, speed, age or nearness to a null.

**How it's built.** The stars grow near the Magnet null (Size follows: Nearness to a null) and fade with age.

**Try this.**
• Drag the Magnet.
• Change Shape to Image / SVG and upload a sprite.
• Try other palettes.`,
  })),
  ex('playParticleMask', fbmGraph({ scale: 2.2, preset: '6' }), play({
    layers: [layer('particles', 'brush', 'Brush', { count: 2000, field: 'flow', turns: 1.5, speed: 1.2, size: 3, sizeJitter: 0.6, trail: 0.92, reveal: true })],
    display: { picture: false, backdrop: [0, 0, 0] },
    notes: `**What it shows.** With **Mask** on, particles become a stencil: each one shows the shader under it. With long trails and the picture hidden, the shader is painted in by their paths.

**Try this.**
• Set Trail to 1 so the painting never fades.
• Switch Picture to Shown.
• Change the particles' field.`,
  })),

  // ─ Shapes and zones ─
  ex('playWalls', quietGraph(), play({
    layers: [
      layer('shape', 'box', 'Wall', { shape: 'box', x: 0.38, w: 0.35, h: 0.35, round: 0.2, rotation: 15, action: 'wall', bounce: 0.3, affects: 'outside' }),
      layer('shape', 'jar', 'Container', { shape: 'circle', x: 0.72, w: 0.4, h: 0.4, action: 'container', affects: 'inside', fill: [1, 0.6, 0.4], stroke: [1, 0.6, 0.4] }),
      layer('particles', 'outside', 'Outside', { count: 900, field: 'noise', speed: 1, size: 1.4, color: [0.6, 0.8, 1], trail: 0.4 }),
      layer('particles', 'inside', 'Inside', { count: 250, field: 'noise', speed: 1.2, spawn: 'center', size: 1.6, color: [1, 0.6, 0.4], trail: 0.4 }),
    ],
    notes: `**What it shows.** A Shape layer set to **Wall** is solid: particles slide along it (Bounce 1 = straight back). A **Container** is the opposite: particles are kept inside.

**How it's built.** Each shape acts only on one particles layer (Acts on), so blue particles avoid the box and orange ones stay in the jar.

**Try this.**
• Drag the shapes on the picture (while the Layers tab is open).
• Turn Show off to make an invisible wall.
• Set Shape to Drawn and draw your own outline.`,
  })),
  ex('playPortals', quietGraph(), play({
    layers: [
      layer('shape', 'in', 'Portal in', { shape: 'circle', x: 0.8, y: 0.5, w: 0.25, h: 0.25, action: 'portal', targetId: 'out', fill: [0.4, 0.7, 1], stroke: [0.4, 0.7, 1] }),
      layer('shape', 'out', 'Portal out', { shape: 'circle', x: 0.2, y: 0.5, w: 0.25, h: 0.25, action: 'none', fill: [1, 0.6, 0.3], stroke: [1, 0.6, 0.3] }),
      layer('particles', 'stream', 'Stream', { count: 700, field: 'none', speed: 0.9, angle: 0, attractor: 'null', force: 'gravitate', strength: 0.8, nullId: 'pull', catchRadius: 0, edges: 'wrap', size: 1.5, trail: 0.6, color: [0.8, 0.9, 1] }),
      layer('null', 'pull', 'Pull', { x: 0.8, y: 0.5, size: 8 }),
    ],
    notes: `**What it shows.** A shape set to **Portal** sends particles that enter it out of its target shape, keeping their motion (turned by the difference in the shapes' rotation).

**How it's built.** A null inside the blue portal pulls the stream in; they reappear from the orange one.

**Try this.**
• Drag the portals around.
• Rotate Portal out.
• Give it a target too, so the two portals ping-pong.`,
  })),
  ex('playForces', quietGraph(), play({
    layers: [
      layer('shape', 'wind', 'Wind', { shape: 'box', x: 0.22, w: 0.45, h: 1.1, action: 'wind', angle: -90, strength: 2, fillOpacity: 0.06 }),
      layer('shape', 'swirl', 'Vortex', { shape: 'circle', x: 0.55, w: 0.25, h: 0.25, action: 'vortex', strength: 3, reach: 0.25 }),
      layer('shape', 'honey', 'Drag', { shape: 'box', x: 0.85, w: 0.4, h: 1.1, action: 'drag', strength: 2, fillOpacity: 0.06, fill: [1, 0.8, 0.3], stroke: [1, 0.8, 0.3] }),
      layer('particles', 'air', 'Air', { count: 1400, field: 'noise', speed: 0.8, size: 1.3, trail: 0.7, colour: 'palette', palette: 1, paletteBy: 'speed', blend: 'screen' }),
    ],
    controls: [ctl('tilt', 'layer:swirl::tilt', 'Vortex · Tilt', 0, 85, 1)],
    mappings: [map('lean', 'tilt', S.lfo('sine', 0.05), 0, 70)],
    notes: `**What it shows.** Force zones act on particles inside (or near) a shape:
• **Wind** is a steady push in a direction (Wind angle: 0 right, −90 up).
• **Vortex** swirls them around it, within Reach. **Tilt** leans the swirl back like a disc seen from the side: orbits become ellipses, and particles grow on the near side and shrink on the far side.
• **Drag** slows them, like honey.

**How it's built.** A slow LFO leans the vortex between flat (0°) and 70°.

**Try this.**
• Change the wind's angle.
• Stop the LFO (turn its mapping off) and set Tilt yourself; rotate the vortex shape to turn the lean.
• Make the drag zone a Drawn shape.`,
  })),
  ex('playTintZones', quietGraph(), play({
    layers: [
      layer('shape', 'red', 'Tint', { shape: 'circle', x: 0.35, w: 0.45, h: 0.45, action: 'tint', tint: [1, 0.3, 0.35], show: false }),
      layer('shape', 'big', 'Resize', { shape: 'box', x: 0.68, w: 0.4, h: 0.4, round: 0.5, action: 'resize', scale: 3, show: false }),
      layer('particles', 'dots', 'Dots', { count: 1200, field: 'noise', speed: 0.6, size: 1.6, color: [0.8, 0.9, 1], trail: 0 }),
    ],
    notes: `**What it shows.** A **Tint** zone recolours particles inside it; a **Resize** zone scales them by Resize ×. These shapes are invisible (Show off): open the Layers tab to see their dashed outlines.

**Try this.**
• Drag the zones.
• Put them over each other.
• Set Resize × to 0 to make particles vanish inside.`,
  })),
  ex('playSensors', glowGraph({ radius: 0.12, posY: -0.55, falloff: 12, tint: [0.4, 0.8, 1] }), play({
    layers: [
      layer('shape', 'box', 'Box', { shape: 'box', x: 0.5, y: 0.62, w: 0.5, h: 0.35, round: 0.15, action: 'sensor', fillOpacity: 0.05 }),
      layer('particles', 'swarm', 'Swarm', { count: 800, field: 'noise', speed: 0.8, attractor: 'press', strength: 2, size: 1.5, trail: 0.4, color: [1, 0.8, 0.5] }),
    ],
    controls: [ctl('radius', 'circ::radius', 'Glow (Box fill)', 0.05, 0.5), ctl('falloff', 'glow::brightness', 'Softness (Box fill)', 3, 20)],
    mappings: [map('fill', 'radius', S.sensor('box', 'fill'), 0.05, 0.5, { smoothMs: 150 }), map('soft', 'falloff', S.sensor('box', 'fill'), 20, 3, { smoothMs: 150 })],
    notes: `**What it shows.** Every shape measures things. **Fill** is how crowded it is with particles (0.5 = as dense as average, 1 = twice that). **Hover** is 1 while the pointer is over it. Map them like any source: here Fill drives the glow below.

**Try this.**
• Hold the mouse button inside the box to pull the swarm in and watch the glow grow.
• Map the box's Hover onto something.
• Particle speed and spread are sensors too (on the particles layer).`,
  })),
  ex('playShapeTriggers', quietGraph(), play({
    layers: [
      layer('shape', 'button', 'Button', { shape: 'circle', x: 0.25, w: 0.3, h: 0.3, action: 'none', fill: [1, 0.5, 0.4], stroke: [1, 0.5, 0.4], fillOpacity: 0.3 }),
      layer('shape', 'pad', 'Hover pad', { shape: 'box', x: 0.55, w: 0.3, h: 0.3, round: 0.2, action: 'none', fill: [0.4, 0.8, 1], stroke: [0.4, 0.8, 1], fillOpacity: 0.3 }),
      layer('shape', 'bucket', 'Bucket', { shape: 'box', x: 0.85, y: 0.3, w: 0.3, h: 0.3, action: 'sensor', fillOpacity: 0.1 }),
      layer('particles', 'fx', 'Sparks', { count: 800, emit: 'burst', spawn: 'center', field: 'none', speed: 1, life: 1.5, fade: 0.5, size: 2, colour: 'palette', palette: 3, paletteBy: 'age', blend: 'screen' }),
      layer('particles', 'sand', 'Sand', { count: 400, field: 'none', attractor: 'null', nullId: 'drain', strength: 1.5, catchRadius: 0, speed: 0.6, size: 1.4, color: [1, 0.9, 0.6] }),
      layer('null', 'drain', 'Drain', { x: 0.85, y: 0.3, size: 7 }),
      layer('text', 'msg', 'Message', { text: 'CLICK THE CIRCLE\nHOVER THE SQUARE\nTHE BUCKET IS FULL', y: 0.85, size: 0.08, sequence: true, transition: 'rise' }),
    ],
    actions: [
      act('click', T.zone('button', 'click'), 'burst', 'fx', 120),
      act('enter', T.zone('pad', 'enter'), 'next', 'msg'),
      act('full', T.zone('bucket', 'fill', 0.7), 'scatter', 'sand', 2),
    ],
    notes: `**What it shows.** Shapes are triggers:
• **Click** when pressed.
• **Enter** when the pointer moves onto one.
• **Fill** when particles crowd it past a level.
Actions use them like keys, and they work on websites too (a background can react to parts of the page).

**How it's built.** Clicking the circle bursts sparks. Hovering the square steps the message. Sand pulled into the bucket fills it, and when full it scatters.

**Try this.**
• Click, hover, and wait for the bucket.
• Change the fill level.`,
  })),
  ex('playDrawnShapes', fbmGraph({ preset: '2' }), play({
    layers: [
      layer('shape', 'poly', 'Drawn', { shape: 'polygon', x: 0.5, y: 0.5, w: 0.8, h: 0.8, points: [0, 0.4, 0.12, 0.12, 0.4, 0.1, 0.16, -0.08, 0.25, -0.38, 0, -0.2, -0.25, -0.38, -0.16, -0.08, -0.4, 0.1, -0.12, 0.12], action: 'none', fillOpacity: 0, strokeWidth: 4, stroke: [1, 1, 1] }),
    ],
    controls: [ctl('trim', 'layer:poly::trim', 'Drawn · Trim', 0, 1), ctl('spin', 'layer:poly::rotation', 'Drawn · Rotation', -180, 180, 1)],
    mappings: [map('draw', 'trim', S.lfo('saw', 0.25), 0, 1), map('spin', 'spin', S.lfo('sine', 0.05), -30, 30)],
    notes: `**What it shows.** Shape → **Drawn** is any outline: click corners on the picture, or drag freehand. **Trim** draws the outline on from 0 to 1, so mapping an LFO onto it animates the drawing.

**Try this.**
• In Layers → Drawn, press **Draw corners**, click a few points on the picture and click the first one to close it.
• Try Draw freehand.
• Give it a fill.`,
  })),
  ex('playPictureShape', fbmGraph({ scale: 1.6, timeScale: 0.03 }), play({
    layers: [
      layer('shape', 'land', 'Land', { shape: 'picture', threshold: 0.55, action: 'wall', show: false, bounce: 0.2 }),
      layer('particles', 'water', 'Water', { count: 1500, field: 'noise', speed: 1, size: 1.4, trail: 0.6, color: [0.5, 0.8, 1], blend: 'screen' }),
    ],
    controls: [ctl('sea', 'layer:land::threshold', 'Land · Threshold', 0.3, 0.8)],
    notes: `**What it shows.** Shape → **Picture** makes everything brighter than a threshold one shape. Here it's a wall, so particles flow like water around the light "land" and follow it as the shader moves.

**Try this.**
• Drag Threshold (the sea level).
• Set the shape's action to Sink, so particles vanish on land.
• Turn Show on to see the land mask.`,
  })),

  // ─ Layers ↔ shader ─
  ex('playGlowText', layersGlowGraph({ falloff: 25, tint: [0.4, 0.75, 1] }), play({
    layers: [
      layer('text', 'neon', 'Neon', { text: 'NEON', size: 0.28, color: [0.9, 0.95, 1], weight: 300 }),
      layer('brush', 'pen', 'Pen', { size: 6, fade: 6, colour: 'tint', color: [1, 1, 1], opacity: 1, blend: 'normal' }),
    ],
    controls: [ctl('falloff', 'glow::brightness', 'Glow falloff', 5, 80)],
    mappings: [map('flicker', 'falloff', S.noise('stepped', 6, 2, 3), 20, 32)],
    notes: `**What it shows.** The **Layers** node (Sources → Layers in the Studio) gives the shader what the layers draw: Color, Alpha and **Distance**, a signed distance to them. Wire Distance into SDF Glow and text, strokes and particles glow like neon.

**Try this.**
• Drag on the picture to write with the pen.
• Open the Studio to see the graph: UV → Layers → SDF Glow → Tone Map.
• Turn "Seen by the Layers node" off on a layer to leave it out.`,
  })),
];

export const PLAY_EXAMPLE_GRAPHS: Record<string, ExampleGraph> = Object.fromEntries(
  LIST.map(e => [e.key, { ...PLAY_EXAMPLE_INDEX[e.key], counter: 20, nodes: e.nodes, play: e.play }]),
);
