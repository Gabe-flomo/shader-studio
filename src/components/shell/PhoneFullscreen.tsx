/**
 * PhoneFullscreenChrome — sits in the picture's frame on phones. Sideways, a
 * small Full screen button in the corner; while the picture alone is on
 * screen (rotated to it, or by that button), a tap shows a minimal bar with
 * Exit for a moment. The bar takes no pointer input away from the picture:
 * taps are read from the window, and only still ones count.
 */
import { useEffect, useState } from 'react';
import { exitFullscreen, toggleFullscreenTarget, useFullscreen } from '../../lib/fullscreen';
import { fontFamily } from '../../theme/tokens';
import { IconButton } from '../ui/Button';

const BAR_MS = 2800;

export function PhoneFullscreenChrome({ showEnter }: { showEnter: boolean }) {
  const on = useFullscreen(s => s.target === 'canvas');
  const [bar, setBar] = useState(false);

  // Show the bar on entering, then on each tap; it fades after a moment.
  useEffect(() => {
    if (!on) { setBar(false); return; }
    setBar(true);
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const still = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10 && Date.now() - down.t < 350;
      down = null;
      if (still && !(e.target instanceof Element && e.target.closest('[data-phone-fs-bar]'))) setBar(b => !b);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointerup', onUp, true); };
  }, [on]);
  useEffect(() => {
    if (!bar) return;
    const t = window.setTimeout(() => setBar(false), BAR_MS);
    return () => window.clearTimeout(t);
  }, [bar]);

  if (on) {
    return (
      <div data-phone-fs-bar="" style={{
        position: 'absolute', top: 'max(8px, env(safe-area-inset-top, 0px))', right: 'max(8px, env(safe-area-inset-right, 0px))', zIndex: 6,
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px 4px 12px', borderRadius: 999,
        background: 'rgba(12,12,18,0.72)', color: '#f2f2f7', font: `600 12.5px ${fontFamily.ui}`, backdropFilter: 'blur(8px)',
        opacity: bar ? 1 : 0, pointerEvents: bar ? 'auto' : 'none', transition: 'opacity 180ms ease',
      }}>
        <span>Full screen</span>
        <button
          type="button"
          onClick={() => { void exitFullscreen(); }}
          style={{ height: 30, padding: '0 12px', border: 0, borderRadius: 999, cursor: 'pointer', background: '#f2f2f7', color: '#101016', font: `650 12.5px ${fontFamily.ui}` }}
        >Exit</button>
      </div>
    );
  }
  if (!showEnter) return null;
  return (
    <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 6 }}>
      <IconButton
        icon="fit" size="sm" tooltip={false}
        label="Full screen: the picture on its own"
        onClick={() => { void toggleFullscreenTarget('canvas'); }}
        style={{ background: 'rgba(12,12,18,0.55)', color: '#f2f2f7', borderRadius: 999 }}
      />
    </div>
  );
}
