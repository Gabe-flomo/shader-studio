/**
 * CombineWindow — the Scene builder's Combine (docs/combine.md, docs/combine-plan.md §3), on the shared builder shell:
 *
 *   ┌ Scene builder › Combine ─────────────── 2 layers · Passes 1/8 ─ Done ┐
 *   │ LAYERS          │                              │ PHOTO → 3D SCENE   │
 *   │ ▣ Photo · card  │        live viewport         │ How [card][world]… │
 *   │ ▤ 3D (base)     │                              │ Card: x y z size   │
 *   │ + Add a layer   │                              │                    │
 *   ├─────────────────┴──────────────────────────────┴────────────────────┤
 *   │ Presets: Photo in a room · Cat → rings · …                          │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * The layer stack is bottom-up (the base at the bottom). Clicking a layer shows the stack up to it alone; again (or
 * Esc), the whole stack. "+ Add a layer" asks what (from this graph, a photo, a mask, or a new build in its builder)
 * and then how (only the verbs that join the pair). The settings are the selected layer's verb, the primary section
 * open and the rest folded with a summary. A number that goes into a socket has ƒ beside it: written as a one-line
 * expression instead (a Simple Expression in the graph), with Make a slider on its numbers (XSlider). Off on a phone
 * (docs/combine-plan.md [D9]).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Menu } from '../ui/Menu';
import { usePhoneDialog } from '../ui/phoneDialog';
import { StudioShell, StudioLabel, StripRow } from '../builders/studio/StudioShell';
import { LiveViewport } from '../builders/studio/LiveViewport';
import { usePictureAspect } from '../builders/studio/usePictureAspect';
import { SceneCrumb } from '../builders/SceneCrumb';
import { NumRow } from '../sceneBuilder/controls';
import { BuilderNote } from '../builders/BuilderWindow';
import { MuteToggle, MutedTag, MUTED_DIM } from '../builders/MuteToggle';
import { DepthGenerateRow } from '../builders/DepthGenerateRow';
import { PictureWays } from '../builders/TexturePicker';
import { useSectionOpen } from '../../builders/sectionFold';
import { sceneDraftBase } from '../../builders/sceneDraft';
import { passBudget } from '../../compiler/passBudget';
import { useCombine } from '../../combine/store';
import {
  addLayer, addProductNode, answerEdits, closeCombine, deleteLayer, editLayerProduct, finishCombine, isolateLayer, newProductIn, redoCombine,
  setLayerSetting, syncCombine, toggleLayerMute, undoCombine, updateLayer,
} from '../../combine/actions';
import { applyCombinePreset } from '../../combine/presetActions';
import { COMBINE_PRESETS } from '../../combine/presets';
import { graphProducts, isSplat, productKind, resolveProduct, sameProduct, targetInfo, type GraphProduct } from '../../combine/products';
import { findCombineBuild } from '../../combine/meta';
import { innerGlue } from '../../combine/apply';
import { FREE_NAMES, checkExpr, exprTargets, type ExprName } from '../../combine/exprs';
import {
  COLLIDE_DEFAULTS, FOLLOW_DEFAULTS, MASK_DEFAULTS, PLACE_DEFAULTS, PRODUCT_LABEL, REPLACE_DEFAULTS, VERBS, num, offeredVerbs, resultKind, settingsOf, targetOf, verbLine,
  type CombineLayer, type CombineSpec, type MaskFind, type ProductKind, type ProductRef, type VerbId,
} from '../../combine/spec';
import { ExprLineInput } from '../builders/ExprLineInput';
import { MakeSliderButton } from '../code/MakeSlider';
import { literalAt, literalToSlider, type LiteralSpan } from '../../lib/glslPatterns/literalSlider';
import type { SceneKind } from '../../builders/sceneKinds';
import { builtinImageParams, ROOM_AND_CAT_ID, WALKWAY_CAT_ID } from '../../lib/builtinImages';
import { BALL_VIDEO } from '../../lib/builtinVideos';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { SEGMENT_CLASSES } from '../../nodes/definitions/segment';
import { fillSummary, isPerBlob } from '../../combine/fills';
import { BlobRings, FillModeChoice, PerBlobFills } from './BlobFills';

const KIND_ICON: Record<ProductKind, IconName> = { picture: 'image', pictureDepth: 'image', scene3d: 'cube', points: 'swarm', mask: 'mask', motion: 'motion' };

/** The product kinds as the stack sees them (a mask product is a mask, a build by its kind). */
function useKindOf() {
  const nodes = useNodeGraphStore(s => s.nodes);
  return useMemo(() => (p: ProductRef) => productKind(p, nodes), [nodes]);
}

export function CombineWindow() {
  const tk = useTokens();
  const phone = usePhoneDialog();
  const spec = useCombine(s => s.spec);
  const picker = useCombine(s => s.picker);
  const isolate = useCombine(s => s.isolate);
  const edits = useCombine(s => s.edits);
  const canUndo = useCombine(s => s.past.length > 0);
  const canRedo = useCombine(s => s.future.length > 0);
  const budget = useNodeGraphStore(s => passBudget(s.nodes));
  // The base's shape (a photo's, a video's): the picture is drawn at it, letterboxed, not stretched to the window.
  const base = spec.layers[0]?.product;
  const aspect = usePictureAspect(base?.kind === 'node' ? base.nodeId : null);
  const n = spec.layers.length;
  const over = budget.used > budget.max, warn = budget.used >= budget.max - 1;
  const passes = <span data-combine-passes={over ? 'over' : warn ? 'warn' : 'ok'} style={{ color: over ? tk.status.danger : warn ? tk.status.warningText : undefined }}>Passes {budget.used}/{budget.max}</span>;
  if (phone) {
    // Combine is off on a phone ([D9]); a graph it made opens as plain nodes.
    return (
      <StudioShell prefsKey="combine" icon="layers" title="Combine" onClose={closeCombine}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: tk.text.muted, textAlign: 'center' }}>Combine is on the desktop: on a phone its graph opens as nodes.</div>
      </StudioShell>
    );
  }
  return (
    <StudioShell prefsKey="combine" icon="layers" title={n ? 'Your combined scene' : 'Combine'} crumb={<SceneCrumb kind="combine" />}
      kind={<>{n} layer{n === 1 ? '' : 's'} · {passes}</>}
      onClose={closeCombine}
      onEscape={() => {
        if (useCombine.getState().picker) { useCombine.getState().setPicker(null); return true; }
        if (useCombine.getState().isolate) { isolateLayer(null); return true; }
        return false;
      }}
      actions={<>
        <IconButton icon="undo" size="sm" label="Undo" disabled={!canUndo} onClick={undoCombine} />
        <IconButton icon="redo" size="sm" label="Redo" disabled={!canRedo} onClick={redoCombine} />
      </>}
      primary={{ label: 'Done', onClick: finishCombine, title: 'Put the combined scene in the graph (one undo step), then close and show it' }}
      nav={<LayerStack />} navWidth={256}
      inspector={<LayerSettings />} inspectorWidth={340}
      presets={<PresetsStrip />} presetsSummary={`${COMBINE_PRESETS.length} built in: ${COMBINE_PRESETS.map(p => p.label).join(' · ')}`}>
      <LiveViewport ownSize aspect={aspect} clock emptyNote="The preview is hidden: show it to see the combined scene here."
        overlay={({ image }) => <>{!isolate && <BlobRings image={image} />}{isolate ? (
          <button type="button" data-combine-isolated onClick={() => isolateLayer(null)} title="Show the whole stack (Esc)"
            style={{ position: 'absolute', left: 10, top: 10, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: 0, borderRadius: 999, cursor: 'pointer', background: 'rgba(0, 0, 0, 0.6)', color: '#fff', font: `600 11.5px ${fontFamily.ui}` }}>
            <Icon name="eye" size={13} />Up to {layerName(spec, isolate)} · show all
          </button>
        ) : null}</>} />
      {edits && <EditsBanner edits={edits} />}
      {picker && <AddLayer />}
    </StudioShell>
  );
}

