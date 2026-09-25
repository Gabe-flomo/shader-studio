import { renderKeepAlive } from '../lib/renderKeepAlive';
import { saveRecording } from './recordingsFolder';
/**
 * CanvasRecorder — adapted from the provided CanvasRecorder.js
 * Supports two browser-native formats:
 *   - 'mediarecorder' : real-time WebM/MP4 via MediaRecorder API (fast, no deps)
 *   - 'png'           : lossless PNG frame sequence packed into a .zip via JSZip
 *
 * CCapture/WebM offline mode is intentionally omitted (requires external workers).
 */

export type RecordFormat = 'mediarecorder' | 'png';

export interface CanvasRecorderOptions {
  fps?: number;
  duration?: number | null;   // seconds; null = manual stop
  format?: RecordFormat;
  quality?: number;            // 0-1
  name?: string;
  videoBitsPerSecond?: number;
  /** MediaRecorder mime type; defaults to the first one the platform supports */
  mimeType?: string;
  autoDownload?: boolean;
  verbose?: boolean;
  /** Called if the encoder fails (e.g. frame size beyond its limits). Nothing is downloaded. */
  onError?: (message: string) => void;
  /** Called with where the file went (a path, or a folder/file name), after it's saved. */
  onSaved?: (where: string) => void;
}

export interface RecordStats {
  isRecording: boolean;
  isPaused: boolean;
  frameCount: number;
  elapsedTime: number;
  actualFPS: number;
  targetFPS: number;
  format: RecordFormat;
  progress: number; // 0-1; 1 when duration reached or stopped
}

export class CanvasRecorder {
  private canvas: HTMLCanvasElement;
  private config: Required<Omit<CanvasRecorderOptions, 'mimeType' | 'onError' | 'onSaved'>> & Pick<CanvasRecorderOptions, 'mimeType' | 'onError' | 'onSaved'>;
  /** Set when MediaRecorder reported an error or produced no data */
  error: string | null = null;

  isRecording = false;
  isPaused    = false;

  private frameCount   = 0;
  private startTime    = 0;
  frames: { index: number; data: string; timestamp: number }[] = [];
  private recordedChunks: Blob[] = [];
  private mediaRecorder: MediaRecorder | null = null;
  private releaseRenderLease: (() => void) | null = null;
  private mediaStopResolve: (() => void) | null = null;
  private stopPromise: Promise<void> | null = null;

  /** Fixed delta time in seconds — use in your animation loop while recording */
  get fakeDeltaTime() { return 1 / this.config.fps; }

  constructor(canvas: HTMLCanvasElement, options: CanvasRecorderOptions = {}) {
    this.canvas = canvas;
    this.config = {
      fps:                options.fps                ?? 60,
      duration:           options.duration           ?? null,
      format:             options.format             ?? 'mediarecorder',
      quality:            options.quality            ?? 0.95,
      name:               options.name               ?? `shader-${Date.now()}`,
      videoBitsPerSecond: options.videoBitsPerSecond ?? 25_000_000,
      autoDownload:       options.autoDownload       !== false,
      verbose:            options.verbose            !== false,
      mimeType:           options.mimeType,
      onError:            options.onError,
      onSaved:            options.onSaved,
    };
  }

  async start(): Promise<void> {
    if (this.isRecording) { console.warn('[CanvasRecorder] already recording'); return; }
    this.isRecording  = true;
    this.isPaused     = false;
    this.frameCount   = 0;
    this.frames       = [];
    this.recordedChunks = [];
    this.startTime    = performance.now();
    this.error        = null;

    if (this.config.format === 'mediarecorder') {
      await this._initMediaRecorder();
    }
    // captureStream() only emits a video frame when the canvas repaints, and
    // ShaderCanvas skips repaints while the picture is static — so hold a
    // lease that keeps it drawing every frame for the whole recording.
    this.releaseRenderLease = renderKeepAlive.acquire();
    this._log(`started ${this.config.format} @ ${this.config.fps}fps`);
  }

  /** Call once per rendered frame inside your animation loop */
  capture(): void {
    if (!this.isRecording || this.isPaused) return;
    this.frameCount++;

    if (this.config.format === 'png') {
      this._capturePngFrame();
    }
    // mediarecorder captures from the stream automatically

    // Auto-stop when duration reached. MediaRecorder timestamps frames in
    // real time, so stop on wall-clock time — counting rAF frames made
    // videos run long whenever rendering fell below the target fps (e.g. at
    // 4× resolution) and short on 120 Hz displays. PNG frames are discrete,
    // so that mode still counts frames.
    if (this.config.duration !== null) {
      const done = this.config.format === 'mediarecorder'
        ? performance.now() - this.startTime >= this.config.duration * 1000
        : this.frameCount >= this.config.duration * this.config.fps;
      if (done) this.stop();
    }
  }

  stop(): Promise<void> {
    if (!this.isRecording) { console.warn('[CanvasRecorder] not recording'); return this.whenStopped(); }
    this.isRecording = false;
    this._log(`stopping — ${this.frameCount} frames captured`);
    this.releaseRenderLease?.();
    this.releaseRenderLease = null;
    this.stopPromise = (async () => {
      if (this.config.format === 'png') {
        await this._finishPng();
      } else {
        await this._finishMediaRecorder();
      }
      this._log('done');
    })();
    return this.stopPromise;
  }

