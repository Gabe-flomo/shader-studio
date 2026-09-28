/**
 * engineExport.ts — the Audio engine's part of an export's sound
 * (ExportModal): the racks rendered offline natively for the span, with any
 * sends' web sounds mixed first and uploaded as their sources. The tracks a
 * send takes leave the direct mix (they're heard through the rack).
 */
import type { PlayRecord, PlayTake } from '../types/play';
import { audioEngineHost } from './audioEngineHost';
import { engineRenderJob, interleave, type EngineRender } from './engineRender';
import { mixdown, sendFx, sentTracks, type MixFx, type RecordingTrack } from './recordingAudio';

export interface EngineExport {
  /** The tracks still mixed directly (sent ones taken out). */
  tracks: RecordingTrack[];
  engine: EngineRender | null;
  /** What to tell the user: units left out, a failed render. */
  notes: string[];
}

/**
 * Render the engine's racks for `length` seconds from clock time `from`. No
 * engine tracks: nothing changes. The render failing leaves the engine out
 * with a note rather than failing the export.
 */
export async function renderEngineForExport(play: PlayRecord, take: PlayTake | null, tracks: readonly RecordingTrack[], from: number, length: number, mixFx: MixFx, sampleRate = 48000): Promise<EngineExport> {
  const { direct, sent } = sentTracks(tracks);
  if (!tracks.some(t => t.engine)) return { tracks: direct, engine: null, notes: [] };
  const job = engineRenderJob(play.audioEngine, take, from, length, sampleRate);
  if (!job) return { tracks: direct, engine: null, notes: take ? [] : ['The Audio engine plays only what a take recorded: render a take to hear its racks.'] };
  const notes: string[] = [];
  const inputs = new Map<string, Float32Array>();
  for (const r of job.racks) {
    if (!r.input) continue;
    const source = play.audioEngine?.racks.find(x => x.id === r.id)?.source ?? 'master';
    const mine = sent.get(r.id) ?? [];
    const b = mine.length ? await mixdown(mine, length, from, sampleRate, { ...mixFx, fx: sendFx(mixFx.fx, source), engine: undefined }) : null;
    if (b) inputs.set(r.id, interleave(b));
    else notes.push(`${r.name}: nothing plays into it in this span, so it's silent.`);
  }
  try {
    const engine = await audioEngineHost.renderTake(job, inputs);
    if (engine?.notes.length) notes.push(...engine.notes);
    return { tracks: direct, engine, notes };
  } catch (e) {
    notes.push(`The Audio engine couldn’t be rendered: ${e instanceof Error ? e.message : String(e)}. The video has the page’s sounds only.`);
    return { tracks: direct, engine: null, notes };
  }
}
