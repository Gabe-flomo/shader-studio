/**
 * TexturePicker — the builders' shared "texture source" picker (docs/scene-builder.md, "Textures").
 * Every builder takes a picture the same five ways, and each ends in a real node of the graph:
 *
 *   1. upload or drop a file;            ┐
 *   2. paste a picture, or a link;       ├ a new Texture node with the picture (builders/textureActions.ts)
 *   3. a picture from the image library; ┘
 *   4. a Texture, Shader Texture (or anything with a texture output) already in the graph;
 *   5. a new Shader Texture.
 *
 *  - <PictureWays onPicked>: the ways alone, for a place that wires the node itself (the Agent
 *    Builder's Where picker, Grid Rules' start picture).
 *  - <TexturePicker>: a builder's row: the picture a use reads now (from the scene's own list), a
 *    "Pick…" panel with the scene's pictures first and then the ways. A new picture is added to the
 *    scene's list (`onAdd`) and picked.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getImage, listImages, type BackgroundImageMeta } from '../../lib/backgroundLibrary';
import { MediaLibraryGrid } from '../media/MediaLibraryGrid';
import { readClipboardPicture } from '../../lib/texture/texturePaste';
import { URL_MESSAGES, TextureUrlError } from '../../lib/texture/pictures';
import { textureNodes, texNodeLabel, type TexSource } from '../../builders/textures';
import { newShaderTexture, pictureFromBlob, pictureFromLibrary, pictureFromUrl, sourceFor, type PickedTexture } from '../../builders/textureActions';

const THUMB: CSSProperties = { width: 44, height: 30, borderRadius: 5, objectFit: 'cover', flexShrink: 0, display: 'block' };

/** A node's picture as a small image (its card thumbnail), or an icon. */
export function TexThumb({ nodeId, w = 44, h = 30 }: { nodeId: string | undefined; w?: number; h?: number }) {
  const tk = useTokens();
  const url = useNodeGraphStore(s => {
    const n = nodeId ? s.nodes.find(x => x.id === nodeId) : undefined;
    return typeof n?.params._thumbnailUrl === 'string' ? n.params._thumbnailUrl : '';
  });
  const shader = useNodeGraphStore(s => (nodeId ? s.nodes.find(x => x.id === nodeId)?.type === 'shaderTexture' : false));
  return url
    ? <img src={url} alt="" data-tex-thumb="image" style={{ ...THUMB, width: w, height: h }} />
    : (
      <span data-tex-thumb="glyph" style={{ ...THUMB, width: w, height: h, background: tk.bg.render, color: tk.text.faint, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
        <Icon name={shader ? 'layers' : 'camera'} size={14} />
      </span>
    );
}

const errorText = (e: unknown) => (e instanceof TextureUrlError ? (URL_MESSAGES as Record<string, string>)[e.problem] ?? e.message : e instanceof Error ? e.message : String(e));

/** The ways to take a picture. `inScene`: graph nodes already in use, not offered again. */
export function PictureWays({ onPicked, list, inScene = [], graph = true, shader = true }: {
  onPicked: (p: PickedTexture) => void;
  /** The scene's pictures (for naming a new one uniquely). */
  list?: readonly TexSource[];
  inScene?: readonly string[];
  graph?: boolean;
  shader?: boolean;
}) {
  const tk = useTokens();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [lib, setLib] = useState<BackgroundImageMeta[] | null>(null);
  const [drag, setDrag] = useState(false);
  const graphKey = useNodeGraphStore(s => (graph ? textureNodes(s.nodes).filter(n => !inScene.includes(n.id)).map(n => `${n.id}\u0000${texNodeLabel(n)}`).join('\u0001') : ''));
  const inGraph = graphKey ? graphKey.split('\u0001').map(x => { const [id, label] = x.split('\u0000'); return { id, label }; }) : [];
  const run = (label: string, job: () => Promise<PickedTexture>) => {
    setBusy(label); setError('');
    job().then(p => { setBusy(''); onPicked(p); }, e => { setBusy(''); setError(errorText(e)); });
  };
  const take = (f: File | null | undefined) => {
    if (!f) return;
    if (!/^image\//i.test(f.type)) { setError('That isn’t a picture: try a PNG, JPEG or WebP.'); return; }
    run('Reading the picture…', () => pictureFromBlob(f, { name: f.name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'picture' }, list));
  };
  const load = () => { const u = link.trim(); if (u) run('Fetching the picture…', () => pictureFromUrl(u, list)); };
  const chip: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', border: `1px dashed ${tk.border.default}`, borderRadius: 999, background: 'none', cursor: 'pointer', color: tk.text.secondary, font: `500 12px ${fontFamily.ui}` };
  const head = (t: string) => <span style={{ fontSize: 11, fontWeight: 650, color: tk.text.muted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{t}</span>;
  return (
    <div data-picture-ways style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div data-picture-drop
        onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files?.[0]); }}
        onClick={() => fileRef.current?.click()}
        style={{ padding: '10px 12px', borderRadius: radius.md, border: `1.5px dashed ${drag ? tk.accent.base : tk.border.default}`, background: drag ? tk.bg.selected : tk.bg.field, color: tk.text.secondary, fontSize: 12, cursor: 'pointer', textAlign: 'center' }}>
        <Icon name="camera" size={14} /> {busy || 'Upload or drop a picture'}
        <input ref={fileRef} type="file" accept="image/*" hidden data-picture-file onChange={e => { take(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <input data-picture-link value={link} placeholder="Paste a picture or its link, then Enter" aria-label="Paste a picture or its link"
        onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }}
        onPaste={e => {
          const got = readClipboardPicture(e.clipboardData);
          if (!got) return;
          e.preventDefault();
          if (got.kind === 'image') run('Reading the picture…', () => pictureFromBlob(got.blob, { name: got.name, url: got.url }, list));
          else { setLink(got.url); run('Fetching the picture…', () => pictureFromUrl(got.url, list)); }
        }}
        style={{ height: 28, padding: '0 8px', borderRadius: radius.control, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `12px ${fontFamily.ui}` }} />
      {error && <span data-picture-error style={{ fontSize: 11.5, color: tk.status.warningText, lineHeight: 1.4 }}>{error}</span>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button type="button" data-picture-library style={chip} onClick={() => { if (lib) { setLib(null); return; } listImages().then(setLib, () => setLib([])); }}>
          <Icon name="folder" size={13} />Image library
        </button>
        {shader && (
          <button type="button" data-picture-shader style={chip} title="A new Shader Texture: its own little shader graph drawn into a texture (edit what it draws later: Edit inside on its card)" onClick={() => { setError(''); onPicked(newShaderTexture(list)); }}>
            <Icon name="layers" size={13} />New Shader Texture
          </button>
        )}
      </div>
      {lib && (
        <div data-picture-library-list style={{ maxHeight: 340, overflowY: 'auto' }} onKeyDown={e => e.stopPropagation()}>
          {lib.length === 0 && <span style={{ fontSize: 11.5, color: tk.text.muted }}>Nothing in the library yet: pictures you load are kept here.</span>}
          {lib.length > 0 && (
            <MediaLibraryGrid kind="image" items={lib} label="Image library" columns="repeat(auto-fill, minmax(70px, 1fr))" thumbHeight={44} previewHeight={130}
              load={async i => (await getImage(i.id))?.blob ?? null}
              onClose={() => setLib(null)}
              onPick={i => { setLib(null); run('Opening the picture…', () => pictureFromLibrary(i.id, list)); }} />
          )}
        </div>
      )}
      {graph && inGraph.length > 0 && (
        <>
          {head('From the graph')}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {inGraph.map(g => (
              <button key={g.id} type="button" data-picture-node={g.id} title={`Read ${g.label}'s Texture output`}
                onClick={() => { const src = sourceFor(g.id, list); if (src) onPicked({ nodeId: g.id, source: src }); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px 3px 3px', borderRadius: radius.md, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.primary, cursor: 'pointer', font: `500 11.5px ${fontFamily.ui}`, maxWidth: 200 }}>
                <TexThumb nodeId={g.id} w={32} h={22} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A builder's picture row for one use: what it reads now, Pick… (the scene's pictures, then every
 * way to take one), and ✕ (when `allowNone`).
 */
export function TexturePicker({ id, sources, value, onChange, onAdd, allowNone = true, none = 'No picture', startOpen = false }: {
  id: string;
  sources: readonly TexSource[];
  /** The source's name it reads now. */
  value: string | null | undefined;
  onChange: (name: string | null) => void;
  /** A new source for the scene's list (picked at once). */
  onAdd: (src: TexSource) => void;
  allowNone?: boolean;
  none?: string;
  startOpen?: boolean;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState(startOpen);
  const cur = sources.find(s => s.name === value);
  const missing = useNodeGraphStore(s => !!cur?.node && !s.nodes.some(n => n.id === cur.node));
  useEffect(() => { if (startOpen) setOpen(true); }, [startOpen]);
  return (
    <div data-texture-picker={id} data-texture-value={value ?? ''} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <TexThumb nodeId={cur?.node} />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: cur ? tk.text.primary : tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cur ? cur.name : none}</span>
          {cur && <span style={{ fontSize: 10.5, color: missing || !cur.node ? tk.status.warningText : tk.text.faint }}>
            {!cur.node ? 'An empty Texture node is made on Build: drop a picture on it' : missing ? 'Its node is gone: pick another' : cur.kind === 'shader' ? 'Shader Texture' : 'Texture node'}
          </span>}
        </span>
        <Button size="sm" data-texture-pick={id} aria-expanded={open} onClick={() => setOpen(o => !o)}>{cur ? 'Change' : 'Pick…'}</Button>
        {cur && allowNone && (
          <button type="button" data-texture-clear={id} aria-label="No picture" title="No picture" onClick={() => onChange(null)}
            style={{ width: 22, height: 22, padding: 0, border: 0, borderRadius: 6, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {open && (
        <div data-texture-panel={id} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, borderRadius: radius.card, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
          {sources.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {sources.map(s => (
                <button key={s.name} type="button" data-texture-source={s.name} aria-pressed={s.name === value} onClick={() => { onChange(s.name); setOpen(false); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px 3px 3px', borderRadius: radius.md, border: 0, cursor: 'pointer', font: `500 11.5px ${fontFamily.ui}`,
                    background: s.name === value ? tk.bg.selected : tk.bg.panel, boxShadow: s.name === value ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.default}`, color: tk.text.primary }}>
                  <TexThumb nodeId={s.node} w={32} h={22} />{s.name}
                </button>
              ))}
            </div>
          )}
          <PictureWays list={sources} inScene={sources.map(s => s.node ?? '')} onPicked={p => { onAdd(p.source); onChange(p.source.name); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}
