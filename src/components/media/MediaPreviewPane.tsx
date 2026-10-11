/**
 * MediaPreviewPane — the large preview a picture/video picker shows for the row
 * useMediaPreviewList has highlighted: the picture itself, or the video playing
 * (muted, looping, through the hook's `videoProps` so only one preview plays at a
 * time app-wide). The file is loaded when the highlight lands on it; a thumbnail
 * stands in until then. "Use it" commits; the preview alone never does.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';

type VideoProps = {
  ref: (el: HTMLVideoElement | null) => void;
  autoPlay: boolean; muted: boolean; loop: boolean; playsInline: boolean;
  onPlay: (e: { currentTarget: HTMLVideoElement }) => void;
};

export function MediaPreviewPane({ kind, itemKey, name, detail, thumb, load, videoProps, height = 150, empty, onUse, useLabel = 'Use it', extra }: {
  kind: 'image' | 'video';
  /** The highlighted row's id, or null when nothing is highlighted. */
  itemKey: string | null;
  name?: string;
  detail?: string;
  /** A small picture shown until the file is loaded. */
  thumb?: string;
  /** The file: a Blob (its object URL is revoked when the preview moves on) or a URL. */
  load?: () => Promise<Blob | string | null>;
  videoProps?: VideoProps;
  height?: number | string;
  empty?: ReactNode;
  onUse?: () => void;
  useLabel?: string;
  extra?: ReactNode;
}) {
  const tk = useTokens();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!itemKey || !load) return;
    let live = true;
    let owned: string | null = null;
    load().then(got => {
      if (!live || !got) return;
      if (typeof got === 'string') setSrc(got);
      else { owned = URL.createObjectURL(got); setSrc(owned); }
    }, () => {});
    return () => { live = false; if (owned) { try { URL.revokeObjectURL(owned); } catch { /* ignore */ } } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  if (!itemKey) return <div data-media-preview="empty" style={{ color: tk.text.faint, font: `500 11.5px/1.5 ${fontFamily.ui}`, padding: '10px 4px', textAlign: 'center' }}>{empty ?? 'Use ↑ and ↓ to look through them; Enter uses the one you’re on.'}</div>;
  const shown = src ?? thumb;
  return (
    <div data-media-preview={kind} aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ height, borderRadius: radius.md, overflow: 'hidden', background: tk.bg.render, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {kind === 'video' && src && videoProps
          ? <video key={src} src={src} {...videoProps} aria-label={name ? `Preview of ${name}` : 'Preview'} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          : shown
            ? <img src={shown} alt={name ? `Preview of ${name}` : 'Preview'} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            : <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>Loading…</span>}
      </div>
      {(name || onUse) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {name && <span style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>}
            {detail && <span style={{ font: `11px ${fontFamily.ui}`, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>}
          </span>
          {extra}
          {onUse && <Button size="sm" variant="primary" icon="check" onClick={onUse} data-media-use>{useLabel}</Button>}
        </div>
      )}
    </div>
  );
}

