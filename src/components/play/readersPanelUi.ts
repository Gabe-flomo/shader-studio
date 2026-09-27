/**
 * readersPanelUi.ts — whether the Audio readers panel is open, and what
 * opened it (a mapping's source picker offers "Use" on each reader); and the
 * record edits the panel makes.
 */
import { create } from 'zustand';
import type { PlayAudioReaders, PlayRecord, TriggerSpec } from '../../types/play';

interface ReadersPanelUi {
  open: boolean;
  /** Opened from this mapping's picker: each reader offers "Use" to make it the source. */
  mappingId: string | null;
  /** The reader to select on opening. */
  focus: string;
  show: (o?: { mappingId?: string | null; focus?: string }) => void;
  hide: () => void;
}

export const useReadersPanel = create<ReadersPanelUi>(set => ({
  open: false,
  mappingId: null,
  focus: '',
  show: o => set({ open: true, mappingId: o?.mappingId ?? null, focus: o?.focus ?? '' }),
  hide: () => set({ open: false, mappingId: null, focus: '' }),
}));

// ── Record edits ─────────────────────────────────────────────────────────────

export const EMPTY_READERS: PlayAudioReaders = { input: '', readers: [] };

/** The record with these readers (the key left out when there are none and no song is picked). */
export function withReaders(p: PlayRecord, next: PlayAudioReaders): PlayRecord {
  const out = { ...p };
  if (!next.readers.length && !next.input) delete out.audioReaders; else out.audioReaders = next;
  return out;
}

export const usesReader = (t: TriggerSpec, id: string) => t.on === 'reader' && t.readerId === id;

/** The record without a reader, and without the mappings and actions that read it. */
export function removeReader(p: PlayRecord, id: string): PlayRecord {
  const cfg = p.audioReaders ?? EMPTY_READERS;
  const out = withReaders(p, { ...cfg, readers: cfg.readers.filter(r => r.id !== id) });
  out.mappings = p.mappings.filter(m => !((m.source.kind === 'reader' && m.source.readerId === id) || (m.source.kind === 'trigger' && usesReader(m.source.trigger, id))));
  if (p.actions) {
    const actions = p.actions.filter(a => !usesReader(a.trigger, id));
    if (actions.length) out.actions = actions; else delete out.actions;
  }
  return out;
}
