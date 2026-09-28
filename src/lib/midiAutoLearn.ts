/**
 * midiAutoLearn.ts — a new MIDI CC mapping starts unassigned (its source has
 * no `cc`), and the first knob that moves on any enabled device becomes its
 * CC and channel. Before this a fresh row sat on CC 1, which most knobs never
 * send, so it looked broken until it was locked.
 *
 * Also the "listening" claim: a row waiting for a knob or a key on its own
 * (Learn, Change…, Lock, Set range, the pad grid's Learn) takes a claim, and
 * auto-learn stands aside while one is held, so one turn of a knob can't both
 * lock row A and assign row B. A rack holding the computer keyboard
 * (lib/keyboardClaim.ts) pauses it too.
 *
 * No React: the Play page starts it with its mappings and an update callback,
 * and tests drive it with `midiEngine.handleBytes`.
 */
import { midiEngine, type MidiEvent } from './midiEngine';
import { keyboardClaimed } from './keyboardClaim';
import type { MidiLock, PlayMapping, PlaySource } from '../types/play';
import { MIDI_LOCKS_MAX } from '../types/playMidi';

// ── The listening claim ───────────────────────────────────────────────────────

let claims = 0;
const claimListeners = new Set<() => void>();

/** Take the MIDI input for a row that waits for the next knob or key. Returns the release. */
export function claimMidiListen(): () => void {
  let held = true;
  claims++;
  for (const l of claimListeners) l();
  return () => {
    if (!held) return;
    held = false;
    claims--;
    for (const l of claimListeners) l();
  };
}

/** Is a row (or the Learn button) waiting for the next input on its own? */
export function midiListenClaimed(): boolean {
  return claims > 0;
}

export function onMidiListenClaim(l: () => void): () => void {
  claimListeners.add(l);
  return () => { claimListeners.delete(l); };
}

// ── Assignment ────────────────────────────────────────────────────────────────

/** A CC mapping source that hasn't been given its knob yet. */
export function isUnassignedCc(source: PlaySource): boolean {
  return source.kind === 'midi' && source.signal === 'cc' && source.cc === undefined && !source.locks?.length;
}

/** The source with the knob from a CC message: its CC, and its channel unless the row already names one. */
export function assignCc(source: PlaySource, e: { channel: number; cc: number }): PlaySource {
  if (source.kind !== 'midi') return source;
  return { ...source, signal: 'cc', cc: e.cc & 127, channel: source.channel || e.channel };
}

/**
 * A CC source with these locks. The first lock's CC becomes the row's, so
 * unlocking everything leaves the row on the knob it was locked to (from any
 * device again).
 */
export function withCcLocks<S extends Extract<PlaySource, { kind: 'midi' }>>(source: S, next: MidiLock[]): S {
  const { locks: _drop, ...rest } = source;
  void _drop;
  return (next.length ? { ...rest, locks: next.slice(0, MIDI_LOCKS_MAX), cc: next[0].cc } : rest) as S;
}

/** The assignment made last, for the row's highlight ("that's the knob you turned"). */
export interface MidiAssignment {
  mappingId: string;
  cc: number;
  channel: number;
  device: string;
  at: number;
}

/** A knob keeps sending while it turns: the same CC doesn't claim a second unassigned row within this. */
const SAME_KNOB_MS = 1500;
/** How long a row shows its new knob as "just assigned". */
export const ASSIGN_FLASH_MS = 1400;

let last: MidiAssignment | null = null;
const assignListeners = new Set<(a: MidiAssignment) => void>();

export function lastMidiAssignment(): MidiAssignment | null {
  return last;
}

export function onMidiAssignment(l: (a: MidiAssignment) => void): () => void {
  assignListeners.add(l);
  return () => { assignListeners.delete(l); };
}

export interface AutoLearnOptions {
  /** The current mappings (read on each message, so a fresh row is seen at once). */
  mappings: () => readonly PlayMapping[];
  /** Write the assigned source onto a mapping. */
  assign: (mappingId: string, source: PlaySource) => void;
  /** Extra reason to stand aside (a Learn in progress); the listening and keyboard claims are checked anyway. */
  paused?: () => boolean;
  now?: () => number;
}

/**
 * Listen for CCs and hand each one to the first unassigned CC mapping. One
 * knob per row: the same CC turning on can't fill several rows at once, and
 * nothing happens while a row listens on its own or a rack has the keyboard.
 * Returns the stop function.
 */
export function startMidiAutoLearn(opts: AutoLearnOptions): () => void {
  const now = opts.now ?? Date.now;
  return midiEngine.subscribe((e: MidiEvent) => {
    if (e.kind !== 'cc') return;
    if (midiListenClaimed() || keyboardClaimed() || opts.paused?.()) return;
    const row = opts.mappings().find(m => isUnassignedCc(m.source));
    if (!row) return;
    const at = now();
    const device = e.device ?? '';
    if (last && last.cc === e.cc && last.channel === e.channel && last.device === device && at - last.at < SAME_KNOB_MS && last.mappingId !== row.id) {
      last = { ...last, at };
      return;
    }
    last = { mappingId: row.id, cc: e.cc & 127, channel: e.channel, device, at };
    opts.assign(row.id, assignCc(row.source, e));
    for (const l of assignListeners) l(last);
  });
}

/** For tests: forget the last assignment. */
export function resetMidiAutoLearn(): void {
  last = null;
}
