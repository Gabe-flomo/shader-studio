/**
 * The Nodes list in Files: every node type with code of its own, by
 * category, with a search; click one for its page.
 */
import { useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { listNodeTypes } from '../../present/nodeCode';
import { capsLabel, cardStyle } from './fileUiShared';

export function NodesListView({ compact, onOpenNode }: { compact: boolean; onOpenNode: (type: string) => void }) {
  const tk = useTokens();
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const list = listNodeTypes(q);
    const by = new Map<string, typeof list>();
    for (const e of list) { const l = by.get(e.category) ?? []; l.push(e); by.set(e.category, l); }
    return [...by.entries()];
  }, [q]);
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 14 : 18, padding: compact ? '14px 16px 40px' : '22px 28px 48px', maxWidth: 980, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ width: compact ? 36 : 42, height: compact ? 36 : 42, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}><Icon name="nodes" size={19} /></span>
        <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 style={{ margin: 0, font: `650 ${compact ? 17 : 20}px ${fontFamily.ui}`, letterSpacing: '-0.015em', color: tk.text.primary }}>Nodes</h1>
          <span style={{ fontSize: 12, color: tk.text.muted }}>{total} node type{total === 1 ? '' : 's'} with a page: what each does, its sockets, a live picture, its GLSL and the graphs that use it.</span>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderRadius: radius.control, background: tk.bg.field, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, width: compact ? '100%' : 220, boxSizing: 'border-box' }}>
          <Icon name="search" size={13} style={{ color: tk.text.faint }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search nodes" aria-label="Search nodes" style={{ flex: 1, minWidth: 0, border: 0, background: 'none', outline: 'none', color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }} />
        </label>
      </div>
      {groups.map(([cat, list]) => (
        <section key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...capsLabel(tk), padding: '0 4px' }}>{cat} · {list.length}</span>
          <div style={{ ...cardStyle(tk), display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1, overflow: 'hidden' }}>
            {list.map(e => <NodeRow key={e.type} label={e.label} description={e.description} onClick={() => onOpenNode(e.type)} />)}
          </div>
        </section>
      ))}
      {!groups.length && <span style={{ fontSize: 12.5, color: tk.text.faint, padding: 20, textAlign: 'center' }}>Nothing matches “{q}”.</span>}
    </div>
  );
}

function NodeRow({ label, description, onClick }: { label: string; description: string; onClick: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ border: 0, background: hover ? tk.bg.hover : tk.bg.panel, padding: '9px 12px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer', minWidth: 0, outline: `1px solid ${tk.border.subtle}` }}>
      <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{label}</span>
      <span style={{ fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{description || ' '}</span>
    </button>
  );
}
