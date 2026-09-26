/**
 * PlayCanvas — one canvas on the Present page: a source's Play running in the
 * web player (runtimeHost), in a box of the block's shape.
 *
 * It runs only while it's wanted (on the current slide, or on screen in the
 * scroll view) and a live slot is free; otherwise it shows its last frame
 * (or the source's still) and says why. Sources that use something the web
 * player can't run yet show their still with a note naming what's missing.
 * Canvases whose Play has Script layers, in a presentation from a file,
 * run the exported page in a sandboxed frame instead (someone else's code).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { mountPlay, stills, useHasSlot, useLiveSlots, type PlayMount } from '../../present/runtimeHost';
import { sourceLimits } from '../../present/snapshot';
import { aspectRatio, type BlockAspect, type PresentSource } from '../../types/presentation';
import { DEFAULT_EMBED, buildPlayHtml } from '../../play/exportHtml';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';

export interface PlayCanvasProps {
  /** Unique per canvas on the page (the block id, plus a suffix where one block shows twice). */
  slotId: string;
  source: PresentSource | undefined;
  aspect: BlockAspect;
  pointer: boolean;
  startTime?: number;
  paused?: boolean;
  /** Should run if it can: the current slide, on screen, and so on. */
  active: boolean;
  /** Run someone else's Script layers in a sandboxed frame. */
  sandbox?: boolean;
  /** The mount (to read and set controls), or null when it stops. */
  onMount?: (m: PlayMount | null) => void;
  style?: CSSProperties;
  children?: ReactNode;
}

export function PlayCanvas({ slotId, source, aspect, pointer, startTime, paused, active, sandbox = false, onMount, style, children }: PlayCanvasProps) {
  const tk = useTokens();
  const limits = useMemo(() => (source ? sourceLimits(source) : []), [source]);
  const hasScript = !!source?.bundle.play.layers.some(l => l.kind === 'script');
  const framed = sandbox && hasScript;
  const runnable = !!source && limits.length === 0;
  // Only while on screen (with a margin, so it's running by the time it scrolls in).
  const boxRef = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setOnScreen(true); return; }
    const io = new IntersectionObserver(es => setOnScreen(es.some(e => e.isIntersecting)), { rootMargin: '160px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const wanted = active && onScreen;
  const want = useLiveSlots(s => s.want);
  const drop = useLiveSlots(s => s.drop);
  const promote = useLiveSlots(s => s.promote);
  useEffect(() => {
    if (wanted && runnable) want(slotId); else drop(slotId);
  }, [wanted, runnable, slotId, want, drop]);
  useEffect(() => () => drop(slotId), [slotId, drop]);
  const live = useHasSlot(slotId) && wanted && runnable;

  const bundle = source?.bundle;
  const hostRef = useRef<HTMLDivElement>(null);
  const onMountRef = useRef(onMount);
  useEffect(() => { onMountRef.current = onMount; });
  const [still, setStill] = useState<string | null>(() => stills.get(slotId) ?? null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!live || framed || !el || !bundle) return;
    let m: PlayMount | null = null;
    try {
      m = mountPlay(el, bundle, { panel: false, pointer, markers: pointer, startTime, paused, pauseOffscreen: true });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      return;
    }
    const err = el.querySelector('.ssp-error');
    setFailed(err ? err.textContent : null);
    onMountRef.current?.(m);
    return () => {
      const png = m?.still?.();
      if (png) { stills.set(slotId, png); setStill(png); }
      onMountRef.current?.(null);
      m?.destroy();
    };
  }, [live, framed, bundle, pointer, startTime, paused, slotId]);

  const frameHtml = useMemo(() => (framed && live && source
    ? buildPlayHtml(source.bundle, { ...DEFAULT_EMBED, mode: 'background', fit: 'cover', followPage: false, markers: false })
    : null), [framed, live, source]);

  const ratio = aspectRatio(aspect);
  const picture = still ?? source?.poster ?? null;
  const note = (icon: 'info' | 'pause' | 'warning', text: string, action?: ReactNode) => (
    <div style={{
      position: 'absolute', left: 10, bottom: 10, right: 10, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
      borderRadius: radius.md, background: alpha('#0b0b10', 0.78), color: '#e8e8ef', font: `500 12px/1.35 ${fontFamily.ui}`, backdropFilter: 'blur(6px)',
    }}>
      <Icon name={icon} size={14} style={{ flexShrink: 0, color: icon === 'warning' ? '#f5c46b' : alpha('#ffffff', 0.7) }} />
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      {action}
    </div>
  );
  return (
    <div ref={boxRef} data-canvas={slotId} data-live={live || undefined} style={{ position: 'relative', width: '100%', aspectRatio: `${ratio}`, borderRadius: radius.lg, overflow: 'hidden', background: tk.bg.render, ...style }}>
      {!live && picture && <img src={picture} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      {live && !framed && <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />}
      {live && framed && frameHtml && (
        <iframe title={source?.title ?? 'Play'} sandbox="allow-scripts" srcDoc={frameHtml} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, pointerEvents: pointer ? 'auto' : 'none' }} />
      )}
      {!source && note('warning', 'Its source was removed from this presentation.')}
      {source && limits.length > 0 && note('warning', `Still frame: the web player can’t run ${limits.join(', ')} yet.`)}
      {source && runnable && wanted && !live && note('pause', 'Paused to keep the page light: other canvases are running.', (
        <button type="button" onClick={() => promote(slotId)} style={{ border: 0, borderRadius: 6, padding: '4px 9px', background: alpha('#ffffff', 0.16), color: '#fff', font: `600 11.5px ${fontFamily.ui}`, cursor: 'pointer' }}>Run</button>
      ))}
      {failed && live && note('warning', failed)}
      {children}
    </div>
  );
}
