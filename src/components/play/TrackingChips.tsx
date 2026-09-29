/**
 * TrackingChips.tsx — face and body tracking's status and settings, and what
 * every tracker (hands too) shares: where its frames come from (Track: the
 * camera or a Video layer) and analysing a video (docs/tracking.md).
 *
 *   TrackerChip     "Face: tracking", an eye, Enable / Stop and the settings
 *                   (Track, show on picture, strictness, smoothing, mirror).
 *   TrackSource     Track: Camera / a Video layer, with the bake panel.
 *   BakePanel       Analyse video: progress, Cancel, what's stored, stale or missing.
 *   VideoTracking   a Video layer card's Tracking section: each tracker on this video.
 */
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { trackerFeeds, type TrackerKind, type TrackerLoadProgress, type TrackerStatus } from '../../lib/handFeed';
import { loadPct, MODEL_BYTES, modelsBundled, sizeText, useTrackerCacheSettings } from '../../lib/trackerCache';
import { playEngine } from '../../lib/playEngine';
import { BAKE_RATES, bakeSig, bakeState, onBakes, trackerOptionsFor } from '../../lib/trackBakes';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { DEFAULT_FACE, DEFAULT_POSE, TRACKER_NAMES, bakeFor, type PlayTracker } from '../../types/playTracking';
import type { VideoLayer } from '../../types/playLayers';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Popover } from '../ui/Popover';
import { RulerSlider } from '../ui/RulerSlider';
import { Select } from '../ui/Select';
import { sizeText } from './backgroundFiles';
import { NumberInput } from '../NodeGraph/NumberInput';
import { FACE_POINT_OPTIONS, POSE_POINT_OPTIONS } from '../../play/trackSources';
import { FACE_POINT_COUNT, POSE_POINT_COUNT } from '../../types/playTracking';
import { cancelBake, patchTracker, startBake, trackerSettingsOf, useBakeJobs } from './trackBakeJobs';

const EMBEDDED = typeof window !== 'undefined' && window.self !== window.top;
export const TRACKER_ICONS: Record<TrackerKind, IconName> = { hands: 'hand', face: 'face', pose: 'body' };
const NOUN: Record<TrackerKind, [string, string]> = { hands: ['hand', 'hands'], face: ['face', 'faces'], pose: ['body', 'bodies'] };

/** A tracker's status, what it shows, whether a take has it resting, and its download progress, kept current. */
export function useTrackerStatus(kind: TrackerKind): { status: TrackerStatus; count: number; paused: boolean; progress: TrackerLoadProgress | null } {
  const feed = trackerFeeds[kind];
  const [s, setS] = useState(() => ({ status: feed.getStatus(), count: feed.handCount(), paused: feed.isPaused(), progress: feed.getProgress() }));
  useEffect(() => feed.onStatus(status => setS({ status, count: feed.handCount(), paused: feed.isPaused(), progress: feed.getProgress() })), [feed]);
  return s;
}

/** Is a tracker's status one of the busy states between Enable and Tracking (docs/tracking.md "Models"). */
export const isBusy = (status: TrackerStatus): boolean => status === 'starting' || status === 'downloading' || status === 'loading';

/** The one-line note under Enable / a tracker's settings: bundled with the app, kept on this device, or downloaded each time (docs/tracking.md "Models"). Reactive to the "Keep tracking models" setting. */
export function useModelNote(kind: TrackerKind): string {
  const keepModels = useTrackerCacheSettings(s => s.keepModels);
  if (modelsBundled()) return 'Bundled with the app.';
  return keepModels ? `Models are kept on this device — ${sizeText(MODEL_BYTES[kind])}.` : 'Downloaded when needed.';
}

/** Re-render when a bake finishes loading. */
function useBakesTick(): void {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onBakes(bump), []);
}

