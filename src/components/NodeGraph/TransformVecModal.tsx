import React from 'react';
import { createPortal } from 'react-dom';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode, DataType } from '../../types/nodeGraph';

const INPUT_STYLE: React.CSSProperties = {
  background: '#11111b',
  border: '1px solid #45475a',
  color: '#a6e3a1',
  borderRadius: '4px',
  padding: '4px 8px',
  fontSize: '12px',
  fontFamily: 'monospace',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '9px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#45475a',
  margin: '0 0 6px',
};

const COMPS = ['x', 'y', 'z', 'w'] as const;
const COMP_COLORS: Record<string, string> = { x: '#f38ba8', y: '#a6e3a1', z: '#89b4fa', w: '#fab387' };

interface Props { node: GraphNode; onClose: () => void }

export function TransformVecModal({ node, onClose }: Props) {
  const updateNodeParams    = useNodeGraphStore(s => s.updateNodeParams);
  const changeNodeVectorType = useNodeGraphStore(s => s.changeNodeVectorType);

  const type = (node.params.outputType as string) || 'vec2';
  const dims = type === 'vec4' ? 4 : type === 'vec3' ? 3 : 2;
  const activeComps = COMPS.slice(0, dims);

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '10px', width: 'min(480px, calc(100vw - 32px))', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px', boxShadow: '0 8px 32px rgba(0,0,0,0.65)', color: '#cdd6f4', fontSize: '12px' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#89b4fa' }}>⊞ Transform Vec</span>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #f38ba855', color: '#f38ba8', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', borderRadius: '4px' }}>✕ Close</button>
        </div>

        {/* Type selector */}
        <div>
          <p style={SECTION_LABEL}>Input / Output Type</p>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['vec2', 'vec3', 'vec4'] as DataType[]).map(t => {
              const active = type === t;
              return (
                <button key={t}
                  onClick={() => changeNodeVectorType(node.id, 'v', 'result', t)}
                  style={{ fontSize: '11px', padding: '3px 12px', borderRadius: '4px', cursor: 'pointer',
                    background: active ? '#89b4fa22' : 'none',
                    border: `1px solid ${active ? '#89b4fa' : '#45475a55'}`,
                    color: active ? '#89b4fa' : '#6c7086',
                  }}
                >{t}</button>
              );
            })}
          </div>
        </div>

        {/* Per-component expression editors */}
        <div>
          <p style={SECTION_LABEL}>Component Expressions</p>
          <p style={{ fontSize: '10px', color: '#45475a', marginBottom: '10px', lineHeight: 1.5 }}>
            Variables available: {activeComps.map(c => (
              <code key={c} style={{ color: COMP_COLORS[c], marginRight: '6px' }}>{c}</code>
            ))}
            — any GLSL built-in is also valid (<code style={{ color: '#6c7086' }}>sign(x)</code>, <code style={{ color: '#6c7086' }}>atan(y, x)</code>, …)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {activeComps.map(c => {
              const pk  = `expr${c.toUpperCase()}`;
              const val = typeof node.params[pk] === 'string' ? (node.params[pk] as string) : c;
              return (
                <div key={c} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontFamily: 'monospace', color: COMP_COLORS[c], width: '12px', flexShrink: 0 }}>{c}</span>
                  <span style={{ fontSize: '11px', color: '#45475a', fontFamily: 'monospace', flexShrink: 0 }}>=</span>
                  <input
                    type="text"
                    value={val}
                    spellCheck={false}
                    placeholder={c}
                    onChange={e => updateNodeParams(node.id, { [pk]: e.target.value })}
                    style={INPUT_STYLE}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Outputs hint */}
        <div style={{ background: '#181825', borderRadius: '6px', padding: '10px 12px', border: '1px solid #313244' }}>
          <p style={{ ...SECTION_LABEL, marginBottom: '4px' }}>Outputs</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '10px', fontFamily: 'monospace' }}>
            {activeComps.map(c => (
              <span key={c} style={{ color: COMP_COLORS[c] }}>{c} <span style={{ color: '#45475a' }}>(float)</span></span>
            ))}
            <span style={{ color: '#89b4fa' }}>result <span style={{ color: '#45475a' }}>({type})</span></span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
