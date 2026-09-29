/**
 * HandsChip.tsx — hand tracking's status and settings (docs/tracking.md).
 *
 *   HandsChip   "Hands: tracking 2 hands", an eye to show or hide the hand
 *               on the picture, Enable / Stop and the settings (hands to
 *               track, strictness, smoothing, mirroring, sides, a readout).
 *               Shown wherever hands are used: the mappings drawer, a hand
 *               trigger, a null that follows a hand, a Camera layer.
 *   ShowHandToggle  "Show hand on picture", for the Camera layer's section.
 *   HandsPill   the same Enable, floating on the picture while the setup
 *               reads hands and tracking is off (browsers need a click to
 *               open the camera).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { handFeed, type HandStatus } from '../../lib/handFeed';
import { loadPct } from '../../lib/trackerCache';
import { playEngine } from '../../lib/playEngine';
import { hdTrackerOptions, hdTracks } from '../../play/kit/hands.js';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { DEFAULT_HAND_RESPONSIVENESS, DEFAULT_HAND_STRICTNESS, DEFAULT_HANDS, oneHandUsed, usesHands, type PlayHands } from '../../types/play';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { RulerSlider } from '../ui/RulerSlider';
import { usePlayUi } from './playUi';
import { CameraChip } from './chips';
import { TrackSource, TrackerChip, trackerText, useFromVideo, useModelNote, useTrackerStatus } from './TrackingChips';

/** Inside another site's frame the camera is refused without asking (see chips.tsx). */
const EMBEDDED = typeof window !== 'undefined' && window.self !== window.top;

/** Status, hands in view and the download progress (while status is 'downloading'), kept current. */
function useHands(): { status: HandStatus; count: number; paused: boolean; progress: ReturnType<typeof handFeed.getProgress> } {
  const [s, setS] = useState(() => ({ status: handFeed.getStatus(), count: handFeed.handCount(), paused: handFeed.isPaused(), progress: handFeed.getProgress() }));
  useEffect(() => handFeed.onStatus(status => setS({ status, count: handFeed.handCount(), paused: handFeed.isPaused(), progress: handFeed.getProgress() })), []);
  return s;
}

function handsText(status: HandStatus, count: number, paused = false, progress: ReturnType<typeof handFeed.getProgress> = null): string {
  switch (status) {
    case 'on': return paused ? 'Hands: resting while a take plays' : count === 0 ? 'Hands: none in view' : count === 1 ? 'Hands: tracking 1 hand' : 'Hands: tracking 2 hands';
    case 'starting': return 'Hands: starting…';
    case 'downloading': return `Hands: downloading the model${progress ? loadPct(progress) : ''}`;
    case 'loading': return 'Hands: loading…';
    case 'blocked': return EMBEDDED ? 'Hands: camera blocked by this page' : 'Hands: camera blocked';
    case 'error': return 'Hands: couldn’t start';
    case 'unsupported': return 'Hands: not available here';
    default: return 'Hands: off';
  }
}

/** The setup's hand settings, and a setter that saves a change with it. */
function useHandSettings(): [PlayHands, (patch: Partial<PlayHands>) => void] {
  const hands = useNodeGraphStore(s => s.play.hands) ?? DEFAULT_HANDS;
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const set = (patch: Partial<PlayHands>) => setPlay(p => {
    const next: PlayHands = { ...(p.hands ?? DEFAULT_HANDS), ...patch };
    // An option set back to nothing leaves the file (older files stay as they were).
    for (const k of Object.keys(patch) as (keyof PlayHands)[]) if (patch[k] === undefined) delete next[k];
    return { ...p, hands: next };
  });
  return [hands, set];
}

