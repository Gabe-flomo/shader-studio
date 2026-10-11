/**
 * useSamplePreview — Splice-style auditioning for a list of samples: the audio
 * kind of the shared useMediaPreviewList (components/media), kept under its
 * old name for the sound browsers. ↑/↓ move the highlight (and, with
 * auto-preview on, play it), ← restarts, → skips 3 s, Space toggles, Enter
 * picks, Esc stops and closes. Mouse: click a row = highlight + preview,
 * double-click = pick. The first ↑/↓/click is what satisfies the browser's
 * autoplay gate: nothing plays before it.
 */
import { useMediaPreviewList, type MediaItem } from '../media/useMediaPreviewList';

export type SampleItem = MediaItem;

export interface UseSamplePreviewOptions<T extends SampleItem> {
  items: readonly T[];
  /** Resolves the row's audio: a Blob (revoked once superseded) or a URL string, or null when it can't be loaded. */
  getSource: (item: T) => Promise<Blob | string | null>;
  onPick: (item: T) => void;
  /** Esc: stop the preview and close the picker. */
  onClose?: () => void;
  /** Stop previewing when this unmounts (the picker closed); on by default. */
  stopOnUnmount?: boolean;
  label?: string;
}

export function useSamplePreview<T extends SampleItem>(o: UseSamplePreviewOptions<T>) {
  return useMediaPreviewList<T>({ kind: 'audio', ...o });
}
