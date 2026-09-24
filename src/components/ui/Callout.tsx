import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from './Icon';
import { toneStyle, type Tone } from './tone';

/**
 * Inline message box — the error box for things that fail inside a panel or modal (a shader
 * that won't compile, a recording that failed, a file that couldn't be read). Title says what
 * happened, the body says what to do; raw logs go in `details` behind a toggle, with a copy button.
 */
export function Callout({
  tone = 'danger', title, children, details, actions, onDismiss,
}: {
  tone?: Tone;
  title: ReactNode;
  children?: ReactNode;
  /** Raw error text (compiler log, stack). Collapsed by default, copyable. */
  details?: string;
  actions?: ReactNode;
  onDismiss?: () => void;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { color, icon } = toneStyle(tk, tone);
  const text = tone === 'warning' ? tk.status.warningText : color;

  const copy = () => {
    if (!details) return;
    navigator.clipboard?.writeText(details).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }, () => { /* clipboard blocked: the text is still selectable below */ });
  };

  const linkBtn = { border: 0, background: 'none', padding: 0, cursor: 'pointer', font: `600 12px ${fontFamily.ui}`, color: text } as const;

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      style={{
        display: 'flex', gap: 10, padding: '10px 12px', borderRadius: radius.lg - 2,
        background: alpha(color, 0.1), boxShadow: `inset 0 0 0 1px ${alpha(color, 0.25)}`,
        font: `12.5px/1.45 ${fontFamily.ui}`, color: tk.text.secondary,
      }}
    >
      <span style={{ color, marginTop: 1 }}><Icon name={icon} size={16} /></span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontWeight: 600, color: tk.text.primary }}>{title}</div>
        {children && <div>{children}</div>}
        {details && open && (
          <pre style={{
            margin: '4px 0 0', padding: '8px 10px', borderRadius: radius.md, background: tk.bg.panel, color: tk.text.secondary,
            font: `11.5px/1.55 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflow: 'auto',
          }}>{details}</pre>
        )}
        {(details || actions) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 2 }}>
            {actions}
            {details && <button type="button" style={linkBtn} onClick={() => setOpen(o => !o)}>{open ? 'Hide details' : 'Show details'}</button>}
            {details && open && <button type="button" style={linkBtn} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>}
          </div>
        )}
      </div>
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss}
          style={{ border: 0, background: 'none', padding: 0, height: 18, cursor: 'pointer', color: tk.text.faint }}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
