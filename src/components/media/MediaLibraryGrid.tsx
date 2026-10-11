/**
 * MediaLibraryGrid — a grid of library pictures or videos to pick from, with the shared
 * media keys (useMediaPreviewList) and a large preview above it: ↑/↓ (and ←/→ for
 * pictures) move, the preview follows, Enter or double-click uses it, a click only
 * previews (on a phone: tap previews, tap again uses it), Esc closes. Used by the
 * Texture node's Library button and the builders' image library (PictureWays).
 */
import { useEffect, useRef } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { useMediaPreviewList } from './useMediaPreviewList';
import { MediaPreviewPane } from './MediaPreviewPane';

export interface LibraryGridItem { id: string; name: string; thumb?: string }

export function MediaLibraryGrid<T extends LibraryGridItem>({ kind, items, load, onPick, onClose, label, columns = 3, thumbHeight = 48, previewHeight = 140, autoFocus = true, touch = false }: {
  kind: 'image' | 'video';
  items: readonly T[];
  /** The full file for the large preview. */
  load: (item: T) => Promise<Blob | string | null>;
  onPick: (item: T) => void;
  onClose?: () => void;
  label: string;
  columns?: number | string;
  thumbHeight?: number;
  previewHeight?: number;
  autoFocus?: boolean;
  touch?: boolean;
}) {
  const tk = useTokens();
  const listRef = useRef<HTMLDivElement>(null);
  const mp = useMediaPreviewList<T>({ kind, items, onPick, onClose, label });
  useEffect(() => { if (autoFocus) listRef.current?.focus({ preventScroll: true }); }, [autoFocus]);
  const hi = mp.highlighted;
  return (
    <div data-media-grid={kind} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {hi && (
        <MediaPreviewPane kind={kind} itemKey={hi.id} name={hi.name} thumb={hi.thumb} load={() => load(hi)} videoProps={mp.videoProps}
          height={previewHeight} onUse={() => onPick(hi)} />
      )}
      <div ref={listRef} {...mp.listProps}
        style={{ display: 'grid', gridTemplateColumns: typeof columns === 'number' ? `repeat(${columns}, 1fr)` : columns, gap: 6 }}>
        {items.map(i => {
          const on = mp.highlight === i.id;
          return (
            <div key={i.id} {...mp.optionProps(i)} aria-label={i.name} title={`${i.name}: double-click or Enter to use it`}
              data-media-item={i.id}
              onClick={() => (touch ? mp.onRowTap : mp.onRowClick)(i)} onDoubleClick={() => onPick(i)}
              style={{ border: `1px solid ${on ? tk.accent.base : tk.border.default}`, borderRadius: radius.md, background: on ? tk.bg.selected : tk.bg.field, padding: 3, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              {i.thumb ? <img src={i.thumb} alt="" style={{ width: '100%', height: thumbHeight, objectFit: 'cover', borderRadius: 3 }} />
                : <span style={{ height: thumbHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint, font: `10px ${fontFamily.ui}` }}>{kind === 'image' ? 'picture' : 'video'}</span>}
              <span style={{ fontSize: 10, color: on ? tk.accent.text : tk.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
