/**
 * tapePreview.ts — each tape track's sound as a waveform for its lane
 * (docs/arrangement.md): the track rendered offline, alone, through its
 * rack's instrument, the way a take's render does it, refreshed after each
 * recording. Nothing is heard.
 *
 *   Granulator (anywhere)       the kit's pure grain engine (recordingAudio.ts
 *                               renderGrains), its settings following the
 *                               track's automation
 *   Audio Unit / sample player  the native offline replay (engineRender.ts,
 *   (desktop)                   ae_render_take), the rack alone
 *   sample player (browser)     an OfflineAudioContext playing the zones'
 *                               sounds at each note, as the live one does
 *
 * Anything else (an Audio Unit in a browser) has notes only: the lane says why.
 * The peaks live here, not in the record.
 */
import { create } from 'zustand';
import type { PlayRecord } from '../types/play';
import { AE_INST, auTarget, isGranulatorRack, macroPropId, macroTarget, zoneForNote, type AeRack, type AeZone } from '../types/playAudioEngine';
import { autoAt, type PlayArrangement } from '../types/playArrangement';
import { tapeEvents } from './tapeTake';
import { renderGrains, padHitsOf } from './recordingAudio';
import { grainBuffer } from './webGranulator';
import { engineRenderJob } from './engineRender';
import { audioEngineHost } from './audioEngineHost';

/** Waveform columns per lane. */
export const PREVIEW_COLUMNS = 480;
const RATE = 22050;
const LOADING = 'Its sound is still loading.';

export type LanePreview =
  | { status: 'ok'; peaks: Float32Array; length: number }
  | { status: 'busy' }
  | { status: 'none'; why: string };

export const useTapePreviews = create<{ lanes: Record<string, LanePreview> }>(() => ({ lanes: {} }));

/** Largest absolute sample per column (both sides), 0..1. */
export function peaksOf(left: Float32Array, right: Float32Array | null, columns = PREVIEW_COLUMNS): Float32Array {
  const out = new Float32Array(columns);
  const n = left.length;
  if (!n) return out;
  for (let c = 0; c < columns; c++) {
    const a = Math.floor((c * n) / columns), b = Math.max(a + 1, Math.floor(((c + 1) * n) / columns));
    let m = 0;
    for (let i = a; i < b && i < n; i++) {
      const v = Math.abs(left[i]);
      if (v > m) m = v;
      if (right) { const w = Math.abs(right[i]); if (w > m) m = w; }
    }
    out[c] = Math.min(1, m);
  }
  return out;
}

/** What a lane's preview was made from, so an unchanged track isn't rendered again. */
const made = new Map<string, string>();

/** Render the lanes of these racks (all when omitted) again where their track or instrument changed. */
export function refreshPreviews(play: PlayRecord, racks?: readonly string[]): void {
  const arr = play.arrangement;
  const all = play.audioEngine?.racks ?? [];
  for (const r of all) {
    if (racks && !racks.includes(r.id)) continue;
    const track = arr?.tracks[r.id];
    const key = JSON.stringify([arr?.length, track?.notes, track?.auto, r.instrument, r.effects.map(e => [e.id, e.bypass, e.params]), r.volume]);
    if (made.get(r.id) === key) continue;
    made.set(r.id, key);
    if (!arr || !track || !(arr.length > 0) || !track.notes.length) { setLane(r.id, { status: 'none', why: '' }); continue; }
    setLane(r.id, { status: 'busy' });
    void renderLane(r, arr).then(res => {
      if (made.get(r.id) !== key) return;
      setLane(r.id, res);
      // The rack's sound was still loading: try again shortly.
      if (res.status === 'none' && res.why === LOADING) { made.delete(r.id); setTimeout(() => refreshPreviews(play, [r.id]), 1000); }
    }).catch(e => setLane(r.id, { status: 'none', why: e instanceof Error ? e.message : String(e) }));
  }
}

function setLane(id: string, p: LanePreview): void {
  useTapePreviews.setState(s => ({ lanes: { ...s.lanes, [id]: p } }));
}

async function renderLane(r: AeRack, arr: PlayArrangement): Promise<LanePreview> {
  const length = arr.length;
  const events = tapeEvents({ ...arr, tracks: { [r.id]: { ...arr.tracks[r.id], mute: false, solo: false } } }, [r.id]);
  const take = { from: 0, length, events, tracks: [] };
  if (isGranulatorRack(r) && !r.source) {
    const buffer = grainBuffer(r.instrument?.sample);
    if (!buffer) return { status: 'none', why: LOADING };
    if (typeof OfflineAudioContext === 'undefined') return { status: 'none', why: '' };
    const frames = Math.max(1, Math.ceil(length * RATE));
    const ctx = new OfflineAudioContext(2, frames, RATE);
    const auto = arr.tracks[r.id].auto;
    const b = renderGrains(ctx, { rackId: r.id, slot: r.instrument!, buffer, volume: r.volume, ...(r.macros ? { macros: r.macros } : {}) }, padHitsOf(take, 0, length), frames,
      // A setting's own lane, or a macro's (macro:<rack> / n), which renderGrains reads through the macro's targets.
      (id, key, base, t) => autoAt(auto[id === macroPropId(r.id) ? macroTarget(r.id, Number(key)) : auTarget(r.id, AE_INST, key)], t) ?? base);
    return { status: 'ok', peaks: peaksOf(b.getChannelData(0), b.getChannelData(1)), length };
  }
  if (audioEngineHost.renders()) {
    const job = engineRenderJob({ racks: [r] }, { id: 'lane', name: 'lane', ...take }, 0, length, 24000);
    if (!job) return { status: 'none', why: '' };
    const out = await audioEngineHost.renderTake(job);
    if (!out) return { status: 'none', why: 'The engine isn’t running.' };
    return { status: 'ok', peaks: peaksOf(out.left, out.right), length };
  }
  const web = r.instrument?.kind === 'sampler' ? audioEngineHost.webSampler(r.id) : null;
  if (web) {
    const b = await renderSampler(web.zones, web.buffers, arr.tracks[r.id].notes, length, r.volume);
    return b ? { status: 'ok', peaks: peaksOf(b.getChannelData(0), b.numberOfChannels > 1 ? b.getChannelData(1) : null), length } : { status: 'none', why: '' };
  }
  return { status: 'none', why: r.instrument?.kind === 'au' ? 'Audio Units sound in the desktop app: the notes are here.' : '' };
}

/** The browser's sample player offline: each note's zone sound at its pitch and velocity (it plays to its end, as live). */
export async function renderSampler(zones: readonly AeZone[], buffers: ReadonlyMap<string, AudioBuffer>, notes: ReadonlyArray<{ t: number; n: number; v: number }>, length: number, volume = 1): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === 'undefined' || !(length > 0)) return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(length * RATE)), RATE);
  for (const n of notes) {
    const z = zoneForNote(zones, n.n);
    const b = z && buffers.get(z.sampleId);
    if (!z || !b || n.t >= length) continue;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = Math.max(0.25, Math.min(4, Math.pow(2, (n.n - z.root) / 12)));
    const g = ctx.createGain();
    g.gain.value = z.gain * n.v * volume;
    src.connect(g).connect(ctx.destination);
    src.start(n.t);
  }
  return ctx.startRendering();
}

/** Forget every preview (another setup was opened). */
export function resetPreviews(): void {
  made.clear();
  useTapePreviews.setState({ lanes: {} });
}
