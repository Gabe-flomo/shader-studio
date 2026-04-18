import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { GraphNode, DataType } from '../../types/nodeGraph';
import { useNodeGraphStore, saveExprPreset } from '../../store/useNodeGraphStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InputDef {
  name: string;
  type: DataType;
  slider: { min: number; max: number } | null;
}

interface WarpLine {
  lhs: string;
  op: string;
  rhs: string;
}

const TYPE_OPTIONS: DataType[] = ['float', 'vec2', 'vec3', 'vec4'];
const OPS = ['=', '+=', '-=', '*=', '/='];

// ─── GLSL function palette ────────────────────────────────────────────────────

interface GlslEntry { label: string; insert: string; group: string; }

const GLSL_PALETTE: GlslEntry[] = [
  { group: 'Trig',      label: 'sin(f)',            insert: 'sin()'                },
  { group: 'Trig',      label: 'cos(f)',            insert: 'cos()'                },
  { group: 'Trig',      label: 'atan(f,f)',          insert: 'atan(, )'             },
  { group: 'Exp/Log',   label: 'exp(f)',             insert: 'exp()'                },
  { group: 'Exp/Log',   label: 'sqrt(f)',            insert: 'sqrt()'               },
  { group: 'Exp/Log',   label: 'pow(f,f)',           insert: 'pow(, )'              },
  { group: 'Rounding',  label: 'floor(f)',           insert: 'floor()'              },
  { group: 'Rounding',  label: 'ceil(f)',            insert: 'ceil()'               },
  { group: 'Rounding',  label: 'fract(f)',           insert: 'fract()'              },
  { group: 'Math',      label: 'abs(f)',             insert: 'abs()'                },
  { group: 'Math',      label: 'mod(f,f)',           insert: 'mod(, )'              },
  { group: 'Math',      label: 'min(f,f)',           insert: 'min(, )'              },
  { group: 'Math',      label: 'max(f,f)',           insert: 'max(, )'              },
  { group: 'Math',      label: 'clamp(f,f,f)',       insert: 'clamp(, , )'          },
  { group: 'Math',      label: 'mix(f,f,f)',         insert: 'mix(, , )'            },
  { group: 'Math',      label: 'smoothstep(f,f,f)',  insert: 'smoothstep(, , )'     },
  { group: 'Vector',    label: 'length(v)',          insert: 'length()'             },
  { group: 'Vector',    label: 'normalize(v)',       insert: 'normalize()'          },
  { group: 'Vector',    label: 'dot(v,v)',           insert: 'dot(, )'              },
  { group: 'Vector',    label: 'vec2(f,f)',          insert: 'vec2(, )'             },
  { group: 'Vector',    label: 'vec3(f,f,f)',        insert: 'vec3(, , )'           },
  { group: 'Custom',    label: 'palette(f,v3×4)',    insert: 'palette(, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0,0.33,0.67))' },
  { group: 'Custom',    label: 'rotate(v2,f)',       insert: 'rotate(, )'           },
  { group: 'SDF',       label: 'sdBox(v2,v2)',       insert: 'sdBox(, )'            },
  { group: 'SDF',       label: 'sdSegment(v2,v2,v2)',insert: 'sdSegment(, , )'      },
  { group: 'SDF',       label: 'sdEllipse(v2,v2)',   insert: 'sdEllipse(, )'        },
  { group: 'SDF',       label: 'opRepeat(v2,f)',     insert: 'opRepeat(, )'         },
  { group: 'Constants', label: 'PI',                insert: 'PI'                   },
  { group: 'Constants', label: 'TAU',               insert: 'TAU'                  },
  { group: 'Constants', label: 'u_time',            insert: 'u_time'               },
];

const GLSL_GROUPS = Array.from(new Set(GLSL_PALETTE.map(e => e.group)));

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
  textTransform: 'uppercase' as const,
  color: '#585b70',
  margin: '10px 0 4px',
};

const INPUT_STYLE: React.CSSProperties = {
  background: '#11111b',
  border: '1px solid #45475a',
  color: '#cdd6f4',
  borderRadius: '4px',
  padding: '3px 7px',
  fontSize: '11px',
  fontFamily: 'monospace',
  outline: 'none',
};

