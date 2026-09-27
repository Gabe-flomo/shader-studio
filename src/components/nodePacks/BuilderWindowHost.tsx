/**
 * BuilderWindowHost — the popped-out Builder, mounted once beside the app.
 *
 * Desktop and tablet: a window floating over whatever page is showing. Drag
 * it by its title bar, resize it from any edge or corner, snap it to the
 * right edge as a full-height panel, or dock it back into the Builder page.
 * Phones: a full-screen sheet.
 *
 * Desktop app: this is the same in-app window. A real second macOS window
 * would be a second webview with its own copy of every store, so edits
 * wouldn't be shared without a sync layer; the in-app window shares them for
 * free (docs/node-packs.md).
 */
import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { IconButton, Button } from '../ui/Button';
import { useBreakpoint, isMobile } from '../../hooks/useBreakpoint';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import { requestPage } from '../page';
import { clampRect, dockBuilder, MIN_H, MIN_W, setBuilderRect, toggleBuilderSnap, useBuilderWindow, type WindowRect } from './builderWindow';
import type { BuilderShell as BuilderShellT } from './BuilderShell';

const BuilderShell = lazyWithSuspense<PropsOf<typeof BuilderShellT>>(() => import('./BuilderShell').then(m => ({ default: m.BuilderShell })));

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function BuilderWindowHost() {
  const popped = useBuilderWindow(s => s.popped);
  return popped ? <BuilderWindow /> : null;
}

function BuilderWindow() {
  const tk = useTokens();
  const phone = isMobile(useBreakpoint());
  const rect = useBuilderWindow(s => s.rect);
  const snap = useBuilderWindow(s => s.snap);
  const flash = useBuilderWindow(s => s.flash);
  const drag = useRef<{ kind: 'move' | Edge; x: number; y: number; start: WindowRect } | null>(null);

  // Stay on screen when the browser window shrinks.
  useEffect(() => {
    const onResize = () => { const r = useBuilderWindow.getState().rect; const c = clampRect(r); if (c.x !== r.x || c.y !== r.y || c.w !== r.w || c.h !== r.h) useBuilderWindow.setState({ rect: c }); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const start = (kind: 'move' | Edge) => (e: RPointerEvent) => {
    if (e.button !== 0) return;
    // A press on a title-bar button isn't a drag.
    if (kind === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const s = useBuilderWindow.getState();
    const from = s.snap === 'right' ? snappedRect() : s.rect;
    drag.current = { kind, x: e.clientX, y: e.clientY, start: from };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
      const r = { ...d.start };
      if (d.kind === 'move') { r.x += dx; r.y += dy; }
      else {
        if (d.kind.includes('e')) r.w = Math.max(MIN_W, d.start.w + dx);
        if (d.kind.includes('s')) r.h = Math.max(MIN_H, d.start.h + dy);
        if (d.kind.includes('w')) { const w = Math.max(MIN_W, d.start.w - dx); r.x = d.start.x + d.start.w - w; r.w = w; }
        if (d.kind.includes('n')) { const h = Math.max(MIN_H, d.start.h - dy); r.y = d.start.y + d.start.h - h; r.h = h; }
      }
      setBuilderRect(clampRect(r));
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBuilderRect(useBuilderWindow.getState().rect, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dock = () => { dockBuilder(); requestPage('fn'); };

  if (phone) {
    return (
      <div role="dialog" aria-label="Builder" style={{ position: 'fixed', inset: 0, zIndex: 1500, display: 'flex', flexDirection: 'column', background: tk.bg.panel, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <BuilderShell compact actions={<IconButton icon="close" label="Close the builder" tooltip={false} onClick={dockBuilder} style={{ width: 38, height: 38 }} />} />
      </div>
    );
  }

  const r = snap === 'right' ? snappedRect() : rect;
  const edge = (k: Edge, style: React.CSSProperties) => (
    <div onPointerDown={start(k)} style={{ position: 'absolute', zIndex: 2, cursor: `${k}-resize`, ...style }} />
  );
  return (
    <div role="dialog" aria-label="Builder window"
      style={{
        position: 'fixed', left: r.x, top: r.y, width: r.w, height: r.h, zIndex: 1500, display: 'flex', flexDirection: 'column',
        borderRadius: snap === 'right' ? 0 : radius.modal, overflow: 'hidden', background: tk.bg.panel, color: tk.text.primary,
        boxShadow: flash ? `0 0 0 3px ${tk.accent.base}, ${tk.shadow.modal}` : `0 0 0 1px ${tk.border.default}, ${tk.shadow.modal}`, transition: 'box-shadow 0.2s',
        font: `12.5px ${fontFamily.ui}`,
      }}>
      <div onPointerDown={start('move')} onDoubleClick={toggleBuilderSnap}
        style={{ height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 0 12px', background: tk.bg.subtle, borderBottom: `1px solid ${tk.border.subtle}`, cursor: 'move', userSelect: 'none', touchAction: 'none' }}>
        <b style={{ fontSize: 12, fontWeight: 650, color: tk.text.secondary }}>Builder</b>
        <span style={{ fontSize: 11.5, color: tk.text.faint }}>drag to move · double-click to {snap === 'right' ? 'float' : 'snap right'}</span>
        <span style={{ flex: 1 }} />
        <IconButton icon={snap === 'right' ? 'popout' : 'panelRight'} size="sm" label={snap === 'right' ? 'Float the window' : 'Snap to the right edge'} onClick={toggleBuilderSnap} />
        <Button size="sm" variant="ghost" icon="panelLeft" title="Put the builder back in the Builder page" onClick={dock} style={{ height: 24 }}>Dock</Button>
        <IconButton icon="close" size="sm" label="Close the window (the builder docks)" onClick={dockBuilder} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <BuilderShell />
      </div>
      {snap !== 'right' && <>
        {edge('n', { left: 8, right: 8, top: 0, height: 5 })}
        {edge('s', { left: 8, right: 8, bottom: 0, height: 6 })}
        {edge('e', { top: 8, bottom: 8, right: 0, width: 6 })}
        {edge('w', { top: 8, bottom: 8, left: 0, width: 6 })}
        {edge('nw', { left: 0, top: 0, width: 10, height: 10 })}
        {edge('ne', { right: 0, top: 0, width: 10, height: 10 })}
        {edge('sw', { left: 0, bottom: 0, width: 12, height: 12 })}
        {edge('se', { right: 0, bottom: 0, width: 14, height: 14 })}
      </>}
      {snap === 'right' && edge('w', { top: 0, bottom: 0, left: 0, width: 6 })}
    </div>
  );
}

/** The right-edge panel: full height below the top bar, the window's width. */
function snappedRect(): WindowRect {
  const { rect } = useBuilderWindow.getState();
  const w = Math.min(Math.max(MIN_W, rect.w), window.innerWidth - 40);
  return { x: window.innerWidth - w, y: 48, w, h: window.innerHeight - 48 };
}
