import React, { useRef } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';

const TYPE_COLORS: Record<string, string> = {
  float: '#f0a',
  vec2:  '#0af',
  vec3:  '#0fa',
};

// ─── GLSL function/constant palette ──────────────────────────────────────────

interface GlslEntry {
  label:  string;   // shown on button: "sin(float)"
  insert: string;   // appended to expression
  group:  string;
}

const GLSL_PALETTE: GlslEntry[] = [
  // Trig
  { group: 'Trig',        label: 'sin(float)',              insert: 'sin()'             },
  { group: 'Trig',        label: 'cos(float)',              insert: 'cos()'             },
  { group: 'Trig',        label: 'tan(float)',              insert: 'tan()'             },
  { group: 'Trig',        label: 'asin(float)',             insert: 'asin()'            },
  { group: 'Trig',        label: 'acos(float)',             insert: 'acos()'            },
  { group: 'Trig',        label: 'atan(float,float)',       insert: 'atan(, )'          },
  // Exponential
  { group: 'Exp/Log',     label: 'exp(float)',              insert: 'exp()'             },
  { group: 'Exp/Log',     label: 'log(float)',              insert: 'log()'             },
  { group: 'Exp/Log',     label: 'sqrt(float)',             insert: 'sqrt()'            },
  { group: 'Exp/Log',     label: 'pow(float,float)',        insert: 'pow(, )'           },
  // Rounding
  { group: 'Rounding',    label: 'floor(float)',            insert: 'floor()'           },
  { group: 'Rounding',    label: 'ceil(float)',             insert: 'ceil()'            },
  { group: 'Rounding',    label: 'round(float)',            insert: 'round()'           },
  { group: 'Rounding',    label: 'fract(float)',            insert: 'fract()'           },
  // Math
  { group: 'Math',        label: 'abs(float)',              insert: 'abs()'             },
  { group: 'Math',        label: 'sign(float)',             insert: 'sign()'            },
  { group: 'Math',        label: 'mod(float,float)',        insert: 'mod(, )'           },
  { group: 'Math',        label: 'min(float,float)',        insert: 'min(, )'           },
  { group: 'Math',        label: 'max(float,float)',        insert: 'max(, )'           },
  { group: 'Math',        label: 'clamp(f,f,f)',            insert: 'clamp(, , )'       },
  { group: 'Math',        label: 'mix(f,f,f)',              insert: 'mix(, , )'         },
  { group: 'Math',        label: 'smoothstep(f,f,f)',       insert: 'smoothstep(, , )'  },
  // Vector
  { group: 'Vector',      label: 'length(vec2)',            insert: 'length()'          },
  { group: 'Vector',      label: 'normalize(vec2)',         insert: 'normalize()'       },
  { group: 'Vector',      label: 'dot(vec2,vec2)',          insert: 'dot(, )'           },
  { group: 'Vector',      label: 'vec2(f,f)',               insert: 'vec2(, )'          },
  { group: 'Vector',      label: 'vec3(f,f,f)',             insert: 'vec3(, , )'        },
  // Custom helpers
  { group: 'Custom',      label: 'palette(f,v3,v3,v3,v3)', insert: 'palette(, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0,0.33,0.67))' },
  { group: 'Custom',      label: 'rotate(vec2,float)',      insert: 'rotate(, )'        },
  // SDF
  { group: 'SDF',         label: 'sdBox(vec2,vec2)',        insert: 'sdBox(, )'         },
  { group: 'SDF',         label: 'sdSegment(v2,v2,v2)',     insert: 'sdSegment(, , )'   },
  { group: 'SDF',         label: 'sdEllipse(vec2,vec2)',    insert: 'sdEllipse(, )'     },
  { group: 'SDF',         label: 'opRepeat(vec2,f)',        insert: 'opRepeat(, )'      },
  { group: 'SDF',         label: 'opRepeatPolar(vec2,f)',   insert: 'opRepeatPolar(, )' },
  // Constants
  { group: 'Constants',   label: 'PI',                      insert: 'PI'                },
  { group: 'Constants',   label: 'TAU',                     insert: 'TAU'               },
  { group: 'Constants',   label: 'u_time',                  insert: 'u_time'            },
];

// ─── Preset expressions ───────────────────────────────────────────────────────

