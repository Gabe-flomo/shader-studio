/**
 * readersPanelUi.ts — whether the Audio readers panel is open, and what
 * opened it (a mapping's source picker offers "Use" on each reader); and the
 * record edits the panel makes.
 */
import { create } from 'zustand';
import type { PlayAudioReaders, PlayLayer } from '../../types/play';
import { padsLayerOfInput, padsReaderInput, videoLayerOfInput, videoReaderInput } from '../../types/playLayers';
import { ENGINE_MASTER, engineRackOfInput, engineReaderInput } from '../../lib/engineSound';

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

// ── Record edits (play/readerControls.ts: a reader comes with a control and a mapping) ──

export const EMPTY_READERS: PlayAudioReaders = { input: '', readers: [] };
export { withReaders, removeReader, usesReader } from '../../play/readerControls';

// ── What the readers can listen to ───────────────────────────────────────────

/**
 * The Listen to choices: the live input, each Audio Input node's song (`file`:
 * its loaded file's name, or null), and each Video layer's sound. An input
 * that is gone (a deleted node or layer) stays listed, saying so, so the
 * picker still shows what is chosen.
 */
export function readerInputOptions(input: string, songs: ReadonlyArray<{ id: string; label: string; file: string | null }>, layers: readonly PlayLayer[], racks: ReadonlyArray<{ id: string; name: string }> = []): { value: string; label: string }[] {
  const out = [
    { value: '', label: 'Live input (mic, interface, cable)' },
    ...songs.map(s => ({ value: s.id, label: `Song · ${s.label}${s.file !== null ? ` · ${s.file}` : ' (no song loaded)'}` })),
  ];
  for (const l of layers) if (l.kind === 'video') out.push({ value: videoReaderInput(l.id), label: `Video · ${l.label}${l.sound === 'off' ? ' (sound off)' : ''}` });
  for (const l of layers) if (l.kind === 'drumpad') out.push({ value: padsReaderInput(l.id), label: `Drum pads · ${l.label}` });
  for (const r of racks) out.push({ value: engineReaderInput(r.id), label: `Audio engine · ${r.name}` });
  if (racks.length || input === engineReaderInput(ENGINE_MASTER)) out.push({ value: engineReaderInput(ENGINE_MASTER), label: 'Audio engine · Master (every rack)' });
  const video = videoLayerOfInput(input), pads = padsLayerOfInput(input), rack = engineRackOfInput(input);
  if (rack) { if (rack !== ENGINE_MASTER && !racks.some(r => r.id === rack)) out.push({ value: input, label: 'Audio engine · a rack no longer in the setup' }); }
  else if (video && !layers.some(l => l.id === video && l.kind === 'video')) out.push({ value: input, label: 'Video · a layer no longer in the setup' });
  else if (pads && !layers.some(l => l.id === pads && l.kind === 'drumpad')) out.push({ value: input, label: 'Drum pads · a layer no longer in the setup' });
  else if (input && !video && !pads && !rack && !songs.some(s => s.id === input)) out.push({ value: input, label: 'Song · a node no longer in the graph' });
  return out;
}
