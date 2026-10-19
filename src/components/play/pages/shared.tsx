/**
 * Shared bits of the Play page's rail pages (pages/*Page.tsx): the panel
 * header, the empty state, the panel grid and a few small helpers.
 */
import type { ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { PlayRecord, PlaySource, PlaySourceDef } from '../../../types/play';
import { Icon } from '../../ui/Icon';
import type { LayerCandidates } from './ControlCards';

/** The split view's big panel lays cards out in as many columns as fit. */
export const PANEL_GRID: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', columnGap: 10, alignItems: 'start' };
export const PANEL_GRID_WIDE: React.CSSProperties = { ...PANEL_GRID, gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))' };

// ── Header + empty state ─────────────────────────────────────────────────────

/**
 * `scroll` (phones): one row, the tools sliding sideways under the title, instead of wrapping
 * onto two more lines (a lone ⋯ on a third row at 360–390px).
 */
export function PanelHeader({ title, hint, after, extra, onClick, chevron, scroll = false }: { title: string; hint?: string; /** Beside the title (the Controls notes' ⓘ). */ after?: ReactNode; extra?: ReactNode; onClick?: () => void; chevron?: 'up' | 'down'; scroll?: boolean }) {
  const tk = useTokens();
  return (
    <div
      onClick={onClick}
      style={{
        minHeight: 44, flexShrink: 0, display: 'flex', alignItems: 'center', flexWrap: scroll ? 'nowrap' : 'wrap', gap: '2px 8px', padding: '0 8px 0 14px',
        borderBottom: `1px solid ${tk.border.default}`, background: tk.bg.panel, cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
      }}
    >
      {chevron && <Icon name={chevron === 'up' ? 'chevU' : 'chevD'} size={14} style={{ color: tk.text.faint }} />}
      {title && <span style={{ font: `650 13px ${fontFamily.ui}`, ...(scroll ? { flexShrink: 0 } : null) }}>{title}</span>}
      {hint && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.mono}`, ...(scroll ? { flexShrink: 0 } : null) }}>{hint}</span>}
      {after && <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', flexShrink: 0, marginLeft: -4 }}>{after}</span>}
      <span style={{ flex: 1 }} />
      {/* Wraps onto a second line on narrow screens rather than running off the edge (or, `scroll`, slides sideways). */}
      <span onClick={e => e.stopPropagation()} data-header-tools={scroll ? 'scroll' : undefined} style={scroll
        ? { display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'nowrap', flex: '0 1 auto', minWidth: 0, minHeight: 44, overflowX: 'auto', scrollbarWidth: 'none' }
        : { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', minHeight: 44, maxWidth: '100%' }}>{extra}</span>
    </div>
  );
}

/** Does anything in the setup listen to MIDI (a MIDI source, a note trigger or an action fired by a note)? */
export function usesMidi(play: PlayRecord): boolean {
  const midiSource = (s: PlaySource) => s.kind === 'midi' || s.kind === 'pad' || (s.kind === 'trigger' && s.trigger.on === 'note');
  return !!play.padGrid || play.mappings.some(m => midiSource(m.source)) || (play.sources ?? []).some(d => midiSource(d.source))
    || (play.actions ?? []).some(a => a.trigger.on === 'note')
    || !!play.audioEngine?.racks.some(r => r.midi !== 'off');
}

export function EmptyState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ margin: '18px 4px', padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, lineHeight: 1.5 }}>
      <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>{title}</div>
      {body}
      {children}
    </div>
  );
}

export const NO_SOURCES: PlaySourceDef[] = [];
export const NO_LAYER_CANDIDATES: LayerCandidates[] = [];

export function joinParts(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** How a rail page changes the setup. */
export type PlayChange = (fn: (p: PlayRecord) => PlayRecord) => void;

/** What every rail page gets: the setup, how to change it, phone or not, and room for two columns. */
export interface RailPageProps { play: PlayRecord; onChange: PlayChange; touch: boolean; wide: boolean }

