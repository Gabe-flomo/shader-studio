/**
 * samplePreview.ts — the one "auditioning" player every sample browser uses
 * (the Sounds tab, the linked-folder browser filtered to audio, the drum pad
 * picker): a dedicated `<audio>` element at a fixed preview volume, separate
 * from the master effects chain, so arrowing through samples never touches
 * the graph's own audio. Only one sample previews at a time; loading it again
 * for a different id cancels whatever was in flight.
 *
 * Pure state + playback here (no React); useSamplePreview.ts wraps it for
 * components.
 */
import { create } from 'zustand';

/** Fixed, independent of the master/graph volume. */
export const PREVIEW_VOLUME = 0.6;
/** ArrowRight skips ahead this many seconds. */
export const PREVIEW_SKIP_SECONDS = 3;

const AUTO_PREVIEW_KEY = 'shader-studio:sample-preview:auto';

export interface SamplePreviewState {
  /** The row id currently loaded (playing, paused, or still loading). Null when nothing is previewing. */
  id: string | null;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  error: string | null;
  /** Remembered (localStorage): selecting/highlighting a row plays it at once. */
  autoPreview: boolean;
}

function readAutoPreview(): boolean {
  try { const v = localStorage.getItem(AUTO_PREVIEW_KEY); return v === null ? true : v === '1'; } catch { return true; }
}

export const useSamplePreviewStore = create<SamplePreviewState>(() => ({
  id: null, playing: false, loading: false, position: 0, duration: 0, error: null, autoPreview: readAutoPreview(),
}));

let audioEl: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let ownsUrl = false;
let rafId: number | null = null;
let loadSeq = 0;

function getEl(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.volume = PREVIEW_VOLUME;
    audioEl.preload = 'auto';
    audioEl.addEventListener('ended', () => { useSamplePreviewStore.setState({ playing: false }); stopTick(); });
    audioEl.addEventListener('loadedmetadata', () => { if (audioEl) useSamplePreviewStore.setState({ duration: isFinite(audioEl.duration) ? audioEl.duration : 0 }); });
    audioEl.addEventListener('error', () => { useSamplePreviewStore.setState({ error: 'Couldn’t play that sound', loading: false, playing: false }); stopTick(); });
  }
  return audioEl;
}

function stopTick(): void { if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } }
function tick(): void {
  const a = audioEl;
  if (a && !a.paused && !a.ended) {
    useSamplePreviewStore.setState({ position: a.currentTime });
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
  }
}
function startTick(): void { if (rafId == null) rafId = requestAnimationFrame(tick); }

function releaseUrl(): void {
  if (ownsUrl && currentUrl) { try { URL.revokeObjectURL(currentUrl); } catch { /* ignore */ } }
  currentUrl = null;
  ownsUrl = false;
}

export function setAutoPreview(v: boolean): void {
  useSamplePreviewStore.setState({ autoPreview: v });
  try { localStorage.setItem(AUTO_PREVIEW_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

/** Stop and unload whatever is previewing (the picker closed, or a sample was picked). */
export function stopPreview(): void {
  loadSeq++; // cancel anything in flight
  stopTick();
  if (audioEl) { try { audioEl.pause(); } catch { /* ignore */ } audioEl.removeAttribute('src'); try { audioEl.load(); } catch { /* ignore */ } }
  releaseUrl();
  useSamplePreviewStore.setState({ id: null, playing: false, loading: false, position: 0, duration: 0, error: null });
}

/**
 * Preview `id`'s sound: `getSource` resolves to a Blob (revoked when the
 * preview moves on) or a URL string (left alone), or null when it can't be
 * loaded. Superseded by a later call for a different id.
 */
export async function previewSample(id: string, getSource: () => Promise<Blob | string | null>): Promise<void> {
  const seq = ++loadSeq;
  const a = getEl();
  useSamplePreviewStore.setState({ id, loading: true, error: null, playing: false, position: 0, duration: 0 });
  let got: Blob | string | null;
  try { got = await getSource(); }
  catch (e) { if (seq === loadSeq) useSamplePreviewStore.setState({ loading: false, error: e instanceof Error ? e.message : String(e) }); return; }
  if (seq !== loadSeq) return;
  if (!got) { useSamplePreviewStore.setState({ loading: false, error: 'Couldn’t load that sound' }); return; }
  releaseUrl();
  if (typeof got === 'string') { currentUrl = got; ownsUrl = false; } else { currentUrl = URL.createObjectURL(got); ownsUrl = true; }
  a.src = currentUrl;
  try {
    await a.play();
    if (seq !== loadSeq) return;
    useSamplePreviewStore.setState({ loading: false, playing: true });
    startTick();
  } catch (e) {
    if (seq !== loadSeq) return;
    // Autoplay refused before the user's first interaction, or the file failed to decode.
    useSamplePreviewStore.setState({ loading: false, playing: false, error: e instanceof Error ? e.message : String(e) });
  }
}

export function togglePlayPause(): void {
  const s = useSamplePreviewStore.getState();
  if (!s.id || !audioEl) return;
  if (audioEl.paused) { void audioEl.play().then(() => { useSamplePreviewStore.setState({ playing: true }); startTick(); }).catch(() => {}); }
  else { audioEl.pause(); useSamplePreviewStore.setState({ playing: false }); stopTick(); }
}

export function restartPreview(): void {
  const s = useSamplePreviewStore.getState();
  if (!s.id || !audioEl) return;
  audioEl.currentTime = 0;
  useSamplePreviewStore.setState({ position: 0 });
  if (audioEl.paused) { void audioEl.play().then(() => { useSamplePreviewStore.setState({ playing: true }); startTick(); }).catch(() => {}); }
}

/** Clamped to [0, duration]. */
export function skipPreview(seconds: number): void {
  const s = useSamplePreviewStore.getState();
  if (!s.id || !audioEl) return;
  const dur = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : s.duration || Infinity;
  const next = Math.max(0, Math.min(dur, audioEl.currentTime + seconds));
  audioEl.currentTime = next;
  useSamplePreviewStore.setState({ position: next });
}

/** For tests: replace the `<audio>` element (e.g. with a fake one), and reset state. */
export function resetSamplePreviewForTests(fakeAudio?: HTMLAudioElement): void {
  stopPreview();
  audioEl = fakeAudio ?? null;
  currentUrl = null; ownsUrl = false; loadSeq = 0;
  useSamplePreviewStore.setState({ id: null, playing: false, loading: false, position: 0, duration: 0, error: null, autoPreview: readAutoPreview() });
}
