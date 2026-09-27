/**
 * What Free sees of Pro: a small "Pro" badge on locked things, and one sheet
 * that says what Pro includes when one of them is used (docs/accounts-and-plans.md
 * section 4: locked features stay visible).
 */
import type { CSSProperties, ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { FEATURES, PRO_PRICE, PRO_STORE_URL, closeProSheet, openProSheet, useCan, useProSheet, type Feature } from '../../lib/plan';

/** A small "Pro" pill beside a locked thing's label. */
export function ProBadge({ style, title = 'Part of Pro' }: { style?: CSSProperties; title?: string }) {
  const tk = useTokens();
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, height: 16, padding: '0 5px', borderRadius: 5, flexShrink: 0,
        background: alpha(tk.accent.base, 0.14), color: tk.accent.text, font: `700 9.5px ${fontFamily.ui}`,
        letterSpacing: '0.04em', textTransform: 'uppercase', verticalAlign: 'middle', lineHeight: 1, ...style,
      }}
    >
      Pro
    </span>
  );
}

/** A ProBadge only while the plan lacks `feature`. */
export function ProBadgeFor({ feature, style }: { feature: Feature; style?: CSSProperties }) {
  return useCan(feature) ? null : <ProBadge style={style} />;
}

/**
 * Wraps a control Free can see but not use: it shows dimmed with a Pro badge,
 * and any click on it opens the Pro sheet instead. On Pro it is just `children`.
 */
export function ProLock({ feature, children, badge = true, style }: { feature: Feature; children: ReactNode; badge?: boolean; style?: CSSProperties }) {
  const ok = useCan(feature);
  if (ok) return <>{children}</>;
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${FEATURES[feature].label}: part of Pro`}
      title="Part of Pro"
      onClickCapture={e => { e.preventDefault(); e.stopPropagation(); openProSheet(feature); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProSheet(feature); } }}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', ...style }}
    >
      <span aria-hidden style={{ display: 'inline-flex', opacity: 0.5, pointerEvents: 'none', minWidth: 0, flex: style?.display === 'flex' ? 1 : undefined }}>{children}</span>
      {badge && <ProBadge />}
    </span>
  );
}

/** What the sheet lists under "Pro also includes". */
const PRO_LIST: Feature[] = ['play.layers', 'play.sources', 'play.backgrounds', 'play.takes', 'convert', 'export.hires', 'export.website', 'files.everything', 'files.install', 'nodes.publish', 'nodes.pack'];

/** The Pro sheet, opened by openProSheet / requireFeature. Mounted once, next to the dialogs. */
export function ProSheetHost() {
  const open = useProSheet(s => s.open);
  const feature = useProSheet(s => s.feature);
  const tk = useTokens();
  if (!open) return null;
  return (
    <Modal
      title={feature ? 'This is part of Pro' : 'Playfield Pro'}
      subtitle={feature ? FEATURES[feature].label : PRO_PRICE}
      icon="spark"
      width={440}
      onClose={closeProSheet}
      footer={<>
        <span style={{ color: tk.text.muted, font: `600 12.5px ${fontFamily.ui}` }}>{PRO_PRICE}</span>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={closeProSheet}>Not now</Button>
        <Button variant="primary" icon="spark" onClick={() => { window.open(PRO_STORE_URL, '_blank', 'noopener'); }}>Get Pro</Button>
      </>}
    >
      <div style={{ padding: '16px 20px 18px', display: 'flex', flexDirection: 'column', gap: 12, font: `12.5px/1.5 ${fontFamily.ui}`, color: tk.text.secondary }}>
        <p style={{ margin: 0 }}>
          You’re on Free: the Studio, Present, the GLSL page, the Builder, Learn and Play’s controls with the mouse, keys and audio.
          Pro unlocks the rest, and anything you made on Pro still opens here to look at.
        </p>
        <div style={{ borderRadius: radius.lg, background: tk.bg.field, padding: '10px 12px' }}>
          <div style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>Pro includes</div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {PRO_LIST.map(f => (
              <li key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: f === feature ? tk.text.primary : tk.text.secondary, fontWeight: f === feature ? 600 : 400 }}>
                <Icon name="check" size={14} style={{ color: f === feature ? tk.accent.base : tk.status.success, flexShrink: 0, marginTop: 2 }} />
                <span>{FEATURES[f].label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
