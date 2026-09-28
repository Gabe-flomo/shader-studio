/**
 * SampleRow — one row in a sample browser, shared by the Sounds tab, the
 * linked-folder browser (filtered to audio) and the drum pad picker: the
 * waveform picture the app already makes for that sound (backgroundLibrary's
 * waveThumbOf / linkedThumbs' audio preview), a playhead line that moves
 * across it while this row is the one previewing, a small speaker icon while
 * it plays, and (on a phone) a Pick button since a tap previews instead of
 * picking straight away. Highlighted vs. previewing vs. loading are drawn
 * differently: the highlight can lead the preview (arrowed to but not yet
 * loaded) or trail it (previewing a row you've scrolled past).
 */
import { useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';

export interface SampleRowProps {
  title: string;
  detail: string;
  /** The waveform picture (a data URL), when one has been made yet. */
  thumb?: string;
  highlighted: boolean;
  playing: boolean;
  loading: boolean;
  /** 0..1 through the sample, only meaningful while `playing`. */
  progress: number;
  w?: number;
  h?: number;
  touch?: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onTap?: () => void;
  onPick?: () => void;
  onMenu?: (el: HTMLElement) => void;
}

/** The row's waveform: the picture already made for it, a playhead over it while playing. */
function WaveThumb({ thumb, progress, playing, active, w, h }: { thumb: string | undefined; progress: number; playing: boolean; active: boolean; w: number; h: number }) {
  const tk = useTokens();
  return (
    <span style={{ position: 'relative', width: w, height: h, flexShrink: 0, borderRadius: radius.sm, overflow: 'hidden', background: tk.bg.render, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.08)}` }}>
      {thumb ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : <Icon name="wave" size={14} style={{ color: active ? tk.accent.base : alpha('#ffffff', 0.4) }} />}
      {playing && (
        <span aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: `${Math.max(0, Math.min(100, progress * 100))}%`, width: 1.5, background: tk.accent.base, boxShadow: `0 0 3px ${tk.accent.base}` }} />
      )}
    </span>
  );
}

export function SampleRow({ title, detail, thumb, highlighted, playing, loading, progress, w = 72, h = 40, touch, onClick, onDoubleClick, onTap, onPick, onMenu }: SampleRowProps) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  const active = highlighted || playing || loading;
  return (
    <div
      role="option"
      aria-selected={highlighted}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 4px 5px 6px', borderRadius: radius.md, background: highlighted ? tk.bg.selected : hover ? tk.bg.hover : 'transparent' }}
    >
      <button
        type="button"
        onClick={() => (touch ? (onTap ?? onClick)() : onClick())}
        onDoubleClick={onDoubleClick}
        title={title}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, border: 0, padding: 0, background: 'none', cursor: 'pointer', textAlign: 'left', color: tk.text.primary }}
      >
        <WaveThumb thumb={thumb} progress={progress} playing={playing} active={active} w={w} h={h} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
            {playing && <Icon name="wave" size={11} style={{ color: tk.accent.base, flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `600 13px ${fontFamily.ui}`, color: highlighted ? tk.accent.text : tk.text.primary }}>{title}</span>
          </span>
          <span style={{ color: tk.text.muted, font: `500 11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {loading ? 'Loading…' : detail}
          </span>
        </span>
      </button>
      {touch && onPick && (
        <Button size="sm" variant={highlighted ? 'primary' : 'ghost'} onClick={onPick} style={{ flexShrink: 0 }}>Pick</Button>
      )}
      {onMenu && (
        <span ref={menuRef} style={{ display: 'inline-flex', flexShrink: 0 }}>
          <IconButton icon="more" label={`More for “${title}”`} tooltip={false} onClick={e => { e.stopPropagation(); if (menuRef.current) onMenu(menuRef.current); }} />
        </span>
      )}
    </div>
  );
}

/** The auto-preview toggle, the same everywhere it's offered. */
export function AutoPreviewToggle({ value, onChange, compact }: { value: boolean; onChange: (v: boolean) => void; compact?: boolean }) {
  const tk = useTokens();
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }} title="Selecting a sample plays it at once, at a low preview volume">
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} style={{ margin: 0 }} />
      <span style={{ color: tk.text.muted, font: `500 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{compact ? 'Auto-preview' : 'Auto-preview samples'}</span>
    </label>
  );
}
