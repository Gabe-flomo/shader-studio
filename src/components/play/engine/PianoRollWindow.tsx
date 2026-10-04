/**
 * PianoRollWindow — a MIDI clip's notes in a big, Live-style clip view of
 * their own (docs/piano-roll.md): double-click a clip on the tape. A floating
 * window over the app, like the History window: dragged by its title bar,
 * resized from its corner, put back where it was last time. Inside, the
 * PianoRoll in its window layout: the clip panel (clip, scale, functions) on
 * the left, keys and grid in the middle, the velocity lane under them.
 *
 * It edits the same Play record as everything else (one undo step per edit),
 * so the tape follows live. Esc (with nothing selected) or × closes it; the
 * dock button moves the clip into the device area's Notes view instead.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import { IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { portalGuard } from '../../ui/portalGuard';
import { WIN_MIN_H, WIN_MIN_W, clampWinRect, loadWinRect, type WinRect } from '../../../play/pianoRollWindow';
import { trackClips, type PlayArrangement } from '../../../types/playArrangement';
import type { AeRack } from '../../../types/playAudioEngine';
import { PianoRoll } from './PianoRoll';
import { usePianoRollWindow } from './pianoRollWindowStore';

const RECT_KEY = 'playfield:piano-roll-window';

const load = (): WinRect => {
  let raw: string | null = null;
  try { raw = localStorage.getItem(RECT_KEY); } catch { /* a preference only */ }
  return loadWinRect(raw, window.innerWidth, window.innerHeight);
};
const save = (r: WinRect) => { try { localStorage.setItem(RECT_KEY, JSON.stringify(r)); } catch { /* a preference only */ } };

/** Drawn by the arrangement while a clip is open in the window. */
export function PianoRollWindowHost({ racks, arr, colorOf, touch, onDock }: {
  racks: readonly AeRack[]; arr: PlayArrangement; colorOf: (rackId: string) => string; touch: boolean;
  /** Put the clip in the device area's Notes view instead. */
  onDock: (rack: string, t: number) => void;
}) {
  const target = usePianoRollWindow(s => s.target);
  const rack = target ? racks.find(r => r.id === target.rack) : undefined;
  // The rack went (deleted, an undo): the window goes with it.
  useEffect(() => { if (target && !rack) usePianoRollWindow.getState().close(); }, [target, rack]);
  if (!target || !rack) return null;
  return <PianoRollWindow rack={rack} arr={arr} t={target.t} fitKey={target.key} color={colorOf(rack.id)} touch={touch} onDock={onDock} />;
}

function PianoRollWindow({ rack, arr, t, fitKey, color, touch, onDock }: {
  rack: AeRack; arr: PlayArrangement; t: number; fitKey: number; color: string; touch: boolean; onDock: (rack: string, t: number) => void;
}) {
  const tk = useTokens();
  const [rect, setRect] = useState<WinRect>(load);
  const rectRef = useRef(rect);
  useEffect(() => { rectRef.current = rect; }, [rect]);
  const boxRef = useRef<HTMLDivElement>(null);
  const close = () => usePianoRollWindow.getState().close();
  const clips = trackClips(arr.tracks[rack.id], arr.length);
  const index = clips.findIndex(c => t >= c.t - 1e-6 && t < c.t + c.d - 1e-6);

  // Opening puts the keyboard in the roll (its shortcuts work straight away).
  useEffect(() => { boxRef.current?.querySelector<HTMLElement>('[data-piano-roll]')?.focus({ preventScroll: true }); }, [fitKey]);

  // The corner handle resizes the box (CSS resize); remember the size it's left at.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let timer: number | null = null;
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w === rectRef.current.w && h === rectRef.current.h) return;
      rectRef.current = { ...rectRef.current, w, h };
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => save(rectRef.current), 300);
    });
    ro.observe(el);
    return () => { ro.disconnect(); if (timer !== null) window.clearTimeout(timer); };
  }, []);

  // The app's window shrinking keeps it on screen.
  useEffect(() => {
    const onResize = () => setRect(r => clampWinRect({ ...r, w: rectRef.current.w, h: rectRef.current.h }, window.innerWidth, window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Esc closes it, unless something inside used it first (the roll lets go of a selection, a field cancels).
  // Caught here, before it bubbles on to the page behind (whose own Esc would take it).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, start = rectRef.current;
    const onMove = (ev: PointerEvent) => setRect(clampWinRect({ ...start, w: rectRef.current.w, h: rectRef.current.h, x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy }, window.innerWidth, window.innerHeight));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      save(rectRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const title = index >= 0 ? `${rack.name} · clip ${index + 1}` : rack.name;
  return createPortal(
    <div
      {...portalGuard}
      ref={boxRef}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-label={`Piano roll: ${title}`}
      data-piano-roll-window=""
      style={{
        position: 'fixed', left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: 600,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', resize: 'both', minWidth: Math.min(WIN_MIN_W, window.innerWidth - 16), minHeight: Math.min(WIN_MIN_H, window.innerHeight - 16),
        background: tk.bg.panel, color: tk.text.primary, borderRadius: radius.lg + 2, boxShadow: `${tk.shadow.modal}, 0 0 0 1px ${tk.border.default}`,
        font: `12.5px ${fontFamily.ui}`,
      }}
    >
      <div
        onPointerDown={startDrag}
        onDoubleClick={() => { const r = clampWinRect({ x: 8, y: 8, w: window.innerWidth, h: window.innerHeight }, window.innerWidth, window.innerHeight); setRect(r); rectRef.current = r; save(r); }}
        title="Drag to move; double-click to fill the screen"
        style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 14px', cursor: 'grab', userSelect: 'none', borderBottom: `1px solid ${tk.border.subtle}` }}
      >
        <Icon name="piano" size={15} style={{ color }} />
        <b style={{ fontSize: 13.5, fontWeight: 650, whiteSpace: 'nowrap' }}>Piano roll</b>
        <span style={{ flex: 1, minWidth: 0, color: tk.text.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 2 }}>
          <IconButton icon="sidebar" size="sm" label="Edit it in the device area instead (Notes)" onClick={() => { onDock(rack.id, t); close(); }} />
          <IconButton icon="close" size="sm" label="Close" shortcut="esc" onClick={close} />
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <PianoRoll key={fitKey} layout="window" rack={rack} arr={arr} anchor={t} color={color} touch={touch} onAnchor={a => usePianoRollWindow.getState().setAnchor(a)} />
      </div>
    </div>,
    document.body,
  );
}
