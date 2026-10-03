/**
 * pianoRoll.ts — the piano roll's grid and its note operations
 * (docs/piano-roll.md, docs/piano-roll-plan.md phases 3–5), modelled on
 * Ableton Live's MIDI editor. Pure: the editor (components/play/engine/
 * PianoRoll.tsx) draws and handles the pointer; everything that changes notes
 * is here, so it's tested.
 *
 * Notes stay `{ t, n, v, d }` in seconds on the tape (types/playArrangement.ts);
 * the grid comes from the tape's BPM in 4/4. An operation takes the track's
 * notes (sorted) and the selection (indices into them) and returns the new
 * notes, sorted, and where the edited notes are now (the new selection).
 */
import { NOTE_MIN, TAPE_MAX_SECONDS, beatSeconds, type ArrNote } from '../types/playArrangement';
import { inScale, snapNote } from './scales';

/** What an operation returns: the notes, sorted, and the selection (indices into them). */
export interface NoteEdit { notes: ArrNote[]; sel: number[] }

// ── The grid ────────────────────────────────────────────────────────────────

/** Fixed grid divisions, as fractions of a whole note (a 4/4 bar). */
export const GRID_DIVS = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32'] as const;
export type GridDiv = 'adaptive' | 'off' | (typeof GRID_DIVS)[number];
export interface GridSetting {
  div: GridDiv;
  triplet: boolean;
  /** Adaptive only: how close the lines may get (px); ⌘1 halves it, ⌘2 doubles it. */
  minPx: number;
}
export const DEFAULT_GRID: GridSetting = { div: 'adaptive', triplet: false, minPx: 24 };

const divFraction = (d: (typeof GRID_DIVS)[number]) => 1 / Number(d.split('/')[1]);

/**
 * The grid step in seconds at `bpm`, zoomed to `pxPerSec`: a fixed division,
 * or (adaptive) the finest power-of-two division at least `minPx` wide, from
 * 1/32 up to 8 bars. Triplets are ⅔ as long. 0: the grid is off.
 */
export function gridStep(g: GridSetting, bpm: number, pxPerSec: number): number {
  if (g.div === 'off') return 0;
  const whole = beatSeconds(bpm) * 4;
  const tri = g.triplet ? 2 / 3 : 1;
  if (g.div !== 'adaptive') return whole * divFraction(g.div) * tri;
  let f = 1 / 32;
  while (f < 8 && whole * f * tri * pxPerSec < g.minPx) f *= 2;
  return whole * f * tri;
}

/** ⌘1 (narrower, `by` -1) and ⌘2 (wider, +1): the next fixed division, or the adaptive grid's density. */
export function stepGrid(g: GridSetting, by: -1 | 1): GridSetting {
  if (g.div === 'adaptive') return { ...g, minPx: Math.max(4, Math.min(128, by < 0 ? g.minPx / 2 : g.minPx * 2)) };
  if (g.div === 'off') return g;
  const i = GRID_DIVS.indexOf(g.div);
  return { ...g, div: GRID_DIVS[Math.max(0, Math.min(GRID_DIVS.length - 1, i - by))] };
}

/** A time on the grid (`step` 0: as is). */
export const snapTime = (t: number, step: number) => (step > 0 ? r6(Math.round(t / step) * step) : r6(t));

/** A short label for a grid step ("1/16", "1/8T", "2 bars"). */
export function gridLabel(step: number, bpm: number, triplet: boolean): string {
  if (!(step > 0)) return 'Off';
  const whole = beatSeconds(bpm) * 4;
  const f = step / whole / (triplet ? 2 / 3 : 1);
  if (f >= 1) return f === 1 ? '1 bar' : `${Math.round(f)} bars`;
  return `1/${Math.round(1 / f)}${triplet ? 'T' : ''}`;
}

// ── Rows (pitch) ────────────────────────────────────────────────────────────

