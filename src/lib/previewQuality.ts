/**
 * previewQuality — the preview's resolution, like After Effects' Full / Half /
 * Third / Quarter: the live canvas renders that share of its pixels on each
 * side and is stretched to fit, so a heavy scene keeps running smoothly while
 * you work. Remembered. Exports always render at full resolution: the Export
 * dialog holds the preview at Full while it is open.
 *
 * Auto (the default until you pick one) starts at Full and drops a level when the picture's GPU
 * work gets heavy enough to stall the page, coming back up when it would fit (lib/autoQuality.ts).
 */
import { create } from 'zustand';

export const PREVIEW_QUALITIES = [
  { value: 1, label: 'Full', short: 'Full' },
  { value: 1 / 2, label: 'Half', short: '½' },
  { value: 1 / 3, label: 'Third', short: '⅓' },
  { value: 1 / 4, label: 'Quarter', short: '¼' },
] as const;

const KEY = 'shader-studio:preview-quality';
/** The stored choice: a fixed share, or 'auto' (also when nothing was ever picked). */
const load = (): number | 'auto' => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null || raw === 'auto') return 'auto';
    const v = Number(raw);
    return PREVIEW_QUALITIES.some(q => Math.abs(q.value - v) < 1e-6) ? v : 'auto';
  } catch { return 'auto'; }
};
const initial = load();

interface PreviewQualityState {
  /** The chosen share of the resolution (1, ½, ⅓, ¼); ignored while `auto`. */
  scale: number;
  /** Auto: the frame loop picks the share by how heavy the picture is. */
  auto: boolean;
  /** Auto's current share. */
  autoScale: number;
  /** Held at Full (exporting): how many holders. */
  holds: number;
  setScale: (s: number) => void;
  setAuto: () => void;
  /** The frame loop's Auto decision. */
  setAutoScale: (s: number) => void;
  hold: () => () => void;
}

export const usePreviewQuality = create<PreviewQualityState>((set, get) => ({
  scale: initial === 'auto' ? 1 : initial,
  auto: initial === 'auto',
  autoScale: 1,
  holds: 0,
  setScale: scale => { try { localStorage.setItem(KEY, String(scale)); } catch { /* preference only */ } set({ scale, auto: false }); },
  setAuto: () => { try { localStorage.setItem(KEY, 'auto'); } catch { /* preference only */ } set({ auto: true, autoScale: 1 }); },
  setAutoScale: autoScale => { if (get().autoScale !== autoScale) set({ autoScale }); },
  hold: () => {
    set({ holds: get().holds + 1 });
    let done = false;
    return () => { if (done) return; done = true; set({ holds: Math.max(0, get().holds - 1) }); };
  },
}));

/** What the preview renders at now: Full while held, else Auto's share or the chosen one. */
export const effectivePreviewQuality = (s: Pick<PreviewQualityState, 'scale' | 'holds' | 'auto' | 'autoScale'> = usePreviewQuality.getState()): number =>
  (s.holds > 0 ? 1 : s.auto ? s.autoScale : s.scale);
