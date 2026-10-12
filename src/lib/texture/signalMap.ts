/**
 * signalMap.ts — the webcam Texture node's quick map mode (docs/texture-node.md, "Map mode"):
 * the card shows the hand signals as live chips; a click on one starts map mode, and a click on
 * any slider in the graph maps that signal onto it. The slider becomes a Play control (unless it
 * already is one) with a mapping from the signal across its whole range, through the same
 * wiring Play's mini mapper uses (miniMapperCore wireSource → layerOps mapSourceTo). Editing the
 * mapping stays in Play → Mappings.
 *
 * Pure apart from the small UI store at the bottom. Any PlaySource works, so face and body
 * chips can join the hands later without changing the wiring.
 */
import { create } from 'zustand';
import type { GraphNode } from '../../types/nodeGraph';
import type { HandRead, PlayControl, PlayMapping, PlayRecord, PlaySource } from '../../types/play';
import { candidateFor, collectPlayCandidates } from '../../play/playControls';
import { handSourceLabel, sourceLabel } from '../../play/playSources';
import { wireSource } from '../../components/play/miniMapperCore';

/** Hands jitter a little: a touch more smoothing than a knob's 60 ms. Play → Mappings changes it. */
export const SIGNAL_SMOOTH_MS = 120;

export interface SignalChip {
  /** Unique per signal (its label). */
  key: string;
  /** Short: "Pinch", "Palm X", "Left · Openness". */
  label: string;
  source: PlaySource;
}

const hand = (read: HandRead, extra: { point?: number; axis?: 'x' | 'y' | 'z' } = {}): PlaySource =>
  ({ kind: 'hand', side: 'any', read, point: extra.point ?? 8, axis: extra.axis ?? 'x', gesture: 'fist' });

/** The everyday hand signals, on either hand (the right one when it's in view). */
export const DEFAULT_HAND_SOURCES: readonly PlaySource[] = [
  hand('pinch', { point: 8 }),
  hand('open'),
  hand('palm', { axis: 'x' }),
  hand('palm', { axis: 'y' }),
  hand('roll'),
  hand('size'),
];

/** A chip's label: the source's own words, without "Either hand · " in front. */
export function signalLabel(s: PlaySource): string {
  if (s.kind === 'hand') return handSourceLabel(s).replace(/^Either hand · /, '');
  return sourceLabel(s);
}

/** The chips: the everyday hand signals, then any other hand signal the setup already maps. */
export function handSignalChips(play: PlayRecord): SignalChip[] {
  const out: SignalChip[] = [];
  const add = (source: PlaySource) => {
    if (source.kind !== 'hand') return;
    const label = signalLabel(source);
    if (!out.some(c => c.key === label)) out.push({ key: label, label, source });
  };
  for (const s of DEFAULT_HAND_SOURCES) add(s);
  for (const m of play.mappings) add(m.source);
  for (const s of play.sources ?? []) add(s.source);
  return out;
}

export type SignalMapResult =
  | { ok: true; play: PlayRecord; control: PlayControl; mapping: PlayMapping; reused: boolean }
  | { ok: false; reason: string };

/**
 * Map `source` onto one node's slider (`paramKey` as the card's row names it: a group card's
 * row carries its inner node, "inner::radius"). The control is made unless the slider already
 * is one, then a mapping across its whole range with SIGNAL_SMOOTH_MS of smoothing.
 */
export function mapSignalOnto(play: PlayRecord, nodes: GraphNode[], paramBindings: Record<string, string>, source: PlaySource, nodeId: string, paramKey: string): SignalMapResult {
  const c = candidateFor(collectPlayCandidates(nodes, paramBindings), nodeId, paramKey);
  if (!c) return { ok: false, reason: 'That one can’t be a Play control (it may be wired, or not a number).' };
  if (c.kind !== 'float') return { ok: false, reason: 'A colour can’t follow a single signal: pick a number slider.' };
  const reused = play.controls.some(x => x.target === c.target);
  const r = wireSource(play, source, { candidate: c }, SIGNAL_SMOOTH_MS);
  if (!r.control || !r.mapping) return { ok: false, reason: 'Couldn’t make the mapping.' };
  return { ok: true, play: r.play, control: r.control, mapping: r.mapping, reused };
}

/** "Pinch → Circle radius mapped · edit in Play". */
export function mappedMessage(signal: string, control: string): string {
  return `${signal} → ${control} mapped · edit in Play`;
}

/** Map mode's UI state: the signal waiting for a slider, or none. */
interface SignalMapState {
  chip: SignalChip | null;
  start: (chip: SignalChip) => void;
  /** A second click on the same chip leaves map mode; another chip switches to it. */
  toggle: (chip: SignalChip) => void;
  stop: () => void;
}

export const useSignalMap = create<SignalMapState>((set, get) => ({
  chip: null,
  start: chip => set({ chip }),
  toggle: chip => set({ chip: get().chip?.key === chip.key ? null : chip }),
  stop: () => set({ chip: null }),
}));
