/**
 * job.ts — one Separate run for an Audio Source (docs/stems.md), and what the progress screen shows.
 *
 * Separate pauses the picture (lib/previewHold.ts: the preview stops drawing so the model gets the GPU), decodes the
 * song at 44.1 kHz, loads the model (the download happened when the person said yes), runs it segment by segment,
 * encodes the stems, keeps them in the library and puts the bake on the node. Done, cancelled or failed, the
 * picture plays again. One run at a time.
 *
 *   idle ──Separate──▶ running (decode → load → separate → encode → save) ──▶ done | cancelled | error ──▶ idle
 *                        └ the preview is held from the first step to the last
 */
import { create } from 'zustand';
import { holdPreview } from '../lib/previewHold';
import { stemModelById, type StemBackend } from './config';
import { separateStems, stemEntry, type StemProgressMsg, type StemResult } from './client';
import { SAMPLE_RATE } from './dsp';
import { removeStems, saveStems, type StemsBake } from '../lib/audioTools/stems';

export type StemJobPhase = 'decode' | 'load' | 'separate' | 'encode' | 'save';

export interface StemJob {
  nodeId: string;
  song: string;
  model: string;
  phase: StemJobPhase;
  /** Segments done (with the current one's pieces as a fraction) and how many. */
  chunk: number;
  chunks: number;
  /** Encoding: which stem of how many. */
  stem: number;
  stems: number;
  /** Model loading (downloads only after the person said yes): bytes. */
  loaded: number;
  total: number;
  startedAt: number;
  /** When the separation itself started (for the estimate). */
  separateAt: number | null;
  /** The song's length, seconds. */
  seconds: number;
  backend: StemBackend | null;
  threads: number;
}

export interface StemJobEnd { kind: 'done' | 'cancelled' | 'error'; nodeId: string; message: string }

export interface StemJobState {
  job: StemJob | null;
  last: StemJobEnd | null;
  /** True while the preview is held for the job. */
  held: boolean;
}

export const useStemJob = create<StemJobState>(() => ({ job: null, last: null, held: false }));

/** 0–1: how far the run is (decode and load are the first few %, separation most of it, encoding the rest). */
export function jobFraction(j: StemJob): number {
  switch (j.phase) {
    case 'decode': return 0.01;
    case 'load': return 0.02 + 0.03 * (j.total ? j.loaded / j.total : 0);
    case 'separate': return 0.05 + 0.85 * (j.chunks ? Math.min(1, j.chunk / j.chunks) : 0);
    case 'encode': return 0.9 + 0.08 * (j.stems ? j.stem / j.stems : 0);
    case 'save': return 0.98;
  }
}

/** Seconds left, from the separation's own pace (null until a segment is done). */
export function jobRemaining(j: StemJob, now: number): number | null {
  if (j.phase !== 'separate' || j.separateAt === null || j.chunk < 0.5 || !j.chunks) return j.phase === 'encode' || j.phase === 'save' ? 2 : null;
  const per = (now - j.separateAt) / 1000 / j.chunk;
  // Encoding takes about a second a stem.
  return Math.max(0, per * (j.chunks - j.chunk)) + 4;
}

export interface StemJobInput {
  nodeId: string;
  /** The song in the library (its id and name). */
  songId: string;
  songName: string;
  model: string;
  /** The stems the node has now (removed once the new ones are kept). */
  previous: StemsBake | null;
}

export interface StemJobDeps {
  hold: () => () => void;
  /** The song's file from the library. */
  getSong: (id: string) => Promise<Blob | null>;
  /** Decode at 44.1 kHz, stereo (mono doubled). */
  decode: (blob: Blob) => Promise<{ left: Float32Array; right: Float32Array }>;
  separate: (model: string, left: Float32Array, right: Float32Array, sr: number, o: { onProgress: (m: StemProgressMsg) => void; signal: AbortSignal }) => Promise<StemResult>;
  save: (song: { id: string; name: string }, model: string, r: StemResult) => Promise<StemsBake>;
  remove: (bake: StemsBake | null) => Promise<void>;
  /** Put the bake on the node. */
  apply: (nodeId: string, bake: StemsBake) => void;
  now: () => number;
}

/** Decode a song at 44.1 kHz stereo (the model's rate). */
export async function decodeSong(blob: Blob): Promise<{ left: Float32Array; right: Float32Array }> {
  const Ctx = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
    ?? (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) throw new Error('This browser can\'t decode audio here.');
  const buf = await new Ctx(2, 1, SAMPLE_RATE).decodeAudioData(await blob.arrayBuffer());
  const left = new Float32Array(buf.getChannelData(0));
  const right = buf.numberOfChannels > 1 ? new Float32Array(buf.getChannelData(1)) : new Float32Array(left);
  return { left, right };
}

