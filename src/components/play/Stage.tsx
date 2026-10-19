/**
 * Stage — the last step of Play: the picture on its own, the way people
 * will play with it, with nothing to edit. (It used to be called Present; the
 * Present page now builds step-by-step lessons from several Plays.)
 *
 *   Full   the app's own picture: everything works (songs, MIDI files, every
 *          layer), for playing and recording the visual you want.
 *   Exact  the website player itself, running the exported page in a frame,
 *          so you see what a visitor would, including what it leaves out.
 *
 * Both at the window's size or framed as a phone, the canvas shape from the
 * Play page (Free letterboxes, never crops), and fullscreen. The picture is
 * on the right, the controls on its left (a phone stacks the picture on top).
 * In Full the controls are Perform (Perform.tsx, docs/perform-mode.md): big
 * faders, knobs, pads and XY pads, with Randomize, Reset, Panic and takes.
 * Exact's column has what the page leaves out (its own panel has the
 * controls). Record captures the picture from whichever mode is showing.
 * Esc leaves.
 *
 * A Present page's canvas can open here too: then the Stage runs that
 * canvas's snapshot (as the presentation has it, with the step's Script
 * edits) in Exact, and says so; Full isn't offered, since the app's picture
 * is the open graph, not the snapshot.
 */
import { APP_HEIGHT } from '../../lib/viewport';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { leftBehind } from '../../play/exportHtml';
import { webExportScope } from '../../play/exportScope';
import { stagePageHtml } from '../../present/liveScript';
import { playUses3D, useThreeSource } from '../../play/threeSource';
import { playBackground } from '../../play/background';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { AspectPicker } from '../shell/PreviewChrome';
import { PHONE_SIZE, useStage, type StageMode, type StageSnapshot } from './stageStore';
import { showSnapshot, useOutput } from '../../output/outputHost';
import { InputLegend, Perform, PerformView } from './Perform';
import { PERFORM_STACK_PX, performSplit } from '../../play/perform';

