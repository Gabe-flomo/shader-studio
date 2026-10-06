import React, { Fragment, useState, useEffect, useMemo, useRef } from 'react';
import { toggleLineOff } from '../../lib/exprLines';
import type { GraphNode, DataType } from '../../types/nodeGraph';
import { setInputSlider } from '../../nodes/sliderFreeze';
import { nowParamValue } from '../../lib/nowValue';
import { useNodeGraphStore, saveExprPreset } from '../../store/useNodeGraphStore';
import { useFunctionBuilder } from '../FunctionBuilder/useFunctionBuilder';
import type { FnDef } from '../FunctionBuilder/useFunctionBuilder';
import { moveItem } from '../../lib/reorder';
import { NumberInput } from './NumberInput';
import { TYPE_COLORS } from './typeColors';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Field, TypeSelect } from '../ui/Field';
import { Chip } from '../ui/Chip';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { toast } from '../ui/toastStore';
import { CodeInput } from '../code/CodeField';
import { ReferencePanel } from '../code/ReferencePanel';
import { LinePreviewPanel, ProbeButton, startLineProbe } from '../code/LinePreview';
import type { EditorPanel } from '../code/editorPanelPrefs';
import { CollapseInputsButton, FunctionsToggle, InputsRail, SidePanel, useEditorSidePanels } from '../code/SidePanels';
import { buildCompletions } from '../code/glslReference';
import { insertSnippet } from '../code/useCompletion';
import { HowUsedButton } from '../codeExplorer/HowUsedButton';
import { useExprBlockJump } from '../codeExplorer/useCodeJumpFocus';
import { ExplainRow } from '../explain/ExplainRow';
import { useExplainDialogs } from '../explain/useExplainDialogs';
import { exprBlockContext, exprBlockUseHere } from '../explain/hosts';
import type { GeneraliseContext } from '../../lib/glslPatterns';
import { snippetLines, type Snippet } from '../../suggestions/snippets';

// ── Convert ExprBlock warp lines → FnDef array (one fn per line, f1/f2/f3…) ──
// Names are always sequential (f1, f2, …). The return type is inferred from a
// typed LHS ("float …", "vec3 …") or falls back to the ExprBlock outputType.
function linesToFnDefs(
  lines: WarpLine[],
  defaultType: 'float' | 'vec2' | 'vec3' = 'float',
): Array<Omit<FnDef, 'id'>> {
  let fnIndex = 0;
  return lines
    .filter(l => l.rhs && l.rhs.trim() && !l.off)
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
  /** Switched off: kept, but compiled as a comment (⌘/ or the // button). */
  off?: boolean;
}


const TYPE_OPTIONS: DataType[] = ['float', 'vec2', 'vec3', 'vec4'];
const OPS = ['=', '+=', '-=', '*=', '/='];


// ─── ExprBlockModal ───────────────────────────────────────────────────────────

interface Props {
  node: GraphNode;
  /** The node sits in a group that iterates — only then can inputs carry between iterations. */
  insideLoop?: boolean;
  onClose: () => void;
}

type Snapshot = { lines: WarpLine[]; result: string };

/** The expression field last focused: reference-panel clicks insert there. */
interface InsertTarget {
  el: HTMLInputElement;
  value: string;
  set: (v: string) => void;
  snap: (v: string) => Snapshot;
}

const PANELS: readonly EditorPanel[] = ['inputs', 'functions'];

