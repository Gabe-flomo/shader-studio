/**
 * The Layers rail page: the layer list beside the selected layer's editor
 * (LayersPanel.tsx), or what Free shows in its place.
 */
import { openProSheet, useCan } from '../../../lib/plan';
import { LayersPanel } from '../LayersPanel';
import type { RailPageProps } from './shared';
import type { ReactNode } from 'react';
import { BackgroundSettings } from '../FullPages';
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

/**
 * The Layers page: the list beside the selected layer's editor (wide), or
 * stacked. The Background is the list's pinned first row (LayersPanel, Play
 * audit P13); `top` scrolls above it (a phone's notes and canvas shape, a
 * tablet's canvas shape). Free keeps the Background's row (the shader, or
 * Pro's backgrounds shown locked) above what layers would do.
 */
export function LayersRailPage({ play, onChange, touch, wide, top }: RailPageProps & { top?: ReactNode }) {
  const layersOk = useCan('play.layers');
  const backgroundsOk = useCan('play.backgrounds');
  if (!layersOk) {
    return (
      <div data-layers-locked="" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {top && <div style={{ flexShrink: 0 }}>{top}</div>}
        <div style={{ flexShrink: 0, padding: '12px 12px 0' }}><BackgroundSettings play={play} onChange={onChange} locked={!backgroundsOk} /></div>
        <LockedLayers play={play} />
      </div>
    );
  }
  return <LayersPanel play={play} touch={touch} split={wide} big={!touch} extras={false} top={top ?? undefined} exposedTargets={new Set(play.controls.map(c => c.target))} onChange={onChange} onExpose={control => onChange(p => (p.controls.some(c => c.target === control.target) ? p : { ...p, controls: [...p.controls, control] }))} />;
}
