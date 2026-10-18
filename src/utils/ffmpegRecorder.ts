/**
 * ffmpegRecorder — offline frame-by-frame encoding via FFmpeg sidecar.
 *
 * Only runs inside Tauri (detects __TAURI_INTERNALS__). Falls back gracefully
 * if Tauri is not present.
 *
 * Render pipeline:
 *   1. Show native save dialog → get output path
 *   2. start_ffmpeg_encode  (Rust spawns FFmpeg with rawvideo stdin input)
 *   3. For each frame:
 *        - Set u_time uniform to deterministic value (frame / fps)
 *        - renderer.render(scene, camera)  [via callback]
 *        - gl.readPixels → RGBA Uint8Array
 *        - send_frame_rgba (IPC — writes raw bytes to FFmpeg stdin)
 *   4. stop_ffmpeg_encode  (closes stdin, waits for FFmpeg to finish)
 */

/**
 * The desktop's codecs (src-tauri/src/export_codecs.rs). The ProRes ones are its profiles (utils/prores.ts):
 * 'prores' is 422 HQ; prores4444 and prores4444xq keep the alpha channel (a transparent background).
 */
export type FfmpegCodec = 'h264' | 'ffv1' | 'prores_proxy' | 'prores_lt' | 'prores_422' | 'prores' | 'prores4444' | 'prores4444xq';

/**
 * The MP4's encoder (the Record dialog's Speed; src-tauri/src/export_codecs.rs mp4_encoder_args): 'hardware' is
 * Apple VideoToolbox H.264 (fast, a bitrate scaled to the size and frame rate), 'hardware_hevc' VideoToolbox HEVC
 * (fast and smaller), 'x264' the best compression (CRF 18, preset medium; the slowest).
 */
export type Mp4Encoder = 'hardware' | 'hardware_hevc' | 'x264';
/** 'auto': hardware H.264 when this FFmpeg can use it, else x264. */
export type Mp4EncoderChoice = Mp4Encoder | 'auto';

/** FFmpeg's name for each hardware encoder (what ffmpeg_hw_encoders lists). */
export const HW_ENCODER_NAMES: Record<Exclude<Mp4Encoder, 'x264'>, string> = { hardware: 'h264_videotoolbox', hardware_hevc: 'hevc_videotoolbox' };

/** The encoder a choice runs with, given the hardware encoders this FFmpeg has (a missing one falls back to x264). */
export function resolveMp4Encoder(choice: Mp4EncoderChoice | undefined, hw: readonly string[]): Mp4Encoder {
  const has = (e: Exclude<Mp4Encoder, 'x264'>) => hw.includes(HW_ENCODER_NAMES[e]);
  if (choice === 'x264') return 'x264';
  if (choice === 'hardware_hevc' && has('hardware_hevc')) return 'hardware_hevc';
  if ((choice === 'hardware' || choice === 'hardware_hevc' || choice === 'auto' || choice === undefined) && has('hardware')) return 'hardware';
  return 'x264';
}

let hwProbe: Promise<string[]> | null = null;
/**
 * The hardware encoders the desktop's FFmpeg can use (asked once; the Rust side keeps its answer too). Empty in the
 * browser, off macOS, or when the probe fails.
 */
export function hardwareEncoders(): Promise<string[]> {
  if (!isTauri()) return Promise.resolve([]);
  hwProbe ??= import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<string[]>('ffmpeg_hw_encoders'))
    .then(list => (Array.isArray(list) ? list : []))
    .catch(() => []);
  return hwProbe;
}

/** For tests: forget the probe. */
export function resetHardwareProbe(): void { hwProbe = null; }

/** The file extension each codec writes. */
export const codecExt = (c: FfmpegCodec): string => (c.startsWith('prores') ? 'mov' : c === 'ffv1' ? 'mkv' : 'mp4');

