/**
 * scales.ts — Live's scales (Ableton Live 12's Scale menu) and the snap that
 * puts a note in key (docs/piano-roll-plan.md): an out-of-scale note goes to
 * the nearest note of the scale, ties going down, as Live does; or always up,
 * or always down. Pure.
 */

export interface ScaleDef { id: string; name: string; steps: readonly number[] }

/** In Live's order. Steps are semitones above the root. */
export const SCALES: readonly ScaleDef[] = [
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'phrygian', name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'locrian', name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
  { id: 'wholeTone', name: 'Whole Tone', steps: [0, 2, 4, 6, 8, 10] },
  { id: 'halfWholeDim', name: 'Half-whole Dim.', steps: [0, 1, 3, 4, 6, 7, 9, 10] },
  { id: 'wholeHalfDim', name: 'Whole-half Dim.', steps: [0, 2, 3, 5, 6, 8, 9, 11] },
  { id: 'minorBlues', name: 'Minor Blues', steps: [0, 3, 5, 6, 7, 10] },
  { id: 'minorPentatonic', name: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'majorPentatonic', name: 'Major Pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'harmonicMinor', name: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'harmonicMajor', name: 'Harmonic Major', steps: [0, 2, 4, 5, 7, 8, 11] },
  { id: 'dorianSharp4', name: 'Dorian #4', steps: [0, 2, 3, 6, 7, 9, 10] },
  { id: 'phrygianDominant', name: 'Phrygian Dominant', steps: [0, 1, 4, 5, 7, 8, 10] },
  { id: 'melodicMinor', name: 'Melodic Minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'lydianAugmented', name: 'Lydian Augmented', steps: [0, 2, 4, 6, 8, 9, 11] },
  { id: 'lydianDominant', name: 'Lydian Dominant', steps: [0, 2, 4, 6, 7, 9, 10] },
  { id: 'superLocrian', name: 'Super Locrian', steps: [0, 1, 3, 4, 6, 8, 10] },
  { id: 'spanish8', name: '8-Tone Spanish', steps: [0, 1, 3, 4, 5, 6, 8, 10] },
  { id: 'bhairav', name: 'Bhairav', steps: [0, 1, 4, 5, 7, 8, 11] },
  { id: 'hungarianMinor', name: 'Hungarian Minor', steps: [0, 2, 3, 6, 7, 8, 11] },
  { id: 'hirajoshi', name: 'Hirajoshi', steps: [0, 2, 3, 7, 8] },
  { id: 'inSen', name: 'In-Sen', steps: [0, 1, 5, 7, 10] },
  { id: 'iwato', name: 'Iwato', steps: [0, 1, 5, 6, 10] },
  { id: 'kumoi', name: 'Kumoi', steps: [0, 2, 3, 7, 9] },
  { id: 'pelogSelisir', name: 'Pelog Selisir', steps: [0, 1, 3, 7, 8] },
  { id: 'pelogTembung', name: 'Pelog Tembung', steps: [0, 1, 5, 7, 8] },
  { id: 'messiaen3', name: 'Messiaen 3', steps: [0, 2, 3, 4, 6, 7, 8, 10, 11] },
  { id: 'messiaen4', name: 'Messiaen 4', steps: [0, 1, 2, 5, 6, 7, 8, 11] },
  { id: 'messiaen5', name: 'Messiaen 5', steps: [0, 1, 5, 6, 7, 11] },
  { id: 'messiaen6', name: 'Messiaen 6', steps: [0, 2, 4, 5, 6, 8, 10, 11] },
  { id: 'messiaen7', name: 'Messiaen 7', steps: [0, 1, 2, 3, 5, 6, 7, 8, 9, 11] },
  { id: 'chromatic', name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];
const BY_ID = new Map(SCALES.map(s => [s.id, s]));

/** A scale by id (Major when unknown). */
export function scaleOf(id: string): ScaleDef { return BY_ID.get(id) ?? SCALES[0]; }

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Is this note in the scale on `root` (0 = C … 11 = B)? */
export function inScale(note: number, id: string, root: number): boolean {
  return scaleOf(id).steps.includes((((note - root) % 12) + 12) % 12);
}

export type SnapMode = 'nearest' | 'up' | 'down';

/** A note put in the scale: itself when in it, else the nearest scale note (ties go down), or the next up or down. Kept within 0–127. */
export function snapNote(note: number, id: string, root: number, mode: SnapMode = 'nearest'): number {
  const n = Math.max(0, Math.min(127, Math.round(note)));
  if (inScale(n, id, root)) return n;
  for (let d = 1; d <= 12; d++) {
    const down = n - d, up = n + d;
    if (mode !== 'up' && down >= 0 && inScale(down, id, root)) return down;
    if (mode !== 'down' && up <= 127 && inScale(up, id, root)) return up;
  }
  return n;
}
