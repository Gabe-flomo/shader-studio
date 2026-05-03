import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { videoEngine } from '../../lib/videoEngine';

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: '#585b70', margin: '10px 0 4px',
};

interface Props {
  node: GraphNode;
  onClose: () => void;
}

export function VideoInputModal({ node, onClose }: Props) {
  const { updateNodeParams } = useNodeGraphStore();

  const fileName  = (node.params._fileName as string) || '';
  const hasFile   = !!(node.params._hasFile);
  const isPlaying = !!(node.params._isPlaying);
  const loop      = node.params._loop !== false;
  const speed     = typeof node.params._speed === 'number' ? node.params._speed : 1.0;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const togglePlay = () => {
    if (isPlaying) {
      videoEngine.pause(node.id);
      updateNodeParams(node.id, { _isPlaying: false }, { immediate: true });
    } else {
      videoEngine.play(node.id);
      updateNodeParams(node.id, { _isPlaying: true }, { immediate: true });
    }
  };

  const handleSpeedChange = (rate: number) => {
    videoEngine.setSpeed(node.id, rate);
    updateNodeParams(node.id, { _speed: rate }, { immediate: true });
  };

  const handleLoopToggle = () => {
    videoEngine.setLoop(node.id, !loop);
    updateNodeParams(node.id, { _loop: !loop }, { immediate: true });
  };

  const SPEED_OPTIONS = [0.25, 0.5, 1.0, 1.5, 2.0];

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
          width: 'min(400px, calc(100vw - 32px))', maxHeight: '88vh', overflowY: 'auto',
          padding: '16px 20px', display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)', color: '#cdd6f4', fontSize: '12px',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontWeight: 700, fontSize: '14px', color: '#cba6f7' }}>▶ Video Input</span>
            {hasFile && (
              <span style={{ fontSize: '10px', color: '#6c7086', background: '#181825', borderRadius: '4px', padding: '2px 8px', fontFamily: 'monospace', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

        {!hasFile && (
          <div style={{ background: '#181825', borderRadius: '6px', padding: '12px', marginBottom: '12px', textAlign: 'center', color: '#585b70', fontSize: '11px' }}>
            Drop a video file onto the node card to load video.
          </div>
        )}

        {/* Playback controls */}
        <p style={SECTION_LABEL}>Playback</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
          {/* Play/pause */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: '#a6adc8', width: '80px', flexShrink: 0 }}>Status</span>
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={togglePlay}
              disabled={!hasFile}
              style={{
                background: !hasFile ? '#181825' : isPlaying ? '#a6e3a133' : '#cba6f733',
                border: `1px solid ${!hasFile ? '#313244' : isPlaying ? '#a6e3a1' : '#cba6f7'}`,
                color: !hasFile ? '#45475a' : isPlaying ? '#a6e3a1' : '#cba6f7',
                borderRadius: '4px', padding: '4px 12px', fontSize: '11px',
                cursor: hasFile ? 'pointer' : 'default', fontWeight: 600,
              }}
            >{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
          </div>

          {/* Loop */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: '#a6adc8', width: '80px', flexShrink: 0 }}>Loop</span>
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={handleLoopToggle}
              style={{
                background: loop ? '#89b4fa33' : 'none',
                border: `1px solid ${loop ? '#89b4fa' : '#45475a'}`,
                color: loop ? '#89b4fa' : '#585b70',
                borderRadius: '4px', padding: '3px 10px', fontSize: '10px',
                cursor: 'pointer',
              }}
            >{loop ? 'On' : 'Off'}</button>
          </div>

          {/* Speed */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: '#a6adc8', width: '80px', flexShrink: 0 }}>Speed</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {SPEED_OPTIONS.map(s => (
                <button
                  key={s}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => handleSpeedChange(s)}
                  style={{
                    background: speed === s ? '#f9e2af33' : 'none',
                    border: `1px solid ${speed === s ? '#f9e2af' : '#45475a'}`,
                    color: speed === s ? '#f9e2af' : '#585b70',
                    borderRadius: '4px', padding: '3px 6px', fontSize: '10px',
                    cursor: 'pointer', fontFamily: 'monospace',
                  }}
                >{s}×</button>
              ))}
            </div>
          </div>
        </div>

        {/* Outputs */}
        <p style={SECTION_LABEL}>Outputs</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {[
            { name: 'color', type: 'vec3', color: '#0fa' },
            { name: 'alpha', type: 'float', color: '#f0a' },
            { name: 'uv', type: 'vec2', color: '#0af' },
          ].map(o => (
            <div key={o.name} style={{ background: '#181825', borderRadius: '4px', padding: '5px 8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontFamily: 'monospace' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: o.color, flexShrink: 0 }} />
              <span style={{ color: o.color }}>{o.name}</span>
              <span style={{ color: '#585b70' }}>→</span>
              <span style={{ color: '#89b4fa' }}>{o.type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