/** "a 3D scene", "a picture": lower case, but not the D of 3D. */
const lower = (s: string) => s.charAt(0) === '3' ? s : s.toLowerCase();

const layerName = (spec: CombineSpec, id: string) => {
  const l = spec.layers.find(x => x.id === id);
  return l ? `layer ${spec.layers.indexOf(l) + 1}` : id;
};

// ── The stack ────────────────────────────────────────────────────────────────

function LayerStack() {
  const tk = useTokens();
  const spec = useCombine(s => s.spec);
  const top = spec.layers[spec.layers.length - 1];
  return (
    <div data-combine-stack style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      <StudioLabel meta={spec.layers.length ? 'top first' : undefined}>Layers</StudioLabel>
      {[...spec.layers].reverse().map(l => <LayerCard key={l.id} layer={l} />)}
      {!spec.layers.length && <span style={{ fontSize: 12, color: tk.text.muted }}>Start with a base: a photo, a 3D scene, anything a builder made.</span>}
      <Button icon="plus" data-combine-add onClick={() => useCombine.getState().setPicker({ on: top?.id ?? null, product: null })}>
        {spec.layers.length ? 'Add a layer' : 'Add the base'}
      </Button>
    </div>
  );
}

function LayerCard({ layer }: { layer: CombineLayer }) {
  const tk = useTokens();
  const spec = useCombine(s => s.spec);
  const selected = useCombine(s => s.selected === layer.id);
  const isolated = useCombine(s => s.isolate === layer.id);
  const info = useCombine(s => s.layerInfo[layer.id]);
  const label = useNodeGraphStore(s => resolveProduct(layer.product, s.nodes).label);
  const kindOf = useKindOf();
  const kind = kindOf(layer.product) ?? 'picture';
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const target = targetOf(spec, layer);
  const onLine = target && layer.on ? ` on layer ${spec.layers.indexOf(target) + 1}` : '';
  return (
    <div data-combine-layer={layer.id} data-selected={selected || undefined} data-isolated={isolated || undefined}
      role="button" tabIndex={0} onClick={() => isolateLayer(layer.id)} onKeyDown={e => { if (e.key === 'Enter') isolateLayer(layer.id); }}
      title={isolated ? 'Showing the stack up to this layer: click again for all of it' : 'Show the stack up to this layer, and its settings'}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 6px', borderRadius: radius.card, cursor: 'pointer',
        background: selected ? tk.bg.selected : tk.bg.panel, boxShadow: selected ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.default}`,
      }}>
      <span style={{ width: 40, height: 40, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
        background: `linear-gradient(135deg, ${alpha(tk.accent.base, 0.28)}, ${alpha(tk.accent.base, 0.08)})`, color: tk.accent.text, ...(layer.muted ? MUTED_DIM : {}) }}>
        <Icon name={layer.product.kind === 'mask' ? 'mask' : KIND_ICON[kind]} size={18} />
        {isolated && <span style={{ position: 'absolute', right: -3, top: -3, width: 16, height: 16, borderRadius: 8, background: tk.accent.base, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="eye" size={10} /></span>}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <b style={{ fontSize: 12.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</b>
        <span style={{ fontSize: 11.5, color: info?.problem ? tk.status.warningText : tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={info?.problem}>
          {info?.problem ? <><Icon name="warning" size={11} style={{ verticalAlign: -1 }} /> {info.problem}</> : `${verbLine(layer)}${onLine}`}
        </span>
      </span>
      {layer.muted && <MutedTag />}
      {!!info?.passes && <span data-layer-passes title={`Adds ${info.passes} pass${info.passes === 1 ? '' : 'es'}`} style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 5px', borderRadius: 5, background: alpha(tk.status.warning, 0.16), color: tk.status.warningText }}>+{info.passes}</span>}
      {layer.verb !== 'base' && <MuteToggle muted={!!layer.muted} what="this layer" onToggle={() => toggleLayerMute(layer.id)} />}
      <IconButton icon="more" size="sm" label="Layer: edit its product, remove" onClick={e => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.right - 200, y: r.bottom + 4 }); }} />
      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        { label: 'Edit product', icon: 'edit', hint: layer.product.kind === 'build' ? 'Open it in its own builder; Done comes back here' : 'Only a builder\'s build opens in its builder: this one is edited on its node', disabled: layer.product.kind !== 'build', onSelect: () => editLayerProduct(layer.id) },
        { label: layer.verb === 'base' ? 'Remove (the next layer becomes the base)' : 'Remove', icon: 'trash', onSelect: () => deleteLayer(layer.id) },
      ]} />}
    </div>
  );
}

// ── + Add a layer ────────────────────────────────────────────────────────────

const NEW_KINDS: Array<{ kind: SceneKind; label: string; icon: IconName; product: ProductKind }> = [
  { kind: '2d', label: '2D scene', icon: 'mask', product: 'picture' },
  { kind: '3d', label: '3D scene', icon: 'cube', product: 'scene3d' },
  { kind: 'agents', label: 'Agent scene', icon: 'swarm', product: 'points' },
  { kind: 'splat', label: 'Splat scene', icon: 'spark', product: 'scene3d' },
  { kind: 'grid', label: 'Grid scene', icon: 'grid', product: 'picture' },
  { kind: 'timecube', label: 'Time Cube', icon: 'layers', product: 'picture' },
  { kind: 'warp', label: 'Warp', icon: 'wave', product: 'picture' },
];

const MASKS: Array<{ find: MaskFind; label: string; icon: IconName }> = [
  { find: 'people', label: 'People', icon: 'body' },
  { find: 'objects', label: 'Objects', icon: 'target' },
  { find: 'click', label: 'Click', icon: 'mouse' },
];

/** Collide with's ways (docs/combine-plan.md §2.3). */
const COLLIDE_WAYS: Array<{ mode: 'bounce' | 'slide' | 'settle'; label: string; icon: IconName; sub: string }> = [
  { mode: 'bounce', label: 'Bounce', icon: 'spark', sub: 'off its surface' },
  { mode: 'slide', label: 'Slide', icon: 'wave', sub: 'along it, round it' },
  { mode: 'settle', label: 'Settle', icon: 'droplet', sub: 'fall and pile up' },
];

/** Follow the shape's ways (§2.4): what each does on a 2D outline, and on a 3D scene's surfaces. */
const FOLLOW_WAYS: Array<{ how: 'trace' | 'cling' | 'flow' | 'orbit'; label: string; icon: IconName; sub: string; sub3d: string }> = [
  { how: 'trace', label: 'Trace', icon: 'curve', sub: 'ride the outline', sub3d: 'circle on the surface' },
  { how: 'cling', label: 'Cling', icon: 'target', sub: 'stay on it, drifting', sub3d: 'crawl on it, any way' },
  { how: 'flow', label: 'Flow along', icon: 'wave', sub: 'pushed round it', sub3d: 'flow over it, one way' },
  { how: 'orbit', label: 'Orbit', icon: 'loop', sub: 'circle it, further out', sub3d: 'a shell round it' },
];

/** A picture-tile button (the picker's choices, the settings' visual pickers). */
function Tile({ icon, label, sub, on, onClick, disabled, title, attrs }: {
  icon: IconName; label: string; sub?: string; on?: boolean; onClick: () => void; disabled?: boolean; title?: string; attrs?: Record<string, string>;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" {...attrs} onClick={onClick} disabled={disabled} title={title} aria-pressed={on}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 64, padding: '8px 6px', border: 0, borderRadius: radius.md,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, textAlign: 'center', font: `600 12px ${fontFamily.ui}`,
        background: on ? alpha(tk.accent.base, 0.16) : hover && !disabled ? tk.bg.hover : tk.bg.field, color: on ? tk.accent.text : tk.text.primary,
        boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.subtle}`,
      }}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
      {sub && <span style={{ fontSize: 10.5, fontWeight: 500, color: tk.text.muted }}>{sub}</span>}
    </button>
  );
}

