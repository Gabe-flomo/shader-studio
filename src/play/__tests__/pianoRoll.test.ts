/**
 * The piano roll's grid and note operations (play/pianoRoll.ts,
 * docs/piano-roll.md), and how they land on the tape (setTrackNotes,
 * deactivated notes left out of playback).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRID, chopNotes, deleteNotes, drawVelocityLine, duplicateNotes, fitToScale, gridLabel, gridStep, humanizeNotes, invertNotes, joinNotes, legatoNotes,
  moveNotes, nudgeVelocity, pasteNotes, quantizeNotes, rampVelocity, resizeNotes, reverseNotes, rollRows, selectRect, setVelocity, splitNotes, stepGrid, stretchNotes,
  toggleNotesOff, transposeNotes,
} from '../pianoRoll';
import { audibleArrangement, emptyArrangement, parseArrangement, setTrackNotes, type ArrNote } from '../../types/playArrangement';

const N = (t: number, n: number, d = 0.5, v = 0.8): ArrNote => ({ t, n, v, d });
// 120 BPM: a beat is 0.5 s, a bar 2 s.
const three = [N(0, 60), N(0.5, 64), N(1, 67)];

describe('grid', () => {
  it('fixed divisions come from the BPM, triplets are ⅔', () => {
    expect(gridStep({ ...DEFAULT_GRID, div: '1/4' }, 120, 100)).toBeCloseTo(0.5);
    expect(gridStep({ ...DEFAULT_GRID, div: '1/16' }, 120, 100)).toBeCloseTo(0.125);
    expect(gridStep({ ...DEFAULT_GRID, div: '1/8', triplet: true }, 120, 100)).toBeCloseTo(0.25 * 2 / 3);
    expect(gridStep({ ...DEFAULT_GRID, div: 'off' }, 120, 100)).toBe(0);
  });
  it('adaptive picks the finest step at least minPx wide', () => {
    // 100 px/s: a 1/16 (0.125 s) is 12.5 px < 24, a 1/8 (0.25 s) is 25 px.
    expect(gridStep(DEFAULT_GRID, 120, 100)).toBeCloseTo(0.25);
    expect(gridStep(stepGrid(DEFAULT_GRID, -1), 120, 100)).toBeCloseTo(0.125);
    expect(gridStep(DEFAULT_GRID, 120, 1)).toBeCloseTo(16); // capped at 8 bars
  });
  it('⌘1/⌘2 step a fixed division', () => {
    expect(stepGrid({ ...DEFAULT_GRID, div: '1/8' }, -1).div).toBe('1/16');
    expect(stepGrid({ ...DEFAULT_GRID, div: '1/8' }, 1).div).toBe('1/4');
    expect(stepGrid({ ...DEFAULT_GRID, div: '1/32' }, -1).div).toBe('1/32');
  });
  it('labels', () => {
    expect(gridLabel(0.125, 120, false)).toBe('1/16');
    expect(gridLabel(0.25 * 2 / 3, 120, true)).toBe('1/8T');
    expect(gridLabel(4, 120, false)).toBe('2 bars');
    expect(gridLabel(0, 120, false)).toBe('Off');
  });
});

describe('rows and selection', () => {
  it('folds to the notes used, or the scale, high to low', () => {
    expect(rollRows(three, 'notes')).toEqual([67, 64, 60]);
    const c = rollRows([], 'scale', { name: 'majorPentatonic', root: 0 }).filter(p => p >= 60 && p < 72);
    expect(c).toEqual([69, 67, 64, 62, 60]);
    expect(rollRows([], 'notes')).toHaveLength(128);
  });
  it('a marquee picks notes it overlaps, limited to the clip', () => {
    expect(selectRect(three, 0.4, 1.2, 62, 70)).toEqual([1, 2]);
    expect(selectRect(three, 0.4, 1.2, 62, 70, i => i !== 2)).toEqual([1]);
  });
});

describe('moving and sizing', () => {
  it('moves the selection and keeps it selected after re-sorting', () => {
    const e = moveNotes(three, [0], 2, 1);
    expect(e.notes.map(n => n.t)).toEqual([0.5, 1, 2]);
    expect(e.sel).toEqual([2]);
    expect(e.notes[2].n).toBe(61);
  });
  it('holds the whole move at 0 and at MIDI’s range', () => {
    const e = moveNotes(three, [1, 2], -5, 100);
    expect(e.notes[1]).toMatchObject({ t: 0, n: 124 });
    expect(e.notes[2]).toMatchObject({ t: 0.5, n: 127 });
  });
  it('⌥-drag copies: originals stay, copies selected', () => {
    const e = moveNotes(three, [0], 1.5, 0, true);
    expect(e.notes).toHaveLength(4);
    expect(e.notes[e.sel[0]]).toMatchObject({ t: 1.5, n: 60 });
  });
  it('resizes either edge (the start keeps the end)', () => {
    expect(resizeNotes(three, [0], 'end', 0.25).notes[0].d).toBeCloseTo(0.75);
    const s = resizeNotes(three, [1], 'start', 0.25).notes.find(n => n.n === 64)!;
    expect(s.t).toBeCloseTo(0.75); expect(s.d).toBeCloseTo(0.25);
    expect(resizeNotes(three, [0], 'end', -10).notes[0].d).toBeCloseTo(0.01);
  });
  it('duplicates after the selection, rounded to the grid', () => {
    const e = duplicateNotes(three, [0, 1], 0.5);
    expect(e.notes).toHaveLength(5);
    expect(e.sel.map(i => e.notes[i].t)).toEqual([1, 1.5]);
  });
  it('pastes at a time, deletes, deactivates and back', () => {
    expect(pasteNotes(three, [N(3, 50), N(3.5, 52)], 10).sel.length).toBe(2);
    expect(deleteNotes(three, [0, 2]).notes).toEqual([three[1]]);
    const off = toggleNotesOff(three, [0, 1]);
    expect(off.notes.filter(n => n.off)).toHaveLength(2);
    expect(toggleNotesOff(off.notes, [0, 1]).notes.some(n => n.off)).toBe(false);
  });
});

describe('split, chop, join', () => {
  it('splits notes across a time', () => {
    const e = splitNotes([N(0, 60, 1)], [0], 0.25);
    expect(e.notes.map(n => [n.t, n.d])).toEqual([[0, 0.25], [0.25, 0.75]]);
    expect(e.sel).toEqual([0, 1]);
  });
  it('chops into equal parts', () => {
    const e = chopNotes([N(0, 60, 1)], [0], 4);
    expect(e.notes.map(n => n.t)).toEqual([0, 0.25, 0.5, 0.75]);
  });
  it('joins same-pitch notes', () => {
    const e = joinNotes([N(0, 60, 0.2), N(1, 60, 0.5), N(0.5, 64)], [0, 1, 2]);
    expect(e.notes).toHaveLength(2);
    expect(e.notes.find(n => n.n === 60)).toMatchObject({ t: 0, d: 1.5 });
    expect(e.sel).toHaveLength(2);
  });
});

describe('timing', () => {
  it('quantizes with an amount, ends optional', () => {
    const notes = [N(0.1, 60, 0.3)];
    expect(quantizeNotes(notes, [0], 0.5).notes[0].t).toBe(0);
    expect(quantizeNotes(notes, [0], 0.5, 0.5).notes[0].t).toBeCloseTo(0.05);
    const both = quantizeNotes([N(0.1, 60, 0.3)], [0], 0.25, 1, true).notes[0];
    expect(both.t).toBe(0); expect(both.d).toBeCloseTo(0.5);
  });
  it('legato runs each note to the next', () => {
    const e = legatoNotes([N(0, 60, 0.1), N(1, 62, 0.1), N(3, 64, 0.1)], [0, 1, 2]);
    expect(e.notes.map(n => n.d)).toEqual([1, 2, 0.1]);
  });
  it('reverse mirrors the selection in its span', () => {
    const e = reverseNotes(three, [0, 1, 2]);
    expect(e.notes.map(n => n.n)).toEqual([67, 64, 60]);
    expect(e.notes.map(n => n.t)).toEqual([0, 0.5, 1]);
  });
  it('stretches from the first start', () => {
    const e = stretchNotes(three, [0, 1, 2], 2);
    expect(e.notes.map(n => [n.t, n.d])).toEqual([[0, 1], [1, 1], [2, 1]]);
    expect(stretchNotes(three, [1, 2], 0.5).notes[2]).toMatchObject({ t: 0.75, d: 0.25 });
  });
  it('humanize is seeded', () => {
    const a = humanizeNotes(three, [0, 1, 2], { time: 0.02, vel: 0.1 }, 7);
    const b = humanizeNotes(three, [0, 1, 2], { time: 0.02, vel: 0.1 }, 7);
    expect(a).toEqual(b);
    expect(a.notes.every((n, i) => Math.abs(n.t - three[i].t) <= 0.02 + 1e-9)).toBe(true);
    expect(humanizeNotes(three, [0, 1, 2], { time: 0.02, vel: 0.1 }, 8)).not.toEqual(a);
  });
});

describe('pitch', () => {
  it('transposes, inverts and fits to a scale', () => {
    expect(transposeNotes(three, [0, 1, 2], 12).notes.map(n => n.n)).toEqual([72, 76, 79]);
    expect(invertNotes(three, [0, 1, 2]).notes.map(n => n.n)).toEqual([67, 63, 60]);
    // C minor: E (64) → D# (63) or F (65), tie goes down.
    expect(fitToScale(three, [1], { name: 'minor', root: 0 }).notes[1].n).toBe(63);
  });
});

describe('velocity', () => {
  it('sets, nudges and ramps', () => {
    expect(setVelocity(three, [0], 0.3).notes[0].v).toBeCloseTo(0.3);
    expect(nudgeVelocity(three, [0, 1], 0.5).notes[0].v).toBe(1);
    const r = rampVelocity(three, [0, 1, 2], 0.2, 1).notes.map(n => n.v);
    expect(r[0]).toBeCloseTo(0.2); expect(r[1]).toBeCloseTo(0.6); expect(r[2]).toBeCloseTo(1);
    expect(drawVelocityLine(three, [1], 0, 0, 1, 1).notes[1].v).toBeCloseTo(0.5);
  });
});

describe('on the tape', () => {
  it('setTrackNotes sorts, says where each went, grows the clip and the tape', () => {
    const arr = { ...emptyArrangement(120), length: 2 };
    const r = setTrackNotes(arr, 'rk', [N(3, 60), N(1, 62)]);
    expect(r.index).toEqual([1, 0]);
    expect(r.arr.length).toBeCloseTo(3.5);
    expect(r.arr.tracks.rk.clips?.some(c => c.t <= 3 && c.t + c.d >= 3.5)).toBe(true);
  });
  it('a note outside every clip grows the open clip (joining a clip it reaches)', () => {
    let arr = setTrackNotes({ ...emptyArrangement(120), length: 8 }, 'rk', [N(0, 60)]).arr;
    arr = setTrackNotes(arr, 'rk', [...arr.tracks.rk.notes, N(4, 60)]).arr;
    expect(arr.tracks.rk.clips).toHaveLength(2);
    const grown = setTrackNotes(arr, 'rk', [...arr.tracks.rk.notes, N(3.8, 62)], 0).arr;
    expect(grown.tracks.rk.clips).toEqual([{ t: 0, d: 4.5 }]);
  });
  it('deactivated notes are kept, parsed and left out of playback', () => {
    const arr = setTrackNotes({ ...emptyArrangement(120), length: 2 }, 'rk', [N(0, 60), { ...N(1, 62), off: true }]).arr;
    expect(audibleArrangement(arr).tracks.rk.notes.map(n => n.n)).toEqual([60]);
    const back = parseArrangement(JSON.parse(JSON.stringify(arr)));
    expect(back?.tracks.rk.notes[1].off).toBe(true);
  });
});
