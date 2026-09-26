/**
 * PresentStage — the last step of Play: the picture on its own, the way people
 * will play with it, with nothing to edit.
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
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { controlExists, readControlValue, targetParts } from '../../play/playControls';
import { sourceLabel } from '../../play/playSources';
import { DEFAULT_EMBED, buildPlayHtml, leftBehind } from '../../play/exportHtml';
import { parseLayerTarget, type PlayControl } from '../../types/play';
import { playEngine } from '../../lib/playEngine';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { RulerSlider } from '../ui/RulerSlider';
import { AspectPicker } from '../shell/PreviewChrome';
import { ColourPad } from './ColourPad';
import { useLiveValues } from './useLiveValues';
import { PHONE_SIZE, usePresent, type PresentMode } from './presentStore';
import { useTakes } from '../../lib/takes';
import { playOverlay } from '../../play/overlay';
import { formatDuration } from '../../lib/midiFile';

export function PresentStage({ canvas, onRecord }: {
  /** The app's live picture (Full). */
  canvas: ReactNode;
  /** Open Record for this canvas; null means the app's own picture. */
  onRecord: (source: HTMLCanvasElement | null) => void;
}) {
  const tk = useTokens();
  const { mode, device, panel, present, exit, setDevice, togglePanel } = usePresent();
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const graphName = useNodeGraphStore(s => s.currentGraph?.name) ?? 'Shader Studio';

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
  const exact = useMemo(() => {
    if (mode !== 'exact') return null;
    const { input, missing } = useNodeGraphStore.getState().playWebInput(graphName);
    return { html: buildPlayHtml(input, { ...DEFAULT_EMBED, mode: 'player' }), missing, left: leftBehind(input.play) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, build]);

  const record = () => {
    if (mode === 'full') { onRecord(null); return; }
    const c = frameRef.current?.contentDocument?.querySelector('canvas.ssp-gl') as HTMLCanvasElement | null;
    onRecord(c);
  };

  const stageBox = useFitBox(device === 'phone' ? PHONE_SIZE : null);

  const bar = { height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderBottom: `1px solid ${alpha('#ffffff', 0.08)}`, background: '#101016', color: '#e8e8ef' } as const;
  return (
    <div ref={rootRef} style={{ width: '100vw', height: '100dvh', display: 'flex', flexDirection: 'column', background: '#07070b', color: '#e8e8ef', font: `12.5px ${fontFamily.ui}` }}>
      <div style={bar}>
        <IconButton icon="close" label="Leave Present (Esc)" onClick={exit} />
        <b style={{ fontSize: 13.5, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{graphName}</b>
        <Segmented size="sm" ariaLabel="Present mode" value={mode ?? 'full'} onChange={m => present(m as PresentMode)} options={[
          { value: 'full', label: 'Full', title: 'Everything Shader Studio can do: songs, MIDI files, every layer' },
          { value: 'exact', label: 'Exact', title: 'The website player itself: exactly what a visitor to the exported page gets' },
        ]} />
        <span style={{ flex: 1 }} />
        <Segmented size="sm" ariaLabel="Screen" value={device} onChange={setDevice} options={[
          { value: 'screen', label: 'Screen', title: 'Fill the window' },
          { value: 'phone', label: 'Phone', title: `A phone's screen (${PHONE_SIZE.w} × ${PHONE_SIZE.h})` },
        ]} />
        {mode === 'full' && <AspectPicker />}
        {mode === 'exact' && <IconButton icon="reset" label="Rebuild the page with your latest changes" onClick={() => setBuild(b => b + 1)} />}
        <IconButton icon="layoutSplit" label={panel ? 'Hide the controls panel' : 'Show the controls panel'} active={panel} onClick={togglePanel} />
        <IconButton icon="fit" label={fullscreen ? 'Leave fullscreen' : 'Fullscreen'} active={fullscreen} onClick={toggleFullscreen} />
        <Button size="sm" variant="primary" icon="record" onClick={record} style={{ background: tk.status.danger }}>Record</Button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
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
                allow="accelerometer; gyroscope; midi; microphone; camera; fullscreen"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: '#0d0d12' }}
              />
            ) : canvas}
          </div>
        </div>
        {panel && (
          <div style={{ width: 300, flexShrink: 0, overflowY: 'auto', borderLeft: `1px solid ${alpha('#ffffff', 0.08)}`, background: '#101016', padding: '12px 14px 18px' }}>
            {mode === 'exact' && exact ? <ExactNotes missing={exact.missing} left={exact.left} /> : <PresentControls />}
            {mode === 'full' && <TakesPanel onRender={() => onRecord(null)} />}
            <InputLegend />
          </div>
        )}
      </div>
    </div>
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
function PresentControls() {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  const nodes = useNodeGraphStore(s => s.nodes);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const live = useLiveValues(play);
  const driven = new Set(play.mappings.filter(m => m.enabled).map(m => m.controlId));
  const write = (c: PlayControl, value: number | number[]) => {
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

/** Which keys, clicks, MIDI and so on do what: the mappings, read as a legend. */
function InputLegend() {
  const play = useNodeGraphStore(s => s.play);
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
 * Takes: perform, and every frame's controls, nulls and pointer are noted, to
 * render later frame by frame (Record › Take) at full quality.
 */
function TakesPanel({ onRender }: { onRender: () => void }) {
  const tk = useTokens();
  const { takes, recording, elapsed, start, stop, remove, renderTake } = useTakes();
  return (
    <div style={{ marginBottom: 18 }}>
      {heading('Takes')}
      <Button size="sm" variant={recording ? 'danger' : 'secondary'} icon={recording ? 'pause' : 'record'} style={{ width: '100%', justifyContent: 'center' }}
        onClick={() => { if (recording) stop(); else start(() => playOverlay.pointerNow()); }}
        title={recording ? 'Stop: keep this take' : 'Play it while this records: every control, null and the pointer, frame by frame'}>
        {recording ? `Stop take · ${formatDuration(elapsed)}` : 'Record a take'}
      </Button>
      <div style={{ color: alpha('#ffffff', 0.5), fontSize: 11.5, lineHeight: 1.45, margin: '6px 0 8px' }}>
        {recording ? 'Playing is being noted. ↺ on the clock starts the take over.' : 'Perform it once, then render it frame by frame: smooth at any size, with the song, no dropped frames.'}
      </div>
      {takes.map(t => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
          <Icon name="record" size={12} style={{ color: tk.status.danger, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
          <span style={{ color: alpha('#ffffff', 0.5), font: `500 11px ${fontFamily.mono}` }}>{formatDuration(t.length)}</span>
          <Button size="sm" variant="ghost" onClick={() => { renderTake(t.id); onRender(); }} title="Open Record with this take">Render…</Button>
          <IconButton icon="trash" label="Delete this take" size="sm" onClick={() => remove(t.id)} />
        </div>
      ))}
    </div>
  );
}