function TileGrid({ children, cols = 3 }: { children: ReactNode; cols?: number }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 6 }}>{children}</div>;
}

/** What the target layer is (null: a base), for the picker. */
function useTargetKind(on: string | null): ProductKind | null {
  const spec = useCombine(s => s.spec);
  const kindOf = useKindOf();
  const t = on ? spec.layers.find(l => l.id === on) : null;
  return t ? resultKind(spec, t, kindOf) : null;
}

function AddLayer() {
  const tk = useTokens();
  const picker = useCombine(s => s.picker)!;
  const spec = useCombine(s => s.spec);
  const nodes = useNodeGraphStore(s => s.nodes);
  const on = picker.on;
  const tKind = useTargetKind(on);
  const close = () => useCombine.getState().setPicker(null);
  const setProduct = (product: ProductRef | null) => useCombine.getState().setPicker({ on, product });
  // A base takes anything; a layer only what some verb joins to the target.
  const tInfo = targetInfo(spec, on, nodes);
  const joins = (k: ProductKind, splat = false) => on === null || (tKind !== null && offeredVerbs(k, tKind, { splat, ...tInfo }).length > 0);
  const pick = (product: ProductRef) => {
    if (on === null) addLayer(product, 'base', null);
    else setProduct(product);
  };
  const fromGraph = graphProducts(nodes).filter(p => !spec.layers.some(l => sameProduct(l.product, p.ref)) && joins(p.kind, isSplat(p.ref)));
  const addPhoto = (which: 'room' | 'walkway' | 'ball') => {
    const id = useNodeGraphStore.getState().newNodeId();
    const type = which === 'ball' ? 'videoInput' : 'textureInput';
    const params = which === 'ball'
      ? { videoId: BALL_VIDEO.id, _fileName: BALL_VIDEO.name, _hasFile: true, _isPlaying: true, _loop: true, _speed: 1 }
      // Stretch: the picture's colour and its texture (what a mask, Segment, reads) then line up, at the picture's shape.
      : { fit: 'stretch', ...builtinImageParams(which === 'room' ? ROOM_AND_CAT_ID : WALKWAY_CAT_ID) };
    addProductNode(plainNode(type, id, { ...params, __comment: `${which === 'ball' ? 'Video' : 'Texture'}: a picture Combine put in the stack. Pick your own on this card.` }));
    pick({ kind: 'node', nodeId: id, output: 'color' });
  };
  return (
    <div data-combine-picker style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, background: 'rgba(0, 0, 0, 0.35)', overflowY: 'auto' }}
      onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div data-captures-escape={undefined} style={{ width: '100%', maxWidth: 620, background: tk.bg.panel, borderRadius: radius.modal, boxShadow: tk.shadow.modal, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ flex: 1, fontSize: 15, fontWeight: 650 }}>{on === null ? 'The base' : picker.product ? 'How does it join?' : 'Add a layer'}</b>
          {picker.product && <Button size="sm" variant="ghost" icon="chevL" onClick={() => setProduct(null)}>What</Button>}
          <IconButton icon="close" size="sm" label="Close" onClick={close} />
        </span>
        {picker.product && on !== null ? <HowStep product={picker.product} on={on} /> : <>
          {on !== null && <span style={{ fontSize: 12, color: tk.text.muted }}>On {layerName(spec, on)} ({lower(PRODUCT_LABEL[tKind ?? 'picture'])}): only what joins it is offered.</span>}
          {fromGraph.length > 0 && <Section label="From this graph">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {fromGraph.map(p => <ProductChip key={JSON.stringify(p.ref)} p={p} onPick={() => pick(p.ref)} />)}
            </div>
          </Section>}
          {(tKind === 'picture' || tKind === 'pictureDepth') && <Section label="A mask: find in the picture below">
            <TileGrid cols={3}>{MASKS.map(m => <Tile key={m.find} icon={m.icon} label={m.label} attrs={{ 'data-pick-mask': m.find }}
              onClick={() => addLayer({ kind: 'mask', find: m.find, ...(m.find === 'objects' ? { classes: 'cat' } : {}) }, 'replaceMask', on)} />)}</TileGrid>
          </Section>}
          {joins('picture') && <Section label="A photo or video">
            <TileGrid cols={3}>
              <Tile icon="image" label="Room and cat" attrs={{ 'data-pick-photo': 'room' }} onClick={() => addPhoto('room')} />
              <Tile icon="image" label="Walkway cat" attrs={{ 'data-pick-photo': 'walkway' }} onClick={() => addPhoto('walkway')} />
              <Tile icon="film" label="Ball action" attrs={{ 'data-pick-photo': 'ball' }} onClick={() => addPhoto('ball')} />
            </TileGrid>
            <PictureWays graph={false} shader={false} onPicked={p => pick({ kind: 'node', nodeId: p.nodeId, output: 'color' })} />
          </Section>}
          <Section label="New, in its builder">
            <TileGrid cols={4}>{NEW_KINDS.filter(k => joins(k.product, k.kind === 'splat')).map(k => (
              <Tile key={k.kind} icon={k.icon} label={k.label} attrs={{ 'data-pick-new': k.kind }} onClick={() => newProductIn(k.kind, on)} title={`Opens the ${k.label} builder: its Done brings the build back here`} />
            ))}</TileGrid>
          </Section>
          {on !== null && tKind && !fromGraph.length && !joins('picture') && !NEW_KINDS.some(k => joins(k.product, k.kind === 'splat')) && (
            <BuilderNote>Nothing joins a {lower(PRODUCT_LABEL[tKind])} in this version yet.</BuilderNote>
          )}
          {on !== null && spec.layers.length > 1 && <OnPicker on={on} />}
        </>}
      </div>
    </div>
  );
  function plainNode(type: string, id: string, params: Record<string, unknown>): GraphNode {
    const def = getNodeDefinition(type)!;
    return {
      id, type, position: { x: 0, y: 0 },
      inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label }])),
      outputs: Object.fromEntries(Object.entries(def.outputs).map(([k, s]) => [k, { type: s.type, label: s.label }])),
      params: { ...(def.defaultParams ?? {}), ...params },
    };
  }
}