let abort: AbortController | null = null;

/** Stop the run (the stems made so far are dropped; the node keeps what it had). */
export function cancelStemJob(): void { abort?.abort(); }

/** Is a run going now? */
export const stemJobRunning = (): boolean => useStemJob.getState().job !== null;

/** One Separate run. Resolves with how it ended (never rejects). */
export async function runStemJob(input: StemJobInput, deps: StemJobDeps): Promise<StemJobEnd> {
  if (useStemJob.getState().job) return { kind: 'error', nodeId: input.nodeId, message: 'Already separating a song.' };
  const ctl = new AbortController();
  abort = ctl;
  const t0 = deps.now();
  const set = (p: Partial<StemJob>) => useStemJob.setState(s => (s.job ? { job: { ...s.job, ...p } } : s));
  useStemJob.setState({
    job: { nodeId: input.nodeId, song: input.songName, model: input.model, phase: 'decode', chunk: 0, chunks: 0, stem: 0, stems: stemModelById(input.model).stems.length, loaded: 0, total: 0, startedAt: t0, separateAt: null, seconds: 0, backend: stemEntry(input.model).backend, threads: stemEntry(input.model).threads },
    last: null, held: true,
  });
  const release = deps.hold();
  let end: StemJobEnd;
  try {
    const blob = await deps.getSong(input.songId);
    if (!blob) throw new Error(`"${input.songName}" isn't in this browser's library.`);
    if (ctl.signal.aborted) throw abortErr();
    const { left, right } = await deps.decode(blob);
    if (ctl.signal.aborted) throw abortErr();
    set({ phase: 'load', seconds: left.length / SAMPLE_RATE });
    const r = await deps.separate(input.model, left, right, SAMPLE_RATE, {
      signal: ctl.signal,
      onProgress: m => {
        if (m.phase === 'download') set({ phase: 'load', loaded: m.loaded, total: m.total });
        else if (m.phase === 'separate') {
          const cur = useStemJob.getState().job;
          const e = stemEntry(input.model);
          set({
            phase: 'separate', chunks: m.chunks, chunk: m.chunk + (m.pieces ? m.piece / m.pieces : 0),
            separateAt: cur?.separateAt ?? deps.now(), backend: e.backend, threads: e.threads,
          });
        } else set({ phase: 'encode', stem: m.stem, stems: m.stems });
      },
    });
    if (ctl.signal.aborted) throw abortErr();
    set({ phase: 'save', backend: r.backend, threads: r.threads });
    const bake = await deps.save({ id: input.songId, name: input.songName }, input.model, r);
    if (ctl.signal.aborted) { await deps.remove(bake); throw abortErr(); }
    deps.apply(input.nodeId, bake);
    // The old stems go once the new ones are on the node (a Re-separate).
    if (input.previous) await deps.remove({ ...input.previous, tracks: input.previous.tracks.filter(t => !bake.tracks.some(n => n.sampleId === t.sampleId)) });
    const secs = (deps.now() - t0) / 1000;
    end = { kind: 'done', nodeId: input.nodeId, message: `Separated in ${fmtDuration(secs)} (${r.backend === 'webgpu' ? 'WebGPU' : `WebAssembly${r.threads > 1 ? `, ${r.threads} threads` : ''}`}).` };
  } catch (e) {
    const cancelled = ctl.signal.aborted || (e instanceof Error && e.name === 'AbortError');
    end = cancelled ? { kind: 'cancelled', nodeId: input.nodeId, message: 'Separation cancelled: the stems are as they were.' }
      : { kind: 'error', nodeId: input.nodeId, message: e instanceof Error ? e.message : String(e) };
  } finally {
    release();
    if (abort === ctl) abort = null;
  }
  useStemJob.setState({ job: null, last: end, held: false });
  return end;
}

const abortErr = () => { const e = new Error('Cancelled'); e.name = 'AbortError'; return e; };

/** "45 s", "3 min 20 s". */
export function fmtDuration(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '';
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** The app's own wiring: the library, the worker, the preview hold. */
export async function defaultStemJobDeps(apply: StemJobDeps['apply']): Promise<StemJobDeps> {
  const { getVideo } = await import('../lib/backgroundLibrary');
  return {
    hold: holdPreview,
    getSong: async id => (await getVideo(id).catch(() => null))?.blob ?? null,
    decode: decodeSong,
    separate: (model, l, r, sr, o) => separateStems(model, l, r, sr, o),
    save: saveStems,
    remove: removeStems,
    apply,
    now: () => performance.now(),
  };
}
