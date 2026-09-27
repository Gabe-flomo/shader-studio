/**
 * midiUi.ts — small shared pieces of the MIDI UI (mapping rows, the MIDI
 * Input node card, the pad grid card): the knob touched last as a hook, the
 * labels for it and for locks, and which pad covers each cell.
 */
import { useEffect, useState } from 'react';
import { midiEngine, type MidiActiveInput } from '../../lib/midiEngine';
import type { MidiLock, PlayPadGrid } from '../../types/playMidi';
import { kmCellsOf, kmLayoutOf, kmNoteName } from '../../play/kit/midi.js';

/** The knob touched last, kept fresh from the engine's events. */
export function useActiveInput(): MidiActiveInput | null {
  const [a, setA] = useState(() => midiEngine.activeInput());
  useEffect(() => midiEngine.subscribe(e => { if (e.kind !== 'devices' && e.kind !== 'noteOff') setA(midiEngine.activeInput()); }), []);
  return a;
}

/** "CC 21 · ch 1 · Launch Control XL" (the device left out when it has none). */
export function lockLabel(l: MidiLock): string {
  return `CC ${l.cc}${l.channel ? ` · ch ${l.channel}` : ''}${l.device ? ` · ${l.device}` : ''}`;
}

export function activeLabel(a: MidiActiveInput): string {
  const what = a.kind === 'cc' ? `CC ${a.number} = ${a.value}` : a.kind === 'note' ? `${kmNoteName(a.number)} · vel ${a.value}` : `bend ${a.value.toFixed(2)}`;
  return `${what} · ch ${a.channel}${a.device ? ` · ${a.device}` : ''}`;
}

/** The same lock (device, channel and CC all equal). */
export const sameLock = (a: MidiLock, b: MidiLock) => a.device === b.device && a.channel === b.channel && a.cc === b.cc;

/** Which pad covers each shader cell (−1: none), for clicks on the picture of the cells. */
export function padsForCells(pg: PlayPadGrid): Int32Array {
  const geo = kmLayoutOf(pg);
  const out = new Int32Array(pg.cols * pg.rows).fill(-1);
  for (let row = 0; row < geo.rows; row++) for (let col = 0; col < geo.cols; col++) {
    const box = kmCellsOf(pg, geo, col, row);
    if (!box) continue;
    for (let r = box[2]; r <= box[3]; r++) for (let c = box[0]; c <= box[1]; c++) if (out[r * pg.cols + c] < 0) out[r * pg.cols + c] = row * geo.cols + col;
  }
  return out;
}

