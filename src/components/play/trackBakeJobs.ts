/**
 * trackBakeJobs.ts — "Analyse video" (docs/tracking.md): runs a tracker over
 * a Video layer's file once (lib/trackBakes.ts analyseVideo), keeps the frames
 * in the browser's track store and a note of them in the setup (the tracker's
 * `bakes`). One analysis per tracker at a time, with its progress, and Cancel.
 */
import { create } from 'zustand';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { playVideoLayers } from '../../play/videoLayers';
import { trackerFeeds, type TrackerKind } from '../../lib/handFeed';
import { BakeCancelled, analyseVideo, bakeSig, deleteBake, newBakeKey, saveBake, trackerOptionsFor } from '../../lib/trackBakes';
import { DEFAULT_HANDS, type PlayRecord } from '../../types/play';
import { DEFAULT_FACE, DEFAULT_POSE, bakeFor, withBake, type PlayTracker, type TrackBakeRef } from '../../types/playTracking';
import { toast } from '../ui/toastStore';

/** The model downloading or loading (docs/tracking.md "Models"), before frame-by-frame analysis starts. */
export interface BakeModelPhase { phase: 'downloading' | 'loading'; loaded?: number; total?: number }
export interface BakeJob { layerId: string; progress: number; abort: AbortController; model?: BakeModelPhase }

interface BakeJobs {
  jobs: Partial<Record<TrackerKind, BakeJob>>;
  /** The last analysis that failed, per tracker (shown on the card until the next try). */
  errors: Partial<Record<TrackerKind, string>>;
}

export const useBakeJobs = create<BakeJobs>(() => ({ jobs: {}, errors: {} }));

/** A tracker's settings in a setup. */
export function trackerSettingsOf(p: PlayRecord, kind: TrackerKind): PlayTracker {
  if (kind === 'hands') return p.hands ?? DEFAULT_HANDS;
  return (kind === 'face' ? p.face : p.pose) ?? (kind === 'face' ? DEFAULT_FACE : DEFAULT_POSE);
}

/** A setup with a tracker's settings patched (a patch value of undefined leaves the file). */
export function patchTracker(p: PlayRecord, kind: TrackerKind, patch: Partial<PlayTracker>): PlayRecord {
  const next = { ...trackerSettingsOf(p, kind), ...patch } as PlayTracker & Record<string, unknown>;
  for (const k of Object.keys(patch)) if ((patch as Record<string, unknown>)[k] === undefined) delete next[k];
  return { ...p, [kind]: next };
}

/** Cancel a tracker's running analysis. */
export function cancelBake(kind: TrackerKind): void {
  useBakeJobs.getState().jobs[kind]?.abort.abort();
}

/** Analyse a Video layer's file for a tracker, `fps` frames a second. Resolves when it is done (or cancelled, or failed). */
export async function startBake(kind: TrackerKind, layerId: string, fps: number): Promise<void> {
  if (useBakeJobs.getState().jobs[kind]) return;
  const play = useNodeGraphStore.getState().play;
  const layer = play.layers.find(l => l.id === layerId);
  const file = playVideoLayers.file(layerId);
  if (!layer || layer.kind !== 'video' || !layer.videoId || !file) { toast.error('No video to analyse yet', { message: 'Pick a video for the layer (or wait until it opens), then try again.' }); return; }
  const options = trackerOptionsFor(kind, trackerSettingsOf(play, kind));
  const abort = new AbortController();
  const setJob = (job: BakeJob | undefined) => useBakeJobs.setState(s => ({ jobs: { ...s.jobs, [kind]: job } }));
  setJob({ layerId, progress: 0, abort, model: { phase: 'downloading' } });
  useBakeJobs.setState(s => ({ errors: { ...s.errors, [kind]: undefined } }));
  let last = 0, lastModel = 0;
  try {
    const r = await analyseVideo({
      kind, blob: file.blob, fps, options, signal: abort.signal,
      // Progress: a few updates a second, not one per frame.
      progress: p => { const now = performance.now(); if (now - last > 120 || p >= 1) { last = now; setJob({ layerId, progress: p, abort }); } },
      onModelProgress: p => {
        const now = performance.now();
        if (now - lastModel > 80) { lastModel = now; setJob({ layerId, progress: 0, abort, model: { phase: p.phase, loaded: p.loaded, total: p.total } }); }
      },
    });
    const key = newBakeKey(kind);
    const kept = await saveBake(key, r.bytes);
    const ref: TrackBakeRef = { key, layerId, videoId: layer.videoId, sig: bakeSig(kind, options), frames: r.frames, fps, duration: r.duration, bytes: r.bytes.length };
    const before = bakeFor(trackerSettingsOf(useNodeGraphStore.getState().play, kind).bakes, layerId, layer.videoId, '');
    useNodeGraphStore.getState().setPlay(p => patchTracker(p, kind, { bakes: withBake(trackerSettingsOf(p, kind).bakes, ref) }));
    if (before && before.bake.key !== key) void deleteBake(before.bake.key);
    // The live tracker on this video isn't needed any more: the engine reads the baked frames.
    const feed = trackerFeeds[kind];
    if (feed.tracksVideo() && feed.getStatus() !== 'off') feed.stop();
    if (!kept) toast.info('Analysed for this session only', { message: 'This browser couldn’t keep the analysis (storage full or blocked): after a reload, analyse the video again.' });
  } catch (e) {
    if (e instanceof BakeCancelled) return;
    const message = e instanceof Error ? e.message : String(e);
    useBakeJobs.setState(s => ({ errors: { ...s.errors, [kind]: message } }));
    toast.error('The video couldn’t be analysed', { message });
  } finally {
    setJob(undefined);
  }
}
