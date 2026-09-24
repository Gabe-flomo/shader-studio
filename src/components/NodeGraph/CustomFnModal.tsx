import React, { useMemo, useRef, useState } from 'react';
import type { GraphNode, DataType } from '../../types/nodeGraph';
import { useNodeGraphStore, saveCustomFnPreset } from '../../store/useNodeGraphStore';
import { NumberInput } from './NumberInput';
import { TYPE_COLORS } from './typeColors';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Field, TypeSelect } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toastStore';
import { CodeField } from '../code/CodeField';
import { ReferencePanel } from '../code/ReferencePanel';
import { buildCompletions } from '../code/glslReference';
import { insertSnippet } from '../code/useCompletion';

const TYPE_OPTIONS: DataType[] = ['float', 'vec2', 'vec3', 'vec4'];

// ─── CustomFnModal ────────────────────────────────────────────────────────────

interface Props {
  node: GraphNode;
  onClose: () => void;
}

export function CustomFnModal({ node, onClose }: Props) {
  const updateNodeParams  = useNodeGraphStore(s => s.updateNodeParams);
  const updateNodeSockets = useNodeGraphStore(s => s.updateNodeSockets);
  const tk = useTokens();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const fnRef   = useRef<HTMLTextAreaElement | null>(null);
  // Reference-panel clicks go to whichever code field was focused last
  const lastField = useRef<'body' | 'fns'>('body');
  const [autoWrap, setAutoWrap] = useState(false);
  const [showHelpers, setShowHelpers] = useState(() => typeof node.params.glslFunctions === 'string' && node.params.glslFunctions.trim() !== '');

  // Read current params
  const customInputs = (node.params.inputs as Array<{ name: string; type: DataType; slider?: { min: number; max: number } | null }>) || [];
  const outputType   = (node.params.outputType as DataType) || 'float';
  const body         = typeof node.params.body === 'string' ? node.params.body : '0.0';
  const glslFns      = typeof node.params.glslFunctions === 'string' ? node.params.glslFunctions : '';
  const labelParam   = typeof node.params.label === 'string' ? node.params.label : 'Custom Fn';

  const rawInputs = node.params.inputs;
  const completions = useMemo(
    () => buildCompletions((rawInputs as Array<{ name: string; type: DataType }> | undefined) ?? []),
    [rawInputs],
  );

  // ── Undo / Redo for body ────────────────────────────────────────────────────
  const bodyHistory      = useRef<string[]>([body]);
  const bodyHistoryIndex = useRef<number>(0);
  const [bodyHistoryPos, setBodyHistoryPos] = useState(0);
  const [bodyHistoryLen, setBodyHistoryLen] = useState(1);

  const pushBodyHistory = (newBody: string) => {
    const trimmed = bodyHistory.current.slice(0, bodyHistoryIndex.current + 1);
    trimmed.push(newBody);
    bodyHistory.current      = trimmed;
    bodyHistoryIndex.current = trimmed.length - 1;
    setBodyHistoryPos(bodyHistoryIndex.current);
    setBodyHistoryLen(trimmed.length);
  };

  const commitBody = (newBody: string) => {
    updateNodeParams(node.id, { body: newBody });
    pushBodyHistory(newBody);
  };

  const undoBody = () => {
    if (bodyHistoryIndex.current <= 0) return;
    bodyHistoryIndex.current -= 1;
    setBodyHistoryPos(bodyHistoryIndex.current);
    updateNodeParams(node.id, { body: bodyHistory.current[bodyHistoryIndex.current] });
    requestAnimationFrame(() => bodyRef.current?.focus());
  };

  const redoBody = () => {
    if (bodyHistoryIndex.current >= bodyHistory.current.length - 1) return;
    bodyHistoryIndex.current += 1;
    setBodyHistoryPos(bodyHistoryIndex.current);
    updateNodeParams(node.id, { body: bodyHistory.current[bodyHistoryIndex.current] });
    requestAnimationFrame(() => bodyRef.current?.focus());
  };

  const canUndoBody = bodyHistoryPos > 0;
  const canRedoBody = bodyHistoryPos < bodyHistoryLen - 1;

  const handleBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoBody(); else undoBody();
    } else if (mod && e.key === 'y') {
      e.preventDefault();
      redoBody();
    }
  };

  const handleBodyBlur = () => {
    const current = bodyHistory.current[bodyHistoryIndex.current];
    if (body !== current) pushBodyHistory(body);
  };

  const handleSavePreset = () => {
    // Read params directly from the node prop (always up-to-date via controlled inputs)
    // This avoids any store node-lookup issues (e.g. nodes inside group subgraphs).
    saveCustomFnPreset({
      label:         (node.params.label as string) || 'Custom Fn',
      inputs:        (node.params.inputs as Parameters<typeof saveCustomFnPreset>[0]['inputs']) ?? [],
      outputType:    ((node.params.outputType as string) || 'float') as Parameters<typeof saveCustomFnPreset>[0]['outputType'],
      body:          typeof node.params.body === 'string' ? node.params.body : '0.0',
      glslFunctions: typeof node.params.glslFunctions === 'string' ? node.params.glslFunctions : '',
    });
    toast.success(`Saved “${labelParam}” to Functions`);
  };

  // Insert a reference snippet into the last-focused field — wraps the selection, or the
  // whole body when "Wrap all" is on.
  const insertFromReference = (text: string) => {
    const isBody = lastField.current === 'body';
    const ta = isBody ? bodyRef.current : fnRef.current;
    const current = isBody ? body : glslFns;
    const start = ta?.selectionStart ?? current.length;
    const end = ta?.selectionEnd ?? current.length;
    const { next, caret } = insertSnippet(current, start, end, text, isBody && autoWrap);
    if (isBody) commitBody(next);
    else updateNodeParams(node.id, { glslFunctions: next });
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(caret, caret);
    });
  };

  // ── Inputs management ─────────────────────────────────────────────────────

  const addInput = () => {
    const newName = `in${customInputs.length}`;
    const next = [...customInputs, { name: newName, type: 'float' as DataType, slider: null as { min: number; max: number } | null }];
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
    // Changing type away from float clears any slider
    const next = customInputs.map((inp, i) =>
      i === idx ? { ...inp, type, slider: type !== 'float' ? null : inp.slider } : inp
    );
    updateNodeParams(node.id, { inputs: next });
    updateNodeSockets(node.id, next, outputType);
  };

  const toggleSlider = (idx: number) => {
    const inp = customInputs[idx];
    const newSlider = inp.slider ? null : { min: 0, max: 1 };
    // Initialize param value to midpoint when enabling
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

  const smallField: React.CSSProperties = {
    width: 60, height: 26, boxSizing: 'border-box', padding: '0 6px', border: 0, outline: 'none', borderRadius: radius.md,
    background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.mono}`, textAlign: 'center',
  };

  return (
    <Modal
      title="Custom Function"
      subtitle={`${labelParam} · Custom Fn node`}
      icon="fn"
      iconColor={tk.kind.fn}
      width={980}
      height={800}
      onClose={onClose}
      footer={
        <>
          <Button icon="export" onClick={handleSavePreset}>Save as preset</Button>
          <Note>Adds it to Functions in the sidebar</Note>
          <span style={{ flex: 1 }} />
          <Note>Changes apply live</Note>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </>
      }
    >
      <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Section label="Name">
            <Field value={labelParam} onChange={e => updateNodeParams(node.id, { label: e.target.value })} placeholder="Node name" aria-label="Node name" spellCheck={false} />
          </Section>

          <Section label="Inputs">
            {customInputs.map((inp, idx) => (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 104px auto 32px', gap: 8, alignItems: 'center' }}>
                  <Field
                    mono
                    leading={<span style={{ width: 9, height: 9, borderRadius: '50%', background: TYPE_COLORS[inp.type] ?? tk.text.faint, flexShrink: 0 }} />}
                    value={inp.name}
                    onChange={e => updateInputName(idx, e.target.value)}
                    spellCheck={false}
                    placeholder="name"
                    aria-label={`Input ${idx + 1} name`}
                  />
                  <TypeSelect value={inp.type} options={TYPE_OPTIONS} onChange={t => updateInputType(idx, t as DataType)} ariaLabel={`Input ${idx + 1} type`} />
                  {inp.type === 'float'
                    ? <Toggle checked={!!inp.slider} onChange={() => toggleSlider(idx)} label="Slider" />
                    : <span />}
                  <IconButton icon="close" label="Remove input" tone="danger" onClick={() => removeInput(idx)} />
                </div>
                {inp.slider && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 2, fontSize: 12, color: tk.text.muted }}>
                    Range
                    <NumberInput value={inp.slider.min} onCommit={n => updateSliderRange(idx, 'min', n)} step={0.1} style={smallField} />
                    to
                    <NumberInput value={inp.slider.max} onCommit={n => updateSliderRange(idx, 'max', n)} step={0.1} style={smallField} />
                    <span style={{ color: tk.text.faint }}>
                      now {typeof node.params[inp.name] === 'number' ? (node.params[inp.name] as number).toFixed(3) : '—'}
                    </span>
                  </div>
                )}
              </div>
            ))}
            <AddRow onClick={addInput}>Add input</AddRow>
          </Section>

          <Section label="Returns">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TypeSelect value={outputType} options={TYPE_OPTIONS} onChange={t => changeOutputType(t as DataType)} ariaLabel="Return type" />
              <Note>The body’s result becomes the node’s output.</Note>
            </div>
          </Section>

          <Section label="Body" grow>
            <CodeField
              grow
              minHeight={180}
              ariaLabel="Function body"
              value={body}
              onChange={v => updateNodeParams(node.id, { body: v })}
              completions={completions}
              textareaRef={el => { bodyRef.current = el; }}
              onFocus={() => { lastField.current = 'body'; }}
              onBlur={handleBodyBlur}
              onKeyDown={handleBodyKeyDown}
              actions={
                <>
                  <IconButton icon="undo" label="Undo" shortcut="cmd+z" size="sm" disabled={!canUndoBody} onClick={undoBody} />
                  <IconButton icon="redo" label="Redo" shortcut="cmd+shift+z" size="sm" disabled={!canRedoBody} onClick={redoBody} />
                </>
              }
            />
            <Note>Use your input names directly. Write a single expression, or a block that ends with <code>return</code>.</Note>
          </Section>

          <div style={{ borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              aria-expanded={showHelpers}
              onClick={() => setShowHelpers(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 0, background: 'none', cursor: 'pointer',
                color: tk.text.muted, font: `600 12.5px ${fontFamily.ui}`, textAlign: 'left',
              }}
            >
              <Icon name={showHelpers ? 'chevD' : 'chevR'} size={14} />
              Helper functions
              <span style={{ fontWeight: 400, color: tk.text.faint }}>optional · added before main()</span>
            </button>
            {showHelpers && (
              <CodeField
                title="Helper functions"
                minHeight={140}
                maxHeight={320}
                ariaLabel="Helper functions"
                value={glslFns}
                onChange={v => updateNodeParams(node.id, { glslFunctions: v })}
                completions={completions}
                textareaRef={el => { fnRef.current = el; }}
                onFocus={() => { lastField.current = 'fns'; }}
                placeholder={'// e.g.\nfloat sdBox(vec2 p, vec2 b) {\n  vec2 d = abs(p) - b;\n  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);\n}'}
              />
            )}
          </div>
        </div>

        <ReferencePanel
          variables={customInputs}
          onInsert={insertFromReference}
          wrapAll={autoWrap}
          onWrapAllChange={setAutoWrap}
        />
      </div>
    </Modal>
  );
}

function Section({ label, grow = false, children }: { label: string; grow?: boolean; children: React.ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: grow ? 1 : undefined, minHeight: grow ? 260 : undefined }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </div>
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
        height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
        border: `1.5px dashed ${hover ? tk.text.faint : tk.border.strong}`, borderRadius: radius.control,
        background: hover ? tk.bg.hover : 'none', color: tk.text.muted, font: `500 12.5px ${fontFamily.ui}`,
      }}
    >
      <Icon name="plus" size={15} />{children}
    </button>
  );
}