export function Stage({ canvas, onRecord }: {
  /** The app's live picture (Full). */
  canvas: ReactNode;
  /** Open Record for this canvas; null means the app's own picture. */
  onRecord: (source: HTMLCanvasElement | null) => void;
}) {
  const tk = useTokens();
  const { mode, device, panel, snapshot: snap, open, exit, setDevice, togglePanel } = useStage();
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const openGraph = useNodeGraphStore(s => s.currentGraph?.name) ?? 'Playfield';
  const graphName = snap ? snap.title : openGraph;
  const graphPlay = useNodeGraphStore(s => s.play);
  const narrow = useNarrow(PERFORM_STACK_PX);
  const winW = useWindowWidth();
  const split = performSplit(winW);
  // A tablet-wide bar has no room for the phone frame (a desktop check) beside the rest.
  const roomy = winW >= 1000;

  // The Stage shows the Play picture: its image, video or colour background too.
  useEffect(() => playBackground.claim(), []);
  // Esc leaves (the browser's own Esc leaves fullscreen first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement) exit(); };
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); };
  }, [exit]);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  // Exact: the exported page, built when entering (Refresh rebuilds it after edits).
  const [build, setBuild] = useState(0);
  // A 3D Script layer: the page carries three.js, so Exact waits for it to load.
  const threeReady = useThreeSource(useNodeGraphStore(s => playUses3D(s.play)) && mode === 'exact' && !snap);
  const exact = useMemo(() => {
    if (mode !== 'exact' || !threeReady) return null;
    if (snap) return { html: snap.html, missing: snap.missing, left: snap.left };
    // The exported page as a web export makes it (play/exportScope.ts): tracking, camera, MIDI and mic held still.
    const { input: raw, missing } = useNodeGraphStore.getState().playWebInput(graphName);
    const { input, frozen } = webExportScope(raw);
    return { html: stagePageHtml(input), missing, left: [...frozen.map(f => ({ what: f.what, why: f.why })), ...leftBehind(input.play, input.media, { graphs: input.backgroundGraphs ?? {}, datasets: input.datasets })] };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, build, snap, threeReady]);

  const record = () => {
    if (mode === 'full') { onRecord(null); return; }
    const c = frameRef.current?.contentDocument?.querySelector('canvas.ssp-gl') as HTMLCanvasElement | null;
    onRecord(c);
  };

  // Perform is the Stage's default view: Full on the open graph (Exact and a snapshot run the page's own panel).
  const perform = mode === 'full' && !snap;
  const stageBox = useFitBox(device === 'phone' && !narrow ? PHONE_SIZE : null);

  const bar = { height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderBottom: `1px solid ${alpha('#ffffff', 0.08)}`, background: '#101016', color: '#e8e8ef' } as const;
  return (
    <div ref={rootRef} style={{ width: '100vw', height: APP_HEIGHT, display: 'flex', flexDirection: 'column', background: '#07070b', color: '#e8e8ef', font: `12.5px ${fontFamily.ui}` }}>
      <div style={bar}>
        <IconButton icon="close" label="Leave the Stage (Esc)" onClick={exit} />
        <b style={{ fontSize: 13.5, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: narrow ? 120 : 220, minWidth: 0 }}>{graphName}</b>
        {snap ? (
          <span title={`The snapshot in “${snap.presentation}”, run by the website player: not the graph open in the Studio`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 9px', borderRadius: 12, background: alpha('#ffffff', 0.1), color: alpha('#ffffff', 0.8), font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
            <Icon name="slides" size={12} />Snapshot
          </span>
        ) : (
          <span style={{ flexShrink: 0, display: 'inline-flex' }}>
            <Segmented size="sm" ariaLabel="Stage mode" value={mode ?? 'full'} onChange={m => open(m as StageMode)} options={[
              { value: 'full', label: 'Full', title: 'Everything Playfield can do: songs, MIDI files, every layer' },
              { value: 'exact', label: 'Exact', title: 'The website player itself: exactly what a visitor to the exported page gets' },
            ]} />
          </span>
        )}
        <span style={{ flex: 1 }} />
        {perform && panel && !narrow && <PerformView />}
        {roomy && (
          <Segmented size="sm" ariaLabel="Screen" value={device} onChange={setDevice} options={[
            { value: 'screen', label: 'Screen', title: 'Fill the window' },
            { value: 'phone', label: 'Phone', title: `A phone's screen (${PHONE_SIZE.w} × ${PHONE_SIZE.h})` },
          ]} />
        )}
        {mode === 'full' && !narrow && <AspectPicker />}
        {mode === 'exact' && !snap && <IconButton icon="reset" label="Rebuild the page with your latest changes" onClick={() => setBuild(b => b + 1)} />}
        <IconButton icon="layoutSplit" label={panel ? 'Hide the controls: the picture alone' : 'Show the controls'} active={panel} onClick={togglePanel} />
        {!narrow && <IconButton icon="fit" label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'} active={fullscreen} onClick={toggleFullscreen} />}
        <StageOutput snap={snap} frame={() => frameRef.current} />
        <Button size="sm" variant="primary" icon="record" onClick={record} disabled={!!snap?.sandboxed}
          aria-label="Record video"
          title={snap?.sandboxed ? 'Its Script layers are someone else’s code, so it runs sealed off from Playfield, where Record video can’t reach its picture' : 'Record video: the picture to a file'}
          style={{ background: tk.status.danger }}>{narrow ? null : 'Record video'}</Button>
      </div>
      {/* The controls on the left, the picture on the right (the user rule); a phone stacks the picture on top. */}
      <div data-stage-body style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: narrow ? 'column' : 'row' }}>
        {panel && (
          <div data-stage-controls style={{
            order: narrow ? 1 : 0, flexShrink: 0, minHeight: 0, minWidth: 0, background: '#101016', display: 'flex', flexDirection: 'column',
            ...(narrow ? { flex: '1 1 0', borderTop: `1px solid ${alpha('#ffffff', 0.08)}` } : { width: perform ? split.controls : 300, borderRight: `1px solid ${alpha('#ffffff', 0.08)}` }),
          }}>
            {perform ? <Perform onRender={() => onRecord(null)} viewInBar={narrow} /> : (
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px 18px' }}>
                {snap ? <SnapshotNotes snap={snap} /> : exact ? <ExactNotes missing={exact.missing} left={exact.left} /> : null}
                <InputLegend play={snap ? snap.play : graphPlay} />
              </div>
            )}
          </div>
        )}
        <div ref={stageBox.ref} data-stage-picture style={{ order: narrow ? 0 : 1, flex: narrow && panel ? '0 0 40%' : 1, minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <div style={{
            position: 'relative', flexShrink: 0,
            ...(stageBox.size ? { width: stageBox.size.w, height: stageBox.size.h, borderRadius: 28, overflow: 'hidden', boxShadow: `0 0 0 10px #1c1c24, 0 30px 80px ${alpha('#000000', 0.6)}` } : { width: '100%', height: '100%' }),
          }}>
            {mode === 'exact' && exact ? (
              <iframe
                ref={frameRef}
                key={build}
                title="The exported page"
                srcDoc={exact.html}
                sandbox={snap?.sandboxed ? 'allow-scripts' : undefined}
                allow="accelerometer; gyroscope; midi; microphone; camera; fullscreen"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: '#0d0d12' }}
              />
            ) : canvas}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The output window from the Stage (docs/projection.md): it always follows
 * the app's picture; a Present canvas can go to it instead, so the projector
 * shows the canvas while this screen keeps its controls.
 */
function StageOutput({ snap, frame }: { snap: StageSnapshot | null; frame: () => HTMLIFrameElement | null }) {
  const open = useOutput(s => s.open);
  const source = useOutput(s => s.source);
  // Leaving the Stage (or another canvas) gives the output back to the app's picture.
  useEffect(() => () => { void showSnapshot(null); }, [snap]);
  if (!open) return null;
  if (!snap) return <span title="The output window shows this picture too" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 9px', borderRadius: 12, background: alpha('#ffffff', 0.1), color: alpha('#ffffff', 0.8), font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}><Icon name="grid" size={12} />On the output</span>;
  const on = source === 'snapshot';
  return (
    <Button size="sm" variant={on ? 'primary' : 'secondary'} icon="grid" disabled={!snap.input || snap.sandboxed}
      title={snap.sandboxed ? 'Its Script layers are someone else’s code, so it runs sealed off, where the output can’t follow it' : on ? 'The output shows this canvas: click to show the Play again' : 'Show this canvas on the output window, following this page'}
      onClick={() => { void showSnapshot(on || !snap.input ? null : { input: snap.input, frame, sandboxed: snap.sandboxed }); }}>
      {on ? 'On the output' : 'Show on output'}
    </Button>
  );
}

/** The phone frame, scaled down to fit the stage when the window is smaller. */
function useFitBox(target: { w: number; h: number } | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!target || !avail) return { ref, size: null };
  const k = Math.min(1, (avail.w - 48) / target.w, (avail.h - 48) / target.h);
  return { ref, size: { w: Math.round(target.w * k), h: Math.round(target.h * k) } };
}

