/**
 * PageCanvas — the main preview, hosted by a page (pageCanvas.ts): the same
 * ShaderCanvas the Studio and Play show, with the preview toolbar (shape,
 * full screen, Record / Snapshot, whatever the page adds), the time controls
 * and the hover readout under it. The app's own preview column steps aside
 * while a page hosts the canvas (App checks `hostsCanvas`).
 *
 * The canvas registers with lib/previewHost so Record and Snapshot take the
 * picture from it. `phone`: the picture with the floating pill (play, reset,
 * time) and the phone full-screen chrome instead of the header and footer.
 *
 * `beside` + `onWidth`: on desktop the host sits at the right of its page with
 * a drag divider on its left edge; the page keeps the width (pageCanvas.ts).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ThemeOverrideContext, useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import ShaderCanvas, { type OfflineRenderHandle } from '../ShaderCanvas';
import { AspectPicker, CanvasFullscreenButton, PreviewFooter, PreviewHeader } from './PreviewChrome';
import { MobilePreviewPill } from './MobilePreviewPill';
import { PhoneFullscreenChrome } from './PhoneFullscreen';
import { IconButton } from '../ui/Button';
import { openRecord, usePreviewHost } from '../../lib/previewHost';
import { clampCanvasWidth, type PageCanvasPage, usePageCanvas } from './pageCanvasStore';

export function PageCanvas({ page, tools, overlay, idleHint = 'Hover for colour', phone = false, resizable = true, defaultShare = 0.5 }: {
  page: PageCanvasPage;
  /** The page's own controls in the header (a view switcher, say). */
  tools?: ReactNode;
  /** Drawn over the picture (a wipe overlay, a notice). */
  overlay?: ReactNode;
  idleHint?: string;
  phone?: boolean;
  /** A drag divider on the left edge, remembered per page. */
  resizable?: boolean;
  /** The share of the room the canvas takes until a width is chosen. */
  defaultShare?: number;
}) {
  const tk = useTokens();
  const setCanvas = usePreviewHost(s => s.setCanvas);
  const setOffline = usePreviewHost(s => s.setOffline);
  const onCanvasReady = useCallback((c: HTMLCanvasElement) => setCanvas(c), [setCanvas]);
  const onOffline = useCallback((h: OfflineRenderHandle) => setOffline(h), [setOffline]);
  // Gone with the page: Record then waits for the next canvas to register.
  useEffect(() => () => { setCanvas(null); setOffline(null); }, [setCanvas, setOffline]);

  const setWidth = usePageCanvas(s => s.setWidth);
  const width = usePageCanvas(s => s.width[page]);
  const ref = useRef<HTMLDivElement>(null);
  // The room the host shares with what sits beside it (its parent): the width is kept within it.
  const [room, setRoom] = useState(0);
  useEffect(() => {
    if (phone || !resizable) return;
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => setRoom(parent.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [phone, resizable]);
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = ref.current, parent = el?.parentElement;
    if (!el || !parent) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const room = parent.getBoundingClientRect();
    let latest = el.getBoundingClientRect().width, applied = 0, timer = 0;
    // The canvas rebuilds its buffers on every resize: follow the pointer a few times a second.
    const apply = () => { timer = 0; applied = performance.now(); setWidth(page, clampCanvasWidth(latest, room.width)); };
    const onMove = (ev: PointerEvent) => {
      latest = room.right - ev.clientX;
      const wait = 60 - (performance.now() - applied);
      if (wait <= 0) apply(); else if (!timer) timer = window.setTimeout(apply, wait);
    };
    const onUp = () => { if (timer) window.clearTimeout(timer); apply(); handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp); };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  if (phone) {
    return (
      <ThemeOverrideContext.Provider value="dark">
        <div ref={ref} data-page-canvas={page} style={{ position: 'relative', width: '100%', height: '100%', background: tk.bg.render, overflow: 'hidden' }}>
          <ShaderCanvas onCanvasReady={onCanvasReady} onRegisterOfflineRender={onOffline} />
          {overlay}
          <PhoneFullscreenChrome showEnter />
          {tools && <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 6, display: 'flex', gap: 6, alignItems: 'center' }}>{tools}</div>}
          <MobilePreviewPill />
        </div>
      </ThemeOverrideContext.Provider>
    );
  }

  return (
    <div ref={ref} data-page-canvas={page} style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: '#0d0d12', font: `12.5px ${fontFamily.ui}`, ...(resizable ? { width: clampCanvasWidth(width, room, defaultShare), flexShrink: 0, borderLeft: `1px solid ${tk.border.default}` } : { flex: 1, minWidth: 0 }) }}>
      {resizable && (
        <div onPointerDown={startResize} title="Drag to resize the canvas" style={{ position: 'absolute', top: 0, bottom: 0, left: -4, width: 8, cursor: 'col-resize', zIndex: 30 }} />
      )}
      {/* Chrome around the picture follows the app's real theme; the picture itself stays dark (below). */}
      <ThemeOverrideContext.Provider value={null}>
        <PreviewHeader>
          {tools}
          {tools && <span style={{ width: 8, flexShrink: 0 }} />}
          <AspectPicker onPanel />
          <CanvasFullscreenButton />
          <IconButton icon="record" label="Record a video or take a Snapshot PNG of the picture" size="sm" onClick={openRecord} />
        </PreviewHeader>
      </ThemeOverrideContext.Provider>
      <ThemeOverrideContext.Provider value="dark">
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <ShaderCanvas onCanvasReady={onCanvasReady} onRegisterOfflineRender={onOffline} />
          {overlay}
        </div>
      </ThemeOverrideContext.Provider>
      <ThemeOverrideContext.Provider value={null}>
        <PreviewFooter idleHint={idleHint} />
      </ThemeOverrideContext.Provider>
    </div>
  );
}
