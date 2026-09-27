/**
 * BackgroundEditor — the Background layer's panel: its queue of sources
 * (graphs, sketches, images, videos, colours) with thumbnails, which one
 * shows and how the next one comes in, and where the background sits.
 *
 * Sources are added from the menu under the queue, renamed in place,
 * reordered by dragging their grip or from their menu (phones), and set up
 * in the panel that opens under the one you pick. Only the showing source
 * runs; the panel says which one that is.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BACKGROUND_RATES, BACKGROUND_VIDEO_KEEP, type BackgroundItem, type BackgroundLayer } from '../../../types/play';
import { BACKGROUND_QUEUE_MAX, DEFAULT_SCRIPT_3D } from '../../../types/playLayers';
import { addSources, DEFAULT_BACKGROUND_SKETCH, duplicateSource, moveSource, newSourceId, removeSource, renameSource, thisGraphSource, updateSource } from '../../../play/backgroundQueue';
import { compiledQueueGraph, onQueueGraphsChange, preloadQueueExamples } from '../../../play/queueGraphs';
import { playBackground } from '../../../play/background';
import { useScriptStatus } from '../../../play/scriptStatus';
import { klSketchCompile } from '../../../play/kit/layers.js';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { nodePreviewRenderer } from '../../../lib/nodePreviewRenderer';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { Segmented, Toggle } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/iconPaths';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Select } from '../../ui/Select';
import { toast } from '../../ui/toastStore';
import { GraphSourcePicker } from '../GraphSourcePicker';
import { IMAGE_ACCEPT, VIDEO_ACCEPT, imageSource, savedGraphSource, sizeText, videoSource } from '../backgroundFiles';
import type { EditorContext } from './editors';
import type { FieldKit } from './fields';
import { Section } from './Section';
import { useShowing } from '../useQueueShowing';
import { pickLibraryImage } from '../../backgrounds/libraryImage';

type Tokens = FieldKit['tk'];
/** A touch screen: HTML drag and drop doesn't work there, so reordering is in each source's menu. */
const COARSE = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
const hexOf = (c: readonly number[]) => `#${c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

const KIND_ICON: Record<BackgroundItem['kind'], IconName> = { graph: 'graphs', script: 'code', image: 'overlay', video: 'play', colour: 'eye' };

/** One line under a source's name: what it is. */
function describe(it: BackgroundItem): string {
  switch (it.kind) {
    case 'graph': return it.graph === 'this' ? 'Graph · this graph' : it.graph?.startsWith('saved:') ? 'Graph · a copy of a saved graph' : 'Graph · example';
    case 'script': return it.mode === '3d' ? 'Sketch · 3D' : 'Sketch · 2D';
    case 'image': return 'Image';
    case 'video': return `Video${it.bytes ? ` · ${sizeText(it.bytes)}` : ''}${it.rate && it.rate !== 1 ? ` · ${it.rate}×` : ''}`;
    case 'colour': return `Colour · ${hexOf(it.colour ?? [0, 0, 0])}`;
  }
}

/** Re-render when compiled graphs or the background's files change (an example loaded, a video's first frame). */
function useQueueTick(): void {
  const [, set] = useState(0);
  useEffect(() => {
    const bump = () => set(n => n + 1);
    const a = onQueueGraphsChange(bump), b = playBackground.onChange(bump);
    return () => { a(); b(); };
  }, []);
}

// ── Thumbnails ───────────────────────────────────────────────────────────────

/** A graph's picture at two seconds in, rendered off-screen once per version of its shader. */
function useGraphThumb(it: BackgroundItem): string {
  const fs = useNodeGraphStore(s => (it.kind === 'graph' && it.graph === 'this' ? s.fragmentShader : ''));
  const pu = useNodeGraphStore(s => (it.kind === 'graph' && it.graph === 'this' ? s.paramUniforms : null));
  const [url, setUrl] = useState('');
  useQueueTick();
  const c = it.kind === 'graph' && it.graph !== 'this' ? compiledQueueGraph(it) : null;
  const shader = it.kind !== 'graph' ? '' : it.graph === 'this' ? fs : c && c !== 'loading' && !('error' in c) ? c.fragmentShader : '';
  const values = it.graph === 'this' ? pu : c && c !== 'loading' && !('error' in c) ? c.uniforms : null;
  useEffect(() => {
    if (!shader) return;
    let alive = true;
    const uniforms = Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [k, { value: v }]));
    nodePreviewRenderer.renderNodePreview(`bg:${it.id}`, shader, { ...uniforms, u_time: { value: 2 } }, 96, { quiet: true }).then(u => { if (alive) setUrl(u); }, () => {});
    return () => { alive = false; };
  }, [it.id, shader, values]);
  return shader ? url : '';
}

function Thumb({ it, tk, size = 'sm' }: { it: BackgroundItem; tk: Tokens; size?: 'sm' | 'lg' }) {
  const graph = useGraphThumb(it);
  const w = size === 'lg' ? 96 : 52, h = size === 'lg' ? 60 : 32;
  const box: React.CSSProperties = { width: w, height: h, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: tk.bg.field, boxShadow: `inset 0 0 0 1px ${alpha('#888888', 0.28)}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' };
  const fill: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
  if (it.kind === 'colour') return <span style={{ ...box, background: hexOf(it.colour ?? [0, 0, 0]) }} />;
  if (it.kind === 'image' && it.src) return <span style={box}><img src={it.src} alt="" style={fill} /></span>;
  if (it.kind === 'video' && it.src) return <span style={box}><video src={`${it.src}#t=0.1`} muted playsInline preload="metadata" style={fill} /></span>;
  if (it.kind === 'graph' && graph) return <span style={box}><img src={graph} alt="" style={fill} /></span>;
  const warn = it.kind === 'video' && playBackground.queueVideoMissing(it);
  return <span style={box}><Icon name={warn ? 'warning' : it.kind === 'script' && it.mode === '3d' ? 'cube' : KIND_ICON[it.kind]} size={size === 'lg' ? 20 : 15} style={{ color: warn ? tk.status.warning : tk.text.faint }} /></span>;
}

