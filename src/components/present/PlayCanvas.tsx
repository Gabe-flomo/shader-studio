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
import { mountPlay, stills, useLiveSlots, useSlot, type PlayMount } from '../../present/runtimeHost';
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
  const [onScreen, setOnScreen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
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
  const slot = useSlot(slotId);
  const live = slot === 'live' && wanted && runnable;

  const bundle = source?.bundle;
  const hostRef = useRef<HTMLDivElement>(null);
  const onMountRef = useRef(onMount);
  useEffect(() => { onMountRef.current = onMount; });
  const [still, setStill] = useState<string | null>(() => stills.get(slotId) ?? null);
  // The graph's own songs: the page stays quiet until the reader asks.
  const soundRef = useRef<PlayMount | null>(null);
  const hasSound = !!bundle?.media?.audio?.some(a => a.src);
  const [audible, setAudible] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!live || framed || !el || !bundle) return;
    let m: PlayMount | null = null;
    try {
      m = mountPlay(el, bundle, { panel: false, pointer, markers: pointer, startTime, paused, pauseOffscreen: true });
    } catch (e) {
      // The player shows its own errors (a shader that won't compile here); this is anything else.
      el.innerHTML = `<div class="ssp-error">${String(e instanceof Error ? e.message : e).replace(/[<>&]/g, '')}</div>`;
      return;
    }
    onMountRef.current?.(m);
    soundRef.current = m;
    return () => {
      const png = m?.still?.();
      if (png) { stills.set(slotId, png); setStill(png); }
      onMountRef.current?.(null);
      soundRef.current = null;
      setAudible(false);
      m?.destroy();
    };
  }, [live, framed, bundle, pointer, startTime, paused, slotId]);

  // Someone else's Script layers run in a sandboxed page of their own; an interactive block's controls come with it (that page's panel).
  const withPanel = !!onMount;
  const frameHtml = useMemo(() => (framed && live && bundle
    ? buildPlayHtml(bundle, withPanel ? { ...DEFAULT_EMBED, mode: 'player', fit: 'cover' } : { ...DEFAULT_EMBED, mode: 'background', fit: 'cover', followPage: false, markers: false })
    : null), [framed, live, bundle, withPanel]);


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
      {live && framed && (
        <span title="This presentation came from a file, so its Script layers are someone else's code: they run in a sealed-off frame with no access to Playfield." style={{ position: 'absolute', top: 10, left: 10, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 7, background: alpha('#0b0b10', 0.7), color: alpha('#ffffff', 0.85), font: `600 11px ${fontFamily.ui}`, pointerEvents: 'auto' }}>
          <Icon name="lock" size={12} />Sandboxed
        </span>
      )}
      {!source && note('warning', 'Its source was removed from this presentation.')}
      {source && limits.length > 0 && note('warning', `Still frame: the web player can’t run ${limits.join(', ')} yet.`)}
      {source && runnable && wanted && slot === 'waiting' && note('pause', 'Paused to keep the page light: other canvases are running.', (
        <button type="button" onClick={() => promote(slotId)} style={{ border: 0, borderRadius: 6, padding: '4px 9px', background: alpha('#ffffff', 0.16), color: '#fff', font: `600 11.5px ${fontFamily.ui}`, cursor: 'pointer' }}>Run</button>
      ))}
      {live && !framed && hasSound && (
        <button type="button" onClick={() => { const on = !audible; setAudible(on); soundRef.current?.sound?.(on); }}
          title={audible ? 'Mute the song the picture reacts to' : 'Play the song the picture reacts to'}
          style={{ position: 'absolute', top: 10, right: 10, display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 8, padding: '5px 10px', background: alpha('#0b0b10', 0.7), color: '#fff', font: `600 12px ${fontFamily.ui}`, cursor: 'pointer', backdropFilter: 'blur(6px)' }}>
          <Icon name="wave" size={13} />{audible ? 'Mute' : 'Play sound'}
        </button>
      )}
      {children}
    </div>
  );
}
