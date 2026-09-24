import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CanvasRecorder } from '../utils/CanvasRecorder';
import { runFfmpegEncode, type FfmpegCodec } from '../utils/ffmpegRecorder';
import type { OfflineRenderHandle } from './ShaderCanvas';
import { getGpuLimits, pickRecorderFormat, preferredRecorderFormat, type RecorderFormat } from '../utils/exportLimits';
import { ctp } from '../theme/palette';

// ── Styles ────────────────────────────────────────────────────────────────────

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2000,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const PANEL: React.CSSProperties = {
  background: ctp.base,
  border: `1px solid ${ctp.surface1}`,
  borderRadius: '12px',
  width: '420px',
  maxWidth: '95vw',
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
  color: ctp.text,
  fontSize: '12px',
};

const BTN_BASE: React.CSSProperties = {
  border: `1px solid ${ctp.surface1}`,
  borderRadius: '6px',
  fontSize: '12px',
  fontFamily: 'system-ui, sans-serif',
  cursor: 'pointer',
  padding: '7px 16px',
  transition: 'all 0.15s',
};

const LABEL: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: ctp.surface2,
  marginBottom: '4px',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
};

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value }: { value: number }) {
  return (
    <div style={{ background: ctp.surface0, borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        width: `${Math.min(Math.round(value * 100), 100)}%`,
        background: `linear-gradient(90deg, ${ctp.blue}, ${ctp.mauve})`,
        borderRadius: '4px',
        transition: 'width 0.15s linear',
      }} />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const CODEC_LABELS: Record<FfmpegCodec, string> = {
  h264:   'H.264',
  prores: 'ProRes 422 HQ',
  ffv1:   'FFV1 (lossless)',
};

const CODEC_DESCRIPTIONS: Record<FfmpegCodec, string> = {
  h264:   'CRF 18 · .mp4 · best compatibility',
  prores: 'Apple ProRes · .mov · editing master',
  ffv1:   'Lossless · .mkv · largest file',
};

// Resolution multipliers relative to the canvas's natural size
const RESOLUTIONS = [
  { label: '1×  (native)', scale: 1 },
  { label: '2×  (2K/4K)',  scale: 2 },
  { label: '4×  (ultra)', scale: 4 },
];

/** What this device can do at a given scale — computed when the modal opens. */
interface ScaleSupport {
  width: number;
  height: number;
  /** Why this scale can't be exported here; null if it can */
  blocked: string | null;
  /** MediaRecorder format that can encode this size (browser mode only) */
  format: RecorderFormat | null;
}

const fmtPx = (w: number, h: number) => `${w}×${h}`;

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  canvas: HTMLCanvasElement | null;
  /**
   * Handle registered by ShaderCanvas — renders to a dedicated RT and reads pixels.
   * Required for FFmpeg offline encoding.
   */
  offlineRender?: OfflineRenderHandle | null;
  onClose: () => void;
}

type RecordMode  = 'mediarecorder' | 'ffmpeg';
type RecordState = 'idle' | 'recording' | 'encoding' | 'done' | 'error';

export function ExportModal({ canvas, offlineRender, onClose }: Props) {
  const [fps, setFps]               = useState(60);
  const [duration, setDuration]     = useState(5);
  const [manualStop, setManualStop] = useState(false);
  const [bitrate, setBitrate]       = useState(50); // Mbps
  const [resScale, setResScale]     = useState(1);
  const [codec, setCodec]           = useState<FfmpegCodec>('h264');
  const [mode, setMode]             = useState<RecordMode>(inTauri ? 'ffmpeg' : 'mediarecorder');
  const [filename, setFilename]     = useState('shader-export');

  const [state, setState]                       = useState<RecordState>('idle');
  const [captureProgress, setCaptureProgress]   = useState(0);
  const [elapsed, setElapsed]                   = useState(0);
  const [frameCount, setFrameCount]             = useState(0);
  const [errorMsg, setErrorMsg]                 = useState('');
  const [outputPath, setOutputPath]             = useState('');

  const recorderRef  = useRef<CanvasRecorder | null>(null);
  const rafRef       = useRef<number>(0);
  const tickRef      = useRef<number>(0);
  const abortRef     = useRef(false);
  // The in-flight FFmpeg encode, if any. Cancel returns the UI to idle at
  // once, but the loop only exits at its next frame — a new encode must wait
  // for that, or the old loop's cleanup would stop the new FFmpeg session.
  const ffmpegRunRef = useRef<Promise<unknown> | null>(null);
  // Handle whose render scale we raised, so every exit path (done, error,
  // cancel, unmount) can put the preview back to 1×.
  const scaledRef = useRef<OfflineRenderHandle | null>(null);

  // ── Device limits per resolution ──────────────────────────────────────────
  // 2×/4× render the shader at the higher resolution (not an upscale), so
  // the output must fit the GPU, a memory budget, and — for MediaRecorder —
  // the browser's video encoder. Check each option up front so ones that
  // can't work are disabled with a reason instead of failing silently.
  const [support, setSupport] = useState<Record<number, ScaleSupport> | null>(null);
  const needsOfflineHandle = mode === 'ffmpeg';
  // Bumped when the preview is resized so output sizes are re-checked.
  const [sizeKey, setSizeKey] = useState('');

  useEffect(() => {
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      if (!scaledRef.current) setSizeKey(`${canvas.width}x${canvas.height}`);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvas]);

  useEffect(() => {
    if (!canvas) return;
    let cancelled = false;
    // The modal only raises the render scale while busy, so at idle the
    // canvas is at 1× (restoreScale runs before we return to idle).
    const w = canvas.width, h = canvas.height;
    const limits = getGpuLimits(canvas);
    const preferred = preferredRecorderFormat();
    (async () => {
      const out: Record<number, ScaleSupport> = {};
      for (const { scale } of RESOLUTIONS) {
        const sw = w * scale, sh = h * scale;
        let blocked: string | null = null;
        let format: RecorderFormat | null = null;
        if (scale > 1 && !offlineRender) {
          blocked = 'High-resolution rendering isn\u2019t available yet — try again once the preview has loaded.';
        } else if (Math.max(sw, sh) > limits.maxDim) {
          blocked = `${fmtPx(sw, sh)} exceeds this GPU\u2019s maximum render size of ${limits.maxDim}px.`;
        } else if (scale > 1 && sw * sh > limits.maxPixels) {
          blocked = `${fmtPx(sw, sh)} (${(sw * sh / 1e6).toFixed(1)} MP) is more than this ${limits.isMobile ? 'mobile ' : ''}device can safely render (limit ≈ ${(limits.maxPixels / 1e6).toFixed(1)} MP).`;
        } else if (!needsOfflineHandle) {
          format = scale === 1 ? preferred : await pickRecorderFormat(sw, sh);
          if (!format) {
            blocked = scale === 1
              ? 'This browser can\u2019t record video (no MediaRecorder format supported).'
              : `No video encoder in this browser can encode ${fmtPx(sw, sh)}.`;
          }
        }
        out[scale] = { width: sw, height: sh, blocked, format };
      }
      if (!cancelled) setSupport(out);
    })();
    return () => { cancelled = true; };
  }, [canvas, offlineRender, needsOfflineHandle, sizeKey]);

  // If the chosen scale turns out to be unsupported, fall back to the largest one that is.
  useEffect(() => {
    if (!support || !support[resScale]?.blocked) return;
    const best = [...RESOLUTIONS].reverse().find(r => !support[r.scale]?.blocked);
    if (best) setResScale(best.scale);
  }, [support, resScale]);

  const current = support?.[resScale] ?? null;

  const restoreScale = () => {
    if (!scaledRef.current) return;
    scaledRef.current.setRenderScale(1);
    scaledRef.current = null;
    // Resizes while scaled were ignored (see the ResizeObserver above), and
    // restoring doesn't change CSS size, so re-check in case the preview moved.
    if (canvas) setSizeKey(`${canvas.width}x${canvas.height}`);
  };

  /** Checks were computed for a different preview size (resized since) — re-check instead of starting. */
  const staleSize = (): string | null => {
    if (!canvas || !current || canvas.width * resScale === current.width && canvas.height * resScale === current.height) return null;
    setSizeKey(`${canvas.width}x${canvas.height}`);
    return 'The preview was resized, so the output size has been updated. Press the button again to export.';
  };

  /** Raise the live renderer to the export scale; returns an error message on failure. */
  const applyScale = (): string | null => {
    if (resScale === 1) return null;
    if (!offlineRender || !current) return 'High-resolution rendering isn\u2019t available.';
    const got = offlineRender.setRenderScale(resScale);
    scaledRef.current = offlineRender;
    if (got.width !== current.width || got.height !== current.height) {
      restoreScale();
      return `The GPU could only allocate ${fmtPx(got.width, got.height)} of the requested ${fmtPx(current.width, current.height)} (out of graphics memory). Try a lower resolution.`;
    }
    return null;
  };

  const startPolling = useCallback(() => {
    tickRef.current = window.setInterval(() => {
      const r = recorderRef.current;
      if (!r) return;
      const s = r.getStats();
      setCaptureProgress(manualStop ? 0 : s.frameCount / ((duration * fps) || 1));
      setElapsed(s.elapsedTime);
      setFrameCount(s.frameCount);
      if (!r.isRecording) clearInterval(tickRef.current);
    }, 150);
  }, [manualStop, duration, fps]);

  const stopPolling = () => clearInterval(tickRef.current);

  const captureLoop = useCallback(() => {
    recorderRef.current?.capture();
    rafRef.current = requestAnimationFrame(captureLoop);
  }, []);

  // A lost WebGL context mid-export (typically GPU memory exhaustion at
  // 2×/4× on mobile) otherwise just freezes the video on the last frame.
  useEffect(() => {
    if (!canvas || !(state === 'recording' || state === 'encoding')) return;
    const onLost = () => {
      abortRef.current = true;
      cancelAnimationFrame(rafRef.current);
      stopPolling();
      if (recorderRef.current?.isRecording) recorderRef.current.stop();
      setErrorMsg(`The GPU ran out of memory at ${fmtPx(current?.width ?? 0, current?.height ?? 0)} and reset the preview. Try a lower resolution.`);
      setState('error');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => canvas.removeEventListener('webglcontextlost', onLost);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, state]);

  // ── MediaRecorder path ────────────────────────────────────────────────────

  const handleStartMediaRecorder = async () => {
    if (!canvas) { setErrorMsg('No canvas available.'); return; }
    if (!current || current.blocked || !current.format) { setErrorMsg(current?.blocked ?? 'Still checking device limits…'); return; }
    const stale = staleSize();
    if (stale) { setErrorMsg(stale); return; }
    setErrorMsg('');
    setCaptureProgress(0);
    setElapsed(0);
    setFrameCount(0);

    const scaleErr = applyScale();
    if (scaleErr) { setErrorMsg(scaleErr); setState('error'); return; }

    try {
      // Record the live canvas directly — at 2×/4× its drawing buffer is
      // already rendering at the export resolution.
      const rec = new CanvasRecorder(canvas, {
        format: 'mediarecorder',
        fps,
        duration: manualStop ? null : duration,
        videoBitsPerSecond: bitrate * 1_000_000,
        mimeType: current.format.mimeType,
        name: filename || `shader-export-${Date.now()}`,
        verbose: false,
        autoDownload: true,
        onError: (msg) => setErrorMsg(msg),
      });
      recorderRef.current = rec;
      await rec.start();
      setState('recording');
      startPolling();
      rafRef.current = requestAnimationFrame(captureLoop);
    } catch (err) {
      restoreScale();
      setErrorMsg(String(err));
      setState('error');
    }
  };

  // Auto-finish when MediaRecorder auto-stops (duration reached or encoder error)
  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => {
      const r = recorderRef.current;
      if (r && !r.isRecording) {
        clearInterval(id);
        cancelAnimationFrame(rafRef.current);
        stopPolling();
        restoreScale();
        // Wait for the file to be written (Tauri's save dialog waits on the
        // user) so a save failure is reported instead of showing "done".
        r.whenStopped().then(() => setTimeout(() => setState(r.error ? 'error' : 'done'), 400));
      }
    }, 200);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── FFmpeg offline encode path ────────────────────────────────────────────

  const handleStartFfmpeg = async () => {
    if (!offlineRender) {
      setErrorMsg('Offline render not available.');
      return;
    }
    if (!current || current.blocked) { setErrorMsg(current?.blocked ?? 'Still checking device limits…'); return; }
    const stale = staleSize();
    if (stale) { setErrorMsg(stale); return; }
    // Switch to 'encoding' first so the Encode button is gone while we wait.
    setErrorMsg('');
    setCaptureProgress(0);
    setElapsed(0);
    setFrameCount(0);
    setState('encoding');
    if (ffmpegRunRef.current) await ffmpegRunRef.current;
    const scaleErr = applyScale();
    if (scaleErr) { setErrorMsg(scaleErr); setState('error'); return; }
    abortRef.current = false;

    // Use the dedicated render target dimensions from the handle.
    // These are fixed at registration time — immune to live canvas resizes.
    const { width: w, height: h, renderAtTime, readPixels: handleReadPixels } = offlineRender;
    const startT = performance.now();

    try {
      const run = runFfmpegEncode({
        width: w,
        height: h,
        fps,
        duration,
        codec,
        // Throwing here is what actually stops the encode loop on Cancel.
        renderFrame: (t) => {
          if (abortRef.current) throw new Error('cancelled');
          renderAtTime(t);
        },
        readPixels: handleReadPixels,
        onProgress: (fraction, frame) => {
          if (abortRef.current) return;
          setCaptureProgress(fraction);
          setFrameCount(frame);
          setElapsed((performance.now() - startT) / 1000);
        },
      });
      const settled = run.catch(() => {});
      ffmpegRunRef.current = settled;
      settled.then(() => { if (ffmpegRunRef.current === settled) ffmpegRunRef.current = null; });
      const path = await run;

      restoreScale();
      setOutputPath(path);
      setState('done');
    } catch (err) {
      restoreScale();
      const msg = String(err);
      if (msg === 'Error: cancelled') {
        setState('idle');
      } else {
        setErrorMsg(msg);
        setState('error');
      }
    }
  };

  // ── Unified start/stop ────────────────────────────────────────────────────

  const handleStart = () => {
    if (mode === 'ffmpeg') handleStartFfmpeg();
    else handleStartMediaRecorder();
  };

  const handleStop = async () => {
    if (mode === 'ffmpeg') {
      // The encode loop sees this, closes FFmpeg, restores scale, and
      // returns us to idle via its 'cancelled' error.
      abortRef.current = true;
      setState('idle');
    } else {
      cancelAnimationFrame(rafRef.current);
      stopPolling();
      const r = recorderRef.current;
      // If an auto-stop already began, still wait for its save to finish.
      if (r) await (r.isRecording ? r.stop() : r.whenStopped());
      restoreScale();
      setTimeout(() => setState(r?.error ? 'error' : 'done'), 400);
    }
  };

  const handleScreenshot = () => {
    if (!canvas) return;
    const name = filename || `screenshot-${Date.now()}`;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }, 'image/png');
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      stopPolling();
      if (recorderRef.current?.isRecording) recorderRef.current.stop();
      abortRef.current = true;
      // Safe even mid-FFmpeg-encode: its next renderFrame sees the abort first.
      restoreScale();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isRecording = state === 'recording';
  const isEncoding  = state === 'encoding';
  const isDone      = state === 'done';
  const isError     = state === 'error';
  const isBusy      = isRecording || isEncoding;

  const displayW = current?.width ?? 0;
  const displayH = current?.height ?? 0;
  const preferred = preferredRecorderFormat();
  // Browser mode: H.264 can't encode this size but VP9/VP8 can.
  const formatFallback = mode === 'mediarecorder' && current?.format && preferred
    && current.format.label !== preferred.label ? current.format : null;
  const canStart = mode === 'ffmpeg'
    ? !!offlineRender && !!current && !current.blocked
    : !!canvas && !!current && !current.blocked && !!current.format;
  const blockedScales = support ? RESOLUTIONS.filter(r => support[r.scale]?.blocked) : [];

  return (
    <div style={OVERLAY} onMouseDown={e => { if (e.target === e.currentTarget && !isBusy) onClose(); }}>
      <div style={PANEL} onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '15px', color: ctp.blue }}>⬡ Export Video</span>
          <button
            onClick={onClose}
            disabled={isBusy}
            style={{ ...BTN_BASE, background: 'none', border: 'none', color: ctp.red, fontSize: '16px', padding: '0 4px', opacity: isBusy ? 0.4 : 1 }}
          >✕</button>
        </div>

        {/* Mode selector — Tauri only */}
        {inTauri && state === 'idle' && (
          <div>
            <div style={LABEL}>Export Mode</div>
            <div style={ROW}>
              <button
                onClick={() => setMode('ffmpeg')}
                style={{
                  ...BTN_BASE, flex: 1, padding: '5px 8px',
                  background: mode === 'ffmpeg' ? ctp.surface0 : ctp.mantle,
                  color: mode === 'ffmpeg' ? ctp.text : ctp.surface2,
                  borderColor: mode === 'ffmpeg' ? ctp.mauve : ctp.surface0,
                  fontSize: '11px',
                }}
              >✦ FFmpeg (HQ)</button>
              <button
                onClick={() => setMode('mediarecorder')}
                style={{
                  ...BTN_BASE, flex: 1, padding: '5px 8px',
                  background: mode === 'mediarecorder' ? ctp.surface0 : ctp.mantle,
                  color: mode === 'mediarecorder' ? ctp.text : ctp.surface2,
                  borderColor: mode === 'mediarecorder' ? ctp.blue : ctp.surface0,
                  fontSize: '11px',
                }}
              >◉ Real-time</button>
            </div>
            {mode === 'ffmpeg' && (
              <div style={{ marginTop: '4px', fontSize: '10px', color: ctp.surface1, lineHeight: 1.4 }}>
                Renders offline at exact timing — no dropped frames. Requires FFmpeg (auto-downloaded on first use).
              </div>
            )}
          </div>
        )}

        {/* Setup UI */}
        {state === 'idle' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

              {/* Codec picker — FFmpeg mode only */}
              {mode === 'ffmpeg' && (
                <div>
                  <div style={LABEL}>Codec</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {(['h264', 'prores', 'ffv1'] as FfmpegCodec[]).map(c => (
                      <button
                        key={c}
                        onClick={() => setCodec(c)}
                        style={{
                          ...BTN_BASE, padding: '5px 10px', textAlign: 'left',
                          background: codec === c ? ctp.surface0 : ctp.mantle,
                          color: codec === c ? ctp.text : ctp.surface2,
                          borderColor: codec === c ? ctp.mauve : ctp.surface0,
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}
                      >
                        <span style={{ fontWeight: codec === c ? 600 : 400 }}>{CODEC_LABELS[c]}</span>
                        <span style={{ fontSize: '10px', color: ctp.surface1, marginLeft: '8px' }}>
                          {CODEC_DESCRIPTIONS[c]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* FPS */}
              <div>
                <div style={LABEL}>FPS</div>
                <div style={ROW}>
                  {[24, 30, 60].map(f => (
                    <button
                      key={f} onClick={() => setFps(f)}
                      style={{
                        ...BTN_BASE, padding: '4px 18px',
                        background: fps === f ? ctp.surface0 : ctp.mantle,
                        color: fps === f ? ctp.text : ctp.surface2,
                        borderColor: fps === f ? ctp.blue : ctp.surface0,
                      }}
                    >{f}</button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div>
                <div style={LABEL}>Duration</div>
                <div style={ROW}>
                  {mode === 'mediarecorder' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: ctp.overlay0 }}>
                      <input
                        type="checkbox"
                        checked={manualStop}
                        onChange={e => setManualStop(e.target.checked)}
                        style={{ accentColor: ctp.blue }}
                      />
                      Manual stop
                    </label>
                  )}
                  {(!manualStop || mode === 'ffmpeg') && (
                    <>
                      <input
                        type="range" min={1} max={60} step={1}
                        value={duration}
                        onChange={e => setDuration(Number(e.target.value))}
                        style={{ flex: 1, accentColor: ctp.blue }}
                      />
                      <span style={{ color: ctp.text, minWidth: '34px', textAlign: 'right' }}>{duration}s</span>
                    </>
                  )}
                </div>
              </div>

              {/* Bitrate — MediaRecorder only */}
              {mode === 'mediarecorder' && (
                <div>
                  <div style={LABEL}>Bitrate</div>
                  <div style={ROW}>
                    {[8, 25, 50, 100].map(b => (
                      <button
                        key={b} onClick={() => setBitrate(b)}
                        style={{
                          ...BTN_BASE, padding: '4px 10px',
                          background: bitrate === b ? ctp.surface0 : ctp.mantle,
                          color: bitrate === b ? ctp.text : ctp.surface2,
                          borderColor: bitrate === b ? ctp.blue : ctp.surface0,
                        }}
                      >{b}</button>
                    ))}
                    <span style={{ color: ctp.surface1, fontSize: '10px' }}>Mbps</span>
                  </div>
                </div>
              )}

              {/* Resolution */}
              <div>
                <div style={LABEL}>Resolution</div>
                <div style={ROW}>
                  {RESOLUTIONS.map(r => {
                    const blocked = support?.[r.scale]?.blocked ?? null;
                    return (
                      <button
                        key={r.scale} onClick={() => setResScale(r.scale)}
                        disabled={!!blocked}
                        title={blocked ?? undefined}
                        style={{
                          ...BTN_BASE, padding: '4px 10px', flex: 1,
                          background: resScale === r.scale ? ctp.surface0 : ctp.mantle,
                          color: resScale === r.scale ? ctp.text : ctp.surface2,
                          borderColor: resScale === r.scale ? ctp.blue : ctp.surface0,
                          fontSize: '11px',
                          opacity: blocked ? 0.4 : 1,
                          cursor: blocked ? 'not-allowed' : 'pointer',
                        }}
                      >{r.label}</button>
                    );
                  })}
                </div>
                {canvas && (
                  <div style={{ marginTop: '4px', fontSize: '10px', color: ctp.surface1 }}>
                    Output: {displayW} × {displayH}px
                    {resScale > 1 && <span style={{ color: ctp.yellow, marginLeft: '6px' }}>⚠ higher bitrate recommended</span>}
                  </div>
                )}
                {formatFallback && current && (
                  <div style={{ marginTop: '4px', fontSize: '10px', color: ctp.yellow, lineHeight: 1.4 }}>
                    ⚠ {preferred!.label} can’t encode {fmtPx(current.width, current.height)} on this device — recording as {formatFallback.label} (.{formatFallback.ext}) instead.
                  </div>
                )}
                {blockedScales.map(r => (
                  <div key={r.scale} style={{ marginTop: '4px', fontSize: '10px', color: ctp.surface2, lineHeight: 1.4 }}>
                    {r.label.split(' ')[0]} unavailable: {support![r.scale].blocked}
                  </div>
                ))}
              </div>

              {/* Filename */}
              <div>
                <div style={LABEL}>File Name</div>
                <input
                  value={filename}
                  onChange={e => setFilename(e.target.value)}
                  placeholder="shader-export"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: ctp.mantle, border: `1px solid ${ctp.surface1}`,
                    color: ctp.text, borderRadius: '6px',
                    padding: '5px 10px', fontSize: '12px', outline: 'none',
                    fontFamily: 'system-ui, sans-serif',
                  }}
                />
              </div>
            </div>

            {mode === 'mediarecorder' && (
              <div style={{ fontSize: '10px', color: ctp.surface1, lineHeight: 1.5 }}>
                Records in real-time via MediaRecorder. Downloads as{' '}
                <strong style={{ color: ctp.overlay0 }}>.{current?.format?.ext ?? preferred?.ext ?? 'webm'}</strong> when stopped.
              </div>
            )}
          </>
        )}

        {/* Real-time recording progress */}
        {isRecording && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ color: ctp.green, fontWeight: 600, fontSize: '13px' }}>⏺ Recording…</div>
            {!manualStop && <ProgressBar value={captureProgress} />}
            <div style={{ color: ctp.overlay0, fontSize: '11px', display: 'flex', gap: '16px' }}>
              <span>⏱ {elapsed.toFixed(1)}s</span>
              <span>🎞 {frameCount} frames</span>
              {!manualStop && <span>📊 {Math.round(captureProgress * 100)}%</span>}
            </div>
          </div>
        )}

        {/* FFmpeg encoding progress */}
        {isEncoding && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ color: ctp.mauve, fontWeight: 600, fontSize: '13px' }}>✦ Encoding…</div>
            <ProgressBar value={captureProgress} />
            <div style={{ color: ctp.overlay0, fontSize: '11px', display: 'flex', gap: '16px' }}>
              <span>⏱ {elapsed.toFixed(1)}s</span>
              <span>🎞 {frameCount} frames</span>
              <span>📊 {Math.round(captureProgress * 100)}%</span>
            </div>
            <div style={{ fontSize: '10px', color: ctp.surface1 }}>
              Rendering offline — UI may be unresponsive during encoding
            </div>
          </div>
        )}

        {/* Done */}
        {isDone && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', padding: '8px 0' }}>
            <span style={{ fontSize: '28px' }}>✅</span>
            <span style={{ color: ctp.green, fontWeight: 600 }}>
              {mode === 'ffmpeg' ? 'Encoded & saved!' : 'Done — video downloaded!'}
            </span>
            {outputPath && (
              <span style={{ color: ctp.surface1, fontSize: '10px', wordBreak: 'break-all', textAlign: 'center' }}>
                {outputPath}
              </span>
            )}
            <span style={{ color: ctp.surface2, fontSize: '11px' }}>
              {frameCount} frames · {elapsed.toFixed(1)}s · {displayW}×{displayH}
            </span>
          </div>
        )}

        {/* Error */}
        {(errorMsg || isError) && (
          <div style={{ color: ctp.red, fontSize: '11px', background: '#2a1a1a', padding: '8px', borderRadius: '6px' }}>
            {errorMsg || 'An error occurred.'}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
          {(isDone || isError) && (
            <button
              onClick={() => { setState('idle'); setCaptureProgress(0); setElapsed(0); setFrameCount(0); setErrorMsg(''); setOutputPath(''); }}
              style={{ ...BTN_BASE, background: ctp.surface0, color: ctp.text }}
            >Record Again</button>
          )}
          {state === 'idle' && (
            <button onClick={onClose} style={{ ...BTN_BASE, background: 'none', color: ctp.overlay0 }}>Cancel</button>
          )}
          {state === 'idle' && (
            <button
              onClick={handleScreenshot}
              disabled={!canvas}
              style={{ ...BTN_BASE, background: ctp.mantle, color: ctp.green, borderColor: `${ctp.green}33`, flex: 1 }}
            >
              📷 Screenshot
            </button>
          )}
          {state === 'idle' && (
            <button
              onClick={handleStart}
              disabled={!canStart}
              style={{
                ...BTN_BASE,
                background: mode === 'ffmpeg' ? ctp.mauve : ctp.blue,
                color: ctp.base, fontWeight: 700,
                borderColor: mode === 'ffmpeg' ? ctp.mauve : ctp.blue,
                opacity: canStart ? 1 : 0.4,
              }}
            >
              {mode === 'ffmpeg' ? '✦ Encode' : '▶ Record'}
            </button>
          )}
          {isBusy && (
            <button
              onClick={handleStop}
              style={{ ...BTN_BASE, background: ctp.red, color: ctp.base, fontWeight: 700, borderColor: ctp.red }}
            >
              {isEncoding ? '✕ Cancel' : '■ Stop'}
            </button>
          )}
          {(isDone || isError) && (
            <button onClick={onClose} style={{ ...BTN_BASE, background: ctp.surface0, color: ctp.text }}>Close</button>
          )}
        </div>

      </div>
    </div>
  );
}
