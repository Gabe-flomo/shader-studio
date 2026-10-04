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
import { extractScriptParams } from '../components/play/layers/scriptExamples';
import { encodeKeys } from '../lib/takePlayback';
import { P5_EXAMPLE_SKETCHES } from './p5ExampleSketches';
import { SKETCH_3D, SKETCH_3D_SHAPES, SKETCH_3D_TEXTURE, SKETCH_BUTTONS, SKETCH_COMET, SKETCH_FIREFLIES, SKETCH_FIRST, SKETCH_GLOW, SKETCH_MOUSE, SKETCH_NULLS, SKETCH_INK, SKETCH_P5, SKETCH_PARTICLES, SKETCH_PICTURE, SKETCH_HALATION, SKETCH_ORBIT } from './playSketches';
import { GRADE_LOOKS, applyLook, newCustomEffect, newFinishEffect, type FinishEffect, type FinishKind, type PlayFinish } from '../types/playFinish';
import { newAudioFxEffect, type AudioFxEffect, type AudioFxKind, type PlayAudioFx } from '../types/playAudioFx';
// An original picture made for the Background example (tools/ridges-at-dusk.mjs), inlined as a data URL.
import RIDGES_AT_DUSK from './playAssets/ridges-at-dusk.jpg?inline';
// An original picture of a pool's floor for the Water example (tools/pool-floor.mjs): straight tile lines show the water bending the light.
import POOL_FLOOR from './playAssets/pool-floor.jpg?inline';
import {
  defaultLayer, handAnchor, type ActionKind, type AudioReader, type PlayAudioReaders, type FireSpec, type HandGesture, type HandRead, type HandSide, type LfoShape, type LiveAudioBand, type NoiseType, type PlayAction, type PlayControl, type PlayDisplay,
  type PlayLayer, type PlayLayerKind, type PlayMapping, type PlayRecord, type PlaySource, type PlayTake, type TakeTrack, type SensorRead, type TriggerMode, type TriggerSpec,
  type CondCmp, type PairAxis, type PlayPair, type PlayPairMapping, type PlaySignal, type RelationMember, type RelationRole, type RelationshipLayer, newRelationMember,
  defaultIncrement, type PlayIncrement,
} from '../types/play';
import { DEFAULT_PAD_GRID, type PlayPadGrid } from '../types/playMidi';
import type { PlayAudioEngine } from '../types/playAudioEngine';
import type { ArrNote, PlayArrangement } from '../types/playArrangement';
import { FN_EFFECTS } from '../play/kit/finish.js';
import { effectFromGraph, type EffectGraph } from '../play/lookGraph';
import { gpPreset } from '../play/kit/gpuParticles.js';
import { MASK_DEFAULTS, MASK_PROP_KEYS, maskKey, type DrumPadLayer, type MaskOp, type MaskProp, type MaskShape } from '../types/playLayers';
import type { DpSynth } from '../play/kit/drumPads.js';
import { agPresetLayer } from '../play/kit/agents.js';
import { HAND_EX, handBeatNodes } from './agentPlayExample';
import { FOLLOW_HAND_ANCHOR } from '../play/followHand';
import type { GroupColour, LayerGroup } from '../types/layerGroups';

// ── Record helpers ───────────────────────────────────────────────────────────

function layer<K extends PlayLayerKind>(kind: K, id: string, label: string, over: Partial<Extract<PlayLayer, { kind: K }>> = {}): PlayLayer {
  return { ...defaultLayer(kind, id, label), ...over } as PlayLayer;
}
/** The layer with a mask of its own added (its numbers as the parser keeps them: every one, defaults filled in). */
function masked(l: PlayLayer, id: string, shape: MaskShape, nums: Partial<Record<MaskProp, number>>, o: { op?: MaskOp; invert?: boolean; points?: number[] } = {}): PlayLayer {
  const out = { ...l, masks: [...(l.masks ?? []), { id, shape, points: o.points ?? [], op: o.op ?? 'add', invert: o.invert ?? false }] } as Record<string, unknown>;
  for (const k of MASK_PROP_KEYS) out[maskKey(id, k)] = nums[k] ?? MASK_DEFAULTS[k];
  return out as unknown as PlayLayer;
}
/**
 * A Script layer holding `code`: the sliders, toggles and buttons it declares
 * are read from the code the way Apply reads them, and each starts at its
 * declared value (or `values`).
 */
export function scriptLayer(id: string, label: string, code: string, over: { mode?: '2d' | '3d'; clear?: boolean; readPicture?: boolean; blend?: string; opacity?: number; toShader?: boolean; values?: Record<string, number>; files?: { name: string; code: string }[]; p5?: true } = {}): PlayLayer {
  const { values = {}, files, ...rest } = over;
  const r = extractScriptParams(code, files);
  if (!r.ok) throw new Error(`playExamples: script ${id}: ${r.error}`);
  const base = Object.fromEntries(Object.entries(defaultLayer('script', id, label)).filter(([k]) => !k.startsWith('p_')));
  // Other tabs only when there are some (the parser leaves an empty list out).
  const out: Record<string, unknown> = { ...base, code, ...(files?.length ? { files: files.map(f => ({ name: f.name, code: f.code })) } : {}), paramDefs: r.defs, ...rest };
  for (const d of r.defs) if (d.kind !== 'button') out[`p_${d.key}`] = values[d.key] ?? d.value;
  return out as unknown as PlayLayer;
}
/** A Script layer holding an imported p5 project (p5ExampleSketches.ts): its tabs, its mode, and each control where the import started it. */
function p5Layer(id: string, key: string): PlayLayer {
  const sk = P5_EXAMPLE_SKETCHES[key];
  return scriptLayer(id, sk.label, sk.code, { files: sk.files, mode: sk.mode, p5: true, clear: false, values: sk.startAt });
}
export const ctl = (id: string, target: string, label: string, min: number, max: number, step?: number): PlayControl =>
  ({ id, target, kind: 'float', label, min, max, ...(step ? { step } : {}) });
const colourCtl = (id: string, target: string, label: string): PlayControl => ({ id, target, kind: 'color', label, min: 0, max: 1 });
const map = (id: string, controlId: string, source: PlaySource, outMin: number, outMax: number, opts: Partial<PlayMapping> = {}): PlayMapping =>
  ({ id, controlId, source, outMin, outMax, curve: 'linear', smoothMs: 0, enabled: true, ...opts });

/** An Increment (docs/increment-mapping.md): the defaults with these settings. */
const inc = (o: Partial<PlayIncrement>): PlayIncrement => ({ ...defaultIncrement(), ...o });
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
  /** A hand source: the right hand, index tip X unless `o` says otherwise. */
  hand: (read: HandRead, o: { side?: HandSide; point?: number; axis?: 'x' | 'y' | 'z'; gesture?: HandGesture }): PlaySource => ({
    kind: 'hand', side: o.side ?? 'right', read, point: o.point ?? 8, axis: o.axis ?? 'x', gesture: o.gesture ?? 'fist',
  }),
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
  hand: (side: HandSide, gesture: HandGesture): TriggerSpec => ({ on: 'hand', side, gesture }),
  /** A and B (layer ids, or handAnchor refs) closer than `distance` picture heights. */
  near: (a: string, b: string, distance: number, margin = 0.03): TriggerSpec => ({ on: 'proximity', a, b, when: 'closer', distance, margin }),
  /** An audio reader going above `threshold`, letting go `hysteresis` below it. */
  reader: (readerId: string, threshold: number, hysteresis = 0.1): TriggerSpec => ({ on: 'reader', readerId, threshold, hysteresis }),
};
/** An audio reader: a dot on the spectrum at `hz`, `width` octaves wide. */
const reader = (id: string, name: string, hz: number, width: number, gain: number, attack: number, release: number, colour: [number, number, number]): AudioReader =>
  ({ id, name, hz, width, gain, attack, release, colour });
/** The same trigger, firing by a mode other than Once. */
const firing = (t: TriggerSpec, fire: FireSpec): TriggerSpec => ({ ...t, fire });
const act = (id: string, trigger: TriggerSpec, kind: ActionKind, layerId: string, amount = 1): PlayAction => ({ id, trigger, do: kind, layerId, amount, enabled: true });
/** A Drum pad layer of generated drums: pad i plays `synth` with its own settings (numbers are layer properties). */
function drumKit(id: string, label: string, pads: Array<[DpSynth, { name?: string; choke?: number; mode?: 'oneshot' | 'gate'; loop?: boolean; reverse?: boolean; pitch?: number; start?: number; end?: number }]>): PlayLayer {
  const l = defaultLayer('drumpad', id, label) as DrumPadLayer & Record<string, unknown>;
  pads.forEach(([synth, o], i) => {
    l.pads[i] = { ...l.pads[i], synth, name: o.name ?? '', choke: o.choke ?? 0, mode: o.mode ?? 'oneshot', loop: o.loop ?? false, reverse: o.reverse ?? false };
    for (const k of ['pitch', 'start', 'end'] as const) if (o[k] !== undefined) l[`pad${i + 1}_${k}`] = o[k];
  });
  return l;
}
/** A Relationship layer with `members` and its settings on top of the defaults. */
function relationship(id: string, label: string, members: RelationMember[], over: Partial<RelationshipLayer> & Record<string, unknown>): PlayLayer {
  return { ...defaultLayer('relationship', id, label), members, ...over } as PlayLayer;
}
/**
 * An Agents layer set up from a preset (agents.js AG_PRESETS), with `over` on top. The default
 * layer's own rule numbers that the preset doesn't use are left out, as the parser would.
 */
function agentsLayer(id: string, label: string, preset: string, over: Record<string, unknown> = {}): PlayLayer {
  const base = defaultLayer('agents', id, label);
  const out: Record<string, unknown> = { ...base, ...agPresetLayer(preset, base), ...over };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as PlayLayer;
}
/** A member of a relationship at its defaults. */
const rm = (id: string, role: RelationRole = 'member'): RelationMember => newRelationMember(id, role);
/** A layer group (organisation in the Layers list: its layers must sit next to each other in `layers`). */
const grp = (id: string, label: string, colour: GroupColour, layers: string[]): LayerGroup => ({ id, label, colour, layers });

export function play(p: { layers?: PlayLayer[]; groups?: LayerGroup[]; controls?: PlayControl[]; mappings?: PlayMapping[]; actions?: PlayAction[]; display?: PlayDisplay; takes?: PlayTake[]; audioReaders?: PlayAudioReaders; finish?: PlayFinish; audioFx?: PlayAudioFx; padGrid?: PlayPadGrid; signals?: PlaySignal[]; pairs?: PlayPair[]; pairMappings?: PlayPairMapping[]; audioEngine?: PlayAudioEngine; arrangement?: PlayArrangement; notes: string }): PlayRecord {
  const out: PlayRecord = { version: 1, controls: p.controls ?? [], mappings: p.mappings ?? [], layers: p.layers ?? [] };
  if (p.audioEngine) out.audioEngine = p.audioEngine;
  if (p.arrangement) out.arrangement = p.arrangement;
  if (p.groups?.length) out.groups = p.groups;
  if (p.actions?.length) out.actions = p.actions;
  out.notes = p.notes;
  if (p.display) out.display = p.display;
  if (p.takes?.length) out.takes = p.takes;
  if (p.audioReaders) out.audioReaders = p.audioReaders;
  if (p.finish) out.finish = p.finish;
  if (p.audioFx) out.audioFx = p.audioFx;
  if (p.signals?.length) out.signals = p.signals;
  if (p.pairs?.length) out.pairs = p.pairs;
  if (p.pairMappings?.length) out.pairMappings = p.pairMappings;
  if (p.padGrid) out.padGrid = p.padGrid;
  return out;
}
/** A condition on a value (sgParseValueRef paths), as a trigger. */
const when = (value: string, cmp: CondCmp, threshold: number, hysteresis = 0, tolerance = 0.01): TriggerSpec => ({ on: 'value', value, cmp, threshold, hysteresis, tolerance });
/** An action that sends a signal. */
const send = (id: string, trigger: TriggerSpec, signal: string): PlayAction => ({ id, trigger, do: 'signal', layerId: '', amount: 1, enabled: true, signal });
/** One axis of a pair mapping. */
const axis = (outMin: number, outMax: number, o: Partial<PairAxis> = {}): PairAxis => ({ outMin, outMax, curve: 'linear', smoothMs: 0, ...o });
/** A Finish effect at its defaults (every number filled in, as the parser keeps it), with `over` on top. Its id is its kind. */
function fx(kind: FinishKind, over: Partial<FinishEffect> = {}): FinishEffect {
  return { ...newFinishEffect(kind, kind), ...over };
}
/** A Finish effect set from one of its card's presets (FN_EFFECTS[kind].presets), then `over`. */
function fxPreset(kind: FinishKind, preset: string, over: Partial<FinishEffect> = {}): FinishEffect {
  const pr = FN_EFFECTS[kind].presets?.find(x => x.name === preset);
  if (!pr) throw new Error(`no ${kind} preset "${preset}"`);
  return fx(kind, { ...pr.values, ...over });
}
/** An audio effect at its defaults with `over` on top, under `id`. */
function afx(kind: AudioFxKind, id: string, over: Record<string, unknown> = {}): AudioFxEffect {
  return { ...newAudioFxEffect(kind, id), ...over } as AudioFxEffect;
}
/** A grade set to one of the built-in looks, then `over`. */
function lookFx(lookId: string, over: Partial<FinishEffect> = {}): FinishEffect {
  return { ...applyLook(newFinishEffect('grade', 'grade'), GRADE_LOOKS.find(l => l.id === lookId)!), ...over };
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

/**
 * UV → Pad Grid → Circle SDF (one per cell, on the cell's Local position, its
 * radius growing with the cell's Level) → SDF Glow → Tone Map → Output.
 */
function padGridGraph(): GraphNode[] {
  const nodes = glowGraph({ falloff: 26, tint: [0.35, 0.75, 1] });
  const circ = nodes.find(n => n.id === 'circ')!;
  circ.inputs.position.connection = { nodeId: 'pads', outputKey: 'local' };
  circ.inputs.radius.connection = { nodeId: 'pads', outputKey: 'level' };
  circ.params = { ...circ.params, radius: 0, __inExpr_radius: 'max(0.012, input * 0.1)' };
  const pads: GraphNode = {
    id: 'pads', type: 'padGrid', position: { x: 240, y: 200 },
    inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } }, cell: { type: 'vec2', label: 'Cell' } },
    outputs: {
      level: { type: 'float', label: 'Level' }, velocity: { type: 'float', label: 'Velocity' }, pressure: { type: 'float', label: 'Pressure' }, held: { type: 'float', label: 'Held' },
      cellID: { type: 'vec2', label: 'Cell ID' }, local: { type: 'vec2', label: 'Local' }, cellSize: { type: 'vec2', label: 'Cell Size' },
      lastPad: { type: 'vec2', label: 'Last Pad' }, lastVelocity: { type: 'float', label: 'Last Velocity' },
    },
    params: { __comment: 'Each cell of the Play page\'s pad grid: Level grows the circle drawn in that cell.' },
  };
  return [nodes[0], pads, ...nodes.slice(1)];
}

/** The glowing circle with an expression on its Radius that has two knobs, `wob` and `speed` (glsl/inputExpr). */
function exprKnobGraph(): GraphNode[] {
  const nodes = glowGraph({ radius: 0.28, falloff: 12, tint: [0.55, 0.45, 1] });
  const circ = nodes.find(n => n.id === 'circ')!;
  circ.params = {
    ...circ.params,
    __inExpr_radius: 'input * (1.0 + wob * sin(t * speed))',
    __inKnobs_radius: [{ name: 'wob', min: 0, max: 0.5 }, { name: 'speed', min: 0, max: 20 }],
    knob_radius_wob: 0.2,
    knob_radius_speed: 6,
  };
  return nodes;
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
export const quietGraph = () => glowGraph({ radius: 0.05, falloff: 30, tint: [0.25, 0.3, 0.5] });

// A star, as an SVG data URL, for the image example.
const STAR_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><polygon points="100,8 124,74 194,74 138,116 160,186 100,144 40,186 62,116 6,74 76,74" fill="#fff"/></svg>');

// ── A recorded take, built instead of performed ──────────────────────────────

/**
 * An 8-second performance for the recorded-take example: the Lead null flies
 * a figure of eight (the comet and the glow ride it), the radius swells on
 * four hits, each hit presses the comet's Sparkle, and the tint drifts from
 * amber through rose to blue. Sampled at 60 per second and stored the way a
 * recording is (takePlayback's encodeKeys keeps only the keys it needs).
 */
function builtTake(): PlayTake {
  const LENGTH = 8, RATE = 60, HITS = [1.4, 3.1, 4.9, 6.6];
  const times: number[] = [];
  for (let i = 0; i <= LENGTH * RATE; i++) times.push(i / RATE);
  // The path in picture units (0–1 across and up), eased in and out so it starts and ends still.
  const path = times.map(t => {
    const u = (t / LENGTH) * Math.PI * 2;
    const calm = Math.min(1, t / 0.6, (LENGTH - t) / 0.6);
    return { x: 0.5 + calm * 0.3 * Math.sin(u), y: 0.5 + calm * 0.2 * Math.sin(2 * u) };
  });
  const hit = (t: number) => HITS.reduce((a, h) => a + (t < h ? Math.exp(-(((t - h) / 0.05) ** 2)) : Math.exp(-(t - h) / 0.35)), 0);
  const tint = (t: number): number[] => {
    const stops = [[1, 0.55, 0.25], [1, 0.35, 0.55], [0.4, 0.6, 1], [1, 0.55, 0.25]];
    const f = (t / LENGTH) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), k = f - i;
    return stops[i].map((c, j) => c + (stops[i + 1][j] - c) * (k * k * (3 - 2 * k)));
  };
  const track = (kind: TakeTrack['kind'], id: string, label: string, values: number[], o: { target?: string; width?: 1 | 3; step?: boolean } = {}): TakeTrack => ({
    kind, id, label, width: o.width ?? 1, ...(o.target ? { target: o.target } : {}), ...(o.step ? { step: true } : {}),
    keys: encodeKeys(o.step ? [0, LENGTH] : times, values, o.width ?? 1, o.step),
  });
  return {
    id: 'take-figure-eight', name: 'Figure of eight', from: 0, length: LENGTH, seed: 4242,
    tracks: [
      track('control', 'x', 'Glow X', path.map(p => -1.78 + p.x * 3.56), { target: 'circ::posX' }),
      track('control', 'y', 'Glow Y', path.map(p => -1 + p.y * 2), { target: 'circ::posY' }),
      track('control', 'radius', 'Radius (Space)', times.map(t => 0.1 + 0.14 * Math.min(1, hit(t))), { target: 'circ::radius' }),
      track('control', 'tint', 'Tint', times.flatMap(tint), { target: 'glow::tint', width: 3 }),
      track('control', 'null:lead:x', 'Lead x', path.map(p => p.x), { target: 'layer:lead::x' }),
      track('control', 'null:lead:y', 'Lead y', path.map(p => p.y), { target: 'layer:lead::y' }),
      track('pointer', 'x', 'Pointer x', path.map(p => p.x)),
      track('pointer', 'y', 'Pointer y', path.map(p => p.y)),
      track('pointer', 'over', 'Pointer over', [1, 1], { step: true }),
      track('pointer', 'down', 'Pointer down', [0, 0], { step: true }),
    ],
    events: HITS.map(t => ({ t, do: 'script:sparkle' as const, layerId: 'comet', amount: 1 })),
  };
}

type Ex = { key: string; nodes: GraphNode[]; play: PlayRecord };
const ex = (key: string, nodes: GraphNode[], p: PlayRecord): Ex => ({ key, nodes, play: p });

// ── Look effects you build (play/lookGraph.ts, docs/finish-stack.md "Effects from nodes") ──

/**
 * The node-built effect of the lookBuilt example: a duotone blended back over the picture, then a
 * vignette. Each node's `__comment` says what it does; the comments are carried into the code the
 * graph compiles to, above that node's lines.
 */