/** "On: layer N": any layer below can be the target (default: the top). */
function OnPicker({ on }: { on: string }) {
  const tk = useTokens();
  const spec = useCombine(s => s.spec);
  const kindOf = useKindOf();
  return (
    <span data-combine-on style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 12, color: tk.text.muted }}>
      On
      {[...spec.layers].reverse().map(l => {
        const k = resultKind(spec, l, kindOf);
        return (
          <button key={l.id} type="button" data-pick-on={l.id} aria-pressed={l.id === on} onClick={() => useCombine.getState().setPicker({ on: l.id, product: null })}
            style={{ border: 0, borderRadius: 999, padding: '3px 9px', cursor: 'pointer', font: `500 11.5px ${fontFamily.ui}`,
              background: l.id === on ? alpha(tk.accent.base, 0.16) : tk.bg.field, color: l.id === on ? tk.accent.text : tk.text.secondary }}>
            {layerName(spec, l.id)} · {PRODUCT_LABEL[k ?? 'picture']}
          </button>
        );
      })}
    </span>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><StudioLabel>{label}</StudioLabel>{children}</div>;
}

function ProductChip({ p, onPick }: { p: GraphProduct; onPick: () => void }) {
  const tk = useTokens();
  return (
    <button type="button" data-pick-product={p.kind} onClick={onPick} title={p.detail}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', font: `600 12px ${fontFamily.ui}`,
        background: tk.bg.field, color: tk.text.primary, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
      <Icon name={KIND_ICON[p.kind]} size={14} />{p.label}<span style={{ fontWeight: 500, color: tk.text.muted }}>{PRODUCT_LABEL[p.kind]}</span>
    </button>
  );
}

/** The verbs that join the product to the target, as tiles, with their ways (Place in: card, the world, by depth). */
function HowStep({ product, on }: { product: ProductRef; on: string }) {
  const tk = useTokens();
  const kindOf = useKindOf();
  const tKind = useTargetKind(on);
  const label = useNodeGraphStore(s => resolveProduct(product, s.nodes).label);
  const spec = useCombine(s => s.spec);
  // Two booleans, not the object: a selector returning a new object each call loops the store forever (React #185).
  const shape = useNodeGraphStore(s => targetInfo(spec, on, s.nodes).shape);
  const flatScene = useNodeGraphStore(s => targetInfo(spec, on, s.nodes).flatScene);
  const tInfo = useMemo(() => ({ shape, flatScene }), [shape, flatScene]);
  const a = kindOf(product) ?? 'picture';
  const verbs = tKind ? offeredVerbs(a, tKind, { splat: isSplat(product), ...tInfo }) : [];
  const ways = (v: VerbId): Array<{ label: string; icon: IconName; settings: CombineLayer['settings']; sub: string }> => {
    const pic = (k: ProductKind | null) => k === 'picture' || k === 'pictureDepth';
    if (v === 'placeIn' && pic(a) && tKind === 'scene3d') return [
      { label: 'On a card', icon: 'image', settings: { how3d: 'card' }, sub: 'stands in the scene' },
      { label: 'As the world', icon: 'sun', settings: { how3d: 'surroundings' }, sub: 'all round it' },
      { label: 'By depth', icon: 'layers', settings: { how3d: 'depth' }, sub: 'objects go behind' },
    ];
    if (v === 'placeIn' && a === 'scene3d' && pic(tKind) && !isSplat(product)) return [
      { label: 'Over it', icon: 'layers', settings: { howPic: 'over' }, sub: 'where it has shapes' },
      { label: 'In it, by depth', icon: 'cube', settings: { howPic: 'depth' }, sub: 'hides behind near things' },
    ];
    if (v === 'placeIn' && pic(a) && pic(tKind)) return [
      { label: 'Over', icon: 'layers', settings: { blend: 'normal', amount: 0.5 }, sub: 'mixed in' },
      { label: 'Screen', icon: 'sun', settings: { blend: 'screen' }, sub: 'its light only' },
      { label: 'Multiply', icon: 'moon', settings: { blend: 'multiply' }, sub: 'its dark only' },
    ];
    if (v === 'replaceMask') return [
      { label: 'On each blob', icon: 'target', settings: { stick: 'blobs' }, sub: 'fitted, follows it' },
      { label: 'The whole mask', icon: 'mask', settings: { stick: 'frame' }, sub: 'the fill as it is' },
    ];
    if (v === 'collide') return COLLIDE_WAYS.map(w => ({ label: w.label, icon: w.icon, settings: { mode: w.mode }, sub: w.sub }));
    if (v === 'follow') return FOLLOW_WAYS.map(w => ({ label: w.label, icon: w.icon, settings: { how: w.how }, sub: tKind === 'scene3d' ? w.sub3d : w.sub }));
    return [{ label: VERBS[v].label, icon: 'link', settings: {}, sub: VERBS[v].reads }];
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 12.5, color: tk.text.muted }}><b style={{ color: tk.text.primary }}>{label}</b> ({PRODUCT_LABEL[a]}) on a {lower(PRODUCT_LABEL[tKind ?? 'picture'])}</span>
      {verbs.map(v => (
        <Section key={v} label={VERBS[v].label}>
          <TileGrid cols={3}>{ways(v).map(w => <Tile key={w.label} icon={w.icon} label={w.label} sub={w.sub} attrs={{ 'data-pick-verb': v, 'data-pick-way': w.label }} onClick={() => addLayer(product, v, on, w.settings)} />)}</TileGrid>
        </Section>
      ))}
      {!verbs.length && <BuilderNote>Nothing joins these two in this version yet.</BuilderNote>}
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

