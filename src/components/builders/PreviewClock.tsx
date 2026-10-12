/**
 * PreviewClock — Pause / Play and ↺ over a builder's own preview canvas (the 2D and 3D Scene
 * builders, the Grid builder). ↺ is the app's one true reset (lib/runtimeReset.ts): this preview's
 * clock and memory start over, and so does the Studio preview and everything else that runs on
 * the clock. Pause is this preview's own and ↺ leaves it as it is.
 */
import type { CSSProperties } from 'react';
import { fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { resetRuntime } from '../../lib/runtimeReset';

export const RESET_LABEL = 'Start over: time 0, every frame cleared';

export function PreviewClock({ paused, onPause, style, size = 'md' }: {
  paused: boolean;
  onPause: () => void;
  /** Where it sits (absolute, over the canvas). */
  style: CSSProperties;
  size?: 'sm' | 'md';
}) {
  const h = size === 'sm' ? 24 : 26;
  const btn: CSSProperties = {
    height: h, padding: '0 9px', border: 0, borderRadius: 7, background: 'rgba(13,13,18,0.72)', color: '#e8e8f0',
    font: `600 ${size === 'sm' ? 11 : 11.5}px ${fontFamily.ui}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
  };
  return (
    <div data-preview-clock style={{ display: 'flex', gap: 4, ...style }} onPointerDown={e => e.stopPropagation()}>
      <button type="button" onClick={onPause} title={paused ? 'Play the preview' : 'Pause the preview'} style={btn}>
        <Icon name={paused ? 'play' : 'pause'} size={12} />{paused ? 'Play' : 'Pause'}
      </button>
      <button type="button" data-preview-reset onClick={() => resetRuntime()} title={RESET_LABEL} aria-label={RESET_LABEL} style={{ ...btn, padding: 0, width: h, justifyContent: 'center' }}>
        <Icon name="reset" size={12} />
      </button>
    </div>
  );
}
