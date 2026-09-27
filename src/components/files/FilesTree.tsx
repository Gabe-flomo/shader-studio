/**
 * The Files page's tree: sections, the user's folders, the things in them
 * and what is inside those, as deep as it goes. Selecting a row shows it on
 * the right; the chevron opens it here.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { formatSize } from '../../utils/library';
import type { FileNode } from '../../files/inventory';
import { iconFor, tintFor } from './fileUiShared';

export function FilesTree({ sections, current, expanded, onToggle, onSelect }: {
  sections: FileNode[];
  current: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div role="tree" aria-label="Everything saved" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {sections.map(s => <Row key={s.id} node={s} depth={0} current={current} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />)}
    </div>
  );
}

function Row({ node, depth, current, expanded, onToggle, onSelect }: { node: FileNode; depth: number; current: string | null; expanded: Set<string>; onToggle: (id: string) => void; onSelect: (id: string) => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const kids = node.treeLeaf ? [] : node.children ?? [];
  const open = expanded.has(node.id);
  const active = current === node.id;
  const section = depth === 0;
  const empty = section && kids.length === 0;
  return (
    <>
      <div
        role="treeitem"
        aria-expanded={kids.length ? open : undefined}
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        onClick={() => onSelect(node.id)}
        onKeyDown={e => {
          if (e.key === 'ArrowRight' && kids.length && !open) { e.preventDefault(); onToggle(node.id); }
          if (e.key === 'ArrowLeft' && open) { e.preventDefault(); onToggle(node.id); }
          if (e.key === 'Enter') onSelect(node.id);
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          height: section ? 32 : 28, display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 + depth * 14, paddingRight: 8,
          borderRadius: radius.md, cursor: 'pointer', outline: 'none', flexShrink: 0,
          background: active ? tk.bg.selected : hover ? tk.bg.hover : 'transparent',
          color: active ? tk.accent.text : empty ? tk.text.faint : tk.text.secondary,
          font: `${section ? 600 : active ? 600 : 500} ${section ? 12.5 : 12}px ${fontFamily.ui}`,
        }}
      >
        <button
          type="button"
          aria-label={open ? `Close ${node.label}` : `Open ${node.label}`}
          tabIndex={-1}
          onClick={e => { e.stopPropagation(); if (kids.length) onToggle(node.id); }}
          style={{ width: 16, height: 20, padding: 0, border: 0, background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint, cursor: kids.length ? 'pointer' : 'default', visibility: kids.length ? 'visible' : 'hidden', flexShrink: 0 }}
        >
          <Icon name={open ? 'chevD' : 'chevR'} size={12} />
        </button>
        <Icon name={iconFor(node)} size={section ? 15 : 14} style={{ flexShrink: 0, color: active ? tk.accent.base : node.kind === 'folder' ? tintFor(tk, node) : tk.text.muted }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span>
        {node.unused && <span title={node.unused} style={{ width: 6, height: 6, borderRadius: 3, background: tk.status.warning, flexShrink: 0 }} />}
        <span style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.faint, flexShrink: 0 }}>{node.size ? formatSize(node.size) : ''}</span>
      </div>
      {open && kids.map(c => <Row key={c.id} node={c} depth={depth + 1} current={current} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />)}
    </>
  );
}