interface ExprPreset {
  label: string;
  outputType: string;
  inputNames: string[];  // names for in0..in3, unused slots reset to default
  expr: string;
}

const EXPR_PRESETS: ExprPreset[] = [
  { label: 'Circle Orbit',  outputType: 'vec2',  inputNames: ['t', 'r'],     expr: 'vec2(cos(t), sin(t)) * r' },
  { label: 'Oscillate X',   outputType: 'float', inputNames: ['t', 'amp'],   expr: 'cos(t) * amp' },
  { label: 'Oscillate XY',  outputType: 'vec2',  inputNames: ['t', 'amp'],   expr: 'vec2(cos(t), sin(t * 0.7)) * amp' },
  { label: 'Ping Pong',     outputType: 'float', inputNames: ['t', 'speed'], expr: 'abs(fract(t * speed) * 2.0 - 1.0)' },
  { label: 'Rotate UV',     outputType: 'vec2',  inputNames: ['uv', 't'],    expr: 'rotate(uv, t)' },
  { label: 'Scroll UV',     outputType: 'vec2',  inputNames: ['uv', 'speed', 't'], expr: 'uv + vec2(t * speed, 0.0)' },
  { label: 'Zoom UV',       outputType: 'vec2',  inputNames: ['uv', 'zoom'], expr: '(uv - vec2(0.5)) * zoom + vec2(0.5)' },
  { label: 'Pulse',         outputType: 'float', inputNames: ['t', 'freq'],  expr: 'smoothstep(0.4, 0.5, sin(t * freq) * 0.5 + 0.5)' },
  { label: 'IQ Palette',    outputType: 'vec3',  inputNames: ['t', 'shift'], expr: 'palette(t + shift, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0,0.33,0.67))' },
  { label: 'Ripple',        outputType: 'float', inputNames: ['d', 't'],     expr: 'sin(d * 10.0 - t * 3.0) * 0.5 + 0.5' },
];

// Group entries
const GROUPS = Array.from(new Set(GLSL_PALETTE.map(e => e.group)));

// ─── Operators ────────────────────────────────────────────────────────────────

const OPERATORS = ['+', '-', '*', '/', '()', '.', ',', '^'];

// ─── ExprModal ────────────────────────────────────────────────────────────────

interface Props {
  node: GraphNode;
  onClose: () => void;
}

const BTN: React.CSSProperties = {
  background: '#313244',
  border: '1px solid #45475a',
  color: '#cdd6f4',
  borderRadius: '4px',
  padding: '3px 8px',
  fontSize: '11px',
  fontFamily: 'monospace',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#585b70',
  margin: '10px 0 4px',
};

