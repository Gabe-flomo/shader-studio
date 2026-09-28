/**
 * VideoEditor — a Video layer's card (docs/video-layer.md): the file, how it
 * plays, its sound with a mini spectrum and the readers on it, where it sits
 * and how it looks.
 *
 * The file goes into the backgrounds library (IndexedDB) when picked; the
 * layer keeps its id, name and size. Its sound, when on, is what audio
 * readers can listen to ("Video · <layer>").
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { VideoLayer } from '../../../types/play';
import { AUDIO_READERS_MAX } from '../../../types/play';
import { videoReaderInput } from '../../../types/playLayers';
import { playVideoLayers } from '../../../play/videoLayers';
import { videoSound } from '../../../lib/videoSound';
import { READER_GAIN_MAX, READER_GAIN_MIN } from '../../../play/audioReaders';
import { addReader, newReader, patchReader, setReaderInput } from '../../../play/readerControls';
import { ReaderDots } from '../ReaderDots';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Choice';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { toast } from '../../ui/toastStore';
import { fontFamily, radius } from '../../../theme/tokens';
import { useTokens } from '../../../theme/themeStore';
import { SpectrumView } from '../SpectrumView';
import { EMPTY_READERS, useReadersPanel } from '../readersPanelUi';
import { readerVideoNote, useVideoSoundState } from '../videoSoundUi';
import { VIDEO_ACCEPT, sizeText } from '../backgroundFiles';
import { Section } from './Section';
import { BigEditorScaffold } from './BigEditorScaffold';
import { LinkedPickButton, LinkedRelinkButton, linkedMissingText } from '../../linked/LinkedPickButton';
import { isLinkedRef } from '../../../files/linkedRefs';
import { matteRows, type EditorContext } from './editors';
import type { Choice, FieldKit } from './fields';
import { VideoTracking } from '../TrackingChips';
import { TRACKER_NAMES } from '../../../types/playTracking';
import { trackerSettingsOf } from '../trackBakeJobs';
import type { PlayRecord } from '../../../types/play';

/** "Hands, Face" when those track this layer; "Off" when none does. */
function trackingSummary(play: PlayRecord, layerId: string): string {
  const on = (['hands', 'face', 'pose'] as const).filter(k => trackerSettingsOf(play, k).source === layerId).map(k => TRACKER_NAMES[k]);
  return on.length ? on.join(', ') : 'Off';
}

const FITS: Choice[] = [
  { value: 'contain', label: 'Fit inside', title: 'The whole frame inside the picture (Scale 1)' },
  { value: 'cover', label: 'Fill', title: 'Fills the picture, cropping what spills over (Scale 1)' },
  { value: 'height', label: 'Height', title: 'As tall as the picture at Scale 1' },
];
const SOUNDS: { value: VideoLayer['sound']; label: string; title: string }[] = [
  { value: 'off', label: 'Off', title: 'Muted' },
  { value: 'listen', label: 'Listen', title: 'Analysed for audio readers, not heard' },
  { value: 'play', label: 'Play', title: 'Heard through the master volume, and analysed' },
];

const clock = (s: number) => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; };

let seq = 0;
const readerId = () => `rd${Date.now().toString(36)}${(seq++).toString(36)}`;

/** The layer's file state, kept current. */
function useFileStatus(id: string) {
  return useSyncExternalStore(playVideoLayers.subscribe, () => `${playVideoLayers.status(id)}|${playVideoLayers.duration(id).toFixed(2)}`);
}

