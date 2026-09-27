/**
 * InputExprPopover — the small editor for an input expression: one GLSL line,
 * rooted in `input`, that modifies what arrives at a float input. Opens from
 * the ƒ mark on a card's input row (a popover), or on a phone from the ƒ chip
 * on the node view's input row (a bottom sheet). Shows the names the
 * expression may use as chips (click inserts), checks the line as you type,
 * applies on Enter or Done, and Remove clears it. The raw input (wire, slider,
 * keyframes, Play control) is untouched: the expression is a layer on top.
 *
 * Knobs: a name the expression makes up (`k` in `input * k`) can become a
 * slider. The check offers "Make k a knob" for a new name, and "Add a knob"
 * inserts a fresh one. Each knob has a value and a range here; once applied
 * it is a slider under the expression on the card, a uniform in the shader.
 */
import { useMemo, useRef, useState, type RefObject } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { nowParamValue } from '../../lib/nowValue';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import {
  freezeKnobInExpr, getInputExpr, getInputKnobs, inputExprPatch, inputExprVariables, knobCandidates, knobParamKey, knobValue, knobVariables,
  nextKnobName, validateInputExpr, type InputKnob,
} from '../../glsl/inputExpr';
import { CodeInput } from '../code/CodeField';
import { buildCompletions } from '../code/glslReference';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { RulerSlider } from '../ui/RulerSlider';

const EXAMPLES = ['input * 2.0', 'input + sin(t)', 'fract(input)', 'smoothstep(0.0, 1.0, input)', 'input * (0.5 + 0.5 * sin(t * 0.5))'];

/** The default range for a new knob. */
const NEW_KNOB: Omit<InputKnob, 'name'> = { min: 0, max: 2 };

