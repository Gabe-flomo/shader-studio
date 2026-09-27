/**
 * BackgroundRow — what the Play picture is under the layers.
 *
 * With no Background layer, this setting decides: the shader or a flat colour
 * (PlayDisplay, types/play.ts), as it always has. Choosing a graph, an image
 * or a video here adds a Background layer (types/playLayers.ts) with it as the
 * first source, so more can queue behind it. While the setup has a Background
 * layer the row says so and links to it; deleting the layer hands the picture
 * back to this setting. Anything but the shader stops the graph on the Play
 * page (play/background.ts): the layers draw over the background and read it
 * as the picture.
 *
 * Setups from before the Background layer keep their image or video here and
 * still play it (their Replace, Fit and video options stay). "Layers only"
 * stays what it was: the picture is covered by the backdrop colour but still
 * runs, so Reveal mattes and particles with Mask show it inside themselves.
 */
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { BACKGROUND_RATES, BACKGROUND_VIDEO_KEEP, DEFAULT_DISPLAY, backgroundLayerOf, backgroundSource, isDefaultDisplay, type BackgroundFit, type BackgroundItem, type PlayDisplay, type PlayRecord } from '../../types/play';
import { playBackground } from '../../play/background';
import { useShowing } from './useQueueShowing';
import { addBackground, newSourceId } from '../../play/backgroundQueue';
import { mediaType } from '../../lib/mediaSources';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { Tooltip } from '../ui/Tooltip';
import { toast } from '../ui/toastStore';
import { usePlayUi } from './playUi';
import { GraphSourcePicker } from './GraphSourcePicker';
import { IMAGE_ACCEPT, VIDEO_ACCEPT, baseName, imageSource, loadBackgroundImage, readDataUrl, sizeText, videoSource } from './backgroundFiles';

const FITS: { value: BackgroundFit; label: string }[] = [
  { value: 'cover', label: 'Fill (crop)' },
  { value: 'contain', label: 'Fit inside' },
  { value: 'stretch', label: 'Stretch' },
];

type HeaderChoice = 'shader' | 'graph' | 'image' | 'video' | 'colour';

