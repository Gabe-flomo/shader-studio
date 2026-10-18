/**
 * stems.ts — an Audio Source's separated stems (docs/audio-tools.md "Separate", docs/stems.md): a bake kept beside the
 * song. Each stem is a sound in the media library (Opus in WebM, else WAV; ids `stem_…`, so the sound pickers leave
 * them out) and the node's `stems` param says which, for which song (`of`: the song's library id) and from which
 * model. The graph saves those ids as `sampleId`s, so .playfield / .playfile files carry the stems like the song.
 *
 *   params.stem   which stem the analysis hears: 'mix' (the default) or a stem the bake has
 *   params.hear   'mix' (the default: hear the song, analyse the stem) or 'stem' (hear the stem too)
 */
import { addVideoFile, deleteVideo, newBackgroundId } from '../backgroundLibrary';
import { STEM_LABELS, STEM_ORDER, stemModelById, type StemName } from '../../stemModel/config';
import type { StemResult } from '../../stemModel/client';

export interface StemTrack { stem: StemName; sampleId: string; type: string; bytes: number }

export interface StemsBake {
  /** The model's id and pinned revision. */
  model: string;
  revision: string;
  /** The song's library id these stems came from. */
  of: string;
  tracks: StemTrack[];
  /** When it was made (ms), the backend and how long it took. */
  at: number;
  backend?: string;
  ms?: number;
}

export type StemChoice = StemName | 'mix';

const isStem = (v: unknown): v is StemName => typeof v === 'string' && (STEM_ORDER as readonly string[]).includes(v);

/** The node's stems bake, when it is for the song loaded now (a different song: none). */
export function stemsOf(params: Record<string, unknown>): StemsBake | null {
  const b = params.stems as Partial<StemsBake> | null | undefined;
  if (!b || typeof b !== 'object' || typeof b.of !== 'string' || !Array.isArray(b.tracks)) return null;
  if (!b.of || b.of !== params.sampleId) return null;
  const tracks = b.tracks.filter((t): t is StemTrack => !!t && isStem(t.stem) && typeof t.sampleId === 'string' && !!t.sampleId);
  if (!tracks.length) return null;
  return { model: String(b.model ?? ''), revision: String(b.revision ?? ''), of: b.of, tracks, at: Number(b.at ?? 0), ...(b.backend ? { backend: String(b.backend) } : {}), ...(b.ms ? { ms: Number(b.ms) } : {}) };
}

/** The stems a bake has, in the picker's order. */
export const availableStems = (bake: StemsBake | null): StemName[] => (bake ? STEM_ORDER.filter(s => bake.tracks.some(t => t.stem === s)) : []);

/** What the analysis hears: the picked stem when the bake has it, else the full mix. */
export function analysedStem(params: Record<string, unknown>): StemChoice {
  const s = params.stem;
  if (!isStem(s)) return 'mix';
  return stemsOf(params)?.tracks.some(t => t.stem === s) ? s : 'mix';
}

/** The library id of the stem the analysis hears, or '' for the mix. */
export function analysedStemId(params: Record<string, unknown>): string {
  const s = analysedStem(params);
  return s === 'mix' ? '' : stemsOf(params)?.tracks.find(t => t.stem === s)?.sampleId ?? '';
}

/** Whether the speakers play the stem (not the mix): only with a stem picked and Hear: This stem. */
export const hearsStem = (params: Record<string, unknown>): boolean => params.hear === 'stem' && analysedStem(params) !== 'mix';

/** The picker's options: Full mix, then the bake's stems. */
export function stemOptions(bake: StemsBake | null): Array<{ value: StemChoice; label: string }> {
  return [{ value: 'mix', label: 'Full mix' }, ...availableStems(bake).map(s => ({ value: s as StemChoice, label: STEM_LABELS[s] }))];
}

const base = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'Song';
const extOf = (type: string) => (type === 'audio/webm' ? 'weba' : type === 'audio/wav' ? 'wav' : 'audio');

/** Keep a separation's stems in the library; the bake to put in the node's `stems`. */
export async function saveStems(song: { id: string; name: string }, modelId: string, r: StemResult): Promise<StemsBake> {
  const spec = stemModelById(modelId);
  const tracks: StemTrack[] = [];
  try {
    for (const s of r.stems) {
      const file = new File([s.bytes as BlobPart], `${base(song.name)} · ${STEM_LABELS[s.name]}.${extOf(s.type)}`, { type: s.type });
      const meta = await addVideoFile(file, { id: newBackgroundId('stem') });
      tracks.push({ stem: s.name, sampleId: meta.id, type: s.type, bytes: s.bytes.length });
    }
  } catch (e) {
    // Out of room (or the library failed) half way: take back what went in.
    for (const t of tracks) await deleteVideo(t.sampleId).catch(() => false);
    throw e;
  }
  return { model: spec.id, revision: spec.revision, of: song.id, tracks, at: Date.now(), backend: r.backend, ms: r.ms };
}

/** Remove a bake's stems from the library. */
export async function removeStems(bake: Pick<StemsBake, 'tracks'> | null): Promise<void> {
  for (const t of bake?.tracks ?? []) await deleteVideo(t.sampleId).catch(() => false);
}

/** Is a library id one of the stems (kept out of the sound pickers)? */
export const isStemSampleId = (id: string): boolean => id.startsWith('stem_');

/** The bake's total size in bytes. */
export const stemsBytes = (bake: StemsBake | null): number => (bake?.tracks ?? []).reduce((s, t) => s + t.bytes, 0);
