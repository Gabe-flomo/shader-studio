/**
 * Bake encoders (docs/bake.md): exact frames in, one video file out.
 *
 * - Desktop: FFmpeg (the export's sidecar), H.264 with a keyframe every half
 *   second and no B-frames ("bake" in src-tauri/src/bake.rs), written to a
 *   temporary file the app then reads into its video library.
 * - Browser: WebCodecs VP8 (VP9 where VP8 isn't offered) into a WebM the app
 *   writes itself (utils/webmMuxer.ts), stamped frame by frame, so a render
 *   slower than real time still plays at exactly its frame rate.
 */
import { muxWebm, type WebmFrame } from '../../utils/webmMuxer';
import type { BakePlan } from './plan';

export interface BakeEncoder {
  /** 'h264' (.mp4) or 'vp9' / 'vp8' (.webm). */
  codec: string;
  ext: string;
  mime: string;
  /** One frame, RGBA top-down, frameWidth × frameHeight. Resolves when the encoder can take the next. */
  addFrame(rgba: Uint8Array, index: number): Promise<void>;
  /** All frames in: the finished file. */
  finish(): Promise<Blob>;
  /** Stop and throw away whatever was written. */
  cancel(): Promise<void>;
}

export const inDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** The desktop encoder: FFmpeg reading raw frames, into a temporary file the app takes afterwards. */
export async function desktopEncoder(plan: BakePlan, invoke?: Invoke): Promise<BakeEncoder> {
  const call: Invoke = invoke ?? (await import('@tauri-apps/api/core')).invoke;
  const path = await call<string>('bake_temp_path', { ext: 'mp4' });
  await call('start_ffmpeg_encode', { outputPath: path, width: plan.frameWidth, height: plan.frameHeight, fps: plan.fps, codec: 'bake', audioWav: null });
  let open = true;
  return {
    codec: 'h264', ext: 'mp4', mime: 'video/mp4',
    addFrame: async (rgba) => { await call('send_frame_rgba', { data: rgba }); },
    finish: async () => {
      open = false;
      await call('stop_ffmpeg_encode');
      const bytes = await call<ArrayBuffer | Uint8Array | number[]>('bake_take_file', { path });
      const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
      return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
    },
    cancel: async () => {
      if (open) { open = false; try { await call('stop_ffmpeg_encode'); } catch { /* already stopped */ } }
      try { await call('bake_discard_file', { path }); } catch { /* nothing to remove */ }
    },
  };
}

/**
 * WebCodecs codecs to try, best first. VP8 first: Chrome's player seeks
 * VP8 WebM reliably, where a VP9 WebM with delta frames failed to decode
 * after a few seeks in testing (2026-10, Chrome 154 on macOS), and a Baked
 * node seeks on every loop and every offline frame. VP9 is the fallback.
 */
const WEB_CODECS: { codec: string; name: 'vp9' | 'vp8' }[] = [
  { codec: 'vp8', name: 'vp8' },
  { codec: 'vp09.00.41.08', name: 'vp9' },
  { codec: 'vp09.00.51.08', name: 'vp9' },
];

/** About a quarter of a bit per pixel per frame: high quality for generative pictures, within 2–80 Mbit/s. */
export const webBitrate = (w: number, h: number, fps: number) => Math.round(Math.min(80e6, Math.max(2e6, w * h * fps * 0.25)));

/** Can this browser bake (WebCodecs with VP9 or VP8 at this size)? Resolves to the codec, or null. */
export async function webCodecFor(width: number, height: number, fps: number): Promise<{ codec: string; name: 'vp9' | 'vp8' } | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const c of WEB_CODECS) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: c.codec, width, height, bitrate: webBitrate(width, height, fps), framerate: fps });
      if (r.supported) return c;
    } catch { /* try the next */ }
  }
  return null;
}

/** How a browser bake's frames are coded: BT.601 matrix, limited range, sRGB primaries and transfer (no conversion on playback). */
export const BAKE_COLOR_SPACE: VideoColorSpaceInit = { matrix: 'smpte170m', primaries: 'bt709', transfer: 'iec61966-2-1', fullRange: false };

/**
 * RGBA (top-down) to I420 with BT.601 limited-range coefficients: Y from each
 * pixel, Cb and Cr from each 2×2 block's average. Width and height are even.
 */
