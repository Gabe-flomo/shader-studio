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
  COLOUR_BYS, MAX_DUP, MAX_LEVELS, MOTIONS, OUTPUT_SHOWS, SHAPES, SHAPE_BY_KIND, SPACES, SPACE_BY_KIND, TONE_MODES,
  allShapes, findItem, itemName, itemSummary, newBlockOp, starterScene, newCombineOp, newDup, newGroup, newMotion, newShape, newSpaceOp, nextId, num, opLabel, spaceSummary,
  type CombineOp, type GlowMode, type Item, type MotionKind, type ParamDef, type Scene2D, type ShapeSpec, type Show2D, type ToneMode, type Vec2, type Vec3,
} from '../../sceneBuilder2d/spec';
import { parseRecipe2D, printRecipe2D } from '../../sceneBuilder2d/recipe';
import { TEMPLATES_2D, templateScene } from '../../sceneBuilder2d/templates';
import { renderShapeThumbnail, renderSpaceThumbnail } from '../../sceneBuilder2d/thumbnails';
import { BUILT_IN_FUNCTIONS, findFunctions, functionsFromGraphs, type FnEntry, type FnRole } from '../../sceneBuilder2d/functions';
import { GRID_ASSIGNS, GRID_COLOUR_BYS, GRID_LABELS, GRID_PIC_MODES, GRID_SHAPES, GRID_TARGETS, RIPPLE_FROMS, defaultGrid, type GridPicMode, type GridShape, type GridSpec } from '../../sceneBuilder2d/grid';
import { PALETTES } from '../../sceneBuilder/output';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { BuilderLabel, BuilderNote, BuilderWindow } from '../builders/BuilderWindow';
import { focusRecipeEditor, useBuilderRecipeRequest } from '../../builders/windows';
import { Card, ColourRow, NumRow, Row, rgbCss, OP_GLYPH } from '../sceneBuilder/controls';
import { Button, IconButton } from '../ui/Button';
import type { IconName } from '../ui/iconPaths';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Preview2D, compileScene2D } from './Preview2D';
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
import { FIT_LABELS, TEX_FITS, newTexUse, withSource, type TexFit, type TexSource, type TexUse } from '../../builders/textures';

const TABS: Array<{ id: Builder2DTab; label: string; icon: IconName; gapBefore?: boolean }> = [
  { id: 'space', label: 'Space', icon: 'wave' },
  { id: 'shapes', label: 'Shapes', icon: 'mask' },
  { id: 'grid', label: 'Grid', icon: 'grid' },
  { id: 'look', label: 'Look', icon: 'sun' },
  { id: 'output', label: 'Output', icon: 'eye' },
  { id: 'recipe', label: 'Recipe', icon: 'text', gapBefore: true },
  { id: 'templates', label: 'Templates', icon: 'presets' },
];

/** What the look and grid sliders reset to on double-click: a new scene's and a new grid's settings. */
const DEFAULT_SCENE_2D = starterScene();
const DEFAULT_GRID = defaultGrid();

const edit = (fn: (d: Scene2D) => void, key?: string) => useSceneBuilder2D.getState().edit(fn, key);

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

function Vec2Row({ label, value, min, max, step = 0.01, onChange, hint, defaultValue }: { label: ReactNode; value: Vec2; min: number; max: number; step?: number; onChange: (v: Vec2) => void; hint?: string; defaultValue?: Vec2 }) {
  const tk = useTokens();
  return (
    <Row label={label} hint={hint}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        {(['X', 'Y'] as const).map((ax, i) => (
          <div key={ax} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span style={{ font: `600 10.5px ${fontFamily.mono}`, color: tk.text.faint, width: 10 }}>{ax}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <NumOnly value={value[i]} min={min} max={max} step={step} label={`${typeof label === 'string' ? label : 'value'} ${ax}`} defaultValue={defaultValue?.[i]}
                onChange={n => { const next = [...value] as Vec2; next[i] = n; onChange(next); }} />
            </div>
          </div>
        ))}
      </div>
    </Row>
  );
}