export function ExprBlockModal({ node, insideLoop = false, onClose }: Props) {
  const updateNodeParams  = useNodeGraphStore(s => s.updateNodeParams);
  const updateNodeSockets = useNodeGraphStore(s => s.updateNodeSockets);
  const tk = useTokens();
  // Side panels: Inputs (folds to a rail) and the function palette (closed by default); ⌘[ / ⌘]
  const { narrow, open: panels, set: setPanel, toggle: togglePanel } = useEditorSidePanels(PANELS);
  // Opened by the Code Explorer's jump to source: show that line.
  useExprBlockJump(node.id);

  // Read current params
  const customInputs: InputDef[] = (node.params.inputs as InputDef[] | undefined) ?? [];
  const lines: WarpLine[]        = (node.params.lines as WarpLine[] | undefined) ?? [];
  const result: string           = (node.params.result as string | undefined) ?? 'p';
  const outputType: DataType     = (node.params.outputType as DataType | undefined) ?? 'float';
  // Exposed locals: inputs and typed line variables the block also outputs.
  const exposed = (node.params.outputs as string[] | undefined) ?? [];
  const candidates = useMemo(() => {
    const out: Array<{ name: string; type: DataType }> = [];
    for (const i of (node.params.inputs as Array<{ name: string; type: DataType }> | undefined) ?? []) if (i.name && !out.some(o => o.name === i.name)) out.push({ name: i.name, type: i.type });
    for (const l of (node.params.lines as Array<{ lhs: string }> | undefined) ?? []) { const m = /^\s*(float|vec[234])\s+([A-Za-z_]\w*)/.exec(l.lhs); if (m && !out.some(o => o.name === m[2])) out.push({ name: m[2], type: m[1] as DataType }); }
    return out.filter(o => o.name !== 'result');
  }, [node.params.inputs, node.params.lines]);
  const exposedOutputs = (names: string[]) => names.map(n => candidates.find(c => c.name === n)).filter((c): c is { name: string; type: DataType } => !!c);
  const toggleExposed = (name: string) => {
    const next = exposed.includes(name) ? exposed.filter(n => n !== name) : [...exposed, name];
    updateNodeParams(node.id, { outputs: next });
    updateNodeSockets(node.id, (node.params.inputs as Array<{ name: string; type: DataType; slider: { min: number; max: number } | null }> | undefined) ?? [], outputType, exposedOutputs(next));
  };
  const label = typeof node.params.label === 'string' && node.params.label.trim() ? node.params.label.trim() : 'Expression Block';

  const [autoWrap, setAutoWrap]             = useState(false);
  const [showSaveInput, setShowSaveInput]   = useState(false);
  const [savePresetName, setSavePresetName] = useState('');

  const rawInputs = node.params.inputs;
  const completions = useMemo(() => buildCompletions((rawInputs as InputDef[] | undefined) ?? []), [rawInputs]);
  // The explainer: types and roles of the block's names (inputs, typed lines, what feeds them)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the inputs, lines and wiring are what it reads
  const explainCtx = useMemo(() => exprBlockContext(node), [node.params.inputs, node.params.lines, node.params.outputType, node.inputs]);
  const explainDialogs = useExplainDialogs({ onJumped: onClose });

  // ── Undo / Redo ──────────────────────────────────────────────────────────────
  const history      = useRef<Snapshot[]>([{ lines, result }]);
  const historyIndex = useRef(0);
  const [historyPos, setHistoryPos] = useState(0);
  const [historyLen, setHistoryLen] = useState(1);

  const pushHistory = (snap: Snapshot) => {
    const trimmed = history.current.slice(0, historyIndex.current + 1);
    trimmed.push(snap);
    history.current      = trimmed;
    historyIndex.current = trimmed.length - 1;
    setHistoryPos(historyIndex.current);
    setHistoryLen(trimmed.length);
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
  const canRedo = historyPos < historyLen - 1;

  const target = useRef<InsertTarget | null>(null);

  // ── Input management ───────────────────────────────────────────────────────

  const setInputs = (next: InputDef[], extra: Record<string, unknown> = {}) => {
    updateNodeParams(node.id, { inputs: next, ...extra });
    updateNodeSockets(node.id, next, outputType, exposedOutputs(exposed));
  };

  const addInput = () => setInputs([...customInputs, { name: `in${customInputs.length}`, type: 'float', slider: null }]);
  const removeInput = (idx: number) => setInputs(customInputs.filter((_, i) => i !== idx));
  const updateInputName = (idx: number, name: string) => setInputs(customInputs.map((inp, i) => i === idx ? { ...inp, name } : inp));
  const updateInputType = (idx: number, type: DataType) =>
    setInputs(customInputs.map((inp, i) => i === idx ? { ...inp, type, slider: type !== 'float' ? null : inp.slider } : inp));
  const toggleCarry = (idx: number) => setInputs(customInputs.map((c, i) => i === idx ? { ...c, carry: !c.carry } : c));

  // Off freezes the input at the value it has right now (slider, keyframes or Play); on picks up from there.
  const toggleSlider = (idx: number) => {
    const inp = customInputs[idx];
    const { inputs: next, params } = setInputSlider(node, customInputs, idx, !inp.slider, inp.slider ? nowParamValue(node, inp.name) : 0);
    setInputs(next, params);
  };

  const updateSliderRange = (idx: number, field: 'min' | 'max', val: number) => {
    const oldSlider = customInputs[idx].slider ?? { min: 0, max: 1 };
    setInputs(customInputs.map((c, i) => i === idx ? { ...c, slider: { ...oldSlider, [field]: val } } : c));
  };

  const changeOutputType = (type: DataType) => {
    updateNodeParams(node.id, { outputType: type });
    updateNodeSockets(node.id, customInputs, type, exposedOutputs(exposed));
  };

  // ── Lines management ───────────────────────────────────────────────────────

  const addLine = () => updateNodeParams(node.id, { lines: [...lines, { lhs: 'p', op: '=', rhs: '' }] });
  const removeLine = (idx: number) => updateNodeParams(node.id, { lines: lines.filter((_, i) => i !== idx) });
  const moveLine = (idx: number, to: number) => updateNodeParams(node.id, { lines: moveItem(lines, idx, to) });
  const updateLine = (idx: number, field: keyof WarpLine, value: string) =>
    updateNodeParams(node.id, { lines: lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) });
  const updateResult = (val: string) => updateNodeParams(node.id, { result: val });
  // A snippet (suggestions/snippets.ts): its lines appended, wired to this block's variables. The
  // result switches to it when the block still returns a bare input of the same type.
  const insertSnippetLines = (sn: Snippet) => {
    const r = snippetLines(sn, customInputs, lines);
    const nextLines = [...lines, ...r.lines];
    const bare = customInputs.find(i => i.name === result.trim());
    const nextResult = bare && r.resultType === outputType ? r.result : result;
    updateNodeParams(node.id, { lines: nextLines, result: nextResult });
    pushHistory({ lines: nextLines, result: nextResult });
    toast.success(`${sn.label}: ${r.lines.length} line${r.lines.length === 1 ? '' : 's'} added`, { message: nextResult === r.result ? `The block now returns ${r.result}.` : `Its value is ${r.result} (${r.resultType}): use it in Return or a later line.` });
  };

  const handleSavePreset = (name: string) => {
    const presetLabel = name.trim() || label;
    saveExprPreset({ label: presetLabel, inputs: customInputs, outputType, lines, result, comment: typeof node.params.__comment === 'string' && node.params.__comment.trim() ? node.params.__comment.trim() : undefined });
    setShowSaveInput(false);
    setSavePresetName('');
    toast.success(`Saved “${presetLabel}” to Expression Blocks`);
  };

  // ── Migrate from old fixed inputs ─────────────────────────────────────────

  const migrateFromNodeInputs = () => {
    const migrated: InputDef[] = Object.entries(node.inputs).map(([key, inp]) => ({
      name: key,
      type: inp.type as DataType,
      slider: null,
    }));
    updateNodeParams(node.id, { inputs: migrated });
    updateNodeSockets(node.id, migrated, outputType, exposedOutputs(exposed));
  };

  // Auto-import existing sockets into params.inputs when the modal first opens
  // and params.inputs is empty (e.g. legacy nodes or newly wired nodes).
  useEffect(() => {
    if (customInputs.length === 0 && Object.keys(node.inputs).length > 0) {
      migrateFromNodeInputs();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reference insert at the focused expression field ──────────────────────

  const insertFromReference = (text: string) => {
    const t = target.current;
    if (!t) return;
    const start = t.el.selectionStart ?? t.value.length;
    const end = t.el.selectionEnd ?? t.value.length;
    const { next, caret } = insertSnippet(t.value, start, end, text, autoWrap);
    t.set(next);
    t.value = next;
    pushHistory(t.snap(next));
    requestAnimationFrame(() => {
      t.el.focus();
      t.el.setSelectionRange(caret, caret);
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

  /** Props for an expression field: autocomplete, history, and registering as the insert target. */
  const exprProps = (value: string, set: (v: string) => void, snap: (v: string) => Snapshot) => ({
    value,
    completions,
    onChange: (v: string) => { set(v); if (target.current) target.current.value = v; },
    onFocus: (el: HTMLInputElement) => { target.current = { el, value, set, snap }; },
    onBlur: handleAnyBlur,
    onKeyDown: handleAnyKeyDown,
  });

  // Open in Function Builder. fnBuilderFns (the bodies authored there) win; lines convert as a fallback.
  const hasFnBuilderFns = Array.isArray(node.params.fnBuilderFns) && (node.params.fnBuilderFns as FnDef[]).length > 0;
  const safeOutputType = (outputType === 'float' || outputType === 'vec2' || outputType === 'vec3') ? outputType : 'float';
  const linesFns = !hasFnBuilderFns ? linesToFnDefs(lines, safeOutputType) : [];
  const canOpenInBuilder = hasFnBuilderFns || linesFns.length > 0;

  const showCarry = (inp: InputDef) => insideLoop || !!inp.carry;

  return (
    <Modal
      title="Expression Block"
      subtitle={`${label} · ${customInputs.length} ${customInputs.length === 1 ? 'input' : 'inputs'} → ${outputType}`}
      icon="expr"
      iconColor={tk.kind.expr}
      width={1200}
      height={700}
      onClose={onClose}
      headerActions={
        <>
          <HowUsedButton />
          <FunctionsToggle open={panels.functions} onToggle={() => togglePanel('functions')} />
          {canOpenInBuilder && (
            <Button size="sm" variant="ghost" icon="fn" style={{ marginRight: 4 }}
              title={hasFnBuilderFns ? 'Re-open in the Function Builder' : 'Open these lines as functions in the Function Builder'}
              onClick={() => {
                useFunctionBuilder.getState().openNodeInBuilder(node.id, (hasFnBuilderFns ? node.params.fnBuilderFns : linesFns) as FnDef[]);
                onClose();
              }}>
              Edit in Builder
            </Button>
          )}
          <IconButton icon="undo" label="Undo" shortcut="cmd+z" disabled={!canUndo} onClick={undo} />
          <IconButton icon="redo" label="Redo" shortcut="cmd+shift+z" disabled={!canRedo} onClick={redo} />
        </>
      }
      footer={
        showSaveInput ? (
          <>
            <Field
              autoFocus
              aria-label="Preset name"
              placeholder={label}
              value={savePresetName}
              onChange={e => setSavePresetName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSavePreset(savePresetName);
                if (e.key === 'Escape') { e.stopPropagation(); setShowSaveInput(false); setSavePresetName(''); }
              }}
              style={{ width: 240 }}
            />
            <Button onClick={() => handleSavePreset(savePresetName)}>Save preset</Button>
            <Button variant="ghost" onClick={() => { setShowSaveInput(false); setSavePresetName(''); }}>Cancel</Button>
            <span style={{ flex: 1 }} />
            <Button variant="primary" onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <Button icon="export" onClick={() => { setSavePresetName(''); setShowSaveInput(true); }}>Save as preset</Button>
            <Note>Adds it to Expression Blocks in the sidebar</Note>
            <span style={{ flex: 1 }} />
            <Note>Changes apply live</Note>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </>
        )
      }
    >
      <div style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative' }}>
        {/* ── Inputs: a panel, folded to a rail of chips, or a drawer on a narrow window ── */}
        {(!panels.inputs || narrow) && <InputsRail inputs={customInputs} onExpand={() => setPanel('inputs', true)} />}
        <SidePanel side="left" label="Inputs" open={panels.inputs} narrow={narrow} width={340} onClose={() => setPanel('inputs', false)}>
        <div data-panel="inputs" style={{ width: 340, maxWidth: '100%', flexShrink: 0, overflowY: 'auto', padding: '18px 20px', borderRight: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box' }}>
          <span style={{ display: 'flex', alignItems: 'center' }}><SectionLabel>Inputs</SectionLabel><CollapseInputsButton onCollapse={() => setPanel('inputs', false)} /></span>
          <Note>Each input is a local variable in the lines. Float inputs can show a slider on the node.</Note>
          {customInputs.map((inp, idx) => (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 104px 26px 32px', gap: 8, alignItems: 'center' }}>
                <Field
                  mono
                  leading={<span style={{ width: 9, height: 9, borderRadius: '50%', background: TYPE_COLORS[inp.type] ?? tk.text.faint, flexShrink: 0 }} />}
                  value={inp.name}
                  onChange={e => updateInputName(idx, e.target.value)}
                  placeholder="name"
                  spellCheck={false}
                  aria-label={`Input ${idx + 1} name`}
                />
                <TypeSelect value={inp.type} options={TYPE_OPTIONS} onChange={t => updateInputType(idx, t as DataType)} ariaLabel={`Input ${idx + 1} type`} />
                <ProbeButton node={node} target={{ kind: 'input', name: inp.name }} label={`Preview input ${inp.name}`} />
                <IconButton icon="close" label="Remove input" tone="danger" onClick={() => removeInput(idx)} />
              </div>
              {(inp.type === 'float' || showCarry(inp)) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingLeft: 2 }}>
                  {inp.type === 'float' && <Toggle checked={!!inp.slider} onChange={() => toggleSlider(idx)} label="Slider" />}
                  {inp.slider && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: tk.text.muted }}>
                      range
                      <NumberInput value={inp.slider.min} step={0.1} onCommit={n => updateSliderRange(idx, 'min', n)} style={smallField(tk)} />
                      <NumberInput value={inp.slider.max} step={0.1} onCommit={n => updateSliderRange(idx, 'max', n)} style={smallField(tk)} />
                    </span>
                  )}
                  {showCarry(inp) && (
                    <span title="Carry the value from one loop iteration to the next" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Toggle checked={!!inp.carry} onChange={() => toggleCarry(idx)} label="Carry" />
                      {inp.carry && (
                        <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.muted, background: tk.bg.field, borderRadius: 6, padding: '2px 7px' }}>
                          + {inp.name}_init socket
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
          <AddRow onClick={addInput}>Add input</AddRow>
        </div>
        </SidePanel>

        {/* ── Lines + return ── */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SectionLabel meta="run top to bottom">Lines</SectionLabel>
            {lines.map((line, i) => (
              <Fragment key={i}>
              <div data-line-off={line.off ? '' : undefined}
                onKeyDownCapture={e => { if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); e.stopPropagation(); updateNodeParams(node.id, { lines: toggleLineOff(lines, i) }); } }}
                style={{ display: 'grid', gridTemplateColumns: '22px 110px 64px minmax(0, 1fr) auto', gap: 6, alignItems: 'center', opacity: line.off ? 0.45 : 1 }}>
                <button type="button" aria-pressed={!!line.off} title={line.off ? 'Off: skipped (kept as a comment). Click or ⌘/ to switch it back on' : `Line ${i + 1}: click or ⌘/ to switch it off without deleting it`}
                  onClick={() => updateNodeParams(node.id, { lines: toggleLineOff(lines, i) })}
                  style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'right', font: `600 11px ${fontFamily.mono}`, color: line.off ? tk.status.warningText : tk.text.disabled, textDecoration: line.off ? 'line-through' : 'none' }}>{line.off ? '//' : i + 1}</button>
                <CodeInput
                  ariaLabel={`Line ${i + 1} target`}
                  placeholder="p.xy"
                  {...exprProps(line.lhs, v => updateLine(i, 'lhs', v), v => ({ lines: lines.map((l, j) => j === i ? { ...l, lhs: v } : l), result }))}
                />
                <Select
                  ariaLabel={`Line ${i + 1} operator`}
                  mono
                  height={34}
                  value={line.op}
                  options={OPS.map(op => ({ value: op, label: op }))}
                  onChange={v => updateLine(i, 'op', v)}
                />
                <CodeInput
                  ariaLabel={`Line ${i + 1} expression`}
                  placeholder="expression…"
                  {...exprProps(line.rhs, v => updateLine(i, 'rhs', v), v => ({ lines: lines.map((l, j) => j === i ? { ...l, rhs: v } : l), result }))}
                />
                <span style={{ display: 'flex', alignItems: 'center' }}>
                  <ProbeButton node={node} target={{ kind: 'line', index: i }} label={`Preview line ${i + 1}`} />
                  <IconButton icon="chevU" label="Move up" size="sm" tooltip={false} disabled={i === 0} onClick={() => moveLine(i, i - 1)} />
                  <IconButton icon="chevD" label="Move down" size="sm" tooltip={false} disabled={i === lines.length - 1} onClick={() => moveLine(i, i + 1)} />
                  <IconButton icon="close" label="Remove line" size="sm" tone="danger" tooltip={false} onClick={() => removeLine(i)} />
                </span>
              </div>
              {line.rhs.trim() && !line.off && <LineExplain node={node} index={i} line={line} ctx={explainCtx} dialogs={explainDialogs} />}
              </Fragment>
            ))}
            {lines.length === 0 && <Note>No lines yet. Each line assigns to a variable, top to bottom.</Note>}
            <AddRow onClick={addLine}>Add line</AddRow>
            <LinePreviewPanel node={node} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SectionLabel>Return</SectionLabel>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <TypeSelect value={outputType} options={TYPE_OPTIONS} onChange={t => changeOutputType(t as DataType)} ariaLabel="Return type" />
              <CodeInput
                ariaLabel="Return expression"
                placeholder="p"
                style={{ flex: 1 }}
                {...exprProps(result, updateResult, v => ({ lines, result: v }))}
              />
              <ProbeButton node={node} target={{ kind: 'return' }} label="Preview the return value" />
            </div>
            {result.trim() ? <LineExplain node={node} index="return" line={{ lhs: '', op: '', rhs: result }} ctx={explainCtx} dialogs={explainDialogs} /> : null}
            <Note>The final expression of type {outputType} that the block outputs.</Note>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SectionLabel meta="more sockets">Also outputs</SectionLabel>
            <Note>Any input or line variable can be an output socket too, as it is after the lines ran.</Note>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {candidates.length === 0 && <Note>Name a variable in a line (`float d = …`) to expose it.</Note>}
              {candidates.map(c => (
                <Chip key={c.name} mono active={exposed.includes(c.name)} dot={TYPE_COLORS[c.type] ?? tk.text.faint} title={`${c.type} · click to ${exposed.includes(c.name) ? 'stop exposing' : 'expose'} it`} onClick={() => toggleExposed(c.name)}>{c.name}</Chip>
              ))}
            </div>
          </div>
        </div>

        <SidePanel side="right" label="Functions" open={panels.functions} narrow={narrow} width={300} onClose={() => setPanel('functions', false)}>
          <ReferencePanel variables={customInputs} onInsert={insertFromReference} wrapAll={autoWrap} onWrapAllChange={setAutoWrap} onSnippet={insertSnippetLines} />
        </SidePanel>
        {explainDialogs.dialogs}
      </div>
    </Modal>
  );
}

/**
 * The Explain row under a line (or Return): the line as it compiles, explained; a part of its
 * expression can be made into a node and, if wanted, used here in its place.
 */
function LineExplain({ node, index, line, ctx, dialogs }: {
  node: GraphNode; index: number | 'return'; line: WarpLine; ctx: GeneraliseContext; dialogs: ReturnType<typeof useExplainDialogs>;
}) {
  const head = index === 'return' ? 'return ' : `${line.lhs} ${line.op || '='} `;
  const text = head + line.rhs;
  return (
    <ExplainRow text={text} exprStart={head.length} ctx={ctx} indent={index === 'return' ? 0 : 28}
      onFindUses={dialogs.findUses}
      onShowPicture={() => startLineProbe(node, index === 'return' ? { kind: 'return' } : { kind: 'line', index })}
      onMakeNode={span => {
        const rel = { start: span.start - head.length, end: span.end - head.length };
        dialogs.makeNode({ source: line.rhs, span: rel, ctx, useHere: exprBlockUseHere(node.id, index, rel) });
      }} />
  );
}

const smallField = (tk: ReturnType<typeof useTokens>): React.CSSProperties => ({
  width: 52, height: 26, boxSizing: 'border-box', padding: '0 6px', border: 0, outline: 'none', borderRadius: radius.md,
  background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.mono}`, textAlign: 'center',
});

function SectionLabel({ children, meta }: { children: React.ReactNode; meta?: string }) {
  const tk = useTokens();
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>
      <span style={{ flex: 1 }}>{children}</span>
      {meta && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 12 }}>{meta}</span>}
    </span>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <span style={{ fontSize: 12, lineHeight: 1.45, color: tk.text.muted }}>{children}</span>;
}

function AddRow({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
        border: `1.5px dashed ${hover ? tk.text.faint : tk.border.strong}`, borderRadius: radius.control,
        background: hover ? tk.bg.hover : 'none', color: tk.text.muted, font: `500 12.5px ${fontFamily.ui}`,
      }}
    >
      <Icon name="plus" size={15} />{children}
    </button>
  );
}
