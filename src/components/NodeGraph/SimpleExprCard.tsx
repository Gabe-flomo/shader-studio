/**
 * Simple Expression card (nodes/definitions/simpleExpr.ts, docs/simple-expression.md).
 *
 * SimpleExprInputName sits in each input row, beside the socket: the input's name (double-click to
 * rename; it must be a GLSL name), its type (“any” until a wire comes in, then the wire's type, in the
 * wire's colour), ↑ to move it and a bin to remove it. SimpleExprCardBody is under the rows: + Input, the Output type,
 * the one-line GLSL field (the app's CodeInput: highlighting, completions, the error edge) with what's
 * wrong or what it makes under it, a hint of the free names, and Convert to Expression Block.
 *
 * Card edits that change sockets go through replaceNodeInScope (one undo step, a compile at once);
 * typing in the field goes through updateNodeParams, whose text edits recompile after a pause.
 */
import { useMemo, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import {
  SIMPLE_EXPR_ENV, SIMPLE_EXPR_OUTPUTS, addSimpleExprVar, checkSimpleExprNode, moveSimpleExprVar, removeSimpleExprVar, renameSimpleExprVar,
  setSimpleExprOutput, simpleExprOutputType, simpleExprText, simpleExprToBlock, simpleExprVarType, simpleExprVars,
} from '../../nodes/definitions/simpleExpr';
import { CodeInput } from '../code/CodeField';
import { buildCompletions } from '../code/glslReference';
import { Icon } from '../ui/Icon';
import { TYPE_COLORS } from './typeColors';

const stop = {
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  onMouseUp: (e: React.MouseEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
};

/** Convert a Simple Expression to a full Expression Block, in place (same wires). */
export function convertSimpleExprToBlock(nodeId: string) {
  useNodeGraphStore.getState().replaceNodeInScope(nodeId, simpleExprToBlock, 'Converted a Simple Expression to an Expression Block');
}

/** One input row's name, type and ×, in the slot where a card shows a socket's label. */
export function SimpleExprInputName({ node, inputKey, touch = false }: { node: GraphNode; inputKey: string; touch?: boolean }) {
  const tk = useTokens();
  const replace = useNodeGraphStore(s => s.replaceNodeInScope);
  const v = simpleExprVars(node).find(x => x.key === inputKey);
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!v) return <span>{inputKey}</span>;
  const wired = !!node.inputs[inputKey]?.connection;
  const type = wired ? simpleExprVarType(node, inputKey) : null;
  const bad = type !== null && !['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3'].includes(type);
  const index = simpleExprVars(node).findIndex(x => x.key === inputKey);
  const count = simpleExprVars(node).length;

  const commit = () => {
    if (draft === null) return;
    const name = draft.trim();
    if (!name || name === v.name) { setDraft(null); setProblem(null); return; }
    let error: string | null = null;
    replace(node.id, n => {
      const r = renameSimpleExprVar(n, inputKey, name);
      if ('error' in r) { error = r.error; return n; }
      return r.node;
    }, `Renamed input ${v.name} to ${name}`);
    if (error) { setProblem(error); return; }
    setDraft(null); setProblem(null);
  };

  const small = touch ? 28 : 18;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }} data-simple-expr-input={v.name}>
      {draft !== null ? (
        <input
          autoFocus
          aria-label={`Name of input ${v.name}`}
          value={draft}
          spellCheck={false}
          title={problem ?? 'A GLSL name: letters, digits and _. Enter renames (the expression follows), Escape cancels.'}
          onChange={e => { setDraft(e.target.value); setProblem(null); }}
          {...stop}
          onBlur={() => { if (problem) { setDraft(null); setProblem(null); } else commit(); }}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setDraft(null); setProblem(null); }
          }}
          style={{
            width: 84, height: touch ? 30 : 22, background: tk.bg.panel, border: 0, outline: 'none', borderRadius: 5, padding: '0 6px',
            boxShadow: `inset 0 0 0 1.5px ${problem ? tk.status.danger : tk.accent.base}`, color: tk.text.primary, font: `600 12px ${fontFamily.mono}`,
          }}
        />
      ) : (
        <span
          title={`${v.name}: double-click to rename`}
          {...stop}
          onDoubleClick={e => { e.stopPropagation(); setDraft(v.name); }}
          style={{ font: `600 ${touch ? 13.5 : 12.5}px ${fontFamily.mono}`, color: tk.text.primary, cursor: 'text', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}
        >{v.name}</span>
      )}
      {problem && <span role="alert" style={{ font: `500 10.5px ${fontFamily.ui}`, color: tk.status.danger, maxWidth: 150, whiteSpace: 'normal', lineHeight: 1.25 }}>{problem}</span>}
      {!problem && (
        <span
          data-simple-expr-type={type ?? 'any'}
          title={type ? (bad ? `Wired to a ${type}: a Simple Expression reads numbers, vectors and matrices` : `${type}, from the wire into it`) : 'Any type: it takes the type of the wire you connect (a float 0.0 while unwired)'}
          style={{
            padding: '0 5px', borderRadius: 4, font: `600 10px ${fontFamily.mono}`, lineHeight: '15px', flexShrink: 0,
            color: bad ? tk.status.danger : type ? (TYPE_COLORS[type] ?? tk.text.secondary) : tk.text.faint,
            background: bad ? alpha(tk.status.danger, 0.14) : type ? alpha(TYPE_COLORS[type] ?? '#888', 0.14) : 'transparent',
            border: type ? '1px solid transparent' : `1px dashed ${tk.border.strong}`,
          }}
        >{type ?? 'any'}</span>
      )}
      {draft === null && (
        <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 2 }}>
          {count > 1 && (
            <button type="button" aria-label={`Move ${v.name} up`} title="Move up" disabled={index === 0} {...stop}
              onClick={e => { e.stopPropagation(); replace(node.id, n => moveSimpleExprVar(n, inputKey, -1), `Moved input ${v.name}`); }}
              style={iconBtn(tk.text.faint, small, index === 0)}><Icon name="chevU" size={11} /></button>
          )}
          <button type="button" aria-label={`Remove input ${v.name}`} title={`Remove ${v.name}${wired ? ' and its wire' : ''}`} {...stop}
            onClick={e => { e.stopPropagation(); replace(node.id, n => removeSimpleExprVar(n, inputKey), `Removed input ${v.name}`); }}
            style={iconBtn(tk.text.faint, small, false)}><Icon name="trash" size={11} /></button>
        </span>
      )}
    </span>
  );
}

