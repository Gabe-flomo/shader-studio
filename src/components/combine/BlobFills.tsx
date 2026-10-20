/**
 * BlobFills — Replace mask's fills in the Combine window (docs/combine.md "Per blob", docs/combine-plan.md §3.4):
 *
 *   FILL     [ One for all ][ Per blob ]
 *   ATTACH   [ By order ][ By ID ]          2 seen now · #1 #2
 *   ● #1  ▣ Rings (2D)          +0   ◐  ›
 *   ● #2  ▤ Room and cat              ◐  ›
 *   ○ Rest  the picture                  ›
 *   + Fill another blob
 *
 * Each row is folded to one line (its blob, its product, what it costs); unfolded: which blob, its own Fit and Fill
 * scale, Edit in its builder, Remove. The product well opens a menu of what can fill: the graph's products, the
 * built-in photos and video, or New in a builder (its Done comes back to this fill). The viewport rings the blobs seen
 * now (BlobRings), each with its fill's colour and name; hovering a row rings its blob, clicking a blob opens its row
 * (or gives a blob without one its own fill).
 */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Menu, type MenuItem } from '../ui/Menu';
import { Segmented } from '../ui/Choice';
import { NumRow } from '../sceneBuilder/controls';
import { MuteToggle, MUTED_DIM } from '../builders/MuteToggle';
import type { ViewRect } from '../builders/studio/LiveViewport';
import { passBudget, HARD_MAX_PASSES } from '../../compiler/passBudget';
import { blobEngine } from '../../lib/blobs/engine';
import type { Track } from '../../lib/blobs/track';
import { useCombine } from '../../combine/store';
import { addProductNode, editLayerProduct, newFillIn, updateLayer } from '../../combine/actions';
import { findCombineBuild } from '../../combine/meta';
import { graphProducts, productNodeIds, resolveProduct, isSplat } from '../../combine/products';
import { MAX_FILLS, addFill, fillIdOf, fillName, isPerBlob, nextFillKey, removeFill, setAttachBy, setFillKey, toOneForAll, toPerBlob, updateFill, withFillIds } from '../../combine/fills';
import { MASK_DEFAULTS, REPLACE_DEFAULTS, num, settingsOf, targetOf, type CombineLayer, type FillEntry, type FillSpec, type ProductKind, type ProductRef } from '../../combine/spec';
import type { SceneKind } from '../../builders/sceneKinds';
import { builtinImageParams, ROOM_AND_CAT_ID, WALKWAY_CAT_ID } from '../../lib/builtinImages';
import { BALL_VIDEO } from '../../lib/builtinVideos';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';

const KIND_ICON: Record<ProductKind, IconName> = { picture: 'image', pictureDepth: 'image', scene3d: 'cube', points: 'swarm', mask: 'mask', motion: 'motion' };

/** Each fill's colour (its ring in the viewport, its dot in the list), by its place in the list. */
const FILL_HUES = [200, 320, 45, 140, 265, 15, 175, 95];
const fillColour = (i: number) => `hsl(${FILL_HUES[i % FILL_HUES.length]} 85% 62%)`;

/** The row hovered (its blob ringed) and the row unfolded, shared by the list and the viewport's rings. */
const useFillFocus = create<{ hover: string | null; open: string | null }>(() => ({ hover: null, open: null }));

/** Change a layer's fills (one step of Combine's undo). Entries without an id (an older spec) get theirs first. */
const setFills = (layerId: string, fn: (f: FillSpec, l: CombineLayer) => FillSpec | undefined | null) =>
  updateLayer(layerId, l => { const next = fn(withFillIds(l.fills ?? { mode: 'all', by: 'order', blobs: [] }), l); if (next !== null) { if (next) l.fills = next; else delete l.fills; } });

/** Unfold the layer's last fill (just added). */
const openLast = (layerId: string) => {
  const last = useCombine.getState().spec.layers.find(l => l.id === layerId)?.fills?.blobs.at(-1)?.id;
  if (last) useFillFocus.setState({ open: last });
};

// ── The live blobs ───────────────────────────────────────────────────────────

/** The Blob Track a fill layer reads: the one it built (`<L>:blobs`), or the mask's own Blob Track node. */
function blobTrackOf(layer: CombineLayer): string | null {
  const c = useCombine.getState();
  const nodes = useNodeGraphStore.getState().nodes;
  const own = c.anchorId ? findCombineBuild(nodes, c.anchorId)?.byRole.get(`${layer.id}:blobs`) : undefined;
  if (own) return own.id;
  const t = targetOf(c.spec, layer);
  if (t?.product.kind === 'node') {
    const n = nodes.find(x => x.id === (t.product as { nodeId: string }).nodeId);
    if (n?.type === 'blobTrack') return n.id;
  }
  return null;
}

