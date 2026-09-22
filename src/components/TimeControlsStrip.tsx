import type { CSSProperties } from 'react';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

const btnStyle: CSSProperties = {
  background: '#1e1e2e99',
  border: '1px solid #45475a',
  color: '#585b70',
  borderRadius: '4px',
  width: '26px',
  height: '26px',
  fontSize: '12px',
  cursor: 'pointer',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};

/**
 * Global play/pause/reset for u_time animation. Vertical icon strip meant to
 * sit absolutely-positioned along the left edge of a render preview; also
 * reused inline (horizontal) inside the keyframe editor modal.
 */
export function TimeControlsStrip({ layout = 'vertical' }: { layout?: 'vertical' | 'horizontal' }) {
  const timePlaying = useNodeGraphStore(s => s.timePlaying);
  const setTimePlaying = useNodeGraphStore(s => s.setTimePlaying);

  return (
    <div
      style={{
        position: layout === 'vertical' ? 'absolute' : 'static',
        left: layout === 'vertical' ? 8 : undefined,
        top: layout === 'vertical' ? '50%' : undefined,
        transform: layout === 'vertical' ? 'translateY(-50%)' : undefined,
        zIndex: layout === 'vertical' ? 10 : undefined,
        display: 'flex',
        flexDirection: layout === 'vertical' ? 'column' : 'row',
        gap: '4px',
      }}
    >
      <button
        onClick={() => setTimePlaying(!timePlaying)}
        title={timePlaying ? 'Pause' : 'Play'}
        style={btnStyle}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#a6e3a1'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#585b70'; }}
      >{timePlaying ? '⏸' : '▶'}</button>
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('reset-time'))}
        title="Reset time to 0"
        style={btnStyle}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f9e2af'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#585b70'; }}
      >↺</button>
    </div>
  );
}