function iconBtn(color: string, size: number, disabled: boolean): React.CSSProperties {
  return {
    width: size, height: size, padding: 0, border: 0, background: 'transparent', borderRadius: 4, color, cursor: disabled ? 'default' : 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1, touchAction: 'manipulation',
  };
}

/**
 * `rows`: also list the inputs (name, type, ×) here: the phone's node page, whose socket rows are its
 * own and have no slot for them.
 */
export function SimpleExprCardBody({ node, touch = false, rows = false }: { node: GraphNode; touch?: boolean; rows?: boolean }) {
  const tk = useTokens();
  const replace = useNodeGraphStore(s => s.replaceNodeInScope);
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const vars = simpleExprVars(node);
  const outT = simpleExprOutputType(node);
  const expr = simpleExprText(node);
  const check = useMemo(() => checkSimpleExprNode(node), [node]);
  const typed = useMemo(() => vars.map(v => ({ name: v.name, type: node.inputs[v.key]?.connection ? simpleExprVarType(node, v.key) : 'float' })), [vars, node]);
  const completions = useMemo(() => buildCompletions(typed, SIMPLE_EXPR_ENV.filter(e => !typed.some(t => t.name === e.name))), [typed]);

  const pill = (on: boolean): React.CSSProperties => ({
    height: touch ? 30 : 22, padding: touch ? '0 10px' : '0 7px', borderRadius: radius.sm, cursor: 'pointer',
    border: `1px solid ${on ? (TYPE_COLORS[outT] ?? tk.accent.base) : tk.border.default}`,
    background: on ? alpha(TYPE_COLORS[outT] ?? tk.accent.base, 0.16) : 'transparent',
    color: on ? tk.text.primary : tk.text.muted, font: `600 ${touch ? 12 : 10.5}px ${fontFamily.mono}`,
  });

  return (
    <div {...stop} data-simple-expr-card={node.id} style={{ padding: '2px 12px 10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows && vars.map(v => (
        <div key={v.key} style={{ display: 'flex', alignItems: 'center', minHeight: touch ? 36 : 24 }}>
          <SimpleExprInputName node={node} inputKey={v.key} touch={touch} />
        </div>
      ))}
      <button type="button" data-simple-expr-add=""
        title="Add an input. It takes the type of whatever you wire into it"
        onClick={() => replace(node.id, addSimpleExprVar, 'Added an input to a Simple Expression')}
        style={{
          alignSelf: 'flex-start', height: touch ? 32 : 22, padding: touch ? '0 12px' : '0 8px', borderRadius: radius.sm, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', color: tk.kind.expr,
          border: `1px dashed ${alpha(tk.kind.expr, 0.55)}`, font: `600 ${touch ? 12.5 : 11}px ${fontFamily.ui}`,
        }}><Icon name="plus" size={11} />Input</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span style={{ font: `600 11px ${fontFamily.ui}`, color: tk.text.muted, marginRight: 4 }}>Output</span>
        {SIMPLE_EXPR_OUTPUTS.map(t => (
          <button key={t} type="button" aria-pressed={t === outT} data-simple-expr-output={t} style={pill(t === outT)}
            onClick={() => replace(node.id, n => setSimpleExprOutput(n, t), `Simple Expression output: ${t}`)}>{t}</button>
        ))}
      </div>

      <CodeInput
        ariaLabel="Expression"
        placeholder="mix(a, b, smoothstep(0.2, 0.8, c))"
        value={expr}
        height={touch ? 40 : 30}
        completions={completions}
        invalid={!check.ok}
        inputAttrs={{ 'data-simple-expr-field': node.id }}
        onChange={v => update(node.id, { expr: v.replace(/\n/g, ' ') })}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      />
      <div role={check.ok ? undefined : 'alert'} data-simple-expr-status={check.ok ? 'ok' : 'error'}
        style={{ font: `500 ${touch ? 12 : 11}px ${fontFamily.ui}`, lineHeight: 1.4, color: check.ok ? tk.text.faint : tk.status.danger }}>
        {check.ok
          ? (check.note ?? (check.type ? `Makes ${check.type}` : `Gives ${outT}`))
          : `${check.error}. Until it's fixed this gives ${outT === 'float' ? '0.0' : `${outT}(0.0)`}.`}
      </div>
      <div style={{ font: `500 ${touch ? 11.5 : 10.5}px ${fontFamily.ui}`, lineHeight: 1.45, color: tk.text.faint }}>
        Use the inputs by name, <Code>t</Code> (seconds), <Code>uv</Code>, <Code>res</Code>, <Code>mouse</Code>, <Code>PI</Code>, <Code>TAU</Code> and GLSL functions.
      </div>
      <button type="button" data-simple-expr-convert=""
        title="Turn this into a full Expression Block (lines, loops, sliders), with the same inputs, wires and expression"
        onClick={() => convertSimpleExprToBlock(node.id)}
        style={{
          alignSelf: 'flex-start', height: touch ? 30 : 20, padding: '0 2px', border: 0, background: 'transparent', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4, color: tk.text.muted, font: `500 ${touch ? 12 : 10.5}px ${fontFamily.ui}`,
        }}><Icon name="expr" size={11} />Convert to Expression Block</button>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code style={{ font: `600 10.5px ${fontFamily.mono}` }}>{children}</code>;
}