const DUOTONE_GRAPH: EffectGraph = {
  v: 1,
  nodes: [
    // Picture colour → how bright this point is (0 black … 1 white).
    { id: 'luma', type: 'luminance', x: 250, y: 40, wires: { color: ['in', 'color'] }, params: { __comment: 'How bright the picture is here: 0 is black, 1 is white.' } },
    // That brightness painted from deep violet (dark) to warm cream (bright): a duotone of the picture.
    { id: 'tone', type: 'colorize', x: 500, y: 40, wires: { field: ['luma', 'result'] }, params: { color: [1, 0.8, 0.5], background: [0.12, 0.05, 0.35], gain: 1, __comment: 'Paints the brightness from deep violet (dark) to warm cream (bright): a duotone.' } },
    // The duotone soft-lit over the original picture, so the picture's own colour still shows through. Opacity is mapped to the mouse.
    { id: 'blend', type: 'blendModes', x: 750, y: 40, wires: { base: ['in', 'color'], blend: ['tone', 'color'] }, params: { mode: 'soft_light', opacity: 0.85, strength: 1, __comment: 'Soft-lights the duotone over the picture; Opacity is how much of it shows.' } },
    // Darkens the corners; its UV is the 0..1 point on the picture (from Effect inputs → UV).
    { id: 'vig', type: 'vignette', x: 1000, y: 40, wires: { color: ['blend', 'result'], uv: ['in', 'uv'] }, params: { radius: 0.75, softness: 0.55, strength: 0.7, __comment: 'Darkens the corners of the picture.' } },
    // What the effect gives back to the stack.
    { id: 'out', type: 'fx:out', x: 1250, y: 40, wires: { color: ['vig', 'result'] } },
  ],
};
/** DUOTONE_GRAPH compiled into a Look effect (its code is what renders, in the app and in exports). */
function graphFx(graph: EffectGraph, id: string, name: string): FinishEffect {
  const r = effectFromGraph(graph, { id, name });
  if (!r.effect) throw new Error(`example effect ${id}: ${r.error}`);
  return r.effect;
}
/** The code-built effect of the lookBuilt example, every line explained. */
const WOBBLE_CODE = `// Tape wobble: each band of rows slides sideways a little, like a worn videotape.
// Settings: each uniform below is a slider on the card (min..max = start, then its label | hint).
uniform float amount; // 0..0.05 = 0.012 Amount | How far a band slides, in picture widths
uniform float rows;   // 4..200 = 60 step 1 Bands | How many bands slide on their own
uniform float speed;  // 0..10 = 2.5 Speed | How fast the wobble moves
uniform vec3 tint;    // color = #ffe6cc Tint | Multiplied over the result

vec3 effect(vec2 uv, vec3 color) {
  float band = floor(uv.y * rows);                       // which band this point is in
  float slide = sin(band * 1.7 + time * speed) * amount; // each band its own slide, moving with the clock
  vec3 moved = picture(uv + vec2(slide, 0.0));           // the picture read from that far sideways
  float edge = smoothstep(0.0, 0.004, abs(slide));       // bands that barely move keep the colour so far
  return mix(color, moved, 0.85 * edge) * tint;          // mostly the slid picture, tinted warm
}
`;

// ── The examples, in learning order ──────────────────────────────────────────

// ── Tape material for the Audio engine examples ─────────────────────────────

/** Four bars of eighth notes in A minor pentatonic at 96 BPM (0.3125 s each), with a low root under each bar. */
const PENTATONIC_RIFF: ArrNote[] = (() => {
  const bars = [
    [57, 60, 64, 69, 67, 64, 62, 60],
    [57, 60, 64, 67, 69, 67, 64, 62],
    [62, 64, 67, 69, 72, 69, 67, 64],
    [60, 62, 64, 67, 64, 62, 60, 57],
  ];
  const roots = [45, 45, 50, 48];
  const out: ArrNote[] = [];
  bars.forEach((bar, b) => {
    out.push({ t: b * 2.5, n: roots[b], v: 0.8, d: 2.2 });
    bar.forEach((n, i) => out.push({ t: b * 2.5 + i * 0.3125, n, v: i % 2 ? 0.6 : 0.85, d: 0.28 }));
  });
  return out.sort((a, b) => a.t - b.t);
})();

/** Two bars of four-on-the-floor kicks at 120 BPM, with a ghost kick before each bar's end. */
const KICK_PATTERN: ArrNote[] = [
  ...Array.from({ length: 16 }, (_, i) => ({ t: i * 0.5, n: 36, v: i % 4 === 0 ? 1 : 0.85, d: 0.2 })),
  { t: 3.75, n: 36, v: 0.5, d: 0.15 },
  { t: 7.75, n: 36, v: 0.5, d: 0.15 },
].sort((a, b) => a.t - b.t);