// ── The editor ───────────────────────────────────────────────────────────────

export function BackgroundEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const l = f.l as BackgroundLayer;
  const tk = f.tk;
  const showing = useShowing();
  useQueueTick();
  const [open, setOpen] = useState<string>('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [picker, setPicker] = useState<{ replace?: string } | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const addRef = useRef<HTMLSpanElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const fileFor = useRef<{ kind: 'image' | 'video'; replace?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const change = ctx.changePlay;
  const full = l.sources.length >= BACKGROUND_QUEUE_MAX;

  // Examples in the queue compile from a chunk that loads on first use.
  useEffect(() => { if (l.sources.some(s => s.kind === 'graph' && s.graph?.startsWith('example:'))) void preloadQueueExamples(); }, [l.sources]);

  const add = (items: BackgroundItem[]) => { if (!items.length) return; change(p => addSources(p, items)); setOpen(items[items.length - 1].id); };
  // A replacement keeps the source's place (and its id, so actions and takes still find it); the name follows the new file or graph.
  const replace = (id: string, item: BackgroundItem) => change(p => updateSource(p, id, { name: item.name, graph: item.graph, nodes: item.nodes, src: item.src, libraryId: item.libraryId, bytes: item.bytes, loop: item.loop, muted: item.muted, rate: item.rate }));
  /** An image background from the library: added to the queue, or in place of `replaceId`. */
  const fromLibrary = async (replaceId?: string) => {
    const item = await pickLibraryImage();
    if (!item) return;
    if (replaceId) replace(replaceId, item); else add([item]);
  };
  const pickFile = async (file: File) => {
    const want = fileFor.current;
    fileFor.current = null;
    if (!want) return;
    setBusy(true);
    try {
      const prev = want.replace ? l.sources.find(s => s.id === want.replace) : undefined;
      const item = want.kind === 'image' ? await imageSource(file) : await videoSource(file, prev);
      if (want.replace) replace(want.replace, item); else add([item]);
    } catch (e) { toast.error(`Couldn’t use that ${want.kind}`, { message: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  const askFile = (kind: 'image' | 'video', replaceId?: string) => { fileFor.current = { kind, replace: replaceId }; (kind === 'image' ? imageInput : videoInput).current?.click(); };
  const set = (id: string, patch: Partial<BackgroundItem>) => change(p => updateSource(p, id, patch));
  const goTo = (i: number) => ctx.act('goto', i + 1);

  const addItems: MenuItem[] = [
    { heading: 'Add to the queue' },
    { label: 'This graph', icon: 'graphs', hint: 'The graph open in the Studio', onSelect: () => add([thisGraphSource()]) },
    { label: 'Another graph…', icon: 'graphs', hint: 'One of your saved graphs, or an example', onSelect: () => setPicker({}) },
    { label: 'Sketch', icon: 'code', hint: 'JavaScript on a 2D canvas', onSelect: () => add([{ id: newSourceId(), kind: 'script', name: 'Sketch', code: DEFAULT_BACKGROUND_SKETCH }]) },
    { label: '3D sketch', icon: 'cube', hint: 'p5-style 3D on WebGL', onSelect: () => add([{ id: newSourceId(), kind: 'script', name: '3D sketch', code: DEFAULT_SCRIPT_3D, mode: '3d' }]) },
    { label: 'Image from your backgrounds…', icon: 'overlay', hint: 'Captured from a graph, or imported, in the Library', onSelect: () => { void fromLibrary(); } },
    { label: 'Image file…', icon: 'import', hint: 'PNG, JPG, WebP or SVG', onSelect: () => askFile('image') },
    { label: 'Video…', icon: 'play', hint: 'MP4, WebM or MOV', onSelect: () => askFile('video') },
    { label: 'Colour', icon: 'eye', hint: 'A flat colour', onSelect: () => add([{ id: newSourceId(), kind: 'colour', name: 'Colour', colour: [0.08, 0.08, 0.12] }]) },
  ];

  const rowMenu = (it: BackgroundItem, i: number): MenuItem[] => [
    { label: 'Show now', icon: 'play', hint: `Go to ${i + 1}`, onSelect: () => goTo(i) },
    { label: 'Rename', icon: 'edit', onSelect: () => setRenaming({ id: it.id, draft: it.name }) },
    { label: 'Duplicate', icon: 'copy', disabled: full, onSelect: () => change(p => duplicateSource(p, it.id)) },
    'separator',
    { label: 'Move up', icon: 'chevU', disabled: i === 0, onSelect: () => change(p => moveSource(p, it.id, i - 1)) },
    { label: 'Move down', icon: 'chevD', disabled: i === l.sources.length - 1, onSelect: () => change(p => moveSource(p, it.id, i + 1)) },
    'separator',
    { label: 'Remove', icon: 'trash', danger: true, onSelect: () => { change(p => removeSource(p, it.id)); if (open === it.id) setOpen(''); } },
  ];

  const commitRename = () => { if (renaming) change(p => renameSource(p, renaming.id, renaming.draft)); setRenaming(null); };

  return (
    <>
      <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void pickFile(file); else fileFor.current = null; }} />
      <input ref={videoInput} type="file" accept={VIDEO_ACCEPT} style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void pickFile(file); else fileFor.current = null; }} />
      <Section kind="background" title="Queue" hint="One source shows at a time, under every other layer. Only the one showing runs (and the one fading out during a crossfade): a graph that isn't showing costs nothing. Everything that reads the picture reads what shows.">
        <div role="list" aria-label="Background sources" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}
          onDragOver={e => { if (drag) e.preventDefault(); }}
          onDrop={e => { if (!drag) return; e.preventDefault(); const { id, over } = drag; setDrag(null); change(p => moveSource(p, id, over)); }}
        >
          {l.sources.length === 0 && (
            <div style={{ padding: '12px', borderRadius: radius.md, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
              Nothing in the queue: the background is its colour. Add this graph, another graph, a sketch, an image, a video or a colour.
            </div>
          )}
          {l.sources.map((it, i) => {
            const isOn = showing?.toId === it.id, isOut = showing?.fromId === it.id, expanded = open === it.id;
            const dropBefore = drag && drag.id !== it.id && drag.over === i;
            return (
              <div key={it.id} role="listitem">
                {dropBefore && <div style={{ height: 2, margin: '-3px 4px 1px', borderRadius: 1, background: tk.accent.base }} />}
                <div
                  onDragOver={e => {
                    if (!drag) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    const at = e.clientY < r.top + r.height / 2 ? i : i + 1;
                    // Where it lands once taken out of its old place.
                    const from = l.sources.findIndex(s => s.id === drag.id);
                    const over = at > from ? at - 1 : at;
                    if (over !== drag.over) setDrag({ ...drag, over });
                  }}
                  style={{
                    borderRadius: radius.md, background: expanded ? alpha(tk.accent.base, 0.05) : 'transparent',
                    boxShadow: `inset 0 0 0 1px ${expanded ? alpha(tk.accent.base, 0.45) : tk.border.subtle}`, opacity: drag?.id === it.id ? 0.45 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 4px', minHeight: 44 }}>
                    <span
                      draggable
                      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.name); setDrag({ id: it.id, over: i }); }}
                      onDragEnd={() => setDrag(null)}
                      title="Drag to reorder"
                      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1, width: 18, cursor: 'grab', color: tk.text.faint, flexShrink: 0 }}
                    >
                      <span style={{ font: `600 10px ${fontFamily.mono}`, color: isOn ? tk.accent.base : tk.text.faint }}>{i + 1}</span>
                      <Icon name="grip" size={12} />
                    </span>
                    <button type="button" onClick={() => setOpen(expanded ? '' : it.id)} aria-expanded={expanded} title={expanded ? 'Close its settings' : 'Its settings'}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 0, border: 0, padding: 0, background: 'none', cursor: 'pointer', textAlign: 'left', color: tk.text.primary }}>
                      <Thumb it={it} tk={tk} />
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {renaming?.id === it.id ? (
                          <Field autoFocus value={renaming.draft} height={24} aria-label="Source name"
                            onClick={e => e.stopPropagation()}
                            onChange={e => setRenaming({ id: it.id, draft: e.target.value })} onBlur={commitRename}
                            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }} />
                        ) : (
                          <span onDoubleClick={e => { e.stopPropagation(); setRenaming({ id: it.id, draft: it.name }); }} style={{ font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                        )}
                        <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{describe(it)}</span>
                      </span>
                    </button>
                    {(isOn || isOut) && (
                      <span style={{ flexShrink: 0, padding: '2px 7px', borderRadius: 999, font: `600 10.5px ${fontFamily.ui}`, color: isOn ? tk.accent.base : tk.text.muted, background: isOn ? alpha(tk.accent.base, 0.12) : tk.bg.field }}>{isOn ? 'Showing' : 'Fading out'}</span>
                    )}
                    {!isOn && !isOut && <IconButton icon="play" label={`Show now (Go to ${i + 1})`} size="sm" onClick={() => goTo(i)} />}
                    <IconButton icon="more" label="Rename, duplicate, move, remove" size="sm" tooltip={false} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.right - 200, y: r.bottom + 4, items: rowMenu(it, i) }); }} />
                  </div>
                  {expanded && <SourceSettings it={it} tk={tk} busy={busy} onSet={patch => set(it.id, patch)} onFile={kind => askFile(kind, it.id)} onLibrary={() => { void fromLibrary(it.id); }} onGraph={() => setPicker({ replace: it.id })} />}
                </div>
              </div>
            );
          })}
          {drag && drag.over === l.sources.length - 1 && l.sources[l.sources.length - 1]?.id !== drag.id && <div style={{ height: 2, margin: '0 4px', borderRadius: 1, background: tk.accent.base }} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span ref={addRef} style={{ display: 'inline-flex' }}>
            <Button size="sm" icon="plus" disabled={full || busy} onClick={() => { const r = addRef.current?.getBoundingClientRect(); if (r) setMenu({ x: r.left, y: r.bottom + 4, items: addItems }); }}>{busy ? 'Loading…' : 'Add source'}</Button>
          </span>
          <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{full ? `The queue holds ${BACKGROUND_QUEUE_MAX} at most.` : COARSE ? 'Reorder from a source’s ⋯ menu.' : 'Drag the grip to reorder.'}</span>
        </div>
      </Section>

      <Section kind="background" title="Change" hint="Index picks the source (0 is the first); make it a control and map anything onto it. Actions step through the queue from keys, beats, notes, clicks or hands: Next, Previous, Random, Go to.">
        {f.props('index', 'offset')}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 0 68px' }}>
          <Button size="sm" icon="chevL" disabled={l.sources.length < 2} onClick={() => ctx.act('prev')}>Previous</Button>
          <Button size="sm" icon="chevR" disabled={l.sources.length < 2} onClick={() => ctx.act('next')}>Next</Button>
          <Button size="sm" icon="dice" disabled={l.sources.length < 2} onClick={() => ctx.act('shuffle')}>Random</Button>
        </div>
        {f.seg('Transition', 'transition', [{ value: 'cut', label: 'Cut', title: 'The next source shows at once' }, { value: 'fade', label: 'Crossfade', title: 'The next source fades in over the old one' }], 'Cut switches at once. Crossfade blends the old source into the new over Fade (s); both run while it lasts.')}
        {l.transition === 'fade' && f.prop('duration')}
      </Section>

      <Section kind="background" title="Placement" hint="Where the background sits: move, scale and turn it. Images and videos fit the picture first (Fill crops, Fit inside shows the colour around them).">
        {f.select('Fit', 'fit', [{ value: 'cover', label: 'Fill (crop)' }, { value: 'contain', label: 'Fit inside' }, { value: 'stretch', label: 'Stretch' }], 'How an image or video meets the picture. Graphs and sketches always fill it.')}
        {f.props('x', 'y', 'scale', 'rotation')}
        {f.colour('Colour', 'colour', 'Under everything: around a fitted or scaled picture, and while a source loads.')}
      </Section>

      {menu && <Menu x={menu.x} y={menu.y} minWidth={200} items={menu.items} onClose={() => setMenu(null)} />}
      {picker && (
        <GraphSourcePicker
          anchorRef={addRef}
          title={picker.replace ? 'Show another graph' : 'Add a graph'}
          onClose={() => setPicker(null)}
          onPick={item => { if (picker.replace) replace(picker.replace, item); else add([item]); }}
        />
      )}
    </>
  );
}