/** The blobs the layer's Blob Track sees now, oldest first: polled a few times a second while shown (they move). */
function useLiveBlobs(layer: CombineLayer | null, every = 250): readonly Track[] {
  const anchor = useCombine(s => s.anchorId);
  const [blobs, setBlobs] = useState<readonly Track[]>([]);
  useEffect(() => {
    if (!layer) return;
    const read = () => { const id = blobTrackOf(layer); setBlobs(id ? [...blobEngine.blobs(id)] : []); };
    read();
    const off = blobEngine.onChange(read);
    const timer = window.setInterval(read, every);
    return () => { off(); window.clearInterval(timer); };
  }, [layer?.id, anchor, every]); // eslint-disable-line react-hooks/exhaustive-deps
  return layer ? blobs : NONE;
}

const NONE: readonly Track[] = [];

/** The fill (if any) on a live blob: by order its slot, by ID its tracked ID. */
const keyOfBlob = (by: FillSpec['by'], t: Track, slot: number) => (by === 'id' ? t.id : slot);

// ── One for all / Per blob ───────────────────────────────────────────────────

/** The Fill choice: One for all (the layer's product on every blob) or Per blob (the list below). */
export function FillModeChoice({ layer }: { layer: CombineLayer }) {
  const per = isPerBlob(layer);
  return (
    <div data-fill-mode={per ? 'perBlob' : 'all'}>
      <Segmented size="sm" fill ariaLabel="Fill" value={per ? 'perBlob' : 'all'} onChange={v => setFills(layer.id, (_f, l) => (v === 'perBlob' ? toPerBlob(l) : toOneForAll(l)))}
        options={[
          { value: 'all', label: <span data-fill="all">One for all</span>, sub: 'same on every blob' },
          { value: 'perBlob', label: <span data-fill="perBlob">Per blob</span>, sub: 'each its own' },
        ]} />
    </div>
  );
}

/** Per blob: Attach by, the fills (folded rows), the rest, and what they cost. */
export function PerBlobFills({ layer }: { layer: CombineLayer }) {
  const tk = useTokens();
  const f = withFillIds(layer.fills!);
  const by = f.by;
  const live = useLiveBlobs(layer);
  const nodes = useNodeGraphStore(s => s.nodes);
  const budget = useMemo(() => passBudget(nodes), [nodes]);
  const target = useCombine(s => targetOf(s.spec, layer));
  const maxBlobs = Math.round(num(target ? settingsOf(target, MASK_DEFAULTS).maxBlobs : 4, 4));
  const costOf = (p: ProductRef) => {
    const ids = productNodeIds(p, nodes);
    return budget.items.filter(it => ids.has(it.topId)).reduce((s, it) => s + it.cost, 0);
  };
  const seenKeys = new Set(live.map((t, i) => keyOfBlob(by, t, i)));
  const fillPasses = [...f.blobs.map(b => b.fill), ...(f.rest ? [f.rest] : [])].reduce((s, p) => s + costOf(p), 0);
  const marches = [...f.blobs.filter(b => !b.muted).map(b => b.fill), ...(f.rest ? [f.rest] : [])].filter(p => resolveProduct(p, nodes).kind === 'scene3d').length;
  const locked = budget.used >= HARD_MAX_PASSES, grace = budget.used > budget.max;
  return (
    <div data-per-blob style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: tk.text.muted, flexShrink: 0 }}>Attach by</span>
        <div data-attach-by={by} style={{ flex: 1 }}>
          <Segmented size="sm" fill ariaLabel="Attach by" value={by} onChange={v => setFills(layer.id, x => setAttachBy(x, v))}
            options={[
              { value: 'order', label: <span data-attach="order" title="Fill #1 on the first blob seen now (the oldest), #2 on the next… When one goes, the next takes its fill">Order</span> },
              { value: 'id', label: <span data-attach="id" title="Each fill on a tracked ID: the blob keeps it until it is lost, and a new blob gets the rest">ID</span> },
            ]} />
        </div>
      </span>
      {/* One line, whatever is seen: blobs come and go every frame on a video, and the rows below mustn't jump. */}
      <span data-blobs-seen={live.length} title={live.length ? undefined : 'Play the picture, or check that the mask finds something'}
        style={{ fontSize: 11.5, color: tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {live.length ? `Seen now: ${live.map((t, i) => fillName(by, keyOfBlob(by, t, i))).join(' · ')}` : 'None seen now'}
        {by === 'order' ? ' · #1 is the oldest' : ' · a fill keeps its ID'}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {f.blobs.map((e, i) => (
          <FillRow key={fillIdOf(e, i)} layer={layer} entry={e} index={i} by={by} seen={seenKeys.has(e.key)} cost={costOf(e.fill)} maxBlobs={maxBlobs} live={live} />
        ))}
        <RestRow layer={layer} cost={f.rest ? costOf(f.rest) : 0} />
      </div>
      <Button size="sm" variant="ghost" icon="plus" data-add-fill disabled={f.blobs.length >= MAX_FILLS}
        title={f.blobs.length >= MAX_FILLS ? `At most ${MAX_FILLS} fills on one layer` : `A fill on ${fillName(by, nextFillKey(f))}`}
        onClick={() => { setFills(layer.id, x => addFill(x, x.rest ?? layer.product)); openLast(layer.id); }}>
        Fill another blob
      </Button>
      <span data-fill-cost style={{ fontSize: 11.5, color: locked || grace ? tk.status.warningText : tk.text.muted }}>
        {fillPasses ? `The fills use ${fillPasses} pass${fillPasses === 1 ? '' : 'es'}` : 'The fills add no pass'}
        {marches ? ` · ${marches} 3D march${marches === 1 ? '' : 'es'} (each where its blob is)` : ''}
        {` · Passes ${budget.used}/${budget.max}`}
        {locked ? ': locked, a fill that needs a pass can\'t be added' : grace ? ': lower quality (grace)' : ''}
      </span>
    </div>
  );
}

