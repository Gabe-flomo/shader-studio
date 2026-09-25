import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from './Button';
import { Icon } from './Icon';
import type { IconName } from './iconPaths';

/**
 * Modal shell: scrim over the live app, 16px panel, 60px header (tinted icon tile, title,
 * subtitle naming what's being edited, actions, close) and an optional 64px footer
 * (secondary actions left, one primary right). Esc and the scrim close it; focus moves into
 * the panel on open and back to the opener on close.
 */
export function Modal({
  title, subtitle, icon, iconColor, headerActions, footer, onClose, width = 480, height, children, closeOnScrim = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  /** Kind colour for the icon tile, e.g. tk.kind.fn. Defaults to the accent. */
  iconColor?: string;
  headerActions?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
  height?: number;
  children: ReactNode;
  closeOnScrim?: boolean;
}) {
  const tk = useTokens();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Captured during the first render, before any child's autoFocus moves focus into the panel.
  const [opener] = useState(() => (typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null));

  useEffect(() => {
    // A child that asked for focus (a text field's autoFocus) keeps it; otherwise the panel takes it.
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A field with its own open popup (autocomplete) handles Esc itself
      if (e.key === 'Escape' && !(e.target as HTMLElement | null)?.closest?.('[data-captures-escape]')) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      opener?.focus?.();
    };
  }, [opener]);

  const tile = iconColor ?? tk.accent.base;
  return createPortal(
    <div
      onPointerDown={e => { if (closeOnScrim && e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: tk.bg.scrim,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={{
          width, maxWidth: '100%', height, maxHeight: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: tk.bg.panel, color: tk.text.primary, borderRadius: radius.modal, boxShadow: tk.shadow.modal,
          font: `12.5px ${fontFamily.ui}`, outline: 'none',
        }}
      >
        <div style={{ height: 60, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px 0 16px', borderBottom: `1px solid ${tk.border.subtle}` }}>
          {icon && (
            <span style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tile, 0.12), color: tile }}>
              <Icon name={icon} />
            </span>
          )}
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
            <b style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>{title}</b>
            {subtitle && <span style={{ fontSize: 12, color: tk.text.muted }}>{subtitle}</span>}
          </span>
          {headerActions}
          <IconButton icon="close" label="Close" shortcut="esc" onClick={onClose} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{children}</div>
        {footer && (
          <div style={{ height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px 0 20px', borderTop: `1px solid ${tk.border.subtle}` }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