export type FoldMode = 'none' | 'notes' | 'scale';

/**
 * The pitches the roll shows, top (high) to bottom: all 128; Fold (F) only
 * the pitches the notes use; Fold to scale (G) only the scale's notes. A fold
 * with nothing to show falls back to the full range.
 */
export function rollRows(notes: readonly ArrNote[], fold: FoldMode, scale?: { name: string; root: number } | null): number[] {
  const out: number[] = [];
  if (fold === 'notes') {
    const used = new Set(notes.map(n => n.n));
    for (let p = 127; p >= 0; p--) if (used.has(p)) out.push(p);
  } else if (fold === 'scale' && scale) {
    for (let p = 127; p >= 0; p--) if (inScale(p, scale.name, scale.root)) out.push(p);
  }
  if (out.length) return out;
  for (let p = 127; p >= 0; p--) out.push(p);
  return out;
}

// ── Selecting ───────────────────────────────────────────────────────────────

/** Notes overlapping the time span [t0, t1] and pitches [lo, hi] (a marquee), limited by `can` (the clip's notes). */
export function selectRect(notes: readonly ArrNote[], t0: number, t1: number, lo: number, hi: number, can: (i: number) => boolean = () => true): number[] {
  const a = Math.min(t0, t1), b = Math.max(t0, t1), p = Math.min(lo, hi), q = Math.max(lo, hi);
  const out: number[] = [];
  notes.forEach((n, i) => { if (can(i) && n.n >= p && n.n <= q && n.t < b && n.t + n.d > a) out.push(i); });
  return out;
}

// ── The plumbing every operation shares ─────────────────────────────────────

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const clampN = (n: number) => Math.max(0, Math.min(127, Math.round(n)));
const clampV = (v: number) => Math.max(0.01, Math.min(1, v));

/** A note kept in range: t ≥ 0, d ≥ NOTE_MIN, n 0..127, v 0.01..1 (its `off` kept). */
function tidy(n: ArrNote): ArrNote {
  const out: ArrNote = { t: r6(Math.max(0, Math.min(TAPE_MAX_SECONDS - NOTE_MIN, n.t))), n: clampN(n.n), v: r6(clampV(n.v)), d: r6(Math.max(NOTE_MIN, n.d)) };
  if (n.off) out.off = true;
  return out;
}

/** `notes` sorted (time, then pitch), with the selection following the `picked` objects. */
function finish(notes: ArrNote[], picked: ReadonlySet<ArrNote>): NoteEdit {
  const sorted = [...notes].sort((a, b) => a.t - b.t || a.n - b.n);
  const sel: number[] = [];
  sorted.forEach((n, i) => { if (picked.has(n)) sel.push(i); });
  return { notes: sorted, sel };
}

/** Each selected note through `fn` (the rest as they are). */
function mapSel(notes: readonly ArrNote[], sel: readonly number[], fn: (n: ArrNote, k: number) => ArrNote): NoteEdit {
  const on = new Set(sel.filter(i => notes[i]));
  const picked = new Set<ArrNote>();
  let k = 0;
  const out = notes.map((n, i) => {
    if (!on.has(i)) return n;
    const m = tidy(fn(n, k++));
    picked.add(m);
    return m;
  });
  return finish(out, picked);
}

const selected = (notes: readonly ArrNote[], sel: readonly number[]) => [...new Set(sel)].filter(i => notes[i]).sort((a, b) => a - b).map(i => notes[i]);

/** The span the selection covers: its first start to its last end. */
export function selectionSpan(notes: readonly ArrNote[], sel: readonly number[]): { t0: number; t1: number; lo: number; hi: number } | null {
  const s = selected(notes, sel);
  if (!s.length) return null;
  let t0 = Infinity, t1 = -Infinity, lo = 127, hi = 0;
  for (const n of s) { t0 = Math.min(t0, n.t); t1 = Math.max(t1, n.t + n.d); lo = Math.min(lo, n.n); hi = Math.max(hi, n.n); }
  return { t0, t1, lo, hi };
}

