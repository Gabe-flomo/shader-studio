import type { ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

/**
 * Small pill: function/variable chips in editors, category tags, counts. `dot` adds a colour dot
 * (a data type or category); `onClick` makes it a button.
 */
export function Chip({
  children, dot, active = false, mono = true, onClick, title,
}: {
  children: ReactNode;
  dot?: string;
  active?: boolean;
  mono?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const tk = useTokens();
  const style = {
    height: 26, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', borderRadius: radius.md - 1,
    border: 0, background: active ? tk.bg.selected : tk.bg.panel, color: tk.text.primary, whiteSpace: 'nowrap' as const,
    boxShadow: `inset 0 0 0 ${active ? 1.5 : 1}px ${active ? tk.accent.base : tk.border.default}`,
    font: `500 11.5px ${mono ? fontFamily.mono : fontFamily.ui}`, cursor: onClick ? 'pointer' : 'default',
  };
  const content = (
    <>
      {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
      {children}
    </>
  );
  return onClick
    ? <button type="button" title={title} onClick={onClick} style={style}>{content}</button>
    : <span title={title} style={style}>{content}</span>;
}
