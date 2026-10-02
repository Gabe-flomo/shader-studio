/**
 * playNotes — Play notes in the app: a rule's Play notes reaction fires
 * (playEngine.onAction) and its notes go to the rack through the Audio
 * engine, so racks hear them and takes record them (audioEngineHost.input).
 *
 * Stuck notes can't happen: each note-off is scheduled with its note-on, a
 * note played again while it sounds is let go first, and stop() (Play ends)
 * sends every held note its note-off at once.
 */
import { playEngine } from './playEngine';
import { audioEngineHost } from './audioEngineHost';
import { noteEvents } from '../play/notes';
import { NOTES_ACTION } from '../types/play';

/** At most this many notes held at once across racks; past it the oldest is let go. */
const HELD_MAX = 64;

export function startPlayNotes(): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  // rack|note → when it began, for let-go-first and the cap.
  const held = new Map<string, { rackId: string; note: number; at: number }>();
  const counts = new Map<string, number>();
  const off = (rackId: string, note: number) => {
    const k = `${rackId}|${note}`;
    if (!held.delete(k)) return;
    audioEngineHost.input(rackId, [0x80, note, 0]);
  };
  const send = (rackId: string, bytes: [number, number, number]) => {
    const on = (bytes[0] & 0xf0) === 0x90 && bytes[2] > 0;
    if (!on) { off(rackId, bytes[1]); return; }
    off(rackId, bytes[1]);
    if (held.size >= HELD_MAX) { const oldest = [...held.values()].sort((a, b) => a.at - b.at)[0]; off(oldest.rackId, oldest.note); }
    held.set(`${rackId}|${bytes[1]}`, { rackId, note: bytes[1], at: performance.now() });
    audioEngineHost.input(rackId, bytes);
  };
  const stopListening = playEngine.onAction(a => {
    if (a.do !== NOTES_ACTION || !a.notes || !a.enabled) return;
    const n = counts.get(a.id) ?? 0;
    counts.set(a.id, n + 1);
    for (const e of noteEvents(a.notes, n, Math.random)) {
      if (e.atMs <= 0) { send(a.notes.rackId, e.bytes); continue; }
      const rackId = a.notes.rackId;
      const t = setTimeout(() => { timers.delete(t); send(rackId, e.bytes); }, e.atMs);
      timers.add(t);
    }
  });
  return () => {
    stopListening();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const h of [...held.values()]) off(h.rackId, h.note);
  };
}