export function HandsChip({ settings = true }: { settings?: boolean }) {
  const tk = useTokens();
  const { status, count, paused, progress } = useHands();
  const [hands, set] = useHandSettings();
  const from = useFromVideo('hands');
  const [open, setOpen] = useState(false);
  const gear = useRef<HTMLSpanElement>(null);
  // The tooltip's frame rate and timings, refreshed while tracking.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status !== 'on') return;
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);
  const busy = status === 'starting' || status === 'downloading' || status === 'loading';
  const colour = from.baked ? (count > 0 ? tk.status.success : tk.status.warning) : status === 'on' ? (paused ? tk.text.disabled : count > 0 ? tk.status.success : tk.status.warning) : busy ? tk.status.warning : status === 'blocked' || status === 'error' ? tk.status.danger : tk.text.disabled;
  const s = handFeed.stats;
  const title = status === 'on' ? `${s.fps} frames a second · the model takes ${s.inferMs} ms (${s.delegate || '…'}) · ${s.latencyMs} ms camera to landmarks` : handFeed.getMessage() || undefined;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
      <span title={title} style={{ color: status === 'blocked' || status === 'error' ? tk.status.danger : tk.text.muted, font: `11px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{from.layer ? trackerText('hands', status, count, paused, from, progress) : handsText(status, count, paused, progress)}</span>
      {status !== 'unsupported' && (
        <IconButton
          icon={hands.overlay ? 'eye' : 'eyeOff'} size="sm" active={hands.overlay}
          label={hands.overlay ? 'Hide hand on picture (tracking keeps going)' : 'Show hand on picture'}
          onClick={() => set({ overlay: !hands.overlay })}
        />
      )}
      {!from.baked && (status === 'off' || status === 'blocked' || status === 'error') && (
        <Button size="sm" icon="hand" onClick={() => void handFeed.start()}>{status === 'off' ? 'Enable' : 'Try again'}</Button>
      )}
      {!from.baked && status === 'on' && <Button size="sm" variant="ghost" onClick={() => handFeed.stop()}>Stop</Button>}
      {settings && (
        <span ref={gear} style={{ display: 'inline-flex' }}>
          <IconButton icon="sliders" label="Hand tracking settings" size="sm" active={open} onClick={() => setOpen(o => !o)} />
        </span>
      )}
      {open && (
        <Popover anchorRef={gear} onClose={() => setOpen(false)} align="end" width={300} padding={0}>
          <HandsSettings />
        </Popover>
      )}
    </span>
  );
}

/** "Show hand on picture" with its colour: the Camera layer's section, and the top of the settings. */
export function ShowHandToggle() {
  const [hands, set] = useHandSettings();
  const hex = `#${hands.colour.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Toggle checked={hands.overlay} onChange={overlay => set({ overlay })} label="Show hand on picture" />
      <span style={{ flex: 1 }} />
      <label title="Colour of the hand on the picture" style={{ position: 'relative', width: 26, height: 22, borderRadius: radius.sm, background: hex, cursor: 'pointer', boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.15)}`, opacity: hands.overlay ? 1 : 0.5, flexShrink: 0 }}>
        <input type="color" aria-label="Colour of the hand on the picture" value={hex} onChange={e => { const h = e.target.value; set({ colour: [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] }); }} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
      </label>
    </div>
  );
}

/** Everything hand tracking can be tuned by, saved with the setup, and what it sees right now. */
function HandsSettings() {
  const tk = useTokens();
  const [hands, set] = useHandSettings();
  const camera = useNodeGraphStore(s => s.play.layers.find(l => l.kind === 'camera'));
  const onlySide = useNodeGraphStore(s => oneHandUsed(s.play));
  const [advanced, setAdvanced] = useState(!!hands.confidence);
  const video = useNodeGraphStore(s => { const l = hands.source ? s.play.layers.find(x => x.id === hands.source) : undefined; return l && l.kind === 'video' ? l : null; });
  const modelNote = useModelNote('hands');
  const label = { color: tk.text.primary, font: `600 12px ${fontFamily.ui}` };
  const hint = { color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}`, margin: '3px 0 0' };
  const head = (text: string, right?: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
      <span style={label}>{text}</span>{right}
    </div>
  );
  const maxHands = hands.maxHands ?? 2;
  const strictness = hands.strictness ?? DEFAULT_HAND_STRICTNESS;
  const conf = hdTrackerOptions(hands);
  const setConf = (k: 'detection' | 'presence' | 'tracking', v: number) => set({ confidence: { detection: conf.detection, presence: conf.presence, tracking: conf.tracking, [k]: v } });
  const small = { color: tk.text.muted, font: `11px ${fontFamily.ui}` };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 12, maxHeight: 'min(620px, calc(100vh - 80px))', overflowY: 'auto', boxSizing: 'border-box' }}>
      <TrackSource kind="hands" />
      <div>
        <ShowHandToggle />
        <p style={hint}>Just the drawing: tracking keeps going while it’s hidden. The eye beside the status does the same. H hides the other guides, not the hand.</p>
      </div>
      <div>
        {head('Hands to track', (
          <Segmented size="sm" ariaLabel="Hands to track" value={String(maxHands) as '1' | '2'} onChange={v => set({ maxHands: v === '1' ? 1 : undefined })}
            options={[{ value: '1', label: '1' }, { value: '2', label: '2' }]} />
        ))}
        <p style={hint}>
          {maxHands === 1 ? 'Only one hand is followed, so a second one never appears. Distance between the hands reads nothing.' : 'Up to two. With 1, a second hand can never appear by mistake.'}
          {onlySide && maxHands === 2 ? ` This setup only reads your ${onlySide} hand: 1 is steadier if you keep the other hand out of view.` : ''}
        </p>
      </div>
      <div>
        {head('Strictness')}
        <RulerSlider ariaLabel="Hand tracking strictness" value={strictness} min={0} max={1} step={0.05} hard defaultValue={DEFAULT_HAND_STRICTNESS} disabled={!!hands.confidence}
          onChange={v => set({ strictness: v, confidence: undefined })} />
        <p style={hint}>{hands.confidence ? 'Set by hand below.' : 'Higher ignores faint or doubtful hands (fewer phantom hands); too high can lose your hand in dim light.'}</p>
        <button type="button" onClick={() => setAdvanced(a => !a)} aria-expanded={advanced}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, padding: 0, border: 0, background: 'none', color: tk.text.muted, font: `600 11px ${fontFamily.ui}`, cursor: 'pointer' }}>
          <Icon name={advanced ? 'chevD' : 'chevR'} size={13} /> Advanced
        </button>
        {advanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {([['detection', 'Finding a hand', 'How sure the model must be to find a new hand.'], ['presence', 'Keeping a hand', 'How sure it must be that a found hand is still there.'], ['tracking', 'Following a hand', 'Below this it looks for the hand afresh instead of following it.']] as const).map(([k, name, what]) => (
              <div key={k} title={what}>
                <div style={{ ...small, marginBottom: 3 }}>{name}</div>
                <RulerSlider ariaLabel={name} value={conf[k]} min={0.1} max={0.95} step={0.05} hard onChange={v => setConf(k, v)} />
              </div>
            ))}
            <p style={{ ...hint, margin: 0 }}>
              MediaPipe’s detection, presence and tracking confidence. {hands.confidence
                ? <button type="button" onClick={() => set({ confidence: undefined })} style={{ padding: 0, border: 0, background: 'none', color: tk.accent.base, font: `600 11px ${fontFamily.ui}`, cursor: 'pointer' }}>Use Strictness again</button>
                : 'Moving one sets all three by hand.'}
            </p>
          </div>
        )}
      </div>
      <div>
        {head('Smoothing')}
        <RulerSlider ariaLabel="Hand smoothing" value={hands.smoothing} min={0} max={1} step={0.05} hard defaultValue={DEFAULT_HANDS.smoothing} onChange={v => set({ smoothing: v })} />
        <p style={hint}>How calm a still hand is. 0 follows every twitch.</p>
      </div>
      <div>
        {head('Responsiveness')}
        <RulerSlider ariaLabel="Hand responsiveness" value={hands.responsiveness ?? DEFAULT_HAND_RESPONSIVENESS} min={0} max={1} step={0.05} hard defaultValue={DEFAULT_HAND_RESPONSIVENESS} onChange={v => set({ responsiveness: v })} />
        <p style={hint}>How quickly a fast move is followed. Low lags behind quick moves; high lets a little jitter through while moving.</p>
      </div>
      <div>
        <Toggle checked={video ? !!video.mirror : camera?.kind === 'camera' ? camera.mirror : hands.mirror} disabled={!!camera || !!video} onChange={mirror => set({ mirror })} label="Mirror, like a selfie" />
        <p style={hint}>{video ? 'Tracking a video: that layer’s own Mirror decides, so the hands line up with the video it shows.' : camera ? 'The Camera layer’s own Mirror decides this: hands line up with the camera image it shows.' : 'Your right hand moves right on the picture.'}</p>
      </div>
      <div>
        <Toggle checked={!!hands.swap} onChange={swap => set({ swap: swap || undefined })} label="Swap left and right" />
        <p style={hint}>Right should be your own right hand (the R at the wrist). If it’s the other way round, as with a camera that mirrors its own picture, turn this on. Mirror doesn’t change which hand is which.</p>
      </div>
      <HandsReadout />
      <p style={{ ...hint, margin: 0, paddingTop: 8, borderTop: `1px solid ${tk.border.default}` }}>
        Everything runs on this computer: camera frames never leave it. {modelNote}
      </p>
    </div>
  );
}

