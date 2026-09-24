import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { videoEngine } from '../../lib/videoEngine';
import { ctp } from '../../theme/palette';

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: ctp.surface2, margin: '10px 0 4px',
};

interface Props {
  node: GraphNode;
  onClose: () => void;
}

export function VideoInputModal({ node, onClose }: Props) {
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);

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
          background: ctp.base, border: `1px solid ${ctp.surface1}`, borderRadius: '10px',
          width: 'min(400px, calc(100vw - 32px))', maxHeight: '88vh', overflowY: 'auto',
          padding: '16px 20px', display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)', color: ctp.text, fontSize: '12px',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontWeight: 700, fontSize: '14px', color: ctp.mauve }}>▶ Video Input</span>
            {hasFile && (
              <span style={{ fontSize: '10px', color: ctp.overlay0, background: ctp.mantle, borderRadius: '4px', padding: '2px 8px', fontFamily: 'monospace', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fileName}
              </span>
            )}
          </div>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={onClose}
            style={{ background: ctp.surface0, border: `1px solid ${ctp.surface1}`, color: ctp.text, borderRadius: '4px', padding: '2px 6px', fontSize: '13px', cursor: 'pointer' }}
          >✕</button>
        </div>

        {!hasFile && (
          <div style={{ background: ctp.mantle, borderRadius: '6px', padding: '12px', marginBottom: '12px', textAlign: 'center', color: ctp.surface2, fontSize: '11px' }}>
            Drop a video file onto the node card to load video.
          </div>
        )}

        {/* Playback controls */}
        <p style={SECTION_LABEL}>Playback</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
          {/* Play/pause */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: ctp.subtext0, width: '80px', flexShrink: 0 }}>Status</span>
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={togglePlay}
              disabled={!hasFile}
              style={{
                background: !hasFile ? ctp.mantle : isPlaying ? `${ctp.green}33` : `${ctp.mauve}33`,
                border: `1px solid ${!hasFile ? ctp.surface0 : isPlaying ? ctp.green : ctp.mauve}`,
                color: !hasFile ? ctp.surface1 : isPlaying ? ctp.green : ctp.mauve,
                borderRadius: '4px', padding: '4px 12px', fontSize: '11px',
                cursor: hasFile ? 'pointer' : 'default', fontWeight: 600,
              }}
            >{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
          </div>

          {/* Loop */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: ctp.subtext0, width: '80px', flexShrink: 0 }}>Loop</span>
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={handleLoopToggle}
              style={{
                background: loop ? `${ctp.blue}33` : 'none',
                border: `1px solid ${loop ? ctp.blue : ctp.surface1}`,
                color: loop ? ctp.blue : ctp.surface2,
                borderRadius: '4px', padding: '3px 10px', fontSize: '10px',
                cursor: 'pointer',
              }}
            >{loop ? 'On' : 'Off'}</button>
          </div>

          {/* Speed */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: ctp.subtext0, width: '80px', flexShrink: 0 }}>Speed</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {SPEED_OPTIONS.map(s => (
                <button
                  key={s}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => handleSpeedChange(s)}
                  style={{
                    background: speed === s ? `${ctp.yellow}33` : 'none',
                    border: `1px solid ${speed === s ? ctp.yellow : ctp.surface1}`,
                    color: speed === s ? ctp.yellow : ctp.surface2,
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
            <div key={o.name} style={{ background: ctp.mantle, borderRadius: '4px', padding: '5px 8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontFamily: 'monospace' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: o.color, flexShrink: 0 }} />
              <span style={{ color: o.color }}>{o.name}</span>
              <span style={{ color: ctp.surface2 }}>→</span>
              <span style={{ color: ctp.blue }}>{o.type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