/** A product's name and kind icon, for a row's well. */
function ProductWell({ product, none, onPick, attrs }: { product: ProductRef | undefined; none?: string; onPick: (r: DOMRect) => void; attrs?: Record<string, string> }) {
  const tk = useTokens();
  const nodes = useNodeGraphStore(s => s.nodes);
  const r = useMemo(() => (product ? resolveProduct(product, nodes) : null), [product, nodes]);
  return (
    <button type="button" {...attrs} onClick={e => { e.stopPropagation(); onPick((e.currentTarget as HTMLElement).getBoundingClientRect()); }}
      title={r?.missing ?? 'Pick what fills it'}
      style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left',
        font: `600 12px ${fontFamily.ui}`, background: tk.bg.field, color: r?.missing ? tk.status.warningText : r ? tk.text.primary : tk.text.muted, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
      <Icon name={r ? (r.missing ? 'warning' : KIND_ICON[r.kind]) : 'image'} size={13} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r ? (r.missing ? 'Missing: pick another' : r.label) : none}</span>
      <Icon name="chevD" size={11} style={{ marginLeft: 'auto', flexShrink: 0, opacity: 0.6 }} />
    </button>
  );
}

function CostTag({ cost, threeD }: { cost: number; threeD: boolean }) {
  const tk = useTokens();
  if (!cost && !threeD) return null;
  return (
    <span data-fill-passes={cost} title={`${cost ? `Its product uses ${cost} pass${cost === 1 ? '' : 'es'}. ` : ''}${threeD ? 'A 3D scene marches where its blob is.' : ''}`}
      style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 5px', borderRadius: 5, flexShrink: 0, background: alpha(tk.status.warning, 0.16), color: tk.status.warningText }}>
      {cost ? `+${cost}` : ''}{cost && threeD ? ' · ' : ''}{threeD ? '3D' : ''}
    </span>
  );
}

