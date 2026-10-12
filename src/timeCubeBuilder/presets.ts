/**
 * presets.ts — the Time Cube builder's presets (docs/timecube-builder.md): the looks of the Time Cube and Frame Stack
 * example folders, read straight from those examples (store/timeCubeExamples.ts, store/frameStackExamples.ts), so a
 * preset is exactly the example's settings: its Time Cube's frames, its View's or Frame Stack's params, and the LFO it
 * wires into one of their sockets. Your video (and its clip) stays. Pure.
 */
import type { GraphNode } from '../types/nodeGraph';
import { buildTimeCubeExamples } from '../store/timeCubeExamples';
import { buildFrameStackExamples } from '../store/frameStackExamples';
import { blankSpec, defaultsOf, specParams, type Params, type TcDisplay, type TcDrive, type TimeCubeSpec } from './spec';

export interface TcPreset {
  key: string;
  label: string;
  blurb: string;
  /** The example it comes from. */
  example: string;
  display: TcDisplay;
}

export const TC_PRESETS: readonly TcPreset[] = [
  { key: 'box', label: 'Box of time', blurb: 'A soft, rounded box of frames; the slice sweeps through time, the past see-through.', example: 'timeCubeBox', display: 'cube' },
  { key: 'pill', label: 'Soft pill', blurb: 'A pastel pill on white, seen flat, the video playing on its face.', example: 'timeCubeSoftPill', display: 'cube' },
  { key: 'highlights', label: 'Highlights loop', blurb: 'Six outlined frames lifted out of the box, travelling with the slice.', example: 'timeCubeHighlights', display: 'cube' },
  { key: 'flow', label: 'Flow', blurb: 'The video flows through the box past a fixed frame; frames lift as they pass.', example: 'timeCubeFlow', display: 'cube' },
  { key: 'key', label: 'Isolate a colour', blurb: 'The amber balls kept as solid trails through time; the rest a grey ghost.', example: 'timeCubeKey', display: 'cube' },
  { key: 'exposure', label: 'Long exposure', blurb: 'Each frame the brightest of six: light trails, sorted by brightness.', example: 'timeCubeLongExposure', display: 'cube' },
  { key: 'iso', label: 'Isometric cards', blurb: 'The frames as a long diagonal stack of cards; the scan lifts one out.', example: 'frameStackIsometric', display: 'stack' },
  { key: 'ring', label: 'Ring of frames', blurb: 'Cards on edge round a ring, white borders, the camera circling.', example: 'frameStackRing', display: 'stack' },
  { key: 'drift', label: 'Drift apart', blurb: 'A neat stack that comes apart and gathers again (an LFO on Spread).', example: 'frameStackDrift', display: 'stack' },
  { key: 'morph', label: 'Stack to ring', blurb: 'The cards fold from a stack into a ring and back, one after another.', example: 'frameStackMorph', display: 'stack' },
];

/** The video and clip settings that are yours, kept by a preset. */
export const SOURCE_KEEP = ['source', 'videoId', 'fileName', '_meta', 'segments', 'clip'] as const;

let examples: Record<string, { nodes: GraphNode[] }> | null = null;
const allExamples = () => (examples ??= { ...buildTimeCubeExamples(), ...buildFrameStackExamples() });

const made = new Map<string, TimeCubeSpec>();

/** A preset's scene, as its example has it (on the Ball action clip). */
export function presetSpec(key: string): TimeCubeSpec {
  if (!made.has(key)) made.set(key, readPreset(key));
  return structuredClone(made.get(key)!);
}

function readPreset(key: string): TimeCubeSpec {
  const p = TC_PRESETS.find(x => x.key === key);
  const spec = blankSpec(p?.display ?? 'cube');
  const g = p ? allExamples()[p.example] : undefined;
  if (!p || !g) return spec;
  const nodes = g.nodes;
  const src = nodes.find(n => n.type === 'timeCube');
  const shown = nodes.find(n => n.type === (p.display === 'cube' ? 'timeCubeView' : 'frameStack'));
  if (src) spec.source = { ...defaultsOf('source'), ...specParams(src.params) };
  if (shown) {
    const params: Params = { ...defaultsOf(p.display === 'cube' ? 'view' : 'stack'), ...specParams(shown.params) };
    if (p.display === 'cube') spec.view = params; else spec.stack = params;
    // The LFO the example wires into one of the display's sockets.
    const wired = Object.entries(shown.inputs).find(([, s]) => s.connection && nodes.find(n => n.id === s.connection!.nodeId)?.type === 'lfo');
    const lfo = wired ? nodes.find(n => n.id === wired[1].connection!.nodeId) : undefined;
    spec.drive = lfo && wired
      ? { on: true, target: wired[0], waveform: String(lfo.params.waveform ?? 'sine') as TcDrive['waveform'], freq: Number(lfo.params.freq ?? 1), offset: Number(lfo.params.offset ?? 0), amplitude: Number(lfo.params.amplitude ?? 1) }
      : { ...spec.drive, on: false, target: p.display === 'cube' ? 'slice' : 'scan' };
  }
  return spec;
}

/** `spec` with preset `key`'s look: its display, its settings and its LFO. Your video and clip stay; the other display's settings stay. */
export function withPreset(spec: TimeCubeSpec, key: string): TimeCubeSpec {
  const made = presetSpec(key);
  const source = { ...made.source };
  for (const k of SOURCE_KEEP) { if (k in spec.source) source[k] = structuredClone(spec.source[k]); else delete source[k]; }
  return {
    ...made, source,
    view: made.display === 'cube' ? made.view : structuredClone(spec.view),
    stack: made.display === 'stack' ? made.stack : structuredClone(spec.stack),
  };
}

/** The preset the scene is now (its display's settings and its LFO as the preset made them), or null. */
export function presetNow(spec: TimeCubeSpec): string | null {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const p of TC_PRESETS) {
    if (p.display !== spec.display) continue;
    const m = presetSpec(p.key);
    const role = p.display === 'cube' ? 'view' : 'stack';
    if (same(m[role], spec[role]) && same(m.drive, spec.drive)) return p.key;
  }
  return null;
}
