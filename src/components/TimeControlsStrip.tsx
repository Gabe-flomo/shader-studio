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
 * Global play/pause/reset for u_time animation. Rendered as a horizontal
 * row by default (header/status bar next to the render preview, or inside
 * the keyframe editor's header) or a vertical stack (the floating dock
 * anchored to the node-graph side of the divider) — never overlaid on the
 * rendered canvas itself either way.
 */
export function TimeControlsStrip({ direction = 'row' }: { direction?: 'row' | 'column' }) {
  const timePlaying = useNodeGraphStore(s => s.timePlaying);
  const setTimePlaying = useNodeGraphStore(s => s.setTimePlaying);

  return (
    <div style={{ display: 'flex', flexDirection: direction, gap: '4px' }}>
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
