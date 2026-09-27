/**
 * InspectorParts — the Present page's settings panel pieces: a titled
 * section and a labelled row (the Inspector and the Style settings share them).
 */
import type { ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';

export function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  const tk = useTokens();
  return (
    <section style={{ padding: '14px 16px', borderBottom: `1px solid ${tk.border.subtle}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ flex: 1, color: tk.text.faint, font: `700 10.5px ${fontFamily.ui}`, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{title}</span>
        {extra}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </section>
  );
}

export function Row({ label, children, hint, extra }: { label: ReactNode; children: ReactNode; hint?: ReactNode; extra?: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 16 }}>
        <span style={{ flex: 1, minWidth: 0, color: tk.text.secondary, font: `600 12px ${fontFamily.ui}` }}>{label}</span>
        {extra}
      </div>
      {children}
      {hint && <span style={{ color: tk.text.faint, font: `500 11.5px/1.4 ${fontFamily.ui}` }}>{hint}</span>}
    </div>
  );
}