export function InputExprPopover({ node, inputKey, anchorRef, onClose, sheet = false }: {
  node: GraphNode;
  inputKey: string;
  /** The ƒ mark it opens from (the popover's anchor). Unused as a sheet. */
  anchorRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** A phone bottom sheet instead of a popover. */
  sheet?: boolean;
}) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const def = getNodeDefinitionFor(node);
  const existing = getInputExpr(node, inputKey);
  const applied = useMemo(() => getInputKnobs(node, inputKey), [node, inputKey]);
  const [draft, setDraft] = useState(existing ?? '');
  const [knobs, setKnobs] = useState<InputKnob[]>(applied);
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(applied.map(k => [k.name, knobValue(node, inputKey, k.name)])));
  const base = useMemo(() => inputExprVariables(node, def, inputKey), [node, def, inputKey]);
  const variables = useMemo(() => [...base, ...knobVariables(knobs)], [base, knobs]);
  const completions = useMemo(() => buildCompletions(variables), [variables]);
  const check = useMemo(() => (draft.trim() ? validateInputExpr(draft, variables) : null), [draft, variables]);
  const candidates = useMemo(() => knobCandidates(draft, variables), [draft, variables]);
  const inputEl = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);
  const label = node.inputs[inputKey]?.label ?? inputKey;
  const touch = sheet;

  const apply = () => {
    const e = draft.trim();
    if (!e) { remove(); return; }
    if (!validateInputExpr(e, variables).ok) return;
    const clamped = Object.fromEntries(knobs.map(k => [k.name, Math.min(k.max, Math.max(k.min, values[k.name] ?? (k.min + k.max) / 2))]));
    updateNodeParams(node.id, inputExprPatch(node, inputKey, e, knobs, clamped));
    onClose();
  };
  const remove = () => {
    if (existing) updateNodeParams(node.id, inputExprPatch(node, inputKey, '', []));
    onClose();
  };
  /** Put `text` at the caret, spaced from what's before it. */
  const insert = (text: string) => {
    const el = inputEl.current;
    const at = el ? (el.selectionStart ?? draft.length) : (caret.current ?? draft.length);
    const before = draft.slice(0, at), after = draft.slice(at);
    const pad = before && !/[\s(,*+\-/]$/.test(before) ? ' ' : '';
    const next = `${before}${pad}${text}${after}`;
    setDraft(next);
    const end = at + pad.length + text.length;
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(end, end); });
  };
  const makeKnob = (name: string) => {
    setKnobs(ks => (ks.some(k => k.name === name) ? ks : [...ks, { name, ...NEW_KNOB }]));
    setValues(v => (name in v ? v : { ...v, [name]: 1 }));
  };
  const addKnob = () => {
    const name = nextKnobName(base, knobs, draft);
    makeKnob(name);
    // After a value (input, 2.0, a closing paren) a bare name would be a syntax error: multiply by it.
    const at = inputEl.current?.selectionStart ?? caret.current ?? draft.length;
    insert(/[\w.)]\s*$/.test(draft.slice(0, at)) ? `* ${name}` : name);
  };
  const setKnob = (name: string, patch: Partial<InputKnob>) => setKnobs(ks => ks.map(k => (k.name === name ? { ...k, ...patch } : k)));
  const setValue = (name: string, v: number) => {
    setValues(vs => ({ ...vs, [name]: v }));
    // An applied knob is live: its slider on the card moves too (a uniform write, no recompile).
    if (applied.some(k => k.name === name)) updateNodeParams(node.id, { [knobParamKey(inputKey, name)]: v });
  };
  /** Removing a knob freezes it: the line keeps the value it has right now (slider, keyframes or Play) as a number. */
  const dropKnob = (name: string) => {
    setKnobs(ks => ks.filter(k => k.name !== name));
    const v = applied.some(k => k.name === name) ? nowParamValue(node, knobParamKey(inputKey, name), values[name] ?? 1) : values[name] ?? 1;
    setDraft(d => freezeKnobInExpr(d, name, v));
  };

  const unknownIsKnobbable = !!check && !check.ok && candidates.length > 0 && /isn.t available here$/.test(check.error ?? '');
  const statusColor = check && !check.ok && !unknownIsKnobbable ? tk.status.danger : tk.text.faint;
  const used = new Set(draft.match(/\b[A-Za-z_]\w*\b/g) ?? []);

  const body = (
    <div onMouseDown={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!sheet && <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, flexShrink: 0, borderRadius: radius.sm, background: alpha(tk.kind.expr, 0.14), color: tk.kind.expr }}><Icon name="fn" size={13} /></span>}
        <div style={{ minWidth: 0 }}>
          {!sheet && <div style={{ font: `700 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Expression on {label}</div>}
          <div style={{ color: tk.text.muted, fontSize: sheet ? 12.5 : 11, lineHeight: 1.4 }}>Modifies what arrives at this input. <code style={{ font: `500 ${sheet ? 12 : 11}px ${fontFamily.mono}` }}>input</code> is the raw value: its wire, slider, keyframes or Play control.</div>
        </div>
      </div>
      <CodeInput
        ariaLabel={`Expression on ${label}`}
        placeholder={EXAMPLES[0]}
        value={draft}
        height={touch ? 40 : 34}
        completions={completions}
        onChange={setDraft}
        inputRef={el => { inputEl.current = el; }}
        onBlur={() => { caret.current = inputEl.current?.selectionStart ?? null; }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
      />
      <div style={{ minHeight: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, font: `500 11px ${fontFamily.ui}`, color: statusColor }}>
        {unknownIsKnobbable ? (
          <>
            <span>{candidates.length === 1 ? <><Mono>{candidates[0]}</Mono> is new here.</> : <>New names: {candidates.map((c, i) => <span key={c}>{i ? ', ' : ''}<Mono>{c}</Mono></span>)}.</>}</span>
            {candidates.map(c => (
              <button key={c} type="button" onClick={() => makeKnob(c)} style={{
                height: touch ? 30 : 22, padding: '0 8px', border: 0, borderRadius: radius.sm, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4, background: alpha(tk.kind.expr, 0.14), color: tk.kind.expr,
                font: `600 11px ${fontFamily.ui}`,
              }}><Icon name="sliders" size={11} />Make <Mono>{c}</Mono> a knob</button>
            ))}
          </>
        ) : check ? (check.ok ? 'Looks fine. Enter applies.' : check.error) : `Try ${EXAMPLES[1]} or ${EXAMPLES[2]}`}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {variables.map(v => (
          <button
            key={v.name}
            type="button"
            title={`${v.type} · ${v.doc}`}
            onClick={() => insert(v.name)}
            style={{
              height: touch ? 30 : 22, padding: touch ? '0 10px' : '0 7px', borderRadius: radius.sm, border: 0, cursor: 'pointer',
              background: v.name === 'input' || v.knob ? alpha(tk.kind.expr, 0.16) : tk.bg.field, color: v.name === 'input' || v.knob ? tk.kind.expr : tk.text.secondary,
              font: `500 ${touch ? 12.5 : 11}px ${fontFamily.mono}`,
            }}
          >{v.name}</button>
        ))}
        <button
          type="button"
          title="A named slider in the expression: it goes in at the cursor, and its slider sits under the expression on the card"
          onClick={addKnob}
          style={{
            height: touch ? 30 : 22, padding: touch ? '0 10px' : '0 7px', borderRadius: radius.sm, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', color: tk.kind.expr,
            border: `1px dashed ${alpha(tk.kind.expr, 0.5)}`, font: `600 ${touch ? 12.5 : 11}px ${fontFamily.ui}`,
          }}
        ><Icon name="plus" size={11} />Add a knob</button>
      </div>
      {knobs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0 2px', borderTop: `1px solid ${tk.border.subtle}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 10.5px ${fontFamily.ui}`, color: tk.text.faint, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            <span style={{ flex: 1 }}>Knobs</span>
            <span style={{ width: touch ? 50 : 44, textAlign: 'center' }}>Min</span>
            <span style={{ width: touch ? 50 : 44, textAlign: 'center' }}>Max</span>
            <span style={{ width: touch ? 32 : 26 }} />
          </div>
          {knobs.map(k => {
            const unused = !used.has(k.name);
            return (
              <div key={k.name} style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: unused ? 0.55 : 1 }} title={unused ? `${k.name} isn't in the expression: Done drops it` : undefined}>
                <span style={{ minWidth: 26, maxWidth: 64, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', font: `600 ${touch ? 13 : 11.5}px ${fontFamily.mono}`, color: tk.kind.expr }}>{k.name}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <RulerSlider value={values[k.name] ?? 0} min={k.min} max={k.max} step={Math.min(0.01, (k.max - k.min) / 200)}
                    onChange={v => setValue(k.name, v)} ariaLabel={`Knob ${k.name}`} touch={touch} />
                </div>
                <RangeField value={k.min} touch={touch} ariaLabel={`${k.name} minimum`} onCommit={n => { if (n < k.max) setKnob(k.name, { min: n }); }} />
                <RangeField value={k.max} touch={touch} ariaLabel={`${k.name} maximum`} onCommit={n => { if (n > k.min) setKnob(k.name, { max: n }); }} />
                <IconButton icon="close" label={`Remove the knob ${k.name}`} size="sm" tooltip={false} onClick={() => dropKnob(k.name)} style={touch ? { width: 32, height: 32 } : undefined} />
              </div>
            );
          })}
          <div style={{ color: tk.text.faint, fontSize: sheet ? 12 : 10.5, lineHeight: 1.4 }}>
            {sheet
              ? 'Each knob is also in this node’s value list, where you can add it to Play or key it.'
              : 'On the card each knob is a slider under the expression: right-click it to add it to Play, or ◆ to key it.'}
          </div>
        </div>
      )}
      <div style={{ color: tk.text.faint, fontSize: 10.5, lineHeight: 1.4 }}>Plus GLSL’s functions: sin, cos, fract, floor, abs, pow, mix, clamp, smoothstep, step, mod, min, max, length…</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {existing && <Button size={touch ? 'md' : 'sm'} variant="ghost" onClick={remove} style={{ color: tk.status.danger }}>Remove</Button>}
        <span style={{ flex: 1 }} />
        <Button size={touch ? 'md' : 'sm'} variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size={touch ? 'md' : 'sm'} variant="primary" disabled={!draft.trim() || (check !== null && !check.ok)} onClick={apply}>Done</Button>
      </div>
    </div>
  );

  if (sheet) return <Sheet title={`Expression on ${label}`} onClose={onClose} maxHeight="88dvh">{body}</Sheet>;
  // Open beside the card, not over it: its knob sliders (and the expression's row) stay in view.
  // Read when the popover measures (in its layout effect), not during render.
  const clearRef = cardOf(anchorRef);
  return (
    <Popover anchorRef={anchorRef ?? { current: null }} clearRef={clearRef} onClose={onClose} width={Math.min(380, (typeof window !== 'undefined' ? window.innerWidth : 380) - 24)} padding={12}>
      {body}
    </Popover>
  );
}

/** A ref-like handle on the card the anchor sits in, resolved each time it's read. */
function cardOf(anchorRef: RefObject<HTMLElement | null> | undefined): RefObject<HTMLElement | null> {
  return { get current() { return (anchorRef?.current?.closest('[data-node-id]') as HTMLElement | null) ?? null; } };
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code style={{ font: `600 11px ${fontFamily.mono}` }}>{children}</code>;
}

/** A small number field that commits on blur or Enter (a half-typed "-" never lands). */
function RangeField({ value, onCommit, ariaLabel, touch }: { value: number; onCommit: (n: number) => void; ariaLabel: string; touch: boolean }) {
  const tk = useTokens();
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) onCommit(n);
    setText(null);
  };
  return (
    <input
      aria-label={ariaLabel}
      inputMode="decimal"
      value={text ?? String(+value.toFixed(4))}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); } }}
      style={{
        width: touch ? 50 : 44, height: touch ? 32 : 24, boxSizing: 'border-box', flexShrink: 0, padding: '0 6px', border: 0, outline: 'none',
        borderRadius: radius.sm, background: tk.bg.field, color: tk.text.primary, textAlign: 'center',
        font: `500 ${touch ? 13 : 11}px ${fontFamily.mono}`,
      }}
    />
  );
}
