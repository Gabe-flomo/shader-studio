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
 * Colour is flat (Solid), a Gradient built here from up to 8 stops (angle,
 * Smooth or Bands; "Save as palette" keeps it in the library), or a library
 * Palette (PlayDisplay.colourMode and .fill): the kit paints it, and
 * everything that reads the picture reads it. Image… takes a picture from
 * the library's backgrounds or a file.
 *
 * Setups from before the Background layer keep their image or video here and
 * still play it (their Replace, Fit and video options stay). "Layers only"
 * stays what it was: the picture is covered by the backdrop colour but still
 * runs, so Reveal mattes and particles with Mask show it inside themselves.
 */
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Menu } from '../ui/Menu';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { FillEditor, type EditableFill } from '../backgrounds/FillEditor';
import { openBackgrounds } from '../backgrounds/backgroundsUi';
import { imageMenuItems, pickLibraryImage } from '../backgrounds/libraryImage';
import { openLinkedPicker } from '../linked/linkedUi';
import { LinkedRelinkButton, linkedMissingText, useLinkedAvailable } from '../linked/LinkedPickButton';
import { linkedBackgroundImage, linkedBackgroundVideo, linkedImageSource, linkedVideoSource } from '../linked/linkedSources';
import { isLinkedRef } from '../../files/linkedRefs';
import { linkedProblem } from '../../files/linkedFolders';
import { usePalettes } from '../backgrounds/useBackgrounds';
import { freePaletteName, getPalette, paletteCss, paletteFill, savePalette, PALETTE_PRESETS } from '../../lib/backgroundLibrary';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { BACKGROUND_RATES, BACKGROUND_VIDEO_KEEP, DEFAULT_DISPLAY, PLAY_FILL_STOPS_MAX, backgroundLayerOf, backgroundSource, fitStops, isDefaultDisplay, type BackgroundFill, type BackgroundFit, type BackgroundItem, type PlayDisplay, type PlayRecord } from '../../types/play';
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
import { askText } from '../ui/dialogStore';
import { usePlayUi } from './playUi';
import { GraphSourcePicker } from './GraphSourcePicker';
import { IMAGE_ACCEPT, VIDEO_ACCEPT, baseName, imageSource, loadBackgroundImage, readDataUrl, sizeText, videoSource } from './backgroundFiles';

const FITS: { value: BackgroundFit; label: string }[] = [
  { value: 'cover', label: 'Fill (crop)' },
  { value: 'contain', label: 'Fit inside' },
  { value: 'stretch', label: 'Stretch' },
];

type HeaderChoice = 'shader' | 'graph' | 'image' | 'video' | 'colour';
type ColourChoice = 'solid' | 'gradient' | 'palette';

