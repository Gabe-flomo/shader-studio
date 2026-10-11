/**
 * useMediaPreviewList — the one keyboard + preview behaviour every media picker and
 * browser shares (sounds, pictures, videos), so a list of files works the same way
 * wherever it is: the Files page's Sounds, the linked-folder browser, the Texture
 * node's Library, the builders' image library, the backgrounds picker.
 *
 *   ↑/↓        move the highlight; the preview follows it (a sound plays when
 *              auto-preview is on, a picture shows large, a video plays)
 *   ←/→        sound/video: back to the start / skip ahead 3 s; pictures: previous / next
 *   Home/End   first / last
 *   Space      sound/video: play / pause
 *   Enter      pick the highlighted one
 *   Esc        stop the preview and close (when the picker closes)
 *
 * Mouse: a click highlights and previews without committing; double-click picks.
 * Phone: tap previews, tap the same row again to pick.
 *
 * Accessibility: spread `listProps` on the list (role=listbox, roving focus through
 * aria-activedescendant) and `optionProps(item)` on each row (role=option, its id).
 *
 * Playback goes through lib/samplePreview.ts: one sound preview player, and a video
 * preview registered there (`videoRef`), so only one preview plays at a time across
 * the app. The preview stops when the list unmounts (the picker closed).
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  PREVIEW_SKIP_SECONDS, claimVideoPreview, previewSample, releaseVideoPreview, restartPreview, setAutoPreview, skipPreview, stopPreview, togglePlayPause, useSamplePreviewStore,
} from '../../lib/samplePreview';

export type MediaKind = 'audio' | 'image' | 'video';

export interface MediaItem { id: string }

export interface UseMediaPreviewListOptions<T extends MediaItem> {
  kind: MediaKind;
  items: readonly T[];
  /** Audio: resolves the row's sound, a Blob (revoked once superseded) or a URL string, or null. */
  getSource?: (item: T) => Promise<Blob | string | null>;
  onPick: (item: T) => void;
  /** Esc: stop the preview and close the picker. */
  onClose?: () => void;
  /** Stop previewing when this unmounts (the picker closed); on by default. */
  stopOnUnmount?: boolean;
  /** The list's accessible name. */
  label?: string;
  /** What a screen reader hears for a row (defaults to nothing extra: the row's own text). */
  describe?: (item: T) => string;
}

type KeyLike = Pick<ReactKeyboardEvent, 'key' | 'preventDefault'> & { target?: EventTarget | null; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };

/** Keys typed into a field inside the list (a rename box) are left alone. */
const typing = (t: EventTarget | null | undefined) => {
  const el = t as HTMLElement | null | undefined;
  return !!el && typeof el.tagName === 'string' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true);
};