/** A tracker's settings in the setup, and a setter that saves a change with it. */
export function useTrackerSettings(kind: TrackerKind): [PlayTracker, (patch: Partial<PlayTracker>) => void] {
  const s = useNodeGraphStore(st => (kind === 'hands' ? st.play.hands : kind === 'face' ? st.play.face : st.play.pose));
  const setPlay = useNodeGraphStore(st => st.setPlay);
  const settings = s ?? trackerSettingsOf(useNodeGraphStore.getState().play, kind);
  return [settings, patch => setPlay(p => patchTracker(p, kind, patch))];
}

/** The Video layer a tracker follows, when it does. */
function useSourceLayer(kind: TrackerKind): VideoLayer | null {
  const [settings] = useTrackerSettings(kind);
  return useNodeGraphStore(st => {
    const l = settings.source ? st.play.layers.find(x => x.id === settings.source) : undefined;
    return l && l.kind === 'video' ? l : null;
  });
}

/** Where the tracker's landmarks come from now, in words: '' for the camera. */
export function useFromVideo(kind: TrackerKind): { layer: VideoLayer | null; baked: boolean } {
  useBakesTick();
  const layer = useSourceLayer(kind);
  useNodeGraphStore(st => st.play);
  return { layer, baked: !!layer && !!playEngine.bakedTrack(kind) };
}

export function trackerText(kind: TrackerKind, status: TrackerStatus, count: number, paused = false, from: { layer: VideoLayer | null; baked: boolean } = { layer: null, baked: false }, progress: TrackerLoadProgress | null = null): string {
  const name = TRACKER_NAMES[kind], [one, many] = NOUN[kind];
  const seen = count === 0 ? `no ${one} in view` : kind === 'hands' ? `${count} ${count === 1 ? one : many}` : `${one} in view`;
  if (from.baked && from.layer) return `${name}: from “${from.layer.label}” (analysed) · ${seen}`;
  switch (status) {
    case 'on': return paused ? `${name}: resting while a take plays` : from.layer ? `${name}: tracking “${from.layer.label}” live · ${seen}` : count === 0 ? `${name}: none in view` : kind === 'hands' ? `${name}: tracking ${count} ${count === 1 ? one : many}` : `${name}: tracking`;
    case 'starting': return `${name}: starting…`;
    case 'downloading': return `${name}: downloading the model${progress ? loadPct(progress) : ''}`;
    case 'loading': return `${name}: loading…`;
    case 'blocked': return EMBEDDED ? `${name}: camera blocked by this page` : `${name}: camera blocked`;
    case 'error': return `${name}: couldn’t start`;
    case 'unsupported': return `${name}: not available here`;
    default: return from.layer ? `${name}: off (on “${from.layer.label}”)` : `${name}: off`;
  }
}

