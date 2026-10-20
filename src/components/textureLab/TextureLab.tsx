/**
 * TextureLab — the Scene builder's Texture Lab window (docs/texture-lab.md), on the shared StudioShell:
 *
 *   ┌ Scene builder › Texture Lab ───── undo · redo · before|after · Passes 3/8 · Open as nodes · Surprise me · Done ┐
 *   │ SOURCE  ▣ Room and cat │   the main preview, live: before | after split, the divider draggable │ the card's   │
 *   │ STACK   ◉ Edges     0  │                                                                       │ settings     │
 *   │         ◉ Glow     +1  │                                                                       │              │
 *   │ [+ Add a tool]         │                                                                       │              │
 *   ├────────────────────────┴───────────────────────────────────────────────────────────────────────┴──────────────┤
 *   │ presets: Thermal · Ink outline · Motion trails · Relief · yours                                               │
 *   └────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Every block is a real Texture tools node; its settings are drawn from the node's own definition (label, range,
 * hint, when it shows), grouped by the card's sections, the first open and the rest folded with a summary. Each card
 * says what it costs in passes, and the add menu says what each tool would cost and locks the ones past the limit.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { StripRow, StudioShell, StudioLabel, PresetCard } from '../builders/studio/StudioShell';
import { LiveViewport, type ViewRect } from '../builders/studio/LiveViewport';
import { SceneCrumb } from '../builders/SceneCrumb';
import { BuilderNote } from '../builders/BuilderWindow';
import { Card, ColourRow, NumRow, Row, NO_DRAG } from '../sceneBuilder/controls';
import { MuteToggle } from '../builders/MuteToggle';
import { PresetsSummary, UserPresets } from '../builders/UserPresets';
import { PictureWays } from '../builders/TexturePicker';
import { budgetTip, graceWords } from '../shell/PassBudget';
import { IconButton, Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Segmented, Toggle } from '../ui/Choice';
import { Select } from '../ui/Select';
import { SurpriseBar } from '../surprise/SurpriseBar';
import { announceSurprise } from '../surprise/announce';
import { newSeed } from '../../lib/surprise';
import { summarizeSection, switchOnPatch } from '../../lib/sectionSummary';
import { presetTextToSpec, specToPresetText } from '../../builders/userPresets';
import { TEXTURE_STRIP_KEYS, stripOf } from '../../builders/stripPresets';
import { backToSceneKinds } from '../../builders/sceneKinds';
import { sceneDraftBase } from '../../builders/sceneDraft';
import { textureNodes, texNodeLabel } from '../../builders/textures';
import { depthModelOffer, depthModelReady, downloadGenerateModel } from '../../builders/depthPicture';
import { builtinImageUrl, ROOM_AND_CAT_ID, WALKWAY_CAT_ID } from '../../lib/builtinImages';
import { CURVES_PRESETS, curvesPresetParams } from '../../nodes/definitions/curves';
import { HARD_MAX_PASSES, MAX_PASSES, budgetLevel, passBudget } from '../../compiler/passBudget';
import type { ParamDef } from '../../types/nodeGraph';
import { useTextureLab } from '../../textureLab/store';
import {
  addBlock, addCosts, closeTextureLab, duplicateBlock, editLab, finishTextureLab, moveBlock, moveBlockTo, openTextureLabAsNodes,
  passesWith, removeBlock, syncTextureLab, type AddCost,
} from '../../textureLab/actions';
import { blockPasses, findTxBuild } from '../../textureLab/apply';
import { BLOCK_GROUPS, BLOCKS, blockDef, viewOf, type BlockDef } from '../../textureLab/blocks';
import { TX_PRESETS, presetNow, surpriseTextureLab, withPreset } from '../../textureLab/presets';
import { lookThumb, type PictureLook } from '../../textureLab/picture';
import {
  blockLabel, blockSummary, defaultsOf, defsOf, normalizeSpec, sourceName, stackLine, visibleNow,
  type Params, type TextureLabSpec, type TxBlock, type TxSource,
} from '../../textureLab/spec';

const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const edit = (fn: (d: TextureLabSpec) => void, coalesce?: string) => useTextureLab.getState().edit(fn, coalesce);
const editBlock = (id: string, fn: (b: TxBlock) => void, coalesce?: string) => edit(d => { const b = d.blocks.find(x => x.id === id); if (b) fn(b); }, coalesce);

/** The node built for a block's role, looked up when the Play menu opens. */
function playParam(blockId: string, key: string, role = 'main'): () => { nodeId: string; key: string } | { missing: string } {
  return () => {
    const id = useTextureLab.getState().targetId;
    const b = id ? findTxBuild(useNodeGraphStore.getState().nodes, id) : null;
    const node = b?.byRole.get(`${blockId}:${role}`);
    return node ? { nodeId: node.id, key } : { missing: 'Not built yet.' };
  };
}

