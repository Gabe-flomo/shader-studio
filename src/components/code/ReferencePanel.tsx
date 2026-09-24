import { useState } from 'react';
import { TYPE_COLORS } from '../NodeGraph/typeColors';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { GLSL_REFERENCE, REFERENCE_GROUPS } from './glslReference';

const OPERATORS = ['+', '-', '*', '/', '()', '.', ','];

/**
 * Right-hand column of the code editors: the node's variables and the GLSL reference as chips.
 * Clicking inserts at the caret of the last-focused field; with "Wrap selection" on, a function
 * wraps the whole expression instead. Chips never take focus, so the caret stays put.
 */
export function ReferencePanel({
  variables, onInsert, wrapAll, onWrapAllChange, showOperators = true, width = 300,
}: {
  variables: ReadonlyArray<{ name: string; type: string }>;
  onInsert: (text: string) => void;
  wrapAll: boolean;
  onWrapAllChange: (on: boolean) => void;
  showOperators?: boolean;
  width?: number;
}) {
  const tk = useTokens();
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();

  const chip = (key: string, label: React.ReactNode, onClick: () => void, title?: string, dot?: string) => (
    <button
      key={key}
      type="button"
      title={title}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      style={{
        height: 26, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', border: 0, borderRadius: 7, cursor: 'pointer',
        background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, color: tk.text.primary,
        font: `500 11.5px ${fontFamily.mono}`, whiteSpace: 'nowrap',
      }}
    >
      {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />}
      {label}
    </button>
  );
  const section = (label: string, children: React.ReactNode) => (
    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{children}</div>
    </div>
  );

  const vars = variables.filter(v => v.name && (!q || v.name.toLowerCase().includes(q)));
  return (
    <div style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', background: tk.bg.subtle, borderLeft: `1px solid ${tk.border.subtle}`, minHeight: 0 }}>
      <div style={{ padding: '14px 14px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field
          leading={<Icon name="search" size={15} style={{ color: tk.text.faint }} />}
          placeholder="Filter functions…"
          aria-label="Filter functions"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          height={32}
          style={{ background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: tk.text.muted }}>Click to insert</span>
          <Toggle checked={wrapAll} onChange={onWrapAllChange} label="Wrap all" />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {vars.length > 0 && section('Variables', vars.map(v => chip(`v-${v.name}`, v.name, () => onInsert(v.name), `${v.name} (${v.type})`, TYPE_COLORS[v.type] ?? tk.text.faint)))}
        {showOperators && !q && section('Operators', OPERATORS.map(op => chip(`o-${op}`, op, () => onInsert(op === '()' || op === '.' || op === ',' ? op : ` ${op} `))))}
        {REFERENCE_GROUPS.map(group => {
          const items = GLSL_REFERENCE.filter(r => r.group === group && (!q || r.name.toLowerCase().includes(q)));
          if (items.length === 0) return null;
          return section(group, items.map(r => chip(
            r.name,
            r.sig ? <>{r.name}<span style={{ color: tk.text.faint }}>{r.sig.replace(/\b(float|vec2|vec3|vec4) (\w+)/g, '$2')}</span></> : r.name,
            () => onInsert(r.insert),
            `${r.name}${r.sig ?? ''}${r.returns ? ` → ${r.returns}` : ''}\n${r.doc}`,
          )));
        })}
        {q && vars.length === 0 && GLSL_REFERENCE.every(r => !r.name.toLowerCase().includes(q)) && (
          <span style={{ fontSize: 12, color: tk.text.muted, padding: '8px 0' }}>Nothing matches “{filter}”.</span>
        )}
      </div>
    </div>
  );
}