/** Face or pose: status, the eye, Enable / Stop and the settings. */
export function TrackerChip({ kind, settings: showSettings = true }: { kind: 'face' | 'pose'; settings?: boolean }) {
  const tk = useTokens();
  const { status, count, paused, progress } = useTrackerStatus(kind);
  const [settings, set] = useTrackerSettings(kind);
  const from = useFromVideo(kind);
  const [open, setOpen] = useState(false);
  const gear = useRef<HTMLSpanElement>(null);
  const feed = trackerFeeds[kind];
  const colour = from.baked ? (count > 0 ? tk.status.success : tk.status.warning) : status === 'on' ? (paused ? tk.text.disabled : count > 0 ? tk.status.success : tk.status.warning) : isBusy(status) ? tk.status.warning : status === 'blocked' || status === 'error' ? tk.status.danger : tk.text.disabled;
  const s = feed.stats;
  const title = status === 'on' && !from.baked ? `${s.fps} frames a second · the model takes ${s.inferMs} ms (${s.delegate || '…'})` : feed.getMessage() || undefined;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
      <span title={title} style={{ color: status === 'blocked' || status === 'error' ? tk.status.danger : tk.text.muted, font: `11px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{trackerText(kind, status, count, paused, from, progress)}</span>
      {status !== 'unsupported' && (
        <IconButton icon={settings.overlay ? 'eye' : 'eyeOff'} size="sm" active={settings.overlay}
          label={settings.overlay ? `Hide the ${NOUN[kind][0]} on the picture (tracking keeps going)` : `Show the ${NOUN[kind][0]} on the picture`}
          onClick={() => set({ overlay: !settings.overlay })} />
      )}
      {!from.baked && (status === 'off' || status === 'blocked' || status === 'error') && (
        <Button size="sm" icon={TRACKER_ICONS[kind]} onClick={() => void feed.start()}>{status === 'off' ? 'Enable' : 'Try again'}</Button>
      )}
      {!from.baked && status === 'on' && <Button size="sm" variant="ghost" onClick={() => feed.stop()}>Stop</Button>}
      {showSettings && (
        <span ref={gear} style={{ display: 'inline-flex' }}>
          <IconButton icon="sliders" label={`${TRACKER_NAMES[kind]} tracking settings`} size="sm" active={open} onClick={() => setOpen(o => !o)} />
        </span>
      )}
      {open && (
        <Popover anchorRef={gear} onClose={() => setOpen(false)} align="end" width={310} padding={0}>
          <TrackerSettings kind={kind} />
        </Popover>
      )}
    </span>
  );
}

/** Show on picture, with its colour. */
function ShowToggle({ kind }: { kind: 'face' | 'pose' }) {
  const [s, set] = useTrackerSettings(kind);
  const hex = `#${s.colour.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
  const what = kind === 'face' ? 'Show face on picture' : 'Show body on picture';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Toggle checked={s.overlay} onChange={overlay => set({ overlay })} label={what} />
      <span style={{ flex: 1 }} />
      <label title={`Colour of the ${NOUN[kind][0]} on the picture`} style={{ position: 'relative', width: 26, height: 22, borderRadius: radius.sm, background: hex, cursor: 'pointer', boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.15)}`, opacity: s.overlay ? 1 : 0.5, flexShrink: 0 }}>
        <input type="color" aria-label={`Colour of the ${NOUN[kind][0]} on the picture`} value={hex} onChange={e => { const h = e.target.value; set({ colour: [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] }); }} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
      </label>
    </div>
  );
}

/** Face or pose tracking's settings. */
function TrackerSettings({ kind }: { kind: 'face' | 'pose' }) {
  const tk = useTokens();
  const [s, set] = useTrackerSettings(kind);
  const camera = useNodeGraphStore(st => st.play.layers.find(l => l.kind === 'camera'));
  const layer = useSourceLayer(kind);
  const modelNote = useModelNote(kind);
  const label = { color: tk.text.primary, font: `600 12px ${fontFamily.ui}` };
  const hint = { color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}`, margin: '3px 0 0' };
  const d = kind === 'face' ? DEFAULT_FACE : DEFAULT_POSE;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 12, maxHeight: 'min(620px, calc(100vh - 80px))', overflowY: 'auto', boxSizing: 'border-box' }}>
      <TrackSource kind={kind} />
      <div>
        <ShowToggle kind={kind} />
        <p style={hint}>Just the drawing: tracking keeps going while it’s hidden.</p>
      </div>
      <div>
        <div style={{ ...label, marginBottom: 4 }}>Strictness</div>
        <RulerSlider ariaLabel={`${TRACKER_NAMES[kind]} tracking strictness`} value={s.strictness ?? 0.5} min={0} max={1} step={0.05} hard defaultValue={0.5} onChange={v => set({ strictness: v })} />
        <p style={hint}>Higher ignores faint or doubtful {kind === 'face' ? 'faces' : 'bodies'}; too high can lose you in dim light.</p>
      </div>
      <div>
        <div style={{ ...label, marginBottom: 4 }}>Smoothing</div>
        <RulerSlider ariaLabel={`${TRACKER_NAMES[kind]} smoothing`} value={s.smoothing} min={0} max={1} step={0.05} hard defaultValue={d.smoothing} onChange={v => set({ smoothing: v })} />
        <p style={hint}>How calm a still {NOUN[kind][0]} is. 0 follows every twitch.</p>
      </div>
      <div>
        <div style={{ ...label, marginBottom: 4 }}>Responsiveness</div>
        <RulerSlider ariaLabel={`${TRACKER_NAMES[kind]} responsiveness`} value={s.responsiveness ?? 0.5} min={0} max={1} step={0.05} hard defaultValue={0.5} onChange={v => set({ responsiveness: v })} />
        <p style={hint}>How quickly a fast move is followed.</p>
      </div>
      <div>
        <Toggle checked={layer ? !!layer.mirror : camera?.kind === 'camera' ? camera.mirror : s.mirror} disabled={!!camera || !!layer} onChange={mirror => set({ mirror })} label="Mirror, like a selfie" />
        <p style={hint}>{layer ? 'Tracking a video: that layer’s own Mirror decides.' : camera ? 'The Camera layer’s own Mirror decides this: the landmarks line up with the camera image it shows.' : 'Moving right moves right on the picture.'}</p>
      </div>
      <p style={{ ...hint, margin: 0, paddingTop: 8, borderTop: `1px solid ${tk.border.default}` }}>
        Everything runs on this computer: frames never leave it. {modelNote}
      </p>
    </div>
  );
}

