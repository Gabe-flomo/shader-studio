import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CanvasRecorder } from '../utils/CanvasRecorder';
import { runFfmpegEncode, type FfmpegCodec } from '../utils/ffmpegRecorder';
import type { OfflineRenderHandle } from './ShaderCanvas';

// ── Styles ────────────────────────────────────────────────────────────────────

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2000,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const PANEL: React.CSSProperties = {
  background: '#1e1e2e',
  border: '1px solid #45475a',
  borderRadius: '12px',
  width: '420px',
  maxWidth: '95vw',
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
  color: '#cdd6f4',
  fontSize: '12px',
};

const BTN_BASE: React.CSSProperties = {
  border: '1px solid #45475a',
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
  color: '#585b70',
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
    <div style={{ background: '#313244', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        width: `${Math.min(Math.round(value * 100), 100)}%`,
        background: 'linear-gradient(90deg, #89b4fa, #cba6f7)',
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

  const [state, setState]                       = useState<RecordState>('idle');
  const [captureProgress, setCaptureProgress]   = useState(0);
  const [elapsed, setElapsed]                   = useState(0);
  const [frameCount, setFrameCount]             = useState(0);
  const [errorMsg, setErrorMsg]                 = useState('');
  const [outputPath, setOutputPath]             = useState('');

  const recorderRef  = useRef<CanvasRecorder | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef       = useRef<number>(0);
  const tickRef      = useRef<number>(0);
  const abortRef     = useRef(false);

  // Derive the recording canvas (upscaled offscreen or the real one)
  const getRecordCanvas = useCallback((): HTMLCanvasElement | null => {
    if (!canvas) return null;
    if (resScale === 1) return canvas;
    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
    const oc = offscreenRef.current;
    oc.width  = canvas.width  * resScale;
    oc.height = canvas.height * resScale;
    return oc;
  }, [canvas, resScale]);

  const copyToOffscreen = useCallback(() => {
    if (resScale === 1 || !canvas || !offscreenRef.current) return;
    const ctx = offscreenRef.current.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0, offscreenRef.current.width, offscreenRef.current.height);
  }, [canvas, resScale]);

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
    copyToOffscreen();
    recorderRef.current?.capture();
    rafRef.current = requestAnimationFrame(captureLoop);
  }, [copyToOffscreen]);

  // ── MediaRecorder path ────────────────────────────────────────────────────

  const handleStartMediaRecorder = async () => {
    if (!canvas) { setErrorMsg('No canvas available.'); return; }
    setErrorMsg('');
    setCaptureProgress(0);
    setElapsed(0);
    setFrameCount(0);

    const recordCanvas = getRecordCanvas();
    if (!recordCanvas) return;

    try {
      const rec = new CanvasRecorder(recordCanvas, {
        format: 'mediarecorder',
        fps,
        duration: manualStop ? null : duration,
        videoBitsPerSecond: bitrate * 1_000_000,
        name: `shader-export-${Date.now()}`,
        verbose: false,
        autoDownload: true,
      });
      recorderRef.current = rec;
      await rec.start();
      setState('recording');
      startPolling();
      rafRef.current = requestAnimationFrame(captureLoop);
    } catch (err) {
      setErrorMsg(String(err));
      setState('error');
    }
  };

  // Auto-finish when MediaRecorder auto-stops (duration reached)
  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => {
      const r = recorderRef.current;
      if (r && !r.isRecording) {
        clearInterval(id);
        cancelAnimationFrame(rafRef.current);
        stopPolling();
        setTimeout(() => setState('done'), 400);
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

    setErrorMsg('');
    setCaptureProgress(0);
    setElapsed(0);
    setFrameCount(0);
    abortRef.current = false;
    setState('encoding');

    // Use the dedicated render target dimensions from the handle.
    // These are fixed at registration time — immune to live canvas resizes.
    const { width: w, height: h, renderAtTime, readPixels: handleReadPixels } = offlineRender;
    const startT = performance.now();

    try {
      const path = await runFfmpegEncode({
        width: w,
        height: h,
        fps,
        duration,
        codec,
        renderFrame: renderAtTime,
        readPixels: handleReadPixels,
        onProgress: (fraction, frame) => {
          if (abortRef.current) return;
          setCaptureProgress(fraction);
          setFrameCount(frame);
          setElapsed((performance.now() - startT) / 1000);
        },
      });

      setOutputPath(path);
      setState('done');
    } catch (err) {
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
      abortRef.current = true;
      setState('idle');
    } else {
      cancelAnimationFrame(rafRef.current);
      stopPolling();
      await recorderRef.current?.stop();
      setTimeout(() => setState('done'), 400);
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      stopPolling();
      if (recorderRef.current?.isRecording) recorderRef.current.stop();
      abortRef.current = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isRecording = state === 'recording';
  const isEncoding  = state === 'encoding';
  const isDone      = state === 'done';
  const isError     = state === 'error';
  const isBusy      = isRecording || isEncoding;

  const displayW = mode === 'ffmpeg' && offlineRender
    ? offlineRender.width
    : canvas ? canvas.width * resScale : 0;
  const displayH = mode === 'ffmpeg' && offlineRender
    ? offlineRender.height
    : canvas ? canvas.height * resScale : 0;

  return (
    <div style={OVERLAY} onMouseDown={e => { if (e.target === e.currentTarget && !isBusy) onClose(); }}>
      <div style={PANEL} onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '15px', color: '#89b4fa' }}>⬡ Export Video</span>
          <button
            onClick={onClose}
            disabled={isBusy}
            style={{ ...BTN_BASE, background: 'none', border: 'none', color: '#f38ba8', fontSize: '16px', padding: '0 4px', opacity: isBusy ? 0.4 : 1 }}
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
                  background: mode === 'ffmpeg' ? '#313244' : '#181825',
                  color: mode === 'ffmpeg' ? '#cdd6f4' : '#585b70',
                  borderColor: mode === 'ffmpeg' ? '#cba6f7' : '#313244',
                  fontSize: '11px',
                }}
              >✦ FFmpeg (HQ)</button>
              <button
                onClick={() => setMode('mediarecorder')}
                style={{
                  ...BTN_BASE, flex: 1, padding: '5px 8px',
                  background: mode === 'mediarecorder' ? '#313244' : '#181825',
                  color: mode === 'mediarecorder' ? '#cdd6f4' : '#585b70',
                  borderColor: mode === 'mediarecorder' ? '#89b4fa' : '#313244',
                  fontSize: '11px',
                }}
              >◉ Real-time</button>
            </div>
            {mode === 'ffmpeg' && (
              <div style={{ marginTop: '4px', fontSize: '10px', color: '#45475a', lineHeight: 1.4 }}>
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
                          background: codec === c ? '#313244' : '#181825',
                          color: codec === c ? '#cdd6f4' : '#585b70',
                          borderColor: codec === c ? '#cba6f7' : '#313244',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}
                      >
                        <span style={{ fontWeight: codec === c ? 600 : 400 }}>{CODEC_LABELS[c]}</span>
                        <span style={{ fontSize: '10px', color: '#45475a', marginLeft: '8px' }}>
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
                        background: fps === f ? '#313244' : '#181825',
                        color: fps === f ? '#cdd6f4' : '#585b70',
                        borderColor: fps === f ? '#89b4fa' : '#313244',
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
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#6c7086' }}>
                      <input
                        type="checkbox"
                        checked={manualStop}
                        onChange={e => setManualStop(e.target.checked)}
                        style={{ accentColor: '#89b4fa' }}
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
                        style={{ flex: 1, accentColor: '#89b4fa' }}
                      />
                      <span style={{ color: '#cdd6f4', minWidth: '34px', textAlign: 'right' }}>{duration}s</span>
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
                          background: bitrate === b ? '#313244' : '#181825',
                          color: bitrate === b ? '#cdd6f4' : '#585b70',
                          borderColor: bitrate === b ? '#89b4fa' : '#313244',
                        }}
                      >{b}</button>
                    ))}
                    <span style={{ color: '#45475a', fontSize: '10px' }}>Mbps</span>
                  </div>
                </div>
              )}

              {/* Resolution */}
              <div>
                <div style={LABEL}>Resolution</div>
                <div style={ROW}>
                  {RESOLUTIONS.map(r => (
                    <button
                      key={r.scale} onClick={() => setResScale(r.scale)}
                      style={{
                        ...BTN_BASE, padding: '4px 10px', flex: 1,
                        background: resScale === r.scale ? '#313244' : '#181825',
                        color: resScale === r.scale ? '#cdd6f4' : '#585b70',
                        borderColor: resScale === r.scale ? '#89b4fa' : '#313244',
                        fontSize: '11px',
                      }}
                    >{r.label}</button>
                  ))}
                </div>
                {canvas && (
                  <div style={{ marginTop: '4px', fontSize: '10px', color: '#45475a' }}>
                    Output: {displayW} × {displayH}px
                    {resScale > 1 && <span style={{ color: '#f9e2af', marginLeft: '6px' }}>⚠ higher bitrate recommended</span>}
                  </div>
                )}
              </div>
            </div>

            {mode === 'mediarecorder' && (
              <div style={{ fontSize: '10px', color: '#45475a', lineHeight: 1.5 }}>
                Records in real-time via MediaRecorder. Downloads as{' '}
                <strong style={{ color: '#6c7086' }}>{inTauri ? '.mp4' : '.webm'}</strong> when stopped.
              </div>
            )}
          </>
        )}

        {/* Real-time recording progress */}
        {isRecording && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ color: '#a6e3a1', fontWeight: 600, fontSize: '13px' }}>⏺ Recording…</div>
            {!manualStop && <ProgressBar value={captureProgress} />}
            <div style={{ color: '#6c7086', fontSize: '11px', display: 'flex', gap: '16px' }}>
              <span>⏱ {elapsed.toFixed(1)}s</span>
              <span>🎞 {frameCount} frames</span>
              {!manualStop && <span>📊 {Math.round(captureProgress * 100)}%</span>}
            </div>
          </div>
        )}

        {/* FFmpeg encoding progress */}
        {isEncoding && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ color: '#cba6f7', fontWeight: 600, fontSize: '13px' }}>✦ Encoding…</div>
            <ProgressBar value={captureProgress} />
            <div style={{ color: '#6c7086', fontSize: '11px', display: 'flex', gap: '16px' }}>
              <span>⏱ {elapsed.toFixed(1)}s</span>
              <span>🎞 {frameCount} frames</span>
              <span>📊 {Math.round(captureProgress * 100)}%</span>
            </div>
            <div style={{ fontSize: '10px', color: '#45475a' }}>
              Rendering offline — UI may be unresponsive during encoding
            </div>
          </div>
        )}

        {/* Done */}
        {isDone && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', padding: '8px 0' }}>
            <span style={{ fontSize: '28px' }}>✅</span>
            <span style={{ color: '#a6e3a1', fontWeight: 600 }}>
              {mode === 'ffmpeg' ? 'Encoded & saved!' : 'Done — video downloaded!'}
            </span>
            {outputPath && (
              <span style={{ color: '#45475a', fontSize: '10px', wordBreak: 'break-all', textAlign: 'center' }}>
                {outputPath}
              </span>
            )}
            <span style={{ color: '#585b70', fontSize: '11px' }}>
              {frameCount} frames · {elapsed.toFixed(1)}s · {displayW}×{displayH}
            </span>
          </div>
        )}

        {/* Error */}
        {(errorMsg || isError) && (
          <div style={{ color: '#f38ba8', fontSize: '11px', background: '#2a1a1a', padding: '8px', borderRadius: '6px' }}>
            {errorMsg || 'An error occurred.'}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
          {(isDone || isError) && (
            <button
              onClick={() => { setState('idle'); setCaptureProgress(0); setElapsed(0); setFrameCount(0); setErrorMsg(''); setOutputPath(''); }}
              style={{ ...BTN_BASE, background: '#313244', color: '#cdd6f4' }}
            >Record Again</button>
          )}
          {state === 'idle' && (
            <button onClick={onClose} style={{ ...BTN_BASE, background: 'none', color: '#6c7086' }}>Cancel</button>
          )}
          {state === 'idle' && (
            <button
              onClick={handleStart}
              disabled={mode === 'ffmpeg' ? !offlineRender : !canvas}
              style={{
                ...BTN_BASE,
                background: mode === 'ffmpeg' ? '#cba6f7' : '#89b4fa',
                color: '#1e1e2e', fontWeight: 700,
                borderColor: mode === 'ffmpeg' ? '#cba6f7' : '#89b4fa',
                opacity: (mode === 'ffmpeg' ? !offlineRender : !canvas) ? 0.4 : 1,
              }}
            >
              {mode === 'ffmpeg' ? '✦ Encode' : '▶ Record'}
            </button>
          )}
          {isBusy && (
            <button
              onClick={handleStop}
              style={{ ...BTN_BASE, background: '#f38ba8', color: '#1e1e2e', fontWeight: 700, borderColor: '#f38ba8' }}
            >
              {isEncoding ? '✕ Cancel' : '■ Stop'}
            </button>
          )}
          {(isDone || isError) && (
            <button onClick={onClose} style={{ ...BTN_BASE, background: '#313244', color: '#cdd6f4' }}>Close</button>
          )}
        </div>

      </div>
    </div>
  );
}
