/**
 * previewQuality — the preview's resolution, like After Effects' Full / Half /
 * Third / Quarter: the live canvas renders that share of its pixels on each
 * side and is stretched to fit, so a heavy scene keeps running smoothly while
 * you work. Remembered. Exports always render at full resolution: the Export
 * dialog holds the preview at Full while it is open.
 */
import { create } from 'zustand';

export const PREVIEW_QUALITIES = [
  { value: 1, label: 'Full', short: 'Full' },
  { value: 1 / 2, label: 'Half', short: '½' },
  { value: 1 / 3, label: 'Third', short: '⅓' },
  { value: 1 / 4, label: 'Quarter', short: '¼' },
] as const;

const KEY = 'shader-studio:preview-quality';
const load = (): number => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return PREVIEW_QUALITIES.some(q => Math.abs(q.value - v) < 1e-6) ? v : 1;
  } catch { return 1; }
};

interface PreviewQualityState {
  /** The chosen share of the resolution (1, ½, ⅓, ¼). */
  scale: number;
  /** Held at Full (exporting): how many holders. */
  holds: number;
  setScale: (s: number) => void;
  hold: () => () => void;
}

export const usePreviewQuality = create<PreviewQualityState>((set, get) => ({
  scale: load(),
  holds: 0,
  setScale: scale => { try { localStorage.setItem(KEY, String(scale)); } catch { /* preference only */ } set({ scale }); },
  hold: () => {
    set({ holds: get().holds + 1 });
    let done = false;
    return () => { if (done) return; done = true; set({ holds: Math.max(0, get().holds - 1) }); };
  },
}));

/** What the preview renders at now: Full while held, else the chosen share. */
export const effectivePreviewQuality = (s: Pick<PreviewQualityState, 'scale' | 'holds'> = usePreviewQuality.getState()): number => (s.holds > 0 ? 1 : s.scale);
