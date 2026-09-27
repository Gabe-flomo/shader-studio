/**
 * backgroundsUi.ts — open the backgrounds windows from anywhere, and get an
 * answer back (a promise), like askText in ui/dialogStore.ts:
 *
 *   openCapture({ aspect?, size?, from? }) → the new image background's id, or null
 *     The capture window: pick a saved graph or example, scrub its time, set
 *     its Play controls, render the shader alone or with its layers, and
 *     Capture (saved to the library's Image backgrounds, named after the
 *     graph and time). `aspect` (w / h) sets the starting size (1080 on the
 *     short side), e.g. a presentation's; `size` sets it exactly.
 *
 *   openBackgrounds({ pick?, title? }) → what was picked, or null
 *     The library's backgrounds (Images and Palettes, folders, rename,
 *     delete with undo, import, capture). With `pick` it's a picker: choosing
 *     an image or palette resolves with it.
 *
 * <BackgroundsHost /> (mounted once, next to the DialogHost) renders them;
 * the windows' code loads on first use.
 */
import { create } from 'zustand';
import type { BackgroundImageMeta, CaptureSource, Palette } from '../../lib/backgroundLibrary';

export type BackgroundPick = { kind: 'image'; image: BackgroundImageMeta } | { kind: 'palette'; palette: Palette };

export interface CaptureRequest {
  kind: 'capture';
  key: number;
  aspect?: number;
  size?: { w: number; h: number };
  /** Start on this graph. */
  from?: Pick<CaptureSource, 'graph' | 'kind'>;
  resolve: (id: string | null) => void;
}
export interface LibraryRequest {
  kind: 'library';
  key: number;
  /** Pick an image, a palette, or either; absent: just manage them. */
  pick?: 'image' | 'palette' | 'any';
  title?: string;
  resolve: (p: BackgroundPick | null) => void;
}
type Request = CaptureRequest | LibraryRequest;

export const useBackgroundsUi = create<{ stack: Request[] }>(() => ({ stack: [] }));

let seq = 0;
const push = (r: Request) => useBackgroundsUi.setState(s => ({ stack: [...s.stack, r] }));
/** Close a window (the host calls it with the window's answer). */
export function closeBackgroundsWindow(key: number): void {
  useBackgroundsUi.setState(s => ({ stack: s.stack.filter(r => r.key !== key) }));
}

export function openCapture(o: { aspect?: number; size?: { w: number; h: number }; from?: CaptureRequest['from'] } = {}): Promise<string | null> {
  return new Promise(resolve => push({ kind: 'capture', key: ++seq, ...o, resolve }));
}

export function openBackgrounds(o: { pick?: LibraryRequest['pick']; title?: string } = {}): Promise<BackgroundPick | null> {
  return new Promise(resolve => push({ kind: 'library', key: ++seq, ...o, resolve }));
}
