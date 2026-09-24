import React, { useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { parseGlslFunctions, buildCustomFnParams } from '../../utils/glslParser';
import { useCtp, type CtpPalette } from '../../theme/nodePalette';
import { Modal } from '../ui/Modal';
import { useTokens } from '../../theme/themeStore';

interface Props {
  onClose: () => void;
}

const BTNFor = (tc: CtpPalette): React.CSSProperties => ({
  background: tc.surface0,
  border: `1px solid ${tc.surface1}`,
  color: tc.text,
  borderRadius: '4px',
  padding: '5px 12px',
  fontSize: '12px',
  fontFamily: 'monospace',
  cursor: 'pointer',
});

export function ImportGlslModal({ onClose }: Props) {
  const tc = useCtp();
  const tk = useTokens();
  const BTN = BTNFor(tc);
  const { addNode } = useNodeGraphStore();
  const [code, setCode] = useState('');

  // Live parse
  const parsed = parseGlslFunctions(code);

  const handleCreate = () => {
    if (parsed.length === 0) return;
    const params = buildCustomFnParams(parsed[0], code);
    const x = 200 + Math.random() * 160;
    const y = 120 + Math.random() * 200;
    addNode('customFn', { x, y }, params);
    onClose();
  };

  return (
    <Modal title="Import GLSL function" subtitle="Paste GLSL; the first function becomes a Custom Fn node" icon="import" iconColor={tk.status.success} width={660} onClose={onClose}>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12.5 }}>
        {/* Description */}
        <div style={{ fontSize: '11px', color: tc.surface2, lineHeight: 1.5 }}>
          Paste one or more GLSL functions. The <strong style={{ color: tc.text }}>first</strong> function
          becomes the node's entry point. All code is injected as helper functions.
        </div>

        {/* Code textarea */}
        <textarea
          value={code}
          onChange={e => setCode(e.target.value)}
          spellCheck={false}
          rows={12}
          placeholder={`// Example:\nfloat sdBox(vec2 p, vec2 b) {\n  vec2 d = abs(p) - b;\n  return length(max(d,0.0)) + min(max(d.x,d.y),0.0);\n}`}
          style={{
            background: tc.crust,
            border: `1px solid ${tc.surface1}`,
            color: tc.blue,
            padding: '10px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontFamily: 'monospace',
            width: '100%',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
            lineHeight: 1.6,
          }}
        />

        {/* Live parse preview */}
        <div>
          <div style={{
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: tc.surface2, marginBottom: '6px',
          }}>
            Detected Functions
          </div>
          {code.trim() === '' ? (
            <div style={{ color: tc.surface2, fontSize: '11px', fontStyle: 'italic' }}>
              Paste GLSL code above to preview detected functions
            </div>
          ) : parsed.length === 0 ? (
            <div style={{ color: tc.red, fontSize: '11px' }}>
              No function signatures detected. Make sure your code includes a return type, name, and body.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {parsed.map((fn, i) => (
                <div
                  key={i}
                  style={{
                    background: i === 0 ? `${tc.green}1a` : tc.mantle,
                    border: `1px solid ${i === 0 ? `${tc.green}55` : tc.surface1}`,
                    borderRadius: '5px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    color: i === 0 ? tc.green : tc.surface2,
                  }}
                  title={i === 0 ? 'Entry point — will be called in the node body' : 'Helper function'}
                >
                  {i === 0 && <span style={{ color: tc.green, marginRight: '4px' }}>★</span>}
                  {fn.returnType} {fn.name}({fn.params.map(p => `${p.type} ${p.name}`).join(', ')})
                </div>
              ))}
            </div>
          )}
        </div>

        {/* What will be created preview */}
        {parsed.length > 0 && (
          <div style={{
            background: tc.mantle,
            border: `1px solid ${tc.surface0}`,
            borderRadius: '6px',
            padding: '10px 12px',
            fontSize: '11px',
            fontFamily: 'monospace',
          }}>
            <div style={{ color: tc.surface2, marginBottom: '6px', fontSize: '10px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Node Preview
            </div>
            <div><span style={{ color: tc.surface2 }}>Label: </span><span style={{ color: tc.text }}>{parsed[0].name}</span></div>
            <div><span style={{ color: tc.surface2 }}>Output: </span><span style={{ color: tc.blue }}>{parsed[0].returnType}</span></div>
            <div><span style={{ color: tc.surface2 }}>Inputs: </span>
              {parsed[0].params.length === 0
                ? <span style={{ color: tc.surface2 }}>none</span>
                : parsed[0].params.map((p, i) => (
                  <span key={i} style={{ color: tc.mauve, marginRight: '8px' }}>{p.type} <span style={{ color: tc.text }}>{p.name}</span></span>
                ))
              }
            </div>
            <div style={{ marginTop: '4px' }}><span style={{ color: tc.surface2 }}>Body: </span>
              <span style={{ color: tc.green }}>
                {parsed[0].name}({parsed[0].params.map(p => p.name).join(', ')})
              </span>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
          <button
            onClick={onClose}
            style={{ ...BTN }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = tc.surface1)}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = tc.surface0)}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={parsed.length === 0}
            style={{
              ...BTN,
              background: parsed.length > 0 ? `${tc.green}1a` : tc.mantle,
              border: `1px solid ${parsed.length > 0 ? `${tc.green}55` : tc.surface0}`,
              color: parsed.length > 0 ? tc.green : tc.surface1,
              cursor: parsed.length > 0 ? 'pointer' : 'not-allowed',
            }}
            onMouseEnter={e => { if (parsed.length > 0) (e.currentTarget as HTMLButtonElement).style.background = `${tc.green}33`; }}
            onMouseLeave={e => { if (parsed.length > 0) (e.currentTarget as HTMLButtonElement).style.background = `${tc.green}1a`; }}
          >
            Create Node
          </button>
        </div>
      </div>
    </Modal>
  );
}