const hexOf = (c: readonly number[]) => `#${c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/** The background's state as the panel shows it (a video's first frame, a load error), re-read when the host says it changed. */
function useBackgroundTick(): number {
  return useSyncExternalStore(subscribe, () => tick.n);
}
const tick = { n: 0 };
playBackground.onChange(() => { tick.n++; });
const subscribe = (cb: () => void) => playBackground.onChange(cb);

export function BackgroundRow({ play, onChange }: { play: PlayRecord; onChange: (fn: (p: PlayRecord) => PlayRecord) => void }) {
  const tk = useTokens();
  useBackgroundTick();
  const layer = backgroundLayerOf(play);
  const d = play.display ?? DEFAULT_DISPLAY;
  const source = backgroundSource(d);
  const hasLayersNode = useNodeGraphStore(s => s.nodes.some(n => n.type === 'playLayers'));
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const segRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const showing = useShowing();
  /** A file picked for the header's own (older) image or video, not for a new Background layer. */
  const legacyPick = useRef(false);

  const setDisplay = (patch: Partial<PlayDisplay>) => onChange(p => {
    const next: PlayDisplay = { ...(p.display ?? DEFAULT_DISPLAY), ...patch };
    if (next.source === 'shader') delete next.source;
    if (next.fit === 'cover') delete next.fit;
    if (isDefaultDisplay(next)) { const rest = { ...p }; delete rest.display; return rest; }
    return { ...p, display: next };
  });

  /**
   * The header's rule: an image, a video or a graph becomes the first source of
   * a new Background layer. An image or video this setup kept here from before
   * moves into it; the header's shader or colour stay, for when the layer goes.
   */
  const startLayer = (first: BackgroundItem) => {
    const id = { v: '' };
    onChange(p => {
      const r = addBackground(p, [first]);
      id.v = r.id;
      const disp = r.play.display ? { ...r.play.display } : undefined;
      if (disp) {
        if (first.kind === 'image') delete disp.image;
        if (first.kind === 'video') delete disp.video;
        if (disp.source === 'image' || disp.source === 'video') delete disp.source;
      }
      const next = { ...r.play };
      if (disp && !isDefaultDisplay(disp)) next.display = disp; else delete next.display;
      return next;
    });
    toast.success('Added a Background layer', { message: `“${first.name}” is its first source. Queue more there, and step through them with keys, beats or notes.` });
    if (id.v) usePlayUi.getState().reveal(id.v);
  };

  const choose = (v: HeaderChoice) => {
    if (v === 'shader' || v === 'colour') { setDisplay({ source: v }); return; }
    if (v === 'graph') { setPicking(true); return; }
    // A picture this setup already kept moves into the layer; otherwise pick a file.
    if (v === 'image' && d.image) { startLayer({ id: newSourceId(), kind: 'image', name: baseName(d.image.name), src: d.image.src }); return; }
    if (v === 'video' && d.video && (d.video.src || playBackground.hasSessionVideo(d.video.name, d.video.bytes))) {
      const vd = d.video;
      startLayer({ id: newSourceId(), kind: 'video', name: vd.name, src: vd.src, bytes: vd.bytes, loop: vd.loop, muted: vd.muted, rate: vd.rate });
      return;
    }
    legacyPick.current = false;
    (v === 'image' ? imageInput : videoInput).current?.click();
  };

  const pickImage = async (file: File) => {
    setBusy(true);
    try {
      if (legacyPick.current) setDisplay({ source: 'image', image: { name: file.name.slice(0, 120), src: await loadBackgroundImage(file) } });
      else startLayer(await imageSource(file));
    } catch (e) { toast.error('Couldn’t use that image', { message: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); legacyPick.current = false; }
  };
  const pickVideo = async (file: File) => {
    setBusy(true);
    try {
      if (!legacyPick.current) { startLayer(await videoSource(file)); return; }
      const prev = d.video;
      const opts = { loop: prev?.loop ?? true, muted: prev?.muted ?? true, rate: prev?.rate ?? 1 };
      if (file.size <= BACKGROUND_VIDEO_KEEP) {
        const src = await readDataUrl(file, mediaType(file.name, file.type, 'video'));
        setDisplay({ source: 'video', video: { name: file.name.slice(0, 120), src, bytes: file.size, ...opts } });
      } else {
        // Too big to keep in the setup: it plays from memory until a reload.
        playBackground.setSessionVideo(file);
        setDisplay({ source: 'video', video: { name: file.name.slice(0, 120), src: '', bytes: file.size, ...opts } });
      }
    } catch (e) { toast.error('Couldn’t use that video', { message: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); legacyPick.current = false; }
  };
  const replaceLegacy = (kind: 'image' | 'video') => { legacyPick.current = true; (kind === 'image' ? imageInput : videoInput).current?.click(); };

  const label = (text: string) => <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{text}</span>;
  const swatch = (title: string, value: readonly number[], set: (c: [number, number, number]) => void) => (
    <label title={title} style={{ position: 'relative', width: 32, height: 22, flexShrink: 0, borderRadius: radius.md, background: hexOf(value), boxShadow: `inset 0 0 0 1px ${tk.border.strong}`, cursor: 'pointer' }}>
      <input type="color" aria-label={title} value={hexOf(value)} onChange={e => set(fromHex(e.target.value))} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
    </label>
  );
  const note = (text: ReactNode, tone: 'faint' | 'warning' = 'faint') => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: tone === 'warning' ? tk.status.warningText : tk.text.muted, font: `11.5px/1.4 ${fontFamily.ui}` }}>
      <Icon name={tone === 'warning' ? 'warning' : 'pause'} size={12} style={{ flexShrink: 0, marginTop: 2, color: tone === 'warning' ? tk.status.warning : tk.text.faint }} />
      <span style={{ minWidth: 0 }}>{text}</span>
    </div>
  );
  const inputs = (
    <>
      <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickImage(f); }} />
      <input ref={videoInput} type="file" accept={VIDEO_ACCEPT} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickVideo(f); }} />
    </>
  );
  const rowStyle: React.CSSProperties = { flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 12px 8px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.panel };

  // ── A Background layer decides ────────────────────────────────────────────
  if (layer) {
    const n = layer.sources.length;
    const shown = layer.sources.find(s => s.id === showing?.toId);
    const what = !layer.visible ? 'hidden: its colour shows' : n === 0 ? 'no sources yet' : `${n} source${n === 1 ? '' : 's'}${shown ? ` · showing “${shown.name}”` : ''}`;
    return (
      <div style={rowStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Tooltip label="Background" description="A Background layer decides what is under the layers: a queue of sources, one at a time. Delete the layer to use this setting (Shader, Colour) again.">
            <span style={{ cursor: 'help' }}>{label('Background')}</span>
          </Tooltip>
          <button
            type="button" onClick={() => usePlayUi.getState().reveal(layer.id)} title="Open the Background layer"
            style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0, height: 26, padding: '0 10px 0 8px', borderRadius: radius.md, border: 0, cursor: 'pointer', background: alpha(tk.accent.base, 0.1), color: tk.text.primary, textAlign: 'left' }}
          >
            <Icon name="slides" size={14} style={{ color: tk.accent.base, flexShrink: 0 }} />
            <span style={{ font: `600 12px ${fontFamily.ui}`, flexShrink: 0 }}>{layer.label}</span>
            <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{what}</span>
            <span style={{ flex: 1 }} />
            <Icon name="chevR" size={13} style={{ color: tk.text.faint, flexShrink: 0 }} />
          </button>
        </div>
      </div>
    );
  }

  // ── This setting decides ──────────────────────────────────────────────────
  const video = d.video;
  const vEl = source === 'video' ? playBackground.videoElement() : null;
  const videoMissing = source === 'video' && !!video && !video.src && !playBackground.hasSessionVideo(video.name, video.bytes);
  const videoError = !!vEl?.error;
  const showToggle = source !== 'colour';
  const layersOnly = !d.picture && source !== 'colour';
  // The backdrop colour matters for Colour, Layers only, and the bars around a fitted image or video.
  const backdropUse = source === 'colour' ? 'Background colour'
    : layersOnly ? 'Backdrop colour (covers the picture)'
      : (source === 'image' || source === 'video') && d.fit === 'contain' ? 'Colour around the picture'
        : null;

  return (
    <div style={rowStyle}>
      {inputs}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tooltip label="Background" description="What the layers draw over. Shader is the graph; Colour a flat colour. Graph…, Image… and Video… add a Background layer with it as the first source: queue more there and step through them. Anything but the shader pauses the graph on the Play page (the Studio still runs it), and everything that reads the picture reads the background instead.">
          <span style={{ cursor: 'help' }}>{label('Background')}</span>
        </Tooltip>
        <div ref={segRef} style={{ display: 'inline-flex' }}>
          <Segmented<HeaderChoice> size="sm" ariaLabel="Background" value={source} onChange={choose} options={[
            { value: 'shader', label: 'Shader', title: 'The graph’s picture' },
            { value: 'graph', label: 'Graph…', title: 'Another graph (a saved one or an example): adds a Background layer' },
            { value: 'image', label: 'Image…', title: 'A picture file (PNG, JPG, WebP or SVG): adds a Background layer' },
            { value: 'video', label: 'Video…', title: 'A video file (MP4, WebM or MOV): adds a Background layer' },
            { value: 'colour', label: 'Colour', title: 'A flat colour: no picture at all, only the layers (a CPU sketch)' },
          ]} />
        </div>
        {backdropUse && swatch(backdropUse, d.backdrop, c => setDisplay({ backdrop: c }))}
        {busy && <span style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>Loading…</span>}
      </div>

      {(source === 'image' || source === 'video' || showToggle) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          {source === 'image' && (
            <>
              {d.image && <img src={d.image.src} alt="" title={d.image.name} style={{ width: 40, height: 24, objectFit: 'cover', borderRadius: 5, boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.12)}`, flexShrink: 0 }} />}
              <Button size="sm" icon="import" disabled={busy} onClick={() => replaceLegacy('image')}>{busy ? 'Loading…' : d.image ? 'Replace' : 'Choose image'}</Button>
            </>
          )}
          {source === 'video' && (
            <Button size="sm" icon="import" disabled={busy} onClick={() => replaceLegacy('video')}>{busy ? 'Loading…' : !video ? 'Choose video' : videoMissing ? 'Load it again' : 'Replace'}</Button>
          )}
          {(source === 'image' ? !!d.image : source === 'video' ? !!video && !videoMissing : false) && (
            <Select ariaLabel="Fit" height={26} value={d.fit ?? 'cover'} options={FITS} onChange={v => setDisplay({ fit: v as BackgroundFit })} style={{ fontSize: 12 }} />
          )}
          {showToggle && (
            <Tooltip label="Layers only" description="Cover the picture with the backdrop colour. It still runs underneath: text or images with a Reveal matte, and particles with Mask on, show it inside themselves.">
              <Toggle checked={layersOnly} onChange={on => setDisplay({ picture: !on })} label="Layers only" />
            </Tooltip>
          )}
        </div>
      )}

      {source === 'video' && video && !videoMissing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Toggle checked={video.loop} onChange={loop => setDisplay({ video: { ...video, loop } })} label="Loop" />
          <Toggle checked={!video.muted} onChange={on => setDisplay({ video: { ...video, muted: !on } })} label="Sound" />
          <Select ariaLabel="Speed" height={26} value={String(video.rate)} options={BACKGROUND_RATES.map(r => ({ value: String(r), label: `${r}×` }))} onChange={v => setDisplay({ video: { ...video, rate: Number(v) } })} style={{ fontSize: 12 }} />
          <span title={video.name} style={{ flex: '1 1 80px', minWidth: 0, color: tk.text.faint, font: `11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{video.name} · {sizeText(video.bytes)}</span>
        </div>
      )}

      {source === 'video' && video && !video.src && !videoMissing && note(`Over ${sizeText(BACKGROUND_VIDEO_KEEP)}, so it plays until you reload: saves, play files and web pages leave it out. Trim or compress it to keep it.`, 'warning')}
      {videoMissing && note(`“${video!.name}” (${sizeText(video!.bytes)}) was too big to save. Load it again to use it.`, 'warning')}
      {videoError && note('This browser can’t play that video. Try an MP4 (H.264) or a WebM.', 'warning')}
      {source !== 'shader' && note(<>The graph is paused on Play: only the {source === 'colour' ? 'colour' : source} and the layers are drawn. The Studio still runs the graph.{hasLayersNode ? ' Its Layers node gets nothing from here while the graph is paused.' : ''}</>)}
      {picking && <GraphSourcePicker anchorRef={segRef} title="Show a graph" onClose={() => setPicking(false)} onPick={item => startLayer(item)} />}
    </div>
  );
}