function NumOnly({ value, min, max, step, onChange, label, defaultValue }: { value: number; min: number; max: number; step: number; onChange: (n: number) => void; label: string; defaultValue?: number }) {
  return <BuilderSlider value={value} min={min} max={max} step={step} onChange={onChange} ariaLabel={label} defaultValue={defaultValue} />;
}

/** One catalogue setting (number or x/y pair) bound to a value map. */
function ParamControl({ p, value, onChange, keyBase }: { p: ParamDef; value: number | Vec2 | string | undefined; onChange: (v: number | Vec2) => void; keyBase: string }) {
  if (Array.isArray(p.def)) {
    const v = Array.isArray(value) ? value as Vec2 : [...p.def] as Vec2;
    return <Vec2Row label={p.label} hint={p.hint} value={v} min={p.min} max={p.max} step={p.step} onChange={onChange} defaultValue={p.def as Vec2} />;
  }
  const v = typeof value === 'number' ? value : p.def;
  void keyBase;
  return <NumRow label={p.label} hint={p.hint} value={v} min={p.min} max={p.max} step={p.step} unit={p.deg ? '°' : undefined} integer={p.step === 1} onChange={onChange} defaultValue={p.def} />;
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
  const remove = () => edit(d => {
    const f = selectedId ? findItem(d, selectedId) : null;
    if (!f) return;
    (f.parent ? f.parent.children : d.layers).splice(f.index, 1);
  });
  const groupWithNext = (op: CombineOp) => edit(d => {
    const f = selectedId ? findItem(d, selectedId) : null;
    if (!f) return;
    const list = f.parent ? f.parent.children : d.layers;
    const next = list[f.index + 1];
    if (!next) return;
    const g = newGroup(nextId(d, 'g'), { op, k: 0, color: f.item.color, glow: f.item.glow, children: [f.item, next] });
    list.splice(f.index, 2, g);
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
          <button key={it.id} type="button" role="option" aria-selected={it.id === selectedId} onClick={() => select(it.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `5px 8px 5px ${8 + depth * 14}px`, border: 0, borderRadius: radius.sm, cursor: 'pointer', textAlign: 'left',
              background: it.id === selectedId ? tk.bg.selected : 'transparent', color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}` }}>
            {it.type === 'group'
              ? <span style={{ width: 16, textAlign: 'center', font: `700 13px ${fontFamily.mono}`, color: tk.accent.text }}>{OP_GLYPH[it.op]}</span>
              : <span style={{ width: 12, height: 12, borderRadius: 3, background: rgbCss(it.color), flexShrink: 0, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemName(scene, it)}</span>
            {itemSummary(it) && <span style={{ fontSize: 11, color: tk.text.faint, whiteSpace: 'nowrap' }}>{itemSummary(it)}</span>}
          </button>
        ))}
      </div>
      {sel && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <IconButton icon="chevU" label="Move back (earlier)" size="sm" disabled={sel.index === 0} onClick={() => move(-1)} />
          <IconButton icon="chevD" label="Move forward (later)" size="sm" disabled={!hasNext} onClick={() => move(1)} />
          <IconButton icon="trash" label="Delete" size="sm" onClick={remove} />
          {hasNext && <Button size="sm" variant="ghost" onClick={() => groupWithNext('union')} title="Join this and the next layer in a Union">∪ with next</Button>}
          {hasNext && <Button size="sm" variant="ghost" onClick={() => groupWithNext('subtract')} title="Cut the next layer out of this one">− next</Button>}
          {sel.item.type === 'group' && <Button size="sm" variant="ghost" onClick={ungroup}>Ungroup</Button>}
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
        const order = <>
          <IconButton icon="chevU" label="Earlier" size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
          <IconButton icon="chevD" label="Later" size="sm" disabled={i === scene.space.length - 1} onClick={() => move(i, 1)} />
          <IconButton icon="trash" label="Remove" size="sm" onClick={() => edit(d => { d.space.splice(i, 1); })} />
        </>;
        return (
          <div key={op.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(h => (h === i ? null : h))} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {i > 0 && <span aria-hidden style={{ alignSelf: 'center', font: `600 10.5px ${fontFamily.mono}`, color: tk.text.faint }}>↓ uv</span>}
            {block ? (
              <Card id={`sp2-${op.id}`} defaultOpen title={sum.label} summary={sum.value}
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
              <Card id={`sp2-${op.id}`} defaultOpen title={sum.label} summary={sum.value}
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
              <Card id={`sp2-${op.id}`} defaultOpen title={def.label} summary={sum.value} actions={order}>
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
      <BlockLibrary onPick={addBlock} />
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

function ItemInspector({ id }: { id: string }) {
  const scene = useSceneBuilder2D(s => s.scene);
  const f = findItem(scene, id);
  if (!f) return null;
  const it = f.item;
  const upd = (fn: (x: Item) => void, key?: string) => edit(d => { const g = findItem(d, id); if (g) fn(g.item); }, key && `${id}:${key}`);
  const shapeDef = it.type === 'shape' ? SHAPE_BY_KIND[it.kind] : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card id={`it2-${id}-shape`} defaultOpen title={itemName(scene, it)} summary={it.type === 'group' ? opLabel(it) : shapeDef?.blurb}>
        {it.type === 'group' ? (
          <>
            <Row label="Combine">
              <Select ariaLabel="Combine" value={it.op} options={[{ value: 'union', label: 'Union (either)' }, { value: 'subtract', label: 'Subtract (cut the rest out of the first)' }, { value: 'intersect', label: 'Intersect (only the overlap)' }]}
                onChange={v => upd(x => { if (x.type === 'group') x.op = v as CombineOp; })} />
            </Row>
            <NumRow label="Blend" hint="0 is a hard edge; above 0 melts the shapes together." value={it.k} min={0} max={0.5} step={0.005} onChange={v => upd(x => { if (x.type === 'group') x.k = v; }, 'k')} />
          </>
        ) : it.type === 'shape' && it.kind === 'fnshape' ? (
          <>
            <BuilderNote>{it.fn ? `${it.fn.name} (${it.fn.from}).` : 'No function.'} Edit the code on the built node (its helpers) to change the shape.</BuilderNote>
            {it.fn && <pre style={{ margin: 0, maxHeight: 140, overflow: 'auto', padding: 8, borderRadius: radius.sm, background: 'rgba(127,127,127,0.12)', font: `500 10.5px/1.5 ${fontFamily.mono}` }}>{it.fn.code}</pre>}
          </>
        ) : shapeDef?.params.map(p => (
          <ParamControl key={p.key} p={p} keyBase={id} value={(it as ShapeSpec).size[p.key]} onChange={v => upd(x => { if (x.type === 'shape') x.size[p.key] = v; }, `size:${p.key}`)} />
        ))}
        {!f.parent && <ColourRow label="Colour" value={it.color} onChange={v => upd(x => { x.color = v; }, 'color')} />}
        {!f.parent && <Row label="Glow"><Toggle checked={it.glow} onChange={v => upd(x => { x.glow = v; })} label="Glows when Look → Glow is Selected" /></Row>}
      </Card>
      {!f.parent && <PictureCard id={id} it={it} />}
      <Card id={`it2-${id}-place`} title="Place" summary={`at ${it.at.map(n => +n.toFixed(2)).join(', ')} · ${Math.round(it.rot)}° · ×${+it.scale.toFixed(2)}`}>
        <Vec2Row label="Position" value={it.at} min={-2} max={2} onChange={v => upd(x => { x.at = v; }, 'at')} />
        <NumRow label="Rotate" unit="°" value={it.rot} defaultValue={0} min={-180} max={180} step={0.5} onChange={v => upd(x => { x.rot = v; }, 'rot')} />
        <NumRow label="Scale" value={it.scale} defaultValue={1} min={0.05} max={4} onChange={v => upd(x => { x.scale = v; }, 'scale')} />
        <NumRow label="Round" hint="Grows the edge outward, rounding corners." value={it.inflate} defaultValue={0} min={0} max={0.3} step={0.002} onChange={v => upd(x => { x.inflate = v; }, 'inflate')} />
        <NumRow label="Outline only" hint="Above 0: only an outline this thick." value={it.hollow} defaultValue={0} min={0} max={0.2} step={0.002} onChange={v => upd(x => { x.hollow = v; }, 'hollow')} />
      </Card>
      <Card id={`it2-${id}-motion`} title="Motion" summary={it.motion.length ? it.motion.map(m => m.kind).join(' · ') : 'still'}>
        {it.motion.map((m, mi) => {
          const md = MOTIONS.find(x => x.kind === m.kind)!;
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 6 }}>
              <Row label={<b>{md.label}</b>}><Button size="sm" variant="ghost" icon="trash" onClick={() => upd(x => { x.motion.splice(mi, 1); })}>Remove</Button></Row>
              <NumRow label="Speed" hint="Cycles a second." value={m.speed} min={-2} max={2} onChange={v => upd(x => { x.motion[mi].speed = v; }, `m:${m.id}:s`)} />
              {md.amount && <NumRow label={md.amount.label} value={m.amount} min={md.amount.min} max={md.amount.max} onChange={v => upd(x => { x.motion[mi].amount = v; }, `m:${m.id}:a`)} />}
              {md.dir && <NumRow label="Direction" unit="°" value={m.dir} min={0} max={360} step={1} onChange={v => upd(x => { x.motion[mi].dir = v; }, `m:${m.id}:d`)} />}
              <NumRow label="Phase" unit="°" value={m.phase} min={0} max={360} step={1} onChange={v => upd(x => { x.motion[mi].phase = v; }, `m:${m.id}:p`)} />
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
      <Card id={`it2-${id}-dup`} title="Duplicate" summary={it.dup ? `${it.dup.count} copies${it.dup.inner ? ` × ${it.dup.inner.count}` : ''}${it.dup.levels > 1 ? ` · ${it.dup.levels} sizes` : ''}` : 'one'}>
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

function ShapesTab() {
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

function GridTab() {
  const tk = useTokens();
  const grid = useSceneBuilder2D(s => s.scene.grid);
  const sources = useSceneBuilder2D(s => s.scene.textures) ?? [];
  const set = (fn: (g: GridSpec) => void, key?: string) => edit(d => { if (d.grid) fn(d.grid); }, key && `grid:${key}`);
  if (!grid) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <BuilderNote>A grid of cells, each with its own shape, and ripples that travel through the cells and change them: their size, their turn, a push, or a morph from one shape into another. It is drawn over the layers.</BuilderNote>
        <Button variant="primary" icon="grid" onClick={() => edit(d => { d.grid = defaultGrid(); })} style={{ alignSelf: 'flex-start' }}>Add a grid</Button>
      </div>
    );
  }
  const toggleShape = (k: GridShape) => set(g => {
    if (g.shapes.includes(k)) { if (g.shapes.length > 1) g.shapes = g.shapes.filter(x => x !== k); }
    else if (g.shapes.length < 3) g.shapes = [...g.shapes, k];
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card id="grid2-cells" defaultOpen title="Cells" summary={`${grid.cols} × ${grid.rows}`}
        actions={<IconButton icon="trash" label="Remove the grid" size="sm" onClick={() => edit(d => { d.grid = null; })} />}>
        <NumRow label="Columns" integer value={grid.cols} defaultValue={DEFAULT_GRID.cols} min={1} max={48} onChange={v => set(g => { g.cols = Math.round(v); }, 'cols')} />
        <NumRow label="Rows" integer value={grid.rows} defaultValue={DEFAULT_GRID.rows} min={1} max={48} onChange={v => set(g => { g.rows = Math.round(v); }, 'rows')} />
        <NumRow label="Span" hint="Half the grid's width: 1 reaches the top edge." value={grid.span} defaultValue={DEFAULT_GRID.span} min={0.1} max={3} onChange={v => set(g => { g.span = v; }, 'span')} />
        <NumRow label="Shape size" hint="A share of the cell: 1 touches the neighbours." value={grid.size} defaultValue={DEFAULT_GRID.size} min={0.05} max={1.5} onChange={v => set(g => { g.size = v; }, 'size')} />
      </Card>
      <Card id="grid2-shapes" defaultOpen title="Shapes" summary={grid.shapes.join(', ')}>
        <BuilderNote>Pick up to three. With more than one, a rule gives each cell its shape.</BuilderNote>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {GRID_SHAPES.map(k => (
            <button key={k} type="button" style={tile(tk, grid.shapes.includes(k))} onClick={() => toggleShape(k)} aria-pressed={grid.shapes.includes(k)}>
              <Thumb k={`gshape:${k}`} make={() => renderShapeThumbnail(k === 'box' ? 'box' : k, 44)} />
              {k}
            </button>
          ))}
        </div>
        {grid.shapes.length > 1 && (
          <Row label="Give out">
            <Select ariaLabel="Give out shapes" value={grid.assign} options={GRID_ASSIGNS.map(a => ({ value: a, label: GRID_LABELS.assign[a] }))} onChange={v => set(g => { g.assign = v as GridSpec['assign']; })} />
          </Row>
        )}
        {grid.shapes.length > 1 && grid.assign === 'every' && <NumRow label="Every" integer value={grid.every} defaultValue={DEFAULT_GRID.every} min={2} max={12} onChange={v => set(g => { g.every = Math.round(v); }, 'every')} />}
      </Card>
      <Card id="grid2-ripples" defaultOpen title="Ripples" summary={grid.ripples.map(r => r.from).join(' + ')}>
        {grid.ripples.map((r, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Row label={`From ${grid.ripples.length > 1 ? i + 1 : ''}`}>
              <div style={{ display: 'flex', gap: 6 }}>
                <Select ariaLabel="Ripple from" value={r.from} options={RIPPLE_FROMS.map(x => ({ value: x, label: GRID_LABELS.from[x] }))} onChange={v => set(g => { g.ripples[i].from = v as typeof r.from; })} />
                {grid.ripples.length > 1 && <IconButton icon="trash" label="Remove this ripple" size="sm" onClick={() => set(g => { g.ripples.splice(i, 1); })} />}
              </div>
            </Row>
            {r.from === 'point' && <Vec2Row label="Point" value={r.at} min={-1.5} max={1.5} onChange={v => set(g => { g.ripples[i].at = v; }, `rip${i}`)} />}
          </div>
        ))}
        {grid.ripples.length < 4 && <Button size="sm" variant="ghost" icon="plus" onClick={() => set(g => { g.ripples.push({ from: 'corners', at: [0, 0] }); })} style={{ alignSelf: 'flex-start' }}>Another ripple</Button>}
        <NumRow label="Rings" hint="Waves per unit of distance." value={grid.freq} defaultValue={DEFAULT_GRID.freq} min={0} max={40} step={0.1} onChange={v => set(g => { g.freq = v; }, 'freq')} />
        <NumRow label="Speed" hint="Cycles a second. 0 stands still." value={grid.speed} defaultValue={DEFAULT_GRID.speed} min={-3} max={3} onChange={v => set(g => { g.speed = v; }, 'speed')} />
        <Row label="Changes">
          <Select ariaLabel="What the ripple changes" value={grid.target} options={GRID_TARGETS.map(x => ({ value: x, label: GRID_LABELS.target[x] }))} onChange={v => set(g => { g.target = v as GridSpec['target']; })} />
        </Row>
        {grid.target !== 'none' && <NumRow label="Amount" value={grid.amount} defaultValue={DEFAULT_GRID.amount} min={0} max={1.5} onChange={v => set(g => { g.amount = v; }, 'amount')} />}
        {grid.target === 'morph' && grid.shapes.length < 2 && <BuilderNote>Morph blends the first two shapes: pick a second one above (a box is used until you do).</BuilderNote>}
      </Card>
      <Card id="grid2-colour" title="Colour" summary={GRID_LABELS.colourBy[grid.colourBy]}>
        <Row label="Colour by">
          <Select ariaLabel="Grid colour by" value={grid.colourBy} options={GRID_COLOUR_BYS.map(x => ({ value: x, label: GRID_LABELS.colourBy[x] }))} onChange={v => set(g => { g.colourBy = v as GridSpec['colourBy']; })} />
        </Row>
        {grid.colourBy === 'shape'
          ? <><ColourRow label="First" value={grid.colour} onChange={v => set(g => { g.colour = v; }, 'c1')} /><ColourRow label="Second" value={grid.colour2} onChange={v => set(g => { g.colour2 = v; }, 'c2')} /></>
          : <BuilderNote>Uses the palette on the Look tab.</BuilderNote>}
        <Row label="Glow"><Toggle checked={grid.glow} onChange={v => set(g => { g.glow = v; })} label="Glows (when Look → Glow is on)" /></Row>
      </Card>
      <Card id="grid2-picture" defaultOpen={!!grid.pic} title="Picture" summary={grid.pic ? `${grid.pic.tex} · ${GRID_LABELS.pic[grid.pic.mode].label.toLowerCase()}` : 'none'}>
        <BuilderNote>Cut a picture up into the grid: the shapes carry it, so you see the shapes made of the picture, not the picture itself.</BuilderNote>
        <TexturePicker id="grid" sources={sources} value={grid.pic?.tex} onAdd={addSource} none="No picture"
          onChange={name => set(g => { g.pic = name ? { tex: name, mode: g.pic?.mode ?? 'piece' } : null; })} />
        {grid.pic && (
          <>
            <Row label="Mode" hint={GRID_PIC_MODES.map(m => `${GRID_LABELS.pic[m].label}: ${GRID_LABELS.pic[m].blurb}`).join('\n')}>
              <Select ariaLabel="Grid picture mode" value={grid.pic.mode} options={GRID_PIC_MODES.map(m => ({ value: m, label: GRID_LABELS.pic[m].label }))}
                onChange={v => set(g => { if (g.pic) g.pic.mode = v as GridPicMode; })} />
            </Row>
            <BuilderNote>{GRID_LABELS.pic[grid.pic.mode].blurb}</BuilderNote>
          </>
        )}
      </Card>
    </div>
  );
}

function LookTab() {
  const look = useSceneBuilder2D(s => s.scene.look);
  const hasGrid = useSceneBuilder2D(s => !!s.scene.grid && s.scene.grid.colourBy !== 'shape');
  const sources = useSceneBuilder2D(s => s.scene.textures) ?? [];
  const set = (fn: (l: Scene2D['look']) => void, key?: string) => edit(d => fn(d.look), key && `look:${key}`);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card id="look2-colour" defaultOpen title="Colour" summary={look.colour.by === 'layer' ? 'each layer its own' : `by ${look.colour.by} · ${look.colour.palette}`}>
        <ColourRow label="Background" value={look.bg} onChange={v => set(l => { l.bg = v; }, 'bg')} />
        <Row label="Colour by">
          <Select ariaLabel="Colour by" value={look.colour.by} options={COLOUR_BYS.map(c => ({ value: c, label: c === 'layer' ? "each layer's colour" : c }))} onChange={v => set(l => { l.colour.by = v as typeof l.colour.by; })} />
        </Row>
        {(look.colour.by !== 'layer' || hasGrid) && (
          <>
            <Row label="Palette" hint={look.colour.by === 'layer' ? 'Used by the grid (Grid → Colour by ripple or cell).' : undefined}><Select ariaLabel="Palette" value={look.colour.palette} options={PALETTES.map(p => ({ value: p.key, label: p.label }))} onChange={v => set(l => { l.colour.palette = v; })} /></Row>
            <NumRow label="Scale" value={look.colour.scale} defaultValue={DEFAULT_SCENE_2D.look.colour.scale} min={0.1} max={8} onChange={v => set(l => { l.colour.scale = v; }, 'cs')} />
            <NumRow label="Drift" hint="How fast the palette cycles over time." value={look.colour.speed} defaultValue={DEFAULT_SCENE_2D.look.colour.speed} min={-1} max={1} onChange={v => set(l => { l.colour.speed = v; }, 'cv')} />
          </>
        )}
      </Card>
      <Card id="look2-picture" defaultOpen={!!look.bgTex} title="Background picture" summary={look.bgTex ? `${look.bgTex.tex}${look.bgTex.warp ? ' · bent by the space' : ''}` : 'none'}>
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
      <Card id="look2-glow" defaultOpen title="Glow" summary={look.glow.mode}>
        <Row label="Glow">
          <Select ariaLabel="Glow" value={look.glow.mode} options={[{ value: 'off', label: 'Off' }, { value: 'all', label: 'All shapes' }, { value: 'selected', label: 'Only layers marked Glow' }]}
            onChange={v => set(l => { l.glow.mode = v as GlowMode; })} />
        </Row>
        {look.glow.mode !== 'off' && (
          <>
            <NumRow label="Amount" value={look.glow.amount} defaultValue={DEFAULT_SCENE_2D.look.glow.amount} min={0.001} max={0.05} step={0.0005} onChange={v => set(l => { l.glow.amount = v; }, 'ga')} />
            <NumRow label="Falloff" value={look.glow.falloff} defaultValue={DEFAULT_SCENE_2D.look.glow.falloff} min={0.5} max={3} onChange={v => set(l => { l.glow.falloff = v; }, 'gf')} />
          </>
        )}
      </Card>
      <Card id="look2-finish" title="Finish" summary={`tone ${look.tone}${look.post.bloom ? ' · bloom' : ''}${look.post.vignette ? ' · vignette' : ''}`}>
        <Row label="Tone map"><Select ariaLabel="Tone map" value={look.tone} options={TONE_MODES.map(t => ({ value: t, label: t }))} onChange={v => set(l => { l.tone = v as ToneMode; })} /></Row>
        <NumRow label="Bloom" value={look.post.bloom} defaultValue={DEFAULT_SCENE_2D.look.post.bloom} min={0} max={1.5} onChange={v => set(l => { l.post.bloom = v; }, 'pb')} />
        <NumRow label="Vignette" value={look.post.vignette} defaultValue={DEFAULT_SCENE_2D.look.post.vignette} min={0} max={1} onChange={v => set(l => { l.post.vignette = v; }, 'pv')} />
        <NumRow label="Grain" value={look.post.grain} defaultValue={DEFAULT_SCENE_2D.look.post.grain} min={0} max={0.5} onChange={v => set(l => { l.post.grain = v; }, 'pg')} />
        <NumRow label="Scanlines" value={look.post.scanlines} defaultValue={DEFAULT_SCENE_2D.look.post.scanlines} min={0} max={1} onChange={v => set(l => { l.post.scanlines = v; }, 'ps')} />
      </Card>
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
    if (!errs.length) useSceneBuilder2D.getState().replace(r.scene);
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
      <BuilderNote>UV → {scene.space.length ? `${scene.space.length} space transform${scene.space.length === 1 ? '' : 's'} (blocks as Expression Blocks with sliders) → ` : ''}{allShapes(scene).length} shape{allShapes(scene).length === 1 ? '' : 's'} with their placing, motion and copies{scene.grid ? ' and a grid (one Expression Block, line by line)' : ''} → colour and glow{scene.look.tone !== 'none' ? ' → Tone Map' : ''} → the Output. Every node gets a note.</BuilderNote>
    </div>
  );
}

export function SceneBuilder2DModal() {
  const tk = useTokens();
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

  const body = { space: <SpaceTab />, shapes: <ShapesTab />, grid: <GridTab />, look: <LookTab />, output: <OutputTab />, recipe: <RecipeTab />, templates: <TemplatesTab /> }[tab];
  void num;
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
        <IconButton icon="undo" label="Undo" shortcut="cmd+z" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" label="Redo" shortcut="cmd+shift+z" disabled={!canRedo} onClick={redo} />
      </>}
      footer={<>
        {editing && <Button icon="copy" onClick={() => buildFromBuilder2D(true)} title="Leave the built scene as it is and build this one beside it">Build as a new copy</Button>}
        <BuilderNote>{editing ? 'Rebuild replaces the scene it was built as, keeping settings you changed on its nodes.' : 'Build adds the graph to the canvas and shows it on the Output.'}</BuilderNote>
        <span style={{ flex: 1 }} />
        {dirty && <BuilderNote style={{ color: tk.text.faint }}>Not built yet</BuilderNote>}
        <Button onClick={() => finishBuilder(close, scene2dBuildIds(useSceneBuilder2D.getState().targetSceneId))}>Done</Button>
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
