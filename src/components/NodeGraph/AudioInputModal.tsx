import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { audioSpectrumRegistry } from '../../lib/audioSpectrumRegistry';

function sliderToHz(v: number): number {
  const t = v / 1000;
  return Math.round(20 * Math.pow(1000, Math.pow(t, 0.6)));
}
function hzToSlider(hz: number): number {
  const ratio = Math.log(Math.max(20, Math.min(20000, hz)) / 20) / Math.log(1000);
  return Math.round(Math.pow(Math.max(0, ratio), 1 / 0.6) * 1000);
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#585b70', margin: '10px 0 4px',
};

interface Props {
  node: GraphNode;
  onClose: () => void;
}

export function AudioInputModal({ node, onClose }: Props) {
  const { updateNodeParams, updateNodeOutputs, updateNodeInputs } = useNodeGraphStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rawBands  = node.params._bands;
  const bands: number[] = Array.isArray(rawBands) ? rawBands as number[] : [200];
  const freqRange  = typeof node.params.freq_range === 'number' ? node.params.freq_range : 200;
  const mode       = (node.params.mode as string) ?? 'band';
  const soloedBand = typeof node.params._soloedBand === 'number' ? node.params._soloedBand : -1;
  const fileName   = (node.params._fileName as string) || '';
  const hasFile    = !!(node.params._hasFile);

  const buildOutputs = (bs: number[]) =>
    Object.fromEntries(bs.map((_, i) => [`amplitude_${i}`, { type: 'float' as const, label: `Band ${i}` }]));
  const buildInputs = (bs: number[]) =>
    Object.fromEntries(bs.map((_, i) => [`band_${i}_center`, { type: 'float' as const, label: `Band ${i} Hz` }]));

  const handleAddBand = () => {
    const newBands = [...bands, 1000];
    updateNodeParams(node.id, { _bands: newBands }, { immediate: true });
    updateNodeOutputs(node.id, buildOutputs(newBands));
    updateNodeInputs(node.id, buildInputs(newBands));
  };

  const handleRemoveBand = (i: number) => {
    if (bands.length <= 1) return;
    const newBands = bands.filter((_, idx) => idx !== i);
    updateNodeParams(node.id, { _bands: newBands }, { immediate: true });
    updateNodeOutputs(node.id, buildOutputs(newBands));
    updateNodeInputs(node.id, buildInputs(newBands));
  };

  const handleSolo = (i: number) => {
    updateNodeParams(node.id, { _soloedBand: soloedBand === i ? -1 : i }, { immediate: true });
  };

  // Register spectrum canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    audioSpectrumRegistry.set(node.id, canvas);
    return () => { audioSpectrumRegistry.delete(node.id); };
  }, [node.id]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const BAND_COLORS = ['#89dceb', '#a6e3a1', '#fab387', '#f38ba8', '#cba6f7', '#f9e2af'];

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
          background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '10px',
          width: 'min(520px, calc(100vw - 32px))', maxHeight: '88vh', overflowY: 'auto',
          padding: '16px 20px', display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)', color: '#cdd6f4', fontSize: '12px',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontWeight: 700, fontSize: '14px', color: '#89dceb' }}>
              ♫ Audio Input
              {soloedBand >= 0 && <span style={{ color: '#f9e2af', fontSize: '10px', marginLeft: '6px' }}>SOLO</span>}
            </span>
            {hasFile && (
              <span style={{ fontSize: '10px', color: '#6c7086', background: '#181825', borderRadius: '4px', padding: '2px 8px', fontFamily: 'monospace', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fileName}
              </span>
            )}
          </div>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={onClose}
            style={{ background: '#313244', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '4px', padding: '2px 6px', fontSize: '13px', cursor: 'pointer' }}
          >✕</button>
        </div>

        {/* No file notice */}
        {!hasFile && (
          <div style={{ background: '#181825', borderRadius: '6px', padding: '12px', marginBottom: '12px', textAlign: 'center', color: '#585b70', fontSize: '11px' }}>
            Drop a WAV / MP3 / OGG file onto the node card to load audio.
          </div>
        )}

        {/* Live spectrum canvas */}
        <p style={SECTION_LABEL}>Live Spectrum</p>
        <div style={{ background: '#11111b', borderRadius: '6px', overflow: 'hidden', border: '1px solid #313244', marginBottom: '12px' }}>
          <canvas ref={canvasRef} width={480} height={80} style={{ display: 'block', width: '100%', height: '80px' }} />
        </div>

        {/* Controls */}
        <p style={SECTION_LABEL}>Frequency Bands</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
          {/* Mode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: '#a6adc8', width: '80px', flexShrink: 0 }}>Mode</span>
            <select
              value={mode}
              onChange={e => updateNodeParams(node.id, { mode: e.target.value })}
              onMouseDown={e => e.stopPropagation()}
              style={{ background: '#313244', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '4px', padding: '3px 6px', fontSize: '11px', cursor: 'pointer' }}
            >
              <option value="band">Frequency Band</option>
              <option value="full">Full Spectrum</option>
            </select>
          </div>

          {/* Shared range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: '#a6adc8', width: '80px', flexShrink: 0 }}>Range ±Hz</span>
            <input
              type="range" min={0} max={1000} step={1}
              value={Math.round(freqRange / 10)}
              disabled={mode === 'full'}
              onMouseDown={e => e.stopPropagation()}
              onChange={e => updateNodeParams(node.id, { freq_range: parseInt(e.target.value) * 10 })}
              style={{ flex: 1, accentColor: '#89dceb', opacity: mode === 'full' ? 0.35 : 1 }}
            />
            <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#6c7086', width: '52px', textAlign: 'right' }}>
              ±{freqRange >= 1000 ? `${(freqRange/1000).toFixed(1)}k` : freqRange} Hz
            </span>
          </div>

          {/* Band list */}
          {mode !== 'full' && bands.map((center, i) => {
            const col = BAND_COLORS[i % BAND_COLORS.length];
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: col, flexShrink: 0 }} />
                <span style={{ fontSize: '10px', color: '#585b70', width: '18px', flexShrink: 0, fontFamily: 'monospace' }}>{i}</span>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => handleSolo(i)}
                  title={soloedBand === i ? 'Un-solo' : 'Solo this band'}
                  style={{ background: soloedBand === i ? '#f9e2af22' : 'none', border: soloedBand === i ? '1px solid #f9e2af55' : '1px solid transparent', color: soloedBand === i ? '#f9e2af' : '#45475a', cursor: 'pointer', fontSize: '9px', padding: '1px 4px', lineHeight: 1, flexShrink: 0, fontWeight: 700, borderRadius: '3px' }}
                >S</button>
                <input
                  type="range" min={0} max={1000} step={1}
                  value={hzToSlider(center)}
                  onMouseDown={e => e.stopPropagation()}
                  onChange={e => {
                    const newHz = sliderToHz(parseInt(e.target.value));
                    const newBands = bands.map((c, idx) => idx === i ? newHz : c);
                    updateNodeParams(node.id, { _bands: newBands });
                  }}
                  style={{ flex: 1, accentColor: col }}
                />
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#6c7086', width: '52px', textAlign: 'right' }}>
                  {center >= 1000 ? `${(center/1000).toFixed(1)}k` : center} Hz
                </span>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => handleRemoveBand(i)}
                  disabled={bands.length <= 1}
                  style={{ background: 'none', border: 'none', color: bands.length <= 1 ? '#313244' : '#585b70', cursor: bands.length <= 1 ? 'default' : 'pointer', fontSize: '13px', padding: '0', flexShrink: 0 }}
                >×</button>
              </div>
            );
          })}

          {mode !== 'full' && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={handleAddBand}
              style={{ background: '#181825', border: '1px dashed #45475a', color: '#585b70', fontSize: '10px', borderRadius: '4px', padding: '4px', cursor: 'pointer', width: '100%', marginTop: '2px' }}
            >+ Add Band</button>
          )}
        </div>

        {/* Outputs */}
        <p style={SECTION_LABEL}>Outputs</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {bands.map((center, i) => {
            const col = BAND_COLORS[i % BAND_COLORS.length];
            const muted = soloedBand >= 0 && soloedBand !== i;
            return (
              <div key={i} style={{ background: '#181825', borderRadius: '4px', padding: '5px 8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontFamily: 'monospace', opacity: muted ? 0.4 : 1 }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: col, flexShrink: 0 }} />
                <span style={{ color: col }}>amplitude_{i}</span>
                <span style={{ color: '#585b70' }}>→</span>
                <span style={{ color: '#89b4fa' }}>float</span>
                <span style={{ color: '#585b70' }}>(0–1)</span>
                {mode !== 'full' && <span style={{ color: '#45475a', marginLeft: 'auto', fontSize: '10px' }}>@ {center >= 1000 ? `${(center/1000).toFixed(1)}k` : center}Hz</span>}
                {muted && <span style={{ color: '#f38ba8', fontSize: '9px', marginLeft: 'auto' }}>MUTED</span>}
              </div>
            );
          })}
        </div>

      </div>
    </div>,
    document.body,
  );
}