/** A Particles node (Sound field preset) listening to the Audio engine's first track → Output. */
function engineParticlesGraph(): GraphNode[] {
  return [
    {
      id: 'field', type: 'gpuParticles', position: { x: 120, y: 160 },
      inputs: { over: { type: 'vec3', label: 'Over' }, uv: { type: 'vec2', label: 'UV' } },
      outputs: { color: { type: 'vec3', label: 'Color' }, particles: { type: 'vec3', label: 'Particles' }, density: { type: 'float', label: 'Density' } },
      params: {
        ...gpPreset('sound'), sound: 0, handX: 0.35, handY: 0.5, hand2X: 0.65, hand2Y: 0.5, _schemaVersion: 2,
        soundFrom: 'track1', palette: 'ember', brightness: 8, size: 1.6, glow: 1, shock: 1.2,
        __comment: 'The Sound field preset listening to the Play page\'s Audio engine: Sound from is Engine track 1 (the Kick rack). Each kick fires a Shockwave ring; Wave and Vibrate ripple the field with the sound.',
      },
    },
    { id: 'out', type: 'output', position: { x: 560, y: 160 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'field', outputKey: 'color' } } }, outputs: {}, params: {} },
  ];
}

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
  ex('playExprKnob', exprKnobGraph(), play({
    controls: [ctl('wob', 'circ::knob_radius_wob', 'Wobble (knob)', 0, 0.5), ctl('speed', 'circ::knob_radius_speed', 'Speed (knob)', 0, 20)],
    mappings: [map('swell', 'wob', S.lfo('sine', 0.12), 0, 0.35, { smoothMs: 60 })],
    notes: `**What it shows.** A knob is a slider inside an input expression. Circle SDF's Radius has the expression **input * (1.0 + wob * sin(t * speed))**, and wob and speed are its knobs: sliders under the expression on the card, and Play controls here.

**How it's built.** In the Studio, the ƒ chip on Radius opens the expression. Typing a new name offers "Make it a knob"; "Add a knob" puts one in at the cursor. On the Play page, Wobble has a slow LFO mapped onto it, so the wobble swells and fades; Speed is free.

**Try this.**
• Drag Speed: the wobble quickens with no recompile (a knob is a uniform).
• Map Mouse X onto Speed, or a MIDI knob onto Wobble.
• In the Studio, right-click a knob's slider for Play, or ◆ to keyframe it.`,
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
  ex('playAudioReaders', glowGraph({ radius: 0.12, falloff: 14, tint: [0.3, 0.55, 1] }), play({
    audioReaders: {
      input: '',
      readers: [
        reader('kick', 'Kick', 60, 0.5, 25, 2, 160, [1, 0.45, 0.4]),
        reader('hat', 'Hi-hat', 8000, 1, 50, 1, 60, [0.35, 0.82, 0.98]),
        reader('voice', 'Voice', 700, 1.5, 28, 40, 300, [0.62, 0.52, 1]),
      ],
    },
    layers: [
      layer('null', 'centre', 'Centre', { x: 0.5, y: 0.5, size: 10, visible: false }),
      layer('particles', 'sparks', 'Sparks', { count: 900, emit: 'burst', spawn: 'null', nullId: 'centre', spawnRadius: 0.05, field: 'noise', noiseScale: 2, speed: 1.3, life: 0.9, fade: 0.7, size: 2.4, sizeJitter: 0.6, colour: 'palette', palette: 1, paletteBy: 'age', trail: 0.5, blend: 'screen' }),
    ],
    controls: [ctl('radius', 'circ::radius', 'Pulse (kick)', 0.05, 0.4), colourCtl('tint', 'glow::tint', 'Colour (voice)')],
    mappings: [
      map('pulse', 'radius', { kind: 'reader', readerId: 'kick' }, 0.08, 0.24, { smoothMs: 20 }),
      map('colour', 'tint', { kind: 'reader', readerId: 'voice' }, 0.25, 1, { channel: 0, smoothMs: 60 }),
    ],
    actions: [act('hats', T.reader('hat', 0.55, 0.2), 'burst', 'sparks', 36)],
    notes: `**What it shows.** Audio readers are dots you place on the live spectrum. Each reads the loudness of one frequency band as 0–1, so you can pick out one instrument: a kick near 60 Hz, hi-hats near 8 kHz, a voice in between. Each reader is a source and a trigger.

**How it's built.** Three readers (open them with **Spectrum**, in any Live audio mapping or on the Live audio chip):
• **Kick**, 60 Hz, half an octave wide: drives the glow's Pulse.
• **Voice**, 700 Hz, an octave and a half wide, slow to rise and fall: pushes the colour's red channel, from blue toward pink.
• **Hi-hat**, 8 kHz: an action bursts sparks each time it crosses 0.55 (**On: Audio reader crosses**).

**Try this.**
• Open **Spectrum** and press **Play test loop** (no mic needed), or **Listen** and play any music.
• Drag a dot sideways to retune it, up or down to change how loud reads as full. Watch its column fill.
• Click the spectrum to add a reader, then pick it as a mapping's source (**Reader · name**).
• On a mapping, press Learn (✦) and play a sound: it picks the band or reader that moved most.`,
  })),
  ex('playPadGrid', padGridGraph(), play({
    padGrid: { ...DEFAULT_PAD_GRID, mode: 'hold', release: 0.6 },
    controls: [ctl('tight', 'glow::brightness', 'Glow tightness (pad velocity)', 8, 40)],
    mappings: [map('vel', 'tight', { kind: 'pad', read: 'velocity', col: 0, row: 0 }, 34, 16, { smoothMs: 60 })],
    notes: `**What it shows.** A grid controller as a grid shader: hitting a pad lights and grows the matching cell. Without a controller, click the cells in the **Pad grid** card (under the mappings).

**How it's built.** The Play page's **Pad grid** reads a Push (notes 36–99) or Launchpad's pads as columns and rows, lines them up with the shader's 8 × 8 cells, and keeps a level per cell (Hold: lit while held, then fading over Release). The graph's **Pad Grid** node reads that level for the cell under each pixel and its Local position, so one Circle SDF draws every cell. A **Pad grid** mapping source reads the last hit's velocity.

**Try this.**
• Plug in a Push 2/3 (User mode) or a Launchpad (programmer mode) and pick it under Pads, or press **Learn the grid** and tap the bottom-left, then the top-right pad.
• Switch A hit to **Latch** to toggle cells, or **Decay** for flashes.
• Set Cells to 16 × 16 and Scale to 2: each pad lights a 2 × 2 block.`,
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
  ex('playProximity', glowGraph({ radius: 0.08, falloff: 14, tint: [1, 0.6, 0.3] }), play({
    layers: [
      layer('null', 'target', 'Target', { x: 0.5, y: 0.5, size: 12, color: '#ffb86b' }),
      layer('null', 'cursor', 'Cursor', { x: 0.25, y: 0.5, follow: 'mouse', spring: 0.6, wobble: 0.25 }),
      layer('particles', 'pop', 'Pop', { count: 1200, emit: 'burst', spawn: 'null', nullId: 'target', spawnRadius: 0.02, field: 'none', speed: 1.4, life: 1.1, fade: 0.6, size: 2.4, sizeJitter: 0.6, colour: 'palette', palette: 3, paletteBy: 'age', trail: 0.4, blend: 'screen' }),
      layer('particles', 'sparks', 'Sparks', { count: 900, emit: 'burst', spawn: 'null', nullId: 'cursor', spawnRadius: 0.01, field: 'noise', noiseScale: 2, speed: 0.35, life: 0.7, fade: 0.8, size: 1.6, colour: 'palette', palette: 1, paletteBy: 'age', trail: 0.6, blend: 'screen' }),
    ],
    controls: [ctl('radius', 'circ::radius', 'Radius (closeness)', 0.04, 0.3)],
    mappings: [map('close', 'radius', S.sensor('cursor', 'distance', 'target'), 0.3, 0.04, { smoothMs: 80 })],
    actions: [
      act('pop', T.near('cursor', 'target', 0.18), 'burst', 'pop', 220),
      act('trail', firing(T.near('cursor', 'target', 0.18), { mode: 'every', every: 3, unit: 'frames' }), 'burst', 'sparks', 6),
    ],
    notes: `**What it shows.** **On: Proximity** is a trigger that fires when two things come close: nulls, shapes, text, images, particles, a Script layer, a fingertip. With a **firing mode** a trigger can fire once or keep firing while it lasts.

**How it's built.** Cursor follows the mouse on a spring; Target sits in the middle of the glow. Both actions use Proximity, Cursor closer than 0.18 to Target:
• **Once** bursts 220 particles from Target as you arrive.
• **Every 3 frames** bursts 6 sparks from Cursor for as long as you stay, so it leaves a trail.
The glow's Radius reads the same distance as a sensor (Layer sensor → Cursor → Distance to Target).

**Try this.**
• Move the mouse onto the glow, circle inside it, then leave.
• In Layers → Actions, open the Proximity trigger: the meter shows the distance now, and the shaded part is where it fires.
• Set the sparks' Fires to **Continuously**, or to **Every 0.1 sec**.
• Change Once to **On exit**: the burst comes when you leave.`,
  })),
  ex('playConditions', glowGraph({ radius: 0.08, falloff: 10, tint: [0.4, 0.75, 1] }), play({
    layers: [
      layer('null', 'goal', 'Goal', { x: 0.78, y: 0.5, size: 14, color: '#7cd4ff' }),
      layer('null', 'cursor', 'Cursor', { x: 0.25, y: 0.5, follow: 'mouse', spring: 0.7, wobble: 0.2 }),
      layer('particles', 'pop', 'Pop', { count: 1200, emit: 'burst', spawn: 'null', nullId: 'goal', spawnRadius: 0.02, field: 'none', speed: 1.3, life: 1.1, fade: 0.6, size: 2.2, sizeJitter: 0.6, colour: 'palette', palette: 3, paletteBy: 'age', trail: 0.4, blend: 'screen' }),
      layer('text', 'words', 'Words', { text: 'REACH THE GOAL\nONE\nTWO\nTHREE\nAGAIN', x: 0.5, y: 0.12, size: 0.06, sequence: true, transition: 'rise' }),
    ],
    controls: [
      ctl('radius', 'circ::radius', 'Radius', 0.04, 0.34),
      colourCtl('tint', 'glow::tint', 'Tint (flashes)'),
    ],
    signals: [{ id: 'reached', name: 'Reached' }, { id: 'celebrate', name: 'Celebrate' }],
    mappings: [
      map('size', 'radius', S.mouse('y'), 0.04, 0.34, { smoothMs: 80 }),
      map('flash', 'tint', S.trig({ on: 'signal', signal: 'celebrate' }, 'envelope', { attack: 10, decay: 350, sustain: 0.35, release: 500 }), 0.35, 1.6),
    ],
    actions: [
      send('near', when('dist:cursor|goal', 'below', 0.1, 0.03), 'reached'),
      send('big', when('ctl:radius', 'crossUp', 0.28, 0.04), 'reached'),
      send('relay', { on: 'signal', signal: 'reached' }, 'celebrate'),
      act('burst', { on: 'signal', signal: 'celebrate' }, 'burst', 'pop', 220),
      act('line', { on: 'signal', signal: 'celebrate' }, 'next', 'words'),
    ],
    notes: `**What it shows.** **When a value…** triggers and **signals**. A trigger can watch any number: a control, a layer's property, a mapping's source, a Finish number, or the distance between two things. An action can **Send a signal** instead of changing a layer, and other actions and mappings fire on it.

**How it's built.**
• Cursor follows the mouse; Goal sits on the right. Action **near**: when the distance Cursor ↔ Goal goes **below** 0.1, send **Reached**.
• Mouse Y drives the Radius. Action **big**: when Radius **crosses up** past 0.28, send **Reached** too.
• **relay**: on Reached, send **Celebrate**. On Celebrate, burst the particles at Goal and step the words; a Trigger mapping on Celebrate flashes the tint.
Signals pass along the chain in the same frame. Each signal fires at most once a frame and a chain stops after 8 links, so a loop can't lock up the page.

**Try this.**
• Move the mouse onto Goal, or up to the top of the picture.
• Open an action's When: the meter shows the value now against the threshold; the lighter strip is the hysteresis it has to pass back through before it can fire again.
• In Layers → Signals press ▶ on Reached: the chain runs without touching anything.
• Record a take: what the chain did is recorded and renders the same every time.`,
  })),
  ex('playPairs', glowGraph({ radius: 0.12, falloff: 9, tint: [1, 0.55, 0.35] }), play({
    controls: [
      ctl('posX', 'circ::posX', 'Circle · X', -0.6, 0.6),
      ctl('posY', 'circ::posY', 'Circle · Y', -0.6, 0.6),
      ctl('radius', 'circ::radius', 'Radius', 0.04, 0.3),
      ctl('falloff', 'glow::brightness', 'Falloff', 3, 24),
      colourCtl('tint', 'glow::tint', 'Tint (flashes on a swap)'),
    ],
    pairs: [
      { id: 'where', label: 'Circle', a: 'posX', b: 'posY', position: true },
      { id: 'look', label: 'Size and glow', a: 'radius', b: 'falloff', position: false },
    ],
    signals: [{ id: 'turn', name: 'Turn' }],
    pairMappings: [
      {
        id: 'walk', pairId: 'where', source: { kind: 'value', source: S.lfo('triangle', 0.12) }, affect: 'a',
        a: axis(-0.5, 0.5, { smoothMs: 60 }), b: axis(-0.5, 0.5, { smoothMs: 60 }),
        swap: { at: 0.4, dir: 'up', backAt: -0.4, backDir: 'down', signal: 'turn', backSignal: 'turn' }, enabled: true,
      },
      {
        id: 'feel', pairId: 'look', source: { kind: 'value', source: S.mouse('y') }, affect: 'both',
        a: axis(0.05, 0.28, { smoothMs: 80 }), b: axis(20, 4, { smoothMs: 80, curve: 'exp', when: { value: 'mouse:x', cmp: 'above', threshold: 0.5, hysteresis: 0.03, tolerance: 0.01 } }), enabled: true,
      },
    ],
    mappings: [map('flash', 'tint', S.trig({ on: 'signal', signal: 'turn' }, 'envelope', { attack: 10, decay: 300, sustain: 0.3, release: 400 }), 0.4, 1.6)],
    notes: `**What it shows.** **Pair controls** and **axis swap**. Two controls can play as one: two sliders, plus an XY pad when they are a position. The shader still sees two plain numbers.

**How it's built.**
• **Circle** pairs X and Y as a position (right-click a slider → **Add as position with Y**). A slow triangle LFO drives it with an **axis swap**: it moves X until X crosses 0.4, then moves Y until Y crosses −0.4 going down, then X again. The axis it leaves holds where it was, so the circle walks a staircase. Each swap sends **Turn**, which flashes the tint.
• **Size and glow** pairs Radius with Falloff (right-click → **Pair with…**). Mouse Y drives both at once, each through its own range and curve. Falloff listens **only while** Mouse X is past the middle, and holds its value otherwise.

**Try this.**
• Drag the dot on the XY pad; the axis a mapping drives is locked while it drives it.
• In Mappings → Pairs, change the walk's source to Mouse X, or its swap thresholds. Press **Start on A** to reset it (rewinding the clock does the same).
• Change the walk to **Position** → Mouse: both axes follow the pointer at once.`,
  })),
  ex('playIncrement', glowGraph({ radius: 0.08, falloff: 10, tint: [0.55, 0.8, 1] }), play({
    controls: [
      ctl('radius', 'circ::radius', 'Radius (steps on the beat)', 0.04, 0.34),
      ctl('posX', 'circ::posX', 'Circle · X (steps on each wrap)', -0.6, 0.6),
      ctl('falloff', 'glow::brightness', 'Falloff (steps on mouse X)', 3, 24),
    ],
    signals: [{ id: 'grow', name: 'Radius.step' }, { id: 'again', name: 'Radius.reset' }],
    mappings: [
      map('beat', 'radius', S.mouse('x'), 0.04, 0.34, { increment: inc({ on: 'repeat', every: 1, unit: 'beats', bpm: 100, step: 0.02, growth: 'compound', factor: 1.5, glideMs: 180, glideCurve: 'out', wrapAfter: 5, wrapBack: 'glide', start: 'value', startValue: 0.05, stepSignal: 'grow', resetSignal: 'again' }) }),
      map('walk', 'posX', S.mouse('x'), -0.5, 0.5, { increment: inc({ on: 'trigger', trigger: { on: 'signal', signal: 'again' }, step: 0.3, limit: 'bounce', glideMs: 500, glideCurve: 'smooth', start: 'value', startValue: 0 }) }),
      map('edge', 'falloff', S.mouse('x'), 4, 22, { increment: inc({ on: 'threshold', threshold: 0.5, hysteresis: 0.1, falling: true, step: 2, growth: 'additive', factor: 1, limit: 'wrap', glideMs: 120, start: 'value', startValue: 8 }) }),
    ],
    notes: `**What it shows.** **Increment** mappings: instead of following its source, a control moves in **steps**, "boom, boom, boom", or with a glide, "smooth, smooth, smooth". A step can grow each time, stop, wrap or bounce at the ends of the range, go back to its start after a number of steps, and send a signal each time.

**How it's built.**
• **Radius** steps on every beat at 100 bpm (**Repeat**). The step **compounds**: 0.02, then × 1.5 each time. After 5 steps it **glides back** to 0.05 and starts growing again. Each step sends **Radius.step**, each wrap-back **Radius.reset**.
• **Circle · X** steps 0.3 each time Radius.reset fires (**Trigger** on a signal), gliding, and **bounces** between −0.5 and 0.5: two increments chained into calculated motion.
• **Falloff** steps when the mouse crosses the middle of the picture (**Threshold** on Mouse X, both ways). The step is **additive** (2, 3, 4…) and **wraps** round its range. The hysteresis stops a hovering mouse from stepping twice.

**Try this.**
• Open Mappings: each row sums itself up in a line, like "+0.02 ×1.5 on beat, wrap 5, glide 180 ms".
• Set Radius's glide to 0: each step jumps instead of sliding.
• Change Circle · X's wrap back to **Ping-pong** after 3 steps.
• Rewind the clock: the steps start over, so a take renders the same every time.`,
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
    notes: `**What it shows.** Background → **Layers only** covers the shader with a backdrop colour, but it keeps rendering underneath. A Reveal matte and particles with **Mask** on show it only where they are.

**Try this.**
• Turn Layers only off (under Background) to see what's underneath.
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
  ex('playVideoSound', glowGraph({ radius: 0.12, falloff: 12, tint: [1, 0.55, 0.3] }), play({
    audioReaders: {
      input: 'video:vid',
      readers: [
        reader('low', 'Low', 80, 1, 25, 5, 180, [1, 0.45, 0.4]),
        reader('high', 'High', 6000, 1.5, 45, 1, 80, [0.35, 0.82, 0.98]),
      ],
    },
    layers: [
      layer('null', 'centre', 'Centre', { x: 0.5, y: 0.5, size: 10, visible: false }),
      layer('video', 'vid', 'Video', { x: 0.74, y: 0.72, scale: 0.4, fit: 'contain', sound: 'play', volume: 0.8, toShader: false }),
      layer('particles', 'sparks', 'Sparks', { count: 700, emit: 'burst', spawn: 'null', nullId: 'centre', spawnRadius: 0.04, field: 'noise', noiseScale: 2, speed: 1.2, life: 0.8, fade: 0.7, size: 2.2, sizeJitter: 0.6, colour: 'palette', palette: 1, paletteBy: 'age', trail: 0.5, blend: 'screen' }),
    ],
    controls: [ctl('radius', 'circ::radius', 'Pulse (low)', 0.05, 0.4), ctl('vol', 'layer:vid::volume', 'Video · Volume', 0, 1)],
    mappings: [map('pulse', 'radius', { kind: 'reader', readerId: 'low' }, 0.08, 0.3, { smoothMs: 30 })],
    actions: [act('highs', T.reader('high', 0.55, 0.2), 'burst', 'sparks', 30)],
    notes: `**What it shows.** A Video layer whose sound drives the picture. With its Sound on, the video's audio goes through the same analysis as the live input and songs, so audio readers can listen to it: pick out the lows, a voice or the hi-hats and map them to anything.

**Start here.** Open **Layers → Video** and press **Pick a video…** (any MP4, WebM or MOV with sound). It plays in the top-right corner, heard through the master volume. No video ships with the example: yours stays in this browser’s library, not in the setup.

**How it's built.** Two readers listen to **Video · Video** (the Audio readers' Listen to):
• **Low**, 80 Hz, an octave wide: drives the glow's Pulse.
• **High**, 6 kHz: an action bursts sparks from the centre each time it crosses 0.55 (**On: Audio reader crosses**).
The layer card's mini spectrum shows the video's sound with the readers' dots; **Audio readers…** opens the full panel.

**Try this.**
• Drag a dot on the mini spectrum to retune it, up or down for how loud reads as full.
• Set Sound to **Listen** to analyse the video without hearing it (it still drives the glow).
• Pause the clock: the video pauses too, and the readers fall silent. ↺ starts both over.
• Turn **Clock** off on the layer to let the video run on its own.`,
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
• Turn Layers only off (under Background) to see what they trace.
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
• Turn Layers only off (under Background).
• Change the particles' field.`,
  })),
  ex('playMultiply', layersGlowGraph({ falloff: 45, tint: [0.3, 0.7, 1] }), play({
    layers: [layer('particles', 'cells', 'Cells', {
      count: 200, emit: 'multiply', spawn: 'center', spawnRadius: 0, field: 'none', edges: 'bounce', seed: 7,
      splitRate: 1.2, splitJitter: 0.35, splitChildren: 1, splitPush: 0.06, multSpread: 0.028, multLife: 'annihilate', multAfter: 'loop',
      pairRadius: 0.25, seekSpeed: 0.12, loopHold: 0,
      goo: true, gooBlend: 2.4, gooThreshold: 0.45, gooSoft: 0.15, size: 9, sizeJitter: 0.3,
      colour: 'tint', color: [0.75, 1, 0.95], opacity: 1, trail: 0, blend: 'normal',
    })],
    controls: [
      ctl('rate', 'layer:cells::splitRate', 'Cells · Split rate', 0.2, 4),
      ctl('blend', 'layer:cells::gooBlend', 'Cells · Goo blend', 1, 5),
      ctl('thresh', 'layer:cells::gooThreshold', 'Cells · Goo threshold', 0.1, 0.9),
    ],
    notes: `**What it shows.** With **Emit: Multiply** a particles layer starts as one particle. Each one buds after about 1 ÷ **Split rate** seconds (with a little **Split jitter**, so it isn't clockwork) until the **Count** is reached: here one cell becomes two hundred in about seven seconds.

**How it's built.** **Goo** draws the particles as metaballs: every particle adds a soft bump to one field, and the field is cut at **Goo threshold**. Touching cells merge into one blob and part with a stretching neck. **Once born: Annihilate** pairs each cell with a random neighbour once the colony is full; the two close in and vanish in a small burst. **When full: Loop** stops the splitting, and when the colony has cleared it grows again from one. The glow is the Layers node: SDF Glow around whatever the layers draw.

**Try this.**
• Once born: **Stay**, and When full: **Hold**, for a colony that just grows.
• Raise Goo blend: cells merge from further apart, with longer necks.
• Buds 3: each split adds three cells, so it fills much faster.
• Turn Goo off to see the particles themselves.`,
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
    groups: [grp('zones', 'Force zones', 'teal', ['wind', 'swirl', 'honey'])],
    controls: [ctl('tilt', 'layer:swirl::tilt', 'Vortex · Tilt', 0, 85, 1)],
    mappings: [map('lean', 'tilt', S.lfo('sine', 0.05), 0, 70)],
    notes: `**What it shows.** Force zones act on particles inside (or near) a shape:
• **Wind** is a steady push in a direction (Wind angle: 0 right, −90 up).
• **Vortex** swirls them around it, within Reach. **Tilt** leans the swirl back like a disc seen from the side: orbits become ellipses, and particles grow on the near side and shrink on the far side.
• **Drag** slows them, like honey.

**How it's built.** A slow LFO leans the vortex between flat (0°) and 70°. The three zones are one group in Layers, **Force zones**: its switch hides them all, and opening its card shows the live Tilt.

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
  ex('playChase', glowGraph({ radius: 0.09, falloff: 10, tint: [0.4, 0.7, 1] }), play({
    layers: [
      layer('shape', 'prey', 'Prey', { shape: 'circle', x: 0.7, y: 0.55, w: 0.07, h: 0.07, action: 'none', fill: [0.5, 0.9, 1], fillOpacity: 0.9, strokeWidth: 0 }),
      layer('null', 'hunter', 'Hunter', { x: 0.2, y: 0.4, size: 12, color: '#ff7a50' }),
      layer('particles', 'pop', 'Pop', { count: 600, emit: 'burst', spawn: 'null', nullId: 'hunter', spawnRadius: 0.02, field: 'none', speed: 1.2, life: 0.9, fade: 0.6, size: 2, colour: 'palette', palette: 3, paletteBy: 'age', trail: 0.3, blend: 'screen' }),
      relationship('chase', 'Chase', [rm('hunter', 'chaser'), rm('prey', 'prey')], { relation: 'chase', speed: 0.55, accel: 2.5, turn: 0.5, sight: 0.55, flee: 0.3, wander: 0.6, wallChaser: 'bounce', wallPrey: 'bounce', respawnAt: 'far', respawnDelay: 1.2, catchRadius: 0.03, onCatch: 'respawn', catchSignal: 'caught', debug: true }),
    ],
    controls: [colourCtl('tint', 'glow::tint', 'Tint (flashes on a catch)'), ctl('radius', 'circ::radius', 'Radius (closing speed)', 0.04, 0.3)],
    signals: [{ id: 'caught', name: 'Caught' }],
    mappings: [
      map('flash', 'tint', S.trig({ on: 'signal', signal: 'caught' }, 'envelope', { attack: 10, decay: 400, sustain: 0.3, release: 600 }), 0.4, 1.8),
      map('closing', 'radius', S.sensor('chase', 'closing'), 0.04, 0.3, { smoothMs: 120 }),
    ],
    actions: [act('burst', { on: 'signal', signal: 'caught' }, 'burst', 'pop', 200)],
    notes: `**What it shows.** A **Relationship** layer moves other layers with a force between them. Here it's a **chase**: Hunter (a null) runs at Prey (a circle) whenever Prey is within its sight, and wanders when it isn't; Prey flees when Hunter comes close. A **catch** (Hunter within the catch radius) sends the **Caught** signal, which flashes the glow and bursts particles; Prey respawns on the far side.

**How it's built.** Layers → Relationship → members: Hunter as the chaser, Prey as the prey. Prey runs a little slower than Hunter, so it gets cornered and caught; it respawns at the far side. The relationship's **Closing** reading (how fast the closest pair is closing in) drives the glow's radius. **Show forces** is on: the dashed rings are the sight and flee distances, the orange line runs from the chaser to its target, white arrows are velocities.

**Try this.**
• Drag Prey somewhere: the chase starts again from there.
• Turn Sight down until Hunter can't see Prey: it wanders until Prey strays close.
• Set Prey's wall to **Escape**: it may run off the picture (out of sight, so Hunter wanders) and comes back after the delay on the far side.
• Set Then to **Swap roles**: the caught becomes the catcher.
• Map Gap, Chase speed or In sight (in the Readings section) onto anything.`,
  })),
  ex('playOrbit', glowGraph({ radius: 0.16, posX: 0.35, posY: 0.2, falloff: 8, tint: [1, 0.7, 0.4] }), play({
    layers: [
      layer('shape', 'sun', 'Sun', { shape: 'circle', x: 0.5, y: 0.5, w: 0.1, h: 0.1, action: 'none', fill: [1, 0.85, 0.5], fillOpacity: 0.95, strokeWidth: 0 }),
      layer('shape', 'p1', 'Rock', { shape: 'circle', x: 0.25, y: 0.5, w: 0.05, h: 0.05, action: 'none', fill: [0.6, 0.85, 1], fillOpacity: 0.9, strokeWidth: 0 }),
      layer('shape', 'p2', 'Ice', { shape: 'circle', x: 0.75, y: 0.5, w: 0.04, h: 0.04, action: 'none', fill: [0.8, 0.7, 1], fillOpacity: 0.9, strokeWidth: 0 }),
      layer('shape', 'p3', 'Dust', { shape: 'box', x: 0.5, y: 0.82, w: 0.035, h: 0.035, round: 0.3, action: 'none', fill: [0.7, 1, 0.8], fillOpacity: 0.9, strokeWidth: 0 }),
      relationship('orbit', 'Orbit', [
        { ...rm('sun'), mass: 6 },
        { ...rm('p1'), picture: 'climb', channel: 'brightness', radius: 0.08 },
        { ...rm('p2'), picture: 'climb', channel: 'brightness', radius: 0.08 },
        { ...rm('p3'), mass: 0.5, picture: 'climb', channel: 'brightness', radius: 0.08 },
      ], { relation: 'attract', attractMode: 'overshoot', strength: 1.2, falloff: 0.7, damping: 0.02, bounciness: 0.6, maxSpeed: 1.2, wallMember: 'bounce', debug: false, m2_picture: 0.4, m3_picture: 0.4, m4_picture: 0.8 }),
    ],
    controls: [ctl('bright', 'glow::brightness', 'Glow (closing speed)', 3, 16), ctl('strength', 'layer:orbit::strength', 'Pull', 0, 3), ctl('climb', 'layer:orbit::m4_picture', 'Dust climbs the glow', 0, 3)],
    mappings: [map('closing', 'bright', S.sensor('orbit', 'closing'), 16, 4, { smoothMs: 100 })],
    notes: `**What it shows.** **Attract** with **overshoot**: a gravity-like pull that members can fall through, so they orbit instead of sticking. Sun is heavy (mass 6) and barely moves; the three small members swing round it. The relationship's **Closing** reading (how fast the closest pair is closing in) drives the glow's brightness.

**Picture forces.** Each member can also react to the **picture** under it, on top of the relationship: Rock, Ice and Dust **climb** brightness, so they drift toward the glow at the upper left (a shader is a landscape to them). **Looks** is how far around them they sample; the gradient over that ring is the direction they take. The strength is a mapping target per member (Dust's is on the panel).

**Try this.**
• Turn **Pull** down to 0: only the glow pulls them now. Turn it up: tight fast orbits.
• Move the glow (its Center in the graph) and watch them follow.
• Switch Mode to **Keep a distance**: they can't cross the boundary and bounce at it instead.
• Turn on Show forces: the green arrows are the picture's pull, the white ones velocities.`,
  })),
  ex('playBoids', layersGlowGraph({ falloff: 70, tint: [0.35, 0.6, 1] }), play({
    layers: [agentsLayer('flock', 'Flock', 'boids', {
      g1_count: 320, seed: 3, g1_color: [0.8, 0.95, 1],
      rules: [...(agPresetLayer('boids', null)!.rules as unknown[]), { id: 'r7', type: 'flee', on: true, group: 0, targetGroup: 0, mode: '', target: 'pointer', targetId: '', channel: 'brightness', k: 3 }],
      r7_weight: 3, r7_speed: 0.8, r7_radius: 0.18, r7_x: 0.5, r7_y: 0.5,
    })],
    controls: [
      ctl('align', 'layer:flock::r1_weight', 'Align', 0, 3),
      ctl('cohere', 'layer:flock::r2_weight', 'Cohere', 0, 3),
      ctl('separate', 'layer:flock::r3_weight', 'Separate', 0, 4),
      ctl('speed', 'layer:flock::speed', 'Speed', 0, 3),
    ],
    notes: `**What it shows.** An **Agents** layer: 320 agents moved by a stack of rules, the classic **boids**. Each one looks only at its neighbours: **Align** turns it the way they are heading, **Cohere** pulls it toward their middle, **Separate** keeps it from bumping into them. A little **Wander** and a **Max speed** with a minimum keep the flock moving, and **Boundary: Wrap** sends them round the edges. A seventh rule, **Flee** from the pointer, lets you part the flock with the mouse.

**How it's built.** Layers → Agents, preset **Boids**, drawn as arrows coloured by heading, with a short trail. The glow is the Layers node: SDF Glow around whatever the layers draw. Every rule's weight and radius is a normal control: the four on the panel are Align, Cohere, Separate and the simulation's Speed.

**Try this.**
• Turn **Separate** down to 0: the flock collapses into tight knots. Turn **Align** to 0: they stop agreeing where to go.
• Open a rule and raise its **Radius**: they see further and the flock gets bigger and slower to turn.
• Look → Draw: **Goo**, and the flock becomes a liquid.
• Seed: the whole run is seeded. Start over replays exactly the same flight, and a take renders it exactly.`,
  })),
  ex('playPredatorPrey', layersGlowGraph({ falloff: 60, tint: [1, 0.5, 0.35] }), play({
    layers: [agentsLayer('world', 'Predators and prey', 'predatorPrey', { seed: 11, g1_color: [0.55, 0.9, 1], g2_color: [1, 0.4, 0.3] })],
    controls: [
      ctl('flee', 'layer:world::r4_weight', 'Prey · Flee', 0, 6),
      ctl('hunt', 'layer:world::r6_speed', 'Predators · Speed', 0, 1.5),
      ctl('drain', 'layer:world::g2_drain', 'Predators · Energy drain', 0, 0.5),
      ctl('respawn', 'layer:world::g1_respawn', 'Prey · Respawn', 0, 20),
      colourCtl('tint', 'glow::tint', 'Tint (flashes on a catch)'),
    ],
    mappings: [map('flash', 'tint', S.sensor('world', 'catch'), 0.6, 1.8, { smoothMs: 60 })],
    notes: `**What it shows.** Two **groups** in one Agents layer. The prey (blue, group 1) flock like boids and **flee** any predator within reach. The predators (red, group 2) **seek** the nearest prey and **catch** it when they touch: the prey dies and the predator gains **energy**. Predators lose energy all the time (**Energy drain**), so one that stops catching starves; prey and predators **respawn** at a rate of their own. Every catch flashes the glow through the layer's **Catch** reading.

**How it's built.** Layers → Agents, preset **Predator–prey**. Rules can apply to one group and look at another: the prey's Align and Cohere count only prey, their Separate counts everyone, their Flee targets group 2; the predators' Seek targets group 1, and their Catch rule catches group 1. **Boundary: Steer away** keeps everyone inside the picture.

**Try this.**
• Raise **Predators · Speed** past the prey's top speed (0.45): the prey can't outrun them and the flock thins.
• Raise **Energy drain**: predators starve between catches and blink out, then respawn.
• Set **Prey · Respawn** to 0: once eaten, prey stay eaten.
• Map the layer's **Group 1 alive** or **Catches** reading onto anything.`,
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
    groups: [grp('triggers', 'Triggers', 'peach', ['button', 'pad', 'bucket']), grp('effects', 'Effects', 'sky', ['fx', 'sand', 'drain'])],
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

**How it's built.** Clicking the circle bursts sparks. Hovering the square steps the message. Sand pulled into the bucket fills it, and when full it scatters. In Layers, the three shapes sit in a group, **Triggers**, and what they set off in another, **Effects**: open one to see its layers.

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

  // ─ Scripts ─
  ex('scriptFirst', glowGraph({ radius: 0.08, falloff: 14, tint: [0.35, 0.55, 1] }), play({
    layers: [scriptLayer('ring', 'Ring', SKETCH_FIRST)],
    controls: [ctl('count', 'layer:ring::p_count', 'Ring · Dots', 3, 60, 1), ctl('size', 'layer:ring::p_radius', 'Ring · Ring size', 0.05, 0.48), ctl('spin', 'layer:ring::p_spin', 'Ring · Spin', -2, 2)],
    notes: `**What it shows.** A **Script** layer is a small JavaScript sketch drawn over the shader: \`setup(s)\` runs once, \`draw(s)\` every frame, on a canvas the size of the picture (\`s.ctx\`). Every entry in \`params\` becomes a slider on the layer.

**How it's built.** The glow is an ordinary graph. The ring is the Ring layer's code: \`s.state.angle\` keeps the spin between frames, \`dt\` makes it frame-rate proof, and sizes are fractions of \`height\`. Three of its sliders were made Play controls with the + in Layers.

**Try this.**
• Drag Dots, Ring size and Spin.
• Layers → Ring → **Open editor**: change the \`hsl(…)\` line and press ⌘/Ctrl+Enter.
• Map an LFO onto Ring size: the sketch breathes on its own.`,
  })),
  ex('script3D', glowGraph({ radius: 0.2, falloff: 5, tint: [0.25, 0.45, 1] }), play({
    layers: [scriptLayer('solid', 'Solid', SKETCH_3D)],
    controls: [ctl('shape', 'layer:solid::p_shape', 'Solid · Shape', 0, 2, 1), ctl('size', 'layer:solid::p_size', 'Solid · Size', 0.1, 0.6), ctl('spin', 'layer:solid::p_spin', 'Solid · Spin', -2, 2), ctl('hue', 'layer:solid::p_hue', 'Solid · Hue', 0, 360, 1)],
    notes: `**What it shows.** 3D in a Script layer, on its plain 2D canvas: a lit torus, ball or cube turning in front of the SDF Glow shader, which is the background. No WebGL and no library: the sketch does the 3D itself.

**How it's built.** Four steps every frame. **Turn** each point of the mesh (a rotation around y, then x). **Project** it: divide by depth, so far points shrink (Lens sets how strongly). **Hide** faces that point away from the camera. **Sort** the rest far to near and paint them in that order, each shaded by how much it faces the light. It's the painter's algorithm, which is how Processing drew 3D before WebGL. The glow behind is an ordinary graph: UV → Circle SDF → SDF Glow → Tone Map.

**Try this.**
• Drag on the picture to throw the shape; it keeps its spin.
• Shape: 0 is a torus, 1 a ball, 2 a cube. Turn on Wireframe to see every face, the back ones too.
• Lower Lens for a wide-angle look; map an LFO onto Hue.
• In the editor, change the \`light\` direction, or add your own mesh function.`,
  })),
  ex('script3DShapes', glowGraph({ radius: 0.12, falloff: 7, tint: [0.3, 0.5, 1] }), play({
    layers: [scriptLayer('shapes', 'Shapes', SKETCH_3D_SHAPES, { mode: '3d' })],
    controls: [ctl('count', 'layer:shapes::p_count', 'Shapes · Shapes', 1, 16, 1), ctl('size', 'layer:shapes::p_size', 'Shapes · Size', 0.03, 0.2), ctl('spin', 'layer:shapes::p_spin', 'Shapes · Spin', -2, 2)],
    notes: `**What it shows.** A **3D Script** layer: the same setup and draw as any Script layer, but its Mode is 3D, so it draws with WebGL. p5's 3D names work as plain names (\`box\`, \`sphere\`, \`torus\`, \`cone\`, lights, \`orbitControl\`), with three.js underneath. The layer starts clear every frame, so the SDF Glow shader is the background.

**How it's built.** Each shape is \`push()\`, a \`translate\` round a ring, two turns, a colour and a shape, then \`pop()\`. Three lights shade them: a dim ambient, a warm directional from the top left and a blue point light where the glow is. Shapes of the same kind and look are drawn together as one instanced mesh, so hundreds stay fast. The layer is composited like any other: Opacity, Blend, the Layers node and the Cloner all see it.

**Try this.**
• Drag on the picture to orbit the camera.
• Turn Shiny off for matte shapes; raise Shapes and Size.
• In the editor, swap \`fill(…)\` for \`normalMaterial()\`, or add \`background(10)\` to see what the layer covers.
• Patterns → 3D has a grid of boxes, orbiting spheres, particles and a terrain.`,
  })),
  ex('script3DTexture', fbmGraph({ scale: 2.5, timeScale: 0.08 }), play({
    layers: [scriptLayer('cube', 'Cube', SKETCH_3D_TEXTURE, { mode: '3d' })],
    controls: [ctl('size', 'layer:cube::p_size', 'Cube · Size', 0.1, 0.8), ctl('spin', 'layer:cube::p_spin', 'Cube · Spin', -2, 2), ctl('tilt', 'layer:cube::p_tilt', 'Cube · Tilt', -1.5, 1.5)],
    notes: `**What it shows.** \`s.picture.texture\` is the picture under a 3D Script layer, this frame, as a texture. \`texture(s.picture.texture)\` skins the next shapes with it, so the cube wears the live shader it floats over.

**How it's built.** The picture is an ordinary graph: FBM noise through a palette. The layer turns a box and calls \`texture\` before it. An ambient and a directional light shade the faces so the cube reads against the same picture behind it; without lights the texture shows flat, at full brightness. The picture is copied to the GPU only on frames that read it.

**Try this.**
• Drag on the picture to orbit; Tilt and Spin turn the cube.
• Open the Studio and change the palette: the cube changes with it.
• In the editor, draw \`sphere(…)\` or \`plane(…)\` after \`texture\`, or take the lights out to see it flat.`,
  })),
  ex('scriptMouse', glowGraph({ radius: 0.04, falloff: 30, tint: [0.3, 0.35, 0.6] }), play({
    layers: [scriptLayer('chain', 'Chain', SKETCH_MOUSE)],
    controls: [ctl('len', 'layer:chain::p_length', 'Chain · Length', 5, 120, 1), ctl('follow', 'layer:chain::p_follow', 'Chain · Follow', 0.02, 0.6)],
    notes: `**What it shows.** \`s.mouse\` is the pointer over the picture in pixels: \`x\`, \`y\` (y down, like any canvas), \`over\` (is it on the picture) and \`down\` (is the button held).

**How it's built.** The head eases toward the mouse, and the sketch keeps a list of where it has been: each bead sits where the head was a few frames ago, so the chain follows its path. \`ease(k, dt)\` turns "a fraction per frame" into the same speed at 30 or 120 frames a second. Away from the picture the head wanders on its own, so it never sits still.

**Try this.**
• Move over the picture; hold the button to swell the beads.
• Lower Follow for a lazier chain.
• In the editor, draw a line from each bead to \`mouse.x, mouse.y\`.`,
  })),
  ex('scriptPicture', fbmGraph({ scale: 1.8, timeScale: 0.06, preset: '6' }), play({
    layers: [scriptLayer('stipple', 'Stipple', SKETCH_PICTURE, { readPicture: true })],
    controls: [ctl('dots', 'layer:stipple::p_count', 'Stipple · Dots', 200, 10000, 100), ctl('contrast', 'layer:stipple::p_contrast', 'Stipple · Contrast', 0.5, 6)],
    display: { picture: false, backdrop: [0.02, 0.02, 0.035] },
    notes: `**What it shows.** \`s.picture.brightness(x, y)\` reads the shader under a pixel, 0 (black) to 1 (white). The layer's **Picture** switch turns it on; the kit samples the shader at 64 × 36 each frame.

**How it's built.** Each dot throws darts: a random spot is kept with a chance equal to its brightness (raised to Contrast), so bright parts collect more dots. Dots live a second or two, then land somewhere new, so the stipple follows the drifting FBM underneath. The picture itself is hidden (Background → Layers only).

**Try this.**
• Turn Layers only off (under Background) to see what is being read.
• Raise Contrast for starker darks; lower it toward 0.5 for an even dust.
• Turn the layer's Picture switch off: every spot reads 0 and the dots scatter evenly.`,
  })),
  ex('scriptNulls', glowGraph({ radius: 0.03, falloff: 30, tint: [0.3, 0.3, 0.55] }), play({
    layers: [
      layer('null', 'a', 'A', { x: 0.2, y: 0.45, color: '#ffb86b' }),
      layer('null', 'b', 'B', { x: 0.8, y: 0.55 }),
      layer('null', 'pull', 'Pull', { x: 0.5, y: 0.75, follow: 'mouse', spring: 0.35, wobble: 0.75, size: 6, color: '#f5c2e7' }),
      scriptLayer('string', 'String', SKETCH_NULLS),
    ],
    controls: [ctl('by', 'layer:b::y', 'B · Y', 0, 1), ctl('bend', 'layer:string::p_bend', 'String · Bend', 0, 2)],
    mappings: [map('sway', 'by', S.lfo('sine', 0.12), 0.3, 0.7)],
    notes: `**What it shows.** \`s.null('A')\` gives the Null layer labelled A (or with id A) in pixels, or \`null\` when there is none. Nulls are the cheap way to give a sketch handles you can drag, map, or let follow the mouse.

**How it's built.** The string is a curve from A to B whose control point is pushed toward Pull, so at Bend 1 it passes through Pull. Pull follows the mouse on a wobbly spring; an LFO sways B up and down through its Y control.

**Try this.**
• Drag A and B; move the mouse to pluck the string.
• Turn Pull's Wobble up to 1 in Layers.
• Rename a null: the sketch looks it up by label, so the string lets go.`,
  })),
  ex('scriptButtons', glowGraph({ radius: 0.08, falloff: 12, tint: [1, 0.45, 0.6] }), play({
    layers: [scriptLayer('rings', 'Rings', SKETCH_BUTTONS)],
    controls: [ctl('radius', 'circ::radius', 'Glow (on the beat)', 0.04, 0.3), ctl('life', 'layer:rings::p_life', 'Rings · Ring life', 0.2, 4)],
    mappings: [map('kick', 'radius', S.trig(T.beat(116, 1), 'envelope', { attack: 5, decay: 260, sustain: 0, release: 80 }), 0.06, 0.2)],
    actions: [act('beat', T.beat(116, 1), 'script:kick', 'rings', 1), act('space', T.key('Space'), 'script:kick', 'rings', 1.6), act('rev', T.key('KeyR'), 'script:reverse', 'rings')],
    notes: `**What it shows.** A sketch can declare **buttons**. \`kick: { kind: 'button' }\` makes one: \`s.pressed('kick')\` is true on the frame it fires and \`s.params.kick\` is the amount. A function in \`params\` (\`reverse(s) { … }\`) is a button that runs itself. Buttons are **actions** on the Play panel, so keys, beats, clicks, notes and shapes can press them.

**How it's built.** Three actions (bottom of the Layers tab): a Beat at 116 BPM presses Kick every beat, Space presses it at 1.6 (bigger rings), R presses Reverse. The glow's radius has a mapping from the same beat, so light and rings land together.

**Try this.**
• Press Space and R.
• Change the beat action's trigger to a MIDI note or an Audio hit.
• Press Kick and Reverse on the layer in Layers.`,
  })),
  ex('scriptParticles', quietGraph(), play({
    layers: [scriptLayer('sparks', 'Fountain', SKETCH_PARTICLES)],
    controls: [ctl('rate', 'layer:sparks::p_rate', 'Fountain · Per second', 0, 1500, 10), ctl('gravity', 'layer:sparks::p_gravity', 'Fountain · Gravity', -1, 3), ctl('spread', 'layer:sparks::p_spread', 'Fountain · Spread', 0, 1.5)],
    notes: `**What it shows.** A particle system is an array of objects and four steps every frame: **spawn**, **move**, **draw**, **die**. The built-in Particles layer does far more, but a sketch is where your own rules go.

**How it's built.** \`owed\` carries fractions of a particle, so Per second is exact at any frame rate. Gravity adds to each velocity; the floor flips it at half speed. Drawing with \`'lighter'\` adds overlapping sparks toward white. The emitter follows the mouse over the picture.

**Try this.**
• Move over the picture; set Gravity below 0 for rising embers.
• In the editor, add \`p.vx += (Math.random() - 0.5) * height * dt;\` in the move step for a flicker.
• Colour by speed instead of age.`,
  })),
  ex('scriptP5', fbmGraph({ scale: 1.4, timeScale: 0.04, preset: '4' }), play({
    layers: [scriptLayer('ridges', 'Ridges', SKETCH_P5)],
    controls: [ctl('rows', 'layer:ridges::p_rows', 'Ridges · Rows', 8, 80, 1), ctl('peak', 'layer:ridges::p_peak', 'Ridges · Peak height', 0, 0.4)],
    mappings: [map('breathe', 'peak', S.lfo('sine', 0.07), 0.08, 0.2)],
    notes: `**What it shows.** Most p5.js sketches run as they are: \`background\`, \`stroke\`, \`fill\`, \`noise\`, \`beginShape\`, \`vertex\`, \`width\`, \`frameCount\` and the rest are built in as plain names. Drop \`createCanvas\`; the canvas is the picture.

**How it's built.** The classic ridge-lines sketch. \`params\` declares Rows and Peak height, and because the sketch also has top-level \`let rows\` and \`let peak\`, the layer writes the slider values into those variables before each draw, so the p5 code never mentions \`s\`. The one other change is \`clear()\` where p5 had \`background(0)\`, so the FBM shows around the ridges; each ridge is filled black, so it hides the ones behind it. An LFO breathes the peaks.

**Try this.**
• Put \`background(0)\` back in place of \`clear()\` to see the sketch alone.
• In the editor, double-click a number (like the 0.02 in \`noise\`), make it a variable, and use **Make it a slider**.
• Paste a p5 sketch of your own and press Apply.`,
  })),
  ex('p5FlowField', quietGraph(), play({
    layers: [p5Layer('flow', 'p5FlowField')],
    controls: [ctl('count', 'layer:flow::p_count', 'Flow field · Count', 100, 3000, 100), ctl('scale', 'layer:flow::p_noiseScale', 'Flow field · Noise scale', 0.001, 0.02, 0.001)],
    mappings: [map('drift', 'scale', S.lfo('sine', 0.03), 0.003, 0.012)],
    display: { picture: true, backdrop: [0.056, 0.064, 0.08], source: 'colour' },
    notes: `**What it shows.** A p5.js project brought in with **Import p5.js sketch…** (Layers → Script): an index.html and a sketch.js, as they would sit on disk. It runs as p5 wrote it: its own 720 × 405 canvas, fitted into the picture, keeping what was drawn between frames.

**How it's built.** The importer read the script order from index.html and left p5 itself out (the layer has it built in). Each DOM control became a declared control: \`createSlider\` → \`control('count')\` plus an entry in \`params\`, the checkbox a toggle, the select a choice. \`.value()\` and \`.checked()\` work as before. Count is only read in setup, so it is marked **restart**: moving it starts the sketch over with that many particles. The background is set to a colour like the sketch's, so the graph is paused. An LFO drifts the noise scale.

**Try this.**
• Drag Count: the sketch starts over each time.
• Turn Trails off on the layer, or pick another Palette.
• In the editor, find \`restart: true\` in params and take it out: Count then does nothing until you press Run.`,
  })),
  ex('p5MultiFile', quietGraph(), play({
    layers: [p5Layer('fountain', 'p5MultiFile')],
    controls: [ctl('gravity', 'layer:fountain::p_gravity', 'Fountain · Gravity', 0, 0.4, 0.01)],
    display: { picture: true, backdrop: [0.07, 0.078, 0.125], source: 'colour' },
    notes: `**What it shows.** A p5 project in three files: \`particle.js\` (a Particle class), \`forces.js\` (gravity, a push from the mouse, bouncing) and \`sketch.js\`. They are three tabs in the editor, and they run in one shared scope, so sketch.js uses the class and functions as if they were written in it.

**How it's built.** Imported with **Import p5.js sketch…**. The other tabs run first, in index.html's order; sketch.js is the main file and always the first tab. \`mousePressed\` and \`keyPressed\` work as in p5: clicking on the picture bursts particles, C clears them. The one slider became a Gravity control.

**Try this.**
• Click on the picture; press C.
• Drag Gravity to 0 and watch the particles float.
• Open the particle.js tab and change the fill: the sketch runs again with it.`,
  })),
  ex('p5Webgl', quietGraph(), play({
    layers: [p5Layer('orbit', 'p5Webgl')],
    controls: [ctl('speed', 'layer:orbit::p_speed', 'Shapes · Speed', 0, 3, 0.1)],
    mappings: [map('pulse', 'speed', S.lfo('sine', 0.05), 0.4, 1.8)],
    display: { picture: true, backdrop: [0.047, 0.055, 0.094], source: 'colour' },
    notes: `**What it shows.** A p5 **WEBGL** sketch: \`createCanvas(600, 600, WEBGL)\` makes the layer a **3D** Script layer, drawn with three.js. \`box\`, \`torus\`, \`sphere\`, \`cone\`, \`cylinder\`, \`normalMaterial\`, \`specularMaterial\`, the lights and \`orbitControl\` work as plain names.

**How it's built.** Imported with **Import p5.js sketch…**, which saw WEBGL and set the layer's Mode to 3D. The speed slider became a control; an LFO swings it. The middle box is coloured by its normals; the four shapes around it are lit by an ambient, a directional and an orange point light.

**Try this.**
• Drag on the picture to orbit (that is \`orbitControl()\`).
• Take the pointLight line out in the editor and see what the orange was.
• Change \`box(110)\` to \`torus(80, 25)\`.`,
  })),
  ex('scriptGlow', layersGlowGraph({ falloff: 60, tint: [0.35, 0.7, 1] }), play({
    layers: [scriptLayer('rose', 'Rose', SKETCH_GLOW)],
    controls: [ctl('falloff', 'glow::brightness', 'Glow falloff', 10, 100), colourCtl('tint', 'glow::tint', 'Glow tint'), ctl('petals', 'layer:rose::p_petals', 'Rose · Petals', 2, 12, 1), ctl('depth', 'layer:rose::p_depth', 'Rose · Depth', 0, 1)],
    mappings: [map('depth', 'depth', S.lfo('sine', 0.05), 0.3, 0.8)],
    notes: `**What it shows.** What a sketch draws can go back into the shader. The **Layers** node gives the graph the layers' colour, alpha and a signed **distance** to them; SDF Glow on that distance turns thin white lines into neon.

**How it's built.** UV → Layers → SDF Glow → Tone Map → Output. The Rose layer draws two rose curves, 2 pixels wide, and has **Seen by the Layers node** on (the default). An LFO sweeps the petals' depth.

**Try this.**
• Drag Glow falloff down for a wide haze, up for a tight tube.
• In the editor, draw a filled circle: the glow hugs its outline.
• Turn "Seen by the Layers node" off on the layer: the lines stay, the glow goes.`,
  })),

  // ─ Backgrounds: an image, a video or a colour instead of the shader ─
  ex('bgColourSketch', glowGraph({ radius: 0.1 }), play({
    layers: [scriptLayer('ink', 'Ink', SKETCH_INK, { clear: false })],
    controls: [ctl('walkers', 'layer:ink::p_count', 'Ink · Walkers', 50, 4000, 10), ctl('swirl', 'layer:ink::p_swirl', 'Ink · Swirl size', 0.5, 8), ctl('fade', 'layer:ink::p_fade', 'Ink · Fade', 0, 0.3), ctl('hue', 'layer:ink::p_hue', 'Ink · Hue', 0, 360, 1)],
    mappings: [map('hueDrift', 'hue', S.lfo('triangle', 0.02), 170, 330)],
    display: { picture: true, backdrop: [0.05, 0.05, 0.08], source: 'colour' },
    notes: `**What it shows.** **Background → Colour**: no shader at all. The graph is paused on this page (the Studio still shows the glow), and the only thing running is a Script layer on a flat colour: a sketch in plain JavaScript, a CPU toy.

**How it's built.** Ink's walkers follow \`noise(x, y, time)\` and draw one short step each frame. "Clear each frame" is off, so the steps pile up; the sketch erases a little of the canvas every frame, which turns them into trails. An LFO drifts the hue.

**Try this.**
• Move over the picture: the walkers part around the pointer.
• Pick another colour next to Background.
• Switch Background to **Shader**: the same ink over the glow, and the graph runs again.`,
  })),
  ex('bgPhotoFlow', glowGraph({ radius: 0.1 }), play({
    layers: [
      layer('particles', 'wind', 'Wind', { count: 1400, field: 'flow', turns: 1, speed: 0.7, size: 1.3, trail: 0.75, colour: 'palette', palette: 3, paletteBy: 'heading', blend: 'screen', detail: 'fine' }),
    ],
    controls: [ctl('turns', 'layer:wind::turns', 'Wind · Turns', 0, 4), ctl('dir', 'layer:wind::angle', 'Wind · Direction', -180, 180, 1), ctl('speed', 'layer:wind::speed', 'Wind · Speed', 0, 2)],
    mappings: [map('turn', 'dir', S.lfo('triangle', 0.015), -60, 60)],
    display: { picture: true, backdrop: [0, 0, 0], source: 'image', image: { name: 'Ridges at dusk.jpg', src: RIDGES_AT_DUSK } },
    notes: `**What it shows.** **Background → Image**: a photo instead of the shader. Everything that reads the picture reads the photo: here a **Flow** particle field turns its brightness into headings, so the particles stream along the ridges and circle the sun.

**How it's built.** The picture is a still (made for this example), kept in the setup, so saves, play files and web pages carry it. The graph is paused on this page. The particles read the photo at 128 × 72 (Detail: fine); an LFO slowly turns the whole field.

**Try this.**
• Drag Turns: at 0 every particle heads the same way; higher, they wrap around the light.
• Background → **Replace** with your own photo, or choose **Video…** for a moving picture (it starts a Background layer).
• Turn **Layers only** on: the photo hides, the particles keep following it.`,
  })),
  // A Background layer: two graphs and a photo in a queue, stepped by keys and a beat, crossfading.
  ex('bgQueue', fbmGraph({ scale: 2.4, timeScale: 0.08, preset: '4' }), play({
    layers: [
      layer('background', 'bg', 'Background', {
        sources: [
          { id: 'clouds', kind: 'graph', name: 'Clouds', graph: 'this' },
          { id: 'rings', kind: 'graph', name: 'Fractal Rings', graph: 'example:fractalRings' },
          { id: 'ridges', kind: 'image', name: 'Ridges at dusk', src: RIDGES_AT_DUSK },
        ],
        transition: 'fade', duration: 1.2,
      }),
      scriptLayer('flies', 'Fireflies', SKETCH_FIREFLIES, { readPicture: true }),
    ],
    controls: [ctl('index', 'layer:bg::index', 'Background · Index', 0, 2, 1), ctl('fade', 'layer:bg::duration', 'Background · Fade (s)', 0, 4), ctl('pull', 'layer:flies::p_pull', 'Fireflies · Pull to light', 0, 3)],
    actions: [
      act('go1', T.key('Digit1'), 'goto', 'bg', 1),
      act('go2', T.key('Digit2'), 'goto', 'bg', 2),
      act('go3', T.key('Digit3'), 'goto', 'bg', 3),
      act('beat', T.beat(96, 8), 'next', 'bg'),
    ],
    notes: `**What it shows.** A **Background layer**: a queue of three sources under everything, one showing at a time. This graph (clouds), the Fractal Rings example and a photo. Press **1**, **2** or **3** to go straight to one; every 8 beats at 96 BPM it moves on by itself. Changes crossfade over 1.2 s.

**How it's built.** The Background layer is the bottom layer. Its sources: **Clouds** is the open graph; **Fractal Rings** is compiled off-screen and drawn as a second shader, only while it shows; the photo is kept in the setup. Four actions do the changing: Go to background 1, 2 and 3 on the number keys, and Next background on a beat. The **Fireflies** Script layer reads the picture (\`s.picture.brightness\`) and climbs toward its light, whichever source is showing.

**Try this.**
• Drag Index on the panel: map a MIDI knob or an LFO onto it instead of keys.
• Set Fade to 0 for hard cuts, or change Transition to Cut on the layer.
• Add a video, a sketch or a colour to the queue (Layers → Background → Add source), and scale or turn the background under Placement.
• Record a take while you press the keys: its render changes at the same frames.`,
  })),

  // ─ Mattes & masks ─
  // A photo matted by a hidden particles layer: the photo shows only where the particles (and their trails) are.
  ex('matteParticles', quietGraph(), play({
    layers: [
      layer('image', 'photo', 'Photo', { src: RIDGES_AT_DUSK, scale: 1.02, toShader: false, trackMatte: { id: 'dust', mode: 'alpha', invert: false } }),
      layer('particles', 'dust', 'Dust', {
        visible: false, toShader: false, count: 1100, field: 'noise', noiseScale: 1.4, noiseEvolve: 0.25, speed: 0.55, steer: 0.35, size: 9, sizeJitter: 0.6,
        trail: 0.94, life: 5, fade: 0.3, spawn: 'anywhere', attractor: 'mouse', force: 'spiral', strength: 0.6, catchRadius: 0, colour: 'tint', color: [1, 1, 1], opacity: 1, flock: 0, seed: 7,
      }),
    ],
    controls: [ctl('size', 'layer:dust::size', 'Dust · Size', 1, 24, 0.5), ctl('trail', 'layer:dust::trail', 'Dust · Trail', 0, 1)],
    notes: `**What it shows.** A **track matte**: the Photo layer shows only where the Dust particles are. The particles themselves are hidden; their trails paint the photo in over the dark shader, and it fades back out as the trails fade.

**How it's built.** Photo → **Matte** → Dust, by **Alpha** (where the matte is solid). Using a layer as a matte hides it, as in After Effects; it keeps running, and its row sits under the Photo with a link. The particles drift on a noise field and spiral round the mouse.

**Try this.**
• Move the mouse over the picture: the dust gathers and the photo follows it.
• Photo → Matte → turn **Invert** on: the photo everywhere except the trails.
• Photo → Matte → **Show it on the picture too** to see the particles doing the work.
• Drag Size and Trail on the panel: big, slow trails reveal most of the photo.`,
  })),
  // Text through a moving window (a hidden Shape matte), over ASCII cut by a feathered mask of its own.
  ex('maskReveal', fbmGraph({ scale: 2.2, timeScale: 0.06, preset: '3' }), play({
    layers: [
      masked(layer('glyphs', 'ascii', 'ASCII', { cell: 11, colour: 'picture', cover: true, background: [0.02, 0.02, 0.04], contrast: 1.4, toShader: false }), 'm1', 'ellipse', { w: 1.1, h: 0.62, feather: 0.12 }),
      layer('text', 'title', 'Title', { text: 'MATTES\nAND MASKS', size: 0.2, weight: 800, color: [1, 0.97, 0.9], toShader: false, trackMatte: { id: 'window', mode: 'alpha', invert: false } }),
      layer('shape', 'window', 'Window', { visible: false, toShader: false, shape: 'circle', x: 0.5, y: 0.5, w: 0.46, h: 0.46, fill: [1, 1, 1], fillOpacity: 1, strokeWidth: 0, action: 'none' }),
    ],
    controls: [ctl('wx', 'layer:window::x', 'Window · X', 0, 1), ctl('feather', 'layer:ascii::mask_m1_feather', 'ASCII · Mask 1 · Feather', 0, 0.3)],
    mappings: [map('sweep', 'wx', S.lfo('sine', 0.12), 0.22, 0.78)],
    notes: `**What it shows.** Two ways to cut a layer. The Title shows only inside the **Window**, a hidden circle that sweeps across (a **track matte**). Under it, the **ASCII** layer has a **mask** of its own: a soft ellipse, so the characters fade out toward the edges.

**How it's built.** Title → **Matte** → **New shape** made the Window, hidden and tucked under the Title in the list; an LFO moves its X. ASCII → **Mask** → Ellipse, with **Feather** 0.12. Mask numbers are layer numbers, so Feather is a control on the panel like any other.

**Try this.**
• Drag Feather on the panel, or open ASCII → Mask 1 and drag its amber handles on the picture.
• Add a second mask to the ASCII (Mask → Rectangle) and set it to **Subtract** to cut a hole.
• Title → Matte → **Luma**, then give the Window a grey fill: the text dims to match.
• Select the Window in the list: its handles work while it is hidden. Make it a Box, or draw a Polygon.`,
  })),
  // A Motion layer watching the picture (or the camera, or a video): its matte reveals a photo, particles are born in it, its readings drive a readout and two rules.
  ex('motionReveal', glowGraph({ radius: 0.16, falloff: 10, tint: [0.45, 0.8, 1], comment: 'The glow that moves: its position orbits (two LFOs) and its radius jumps every few seconds (a square LFO). The Watcher layer sees that movement.' }), play({
    layers: [
      layer('image', 'photo', 'Photo · shows where it moves', { src: RIDGES_AT_DUSK, scale: 1.02, toShader: false, trackMatte: { id: 'watch', mode: 'alpha', invert: false } }),
      layer('motion', 'watch', 'Watcher', { visible: false, readFrom: 'picture', sensitivity: 0.7, delay: 2, smoothing: 0.85, cell: 0.035, show: 'mask', feather: 0.05 }),
      layer('particles', 'sparks', 'Sparks · born where it moves', {
        toShader: false, count: 900, emit: 'burst', spawn: 'motion', motionId: 'watch', life: 1.4, fade: 0.6, field: 'noise', noiseScale: 2, speed: 0.7, size: 2.2, sizeJitter: 0.5,
        colour: 'palette', palette: 2, paletteBy: 'age', trail: 0.55, blend: 'screen', seed: 11,
      }),
      layer('text', 'state', 'Status', { text: 'STILL\nSOMETHING MOVED', sequence: true, interval: 0, transition: 'fade', x: 0.5, y: 0.08, size: 0.04, weight: 700, font: 'mono', color: [1, 0.9, 0.7], toShader: false }),
      layer('text', 'readout', 'Readout · follows the movement', { text: 'movement {v}', reads: 'read:watch::motion', readFormat: 'template', readDecimals: 2, x: 0.5, y: 0.5, size: 0.04, weight: 600, font: 'mono', color: [0.7, 1, 0.9], toShader: false }),
    ],
    controls: [
      ctl('gx', 'circ::posX', 'Glow X (an LFO moves it)', -1.6, 1.6),
      ctl('gy', 'circ::posY', 'Glow Y (an LFO moves it)', -0.9, 0.9),
      ctl('gr', 'circ::radius', 'Glow size (jumps every 4 s)', 0.05, 0.5),
      ctl('sens', 'layer:watch::sensitivity', 'Watcher · Sensitivity', 0, 1),
      ctl('feather', 'layer:watch::feather', 'Watcher · Feather', 0, 0.3),
      ctl('rx', 'layer:readout::x', 'Readout X (Where X)', 0, 1),
      ctl('ry', 'layer:readout::y', 'Readout Y (Where Y)', 0, 1),
    ],
    mappings: [
      map('orbitX', 'gx', S.lfo('sine', 0.13), -1.1, 1.1),
      map('orbitY', 'gy', S.lfo('sine', 0.13, 0.25), -0.55, 0.55),
      map('jump', 'gr', S.lfo('square', 0.125), 0.12, 0.34),
      map('whereX', 'rx', S.sensor('watch', 'moveX'), 0.15, 0.85, { smoothMs: 250 }),
      map('whereY', 'ry', S.sensor('watch', 'moveY'), 0.15, 0.9, { smoothMs: 250 }),
    ],
    signals: [
      { id: 'starts', name: 'Movement starts: sparks burst and the status says so', inputs: [{ kind: 'trigger', trigger: when('read:watch::motion', 'crossUp', 0.2, 0.05) }],
        do: [{ id: 'starts_burst', do: 'burst', layerId: 'sparks', amount: 60, enabled: true }, { id: 'starts_text', do: 'next', layerId: 'state', amount: 1, enabled: true }] },
      { id: 'big', name: 'A big movement (Area past 0.08): a bigger burst', inputs: [{ kind: 'trigger', trigger: when('read:watch::area', 'crossUp', 0.08, 0.02) }],
        do: [{ id: 'big_burst', do: 'burst', layerId: 'sparks', amount: 220, enabled: true }] },
      { id: 'stops', name: 'Movement stops: the status goes back to STILL', inputs: [{ kind: 'trigger', trigger: when('read:watch::motion', 'crossDown', 0.08, 0.03) }],
        do: [{ id: 'stops_text', do: 'reset', layerId: 'state', amount: 1, enabled: true }] },
    ],
    notes: `**What it shows.** A **Motion** layer turns movement into something you can use: a matte, a place particles are born, and readings (how much moves, where, which way) for mappings and rules. Here it watches the **picture**, a glow that orbits and jumps, so it works without a camera. Switch it to your webcam or a video and the same setup follows you.

**Start here.** Layers → **Watcher** → Source → **Camera** (then **Turn on camera**), and wave. Or add a **Video** layer and pick Source → **A layer** → your video (hide the video to use only its movement).

**The layers, bottom to top.**
• **Photo · shows where it moves**: a photo with **Matte → Watcher**: it shows only where the Watcher sees movement, a soft-edged trail behind the glow.
• **Watcher** (Motion, hidden): watches the Picture. Sensitivity 0.7 catches the glow's soft edge; Delay 2 frames; Smoothing 0.85 makes the matte linger like a trail; Cell size 0.035; Feather 0.05 softens the matte's edge. Hidden, it still measures: hiding only stops it drawing.
• **Sparks · born where it moves**: particles with Born → **Where it moves**, In → **Watcher**. They only exist when a rule bursts them, and always inside the movement.
• **Status**: two lines, STILL and SOMETHING MOVED, stepped by the rules.
• **Readout · follows the movement**: a Text layer that reads the Watcher's **Amount** ("movement 0.42"); its X and Y follow **Where X/Y**.

**The controls.** *Glow X / Y / size* are the shader's circle, moved by three LFOs (the thing that moves). *Watcher · Sensitivity* and *Feather* are the Motion layer's own numbers: drag them to see the matte widen or soften. *Readout X / Y* are driven by the Watcher's Where X and Where Y (smoothed 250 ms, kept off the edges), so the words chase the movement.

**The rules.**
• *Movement starts*: Amount crosses up through 0.2 → burst 60 sparks where it moves, and the status steps to SOMETHING MOVED.
• *A big movement*: Area (the share of the grid moving) crosses up through 0.08, which happens when the glow jumps in size → burst 220.
• *Movement stops*: Amount falls under 0.08 → the status goes back to STILL.

**Try this.**
• Photo → Matte → **Invert**: the photo everywhere except where it moves.
• Watcher → Show → **Heat map** and its eye on, to see the grid it measures; or **Movement** for the motion-extract look.
• Rules → Behaviours: *Motion starts*, *Big movement* and *Motion stops* make the same rules for any Motion layer.
• Map **Direction X** (Watcher's readings, under Accepts and emits) onto something: 0.5 is still, 1 rightward, 0 leftward.`,
  })),

  // ─ Hands ─
  ex('handFingertips', quietGraph(), play({
    layers: [
      layer('camera', 'cam', 'Camera', { opacity: 0.22 }),
      layer('null', 'index', 'Index tip', { follow: 'hand', handSide: 'right', handPoint: 8, spring: 0.8, wobble: 0.15, color: '#ffb86b', role: 'emitter', radius: 0.03, strength: 1.2 }),
      layer('null', 'thumb', 'Thumb tip', { follow: 'hand', handSide: 'right', handPoint: 4, spring: 0.8, wobble: 0.15, role: 'absorber', radius: 0.03, strength: 4 }),
      layer('null', 'left', 'Left index', { follow: 'hand', handSide: 'left', handPoint: 8, x: 0.25, spring: 0.6, wobble: 0.3, color: '#7ee0b0', role: 'vortex', radius: 0.08, strength: 1.5 }),
      layer('particles', 'field', 'Field lines', { count: 700, field: 'none', speed: 0.5, steer: 0.2, edges: 'respawn', size: 1.3, trail: 0.85, colour: 'palette', palette: 1, paletteBy: 'age', life: 0, blend: 'screen' }),
    ],
    notes: `**What it shows.** Nulls can follow a tracked hand: a fingertip, a knuckle, the wrist. Whatever reads a null reads it then, so particle roles, sensors, Script layers and mappings all follow your fingers.

**How it's built.** Three nulls set to Follows → **A hand**: Index tip (your right index finger) is an **Emitter**, Thumb tip an **Absorber**, and Left index a **Vortex**. Particles flow from your index finger into your thumb, so pinching squeezes the field lines together. The Camera layer is faint, so you can see your hands under the dots.

**Try this.**
• Press **Enable hand tracking** on the picture (the browser asks for the camera once). Everything runs on this computer.
• Pinch slowly, then spread your fingers.
• Bring your left hand in to stir the particles.
• In Layers, pick another Point for a null (the wrist, the pinky tip), or raise its Wobble.
• Hide the Camera layer: tracking goes on without it.`,
  })),
  ex('handPinch', glowGraph({ radius: 0.2, falloff: 10, tint: [1, 0.55, 0.25] }), play({
    layers: [
      layer('null', 'palm', 'Palm', { follow: 'hand', handSide: 'right', handPoint: 9, spring: 0.7, wobble: 0.2, size: 0 }),
      layer('particles', 'sparks', 'Sparks', { count: 1500, emit: 'burst', spawn: 'null', nullId: 'palm', spawnRadius: 0.03, field: 'none', speed: 1.4, life: 1.1, fade: 0.6, size: 2.2, sizeJitter: 0.6, colour: 'palette', palette: 3, paletteBy: 'age', trail: 0.4, blend: 'screen' }),
    ],
    controls: [
      ctl('radius', 'circ::radius', 'Radius (pinch)', 0.03, 0.45),
      ctl('x', 'circ::posX', 'Glow X (palm)', -1.78, 1.78), ctl('y', 'circ::posY', 'Glow Y (palm)', -1, 1),
      ctl('falloff', 'glow::brightness', 'Falloff (point)', 3, 30),
    ],
    mappings: [
      map('pinch', 'radius', S.hand('pinch', { point: 8 }), 0.03, 0.45, { smoothMs: 60 }),
      map('px', 'x', S.hand('palm', { axis: 'x' }), -1.78, 1.78, { smoothMs: 40 }),
      map('py', 'y', S.hand('palm', { axis: 'y' }), -1, 1, { smoothMs: 40 }),
      map('point', 'falloff', S.trig(T.hand('right', 'point'), 'toggle'), 10, 3),
    ],
    actions: [act('fist', T.hand('right', 'fist'), 'burst', 'sparks', 220)],
    notes: `**What it shows.** Hand readings are sources like any knob, and gestures are triggers like any key.
• **Pinch**: thumb to index, 0 touching and 1 spread, sized to your hand so it reads the same near the camera and far from it.
• **Palm centre** X and Y put the glow where your hand is.
• A **fist** fires the Burst action; **pointing** toggles the glow's softness.

**How it's built.** Three mappings from the Hands group of sources (Right · Pinch, Right · Palm X, Right · Palm Y), a Trigger mapping with On: Hand gesture → Point (Toggle), and an action with the same trigger kind → Fist → Burst. The sparks are born at a hidden null that follows your palm. Gestures have hysteresis: holding a fist fires once, and it fires again only after you open your hand.

**Try this.**
• Press **Enable hand tracking** on the picture, then pinch.
• Make a fist, open it, make it again.
• Point with your index finger to toggle the softness.
• In Mappings, press **Learn** on a row and move one finger: the landmark that moved most becomes its source.`,
  })),
  ex('handTwoHands', glowGraph({ mode: 'ring', ringFreq: 8, falloff: 6, radius: 0.3, tint: [0.5, 0.6, 1] }), play({
    controls: [ctl('radius', 'circ::radius', 'Radius (hands apart)', 0.03, 1.2), colourCtl('tint', 'glow::tint', 'Tint (hand heights)'), ctl('falloff', 'glow::brightness', 'Falloff (right hand open)', 2, 20)],
    mappings: [
      map('apart', 'radius', S.hand('spread', {}), 0.03, 1.2, { smoothMs: 100 }),
      map('red', 'tint', S.hand('palm', { side: 'left', axis: 'y' }), 0.1, 1, { channel: 0, smoothMs: 120 }),
      map('blue', 'tint', S.hand('palm', { side: 'right', axis: 'y' }), 0.1, 1, { channel: 2, smoothMs: 120 }),
      map('open', 'falloff', S.hand('open', {}), 20, 2, { smoothMs: 120 }),
    ],
    notes: `**What it shows.** Two hands at once. **Distance between the hands** is a source (1 is a picture width apart), and each hand has its own readings, so one hand can steer colour while the other shapes the picture.

**How it's built.**
• Hands apart → the rings' radius: pull your hands apart to zoom out.
• Left palm height → the tint's red; right palm height → its blue.
• Right hand's openness → the falloff: a fist sharpens the rings, an open hand softens them.
Distance reads only while both hands are in view, so the rings hold their size when one hand drops out.

**Try this.**
• Press **Enable hand tracking** on the picture and hold up both hands.
• Raise one hand and lower the other.
• In the Hands settings (Mappings → the sliders button beside Hands), raise **Smoothing** for slower, steadier moves.
• Record a take: hand-driven values record like any others and render frame by frame.`,
  })),
  ex('handProximity', glowGraph({ radius: 0.24, falloff: 18, tint: [0.45, 0.8, 1] }), play({
    layers: [
      layer('camera', 'cam', 'Camera', { opacity: 0.22 }),
      layer('shape', 'button', 'Button', { shape: 'circle', x: 0.5, y: 0.5, w: 0.24, h: 0.24, action: 'none', fill: [0.45, 0.8, 1], stroke: [0.45, 0.8, 1], fillOpacity: 0.18, strokeWidth: 2 }),
      layer('text', 'words', 'Words', { text: 'TOUCH THE CIRCLE\nAGAIN\nONE MORE\nWELL DONE', x: 0.5, y: 0.14, size: 0.06, sequence: true, transition: 'rise' }),
    ],
    controls: [ctl('glow', 'glow::brightness', 'Falloff (touch)', 4, 30)],
    mappings: [map('flash', 'glow', S.trig(T.near(handAnchor('any', 8), 'button', 0.1), 'envelope', { attack: 20, decay: 300, sustain: 0.4, release: 400 }), 18, 5)],
    actions: [act('step', T.near(handAnchor('any', 8), 'button', 0.1), 'next', 'words')],
    notes: `**What it shows.** Proximity with a hand: a fingertip coming close to a shape is a trigger, like a key press.

**How it's built.** The action's trigger is **On: Proximity**, from **Either hand · Index tip** to the Button shape, closer than 0.1 (a tenth of the picture's height). It fires **Once** as your fingertip arrives and steps the Words to the next line. A Trigger mapping with the same proximity plays an envelope on the glow, so it flares while you touch. The margin (0.03) means your finger has to move a little further away before it can fire again, so a shaky hand at the edge doesn't flicker.

**Try this.**
• Press **Enable hand tracking** on the picture, then touch the circle with your index finger.
• In Layers → Actions, watch the distance meter as you move.
• Pick another point on the hand (the thumb tip, the palm) or another shape.
• Set Fires to **Every 0.5 sec** and hold your finger on the circle.`,
  })),

  // A path between four fingertips: a window through ASCII, strung with a web.
  ex('handPaths', fbmGraph({ scale: 2.4, timeScale: 0.07, preset: '2' }), play({
    layers: [
      layer('glyphs', 'ascii', 'ASCII', { cell: 12, colour: 'picture', cover: true, background: [0.02, 0.02, 0.04], contrast: 1.4, trackMatte: { id: 'window', mode: 'alpha', invert: true } }),
      layer('shape', 'window', 'Window', { visible: false, shape: 'path', pointIds: ['rIndex', 'rThumb', 'lThumb', 'lIndex'], pathStyle: 'fill', hull: true, onLost: 'fade', action: 'none', fill: [1, 1, 1], fillOpacity: 1, strokeWidth: 0 }),
      layer('shape', 'strings', 'Strings', { shape: 'path', pointIds: ['rIndex', 'rThumb', 'lThumb', 'lIndex'], pathStyle: 'web', onLost: 'drop', action: 'none', fillOpacity: 0, stroke: [1, 0.85, 0.55], strokeWidth: 1.5 }),
      layer('null', 'rIndex', 'Right index tip', { follow: 'hand', handSide: 'right', handPoint: 8, x: 0.66, y: 0.7, spring: 0.7, wobble: 0.15, size: 6, color: '#ffb86b' }),
      layer('null', 'rThumb', 'Right thumb tip', { follow: 'hand', handSide: 'right', handPoint: 4, x: 0.6, y: 0.32, spring: 0.7, wobble: 0.15, size: 6, color: '#ffb86b' }),
      layer('null', 'lThumb', 'Left thumb tip', { follow: 'hand', handSide: 'left', handPoint: 4, x: 0.4, y: 0.32, spring: 0.7, wobble: 0.15, size: 6, color: '#7ee0b0' }),
      layer('null', 'lIndex', 'Left index tip', { follow: 'hand', handSide: 'left', handPoint: 8, x: 0.34, y: 0.7, spring: 0.7, wobble: 0.15, size: 6, color: '#7ee0b0' }),
    ],
    controls: [ctl('cell', 'layer:ascii::cell', 'ASCII · Cell (window area)', 6, 40, 1)],
    mappings: [map('open', 'cell', S.sensor('window', 'area'), 8, 40, { smoothMs: 120 })],
    notes: `**What it shows.** A **Path** shape: its corners are nulls, so when the nulls follow your fingertips the shape moves with your hands. Frame the picture with both thumbs and index fingers and the ASCII opens a window onto the landscape under it. This one is made for **hand tracking**, and works without a camera too: until tracking starts, the four points rest in a frame you can drag.

**How it's built.** Four nulls follow both hands' thumb and index tips. **Window** is a Shape → **Path** through them, Style **Fill** with **Hull** on (it wraps round the outside, so crossing fingers never make a bow-tie). It is hidden and is the ASCII layer's **track matte**, inverted: the characters everywhere except inside your hands. **Strings** is a second path through the same nulls, Style **Web**: every pair joined. The Window's **Area** reading drives the ASCII cell size, so opening your hands coarsens the characters.

**Try this.**
• Press **Enable hand tracking** on the picture and make a frame with both hands. Without a camera, drag the four dots.
• Take one hand away: the Window fades out (Hand lost: **Fade**) and the Strings drop that hand's corners (**Drop**). Try **Hold**.
• Window → Style **Smooth** for a rounded window, or **Circle** for a lens your fingers size.
• ASCII → Matte → turn Invert off: the characters only inside your hands.
• Add hand path (Add layer, or the Camera layer's Hand tracking section) makes this setup in one step.`,
  })),

  // ─ Recording ─
  ex('playTake', glowGraph({ radius: 0.1, falloff: 10 }), play({
    layers: [
      layer('null', 'lead', 'Lead', { x: 0.5, y: 0.5, follow: 'mouse', spring: 0.5, wobble: 0.35, size: 0 }),
      scriptLayer('comet', 'Comet', SKETCH_COMET),
    ],
    controls: [ctl('x', 'circ::posX', 'Glow X', -1.8, 1.8), ctl('y', 'circ::posY', 'Glow Y', -1, 1), ctl('radius', 'circ::radius', 'Radius (Space)', 0.05, 0.3), colourCtl('tint', 'glow::tint', 'Tint')],
    mappings: [
      map('nx', 'x', S.nul('lead', 'x'), -1.78, 1.78), map('ny', 'y', S.nul('lead', 'y'), -1, 1),
      map('hit', 'radius', S.trig(T.key('Space'), 'envelope', { attack: 30, decay: 350, sustain: 0, release: 200 }), 0.1, 0.24),
    ],
    actions: [act('sparkle', T.key('Space'), 'script:sparkle', 'comet'), act('sparkleS', T.key('KeyS'), 'script:sparkle', 'comet')],
    takes: [builtTake()],
    notes: `**What it shows.** A **take** is a performance kept as keyframes: every control, null, the pointer and each action that fired, frame by frame. This one ships with the example, so you can watch it and render it without playing first.

**How it's built.** Live, the Lead null chases the mouse on a spring; the glow and the Comet sketch ride it; Space swells the glow and presses the comet's Sparkle. The take "Figure of eight" is 8 seconds of that, built in code instead of performed.

**Try this.**
• Record (the red dot) → **Performance** → Takes → ▶ on Figure of eight to watch it back.
• Press **Render…** on it: it renders frame by frame, smooth at any size, with no dropped frames.
• Record your own: Start, move the mouse and tap Space, then Stop. It plays back and joins the list.`,
  })),

  // ─ Finish: grading, lens, film and time over the whole picture ─
  ex('finishGrade', fbmGraph({ scale: 2.2, preset: '2' }), play({
    layers: [layer('text', 'title', 'Title', { text: 'GOLDEN HOUR', y: 0.5, size: 0.14 })],
    finish: {
      on: true,
      effects: [
        fx('grade', { contrast: 0.2, temperature: 0.35, vibrance: 0.25 }),
        fx('lens', { distortion: 0.3 }),
        fx('chroma', { amount: 0.4 }),
        fx('vignette', { amount: 0.5 }),
      ],
    },
    controls: [
      ctl('exposure', 'finish:grade::exposure', 'Grade · Exposure', -2, 2),
      ctl('contrast', 'finish:grade::contrast', 'Grade · Contrast', -1, 1),
      ctl('temp', 'finish:grade::temperature', 'Grade · Temperature', -1, 1),
      ctl('sat', 'finish:grade::saturation', 'Grade · Saturation', -1, 1),
      ctl('lens', 'finish:lens::distortion', 'Lens distortion · Distortion', -1, 1),
    ],
    mappings: [map('warm', 'temp', S.mouse('x'), -0.7, 0.7, { smoothMs: 120 })],
    notes: `**What it shows.** The **Finish** tab works on the final picture: the shader and every layer at once, like a colourist's grade and a lens on the camera. The title is a layer, and it is graded, bent and fringed with everything else.

**How it's built.** Four effects, top to bottom: a **Grade** (warmer, more contrast, more vibrance), **Lens distortion** (a barrel, zoomed so the edges stay filled), **Chromatic aberration** (red and blue part at the corners) and a **Vignette**. Their numbers can be controls like any slider (the + beside each one), so here mouse X drives the grade's Temperature.

**Try this.**
• Move the mouse left and right: the picture cools and warms.
• Finish → **Before / after**, then drag the divider on the picture.
• Push Lens distortion below 0 for a pincushion; in the Grade, open Curves and pull the middle of the RGB curve up.`,
  })),
  ex('finishLooks', fbmGraph({ scale: 3, preset: '4' }), play({
    layers: [layer('text', 'title', 'Title', { text: 'LOOKS', y: 0.5, size: 0.2 })],
    finish: { on: true, effects: [lookFx('teal-orange'), fx('grain', { amount: 0.2 })] },
    controls: [
      ctl('liftL', 'finish:grade::liftL', 'Grade · Shadows level', -1, 1),
      ctl('gainL', 'finish:grade::gainL', 'Grade · Highlights level', -1, 1),
      ctl('hiHue', 'finish:grade::splitHiHue', 'Grade · Highlights hue', 0, 360, 1),
      ctl('hiSat', 'finish:grade::splitHiSat', 'Grade · Highlights amount', 0, 1),
      ctl('shHue', 'finish:grade::splitShHue', 'Grade · Shadows hue', 0, 360, 1),
      ctl('shSat', 'finish:grade::splitShSat', 'Grade · Shadows amount', 0, 1),
      ctl('amount', 'finish:grade::amount', 'Grade · Amount', 0, 1),
    ],
    notes: `**What it shows.** A **Look** is a starting point: picking one sets the Grade's own controls, curves included, and you carry on from there. This is **Teal & orange**: warm highlights over cool shadows, from split toning, the colour wheels and a gentle S curve.

**How it's built.** Finish → Grade → Look → Teal & orange, then Film grain on top. The split-toning hues and amounts, the wheels' levels and the grade's Amount are controls.

**Try this.**
• Drag Grade · Amount from 1 to 0 and back: the whole look fades in and out.
• In the Grade, pick another Look (Bleach bypass, Faded print, Cross-process, Mono with toned shadows) and see which controls it moved.
• Make a grade you like and save it with the disk button: it joins the Looks list on this device.`,
  })),
  ex('finishScreen', glowGraph({ radius: 0.22, falloff: 6, tint: [0.3, 0.9, 1] }), play({
    layers: [layer('text', 'title', 'Title', { text: 'PLAYFIELD TV', y: 0.2, size: 0.1 })],
    finish: {
      on: true,
      effects: [fx('shake', { amount: 0.08, weave: 0.4 }), fx('crt', { curvature: 0.35 }), fx('bloom', { amount: 0.8, threshold: 0.55 }), fx('grain', { amount: 0.25 }), fx('flicker', { amount: 0.15 })],
    },
    controls: [
      ctl('curve', 'finish:crt::curvature', 'CRT · Curvature', 0, 1),
      ctl('scan', 'finish:crt::scanlines', 'CRT · Scanlines', 0, 1),
      ctl('bloom', 'finish:bloom::amount', 'Bloom · Amount', 0, 2),
      ctl('grain', 'finish:grain::amount', 'Film grain · Amount', 0, 1),
      ctl('shake', 'finish:shake::amount', 'Camera shake · Amount (Space)', 0, 1),
    ],
    mappings: [map('hit', 'shake', S.trig(T.key('Space'), 'envelope', { attack: 10, decay: 500, sustain: 0.2, release: 400 }), 0.08, 0.9)],
    notes: `**What it shows.** Screen and film effects over the whole frame: a **CRT** (curved glass, an RGB shadow mask, scanlines and phosphor glow), **Bloom**, **Film grain**, **Flicker** and **Camera shake** with film gate weave.

**How it's built.** The CRT's mask is the Studio's **CRT Mask** node, the same GLSL. Bloom and the CRT's glow share one small blurred copy of the frame, so they cost a few tiny passes. Space fires an envelope into Camera shake · Amount.

**Try this.**
• Tap and hold **Space**: the camera jolts, then settles.
• Drag CRT · Curvature to 1, and Scanlines down to 0.
• Map a live audio band onto Camera shake · Amount (Mappings → Add → Live audio) and the picture shakes on the kick.`,
  })),
  ex('finishHalation', glowGraph({ radius: 0.1 }), play({
    layers: [scriptLayer('scene', 'Test scene', SKETCH_HALATION)],
    display: { picture: true, backdrop: [0.05, 0.05, 0.06], source: 'colour' },
    // The defaults are the measured reference (Classic cine).
    finish: { on: true, effects: [fx('halation')] },
    controls: [
      ctl('amount', 'finish:halation::amount', 'Halation · Amount', 0, 2),
      ctl('reach', 'finish:halation::reach', 'Halation · Reach', 0, 1),
      ctl('thr', 'finish:halation::threshold', 'Halation · Threshold', -4, 4),
      ctl('head', 'finish:halation::headroom', 'Halation · Highlight headroom', 1, 16),
      ctl('warm', 'finish:halation::warmth', 'Halation · Warmth', 0, 1),
      ctl('grow', 'finish:halation::growth', 'Halation · Growth', 0, 1),
      ctl('cons', 'finish:halation::conserve', 'Halation · Conserve', 0, 1),
      ctl('paper', 'layer:scene::p_paper', 'Test scene · Paper white', 0.5, 1),
    ],
    notes: `**What it shows.** Film **halation**: light strong enough to go right through the film bounces off its back and exposes it again from behind, reaching the red layer first. It shows as a thin red bleed hugging bright edges, landing on the darker picture right beside them, orange where it is strongest. The defaults are measured from a film-emulation grade (the Joo.Works ACES lite Halation PowerGrade): the bleed starts when a part's red passes about 0.70 on screen, reaches only a few pixels, and never turns the bright part itself red.

**How it's built.** A Script layer draws a test scene: a grey ramp, a paper-white card, a teal patch and a row of small lamps that clip. The Finish stack turns the picture into linear light, takes the red over **Threshold** as the source (with **Highlight headroom** guessing how much brighter than white the clipped parts were), spreads it a few pixels (the same distance from a one-pixel glint as from a big card's edge), and adds it, tinted, only where the picture is darker. **Reach** adds a wider, softer haze.

**Try this.**
• The ramp bleeds red above and below from about two thirds along; the paper card gets a thin red rim on the dark wall; the teal patch makes none (no red in it); the clipped lamps bleed furthest.
• Lower Test scene · Paper white to 0.60: the card drops under the threshold and its rim goes.
• Try Warmth (red to orange), Reach (the wide haze), Conserve (the bright part gives up what it bleeds), or the Subtle, Classic cine and Strong presets on the Halation card.`,
  })),
  ex('finishTime', fbmGraph({ scale: 2.5, timeScale: 0.5, preset: '4' }), play({
    layers: [scriptLayer('comet', 'Comet', SKETCH_ORBIT)],
    finish: { on: true, effects: [fx('time', { amount: 30, angle: 90 })] },
    controls: [
      ctl('back', 'finish:time::amount', 'Time displacement · Frames back', 0, 31),
      ctl('dir', 'finish:time::angle', 'Time displacement · Direction', 0, 360, 1),
      ctl('speed', 'layer:comet::p_speed', 'Comet · Speed', 0, 3),
    ],
    mappings: [map('mouseBack', 'back', S.mouse('y'), 8, 31, { smoothMs: 150 })],
    notes: `**What it shows.** **Time displacement**: each part of the picture shows a different moment. The bottom is now and the top is up to 30 frames ago, so the drifting shader shears and the comet and the bar smear into slit-scan shapes.

**How it's built.** The Finish stack keeps the last frames (32 of them, reduced, by default) and reads each pixel from the frame its **map** points at: slit-scan, brightness, noise, radial, or a layer's alpha. The comet is a Script layer moving with the clock, so a render moves the same way; renders fill the frames in order, so they come out the same every time.

**Try this.**
• Move the mouse up and down: Frames back follows it.
• Turn Direction to 0 for a sideways scan, or pick another Map on the Time displacement card (Brightness, Noise, Radial, or a layer).
• Set Quality to High for 64 frames of history.`,
  })),
  // ─ Finish: the newer looks (pixel sort, halftone, ASCII, light leaks) and the effects' presets ─
  ex('finishPixelSort', quietGraph(), play({
    display: { picture: true, backdrop: [0, 0, 0], source: 'image', image: { name: 'Ridges at dusk.jpg', src: RIDGES_AT_DUSK } },
    finish: {
      on: true,
      effects: [
        fxPreset('pixelsort', 'Drip'),
        fxPreset('leaks', 'Warm'),
        fx('grain', { amount: 0.15 }),
        fx('vignette', { amount: 0.35 }),
      ],
    },
    controls: [
      ctl('thr', 'finish:pixelsort::threshold', 'Pixel sort · Threshold', 0, 1),
      ctl('len', 'finish:pixelsort::length', 'Pixel sort · Length', 0, 1),
      ctl('dir', 'finish:pixelsort::angle', 'Pixel sort · Direction', 0, 360, 1),
      ctl('leak', 'finish:leaks::amount', 'Light leaks · Amount', 0, 1),
      ctl('hue', 'finish:leaks::hue', 'Light leaks · Hue', 0, 360, 1),
    ],
    mappings: [
      map('breathe', 'len', S.lfo('sine', 0.05), 0.12, 0.45, { smoothMs: 60 }),
      map('drift', 'thr', S.lfo('sine', 0.031, 0.25), 0.38, 0.62, { smoothMs: 60 }),
    ],
    notes: `**What it shows.** Two of the newer Finish effects on a photo. **Pixel sort** finds the runs of pixels brighter than its Threshold and sorts them into streaks, so the sky and the sun drip down over the ridges. **Light leaks** wash warm light in from the edges, drifting slowly, like film fogged at the gate.

**How it's built.** Background → Image holds the photo (the graph is paused). Finish: Pixel sort with its **Drip** preset, Light leaks with **Warm**, then a little Film grain and a Vignette. Two slow LFOs breathe the streaks' Length and move the Threshold, so different parts of the picture sort over time.

**Try this.**
• Pixel sort's presets: **Sideways** runs the streaks to the right; **Melt** sorts nearly everything.
• Turn Direction to 90 and the streaks rise like heat.
• Light leaks: **Rose** or **Burn**, or drag Hue round the colour wheel.
• Background → Replace with your own photo.`,
  })),
  ex('finishPrint', fbmGraph({ scale: 1.6, timeScale: 0.08, preset: '1' }), play({
    layers: [layer('text', 'title', 'Title', { text: 'POW!', y: 0.5, size: 0.3 })],
    finish: {
      on: true,
      effects: [
        fxPreset('posterize', 'Poster'),
        fxPreset('edges', 'Ink outline'),
        fxPreset('halftone', 'Comic'),
      ],
    },
    controls: [
      ctl('dot', 'finish:halftone::size', 'Halftone · Dot size', 2, 60, 0.5),
      ctl('ang', 'finish:halftone::angle', 'Halftone · Angle', 0, 90, 1),
      ctl('col', 'finish:halftone::colour', 'Halftone · Colour', 0, 1),
      ctl('lev', 'finish:posterize::levels', 'Posterize · Levels', 2, 32, 1),
      ctl('ink', 'finish:edges::amount', 'Edges · Amount', 0, 1),
    ],
    mappings: [map('dotPulse', 'dot', S.lfo('sine', 0.08), 7, 14, { smoothMs: 80 })],
    notes: `**What it shows.** A comic-book print made only from Finish effects: **Posterize** flattens the colours into a few bands, **Edges** inks their outlines in black, and **Halftone** prints the result as cyan, magenta, yellow and black dots on cream paper, the way comics were printed.

**How it's built.** A drifting FBM landscape through a Palette, with a text layer on top. Finish: Posterize (**Poster** preset), Edges (**Ink outline**), Halftone (**Comic**). Halftone starts a pass of its own, so it prints the posterized, outlined picture. A slow LFO swells the dots.

**Try this.**
• Halftone's **Newsprint** preset: black ink only, small dots. **Pop art**: huge dots at a jaunty angle.
• Drag Halftone · Colour to 0 for one ink, or Posterize · Levels up for smoother colour.
• Edges: try **Neon** for glowing outlines instead of ink.`,
  })),
  ex('finishTerminal', glowGraph({ radius: 0.24, falloff: 9, tint: [0.4, 1, 0.6], mode: 'ring', ringFreq: 10, comment: 'The circle whose rings ASCII redraws in characters. Its Radius breathes with an LFO.' }), play({
    finish: {
      on: true,
      effects: [
        fxPreset('feedback', 'Ghost trail'),
        fxPreset('ascii', 'Terminal', { size: 18, contrast: 0.6 }),
        fx('bloom', { amount: 0.35, threshold: 0.6 }),
        fx('crt', { curvature: 0.15 }),
      ],
    },
    controls: [
      ctl('radius', 'circ::radius', 'Circle radius', 0.05, 0.5),
      ctl('char', 'finish:ascii::size', 'ASCII · Character size', 4, 48, 0.5),
      ctl('con', 'finish:ascii::contrast', 'ASCII · Contrast', 0, 1),
      ctl('trail', 'finish:feedback::amount', 'Feedback · Amount', 0, 0.99),
    ],
    mappings: [map('breathe', 'radius', S.lfo('sine', 0.12), 0.12, 0.42, { smoothMs: 40 })],
    notes: `**What it shows.** An old green terminal. **Feedback** keeps fading copies of earlier frames (ghost trails as the rings breathe), **ASCII** redraws everything as text characters, from sparse dots in the dark to dense blocks in the light, then Bloom and a slight CRT curve finish the screen.

**How it's built.** Rings of glow from one circle (SDF Glow in Ring Light mode), its Radius breathing with an LFO. Finish: Feedback (**Ghost trail** preset), ASCII (**Terminal**: one ink colour), Bloom, CRT. ASCII starts a pass of its own, so it draws the ghost trails too.

**Try this.**
• ASCII's **Colour** preset takes each character's colour from the picture; **Big type** makes huge characters.
• Feedback's **Tunnel** and **Spiral** presets zoom and spin the trails into the characters.
• Drag ASCII · Character size down to 6 for a dense, detailed screen.`,
  })),
  ex('finishKaleidoscope', fbmGraph({ scale: 3, timeScale: 0.25, preset: '2' }), play({
    finish: {
      on: true,
      effects: [
        fxPreset('feedback', 'Tunnel'),
        fxPreset('mirror', 'Mandala'),
        fxPreset('edges', 'Neon'),
      ],
    },
    controls: [
      ctl('seg', 'finish:mirror::segments', 'Mirror · Segments', 1, 16, 1),
      ctl('spin', 'finish:mirror::spin', 'Mirror · Spin', -1, 1),
      ctl('zoom', 'finish:mirror::zoom', 'Mirror · Zoom', 0.25, 4),
      ctl('fb', 'finish:feedback::amount', 'Feedback · Trail', 0, 0.99),
      ctl('glow', 'finish:edges::glow', 'Edges · Glow', 0, 2),
    ],
    mappings: [map('breathe', 'zoom', S.lfo('sine', 0.04), 0.8, 1.6, { smoothMs: 80 })],
    notes: `**What it shows.** Presets on three Finish effects, stacked into a moving mandala from a drifting noise. **Feedback** (Tunnel) leaves trails that grow and turn, **Mirror** (Mandala) folds them into six wedges, and **Edges** (Neon) keeps only their outlines, glowing in colours that follow their direction.

**How it's built.** An FBM noise through a Palette, drifting fairly fast; an LFO slowly zooms the Mirror in and out. Each effect's card has a preset row at the top: one click sets its numbers, and you carry on from there. The order matters: the trails are folded, then outlined.

**Try this.**
• Mirror's other presets: **Mirror**, **Crystal** (twelve wedges, spinning back), **Butterfly**.
• Feedback: **Spiral** for a whirl, **Smear** for a liquid blend.
• Add a **Posterize** at the bottom and try its **Sunset duo** or **Handheld** preset: the neon becomes a two-colour print.
• Drag the Finish cards into another order and watch the look change.`,
  })),
  // ─ Finish: the temporal effects (Datamosh, Echo, Motion extract) on moving content ─
  ex('finishDatamoshEcho', fbmGraph({ scale: 2.2, timeScale: 0.05, preset: '4' }), play({
    layers: [
      layer('shape', 'orb', 'Orb', { shape: 'circle', x: 0.3, y: 0.5, w: 0.22, h: 0.22, fill: [1, 0.85, 0.4], fillOpacity: 1, stroke: [1, 0.95, 0.7], strokeWidth: 2, action: 'none' }),
    ],
    finish: {
      on: true,
      effects: [
        fx('echo', { time: 5, count: 5, start: 0.85, decay: 0.7, mode: 3, strobe: 0, map: 'layer', layerId: 'orb' }),
        fxPreset('datamosh', 'Bloom', { bleed: 0.03, block: 32, push: 1.6, sustain: 0.85, every: 4, map: 'layer', layerId: 'orb' }),
        fx('vignette', { amount: 0.4 }),
      ],
    },
    controls: [
      ctl('ox', 'layer:orb::x', 'Orb · x', 0, 1),
      ctl('oy', 'layer:orb::y', 'Orb · y', 0, 1),
      ctl('echoes', 'finish:echo::count', 'Echo · Echoes', 1, 8, 1),
      ctl('etime', 'finish:echo::time', 'Echo · Echo time', 1, 30, 1),
      ctl('push', 'finish:datamosh::push', 'Datamosh · Push', 0, 3),
      ctl('mosh', 'finish:datamosh::hold', 'Datamosh · Mosh (hold M)', 0, 1, 1),
    ],
    mappings: [
      map('swingX', 'ox', S.lfo('sine', 0.37), 0.15, 0.85),
      map('swingY', 'oy', S.lfo('sine', 0.53, 0.25), 0.25, 0.75),
      map('holdM', 'mosh', S.key('KeyM'), 0, 1),
    ],
    notes: `**What it shows.** Two of the temporal Finish effects on one moving shape. **Echo** leaves sharp copies of the Orb a few frames apart behind it. **Datamosh** treats the picture like a video that lost its keyframes: the Orb's movement drags the landscape's old pixels along in blocks, smearing and blooming, until a keyframe every four seconds snaps it clean.

**How it's built.** A drifting FBM landscape, and a Shape layer (the Orb) swung round by two LFOs. Finish:
• **Echo** with Source **One layer: Orb** and Operator **Behind**: five copies of only the Orb, under it, each fainter (the Layer echo setup).
• **Datamosh** from the Bloom preset, pushed harder (bigger blocks, more Push and Sustain), with **Motion from: Orb**: the Orb's movement moves the picture's blocks. Keyframe every 4 s heals it.
• A Vignette.
Holding **M** turns Datamosh's **Mosh** on: nothing heals while it's held.

**Try this.**
• Hold **M** for a few seconds and let go: the smear piles up, then the next keyframe clears it.
• Datamosh presets: **Melt** (slow, liquid), **Blocky**, **Pulse** (a keyframe every second).
• Echo: **Strobe echo** makes the copies jump instead of following; set Source back to Whole picture to echo everything.`,
  })),
  ex('finishMotionExtract', glowGraph({ radius: 0.16, falloff: 7, tint: [1, 0.75, 0.45], comment: 'A glowing circle swung round by two LFOs: the movement Motion extract shows.' }), play({
    layers: [layer('text', 'word', 'Word', { text: 'MOVE', y: 0.3, size: 0.18 })],
    finish: { on: true, effects: [fxPreset('motionx', 'Neon motion')] },
    controls: [
      ctl('px', 'circ::posX', 'Circle · x', -1, 1),
      ctl('py', 'circ::posY', 'Circle · y', -1, 1),
      ctl('wx', 'layer:word::x', 'Word · x', 0, 1),
      ctl('delay', 'finish:motionx::delay', 'Motion extract · Delay', 1, 30, 1),
      ctl('gain', 'finish:motionx::gain', 'Motion extract · Gain', 0, 8),
      ctl('neon', 'finish:motionx::neon', 'Motion extract · Neon', 0, 1),
    ],
    mappings: [
      map('orbitX', 'px', S.lfo('sine', 0.17), -0.7, 0.7),
      map('orbitY', 'py', S.lfo('sine', 0.17, 0.25), -0.45, 0.45),
      map('slide', 'wx', S.lfo('triangle', 0.15), 0.3, 0.7),
    ],
    notes: `**What it shows.** **Motion extract**: the picture inverted over a copy of itself from a few frames ago. Whatever stays still cancels out, so only what moves shows, as outlines. Here with the **Neon motion** preset: on black, what arrives glows cyan and what leaves glows magenta.

**How it's built.** A glowing circle orbiting on two LFOs, and a text layer sliding left and right. Finish: Motion extract with its **Neon motion** preset. A still frame shows nothing at all: pause the clock and the picture goes black.

**Try this.**
• Delay: longer catches slower movement and draws thicker outlines.
• Presets: **Classic grey** (the mid-grey version of the trick), **On black**.
• Put it over a Camera or a Video layer: only you (or what moves in the video) shows.`,
  })),
  // ─ Finish: Water, a simulated surface: a layer drags a wake, rain falls, clicks splash ─
  ex('finishWater', quietGraph(), play({
    display: { picture: true, backdrop: [0, 0, 0], source: 'image', image: { name: 'Pool floor.jpg', src: POOL_FLOOR } },
    layers: [
      layer('null', 'boat', 'Boat', { x: 0.3, y: 0.5, size: 8, color: '#ffb86b' }),
    ],
    finish: {
      on: true,
      effects: [
        fx('water', { source: 'layer', sourceLayer: 'boat', shape: 'point', speed: 0.22, damping: 0.14, size: 0.04, strength: 1.2, refraction: 0.6, highlights: 0.5, rain: 3, drop: 0.01 }),
        fx('chroma', { amount: 0.6, where: 'waves' }),
      ],
    },
    controls: [
      ctl('bx', 'layer:boat::x', 'Boat · x', 0, 1),
      ctl('by', 'layer:boat::y', 'Boat · y', 0, 1),
      ctl('speed', 'finish:water::speed', 'Water · Wave speed', 0.05, 2),
      ctl('damp', 'finish:water::damping', 'Water · Damping', 0, 1),
      ctl('rain', 'finish:water::rain', 'Water · Rain', 0, 60, 0.5),
      ctl('bend', 'finish:water::refraction', 'Water · Refraction', 0, 1),
      ctl('shine', 'finish:water::highlights', 'Water · Highlights', 0, 1),
    ],
    mappings: [
      map('sailX', 'bx', S.lfo('sine', 0.11), 0.12, 0.88),
      map('sailY', 'by', S.lfo('sine', 0.17, 0.25), 0.22, 0.78),
    ],
    signals: [
      { id: 'splashClick', name: 'Splash where you click', inputs: [{ kind: 'trigger', trigger: T.click() }], do: [{ id: 'sc', do: 'splash', layerId: 'finish:water', amount: 1, enabled: true, key: 'pointer', value: 0.05 }] },
      { id: 'bigSplash', name: 'Big splash (Space)', inputs: [{ kind: 'trigger', trigger: T.key('Space') }], do: [{ id: 'bs', do: 'splash', layerId: 'finish:water', amount: 1, enabled: true, key: 'random', value: 0.12 }] },
    ],
    notes: `**What it shows.** **Water**, a Look effect that simulates a water surface over the picture. An invisible boat sails round the pool and drags a wake behind it, a V of waves that spreads, crosses the others and fades; a light rain dimples the surface; click to splash. The tile lines bend under the waves and their crests catch the light.

**How it's built.**
• The picture: Background → Image holds a pool's floor (the graph underneath is paused). Straight lines and small detail show the water's bending best.
• **Boat** (a Null layer): just a point; its marker shows only while you edit. Two slow LFOs swing its x and y (the **Boat · x / y** controls), so it sails a looping path faster than the waves travel, which is what makes a wake rather than rings. A null rather than a shape, because the Finish stack bends everything under it, layers too: a drawn boat would wobble in its own wake.
• Finish → **Water**: Source **A layer: Boat**, Shape **Point**. Every frame it presses a small dimple into the water where the boat is; as the boat moves, the water it leaves springs back and the waves run off at **Wave speed**. **Rain** drops 3 raindrops a second at random places (the same places in every render). Open edges lets the waves run out of the frame.
• Finish → **Chromatic aberration** with **Where → Where the water moves**: colour fringes only on the waves, none on still water.
• Rules: **Splash where you click** (a click on the picture → Splash under the pointer) and **Big splash (Space)** (Space → a bigger Splash somewhere random). Both are a rule's Do → **Splash · Water**.
• Controls: **Wave speed** (how fast the waves travel), **Damping** (how long they last), **Rain** (drops a second), **Refraction** (how much the waves bend the picture) and **Highlights** (glints and the bright bands crests focus).

**Try this.**
• On the Water card, set Source to **The pointer** and drag across the picture: a fast flick leaves a sharp V, a slow one only ripples. Give it **Bob** and hold still to make rings.
• Water's presets: **Rain on glass**, **Ripple tank** (two bobbing points that interfere), **Shockwave** (then press Space).
• Set the Boat null to **Follow: Mouse**: the wake trails a springy point that chases your pointer.
• Add a Shape layer, hide it, and pick Shape → **A layer's shape** with it on the Water card: the whole shape pushes the water as it moves.
• Render it: the waves are simulated by the clock, so every render comes out the same.`,
  })),
  ex('drumPads', glowGraph({ radius: 0.1, falloff: 16, tint: [1, 0.5, 0.3] }), play({
    layers: [
      drumKit('drums', 'Drums', [
        ['kick', {}], ['snare', {}], ['hat', { choke: 1 }], ['openhat', { choke: 1 }],
        ['clap', {}], ['tom', {}], ['rim', {}], ['cowbell', {}],
        ['kick', { name: 'Kick low', pitch: -5 }], ['tom', { name: 'Tom high', pitch: 7 }], ['snare', { name: 'Snare back', reverse: true }], ['clap', { name: 'Clap gate', mode: 'gate', loop: true, start: 0.05, end: 0.3 }],
      ]),
      layer('null', 'centre', 'Centre', { x: 0.5, y: 0.5, size: 10, visible: false }),
      layer('particles', 'sparks', 'Sparks', { count: 900, emit: 'burst', spawn: 'null', nullId: 'centre', spawnRadius: 0.05, field: 'noise', noiseScale: 2, speed: 1.4, life: 0.8, fade: 0.7, size: 2.4, sizeJitter: 0.6, colour: 'palette', palette: 1, paletteBy: 'age', trail: 0.5, blend: 'screen' }),
    ],
    audioReaders: {
      input: 'pads:drums',
      readers: [
        reader('lows', 'Kick', 60, 0.8, 30, 2, 180, [1, 0.45, 0.35]),
        reader('highs', 'Hats', 8000, 1.2, 45, 1, 70, [0.35, 0.82, 0.98]),
      ],
    },
    controls: [
      ctl('radius', 'circ::radius', 'Pulse (the kick)', 0.05, 0.4),
      ctl('kickPitch', 'layer:drums::pad1_pitch', 'Drums · Kick pitch', -24, 24, 0.01),
      ctl('hatDecay', 'layer:drums::pad4_decay', 'Drums · Open hat decay', 0, 1),
    ],
    mappings: [
      map('pulse', 'radius', { kind: 'reader', readerId: 'lows' }, 0.08, 0.26, { smoothMs: 20 }),
      map('pitch', 'kickPitch', S.mouse('y'), -7, 5, { smoothMs: 40 }),
    ],
    actions: [
      act('hats', T.reader('highs', 0.5, 0.2), 'burst', 'sparks', 30),
      act('space', T.key('Space'), 'pad', 'drums', 2),
    ],
    notes: `**What it shows.** A **Drum pads** layer: sixteen pads, each playing a sound Simpler-style, with the sound feeding audio readers that drive the picture. The kick pulses the glow; the hats throw sparks. Nothing plays by itself: you play it.

**How it's built.** The pads hold generated drums (made when the example opens, so no audio files come with it): a kick, a snare, closed and open hats in the same **choke** group (a closed hat cuts the open one), a clap, toms, a rim and a cowbell, then variations: a lower kick (Pitch −5), a higher tom, a **reversed** snare and a looping **gate** clap (it plays while held). The layer's sound goes through its own effect chain (Finish → Sound) to the master. The audio readers listen to it (**Listen to: Drum pads · Drums**): **Kick** at 60 Hz drives the Pulse, **Hats** at 8 kHz fire the Sparks burst. Mouse Y moves the kick's pitch (a mapping on **Drums · Kick pitch**, the layer property \`pad1_pitch\`).

**Try this.**
• Press Z X C V, A S D F, Q W E R: pads 1–12 (1 2 3 4 are pads 13–16). Space plays the snare through an action (**Do: Play pad**).
• Click pads on the layer card (higher on a pad is harder), or play MIDI notes 36–51 (a drum rack's), or a pad grid's lower-left 4 × 4.
• Select a pad and drag its waveform's edges, try Reverse, Gate and Loop, or drop a sound file of your own on it.
• Add a Reverb to the Drums chain in Finish → Sound.
• Record a take and render it: every hit lands in the video's sound at the moment you played it.`,
  })),
  ex('granulator', glowGraph({ radius: 0.12, falloff: 14, tint: [0.45, 0.7, 1] }), play({
    audioEngine: {
      racks: [{
        id: 'gran', name: 'Granulator', effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false,
        instrument: {
          id: 'inst', kind: 'granulator', sample: { synth: 'pad', name: 'Pad chord' },
          // By GR_PARAMS address: Cloud, position, spray, size, density, spread, pitch random, pan random,
          // filter + cutoff, attack, release, scan LFO rate + depth, drone, level.
          params: { 0: 2, 1: 0.35, 2: 0.12, 3: 140, 5: 28, 7: 7, 8: 0.15, 9: 0.7, 14: 1, 15: 7000, 17: 0.6, 20: 1.5, 24: 0.07, 25: 0.12, 28: 1, 33: 0.9 },
        },
      }, {
        // Part two: the particles inside the ring play the pad chord an octave up, each at its own place and pitch.
        id: 'ring', name: 'Particle chimes', effects: [], keyboard: false, midi: 'off', channel: 0, volume: 1, mute: false,
        instrument: {
          id: 'inst', kind: 'granulator', sample: { synth: 'pad', name: 'Pad chord' },
          // Cloud, grain size, pitch +12, pan random, cap, level, grains per thing.
          params: { 0: 2, 3: 120, 6: 12, 9: 0.2, 29: 48, 33: 0.6, 35: 3 },
          from: {
            source: 'flow', boundary: 'hoop', births: true,
            links: [
              { prop: 'x', target: 'position', on: true, min: 0, max: 0.6 },
              { prop: 'y', target: 'pitch', on: true, min: -12, max: 12 },
              { prop: 'speed', target: 'size', on: true, min: 40, max: 300 },
              { prop: 'age', target: 'amp', on: true, min: 1, max: 0 },
            ],
          },
        },
      }],
    },
    audioFx: { chains: { 'rack:gran': { on: true, effects: [afx('reverb', 'verb', { type: 'hall', size: 0.7, decay: 3.2, mix: 0.3 })] } } },
    audioReaders: {
      input: 'engine:gran',
      readers: [
        reader('body', 'Body', 320, 1.2, 25, 3, 160, [1, 0.55, 0.35]),
        reader('air', 'Shine', 880, 1.2, 35, 2, 120, [0.4, 0.8, 1]),
      ],
    },
    layers: [
      layer('null', 'g1', 'Grain 1', { x: 0.3, y: 0.3, size: 10 }),
      layer('null', 'g2', 'Grain 2', { x: 0.5, y: 0.3, size: 10 }),
      layer('null', 'g3', 'Grain 3', { x: 0.7, y: 0.3, size: 10 }),
      layer('audio', 'bars', 'Spectrum', { style: 'bars', y: 0.12, w: 1.7, h: 0.16, bars: 64, colour: 'palette', palette: 1, opacity: 0.7, toShader: false }),
      layer('particles', 'flow', 'Flow', { count: 220, field: 'noise', noiseScale: 2, speed: 0.5, life: 4, fade: 0.6, size: 2.2, colour: 'palette', palette: 1, paletteBy: 'age', trail: 0.4, blend: 'screen' }),
      layer('shape', 'hoop', 'Ring', { shape: 'circle', x: 0.5, y: 0.5, w: 0.3, h: 0.3, fill: [0.4, 0.8, 1], stroke: [0.4, 0.8, 1] }),
    ],
    controls: [
      ctl('hoopX', 'layer:hoop::x', 'Ring · x', 0, 1),
      ctl('pos', 'au:gran:inst::1', 'Granulator · Position', 0, 1),
      ctl('size', 'au:gran:inst::3', 'Granulator · Grain size', 2, 2000, 1),
      ctl('radius', 'circ::radius', 'Glow (the grains’ body)', 0.05, 0.4),
      ctl('count', 'grains:gran::grains', 'Grain count', 0, 64),
      ctl('g1x', 'layer:g1::x', 'Grain 1 · x', 0, 1), ctl('g1y', 'layer:g1::y', 'Grain 1 · y', 0, 1),
      ctl('g2x', 'layer:g2::x', 'Grain 2 · x', 0, 1), ctl('g2y', 'layer:g2::y', 'Grain 2 · y', 0, 1),
      ctl('g3x', 'layer:g3::x', 'Grain 3 · x', 0, 1), ctl('g3y', 'layer:g3::y', 'Grain 3 · y', 0, 1),
    ],
    mappings: [
      map('scan', 'pos', S.mouse('x'), 0.02, 0.98, { smoothMs: 80 }),
      map('grainSize', 'size', S.mouse('y'), 25, 400, { curve: 'exp', smoothMs: 80 }),
      map('glow', 'radius', { kind: 'reader', readerId: 'body' }, 0.07, 0.3, { smoothMs: 30 }),
      map('count', 'count', S.sensor('ae:gran', 'grains'), 0, 64),
      map('hoopDrift', 'hoopX', S.lfo('sine', 0.05), 0.25, 0.75),
      ...[1, 2, 3].flatMap(i => [
        map(`g${i}x`, `g${i}x`, S.sensor('ae:gran', 'grainPos', String(i)), 0.05, 0.95),
        map(`g${i}y`, `g${i}y`, S.sensor('ae:gran', 'grainAmp', String(i)), 0.25, 0.85, { smoothMs: 40 }),
      ]),
    ],
    notes: `**What it shows.** A **Granulator**: an Audio engine rack whose instrument plays a sample as a cloud of short grains, up to 64 at once. Its sound feeds audio readers that swell the glow, and its grains ride three nulls across the picture. Move the mouse to play it: X scans through the sample, Y sets the grain size.

**How it's built.** The rack **Granulator** (Engine tab) holds a Granulator in **Cloud** mode, with **Drone** on so it sounds without a key. Its sample is the generated **pad chord** (A minor, slowly swelling), made when the example opens, so no audio file comes with it. Mouse X drives **Position** (\`au:gran:inst::1\`, a control like any Audio Unit parameter) and mouse Y the **Grain size** through an Exp curve. The sound goes through the rack's own Sound chain (Finish → Sound → Granulator: a hall reverb). The readers listen to the rack (**Listen to: Audio engine · Granulator**): **Body** at 320 Hz drives the glow, and **Shine** at 880 Hz follows the chord's top octave. The grains are sensors on the rack: **Grain count**, and grains 1–3's place in the sample (x) and level (y) drive the three nulls.

**Try this.**
• Click the picture first: the browser starts sound on a click. Mute the master if you only want to watch.
• Engine tab → Granulator: switch **Classic**, **Flux**, **Cloud**, **Emit** (grains from spawn points that travel through the sample) and **Spectral** (grains that play frequency bands), try **Freeze**, turn **Scan** to 1 for a time-stretch, or change the **Sample** to a Library sound or a drum pad's.
• Turn **Drone** off and play it from the card's keys, the computer keyboard (**Computer keyboard** on the card) or a MIDI keyboard: C4 plays the sample at its own pitch.
• **Readouts → controls** and **Grains → nulls** on the card make more of these.
• Record a take and render it: the grains come out the same every time (seeded).

**Part two: grains from the particles.** A second rack, **Particle chimes**, plays the pad chord an octave up from the **Flow** particles: under **Grains from a layer**, its Source is Flow and its boundary is the **Ring** circle (an LFO drifts it across). Each particle inside plays 3 grains a second: its X sets where in the chord it reads, Y its pitch (±12 semitones), its speed the grain size, and its age the level, so a particle fades out of the sound as it fades out of sight. More particles in the ring make more grains, and a particle born inside plays at once. Move the Ring, point the boundary at a drawn path, or change the links.`,
  })),
  ex('audioEffects', glowGraph({ radius: 0.12, falloff: 12, tint: [1, 0.6, 0.3] }), play({
    audioFx: {
      chains: {
        master: {
          on: true,
          effects: [
            afx('filter', 'sweep', { cutoff: 2500, resonance: 6 }),
            afx('echo', 'echo', { sync: '1/8d', bpm: 120, feedback: 0.35, tone: 3000, mix: 0.25, pingpong: true }),
          ],
        },
      },
    },
    audioReaders: {
      input: '',
      readers: [
        reader('lows', 'Lows', 70, 1, 25, 2, 160, [1, 0.5, 0.35]),
        reader('highs', 'Highs', 6000, 1.5, 40, 2, 120, [0.4, 0.8, 1]),
      ],
    },
    layers: [layer('audio', 'bars', 'Spectrum', { style: 'bars', y: 0.14, w: 1.7, h: 0.2, bars: 64, colour: 'palette', palette: 1, opacity: 0.85, toShader: false })],
    controls: [
      ctl('cutoff', 'audiofx:master:sweep::cutoff', 'Master · Filter · Cutoff', 20, 20000, 1),
      ctl('res', 'audiofx:master:sweep::resonance', 'Master · Filter · Resonance', 0.1, 20),
      ctl('echoMix', 'audiofx:master:echo::mix', 'Master · Echo · Mix', 0, 1),
      ctl('radius', 'circ::radius', 'Glow (the highs)', 0.05, 0.4),
    ],
    mappings: [
      map('sweep', 'cutoff', S.mouse('x'), 150, 14000, { curve: 'exp', smoothMs: 60 }),
      map('ring', 'res', S.mouse('y'), 0.7, 14, { smoothMs: 60 }),
      map('glow', 'radius', { kind: 'reader', readerId: 'highs' }, 0.06, 0.3, { smoothMs: 30 }),
    ],
    notes: `**What it shows.** Audio effects on the sound, played by the mouse: a **Filter** on the master bus, swept by mouse X, its resonance on mouse Y, then a ping-pong **Echo** synced to dotted eighths. The Highs reader hears the sound after the effects, so the glow shrinks as the filter closes.

**How it's built.** Finish → **Sound** holds a chain per sound (audio layers, Video layers, Audio Input songs, the MIDI synth) and one on the **Master**. The filter's Cutoff and Resonance and the echo's Mix are controls (the + beside each number), mapped like any slider: Cutoff through an **Exp** curve so the sweep is even to the ear. Every number glides, so the sweep never clicks.

**Try this.**
• Nothing plays by itself: open **Spectrum** (the Audio readers panel) and press **Play test loop**, then move the mouse left and right.
• Finish → Sound → Filter: try **High-pass** or **Band-pass**, or give it an **LFO**.
• Add a **Reverb** (Hall) or a **Distortion** (Wavefold, Bitcrush) after the filter, and drag the cards to change the order.
• Readers hear → **Before**: the glow stops following the filter.
• Record a take and render it: the render's sound has the sweep as you played it.`,
  })),
  // A MIDI clip on the tape, in a scale, with Snap to scale on the rack.
  ex('pianoRollScale', glowGraph({ radius: 0.1, falloff: 10, tint: [0.4, 0.8, 1], mode: 'ring', ringFreq: 8, comment: 'The glow the notes swell: its Radius follows the Hits reader on the Tom keys rack.' }), play({
    audioEngine: {
      racks: [{
        id: 'keys', name: 'Tom keys', effects: [], keyboard: true, midi: '', channel: 0, volume: 1, mute: false, scaleLock: 'nearest',
        instrument: {
          id: 'inst', kind: 'granulator', sample: { synth: 'tom', name: 'Tom' },
          // By GR_PARAMS address: Classic mode, read from the start, short grains, pan random, a plucked
          // envelope (attack, decay, no sustain, release), Scan 1 (the sample at its own speed), root C4, level.
          params: { 0: 0, 1: 0, 3: 70, 9: 0.35, 17: 0.002, 18: 0.3, 19: 0, 20: 0.3, 23: 1, 31: 60, 33: 0.9 },
        },
      }],
    },
    arrangement: {
      length: 10, loop: true, bpm: 96, metronome: false, countIn: 0, fade: 0,
      tracks: { keys: { notes: PENTATONIC_RIFF, auto: {}, arm: true, clips: [{ t: 0, d: 10 }] } },
      scale: { on: true, root: 9, name: 'minorPentatonic' },
    },
    audioFx: { chains: { 'rack:keys': { on: true, effects: [afx('reverb', 'verb', { type: 'hall', size: 0.6, decay: 2.4, mix: 0.28 })] } } },
    audioReaders: { input: 'engine:keys', readers: [reader('hits', 'Hits', 160, 1.5, 30, 2, 160, [0.4, 0.8, 1])] },
    controls: [
      ctl('radius', 'circ::radius', 'Glow (the notes)', 0.05, 0.4),
      ctl('size', 'au:keys:inst::3', 'Tom keys · Grain size', 2, 2000, 1),
      ctl('decay', 'au:keys:inst::18', 'Tom keys · Decay', 0, 10),
    ],
    mappings: [map('glow', 'radius', { kind: 'reader', readerId: 'hits' }, 0.07, 0.3, { smoothMs: 25 })],
    notes: `**What it shows.** A **MIDI clip** on the Audio engine's tape: four bars of a riff in **A minor pentatonic**, with the tape's **Scale** set to that scale and **Snap to scale** on the rack, so whatever you play on the computer keyboard lands in the scale too. The notes swell the glow through an audio reader.

**How it's built.** One rack, **Tom keys**: a Granulator playing the generated tom (so no audio file comes with it) with a short, plucked envelope, through a hall reverb (Finish → Sound). The tape (Engine tab → Arrangement) holds one clip on its lane; the transport's Scale is **A Minor Pentatonic**, and the rack's **Snap to scale** is Nearest. The **Hits** reader listens to the rack and drives the glow's Radius.

**Try this.**
• Click the picture first (the browser starts sound on a click), then press **Play** on the transport.
• **Double-click the clip** to open the **piano roll**: the scale's rows are tinted. Drag notes, draw new ones (B), or select some and press **Fit to scale** under Functions.
• Play the computer keyboard (the rack's keyboard is on): any key you press is snapped to the nearest scale note. Set Snap to scale to Up or Down on the rack card, or change the Scale on the transport.
• Change the instrument's Sample to the pad chord or a Library sound (on the desktop app, any Audio Unit synth).`,
  })),
  // A Granulator in Spectral mode, its grains emitted or spread in time.
  ex('granulatorSpectral', glowGraph({ radius: 0.14, falloff: 10, tint: [0.75, 0.5, 1], comment: 'The glow follows how much energy the spectral grains carry (Grain energy, a sensor on the rack).' }), play({
    audioEngine: {
      racks: [{
        id: 'spec', name: 'Spectral', effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false,
        instrument: {
          id: 'inst', kind: 'granulator', sample: { synth: 'pad', name: 'Pad chord' },
          // Spectral mode, position, grain size, density, pan random, attack, release, drone, level,
          // Emit's travel (direction both, speed, spread, bounce), the band (centre, width, spread, travel,
          // both ways, bounce), partials, and Grains: Emit (0 on the line, 1 emit, 2 spread) with its Area.
          params: {
            0: 4, 1: 0.3, 3: 260, 5: 22, 9: 0.6, 17: 0.4, 20: 2, 28: 1, 33: 0.8,
            36: 2, 37: 0.12, 38: 0.3, 39: 1,
            40: 0.4, 41: 0.08, 42: 0.35, 43: 0.06, 44: 2, 45: 1, 47: 6, 49: 1, 50: 0.4,
          },
        },
      }],
    },
    audioFx: { chains: { 'rack:spec': { on: true, effects: [afx('reverb', 'verb', { type: 'hall', size: 0.8, decay: 4, mix: 0.35 })] } } },
    layers: [
      layer('null', 'g1', 'Grain 1', { x: 0.3, y: 0.5, size: 10 }),
      layer('null', 'g2', 'Grain 2', { x: 0.5, y: 0.5, size: 10 }),
      layer('null', 'g3', 'Grain 3', { x: 0.7, y: 0.5, size: 10 }),
      layer('null', 'g4', 'Grain 4', { x: 0.4, y: 0.5, size: 10 }),
    ],
    controls: [
      ctl('grains', 'au:spec:inst::49', 'Spectral · Grains (0 line, 1 emit, 2 spread)', 0, 2, 1),
      ctl('band', 'au:spec:inst::40', 'Spectral · Band', 0, 1),
      ctl('pos', 'au:spec:inst::1', 'Spectral · Position', 0, 1),
      ctl('radius', 'circ::radius', 'Glow (the grains’ energy)', 0.05, 0.4),
      ...[1, 2, 3, 4].flatMap(i => [ctl(`g${i}x`, `layer:g${i}::x`, `Grain ${i} · x`, 0, 1), ctl(`g${i}y`, `layer:g${i}::y`, `Grain ${i} · y`, 0, 1)]),
    ],
    mappings: [
      map('sweep', 'band', S.lfo('sine', 0.03), 0.2, 0.7, { smoothMs: 100 }),
      map('scan', 'pos', S.lfo('triangle', 0.017, 0.5), 0.1, 0.8, { smoothMs: 100 }),
      map('energy', 'radius', S.sensor('ae:spec', 'grainEnergySum'), 0.07, 0.32, { smoothMs: 60 }),
      ...[1, 2, 3, 4].flatMap(i => [
        map(`g${i}x`, `g${i}x`, S.sensor('ae:spec', 'grainPos', String(i)), 0.05, 0.95),
        map(`g${i}y`, `g${i}y`, S.sensor('ae:spec', 'grainBand', String(i)), 0.15, 0.85, { smoothMs: 40 }),
      ]),
    ],
    notes: `**What it shows.** The Granulator's **Spectral** mode: each grain plays a **band of frequencies** of the pad chord (its strongest partials, as sines) instead of a slice of time. With **Grains: Emit**, the grains are launched from Position and travel through the sample while they sound, so the chord's harmonics drift and smear. Four nulls show four grains: across is where in the sample a grain is, up is its band (low notes low, high notes high).

**How it's built.** One rack, **Spectral**: a Granulator on the generated **pad chord** (A minor), with **Drone** on so it sounds by itself, through a long hall reverb. Two slow LFOs move the Band and the Position. Sensors on the rack drive the picture: **Grain energy** swells the glow, and grains 1 to 4's place and band move the nulls.

**Try this.**
• Click the picture first: the browser starts sound on a click.
• Drag **Grains** to 2 (**Spread**): the grains scatter in an Area round Position instead; at 0 they all sit on the line.
• Engine tab → Spectral card: watch the spectrogram, change **Band width**, **Partials** or **Shift** (inharmonic, bell-like), or Band travel to make the bands climb.
• Turn Drone off and play it from a MIDI keyboard.`,
  })),
  // Particles in the graph listening to an Audio engine track.
  ex('particlesEngineTrack', engineParticlesGraph(), play({
    audioEngine: {
      racks: [{
        id: 'kick', name: 'Kick', effects: [], keyboard: false, midi: 'off', channel: 0, volume: 1, mute: false,
        instrument: {
          id: 'inst', kind: 'granulator', sample: { synth: 'kick', name: 'Kick' },
          // Classic mode from the start of the sample at its own speed (Scan 1), a short envelope, root C1.
          params: { 0: 0, 1: 0, 3: 150, 9: 0, 17: 0.001, 18: 0.35, 19: 0, 20: 0.12, 23: 1, 31: 36, 33: 1 },
        },
      }, {
        id: 'pad', name: 'Pad', effects: [], keyboard: false, midi: 'off', channel: 0, volume: 0.6, mute: false,
        instrument: {
          id: 'inst', kind: 'granulator', sample: { synth: 'pad', name: 'Pad chord' },
          // Cloud, position, spray, size, density, spread, pitch random, pan random, low-pass + cutoff, attack, release, scan LFO, drone, level.
          params: { 0: 2, 1: 0.35, 2: 0.12, 3: 140, 5: 28, 7: 7, 8: 0.15, 9: 0.7, 14: 1, 15: 4000, 17: 0.6, 20: 1.5, 24: 0.07, 25: 0.12, 28: 1, 33: 0.6 },
        },
      }],
    },
    arrangement: {
      length: 8, loop: true, bpm: 120, metronome: false, countIn: 0, fade: 0,
      tracks: { kick: { notes: KICK_PATTERN, auto: {}, arm: true, clips: [{ t: 0, d: 8 }] } },
    },
    notes: `**What it shows.** A **Particles** node in the graph listening to a track of the Play page's **Audio engine**. Its **Sound from** is **Engine track 1**, the Kick rack: every kick on the tape fires a shockwave ring through the field, and the travelling sound ripples it. A pad drone plays on track 2 for atmosphere; the particles don't hear it.

**How it's built.** The graph is a Particles node with the Sound field preset (a still disc of particles that sound moves). The Audio engine has two racks of generated sounds (no audio files): **Kick**, a Granulator on the generated kick, played by a two-bar clip on the tape; and **Pad**, a Granulator drone on the pad chord. In the graph, select the Particles node: Sound → **Sound from** picks the master or any track.

**Try this.**
• Click the picture first (the browser starts sound on a click), then press **Play** on the transport (Engine tab).
• Double-click the Kick clip to open the piano roll and add or move kicks: each one is a ring.
• Set Sound from to **Audio engine** (the master) and the pad joins in; or try the Launch preset on the node for a rocket's roar.`,
  })),
  // ─ Look effects you build: one from nodes, one from code ─
  ex('lookBuilt', fbmGraph({ scale: 2.4, timeScale: 0.1, preset: '3' }), play({
    layers: [layer('text', 'title', 'Title', { text: 'BUILT', y: 0.5, size: 0.2 })],
    finish: {
      on: true,
      effects: [
        graphFx(DUOTONE_GRAPH, 'duotone', 'Duotone (nodes)'),
        newCustomEffect({ name: 'Tape wobble (code)', code: WOBBLE_CODE }, 'wobble'),
      ],
    },
    controls: [
      ctl('duo', 'finish:duotone::opacity', 'Duotone · Opacity', 0, 1),
      ctl('wob', 'finish:wobble::amount', 'Tape wobble · Amount', 0, 0.05),
    ],
    mappings: [
      map('duoMouse', 'duo', S.mouse('x'), 0, 1, { smoothMs: 100 }),
      map('wobLfo', 'wob', S.lfo('sine', 0.15), 0.002, 0.03, { smoothMs: 60 }),
    ],
    notes: `**What it shows.** Two Look effects you make yourself: **Duotone (nodes)** is built from Studio nodes, **Tape wobble (code)** is written in GLSL. Both are ordinary effects in the stack: their settings are sliders and controls, they take a Where, and they render in exports.

**How it's built.** **Duotone** is a node graph (open it with **Edit nodes…** on its card): Effect inputs → **Luminance** (how bright each point is) → **Colorize** (that brightness painted violet to cream) → **Blend Modes** (soft-lit over the original picture; its Base is the Picture colour) → **Vignette** (its UV wired from the inputs' 0..1 UV) → Effect output. Every node slider became one of the effect's settings; mouse X drives its Opacity. **Tape wobble** is code (Open editor… on its card): each band of rows reads the picture slid sideways by a sine that moves with time; an LFO swells the slide.

**Try this.**
• Move the mouse left and right: the duotone fades in and out.
• Duotone → **Edit nodes…**, then **+ Add node → Posterize**: it goes in just before the output. Use **Update effect**.
• Tape wobble → **Open editor…** and change \`1.7\` to \`7.0\`: smaller, busier bands. Or + Add effect → **Nodes** for any single node (Hue Rotate, Tone Map, CRT Mask…).`,
  })),
  // The Agents group on the Play page (Agents P4): a hand steers a million particles, the engine's kick blasts them.
  ex('agentsHandBeat', handBeatNodes(), play({
    controls: [
      ctl('hx', `${HAND_EX.group}::${HAND_EX.attract}::handX`, 'Hand X', 0, 1),
      ctl('hy', `${HAND_EX.group}::${HAND_EX.attract}::handY`, 'Hand Y', 0, 1),
      ctl('pull', `${HAND_EX.group}::${HAND_EX.attract}::strength`, 'Hand strength', -3, 3),
      ctl('kick', `${HAND_EX.group}::${HAND_EX.kick}::strength`, 'Kick strength', 0, 2),
      ctl('burst', `${HAND_EX.emit}::burst`, 'Burst', 0, 1),
      ctl('again', `${HAND_EX.group}::restart`, 'Start over', 0, 1),
    ],
    pairs: [{ id: 'hand', label: 'Hand', a: 'hx', b: 'hy', position: true }],
    // The pointer first, then the hand: the later mapping wins once a hand has been seen (play/followHand.ts).
    pairMappings: [
      { id: 'byPointer', pairId: 'hand', source: { kind: 'position', anchor: 'pointer' }, affect: 'both', a: axis(0, 1, { smoothMs: 60 }), b: axis(0, 1, { smoothMs: 60 }), enabled: true },
      { id: 'byHand', pairId: 'hand', source: { kind: 'position', anchor: FOLLOW_HAND_ANCHOR }, affect: 'both', a: axis(0, 1, { smoothMs: 60 }), b: axis(0, 1, { smoothMs: 60 }), enabled: true },
    ],
    mappings: [
      map('fist', 'pull', S.trig(T.hand('any', 'fist'), 'envelope', { attack: 30, decay: 10, sustain: 1, release: 250 }), 1.2, -2.5),
      map('keyB', 'burst', S.trig(T.key('KeyB'), 'envelope', { attack: 0, decay: 10, sustain: 1, release: 50 }), 0, 1),
      map('keyR', 'again', S.trig(T.key('KeyR'), 'envelope', { attack: 0, decay: 10, sustain: 1, release: 50 }), 0, 1),
    ],
    audioEngine: {
      racks: [{
        id: 'kick', name: 'Kick', effects: [], keyboard: false, midi: 'off', channel: 0, volume: 1, mute: false,
        instrument: {
          id: 'inst', kind: 'granulator', sample: { synth: 'kick', name: 'Kick' },
          // Classic mode from the start of the sample at its own speed (Scan 1), a short envelope, root C1.
          params: { 0: 0, 1: 0, 3: 150, 9: 0, 17: 0.001, 18: 0.35, 19: 0, 20: 0.12, 23: 1, 31: 36, 33: 1 },
        },
      }],
    },
    arrangement: {
      length: 8, loop: true, bpm: 120, metronome: false, countIn: 0, fade: 0,
      tracks: { kick: { notes: KICK_PATTERN, auto: {}, arm: true, clips: [{ t: 0, d: 8 }] } },
    },
    notes: `**What it shows.** A Studio **Agents group** played from the Play page: a million particles that your hand steers, while the **Audio engine**'s kick track blasts shockwaves through them. No camera? The pointer over the picture steers them until a hand is seen.

**How it's built.** The graph (Studio) is the **Hand swarm** group: inside, Home → **Sound kick** → Curl noise → **Attract / Repel** → Integrate, drawn as neon streaks. Every node has a note (the speech-bubble tab on its card). The group's **Sound from** is **Engine track 1**, so every Sound kick inside hears the **Kick** rack, whose clip on the tape plays a two-bar kick pattern at 120 bpm. Attract's Target is **A hand or null**: its **Hand X / Y** (0–1 across and up the picture) are Play controls.

**The controls.**
• **Hand X / Hand Y**: where the hand pulls, paired as one position (**Hand**). Two pair mappings drive it: **the pointer** over the picture, then **a hand's index fingertip** (either hand). The hand's mapping comes second, so once a hand has been seen it wins.
• **Hand strength**: how hard the hand pulls (negative pushes). A mapping from the **fist** gesture sends it to −2.5 while you hold a fist: open hand gathers, fist scatters.
• **Kick strength**: how hard each kick's shockwave pushes.
• **Burst**: Emit's Burst. A mapping from **B** fires it: everyone is born again at once, where they are born.
• **Start over**: the group's own Start over (the card's ↺ as a trigger). A mapping from **R** fires it: the simulation begins again at step 0.

**The rules.** Fist → Hand strength (an envelope that holds while the fist does), B → Burst, R → Start over. All three are mappings from trigger sources, so you can re-point them in Mappings (a beat, a pad, a MIDI note, a gesture).

**Try this.**
• Move the pointer over the picture: the swarm gathers and swirls round it. Press B for a fresh cloud, R to start over.
• Click the picture, then press **Play** on the Engine tab's transport: each kick blasts a ring out of the middle. Press **Enable hand tracking** on the picture and raise a hand.
• In Studio, set the group's Sound from to **Level (and Beat)** and Beat to 120 for a silent stand-in kick. Right-click any slider inside the group → **Pin to the group card**, or **Follow a hand in Play** on a Hand X.`,
  })),
];

export const PLAY_EXAMPLE_GRAPHS: Record<string, ExampleGraph> = Object.fromEntries(
  LIST.map(e => [e.key, { ...PLAY_EXAMPLE_INDEX[e.key], counter: 20, nodes: e.nodes, play: e.play }]),
);
