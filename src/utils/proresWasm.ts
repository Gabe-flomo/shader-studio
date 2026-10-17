/**
 * ProRes in the browser: prores-wasm-encoder (Olivier Estevez, LGPL-2.1-or-later,
 * https://github.com/OlivierEstevez/ProRes-WASM-encoder). Only ever loaded with import(),
 * so it is a chunk of its own (vite.config.ts names it `prores-wasm`), never in the app's
 * main script, and replaceable on its own as the LGPL asks. Its licence ships beside the app
 * at licenses/prores-wasm-encoder.txt (public/licenses/) and is listed in lib/thirdParty.ts.
 *
 * Frames go in as straight (not premultiplied) RGBA, top row first, which is what the offline
 * render's read-back and the Play layers' composite give (docs/prores-export.md). Video only:
 * the encoder writes no audio track.
 */
import type { ProResProfileInfo } from './prores';

export interface ProResWasmOptions {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  profile: ProResProfileInfo;
  /** Fill `out` with frame `index`'s RGBA (straight alpha, top row first). Throw to cancel. */
  frame: (index: number, out: Uint8Array) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

/** The encoder's module, loaded on first use (its own chunk). */
export const loadProResWasm = () => import('prores-wasm-encoder/parallel');
const loadSingle = () => import('prores-wasm-encoder');

interface FrameSink {
  addFrameRgba(rgba: Uint8Array): Promise<void> | void;
  finalizeToBlob(): Promise<Blob> | Blob;
  destroy(): Promise<void> | void;
}

/** A worker pool where workers run; the single-thread encoder where they can't (a CSP without blob: workers). */
async function openEncoder(o: ProResWasmOptions): Promise<FrameSink> {
  const settings = { width: o.width, height: o.height, frameRate: o.fps, profile: o.profile.profileNumber };
  try {
    const { createProResEncoderPool } = await loadProResWasm();
    return await createProResEncoderPool(settings);
  } catch (poolError) {
    const { createProResEncoder } = await loadSingle();
    const enc = await createProResEncoder().catch(() => { throw poolError; });
    enc.initialize(settings);
    return enc;
  }
}

/** Render and encode every frame; resolves with the .mov. */
export async function encodeProResWasm(o: ProResWasmOptions): Promise<Blob> {
  const enc = await openEncoder(o);
  const pixels = new Uint8Array(o.width * o.height * 4);
  try {
    for (let i = 0; i < o.totalFrames; i++) {
      await o.frame(i, pixels);
      // The pool copies the frame before it returns, so `pixels` is free again at once.
      await enc.addFrameRgba(pixels);
      o.onProgress?.(i + 1, o.totalFrames);
      // The single-thread encoder is synchronous: let the progress bar draw now and then.
      if (i % 4 === 3) await new Promise<void>(r => setTimeout(r, 0));
    }
    return await enc.finalizeToBlob();
  } finally {
    await enc.destroy();
  }
}