function FillRow({ layer, entry, index, by, seen, cost, maxBlobs, live }: {
  layer: CombineLayer; entry: FillEntry; index: number; by: FillSpec['by']; seen: boolean; cost: number; maxBlobs: number; live: readonly Track[];
}) {
  const tk = useTokens();
  const id = fillIdOf(entry, index);
  const open = useFillFocus(s => s.open === id);
  const hover = useFillFocus(s => s.hover === id);
  const kind = useNodeGraphStore(s => resolveProduct(entry.fill, s.nodes).kind);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const R = settingsOf(layer, REPLACE_DEFAULTS);
  const name = fillName(by, entry.key);
  // The blobs this fill can go on: by order the slots up to Most blobs; by ID the ones seen now and its own.
  const keys = by === 'order'
    ? Array.from({ length: Math.max(maxBlobs, entry.key + 1) }, (_, k) => k)
    : [...new Set([entry.key, ...live.map(t => t.id)])].sort((a, b) => a - b);
  return (
    <div data-fill-row={id} data-fill-key={entry.key} data-open={open || undefined}
      onMouseEnter={() => useFillFocus.setState({ hover: id })} onMouseLeave={() => useFillFocus.setState(s => (s.hover === id ? { hover: null } : s))}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 6, borderRadius: radius.md, background: open || hover ? tk.bg.hover : 'transparent', boxShadow: open ? `inset 0 0 0 1px ${tk.border.default}` : undefined }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, ...(entry.muted ? MUTED_DIM : {}) }}>
        <span title={seen ? `${name} is seen now` : `${name} isn't seen now: its fill shows when it is`}
          style={{ width: 50, flexShrink: 0, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4, font: `700 11.5px ${fontFamily.ui}`, color: seen ? tk.text.primary : tk.text.faint }}>
          <span style={{ width: 9, height: 9, borderRadius: 5, flexShrink: 0, background: seen ? fillColour(index) : 'transparent', boxShadow: `inset 0 0 0 1.5px ${fillColour(index)}` }} />{name}
        </span>
        <ProductWell product={entry.fill} onPick={r => setMenu(r)} attrs={{ 'data-fill-well': id }} />
        <CostTag cost={cost} threeD={kind === 'scene3d'} />
        <MuteToggle muted={!!entry.muted} what={`fill ${name}`} onToggle={() => setFills(layer.id, f => updateFill(f, id, { muted: !entry.muted }))} />
        <IconButton icon={open ? 'chevD' : 'chevR'} size="sm" label={open ? 'Fold' : `Settings of fill ${name}`} onClick={() => useFillFocus.setState({ open: open ? null : id })} />
      </span>
      {!open && (entry.fit || entry.scale !== undefined) && <span style={{ paddingLeft: 56, fontSize: 11, color: tk.text.muted }}>{[entry.fit, entry.scale !== undefined ? `scale ${entry.scale}` : ''].filter(Boolean).join(' · ')}</span>}
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11.5, color: tk.text.muted }}>
          On
          {keys.map(k => (
            <button key={k} type="button" data-fill-blob={k} aria-pressed={k === entry.key} onClick={() => setFills(layer.id, f => setFillKey(f, id, k))}
              style={{ border: 0, borderRadius: 999, padding: '2px 8px', cursor: 'pointer', font: `600 11px ${fontFamily.ui}`,
                background: k === entry.key ? alpha(tk.accent.base, 0.16) : tk.bg.field, color: k === entry.key ? tk.accent.text : tk.text.secondary }}>{fillName(by, k)}</button>
          ))}
        </span>
        <Segmented size="sm" fill ariaLabel="Fit" value={entry.fit ?? 'same'} onChange={v => setFills(layer.id, f => updateFill(f, id, { fit: v === 'same' ? undefined : v }))}
          options={[{ value: 'same', label: 'As all', sub: String(R.fit) }, { value: 'box', label: 'Box' }, { value: 'square', label: 'Square' }, { value: 'circle', label: 'Circle' }]} />
        <NumRow label="Fill scale" value={num(entry.scale, num(R.scale, 1))} min={0.1} max={4} defaultValue={num(R.scale, 1)} rangeKey="combine:scale"
          onChange={v => setFills(layer.id, f => updateFill(f, id, { scale: v }))}
          lazyParam={fillPlayParam(`${layer.id}:fill:${id}:space`, 'scale')} />
        <span style={{ display: 'flex', gap: 6 }}>
          {entry.fill.kind === 'build' && <Button size="sm" variant="ghost" icon="edit" onClick={() => editLayerProduct(layer.id, entry.fill)}>Edit in its builder</Button>}
          <Button size="sm" variant="ghost" icon="trash" data-remove-fill={id} onClick={() => setFills(layer.id, f => removeFill(f, id))}>Remove</Button>
        </span>
      </div>}
      {menu && <FillMenu at={menu} layer={layer} slot={id} onClose={() => setMenu(null)} onPick={p => { if (p) setFills(layer.id, f => updateFill(f, id, { fill: p })); }} />}
    </div>
  );
}

