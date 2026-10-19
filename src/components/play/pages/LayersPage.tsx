/**
 * The Layers rail page: the layer list beside the selected layer's editor
 * (LayersPanel.tsx), or what Free shows in its place.
 */
import { openProSheet, useCan } from '../../../lib/plan';
import { LayersPanel } from '../LayersPanel';
import type { RailPageProps } from './shared';
import { ProBadge } from '../../account/ProSheet';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { PlayRecord } from '../../../types/play';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';

export function LockedLayers({ play }: { play: PlayRecord }) {
  const tk = useTokens();
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 12px' }}>
      <div style={{ padding: '14px 14px 12px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="lock" size={15} style={{ color: tk.text.faint }} />
          <b style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>Layers are part of Pro</b>
          <ProBadge />
        </div>
        <span style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          Shapes, particles, text, images, the camera, scripts and nulls on top of the picture, with their actions and groups.
          {play.layers.length > 0 ? ' This setup’s layers are kept as they are: they show here, and play again with Pro.' : ''}
        </span>
        <div><Button size="sm" variant="primary" icon="spark" onClick={() => openProSheet('play.layers')}>See what Pro adds</Button></div>
      </div>
      {play.layers.length > 0 && (
        <div style={{ marginTop: 10, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, overflow: 'hidden' }}>
          {play.layers.map((l, i) => (
            <div key={l.id} title="Needs Pro" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', borderTop: i ? `1px solid ${tk.border.subtle}` : undefined, opacity: 0.55 }}>
              <Icon name="layoutCanvas" size={14} style={{ color: tk.text.faint }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.primary }}>{l.label}</span>
              <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{l.kind} · needs Pro</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Free's Background row: the shader, with backgrounds shown as Pro. */
export function LockedBackground() {
  const tk = useTokens();
  return (
    <button type="button" onClick={() => openProSheet('play.backgrounds')} style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 12px', border: 0, borderBottom: `1px solid ${tk.border.subtle}`,
      background: tk.bg.panel, cursor: 'pointer', color: tk.text.muted, font: `12px ${fontFamily.ui}`, textAlign: 'left',
    }}>
      <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Background</span>
      <span style={{ flex: 1 }}>The shader</span>
      <span style={{ color: tk.text.faint }}>Images, video, gradients</span>
      <ProBadge />
    </button>
  );
}


/** The Layers page: the list beside the selected layer's editor (wide), or stacked. */
export function LayersRailPage({ play, onChange, touch, wide }: RailPageProps) {
  const layersOk = useCan('play.layers');
  if (!layersOk) return <LockedLayers play={play} />;
  return <LayersPanel play={play} touch={touch} split={wide} big extras={false} exposedTargets={new Set(play.controls.map(c => c.target))} onChange={onChange} onExpose={control => onChange(p => (p.controls.some(c => c.target === control.target) ? p : { ...p, controls: [...p.controls, control] }))} />;
}
