import React, { useRef, useState } from 'react';
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

// Presets specifically for FloatWarp — float-only, use value/a/b/c socket names only
interface FloatWarpPreset {
  label: string;
  expr:  string;
  hint?: string;
}
const FLOAT_WARP_PRESETS: FloatWarpPreset[] = [
  { label: 'Sine',         expr: 'sin(value)',                                   hint: 'Oscillate' },
  { label: 'Abs Sine',     expr: 'abs(sin(value))',                              hint: 'Always positive bounce' },
  { label: 'Ping-Pong',    expr: 'abs(fract(value * a) * 2.0 - 1.0)',           hint: 'a = speed' },
  { label: 'Slow Down',    expr: 'value * a',                                    hint: 'a = scale (try 0.25)' },
  { label: 'Ease In-Out',  expr: 'smoothstep(0.0, 1.0, fract(value * a))',      hint: 'a = cycles/sec' },
  { label: 'Step',         expr: 'floor(value * a) / a',                        hint: 'a = steps' },
  { label: 'Sawtooth',     expr: 'fract(value * a)',                             hint: 'a = freq' },
  { label: 'Square Wave',  expr: 'step(0.5, fract(value * a))',                 hint: 'a = freq' },
  { label: 'Exponential',  expr: 'pow(max(value, 0.0), a)',                     hint: 'a = exponent' },
  { label: 'Ripple',       expr: 'sin(value * a - b * 3.0) * 0.5 + 0.5',       hint: 'a = freq, b = time' },
  { label: 'Remap',        expr: 'value * (b - a) + a',                         hint: 'remap [0,1] → [a,b]' },
  { label: 'Clamp',        expr: 'clamp(value, a, b)',                          hint: 'clamp to [a,b]' },
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [autoWrap, setAutoWrap] = useState(false);

  // FloatWarp has fixed socket names (value, a, b, c) — skip the in0–in3 UI
  const isFloatWarp = node.type === 'floatWarp';
  const expr        = typeof node.params.expr === 'string' ? node.params.expr : '';
  const outputType  = typeof node.params.outputType === 'string' ? node.params.outputType : 'float';

  // ── Undo / Redo history ────────────────────────────────────────────────────
  // Stored as a ref so mutations don't cause re-renders; we only re-render when
  // the index changes (which drives button disabled state).
  const history      = useRef<string[]>([expr]);
  const historyIndex = useRef<number>(0);
  const [historyPos, setHistoryPos] = useState(0); // mirrors historyIndex for react state

  // Push a new snapshot — call this every time expr changes from a button/preset.
  // Typing in the textarea is handled separately (on blur / debounced).
  const pushHistory = (newExpr: string) => {
    // Drop any redo-future when a new change is made
    const trimmed = history.current.slice(0, historyIndex.current + 1);
    trimmed.push(newExpr);
    history.current    = trimmed;
    historyIndex.current = trimmed.length - 1;
    setHistoryPos(historyIndex.current);
  };

  const commitExpr = (newExpr: string) => {
    updateNodeParams(node.id, { expr: newExpr });
    pushHistory(newExpr);
  };

  const undo = () => {
    if (historyIndex.current <= 0) return;
    historyIndex.current -= 1;
    setHistoryPos(historyIndex.current);
    updateNodeParams(node.id, { expr: history.current[historyIndex.current] });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const redo = () => {
    if (historyIndex.current >= history.current.length - 1) return;
    historyIndex.current += 1;
    setHistoryPos(historyIndex.current);
    updateNodeParams(node.id, { expr: history.current[historyIndex.current] });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const canUndo = historyPos > 0;
  const canRedo = historyPos < history.current.length - 1;

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
    pushHistory(preset.expr);
  };

  // Apply a FloatWarp preset — only updates expr, socket names are fixed (value/a/b/c)
  const applyFloatWarpPreset = (preset: FloatWarpPreset) => {
    updateNodeParams(node.id, { expr: preset.expr });
    pushHistory(preset.expr);
  };

  // Insert text at cursor — with selection-wrapping and auto-wrap support.
  // • autoWrap ON  + text has "(": wraps the entire current expression as the first arg.
  // • Selection present + text has "(": wraps the selected text as the first arg.
  // • Otherwise: plain insert/replace at cursor (existing behaviour).
  const insertAtCursor = (text: string) => {
    const ta    = textareaRef.current;
    const start = ta?.selectionStart ?? expr.length;
    const end   = ta?.selectionEnd   ?? expr.length;

    const hasParen    = text.includes('(');
    const hasSelection = start !== end;
    const selectedText = hasSelection ? expr.slice(start, end) : '';

    // Helper: put `inner` as the first argument of a function insert like "sin()" or "pow(, )"
    const wrapFirst = (fnInsert: string, inner: string): string => {
      // Find the opening paren and insert `inner` right after it
      const parenIdx = fnInsert.indexOf('(');
      return fnInsert.slice(0, parenIdx + 1) + inner + fnInsert.slice(parenIdx + 1);
    };

    let newExpr: string;
    let cursorPos: number;

    if (autoWrap && hasParen) {
      // Wrap the entire current expression as the first arg
      const wrapped = wrapFirst(text, expr);
      newExpr   = wrapped;
      cursorPos = wrapped.length;
    } else if (hasSelection && hasParen) {
      // Wrap the selected region as the first arg, replace the selection
      const wrapped = wrapFirst(text, selectedText);
      newExpr   = expr.slice(0, start) + wrapped + expr.slice(end);
      cursorPos = start + wrapped.length;
    } else {
      // Plain insert at cursor (original behaviour)
      newExpr   = expr.slice(0, start) + text + expr.slice(end);
      cursorPos = start + text.length;
    }

    commitExpr(newExpr);
    // Restore focus + cursor after React re-render
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(cursorPos, cursorPos);
    });
  };

  // Handle Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z inside the textarea
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (mod && e.key === 'y') {
      e.preventDefault();
      redo();
    }
  };

  // Push a history snapshot when the user finishes typing (on blur)
  const handleTextareaBlur = () => {
    const current = history.current[historyIndex.current];
    if (expr !== current) pushHistory(expr);
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
          {isFloatWarp
            ? FLOAT_WARP_PRESETS.map(preset => (
                <button
                  key={preset.label}
                  onClick={() => applyFloatWarpPreset(preset)}
                  title={preset.hint ? `${preset.hint} — ${preset.expr}` : preset.expr}
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
              ))
            : EXPR_PRESETS.map(preset => (
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
              ))
          }
        </div>

        {/* Inputs */}
        <div style={SECTION_LABEL as React.CSSProperties}>Inputs</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
          {isFloatWarp
            // FloatWarp: fixed named sockets — show them as insert buttons with connection status
            // 'intensity' is shown but not insertable (it's a blend knob, not part of the expr)
            ? (['value', 'a', 'b', 'c', 'intensity'] as const).map(name => {
                const input          = node.inputs[name];
                const isConnected    = !!input?.connection;
                const isIntensity    = name === 'intensity';
                return (
                  <div
                    key={name}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      background: '#181825', border: '1px solid #313244',
                      borderRadius: '5px', padding: '4px 8px',
                      opacity: isIntensity ? 0.7 : 1,
                    }}
                  >
                    <div
                      style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: isConnected ? '#f0a' : '#444',
                        border: '2px solid #f0a',
                        cursor: isConnected ? 'pointer' : 'default', flexShrink: 0,
                      }}
                      title={isConnected ? 'Click to disconnect' : 'Not wired'}
                      onClick={() => { if (isConnected) disconnectInput(node.id, name); }}
                    />
                    <span style={{ color: '#cdd6f4', fontSize: '11px', fontFamily: 'monospace' }}>{name}</span>
                    <span style={{ fontSize: '10px', color: '#585b70' }}>float</span>
                    {isIntensity
                      ? <span style={{ fontSize: '10px', color: '#585b70', fontStyle: 'italic' }}>blend knob</span>
                      : (
                        <button
                          onClick={() => insertAtCursor(name)}
                          title={`Insert "${name}" into expression`}
                          style={{ ...BTN, padding: '1px 5px', fontSize: '10px', background: '#313244' }}
                        >
                          ↵
                        </button>
                      )
                    }
                  </div>
                );
              })
            // Expr node: in0–in3 with editable names
            : [0, 1, 2, 3].map(i => {
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
              })
          }
        </div>

        {/* Output type — hidden for FloatWarp (always float) */}
        {!isFloatWarp && (
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
        )}

        {/* Expression textarea */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', marginBottom: '4px', flexWrap: 'wrap' }}>
          <span style={{ ...(SECTION_LABEL as React.CSSProperties), margin: 0 }}>Expression</span>

          {/* Undo */}
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Cmd/Ctrl+Z)"
            style={{
              ...BTN,
              padding: '2px 7px',
              fontSize: '12px',
              opacity: canUndo ? 1 : 0.35,
              cursor: canUndo ? 'pointer' : 'default',
            }}
          >
            ↩
          </button>

          {/* Redo */}
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Cmd/Ctrl+Shift+Z)"
            style={{
              ...BTN,
              padding: '2px 7px',
              fontSize: '12px',
              opacity: canRedo ? 1 : 0.35,
              cursor: canRedo ? 'pointer' : 'default',
            }}
          >
            ↪
          </button>

          {/* Auto-wrap toggle */}
          <button
            onClick={() => setAutoWrap(v => !v)}
            title={autoWrap
              ? 'Auto-wrap ON — clicking a function wraps the entire expression as its first argument. Click to toggle off.'
              : 'Auto-wrap OFF — clicking a function while text is selected wraps just the selection. Click to toggle on.'}
            style={{
              ...BTN,
              padding: '2px 8px',
              fontSize: '10px',
              background: autoWrap ? '#45475a' : '#313244',
              color: autoWrap ? '#cba6f7' : '#585b70',
              border: `1px solid ${autoWrap ? '#cba6f7' : '#45475a'}`,
              transition: 'all 0.15s',
            }}
          >
            ⊂ auto-wrap {autoWrap ? 'ON' : 'OFF'}
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={expr}
          onChange={e => updateNodeParams(node.id, { expr: e.target.value })}
          onBlur={handleTextareaBlur}
          onKeyDown={handleTextareaKeyDown}
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