const narrowScreen = () => typeof window !== 'undefined' && window.innerWidth < 640;



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
  const [imageMenu, setImageMenu] = useState<{ x: number; y: number; legacy: boolean } | null>(null);
  const [editingFill, setEditingFill] = useState(false);
  const fillRef = useRef<HTMLButtonElement>(null);
  const palettes = usePalettes();
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
    if (v === 'video' && d.video && (d.video.src || playBackground.hasSessionVideo(d.video.name, d.video.bytes) || isLinkedRef(d.video.libraryId))) {
      const vd = d.video;
      startLayer({ id: newSourceId(), kind: 'video', name: vd.name, src: vd.src, bytes: vd.bytes, loop: vd.loop, muted: vd.muted, rate: vd.rate, ...(vd.libraryId ? { libraryId: vd.libraryId } : {}) });
      return;
    }
    legacyPick.current = false;
    if (v === 'image') { askImage(false); return; }
    askVideo(false);
  };

  // Linked folders (docs/linked-folders.md): a picture embedded like a picked file, a video played from disk.
  const linkedOk = useLinkedAvailable();
  const [videoMenu, setVideoMenu] = useState<{ x: number; y: number; legacy: boolean } | null>(null);
  /** Video…: a file, or (with linked folders) a menu. */
  const askVideo = (legacy: boolean) => {
    if (!linkedOk) { legacyPick.current = legacy; videoInput.current?.click(); return; }
    const r = segRef.current?.getBoundingClientRect();
    setVideoMenu({ x: r ? r.left : 16, y: r ? r.bottom + 4 : 80, legacy });
  };
  const fromLinked = async (kind: 'image' | 'video', legacy: boolean, ref?: string) => {
    let use = ref, bytes = d.video?.bytes ?? 0;
    if (!use) {
      const p = await openLinkedPicker({ filter: kind });
      if (p?.kind !== 'file') return;
      use = p.ref; bytes = p.entry.size;
    }
    setBusy(true);
    try {
      if (kind === 'image') {
        if (legacy) setDisplay({ source: 'image', image: await linkedBackgroundImage(use) }); else startLayer(await linkedImageSource(use));
      } else if (legacy) setDisplay({ source: 'video', video: linkedBackgroundVideo(use, bytes, d.video) });
      else startLayer(linkedVideoSource(use, bytes));
    } catch (e) { toast.error(`Couldn’t use that ${kind}`, { message: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  /** Image…: a menu, library or file. */
  const askImage = (legacy: boolean) => {
    const r = segRef.current?.getBoundingClientRect();
    setImageMenu({ x: r ? r.left : 16, y: r ? r.bottom + 4 : 80, legacy });
  };
  const imageFromLibrary = async (legacy: boolean) => {
    const item = await pickLibraryImage();
    if (!item) return;
    if (legacy) setDisplay({ source: 'image', image: { name: item.name, src: item.src!, ...(item.libraryId ? { libraryId: item.libraryId } : {}) } });
    else startLayer(item);
  };

  // ── Colour: solid, gradient or palette ────────────────────────────────────
  const colourChoice: ColourChoice = d.colourMode ?? 'solid';
  const fill: BackgroundFill = d.fill ?? paletteFill(PALETTE_PRESETS[0]);
  const setFill = (f: EditableFill, mode: 'gradient' | 'palette' = 'gradient') => {
    const next: BackgroundFill = { style: f.style, stops: fitStops(f.stops, PLAY_FILL_STOPS_MAX), angle: f.angle };
    if (mode === 'palette' && d.fill?.paletteId) { next.paletteId = d.fill.paletteId; if (d.fill.name) next.name = d.fill.name; }
    setDisplay({ colourMode: mode, fill: next });
  };
  const chooseColour = (c: ColourChoice) => {
    if (c === 'solid') { setDisplay({ colourMode: undefined }); return; }
    if (c === 'gradient') { setDisplay({ colourMode: 'gradient', fill: d.fill ?? { ...paletteFill(PALETTE_PRESETS[0]), paletteId: undefined, name: undefined } }); return; }
    // Palette: keep the one picked before, else the first preset.
    const keep = d.fill?.paletteId && getPalette(d.fill.paletteId);
    setDisplay({ colourMode: 'palette', fill: keep ? { ...paletteFill(keep), angle: d.fill!.angle } : paletteFill(PALETTE_PRESETS[0]) });
  };
  const pickPalette = (id: string) => {
    const p = getPalette(id);
    if (p) setDisplay({ colourMode: 'palette', fill: paletteFill(p) });
  };
  const saveAsPalette = async () => {
    const n = await askText('Save as palette', { label: 'Name', initial: freePaletteName(fill.name ?? 'My gradient'), confirmLabel: 'Save' });
    if (!n) return;
    try {
      const p = savePalette({ name: n, stops: fill.stops, style: fill.style, angle: fill.angle });
      setDisplay({ colourMode: d.colourMode, fill: { ...fill, paletteId: p.id, name: p.name } });
      toast.success(`Saved “${p.name}”`, { message: 'In the Library’s backgrounds, under Palettes: pick it here with Palette, or in any setup.' });
    } catch (e) { toast.error('Couldn’t save the palette', { message: e instanceof Error ? e.message : String(e) }); }
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
  const replaceLegacy = (kind: 'image' | 'video') => {
    if (kind === 'image') { askImage(true); return; }
    askVideo(true);
  };

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
  const videoLinked = !!video && isLinkedRef(video.libraryId);
  const videoMissing = source === 'video' && !!video && !video.src && !playBackground.hasSessionVideo(video.name, video.bytes) && (!videoLinked || !!linkedProblem(video.libraryId!));
  const videoError = !!vEl?.error;
  const showToggle = source !== 'colour';
  const layersOnly = !d.picture && source !== 'colour';
  // The backdrop colour matters for Colour, Layers only, and the bars around a fitted image or video.
  const backdropUse = source === 'colour' ? (colourChoice === 'solid' ? 'Background colour' : null)
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

      {source === 'colour' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          <Segmented<ColourChoice> size="sm" ariaLabel="Colour" value={colourChoice} onChange={chooseColour} options={[
            { value: 'solid', label: 'Solid', title: 'One flat colour' },
            { value: 'gradient', label: 'Gradient', title: `Colours blending across the picture: up to ${PLAY_FILL_STOPS_MAX} stops, at any angle` },
            { value: 'palette', label: 'Palette', title: 'A palette from the library (built in, or one you saved)' },
          ]} />
          {colourChoice === 'gradient' && (
            <>
              <button ref={fillRef} type="button" onClick={() => setEditingFill(o => !o)} aria-expanded={editingFill} title="Edit the gradient"
                style={{ width: 56, height: 24, flexShrink: 0, borderRadius: radius.md, border: 0, padding: 0, cursor: 'pointer', background: paletteCss(fill), boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.14)}${editingFill ? `, 0 0 0 2px ${tk.accent.base}` : ''}` }} />
              <Button size="sm" icon="edit" onClick={() => setEditingFill(o => !o)}>Edit</Button>
              <Button size="sm" variant="ghost" icon="save" onClick={() => void saveAsPalette()} title="Keep these colours in the Library, to use in other setups">Save as palette</Button>
            </>
          )}
          {colourChoice === 'palette' && (
            <>
              <div role="listbox" aria-label="Palettes" style={{ display: 'flex', gap: 5, overflowX: 'auto', flex: '1 1 160px', minWidth: 0, padding: '2px 2px 3px' }}>
                {[...palettes.filter(p => !p.preset), ...palettes.filter(p => p.preset)].slice(0, 24).map(p => {
                  const on = d.fill?.paletteId === p.id;
                  return (
                    <button key={p.id} type="button" role="option" aria-selected={on} title={p.name} onClick={() => pickPalette(p.id)}
                      style={{ width: 34, height: 22, flexShrink: 0, borderRadius: 6, border: 0, padding: 0, cursor: 'pointer', background: paletteCss(p, 90), boxShadow: on ? `0 0 0 2px ${tk.bg.panel}, 0 0 0 3.5px ${tk.accent.base}` : `inset 0 0 0 1px ${alpha('#000000', 0.14)}` }} />
                  );
                })}
              </div>
              <Button size="sm" variant="ghost" onClick={async () => { const pk = await openBackgrounds({ pick: 'palette', title: 'Choose a palette' }); if (pk?.kind === 'palette') setDisplay({ colourMode: 'palette', fill: paletteFill(pk.palette) }); }}>More…</Button>
              <span title={d.fill?.name} style={{ color: tk.text.muted, font: `500 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>{d.fill?.name ?? ''}</span>
              <Button size="sm" variant="ghost" icon="edit" title="Change its colours and angle here (as a gradient)" onClick={() => { setDisplay({ colourMode: 'gradient' }); setEditingFill(true); }}>Edit as gradient</Button>
            </>
          )}
          {editingFill && colourChoice === 'gradient' && (narrowScreen()
            ? <Sheet title="Gradient" onClose={() => setEditingFill(false)} maxHeight="80dvh"><div style={{ padding: '4px 0 12px' }}><FillEditor fill={fill} onChange={f => setFill(f)} compact /></div></Sheet>
            : (
              <Popover anchorRef={fillRef} onClose={() => setEditingFill(false)} align="start" width={380} padding={14}>
                <FillEditor fill={fill} onChange={f => setFill(f)} />
              </Popover>
            ))}
        </div>
      )}

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

      {source === 'video' && videoLinked && !videoMissing && note('Plays from its linked folder, read-only: not copied into the setup or the library.')}
      {source === 'video' && video && !video.src && !videoMissing && !videoLinked && note(`Over ${sizeText(BACKGROUND_VIDEO_KEEP)}, so it plays until you reload: saves, play files and web pages leave it out. Trim or compress it to keep it.`, 'warning')}
      {videoMissing && !videoLinked && note(`“${video!.name}” (${sizeText(video!.bytes)}) was too big to save. Load it again to use it.`, 'warning')}
      {videoMissing && videoLinked && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{note(linkedMissingText(video!.libraryId!, video!.name), 'warning')}<LinkedRelinkButton id={video!.libraryId!} filter="video" onRelinked={ref => void fromLinked('video', true, ref)} /></div>}
      {videoError && note('This browser can’t play that video. Try an MP4 (H.264) or a WebM.', 'warning')}
      {source !== 'shader' && note(<>The graph is paused on Play: only the {source === 'colour' ? 'colour' : source} and the layers are drawn. The Studio still runs the graph.{hasLayersNode ? ' Its Layers node gets nothing from here while the graph is paused.' : ''}</>)}
      {imageMenu && (
        <Menu x={imageMenu.x} y={imageMenu.y} minWidth={240} onClose={() => setImageMenu(null)}
          items={imageMenuItems(
            () => { const legacy = imageMenu.legacy; setImageMenu(null); void imageFromLibrary(legacy); },
            () => { legacyPick.current = imageMenu.legacy; setImageMenu(null); imageInput.current?.click(); },
            linkedOk ? () => { const legacy = imageMenu.legacy; setImageMenu(null); void fromLinked('image', legacy); } : undefined,
          )} />
      )}
      {videoMenu && (
        <Menu x={videoMenu.x} y={videoMenu.y} minWidth={240} onClose={() => setVideoMenu(null)} items={[
          { label: 'Upload a file…', icon: 'import', hint: 'MP4, WebM or MOV', onSelect: () => { legacyPick.current = videoMenu.legacy; setVideoMenu(null); videoInput.current?.click(); } },
          { label: 'From a linked folder…', icon: 'link', hint: 'Plays from disk where it is: not copied', onSelect: () => { const legacy = videoMenu.legacy; setVideoMenu(null); void fromLinked('video', legacy); } },
        ]} />
      )}
      {picking && <GraphSourcePicker anchorRef={segRef} title="Show a graph" onClose={() => setPicking(false)} onPick={item => startLayer(item)} />}
    </div>
  );
}
