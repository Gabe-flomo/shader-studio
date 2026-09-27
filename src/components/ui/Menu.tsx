import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from './Icon';
import type { IconName } from './iconPaths';
import { portalGuard } from './portalGuard';
import { menuAsSheet } from './menuSheet';

export type MenuItem =
  | { label: string; icon?: IconName; /** Tints the icon (a saved layer kind's colour). */ iconColor?: string; hint?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | 'separator'
  /** A small caps label over the items that follow it (not selectable). */
  | { heading: string };

const MARGIN = 8;

/**
 * Context/popup menu opened at a viewport point. Closes on outside click, Esc, or selecting an
 * item; ↑/↓ + Enter work from the keyboard. Kept inside the viewport.
 *
 * On phones it opens as a bottom sheet instead: a scrim, a grab handle, an optional title that
 * stays put, and the items in a scrolling list no taller than 80% of the screen, so a long menu
 * never runs off the bottom. Tapping the scrim closes it.
 */
export function Menu({ x, y, items, onClose, minWidth = 190, maxWidth = 360, title, sheet = 'auto' }: {
  x: number;
  y: number;
  items: readonly MenuItem[];
  onClose: () => void;
  minWidth?: number;
  /** Long hints wrap inside this, so a menu never grows to its longest sentence. */
  maxWidth?: number;
  /** Shown at the top of the phone sheet. */
  title?: string;
  /** 'auto': a sheet on phone-width screens. */
  sheet?: boolean | 'auto';
}) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const [asSheet] = useState(() => menuAsSheet(window.innerWidth, sheet));
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  const selectable = items.map((it, i) => (it !== 'separator' && !('heading' in it) && !it.disabled ? i : -1)).filter(i => i >= 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || asSheet) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - r.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - r.height - MARGIN)),
    });
  }, [x, y, asSheet]);

  useEffect(() => {
    // The sheet's scrim covers the page and closes it on a tap (not on the press, or the tap
    // would land on whatever the sheet uncovered).
    const onDown = (e: PointerEvent) => { if (!asSheet && !ref.current?.contains(e.target as Node)) onClose(); };
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
        if (it !== 'separator' && !('heading' in it)) { it.onSelect(); onClose(); }
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [active, items, onClose, selectable, asSheet]);

  const rows = items.map((it, i) => {
    if (it === 'separator') return <div key={i} style={{ height: 1, background: tk.border.subtle, margin: asSheet ? '6px 4px' : '4px 2px' }} />;
    if ('heading' in it) return <div key={i} role="presentation" style={{ padding: asSheet ? '12px 12px 4px' : '8px 10px 3px', color: tk.text.faint, font: `700 ${asSheet ? 11 : 10}px ${fontFamily.ui}`, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{it.heading}</div>;
    // A short hint (a shortcut, "Rotation 0°") sits at the right; a sentence goes under the label.
    const long = !!it.hint && it.hint.length > 28;
    return (
      <button
        key={i}
        type="button"
        role="menuitem"
        disabled={it.disabled}
        onMouseEnter={() => setActive(i)}
        onClick={() => { it.onSelect(); onClose(); }}
        style={{
          width: '100%', minHeight: asSheet ? 46 : 30, display: 'flex', alignItems: long ? 'flex-start' : 'center', gap: asSheet ? 12 : 8,
          padding: asSheet ? (long ? '9px 12px' : '0 12px') : long ? '6px 10px' : '0 10px', border: 0,
          borderRadius: asSheet ? radius.lg : radius.md - 1, background: active === i ? tk.bg.field : 'transparent', textAlign: 'left',
          color: it.danger ? tk.status.danger : tk.text.primary, font: 'inherit', cursor: 'pointer',
          opacity: it.disabled ? 0.45 : 1,
        }}
      >
        {it.icon && <Icon name={it.icon} size={asSheet ? 18 : 15} style={{ color: it.danger ? tk.status.danger : it.iconColor ?? tk.text.muted, marginTop: long ? 1 : 0, flexShrink: 0 }} />}
        {long ? (
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span>{it.label}</span>
            <span style={{ font: `${asSheet ? 12.5 : 11.5}px/1.35 ${fontFamily.ui}`, color: tk.text.faint }}>{it.hint}</span>
          </span>
        ) : (
          <>
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.hint && <span style={{ font: `500 ${asSheet ? 12 : 11}px ${fontFamily.mono}`, color: tk.text.faint }}>{it.hint}</span>}
          </>
        )}
      </button>
    );
  });

  if (asSheet) {
    return createPortal(
      <div
        {...portalGuard}
        data-menu-sheet=""
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        style={{ position: 'fixed', inset: 0, zIndex: 9000, background: tk.bg.scrim, display: 'flex', alignItems: 'flex-end' }}
      >
        <div
          ref={ref}
          role="menu"
          aria-label={title}
          style={{
            width: '100%', maxHeight: '80dvh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
            background: tk.bg.panel, color: tk.text.primary, borderRadius: '20px 20px 0 0', boxShadow: '0 -12px 40px rgba(20,20,30,0.16)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)', font: `15px ${fontFamily.ui}`,
          }}
        >
          <div style={{ flexShrink: 0, borderBottom: title ? `1px solid ${tk.border.subtle}` : undefined }}>
            <div style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: 40, height: 4, borderRadius: 2, background: tk.border.strong }} />
            </div>
            {title && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 8px 18px' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `650 16px ${fontFamily.ui}` }}>{title}</span>
                <button type="button" aria-label="Close" onClick={onClose}
                  style={{ width: 40, height: 40, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: radius.control, background: 'transparent', color: tk.text.muted, cursor: 'pointer' }}>
                  <Icon name="close" size={18} />
                </button>
              </div>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '6px 8px 12px' }}>{rows}</div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      {...portalGuard}
      ref={ref}
      role="menu"
      style={{
        position: 'fixed', left: pos.left, top: pos.top, zIndex: 9000, minWidth, maxWidth: `min(${maxWidth}px, calc(100vw - 16px))`, maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto', padding: 4,
        background: tk.bg.panel, borderRadius: 10, boxShadow: tk.shadow.popover, font: `12.5px ${fontFamily.ui}`,
      }}
    >
      {rows}
    </div>,
    document.body,
  );
}