export interface FfmpegEncodeOptions {
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Frames per second */
  fps: number;
  /** Total duration in seconds */
  duration: number;
  /** Codec to use */
  codec: FfmpegCodec;
  /** Where to write the file; asks with a save dialog when unset. */
  outputPath?: string;
  /** Clock time of the first frame (a take starts where it was recorded). Default 0. */
  startTime?: number;
  /** The recording's sound as WAV bytes (see lib/recordingAudio.ts), muxed in as its audio track. */
  audioWav?: Uint8Array | null;
  /**
   * Called once per frame.
   * Implementation should:
   *   1. Set the shader's u_time uniform to `time`
   *   2. Render the scene
   * Returns void, or a promise when the frame needs to wait (a video seeking).
   */
  renderFrame: (time: number) => void | Promise<void>;
  /**
   * Called to read the current framebuffer pixels into the provided buffer.
   * Implementation should call gl.readPixels into `out`.
   */
  readPixels: (out: Uint8Array, width: number, height: number) => void;
  /** Progress callback — called with fractionComplete (0..1) */
  onProgress?: (fraction: number, frame: number, total: number) => void;
  /** H.264 only: which encoder (Mp4EncoderChoice; default 'auto'). Ignored by the other codecs. */
  encoder?: Mp4EncoderChoice;
  /**
   * The hardware encoder failed part-way (or wouldn't start): the encode starts over with x264, from the first frame.
   * Reset anything the frames carry from one to the next (a first-frame flag) here.
   */
  onRestart?: (why: string) => void;
  /** The encoder each attempt runs with (H.264 only), as it starts. */
  onEncoder?: (encoder: Mp4Encoder) => void;
}

const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Start an FFmpeg offline encode.
 * Returns a promise that resolves to the output file path, or throws on error.
 */
export async function runFfmpegEncode(opts: FfmpegEncodeOptions): Promise<string> {
  if (!isTauri()) {
    throw new Error('FFmpeg encoding is only available in the desktop app.');
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const { save }   = await import('@tauri-apps/plugin-dialog');

  const ext = codecExt(opts.codec);

  const outputPath = opts.outputPath ?? await save({
    defaultPath: `shader-export-${Date.now()}.${ext}`,
    filters: [{ name: 'Video', extensions: [ext] }],
  });

  if (!outputPath) {
    throw new Error('cancelled');
  }

  const encoder = opts.codec === 'h264' ? resolveMp4Encoder(opts.encoder, opts.encoder === 'x264' ? [] : await hardwareEncoders()) : null;
  try {
    return await encodeOnce(invoke, opts, outputPath, encoder);
  } catch (err) {
    // A hardware encoder that fails (VideoToolbox busy, a size it won't take) leaves FFmpeg gone: the frames are
    // deterministic, so start over with x264 once. Cancel is never retried.
    if (!encoder || encoder === 'x264' || String(err) === 'Error: cancelled') throw err;
    opts.onRestart?.(String(err));
    return encodeOnce(invoke, opts, outputPath, 'x264');
  }
}

type Invoke = typeof import('@tauri-apps/api/core').invoke;

async function encodeOnce(invoke: Invoke, opts: FfmpegEncodeOptions, outputPath: string, encoder: Mp4Encoder | null): Promise<string> {
  const totalFrames = Math.ceil(opts.duration * opts.fps);
  if (encoder) opts.onEncoder?.(encoder);

  // Start the Rust/FFmpeg session
  await invoke('start_ffmpeg_encode', {
    outputPath,
    width:  opts.width,
    height: opts.height,
    fps:    opts.fps,
    codec:  opts.codec,
    audioWav: opts.audioWav && opts.audioWav.length ? opts.audioWav : null,
    ...(encoder ? { encoder } : {}),
  });

  // Reusable pixel buffer — allocated once, reused every frame
  const pixelBuf = new Uint8Array(opts.width * opts.height * 4);

  try {
    for (let i = 0; i < totalFrames; i++) {
      const time = (opts.startTime ?? 0) + i / opts.fps;

      // Render deterministic frame
      await opts.renderFrame(time);

      // Read pixels into the reusable buffer
      opts.readPixels(pixelBuf, opts.width, opts.height);

      // Send raw RGBA bytes to Rust → FFmpeg stdin, as the request's body. Only a typed array passed as the whole
      // payload travels as binary: one inside an object ({ data: pixelBuf }) is turned into a JSON array of numbers
      // (Tauri's process-ipc-message-fn: Array.from + JSON.stringify, then serde on the Rust side), about half a
      // second a 1080p frame, which was most of an export's time.
      await invoke('send_frame_rgba', pixelBuf);

      opts.onProgress?.(i / totalFrames, i, totalFrames);

      // Yield to the event loop every 5 frames to update progress UI.
      // More frequent yields than necessary hurt throughput significantly.
      if (i % 5 === 0) {
        await new Promise<void>(r => setTimeout(r, 0));
      }
    }
  } catch (err) {
    // Try to clean up the Rust session before re-throwing
    try { await invoke('stop_ffmpeg_encode'); } catch { /* ignore */ }
    throw err;
  }

  // Finalise — this blocks until FFmpeg has finished writing
  await invoke('stop_ffmpeg_encode');

  opts.onProgress?.(1, totalFrames, totalFrames);
  return outputPath;
}