/** A section of the settings: the primary one open, the rest folded with a summary (remembered per section). */
function Fold({ id, title, summary, primary = false, children }: { id: string; title: string; summary?: string; primary?: boolean; children: ReactNode }) {
  const tk = useTokens();
  const [open, setOpen] = useSectionOpen(`combine:${id}`, primary);
  return (
    <div data-combine-section={id} data-open={open || undefined} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.text.faint, font: `700 11px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'left' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={12} />
        <span style={{ flexShrink: 0 }}>{title}</span>
        {!open && summary && <span style={{ flex: 1, minWidth: 0, textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>}
    </div>
  );
}

/** A glue node's param, for the slider's right-click Add to Play: only once the build is in your graph ([D8]). */
function playParam(role: string, key: string): () => { nodeId: string; key: string } | { missing: string } {
  return () => {
    const c = useCombine.getState();
    const nodes = useNodeGraphStore.getState().nodes;
    const found = c.anchorId ? findCombineBuild(nodes, c.anchorId) : null;
    // A glue node, or one Combine put inside a product's Agents group (Collide with, Follow the shape).
    const node = found ? found.byRole.get(role) ?? innerGlue(nodes, found.meta.build).get(role) : undefined;
    if (!node) return { missing: 'Not built yet: this part is off.' };
    // Before Done the build is a draft: a Play control would point at nothing in your graph.
    const inBase = (list: readonly GraphNode[] | null | undefined): boolean => !!list?.some(n => n.id === node.id || inBase((n.params.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes));
    if (!inBase(sceneDraftBase())) return { missing: 'Add to Play after Done: the combined scene isn\'t in your graph yet.' };
    return { nodeId: node.id, key };
  };
}

function LayerSettings() {
  const tk = useTokens();
  const spec = useCombine(s => s.spec);
  const selected = useCombine(s => s.selected);
  const warnings = useCombine(s => s.warnings);
  const info = useCombine(s => (selected ? s.layerInfo[selected] : undefined));
  const nodes = useNodeGraphStore(s => s.nodes);
  const kindOf = useKindOf();
  const layer = spec.layers.find(l => l.id === selected);
  // An expression that doesn't check says so under its own field: not again here.
  const shown = warnings.filter(w => !/ = .*The slider's number is used\.$/.test(w));
  if (!layer) return <div style={{ padding: 16 }}><BuilderNote>Pick a layer to set how it joins.</BuilderNote></div>;
  const a = resolveProduct(layer.product, nodes);
  const target = targetOf(spec, layer);
  const tKind = target ? resultKind(spec, target, kindOf) : null;
  // What it goes on, as you'd name it: a Place in layer keeps its target's kind, so name that ("3D scene").
  let root = target;
  while (root && root.verb === 'placeIn') root = targetOf(spec, root);
  const tLabel = root ? resolveProduct(root.product, nodes).label : '';
  const S = layer.settings;
  const set = (k: string) => (v: number | string | boolean) => setLayerSetting(layer.id, k, v);
  const L = layer.id;
  const slider = (key: string, label: string, def: number, min: number, max: number, play?: [string, string], step = 0.01) => (
    <NumRow key={key} label={label} value={num(S[key], def)} min={min} max={max} step={step} defaultValue={def} onChange={set(key)} rangeKey={`combine:${key}`}
      lazyParam={play ? playParam(`${L}:${play[0]}`, play[1]) : () => ({ missing: 'This one is set on two nodes at once: change it here.' })} />
  );
  const pic = (k: ProductKind | null) => k === 'picture' || k === 'pictureDepth';
  const d3 = tKind === 'scene3d';
  // The numbers that can be a line instead (they go into a socket), with the names each line can use.
  const targets = exprTargets(layer.verb, { how: String(S.how ?? FOLLOW_DEFAULTS.how), mode: String(S.mode ?? COLLIDE_DEFAULTS.mode), d3, amount: true });
  /** A slider, or (ƒ) its one-line expression, when the number can be one. */
  const xslider = (key: string, label: string, def: number, min: number, max: number, play?: [string, string], step = 0.01) => (targets[key]
    ? <XSlider key={key} layer={layer} k={key} label={label} names={targets[key]}>{slider(key, label, def, min, max, play, step)}</XSlider>
    : slider(key, label, def, min, max, play, step));
  const body: ReactNode[] = [];
  if (layer.verb === 'base') {
    body.push(<BuilderNote key="base">The base: every layer above goes on it.{layer.product.kind === 'build' ? ' Edit product opens it in its builder.' : ''}</BuilderNote>);
  } else if (layer.verb === 'placeIn' && pic(a.kind) && pic(tKind)) {
    const P = settingsOf(layer, PLACE_DEFAULTS);
    body.push(<Fold key="blend" id="blend" title="Blend" primary summary={`${P.blend} · ${num(P.amount, 1)}`}>
      <TileGrid cols={5}>{(['normal', 'screen', 'add', 'multiply', 'overlay'] as const).map(b => <Tile key={b} icon={b === 'multiply' ? 'moon' : b === 'normal' ? 'layers' : 'sun'} label={b[0].toUpperCase() + b.slice(1)} on={P.blend === b} onClick={() => set('blend')(b)} />)}</TileGrid>
      {xslider('amount', 'Amount', 1, 0, 1, P.blend === 'normal' ? ['blend', 't'] : ['blend', 'opacity'])}
    </Fold>);
  } else if (layer.verb === 'placeIn' && pic(a.kind) && tKind === 'scene3d') {
    const P = settingsOf(layer, PLACE_DEFAULTS);
    body.push(<Fold key="how" id="how3d" title="How" primary summary={String(P.how3d)}>
      <TileGrid cols={3}>
        <Tile icon="image" label="Card" sub="stands in it" on={P.how3d === 'card'} attrs={{ 'data-how': 'card' }} onClick={() => set('how3d')('card')} />
        <Tile icon="sun" label="World" sub="all round it" on={P.how3d === 'surroundings'} attrs={{ 'data-how': 'surroundings' }} onClick={() => set('how3d')('surroundings')} />
        <Tile icon="layers" label="By depth" sub="objects go behind" on={P.how3d === 'depth'} attrs={{ 'data-how': 'depth' }} onClick={() => set('how3d')('depth')} />
      </TileGrid>
    </Fold>);
    if (P.how3d === 'card') body.push(<Fold key="card" id="card" title="Card" primary summary={`size ${num(P.size, 1.6)} · turn ${num(P.turn, 0)}°`}>
      {slider('x', 'Across', 0, -3, 3)}{slider('y', 'Up', 0.1, -2, 2)}{slider('z', 'Depth', -0.6, -5, 3)}
      {slider('turn', 'Turn °', 0, -180, 180, undefined, 0.5)}{slider('size', 'Size', 1.6, 0.1, 6)}{slider('glow', 'Brightness', 1, 0, 4)}
    </Fold>);
    if (P.how3d === 'depth') body.push(<DepthFold key="depth" layer={layer} pictureRef={a.texture?.nodeId} label={a.label} />);
  } else if (layer.verb === 'placeIn' && a.kind === 'scene3d' && pic(tKind) && !a.splat) {
    const P = settingsOf(layer, PLACE_DEFAULTS);
    body.push(<Fold key="how" id="howPic" title="How" primary summary={String(P.howPic)}>
      <TileGrid cols={2}>
        <Tile icon="layers" label="Over it" sub="where it has shapes" on={P.howPic === 'over'} attrs={{ 'data-how': 'over' }} onClick={() => set('howPic')('over')} />
        <Tile icon="cube" label="By depth" sub="near things hide it" on={P.howPic === 'depth'} attrs={{ 'data-how': 'depth' }} onClick={() => set('howPic')('depth')} />
      </TileGrid>
      {P.howPic === 'over' && xslider('amount', 'Amount', 1, 0, 1, ['amount', 'b'])}
    </Fold>);
    if (P.howPic === 'depth' && target) body.push(<DepthFold key="depth" layer={layer} pictureRef={resolveProduct(target.product, nodes).texture?.nodeId} label={tLabel} />);
  } else if (layer.verb === 'placeIn' && a.kind === 'points') {
    body.push(<Fold key="pts" id="points" title="Points" primary summary={`amount ${num(S.amount, 1)}`}>{xslider('amount', 'Amount', 1, 0, 1, ['over', 't'])}</Fold>);
  } else if (layer.verb === 'placeIn' && a.splat) {
    body.push(<BuilderNote key="splat">The splats are seen through the scene's camera and hide behind its surfaces. Place and turn them in the Splat builder (Edit product).</BuilderNote>);
  } else if (layer.verb === 'collide') {
    const C = settingsOf(layer, COLLIDE_DEFAULTS);
    const mode = String(C.mode);
    body.push(<Fold key="how" id="collide" title="How" primary summary={mode}>
      <TileGrid cols={3}>{COLLIDE_WAYS.map(w => <Tile key={w.mode} icon={w.icon} label={w.label} sub={w.sub} on={mode === w.mode} attrs={{ 'data-collide': w.mode }} onClick={() => set('mode')(w.mode)} />)}</TileGrid>
      {mode === 'bounce' && xslider('bounce', 'Bounce', 0.6, 0, 1, ['collide', 'bounce'])}
      {mode === 'settle' && xslider('gravity', 'Gravity', 0.6, 0, 3, ['gravity', 'strength'])}
      {xslider('friction', 'Friction', mode === 'settle' ? 0.5 : 0.03, 0, 1, ['collide', 'friction'])}
    </Fold>);
    body.push(<Fold key="edge" id="collideEdge" title="Surface" summary={`margin ${num(C.margin, 0.015)}${d3 ? ` · grid ±${num(C.reach, 2)}` : ''}`}>
      {slider('margin', 'Margin', 0.015, 0, 0.2, ['collide', 'margin'], 0.001)}
      {mode !== 'settle' && slider('cushion', 'Cushion', 0.06, 0, 0.5, ['collide', 'cushion'], 0.001)}
      {d3 && slider('reach', 'Scene size', 2, 0.2, 10, ['collide', 'reach'], 0.05)}
    </Fold>);
    body.push(<Fold key="draw" id="pointsDraw" title="Draw" summary={`amount ${num(S.amount, 1)}`}>{xslider('amount', 'Amount', 1, 0, 1, ['over', 't'])}</Fold>);
  } else if (layer.verb === 'follow') {
    const F = settingsOf(layer, FOLLOW_DEFAULTS);
    const how = String(F.how);
    const ride = !d3 && (how === 'trace' || how === 'orbit');
    body.push(<Fold key="how" id="follow" title="How" primary summary={`${how === 'flow' ? 'flow along' : how} · speed ${num(F.speed, 0.35)}`}>
      <TileGrid cols={4}>{FOLLOW_WAYS.map(w => <Tile key={w.how} icon={w.icon} label={w.label} sub={d3 ? w.sub3d : w.sub} on={how === w.how} attrs={{ 'data-follow': w.how }} onClick={() => set('how')(w.how)} />)}</TileGrid>
      {d3 && how !== 'cling' && <TileGrid cols={3}>{(['y', 'x', 'z'] as const).map(x => <Tile key={x} icon={x === 'y' ? 'loop' : 'bidir'} label={x === 'y' ? 'Up' : x === 'x' ? 'Across' : 'Depth'} sub={how === 'flow' ? 'flows that way' : 'round that axis'} on={String(F.axis) === x} attrs={{ 'data-axis': x }} onClick={() => set('axis')(x)} />)}</TileGrid>}
      {(d3 || ride) && xslider('speed', 'Speed', 0.35, -2, 2, ['follow', 'speed'])}
      {!d3 && how === 'flow' && xslider('push', 'Push', 1.2, -4, 4, ['along', 'strength'])}
      {!d3 && how === 'cling' && xslider('drift', 'Drift', 0.5, 0, 3, ['drift', 'strength'])}
      {how === 'orbit'
        ? xslider('orbit', 'Distance', 0.25, 0, 1.5, ['follow', d3 ? 'offset' : 'level'], 0.005)
        : xslider('offset', 'Offset', 0.02, -0.3, 0.6, d3 ? ['follow', 'offset'] : ride ? ['follow', 'level'] : ['offset', 'value'], 0.005)}
      {ride && xslider('width', 'Band', 0.03, 0, 0.3, ['follow', 'width'], 0.001)}
    </Fold>);
    if (d3) body.push(<Fold key="grid" id="followGrid" title="Surface" summary={`grid ±${num(F.reach, 2)}`}>{slider('reach', 'Scene size', 2, 0.2, 10, ['follow', 'reach'], 0.05)}</Fold>);
    body.push(<Fold key="draw" id="pointsDraw" title="Draw" summary={`amount ${num(S.amount, 1)}`}>{xslider('amount', 'Amount', 1, 0, 1, ['over', 't'])}</Fold>);
  } else if (layer.verb === 'replaceMask' && layer.product.kind === 'mask') {
    const M = settingsOf(layer, MASK_DEFAULTS);
    const find = layer.product.find;
    const classes = (layer.product.classes ?? 'person').split(',').filter(Boolean);
    body.push(<Fold key="find" id="find" title="Find" primary summary={find === 'objects' ? classes.join(', ') : find}>
      <TileGrid cols={3}>{MASKS.map(m => <Tile key={m.find} icon={m.icon} label={m.label} on={find === m.find} attrs={{ 'data-find': m.find }}
        onClick={() => updateLayer(L, l => { l.product = { kind: 'mask', find: m.find, ...(m.find === 'objects' ? { classes: classes.join(',') || 'cat' } : {}) }; })} />)}</TileGrid>
      {find === 'objects' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {SEGMENT_CLASSES.slice(0, 12).map(c => {
          const on = classes.includes(c.key);
          return <button key={c.key} type="button" aria-pressed={on} data-class={c.key} onClick={() => {
            const next = on ? classes.filter(x => x !== c.key) : [...classes, c.key];
            if (next.length) updateLayer(L, l => { l.product = { kind: 'mask', find: 'objects', classes: next.join(',') }; });
          }} style={{ border: 0, borderRadius: 999, padding: '3px 9px', cursor: 'pointer', font: `500 11.5px ${fontFamily.ui}`, background: on ? alpha(tk.accent.base, 0.16) : tk.bg.field, color: on ? tk.accent.text : tk.text.secondary }}>{c.label}</button>;
        })}
      </div>}
      {find === 'click' && <BuilderNote>Pick the point on the Segment card (Pick on the preview); it follows what you clicked.</BuilderNote>}
    </Fold>);
    body.push(<Fold key="edge" id="maskEdge" title="Edge" summary={`threshold ${num(M.threshold, 0.5)} · grow ${num(M.grow, 0)}`}>
      {slider('threshold', 'Threshold', 0.5, 0, 1, ['find', 'threshold'])}{slider('softness', 'Softness', 0.1, 0, 0.5, ['find', 'softness'])}{slider('grow', 'Grow', 0, -20, 20, ['find', 'grow'], 0.5)}
    </Fold>);
    body.push(<Fold key="blobs" id="maskBlobs" title="Blobs" summary={`up to ${num(M.maxBlobs, 4)}`}>
      {slider('maxBlobs', 'Most blobs', 4, 1, 16, undefined, 1)}
      <BuilderNote>A fill on this mask sticks to each blob it finds (one per person or thing).</BuilderNote>
    </Fold>);
  } else if (layer.verb === 'replaceMask') {
    const R = settingsOf(layer, REPLACE_DEFAULTS);
    // Per blob (BlobFills.tsx): each blob its own fill, attached by order or ID, and the rest; always on the blobs.
    const perBlob = isPerBlob(layer);
    body.push(<Fold key="fill" id="fill" title="Fill" primary summary={fillSummary(layer, R)}>
      <FillModeChoice layer={layer} />
      {perBlob ? <PerBlobFills layer={layer} /> : <TileGrid cols={2}>
        <Tile icon="target" label="On each blob" sub="fitted, follows it" on={R.stick === 'blobs'} attrs={{ 'data-stick': 'blobs' }} onClick={() => set('stick')('blobs')} />
        <Tile icon="mask" label="Whole mask" sub="as it is" on={R.stick === 'frame'} attrs={{ 'data-stick': 'frame' }} onClick={() => set('stick')('frame')} />
      </TileGrid>}
      {xslider('amount', 'Amount', 1, 0, 1, perBlob ? undefined : ['amount', 'b'])}
    </Fold>);
    if (R.stick === 'blobs' || perBlob) body.push(<Fold key="stick" id="stick" title="Stick" summary={`${R.fit} · padding ${num(R.padding, 0.15)}`}>
      <TileGrid cols={3}>{(['box', 'square', 'circle'] as const).map(f => <Tile key={f} icon={f === 'circle' ? 'target' : f === 'box' ? 'layout' : 'grid'} label={f === 'box' ? 'Box' : f === 'square' ? 'Square' : 'Circle'} on={R.fit === f} attrs={{ 'data-fit': f }} onClick={() => set('fit')(f)} />)}</TileGrid>
      {slider('padding', 'Padding', 0.15, -0.5, 1, perBlob ? undefined : ['space', 'padding'])}{slider('scale', 'Fill scale', 1, 0.1, 4, perBlob ? undefined : ['space', 'scale'])}{slider('spin', 'Spin by ID', 0, 0, 1, perBlob ? undefined : ['space', 'spin'])}
    </Fold>);
  }
  return (
    <div data-combine-settings={L} style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 14 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.label}{target ? ` → ${tLabel}` : ''}
        </b>
        {layer.product.kind === 'build' && <Button size="sm" variant="ghost" icon="edit" data-edit-product onClick={() => editLayerProduct(L)}>Edit product</Button>}
      </span>
      {info?.problem && <BuilderNote style={{ color: tk.status.warningText }}>{info.problem}</BuilderNote>}
      <div style={layer.muted ? MUTED_DIM : undefined}>{body}</div>
      {!!info?.passes && <BuilderNote>This layer adds {info.passes} pass{info.passes === 1 ? '' : 'es'}: a picture worked out per pixel becomes a texture for it.</BuilderNote>}
      {shown.length > 0 && <div data-combine-warnings style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{shown.map(w => <BuilderNote key={w} style={{ color: tk.status.warningText }}>{w}</BuilderNote>)}</div>}
    </div>
  );
}

// ── One-line expressions (docs/combine-plan.md §2.8) ─────────────────────────

/**
 * A verb's number with ƒ beside it: written as a one-line expression instead (exprs.ts: a Simple Expression wired where
 * the number goes). The line is checked as you type and built when you leave it (or press Enter). A number under the
 * caret offers Make a slider: it becomes a name with a slider of its own (a Constant in the graph, which Add to Play
 * can take after Done). × goes back to the plain slider.
 */
function XSlider({ layer, k, label, names, children }: { layer: CombineLayer; k: string; label: string; names: readonly ExprName[]; children: ReactNode }) {
  const tk = useTokens();
  const text = layer.exprs?.[k];
  const sliders = useMemo(() => layer.sliders?.[k] ?? {}, [layer.sliders, k]);
  const [draft, setDraft] = useState<string | null>(null);
  const [offer, setOffer] = useState<LiteralSpan | null>(null);
  useEffect(() => { setDraft(null); setOffer(null); }, [text]);
  const L = layer.id;
  const value = draft ?? text ?? '';
  const all = useMemo(() => [...FREE_NAMES, ...names], [names]);
  const chk = text === undefined ? null : checkExpr(value, all, sliders);
  const commit = (v = value) => {
    setDraft(null);
    if (v !== text) updateLayer(L, l => { l.exprs = { ...(l.exprs ?? {}), [k]: v }; });
  };
  const toggle = () => updateLayer(L, l => {
    if (l.exprs?.[k] !== undefined) {
      const { [k]: _gone, ...rest } = l.exprs;
      l.exprs = rest;
      if (l.sliders) { const { [k]: _s, ...more } = l.sliders; l.sliders = more; }
    } else l.exprs = { ...(l.exprs ?? {}), [k]: String(num(l.settings[k], 0)) };
  });
  const makeSlider = (lit: LiteralSpan) => {
    const made = literalToSlider(value, { ...lit, int: false }, [...all.map(x => x.name), ...Object.keys(sliders)]);
    setOffer(null);
    setDraft(null);
    updateLayer(L, l => {
      l.exprs = { ...(l.exprs ?? {}), [k]: made.text };
      l.sliders = { ...(l.sliders ?? {}), [k]: { ...(l.sliders?.[k] ?? {}), [made.name]: made.value } };
    });
  };
  const fx = (
    <button type="button" data-expr-toggle={k} aria-pressed={text !== undefined} onClick={toggle}
      title={text !== undefined ? `Back to a plain ${label} slider` : `Write ${label} as a line: a Simple Expression in the graph`}
      style={{ flexShrink: 0, width: 22, height: 22, padding: 0, border: 0, borderRadius: 6, cursor: 'pointer', font: `italic 700 12px ${fontFamily.mono}`,
        background: text !== undefined ? alpha(tk.accent.base, 0.16) : 'none', color: text !== undefined ? tk.accent.text : tk.text.muted }}>ƒ</button>
  );
  if (text === undefined) return <div data-xslider={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ flex: 1, minWidth: 0 }}>{children}</div>{fx}</div>;
  return (
    <div data-xslider={k} data-expr-on style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 76, flexShrink: 0, fontSize: 12, color: tk.text.secondary }}>{label} =</span>
        <ExprLineInput ariaLabel={`${label} as an expression`} attrs={{ 'data-expr-line': k }} value={value} invalid={!!chk && !chk.ok}
          vars={[...all.map(x => ({ name: x.name, type: 'float' })), ...Object.keys(sliders).map(name => ({ name, type: 'float' }))]}
          placeholder="e.g. 0.3 + 0.2 * sin(t)"
          onChange={v => setDraft(v)}
          onCaret={el => setOffer(literalAt(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0))}
          onBlur={() => { commit(); setTimeout(() => setOffer(null), 150); }} />
        {fx}
      </div>
      {chk && !chk.ok && <div role="alert" data-expr-error={k} style={{ fontSize: 11.5, color: tk.status.danger, paddingLeft: 82 }}>{chk.error}</div>}
      {offer && <MakeSliderButton lit={offer} onMake={() => makeSlider(offer)} indent={82} />}
      <span style={{ paddingLeft: 82, fontSize: 11, color: tk.text.faint }} title={all.map(x => `${x.name}: ${x.doc}`).join('\n')}>{all.map(x => x.name).join(' · ')}</span>
      {Object.entries(sliders).map(([name, v]) => (
        <NumRow key={name} label={name} value={v} min={Math.min(0, v * 2)} max={Math.max(1, Math.abs(v) * 2)} defaultValue={v}
          onChange={nv => updateLayer(L, l => { l.sliders = { ...(l.sliders ?? {}), [k]: { ...(l.sliders?.[k] ?? {}), [name]: nv } }; })}
          lazyParam={playParam(`${L}:x:${k}:${name}`, 'value')} />
      ))}
    </div>
  );
}

/** Depth for a picture: Generate depth (the opt-in download, then the model once) and where its near and far sit. */
function DepthFold({ layer, pictureRef, label }: { layer: CombineLayer; pictureRef: string | undefined; label: string }) {
  const P = settingsOf(layer, PLACE_DEFAULTS);
  const nodes = useNodeGraphStore(s => s.nodes);
  const isTexture = !!pictureRef && ['textureInput', 'videoInput'].includes(nodes.find(n => n.id === pictureRef)?.type ?? '');
  return (
    <Fold id="depth" title="Depth" primary summary={`near ${num(P.near, 1.5)} · far ${num(P.far, 8)}${layer.depthBake ? ' · generated' : ''}`}>
      {isTexture
        ? <DepthGenerateRow pictureNode={pictureRef} source={label} bake={layer.depthBake} onBake={info => updateLayer(layer.id, l => { l.depthBake = info; })} />
        : <BuilderNote>The Depth node works this picture's depth out live, once its model is downloaded (its card offers it).</BuilderNote>}
      <NumRow label="Nearest" value={num(P.near, 1.5)} min={0.1} max={20} defaultValue={1.5} onChange={v => setLayerSetting(layer.id, 'near', v)} lazyParam={playParam(`${layer.id}:composite`, 'nearD')} />
      <NumRow label="Farthest" value={num(P.far, 8)} min={0.2} max={100} step={0.1} defaultValue={8} onChange={v => setLayerSetting(layer.id, 'far', v)} lazyParam={playParam(`${layer.id}:composite`, 'farD')} />
      <NumRow label="Edge softness" value={num(P.soft, 0.08)} min={0} max={1} step={0.005} defaultValue={0.08} onChange={v => setLayerSetting(layer.id, 'soft', v)} lazyParam={playParam(`${layer.id}:composite`, 'softness')} />
    </Fold>
  );
}

// ── Hand edits, presets ──────────────────────────────────────────────────────

function EditsBanner({ edits }: { edits: { params: string[]; wires: string[] } }) {
  const tk = useTokens();
  const count = edits.params.length + edits.wires.length;
  return (
    <div data-combine-edits style={{ position: 'absolute', left: '50%', top: 12, transform: 'translateX(-50%)', zIndex: 4, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 14px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: tk.shadow.modal, fontSize: 12.5 }}
      title={[...edits.params, ...edits.wires].join('\n')}>
      <span>{count} {count === 1 ? 'thing' : 'things'} edited by hand on its nodes</span>
      <Button size="sm" variant="primary" data-keep-edits onClick={() => answerEdits(false)}>Keep my edits</Button>
      <Button size="sm" data-rebuild onClick={() => answerEdits(true)}>Rebuild it</Button>
    </div>
  );
}

function PresetsStrip() {
  const tk = useTokens();
  return (
    <StripRow attrs={{ 'data-combine-presets': '' }}>
      {COMBINE_PRESETS.map(p => (
        <button key={p.key} type="button" data-preset={p.key} title={p.hint} onClick={() => { applyCombinePreset(p.key); syncCombine(); }}
          style={{ flexShrink: 0, width: 132, padding: 0, border: 0, background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left', color: tk.text.secondary, font: `500 12px ${fontFamily.ui}` }}>
          <span style={{ width: 132, height: 76, borderRadius: radius.md, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.accent.text,
            background: `radial-gradient(circle at 30% 30%, ${alpha(tk.accent.base, 0.35)}, ${alpha(tk.accent.base, 0.06)} 70%), ${tk.bg.render}`, boxShadow: `0 0 0 1px ${tk.border.default}` }}>
            <Icon name={p.icon} size={26} />
          </span>
          <span style={{ padding: '0 2px' }}>{p.label}</span>
        </button>
      ))}
    </StripRow>
  );
}