// ─── ExprBlockModal ───────────────────────────────────────────────────────────

interface Props {
  node: GraphNode;
  onClose: () => void;
}

type Snapshot = { lines: WarpLine[]; result: string };

export function ExprBlockModal({ node, onClose }: Props) {
  const { updateNodeParams, updateNodeSockets } = useNodeGraphStore();

  // Read current params
  const customInputs: InputDef[] = (node.params.inputs as InputDef[] | undefined) ?? [];
  const lines: WarpLine[]        = (node.params.lines as WarpLine[] | undefined) ?? [];
  const result: string           = (node.params.result as string | undefined) ?? 'p';
  const outputType: DataType     = (node.params.outputType as DataType | undefined) ?? 'vec3';

  const [savedFlash, setSavedFlash] = useState(false);
  const [autoWrap, setAutoWrap]     = useState(false);

  // ── Undo / Redo ──────────────────────────────────────────────────────────────
  const history      = useRef<Snapshot[]>([{ lines, result }]);
  const historyIndex = useRef(0);
  const [historyPos, setHistoryPos] = useState(0);

  const pushHistory = (snap: Snapshot) => {
    const trimmed = history.current.slice(0, historyIndex.current + 1);
    trimmed.push(snap);
    history.current      = trimmed;
    historyIndex.current = trimmed.length - 1;
    setHistoryPos(historyIndex.current);
  };

  const undo = () => {
    if (historyIndex.current <= 0) return;
    historyIndex.current -= 1;
    setHistoryPos(historyIndex.current);
    const snap = history.current[historyIndex.current];
    updateNodeParams(node.id, { lines: snap.lines, result: snap.result });
  };

  const redo = () => {
    if (historyIndex.current >= history.current.length - 1) return;
    historyIndex.current += 1;
    setHistoryPos(historyIndex.current);
    const snap = history.current[historyIndex.current];
    updateNodeParams(node.id, { lines: snap.lines, result: snap.result });
  };

  const canUndo = historyPos > 0;
  const canRedo = historyPos < history.current.length - 1;

  // Track the last-focused expression input so GLSL function buttons can insert there
  const lastFocusedRef    = useRef<HTMLInputElement | null>(null);
  const lastFocusedSetter = useRef<((val: string) => void) | null>(null);
  const lastFocusedValue  = useRef<string>('');
  const lastFocusedSnapFn = useRef<((newVal: string) => Snapshot) | null>(null);

  // Available variables collapse state
  const [varsExpanded, setVarsExpanded]   = useState(false);
  const varsChipsRef                       = useRef<HTMLDivElement>(null);
  const [hiddenVarsCount, setHiddenVarsCount] = useState(0);

  // Measure which chips wrap to a second line.
  // Use .length + varsExpanded as deps — NOT the full array ref, because
  // customInputs is `?? []` which creates a new reference each render and
  // would cause the effect to re-run on every render, potentially looping.
  useLayoutEffect(() => {
    const container = varsChipsRef.current;
    if (!container) return;
    const chips = Array.from(container.children) as HTMLElement[];
    if (chips.length === 0) { setHiddenVarsCount(0); return; }
    const firstTop = chips[0].offsetTop;
    const hidden = chips.filter(c => c.offsetTop > firstTop).length;
    setHiddenVarsCount(hidden);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customInputs.length, varsExpanded]);

  const flash = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 800);
  };

  // ── Input management ───────────────────────────────────────────────────────

  const addInput = () => {
    const newName = `in${customInputs.length}`;
    const next: InputDef[] = [...customInputs, { name: newName, type: 'float', slider: null }];
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
    const next = customInputs.map((inp, i) =>
      i === idx ? { ...inp, type, slider: type !== 'float' ? null : inp.slider } : inp
    );
    updateNodeParams(node.id, { inputs: next });
    updateNodeSockets(node.id, next, outputType);
  };

  const toggleSlider = (idx: number) => {
    const inp = customInputs[idx];
    const newSlider = inp.slider ? null : { min: 0, max: 1 };
    const extraParams: Record<string, unknown> = {};
    if (newSlider && typeof node.params[inp.name] !== 'number') {
      extraParams[inp.name] = 0.5;
    }
    const next = customInputs.map((c, i) => i === idx ? { ...c, slider: newSlider } : c);
    updateNodeParams(node.id, { inputs: next, ...extraParams });
    updateNodeSockets(node.id, next, outputType);
  };

  const updateSliderRange = (idx: number, field: 'min' | 'max', raw: string) => {
    const val = parseFloat(raw);
    if (isNaN(val)) return;
    const inp = customInputs[idx];
    const oldSlider = inp.slider ?? { min: 0, max: 1 };
    const newSlider = { ...oldSlider, [field]: val };
    const next = customInputs.map((c, i) => i === idx ? { ...c, slider: newSlider } : c);
    updateNodeParams(node.id, { inputs: next });
    updateNodeSockets(node.id, next, outputType);
  };

  const changeOutputType = (type: DataType) => {
    updateNodeParams(node.id, { outputType: type });
    updateNodeSockets(node.id, customInputs, type);
  };

  // ── Lines management ───────────────────────────────────────────────────────

  const addLine = () => {
    const next: WarpLine[] = [...lines, { lhs: 'p', op: '=', rhs: '' }];
    updateNodeParams(node.id, { lines: next });
  };

  const removeLine = (idx: number) => {
    updateNodeParams(node.id, { lines: lines.filter((_, i) => i !== idx) });
  };

  const updateLine = (idx: number, field: keyof WarpLine, value: string) => {
    const next = lines.map((l, i) => i === idx ? { ...l, [field]: value } : l);
    updateNodeParams(node.id, { lines: next });
  };

  const updateResult = (val: string) => {
    updateNodeParams(node.id, { result: val });
  };

  const handleSavePreset = () => {
    saveExprPreset({
      label:      typeof node.params.label === 'string' && node.params.label.trim() ? node.params.label.trim() : 'Expr Block',
      inputs:     customInputs,
      outputType,
      lines,
      result,
    });
    flash();
  };

  // ── Migrate from old fixed inputs ─────────────────────────────────────────

  const migrateFromNodeInputs = () => {
    const migrated: InputDef[] = Object.entries(node.inputs).map(([key, inp]) => ({
      name: key,
      type: inp.type as DataType,
      slider: null,
    }));
    updateNodeParams(node.id, { inputs: migrated });
    updateNodeSockets(node.id, migrated, outputType);
    flash();
  };

  // Auto-import existing sockets into params.inputs when the modal first opens
  // and params.inputs is empty (e.g. legacy nodes or newly wired nodes).
  useEffect(() => {
    if (customInputs.length === 0 && Object.keys(node.inputs).length > 0) {
      migrateFromNodeInputs();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── GLSL function insert at focused expression input ───────────────────────

  const insertAtFocused = (text: string) => {
    const el     = lastFocusedRef.current;
    const setter = lastFocusedSetter.current;
    if (!el || !setter) return;

    const current  = lastFocusedValue.current;
    const start    = el.selectionStart ?? current.length;
    const end      = el.selectionEnd   ?? current.length;
    const hasParen = text.includes('(');
    let next: string;
    let cursor: number;

    if (autoWrap && hasParen) {
      const parenIdx = text.indexOf('(');
      const wrapped  = text.slice(0, parenIdx + 1) + current + text.slice(parenIdx + 1);
      next   = wrapped;
      cursor = wrapped.length;
    } else if (hasParen) {
      const parenIdx = text.indexOf('(');
      const selected = current.slice(start, end);
      if (selected) {
        const wrapped = text.slice(0, parenIdx + 1) + selected + text.slice(parenIdx + 1);
        next   = current.slice(0, start) + wrapped + current.slice(end);
        cursor = start + wrapped.length;
      } else {
        next       = current.slice(0, start) + text + current.slice(end);
        const emptyParen = text.indexOf('()');
        cursor     = start + (emptyParen >= 0 ? emptyParen + 1 : text.length);
      }
    } else {
      next   = current.slice(0, start) + text + current.slice(end);
      cursor = start + text.length;
    }

    setter(next);
    lastFocusedValue.current = next;
    if (lastFocusedSnapFn.current) pushHistory(lastFocusedSnapFn.current(next));

    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  /** Push a history snapshot when the user finishes typing in any field. */
  const handleAnyBlur = () => {
    const currentLines  = (node.params.lines  as WarpLine[] | undefined) ?? [];
    const currentResult = (node.params.result as string     | undefined) ?? 'p';
    const last = history.current[historyIndex.current];
    if (JSON.stringify(last.lines) !== JSON.stringify(currentLines) || last.result !== currentResult) {
      pushHistory({ lines: currentLines, result: currentResult });
    }
  };

  const handleAnyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && e.key === 'y') { e.preventDefault(); redo(); }
  };

  /** Register a text input so it becomes the insertion target for GLSL buttons. */
  const makeExprInputProps = (
    currentValue: string,
    setter: (v: string) => void,
    snapFn: (newVal: string) => Snapshot,
  ) => ({
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      lastFocusedRef.current    = e.currentTarget;
      lastFocusedSetter.current = setter;
      lastFocusedValue.current  = currentValue;
      lastFocusedSnapFn.current = snapFn;
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      lastFocusedValue.current = e.target.value;
      setter(e.target.value);
    },
    onBlur:    handleAnyBlur,
    onKeyDown: handleAnyKeyDown,
  });

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)',
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
          width: 'min(820px, calc(100vw - 32px))',
          maxHeight: '88vh',
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '0',
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
          color: '#cdd6f4',
          fontSize: '12px',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#a6e3a1' }}>⟴ Expr Block</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {savedFlash && (
              <span style={{ fontSize: '11px', color: '#a6e3a1', fontFamily: 'monospace' }}>✓ saved</span>
            )}
            <button
              onClick={handleSavePreset}
              title="Save as a reusable preset in the palette"
              style={{ ...BTN, color: '#a6e3a1', borderColor: '#a6e3a155', background: '#a6e3a111' }}
            >
              ↑ Save Preset
            </button>
            <button onClick={onClose} style={{ ...BTN, color: '#f38ba8', borderColor: '#f38ba855' }}>✕ Close</button>
          </div>
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>

          {/* ── Left: Inputs ─────────────────────────────────────────────── */}
          <div style={{ width: '230px', flexShrink: 0 }}>
            <p style={SECTION_LABEL}>Inputs</p>
            <p style={{ fontSize: '10px', color: '#45475a', marginBottom: '8px', lineHeight: 1.4 }}>
              Each input becomes a local variable in the warp. Float inputs can have sliders.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {customInputs.map((inp, idx) => (
                <div
                  key={idx}
                  style={{
                    background: '#181825',
                    border: '1px solid #313244',
                    borderRadius: '6px',
                    padding: '6px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  {/* Name + Type + Delete row */}
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={inp.name}
                      onChange={e => updateInputName(idx, e.target.value)}
                      placeholder="name"
                      style={{ ...INPUT_STYLE, flex: 1, minWidth: 0 }}
                    />
                    <select
                      value={inp.type}
                      onChange={e => updateInputType(idx, e.target.value as DataType)}
                      style={{ ...INPUT_STYLE, color: '#89b4fa', cursor: 'pointer', padding: '3px 4px' }}
                    >
                      {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button
                      onClick={() => removeInput(idx)}
                      style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', padding: '0 2px', fontSize: '13px', lineHeight: 1 }}
                      title="Remove input"
                    >×</button>
                  </div>

                  {/* Slider toggle (float only) */}
                  {inp.type === 'float' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '10px', color: inp.slider ? '#a6e3a1' : '#585b70' }}>
                        <input
                          type="checkbox"
                          checked={!!inp.slider}
                          onChange={() => toggleSlider(idx)}
                          style={{ accentColor: '#a6e3a1', cursor: 'pointer' }}
                        />
                        slider
                      </label>
                      {inp.slider && (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: '#6c7086' }}>
                            <span>min</span>
                            <input
                              type="number"
                              value={inp.slider.min}
                              step={0.1}
                              onChange={e => updateSliderRange(idx, 'min', e.target.value)}
                              style={{ ...INPUT_STYLE, width: '44px', padding: '1px 4px', fontSize: '10px' }}
                            />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: '#6c7086' }}>
                            <span>max</span>
                            <input
                              type="number"
                              value={inp.slider.max}
                              step={0.1}
                              onChange={e => updateSliderRange(idx, 'max', e.target.value)}
                              style={{ ...INPUT_STYLE, width: '44px', padding: '1px 4px', fontSize: '10px' }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}

              <button
                onClick={addInput}
                style={{ ...BTN, alignSelf: 'flex-start', background: '#a6e3a111', borderColor: '#a6e3a133', color: '#a6e3a1', marginTop: '2px' }}
              >
                + Add Input
              </button>
            </div>

            {/* Output Type */}
            <p style={SECTION_LABEL}>Output Type</p>
            <select
              value={outputType}
              onChange={e => changeOutputType(e.target.value as DataType)}
              style={{ ...INPUT_STYLE, color: '#89b4fa', cursor: 'pointer', width: '100%' }}
            >
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* ── Right: Warp Lines ─────────────────────────────────────────── */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={SECTION_LABEL}>Warp Lines</p>
            <p style={{ fontSize: '10px', color: '#45475a', marginBottom: '8px', lineHeight: 1.4 }}>
              Each line is a GLSL assignment statement. Input variable names from the left panel are available.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {lines.map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  {/* LHS */}
                  <input
                    type="text"
                    value={line.lhs}
                    placeholder="p.xy"
                    spellCheck={false}
                    style={{ ...INPUT_STYLE, width: '80px' }}
                    {...makeExprInputProps(line.lhs, v => updateLine(i, 'lhs', v), v => ({ lines: lines.map((l, j) => j === i ? { ...l, lhs: v } : l), result }))}
                  />
                  {/* Operator */}
                  <select
                    value={line.op}
                    onChange={e => updateLine(i, 'op', e.target.value)}
                    style={{ ...INPUT_STYLE, color: '#89b4fa', cursor: 'pointer', padding: '3px 4px' }}
                  >
                    {OPS.map(op => <option key={op} value={op}>{op}</option>)}
                  </select>
                  {/* RHS */}
                  <input
                    type="text"
                    value={line.rhs}
                    placeholder="expression…"
                    spellCheck={false}
                    style={{ ...INPUT_STYLE, flex: 1, color: '#a6e3a1' }}
                    {...makeExprInputProps(line.rhs, v => updateLine(i, 'rhs', v), v => ({ lines: lines.map((l, j) => j === i ? { ...l, rhs: v } : l), result }))}
                  />
                  {/* Remove */}
                  <button
                    onClick={() => removeLine(i)}
                    style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', padding: '0 3px', fontSize: '14px', lineHeight: 1, flexShrink: 0 }}
                    title="Remove line"
                  >×</button>
                </div>
              ))}

              {lines.length === 0 && (
                <div style={{ fontSize: '11px', color: '#45475a', fontFamily: 'monospace', padding: '4px 0' }}>
                  No lines yet — click "+ Add Line" to start
                </div>
              )}

              <button
                onClick={addLine}
                style={{ ...BTN, alignSelf: 'flex-start', marginTop: '2px', background: '#a6e3a111', borderColor: '#a6e3a133', color: '#a6e3a1' }}
              >
                + Add Line
              </button>
            </div>

            {/* Return expression */}
            <p style={SECTION_LABEL}>Return Expression</p>
            <p style={{ fontSize: '10px', color: '#45475a', marginBottom: '6px', lineHeight: 1.4 }}>
              The final expression of type <code style={{ color: '#89b4fa' }}>{outputType}</code> that this block outputs.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: '#6c7086', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>return</span>
              <input
                type="text"
                value={result}
                placeholder="p"
                spellCheck={false}
                style={{ ...INPUT_STYLE, flex: 1, color: '#89b4fa', fontSize: '12px' }}
                {...makeExprInputProps(result, updateResult, v => ({ lines, result: v }))}
              />
            </div>

            {/* Available variables — collapses when chips wrap to a second line */}
            {customInputs.length > 0 && (
              <div style={{ marginTop: '12px', padding: '8px', background: '#181825', borderRadius: '6px', border: '1px solid #313244' }}>
                <p style={{ ...SECTION_LABEL, margin: '0 0 4px' }}>Available Variables</p>
                <div
                  ref={varsChipsRef}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px',
                    overflow: 'hidden',
                    // Single-line clip: ~22px covers one row of chips; expand shows all
                    maxHeight: varsExpanded ? 'none' : '22px',
                  }}
                >
                  {customInputs.map(inp => (
                    <code
                      key={inp.name}
                      onClick={() => insertAtFocused(inp.name)}
                      title={`Insert "${inp.name}" into focused expression`}
                      style={{
                        fontSize: '10px',
                        color: inp.type === 'vec3' ? '#a6e3a1' : inp.type === 'float' ? '#89b4fa' : '#f9e2af',
                        background: '#11111b',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        userSelect: 'none',
                        flexShrink: 0,
                      }}
                    >
                      {inp.type} {inp.name}
                    </code>
                  ))}
                </div>
                {/* Expand / collapse toggle */}
                {hiddenVarsCount > 0 && !varsExpanded && (
                  <button
                    onClick={() => setVarsExpanded(true)}
                    style={{
                      ...BTN,
                      marginTop: '4px',
                      padding: '1px 7px',
                      fontSize: '10px',
                      background: 'none',
                      border: 'none',
                      color: '#585b70',
                      cursor: 'pointer',
                    }}
                  >
                    + show {hiddenVarsCount} more
                  </button>
                )}
                {varsExpanded && customInputs.length > 1 && (
                  <button
                    onClick={() => setVarsExpanded(false)}
                    style={{
                      ...BTN,
                      marginTop: '4px',
                      padding: '1px 7px',
                      fontSize: '10px',
                      background: 'none',
                      border: 'none',
                      color: '#585b70',
                      cursor: 'pointer',
                    }}
                  >
                    − show less
                  </button>
                )}
                <p style={{ fontSize: '9px', color: '#45475a', marginTop: '4px', marginBottom: 0 }}>
                  Click any chip to insert into the focused expression field
                </p>
              </div>
            )}

            {/* ── GLSL Function Reference ──────────────────────────────────── */}
            <div style={{ marginTop: '14px', padding: '10px', background: '#181825', borderRadius: '6px', border: '1px solid #313244' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
                <p style={{ ...SECTION_LABEL, margin: 0, flex: 1 }}>GLSL Reference</p>
                <button onClick={undo} disabled={!canUndo} title="Undo (Cmd/Ctrl+Z)"
                  style={{ ...BTN, padding: '2px 7px', fontSize: '12px', opacity: canUndo ? 1 : 0.35, cursor: canUndo ? 'pointer' : 'default' }}>↩</button>
                <button onClick={redo} disabled={!canRedo} title="Redo (Cmd/Ctrl+Shift+Z)"
                  style={{ ...BTN, padding: '2px 7px', fontSize: '12px', opacity: canRedo ? 1 : 0.35, cursor: canRedo ? 'pointer' : 'default' }}>↪</button>
                <button
                  onClick={() => setAutoWrap(v => !v)}
                  title={autoWrap ? 'Auto-wrap ON — clicks wrap entire field value as first arg' : 'Auto-wrap OFF — clicks wrap selected text only'}
                  style={{ ...BTN, padding: '2px 8px', fontSize: '10px', background: autoWrap ? '#45475a' : '#313244', color: autoWrap ? '#cba6f7' : '#585b70', border: `1px solid ${autoWrap ? '#cba6f7' : '#45475a'}`, transition: 'all 0.15s' }}
                >⊂ auto-wrap {autoWrap ? 'ON' : 'OFF'}</button>
              </div>
              <p style={{ fontSize: '9px', color: '#45475a', marginBottom: '8px' }}>
                Click to insert into the focused expression or return field
              </p>
              {GLSL_GROUPS.map(group => (
                <div key={group} style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '9px', color: '#45475a', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '3px' }}>
                    {group}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                    {GLSL_PALETTE.filter(e => e.group === group).map(entry => (
                      <button
                        key={entry.label}
                        onClick={() => insertAtFocused(entry.insert)}
                        title={`Insert: ${entry.insert}`}
                        style={{
                          ...BTN,
                          padding: '2px 6px',
                          fontSize: '10px',
                          background: '#11111b',
                          borderColor: '#313244',
                          color: '#6c7086',
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4';
                          (e.currentTarget as HTMLButtonElement).style.borderColor = '#45475a';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLButtonElement).style.color = '#6c7086';
                          (e.currentTarget as HTMLButtonElement).style.borderColor = '#313244';
                        }}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
