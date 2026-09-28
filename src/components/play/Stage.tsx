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
 * Play page, and fullscreen. The side panel has only what a visitor gets:
 * the controls, and which keys, clicks and MIDI do what. Record captures the
 * picture from whichever mode is showing. Esc leaves.
 *
 * A Present page's canvas can open here too: then the Stage runs that
 * canvas's snapshot (as the presentation has it, with the step's Script
 * edits) in Exact, and says so; Full isn't offered, since the app's picture
 * is the open graph, not the snapshot.
 */
import { APP_HEIGHT } from '../../lib/viewport';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { controlExists, readControlValue, targetParts } from '../../play/playControls';
import { sourceLabel } from '../../play/playSources';
import { leftBehind } from '../../play/exportHtml';
import { stagePageHtml } from '../../present/liveScript';
import { playUses3D, useThreeSource } from '../../play/threeSource';
import { parseLayerTarget, type PlayControl, type PlayRecord } from '../../types/play';
import { parseFinishTarget, patchFinishEffect } from '../../types/playFinish';
import { parseAudioFxTarget, patchAudioFxEffect } from '../../types/playAudioFx';
import { aeRack, aeSlot, parseAuTarget, patchSlot } from '../../types/playAudioEngine';
import { playEngine, pairDrives } from '../../lib/playEngine';
import { pairOf } from '../../play/pairs';
import { XYPad } from './PairControls';
import { playBackground } from '../../play/background';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { RulerSlider } from '../ui/RulerSlider';
import { AspectPicker } from '../shell/PreviewChrome';
import { ColourPad } from './ColourPad';
import { useLiveValues } from './useLiveValues';
import { PHONE_SIZE, useStage, type StageMode, type StageSnapshot } from './stageStore';
import { useTakes } from '../../lib/takes';
import { TakesList } from './TakesList';
import { showSnapshot, useOutput } from '../../output/outputHost';

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
  const narrow = useNarrow();

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
    const { input, missing } = useNodeGraphStore.getState().playWebInput(graphName);
    return { html: stagePageHtml(input), missing, left: leftBehind(input.play, input.media, { graphs: input.backgroundGraphs ?? {}, datasets: input.datasets }) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, build, snap, threeReady]);

  const record = () => {
    if (mode === 'full') { onRecord(null); return; }
    const c = frameRef.current?.contentDocument?.querySelector('canvas.ssp-gl') as HTMLCanvasElement | null;
    onRecord(c);
  };

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
          <Segmented size="sm" ariaLabel="Stage mode" value={mode ?? 'full'} onChange={m => open(m as StageMode)} options={[
            { value: 'full', label: 'Full', title: 'Everything Playfield can do: songs, MIDI files, every layer' },
            { value: 'exact', label: 'Exact', title: 'The website player itself: exactly what a visitor to the exported page gets' },
          ]} />
        )}
        <span style={{ flex: 1 }} />
        {!narrow && (
          <Segmented size="sm" ariaLabel="Screen" value={device} onChange={setDevice} options={[
            { value: 'screen', label: 'Screen', title: 'Fill the window' },
            { value: 'phone', label: 'Phone', title: `A phone's screen (${PHONE_SIZE.w} × ${PHONE_SIZE.h})` },
          ]} />
        )}
        {mode === 'full' && !narrow && <AspectPicker />}
        {mode === 'exact' && !snap && <IconButton icon="reset" label="Rebuild the page with your latest changes" onClick={() => setBuild(b => b + 1)} />}
        <IconButton icon="layoutSplit" label={panel ? 'Hide the side panel' : 'Show the side panel'} active={panel} onClick={togglePanel} />
        {!narrow && <IconButton icon="fit" label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'} active={fullscreen} onClick={toggleFullscreen} />}
        <StageOutput snap={snap} frame={() => frameRef.current} />
        <Button size="sm" variant="primary" icon="record" onClick={record} disabled={!!snap?.sandboxed}
          title={snap?.sandboxed ? 'Its Script layers are someone else’s code, so it runs sealed off from Playfield, where Record can’t reach its picture' : undefined}
          style={{ background: tk.status.danger }}>{narrow ? null : 'Record'}</Button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: narrow ? 'column' : 'row' }}>
        <div ref={stageBox.ref} style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
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
        {panel && (
          <div style={{
            flexShrink: 0, overflowY: 'auto', background: '#101016', padding: '12px 14px 18px',
            ...(narrow ? { maxHeight: '32%', borderTop: `1px solid ${alpha('#ffffff', 0.08)}` } : { width: 300, borderLeft: `1px solid ${alpha('#ffffff', 0.08)}` }),
          }}>
            {snap ? <SnapshotNotes snap={snap} /> : mode === 'exact' && exact ? <ExactNotes missing={exact.missing} left={exact.left} /> : <StageControls />}
            {mode === 'full' && <TakesPanel onRender={() => onRecord(null)} />}
            <InputLegend play={snap ? snap.play : graphPlay} />
          </div>
        )}
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

