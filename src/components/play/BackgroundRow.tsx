/**
 * BackgroundRow — what the Play picture is under the layers: the shader, an
 * image, a video or a flat colour (PlayDisplay, types/play.ts). Anything but
 * the shader stops the graph on the Play page (play/background.ts): the
 * layers draw over the background and read it as the picture.
 *
 * "Layers only" stays what it was: the picture (shader, image or video) is
 * covered by the backdrop colour but still runs, so Reveal mattes and
 * particles with Mask show it inside themselves. Old files' Layers only is
 * the shader's.
 */
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { BACKGROUND_IMAGE_MAX, BACKGROUND_IMAGE_SIDE, BACKGROUND_RATES, BACKGROUND_VIDEO_KEEP, DEFAULT_DISPLAY, backgroundSource, isDefaultDisplay, type BackgroundFit, type BackgroundSource, type PlayDisplay, type PlayRecord } from '../../types/play';
import { playBackground } from '../../play/background';
import { mediaType } from '../../lib/mediaSources';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { Tooltip } from '../ui/Tooltip';
import { toast } from '../ui/toastStore';

const MB = 1024 * 1024;
const sizeText = (bytes: number) => (bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const FITS: { value: BackgroundFit; label: string }[] = [
  { value: 'cover', label: 'Fill (crop)' },
  { value: 'contain', label: 'Fit inside' },
  { value: 'stretch', label: 'Stretch' },
];

/** A picked image as a data URL: at most BACKGROUND_IMAGE_SIDE on its longest side (SVGs drawn at that size), JPEG unless it has transparency. */
function loadBackgroundImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
      const w0 = img.naturalWidth || BACKGROUND_IMAGE_SIDE, h0 = img.naturalHeight || BACKGROUND_IMAGE_SIDE;
      const encode = (side: number) => {
        const k = isSvg ? side / Math.max(w0, h0) : Math.min(1, side / Math.max(w0, h0));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
        const x = c.getContext('2d');
        if (!x) return '';
        x.drawImage(img, 0, 0, c.width, c.height);
        // Transparency only matters for PNG, WebP and SVG; photos go as JPEG.
        const png = (isSvg || file.type === 'image/png' || file.type === 'image/webp') && hasAlpha(x, c.width, c.height);
        return png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88);
      };
      let src = encode(BACKGROUND_IMAGE_SIDE);
      if (src.length > BACKGROUND_IMAGE_MAX) src = encode(1280);
      if (!src || src.length > BACKGROUND_IMAGE_MAX) reject(new Error('The image is too big to keep, even scaled down.'));
      else resolve(src);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This browser can’t read that image.')); };
    img.src = url;
  });
}

function hasAlpha(x: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const d = x.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 16) if (d[i] < 255) return true;
  } catch { /* unreadable: keep it as PNG */ return true; }
  return false;
}

function readDataUrl(file: File, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === 'string' ? resolve(r.result.replace(/^data:[^;,]*;/, `data:${mime};`)) : reject(new Error('Couldn’t read the file.')));
    r.onerror = () => reject(r.error ?? new Error('Couldn’t read the file.'));
    r.readAsDataURL(file);
  });
}

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
  const d = play.display ?? DEFAULT_DISPLAY;
  const source = backgroundSource(d);
  const hasLayersNode = useNodeGraphStore(s => s.nodes.some(n => n.type === 'playLayers'));
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const setDisplay = (patch: Partial<PlayDisplay>) => onChange(p => {
    const next: PlayDisplay = { ...(p.display ?? DEFAULT_DISPLAY), ...patch };
    if (next.source === 'shader') delete next.source;
    if (next.fit === 'cover') delete next.fit;
    if (isDefaultDisplay(next)) { const rest = { ...p }; delete rest.display; return rest; }
    return { ...p, display: next };
  });

  const pickImage = async (file: File) => {
    setBusy(true);
    try { setDisplay({ source: 'image', image: { name: file.name.slice(0, 120), src: await loadBackgroundImage(file) } }); }
    catch (e) { toast.error('Couldn’t use that image', { message: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  const pickVideo = async (file: File) => {
    setBusy(true);
    try {
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
    finally { setBusy(false); }
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
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 12px 8px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.panel }}>
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickImage(f); }} />
      <input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickVideo(f); }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tooltip label="Background" description="What the layers draw over. Shader is the graph. Image, Video and Colour replace it on the Play page: the graph stops running here (the Studio still shows it), and everything that reads the picture — Script layers, glyphs, contours, particles, mattes, picture shapes — reads the background instead.">
          <span style={{ cursor: 'help' }}>{label('Background')}</span>
        </Tooltip>
        <Segmented<BackgroundSource> size="sm" ariaLabel="Background" value={source} onChange={v => setDisplay({ source: v })} options={[
          { value: 'shader', label: 'Shader', title: 'The graph’s picture' },
          { value: 'image', label: 'Image', title: 'A picture file (PNG, JPG, WebP or SVG) instead of the shader' },
          { value: 'video', label: 'Video', title: 'A video file (MP4, WebM or MOV) instead of the shader' },
          { value: 'colour', label: 'Colour', title: 'A flat colour: no picture at all, only the layers (a CPU sketch)' },
        ]} />
        {backdropUse && swatch(backdropUse, d.backdrop, c => setDisplay({ backdrop: c }))}
      </div>

      {(source === 'image' || source === 'video' || showToggle) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          {source === 'image' && (
            <>
              {d.image && <img src={d.image.src} alt="" title={d.image.name} style={{ width: 40, height: 24, objectFit: 'cover', borderRadius: 5, boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.12)}`, flexShrink: 0 }} />}
              <Button size="sm" icon="import" disabled={busy} onClick={() => imageInput.current?.click()}>{busy ? 'Loading…' : d.image ? 'Replace' : 'Choose image'}</Button>
            </>
          )}
          {source === 'video' && (
            <Button size="sm" icon="import" disabled={busy} onClick={() => videoInput.current?.click()}>{busy ? 'Loading…' : !video ? 'Choose video' : videoMissing ? 'Load it again' : 'Replace'}</Button>
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
    </div>
  );
}