/** Track: the camera or a Video layer; with a video, the bake panel. */
export function TrackSource({ kind }: { kind: TrackerKind }) {
  const tk = useTokens();
  const [s, set] = useTrackerSettings(kind);
  const videos = useNodeGraphStore(st => st.play.layers.filter((l): l is VideoLayer => l.kind === 'video'));
  const layer = videos.find(l => l.id === s.source) ?? null;
  const options = [{ value: '', label: 'Camera' }, ...videos.map(l => ({ value: l.id, label: `Video · ${l.label}` }))];
  if (s.source && !layer) options.push({ value: s.source, label: 'A deleted video' });
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <span style={{ color: tk.text.primary, font: `600 12px ${fontFamily.ui}` }}>Track</span>
        <Select ariaLabel={`${TRACKER_NAMES[kind]}: track the camera or a video`} value={s.source ?? ''} options={options} height={26} style={{ maxWidth: 190 }}
          onChange={v => set({ source: v || undefined })} />
      </div>
      {layer
        ? <BakePanel kind={kind} layer={layer} />
        : <p style={{ color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}`, margin: '3px 0 0' }}>{videos.length ? 'The camera, or a Video layer: its frames, placed where the layer shows them.' : 'The camera. Add a Video layer to track a video instead.'}</p>}
    </div>
  );
}

/** A tracker on a Video layer: analyse it once for exact, repeatable landmarks. */
export function BakePanel({ kind, layer }: { kind: TrackerKind; layer: VideoLayer }) {
  const tk = useTokens();
  useBakesTick();
  const [s] = useTrackerSettings(kind);
  const job = useBakeJobs(st => st.jobs[kind]);
  const error = useBakeJobs(st => st.errors[kind]);
  const [fps, setFps] = useState<number>(30);
  const sig = bakeSig(kind, trackerOptionsFor(kind, s));
  const found = layer.videoId ? bakeFor(s.bakes, layer.id, layer.videoId, sig) : null;
  const state = found ? bakeState(found.bake.key) : null;
  const small = { color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` };
  const box = { marginTop: 6, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field, display: 'flex', flexDirection: 'column' as const, gap: 6 };
  if (!layer.videoId) return <div style={box}><span style={small}>Pick a video for “{layer.label}” first.</span></div>;
  if (job && job.layerId === layer.id) {
    const modelText = job.model?.phase === 'downloading' ? `Downloading the model${job.model.loaded !== undefined && job.model.total !== undefined ? loadPct({ loaded: job.model.loaded, total: job.model.total }) : ''}…`
      : job.model?.phase === 'loading' ? 'Loading…' : null;
    return (
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}` }}>{modelText ?? `Analysing “${layer.label}”… ${Math.round(job.progress * 100)}%`}</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={() => cancelBake(kind)}>Cancel</Button>
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)} style={{ height: 4, borderRadius: 2, background: tk.border.default, overflow: 'hidden' }}>
          <div style={{ width: `${job.progress * 100}%`, height: '100%', background: tk.accent.base, transition: 'width 120ms linear' }} />
        </div>
      </div>
    );
  }
  const analyse = (label: string, variant: 'primary' | 'secondary' = 'secondary') => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Button size="sm" variant={variant} icon="target" onClick={() => void startBake(kind, layer.id, fps)}>{label}</Button>
      <Segmented size="sm" ariaLabel="Frames a second to analyse" value={String(fps) as '30' | '15' | '10'} options={BAKE_RATES.map(r => ({ value: String(r) as '30' | '15' | '10', label: `${r}`, title: `${r} frames a second` }))} onChange={v => setFps(Number(v))} />
      <span style={small}>fps</span>
    </span>
  );
  let status: ReactNode;
  if (!found) status = <span style={small}>Not analysed yet: it’s tracked live while the video plays. <b>Analyse</b> once for exact results: the same landmarks every time it plays, in takes, renders and on a website.</span>;
  else if (state === 'missing') status = <span style={small}>This browser doesn’t have the analysis (another browser, or a cleared library). Analyse it again.</span>;
  else if (state === 'loading') status = <span style={small}>Loading the analysis…</span>;
  else status = <span style={small}>Analysed: {found.bake.frames} frames at {found.bake.fps} fps · {sizeText(found.bake.bytes)}{found.fresh ? '' : '. The settings changed since: analyse again to use them.'}</span>;
  return (
    <div style={box}>
      {status}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {analyse(found ? 'Analyse again' : 'Analyse video', found && found.fresh && state === 'ready' ? 'secondary' : 'primary')}
      </div>
      {error && <span style={{ ...small, color: tk.status.danger }}>{error}</span>}
    </div>
  );
}

/**
 * A face or body landmark: the named ones in a list (nose tip, chin, wrists…),
 * and for a face any of its 478 by number.
 */
export function TrackPointPicker({ kind, value, onChange }: { kind: 'face' | 'pose'; value: number; onChange: (point: number) => void }) {
  const named = kind === 'face' ? FACE_POINT_OPTIONS : POSE_POINT_OPTIONS;
  const options = named.some(o => o.value === String(value)) ? named : [...named, { value: String(value), label: `Point ${value}` }];
  const max = (kind === 'face' ? FACE_POINT_COUNT : POSE_POINT_COUNT) - 1;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
      <Select ariaLabel={kind === 'face' ? 'Point on the face' : 'Point on the body'} value={String(value)} options={options} onChange={v => onChange(parseInt(v, 10) || 0)} height={26} style={{ flex: 1, minWidth: 0 }} />
      {kind === 'face' && <NumberInput value={value} min={0} max={max} step={1} title={`Any of the face's ${max + 1} points by number (MediaPipe's face mesh)`} onCommit={n => onChange(Math.max(0, Math.min(max, Math.round(n))))} style={{ width: 48 }} />}
    </span>
  );
}

/** A Video layer card's Tracking section: each tracker, on this video or not. */
export function VideoTracking({ layer }: { layer: VideoLayer }) {
  const tk = useTokens();
  const play = useNodeGraphStore(st => st.play);
  const setPlay = useNodeGraphStore(st => st.setPlay);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {(['hands', 'face', 'pose'] as const).map(kind => {
        const s = trackerSettingsOf(play, kind);
        const on = s.source === layer.id;
        return (
          <div key={kind}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name={TRACKER_ICONS[kind]} size={14} />
              <span style={{ color: tk.text.primary, font: `600 12px ${fontFamily.ui}`, width: 44 }}>{TRACKER_NAMES[kind]}</span>
              <span style={{ flex: 1, color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{on ? 'Tracks this video' : s.source ? 'Tracks another video' : 'Tracks the camera'}</span>
              <Button size="sm" variant={on ? 'ghost' : 'secondary'} onClick={() => setPlay(p => patchTracker(p, kind, { source: on ? undefined : layer.id }))}>{on ? 'Use the camera' : 'Track this video'}</Button>
            </div>
            {on && <BakePanel kind={kind} layer={layer} />}
          </div>
        );
      })}
      <span style={{ color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>Hands, a face or a body in the video become sources, gestures and points nulls can follow, placed where this layer shows the video (its position, size, rotation and Mirror).</span>
    </div>
  );
}