const heading = (text: string) => (
  <div style={{ color: alpha('#ffffff', 0.45), font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '4px 0 8px' }}>{text}</div>
);

/** The window's width, for the Stage's split (play/perform.ts performSplit). */
function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/** Phone-sized windows: the bar keeps what matters, the panel goes under the picture. */
function useNarrow(px = 640) {
  const q = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return narrow;
}

/** A Present canvas on the Stage: whose snapshot this is, and what the page leaves out. */
function SnapshotNotes({ snap }: { snap: StageSnapshot }) {
  const when = snap.capturedAt ? new Date(snap.capturedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return (
    <div style={{ marginBottom: 18, lineHeight: 1.5 }}>
      {heading('From the presentation')}
      <div style={{ color: alpha('#ffffff', 0.7) }}>
        The snapshot of <b style={{ color: '#fff' }}>{snap.title}</b> in “{snap.presentation}”{when ? `, taken ${when}` : ''}, run by the website player. It isn’t the graph open in the Studio: edit that and the snapshot stays as it is until you Refresh it on the Present page.
      </div>
      {snap.edited && <div style={{ marginTop: 10, color: alpha('#ffffff', 0.7) }}>Its Script layer runs the code as edited on this step.</div>}
      {snap.sandboxed && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start', color: alpha('#ffffff', 0.7) }}>
          <Icon name="lock" size={12} style={{ flexShrink: 0, marginTop: 4 }} />
          <span>Sandboxed: this presentation came from a file, so its Script layers run sealed off from Playfield, and Record can’t reach the picture.</span>
        </div>
      )}
      {(snap.missing.length > 0 || snap.left.length > 0) && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {snap.missing.length > 0 && <div style={{ color: '#f5c46b' }}>Can’t run on the web: {snap.missing.join(', ')}. Blank or frozen there.</div>}
          {snap.left.map(x => (
            <div key={x.what} style={{ color: alpha('#ffffff', 0.7) }}><b style={{ color: '#f5c46b' }}>{x.what}</b>: {x.why}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Exact: the page's own panel has the controls; here, what it won't have. */
function ExactNotes({ missing, left }: { missing: string[]; left: { what: string; why: string }[] }) {
  return (
    <div style={{ marginBottom: 18, lineHeight: 1.5 }}>
      {heading('The exported page')}
      <div style={{ color: alpha('#ffffff', 0.7) }}>This is the website player running your page: its controls are in its own panel.</div>
      {(missing.length > 0 || left.length > 0) && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {missing.length > 0 && <div style={{ color: '#f5c46b' }}>Can’t run on the web: {missing.join(', ')}. Blank or frozen there.</div>}
          {left.map(x => (
            <div key={x.what} style={{ color: alpha('#ffffff', 0.7) }}><b style={{ color: '#f5c46b' }}>{x.what}</b>: {x.why}</div>
          ))}
        </div>
      )}
    </div>
  );
}
