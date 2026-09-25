import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Icon } from './Icon';
import { toneStyle } from './tone';
import { useToastStore, type Toast } from './toastStore';

const AUTO_DISMISS_MS = 5000;

/** Renders the toast stack (bottom centre, above everything). Mount once near the app root. */
export function Toaster() {
  const toasts = useToastStore(s => s.toasts);
  return createPortal(
    <div
      aria-live="polite"
      style={{
        position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 11000,
        display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none',
      }}
    >
      {toasts.map(t => <ToastCard key={t.id} toast={t} />)}
    </div>,
    document.body,
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const tk = useTokens();
  const dismiss = useToastStore(s => s.dismiss);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const { color, icon } = toneStyle(tk, toast.tone);
  const sticky = toast.tone === 'danger' || !!toast.sticky;

  useEffect(() => {
    if (sticky || hovered) return;
    const id = window.setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [sticky, hovered, dismiss, toast.id]);

  const btn = { border: 0, background: 'none', padding: 0, cursor: 'pointer', font: `600 12px ${fontFamily.ui}` } as const;

  return (
    <div
      role={sticky ? 'alert' : 'status'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        pointerEvents: 'auto', width: 380, maxWidth: 'calc(100vw - 32px)', display: 'flex', gap: 10, padding: '11px 12px 11px 14px',
        borderRadius: 12, background: tk.bg.panel, boxShadow: `${tk.shadow.popover}, inset 3px 0 0 ${color}`,
        font: `12.5px/1.45 ${fontFamily.ui}`, color: tk.text.secondary,
      }}
    >
      <span style={{ color, marginTop: 1 }}><Icon name={icon} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: tk.text.primary }}>{toast.title}</div>
        {toast.message && <div style={{ marginTop: 2 }}>{toast.message}</div>}
        {(toast.action || toast.details) && (
          <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
            {toast.action && (
              <button type="button" style={{ ...btn, color: tk.accent.text }}
                onClick={() => { toast.action?.onClick(); dismiss(toast.id); }}>{toast.action.label}</button>
            )}
            {toast.details && (
              <button type="button" style={{ ...btn, color: tk.text.muted }}
                onClick={() => navigator.clipboard?.writeText(toast.details ?? '').then(() => setCopied(true), () => {})}>
                {copied ? 'Copied' : 'Copy details'}
              </button>
            )}
          </div>
        )}
      </div>
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}
        style={{ border: 0, background: 'none', padding: 0, height: 18, cursor: 'pointer', color: tk.text.faint }}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
