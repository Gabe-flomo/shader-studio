/**
 * play.ts — the "instrument" a graph carries for the Play page: which params
 * are exposed as controls, and how live inputs (MIDI, mouse, keys) map onto
 * params. Saved with the graph under the top-level `play` key. Nothing here
 * edits the graph; mappings only write uniforms through the input bus.
 */

export type PlayCurve = 'linear' | 'exp' | 'log';

export type MidiChannelKind = 'note' | 'velocity' | 'gate' | 'bend' | 'cc';

export type PlaySource =
  /** A MIDI stream from the engine. `midiChannel` 0 = all channels. `cc` only for kind 'cc'. */
  | { kind: 'midi'; channel: MidiChannelKind; cc?: number; midiChannel?: number }
  /** Pointer position across the window, 0..1 (y up). */
  | { kind: 'mouse'; axis: 'x' | 'y' }
  /** A keyboard key held (1) or not (0), by `KeyboardEvent.code`. */
  | { kind: 'key'; code: string };

export interface PlayTarget {
  nodeId: string;
  paramKey: string;
}

export interface PlayControl {
  id: string;
  target: PlayTarget;
  /** Overrides the node/param label on the panel. */
  label?: string;
  min: number;
  max: number;
}

export interface PlayMapping {
  id: string;
  source: PlaySource;
  target: PlayTarget;
  /** Input range that maps onto outMin..outMax; values outside are clamped. */
  inMin: number;
  inMax: number;
  outMin: number;
  outMax: number;
  curve: PlayCurve;
  smoothMs: number;
  enabled: boolean;
}

export interface PlayInstrument {
  version: 1;
  controls: PlayControl[];
  mappings: PlayMapping[];
}

export const EMPTY_PLAY: PlayInstrument = { version: 1, controls: [], mappings: [] };

export function playTargetKey(t: PlayTarget): string {
  return `${t.nodeId}::${t.paramKey}`;
}

/** Default input range for a source: what the engine actually emits. */
export function sourceRange(s: PlaySource): [number, number] {
  if (s.kind === 'midi' && s.channel === 'bend') return [-1, 1];
  return [0, 1];
}

export function describeSource(s: PlaySource): string {
  switch (s.kind) {
    case 'midi': {
      const ch = s.midiChannel && s.midiChannel > 0 ? ` ch${s.midiChannel}` : '';
      if (s.channel === 'cc') return `MIDI CC ${s.cc ?? 1}${ch}`;
      const names: Record<Exclude<MidiChannelKind, 'cc'>, string> = { note: 'MIDI note', velocity: 'MIDI velocity', gate: 'MIDI gate', bend: 'Pitch bend' };
      return `${names[s.channel]}${ch}`;
    }
    case 'mouse': return `Mouse ${s.axis.toUpperCase()}`;
    case 'key':   return `Key ${s.code.replace(/^Key|^Digit/, '')}`;
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function sanitizeTarget(raw: unknown): PlayTarget | null {
  const t = raw as Partial<PlayTarget> | null;
  if (!t || typeof t.nodeId !== 'string' || typeof t.paramKey !== 'string') return null;
  return { nodeId: t.nodeId, paramKey: t.paramKey };
}

function sanitizeSource(raw: unknown): PlaySource | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s !== 'object') return null;
  if (s.kind === 'midi') {
    const channel = s.channel;
    if (channel !== 'note' && channel !== 'velocity' && channel !== 'gate' && channel !== 'bend' && channel !== 'cc') return null;
    return {
      kind: 'midi', channel,
      ...(channel === 'cc' ? { cc: Math.max(0, Math.min(127, Math.round(num(s.cc, 1)))) } : {}),
      ...(num(s.midiChannel, 0) > 0 ? { midiChannel: Math.min(16, Math.round(num(s.midiChannel, 0))) } : {}),
    };
  }
  if (s.kind === 'mouse') return { kind: 'mouse', axis: s.axis === 'y' ? 'y' : 'x' };
  if (s.kind === 'key' && typeof s.code === 'string') return { kind: 'key', code: s.code };
  return null;
}

/** Load a `play` record from a graph file, dropping anything malformed. */
export function sanitizePlay(raw: unknown): PlayInstrument {
  const p = raw as Partial<PlayInstrument> | null;
  if (!p || typeof p !== 'object') return EMPTY_PLAY;
  const controls: PlayControl[] = [];
  for (const c of Array.isArray(p.controls) ? p.controls : []) {
    const target = sanitizeTarget((c as PlayControl)?.target);
    if (!target || typeof (c as PlayControl).id !== 'string') continue;
    const cc = c as PlayControl;
    controls.push({ id: cc.id, target, ...(typeof cc.label === 'string' ? { label: cc.label } : {}), min: num(cc.min, 0), max: num(cc.max, 1) });
  }
  const mappings: PlayMapping[] = [];
  for (const m of Array.isArray(p.mappings) ? p.mappings : []) {
    const mm = m as PlayMapping;
    const target = sanitizeTarget(mm?.target);
    const source = sanitizeSource(mm?.source);
    if (!target || !source || typeof mm.id !== 'string') continue;
    const [lo, hi] = sourceRange(source);
    mappings.push({
      id: mm.id, source, target,
      inMin: num(mm.inMin, lo), inMax: num(mm.inMax, hi),
      outMin: num(mm.outMin, 0), outMax: num(mm.outMax, 1),
      curve: mm.curve === 'exp' || mm.curve === 'log' ? mm.curve : 'linear',
      smoothMs: Math.max(0, num(mm.smoothMs, 0)),
      enabled: mm.enabled !== false,
    });
  }
  return { version: 1, controls, mappings };
}
