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
 *
 * `scripts` replaces Script layers' code in this canvas only (a live code
 * block on the same step): straight into the mount, or by postMessage into
 * the sandboxed frame; `onScript` hears back whether each one runs.
 * Over the picture: Enable camera (camera layers), Play sound (the graph's
 * songs) and Stage (this canvas on the Stage), as each applies.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { mountPlay, stills, useCamera, useLiveSlots, useSlot, type PlayMount } from '../../present/runtimeHost';
import type { ScriptEdits } from '../../present/liveScript';
import { sourceLimits } from '../../present/snapshot';
import { aspectRatio, type BlockAspect, type PresentSource } from '../../types/presentation';
import { DEFAULT_EMBED, buildPlayHtml, playUsesCamera } from '../../play/exportHtml';
import { playUses3D, useThreeSource } from '../../play/threeSource';
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
  /** Layer id → code: Script layers edited on this step (a live code block). */
  scripts?: ScriptEdits;
  /** Each Script layer's state: null when it runs, else the error. */
  onScript?: (layerId: string, error: string | null) => void;
  /** Open this canvas on the Stage. */
  onStage?: () => void;
  /** Phones: shorter labels on the buttons over the picture. */
  compact?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
}

/** How long typing pauses before an edit runs (so half-typed code doesn't flash errors). */
const SCRIPT_DELAY = 300;