// ── Moving, sizing, copying ─────────────────────────────────────────────────

/**
 * The selection moved `dt` seconds and `dn` semitones (dragging, the arrows).
 * The whole move is held back where a note would go before 0 or out of MIDI's
 * range, so the selection keeps its shape.
 */
export function moveNotes(notes: readonly ArrNote[], sel: readonly number[], dt: number, dn: number, copy = false): NoteEdit {
  const span = selectionSpan(notes, sel);
  if (!span) return { notes: [...notes], sel: [] };
  const t = Math.max(-span.t0, dt);
  const n = Math.max(-span.lo, Math.min(127 - span.hi, Math.round(dn)));
  if (!copy) return mapSel(notes, sel, x => ({ ...x, t: x.t + t, n: x.n + n }));
  // ⌥-drag: the originals stay, the copies move and are selected.
  const copies = selected(notes, sel).map(x => tidy({ ...x, t: x.t + t, n: x.n + n }));
  return finish([...notes, ...copies], new Set(copies));
}

/** The selection's start or end edge moved `dt` (a note never shorter than `min`). Moving the start keeps the end. */
export function resizeNotes(notes: readonly ArrNote[], sel: readonly number[], edge: 'start' | 'end', dt: number, min = NOTE_MIN): NoteEdit {
  return mapSel(notes, sel, x => {
    if (edge === 'end') return { ...x, d: Math.max(min, x.d + dt) };
    const end = x.t + x.d;
    const t = Math.max(0, Math.min(end - min, x.t + dt));
    return { ...x, t, d: end - t };
  });
}

/** ⌘D: the selection copied right after itself (its span, rounded up to the grid `step`); the copies are selected. */
export function duplicateNotes(notes: readonly ArrNote[], sel: readonly number[], step = 0): NoteEdit {
  const span = selectionSpan(notes, sel);
  if (!span) return { notes: [...notes], sel: [] };
  let by = span.t1 - span.t0;
  if (step > 0) by = Math.max(step, Math.ceil(by / step - 1e-6) * step);
  const copies = selected(notes, sel).map(x => tidy({ ...x, t: x.t + by }));
  return finish([...notes, ...copies], new Set(copies));
}

/** The selection's notes, as copies offset so the earliest starts at `at` (paste); the pasted notes are selected. */
export function pasteNotes(notes: readonly ArrNote[], clip: readonly ArrNote[], at: number): NoteEdit {
  if (!clip.length) return { notes: [...notes], sel: [] };
  const t0 = Math.min(...clip.map(n => n.t));
  const copies = clip.map(x => tidy({ ...x, t: x.t - t0 + at }));
  return finish([...notes, ...copies], new Set(copies));
}

/** Delete the selection. */
export function deleteNotes(notes: readonly ArrNote[], sel: readonly number[]): NoteEdit {
  const on = new Set(sel);
  return { notes: notes.filter((_, i) => !on.has(i)), sel: [] };
}

/** 0: the selection deactivated (kept, greyed, silent), or back on when every selected note is already off. */
export function toggleNotesOff(notes: readonly ArrNote[], sel: readonly number[]): NoteEdit {
  const allOff = selected(notes, sel).every(n => n.off);
  return mapSel(notes, sel, x => { const y: ArrNote = { t: x.t, n: x.n, v: x.v, d: x.d }; if (!allOff) y.off = true; return y; });
}

// ── Split, chop, join ───────────────────────────────────────────────────────

