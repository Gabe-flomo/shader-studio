/**
 * SceneBuilder2DModal — the 2D Scene Builder window (docs/scene-builder-2d-plan.md).
 *
 * Left: the layers (shapes and combine groups, top to bottom = back to front). Middle: the tabs
 * (Space, Shapes, Look, Output, Recipe, Templates). Right: a live preview of what Build makes.
 * Build puts the graph on the canvas (or rebuilds the scene it was opened from, keeping the user's
 * own edits where it can); Done closes.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSceneBuilder2D, type Builder2DTab } from '../../sceneBuilder2d/store';
import { buildFromBuilder2D } from '../../sceneBuilder2d/actions';
import {
  COLOUR_BYS, LOOK_MUTES_2D, MAX_DUP, MAX_LEVELS, MOTIONS, OUTPUT_SHOWS, SHAPES, SHAPE_BY_KIND, SPACES, SPACE_BY_KIND, TONE_MODES,
  COMBINE_CHOICES_2D, OP_GLYPH_2D, SHAPE_STYLES, allShapes, findItem, itemName, itemSummary, styleOf, newBlockOp, starterScene, newCombineOp, newDup, newGroup, newMotion, newShape, newSpaceOp, nextId, num, opLabel, spaceSummary,
  type CombineOp, type GlowMode, type GroupSpec, type ShapeStyle, type Item, type LookMute2D, type MotionKind, type ParamDef, type Scene2D, type ShapeSpec, type Show2D, type ToneMode, type Vec2, type Vec3,
} from '../../sceneBuilder2d/spec';
import { DEFAULT_SMOOTH_K, parseRecipe2D, printRecipe2D } from '../../sceneBuilder2d/recipe';
import { GLOW_TYPES, GLOW_TYPE_LABELS, type GlowType } from '../../nodes/definitions/combiners';
import { MODS, MOD_BY_KIND, checkCustom, modSummary, newMod, type DistMod, type ModKind } from '../../sceneBuilder2d/modify';
import { ExprLineInput } from '../builders/ExprLineInput';
import { paramNameProblem } from '../../sceneBuilder2d/blocks';
import { TEMPLATES_2D, templateScene } from '../../sceneBuilder2d/templates';
import { renderShapeThumbnail, renderSpaceThumbnail } from '../../sceneBuilder2d/thumbnails';
import { BUILT_IN_FUNCTIONS, findFunctions, functionsFromGraphs, type FnEntry, type FnRole } from '../../sceneBuilder2d/functions';
import { GRID_LABELS } from '../../sceneBuilder2d/grid';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { BuilderLabel, BuilderNote, BuilderWindow } from '../builders/BuilderWindow';
import { focusRecipeEditor, useBuilderRecipeRequest } from '../../builders/windows';
import { Card, NumRow, Row, rgbCss } from '../sceneBuilder/controls';
import { Button, IconButton } from '../ui/Button';
import type { IconName } from '../ui/iconPaths';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Preview2D, compileScene2D } from './Preview2D';
import { StudioNavItem, StudioShell } from '../builders/studio/StudioShell';
import { usePhoneDialog } from '../ui/phoneDialog';
import { DepthTab } from './DepthTab';
import { BlockEditor, BlockLibrary, CombineEditor, SpaceView, WarpCanvas } from './SpaceBlocks';
import { blockMap, combineMap, emptyBlock, type CombineSpec, type SpaceBlock } from '../../sceneBuilder2d/blocks';
import { BLOCK_BY_ID } from '../../sceneBuilder2d/blockLibrary';
import { SurpriseBar } from '../surprise/SurpriseBar';
import { announceSurprise } from '../surprise/announce';
import { newSeed } from '../../lib/surprise';
import { SCENE_WINDOW, SceneCrumb } from '../builders/SceneCrumb';
import { useThrottled } from '../builders/useBuilderPreview';
import { BuilderSlider } from '../builders/BuilderSlider';
import { finishBuilder } from '../../builders/finish';
import { scene2dBuildIds } from '../../builders/finishScenes';
import { TexturePicker } from '../builders/TexturePicker';
import { MUTED_DIM, MuteToggle, MutedTag } from '../builders/MuteToggle';
import { soloIn, soloKeys } from '../../builders/mute';
import { PIECES_LABELS, PIECES_MOVES, PIECES_SIZE_BYS, defaultPieces, startPieces, type PiecesSpec } from '../../sceneBuilder2d/pieces';
import { PIECE_SHAPES } from '../../nodes/definitions/pieces';
import { FIT_LABELS, TEX_FITS, newTexUse, withSource, type TexFit, type TexSource, type TexUse } from '../../builders/textures';
import { find2dBuild } from '../../sceneBuilder2d/apply';
import { paletteLabel, paletteSwatches, swatchGradient } from '../../builders/look/palette';
import { GRADE_BY_KIND, GRADE_KINDS, gradeParamTarget } from '../../builders/look/grade';
import { FX_KINDS, MAX_FX_PASSES, fxParamTarget } from '../../builders/look/effects';
import { buildScene2D } from '../../sceneBuilder2d/build';
import type { StackItem } from '../../builders/look/stack';
import { StackCards, type LazyParam } from '../builders/look/StackCards';
import { PaletteCardBody, SlotColourRow } from '../builders/look/PaletteCard';

const TABS: Array<{ id: Builder2DTab; label: string; icon: IconName; gapBefore?: boolean }> = [
  { id: 'space', label: 'Space', icon: 'wave' },
  { id: 'shapes', label: 'Shapes', icon: 'mask' },
  { id: 'combine', label: 'Combine', icon: 'link' },
  { id: 'modify', label: 'Modify', icon: 'sliders' },
  { id: 'depth', label: 'Depth', icon: 'layers' },
  { id: 'effects', label: 'Effects', icon: 'spark' },
  { id: 'look', label: 'Look', icon: 'sun' },
  { id: 'output', label: 'Output', icon: 'eye' },
  { id: 'recipe', label: 'Recipe', icon: 'text', gapBefore: true },
  { id: 'templates', label: 'Templates', icon: 'presets' },
];

/** What the look sliders reset to on double-click: a new scene's settings. */
const DEFAULT_SCENE_2D = starterScene();

const edit = (fn: (d: Scene2D) => void, key?: string) => useSceneBuilder2D.getState().edit(fn, key);

/** A layer's mute (builders/mute.ts): one undo step; Alt-click solos it among its siblings. */
const itemMute = (id: string, what: string) => ({
  onToggle: () => edit(d => { const f = findItem(d, id); if (f) f.item.muted = !f.item.muted; }),
  onSolo: () => edit(d => { const f = findItem(d, id); if (f) soloIn(f.parent ? f.parent.children : d.layers, id); }),
  what,
});
/**
 * Two items joined in a new combine: the first's place in the list, its style and glow; the colours
 * blended from the shapes' own by the smooth weight (`mix`), each child keeping its colour.
 */
function joinedGroup(d: Scene2D, op: CombineOp, k: number, a: Item, b: Item): GroupSpec {
  return newGroup(nextId(d, 'g'), { op, k, color: a.color, glow: a.glow || b.glow, style: a.style ?? 'filled', mix: true, children: [a, b] });
}

