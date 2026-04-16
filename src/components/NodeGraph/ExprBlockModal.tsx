import React, { useState } from 'react';
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

export function ExprBlockModal({ node, onClose }: Props) {
  const { updateNodeParams, updateNodeSockets } = useNodeGraphStore();

  // Read current params
  const customInputs: InputDef[] = (node.params.inputs as InputDef[] | undefined) ?? [];
  const lines: WarpLine[]        = (node.params.lines as WarpLine[] | undefined) ?? [];
  const result: string           = (node.params.result as string | undefined) ?? 'p';
  const outputType: DataType     = (node.params.outputType as DataType | undefined) ?? 'vec3';

  const [savedFlash, setSavedFlash] = useState(false);

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
          width: 'min(780px, calc(100vw - 32px))',
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

            {customInputs.length === 0 && Object.keys(node.inputs).length > 0 && (
              <button
                onClick={migrateFromNodeInputs}
                style={{ ...BTN, marginBottom: '8px', color: '#f9e2af', borderColor: '#f9e2af55', background: '#f9e2af11' }}
              >
                ↑ Import from existing sockets
              </button>
            )}

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
                    onChange={e => updateLine(i, 'lhs', e.target.value)}
                    placeholder="p.xy"
                    spellCheck={false}
                    style={{ ...INPUT_STYLE, width: '80px' }}
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
                    onChange={e => updateLine(i, 'rhs', e.target.value)}
                    placeholder="expression…"
                    spellCheck={false}
                    style={{ ...INPUT_STYLE, flex: 1, color: '#a6e3a1' }}
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
                onChange={e => updateResult(e.target.value)}
                placeholder="p"
                spellCheck={false}
                style={{ ...INPUT_STYLE, flex: 1, color: '#89b4fa', fontSize: '12px' }}
              />
            </div>

            {/* Available variables hint */}
            {customInputs.length > 0 && (
              <div style={{ marginTop: '12px', padding: '8px', background: '#181825', borderRadius: '6px', border: '1px solid #313244' }}>
                <p style={{ ...SECTION_LABEL, margin: '0 0 4px' }}>Available Variables</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {customInputs.map(inp => (
                    <code key={inp.name} style={{
                      fontSize: '10px', color: inp.type === 'vec3' ? '#a6e3a1' : inp.type === 'float' ? '#89b4fa' : '#f9e2af',
                      background: '#11111b', padding: '1px 5px', borderRadius: '3px',
                    }}>
                      {inp.type} {inp.name}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