function RestRow({ layer, cost }: { layer: CombineLayer; cost: number }) {
  const tk = useTokens();
  const f = layer.fills!;
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const kind = useNodeGraphStore(s => (f.rest ? resolveProduct(f.rest, s.nodes).kind : null));
  return (
    <div data-fill-row="rest" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 6 }}>
      <span title="Every blob without a fill of its own" style={{ width: 50, flexShrink: 0, font: `700 11.5px ${fontFamily.ui}`, color: tk.text.secondary }}>Rest</span>
      <ProductWell product={f.rest} none="The picture (as it is)" onPick={r => setMenu(r)} attrs={{ 'data-fill-well': 'rest' }} />
      <CostTag cost={cost} threeD={kind === 'scene3d'} />
      {menu && <FillMenu at={menu} layer={layer} slot="rest" onClose={() => setMenu(null)} onPick={p => setFills(layer.id, x => ({ ...x, rest: p ?? undefined }))} allowNone />}
    </div>
  );
}

/** A per-blob fill's Blob Space param, for the slider's right-click Add to Play (after Done, as the window's others). */
function fillPlayParam(role: string, key: string): () => { nodeId: string; key: string } | { missing: string } {
  return () => {
    const c = useCombine.getState();
    const node = c.anchorId ? findCombineBuild(useNodeGraphStore.getState().nodes, c.anchorId)?.byRole.get(role) : undefined;
    if (!node) return { missing: 'Not built yet: this fill is off.' };
    return { nodeId: node.id, key };
  };
}

// ── What can fill ────────────────────────────────────────────────────────────

const NEW_FILL_KINDS: Array<{ kind: SceneKind; label: string }> = [
  { kind: '2d', label: '2D scene' }, { kind: '3d', label: '3D scene' }, { kind: 'agents', label: 'Agent scene' },
  { kind: 'grid', label: 'Grid scene' }, { kind: 'timecube', label: 'Time Cube' }, { kind: 'warp', label: 'Warp' },
];

function plainNode(type: string, id: string, params: Record<string, unknown>): GraphNode {
  const def = getNodeDefinition(type)!;
  return {
    id, type, position: { x: 0, y: 0 },
    inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label }])),
    outputs: Object.fromEntries(Object.entries(def.outputs).map(([k, s]) => [k, { type: s.type, label: s.label }])),
    params: { ...(def.defaultParams ?? {}), ...params },
  };
}

/** A built-in photo or video, added beside the products: its ref. */
function addBuiltin(which: 'room' | 'walkway' | 'ball'): ProductRef {
  const id = useNodeGraphStore.getState().newNodeId();
  const video = which === 'ball';
  const params = video
    ? { videoId: BALL_VIDEO.id, _fileName: BALL_VIDEO.name, _hasFile: true, _isPlaying: true, _loop: true, _speed: 1 }
    : { fit: 'cover', ...builtinImageParams(which === 'room' ? ROOM_AND_CAT_ID : WALKWAY_CAT_ID) };
  addProductNode(plainNode(video ? 'videoInput' : 'textureInput', id, { ...params, __comment: `${video ? 'Video' : 'Texture'}: a fill Combine put on a blob. Pick your own on this card.` }));
  return { kind: 'node', nodeId: id, output: 'color' };
}

/** The fill well's menu: the graph's pictures, 3D scenes and points; the built-in photos; New in a builder. */
function FillMenu({ at, layer, slot, onPick, onClose, allowNone = false }: {
  at: DOMRect; layer: CombineLayer; slot: string; onPick: (p: ProductRef | null) => void; onClose: () => void; allowNone?: boolean;
}) {
  const nodes = useNodeGraphStore.getState().nodes;
  const spec = useCombine.getState().spec;
  // What can fill: not a mask, not splats (they don't draw in a box), not a layer of this stack's own pictures below.
  const products = graphProducts(nodes).filter(p => p.kind !== 'mask' && p.kind !== 'motion' && !isSplat(p.ref) && !spec.layers.some(l => l.verb === 'base' && JSON.stringify(l.product) === JSON.stringify(p.ref)));
  const items: MenuItem[] = [];
  if (allowNone) items.push({ label: 'The picture (as it is)', icon: 'image', hint: 'Blobs without a fill of their own stay as they are', onSelect: () => onPick(null) }, 'separator');
  if (products.length) {
    items.push({ heading: 'From this graph' });
    for (const p of products) items.push({ label: p.label, icon: KIND_ICON[p.kind], hint: p.detail, onSelect: () => onPick(p.ref) });
  }
  items.push({ heading: 'A photo or video' },
    { label: 'Room and cat', icon: 'image', onSelect: () => onPick(addBuiltin('room')) },
    { label: 'Walkway cat', icon: 'image', onSelect: () => onPick(addBuiltin('walkway')) },
    { label: 'Ball action', icon: 'film', onSelect: () => onPick(addBuiltin('ball')) },
    { heading: 'New, in its builder' },
    ...NEW_FILL_KINDS.map(k => ({ label: k.label, icon: (k.kind === '3d' ? 'cube' : k.kind === 'agents' ? 'swarm' : 'layers') as IconName, hint: 'Its Done comes back to this fill', onSelect: () => newFillIn(k.kind, layer.id, slot) })));
  return <Menu x={at.left} y={at.bottom + 4} items={items} onClose={onClose} minWidth={220} title="Fill with" />;
}