export function PlayCanvas({ slotId, source, aspect, pointer, startTime, paused, active, sandbox = false, onMount, scripts, onScript, onStage, compact = false, style, children }: PlayCanvasProps) {
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
  const onScriptRef = useRef(onScript);
  const scriptsRef = useRef(scripts);
  useEffect(() => { onMountRef.current = onMount; onScriptRef.current = onScript; scriptsRef.current = scripts; });
  const [still, setStill] = useState<string | null>(() => stills.get(slotId) ?? null);
  // The graph's own songs: the page stays quiet until the reader asks.
  const mountRef = useRef<PlayMount | null>(null);
  const hasSound = !!bundle?.media?.audio?.some(a => a.src);
  const [audible, setAudible] = useState(false);
  // Camera layers: dark until the reader turns the camera on (once for the page).
  const usesCamera = !!bundle && playUsesCamera(bundle.play);
  const camera = useCamera(s => s.status);
  const enableCamera = useCamera(s => s.enable);

  useEffect(() => {
    const el = hostRef.current;
    if (!live || framed || !el || !bundle) return;
    let m: PlayMount | null = null;
    try {
      m = mountPlay(el, bundle, { panel: false, pointer, markers: pointer, startTime, paused, pauseOffscreen: true, onScript: (id, err) => onScriptRef.current?.(id, err) });
      for (const [id, code] of Object.entries(scriptsRef.current ?? {})) m.setScript?.(id, code);
    } catch (e) {
      // The player shows its own errors (a shader that won't compile here); this is anything else.
      el.innerHTML = `<div class="ssp-error">${String(e instanceof Error ? e.message : e).replace(/[<>&]/g, '')}</div>`;
      return;
    }
    onMountRef.current?.(m);
    mountRef.current = m;
    return () => {
      const png = m?.still?.();
      if (png) { stills.set(slotId, png); setStill(png); }
      onMountRef.current?.(null);
      mountRef.current = null;
      setAudible(false);
      m?.destroy();
    };
  }, [live, framed, bundle, pointer, startTime, paused, slotId]);

  // Someone else's Script layers run in a sandboxed page of their own; an interactive block's controls come with it (that page's panel).
  const withPanel = !!onMount;
  // A 3D Script layer: the framed page carries three.js, so it waits for it to load.
  const threeReady = useThreeSource(!!framed && !!bundle && playUses3D(bundle.play));
  const frameHtml = useMemo(() => (framed && live && bundle && threeReady
    ? buildPlayHtml(bundle, withPanel ? { ...DEFAULT_EMBED, mode: 'player', fit: 'cover', host: true } : { ...DEFAULT_EMBED, mode: 'background', fit: 'cover', followPage: false, markers: false, host: true })
    : null), [framed, live, bundle, withPanel, threeReady]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameReady = useRef(false);

  // Script edits: every Script layer gets its edited code, or the snapshot's again after a Reset.
  // A pause in typing first, then straight into the mount, or across to the sandboxed frame.
  const sendScripts = useRef<() => void>(() => {});
  useEffect(() => {
    sendScripts.current = () => {
      if (!bundle) return;
      for (const l of bundle.play.layers) {
        if (l.kind !== 'script') continue;
        const code = scripts?.[l.id] ?? l.code;
        if (framed) { if (frameReady.current) frameRef.current?.contentWindow?.postMessage({ ssp: 'script', layerId: l.id, code }, '*'); }
        else mountRef.current?.setScript?.(l.id, code);
      }
    };
  });
  const scriptsKey = JSON.stringify(scripts ?? {});
  useEffect(() => {
    const t = window.setTimeout(() => sendScripts.current(), SCRIPT_DELAY);
    return () => window.clearTimeout(t);
  }, [scriptsKey]);
  useEffect(() => {
    if (!framed || !live) return;
    frameReady.current = false;
    const onMessage = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const d = e.data as { ssp?: string; layerId?: unknown; error?: unknown } | null;
      if (d?.ssp === 'ready') { frameReady.current = true; sendScripts.current(); }
      else if (d?.ssp === 'scriptStatus' && typeof d.layerId === 'string') onScriptRef.current?.(d.layerId, typeof d.error === 'string' ? d.error.slice(0, 600) : null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [framed, live, frameHtml]);


  const ratio = aspectRatio(aspect);
  const overBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, border: 0, borderRadius: 8, padding: '0 10px', background: alpha('#0b0b10', 0.7), color: '#fff', font: `600 12px ${fontFamily.ui}`, cursor: 'pointer', backdropFilter: 'blur(6px)', whiteSpace: 'nowrap' };
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
    <div ref={boxRef} data-canvas={slotId} data-live={live || undefined} style={{ position: 'relative', width: '100%', aspectRatio: `${ratio}`, borderRadius: `var(--pp-radius, ${radius.lg}px)`, overflow: 'hidden', background: tk.bg.render, ...style }}>
      {!live && picture && <img src={picture} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      {live && !framed && <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />}
      {live && framed && frameHtml && (
        <iframe ref={frameRef} title={source?.title ?? 'Play'} sandbox="allow-scripts" allow="camera; microphone; midi" srcDoc={frameHtml} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, pointerEvents: pointer ? 'auto' : 'none' }} />
      )}
      {live && framed && (
        <span title="This presentation came from a file, so its Script layers are someone else's code: they run in a sealed-off frame with no access to Playfield." style={{ position: 'absolute', top: 10, left: 10, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 7, background: alpha('#0b0b10', 0.7), color: alpha('#ffffff', 0.85), font: `600 11px ${fontFamily.ui}`, pointerEvents: 'auto' }}>
          <Icon name="lock" size={12} />Sandboxed
        </span>
      )}
      {!source && note('warning', 'Its source was removed from this presentation.')}
      {source && limits.length > 0 && note('warning', `Still frame: the web player can’t run ${limits.map(l => l.split(':')[0]).join(', ')} yet.`)}
      {source && runnable && wanted && slot === 'waiting' && note('pause', 'Paused to keep the page light: other canvases are running.', (
        <button type="button" onClick={() => promote(slotId)} style={{ border: 0, borderRadius: 6, padding: '4px 9px', background: alpha('#ffffff', 0.16), color: '#fff', font: `600 11.5px ${fontFamily.ui}`, cursor: 'pointer' }}>Run</button>
      ))}
      {(onStage || (live && !framed && (hasSound || (usesCamera && camera !== 'on')))) && (
        <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 'calc(100% - 20px)' }}>
          {live && !framed && usesCamera && camera !== 'on' && (
            <button type="button" disabled={camera === 'asking'} onClick={() => void enableCamera()}
              title={camera === 'blocked' ? 'The browser was told no. Allow the camera in its address bar, then try again.' : camera === 'unsupported' ? 'This browser has no camera to offer' : 'The picture reads your camera. Nothing leaves this computer.'}
              style={overBtn}>
              <Icon name="camera" size={13} />{camera === 'blocked' ? 'Camera blocked' : camera === 'unsupported' ? 'No camera' : camera === 'asking' ? 'Asking…' : compact ? 'Camera' : 'Enable camera'}
            </button>
          )}
          {live && !framed && hasSound && (
            <button type="button" onClick={() => { const on = !audible; setAudible(on); mountRef.current?.sound?.(on); }}
              title={audible ? 'Mute the song the picture reacts to' : 'Play the song the picture reacts to'}
              style={overBtn}>
              <Icon name="wave" size={13} />{audible ? 'Mute' : compact ? 'Sound' : 'Play sound'}
            </button>
          )}
          {onStage && (
            <button type="button" onClick={onStage} title="Open this canvas on the Stage: fullscreen, phone or screen, with its controls, ready to record" aria-label="Open on the Stage" style={overBtn}>
              <Icon name="popout" size={13} />{compact ? null : 'Stage'}
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
