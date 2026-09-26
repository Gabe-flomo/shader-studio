/**
 * PerformanceBar — the small floating bar while a performance records or
 * plays back (lib/takes.ts). It sits over the bottom of the window and
 * leaves everything else alone, so the picture, keys, MIDI and the mouse
 * keep working while you play.
 *
 *   count-in   Recording in 3… · Cancel
 *   recording  ● 0:07 / 0:15 · progress · Stop (⌘.)
 *   playback   play/pause · scrub · time · Render… · Record again · Discard · Done
 */
import { useEffect, useRef, useState } from 'react';
import { recordingStart, useTakes } from '../lib/takes';
import { subscribeTimeTick } from '../lib/timeTick';
import { formatDuration } from '../lib/midiFile';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { TAKE_MAX_SECONDS } from '../types/play';
import { ThemeOverrideContext, useTokens } from '../theme/themeStore';
import { usePresent } from './play/presentStore';
import { fontFamily, radius } from '../theme/tokens';
import { Button, IconButton } from './ui/Button';
import { Kbd } from './ui/Kbd';

const STOP_COMBO = 'cmd+.';

/** 0:07.4: tenths, so a short take reads as moving. */
function clock(s: number): string {
  const t = Math.floor(s * 10) / 10;
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
}

/** ⌘. (Ctrl+. elsewhere): the Play engine ignores modifier keys, so it never fights a mapped key. */
function isStopKey(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === '.' || e.code === 'Period');
}

export function PerformanceBar() {
  const phase = useTakes(s => s.phase);
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'countdown') return;
    const onKey = (e: KeyboardEvent) => {
      if (!isStopKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      useTakes.getState().stop();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase]);
  // On the Stage the bar is dark like everything else there.
  const onStage = usePresent(s => s.mode) !== null;
  if (phase === 'idle') return null;
  const bar = <Bar>{phase === 'replay' ? <ReplayControls /> : <RecordingControls />}</Bar>;
  return onStage ? <ThemeOverrideContext.Provider value="dark">{bar}</ThemeOverrideContext.Provider> : bar;
}

function Bar({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return (
    <div
      role="region"
      aria-label="Performance"
      style={{
        position: 'fixed', left: '50%', bottom: 52, transform: 'translateX(-50%)', zIndex: 950,
        width: 'max-content', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', columnGap: 8, rowGap: 6, flexWrap: 'wrap', padding: '8px 10px',
        background: tk.bg.panel, color: tk.text.primary, borderRadius: radius.lg,
        boxShadow: `${tk.shadow.popover}, inset 0 0 0 1px ${tk.border.default}`,
        font: `500 12.5px ${fontFamily.ui}`,
      }}
    >
      {children}
    </div>
  );
}

function Dot({ pulse }: { pulse: boolean }) {
  const tk = useTokens();
  return <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: tk.status.danger, animation: pulse ? 'recPulse 1.2s ease-in-out infinite' : undefined }} />;
}

function RecordingControls() {
  const tk = useTokens();
  const phase = useTakes(s => s.phase);
  const countdown = useTakes(s => s.countdown);
  const settings = useTakes(s => s.settings);
  const limit = settings.manual ? TAKE_MAX_SECONDS : Math.min(TAKE_MAX_SECONDS, settings.seconds);
  const timeRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  // The readout follows the clock without re-rendering (timeTick).
  useEffect(() => subscribeTimeTick(t => {
    const from = recordingStart();
    const s = from === null ? 0 : Math.max(0, Math.min(limit, t - from));
    if (timeRef.current) timeRef.current.textContent = clock(s);
    if (fillRef.current) fillRef.current.style.width = `${(s / limit) * 100}%`;
  }), [limit]);

  if (phase === 'countdown') {
    return (
      <>
        <Dot pulse={false} />
        <span style={{ minWidth: 130 }}>Recording in <b style={{ font: `700 13px ${fontFamily.mono}` }}>{countdown}</b>…</span>
        <Button size="sm" variant="ghost" onClick={() => useTakes.getState().cancel()}>Cancel</Button>
      </>
    );
  }
  return (
    <>
      <Dot pulse />
      <span style={{ fontWeight: 600 }}>Recording</span>
      <span style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.muted, fontVariantNumeric: 'tabular-nums' }}>
        <span ref={timeRef}>0:00.0</span> / {formatDuration(limit)}
      </span>
      <div aria-hidden style={{ width: 120, height: 4, borderRadius: 2, background: tk.bg.field, overflow: 'hidden' }}>
        <div ref={fillRef} style={{ width: 0, height: '100%', background: tk.status.danger }} />
      </div>
      <Button size="sm" variant="danger" onClick={() => useTakes.getState().stop()} title="Stop and watch it back">
        <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: 'currentColor' }} />
        Stop
        <Kbd combo={STOP_COMBO} onDark />
      </Button>
    </>
  );
}

function ReplayControls() {
  const tk = useTokens();
  const replayId = useTakes(s => s.replayId);
  const playing = useTakes(s => s.replayPlaying);
  const take = useNodeGraphStore(s => s.play.takes?.find(t => t.id === replayId));
  const timeRef = useRef<HTMLSpanElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!take) return;
    return subscribeTimeTick(t => {
      const s = Math.max(0, Math.min(take.length, t - take.from));
      if (timeRef.current) timeRef.current.textContent = clock(s);
      if (rangeRef.current && !dragging) rangeRef.current.value = String(s);
    });
  }, [take, dragging]);
  if (!take) return null;
  const st = useTakes.getState;
  return (
    <>
      {/* Transport: wraps above the buttons on a narrow window, the scrub taking the width. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 300px', minWidth: 0 }}>
        <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onClick={() => st().setReplayPlaying(!playing)} style={{ color: tk.text.primary }} />
        <span style={{ fontWeight: 600, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="Watching the take back: live input is off until you're done">{take.name}</span>
        <input
          ref={rangeRef}
          type="range"
          aria-label="Position in the take"
          min={0}
          max={take.length}
          step={1 / 60}
          defaultValue={0}
          onPointerDown={() => { setDragging(true); st().setReplayPlaying(false); }}
          onPointerUp={() => setDragging(false)}
          onChange={e => st().seekReplay(Number(e.target.value))}
          style={{ flex: 1, minWidth: 80, width: 180, accentColor: tk.accent.base, cursor: 'pointer' }}
        />
        <span style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          <span ref={timeRef}>0:00.0</span> / {clock(take.length)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
        <Button size="sm" variant="primary" onClick={() => st().renderTake(take.id)} title="Render this take frame by frame, with no dropped frames">Render…</Button>
        <Button size="sm" icon="record" onClick={() => st().begin()} title="Record another take (this one stays in the list)">Record again</Button>
        <Button size="sm" variant="ghost" onClick={() => st().remove(take.id)} title="Delete this take">Discard</Button>
        <IconButton icon="close" label="Done: back to playing live" onClick={() => st().endReplay()} />
      </div>
    </>
  );
}
