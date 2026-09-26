/**
 * InputExprPopover — the small editor for an input expression: one GLSL line,
 * rooted in `input`, that modifies what arrives at a float input. Opens from
 * the ƒ mark on a card's input row. Shows the names the expression may use as
 * chips (click inserts), checks the line as you type, applies on Enter or
 * Done, and Remove clears it. The raw input (wire, slider, keyframes, Play
 * control) is untouched: the expression is a layer on top.
 */
import { useMemo, useRef, useState, type RefObject } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { getInputExpr, inputExprKey, inputExprVariables, validateInputExpr } from '../../glsl/inputExpr';
import { CodeInput } from '../code/CodeField';
import { buildCompletions } from '../code/glslReference';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';

const EXAMPLES = ['input * 2.0', 'input + sin(t)', 'fract(input)', 'smoothstep(0.0, 1.0, input)', 'input * (0.5 + 0.5 * sin(t * 0.5))'];

export function InputExprPopover({ node, inputKey, anchorRef, onClose }: {
  node: GraphNode;
  inputKey: string;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const def = getNodeDefinitionFor(node);
  const existing = getInputExpr(node, inputKey);
  const [draft, setDraft] = useState(existing ?? '');
  const variables = useMemo(() => inputExprVariables(node, def, inputKey), [node, def, inputKey]);
  const completions = useMemo(() => buildCompletions(variables), [variables]);
  const check = useMemo(() => (draft.trim() ? validateInputExpr(draft, variables) : null), [draft, variables]);
  const inputEl = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);
  const label = node.inputs[inputKey]?.label ?? inputKey;

  const apply = () => {
    const e = draft.trim();
    if (!e) { remove(); return; }
    if (!validateInputExpr(e, variables).ok) return;
    updateNodeParams(node.id, { [inputExprKey(inputKey)]: e });
    onClose();
  };
  const remove = () => {
    if (existing) updateNodeParams(node.id, { [inputExprKey(inputKey)]: '' });
    onClose();
  };
  const insert = (name: string) => {
    const el = inputEl.current;
    const at = el ? (el.selectionStart ?? draft.length) : (caret.current ?? draft.length);
    const before = draft.slice(0, at), after = draft.slice(at);
    const pad = before && !/[\s(,*+\-/]$/.test(before) ? ' ' : '';
    const next = `${before}${pad}${name}${after}`;
    setDraft(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + pad.length + name.length, at + pad.length + name.length); });
  };

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={Math.min(360, (typeof window !== 'undefined' ? window.innerWidth : 360) - 24)} padding={12}>
      <div onMouseDown={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: radius.sm, background: alpha(tk.kind.expr, 0.14), color: tk.kind.expr }}><Icon name="fn" size={13} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ font: `700 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Expression on {label}</div>
            <div style={{ color: tk.text.muted, fontSize: 11, lineHeight: 1.4 }}>Modifies what arrives at this input. <code style={{ font: `500 11px ${fontFamily.mono}` }}>input</code> is the raw value: its wire, slider, keyframes or Play control.</div>
          </div>
        </div>
        <CodeInput
          ariaLabel={`Expression on ${label}`}
          placeholder={EXAMPLES[0]}
          value={draft}
          completions={completions}
          onChange={setDraft}
          inputRef={el => { inputEl.current = el; }}
          onBlur={() => { caret.current = inputEl.current?.selectionStart ?? null; }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
        />
        <div style={{ minHeight: 16, font: `500 11px ${fontFamily.ui}`, color: check && !check.ok ? tk.status.danger : tk.text.faint }}>
          {check ? (check.ok ? 'Looks fine. Enter applies.' : check.error) : `Try ${EXAMPLES[1]} or ${EXAMPLES[2]}`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {variables.map(v => (
            <button
              key={v.name}
              type="button"
              title={`${v.type} · ${v.doc}`}
              onClick={() => insert(v.name)}
              style={{
                height: 22, padding: '0 7px', borderRadius: radius.sm, border: 0, cursor: 'pointer',
                background: v.name === 'input' ? alpha(tk.kind.expr, 0.16) : tk.bg.field, color: v.name === 'input' ? tk.kind.expr : tk.text.secondary,
                font: `500 11px ${fontFamily.mono}`,
              }}
            >{v.name}</button>
          ))}
        </div>
        <div style={{ color: tk.text.faint, fontSize: 10.5, lineHeight: 1.4 }}>Plus GLSL’s functions: sin, cos, fract, floor, abs, pow, mix, clamp, smoothstep, step, mod, min, max, length…</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {existing && <Button size="sm" variant="ghost" onClick={remove} style={{ color: tk.status.danger }}>Remove</Button>}
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!draft.trim() || (check !== null && !check.ok)} onClick={apply}>Done</Button>
        </div>
      </div>
    </Popover>
  );
}
