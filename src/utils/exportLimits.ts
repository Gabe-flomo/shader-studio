/**
 * exportLimits — works out which export resolutions this device can actually
 * produce, so the export modal can disable the ones that would fail instead
 * of silently writing an empty file.
 *
 * Three independent ceilings apply to a W×H export:
 *   1. GPU: the drawing buffer and render targets must fit inside
 *      MAX_TEXTURE_SIZE / MAX_RENDERBUFFER_SIZE / MAX_VIEWPORT_DIMS.
 *   2. Memory: the live pipeline keeps several full-size buffers (half-float
 *      RT, ping-pong pair, export RTs, drawing buffer), so a mobile GPU gets
 *      its context lost long before hitting the texture-size limit. There is
 *      no API for GPU memory, so this is a conservative pixel budget.
 *   3. Encoder (browser MediaRecorder only): H.264 encoders top out around
 *      level 5.1/5.2 (~9.4 MP, e.g. 4096×2304); beyond that Chrome fires
 *      "EncodingError: The given encoder configuration is not supported" and
 *      records 0 bytes. WebCodecs' VideoEncoder.isConfigSupported() reports
 *      the same limits MediaRecorder hits, so we ask it up front.
 */

export interface GpuLimits {
  /** Largest width or height the GPU can render to */
  maxDim: number;
  /** Pixel budget (w×h) we allow for export on this device */
  maxPixels: number;
  isMobile: boolean;
}

export interface RecorderFormat {
  mimeType: string;
  /** Human label, e.g. "H.264 (.mp4)" */
  label: string;
  ext: 'mp4' | 'webm';
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS reports a desktop Mac UA — detect it by touch support.
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOS;
}

export function getGpuLimits(canvas: HTMLCanvasElement | null): GpuLimits {
  const isMobile = isMobileDevice();
  let maxDim = 4096; // WebGL-guaranteed floor on every device we care about
  const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl') ?? null;
  if (gl) {
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    maxDim = Math.min(
      gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      vp[0], vp[1],
    );
  }
  // ~40 bytes/px across the live + export buffers: 8K is ~1.3 GB, 4K ~330 MB.
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  let maxPixels = 7680 * 4320;                                // desktop: 8K
  if (isMobile) maxPixels = 3840 * 2160;                      // phone/tablet: 4K UHD
  if (deviceMemory !== undefined && deviceMemory <= 2) maxPixels = 1920 * 1080;
  return { maxDim, maxPixels, isMobile };
}

// MediaRecorder containers in preference order. H.264 first for
// compatibility (and .mp4 in Tauri/WebKit); VP9/VP8 as fallbacks because
// their encoders accept far larger frames than H.264's level limits.
const CANDIDATES: (RecorderFormat & { codecs: string[] })[] = [
  { mimeType: 'video/mp4;codecs=h264', label: 'H.264', ext: 'mp4', codecs: ['avc1.640034', 'avc1.4D0034', 'avc1.42E034'] },
  { mimeType: 'video/mp4',             label: 'H.264', ext: 'mp4', codecs: ['avc1.640034', 'avc1.4D0034', 'avc1.42E034'] },
  { mimeType: 'video/webm;codecs=vp9', label: 'VP9',   ext: 'webm', codecs: ['vp09.00.51.08', 'vp09.00.61.08'] },
  { mimeType: 'video/webm;codecs=vp8', label: 'VP8',   ext: 'webm', codecs: ['vp8'] },
];

async function encoderSupports(codecs: string[], width: number, height: number, isMobile: boolean, isH264: boolean): Promise<boolean> {
  // 4:2:0 encoders need even dimensions; MediaRecorder pads odd sizes itself,
  // but isConfigSupported rejects them, so check the padded size.
  const w = width + (width % 2);
  const h = height + (height % 2);
  if (typeof VideoEncoder === 'undefined') {
    // No WebCodecs (older Safari): fall back to typical hardware limits.
    if (isH264) return w * h <= (isMobile ? 1920 * 1088 : 4096 * 2304) && Math.max(w, h) <= 4096;
    return !isMobile && Math.max(w, h) <= 16384;
  }
  for (const codec of codecs) {
    try {
      const res = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, framerate: 60 });
      if (res.supported) return true;
    } catch { /* malformed config on this platform — try next */ }
  }
  return false;
}

/**
 * Pick the best MediaRecorder format able to encode a W×H stream on this
 * device, or null if none can.
 */
export async function pickRecorderFormat(width: number, height: number): Promise<RecorderFormat | null> {
  if (typeof MediaRecorder === 'undefined') return null;
  const isMobile = isMobileDevice();
  const seen = new Set<string>();
  for (const c of CANDIDATES) {
    if (!MediaRecorder.isTypeSupported(c.mimeType)) continue;
    // 'video/mp4' and 'video/mp4;codecs=h264' are the same encoder — test once.
    const key = c.codecs.join();
    if (seen.has(key)) continue;
    seen.add(key);
    if (await encoderSupports(c.codecs, width, height, isMobile, c.ext === 'mp4')) {
      return { mimeType: c.mimeType, label: c.label, ext: c.ext };
    }
  }
  return null;
}

/** The format MediaRecorder would use for a small (1×) recording — i.e. the preferred one. */
export function preferredRecorderFormat(): RecorderFormat | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const c = CANDIDATES.find(c => MediaRecorder.isTypeSupported(c.mimeType));
  return c ? { mimeType: c.mimeType, label: c.label, ext: c.ext } : null;
}
