/**
 * notes.ts — Play notes, the pure part (implementation guide 8): what a rule's
 * Play notes reaction sends a rack each time it fires, as MIDI bytes at
 * offsets in ms (each note-on with its note-off `lengthMs` later).
 *
 *   chord    every note at once
 *   strum    every note, `gapMs` apart, low to high
 *   arp      the next note of the list each time it fires (round and round)
 *   random   one note of the list, picked at random
 *
 * Velocity strays by up to `velRandom` of itself; notes snap to a scale when
 * one is set. `rng` is passed in so a take or a test replays the same.
 */
import type { NotesScale, NotesSpec } from '../types/play';

export interface NoteEvent { atMs: number; bytes: [number, number, number] }

const SCALES: Record<NotesScale, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
};

/** A note moved to the nearest one in the scale (ties go down). */
export function snapToScale(note: number, scale: NotesScale, root: number): number {
  if (scale === 'chromatic') return note;
  const steps = SCALES[scale];
  for (let d = 0; d <= 6; d++) {
    for (const n of [note - d, note + d]) if (n >= 0 && n <= 127 && steps.includes((((n - root) % 12) + 12) % 12)) return n;
  }
  return note;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** "C4 E4 G4 · strum": a Play notes reaction in words. */
export function notesSummary(s: NotesSpec): string {
  const names = s.notes.length ? s.notes.map(noteName).join(' ') : 'no notes yet';
  return `${names} · ${s.play}`;
}

/**
 * The events for one firing. `count`: how many times it has fired before
 * (arp walks the list with it); `channel` 0..15.
 */
export function noteEvents(s: NotesSpec, count: number, rng: () => number, channel = 0): NoteEvent[] {
  if (!s.notes.length) return [];
  const notes = [...new Set(s.notes.map(n => snapToScale(n, s.scale, s.root)))].sort((a, b) => a - b);
  const pick = s.play === 'arp' ? [notes[((count % notes.length) + notes.length) % notes.length]]
    : s.play === 'random' ? [notes[Math.min(notes.length - 1, Math.floor(rng() * notes.length))]]
    : notes;
  const out: NoteEvent[] = [];
  pick.forEach((n, i) => {
    const at = s.play === 'strum' ? i * s.gapMs : 0;
    const vel = Math.max(1, Math.min(127, Math.round(s.velocity * (1 + (rng() * 2 - 1) * s.velRandom))));
    out.push({ atMs: at, bytes: [0x90 | channel, n, vel] });
    out.push({ atMs: at + s.lengthMs, bytes: [0x80 | channel, n, 0] });
  });
  return out.sort((a, b) => a.atMs - b.atMs);
}
