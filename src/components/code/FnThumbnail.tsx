/**
 * FnThumbnail — a saved function's picture, rendered the first time it
 * scrolls into view (lib/fnThumbnails.ts caches it by content). Until then,
 * and for a function that can't be drawn on its own, the square holds the
 * function icon.
 */
import { useEffect, useRef, useState } from 'react';
import { cachedFnThumbnail, fnThumbnail } from '../../lib/fnThumbnails';
import type { PresetLike } from '../../glsl/presetPreview';
import { useTokens } from '../../theme/themeStore';
import { radius as radii } from '../../theme/tokens';
import { Icon } from '../ui/Icon';

export function FnThumbnail({ preset, size = 24, radius = radii.xs, title }: { preset: PresetLike; size?: number; radius?: number; title?: string }) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | undefined>(() => cachedFnThumbnail(preset, size));
  // A different preset (or an edit to this one) starts from its own cache entry.
  const [seen, setSeen] = useState(preset);
  if (seen !== preset) { setSeen(preset); setUrl(cachedFnThumbnail(preset, size)); }

  useEffect(() => {
    if (url !== undefined) return;
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const start = () => { fnThumbnail(preset, size).then(u => { if (alive) setUrl(u); }); };
    if (typeof IntersectionObserver === 'undefined') { start(); return () => { alive = false; }; }
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '120px' });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [preset, size, url]);

  return (
    <div ref={ref} title={url === '' ? 'No picture: this function doesn’t compile on its own' : title} aria-hidden={!title && url !== ''}
      style={{ width: size, height: size, flexShrink: 0, borderRadius: radius, overflow: 'hidden', background: url ? tk.bg.render : tk.bg.field, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {url
        ? <img src={url} alt="" width={size} height={size} draggable={false} style={{ display: 'block', width: size, height: size }} />
        : <Icon name="fn" size={Math.round(size * 0.6)} style={{ color: tk.kind.fn, opacity: url === '' ? 0.9 : 0.45 }} />}
    </div>
  );
}