/** Build each change into the graph, once a frame at most (the stack, the divider, a block shown on its own). */
function useLiveSync() {
  useEffect(() => {
    let raf = 0;
    let last = useTextureLab.getState();
    const off = useTextureLab.subscribe(s => {
      if (!s.open || (s.spec === last.spec && s.split === last.split && s.upTo === last.upTo)) return;
      last = s;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (useTextureLab.getState().open) syncTextureLab(); });
    });
    return () => { off(); if (raf) cancelAnimationFrame(raf); };
  }, []);
}

/** Passes each block uses now, from the graph. */
function useBlockPasses(): Record<string, number> {
  const target = useTextureLab(s => s.targetId);
  const nodes = useNodeGraphStore(s => s.nodes);
  return useMemo(() => blockPasses(nodes, target), [nodes, target]);
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function CostBadge({ n, grace, locked, title }: { n: number; grace?: boolean; locked?: boolean; title?: string }) {
  const tk = useTokens();
  const colour = locked ? tk.text.faint : grace ? tk.status.warningText : n > 0 ? tk.text.secondary : tk.text.faint;
  return (
    <span data-tx-cost={n} title={title ?? (n ? `Uses ${n} pass${n === 1 ? '' : 'es'} of the ${MAX_PASSES} at full quality` : 'Uses no passes')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0, minWidth: 22, justifyContent: 'center', height: 18, padding: '0 5px', borderRadius: 9, fontSize: 11, fontWeight: 600,
        color: colour, background: grace && !locked ? 'rgba(234,170,40,0.14)' : tk.bg.field }}>
      {locked ? <Icon name="lock" size={10} /> : n > 0 ? `+${n}` : '0'}
    </span>
  );
}

function SourceThumb({ source, size = 34 }: { source: TxSource; size?: number }) {
  const tk = useTokens();
  const nodeThumb = useNodeGraphStore(s => {
    if (source.kind !== 'node') return '';
    const nd = s.nodes.find(x => x.id === source.nodeId);
    return typeof nd?.params._thumbnailUrl === 'string' ? nd.params._thumbnailUrl : '';
  });
  const url = source.kind === 'room' ? builtinImageUrl(ROOM_AND_CAT_ID) : source.kind === 'walkway' ? builtinImageUrl(WALKWAY_CAT_ID) : nodeThumb;
  const box: CSSProperties = { width: size * 1.4, height: size, borderRadius: 6, flexShrink: 0, objectFit: 'cover', display: 'block' };
  return url ? <img src={url} alt="" style={box} />
    : <span style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tk.bg.render, color: '#c8cad4' }}><Icon name={source.kind === 'ball' ? 'film' : 'image'} size={15} /></span>;
}

// ── The stack (left) ─────────────────────────────────────────────────────────

