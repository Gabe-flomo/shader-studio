import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CanvasRecorder, type RecordFormat } from '../utils/CanvasRecorder';
import { useFFmpeg, type EncodeFormat } from '../hooks/useFFmpeg';

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
  width: '440px',
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

// ── Format types ─────────────────────────────────────────────────────────────

type ExportFormat = 'webm' | 'mp4-ffmpeg' | 'gif-ffmpeg' | 'png-zip';

const FORMAT_CARDS: { id: ExportFormat; label: string; desc: string; tag?: string }[] = [
  { id: 'webm',       label: 'WebM',       desc: 'Real-time · fast · browser-native',  tag: 'fast' },
  { id: 'mp4-ffmpeg', label: 'MP4',        desc: 'High quality · encoded in-browser',  tag: 'best' },
  { id: 'gif-ffmpeg', label: 'GIF',        desc: 'Looping · palette-optimised',        tag: '' },
  { id: 'png-zip',    label: 'PNG Zip',    desc: 'Lossless frames · use with ffmpeg',  tag: '' },
];

// ── Format option card ────────────────────────────────────────────────────────

function FormatCard({
  id: _id, label, desc, tag, selected, onSelect,
}: {
  id: ExportFormat; label: string; desc: string; tag?: string;
  selected: boolean; onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        ...BTN_BASE,
        flex: 1,
        textAlign: 'left',
        padding: '8px 10px',
        background: selected ? '#2a2a3e' : '#181825',
        borderColor: selected ? '#89b4fa' : '#313244',
        color: selected ? '#cdd6f4' : '#6c7086',
        display: 'flex', flexDirection: 'column', gap: '3px',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontWeight: 700, fontSize: '12px', color: selected ? '#89b4fa' : '#6c7086' }}>{label}</span>
        {tag && <span style={{ fontSize: '9px', background: '#313244', borderRadius: '3px', padding: '1px 4px', color: '#a6e3a1' }}>{tag}</span>}
      </span>
      <span style={{ fontSize: '10px', opacity: 0.7 }}>{desc}</span>
    </button>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, color = 'linear-gradient(90deg, #89b4fa, #cba6f7)' }: { value: number; color?: string }) {
  return (
    <div style={{ background: '#313244', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        width: `${Math.min(Math.round(value * 100), 100)}%`,
        background: color,
        borderRadius: '4px',
        transition: 'width 0.15s linear',
      }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  canvas: HTMLCanvasElement | null;
  onClose: () => void;
}

type RecordState = 'idle' | 'recording' | 'encoding' | 'done' | 'error';

function downloadBlob(blob: Blob, filename: string) {
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

export function ExportModal({ canvas, onClose }: Props) {
  const [format, setFormat]         = useState<ExportFormat>('mp4-ffmpeg');
  const [fps, setFps]               = useState(30);
  const [duration, setDuration]     = useState(5);
  const [manualStop, setManualStop] = useState(false);
  const [bitrate, setBitrate]       = useState(25); // Mbps (webm only)

  const [state, setState]           = useState<RecordState>('idle');
  const [captureProgress, setCaptureProgress] = useState(0);
  const [encodeProgress, setEncodeProgress]   = useState(0);
  const [elapsed, setElapsed]       = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [statusMsg, setStatusMsg]   = useState('');
  const [errorMsg, setErrorMsg]     = useState('');

  const recorderRef  = useRef<CanvasRecorder | null>(null);
  const rafRef       = useRef<number>(0);
  const tickRef      = useRef<number>(0);

  const { load: loadFfmpeg, encode, loading: ffmpegLoading, ready: ffmpegReady } = useFFmpeg();

  // Pre-load ffmpeg as soon as the user picks MP4 or GIF (once only)
  const hasTriggeredLoad = useRef(false);
  useEffect(() => {
    if ((format === 'mp4-ffmpeg' || format === 'gif-ffmpeg') && !ffmpegReady && !ffmpegLoading && !hasTriggeredLoad.current) {
      hasTriggeredLoad.current = true;
      loadFfmpeg();
    }
  }, [format, ffmpegReady, ffmpegLoading, loadFfmpeg]);

  // Poll recorder stats while capturing
  const startPolling = useCallback(() => {
    tickRef.current = window.setInterval(() => {
      const r = recorderRef.current;
      if (!r) return;
      const s = r.getStats();
      setCaptureProgress(manualStop ? 0 : s.frameCount / ((duration * fps) || 1));
      setElapsed(s.elapsedTime);
      setFrameCount(s.frameCount);
      if (!r.isRecording) {
        clearInterval(tickRef.current);
      }
    }, 150);
  }, [manualStop, duration, fps]);

  const stopPolling = () => clearInterval(tickRef.current);

  // rAF capture loop
  const captureLoop = useCallback(() => {
    recorderRef.current?.capture();
    rafRef.current = requestAnimationFrame(captureLoop);
  }, []);

  // Map ExportFormat → RecordFormat + encode info
  const getRecordFormat = (f: ExportFormat): RecordFormat =>
    f === 'webm' ? 'mediarecorder' : 'png';

  const needsFFmpeg = (f: ExportFormat) => f === 'mp4-ffmpeg' || f === 'gif-ffmpeg';

  const handleStart = async () => {
    if (!canvas) { setErrorMsg('No canvas available — open the studio first.'); return; }
    setErrorMsg('');
    setCaptureProgress(0);
    setEncodeProgress(0);
    setElapsed(0);
    setFrameCount(0);
    setStatusMsg('');

    // For ffmpeg formats, ensure wasm is loaded before starting
    if (needsFFmpeg(format) && !ffmpegReady) {
      setStatusMsg('Loading encoder…');
      await loadFfmpeg();
      setStatusMsg('');
    }

    try {
      const rec = new CanvasRecorder(canvas, {
        format: getRecordFormat(format),
        fps,
        duration: manualStop ? null : duration,
        videoBitsPerSecond: bitrate * 1_000_000,
        name: `shader-export-${Date.now()}`,
        verbose: false,
        // For ffmpeg formats, don't auto-download zip — we'll handle output ourselves
        autoDownload: !needsFFmpeg(format),
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

  const handleStop = async () => {
    cancelAnimationFrame(rafRef.current);
    stopPolling();
    await recorderRef.current?.stop();
    await finishExport();
  };

  const finishExport = async () => {
    const rec = recorderRef.current;
    if (!rec) return;

    const finalFrameCount = rec.frames.length > 0 ? rec.frames.length : frameCount;
    setFrameCount(finalFrameCount);

    if (needsFFmpeg(format)) {
      const frames = rec.frames.map(f => f.data);
      if (frames.length === 0) {
        setErrorMsg('No frames captured.');
        setState('error');
        return;
      }
      setState('encoding');
      setEncodeProgress(0);
      setStatusMsg(`Encoding ${frames.length} frames…`);
      try {
        const encodeFormat: EncodeFormat = format === 'gif-ffmpeg' ? 'gif' : 'mp4';
        const blob = await encode(frames, {
          fps,
          format: encodeFormat,
          onProgress: (r) => setEncodeProgress(r),
          onLog: (msg) => setStatusMsg(msg.slice(0, 60)),
        });
        const ext = encodeFormat === 'gif' ? 'gif' : 'mp4';
        downloadBlob(blob, `shader-export.${ext}`);
        setState('done');
        setStatusMsg('');
      } catch (err) {
        setErrorMsg(String(err));
        setState('error');
      }
    } else if (format === 'png-zip') {
      // CanvasRecorder already handled zip download; just mark done
      setState('done');
    } else {
      // webm — auto-downloaded by MediaRecorder onstop
      setTimeout(() => setState('done'), 600);
    }
  };

  // Auto-finish when recorder auto-stops (duration reached)
  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => {
      const r = recorderRef.current;
      if (r && !r.isRecording) {
        clearInterval(id);
        cancelAnimationFrame(rafRef.current);
        stopPolling();
        finishExport();
      }
    }, 200);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      stopPolling();
      if (recorderRef.current?.isRecording) recorderRef.current.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isRecording  = state === 'recording';
  const isEncoding   = state === 'encoding';
  const isDone       = state === 'done';
  const isError      = state === 'error';
  const isBusy       = isRecording || isEncoding;

  return (
    <div style={OVERLAY} onMouseDown={e => { if (e.target === e.currentTarget && !isBusy) onClose(); }}>
      <div style={PANEL} onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '15px', color: '#89b4fa' }}>⬡ Export Animation</span>
          <button
            onClick={onClose}
            disabled={isBusy}
            style={{ ...BTN_BASE, background: 'none', border: 'none', color: '#f38ba8', fontSize: '16px', padding: '0 4px', opacity: isBusy ? 0.4 : 1 }}
          >✕</button>
        </div>

        {/* Setup UI — hidden while busy or done */}
        {state === 'idle' && (
          <>
            {/* Format */}
            <div>
              <div style={LABEL}>Format</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                {FORMAT_CARDS.map(fc => (
                  <FormatCard
                    key={fc.id} id={fc.id} label={fc.label} desc={fc.desc} tag={fc.tag}
                    selected={format === fc.id}
                    onSelect={() => setFormat(fc.id)}
                  />
                ))}
              </div>
            </div>

            {/* Encoder status — always rendered for MP4/GIF to avoid layout shift */}
            <div style={{
              fontSize: '10px',
              minHeight: '16px',
              color: ffmpegReady ? '#a6e3a1' : '#f9e2af',
              display: 'flex', alignItems: 'center', gap: '6px',
              visibility: (format === 'mp4-ffmpeg' || format === 'gif-ffmpeg') ? 'visible' : 'hidden',
            }}>
              {ffmpegLoading
                ? '⏳ Loading encoder (~10 MB, one-time)…'
                : ffmpegReady
                  ? '✓ Encoder ready'
                  : '↻ Encoder loads when recording starts'}
            </div>

            {/* Settings */}
            <div>
              <div style={LABEL}>Settings</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

                {/* FPS */}
                <div style={ROW}>
                  <span style={{ width: '80px', color: '#6c7086' }}>FPS</span>
                  {[24, 30, 60].map(f => (
                    <button
                      key={f} onClick={() => setFps(f)}
                      style={{
                        ...BTN_BASE, padding: '4px 14px',
                        background: fps === f ? '#313244' : '#181825',
                        color: fps === f ? '#cdd6f4' : '#585b70',
                        borderColor: fps === f ? '#89b4fa' : '#313244',
                      }}
                    >{f}</button>
                  ))}
                </div>

                {/* Duration */}
                <div style={ROW}>
                  <span style={{ width: '80px', color: '#6c7086' }}>Duration</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#6c7086' }}>
                    <input
                      type="checkbox"
                      checked={manualStop}
                      onChange={e => setManualStop(e.target.checked)}
                      style={{ accentColor: '#89b4fa' }}
                    />
                    Manual stop
                  </label>
                  {!manualStop && (
                    <>
                      <input
                        type="range"
                        min={1} max={30} step={1}
                        value={duration}
                        onChange={e => setDuration(Number(e.target.value))}
                        style={{ flex: 1, accentColor: '#89b4fa' }}
                      />
                      <span style={{ color: '#cdd6f4', minWidth: '30px', textAlign: 'right' }}>{duration}s</span>
                    </>
                  )}
                </div>

                {/* Bitrate (webm only) */}
                {format === 'webm' && (
                  <div style={ROW}>
                    <span style={{ width: '80px', color: '#6c7086' }}>Bitrate</span>
                    {[8, 25, 50].map(b => (
                      <button
                        key={b} onClick={() => setBitrate(b)}
                        style={{
                          ...BTN_BASE, padding: '4px 10px',
                          background: bitrate === b ? '#313244' : '#181825',
                          color: bitrate === b ? '#cdd6f4' : '#585b70',
                          borderColor: bitrate === b ? '#89b4fa' : '#313244',
                        }}
                      >{b} Mbps</button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Info blurb */}
            <div style={{ fontSize: '10px', color: '#45475a', lineHeight: 1.5 }}>
              {format === 'webm'       && 'Records in real-time. Downloads as WebM when done.'}
              {format === 'mp4-ffmpeg' && 'Captures PNG frames then encodes to MP4 in your browser using ffmpeg.wasm. Best quality.'}
              {format === 'gif-ffmpeg' && 'Captures PNG frames then encodes to a palette-optimised GIF in your browser.'}
              {format === 'png-zip'    && 'Captures every frame as a PNG and packages them into a .zip file.'}
            </div>
          </>
        )}

        {/* Recording progress */}
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

        {/* Encoding progress */}
        {isEncoding && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ color: '#f9e2af', fontWeight: 600, fontSize: '13px' }}>⚙ Encoding with ffmpeg.wasm…</div>
            <ProgressBar value={encodeProgress} color="linear-gradient(90deg, #f9e2af, #fab387)" />
            <div style={{ color: '#6c7086', fontSize: '11px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <span>📊 {Math.round(encodeProgress * 100)}%</span>
              <span>🎞 {frameCount} frames</span>
            </div>
            {statusMsg && (
              <div style={{ fontSize: '9px', color: '#45475a', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {statusMsg}
              </div>
            )}
          </div>
        )}

        {/* Done */}
        {isDone && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', padding: '8px 0' }}>
            <span style={{ fontSize: '28px' }}>✅</span>
            <span style={{ color: '#a6e3a1', fontWeight: 600 }}>Export complete — file downloaded!</span>
            <span style={{ color: '#585b70', fontSize: '11px' }}>{frameCount} frames · {elapsed.toFixed(1)}s</span>
          </div>
        )}

        {/* Error */}
        {(errorMsg || isError) && (
          <div style={{ color: '#f38ba8', fontSize: '11px', background: '#2a1a1a', padding: '8px', borderRadius: '6px' }}>
            {errorMsg || 'An error occurred. Check the console for details.'}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
          {(isDone || isError) && (
            <button
              onClick={() => { setState('idle'); setCaptureProgress(0); setEncodeProgress(0); setElapsed(0); setFrameCount(0); setErrorMsg(''); setStatusMsg(''); }}
              style={{ ...BTN_BASE, background: '#313244', color: '#cdd6f4' }}
            >Record Again</button>
          )}
          {state === 'idle' && (
            <button
              onClick={onClose}
              style={{ ...BTN_BASE, background: 'none', color: '#6c7086' }}
            >Cancel</button>
          )}
          {state === 'idle' && (
            <button
              onClick={handleStart}
              disabled={!canvas || ffmpegLoading}
              style={{ ...BTN_BASE, background: '#89b4fa', color: '#1e1e2e', fontWeight: 700, borderColor: '#89b4fa', opacity: (canvas && !ffmpegLoading) ? 1 : 0.4 }}
            >▶ Start Recording</button>
          )}
          {isRecording && (
            <button
              onClick={handleStop}
              style={{ ...BTN_BASE, background: '#f38ba8', color: '#1e1e2e', fontWeight: 700, borderColor: '#f38ba8' }}
            >■ Stop</button>
          )}
          {(isDone || isError) && (
            <button
              onClick={onClose}
              style={{ ...BTN_BASE, background: '#313244', color: '#cdd6f4' }}
            >Close</button>
          )}
        </div>

      </div>
    </div>
  );
}
