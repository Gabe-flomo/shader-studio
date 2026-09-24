import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { GraphNode, DataType } from '../../types/nodeGraph';
import { useNodeGraphStore, saveExprPreset } from '../../store/useNodeGraphStore';
import { useFunctionBuilder } from '../FunctionBuilder/useFunctionBuilder';
import type { FnDef } from '../FunctionBuilder/useFunctionBuilder';
import { moveItem } from '../../lib/reorder';
import { GLSL_PALETTE } from '../../lib/glslPalette';
import { NumberInput } from './NumberInput';
import { ctp } from '../../theme/palette';

// ── Convert ExprBlock warp lines → FnDef array (one fn per line, f1/f2/f3…) ──
// Names are always sequential (f1, f2, …). The return type is inferred from a
// typed LHS ("float …", "vec3 …") or falls back to the ExprBlock outputType.
function linesToFnDefs(
  lines: WarpLine[],
  defaultType: 'float' | 'vec2' | 'vec3' = 'float',
): Array<Omit<FnDef, 'id'>> {
  let fnIndex = 0;
  return lines
    .filter(l => l.rhs && l.rhs.trim())
    .map(line => {
      fnIndex++;
      const lhs = line.lhs.trim();
      const typedMatch = lhs.match(/^(float|vec2|vec3)\s+/);
      const returnType = typedMatch
        ? (typedMatch[1] as 'float' | 'vec2' | 'vec3')
        : defaultType;
      return { name: `f${fnIndex}`, returnType, body: line.rhs };
    });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface InputDef {
  name: string;
  type: DataType;
  slider: { min: number; max: number } | null;
  carry?: boolean;
}

interface WarpLine {
  lhs: string;
  op: string;
  rhs: string;
}

const TYPE_OPTIONS: DataType[] = ['float', 'vec2', 'vec3', 'vec4'];
const OPS = ['=', '+=', '-=', '*=', '/='];

// ─── GLSL function palette ────────────────────────────────────────────────────
// Shared with the mobile inline autocomplete — see src/lib/glslPalette.ts.

const GLSL_GROUPS = Array.from(new Set(GLSL_PALETTE.map(e => e.group)));

// ─── Styles ───────────────────────────────────────────────────────────────────

const BTN: React.CSSProperties = {
  background: ctp.surface0,
  border: `1px solid ${ctp.surface1}`,
  color: ctp.text,
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
  color: ctp.surface2,
  margin: '10px 0 4px',
};

const INPUT_STYLE: React.CSSProperties = {
  background: ctp.crust,
  border: `1px solid ${ctp.surface1}`,
  color: ctp.text,
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
  const updateNodeParams  = useNodeGraphStore(s => s.updateNodeParams);
  const updateNodeSockets = useNodeGraphStore(s => s.updateNodeSockets);

  // Read current params
  const customInputs: InputDef[] = (node.params.inputs as InputDef[] | undefined) ?? [];
  const lines: WarpLine[]        = (node.params.lines as WarpLine[] | undefined) ?? [];
  const result: string           = (node.params.result as string | undefined) ?? 'p';
  const outputType: DataType     = (node.params.outputType as DataType | undefined) ?? 'float';

  const [savedFlash, setSavedFlash]     = useState(false);
  const [autoWrap, setAutoWrap]         = useState(false);
  const [showSaveInput, setShowSaveInput]   = useState(false);
  const [savePresetName, setSavePresetName] = useState('');

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

  const toggleCarry = (idx: number) => {
    const next = customInputs.map((c, i) => i === idx ? { ...c, carry: !c.carry } : c);
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

  const updateSliderRange = (idx: number, field: 'min' | 'max', val: number) => {
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

  const moveLine = (idx: number, to: number) => {
    updateNodeParams(node.id, { lines: moveItem(lines, idx, to) });
  };

  const updateLine = (idx: number, field: keyof WarpLine, value: string) => {
    const next = lines.map((l, i) => i === idx ? { ...l, [field]: value } : l);
    updateNodeParams(node.id, { lines: next });
  };

  const updateResult = (val: string) => {
    updateNodeParams(node.id, { result: val });
  };

  const handleSavePreset = (name: string) => {
    saveExprPreset({
      label:      name.trim() || (typeof node.params.label === 'string' && node.params.label.trim() ? node.params.label.trim() : 'Expr Block'),
      inputs:     customInputs,
      outputType,
      lines,
      result,
    });
    setShowSaveInput(false);
    setSavePresetName('');
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
          background: ctp.base,
          border: `1px solid ${ctp.surface1}`,
          borderRadius: '10px',
          width: 'min(820px, calc(100vw - 32px))',
          maxHeight: '88vh',
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '0',
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
          color: ctp.text,
          fontSize: '12px',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: ctp.green }}>⟴ Expr Block</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {savedFlash && (
              <span style={{ fontSize: '11px', color: ctp.green, fontFamily: 'monospace' }}>✓ saved</span>
            )}
            {/* Open in Function Builder.
                Priority: fnBuilderFns (actual function bodies) > lines conversion (fallback).
                fnBuilderFns are always present when saved via "Save to ExprBlock" from the
                Function Builder. Lines-as-functions is only used for manually-written ExprBlocks
                that have never been through the builder (no fnBuilderFns stored). */}
            {(() => {
              const hasFnBuilderFns =
                Array.isArray(node.params.fnBuilderFns) &&
                (node.params.fnBuilderFns as FnDef[]).length > 0;
              const safeOutputType = (outputType === 'float' || outputType === 'vec2' || outputType === 'vec3')
                ? outputType : 'float';
              const linesFns = !hasFnBuilderFns ? linesToFnDefs(lines, safeOutputType) : [];
              const hasConvertibleLines = linesFns.length > 0;
              if (!hasFnBuilderFns && !hasConvertibleLines) return null;
              return (
                <button
                  onClick={() => {
                    if (hasFnBuilderFns) {
                      // Restore the actual function bodies that were authored in the builder
                      useFunctionBuilder.getState().openNodeInBuilder(node.id, node.params.fnBuilderFns as FnDef[]);
                    } else {
                      // No builder history — convert warp lines to f1/f2/f3… functions
                      useFunctionBuilder.getState().openNodeInBuilder(node.id, linesFns as FnDef[]);
                    }
                    onClose();
                  }}
                  title={hasFnBuilderFns
                    ? 'Re-open in the Function Builder'
                    : 'Open warp lines as functions in the Function Builder'}
                  style={{ ...BTN, color: ctp.blue, borderColor: `${ctp.blue}55`, background: `${ctp.blue}11` }}
                >
                  ƒ( ) Edit in Builder
                </button>
              );
            })()}
            {showSaveInput ? (
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input
                  autoFocus
                  type="text"
                  placeholder={typeof node.params.label === 'string' && node.params.label.trim() ? node.params.label.trim() : 'Expr Block'}
                  value={savePresetName}
                  onChange={e => setSavePresetName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSavePreset(savePresetName);
                    if (e.key === 'Escape') { setShowSaveInput(false); setSavePresetName(''); }
                  }}
                  style={{ flex: 1, minWidth: 0, padding: '3px 6px', fontSize: '11px', background: ctp.base, color: ctp.text, border: `1px solid ${ctp.green}`, borderRadius: '4px', outline: 'none' }}
                />
                <button
                  onClick={() => handleSavePreset(savePresetName)}
                  style={{ ...BTN, color: ctp.green, borderColor: `${ctp.green}55`, background: `${ctp.green}11`, padding: '3px 8px' }}
                >↑</button>
                <button
                  onClick={() => { setShowSaveInput(false); setSavePresetName(''); }}
                  style={{ ...BTN, color: ctp.overlay0, borderColor: `${ctp.overlay0}55`, padding: '3px 6px' }}
                >✕</button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setSavePresetName('');
                  setShowSaveInput(true);
                }}
                title="Save as a reusable preset in the palette"
                style={{ ...BTN, color: ctp.green, borderColor: `${ctp.green}55`, background: `${ctp.green}11` }}
              >
                ↑ Save Preset
              </button>
            )}
            <button onClick={onClose} style={{ ...BTN, color: ctp.red, borderColor: `${ctp.red}55` }}>✕ Close</button>
          </div>
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>

          {/* ── Left: Inputs ─────────────────────────────────────────────── */}
          <div style={{ width: '230px', flexShrink: 0 }}>
            <p style={SECTION_LABEL}>Inputs</p>
            <p style={{ fontSize: '10px', color: ctp.surface1, marginBottom: '8px', lineHeight: 1.4 }}>
              Each input becomes a local variable in the warp. Float inputs can have sliders.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {customInputs.map((inp, idx) => (
                <div
                  key={idx}
                  style={{
                    background: ctp.mantle,
                    border: `1px solid ${ctp.surface0}`,
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
                      style={{ ...INPUT_STYLE, color: ctp.blue, cursor: 'pointer', padding: '3px 4px' }}
                    >
                      {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button
                      onClick={() => removeInput(idx)}
                      style={{ background: 'none', border: 'none', color: ctp.red, cursor: 'pointer', padding: '0 2px', fontSize: '13px', lineHeight: 1 }}
                      title="Remove input"
                    >×</button>
                  </div>

                  {/* Slider toggle (float only) */}
                  {inp.type === 'float' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '10px', color: inp.slider ? ctp.green : ctp.surface2 }}>
                        <input
                          type="checkbox"
                          checked={!!inp.slider}
                          onChange={() => toggleSlider(idx)}
                          style={{ accentColor: ctp.green, cursor: 'pointer' }}
                        />
                        slider
                      </label>
                      {inp.slider && (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: ctp.overlay0 }}>
                            <span>min</span>
                            <NumberInput
                              value={inp.slider.min}
                              step={0.1}
                              onCommit={n => updateSliderRange(idx, 'min', n)}
                              style={{ ...INPUT_STYLE, width: '44px', padding: '1px 4px', fontSize: '10px' }}
                            />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: ctp.overlay0 }}>
                            <span>max</span>
                            <NumberInput
                              value={inp.slider.max}
                              step={0.1}
                              onCommit={n => updateSliderRange(idx, 'max', n)}
                              style={{ ...INPUT_STYLE, width: '44px', padding: '1px 4px', fontSize: '10px' }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Carry toggle — available for all types */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '10px', color: inp.carry ? ctp.mauve : ctp.surface2 }}>
                      <input
                        type="checkbox"
                        checked={!!inp.carry}
                        onChange={() => toggleCarry(idx)}
                        style={{ accentColor: ctp.mauve, cursor: 'pointer' }}
                      />
                      carry
                    </label>
                    {inp.carry && (
                      <span style={{ fontSize: '9px', color: ctp.overlay0, fontStyle: 'italic' }}>
                        + {inp.name}_init slot
                      </span>
                    )}
                  </div>
                </div>
              ))}

              <button
                onClick={addInput}
                style={{ ...BTN, alignSelf: 'flex-start', background: `${ctp.green}11`, borderColor: `${ctp.green}33`, color: ctp.green, marginTop: '2px' }}
              >
                + Add Input
              </button>
            </div>

            {/* Output Type */}
            <p style={SECTION_LABEL}>Output Type</p>
            <select
              value={outputType}
              onChange={e => changeOutputType(e.target.value as DataType)}
              style={{ ...INPUT_STYLE, color: ctp.blue, cursor: 'pointer', width: '100%' }}
            >
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* ── Right: Warp Lines ─────────────────────────────────────────── */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={SECTION_LABEL}>Warp Lines</p>
            <p style={{ fontSize: '10px', color: ctp.surface1, marginBottom: '8px', lineHeight: 1.4 }}>
              Each line is a GLSL assignment statement. Input variable names from the left panel are available.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {lines.map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  {/* Reorder */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flexShrink: 0 }}>
                    <button
                      onClick={() => moveLine(i, i - 1)}
                      disabled={i === 0}
                      style={{ background: 'none', border: 'none', color: i === 0 ? ctp.surface0 : ctp.overlay0, cursor: i === 0 ? 'default' : 'pointer', padding: 0, fontSize: '9px', lineHeight: 1 }}
                      title="Move up"
                    >▲</button>
                    <button
                      onClick={() => moveLine(i, i + 1)}
                      disabled={i === lines.length - 1}
                      style={{ background: 'none', border: 'none', color: i === lines.length - 1 ? ctp.surface0 : ctp.overlay0, cursor: i === lines.length - 1 ? 'default' : 'pointer', padding: 0, fontSize: '9px', lineHeight: 1 }}
                      title="Move down"
                    >▼</button>
                  </div>
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
                    style={{ ...INPUT_STYLE, color: ctp.blue, cursor: 'pointer', padding: '3px 4px' }}
                  >
                    {OPS.map(op => <option key={op} value={op}>{op}</option>)}
                  </select>
                  {/* RHS */}
                  <input
                    type="text"
                    value={line.rhs}
                    placeholder="expression…"
                    spellCheck={false}
                    style={{ ...INPUT_STYLE, flex: 1, color: ctp.green }}
                    {...makeExprInputProps(line.rhs, v => updateLine(i, 'rhs', v), v => ({ lines: lines.map((l, j) => j === i ? { ...l, rhs: v } : l), result }))}
                  />
                  {/* Remove */}
                  <button
                    onClick={() => removeLine(i)}
                    style={{ background: 'none', border: 'none', color: ctp.red, cursor: 'pointer', padding: '0 3px', fontSize: '14px', lineHeight: 1, flexShrink: 0 }}
                    title="Remove line"
                  >×</button>
                </div>
              ))}

              {lines.length === 0 && (
                <div style={{ fontSize: '11px', color: ctp.surface1, fontFamily: 'monospace', padding: '4px 0' }}>
                  No lines yet — click "+ Add Line" to start
                </div>
              )}

              <button
                onClick={addLine}
                style={{ ...BTN, alignSelf: 'flex-start', marginTop: '2px', background: `${ctp.green}11`, borderColor: `${ctp.green}33`, color: ctp.green }}
              >
                + Add Line
              </button>
            </div>

            {/* Return expression */}
            <p style={SECTION_LABEL}>Return Expression</p>
            <p style={{ fontSize: '10px', color: ctp.surface1, marginBottom: '6px', lineHeight: 1.4 }}>
              The final expression of type <code style={{ color: ctp.blue }}>{outputType}</code> that this block outputs.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: ctp.overlay0, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>return</span>
              <input
                type="text"
                value={result}
                placeholder="p"
                spellCheck={false}
                style={{ ...INPUT_STYLE, flex: 1, color: ctp.blue, fontSize: '12px' }}
                {...makeExprInputProps(result, updateResult, v => ({ lines, result: v }))}
              />
            </div>

            {/* Available variables — collapses when chips wrap to a second line */}
            {customInputs.length > 0 && (
              <div style={{ marginTop: '12px', padding: '8px', background: ctp.mantle, borderRadius: '6px', border: `1px solid ${ctp.surface0}` }}>
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
                        color: inp.type === 'vec3' ? ctp.green : inp.type === 'float' ? ctp.blue : ctp.yellow,
                        background: ctp.crust,
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
                      color: ctp.surface2,
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
                      color: ctp.surface2,
                      cursor: 'pointer',
                    }}
                  >
                    − show less
                  </button>
                )}
                <p style={{ fontSize: '9px', color: ctp.surface1, marginTop: '4px', marginBottom: 0 }}>
                  Click any chip to insert into the focused expression field
                </p>
              </div>
            )}

            {/* ── GLSL Function Reference ──────────────────────────────────── */}
            <div style={{ marginTop: '14px', padding: '10px', background: ctp.mantle, borderRadius: '6px', border: `1px solid ${ctp.surface0}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
                <p style={{ ...SECTION_LABEL, margin: 0, flex: 1 }}>GLSL Reference</p>
                <button onClick={undo} disabled={!canUndo} title="Undo (Cmd/Ctrl+Z)"
                  style={{ ...BTN, padding: '2px 7px', fontSize: '12px', opacity: canUndo ? 1 : 0.35, cursor: canUndo ? 'pointer' : 'default' }}>↩</button>
                <button onClick={redo} disabled={!canRedo} title="Redo (Cmd/Ctrl+Shift+Z)"
                  style={{ ...BTN, padding: '2px 7px', fontSize: '12px', opacity: canRedo ? 1 : 0.35, cursor: canRedo ? 'pointer' : 'default' }}>↪</button>
                <button
                  onClick={() => setAutoWrap(v => !v)}
                  title={autoWrap ? 'Auto-wrap ON — clicks wrap entire field value as first arg' : 'Auto-wrap OFF — clicks wrap selected text only'}
                  style={{ ...BTN, padding: '2px 8px', fontSize: '10px', background: autoWrap ? ctp.surface1 : ctp.surface0, color: autoWrap ? ctp.mauve : ctp.surface2, border: `1px solid ${autoWrap ? ctp.mauve : ctp.surface1}`, transition: 'all 0.15s' }}
                >⊂ auto-wrap {autoWrap ? 'ON' : 'OFF'}</button>
              </div>
              <p style={{ fontSize: '9px', color: ctp.surface1, marginBottom: '8px' }}>
                Click to insert into the focused expression or return field
              </p>
              {GLSL_GROUPS.map(group => (
                <div key={group} style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '9px', color: ctp.surface1, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '3px' }}>
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
                          background: ctp.crust,
                          borderColor: ctp.surface0,
                          color: ctp.overlay0,
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLButtonElement).style.color = ctp.text;
                          (e.currentTarget as HTMLButtonElement).style.borderColor = ctp.surface1;
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLButtonElement).style.color = ctp.overlay0;
                          (e.currentTarget as HTMLButtonElement).style.borderColor = ctp.surface0;
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
