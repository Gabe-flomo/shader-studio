/**
 * The histogram's picked band (App.tsx HistogramOverlay): a brightness range of one channel. While one
 * is set, the live preview shows only the pixels whose channel falls in it, in their own colours, and
 * dims the rest to a faint grey (ShaderCanvas's blit, BLIT_FRAG). Never in recordings or exports.
 */
import { create } from 'zustand';

export type BandChannel = 'luma' | 'r' | 'g' | 'b';
export interface HistBand { channel: BandChannel; lo: number; hi: number }

export const useHistBand = create<{ band: HistBand | null; set: (b: HistBand | null) => void }>(set => ({
  band: null,
  set: band => set({ band }),
}));

/** The blit's uniforms for a band: channel 0 is off, 1 luma, 2 red, 3 green, 4 blue. */
export function bandUniforms(b: HistBand | null): { ch: number; lo: number; hi: number } {
  if (!b) return { ch: 0, lo: 0, hi: 1 };
  return { ch: { luma: 1, r: 2, g: 3, b: 4 }[b.channel], lo: Math.min(b.lo, b.hi), hi: Math.max(b.lo, b.hi) };
}

/** Is `rgb` (0–1) in the band? The CPU twin of the shader's test (for tests). */
export function inBand(b: HistBand, rgb: [number, number, number]): boolean {
  const [r, g, bl] = rgb.map(v => Math.min(Math.max(v, 0), 1));
  const v = b.channel === 'luma' ? 0.299 * r + 0.587 * g + 0.114 * bl : b.channel === 'r' ? r : b.channel === 'g' ? g : bl;
  const { lo, hi } = bandUniforms(b);
  // The top band includes 1.0 (the histogram's last bin does)
  return v >= lo && (v < hi || (hi >= 1 && v <= 1));
}
