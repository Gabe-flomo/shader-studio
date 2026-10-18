/**
 * browserParts.tsx — the pieces the sidebar's Nodes list is drawn with (NodeBrowser.tsx), shared so
 * the Library (components/library/Library.tsx) is drawn with the very same ones:
 *
 *   CapsLabel      a section's small caps heading, with a rule ("SOURCES ────")
 *   CategoryRow    a category you open: icon, name, count, chevron
 *   Crumb          inside a category: back, its name, its count
 *   Count          the grey count pill
 *   Pill           one thing in a category: click previews, double-click adds, drag places
 *   AddHint        the "Click to preview · double-click or drag…" line over the pills
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { nodeDragProps, nodeDragStyle, type DropPayload } from './nodeDrop';

export function Count({ n }: { n: number }) {
  const tk = useTokens();
  return <span style={{ fontSize: 11, color: tk.text.faint, background: tk.bg.hover, borderRadius: radius.sm, padding: '1px 6px', fontVariantNumeric: 'tabular-nums' }}>{n}</span>;
}

export function CapsLabel({ children, rule = false }: { children: ReactNode; rule?: boolean }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 2px 4px' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>{children}</span>
      {rule && <span style={{ flex: 1, height: 1, background: tk.border.subtle }} />}
    </div>
  );
}

export function CategoryRow({ label, icon, count, onClick, title, attrs }: {
  label: string; icon?: ReactNode; count: number; onClick: () => void; title?: string;
  /** data-* attributes (tests and styles find a row by them). */
  attrs?: Record<string, string>;
}) {
  const tk = useTokens();
  const [hovered, setHovered] = useState(false);
  return (
    <button
      {...attrs}
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 0 8px', border: 0,
        borderRadius: radius.md, background: hovered ? tk.bg.hover : 'transparent', cursor: 'pointer', textAlign: 'left',
        color: tk.text.secondary, font: `12.5px ${fontFamily.ui}`,
      }}
    >
      {icon && <span style={{ width: 14, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <Count n={count} />
      <Icon name="chevR" size={14} style={{ color: tk.text.disabled }} />
    </button>
  );
}

export function Crumb({ label, count, onBack }: { label: ReactNode; count: number; onBack: () => void }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      <IconButton icon="chevL" label="Back to categories" size="sm" onClick={onBack}
        style={{ background: tk.bg.hover, color: tk.text.secondary }} />
      <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 12.5, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <Count n={count} />
    </div>
  );
}

export function AddHint({ swap = false, noun = 'a node' }: { swap?: boolean; noun?: string }) {
  const tk = useTokens();
  return (
    <div data-add-hint="" style={{ color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}`, padding: '0 2px 6px' }}>
      Click {noun} to preview it · double-click{swap ? ' to replace' : ' or drag it onto the graph to add it'}
    </div>
  );
}

export function Pill({
  label, description, badge, lead,
  isSelected, isHighlighted = false,
  onSingleClick, onDoubleClick,
  swapMode = false, btnRef, drag, onDragEnd, attrs,
}: {
  label: string; description?: string; badge?: string;
  /** Drawn before the name (a picture's thumbnail in the Library). */
  lead?: ReactNode;
  isSelected: boolean; isHighlighted?: boolean;
  onSingleClick: () => void; onDoubleClick: () => void;
  swapMode?: boolean;
  btnRef?: (el: HTMLButtonElement | null) => void;
  /** Pressing and moving carries it to the graph (nodeDrop.ts); none when it can't be added by hand. */
  drag: DropPayload | null;
  onDragEnd?: () => void;
  attrs?: Record<string, string>;
}) {
  const tk = useTokens();
  const [hovered, setHovered] = useState(false);
  const on = isSelected || isHighlighted;
  return (
    <button
      {...attrs}
      ref={btnRef}
      title={`${description ? `${description}\n\n` : ''}Click to preview · Double-click to ${swapMode ? 'replace' : 'add'}${drag && !swapMode ? ' · or drag it onto the graph' : ''}`}
      {...nodeDragProps(swapMode ? null : drag, onDragEnd)}
      onClick={onSingleClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 28, maxWidth: '100%', display: 'inline-flex', alignItems: 'center', gap: 6, padding: lead ? '0 10px 0 4px' : '0 10px', border: 0, borderRadius: radius.md,
        background: on ? tk.bg.selected : hovered ? tk.bg.hover : tk.bg.field,
        boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none',
        color: on ? tk.accent.text : tk.text.secondary, font: `${on ? 600 : 500} 12.5px ${fontFamily.ui}`,
        cursor: swapMode ? 'pointer' : 'grab', ...nodeDragStyle, whiteSpace: 'nowrap',
        transition: 'background 0.12s, box-shadow 0.12s',
      }}
    >
      {lead}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {badge && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: tk.text.faint, background: tk.bg.hover, borderRadius: radius.sm, padding: '1px 5px' }}>{badge}</span>}
    </button>
  );
}