/** Selected notes that sound across `at` split there into two (both selected). */
export function splitNotes(notes: readonly ArrNote[], sel: readonly number[], at: number): NoteEdit {
  const on = new Set(sel);
  const picked = new Set<ArrNote>();
  const out: ArrNote[] = [];
  notes.forEach((x, i) => {
    if (!on.has(i)) { out.push(x); return; }
    if (at - x.t >= NOTE_MIN && x.t + x.d - at >= NOTE_MIN) {
      const a = tidy({ ...x, d: at - x.t }), b = tidy({ ...x, t: at, d: x.t + x.d - at });
      out.push(a, b); picked.add(a); picked.add(b);
    } else { out.push(x); picked.add(x); }
  });
  return finish(out, picked);
}

/** ⌘E: each selected note chopped into `parts` equal notes (too short to chop: left as is). */
export function chopNotes(notes: readonly ArrNote[], sel: readonly number[], parts = 2): NoteEdit {
  const k = Math.max(2, Math.min(64, Math.round(parts)));
  const on = new Set(sel);
  const picked = new Set<ArrNote>();
  const out: ArrNote[] = [];
  notes.forEach((x, i) => {
    if (!on.has(i)) { out.push(x); return; }
    const d = x.d / k;
    if (d < NOTE_MIN) { out.push(x); picked.add(x); return; }
    for (let j = 0; j < k; j++) { const y = tidy({ ...x, t: x.t + j * d, d }); out.push(y); picked.add(y); }
  });
  return finish(out, picked);
}

/** ⌘J: selected notes of the same pitch joined into one, from the first's start to the last's end (the first's velocity). */
export function joinNotes(notes: readonly ArrNote[], sel: readonly number[]): NoteEdit {
  const on = new Set(sel);
  const byPitch = new Map<number, ArrNote[]>();
  for (const i of on) { const x = notes[i]; if (x) byPitch.set(x.n, [...(byPitch.get(x.n) ?? []), x]); }
  const picked = new Set<ArrNote>();
  const out: ArrNote[] = [];
  notes.forEach((x, i) => {
    if (!on.has(i)) out.push(x);
    else if ((byPitch.get(x.n)?.length ?? 0) < 2) { out.push(x); picked.add(x); }
  });
  for (const group of byPitch.values()) {
    if (group.length < 2) continue;
    const first = group.reduce((a, b) => (b.t < a.t ? b : a));
    const end = Math.max(...group.map(n => n.t + n.d));
    const y = tidy({ ...first, d: end - first.t });
    out.push(y); picked.add(y);
  }
  return finish(out, picked);
}

// ── Timing: quantize, legato, reverse, stretch, humanize ────────────────────

/**
 * ⌘U: each selected note's start moved `amount` (0..1) of the way to the
 * nearest grid line; `ends` also moves its end (the length follows). The
 * length is kept otherwise.
 */
export function quantizeNotes(notes: readonly ArrNote[], sel: readonly number[], step: number, amount = 1, ends = false): NoteEdit {
  if (!(step > 0)) return { notes: [...notes], sel: [...sel] };
  const a = Math.max(0, Math.min(1, amount));
  return mapSel(notes, sel, x => {
    const t = x.t + (snapTime(x.t, step) - x.t) * a;
    if (!ends) return { ...x, t };
    const e0 = x.t + x.d, e = e0 + (snapTime(e0, step) - e0) * a;
    return { ...x, t, d: Math.max(NOTE_MIN, e - t) };
  });
}

/** Legato: each selected note lasts until the next selected note starts (notes starting together count as one); the last keeps its length. */
export function legatoNotes(notes: readonly ArrNote[], sel: readonly number[]): NoteEdit {
  const starts = [...new Set(selected(notes, sel).map(n => n.t))].sort((a, b) => a - b);
  return mapSel(notes, sel, x => {
    const next = starts.find(s => s > x.t + 1e-9);
    return next === undefined ? x : { ...x, d: next - x.t };
  });
}

/** Reverse: the selection played backwards in its own span (the last note's end becomes the first's start). */
export function reverseNotes(notes: readonly ArrNote[], sel: readonly number[]): NoteEdit {
  const span = selectionSpan(notes, sel);
  if (!span) return { notes: [...notes], sel: [] };
  return mapSel(notes, sel, x => ({ ...x, t: span.t0 + span.t1 - (x.t + x.d) }));
}

