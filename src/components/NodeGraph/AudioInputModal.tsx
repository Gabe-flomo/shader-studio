import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { audioSpectrumRegistry } from '../../lib/audioSpectrumRegistry';

const BTN: React.CSSProperties = {
  background: '#313244',
  border: '1px solid #45475a',
  color: '#cdd6f4',
  borderRadius: '4px',
  padding: '3px 8px',
  fontSize: '11px',
  fontFamily: 'monospace',
  cursor: 'pointer',
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#585b70',
  margin: '10px 0 4px',
};

const SLIDER_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  marginBottom: '6px',
};

interface Props {
  node: GraphNode;
  onClose: () => void;
}

export function AudioInputModal({ node, onClose }: Props) {
  const { updateNodeParams } = useNodeGraphStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const freqCenter = typeof node.params.freq_center === 'number' ? node.params.freq_center : 200;
  const freqRange  = typeof node.params.freq_range  === 'number' ? node.params.freq_range  : 200;
  const mode       = (node.params.mode as string) ?? 'band';
  const fileName   = (node.params._fileName as string) || '';
  const hasFile    = !!(node.params._hasFile);

  // Register the spectrum canvas so ShaderCanvas.animate() can draw into it each frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    audioSpectrumRegistry.set(node.id, canvas);
    return () => {
      audioSpectrumRegistry.delete(node.id);
    };
  }, [node.id]);

  // ── Key handler ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#1e1e2e',
          border: '1px solid #45475a',
          borderRadius: '10px',
          width: 'min(520px, calc(100vw - 32px))',
          maxHeight: '88vh',
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '0',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          color: '#cdd6f4',
          fontSize: '12px',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontWeight: 700, fontSize: '14px', color: '#89dceb' }}>♫ Audio Input</span>
            {hasFile && (
              <span style={{
                fontSize: '10px', color: '#6c7086',
                background: '#181825', borderRadius: '4px',
                padding: '2px 8px', fontFamily: 'monospace',
                maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {fileName}
              </span>
            )}
          </div>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={onClose}
            style={{ ...BTN, padding: '2px 6px', fontSize: '13px' }}
          >
            ✕
          </button>
        </div>

        {/* ── No file notice ────────────────────────────────────────────────── */}
        {!hasFile && (
          <div style={{
            background: '#181825', borderRadius: '6px', padding: '12px',
            marginBottom: '12px', textAlign: 'center',
            color: '#585b70', fontSize: '11px',
          }}>
            Drop a WAV / MP3 / OGG file onto the node card to load audio.
          </div>
        )}

        {/* ── Live spectrum canvas ──────────────────────────────────────────── */}
        <p style={SECTION_LABEL}>Live Spectrum</p>
        <div style={{
          background: '#11111b', borderRadius: '6px', overflow: 'hidden',
          border: '1px solid #313244', marginBottom: '12px',
        }}>
          <canvas
            ref={canvasRef}
            width={480}
            height={80}
            style={{ display: 'block', width: '100%', height: '80px' }}
          />
          {!hasFile && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              color: '#45475a', fontSize: '10px', pointerEvents: 'none',
            }}>
              no audio loaded
            </div>
          )}
        </div>

        {/* ── Frequency controls ────────────────────────────────────────────── */}
        <p style={SECTION_LABEL}>Frequency Band</p>
        <div style={{ marginBottom: '12px' }}>
          {/* Mode select */}
          <div style={{ ...SLIDER_ROW, marginBottom: '10px' }}>
            <span style={{ fontSize: '11px', color: '#a6adc8', width: '100px', flexShrink: 0 }}>Mode</span>
            <select
              value={mode}
              onChange={e => updateNodeParams(node.id, { mode: e.target.value })}
              onMouseDown={e => e.stopPropagation()}
              style={{
                background: '#313244', border: '1px solid #45475a', color: '#cdd6f4',
                borderRadius: '4px', padding: '3px 6px', fontSize: '11px', cursor: 'pointer',
              }}
            >
              <option value="band">Frequency Band</option>
              <option value="full">Full Spectrum</option>
            </select>
          </div>

          {/* Freq center slider */}
          <div style={SLIDER_ROW}>
            <span style={{ fontSize: '11px', color: '#a6adc8', width: '100px', flexShrink: 0 }}>
              Center (Hz)
            </span>
            <input
              type="range"
              min={20} max={20000} step={1}
              value={freqCenter}
              disabled={mode === 'full'}
              onMouseDown={e => e.stopPropagation()}
              onChange={e => updateNodeParams(node.id, { freq_center: parseFloat(e.target.value) })}
              style={{ flex: 1, accentColor: '#89dceb', opacity: mode === 'full' ? 0.35 : 1 }}
            />
            <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#6c7086', width: '52px', textAlign: 'right' }}>
              {freqCenter >= 1000 ? `${(freqCenter / 1000).toFixed(1)}k` : `${Math.round(freqCenter)}`} Hz
            </span>
          </div>

          {/* Freq range slider */}
          <div style={SLIDER_ROW}>
            <span style={{ fontSize: '11px', color: '#a6adc8', width: '100px', flexShrink: 0 }}>
              Range (±Hz)
            </span>
            <input
              type="range"
              min={0} max={10000} step={1}
              value={freqRange}
              disabled={mode === 'full'}
              onMouseDown={e => e.stopPropagation()}
              onChange={e => updateNodeParams(node.id, { freq_range: parseFloat(e.target.value) })}
              style={{ flex: 1, accentColor: '#89dceb', opacity: mode === 'full' ? 0.35 : 1 }}
            />
            <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#6c7086', width: '52px', textAlign: 'right' }}>
              {freqRange >= 1000 ? `${(freqRange / 1000).toFixed(1)}k` : `${Math.round(freqRange)}`} Hz
            </span>
          </div>

          {/* Band summary */}
          {mode === 'band' && (
            <div style={{ fontSize: '10px', color: '#585b70', marginTop: '4px', fontFamily: 'monospace' }}>
              Band: {Math.max(20, freqCenter - freqRange)} – {Math.min(20000, freqCenter + freqRange)} Hz
            </div>
          )}
        </div>

        {/* ── Output info ───────────────────────────────────────────────────── */}
        <p style={SECTION_LABEL}>Output</p>
        <div style={{
          background: '#181825', borderRadius: '6px', padding: '8px 10px',
          display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: '11px', fontFamily: 'monospace', color: '#a6adc8',
        }}>
          <span style={{ color: '#f0a' }}>amplitude</span>
          <span style={{ color: '#585b70' }}>→</span>
          <span style={{ color: '#89b4fa' }}>float</span>
          <span style={{ color: '#585b70', marginLeft: '4px' }}>(0 – 1)</span>
          <span style={{ marginLeft: 'auto', color: '#45475a', fontSize: '10px' }}>
            u_audio_{node.id}
          </span>
        </div>

      </div>
    </div>,
    document.body,
  );
}
