import { useEffect, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';

/**
 * Floating pill at the bottom of the phone preview: play/pause, reset, the time, and the
 * read-only node-graph overlay toggle. It sits on the render, so it's dark in both themes.
 */
export function MobilePreviewPill({ overlayOpen, onToggleOverlay }: { overlayOpen: boolean; onToggleOverlay: () => void }) {
  const timePlaying = useNodeGraphStore(s => s.timePlaying);
  const setTimePlaying = useNodeGraphStore(s => s.setTimePlaying);
  const [time, setTime] = useState(0);
  useEffect(() => {
    const onTick = (e: Event) => setTime((e as CustomEvent<{ time: number }>).detail.time);
    window.addEventListener('time-tick', onTick);
    return () => window.removeEventListener('time-tick', onTick);
  }, []);

  const btn = (icon: IconName, label: string, onClick: () => void, on = false) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on || undefined}
      onClick={onClick}
      style={{
        width: 40, height: 36, padding: 0, border: 0, borderRadius: 10, cursor: 'pointer', touchAction: 'manipulation',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? 'rgba(255,255,255,0.14)' : 'none', color: on ? '#ffffff' : '#d8d9e0',
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  );

  return (
    <div style={{
      position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 22,
      display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 14,
      background: 'rgba(26,27,34,0.88)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    }}>
      {btn(timePlaying ? 'pause' : 'play', timePlaying ? 'Pause' : 'Play', () => setTimePlaying(!timePlaying))}
      {btn('reset', 'Reset time to 0', () => window.dispatchEvent(new CustomEvent('reset-time')))}
      <span style={{ font: `12px ${fontFamily.mono}`, color: '#e8e9ef', padding: '0 8px', fontVariantNumeric: 'tabular-nums' }}>{time.toFixed(2)}s</span>
      {btn('overlay', overlayOpen ? 'Hide the node graph overlay' : 'Show the node graph over the preview', onToggleOverlay, overlayOpen)}
    </div>
  );
}