/** The Play panel's controls, as a visitor has them: sliders, colours and buttons. */
function StageControls() {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  const nodes = useNodeGraphStore(s => s.nodes);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const live = useLiveValues(play);
  const driven = new Set(play.mappings.filter(m => m.enabled).map(m => m.controlId));
  // A pair's mappings drive its A and/or B too.
  for (const pm of play.pairMappings ?? []) {
    const pr = pm.enabled ? play.pairs?.find(x => x.id === pm.pairId) : undefined;
    if (pr) for (const id of [pr.a, pr.b]) if (pairDrives(pm, pr, id)) driven.add(id);
  }
  const write = (c: PlayControl, value: number | number[]) => {
    const ft = parseFinishTarget(c.target);
    if (ft) { if (typeof value === 'number') setPlay(p => ({ ...p, finish: patchFinishEffect(p.finish, ft.effectId, { [ft.key]: value }) })); return; }
    const at = parseAudioFxTarget(c.target);
    if (at) { if (typeof value === 'number') setPlay(p => ({ ...p, audioFx: patchAudioFxEffect(p.audioFx, at.chainId, at.effectId, { [at.key]: value }) })); return; }
    const au = parseAuTarget(c.target);
    if (au) { if (typeof value === 'number') setPlay(p => ({ ...p, audioEngine: patchSlot(p.audioEngine, au.rackId, au.slotId, { params: { ...aeSlot(aeRack(p.audioEngine, au.rackId), au.slotId)?.params, [au.address]: value } }) })); return; }
    const lt = parseLayerTarget(c.target);
    if (lt) {
      if (typeof value === 'number') setPlay(p => ({ ...p, layers: p.layers.map(l => (l.id === lt.layerId ? { ...l, [lt.key]: value } as typeof l : l)) }));
      return;
    }
    const { nodeId, paramKey } = targetParts(c.target);
    updateNodeParams(nodeId, { [paramKey]: value }, { immediate: true });
  };
  const shown = play.controls.filter(c => controlExists(nodes, c, play));
  return (
    <div style={{ marginBottom: 18 }}>
      {heading('Controls')}
      {shown.length === 0 && <div style={{ color: alpha('#ffffff', 0.5), lineHeight: 1.5 }}>No controls: visitors can only watch. Add some on the Play page.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {shown.map(c => {
          const value = readControlValue(nodes, c.target, play);
          const lv = live.get(c.id);
          const isDriven = driven.has(c.id);
          // A position pair is one XY pad, where its A is (as on the Play panel).
          const pair = pairOf(play, c.id);
          const cb = pair?.position ? shown.find(x => x.id === (c.id === pair.a ? pair.b : pair.a)) : undefined;
          if (pair && cb) {
            if (c.id !== pair.a) return null;
            const num = (ctl: PlayControl) => { const l = live.get(ctl.id), v = readControlValue(nodes, ctl.target, play); return driven.has(ctl.id) && typeof l === 'number' ? l : typeof v === 'number' ? v : ctl.min; };
            const dB = driven.has(cb.id);
            return (
              <div key={c.id} data-pair-id={pair.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 12px ${fontFamily.ui}` }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pair.label}</span>
                  {(isDriven || dB) && <span title="A mapping moves it" style={{ color: tk.accent.base, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em' }}>LIVE</span>}
                </div>
                <XYPad a={c} b={cb} x={num(c)} y={num(cb)} lockX={isDriven} lockY={dB} onChange={(x, y) => { if (!isDriven) write(c, x); if (!dB) write(cb, y); }} />
              </div>
            );
          }
          return (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 12px ${fontFamily.ui}` }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                {isDriven && c.kind !== 'action' && <span title="A mapping moves it" style={{ color: tk.accent.base, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em' }}>LIVE</span>}
              </div>
              {c.kind === 'action' ? (
                <Button size="sm" variant="primary" icon="play" onClick={() => playEngine.fireControl(c.id)} style={{ justifyContent: 'center', boxShadow: typeof lv === 'number' && lv >= 0.5 ? `0 0 0 2px ${alpha(tk.accent.base, 0.5)}` : undefined }}>{c.label}</Button>
              ) : c.kind === 'color' ? (
                <ColourPad value={Array.isArray(value) ? value : [0, 0, 0]} live={isDriven && Array.isArray(lv) ? lv : undefined} disabled={false} onChange={v => write(c, v)} />
              ) : (
                <RulerSlider
                  value={typeof lv === 'number' && isDriven ? lv : typeof value === 'number' ? value : c.min}
                  min={c.min} max={c.max} step={c.step ?? 0.01}
                  defaultValue={typeof value === 'number' ? value : (c.min + c.max) / 2}
                  disabled={isDriven}
                  onChange={v => write(c, v)}
                  // Typing a value past the range widens it: the control keeps the new range, as on the panel.
                  onRange={(min, max) => setPlay(p => ({ ...p, controls: p.controls.map(x => (x.id === c.id ? { ...x, min, max } : x)) }))}
                  ariaLabel={c.label}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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

/** Which keys, clicks, MIDI and so on do what: the mappings, read as a legend. */
function InputLegend({ play }: { play: PlayRecord }) {
  const rows = play.mappings.filter(m => m.enabled).map(m => ({
    id: m.id,
    from: sourceLabel(m.source, play.controls, play.layers),
    to: play.controls.find(c => c.id === m.controlId)?.label ?? '—',
  }));
  if (!rows.length) return null;
  return (
    <div>
      {heading('Inputs')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ flexShrink: 0, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 7px', borderRadius: radius.sm, background: alpha('#ffffff', 0.08), font: `500 11.5px ${fontFamily.mono}` }}>{r.from}</span>
            <Icon name="chevR" size={11} style={{ color: alpha('#ffffff', 0.35), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: alpha('#ffffff', 0.8) }}>{r.to}</span>
          </div>
        ))}
      </div>
    </div>
  );
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

/**
 * Takes: perform (up to a minute) and every input is kept as keyframes, to
 * watch back and render later frame by frame (see lib/takes.ts, TakesList).
 */
function TakesPanel({ onRender }: { onRender: () => void }) {
  const phase = useTakes(s => s.phase);
  const busy = phase === 'recording' || phase === 'countdown';
  return (
    <div style={{ marginBottom: 18 }}>
      {heading('Takes')}
      <Button size="sm" variant={busy ? 'danger' : 'secondary'} icon="record" style={{ width: '100%', justifyContent: 'center' }}
        onClick={() => (busy ? useTakes.getState().stop() : useTakes.getState().begin())}
        title={busy ? 'Stop and watch it back' : 'Play it for up to a minute: every input is kept, to watch back and render frame by frame'}>
        {busy ? 'Stop recording' : 'Record a performance'}
      </Button>
      <div style={{ color: alpha('#ffffff', 0.5), fontSize: 11.5, lineHeight: 1.45, margin: '6px 0 8px' }}>
        Perform it once, then render it frame by frame: smooth at any size, with the song, no dropped frames.
      </div>
      <TakesList onRender={() => onRender()} />
    </div>
  );
}