// ── One source's settings ────────────────────────────────────────────────────

function SourceSettings({ it, tk, busy, onSet, onFile, onLibrary, onGraph }: {
  it: BackgroundItem;
  tk: Tokens;
  busy: boolean;
  onSet: (patch: Partial<BackgroundItem>) => void;
  onFile: (kind: 'image' | 'video') => void;
  onLibrary: () => void;
  onGraph: () => void;
}) {
  const row = (label: string, children: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
      <span style={{ width: 54, flexShrink: 0, color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
      {children}
    </div>
  );
  const note = (text: ReactNode, tone: 'faint' | 'warning' = 'faint') => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 8, color: tone === 'warning' ? tk.status.warningText : tk.text.muted, font: `11.5px/1.45 ${fontFamily.ui}` }}>
      <Icon name={tone === 'warning' ? 'warning' : 'info'} size={12} style={{ flexShrink: 0, marginTop: 2, color: tone === 'warning' ? tk.status.warning : tk.text.faint }} />
      <span style={{ minWidth: 0 }}>{text}</span>
    </div>
  );
  let body: ReactNode = null;
  switch (it.kind) {
    case 'graph': {
      const c = it.graph === 'this' ? null : compiledQueueGraph(it);
      const saved = it.graph?.startsWith('saved:') ? it.graph.slice(6) : null;
      const savedThere = !!saved && (() => { try { return localStorage.getItem(`shader-studio:${saved}`) !== null; } catch { return false; } })();
      body = (
        <>
          {row('Graph', (
            <>
              <Button size="sm" icon="graphs" onClick={onGraph}>Show another graph</Button>
              {saved && savedThere && <Button size="sm" variant="ghost" icon="reset" onClick={() => { try { const next = savedGraphSource(saved); onSet({ nodes: next.nodes }); toast.success(`Copied “${saved}” again`); } catch (e) { toast.error('Couldn’t copy it again', { message: e instanceof Error ? e.message : String(e) }); } }}>Copy again from saved</Button>}
            </>
          ))}
          {it.graph === 'this'
            ? note('The graph open in the Studio, with its controls and mappings. It runs only while it shows.')
            : c === 'loading' ? note('Loading the examples…')
              : c && 'error' in c ? note(`This graph doesn’t compile: ${c.error}`, 'warning')
                : note(<>Runs as a second shader with {saved ? 'its sliders as they were saved (a copy, kept in this setup' : 'its sliders as the example has them ('}{saved ? '; change the saved graph and copy it again to update)' : 'this setup’s controls don’t reach it)'}.{c && c.limits.length ? ` Here it runs without ${c.limits.join(', ')}.` : ''}</>)}
        </>
      );
      break;
    }
    case 'script': body = <ScriptSource it={it} tk={tk} onSet={onSet} note={note} />; break;
    case 'image':
      body = (
        <>
          {row('Image', (
            <>
              <Button size="sm" icon="overlay" disabled={busy} onClick={onLibrary}>From your backgrounds…</Button>
              <Button size="sm" variant="ghost" icon="import" disabled={busy} onClick={() => onFile('image')}>{busy ? 'Loading…' : 'Replace with a file'}</Button>
            </>
          ))}
          {it.libraryId && note('From the Library’s image backgrounds. A copy is kept in this setup, so it works when shared.')}
        </>
      );
      break;
    case 'video': {
      const missing = playBackground.queueVideoMissing(it);
      const el = !missing ? playBackground.queueVideo(it) : null;
      body = (
        <>
          {row('File', <Button size="sm" icon="import" disabled={busy} onClick={() => onFile('video')}>{busy ? 'Loading…' : missing ? 'Load it again' : 'Replace video'}</Button>)}
          {!missing && row('Plays', (
            <>
              <Toggle checked={it.loop !== false} onChange={loop => onSet({ loop })} label="Loop" />
              <Toggle checked={it.muted === false} onChange={on => onSet({ muted: !on })} label="Sound" />
              <Select ariaLabel="Speed" height={26} value={String(it.rate ?? 1)} options={BACKGROUND_RATES.map(r => ({ value: String(r), label: `${r}×` }))} onChange={v => onSet({ rate: Number(v) })} style={{ fontSize: 12 }} />
            </>
          ))}
          {missing && note(`“${it.name}” (${sizeText(it.bytes ?? 0)}) was too big to save. Load it again to use it.`, 'warning')}
          {!missing && !it.src && note(`Over ${sizeText(BACKGROUND_VIDEO_KEEP)}, so it plays until you reload: saves, play files and web pages leave it out. Trim or compress it to keep it.`, 'warning')}
          {el?.error && note('This browser can’t play that video. Try an MP4 (H.264) or a WebM.', 'warning')}
          {!missing && note('It follows the clock: pause the preview and it pauses; ↺ starts it over. Only the showing video plays.')}
        </>
      );
      break;
    }
    case 'colour':
      body = row('Colour', (
        <label title="Colour" style={{ position: 'relative', width: 44, height: 26, borderRadius: radius.md, background: hexOf(it.colour ?? [0, 0, 0]), boxShadow: `inset 0 0 0 1px ${alpha('#888888', 0.45)}`, cursor: 'pointer' }}>
          <input type="color" aria-label={`${it.name} colour`} value={hexOf(it.colour ?? [0, 0, 0])} onChange={e => onSet({ colour: fromHex(e.target.value) })} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
        </label>
      ));
      break;
  }
  return <div style={{ padding: '2px 10px 10px 30px' }}>{body}</div>;
}

