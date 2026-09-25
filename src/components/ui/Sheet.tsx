import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { IconButton } from './Button';
import { portalGuard } from './portalGuard';

/**
 * Phone bottom sheet: scrim, 24px top corners, grab handle, optional title row with close, and a
 * scrolling body. Tapping the scrim or pressing Esc closes it. `maxHeight` is a CSS length.
 */
export function Sheet({ title, onClose, children, maxHeight = '80dvh', headerExtra }: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  maxHeight?: string;
  headerExtra?: ReactNode;
}) {
  const tk = useTokens();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div
      {...portalGuard}
      onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: tk.bg.scrim, display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxHeight, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
          background: tk.bg.panel, color: tk.text.primary, borderRadius: '24px 24px 0 0', boxShadow: '0 -12px 40px rgba(20,20,30,0.16)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)', font: `13px ${fontFamily.ui}`,
        }}
      >
        <div style={{ height: 22, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 40, height: 4, borderRadius: 2, background: tk.border.strong }} />
        </div>
        {title !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 10px 18px', flexShrink: 0 }}>
            <span style={{ flex: 1, fontSize: 17, fontWeight: 650 }}>{title}</span>
            {headerExtra}
            <IconButton icon="close" label="Close" tooltip={false} onClick={onClose} style={{ width: 40, height: 40 }} />
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px 20px' }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