function StackRow({ block, index, passes, grace }: { block: TxBlock; index: number; passes: number; grace: boolean }) {
  const tk = useTokens();
  const selected = useTextureLab(s => s.selected === block.id);
  const upTo = useTextureLab(s => s.upTo);
  const def = blockDef(block.type);
  const [over, setOver] = useState(false);
  const summary = blockSummary(block);
  return (
    <div data-tx-block={block.id} data-tx-type={block.type} draggable={!NO_DRAG}
      onDragStart={e => { e.dataTransfer.setData('text/x-tx-block', block.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={e => { if (e.dataTransfer.types.includes('text/x-tx-block')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { setOver(false); const id = e.dataTransfer.getData('text/x-tx-block'); if (id && id !== block.id) moveBlockTo(id, index); }}
      onClick={() => useTextureLab.getState().select(block.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 6px 7px 8px', borderRadius: radius.control, cursor: 'pointer',
        background: selected ? tk.bg.selected : 'transparent', boxShadow: over ? `inset 0 2px 0 ${tk.accent.base}` : selected ? `inset 0 0 0 1px ${tk.accent.base}` : 'none',
        opacity: block.muted ? 0.55 : 1,
      }}>
      <Icon name={def?.icon ?? 'image'} size={15} style={{ color: selected ? tk.accent.text : tk.text.muted, flexShrink: 0 }} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: tk.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{blockLabel(block)}</span>
        {summary && <span style={{ fontSize: 11.5, color: tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>}
      </span>
      <CostBadge n={passes} grace={grace && passes > 0} />
      <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
        <IconButton icon={upTo === block.id ? 'eye' : 'eyeOff'} size="sm" active={upTo === block.id} data-tx-upto={block.id}
          label={upTo === block.id ? 'Show the whole stack again' : 'Show the picture up to this block'} onClick={() => useTextureLab.getState().setUpTo(upTo === block.id ? null : block.id)} />
        <MuteToggle muted={!!block.muted} what={blockLabel(block)} onToggle={() => editBlock(block.id, b => { b.muted = !b.muted; })} />
      </span>
    </div>
  );
}

function AddMenu({ after, onDone }: { after: string | null; onDone: () => void }) {
  const tk = useTokens();
  const costs = useMemo(() => addCosts(after), [after]);
  const tile = (def: BlockDef, c: AddCost | undefined) => (
    <button key={def.type} type="button" data-tx-add={def.type} disabled={c?.locked}
      title={c?.locked ? `Locked: it would need ${c.total} passes, and 10 is the most. Remove or mute a block that uses passes first.` : `${def.line}.${c?.grace ? ' Uses a grace pass: the preview draws at lower quality.' : ''}`}
      onClick={() => { if (addBlock(def.type, after)) onDone(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '6px 7px', border: 0, borderRadius: radius.sm, textAlign: 'left', font: 'inherit',
        background: tk.bg.field, color: c?.locked ? tk.text.disabled : tk.text.primary, cursor: c?.locked ? 'not-allowed' : 'pointer', minWidth: 0,
      }}>
      <Icon name={def.icon} size={14} style={{ color: tk.text.muted, flexShrink: 0 }} />
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{def.label}</span>
        <span style={{ fontSize: 11, color: tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{def.line}</span>
      </span>
      <CostBadge n={c?.adds ?? 0} grace={c?.grace} locked={c?.locked} title={c?.locked ? 'Locked: past 10 passes' : c?.adds ? `Adds ${c.adds} pass${c.adds === 1 ? '' : 'es'}${c.grace ? ' (in the grace zone: lower quality)' : ''}` : 'Adds no pass'} />
    </button>
  );
  return (
    <div data-tx-add-menu style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, borderRadius: radius.control, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
      {BLOCK_GROUPS.map(g => (
        <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>{g.label}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {BLOCKS.filter(b => b.group === g.id).map(b => tile(b, costs.get(b.type)))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stack() {
  const tk = useTokens();
  const spec = useTextureLab(s => s.spec);
  const selected = useTextureLab(s => s.selected);
  const passes = useBlockPasses();
  const total = Object.values(passes).reduce((a, b) => a + b, 0);
  const grace = useUsedNow() > MAX_PASSES;
  const [adding, setAdding] = useState(false);
  const after = selected !== 'source' && spec.blocks.some(b => b.id === selected) ? selected : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 10px' }}>
      <StudioLabel>Source</StudioLabel>
      <div data-tx-source-row onClick={() => useTextureLab.getState().select('source')}
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 6, borderRadius: radius.control, cursor: 'pointer', marginBottom: 8,
          background: selected === 'source' ? tk.bg.selected : 'transparent', boxShadow: selected === 'source' ? `inset 0 0 0 1px ${tk.accent.base}` : 'none' }}>
        <SourceThumb source={spec.source} />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{sourceName(spec.source)}</span>
          <span style={{ fontSize: 11.5, color: tk.text.muted }}>{spec.source.kind === 'ball' ? 'a video' : spec.source.kind === 'node' ? 'from the graph' : 'a photo'}</span>
        </span>
      </div>
      <StudioLabel meta={`${total} pass${total === 1 ? '' : 'es'}`}>Stack</StudioLabel>
      {!spec.blocks.length && <BuilderNote style={{ padding: '2px 6px 6px' }}>No tools yet: add one, or pick a preset below.</BuilderNote>}
      {spec.blocks.map((b, i) => <StackRow key={b.id} block={b} index={i} passes={passes[b.id] ?? 0} grace={grace} />)}
      <Button size="sm" variant={adding ? 'secondary' : 'ghost'} icon={adding ? 'close' : 'plus'} data-tx-add-open onClick={() => setAdding(a => !a)} style={{ marginTop: 4, justifyContent: 'flex-start' }}>
        {adding ? 'Close' : after ? 'Add a tool after this one' : 'Add a tool'}
      </Button>
      {adding && <AddMenu after={after} onDone={() => setAdding(false)} />}
    </div>
  );
}

/** Whether the graph is in the grace zone (re-read when the graph changes). */
function useUsedNow(): number {
  const nodes = useNodeGraphStore(s => s.nodes);
  return useMemo(() => passBudget(nodes).used, [nodes]);
}

// ── The inspector (right) ────────────────────────────────────────────────────

/** One setting of the block's node, as its card draws it. */
function ParamRow({ block, k, role = 'main', type, params, set }: { block: TxBlock; k: string; role?: string; type: string; params: Params; set: (k: string, v: unknown) => void }) {
  const pd = defsOf(type)[k];
  const def = defaultsOf(type)[k];
  if (!pd || !visibleNow(pd, params, type)) return null;
  const attrs = { 'data-tx-param': `${block.id}.${role}.${k}` };
  switch (pd.type) {
    case 'float': case 'int':
      return <div {...attrs}><NumRow label={pd.label} hint={pd.hint} value={num(params[k], num(def, 0))} min={pd.min ?? 0} max={pd.max ?? 1} step={pd.step ?? 0.01}
        integer={pd.type === 'int' || pd.step === 1} defaultValue={typeof def === 'number' ? def : undefined} rangeKey={`texturelab:${block.type}:${k}`}
        lazyParam={playParam(block.id, k, role)} onChange={v => set(k, v)} /></div>;
    case 'select':
      return <div {...attrs}><Row label={pd.label} hint={pd.hint}><Select ariaLabel={pd.label} value={String(params[k] ?? def ?? '')} options={pd.options ?? []} onChange={v => set(k, v)} /></Row></div>;
    case 'bool':
      return <div {...attrs}><Row label={pd.label} hint={pd.hint}><Toggle checked={params[k] === true || params[k] === 'true'} onChange={on => {
        if (on) for (const [pk, pv] of Object.entries(switchOnPatch(k, pd, params, defaultsOf(type)))) set(pk, pv); else set(k, false);
      }} /></Row></div>;
    case 'vec3color':
      return <div {...attrs}><ColourRow label={pd.label} hint={pd.hint} value={(Array.isArray(params[k]) ? params[k] : def) as [number, number, number]} onChange={v => set(k, v)} /></div>;
    default: return null;
  }
}

/** The node's settings, by its card's sections: the first open, the rest folded with a summary. */
function Sections({ block }: { block: TxBlock }) {
  const defs = defsOf(block.type);
  const groups = useMemo(() => {
    const out: Array<{ title: string; keys: string[] }> = [];
    for (const [k, pd] of Object.entries(defs as Record<string, ParamDef>)) {
      if (pd.type === 'string') continue;
      const title = pd.section ?? 'Settings';
      let g = out.find(x => x.title === title);
      if (!g) { g = { title, keys: [] }; out.push(g); }
      g.keys.push(k);
    }
    return out;
  }, [defs]);
  const set = (k: string, v: unknown) => editBlock(block.id, b => { b.params[k] = v; }, `${block.id}:${k}`);
  const shown = groups.filter(g => g.keys.some(k => { const pd = defs[k]; return pd && visibleNow(pd, block.params, block.type); }));
  return <>{shown.map((g, i) => (
    <Card key={`${block.id}:${g.title}`} id={`texturelab:${block.type}:${g.title}`} title={g.title} defaultOpen={i === 0}
      summary={summarizeSection(g.keys, defs, block.params, defaultsOf(block.type)).text}>
      {g.keys.map(k => <ParamRow key={k} block={block} k={k} type={block.type} params={block.params} set={set} />)}
    </Card>
  ))}</>;
}

function DepthModelNote() {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(() => depthModelReady());
  const offer = depthModelOffer();
  return (
    <div data-tx-depth-model style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <BuilderNote>{ready ? 'Depth runs on this device. The first frames take a moment.' : `Depth runs on this device with ${offer.name}, a one-time ${offer.mb} MB download. Until then it shows black. Nothing is sent anywhere.`}</BuilderNote>
      {!ready && <Button size="sm" disabled={busy} onClick={() => { setBusy(true); void downloadGenerateModel().then(ok => { setBusy(false); setReady(ok || depthModelReady()); }); }}>
        {busy ? 'Downloading…' : `Download (${offer.mb} MB)`}
      </Button>}
    </div>
  );
}

function BlockPanel({ block, index, count, passes }: { block: TxBlock; index: number; count: number; passes: number }) {
  const tk = useTokens();
  const def = blockDef(block.type)!;
  const view = viewOf(def, block.view);
  const curvesNow = block.type === 'curves' ? CURVES_PRESETS.find(p => { const q = curvesPresetParams(p.value); return q && Object.entries(q).every(([k, v]) => JSON.stringify(block.params[k]) === JSON.stringify(v)); })?.value ?? '' : '';
  return (
    <div data-tx-panel={block.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name={def.icon} size={18} style={{ color: tk.text.muted, marginTop: 2 }} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 15, fontWeight: 650 }}>{def.label}</b>
          <span style={{ fontSize: 12, color: tk.text.muted }}>{def.line} · {passes ? `${passes} pass${passes === 1 ? '' : 'es'}` : 'no passes'}</span>
        </span>
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
          <IconButton icon="chevU" size="sm" label="Move up" disabled={index === 0} onClick={() => moveBlock(block.id, -1)} />
          <IconButton icon="chevD" size="sm" label="Move down" disabled={index >= count - 1} onClick={() => moveBlock(block.id, 1)} />
          <IconButton icon="copy" size="sm" label="Duplicate" onClick={() => duplicateBlock(block.id)} />
          <IconButton icon="trash" size="sm" tone="danger" label="Remove" data-tx-remove={block.id} onClick={() => removeBlock(block.id)} />
        </span>
      </span>
      {def.views.length > 1 && (
        <Row label="Show" hint="Which of its outputs goes on down the stack.">
          <span data-tx-view={view.id}><Segmented size="sm" ariaLabel="Which output" value={view.id} wrap options={def.views.map(v => ({ value: v.id, label: v.label }))}
            onChange={v => editBlock(block.id, b => { b.view = v; })} /></span>
        </Row>
      )}
      <div data-tx-param={`${block.id}.amount`}>
        <NumRow label="Amount" hint="How much of the block's result: 0 is the picture as it came in." value={block.amount} min={0} max={1} step={0.01} defaultValue={1}
          rangeKey="texturelab:amount" lazyParam={playParam(block.id, 't', 'mix')} onChange={v => editBlock(block.id, b => { b.amount = v; }, `${block.id}:amount`)} />
      </div>
      {def.needsModel && <DepthModelNote />}
      {block.type === 'curves' && (
        <Row label="Curve" hint="The tone curve (drag its points on the Curves card after Done).">
          <Select ariaLabel="Curve" value={curvesNow} options={[...(curvesNow ? [] : [{ value: '', label: 'Your own curve' }]), ...CURVES_PRESETS.filter(p => p.value !== 'linear').map(p => ({ value: p.value, label: p.label }))]}
            onChange={v => editBlock(block.id, b => { Object.assign(b.params, curvesPresetParams(v) ?? {}); })} />
        </Row>
      )}
      {def.special === 'flood' && (
        <div data-tx-param={`${block.id}.seed.level`}>
          <NumRow label="What counts as a shape" hint="The brightness a part needs to be outlined: higher keeps fewer, brighter shapes."
            value={num(block.aux?.seed?.level, 0.55)} min={0} max={1} step={0.01} defaultValue={0.55} rangeKey="texturelab:seed"
            lazyParam={playParam(block.id, 'level', 'seed')} onChange={v => editBlock(block.id, b => { b.aux = { ...(b.aux ?? {}), seed: { ...(b.aux?.seed ?? {}), level: v } }; }, `${block.id}:seed`)} />
        </div>
      )}
      <Sections block={block} />
    </div>
  );
}

function SourcePanel() {
  const tk = useTokens();
  const spec = useTextureLab(s => s.spec);
  const target = useTextureLab(s => s.targetId);
  // A string, so the selector's value is stable (a new array each time would re-render without end).
  const picsKey = useNodeGraphStore(s => JSON.stringify(textureNodes(s.nodes).filter(nd => nd.id !== target && !String(nd.params._txRole ?? '')).map(nd => ({ id: nd.id, label: texNodeLabel(nd) }))));
  const inGraph = useMemo(() => JSON.parse(picsKey) as Array<{ id: string; label: string }>, [picsKey]);
  // What the Output showed before Texture Lab opened (the graph's own picture).
  const shown = useMemo(() => {
    const base = sceneDraftBase() ?? [];
    const out = base.find(nd => (nd.type === 'output' || nd.type === 'vec4Output') && nd.inputs.color?.connection);
    const c = out?.inputs.color.connection;
    const from = c ? base.find(nd => nd.id === c.nodeId) : undefined;
    return c && from && !String(from.params._txRole ?? '') ? { nodeId: c.nodeId, output: c.outputKey } : null;
  }, []);
  const setSource = (s: TxSource) => { if (editLab(d => { d.source = s; }, { structural: true })) useTextureLab.getState().select('source'); };
  const tile = (key: string, s: TxSource, label: string, active: boolean) => (
    <button key={key} type="button" data-tx-source={key} onClick={() => setSource(s)}
      style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 5, border: 0, borderRadius: radius.control, cursor: 'pointer', font: 'inherit', textAlign: 'left',
        background: active ? tk.bg.selected : tk.bg.field, boxShadow: active ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none', color: tk.text.primary }}>
      <SourceThumb source={s} size={52} />
      <span style={{ fontSize: 12, fontWeight: 550 }}>{label}</span>
    </button>
  );
  const k = spec.source.kind;
  return (
    <div data-tx-panel="source" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ fontSize: 15, fontWeight: 650 }}>Source</b>
        <span style={{ fontSize: 12, color: tk.text.muted }}>The picture the stack works on</span>
      </span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
        {tile('room', { kind: 'room' }, 'Room and cat', k === 'room')}
        {tile('walkway', { kind: 'walkway' }, 'Walkway cat', k === 'walkway')}
        {tile('ball', { kind: 'ball' }, 'Ball action', k === 'ball')}
      </div>
      {(inGraph.length > 0 || shown) && (
        <Card id="texturelab:source:graph" title="From the graph" defaultOpen={k === 'node'} summary={k === 'node' ? sourceName(spec.source) : `${inGraph.length + (shown ? 1 : 0)} to pick from`}>
          {shown && <Button size="sm" variant={k === 'node' && spec.source.nodeId === shown.nodeId ? 'primary' : 'secondary'} onClick={() => setSource({ kind: 'node', nodeId: shown.nodeId, output: shown.output, name: 'What the Output showed' })}>What the Output showed</Button>}
          {inGraph.map(p => (
            <Button key={p.id} size="sm" variant={k === 'node' && spec.source.nodeId === p.id ? 'primary' : 'secondary'} onClick={() => setSource({ kind: 'node', nodeId: p.id, name: p.label })}>{p.label}</Button>
          ))}
        </Card>
      )}
      <Card id="texturelab:source:yours" title="Your picture" defaultOpen={false} summary="Upload, paste or the library">
        <PictureWays graph={false} shader={false} onPicked={p => setSource({ kind: 'node', nodeId: p.nodeId, name: p.source.name })} />
      </Card>
      {k === 'ball' && <BuilderNote>The Ball action clip plays in a loop. Trails, Change and Optical Flow need a moving picture.</BuilderNote>}
    </div>
  );
}

function Inspector() {
  const spec = useTextureLab(s => s.spec);
  const selected = useTextureLab(s => s.selected);
  const passes = useBlockPasses();
  const i = spec.blocks.findIndex(b => b.id === selected);
  return (
    <div data-inspector={selected} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 14px 24px' }}>
      {i < 0 ? <SourcePanel /> : <BlockPanel block={spec.blocks[i]} index={i} count={spec.blocks.length} passes={passes[spec.blocks[i].id] ?? 0} />}
    </div>
  );
}

/** The pass budget, always shown here: "Passes 3/8", amber with grace words past 8, red past 10. */
function LabPasses() {
  const tk = useTokens();
  const used = useUsedNow();
  const b = { used, max: MAX_PASSES };
  const level = budgetLevel(used);
  const colour = level === 'over' ? tk.status.danger : level === 'grace' || level === 'warn' ? tk.status.warningText : tk.text.secondary;
  return (
    <span data-tx-passes={used} data-level={level} title={`${budgetTip(b)}. ${HARD_MAX_PASSES} is the most: past it, tools that need a pass are locked.${level === 'grace' ? ` (${graceWords(b)})` : ''}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px', borderRadius: 13, flexShrink: 0, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
        color: colour, background: level === 'grace' ? 'rgba(234,170,40,0.14)' : tk.bg.field }}>
      Passes {used}/{MAX_PASSES}
      {level === 'grace' && <span style={{ fontWeight: 500 }}>· ½ quality{used >= HARD_MAX_PASSES ? ', locked' : ''}</span>}
    </span>
  );
}

// ── Viewport, presets ────────────────────────────────────────────────────────

/** The before / after divider over the picture, dragged across it. */
function SplitHandle({ image }: { image: ViewRect }) {
  const tk = useTokens();
  const split = useTextureLab(s => s.split);
  const drag = useRef(false);
  if (split === null) return null;
  const x = image.x + image.w * split;
  const move = (clientX: number, el: HTMLElement) => {
    const r = el.parentElement!.getBoundingClientRect();
    useTextureLab.getState().setSplit(Math.max(0.02, Math.min(0.98, (clientX - r.left - image.x) / image.w)));
  };
  const label: CSSProperties = { position: 'absolute', top: image.y + 10, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: 'rgba(13,13,18,0.6)', color: '#fff', pointerEvents: 'none' };
  return (
    <>
      <span style={{ ...label, left: image.x + 10 }}>Before</span>
      <span style={{ ...label, right: `calc(100% - ${image.x + image.w - 10}px)` }}>After</span>
      <div data-tx-split role="slider" aria-label="Before and after divider" aria-valuenow={Math.round(split * 100)} aria-valuemin={0} aria-valuemax={100} tabIndex={0}
        onPointerDown={e => { drag.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (drag.current) move(e.clientX, e.currentTarget); }}
        onPointerUp={() => { drag.current = false; }}
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') useTextureLab.getState().setSplit(Math.max(0.02, Math.min(0.98, split + (e.key === 'ArrowLeft' ? -0.02 : 0.02)))); }}
        style={{ position: 'absolute', left: x - 14, top: image.y, width: 28, height: image.h, cursor: 'ew-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}>
        <span style={{ width: 26, height: 26, borderRadius: 13, background: '#f2f2f2', boxShadow: '0 1px 4px rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.secondary }}>
          <Icon name="bidir" size={14} />
        </span>
      </div>
    </>
  );
}

const LOOK_OF: Record<string, PictureLook> = { thermal: 'thermal', ink: 'ink', trails: 'trails', relief: 'relief' };

function Presets() {
  const spec = useTextureLab(s => s.spec);
  const offered = useMemo(() => stripOf(TX_PRESETS, TEXTURE_STRIP_KEYS), []);
  const [pics, setPics] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void Promise.all(offered.map(async p => [p.key, await lookThumb(LOOK_OF[p.key] ?? 'none')] as const)).then(r => { if (live) setPics(Object.fromEntries(r)); });
    return () => { live = false; };
  }, [offered]);
  const now = useMemo(() => presetNow(spec), [spec]);
  return (
    <StripRow>
      {offered.map(p => (
        <PresetCard key={p.key} id={p.key} label={p.label} hint={`${p.blurb} Your picture stays.`} src={pics[p.key] || null} active={now === p.key}
          onClick={() => {
            // A preset adds passes: the lock may refuse it (with its toast).
            const next = withPreset(useTextureLab.getState().spec, p.key);
            if (editLab(d => { d.blocks = next.blocks; }, { structural: true })) useTextureLab.getState().select(next.blocks[0]?.id ?? 'source');
          }} />
      ))}
      <UserPresets kind="texture" noun="texture stack" getRecipe={() => specToPresetText(useTextureLab.getState().spec)}
        onLoad={text => { const s = presetTextToSpec<TextureLabSpec>(text); if (s) useTextureLab.getState().replace(normalizeSpec({ ...s, source: useTextureLab.getState().spec.source })); }} />
    </StripRow>
  );
}

export function TextureLab() {
  const undo = useTextureLab(s => s.undo);
  const redo = useTextureLab(s => s.redo);
  const canUndo = useTextureLab(s => s.past.length > 0);
  const canRedo = useTextureLab(s => s.future.length > 0);
  const seed = useTextureLab(s => s.surpriseSeed);
  const split = useTextureLab(s => s.split);
  const upTo = useTextureLab(s => s.upTo);
  const line = useTextureLab(s => stackLine(s.spec));
  const upToLabel = useTextureLab(s => { const b = s.spec.blocks.find(x => x.id === s.upTo); return b ? blockLabel(b) : ''; });
  useLiveSync();

  // ⌘Z / ⌘⇧Z undo the builder (the graph follows), not the graph's own history.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'))) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) useTextureLab.getState().redo(); else useTextureLab.getState().undo();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const overlay = (box: { image: ViewRect }): ReactNode => (
    <>
      <SplitHandle image={box.image} />
      {upTo && (
        <span data-tx-upto-note style={{ position: 'absolute', left: box.image.x + 10, bottom: `calc(100% - ${box.image.y + box.image.h - 10}px)`, padding: '3px 9px', borderRadius: 10, fontSize: 11.5, fontWeight: 600, background: 'rgba(13,13,18,0.7)', color: '#fff' }}>
          Up to {upToLabel} · <button type="button" onClick={() => useTextureLab.getState().setUpTo(null)} style={{ border: 0, background: 'none', color: '#9cc2ff', cursor: 'pointer', font: 'inherit', padding: 0 }}>show all</button>
        </span>
      )}
    </>
  );

  return (
    <StudioShell prefsKey="texture-lab" icon="image" title="Texture Lab" crumb={<SceneCrumb kind="texture" onBack={backToSceneKinds} />}
      kind={line}
      onClose={closeTextureLab}
      onEscape={() => { if (useTextureLab.getState().upTo) { useTextureLab.getState().setUpTo(null); return true; } return false; }}
      actions={<>
        <IconButton icon="undo" size="sm" label="Undo" shortcut="cmd+z" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" size="sm" label="Redo" shortcut="cmd+shift+z" disabled={!canRedo} onClick={redo} />
        <IconButton icon="layoutSplit" size="sm" active={split !== null} data-tx-split-toggle label={split !== null ? 'Hide the before | after divider' : 'Show before | after'}
          onClick={() => useTextureLab.getState().setSplit(split !== null ? null : 0.5)} />
        <LabPasses />
        <IconButton icon="fn" size="sm" data-open-as-nodes label="Open as nodes: close and show the stack's nodes, every one with a note" onClick={openTextureLabAsNodes} />
      </>}
      surprise={
        <SurpriseBar seed={seed} title="A random stack from a new seed: two to four tools, varied, a few passes at most (your picture stays; one undo step)" onSurprise={s => {
          const made = surpriseTextureLab(s, useTextureLab.getState().spec, passesWith);
          useTextureLab.getState().replace(made);
          useTextureLab.getState().setSeed(s);
          useTextureLab.getState().select(made.blocks[0]?.id ?? 'source');
          const current = useTextureLab.getState().spec;
          announceSurprise({
            title: 'Texture Lab surprise', seed: s, message: made.blocks.map(blockLabel).join(' → '),
            reroll: () => { undo(); const again = newSeed(); const m = surpriseTextureLab(again, useTextureLab.getState().spec, passesWith); useTextureLab.getState().replace(m); useTextureLab.getState().setSeed(again); },
            undo: () => undo(),
            stillCurrent: () => useTextureLab.getState().spec === current,
          });
        }} />}
      primary={{ label: 'Done', onClick: finishTextureLab, title: 'Put the stack in the graph as nodes and show it (closing without Done leaves the graph as it was)' }}
      nav={<Stack />} navWidth={264}
      inspector={<Inspector />} inspectorWidth={360}
      presets={<Presets />} presetsSummary={<PresetsSummary kind="texture" builtIns={stripOf(TX_PRESETS, TEXTURE_STRIP_KEYS).map(t => t.label)} />}>
      <LiveViewport ownSize clock overlay={overlay} emptyNote="The preview is hidden: show it to see the picture here." />
    </StudioShell>
  );
}
