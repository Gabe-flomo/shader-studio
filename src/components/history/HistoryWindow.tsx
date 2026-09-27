/**
 * HistoryWindow — the History panel popped out of the sidebar into a larger
 * floating window (like the floating preview): dragged by its title bar,
 * resized from its corner, placed where it was last time. Wide enough, it
 * shows the list and the chosen entry's details side by side.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { portalGuard } from '../ui/portalGuard';
import { HistoryPanel } from './HistoryPanel';
import { useHistoryWindow } from './historyWindowStore';

const RECT_KEY = 'playfield:history-window';

interface Rect { x: number; y: number; w: number; h: number }

function loadRect(): Rect {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth, vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const fallback = { w: Math.min(760, vw - 40), h: Math.min(620, vh - 100), x: 0, y: 70 };
  fallback.x = Math.max(20, Math.round((vw - fallback.w) / 2));
  try {
    const r = JSON.parse(localStorage.getItem(RECT_KEY) ?? 'null') as Rect | null;
    if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite)) return clampRect(r);
  } catch { /* a preference only */ }
  return fallback;
}

/** Keeps the title bar on screen and the window no bigger than the screen. */
function clampRect(r: Rect): Rect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.max(320, Math.min(r.w, vw - 16)), h = Math.max(260, Math.min(r.h, vh - 16));
  return { w, h, x: Math.max(8 - w + 120, Math.min(r.x, vw - 120)), y: Math.max(8, Math.min(r.y, vh - 48)) };
}

function saveRect(r: Rect) {
  try { localStorage.setItem(RECT_KEY, JSON.stringify(r)); } catch { /* a preference only */ }
}

/** Mounted once by the app (desktop); draws the window while it's open. */
export function HistoryWindowHost() {
  const open = useHistoryWindow(s => s.open);
  return open ? <HistoryWindow /> : null;
}

function HistoryWindow() {
  const tk = useTokens();
  const [rect, setRect] = useState<Rect>(loadRect);
  const rectRef = useRef(rect);
  useEffect(() => { rectRef.current = rect; }, [rect]);
  const boxRef = useRef<HTMLDivElement>(null);
  const close = () => useHistoryWindow.getState().setOpen(false);

  // The corner handle resizes the box (CSS resize); remember the size it's left at.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let t: number | null = null;
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w === rectRef.current.w && h === rectRef.current.h) return;
      rectRef.current = { ...rectRef.current, w, h };
      if (t !== null) window.clearTimeout(t);
      t = window.setTimeout(() => saveRect(rectRef.current), 300);
    });
    ro.observe(el);
    return () => { ro.disconnect(); if (t !== null) window.clearTimeout(t); };
  }, []);

  // Esc closes it (unless something inside handles Esc first: a popover, a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!boxRef.current?.contains(document.activeElement)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, start = rectRef.current;
    const onMove = (ev: PointerEvent) => setRect(clampRect({ ...start, w: rectRef.current.w, h: rectRef.current.h, x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy }));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      saveRect(rectRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return createPortal(
    <div
      {...portalGuard}
      ref={boxRef}
      role="dialog"
      aria-label="History"
      data-history-window=""
      style={{
        position: 'fixed', left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: 600,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', resize: 'both', minWidth: 320, minHeight: 260,
        background: tk.bg.panel, color: tk.text.primary, borderRadius: radius.lg + 2, boxShadow: `${tk.shadow.modal}, 0 0 0 1px ${tk.border.default}`,
        font: `12.5px ${fontFamily.ui}`,
      }}
    >
      <div
        onPointerDown={startDrag}
        style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 14px', cursor: 'grab', userSelect: 'none', borderBottom: `1px solid ${tk.border.subtle}` }}
      >
        <Icon name="history" size={15} style={{ color: tk.accent.base }} />
        <b style={{ flex: 1, fontSize: 14, fontWeight: 650 }}>History</b>
        <span onPointerDown={e => e.stopPropagation()} style={{ display: 'flex', gap: 2 }}>
          <IconButton icon="sidebar" size="sm" label="Put History back in the sidebar" onClick={close} />
          <IconButton icon="close" size="sm" label="Close" shortcut="esc" onClick={close} />
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 12px 0' }}>
        <HistoryPanel mode="window" />
      </div>
    </div>,
    document.body,
  );
}
