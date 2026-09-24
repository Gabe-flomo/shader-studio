import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from './Icon';
import type { IconName } from './iconPaths';

export type MenuItem =
  | { label: string; icon?: IconName; hint?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | 'separator';

const MARGIN = 8;

/**
 * Context/popup menu opened at a viewport point. Closes on outside click, Esc, or selecting an
 * item; ↑/↓ + Enter work from the keyboard. Kept inside the viewport.
 */
export function Menu({ x, y, items, onClose, minWidth = 190 }: {
  x: number;
  y: number;
  items: readonly MenuItem[];
  onClose: () => void;
  minWidth?: number;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  const selectable = items.map((it, i) => (it !== 'separator' && !it.disabled ? i : -1)).filter(i => i >= 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - r.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - r.height - MARGIN)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectable.length === 0) return;
        const at = selectable.indexOf(active);
        const next = e.key === 'ArrowDown' ? (at + 1) % selectable.length : (at - 1 + selectable.length) % selectable.length;
        setActive(selectable[next]);
      }
      if (e.key === 'Enter' && active >= 0) {
        const it = items[active];
        if (it !== 'separator') { it.onSelect(); onClose(); }
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [active, items, onClose, selectable]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed', left: pos.left, top: pos.top, zIndex: 9000, minWidth, padding: 4,
        background: tk.bg.panel, borderRadius: 10, boxShadow: tk.shadow.popover, font: `12.5px ${fontFamily.ui}`,
      }}
    >
      {items.map((it, i) => it === 'separator'
        ? <div key={i} style={{ height: 1, background: tk.border.subtle, margin: '4px 2px' }} />
        : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => { it.onSelect(); onClose(); }}
            style={{
              width: '100%', height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', border: 0,
              borderRadius: radius.md - 1, background: active === i ? tk.bg.field : 'transparent', textAlign: 'left',
              color: it.danger ? tk.status.danger : tk.text.primary, font: 'inherit', cursor: 'pointer',
              opacity: it.disabled ? 0.45 : 1,
            }}
          >
            {it.icon && <Icon name={it.icon} size={15} style={{ color: it.danger ? tk.status.danger : tk.text.muted }} />}
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.hint && <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>{it.hint}</span>}
          </button>
        ))}
    </div>,
    document.body,
  );
}