export function ExprModal({ node, onClose }: Props) {
  const { updateNodeParams, disconnectInput } = useNodeGraphStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const expr       = typeof node.params.expr === 'string' ? node.params.expr : '';
  const outputType = typeof node.params.outputType === 'string' ? node.params.outputType : 'float';

  // Apply a preset — sets expr, outputType, and all input slot names at once
  const applyPreset = (preset: ExprPreset) => {
    const slotDefaults = ['in0', 'in1', 'in2', 'in3'];
    updateNodeParams(node.id, {
      expr: preset.expr,
      outputType: preset.outputType,
      in0Name: preset.inputNames[0] ?? slotDefaults[0],
      in1Name: preset.inputNames[1] ?? slotDefaults[1],
      in2Name: preset.inputNames[2] ?? slotDefaults[2],
      in3Name: preset.inputNames[3] ?? slotDefaults[3],
    });
  };

  // Insert text at cursor position in textarea, falling back to append
  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      updateNodeParams(node.id, { expr: expr + text });
      return;
    }
    const start = ta.selectionStart ?? expr.length;
    const end   = ta.selectionEnd   ?? expr.length;
    const newExpr = expr.slice(0, start) + text + expr.slice(end);
    updateNodeParams(node.id, { expr: newExpr });
    // Restore focus + cursor after React re-render
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + text.length, start + text.length);
    });
  };

  return (
    // Backdrop
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div
        style={{
          background: '#1e1e2e',
          border: '1px solid #45475a',
          borderRadius: '10px',
          width: '680px',
          maxHeight: '85vh',
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
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#89b4fa' }}>Expr Editor</span>
          <button
            onClick={onClose}
            style={{ ...BTN, background: 'none', border: 'none', color: '#f38ba8', fontSize: '16px', padding: '0 4px' }}
          >
            ✕
          </button>
        </div>

        {/* Presets */}
        <div style={{ ...(SECTION_LABEL as React.CSSProperties), color: '#94e2d5' }}>Presets</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
          {EXPR_PRESETS.map(preset => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              title={`${preset.outputType}: ${preset.expr}`}
              style={{
                ...BTN,
                color: '#94e2d5',
                borderColor: '#94e2d533',
                background: '#1e3a3a',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#2a4a4a'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1e3a3a'; }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Inputs */}
        <div style={SECTION_LABEL as React.CSSProperties}>Inputs</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
          {[0, 1, 2, 3].map(i => {
            const slotKey     = `in${i}`;
            const nameKey     = `in${i}Name`;
            const input       = node.inputs[slotKey];
            const isConnected = !!input?.connection;
            const name        = typeof node.params[nameKey] === 'string' ? (node.params[nameKey] as string) : slotKey;
            return (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  background: '#181825', border: '1px solid #313244',
                  borderRadius: '5px', padding: '4px 8px',
                }}
              >
                <div
                  style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: isConnected ? (TYPE_COLORS[input?.type ?? 'float'] || '#888') : '#444',
                    border: `2px solid ${TYPE_COLORS[input?.type ?? 'float'] || '#888'}`,
                    cursor: isConnected ? 'pointer' : 'default', flexShrink: 0,
                  }}
                  title={isConnected ? 'Click to disconnect' : 'Not wired'}
                  onClick={() => { if (isConnected) disconnectInput(node.id, slotKey); }}
                />
                <input
                  type="text"
                  value={name}
                  onChange={e => updateNodeParams(node.id, { [nameKey]: e.target.value })}
                  spellCheck={false}
                  style={{
                    background: 'transparent', border: 'none',
                    borderBottom: '1px solid #313244',
                    color: '#cdd6f4', fontSize: '11px', fontFamily: 'monospace',
                    outline: 'none', width: '60px', padding: '0 2px',
                  }}
                />
                <span style={{ fontSize: '10px', color: '#585b70' }}>{input?.type ?? 'float'}</span>
                <button
                  onClick={() => insertAtCursor(name)}
                  title={`Insert "${name}" into expression`}
                  style={{ ...BTN, padding: '1px 5px', fontSize: '10px', background: '#313244' }}
                >
                  ↵
                </button>
              </div>
            );
          })}
        </div>

        {/* Output type */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ color: '#6c7086', fontSize: '11px' }}>Output type</span>
          <select
            value={outputType}
            onChange={e => updateNodeParams(node.id, { outputType: e.target.value })}
            style={{
              background: '#181825', border: '1px solid #45475a',
              color: '#cdd6f4', borderRadius: '3px',
              fontSize: '11px', padding: '2px 6px', outline: 'none', cursor: 'pointer',
            }}
          >
            {['float', 'vec2', 'vec3'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Expression textarea */}
        <div style={SECTION_LABEL as React.CSSProperties}>Expression</div>
        <textarea
          ref={textareaRef}
          value={expr}
          onChange={e => updateNodeParams(node.id, { expr: e.target.value })}
          spellCheck={false}
          rows={4}
          style={{
            background: '#11111b', border: '1px solid #45475a',
            color: '#a6e3a1', padding: '8px 10px',
            borderRadius: '5px', fontSize: '12px', fontFamily: 'monospace',
            width: '100%', resize: 'vertical', outline: 'none',
            boxSizing: 'border-box', lineHeight: 1.5,
          }}
        />

        {/* Operators */}
        <div style={SECTION_LABEL as React.CSSProperties}>Operators</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
          {OPERATORS.map(op => (
            <button
              key={op}
              onClick={() => insertAtCursor(op === '()' ? '()' : ` ${op} `)}
              style={{ ...BTN, padding: '3px 10px' }}
            >
              {op}
            </button>
          ))}
        </div>

        {/* Function groups */}
        {GROUPS.map(group => (
          <div key={group}>
            <div style={SECTION_LABEL as React.CSSProperties}>{group}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
              {GLSL_PALETTE.filter(e => e.group === group).map(entry => (
                <button
                  key={entry.label}
                  onClick={() => insertAtCursor(entry.insert)}
                  title={`Insert: ${entry.insert}`}
                  style={{ ...BTN }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