export function useMediaPreviewList<T extends MediaItem>({ kind, items, getSource, onPick, onClose, stopOnUnmount = true, label, describe }: UseMediaPreviewListOptions<T>) {
  const audio = useSamplePreviewStore();
  const [highlight, setHighlightState] = useState<string | null>(null);
  const highlightRef = useRef<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const getSourceRef = useRef(getSource);
  getSourceRef.current = getSource;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const baseId = useId();
  const videoEl = useRef<HTMLVideoElement | null>(null);

  const setHighlight = (id: string | null) => { highlightRef.current = id; setHighlightState(id); };

  // The picker closed: no preview carries on.
  useEffect(() => () => {
    if (!stopOnUnmount) return;
    if (kind === 'audio') stopPreview();
    if (videoEl.current) releaseVideoPreview(videoEl.current);
  }, [stopOnUnmount, kind]);

  // A highlight that left the list (search, another folder) is dropped, and its sound stops.
  useEffect(() => {
    const h = highlightRef.current;
    if (h && !items.some(i => i.id === h)) {
      setHighlight(null);
      if (kind === 'audio' && useSamplePreviewStore.getState().id === h) stopPreview();
    }
  }, [items, kind]);

  const optionId = (id: string) => {
    const idx = itemsRef.current.findIndex(i => i.id === id);
    return idx < 0 ? undefined : `${baseId}-opt-${idx}`;
  };

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    if (!highlight || typeof document === 'undefined') return;
    const id = optionId(highlight);
    const el = id ? document.getElementById(id) : null;
    el?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight]);

  const playAudio = (item: T) => {
    const get = getSourceRef.current;
    if (get) void previewSample(item.id, () => get(item));
  };

  const highlightItem = (item: T, opts: { autoPlay?: boolean } = {}) => {
    setHighlight(item.id);
    if (kind === 'audio' && opts.autoPlay !== false && useSamplePreviewStore.getState().autoPreview) playAudio(item);
  };

  const move = (delta: number) => {
    const list = itemsRef.current;
    if (!list.length) return;
    const idx = list.findIndex(i => i.id === highlightRef.current);
    const next = idx < 0 ? list[delta < 0 ? list.length - 1 : 0] : list[Math.max(0, Math.min(list.length - 1, idx + delta))];
    if (next && next.id !== highlightRef.current) highlightItem(next);
  };
  const jump = (to: 'first' | 'last') => {
    const list = itemsRef.current;
    const next = to === 'first' ? list[0] : list[list.length - 1];
    if (next) highlightItem(next);
  };

  const video = () => videoEl.current;
  const restart = () => {
    if (kind === 'audio') { restartPreview(); return; }
    const v = video();
    if (!v) return;
    v.currentTime = 0;
    if (v.paused) { claimVideoPreview(v); void v.play()?.catch?.(() => {}); }
  };
  const skip = (s: number) => {
    if (kind === 'audio') { skipPreview(s); return; }
    const v = video();
    if (!v) return;
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Infinity;
    v.currentTime = Math.max(0, Math.min(dur, v.currentTime + s));
  };
  const toggle = () => {
    if (kind === 'audio') {
      // Nothing loaded yet: Space plays the highlighted one.
      if (!useSamplePreviewStore.getState().id) { const it = itemsRef.current.find(i => i.id === highlightRef.current); if (it) playAudio(it); return; }
      togglePlayPause();
      return;
    }
    const v = video();
    if (!v) return;
    if (v.paused) { claimVideoPreview(v); void v.play()?.catch?.(() => {}); } else v.pause();
  };

  const pickHighlighted = () => {
    const list = itemsRef.current;
    const id = highlightRef.current ?? (kind === 'audio' ? useSamplePreviewStore.getState().id : null);
    const item = list.find(i => i.id === id);
    if (item) onPickRef.current(item);
  };

  const onKeyDown = (e: KeyLike) => {
    if (typing(e.target) || e.altKey || e.metaKey || e.ctrlKey) return;
    const timed = kind !== 'image';
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'ArrowLeft': e.preventDefault(); if (timed) restart(); else move(-1); break;
      case 'ArrowRight': e.preventDefault(); if (timed) skip(PREVIEW_SKIP_SECONDS); else move(1); break;
      case 'Home': e.preventDefault(); jump('first'); break;
      case 'End': e.preventDefault(); jump('last'); break;
      case ' ': case 'Spacebar': if (timed) { e.preventDefault(); toggle(); } break;
      case 'Enter': e.preventDefault(); pickHighlighted(); break;
      case 'Escape':
        if (kind === 'audio') stopPreview();
        else if (videoEl.current) videoEl.current.pause();
        if (onClose) { e.preventDefault(); onClose(); }
        break;
      default: break;
    }
  };

  const onRowClick = (item: T) => highlightItem(item);
  const onRowDoubleClick = (item: T) => onPickRef.current(item);
  /** Phone: tap once to preview (and highlight), tap again on the same row to pick. */
  const onRowTap = (item: T) => { if (highlightRef.current === item.id) onPickRef.current(item); else highlightItem(item); };

  /** The video picker's preview element: registered so only one preview plays app-wide. */
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    if (videoEl.current && videoEl.current !== el) releaseVideoPreview(videoEl.current);
    videoEl.current = el;
  }, []);
  /** Spread on the preview <video>: claims the one-preview slot whenever it starts. */
  const videoProps = {
    ref: videoRef,
    autoPlay: true, muted: true, loop: true, playsInline: true,
    onPlay: (e: { currentTarget: HTMLVideoElement }) => claimVideoPreview(e.currentTarget),
  };

  const highlighted = highlight ? items.find(i => i.id === highlight) ?? null : null;
  const activeId = highlight ? optionId(highlight) : undefined;

  const listProps = {
    role: 'listbox' as const,
    tabIndex: 0,
    'aria-label': label,
    'aria-activedescendant': activeId,
    'data-media-list': kind,
    onKeyDown,
  };
  const optionProps = (item: T) => ({
    id: optionId(item.id),
    role: 'option' as const,
    'aria-selected': highlight === item.id,
    ...(describe ? { 'aria-label': describe(item) } : {}),
  });

  return {
    kind,
    highlight,
    highlighted,
    setHighlight: (id: string | null) => { const it = id ? itemsRef.current.find(i => i.id === id) : null; if (it) highlightItem(it, { autoPlay: false }); else setHighlight(null); },
    listProps,
    optionProps,
    videoRef,
    videoProps,
    playingId: audio.id,
    playing: audio.playing,
    loading: audio.loading,
    position: audio.position,
    duration: audio.duration,
    error: audio.error,
    autoPreview: audio.autoPreview,
    setAutoPreview,
    onKeyDown,
    onRowClick,
    onRowDoubleClick,
    onRowTap,
  };
}

export type MediaPreviewList<T extends MediaItem> = ReturnType<typeof useMediaPreviewList<T>>;