/** What the tracker sees right now, to help find out why a hand misbehaves. */
function HandsReadout() {
  const tk = useTokens();
  const { status } = useHands();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status !== 'on') return;
    const id = window.setInterval(() => setTick(t => t + 1), 250);
    return () => window.clearInterval(id);
  }, [status]);
  if (status !== 'on') return null;
  const s = handFeed.stats, o = handFeed.getOptions();
  const r = hdTracks(playEngine.handState());
  const mono = { font: `11px/1.6 ${fontFamily.mono}`, color: tk.text.secondary };
  const name = (side: string) => (side === 'left' ? 'Left' : 'Right');
  return (
    <div style={{ background: tk.bg.field, borderRadius: radius.md, padding: '8px 10px' }}>
      <div style={{ color: tk.text.primary, font: `600 11px ${fontFamily.ui}`, marginBottom: 4 }}>What the tracker sees</div>
      <div style={mono}>{s.fps} fps · {s.inferMs} ms · {s.delegate || '…'}</div>
      <div style={mono}>Found {r.raw}{r.rejected ? `, ignored ${r.rejected} (too small or off the frame)` : ''} · looking for {o.numHands}</div>
      {r.tracks.length === 0 && <div style={{ ...mono, color: tk.text.faint }}>No hands</div>}
      {r.tracks.map(t => (
        <div key={t.id} style={mono}>
          #{t.id} {name(t.side)} · model says {name(t.said)} {Math.round(t.score * 100)}%
          {!t.shown ? ' · appearing…' : t.held ? ' · held' : ''}
        </div>
      ))}
      <div style={{ ...mono, color: tk.text.faint }}>Confidence {o.detection} / {o.presence} / {o.tracking}</div>
    </div>
  );
}

