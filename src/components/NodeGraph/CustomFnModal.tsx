import React, { useRef } from 'react';
import type { GraphNode, DataType } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';

// ─── GLSL function palette (same entries as ExprModal) ───────────────────────

interface GlslEntry { label: string; insert: string; group: string; }

const GLSL_PALETTE: GlslEntry[] = [
  { group: 'Trig',      label: 'sin(float)',        insert: 'sin()'               },
  { group: 'Trig',      label: 'cos(float)',        insert: 'cos()'               },
  { group: 'Trig',      label: 'tan(float)',        insert: 'tan()'               },
  { group: 'Trig',      label: 'atan(float,float)', insert: 'atan(, )'            },
  { group: 'Exp/Log',   label: 'exp(float)',        insert: 'exp()'               },
  { group: 'Exp/Log',   label: 'sqrt(float)',       insert: 'sqrt()'              },
  { group: 'Exp/Log',   label: 'pow(float,float)',  insert: 'pow(, )'             },
  { group: 'Rounding',  label: 'floor(float)',      insert: 'floor()'             },
  { group: 'Rounding',  label: 'ceil(float)',       insert: 'ceil()'              },
  { group: 'Rounding',  label: 'fract(float)',      insert: 'fract()'             },
  { group: 'Math',      label: 'abs(float)',        insert: 'abs()'               },
  { group: 'Math',      label: 'mod(float,float)',  insert: 'mod(, )'             },
  { group: 'Math',      label: 'min(float,float)',  insert: 'min(, )'             },
  { group: 'Math',      label: 'max(float,float)',  insert: 'max(, )'             },
  { group: 'Math',      label: 'clamp(f,f,f)',      insert: 'clamp(, , )'         },
  { group: 'Math',      label: 'mix(f,f,f)',        insert: 'mix(, , )'           },
  { group: 'Math',      label: 'smoothstep(f,f,f)', insert: 'smoothstep(, , )'    },
  { group: 'Vector',    label: 'length(vec2)',      insert: 'length()'            },
  { group: 'Vector',    label: 'normalize(vec2)',   insert: 'normalize()'         },
  { group: 'Vector',    label: 'dot(vec2,vec2)',    insert: 'dot(, )'             },
  { group: 'Vector',    label: 'vec2(f,f)',         insert: 'vec2(, )'            },
  { group: 'Vector',    label: 'vec3(f,f,f)',       insert: 'vec3(, , )'          },
  { group: 'Custom',    label: 'palette(f,v3×4)',   insert: 'palette(, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0,0.33,0.67))' },
  { group: 'Custom',    label: 'rotate(vec2,float)',insert: 'rotate(, )'          },
  { group: 'SDF',       label: 'sdBox(vec2,vec2)',     insert: 'sdBox(, )'         },
  { group: 'SDF',       label: 'sdSegment(v2,v2,v2)', insert: 'sdSegment(, , )'   },
  { group: 'SDF',       label: 'sdEllipse(vec2,vec2)', insert: 'sdEllipse(, )'    },
  { group: 'SDF',       label: 'opRepeat(vec2,f)',     insert: 'opRepeat(, )'     },
  { group: 'SDF',       label: 'opRepeatPolar(vec2,f)', insert: 'opRepeatPolar(, )' },
  { group: 'Constants', label: 'PI',               insert: 'PI'                  },
  { group: 'Constants', label: 'TAU',              insert: 'TAU'                 },
  { group: 'Constants', label: 'u_time',           insert: 'u_time'              },
];

const GROUPS = Array.from(new Set(GLSL_PALETTE.map(e => e.group)));
const TYPE_OPTIONS: DataType[] = ['float', 'vec2', 'vec3', 'vec4'];

// ─── Styles ───────────────────────────────────────────────────────────────────

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

// ─── CustomFnModal ────────────────────────────────────────────────────────────

interface Props {
  node: GraphNode;
  onClose: () => void;
}