/** A sketch source: its code, applied with the button or ⌘/Ctrl + Enter, 2D or 3D. */
function ScriptSource({ it, tk, onSet, note }: { it: BackgroundItem; tk: Tokens; onSet: (patch: Partial<BackgroundItem>) => void; note: (text: ReactNode, tone?: 'faint' | 'warning') => ReactNode }) {
  const [draft, setDraft] = useState(it.code ?? '');
  const [seen, setSeen] = useState(it.code ?? '');
  if ((it.code ?? '') !== seen) { setSeen(it.code ?? ''); setDraft(it.code ?? ''); }
  const [compileError, setCompileError] = useState<string | null>(null);
  const runError = useScriptStatus(`bg:${it.id}`);
  const dirty = draft !== (it.code ?? '');
  const apply = () => {
    // 3D sketches compile against three.js, which may not be loaded here: the kit reports those.
    const st = it.mode === '3d' ? null : klSketchCompile(draft);
    if (st?.error) { setCompileError(st.error); return; }
    setCompileError(null);
    onSet({ code: draft });
  };
  const error = compileError ?? runError;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <Segmented size="sm" ariaLabel="2D or 3D" value={it.mode === '3d' ? '3d' : '2d'} onChange={v => onSet({ mode: v === '3d' ? '3d' : undefined })} options={[{ value: '2d', label: '2D', title: 'A 2D canvas' }, { value: '3d', label: '3D', title: 'p5-style 3D on WebGL (three.js)' }]} />
        <span style={{ flex: 1 }} />
        <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} onClick={apply}>Apply</Button>
      </div>
      <textarea
        aria-label={`${it.name} code`} spellCheck={false} value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); apply(); } }}
        rows={10}
        style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '8px 10px', borderRadius: radius.md, border: `1px solid ${error ? tk.status.warning : tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `12px/1.5 ${fontFamily.mono}`, resize: 'vertical', tabSize: 2 }}
      />
      {error ? note(error, 'warning') : note(<>A sketch in the background: <code>draw(s)</code> paints the whole picture each frame (<code>s.ctx</code>, <code>s.width</code>, <code>s.height</code>, <code>s.time</code>, <code>s.mouse</code>). It runs only while it shows. ⌘/Ctrl + Enter applies.</>)}
    </>
  );
}