/** ×2 and /2 (any factor): the selection stretched from its first start, lengths too. */
export function stretchNotes(notes: readonly ArrNote[], sel: readonly number[], factor: number): NoteEdit {
  const span = selectionSpan(notes, sel);
  if (!span || !(factor > 0)) return { notes: [...notes], sel: [...sel] };
  return mapSel(notes, sel, x => ({ ...x, t: span.t0 + (x.t - span.t0) * factor, d: x.d * factor }));
}

/** A small seeded random (mulberry32): the same seed gives the same humanize. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Humanize: each selected note's start nudged up to ±`time` s and its velocity up to ±`vel`, from `seed` (repeatable). */
export function humanizeNotes(notes: readonly ArrNote[], sel: readonly number[], amount: { time: number; vel: number }, seed: number): NoteEdit {
  const rnd = seededRandom(seed);
  return mapSel(notes, sel, x => ({ ...x, t: x.t + (rnd() * 2 - 1) * amount.time, v: x.v + (rnd() * 2 - 1) * amount.vel }));
}

// ── Pitch: transpose, invert, fit to scale ──────────────────────────────────

/** The selection moved `semis` semitones (held at MIDI's ends, keeping its shape). */
export function transposeNotes(notes: readonly ArrNote[], sel: readonly number[], semis: number): NoteEdit {
  return moveNotes(notes, sel, 0, semis);
}

/** Invert: the selection upside down in its own range (the highest note becomes the lowest). */
export function invertNotes(notes: readonly ArrNote[], sel: readonly number[]): NoteEdit {
  const span = selectionSpan(notes, sel);
  if (!span) return { notes: [...notes], sel: [] };
  return mapSel(notes, sel, x => ({ ...x, n: span.hi + span.lo - x.n }));
}

/** Fit to scale: each selected note to the nearest note of the scale (ties go down). */
export function fitToScale(notes: readonly ArrNote[], sel: readonly number[], scale: { name: string; root: number }): NoteEdit {
  return mapSel(notes, sel, x => ({ ...x, n: snapNote(x.n, scale.name, scale.root) }));
}

// ── Velocity ────────────────────────────────────────────────────────────────

/** The selection's velocity set to `v` (typed into the velocity lane). */
export function setVelocity(notes: readonly ArrNote[], sel: readonly number[], v: number): NoteEdit {
  return mapSel(notes, sel, x => ({ ...x, v }));
}

/** The selection's velocity changed by `dv` (dragging a stem moves every selected stem together). */
export function nudgeVelocity(notes: readonly ArrNote[], sel: readonly number[], dv: number): NoteEdit {
  return mapSel(notes, sel, x => ({ ...x, v: x.v + dv }));
}

/** A velocity ramp across the selection by time: `v0` at its first start to `v1` at its last start. */
export function rampVelocity(notes: readonly ArrNote[], sel: readonly number[], v0: number, v1: number): NoteEdit {
  const s = selected(notes, sel);
  if (!s.length) return { notes: [...notes], sel: [] };
  const a = Math.min(...s.map(n => n.t)), b = Math.max(...s.map(n => n.t));
  return mapSel(notes, sel, x => ({ ...x, v: b > a ? v0 + (v1 - v0) * (x.t - a) / (b - a) : v1 }));
}

/** Velocities drawn along a line: each note in `idx` set to the line from (t0, v0) to (t1, v1) at its start. */
export function drawVelocityLine(notes: readonly ArrNote[], idx: readonly number[], t0: number, v0: number, t1: number, v1: number): NoteEdit {
  return mapSel(notes, idx, x => ({ ...x, v: Math.abs(t1 - t0) < 1e-9 ? v1 : v0 + (v1 - v0) * (x.t - t0) / (t1 - t0) }));
}