/** Enable, on the picture, while the setup reads hands and tracking is off. */
export function HandsPill() {
  const { status, count, progress } = useHands();
  const performing = usePlayUi(s => s.performing);
  const needs = useNodeGraphStore(s => usesHands(s.play));
  const from = useFromVideo('hands');
  // Hands from an analysed video need nothing turned on.
  if (!performing || !needs || from.baked || status === 'on' || status === 'unsupported') return null;
  const busy = status === 'starting' || status === 'downloading' || status === 'loading';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void handFeed.start()}
      title={handFeed.getMessage() || 'This setup follows your hands. Turn on the camera and hand tracking (everything stays on this computer).'}
      style={{
        position: 'absolute', left: 10, bottom: 10, zIndex: 3, display: 'inline-flex', alignItems: 'center', gap: 7,
        height: 30, padding: '0 12px 0 10px', border: 0, borderRadius: 999, cursor: busy ? 'default' : 'pointer',
        background: alpha('#000000', 0.62), color: '#ffffff', font: `600 12px ${fontFamily.ui}`,
        boxShadow: `inset 0 0 0 1px ${alpha('#ffffff', 0.16)}`, backdropFilter: 'blur(6px)',
      }}
    >
      <Icon name="hand" size={15} />
      {status === 'downloading' ? `Downloading the model${progress ? loadPct(progress) : ''}` : status === 'loading' ? 'Loading…' : busy ? 'Starting hand tracking…' : status === 'blocked' || status === 'error' ? `${handsText(status, count).replace('Hands: ', '')} · Try again` : from.layer ? `Track hands in “${from.layer.label}”` : 'Enable hand tracking'}
    </button>
  );
}

/**
 * HandsButton — hand tracking's way in, always in the Mappings header:
 * a hand icon (with a dot while tracking) that opens the chip with Enable,
 * Stop and the settings, plus how to use hands once they're on.
 */
