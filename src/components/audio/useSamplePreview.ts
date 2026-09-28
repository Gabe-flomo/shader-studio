/**
 * useSamplePreview — Splice-style auditioning for a list of samples, shared
 * by the Sounds tab, the linked-folder browser (filtered to audio) and the
 * drum pad picker. Wraps lib/samplePreview.ts's dedicated preview player with
 * the list-navigation part: ↑/↓ move the highlight (and, with auto-preview
 * on, play it), ← restarts, → skips 3 s, Space toggles, Enter picks, Esc
 * stops and closes. Mouse: click a row = highlight + preview, double-click =
 * pick. The first ↑/↓/click is what satisfies the browser's autoplay gate —
 * nothing plays before it.
 */
import { useEffect, useRef, useState } from 'react';
import {
  PREVIEW_SKIP_SECONDS, previewSample, restartPreview, setAutoPreview, skipPreview, stopPreview, togglePlayPause, useSamplePreviewStore,
} from '../../lib/samplePreview';

export interface SampleItem { id: string }

export interface UseSamplePreviewOptions<T extends SampleItem> {
  items: readonly T[];
  /** Resolves the row's audio: a Blob (revoked once superseded) or a URL string, or null when it can't be loaded. */
  getSource: (item: T) => Promise<Blob | string | null>;
  onPick: (item: T) => void;
  /** Esc: stop the preview and close the picker. */
  onClose?: () => void;
  /** Stop previewing when this unmounts (the picker closed) — on by default. */
  stopOnUnmount?: boolean;
}

export function useSamplePreview<T extends SampleItem>({ items, getSource, onPick, onClose, stopOnUnmount = true }: UseSamplePreviewOptions<T>) {
  const state = useSamplePreviewStore();
  const [highlight, setHighlight] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const getSourceRef = useRef(getSource);
  getSourceRef.current = getSource;

  useEffect(() => () => { if (stopOnUnmount) stopPreview(); }, [stopOnUnmount]);

  const play = (item: T) => { void previewSample(item.id, () => getSourceRef.current(item)); };

  const highlightItem = (item: T, opts: { autoPlay?: boolean } = {}) => {
    setHighlight(item.id);
    if (opts.autoPlay !== false && state.autoPreview) play(item);
  };

  const move = (delta: number) => {
    const list = itemsRef.current;
    if (!list.length) return;
    const idx = list.findIndex(i => i.id === highlight);
    const next = list[Math.max(0, Math.min(list.length - 1, idx + delta))];
    if (next) highlightItem(next);
  };

  const onKeyDown = (e: { key: string; preventDefault(): void }) => {
    const list = itemsRef.current;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (!highlight && list[0]) highlightItem(list[0]); else move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'ArrowLeft': e.preventDefault(); restartPreview(); break;
      case 'ArrowRight': e.preventDefault(); skipPreview(PREVIEW_SKIP_SECONDS); break;
      case ' ': case 'Spacebar': e.preventDefault(); togglePlayPause(); break;
      case 'Enter': { e.preventDefault(); const item = list.find(i => i.id === (highlight ?? state.id)); if (item) onPick(item); break; }
      case 'Escape': e.preventDefault(); stopPreview(); onClose?.(); break;
      default: break;
    }
  };

  const onRowClick = (item: T) => highlightItem(item);
  const onRowDoubleClick = (item: T) => onPick(item);
  /** Phone: tap once to preview (and highlight), tap again on the same row to pick. */
  const onRowTap = (item: T) => { if (highlight === item.id) onPick(item); else highlightItem(item); };

  return {
    highlight,
    playingId: state.id,
    playing: state.playing,
    loading: state.loading,
    position: state.position,
    duration: state.duration,
    error: state.error,
    autoPreview: state.autoPreview,
    setAutoPreview,
    onKeyDown,
    onRowClick,
    onRowDoubleClick,
    onRowTap,
  };
}
