import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CanvasRecorder } from '../utils/CanvasRecorder';
import { runFfmpegEncode, type FfmpegCodec } from '../utils/ffmpegRecorder';
import type { OfflineRenderHandle } from './ShaderCanvas';
import { getGpuLimits, pickRecorderFormat, preferredRecorderFormat, type RecorderFormat } from '../utils/exportLimits';
import { useTokens } from '../theme/themeStore';
import { alpha, fontFamily, radius } from '../theme/tokens';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Segmented, Toggle } from './ui/Choice';
import { Field } from './ui/Field';
import { Icon } from './ui/Icon';
import { Modal } from './ui/Modal';
import { RulerSlider } from './ui/RulerSlider';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { PREVIEW_ASPECTS } from '../utils/graphImportPlan';

// ── Progress bar ──────────────────────────────────────────────────────────────

// Pulsing record dot, injected once
if (typeof document !== 'undefined' && !document.getElementById('rec-pulse-anim')) {
  const st = document.createElement('style');
  st.id = 'rec-pulse-anim';
  st.textContent = '@keyframes recPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }';
  document.head.appendChild(st);
}

function ProgressBar({ value }: { value: number }) {
  const tk = useTokens();
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}
      style={{ background: tk.bg.field, borderRadius: 4, height: 8, overflow: 'hidden' }}>
      <div style={{
        height: '100%', width: `${Math.min(Math.round(value * 100), 100)}%`, background: tk.accent.base,
        borderRadius: 4, transition: 'width 0.15s linear',
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

// Output sizes. "Preview" is the canvas as shown; the rest are standard
// short sides (720p, 1080p, 1440p, 2160p) laid out in the preview's shape,
// so a 16:9 preview gives 1920×1080 and a 9:16 preview 1080×1920.
const RESOLUTIONS: ReadonlyArray<{ id: string; label: string; sub: string; shortSide: number | null }> = [
  { id: 'preview', label: 'Preview', sub: 'as shown', shortSide: null },
  { id: '720',     label: '720p',    sub: 'HD',       shortSide: 720 },
  { id: '1080',    label: '1080p',   sub: 'Full HD',  shortSide: 1080 },
  { id: '1440',    label: '1440p',   sub: '2K',       shortSide: 1440 },
  { id: '2160',    label: '2160p',   sub: '4K',       shortSide: 2160 },
];

/** Even pixel dimensions for `shortSide` in the canvas's aspect (video encoders want even sizes). */
function sizeFor(canvasW: number, canvasH: number, shortSide: number | null): { width: number; height: number } {
  if (!shortSide) return { width: canvasW, height: canvasH };
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const ratio = canvasW / Math.max(1, canvasH);
  return ratio >= 1
    ? { width: even(shortSide * ratio), height: shortSide }
    : { width: shortSide, height: even(shortSide / ratio) };
}

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
  const tk = useTokens();
  const [fps, setFps]               = useState(60);
  const [duration, setDuration]     = useState(5);
  const [manualStop, setManualStop] = useState(false);
  const [bitrate, setBitrate]       = useState(50); // Mbps
  const [resId, setResId]           = useState('preview');
  const previewAspect    = useNodeGraphStore(s => s.previewAspect);
  const setPreviewAspect = useNodeGraphStore(s => s.setPreviewAspect);
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
  const [support, setSupport] = useState<Record<string, ScaleSupport> | null>(null);
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
      const out: Record<string, ScaleSupport> = {};
      for (const { id, shortSide } of RESOLUTIONS) {
        const { width: sw, height: sh } = sizeFor(w, h, shortSide);
        const scale = id === 'preview' ? 1 : 2; // any non-preview size renders off the CSS size
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
        out[id] = { width: sw, height: sh, blocked, format };
      }
      if (!cancelled) setSupport(out);
    })();
    return () => { cancelled = true; };
  }, [canvas, offlineRender, needsOfflineHandle, sizeKey]);

  // If the chosen scale turns out to be unsupported, fall back to the largest one that is.
  useEffect(() => {
    if (!support || !support[resId]?.blocked) return;
    const best = [...RESOLUTIONS].reverse().find(r => !support[r.id]?.blocked);
    if (best) setResId(best.id);
  }, [support, resId]);

  const current = support?.[resId] ?? null;

  const restoreScale = () => {
    if (!scaledRef.current) return;
    scaledRef.current.setRenderSize(null);
    scaledRef.current = null;
    // Resizes while scaled were ignored (see the ResizeObserver above), and
    // restoring doesn't change CSS size, so re-check in case the preview moved.
    if (canvas) setSizeKey(`${canvas.width}x${canvas.height}`);
  };

  /** Checks were computed for a different preview size (resized since) — re-check instead of starting. */
  const staleSize = (): string | null => {
    if (!canvas || !current) return null;
    const expect = sizeFor(canvas.width, canvas.height, RESOLUTIONS.find(r => r.id === resId)?.shortSide ?? null);
    if (expect.width === current.width && expect.height === current.height) return null;
    setSizeKey(`${canvas.width}x${canvas.height}`);
    return 'The preview was resized, so the output size has been updated. Press the button again to export.';
  };

  /** Raise the live renderer to the export scale; returns an error message on failure. */
  const applyScale = (): string | null => {
    if (resId === 'preview') return null;
    if (!offlineRender || !current) return 'High-resolution rendering isn\u2019t available.';
    const got = offlineRender.setRenderSize({ width: current.width, height: current.height });
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
  const blockedScales = support ? RESOLUTIONS.filter(r => support[r.id]?.blocked) : [];

  const ext = mode === 'ffmpeg' ? (codec === 'prores' ? 'mov' : codec === 'ffv1' ? 'mkv' : 'mp4') : (current?.format?.ext ?? preferred?.ext ?? 'webm');
  const resetToIdle = () => { setState('idle'); setCaptureProgress(0); setElapsed(0); setFrameCount(0); setErrorMsg(''); setOutputPath(''); };

  const footer = state === 'idle' ? (
    <>
      <Button icon="camera" disabled={!canvas} onClick={handleScreenshot}>Snapshot PNG</Button>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!canStart} onClick={handleStart}>
        {mode === 'ffmpeg' ? 'Encode' : <><span style={{ width: 8, height: 8, borderRadius: '50%', background: tk.status.danger }} />Start recording</>}
      </Button>
    </>
  ) : isBusy ? (
    <>
      <span style={{ flex: 1 }} />
      <Button variant="danger" onClick={handleStop}>{isEncoding ? 'Cancel encode' : 'Stop recording'}</Button>
    </>
  ) : (
    <>
      <Button onClick={resetToIdle}>Record again</Button>
      <span style={{ flex: 1 }} />
      <Button variant="primary" onClick={onClose}>Close</Button>
    </>
  );

  const stats = (
    <div style={{ display: 'flex', gap: 16, font: `500 12px ${fontFamily.mono}`, color: tk.text.muted, fontVariantNumeric: 'tabular-nums' }}>
      <span>{elapsed.toFixed(1)}s</span>
      <span>{frameCount} frames</span>
      {(isEncoding || !manualStop) && <span>{Math.round(captureProgress * 100)}%</span>}
    </div>
  );

  return (
    <Modal
      title="Record"
      subtitle="Export the preview as video or a still"
      icon="record"
      iconColor={tk.status.danger}
      width={480}
      closeOnScrim={!isBusy}
      onClose={() => { if (!isBusy) onClose(); }}
      footer={footer}
    >
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Mode — Tauri only */}
        {inTauri && state === 'idle' && (
          <Section label="Mode">
            <Segmented
              fill
              ariaLabel="Export mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'ffmpeg', label: 'FFmpeg (HQ)', sub: 'offline, exact timing' },
                { value: 'mediarecorder', label: 'Real-time', sub: 'records as it plays' },
              ]}
            />
            {mode === 'ffmpeg' && <Help>Renders offline at exact timing, with no dropped frames. FFmpeg downloads on first use.</Help>}
          </Section>
        )}

        {state === 'idle' && (
          <>
            {mode === 'ffmpeg' && (
              <Section label="Codec">
                <div role="radiogroup" aria-label="Codec" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(['h264', 'prores', 'ffv1'] as FfmpegCodec[]).map(c => {
                    const on = codec === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setCodec(c)}
                        style={{
                          height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 12px',
                          border: 0, borderRadius: radius.control, cursor: 'pointer', textAlign: 'left',
                          background: on ? tk.bg.selected : tk.bg.panel,
                          boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? tk.accent.base : tk.border.default}`,
                          color: tk.text.primary, font: `${on ? 600 : 500} 12.5px ${fontFamily.ui}`,
                        }}
                      >
                        {CODEC_LABELS[c]}
                        <span style={{ fontSize: 11.5, fontWeight: 500, color: tk.text.muted }}>{CODEC_DESCRIPTIONS[c]}</span>
                      </button>
                    );
                  })}
                </div>
              </Section>
            )}

            <Section label="Frame rate">
              <Segmented
                fill
                ariaLabel="Frame rate"
                value={String(fps)}
                onChange={v => setFps(Number(v))}
                options={[24, 30, 60].map(f => ({ value: String(f), label: `${f}`, sub: 'fps' }))}
              />
            </Section>

            <Section label="Duration">
              {(!manualStop || mode === 'ffmpeg') && (
                <div style={{ display: 'flex' }}>
                  <RulerSlider value={duration} min={1} max={60} step={1} defaultValue={5} onChange={setDuration} ariaLabel="Duration in seconds" />
                </div>
              )}
              {mode === 'mediarecorder' && <Toggle checked={manualStop} onChange={setManualStop} label="Stop manually instead" />}
            </Section>

            <Section label="Shape" meta={PREVIEW_ASPECTS.find(a => a.id === previewAspect)?.hint}>
              <Segmented
                fill
                ariaLabel="Aspect ratio"
                value={previewAspect}
                onChange={v => setPreviewAspect(v as typeof previewAspect)}
                options={PREVIEW_ASPECTS.map(a => ({ value: a.id, label: a.label, title: a.hint }))}
              />
              <Help>The preview takes this shape too, so what you see is what you export. Free follows the panel.</Help>
            </Section>

            <Section label="Resolution" meta={canvas && current ? `${displayW} × ${displayH} px` : undefined}>
              <Segmented
                fill
                ariaLabel="Resolution"
                value={resId}
                onChange={v => setResId(v)}
                options={RESOLUTIONS.map(r => {
                  const sup = support?.[r.id];
                  const blocked = sup?.blocked ?? null;
                  return { value: r.id, label: r.label, sub: sup ? fmtPx(sup.width, sup.height) : r.sub, disabled: !!blocked, title: blocked ?? undefined };
                })}
              />
              {resId !== 'preview' && <Help>Rendered at that exact size in the preview's shape. Higher resolutions need a higher bitrate to look clean.</Help>}
              {formatFallback && current && (
                <Callout tone="warning" title={`Recording as ${formatFallback.label} instead`}>
                  {preferred!.label} can’t encode {fmtPx(current.width, current.height)} on this device, so the file will be .{formatFallback.ext}.
                </Callout>
              )}
              {blockedScales.map(r => (
                <Help key={r.id}>{r.label} unavailable: {support![r.id].blocked}</Help>
              ))}
            </Section>

            {mode === 'mediarecorder' && (
              <Section label="Bitrate">
                <Segmented
                  fill
                  ariaLabel="Bitrate"
                  value={String(bitrate)}
                  onChange={v => setBitrate(Number(v))}
                  options={[8, 25, 50, 100].map(b => ({ value: String(b), label: `${b}`, sub: 'Mbps' }))}
                />
              </Section>
            )}

            <Section label="File name">
              <Field mono value={filename} onChange={e => setFilename(e.target.value)} placeholder="shader-export" suffix={`.${ext}`} aria-label="File name" />
              {mode === 'mediarecorder' && <Help>Records in real time. The file downloads when recording stops.</Help>}
            </Section>
          </>
        )}

        {isRecording && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: tk.status.danger, animation: 'recPulse 1.2s ease-in-out infinite' }} />
              Recording…
            </div>
            {!manualStop && <ProgressBar value={captureProgress} />}
            {stats}
          </div>
        )}

        {isEncoding && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Encoding…</div>
            <ProgressBar value={captureProgress} />
            {stats}
            <Help>Rendering offline, so the app may be unresponsive until it finishes.</Help>
          </div>
        )}

        {isDone && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 0', textAlign: 'center' }}>
            <span style={{
              width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: alpha(tk.status.success, 0.14), color: tk.status.success,
            }}><Icon name="check" size={20} /></span>
            <b style={{ fontSize: 14, fontWeight: 600 }}>{mode === 'ffmpeg' ? 'Encoded and saved' : 'Recording saved'}</b>
            {outputPath && <span style={{ font: `11.5px ${fontFamily.mono}`, color: tk.text.muted, wordBreak: 'break-all' }}>{outputPath}</span>}
            <span style={{ fontSize: 12, color: tk.text.muted }}>{frameCount} frames · {elapsed.toFixed(1)}s · {displayW}×{displayH}</span>
          </div>
        )}

        {(errorMsg || isError) && (
          <Callout title={isError ? 'Recording failed' : 'Can’t start yet'} details={errorMsg && errorMsg.length > 140 ? errorMsg : undefined}>
            {errorMsg && errorMsg.length <= 140 ? errorMsg : (errorMsg ? 'See the details below.' : 'Something went wrong while recording.')}
          </Callout>
        )}
      </div>
    </Modal>
  );
}

function Section({ label, meta, children }: { label: string; meta?: string; children: React.ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>
        <span style={{ flex: 1 }}>{label}</span>
        {meta && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 12, color: tk.text.muted }}>{meta}</span>}
      </span>
      {children}
    </div>
  );
}

function Help({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: tk.text.muted }}>{children}</p>;
}