export function HandsButton() {
  const tk = useTokens();
  const { status } = useHands();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  if (status === 'unsupported') return null;
  const on = status === 'on';
  return (
    <span ref={anchor} style={{ position: 'relative', display: 'inline-flex' }}>
      <IconButton icon="hand" label={on ? 'Hand tracking is on' : 'Hand tracking: follow your hands with the camera'} active={open} tooltip={!open} onClick={() => setOpen(o => !o)} />
      {on && <span aria-hidden style={{ position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: '50%', background: tk.status.success, pointerEvents: 'none' }} />}
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={320} padding={0}>
          <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <HandsChip />
            <TrackerChip kind="face" />
            <TrackerChip kind="pose" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Camera</span>
              <CameraChip />
            </div>
            <div style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
              {on
                ? <>Now press <b>Learn</b> and move a finger or pinch, or pick a source from the <b>Hands</b> group in a mapping. Triggers can fire <b>On: Hand gesture</b>, and a Null can follow a hand point.</>
                : <>Turn it on to use your hands as a controller: every finger point, pinches and gestures become sources. Face and Pose do the same for your face and body. Each can track a Video layer instead of the camera (in its settings). It runs on this computer; nothing is uploaded.</>}
            </div>
          </div>
        </Popover>
      )}
    </span>
  );
}

/**
 * HandsLive — a small pulsing "Hands" light in the top bar while hand tracking
 * is on (or starting), so it's never a surprise that your hands are driving
 * things. Click it for the chip: Stop, the drawing, the settings.
 */
export function HandsLive({ compact = false }: { compact?: boolean }) {
  const tk = useTokens();
  const hs = useHands();
  const fs = useTrackerStatus('face'), ps = useTrackerStatus('pose');
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const live = (x: { status: HandStatus }) => x.status === 'on' || x.status === 'starting' || x.status === 'downloading' || x.status === 'loading';
  if (!live(hs) && (live(fs) || live(ps))) {
    // Only the face or the body: the same light, for them.
    const s = live(fs) ? fs : ps, kind = live(fs) ? 'face' as const : 'pose' as const;
    const colour = s.status === 'starting' || s.status === 'downloading' || s.status === 'loading' ? tk.status.warning : s.count > 0 ? tk.status.success : tk.text.muted;
    return (
      <span ref={anchor} style={{ display: 'inline-flex' }}>
        <button type="button" onClick={() => setOpen(o => !o)} title={`${trackerText(kind, s.status, s.count, s.paused)}. Click to stop or change settings.`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: compact ? '0 8px' : '0 10px 0 8px', border: 0, borderRadius: 999, cursor: 'pointer', background: open ? tk.bg.selected : alpha(colour, 0.12), color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}` }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: colour }} />
          <Icon name={kind === 'face' ? 'face' : 'body'} size={13} />
          {!compact && <span>{kind === 'face' ? 'Face' : 'Pose'}</span>}
        </button>
        {open && (
          <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={320} padding={0}>
            <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}><TrackerChip kind="face" /><TrackerChip kind="pose" /></div>
          </Popover>
        )}
      </span>
    );
  }
  const { status, count, paused } = hs;
  if (status !== 'on' && status !== 'starting' && status !== 'downloading' && status !== 'loading') return null;
  const colour = status === 'starting' || status === 'downloading' || status === 'loading' ? tk.status.warning : count > 0 ? tk.status.success : tk.text.muted;
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <style>{'@keyframes hands-live-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}'}</style>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={`${handsText(status, count, paused)}. Click to stop or change settings.`}
        aria-label={`${handsText(status, count, paused)}. Open hand tracking`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: compact ? '0 8px' : '0 10px 0 8px', border: 0, borderRadius: 999, cursor: 'pointer', background: open ? tk.bg.selected : alpha(colour, 0.12), color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}` }}
      >
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: colour, animation: paused ? undefined : 'hands-live-pulse 1.6s ease-in-out infinite' }} />
        <Icon name="hand" size={13} />
        {!compact && <span>{status === 'starting' || status === 'downloading' || status === 'loading' ? 'Starting…' : count === 0 ? 'Hands' : `Hands · ${count}`}</span>}
      </button>
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={320} padding={0}>
          <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}><HandsChip />{live(fs) && <TrackerChip kind="face" />}{live(ps) && <TrackerChip kind="pose" />}</div>
        </Popover>
      )}
    </span>
  );
}