/** The seven combine choices as picture buttons; `value` marks the current one. */
function CombineButtons({ value, onPick, label }: { value?: { op: CombineOp; k: number } | null; onPick: (op: CombineOp, smooth: boolean) => void; label: string }) {
  const tk = useTokens();
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {COMBINE_CHOICES_2D.map(ch => {
        const on = !!value && value.op === ch.op && (ch.op === 'xor' || (value.k > 0) === ch.smooth);
        return (
          <button key={ch.key} type="button" data-combine-op={ch.key} aria-pressed={on} title={`${ch.label}: ${ch.blurb}`} onClick={() => onPick(ch.op, ch.smooth)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', border: 0, borderRadius: radius.md, cursor: 'pointer',
              background: on ? tk.bg.selected : tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.ui}` }}>
            <span style={{ font: `700 13px ${fontFamily.mono}`, color: tk.accent.text, minWidth: 18, textAlign: 'center' }}>{ch.glyph}</span>{ch.label}
          </button>
        );
      })}
    </div>
  );
}

/** A look effect's mute: one undo step; Alt-click solos it among the look's effects. */
const lookMute = (key: LookMute2D, what: string, muted: boolean) => ({
  muted, what,
  onToggle: () => edit(d => { d.look.mute = { ...d.look.mute, [key]: !d.look.mute?.[key] }; }),
  onSolo: () => edit(d => { d.look.mute = soloKeys(d.look.mute ?? {}, LOOK_MUTES_2D, key); }),
});

// ── Small pieces ──────────────────────────────────────────────────────────────

/** A thumbnail from an RGBA buffer (thumbnails.ts), drawn once per key. */
function Thumb({ make, size = 44, k }: { make: () => Uint8ClampedArray; size?: number; k: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    try {
      const px = make();
      const img = new ImageData(new Uint8ClampedArray(px), size, size);
      ctx.putImageData(img, 0, 0);
    } catch { /* a thumbnail is a nicety */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw when the key changes
  }, [k, size]);
  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size, borderRadius: 6, display: 'block', flexShrink: 0 }} />;
}

function Vec2Row({ label, value, min, max, step = 0.01, onChange, hint, defaultValue, rangeKey, lazyParam }: {
  label: ReactNode; value: Vec2; min: number; max: number; step?: number; onChange: (v: Vec2) => void; hint?: string; defaultValue?: Vec2;
  /** Remembers a typed-wider range per axis (`${rangeKey}:X`). */
  rangeKey?: string;
  /** The built node's param for an axis, found when the slider's menu opens (right-click → Play). */
  lazyParam?: (axis: 0 | 1) => LazyParam;
}) {
  const tk = useTokens();
  return (
    <Row label={label} hint={hint}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        {(['X', 'Y'] as const).map((ax, i) => (
          <div key={ax} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span style={{ font: `600 10.5px ${fontFamily.mono}`, color: tk.text.faint, width: 10 }}>{ax}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <NumOnly value={value[i]} min={min} max={max} step={step} label={`${typeof label === 'string' ? label : 'value'} ${ax}`} defaultValue={defaultValue?.[i]}
                rangeKey={rangeKey && `${rangeKey}:${ax}`} lazyParam={lazyParam?.(i as 0 | 1)}
                onChange={n => { const next = [...value] as Vec2; next[i] = n; onChange(next); }} />
            </div>
          </div>
        ))}
      </div>
    </Row>
  );
}

function NumOnly({ value, min, max, step, onChange, label, defaultValue, rangeKey, lazyParam }: {
  value: number; min: number; max: number; step: number; onChange: (n: number) => void; label: string; defaultValue?: number; rangeKey?: string; lazyParam?: LazyParam;
}) {
  return <BuilderSlider value={value} min={min} max={max} step={step} onChange={onChange} ariaLabel={label} defaultValue={defaultValue} rangeKey={rangeKey} lazyParam={lazyParam} />;
}

/** One catalogue setting (number or x/y pair) bound to a value map. */
function ParamControl({ p, value, onChange, keyBase }: { p: ParamDef; value: number | Vec2 | string | undefined; onChange: (v: number | Vec2) => void; keyBase: string }) {
  if (Array.isArray(p.def)) {
    const v = Array.isArray(value) ? value as Vec2 : [...p.def] as Vec2;
    return <Vec2Row label={p.label} hint={p.hint} value={v} min={p.min} max={p.max} step={p.step} onChange={onChange} defaultValue={p.def as Vec2}
      rangeKey={`2d:${keyBase}:${p.key}`} lazyParam={axis => play2dAny(keyBase, [`${p.key}${'XY'[axis]}`, 'xy'[axis]])} />;
  }
  const v = typeof value === 'number' ? value : p.def;
  return <NumRow label={p.label} hint={p.hint} value={v} min={p.min} max={p.max} step={p.step} unit={p.deg ? '°' : undefined} integer={p.step === 1} onChange={onChange} defaultValue={p.def}
    rangeKey={`2d:${keyBase}:${p.key}`} lazyParam={play2dAny(keyBase, [p.key])} />;
}

const tile = (tk: ReturnType<typeof useTokens>, on = false): React.CSSProperties => ({
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 6, border: 0, borderRadius: radius.md, cursor: 'pointer',
  background: on ? tk.bg.selected : tk.bg.field, color: tk.text.secondary, font: `500 11px ${fontFamily.ui}`, width: 72,
});

// ── Left: the layers ──────────────────────────────────────────────────────────

function LayerList() {
  const tk = useTokens();
  const scene = useSceneBuilder2D(s => s.scene);
  const selectedId = useSceneBuilder2D(s => s.selectedId);
  const select = useSceneBuilder2D(s => s.select);
  const rows: Array<{ it: Item; depth: number }> = [];
  const walk = (items: Item[], depth: number) => { for (const it of items) { rows.push({ it, depth }); if (it.type === 'group') walk(it.children, depth + 1); } };
  walk(scene.layers, 0);
  const sel = selectedId ? findItem(scene, selectedId) : null;

  const move = (dir: -1 | 1) => edit(d => {
    const f = selectedId ? findItem(d, selectedId) : null;
    if (!f) return;
    const list = f.parent ? f.parent.children : d.layers;
    const j = f.index + dir;
    if (j < 0 || j >= list.length) return;
    [list[f.index], list[j]] = [list[j], list[f.index]];
  });
  const removeId = (id: string) => edit(d => {
    const f = findItem(d, id);
    if (!f) return;
    (f.parent ? f.parent.children : d.layers).splice(f.index, 1);
  });
  const remove = () => { if (selectedId) removeId(selectedId); };
  const groupWithNext = (op: CombineOp) => edit(d => {
    const f = selectedId ? findItem(d, selectedId) : null;
    if (!f) return;
    const list = f.parent ? f.parent.children : d.layers;
    const next = list[f.index + 1];
    if (!next) return;
    list.splice(f.index, 2, joinedGroup(d, op, 0, f.item, next));
  });
  const ungroup = () => edit(d => {
    const f = selectedId ? findItem(d, selectedId) : null;
    if (!f || f.item.type !== 'group') return;
    (f.parent ? f.parent.children : d.layers).splice(f.index, 1, ...f.item.children);
  });
  const hasNext = !!sel && (sel.parent ? sel.parent.children : scene.layers).length > sel.index + 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 10px' }}>
      <BuilderLabel meta={`${allShapes(scene).length} shapes`} hint="Layers are painted top to bottom: the last one is on top. A combine joins, cuts or overlaps the shapes inside it.">Layers</BuilderLabel>
      {rows.length === 0 && <BuilderNote>No shapes yet. Pick one on the Shapes tab.</BuilderNote>}
      <div role="listbox" aria-label="Layers" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map(({ it, depth }) => (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button type="button" role="option" aria-selected={it.id === selectedId} onClick={() => select(it.id)}
            onKeyDown={e => { if ((e.key === 'Delete' || e.key === 'Backspace') && it.id === selectedId) { e.preventDefault(); remove(); } }}
            style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: `5px 8px 5px ${8 + depth * 14}px`, border: 0, borderRadius: radius.sm, cursor: 'pointer', textAlign: 'left',
              background: it.id === selectedId ? tk.bg.selected : 'transparent', color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}`, ...(it.muted ? MUTED_DIM : {}) }}>
            {it.type === 'group'
              ? <span title={opLabel(it)} style={{ width: 16, textAlign: 'center', font: `700 13px ${fontFamily.mono}`, color: tk.accent.text }}>{OP_GLYPH_2D[it.op]}</span>
              : <span style={{ width: 12, height: 12, borderRadius: 3, background: rgbCss(it.color), flexShrink: 0, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemName(scene, it)}</span>
            {it.id === selectedId && itemSummary(it) && <span data-layer-summary style={{ fontSize: 11, color: tk.text.faint, whiteSpace: 'nowrap' }}>{itemSummary(it)}</span>}
          </button>
          <MuteToggle muted={!!it.muted} {...itemMute(it.id, `‘${itemName(scene, it)}’`)} />
          {/* Every layer has its remove on its row (Delete removes the selected one too). */}
          <IconButton icon="close" size="sm" tone="danger" label={`Remove ‘${itemName(scene, it)}’ (Delete)`} data-layer-remove={it.id} onClick={() => { select(it.id); removeId(it.id); }} />
          </div>
        ))}
      </div>
      {sel && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <IconButton icon="chevU" label="Move back (earlier)" size="sm" disabled={sel.index === 0} onClick={() => move(-1)} />
          <IconButton icon="chevD" label="Move forward (later)" size="sm" disabled={!hasNext} onClick={() => move(1)} />
          <IconButton icon="trash" label="Delete" size="sm" onClick={remove} />
          {hasNext && <Button size="sm" variant="ghost" onClick={() => groupWithNext('union')} title="Join this and the next layer in a Union (Combine has the others: smooth union, subtract, intersect, xor)">∪ with next</Button>}
          {hasNext && <Button size="sm" variant="ghost" onClick={() => groupWithNext('subtract')} title="Cut the next layer out of this one">− next</Button>}
          {sel.item.type === 'group' && <Button size="sm" variant="ghost" onClick={ungroup}>Ungroup</Button>}
          <Button size="sm" variant="ghost" icon="link" onClick={() => useSceneBuilder2D.getState().setTab('combine')} title="Combine: join, melt, cut or overlap shapes, with a smooth amount">Combine…</Button>
        </div>
      )}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

/** Where functions are found: your saved GLSL and presets (the Code Explorer's collector), the Convert examples, and Custom Function nodes in your saved graphs, the open graph and the examples. */
async function gatherFunctions(): Promise<FnEntry[]> {
  const [{ collectUserDocs }, { localKV }, ex, conv, { useNodeGraphStore }] = await Promise.all([
    import('../../codeExplorer/userCorpus'), import('../../utils/library'), import('../../store/exampleGraphs'), import('../../glslToGraph/examples'), import('../../store/useNodeGraphStore'),
  ]);
  const docs = collectUserDocs(localKV, null);
  const files = [
    ...docs.flatMap(d => d.sources.filter(src => src.mode === 'file').map(src => ({ label: `${d.group.toLowerCase()}: ${d.label}`, code: src.text }))),
    ...Object.entries(conv.CONVERT_EXAMPLES as Record<string, { label?: string; code: string }>).map(([k, e]) => ({ label: `convert example: ${e.label ?? k}`, code: e.code })),
  ];
  const saved: Array<{ label: string; nodes: unknown }> = [];
  for (const key of localKV.keys()) {
    if (!key.startsWith('shader-studio:')) continue;
    try { const v = JSON.parse(localKV.get(key) ?? 'null') as { nodes?: unknown } | null; if (v && Array.isArray(v.nodes)) saved.push({ label: `saved: ${key.slice('shader-studio:'.length)}`, nodes: v.nodes }); } catch { /* not a graph */ }
  }
  const graphs = [
    { label: 'this graph', nodes: useNodeGraphStore.getState().nodes },
    ...saved,
    ...Object.values(ex.EXAMPLE_GRAPHS as Record<string, { label: string; nodes: unknown }>).map(g => ({ label: `example: ${g.label}`, nodes: g.nodes })),
  ];
  return [...findFunctions(files), ...functionsFromGraphs(graphs)];
}

let foundCache: FnEntry[] | null = null;

/** Built-in functions for a role, and on request the ones in your code and the examples. */
function FunctionPicker({ role, onPick }: { role: FnRole; onPick: (f: FnEntry) => void }) {
  const tk = useTokens();
  const [found, setFound] = useState<FnEntry[] | null>(foundCache);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const look = async () => {
    setBusy(true);
    try { foundCache = await gatherFunctions(); setFound(foundCache); } finally { setBusy(false); }
  };
  const mine = (found ?? []).filter(f => f.role === role && (!q || `${f.name} ${f.from}`.toLowerCase().includes(q.toLowerCase())));
  const chip: React.CSSProperties = { display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '6px 9px', border: 0, borderRadius: radius.md, background: tk.bg.field, color: tk.text.primary, cursor: 'pointer', textAlign: 'left', font: `600 11.5px ${fontFamily.mono}`, maxWidth: 230 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {BUILT_IN_FUNCTIONS.filter(f => f.role === role).map(f => (
          <button key={f.name} type="button" title={f.code} style={chip} onClick={() => onPick(f)}>
            {f.name}<span style={{ font: `500 10.5px ${fontFamily.ui}`, color: tk.text.muted }}>{f.blurb}</span>
          </button>
        ))}
      </div>
      {!found
        ? <Button size="sm" variant="ghost" icon="search" disabled={busy} onClick={() => void look()} style={{ alignSelf: 'flex-start' }}>{busy ? 'Looking…' : 'Find more in your code and the examples'}</Button>
        : (
          <>
            <input aria-label="Search functions" placeholder={`${mine.length} ${role === 'space' ? 'vec2 f(vec2 p)' : 'float f(vec2 p)'} functions found: search…`} value={q} onChange={e => setQ(e.target.value)}
              style={{ height: 28, padding: '0 8px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.ui}` }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 220, overflow: 'auto' }}>
              {mine.slice(0, 60).map(f => (
                <button key={`${f.from}:${f.name}`} type="button" title={f.code} style={chip} onClick={() => onPick(f)}>
                  {f.name}<span style={{ font: `500 10.5px ${fontFamily.ui}`, color: tk.text.muted }}>{f.from}</span>
                </button>
              ))}
              {!mine.length && <BuilderNote>None found.</BuilderNote>}
            </div>
          </>
        )}
    </div>
  );
}

function SpaceTab() {
  const tk = useTokens();
  const scene = useSceneBuilder2D(s => s.scene);
  const [hover, setHover] = useState<number | null>(null);
  const move = (i: number, dir: -1 | 1) => edit(d => { const j = i + dir; if (j < 0 || j >= d.space.length) return; [d.space[i], d.space[j]] = [d.space[j], d.space[i]]; });
  const upd = (i: number) => (fn: (b: SpaceBlock) => void, key?: string) => edit(d => { const b = d.space[i]?.block; if (b) fn(b); }, key);
  const updC = (i: number) => (fn: (c: CombineSpec) => void, key?: string) => edit(d => { const c = d.space[i]?.combine; if (c) fn(c); }, key);
  const addBlock = (b: SpaceBlock) => edit(d => { d.space.push(newBlockOp(nextId(d, 'p'), b)); });
  const hoverOp = hover !== null ? scene.space[hover] : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SpaceView ops={scene.space} upTo={hover === null ? null : hover + 1} hoverName={hoverOp ? spaceSummary(hoverOp).label : undefined} />
      {scene.space.map((op, i) => {
        const block = op.kind === 'block' ? op.block : undefined;
        const comb = op.kind === 'combine' ? op.combine : undefined;
        const def = SPACE_BY_KIND[op.kind];
        if (!block && !comb && !def) return null;
        const sum = spaceSummary(op);
        // Mute (builders/mute.ts): bypassed by a live uniform; Alt-click solos it in the stack.
        const mute = { muted: !!op.muted, what: sum.label, onToggle: () => edit(d => { d.space[i].muted = !d.space[i].muted; }), onSolo: () => edit(d => soloIn(d.space, op.id)) };
        const order = <>
          <IconButton icon="chevU" label="Earlier" size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
          <IconButton icon="chevD" label="Later" size="sm" disabled={i === scene.space.length - 1} onClick={() => move(i, 1)} />
        </>;
        // The op's remove: the card's own trash at the end of its header, and Delete while it has focus.
        const drop = () => edit(d => { d.space.splice(i, 1); });
        return (
          <div key={op.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(h => (h === i ? null : h))} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {i > 0 && <span aria-hidden style={{ alignSelf: 'center', font: `600 10.5px ${fontFamily.mono}`, color: tk.text.faint }}>↓ uv</span>}
            {block ? (
              <Card id={`sp2-${op.id}`} onRemove={drop} removeLabel={`Remove ${sum.label}`} defaultOpen title={sum.label} summary={sum.value} mute={mute}
                actions={<>
                  <IconButton icon="link" label="Combine with another block (add, subtract, multiply, blend)" size="sm"
                    onClick={() => edit(d => { const b = d.space[i].block; if (b) d.space[i] = newCombineOp(d.space[i].id, b, emptyBlock(), 'add'); })} />
                  {order}
                </>}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <WarpCanvas map={() => blockMap(block, 1)} k={JSON.stringify(block)} size={72} title="A grid through this block alone" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {block.lib && BLOCK_BY_ID[block.lib] && <BuilderNote>{BLOCK_BY_ID[block.lib].blurb}</BuilderNote>}
                    <BlockEditor block={block} idBase={`sp:${op.id}`} update={upd(i)} />
                  </div>
                </div>
              </Card>
            ) : comb ? (
              <Card id={`sp2-${op.id}`} onRemove={drop} removeLabel={`Remove ${sum.label}`} defaultOpen title={sum.label} summary={sum.value} mute={mute}
                actions={<>
                  <Button size="sm" variant="ghost" title="Undo the combine: A and B become two blocks in a chain (A, then B)"
                    onClick={() => edit(d => { const c = d.space[i].combine; if (!c) return; const id2 = nextId(d, 'p'); d.space.splice(i, 1, newBlockOp(d.space[i].id, c.a), newBlockOp(id2, c.b)); })}>Split</Button>
                  {order}
                </>}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <WarpCanvas map={() => combineMap(comb, 1)} k={JSON.stringify(comb)} size={72} title="A grid through the combine" />
                  <div style={{ flex: 1, minWidth: 0 }}><CombineEditor spec={comb} idBase={`sp:${op.id}`} update={updC(i)} /></div>
                </div>
              </Card>
            ) : def && (
              <Card id={`sp2-${op.id}`} onRemove={drop} removeLabel={`Remove ${sum.label}`} defaultOpen title={def.label} summary={sum.value} actions={order} mute={mute}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <Thumb k={JSON.stringify(op)} make={() => renderSpaceThumbnail(op, 64)} size={64} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <BuilderNote>{op.kind === 'fn' ? `${String(op.values.name)} (${String(op.values.from || 'a function')}): ${def.blurb}` : def.blurb}</BuilderNote>
                    {op.kind === 'fn' && <pre style={{ margin: 0, maxHeight: 140, overflow: 'auto', padding: 8, borderRadius: radius.sm, background: tk.bg.field, font: `500 10.5px/1.5 ${fontFamily.mono}`, color: tk.text.secondary }}>{String(op.values.code ?? '')}</pre>}
                    {def.select && (
                      <Row label={def.select.label}>
                        <Select ariaLabel={def.select.label} value={String(op.values[def.select.key] ?? def.select.def)} options={def.select.options.map(o => ({ value: o, label: o }))}
                          onChange={v => edit(d => { d.space[i].values[def.select!.key] = v; })} />
                      </Row>
                    )}
                    {def.params.map(p => (
                      <ParamControl key={p.key} p={p} keyBase={op.id} value={op.values[p.key]} onChange={v => edit(d => { d.space[i].values[p.key] = v; }, `sp:${op.id}:${p.key}`)} />
                    ))}
                  </div>
                </div>
              </Card>
            )}
          </div>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <BuilderLabel hint="A block is up to three lines like an Expression Block: uv.x, uv.y or uv, then =, +=, -= or *=, then any expression of x, y, uv and t. Blocks chain: each one's uv feeds the next. Link (on a block) combines two blocks instead.">Add a block</BuilderLabel>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" icon="plus" onClick={() => addBlock(emptyBlock())}>Empty block</Button>
      </div>
      <BlockLibrary onPick={addBlock} onPickCombine={c => edit(d => { const op = newCombineOp(nextId(d, 'p'), c.a, c.b, c.mode, c.amount); if (c.my) op.combine!.my = c.my; d.space.push(op); })} />
      <Card id="sp2-builtins" title="Built-in transforms" summary="zoom, rotate, tile, mirror, kaleidoscope… as their own nodes">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SPACES.filter(sp => sp.kind !== 'fn').map(sp => (
            <button key={sp.kind} type="button" title={sp.blurb} style={tile(tk)}
              onClick={() => edit(d => { d.space.push(newSpaceOp(sp.kind, nextId(d, 'p'))); })}>
              <Thumb k={`space:${sp.kind}`} make={() => renderSpaceThumbnail(newSpaceOp(sp.kind, 'x'), 44)} />
              {sp.label}
            </button>
          ))}
        </div>
      </Card>
      <Card id="sp2-functions" title="Add a function" summary="vec2 f(vec2 p[, float t]) from the built-ins, your code and the examples">
        <FunctionPicker role="space" onPick={f => edit(d => { d.space.push(newSpaceOp('fn', nextId(d, 'p'), { name: f.name, code: f.code, timed: f.timed ? 1 : 0, from: f.from })); })} />
      </Card>
    </div>
  );
}

/** Adds a picture to the scene's list (the shared picker's onAdd). */
const addSource = (src: TexSource) => edit(d => { d.textures = withSource(d.textures, src); });

/** A picture use's fit and its tiles / zoom. */
function FitRows({ use, onChange, k }: { use: TexUse; onChange: (fn: (u: TexUse) => void, key?: string) => void; k: string }) {
  return (
    <>
      <Row label="Fit" hint={FIT_LABELS[use.fit].blurb}>
        <Select ariaLabel="Fit" value={use.fit} options={TEX_FITS.map(f => ({ value: f, label: FIT_LABELS[f].label }))} onChange={v => onChange(u => { u.fit = v as TexFit; if (v === 'tile' && u.scale === 1) u.scale = 3; })} />
      </Row>
      <NumRow label={use.fit === 'tile' ? 'Tiles' : 'Zoom'} hint={use.fit === 'tile' ? 'How many times it repeats up the shape.' : 'Above 1 closer.'} value={use.scale} defaultValue={use.fit === 'tile' ? 3 : 1} min={use.fit === 'tile' ? 0.25 : 0.1} max={use.fit === 'tile' ? 16 : 8} onChange={v => onChange(u => { u.scale = v; }, `${k}:scale`)} />
    </>
  );
}

/** A layer's pictures: painted with one (Fill), shown only where one is bright (Mask). */
function PictureCard({ id, it }: { id: string; it: Item }) {
  const sources = useSceneBuilder2D(s => s.scene.textures) ?? [];
  const upd = (fn: (x: Item) => void, key?: string) => edit(d => { const g = findItem(d, id); if (g) fn(g.item); }, key && `${id}:${key}`);
  const picture = it.type === 'shape' && it.kind === 'picture';
  return (
    <Card id={`it2-${id}-picture`} defaultOpen={picture || !!it.fill || !!it.mask} title="Picture" summary={[it.fill ? `painted with ${it.fill.tex}` : '', it.mask ? `mask ${it.mask.tex}` : ''].filter(Boolean).join(' · ') || 'its colour'}>
      <BuilderLabel hint="The picture is read at this layer's own point: it moves, turns and repeats with it, and bends with the Space tab.">{picture ? 'The picture' : 'Fill with a picture'}</BuilderLabel>
      <TexturePicker id={`fill-${id}`} sources={sources} value={it.fill?.tex} onAdd={addSource} startOpen={picture && !it.fill} none={picture ? 'Pick its picture' : 'Its own colour'}
        onChange={name => upd(x => { x.fill = name ? (x.fill ? { ...x.fill, tex: name } : newTexUse(name)) : null; })} />
      {it.fill && <FitRows use={it.fill} k="fill" onChange={(fn, key) => upd(x => { if (x.fill) fn(x.fill); }, key)} />}
      <BuilderLabel hint="The layer (and its glow) only where a picture over the whole frame is bright: a stencil.">Mask with a picture</BuilderLabel>
      <TexturePicker id={`mask-${id}`} sources={sources} value={it.mask?.tex} onAdd={addSource} none="No mask"
        onChange={name => upd(x => { x.mask = name ? { tex: name, cut: x.mask?.cut ?? 0.5, invert: x.mask?.invert ?? false } : null; })} />
      {it.mask && (
        <>
          <NumRow label="Cut" hint="How bright the picture must be for the layer to show." value={it.mask.cut} defaultValue={0.5} min={0} max={1} onChange={v => upd(x => { if (x.mask) x.mask.cut = v; }, 'maskcut')} />
          <Row label="Invert"><Toggle checked={it.mask.invert} onChange={v => upd(x => { if (x.mask) x.mask.invert = v; })} label="Show where the picture is dark" /></Row>
        </>
      )}
    </Card>
  );
}

/** A combine's operator (seven buttons), its smooth amount and its colour. */
function GroupControls({ id, g }: { id: string; g: GroupSpec }) {
  const upd = (fn: (x: GroupSpec) => void, key?: string) => edit(d => { const f = findItem(d, id); if (f?.item.type === 'group') fn(f.item); }, key && `${id}:${key}`);
  return (
    <>
      <BuilderLabel hint="How the shapes inside join. Hover a button for what it does. The smooth ones melt, round or soften where the shapes meet over Smooth.">Combine</BuilderLabel>
      <CombineButtons label="Combine operator" value={g} onPick={(op, smooth) => upd(x => { x.op = op; x.k = op === 'xor' || !smooth ? 0 : x.k > 0 ? x.k : DEFAULT_SMOOTH_K; })} />
      {g.op !== 'xor' && <NumRow label="Smooth" hint="The blend radius k: 0 is the hard edge, above 0 the smooth combine (live: a slider on the combine node, so dragging never recompiles)." value={g.k} defaultValue={0} min={0} max={0.5} step={0.005}
        onChange={v => upd(x => { x.k = v; }, 'k')} lazyParam={play2d(`${id}:op1`, 'k')} />}
      <Row label="Colour" hint="Blend: each shape keeps its own colour and they run into each other by the combine's smooth weight. One colour: the group's.">
        <Toggle checked={!!g.mix} onChange={v => upd(x => { if (v) x.mix = true; else delete x.mix; })} label={g.mix ? 'Blend the shapes\' colours' : 'One colour for the group'} />
      </Row>
    </>
  );
}

function ItemInspector({ id }: { id: string }) {
  const scene = useSceneBuilder2D(s => s.scene);
  const f = findItem(scene, id);
  if (!f) return null;
  const it = f.item;
  const upd = (fn: (x: Item) => void, key?: string) => edit(d => { const g = findItem(d, id); if (g) fn(g.item); }, key && `${id}:${key}`);
  const shapeDef = it.type === 'shape' ? SHAPE_BY_KIND[it.kind] : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card id={`it2-${id}-shape`} defaultOpen title={itemName(scene, it)} summary={it.type === 'group' ? opLabel(it) : shapeDef?.blurb}
        mute={{ muted: !!it.muted, ...itemMute(id, `‘${itemName(scene, it)}’`) }}>
        {it.type === 'group' ? (
          <>
            <GroupControls id={id} g={it} />
          </>
        ) : it.type === 'shape' && it.kind === 'fnshape' ? (
          <>
            <BuilderNote>{it.fn ? `${it.fn.name} (${it.fn.from}).` : 'No function.'} Edit the code on the built node (its helpers) to change the shape.</BuilderNote>
            {it.fn && <pre style={{ margin: 0, maxHeight: 140, overflow: 'auto', padding: 8, borderRadius: radius.sm, background: 'rgba(127,127,127,0.12)', font: `500 10.5px/1.5 ${fontFamily.mono}` }}>{it.fn.code}</pre>}
          </>
        ) : shapeDef?.params.map(p => (
          <ParamControl key={p.key} p={p} keyBase={id} value={(it as ShapeSpec).size[p.key]} onChange={v => upd(x => { if (x.type === 'shape') x.size[p.key] = v; }, `size:${p.key}`)} />
        ))}
        {!f.parent && <Row label="Style" hint={SHAPE_STYLES.map(x => `${x.label}: ${x.blurb}`).join('\n')}>
          <Select ariaLabel="Style" value={styleOf(it)} options={SHAPE_STYLES.map(x => ({ value: x.style, label: x.label }))} onChange={v => upd(x => { x.style = v as ShapeStyle; })} />
        </Row>}
        {!f.parent && !(it.type === 'group' && it.mix) && <SlotColourRow label="Colour" value={it.color} slot={it.slot} swatches={paletteSwatches(scene.look.colour.palette, scene.look.custom)}
          onColour={v => upd(x => { x.color = v; }, 'color')} onSlot={s => upd(x => { if (s == null) delete x.slot; else x.slot = s; })} />}
        {f.parent?.mix && it.type === 'shape' && <SlotColourRow label="Colour" value={it.color} slot={it.slot} swatches={paletteSwatches(scene.look.colour.palette, scene.look.custom)}
          onColour={v => upd(x => { x.color = v; }, 'color')} onSlot={s => upd(x => { if (s == null) delete x.slot; else x.slot = s; })} />}
        {!f.parent && <Row label="Glow"><Toggle checked={it.glow} onChange={v => upd(x => { x.glow = v; })} label="Glows when Look → Glow is Selected" /></Row>}
        {!f.parent && <Row label="Glow type" hint={GLOW_TYPES.map(t => `${GLOW_TYPE_LABELS[t].label}: ${GLOW_TYPE_LABELS[t].blurb}`).join('\n')}>
          <Select ariaLabel="Layer glow type" value={it.glowType ?? ''} options={[{ value: '', label: 'The Look\'s' }, ...GLOW_TYPES.map(t => ({ value: t, label: GLOW_TYPE_LABELS[t].label }))]}
            onChange={v => upd(x => { if (v) x.glowType = v as GlowType; else delete x.glowType; })} />
        </Row>}
      </Card>
      {!f.parent && <PictureCard id={id} it={it} />}
      <Card id={`it2-${id}-place`} title="Place" summary={`at ${it.at.map(n => +n.toFixed(2)).join(', ')} · ${Math.round(it.rot)}° · ×${+it.scale.toFixed(2)}`}>
        <Vec2Row label="Position" value={it.at} min={-2} max={2} onChange={v => upd(x => { x.at = v; }, 'at')} />
        <NumRow label="Rotate" unit="°" value={it.rot} defaultValue={0} min={-180} max={180} step={0.5} onChange={v => upd(x => { x.rot = v; }, 'rot')} />
        <NumRow label="Scale" value={it.scale} defaultValue={1} min={0.05} max={4} onChange={v => upd(x => { x.scale = v; }, 'scale')} />
        <NumRow label="Round" hint="Grows the edge outward, rounding corners." value={it.inflate} defaultValue={0} min={0} max={0.3} step={0.002} onChange={v => upd(x => { x.inflate = v; }, 'inflate')} />
        <NumRow label="Outline only" hint="Above 0: only an outline this thick." value={it.hollow} defaultValue={0} min={0} max={0.2} step={0.002} onChange={v => upd(x => { x.hollow = v; }, 'hollow')} />
      </Card>
      <Card id={`it2-${id}-motion`} title="Motion" summary={it.motion.length ? it.motion.map(m => `${m.kind}${m.muted ? ' (muted)' : ''}`).join(' · ') : 'still'}>
        {it.motion.map((m, mi) => {
          const md = MOTIONS.find(x => x.kind === m.kind)!;
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 6 }}>
              <Row label={<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={m.muted ? MUTED_DIM : undefined}>{md.label}</b>{m.muted && <MutedTag />}</span>}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <MuteToggle muted={!!m.muted} what={`the ${md.label.toLowerCase()}`}
                    onToggle={() => upd(x => { x.motion[mi].muted = !x.motion[mi].muted; })}
                    onSolo={() => upd(x => soloIn(x.motion, m.id))} />
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => upd(x => { x.motion.splice(mi, 1); })}>Remove</Button>
                </div>
              </Row>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...(m.muted ? MUTED_DIM : {}) }}>
              <NumRow label="Speed" hint="Cycles a second." value={m.speed} min={-2} max={2} onChange={v => upd(x => { x.motion[mi].speed = v; }, `m:${m.id}:s`)} />
              {md.amount && <NumRow label={md.amount.label} value={m.amount} min={md.amount.min} max={md.amount.max} onChange={v => upd(x => { x.motion[mi].amount = v; }, `m:${m.id}:a`)} />}
              {md.dir && <NumRow label="Direction" unit="°" value={m.dir} min={0} max={360} step={1} onChange={v => upd(x => { x.motion[mi].dir = v; }, `m:${m.id}:d`)} />}
              <NumRow label="Phase" unit="°" value={m.phase} min={0} max={360} step={1} onChange={v => upd(x => { x.motion[mi].phase = v; }, `m:${m.id}:p`)} />
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {MOTIONS.map(md => (
            <Button key={md.kind} size="sm" variant="ghost" icon="plus" title={md.blurb}
              onClick={() => edit(d => { const g = findItem(d, id); if (g) g.item.motion.push(newMotion(md.kind as MotionKind, nextId(d, 'm'))); })}>{md.label}</Button>
          ))}
        </div>
      </Card>
      <Card id={`it2-${id}-dup`} title="Duplicate"
        mute={it.dup ? { muted: !!it.dup.muted, what: 'the ring of copies', onToggle: () => upd(x => { if (x.dup) x.dup.muted = !x.dup.muted; }) } : undefined}
        summary={it.dup ? `${it.dup.count} copies${it.dup.inner ? ` × ${it.dup.inner.count}` : ''}${it.dup.levels > 1 ? ` · ${it.dup.levels} sizes` : ''}` : 'one'}>
        <Row label="Ring of copies"><Toggle checked={!!it.dup} onChange={v => upd(x => { x.dup = v ? newDup() : null; })} label="Copy it round a circle" /></Row>
        {it.dup && (
          <>
            <NumRow label="Copies" integer value={it.dup.count} min={2} max={MAX_DUP} onChange={v => upd(x => { if (x.dup) x.dup.count = Math.round(v); }, 'dup:c')} />
            <NumRow label="Ring radius" value={it.dup.radius} min={0} max={2} onChange={v => upd(x => { if (x.dup) x.dup.radius = v; }, 'dup:r')} />
            <Row label="Rings of rings"><Toggle checked={!!it.dup.inner} onChange={v => upd(x => { if (x.dup) x.dup.inner = v ? { count: 6, radius: 0.1 } : undefined; })} label="Each copy is itself a ring" /></Row>
            {it.dup.inner && (
              <>
                <NumRow label="Inner copies" integer value={it.dup.inner.count} min={2} max={MAX_DUP} onChange={v => upd(x => { if (x.dup?.inner) x.dup.inner.count = Math.round(v); }, 'dup:ic')} />
                <NumRow label="Inner radius" value={it.dup.inner.radius} min={0} max={1} onChange={v => upd(x => { if (x.dup?.inner) x.dup.inner.radius = v; }, 'dup:ir')} />
              </>
            )}
            <NumRow label="Sizes" hint="Repeat the whole ring at bigger sizes (1: once)." integer value={it.dup.levels} min={1} max={MAX_LEVELS} onChange={v => upd(x => { if (x.dup) x.dup.levels = Math.round(v); }, 'dup:l')} />
            {it.dup.levels > 1 && <NumRow label="Size step" value={it.dup.factor} min={1.1} max={4} onChange={v => upd(x => { if (x.dup) x.dup.factor = v; }, 'dup:f')} />}
          </>
        )}
      </Card>
    </div>
  );
}

export function ShapesTab() {
  const tk = useTokens();
  const selectedId = useSceneBuilder2D(s => s.selectedId);
  const select = useSceneBuilder2D(s => s.select);
  const add = (kind: string) => {
    let id = '';
    edit(d => { id = nextId(d, 's'); d.layers.push(newShape(kind, id, { color: [...DEFAULT_COLOURS[d.layers.length % DEFAULT_COLOURS.length]] as Vec3 })); });
    select(id);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <BuilderLabel hint="Each shape is a distance field (SDF): how far every pixel is from its edge. Click one to add it as a new layer.">Add a shape</BuilderLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SHAPES.filter(sh => sh.kind !== 'fnshape').map(sh => (
          <button key={sh.kind} type="button" title={sh.blurb} style={tile(tk)} onClick={() => add(sh.kind)}>
            <Thumb k={`shape:${sh.kind}`} make={() => renderShapeThumbnail(sh.kind, 44)} />
            {sh.label}
          </button>
        ))}
      </div>
      <BuilderLabel hint="Pictures made of shapes: a picture rebuilt from pieces (a Pieces node), drawn over the layers.">Pictures</BuilderLabel>
      <PiecesCard />
      <OlderGridCard />
      <BuilderLabel hint="A GLSL function float f(vec2 p[, float t]) that measures a shape: negative inside, positive outside. It becomes a Custom Function node.">Function shapes</BuilderLabel>
      <FunctionPicker role="shape" onPick={f => {
        let id = '';
        edit(d => { id = nextId(d, 's'); d.layers.push(newShape('fnshape', id, { name: f.name, fn: { name: f.name, code: f.code, timed: f.timed, from: f.from }, color: [...DEFAULT_COLOURS[d.layers.length % DEFAULT_COLOURS.length]] as Vec3 })); });
        select(id);
      }} />
      {selectedId ? <ItemInspector key={selectedId} id={selectedId} /> : <BuilderNote>Select a layer on the left to change it.</BuilderNote>}
    </div>
  );
}

const DEFAULT_COLOURS: Vec3[] = [[0.35, 0.8, 1], [1, 0.45, 0.7], [1, 0.8, 0.3], [0.5, 1, 0.6], [0.75, 0.55, 1]];

/** Picture in pieces (sceneBuilder2d/pieces.ts): the Pieces node over the layers, with the shared picture picker. */
function PiecesCard() {
  const pieces = useSceneBuilder2D(s => s.scene.pieces);
  const sources = useSceneBuilder2D(s => s.scene.textures) ?? [];
  const set = (fn: (p: PiecesSpec) => void, key?: string) => edit(d => { if (d.pieces) fn(d.pieces); }, key && `pieces:${key}`);
  const D = defaultPieces('');
  return (
    <Card id="pieces2" defaultOpen={!!pieces} title="Picture in pieces"
      mute={pieces ? { muted: !!pieces.muted, what: 'the picture in pieces', onToggle: () => set(p => { p.muted = !p.muted; }) } : undefined} summary={pieces ? `${pieces.tex} · ${pieces.count} ${pieces.shape}s · ${PIECES_LABELS.move[pieces.move].toLowerCase()}` : 'none'}
      onRemove={pieces ? () => edit(d => { d.pieces = null; }) : undefined} removeLabel="Remove the picture in pieces">
      <BuilderNote>A picture rebuilt from pieces, each the picture's colour at its home, drawn over the layers. Move the pieces and the picture moves: they scatter and flow back home.</BuilderNote>
      <TexturePicker id="pieces" sources={sources} value={pieces?.tex} onAdd={addSource} none="No picture in pieces"
        onChange={name => edit(d => { d.pieces = name ? { ...(d.pieces ?? startPieces(name)), tex: name } : null; })} />
      {pieces && (
        <>
          <Row label="Shape">
            <Select ariaLabel="Piece shape" value={pieces.shape} options={PIECE_SHAPES.map(k => ({ value: k, label: PIECES_LABELS.shape[k] }))} onChange={v => set(p => { p.shape = v as PiecesSpec['shape']; })} />
          </Row>
          <NumRow label="Pieces across" integer value={pieces.count} defaultValue={D.count} min={4} max={160} onChange={v => set(p => { p.count = Math.round(v); }, 'count')} />
          <NumRow label="Size" hint="1 touches the neighbours." value={pieces.size} defaultValue={D.size} min={0.1} max={2} onChange={v => set(p => { p.size = v; }, 'size')} />
          <Row label="Colour">
            <Select ariaLabel="Piece colour" value={pieces.colour} options={[{ value: 'flat', label: 'Flat: its colour at home' }, { value: 'piece', label: 'Piece: carries its bit of the picture' }]} onChange={v => set(p => { p.colour = v as PiecesSpec['colour']; })} />
          </Row>
          <Row label="Size by">
            <Select ariaLabel="Piece size by" value={pieces.sizeBy} options={PIECES_SIZE_BYS.map(k => ({ value: k, label: PIECES_LABELS.sizeBy[k] }))} onChange={v => set(p => { p.sizeBy = v as PiecesSpec['sizeBy']; })} />
          </Row>
          <Row label="Move">
            <Select ariaLabel="What moves the pieces" value={pieces.move} options={PIECES_MOVES.map(k => ({ value: k, label: PIECES_LABELS.move[k] }))} onChange={v => set(p => { p.move = v as PiecesSpec['move']; })} />
          </Row>
          <NumRow label="Scatter" hint="A random push for every piece, each its own way (picture units: 1 is half the frame's height). A little (0.01) breaks the grid up, CC Ball Action style." value={pieces.scatter ?? 0} defaultValue={0} min={0} max={1} onChange={v => set(p => { p.scatter = v; }, 'scatter')} />
          {(pieces.scatter ?? 0) > 0 && <>
            <NumRow label="Seed" integer hint="Another random layout." value={pieces.seed ?? 1} defaultValue={1} min={0} max={100} onChange={v => set(p => { p.seed = Math.round(v); }, 'seed')} />
            <NumRow label="Scatter turn" hint="Up to this many degrees of random turn per piece." value={pieces.scatterTurn ?? 0} defaultValue={0} min={0} max={180} onChange={v => set(p => { p.scatterTurn = v; }, 'scatterTurn')} />
          </>}
          <NumRow label="Scatter size" hint="Random size per piece: 0.3 makes them 70%–130% of Size." value={pieces.scatterSize ?? 0} defaultValue={0} min={0} max={1} onChange={v => set(p => { p.scatterSize = v; }, 'scatterSize')} />
          <NumRow label="Dim floor" hint="Lifts the darkest colours, so dark parts of the picture stay as dim pieces." value={pieces.dim ?? 0} defaultValue={0} min={0} max={0.5} onChange={v => set(p => { p.dim = v; }, 'dim')} />
          {pieces.move !== 'none' && <>
            <NumRow label="Fly" hint="How far the moving field carries the pieces: a share of the frame's height." value={pieces.amount} defaultValue={D.amount} min={0} max={1.5} onChange={v => set(p => { p.amount = v; }, 'amount')} />
            {pieces.move !== 'mouse' && <NumRow label="Swirl size" hint="The noise's scale: smaller is broader swirls." value={pieces.swirl} defaultValue={D.swirl} min={0.1} max={5} onChange={v => set(p => { p.swirl = v; }, 'swirl')} />}
          </>}
          {(pieces.move !== 'none' || (pieces.scatter ?? 0) > 0) && <NumRow label="Pace" hint="Scatters a second: an LFO eases the move and the Scatter out and back (0: they stay scattered)." value={pieces.speed} defaultValue={D.speed} min={0} max={1} onChange={v => set(p => { p.speed = v; }, 'speed')} />}
        </>
      )}
    </Card>
  );
}

/**
 * A grid from an older scene (grids are made in the Grid builder now). It can't be carried over (the
 * Grid builder draws its grids cell by cell), so it stays as it was built: read-only, mutable, removable.
 */
function OlderGridCard() {
  const grid = useSceneBuilder2D(s => s.scene.grid);
  if (!grid) return null;
  return (
    <Card id="grid2-older" defaultOpen title="Grid (from an older scene)" summary={`${grid.cols} × ${grid.rows} · ${grid.shapes.join(', ')} · ${GRID_LABELS.target[grid.target].toLowerCase()}`}
      mute={{ muted: !!grid.muted, what: 'the grid', onToggle: () => edit(d => { if (d.grid) d.grid.muted = !d.grid.muted; }) }}
      onRemove={() => edit(d => { d.grid = null; })} removeLabel="Remove the grid">
      <div data-older-grid><BuilderNote>This scene has a grid: edit it in the Grid builder. This one can't be carried over (the Grid builder draws its grids cell by cell), so it stays here as it was built, read-only; it still builds as before and its recipe keeps its <code>grid …</code> clause.</BuilderNote></div>
      <Button size="sm" variant="ghost" icon="grid" style={{ alignSelf: 'flex-start' }} title="Opens the Grid builder on a new grid scene"
        onClick={() => { void import('../../gridScene/actions').then(m => m.openNewGridScene()); }}>Open the Grid builder</Button>
    </Card>
  );
}

/** One Modify card's body: its sliders, or for f(d) its line (the Expression Block editor) and sliders. */
function ModBody({ id, m, i }: { id: string; m: DistMod; i: number }) {
  const tk = useTokens();
  const [newName, setNewName] = useState('');
  const upd = (fn: (x: DistMod) => void, key?: string) => edit(d => { const f = findItem(d, id); const x = f?.item.mods?.[i]; if (x) fn(x); }, key && `${id}:mod:${m.id}:${key}`);
  const def = MOD_BY_KIND[m.kind];
  if (m.kind !== 'custom') {
    return <>{def.params.map(p => (
      <NumRow key={p.key} label={p.label} hint={p.hint} integer={p.integer} value={m.values[p.key] ?? p.def} defaultValue={p.def} min={p.min} max={p.max} step={p.step}
        onChange={v => upd(x => { x.values[p.key] = p.integer ? Math.round(v) : v; }, p.key)} lazyParam={p.key === 'count' ? undefined : play2d(`${id}:mod:${m.id}`, p.key)} />
    ))}</>;
  }
  const chk = checkCustom(m);
  const names = Object.keys(m.values);
  const vars = [{ name: 'd', type: 'float' }, { name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'uv', type: 'vec2' }, { name: 't', type: 'float' }, ...names.map(n => ({ name: n, type: 'float' }))];
  const why = newName.trim() ? paramNameProblem(newName.trim(), ['d', 'x', 'y', 'uv', 't', 'PI', 'TAU', ...names]) : null;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.muted }}>d =</span>
        <ExprLineInput ariaLabel="f(d)" attrs={{ 'data-mod-fd': '' }} value={m.expr ?? ''} vars={vars} invalid={!chk.ok} placeholder="e.g. abs(d) - 0.02" onChange={v => upd(x => { x.expr = v; }, 'expr')} />
      </div>
      {!chk.ok && <div role="alert" data-mod-error style={{ fontSize: 11.5, color: tk.status.danger }}>{chk.error}</div>}
      {names.map(n => {
        const r = m.sliders?.find(s => s.name === n);
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <NumRow label={<span style={{ fontFamily: fontFamily.mono }}>{n}</span>} value={m.values[n]} min={r?.min ?? Math.min(0, m.values[n] * 2)} max={r?.max ?? Math.max(1, m.values[n] * 2)}
                onChange={v => upd(x => { x.values[n] = v; }, `s:${n}`)} lazyParam={play2d(`${id}:mod:${m.id}`, n)} />
            </div>
            <IconButton icon="close" size="sm" label={`Remove slider ${n}`} onClick={() => upd(x => { delete x.values[n]; x.sliders = x.sliders?.filter(s => s.name !== n); })} />
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input aria-label="New slider name" placeholder="New slider (e.g. amp)" value={newName} onChange={e => setNewName(e.target.value)}
          style={{ height: 26, padding: '0 8px', borderRadius: radius.sm, border: `1px solid ${why ? tk.status.danger : tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.mono}`, width: 160 }} />
        <Button size="sm" variant="ghost" icon="plus" disabled={!newName.trim() || !!why} onClick={() => { const n = newName.trim(); upd(x => { x.values[n] = 0.1; }); setNewName(''); }}>Slider</Button>
        {why && <span style={{ fontSize: 11, color: tk.status.danger }}>{why}</span>}
      </div>
    </>
  );
}

/**
 * Modify: operations on the selected shape's (or combine's) distance, before it is drawn: a stack
 * of cards, top to bottom (modify.ts). Every number is a live slider on its Expression Block.
 */
export function ModifyTab() {
  const scene = useSceneBuilder2D(s => s.scene);
  const selectedId = useSceneBuilder2D(s => s.selectedId);
  const sel = selectedId ? findItem(scene, selectedId) : null;
  if (!sel) return <BuilderNote>Pick a shape or a combine on the left: Modify changes its distance before it is drawn (a disc into rings, ripples, a wobbly edge…).</BuilderNote>;
  const it = sel.item;
  const id = it.id;
  const mods = it.mods ?? [];
  const add = (kind: ModKind) => edit(d => { const f = findItem(d, id); if (f) (f.item.mods ??= []).push(newMod(kind, nextId(d, 'x'))); });
  const move = (i: number, dir: -1 | 1) => edit(d => { const l = findItem(d, id)?.item.mods; const j = i + dir; if (!l || j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <BuilderNote>Changes how ‘{itemName(scene, it)}’ looks by changing its distance d (negative inside, positive outside) before it is drawn, after its place, motion, copies{it.type === 'group' ? ' and combine' : ''}. Applied top to bottom; each is an Expression Block whose numbers are live sliders you can drag or wire.</BuilderNote>
      {mods.map((m, i) => (
        <Card key={m.id} id={`mod2-${id}-${m.id}`} defaultOpen title={`${i + 1}. ${MOD_BY_KIND[m.kind]?.label ?? m.kind}`} summary={modSummary(m)}
          mute={{ muted: !!m.muted, what: MOD_BY_KIND[m.kind]?.label ?? m.kind, onToggle: () => edit(d => { const x = findItem(d, id)?.item.mods?.[i]; if (x) x.muted = !x.muted; }), onSolo: () => edit(d => { const l = findItem(d, id)?.item.mods; if (l) soloIn(l, m.id); }) }}
          onRemove={() => edit(d => { findItem(d, id)?.item.mods?.splice(i, 1); })} removeLabel={`Remove ${MOD_BY_KIND[m.kind]?.label}`}
          actions={<>
            <IconButton icon="chevU" label="Earlier" size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon="chevD" label="Later" size="sm" disabled={i === mods.length - 1} onClick={() => move(i, 1)} />
          </>}>
          <BuilderNote>{MOD_BY_KIND[m.kind]?.blurb}</BuilderNote>
          <ModBody id={id} m={m} i={i} />
        </Card>
      ))}
      <BuilderLabel hint="Each adds a card at the bottom of the stack. Hover a button for what it does.">Add</BuilderLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {MODS.map(md => <Button key={md.kind} size="sm" variant="ghost" icon="plus" title={md.blurb} data-mod-add={md.kind} onClick={() => add(md.kind)}>{md.label}</Button>)}
      </div>
    </div>
  );
}

/**
 * Combine: the layers as a tree of combines (union, smooth union, subtract, intersect, xor), like the
 * 3D builder's. Pick a layer, then join it with the next one; a combine's operator, smooth amount and
 * colour are edited here. Each shape's motion, copies and place apply before it is combined.
 */
export function CombineTab() {
  const tk = useTokens();
  const scene = useSceneBuilder2D(s => s.scene);
  const selectedId = useSceneBuilder2D(s => s.selectedId);
  const select = useSceneBuilder2D(s => s.select);
  const sel = selectedId ? findItem(scene, selectedId) : null;
  const siblings = sel ? (sel.parent ? sel.parent.children : scene.layers) : [];
  const next = sel ? siblings[sel.index + 1] : undefined;
  const prev = sel ? siblings[sel.index - 1] : undefined;
  const join = (op: CombineOp, smooth: boolean) => {
    let gid = '';
    edit(d => {
      const f = selectedId ? findItem(d, selectedId) : null;
      if (!f) return;
      const list = f.parent ? f.parent.children : d.layers;
      const nx = list[f.index + 1];
      if (!nx) return;
      const g = joinedGroup(d, op, smooth && op !== 'xor' ? DEFAULT_SMOOTH_K : 0, f.item, nx);
      gid = g.id;
      list.splice(f.index, 2, g);
    });
    if (gid) select(gid);
  };
  const intoAbove = () => edit(d => {
    const f = selectedId ? findItem(d, selectedId) : null;
    if (!f) return;
    const list = f.parent ? f.parent.children : d.layers;
    const above = list[f.index - 1];
    if (above?.type !== 'group') return;
    list.splice(f.index, 1);
    above.children.push(f.item);
  });
  const outOf = () => edit(d => {
    const f = selectedId ? findItem(d, selectedId) : null;
    if (!f?.parent) return;
    const p = findItem(d, f.parent.id);
    if (!p) return;
    f.parent.children.splice(f.index, 1);
    (p.parent ? p.parent.children : d.layers).splice(p.index + 1, 0, f.item);
  });
  const rows: Array<{ it: Item; depth: number }> = [];
  const walk = (items: Item[], depth: number) => { for (const it of items) { rows.push({ it, depth }); if (it.type === 'group') walk(it.children, depth + 1); } };
  walk(scene.layers, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <BuilderNote>Join shapes into one: union, smooth union (melted together), subtract (cut out), intersect (only the overlap), their smooth forms, and xor. Each shape's place, motion and copies apply first; the combine is real SDF combine nodes whose Smooth is a live slider. A combine blends its shapes' colours by the same smooth weight.</BuilderNote>
      <div role="tree" aria-label="Combine tree" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map(({ it, depth }) => (
          <button key={it.id} type="button" role="treeitem" aria-selected={it.id === selectedId} onClick={() => select(it.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `5px 8px 5px ${8 + depth * 18}px`, border: 0, borderLeft: depth ? `2px solid ${tk.border.default}` : '2px solid transparent', borderRadius: radius.sm, cursor: 'pointer', textAlign: 'left',
              background: it.id === selectedId ? tk.bg.selected : 'transparent', color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}`, ...(it.muted ? MUTED_DIM : {}) }}>
            {it.type === 'group'
              ? <span style={{ font: `700 12px ${fontFamily.mono}`, color: tk.accent.text, padding: '1px 6px', borderRadius: 4, background: tk.bg.field }}>{OP_GLYPH_2D[it.op]} {opLabel(it).toLowerCase()}{it.k > 0 && it.op !== 'xor' ? ` ${+it.k.toFixed(3)}` : ''}</span>
              : <span style={{ width: 12, height: 12, borderRadius: 3, background: rgbCss(it.color), flexShrink: 0, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.type === 'group' && !it.name ? `${it.children.length} items` : itemName(scene, it)}</span>
          </button>
        ))}
        {!rows.length && <BuilderNote>No shapes yet. Add two on the Shapes tab, then join them here.</BuilderNote>}
      </div>
      {sel && (
        <>
          <Card id="cb2-join" defaultOpen title={`Join ‘${itemName(scene, sel.item)}’ with the next layer`} summary={next ? `‘${itemName(scene, next)}’` : 'no next layer'}>
            {next
              ? <CombineButtons label="Join with the next layer" onPick={join} />
              : <BuilderNote>It is the last {sel.parent ? 'item in its combine' : 'layer'}: pick an earlier one to join it with the one after.</BuilderNote>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {prev?.type === 'group' && <Button size="sm" variant="ghost" onClick={intoAbove} title="Put it inside the combine just above it (last in it)">› Into the combine above</Button>}
              {sel.parent && <Button size="sm" variant="ghost" onClick={outOf} title="Take it out of its combine, just after it">‹ Out of its combine</Button>}
            </div>
          </Card>
          {sel.item.type === 'group' && (
            <Card id={`cb2-${sel.item.id}`} defaultOpen title={opLabel(sel.item)} summary={`${sel.item.children.length} items${sel.item.mix ? ' · colours blended' : ''}`}
              mute={{ muted: !!sel.item.muted, ...itemMute(sel.item.id, `‘${itemName(scene, sel.item)}’`) }}
              actions={<Button size="sm" variant="ghost" onClick={() => edit(d => { const f = findItem(d, sel.item.id); if (f && f.item.type === 'group') (f.parent ? f.parent.children : d.layers).splice(f.index, 1, ...f.item.children); })}>Ungroup</Button>}>
              <GroupControls id={sel.item.id} g={sel.item} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** A look row with its mute switch at the end (none while the effect is off). */
function Effect({ m, children }: { m: ReturnType<typeof lookMute> | null; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ flex: 1, minWidth: 0, ...(m?.muted ? MUTED_DIM : {}) }}>{children}</div>
      {m ? <MuteToggle {...m} /> : <span style={{ width: 26, flexShrink: 0 }} />}
    </div>
  );
}
/** The node a builder setting builds, looked up when its slider's menu opens (right-click → Play). */
const play2d = (role: string, key: string): LazyParam => play2dAny(role, [key]);
/** As play2d, for a setting whose param on the built node may go by one of a few names (the first it has). */
function play2dAny(role: string, keys: readonly string[]): LazyParam {
  return () => {
    const id = useSceneBuilder2D.getState().targetSceneId;
    const b = id ? find2dBuild(useNodeGraphStore.getState().nodes, id) : null;
    const n = b?.byRole.get(role);
    if (!n) return { missing: 'Not built yet: Build, then right-click to add it to Play.' };
    const key = keys.find(k => k in n.params);
    return key ? { nodeId: n.id, key } : { missing: 'Built into the node rather than a slider on it: change it here.' };
  };
}
const gradePlay = (it: StackItem, key: string) => { const t = gradeParamTarget(it, key); return t ? play2d(t.role, t.param) : undefined; };
const fxPlay = (it: StackItem, key: string) => { const t = fxParamTarget(it, key); return t ? play2d(t.role, t.param) : undefined; };

function LookTab() {
  const look = useSceneBuilder2D(s => s.scene.look);
  const hasGrid = useSceneBuilder2D(s => !!s.scene.grid && s.scene.grid.colourBy !== 'shape');
  const sources = useSceneBuilder2D(s => s.scene.textures) ?? [];
  const set = (fn: (l: Scene2D['look']) => void, key?: string) => edit(d => fn(d.look), key && `look:${key}`);
  const swatches = paletteSwatches(look.colour.palette, look.custom);
  const grade = look.grade ?? [];
  const P = look.post;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card id="look2-palette" defaultOpen title="Palette" summary={paletteLabel(look.colour.palette, look.customName)}
        accent={swatchGradient(swatches)}>
        <PaletteCardBody value={{ key: look.colour.palette, custom: look.custom, customName: look.customName }}
          onChange={(v, key) => set(l => { l.colour.palette = v.key; l.custom = v.custom ?? null; l.customName = v.customName ?? null; if (!l.custom) delete l.custom; if (!l.customName) delete l.customName; }, key)} />
      </Card>
      <Card id="look2-colour" title="Colour" summary={`${look.bgSlot != null ? `background slot ${look.bgSlot + 1}` : 'background'} · ${look.colour.by === 'layer' ? 'each layer its own' : `by ${look.colour.by}`}`}>
        <SlotColourRow label="Background" value={look.bg} slot={look.bgSlot} swatches={swatches}
          onColour={v => set(l => { l.bg = v; }, 'bg')} onSlot={s => set(l => { if (s == null) delete l.bgSlot; else l.bgSlot = s; })} />
        <Row label="Colour by" hint="Each layer's colour (its slot or free colour, on Shapes), or the palette read by something about the picture.">
          <Select ariaLabel="Colour by" value={look.colour.by} options={COLOUR_BYS.map(c => ({ value: c, label: c === 'layer' ? "each layer's colour" : c }))} onChange={v => set(l => { l.colour.by = v as typeof l.colour.by; })} />
        </Row>
        {(look.colour.by !== 'layer' || hasGrid) && (
          <>
            {look.colour.by === 'layer' && <BuilderNote>The palette also colours the grid (Grid → Colour by ripple or cell).</BuilderNote>}
            <NumRow label="Scale" value={look.colour.scale} defaultValue={DEFAULT_SCENE_2D.look.colour.scale} min={0.1} max={8} onChange={v => set(l => { l.colour.scale = v; }, 'cs')} />
            <NumRow label="Drift" hint="How fast the palette cycles over time." value={look.colour.speed} defaultValue={DEFAULT_SCENE_2D.look.colour.speed} min={-1} max={1} onChange={v => set(l => { l.colour.speed = v; }, 'cv')} />
          </>
        )}
      </Card>
      <Card id="look2-picture" title="Background picture" summary={look.bgTex ? `${look.bgTex.tex}${look.bgTex.warp ? ' · bent by the space' : ''}` : 'none'}>
        <BuilderNote>A picture behind every layer. Read at the warped point, every space transform and block bends it: add a block on the Space tab to warp the picture.</BuilderNote>
        <TexturePicker id="bg" sources={sources} value={look.bgTex?.tex} onAdd={addSource} none="Only the colour"
          onChange={name => set(l => { l.bgTex = name ? (l.bgTex ? { ...l.bgTex, tex: name } : { ...newTexUse(name), warp: true }) : null; })} />
        {look.bgTex && (
          <>
            <FitRows use={look.bgTex} k="bg" onChange={(fn, key) => set(l => { if (l.bgTex) fn(l.bgTex); }, key)} />
            <Row label="Bent by the space"><Toggle checked={look.bgTex.warp} onChange={v => set(l => { if (l.bgTex) l.bgTex.warp = v; })} label="Read the picture at the warped point" /></Row>
          </>
        )}
      </Card>
      <Card id="look2-glow" title="Glow" summary={look.glow.mode} mute={look.glow.mode !== 'off' ? lookMute('glow', 'the glow', !!look.mute?.glow) : undefined}>
        <Row label="Glow">
          <Select ariaLabel="Glow" value={look.glow.mode} options={[{ value: 'off', label: 'Off' }, { value: 'all', label: 'All shapes' }, { value: 'selected', label: 'Only layers marked Glow' }]}
            onChange={v => set(l => { l.glow.mode = v as GlowMode; })} />
        </Row>
        {look.glow.mode !== 'off' && (
          <>
            <Row label="Type" hint={GLOW_TYPES.map(t => `${GLOW_TYPE_LABELS[t].label}: ${GLOW_TYPE_LABELS[t].blurb}`).join('\n')}>
              <Select ariaLabel="Glow type" value={look.glow.type ?? ''} options={[{ value: '', label: 'Soft (Glow style), Halo (Filled)' }, ...GLOW_TYPES.map(t => ({ value: t, label: GLOW_TYPE_LABELS[t].label }))]}
                onChange={v => set(l => { if (v) l.glow.type = v as GlowType; else delete l.glow.type; })} />
            </Row>
            {look.glow.type && <BuilderNote>{GLOW_TYPE_LABELS[look.glow.type].blurb}</BuilderNote>}
            <NumRow label="Amount" value={look.glow.amount} defaultValue={DEFAULT_SCENE_2D.look.glow.amount} min={0.001} max={0.05} step={0.0005} onChange={v => set(l => { l.glow.amount = v; }, 'ga')} />
            <NumRow label="Falloff" value={look.glow.falloff} defaultValue={DEFAULT_SCENE_2D.look.glow.falloff} min={0.5} max={3} onChange={v => set(l => { l.glow.falloff = v; }, 'gf')} />
          </>
        )}
      </Card>
      <Card id="look2-grade" title="Grade" summary={grade.length ? grade.map(g => GRADE_BY_KIND[g.kind]?.label ?? g.kind).join(' → ') : 'none'}>
        <StackCards name="grade" idPrefix="gr" items={grade} defs={GRADE_KINDS} playParam={gradePlay}
          empty="No grade yet: add one above. Each is a real node after the tone map, in the order shown."
          onEdit={(fn, key) => edit(d => { const next = fn([...(d.look.grade ?? [])]); if (next.length) d.look.grade = next; else delete d.look.grade; }, key)} />
      </Card>
      <Card id="look2-finish" title="Finish" summary={`tone ${look.tone}${P.vignette ? ' · vignette' : ''}${P.grain ? ' · grain' : ''}${P.bloom || P.scanlines ? ' · older effects' : ''}`}>
        <Effect m={look.tone !== 'none' ? lookMute('tone', 'the tone map', !!look.mute?.tone) : null}>
          <Row label="Tone map"><Select ariaLabel="Tone map" value={look.tone} options={TONE_MODES.map(t => ({ value: t, label: t }))} onChange={v => set(l => { l.tone = v as ToneMode; })} /></Row>
        </Effect>
        <Effect m={P.vignette > 0 ? lookMute('vignette', 'the vignette', !!look.mute?.vignette) : null}>
          <NumRow label="Vignette" value={P.vignette} defaultValue={DEFAULT_SCENE_2D.look.post.vignette} min={0} max={1} onChange={v => set(l => { l.post.vignette = v; }, 'pv')} />
        </Effect>
        <Effect m={P.grain > 0 ? lookMute('grain', 'the grain', !!look.mute?.grain) : null}>
          <NumRow label="Grain" value={P.grain} defaultValue={DEFAULT_SCENE_2D.look.post.grain} min={0} max={0.5} onChange={v => set(l => { l.post.grain = v; }, 'pg')} />
        </Effect>
        {(P.bloom > 0 || P.scanlines > 0) && (
          <div data-look-legacy style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <BuilderNote>This scene was made with effects the builder no longer offers. They still build as before; set one to 0 to take it out. Effects → Glow and CRT mask replace them.</BuilderNote>
            {P.bloom > 0 && <Effect m={lookMute('bloom', 'the bloom', !!look.mute?.bloom)}><NumRow label="Bloom (older)" hint="The older Bloom reads the frame before, so moving things smear. Effects → Glow is the same-frame kind." value={P.bloom} min={0} max={1.5} onChange={v => set(l => { l.post.bloom = v; }, 'pb')} /></Effect>}
            {P.scanlines > 0 && <Effect m={lookMute('scanlines', 'the scanlines', !!look.mute?.scanlines)}><NumRow label="Scanlines (older)" hint="Effects → CRT mask has scanlines with the tube's mask." value={P.scanlines} min={0} max={1} onChange={v => set(l => { l.post.scanlines = v; }, 'ps')} /></Effect>}
          </div>
        )}
      </Card>
    </div>
  );
}

function EffectsTab() {
  const effects = useSceneBuilder2D(s => s.scene.effects) ?? [];
  const sources = useSceneBuilder2D(s => s.scene.textures) ?? [];
  const scene = useThrottled(useSceneBuilder2D(s => s.scene));
  // The Passes the effects take (each move after a read starts a new one), as a tag on the card that takes one.
  const passOf = useMemo(() => {
    const out = new Map<string, number>();
    let n = 0;
    for (const node of buildScene2D(scene).nodes) {
      const role = String(node.params._sbRole ?? '');
      const m = /^fx:(.+):pass$/.exec(role);
      if (m && node.type === 'pass') out.set(m[1], ++n);
    }
    return out;
  }, [scene]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <BuilderNote>Shader effects on the finished picture, top to bottom: each one works on what the ones above made. Moves (Displace, Swirl, Pixelate, Kaleidoscope, CRT curvature) bend where the picture is read; Blur, Glow and Chromatic aberration read round each pixel; CRT mask works on the colour. They build as real nodes after the Look's grade.</BuilderNote>
      {passOf.size > 0 && <BuilderNote style={{ fontSize: 11 }}>Passes: {passOf.size} of {MAX_FX_PASSES} used, {MAX_FX_PASSES - passOf.size} left. A move (swirl, kaleidoscope…) after a read (blur, glow, rays…) takes a new one, so it bends what the reads made.</BuilderNote>}
      <StackCards name="fx" idPrefix="fx" items={effects} defs={FX_KINDS} playParam={fxPlay} sources={sources} onAddSource={addSource}
        badge={it => (passOf.has(it.id) ? `pass ${passOf.get(it.id)} of ${MAX_FX_PASSES}` : null)}
        empty="No effects yet: add one above."
        onEdit={(fn, key) => edit(d => { const next = fn([...(d.effects ?? [])]); if (next.length) d.effects = next; else delete d.effects; }, key && `fx:${key}`)} />
    </div>
  );
}

function OutputTab() {
  const out = useSceneBuilder2D(s => s.scene.output);
  const show = out?.show ?? 'picture';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <BuilderNote>What the Output shows. Anything but the picture is a way to see how the scene works.</BuilderNote>
      {OUTPUT_SHOWS.map(o => (
        <label key={o.show} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="radio" name="out2d" checked={show === o.show} onChange={() => edit(d => { d.output = o.show === 'picture' ? undefined : { show: o.show as Show2D, palette: d.output?.palette }; })} />
          <span><b>{o.label}</b><br /><span style={{ fontSize: 12, opacity: 0.75 }}>{o.blurb}</span></span>
        </label>
      ))}
    </div>
  );
}

function RecipeTab() {
  const tk = useTokens();
  const scene = useSceneBuilder2D(s => s.scene);
  const printed = useMemo(() => printRecipe2D(scene, { multiline: true }), [scene]);
  const [text, setText] = useState(printed);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => { setText(printed); setErrors([]); }, [printed]);
  const apply = () => {
    const r = parseRecipe2D(text);
    const errs = r.errors.map(e => (typeof e === 'string' ? e : (e as { message?: string }).message ?? String(e)));
    setErrors(errs);
    if (errs.length) return;
    // A recipe doesn't carry the generated depth (an image in the library): keep it for the same picture.
    const was = useSceneBuilder2D.getState().scene.depth;
    if (r.scene.depth && was?.bake && was.tex === r.scene.depth.tex) r.scene.depth.bake = was.bake;
    useSceneBuilder2D.getState().replace(r.scene);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <BuilderNote>The whole scene as text in the Playfield language: space transforms, then shapes (with <code>@orbit(…)</code>, <code>@ring(…)</code> and other modifiers), then the look, joined by <code>·</code>. Edit it and press Apply, or paste one.</BuilderNote>
      <textarea aria-label="2D scene recipe" value={text} onChange={e => setText(e.target.value)} spellCheck={false}
        style={{ minHeight: 220, resize: 'vertical', padding: 10, borderRadius: radius.md, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `500 12px/1.6 ${fontFamily.mono}` }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <Button variant="primary" size="sm" icon="check" onClick={apply} disabled={text === printed}>Apply</Button>
        <Button size="sm" variant="ghost" icon="copy" onClick={() => { void navigator.clipboard?.writeText(text); }}>Copy</Button>
      </div>
      {errors.map((e, i) => <div key={i} role="alert" style={{ color: tk.status.danger, fontSize: 12 }}>{e}</div>)}
    </div>
  );
}

function TemplatesTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <BuilderNote>Starting points. Loading one replaces the form (Undo brings yours back).</BuilderNote>
      {TEMPLATES_2D.map(t => (
        <Card key={t.key} id={`tpl2-${t.key}`} title={t.label} summary={t.blurb}
          actions={<Button size="sm" onClick={() => useSceneBuilder2D.getState().replace(templateScene(t.key))}>Load</Button>}>
          <BuilderNote>{t.blurb}</BuilderNote>
          <code style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{t.recipe}</code>
        </Card>
      ))}
    </div>
  );
}

// ── The window ────────────────────────────────────────────────────────────────

function PreviewPanel() {
  const live = useSceneBuilder2D(s => s.scene);
  // One compile for the picture and the node count, following a drag at most every 50 ms.
  const scene = useThrottled(live);
  const c = useMemo(() => compileScene2D(scene), [scene]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 14px' }}>
      <BuilderLabel>Preview</BuilderLabel>
      <Preview2D scene={scene} compiled={c} />
      <BuilderLabel meta={`${c.nodes} nodes`}>What Build makes</BuilderLabel>
      <BuilderNote>UV → {scene.space.length ? `${scene.space.length} space transform${scene.space.length === 1 ? '' : 's'} (blocks as Expression Blocks with sliders) → ` : ''}{allShapes(scene).length} shape{allShapes(scene).length === 1 ? '' : 's'} with their placing, motion and copies{scene.grid ? ' and a grid (one Expression Block, line by line)' : ''}{scene.depth ? ` → a picture with depth (Depth node, Depth Mix: ${scene.depth.look === 'top' ? 'on top' : scene.depth.look})` : ''} → colour and glow{scene.look.tone !== 'none' ? ' → Tone Map' : ''} → the Output. Every node gets a note.</BuilderNote>
    </div>
  );
}

/** The phone's viewport: the live picture, as large as the sheet leaves it. */
function PhoneViewport2D() {
  const live = useSceneBuilder2D(s => s.scene);
  return <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 8 }}><Preview2D scene={live} height="fill" /></div>;
}

export function SceneBuilder2DModal() {
  const tk = useTokens();
  const phone = usePhoneDialog();
  const tab = useSceneBuilder2D(s => s.tab);
  const setTab = useSceneBuilder2D(s => s.setTab);
  // Only what the frame shows, so a slider drag re-renders the tab it is on, not the whole window.
  const shapes = useSceneBuilder2D(s => allShapes(s.scene).length);
  const spaceCount = useSceneBuilder2D(s => s.scene.space.length);
  const gridSize = useSceneBuilder2D(s => (s.scene.grid ? `${s.scene.grid.cols} × ${s.scene.grid.rows}` : null));
  const close = useSceneBuilder2D(s => s.close);
  const undo = useSceneBuilder2D(s => s.undo);
  const redo = useSceneBuilder2D(s => s.redo);
  const canUndo = useSceneBuilder2D(s => s.past.length > 0);
  const canRedo = useSceneBuilder2D(s => s.future.length > 0);
  const dirty = useSceneBuilder2D(s => s.dirty);
  const surpriseSeed = useSceneBuilder2D(s => s.surpriseSeed);
  const targetSceneId = useSceneBuilder2D(s => s.targetSceneId);
  const targetExists = useNodeGraphStore(s => !!targetSceneId && s.nodes.some(n => n.id === targetSceneId));
  const editing = !!targetSceneId && targetExists;
  // ⌘⇧D: the Recipe tab, its text focused.
  useBuilderRecipeRequest(() => { setTab('recipe'); focusRecipeEditor('textarea[aria-label="2D scene recipe"]'); });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'))) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [undo, redo]);

  const surpriseBar = (
    <SurpriseBar seed={surpriseSeed} title="A random scene from a new seed: space blocks, shapes, motion and a look (one undo step)" onSurprise={seed => {
      useSceneBuilder2D.getState().surprise(seed);
      const made = useSceneBuilder2D.getState().scene;
      announceSurprise({
        title: '2D scene surprise', seed,
        message: `${made.space.length} space transform${made.space.length === 1 ? '' : 's'} · ${made.layers.length} shape${made.layers.length === 1 ? '' : 's'}. Build puts it on the canvas.`,
        reroll: () => { undo(); useSceneBuilder2D.getState().surprise(newSeed()); },
        undo: () => undo(),
        stillCurrent: () => useSceneBuilder2D.getState().scene === made,
      });
    }} />
  );
  const done = () => finishBuilder(close, scene2dBuildIds(useSceneBuilder2D.getState().targetSceneId));
  const body = { space: <SpaceTab />, shapes: <ShapesTab />, combine: <CombineTab />, modify: <ModifyTab />, depth: <DepthTab />, look: <LookTab />, effects: <EffectsTab />, output: <OutputTab />, recipe: <RecipeTab />, templates: <TemplatesTab /> }[tab];
  void num;
  // A phone: the shared phone layout (StudioShell → PhoneStudio): the picture on top, the sections
  // as the bottom bar's tabs, Templates and Surprise me as its Presets, the layers a tab of their own.
  if (phone) return (
    <StudioShell prefsKey="scene-builder-2d" icon="mask" iconColor={tk.kind.fn} title={editing ? 'Your 2D scene' : 'A new 2D scene'} crumb={<SceneCrumb kind="2d" />}
      onClose={close}
      actions={<>
        <IconButton icon="undo" size="sm" label="Undo" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" size="sm" label="Redo" disabled={!canRedo} onClick={redo} />
        <Button size="sm" data-scene2d-done onClick={done}>Done</Button>
      </>}
      primary={{ label: editing ? 'Rebuild' : 'Build', onClick: () => { if (shapes || gridSize) buildFromBuilder2D(false); }, title: editing ? 'Rebuild the scene it was built as' : 'Add the graph to the canvas and show it on the Output' }}
      nav={<>{TABS.filter(t => t.id !== 'templates').map(t => <StudioNavItem key={t.id} id={t.id} icon={t.icon} label={t.label} selected={tab === t.id} onClick={() => setTab(t.id)} />)}</>}
      phonePanels={[{ id: 'layers', label: 'Layers', icon: 'layers', content: <LayerList /> }]}
      surprise={surpriseBar} presets={<TemplatesTab />}
      inspector={<div style={{ padding: '4px 16px 16px' }}>{tab === 'templates' ? <TemplatesTab /> : body}</div>}>
      <PhoneViewport2D />
    </StudioShell>
  );
  return (
    <BuilderWindow
      prefsKey="scene-builder-2d"
      width={SCENE_WINDOW.width} height={SCENE_WINDOW.height}
      title={<SceneCrumb kind="2d" />}
      subtitle={`2D Scene Builder · ${editing ? 'editing a built scene' : 'a new scene'} · ${spaceCount} space · ${shapes} shape${shapes === 1 ? '' : 's'}${gridSize ? ` · a ${gridSize} grid` : ''}`}
      icon="mask"
      iconColor={tk.kind.fn}
      onClose={close}
      tabs={{ items: TABS, value: tab, onChange: id => setTab(id as Builder2DTab), ariaLabel: '2D Scene Builder sections' }}
      left={{ label: 'Layers', icon: 'layers', width: 260, content: <LayerList /> }}
      right={{ label: 'Preview', icon: 'eye', width: 340, content: <PreviewPanel /> }}
      headerActions={<>
        {surpriseBar}
        <IconButton icon="undo" label="Undo" shortcut="cmd+z" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" label="Redo" shortcut="cmd+shift+z" disabled={!canRedo} onClick={redo} />
      </>}
      footer={<>
        {editing && <Button icon="copy" onClick={() => buildFromBuilder2D(true)} title="Leave the built scene as it is and build this one beside it">Build as a new copy</Button>}
        <BuilderNote>{editing ? 'Rebuild replaces the scene it was built as, keeping settings you changed on its nodes.' : 'Build adds the graph to the canvas and shows it on the Output.'}</BuilderNote>
        <span style={{ flex: 1 }} />
        {dirty && <BuilderNote style={{ color: tk.text.faint }}>Not built yet</BuilderNote>}
        <Button onClick={done}>Done</Button>
        <Button variant="primary" icon="rebuild" disabled={!shapes && !gridSize} onClick={() => buildFromBuilder2D(false)}>{editing ? 'Rebuild' : 'Build'}</Button>
      </>}
    >
      <div style={{ padding: '14px 16px' }}>{body}</div>
    </BuilderWindow>
  );
}

/** Mounted once beside the canvas: the builder window while it is open. */
export function SceneBuilder2DHost() {
  const open = useSceneBuilder2D(s => s.open);
  return open ? <SceneBuilder2DModal /> : null;
}