// ── The viewport's rings ─────────────────────────────────────────────────────

/**
 * Over the viewport, while a per-blob fill layer is selected: a ring round every blob seen now, in its fill's colour,
 * named (#1 / ID 3) with what fills it. The hovered row's blob is ringed brighter. Clicking a blob opens its fill's row,
 * or gives a blob without one its own fill (a copy of the rest's, or the layer's product).
 */
export function BlobRings({ image }: { image: ViewRect }) {
  const selected = useCombine(s => s.selected);
  const layer = useCombine(s => s.spec.layers.find(l => l.id === selected) ?? null);
  const per = !!layer && layer.verb === 'replaceMask' && layer.product.kind !== 'mask' && isPerBlob(layer);
  const live = useLiveBlobs(per ? layer : null, 100);
  const hover = useFillFocus(s => s.hover);
  const nodes = useNodeGraphStore(s => s.nodes);
  if (!per || !layer?.fills || !live.length) return null;
  const f = withFillIds(layer.fills);
  return (
    <div data-blob-rings style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
      {live.map((t, slot) => {
        const key = keyOfBlob(f.by, t, slot);
        const i = f.blobs.findIndex(b => b.key === key);
        const e = i >= 0 ? f.blobs[i] : null;
        const fid = e ? fillIdOf(e, i) : null;
        const on = !!fid && hover === fid;
        const colour = e ? fillColour(i) : 'rgba(255,255,255,0.7)';
        // Blob data is in picture coordinates, y up.
        const left = image.x + t.x0 * image.w, top = image.y + (1 - t.y1) * image.h;
        const w = (t.x1 - t.x0) * image.w, h = (t.y1 - t.y0) * image.h;
        const what = e ? resolveProduct(e.fill, nodes).label : f.rest ? `rest: ${resolveProduct(f.rest, nodes).label}` : 'the picture';
        return (
          <button key={t.id} type="button" data-blob-ring={key} data-blob-fill={fid ?? 'rest'}
            title={e ? `${fillName(f.by, key)}: ${what}. Click for its settings` : `${fillName(f.by, key)}: no fill of its own (${what}). Click to give it one`}
            onClick={() => {
              if (fid) { useFillFocus.setState({ open: fid }); return; }
              setFills(layer.id, x => { const added = addFill(x, x.rest ?? layer.product); return added ? setFillKey(added, added.blobs[added.blobs.length - 1].id!, key) : x; });
              openLast(layer.id);
            }}
            onMouseEnter={() => fid && useFillFocus.setState({ hover: fid })} onMouseLeave={() => useFillFocus.setState(s => (s.hover === fid ? { hover: null } : s))}
            style={{ position: 'absolute', left, top, width: w, height: h, padding: 0, background: on ? 'rgba(255,255,255,0.08)' : 'transparent', cursor: 'pointer', pointerEvents: 'auto',
              border: `${on ? 3 : 2}px ${e ? 'solid' : 'dashed'} ${colour}`, borderRadius: 8, boxShadow: on ? `0 0 0 3px rgba(0,0,0,0.35), 0 0 18px ${colour}` : '0 0 0 1px rgba(0,0,0,0.35)' }}>
            <span style={{ position: 'absolute', left: -2, top: top - image.y < 24 ? 2 : -22, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap',
              background: 'rgba(0,0,0,0.7)', color: '#fff', font: `600 11px ${fontFamily.ui}` }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: colour }} />{fillName(f.by, key)} · {what}
            </span>
          </button>
        );
      })}
    </div>
  );
}
