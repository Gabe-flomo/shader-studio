/**
 * The Texture node's card body (docs/texture-node.md): one card for a picture, a video or the
 * webcam. NodeComponent draws the header and the sockets round it.
 *
 * - **Source:** Image / Video / Webcam (the store's switchTextureSource: same node, wires kept).
 * - **Image:** click or drop a file, pick one from the library, or paste a URL; Edit… (crop,
 *   rotate, flip in the clip editor); Fit, Tile, Wrap and Filter.
 * - **Video:** click or drop a file, the library, or a URL (when the site allows it); the clip
 *   editor for trim, segments, speed, loop, crop; a missing file says so and offers Re-link.
 * - **Webcam:** Play's own camera and hand-tracking controls, the mirror, and "Map a hand to…"
 *   (Play's mini mapper, onto any slider in the graph).
 * - **Generate depth:** a Depth node wired to this texture (and a Depth Composite in a 3D graph).
 *
 * Every hook here runs whatever the source, so switching it never changes the hook order.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Segmented, Toggle } from '../ui/Choice';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toastStore';
import { CameraChip } from '../play/chips';
import { HandsChip } from '../play/HandsChip';
import { MiniMapper } from '../play/MiniMapper';
import { sourceLabel } from '../../play/playSources';
import { candidateLabel, collectPlayCandidates } from '../../play/playControls';
import { videoEngine } from '../../lib/videoEngine';
import { listImages, listVideos, getImage, type BackgroundImageMeta, type LibraryVideoMeta } from '../../lib/backgroundLibrary';
import { KIND_LABEL, imageNameOf, textureKindOf, type TextureKind } from '../../lib/texture/textureSource';
import { fetchMedia, TextureUrlError } from '../../lib/texture/pictures';
import { takePicture } from '../../lib/texture/pictureHost';
import { isImageFile, isVideoFile, loadLibraryVideo, loadVideoIntoNode, videoMissing } from '../../lib/texture/videoActions';
import { cameraLayerOf, mirrorParams, setCameraMirror } from '../../lib/texture/webcam';
import { textureTileOf, textureWrapOf } from '../../nodes/definitions/sources';
import { TextureImageEditModal } from './TextureImageEditModal';

const KINDS: TextureKind[] = ['image', 'video', 'webcam'];
const subscribeEngine = (fn: () => void) => videoEngine.onChange(fn);

export function TextureCardBody({ node, onEditClip }: { node: GraphNode; onEditClip: () => void }) {
  const tk = useTokens();
  const kind = textureKindOf(node);
  const switchSource = useNodeGraphStore(s => s.switchTextureSource);
  const generateDepth = useNodeGraphStore(s => s.generateTextureDepth);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const hasPicture = useNodeGraphStore(s => !!s.nodeTextures[node.id]);
  const play = useNodeGraphStore(s => s.play);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const nodes = useNodeGraphStore(s => s.nodes);
  const paramBindings = useNodeGraphStore(s => s.paramBindings);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [libOpen, setLibOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [missing, setMissing] = useState(false);
  const [mapTarget, setMapTarget] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLSpanElement>(null);
  const mapRef = useRef<HTMLSpanElement>(null);
  const p = node.params;
  const videoId = typeof p.videoId === 'string' ? p.videoId : '';
  const videoUrl = useSyncExternalStore(subscribeEngine, () => videoEngine.url(node.id));

  // A kept video this browser doesn't have: say so (Re-link), rather than an empty card.
  useEffect(() => {
    let live = true;
    if (kind !== 'video' || !videoId || videoUrl) { setMissing(false); return; }
    void videoMissing(videoId).then(m => { if (live) setMissing(m); });
    return () => { live = false; };
  }, [kind, videoId, videoUrl]);

  const line = { fontSize: 11, color: tk.text.muted, lineHeight: 1.4 } as const;
  const label = { fontSize: 10.5, color: tk.text.faint, minWidth: 40 } as const;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const run = async (what: string, job: () => Promise<string | null | void>) => {
    setBusy(what); setError('');
    try { const err = await job(); if (err) setError(err); } catch (e) {
      setError(e instanceof TextureUrlError ? e.message : e instanceof Error ? e.message : String(e));
    } finally { setBusy(''); }
  };

  const toKind = (k: TextureKind) => {
    if (k === kind) return;
    setError('');
    switchSource(node.id, k);
    // Back to a video this node already had open: its texture again (a webcam took the slot).
    if (k === 'video') { const t = videoEngine.getTexture(node.id); if (t) useNodeGraphStore.getState().setVideoTexture(node.id, t); }
  };

  const takeFile = (f: File) => {
    if (isVideoFile(f)) {
      if (kind !== 'video') toKind('video');
      void run('Opening the video…', () => loadVideoIntoNode(node.id, f));
    } else if (isImageFile(f)) {
      if (kind !== 'image') toKind('image');
      void run('Reading the picture…', async () => { await takePicture(node.id, f, { name: f.name.replace(/\.[a-z0-9]{2,5}$/i, '') }); });
    } else setError(`"${f.name}" isn’t a picture or a video.`);
  };

  const loadUrl = () => {
    const u = url.trim();
    if (!u) return;
    if (kind === 'video') {
      void run('Downloading the video…', async () => {
        const got = await fetchMedia(u, 'video');
        const ext = got.blob.type.includes('webm') ? '.webm' : got.blob.type.includes('quicktime') ? '.mov' : '.mp4';
        return loadVideoIntoNode(node.id, new File([got.blob], `${got.name}${ext}`, { type: got.blob.type || 'video/mp4' }), { url: u });
      });
    } else {
      void run('Downloading the picture…', async () => {
        const got = await fetchMedia(u, 'image');
        await takePicture(node.id, got.blob, { name: got.name, url: u });
        setUrl('');
      });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const f = e.dataTransfer.files[0];
    if (f) { takeFile(f); return; }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (text && /^https?:/i.test(text.trim())) { setUrl(text.trim()); }
  };

  const thumb = typeof p._thumbnailUrl === 'string' ? p._thumbnailUrl : '';
  const name = kind === 'image' ? imageNameOf(p) : (typeof p._fileName === 'string' ? p._fileName : '');
  const cam = cameraLayerOf(play);
  const mirror = cam ? cam.mirror : p.mirror !== false;
  const handMappings = play.mappings.filter(m => m.source.kind === 'hand');
  const candidates = useMemo(() => (kind === 'webcam' ? collectPlayCandidates(nodes, paramBindings) : []), [kind, nodes, paramBindings]);
  const pending = candidates.find(c => c.target === mapTarget) ?? null;

  const dropZone = (children: ReactNode) => (
    <div
      onDrop={onDrop}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
      onClick={() => fileRef.current?.click()}
      onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); if (kind === 'image' && hasPicture) setEditing(true); else if (kind === 'video' && videoUrl) onEditClip(); }}
      title={kind === 'image' ? 'Click: pick a file · drop a picture or a video · double-click: edit' : 'Click: pick a file · drop a video · double-click: the clip editor'}
      data-texture-drop
      style={{ border: `1px dashed ${tk.border.default}`, borderRadius: radius.md, background: tk.bg.field, minHeight: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }}
    >{children}</div>
  );

  return (
    <div onMouseDown={stop} onPointerDown={stop} onWheel={stop} data-texture-card={kind} style={{ padding: '6px 10px 8px', display: 'flex', flexDirection: 'column', gap: 7, font: `11px ${fontFamily.ui}` }}>
      <Segmented<TextureKind> size="sm" fill ariaLabel="Source" value={kind} onChange={toKind} options={KINDS.map(k => ({ value: k, label: KIND_LABEL[k] }))} />
      <input ref={fileRef} type="file" accept={kind === 'video' ? 'video/mp4,video/webm,video/quicktime,video/ogg,.mkv,.m4v' : 'image/*,video/mp4,video/webm,video/quicktime'} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) takeFile(f); e.target.value = ''; }} />

      {kind === 'image' && <>
        {dropZone(thumb
          ? <img src={thumb} alt={name || 'picture'} style={{ width: '100%', maxHeight: 110, objectFit: 'contain', display: 'block' }} />
          : <span style={{ ...line, padding: 10, textAlign: 'center' }}>Click or drop a picture (or a video)</span>)}
        {thumb && !hasPicture && !busy && <span style={{ ...line, color: tk.status.warning }}>Opening the picture… (if it stays like this, load it again: it was saved before pictures were kept with the graph)</span>}
      </>}

      {kind === 'video' && <>
        {dropZone(videoUrl
          ? <video src={videoUrl} muted playsInline style={{ width: '100%', maxHeight: 110, objectFit: 'contain', display: 'block' }} />
          : <span style={{ ...line, padding: 10, textAlign: 'center' }}>{missing ? '' : 'Click or drop an MP4 / WebM / MOV'}</span>)}
        {missing && (
          <span data-texture-missing style={{ ...line, color: tk.status.warning }}>
            Missing: {name || 'the video'} isn’t in this browser’s library. Re-link it: pick the file, or one from the library.
          </span>
        )}
      </>}

      {kind !== 'webcam' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button size="sm" onClick={() => fileRef.current?.click()}>{missing ? 'Re-link…' : kind === 'image' ? (hasPicture ? 'Replace…' : 'Upload…') : (videoUrl ? 'Replace…' : 'Upload…')}</Button>
          <span ref={libRef}><Button size="sm" onClick={() => setLibOpen(o => !o)} aria-expanded={libOpen}>Library</Button></span>
          {kind === 'image' && <Button size="sm" disabled={!hasPicture} onClick={() => setEditing(true)} title="Crop, rotate, flip">Edit…</Button>}
          {kind === 'video' && <Button size="sm" disabled={!videoUrl} onClick={onEditClip} title="Trim, segments, speed, loop, crop">Edit clip…</Button>}
        </div>
      )}
      {libOpen && kind !== 'webcam' && (
        <LibraryPicker anchorRef={libRef} kind={kind} onClose={() => setLibOpen(false)} onPick={item => {
          setLibOpen(false);
          if (kind === 'video') void run('Opening the video…', () => loadLibraryVideo(node.id, item.id));
          else void run('Reading the picture…', async () => {
            const img = await getImage(item.id);
            if (!img) return 'That picture isn’t in the library any more.';
            await takePicture(node.id, img.blob, { name: img.name, libraryId: item.id });
          });
        }} />
      )}
      {kind !== 'webcam' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') loadUrl(); }}
            placeholder={kind === 'image' ? 'Paste an image URL' : 'Paste a video file URL'} aria-label={kind === 'image' ? 'Image URL' : 'Video URL'}
            style={{ flex: 1, minWidth: 0, height: 26, padding: '0 8px', borderRadius: radius.md, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `11px ${fontFamily.ui}`, outline: 'none' }}
          />
          <Button size="sm" disabled={!url.trim() || !!busy} onClick={loadUrl}>Load</Button>
        </div>
      )}
      {busy && <span style={line}>{busy}</span>}
      {error && <span role="alert" data-texture-error style={{ ...line, color: tk.status.danger }}>{error}</span>}
      {!busy && !error && !missing && name && kind !== 'webcam' && (
        <span style={{ ...line, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>
          {name}{kind === 'image' && typeof p._imageSrc === 'string' ? ' · kept with the graph' : kind === 'video' && videoId ? ' · in the video library' : ''}
        </span>
      )}

      {kind === 'image' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '5px 6px', alignItems: 'center' }}>
          <span style={label}>Fit</span>
          <Select ariaLabel="Fit" height={24} value={typeof p.fit === 'string' ? p.fit : 'stretch'} onChange={v => updateNodeParams(node.id, { fit: v }, { immediate: true })}
            options={[{ value: 'stretch', label: 'Stretch' }, { value: 'contain', label: 'Fit' }, { value: 'cover', label: 'Fill' }]} />
          <span style={label}>Tile</span>
          <Select ariaLabel="Tile" height={24} value={String(textureTileOf(p.tile))} onChange={v => updateNodeParams(node.id, { tile: Number(v) === 1 ? undefined : Number(v) }, { immediate: true })}
            options={[1, 2, 3, 4, 6, 8, 16].map(n => ({ value: String(n), label: `${n}×` }))} />
          <span style={label}>Wrap</span>
          <Select ariaLabel="Wrap" height={24} value={textureWrapOf(p.wrap)} onChange={v => updateNodeParams(node.id, { wrap: v === 'clamp' ? undefined : v }, { immediate: true })}
            options={[{ value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' }]} />
          <span style={label}>Filter</span>
          <Select ariaLabel="Filter" height={24} value={p.filter === 'nearest' ? 'nearest' : 'linear'} onChange={v => updateNodeParams(node.id, { filter: v === 'linear' ? undefined : v }, { immediate: true })}
            options={[{ value: 'linear', label: 'Smooth' }, { value: 'nearest', label: 'Pixels' }]} />
        </div>
      )}

      {kind === 'webcam' && (
        <div data-texture-webcam style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <CameraChip />
          <Toggle checked={mirror} onChange={m => { setPlay(pl => setCameraMirror(pl, m)); updateNodeParams(node.id, mirrorParams(m), { immediate: true }); }} label="Mirror" />
          <HandsChip settings={false} />
          <span ref={mapRef} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={label}>Hands →</span>
            <Select ariaLabel="Map a hand to" height={24} value={mapTarget} onChange={v => setMapTarget(v)} style={{ flex: 1, minWidth: 0 }}
              options={[{ value: '', label: candidates.length ? 'Map a hand to…' : 'No sliders to map yet' }, ...candidates.map(c => ({ value: c.target, label: candidateLabel(c) }))]} />
          </span>
          {handMappings.length > 0 && (
            <span style={line}>{handMappings.length} hand mapping{handMappings.length === 1 ? '' : 's'}: {handMappings.slice(0, 3).map(m => {
              const c = play.controls.find(x => x.id === m.controlId);
              return `${sourceLabel(m.source)} → ${c?.label ?? 'a control'}`;
            }).join(', ')}{handMappings.length > 3 ? '…' : ''}. Tune them in Play → Mappings.</span>
          )}
          {!cam && <span style={{ ...line, color: tk.status.warning }}>No Camera layer: switch to Image and back to Webcam to add one.</span>}
        </div>
      )}
      {pending && kind === 'webcam' && (
        <MiniMapper anchorRef={mapRef} target={{ candidate: pending }} label={candidateLabel(pending)} unfold={['Hands']} onClose={() => setMapTarget('')} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Button size="sm" icon="layers" data-texture-depth
          disabled={kind === 'image' ? !hasPicture : kind === 'video' ? !videoUrl && !videoId : false}
          title={kind === 'video' ? 'Add a Depth node wired to this video (its depth is baked first)' : 'Add a Depth node wired to this texture (in a 3D graph, a Depth Composite too)'}
          onClick={() => {
            const plan = generateDepth(node.id);
            if (!plan) return;
            toast.info('Depth added', {
              message: plan.message,
              ...(plan.bake ? { action: { label: 'Bake depth', onClick: () => void bakeNow(plan.depthId) } } : {}),
            });
          }}>Generate depth</Button>
      </div>
      {editing && <TextureImageEditModal node={node} onClose={() => setEditing(false)} />}
    </div>
  );
}

async function bakeNow(depthId: string): Promise<void> {
  try {
    const { bakeDepth } = await import('../../lib/depth/bake');
    toast.info('Baking depth…', { message: 'The model runs once over the clip; the Depth card shows the progress.' });
    const info = await bakeDepth(depthId, () => {});
    toast.info('Depth baked', { message: info.kind === 'video' ? `${info.frames} frames, kept in the video library.` : 'Kept in the image library.' });
  } catch (e) {
    toast.error('Couldn’t bake the depth', { message: e instanceof Error ? e.message : String(e) });
  }
}

type LibItem = { id: string; name: string; thumb?: string };

function LibraryPicker({ anchorRef, kind, onPick, onClose }: { anchorRef: React.RefObject<HTMLElement | null>; kind: 'image' | 'video'; onPick: (i: LibItem) => void; onClose: () => void }) {
  const tk = useTokens();
  const [items, setItems] = useState<LibItem[] | null>(null);
  useEffect(() => {
    let live = true;
    const load: Promise<Array<BackgroundImageMeta | LibraryVideoMeta>> = kind === 'image' ? listImages() : listVideos();
    load.then(l => { if (live) setItems(l.map(x => ({ id: x.id, name: x.name, thumb: x.thumb }))); }, () => { if (live) setItems([]); });
    return () => { live = false; };
  }, [kind]);
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={280} padding={8}>
      <div data-texture-library style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto', font: `11.5px ${fontFamily.ui}` }}>
        <span style={{ color: tk.text.faint, fontSize: 11 }}>{kind === 'image' ? 'Pictures in the library (Files → Backgrounds)' : 'Videos in the library'}</span>
        {items === null && <span style={{ color: tk.text.muted }}>Loading…</span>}
        {items?.length === 0 && <span style={{ color: tk.text.muted }}>Nothing here yet. Pictures and videos you load are kept here.</span>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {items?.map(i => (
            <button key={i.id} type="button" onClick={() => onPick(i)} title={i.name}
              style={{ border: `1px solid ${tk.border.default}`, borderRadius: radius.md, background: tk.bg.field, padding: 3, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              {i.thumb ? <img src={i.thumb} alt="" style={{ width: '100%', height: 48, objectFit: 'cover', borderRadius: 3 }} /> : <span style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint }}>{kind === 'image' ? 'picture' : 'video'}</span>}
              <span style={{ fontSize: 10, color: tk.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}
