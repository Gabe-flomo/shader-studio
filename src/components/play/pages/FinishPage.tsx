/**
 * The Finish rail page: effects over the whole picture (finish/FinishPanel.tsx),
 * or what Free shows in its place.
 */
import { openProSheet, useCan } from '../../../lib/plan';
import { FinishPanel } from '../finish/FinishPanel';
import type { RailPageProps } from './shared';
import { ProBadge } from '../../account/ProSheet';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { PlayRecord } from '../../../types/play';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';

/** Free's Layers tab: what layers do, the setup's own layers listed dimmed (kept, not run), and the way to Pro. */
export function LockedFinish({ play }: { play: PlayRecord }) {
  const tk = useTokens();
  const n = play.finish?.effects.length ?? 0;
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 12px' }}>
      <div style={{ padding: '14px 14px 12px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="lock" size={15} style={{ color: tk.text.faint }} />
          <b style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>The Finish stack is part of Pro</b>
          <ProBadge />
        </div>
        <span style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          Colour grading with curves and wheels, lens distortion, CRT, bloom, halation, film grain, camera shake and time displacement over the whole picture.
          {n > 0 ? ` This setup’s ${n === 1 ? 'effect is' : `${n} effects are`} kept as they are, and play again with Pro.` : ''}
        </span>
        <div><Button size="sm" variant="primary" icon="spark" onClick={() => openProSheet('play.finish')}>See what Pro adds</Button></div>
      </div>
    </div>
  );
}


/** The Finish page: the picture's effects. */
export function FinishRailPage({ play, onChange, touch, wide }: RailPageProps) {
  const finishOk = useCan('play.finish');
  return finishOk ? <FinishPanel play={play} onChange={onChange} touch={touch} wide={wide} only="picture" /> : <LockedFinish play={play} />;
}