  /**
   * Resolves once the file has been finalised and saved (or saving failed —
   * check `error`). isRecording flips false as soon as stopping begins, which
   * can be well before this: the Tauri save dialog waits on the user.
   */
  whenStopped(): Promise<void> {
    return this.stopPromise ?? Promise.resolve();
  }

  pause()  { this.isPaused = true;  this._log('paused');  }
  resume() { this.isPaused = false; this._log('resumed'); }

  getStats(): RecordStats {
    const elapsed = this.isRecording ? (performance.now() - this.startTime) / 1000 : 0;
    const target  = this.config.duration ?? 0;
    return {
      isRecording: this.isRecording,
      isPaused:    this.isPaused,
      frameCount:  this.frameCount,
      elapsedTime: elapsed,
      actualFPS:   elapsed > 0 ? this.frameCount / elapsed : 0,
      targetFPS:   this.config.fps,
      format:      this.config.format,
      progress:    target > 0 ? Math.min(this.frameCount / (target * this.config.fps), 1) : 0,
    };
  }

  // ── PNG sequence ─────────────────────────────────────────────────────────

  private _capturePngFrame() {
    const data = this.canvas.toDataURL('image/png');
    this.frames.push({ index: this.frameCount, data, timestamp: performance.now() - this.startTime });
  }

  private async _finishPng() {
    this._log(`packing ${this.frames.length} PNG frames…`);

    // Try to use JSZip if available globally, otherwise fall back to individual download
    // @ts-expect-error — optional global
    if (typeof window.JSZip !== 'undefined') {
      // @ts-expect-error — optional global
      const zip = new window.JSZip() as {
        folder: (name: string) => { file: (name: string, data: Uint8Array) => void };
        generateAsync: (opts: object) => Promise<Blob>;
      };
      const folder = zip.folder(this.config.name);
      for (let i = 0; i < this.frames.length; i++) {
        const base64 = this.frames[i].data.split(',')[1];
        const bin    = atob(base64);
        const arr    = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
        folder.file(`frame_${String(i).padStart(5, '0')}.png`, arr);
        if (i % 50 === 0) this._log(`zipping ${i}/${this.frames.length}…`);
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      if (this.config.autoDownload) this._downloadBlob(blob, `${this.config.name}.zip`);
    } else {
      console.warn('[CanvasRecorder] JSZip not found — downloading first frame as sample');
      if (this.frames.length > 0) {
        const link = document.createElement('a');
        link.download = `${this.config.name}_frame_00000.png`;
        link.href = this.frames[0].data;
        link.click();
      }
    }
  }

  // ── MediaRecorder ────────────────────────────────────────────────────────

  private async _initMediaRecorder() {
    const stream   = this.canvas.captureStream(this.config.fps);
    const mimeType = this.config.mimeType ?? this._bestMimeType();

    if (!mimeType) {
      throw new Error(
        'This browser can\u2019t record video: MediaRecorder supports none of ' +
        'MP4 (H.264), WebM (VP9) or WebM (VP8) here.'
      );
    }

    this._log(`MediaRecorder mimeType: ${mimeType}`);

    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: this.config.videoBitsPerSecond,
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data?.size > 0) this.recordedChunks.push(e.data);
    };

    // Without this, an encoder rejection (e.g. H.264 at a frame size above its
    // level limit) stops the recorder and we'd "download" a 0-byte file.
    this.mediaRecorder.onerror = (e) => {
      const err = (e as Event & { error?: DOMException }).error;
      this._fail(`Video encoder failed at ${this.canvas.width}×${this.canvas.height}: ${err?.message ?? 'unknown error'}`);
    };

    this.mediaRecorder.onstop = async () => {
      const blob = new Blob(this.recordedChunks, { type: mimeType });
      const ext  = mimeType.includes('mp4') ? 'mp4' : 'webm';
      if (!this.error && blob.size === 0) {
        this._fail(`The video encoder produced no data at ${this.canvas.width}×${this.canvas.height}.`);
      }
      if (!this.error && this.config.autoDownload) await this._downloadBlob(blob, `${this.config.name}.${ext}`);
      stream.getTracks().forEach(t => t.stop());
      this.mediaStopResolve?.();
    };

    this.mediaRecorder.start(100); // collect data every 100 ms
  }

  private _finishMediaRecorder(): Promise<void> {
    return new Promise(resolve => {
      this.mediaStopResolve = resolve;
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      } else {
        resolve();
      }
    });
  }

  private _bestMimeType(): string | null {
    const types = [
      'video/mp4;codecs=h264',   // WebKit (Tauri / Safari) — try first so macOS gets .mp4
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return null; // nothing supported — caller must handle
  }

  // ── Utilities ────────────────────────────────────────────────────────────

  private async _downloadBlob(blob: Blob, filename: string) {
    this._log(`saving ${filename} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
    // Where it goes (a folder, a save dialog or Downloads) is the Recordings setting.
    try {
      const where = await saveRecording(blob, filename);
      if (where) { this._log(`saved to ${where}`); this.config.onSaved?.(where); }
    } catch (err) {
      this._fail(`Couldn\u2019t save the recording: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private _fail(message: string) {
    if (this.error) return;
    this.error = message;
    this.isRecording = false;
    console.error('[CanvasRecorder]', message);
    this.config.onError?.(message);
  }

  private _log(...args: unknown[]) {
    if (this.config.verbose) console.log('[CanvasRecorder]', ...args);
  }
}