export function rgbaToI420(rgba: Uint8Array, w: number, h: number, out: Uint8Array): void {
  const ySize = w * h, cw = w >> 1;
  const uOff = ySize, vOff = ySize + (ySize >> 2);
  for (let y = 0; y < h; y++) {
    let i = y * w * 4, o = y * w;
    for (let x = 0; x < w; x++, i += 4, o++) out[o] = (16.5 + 0.256788 * rgba[i] + 0.504129 * rgba[i + 1] + 0.097906 * rgba[i + 2]) | 0;
  }
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const a = (y * w + x) * 4, b = a + w * 4;
      const r = (rgba[a] + rgba[a + 4] + rgba[b] + rgba[b + 4]) * 0.25;
      const g = (rgba[a + 1] + rgba[a + 5] + rgba[b + 1] + rgba[b + 5]) * 0.25;
      const bl = (rgba[a + 2] + rgba[a + 6] + rgba[b + 2] + rgba[b + 6]) * 0.25;
      const c = (y >> 1) * cw + (x >> 1);
      out[uOff + c] = (128.5 - 0.148223 * r - 0.290993 * g + 0.439216 * bl) | 0;
      out[vOff + c] = (128.5 + 0.439216 * r - 0.367788 * g - 0.071427 * bl) | 0;
    }
  }
}

/** The browser encoder: WebCodecs into a WebM, keyframes every half second. */
export async function webEncoder(plan: BakePlan): Promise<BakeEncoder> {
  const w = plan.frameWidth, h = plan.frameHeight, fps = plan.fps;
  const pick = await webCodecFor(w, h, fps);
  if (!pick) throw new Error('This browser can’t encode video frame by frame (it needs WebCodecs with VP8 or VP9: Chrome, Edge, Firefox 130+ or Safari 17+). The desktop app bakes with FFmpeg.');
  const frames: WebmFrame[] = [];
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      frames.push({ data, timestampUs: chunk.timestamp, key: chunk.type === 'key' });
    },
    error: (e) => { failure = e instanceof Error ? e : new Error(String(e)); },
  });
  encoder.configure({ codec: pick.codec, width: w, height: h, bitrate: webBitrate(w, h, fps), framerate: fps, latencyMode: 'quality' });
  const gop = Math.max(1, Math.round(fps / 2));
  const frameUs = 1e6 / fps;
  // The frames go in as I420 we convert ourselves (BT.601, limited range: what every VP8 decoder assumes),
  // tagged the same in the file, so the browser's own RGB → YUV choice can't stretch or shift the colours.
  const yuv = new Uint8Array(w * h * 3 / 2);
  return {
    codec: pick.name, ext: 'webm', mime: 'video/webm',
    addFrame: async (rgba, index) => {
      if (failure) throw failure;
      rgbaToI420(rgba, w, h, yuv);
      const frame = new VideoFrame(yuv, { format: 'I420', codedWidth: w, codedHeight: h, timestamp: Math.round(index * frameUs), duration: Math.round(frameUs), colorSpace: BAKE_COLOR_SPACE });
      try { encoder.encode(frame, { keyFrame: index % gop === 0 }); } finally { frame.close(); }
      // Keep a few frames in flight at most: the encoder works while the next frame renders, and memory stays flat.
      while (encoder.encodeQueueSize > 3 && !failure) await new Promise(r => setTimeout(r, 2));
    },
    finish: async () => {
      await encoder.flush();
      encoder.close();
      if (failure) throw failure;
      frames.sort((a, b) => a.timestampUs - b.timestampUs);
      const bytes = muxWebm(frames, { codec: pick.name, width: w, height: h, fps, duration: plan.frames / fps, colour: { matrix: 6, range: 1, transfer: 13, primaries: 1 } });
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'video/webm' });
    },
    cancel: async () => { try { encoder.close(); } catch { /* closed */ } },
  };
}

/** The encoder for where the app runs: FFmpeg on the desktop, WebCodecs in a browser. */
export function bakeEncoder(plan: BakePlan): Promise<BakeEncoder> {
  return inDesktopApp() ? desktopEncoder(plan) : webEncoder(plan);
}
