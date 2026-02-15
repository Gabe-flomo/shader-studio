/**
 * useFFmpeg — lazy-loads ffmpeg.wasm and provides a helper to encode
 * an array of PNG data-URLs into an MP4 or GIF blob.
 *
 * Uses the single-threaded @ffmpeg/core (no SharedArrayBuffer required),
 * loaded from jsDelivr CDN so the WASM binary isn't bundled.
 *
 * The FFmpeg instance is a module-level singleton — loaded once, shared forever.
 */

import { useState, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

export type EncodeFormat = 'mp4' | 'gif';

export interface EncodeOptions {
  fps: number;
  format: EncodeFormat;
  onProgress?: (ratio: number) => void;
  onLog?: (msg: string) => void;
}

// unpkg has permissive CORS and works without Cross-Origin-Isolation headers
const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';

/** Fetch a remote file and return a local blob: URL so FFmpeg can import it */
async function fetchAsBlob(url: string, mimeType: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  const buf = await res.arrayBuffer();
  return URL.createObjectURL(new Blob([buf], { type: mimeType }));
}

// ── Module-level singleton so ffmpeg is never reloaded between renders ─────────
let _ffmpeg: FFmpeg | null = null;
let _loadPromise: Promise<void> | null = null;

async function loadFFmpeg(): Promise<void> {
  if (_ffmpeg) return; // already loaded
  if (_loadPromise) return _loadPromise; // loading in progress — wait for it

  _loadPromise = (async () => {
    const [coreURL, wasmURL] = await Promise.all([
      fetchAsBlob(`${CORE_BASE}/ffmpeg-core.js`,   'text/javascript'),
      fetchAsBlob(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    ]);
    const ff = new FFmpeg();
    await ff.load({ coreURL, wasmURL });
    _ffmpeg = ff;
  })();

  return _loadPromise;
}

// ── React hook ─────────────────────────────────────────────────────────────────

export function useFFmpeg() {
  const [loading, setLoading] = useState(false);
  const [ready, setReady]     = useState(_ffmpeg !== null); // sync with singleton
  const [loadError, setLoadError] = useState('');

  /** Trigger ffmpeg load (no-op if already loaded/loading) */
  const load = useCallback(async () => {
    if (_ffmpeg) { setReady(true); return; }
    setLoading(true);
    setLoadError('');
    try {
      await loadFFmpeg();
      setReady(true);
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, []); // stable — no deps

  /**
   * Encode an array of PNG data-URLs into an MP4 or GIF blob.
   * Automatically loads ffmpeg if not yet ready.
   */
  const encode = useCallback(async (
    frames: string[],
    { fps, format, onProgress, onLog }: EncodeOptions,
  ): Promise<Blob> => {
    if (!_ffmpeg) await loadFFmpeg();
    const ff = _ffmpeg!;

    // Progress during frame upload phase (0–40%)
    const uploadProgress = (i: number) => onProgress?.(i / frames.length * 0.4);

    // Wire encode-phase progress (40–100%)
    ff.on('progress', ({ progress }) => {
      onProgress?.(0.4 + Math.min(progress, 1) * 0.6);
    });
    ff.on('log', ({ message }) => {
      if (message) onLog?.(message);
    });

    // Write frames into virtual FS
    for (let i = 0; i < frames.length; i++) {
      const fname = `frame_${String(i).padStart(5, '0')}.png`;
      await ff.writeFile(fname, await fetchFile(frames[i]));
      uploadProgress(i + 1);
    }

    const outFile = format === 'gif' ? 'output.gif' : 'output.mp4';

    if (format === 'gif') {
      // Two-pass GIF: palette generation then encode
      await ff.exec([
        '-framerate', String(fps),
        '-i', 'frame_%05d.png',
        '-vf', `fps=${fps},scale=trunc(iw/2)*2:-1:flags=lanczos,palettegen`,
        'palette.png',
      ]);
      await ff.exec([
        '-framerate', String(fps),
        '-i', 'frame_%05d.png',
        '-i', 'palette.png',
        '-lavfi', `fps=${fps},scale=trunc(iw/2)*2:-1:flags=lanczos[x];[x][1:v]paletteuse`,
        outFile,
      ]);
    } else {
      // MP4 — libx264, web-compatible
      await ff.exec([
        '-framerate', String(fps),
        '-i', 'frame_%05d.png',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outFile,
      ]);
    }

    // Read result
    const data = await ff.readFile(outFile);
    const mimeType = format === 'gif' ? 'image/gif' : 'video/mp4';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blob = new Blob([data as any], { type: mimeType });

    // Clean up virtual FS
    for (let i = 0; i < frames.length; i++) {
      await ff.deleteFile(`frame_${String(i).padStart(5, '0')}.png`).catch(() => {});
    }
    await ff.deleteFile(outFile).catch(() => {});
    if (format === 'gif') await ff.deleteFile('palette.png').catch(() => {});

    return blob;
  }, []); // stable

  return { load, encode, loading, ready, error: loadError };
}