export function VideoEditor({ f, ctx, pictureHidden }: { f: FieldKit; ctx: EditorContext; pictureHidden: boolean }) {
  const l = f.l as VideoLayer;
  const tk = f.tk;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, durText] = useFileStatus(l.id).split('|');
  const duration = Number(durText) || 0;

  const pick = async (file: File) => {
    if (!/^video\//.test(file.type) && !/\.(mp4|m4v|webm|mov|ogv)$/i.test(file.name)) { toast.error('That isn’t a video file', { message: 'Pick an MP4, WebM or MOV.' }); return; }
    setBusy(true);
    try {
      const got = await playVideoLayers.pick(file);
      f.set({ videoId: got.videoId, fileName: got.fileName, bytes: got.bytes });
      if (!got.kept) toast.info('Playing for this session only', { message: 'The library couldn’t keep this video (storage full or blocked), so after a reload the layer asks for it again.' });
    } catch (e) {
      toast.error('Couldn’t open that video', { message: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  // A video used from a linked folder where it is (docs/linked-folders.md): the layer names it by its reference.
  const takeLinked = (ref: string, name: string, bytes: number) => f.set({ videoId: ref, fileName: name.slice(0, 120), bytes });

  const hint = (text: string) => <div style={{ margin: '6px 0 0 68px', color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>{text}</div>;
  const fileNote = status === 'loading' ? 'Opening the video…'
    : status === 'missing' && isLinkedRef(l.videoId) ? linkedMissingText(l.videoId, l.fileName)
    : status === 'missing' ? `“${l.fileName}”${l.bytes ? ` (${sizeText(l.bytes)})` : ''} isn’t in this browser’s library (another browser, or a cleared library). Pick it again.`
      : status === 'error' ? (playVideoLayers.errorText(l.id) || 'This browser couldn’t open that video.')
        : '';

  return (
    <BigEditorScaffold kind="video" sections={[
      { id: 'video-file', label: 'Video' },
      { id: 'video-playback', label: 'Playback' },
      { id: 'video-sound', label: 'Sound' },
      { id: 'video-position', label: 'Position' },
      { id: 'video-look', label: 'Look' },
      { id: 'video-tracking', label: 'Tracking' },
    ]}>
      <Section id="video-file" kind="video" title="Video" primary summary={l.videoId ? `${l.fileName}${l.bytes ? ` · ${sizeText(l.bytes)}` : ''}` : 'No video yet'}>
        <input ref={fileRef} type="file" accept={VIDEO_ACCEPT} style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void pick(file); }} />
        {!l.videoId ? (
          <div style={{ marginTop: 6, padding: '12px 12px', borderRadius: radius.md, background: tk.bg.field, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}` }}>Pick a video</span>
            <span style={{ color: tk.text.muted, font: `11.5px/1.45 ${fontFamily.ui}` }}>An MP4, WebM or MOV of your own. It stays in this browser’s library, not in the setup. With Sound on, its sound can drive controls through audio readers.</span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button size="sm" variant="primary" icon="import" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Opening…' : 'Pick a video…'}</Button>
              <LinkedPickButton filter="video" disabled={busy} onPick={(ref, e) => takeLinked(ref, e.name, e.size)} />
            </span>
          </div>
        ) : f.row('File', (
          <>
            <Button size="sm" icon="import" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Opening…' : status === 'missing' ? 'Pick it again' : 'Replace'}</Button>
            {status === 'missing' ? <LinkedRelinkButton id={l.videoId} filter="video" onRelinked={ref => takeLinked(ref, ref.split('/').pop() ?? l.fileName, l.bytes)} /> : <LinkedPickButton filter="video" label="Linked…" disabled={busy} onPick={(ref, e) => takeLinked(ref, e.name, e.size)} />}
            <span title={l.fileName} style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
              {l.fileName}{l.bytes ? ` · ${sizeText(l.bytes)}` : ''}{duration ? ` · ${clock(duration)}` : ''}
            </span>
          </>
        ))}
        {fileNote && hint(fileNote)}
      </Section>
      <Section id="video-playback" kind="video" title="Playback" summary={`${l.playing ? 'Playing' : 'Paused'} · ${l.speed}×${l.loop ? ' · loop' : ''}`}>
        {f.row('Play', (
          <>
            <Button size="sm" icon={l.playing ? 'pause' : 'play'} onClick={() => { playVideoLayers.resumeAudio(); f.set({ playing: !l.playing }); }}>{l.playing ? 'Pause' : 'Play'}</Button>
            {status === 'ready' && <Position id={l.id} duration={duration} />}
          </>
        ), l.follow ? 'Following the clock: it also pauses with the preview, and ↺ starts it over. Paused, it holds its start frame.' : 'Running free: it plays on its own, whatever the clock does.')}
        {f.toggle('Loop', 'loop', 'Start over at the end')}
        {f.row('Speed', <><NumberInput value={l.speed} min={0.05} max={8} step={0.05} title="Playback rate (1 = as recorded)" onCommit={n => f.set({ speed: Math.max(0.05, Math.min(8, n)) })} style={f.numStyle} /><span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>×</span></>)}
        {f.row('Start at', <><NumberInput value={l.start} min={0} max={36000} step={0.1} title="Seconds into the video that the clock's 0 shows" onCommit={n => f.set({ start: Math.max(0, n) })} style={f.numStyle} /><span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>s</span></>, 'Seconds into the video where it starts: the clock’s 0 shows this frame.')}
        {f.toggle('Clock', 'follow', 'Follow the clock', 'On: frame t of the clock shows start + t × speed, so takes and rendered videos show exactly the same frames. Off: it runs on its own (a render still follows the clock).')}
      </Section>
      <SoundSection f={f} ctx={ctx} status={status} />
      <Section id="video-position" kind="video" title="Position" summary={l.fit}>
        {f.seg('Fit', 'fit', FITS, 'The size at Scale 1: the whole frame inside the picture, filling it, or as tall as it.')}
        {f.props('x', 'y', 'scale', 'rotation')}
        {f.note('Drag it on the picture, or pull a corner to resize.')}
      </Section>
      <Section id="video-look" kind="video" title="Look" summary={`opacity ${l.opacity.toFixed(2)} · ${l.matte}`}>
        {f.prop('opacity')}
        {f.toggle('Mirror', 'mirror', 'Flip left to right', 'Shows the video mirrored. Hands, a face or a body tracked in it are mirrored with it (left and right still mean the person’s own).')}
        {matteRows(f, pictureHidden)}
      </Section>
      <Section id="video-tracking" kind="video" title="Tracking" summary={trackingSummary(ctx.play, l.id)}>
        <VideoTracking layer={l} />
      </Section>
    </BigEditorScaffold>
  );
}

/** Where it is now, about four times a second. */
function Position({ id, duration }: { id: string; duration: number }) {
  const tk = useTokens();
  const [t, setT] = useState(() => playVideoLayers.position(id));
  useEffect(() => {
    const iv = window.setInterval(() => setT(playVideoLayers.position(id)), 250);
    return () => window.clearInterval(iv);
  }, [id]);
  return <span style={{ color: tk.text.muted, font: `500 11px ${fontFamily.mono}` }}>{clock(t)}{duration ? ` / ${clock(duration)}` : ''}</span>;
}

function SoundSection({ f, ctx, status }: { f: FieldKit; ctx: EditorContext; status: string }) {
  const l = f.l as VideoLayer;
  const tk = f.tk;
  const state = useVideoSoundState(l.id);
  const cfg = ctx.play.audioReaders ?? EMPTY_READERS;
  const mine = cfg.input === videoReaderInput(l.id);
  const readers = mine ? cfg.readers : [];
  const [selected, setSelected] = useState('');
  const suspended = useSyncExternalStore(videoSound.subscribe, () => l.sound !== 'off' && playVideoLayers.audioSuspended());

  // Reader edits go through play/readerControls.ts: each reader comes with a control in "Audio readers · <layer>".
  const listenHere = () => { playVideoLayers.resumeAudio(); ctx.changePlay(p => setReaderInput(p, videoReaderInput(l.id))); };
  const openPanel = () => { listenHere(); useReadersPanel.getState().show({ focus: selected || cfg.readers[0]?.id || '' }); };
  const add = (hz: number, topDb: number) => {
    if (!mine || cfg.readers.length >= AUDIO_READERS_MAX) return;
    const r = newReader(readerId(), hz, topDb, cfg.readers);
    ctx.changePlay(p => addReader(p, r));
    setSelected(r.id);
  };
  const move = (id: string, hz: number, gain: number) => ctx.changePlay(p => patchReader(p, id, { hz, gain: Math.max(READER_GAIN_MIN, Math.min(READER_GAIN_MAX, gain)) }));

  const note = l.sound === 'off' ? '' : suspended ? 'The browser holds sound until you click: click anywhere on the page to start it.' : status === 'ready' ? readerVideoNote(l.label, state) : '';
  return (
    <Section id="video-sound" kind="video" title="Sound" summary={l.sound === 'off' ? 'Off' : `${l.sound === 'play' ? 'Playing' : 'Listening'}${mine ? ` · ${cfg.readers.length} reader${cfg.readers.length === 1 ? '' : 's'}` : ''}`}>
      {f.row('Sound', (
        <Segmented size="sm" ariaLabel="Sound" value={l.sound} options={SOUNDS} onChange={v => { playVideoLayers.resumeAudio(); f.set({ sound: v }); }} />
      ), 'Off: muted. Listen: its sound goes to the analysis (audio readers, the spectrum below) without being heard. Play: heard through the master volume as well.')}
      {l.sound === 'play' && f.prop('volume')}
      {l.sound !== 'off' && (
        <div style={{ marginTop: 8 }}>
          <SpectrumView
            compact
            readers={readers}
            selected={selected}
            peakHold={false}
            height={96}
            canAdd={mine && cfg.readers.length < AUDIO_READERS_MAX}
            onSelect={setSelected}
            onAdd={add}
            onMove={move}
            spectrum={() => spectrumOf(l.id)}
            emptyText={status === 'ready' ? (state === 'paused' ? 'Paused' : 'No sound yet') : 'No video yet'}
          />
          <div style={{ marginTop: 6 }}><ReaderDots play={ctx.play} input={videoReaderInput(l.id)} compact /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {!mine && <Button size="sm" icon="wave" onClick={listenHere} title="Point the setup’s audio readers at this video’s sound">Readers listen here</Button>}
            <Button size="sm" variant={mine ? 'primary' : 'ghost'} icon="wave" onClick={openPanel} title="The full spectrum and the readers’ list, listening to this video">Audio readers…</Button>
            <span style={{ color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}`, flex: '1 1 160px', minWidth: 0 }}>
              {mine
                ? cfg.readers.length ? `${cfg.readers.length} reader${cfg.readers.length === 1 ? '' : 's'} on this video, each a control in Audio readers · ${l.label}.` : 'Click the spectrum to place a reader: it becomes a control.'
                : cfg.input ? 'The readers listen to something else now.' : 'The readers listen to the live input now.'}
            </span>
          </div>
        </div>
      )}
      {note && <div style={{ margin: '6px 0 0 0', color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>{note}</div>}
    </Section>
  );
}

const bufs = new Map<string, { freq: Float32Array<ArrayBuffer>; at: number }>();
/** A video layer's spectrum now (dB per bin), or null while its sound isn't coming in. */
function spectrumOf(layerId: string): { freq: Float32Array; sampleRate: number } | null {
  const an = videoSound.analyser(layerId);
  if (!an) return null;
  let b = bufs.get(layerId);
  if (!b || b.freq.length !== an.frequencyBinCount) { b = { freq: new Float32Array(an.frequencyBinCount), at: 0 }; bufs.set(layerId, b); }
  const now = performance.now();
  if (now - b.at > 8) { b.at = now; an.getFloatFrequencyData(b.freq); }
  return { freq: b.freq, sampleRate: an.context.sampleRate };
}
