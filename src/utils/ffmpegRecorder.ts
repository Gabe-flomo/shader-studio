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

export type FfmpegCodec = 'h264' | 'prores' | 'ffv1';

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
  /**
   * Called once per frame.
   * Implementation should:
   *   1. Set the shader's u_time uniform to `time`
   *   2. Render the scene
   * Returns void.
   */
  renderFrame: (time: number) => void;
  /**
   * Called to read the current framebuffer pixels into the provided buffer.
   * Implementation should call gl.readPixels into `out`.
   */
  readPixels: (out: Uint8Array, width: number, height: number) => void;
  /** Progress callback — called with fractionComplete (0..1) */
  onProgress?: (fraction: number, frame: number, total: number) => void;
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

  const ext = opts.codec === 'prores' ? 'mov'
            : opts.codec === 'ffv1'   ? 'mkv'
            : 'mp4';

  const outputPath = await save({
    defaultPath: `shader-export-${Date.now()}.${ext}`,
    filters: [{ name: 'Video', extensions: [ext] }],
  });

  if (!outputPath) {
    throw new Error('cancelled');
  }

  const totalFrames = Math.ceil(opts.duration * opts.fps);

  // Start the Rust/FFmpeg session
  await invoke('start_ffmpeg_encode', {
    outputPath,
    width:  opts.width,
    height: opts.height,
    fps:    opts.fps,
    codec:  opts.codec,
  });

  // Reusable pixel buffer — allocated once, reused every frame
  const pixelBuf = new Uint8Array(opts.width * opts.height * 4);

  try {
    for (let i = 0; i < totalFrames; i++) {
      const time = i / opts.fps;

      // Render deterministic frame
      opts.renderFrame(time);

      // Read pixels into the reusable buffer
      opts.readPixels(pixelBuf, opts.width, opts.height);

      // Send raw RGBA bytes to Rust → FFmpeg stdin.
      // Pass the Uint8Array directly — Tauri v2 transfers typed arrays as binary
      // (no Array.from conversion needed, which was an O(n) copy per frame).
      await invoke('send_frame_rgba', { data: pixelBuf });

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
