import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from './Button';
import { Icon } from './Icon';
import type { IconName } from './iconPaths';
import { portalGuard } from './portalGuard';
import { usePhoneDialog } from './phoneDialog';

/** Open modals, oldest first: Esc closes only the one on top (a dialog opened from an editor). */
const openModals: number[] = [];
let nextModalId = 1;

/**
 * Modal shell: scrim over the live app, 16px panel, 60px header (tinted icon tile, title,
 * subtitle naming what's being edited, actions, close) and an optional 64px footer
 * (secondary actions left, one primary right). Esc and the scrim close it; focus moves into
 * the panel on open and back to the opener on close. On a phone (phoneDialog.ts) the panel
 * fills the screen: the body scrolls, the header and footer stay, and the footer grows when
 * its buttons stack.
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
  const [modalId] = useState(() => nextModalId++);
  useEffect(() => {
    openModals.push(modalId);
    return () => { const i = openModals.indexOf(modalId); if (i >= 0) openModals.splice(i, 1); };
  }, [modalId]);

  useEffect(() => {
    // A child that asked for focus (a text field's autoFocus) keeps it; otherwise the panel takes it.
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A field with its own open popup (autocomplete) handles Esc itself
      if (e.key === 'Escape' && openModals[openModals.length - 1] === modalId && !(e.target as HTMLElement | null)?.closest?.('[data-captures-escape]')) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      opener?.focus?.();
    };
  }, [opener, modalId]);

  const tile = iconColor ?? tk.accent.base;
  const phone = usePhoneDialog();
  return createPortal(
    <div
      {...portalGuard}
      onPointerDown={e => { e.stopPropagation(); if (closeOnScrim && e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: tk.bg.scrim,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: phone ? 0 : 16,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        style={{
          width: phone ? '100%' : width, maxWidth: '100%', height: phone ? '100%' : height, maxHeight: '100%',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box',
          background: tk.bg.panel, color: tk.text.primary, borderRadius: phone ? 0 : radius.modal, boxShadow: tk.shadow.modal,
          paddingTop: phone ? 'env(safe-area-inset-top, 0px)' : undefined, paddingBottom: phone ? 'env(safe-area-inset-bottom, 0px)' : undefined,
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
          <IconButton icon="close" label="Close" shortcut="esc" onClick={onClose} style={phone ? { width: 40, height: 40 } : undefined} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' }}>{children}</div>
        {footer && (
          <div style={{ minHeight: 64, boxSizing: 'border-box', flexShrink: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: phone ? '12px 16px' : '12px 16px 12px 20px', borderTop: `1px solid ${tk.border.subtle}` }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
