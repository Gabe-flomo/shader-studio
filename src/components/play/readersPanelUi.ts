/**
 * readersPanelUi.ts — whether the Audio readers panel is open, and what
 * opened it (a mapping's source picker offers "Use" on each reader); and the
 * record edits the panel makes.
 */
import { create } from 'zustand';
import type { PlayAudioReaders, PlayLayer, PlayRecord, TriggerSpec } from '../../types/play';
import { videoLayerOfInput, videoReaderInput } from '../../types/playLayers';

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

// ── What the readers can listen to ───────────────────────────────────────────

/**
 * The Listen to choices: the live input, each Audio Input node's song (`file`:
 * its loaded file's name, or null), and each Video layer's sound. An input
 * that is gone (a deleted node or layer) stays listed, saying so, so the
 * picker still shows what is chosen.
 */
export function readerInputOptions(input: string, songs: ReadonlyArray<{ id: string; label: string; file: string | null }>, layers: readonly PlayLayer[]): { value: string; label: string }[] {
  const out = [
    { value: '', label: 'Live input (mic, interface, cable)' },
    ...songs.map(s => ({ value: s.id, label: `Song · ${s.label}${s.file !== null ? ` · ${s.file}` : ' (no song loaded)'}` })),
  ];
  for (const l of layers) if (l.kind === 'video') out.push({ value: videoReaderInput(l.id), label: `Video · ${l.label}${l.sound === 'off' ? ' (sound off)' : ''}` });
  const video = videoLayerOfInput(input);
  if (video && !layers.some(l => l.id === video && l.kind === 'video')) out.push({ value: input, label: 'Video · a layer no longer in the setup' });
  else if (input && !video && !songs.some(s => s.id === input)) out.push({ value: input, label: 'Song · a node no longer in the graph' });
  return out;
}