export function CustomFnModal({ node, onClose }: Props) {
  const { updateNodeParams, updateNodeSockets } = useNodeGraphStore();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fnRef   = useRef<HTMLTextAreaElement>(null);

  // Read current params
  const customInputs = (node.params.inputs as Array<{ name: string; type: DataType }>) || [];
  const outputType   = (node.params.outputType as DataType) || 'float';
  const body         = typeof node.params.body === 'string' ? node.params.body : '0.0';
  const glslFns      = typeof node.params.glslFunctions === 'string' ? node.params.glslFunctions : '';
  const labelParam   = typeof node.params.label === 'string' ? node.params.label : 'Custom Fn';

  // Insert text at textarea cursor
  const insertAtCursor = (ref: React.RefObject<HTMLTextAreaElement>, current: string, paramKey: string, text: string) => {
    const ta = ref.current;
    if (!ta) {
      updateNodeParams(node.id, { [paramKey]: current + text });
      return;
    }
    const start = ta.selectionStart ?? current.length;
    const end   = ta.selectionEnd   ?? current.length;
    const next  = current.slice(0, start) + text + current.slice(end);
    updateNodeParams(node.id, { [paramKey]: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + text.length, start + text.length);
    });
  };

  // ── Inputs management ─────────────────────────────────────────────────────

  const addInput = () => {
    const newName = `in${customInputs.length}`;
    const next = [...customInputs, { name: newName, type: 'float' as DataType }];
    updateNodeParams(node.id, { inputs: next });
    updateNodeSockets(node.id, next, outputType);
  };

  const removeInput = (idx: number) => {
    const next = customInputs.filter((_, i) => i !== idx);
    updateNodeParams(node.id, { inputs: next });
    updateNodeSockets(node.id, next, outputType);
  };

  const updateInputName = (idx: number, name: string) => {
    const next = customInputs.map((inp, i) => i === idx ? { ...inp, name } : inp);
    updateNodeParams(node.id, { inputs: next });
    updateNodeSockets(node.id, next, outputType);
  };

  const updateInputType = (idx: number, type: DataType) => {
    const next = customInputs.map((inp, i) => i === idx ? { ...inp, type } : inp);
    updateNodeParams(node.id, { inputs: next });
    updateNodeSockets(node.id, next, outputType);
  };

  const changeOutputType = (type: DataType) => {
    updateNodeParams(node.id, { outputType: type });
    updateNodeSockets(node.id, customInputs, type);
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
          width: '700px',
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
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontWeight: 700, fontSize: '14px', color: '#cba6f7' }}>ƒ Custom Function</span>
            <input
              type="text"
              value={labelParam}
              onChange={e => updateNodeParams(node.id, { label: e.target.value })}
              placeholder="Node name"
              spellCheck={false}
              style={{
                background: '#181825',
                border: '1px solid #45475a',
                color: '#cdd6f4',
                borderRadius: '4px',
                fontSize: '12px',
                padding: '3px 8px',
                outline: 'none',
                width: '160px',
              }}
            />
          </div>
          <button
            onClick={onClose}
            style={{ ...BTN, background: 'none', border: 'none', color: '#f38ba8', fontSize: '16px', padding: '0 4px' }}
          >
            ✕
          </button>
        </div>

        {/* Inputs section */}
        <div style={SECTION_LABEL as React.CSSProperties}>Inputs</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
          {customInputs.map((inp, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: '#181825', border: '1px solid #313244',
                borderRadius: '5px', padding: '5px 8px',
              }}
            >
              <span style={{ color: '#585b70', fontSize: '10px', minWidth: '16px' }}>{idx}</span>
              <input
                type="text"
                value={inp.name}
                onChange={e => updateInputName(idx, e.target.value)}
                spellCheck={false}
                placeholder="name"
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid #313244',
                  color: '#cdd6f4',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  outline: 'none',
                  width: '90px',
                  padding: '0 2px',
                }}
              />
              <select
                value={inp.type}
                onChange={e => updateInputType(idx, e.target.value as DataType)}
                style={{
                  background: '#181825',
                  border: '1px solid #45475a',
                  color: '#cdd6f4',
                  borderRadius: '3px',
                  fontSize: '11px',
                  padding: '2px 4px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {/* Insert into body */}
              <button
                onClick={() => insertAtCursor(bodyRef, body, 'body', inp.name)}
                title={`Insert "${inp.name}" into body`}
                style={{ ...BTN, padding: '2px 6px', fontSize: '10px' }}
              >
                ↵
              </button>
              <button
                onClick={() => removeInput(idx)}
                style={{ ...BTN, background: 'none', border: 'none', color: '#f38ba8', padding: '2px 4px', fontSize: '13px', marginLeft: 'auto' }}
                title="Remove input"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={addInput}
            style={{ ...BTN, alignSelf: 'flex-start', marginTop: '4px', color: '#a6e3a1', borderColor: '#a6e3a133' }}
          >
            + Add Input
          </button>
        </div>

        {/* Output type */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ color: '#6c7086', fontSize: '11px' }}>Output type</span>
          <select
            value={outputType}
            onChange={e => changeOutputType(e.target.value as DataType)}
            style={{
              background: '#181825',
              border: '1px solid #45475a',
              color: '#cdd6f4',
              borderRadius: '3px',
              fontSize: '11px',
              padding: '2px 6px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Body textarea */}
        <div style={SECTION_LABEL as React.CSSProperties}>GLSL Body</div>
        <div style={{ fontSize: '10px', color: '#585b70', marginBottom: '4px' }}>
          Use your input names directly. Single expression or multi-line block. The result is assigned to the output.
        </div>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={e => updateNodeParams(node.id, { body: e.target.value })}
          spellCheck={false}
          rows={6}
          style={{
            background: '#11111b',
            border: '1px solid #45475a',
            color: '#a6e3a1',
            padding: '8px 10px',
            borderRadius: '5px',
            fontSize: '12px',
            fontFamily: 'monospace',
            width: '100%',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
            lineHeight: 1.5,
          }}
        />

        {/* Operators */}
        <div style={SECTION_LABEL as React.CSSProperties}>Operators</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
          {['+', '-', '*', '/', '()', '.', ','].map(op => (
            <button
              key={op}
              onClick={() => insertAtCursor(bodyRef, body, 'body', op === '()' ? '()' : ` ${op} `)}
              style={{ ...BTN, padding: '3px 10px' }}
            >
              {op}
            </button>
          ))}
        </div>

        {/* Function palette */}
        {GROUPS.map(group => (
          <div key={group}>
            <div style={SECTION_LABEL as React.CSSProperties}>{group}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
              {GLSL_PALETTE.filter(e => e.group === group).map(entry => (
                <button
                  key={entry.label}
                  onClick={() => insertAtCursor(bodyRef, body, 'body', entry.insert)}
                  title={`Insert: ${entry.insert}`}
                  style={BTN}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Helper GLSL functions */}
        <div style={SECTION_LABEL as React.CSSProperties}>Helper Functions (optional)</div>
        <div style={{ fontSize: '10px', color: '#585b70', marginBottom: '4px' }}>
          Paste external GLSL functions here. They are injected before main() and available in the body above.
        </div>
        <textarea
          ref={fnRef}
          value={glslFns}
          onChange={e => updateNodeParams(node.id, { glslFunctions: e.target.value })}
          spellCheck={false}
          rows={6}
          placeholder={'// e.g.\nfloat sdBox(vec2 p, vec2 b) {\n  vec2 d = abs(p) - b;\n  return length(max(d,0.0)) + min(max(d.x,d.y),0.0);\n}'}
          style={{
            background: '#11111b',
            border: '1px solid #45475a',
            color: '#89b4fa',
            padding: '8px 10px',
            borderRadius: '5px',
            fontSize: '11px',
            fontFamily: 'monospace',
            width: '100%',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
            lineHeight: 1.5,
          }}
        />
      </div>
    </div>
  );
}
