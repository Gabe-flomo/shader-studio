/**
 * tabs.tsx — the Scene Builder's sections: Shapes, Combine, Bend space, Look,
 * Camera, Quality, Recipe, Templates and Describe. Each reads the spec from the
 * builder store and changes it through `edit` (one undo step per change, one
 * per drag).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSceneBuilder } from '../../sceneBuilder/store';
import {
  DEFAULT_LOOK, MODIFIER_KINDS, SHAPES, SHAPE_BY_KIND, TONE_MODES, WARPS, WARP_BY_KIND, allShapes, autoStepScale, defaultSize, findItem, itemName, modifierSummary, opLabel, stepHints, walkItems,
  type GroupSpec, type ParamDef, type RenderMode, type SceneItem, type SceneSpec, type ShapeSpec, type Vec3, type WarpSpec,
} from '../../sceneBuilder/spec';
import { randomShapeAction, randomiseThisAction } from './surpriseActions';
import { addModifier, addShape, addWarp, duplicateItem, moveBy, moveItem, moveModifierTo, moveWarp, removeItem, removeWarp, ungroup } from '../../sceneBuilder/edit';
import { GALLERY_SHAPES, type GalleryShape } from '../../sceneBuilder/thumbnails';
import { ShapeGallery, ShapeThumb } from './ShapeGallery';
import { NO_DRAG, OP_GLYPH } from './controls';
import { Icon } from '../ui/Icon';
import { RECIPE_VOCABULARY, parseRecipe, printRecipe, type RecipeError, type RecipeHint } from '../../sceneBuilder/recipe';
import { freshSeed, type Resolved } from '../../lang/random';
import { SCENE_TEMPLATES } from '../../sceneBuilder/templates';
import { describeIntoBuilder } from '../../sceneBuilder/actions';
import { Card, ColourRow, NumRow, Row, Vec3Row, rgbCss } from './controls';
import { BuilderHelp, BuilderLabel, BuilderNote, EmptyHelp } from '../builders/BuilderWindow';
import type { HelpExample } from '../builders/helpContent';
import { AssistList, SignatureLine, useTypeAhead } from '../builders/TypeAhead';
import { recipeAssist } from '../../lang/complete';
import { CodeField } from '../code/CodeField';
import type { Completion } from '../code/glslReference';
import { RecipeCode } from './RecipeCode';
import { recipeHtml } from './recipeColours';
import { RecipeRows } from './RecipeRows';
import { OUTPUTS, OUTPUT_BY_SHOW, PALETTES, DEFAULT_PALETTE, outputClause, outputProblem, type OutputShow } from '../../sceneBuilder/output';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { Segmented, Toggle } from '../ui/Choice';
import { Menu } from '../ui/Menu';
import { Callout } from '../ui/Callout';
import { toast } from '../ui/toastStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

const Pane = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
);

/** A help example's recipe clause added to the scene (one undo step). */
function useInsertExample() {
  const spec = useSceneBuilder(s => s.spec);
  const replace = useSceneBuilder(s => s.replace);
  return (ex: HelpExample) => {
    if (!('recipe' in ex.insert)) return;
    const r = parseRecipe(`${printRecipe(spec)} · ${ex.insert.recipe}`);
    if (r.errors.length) { toast.warning('That example didn\'t fit', { message: r.errors[0].message }); return; }
    replace(r.spec);
    toast.success(`Added: ${ex.insert.recipe}`, { message: 'Undo takes it back.' });
  };
}

const fmtN = (n: number) => String(Math.round(n * 1000) / 1000);
const vecText = (v: Vec3) => `(${v.map(fmtN).join(', ')})`;

function ParamRows({ params, values, onChange, keyPrefix }: {
  params: ParamDef[]; values: Record<string, unknown>; onChange: (key: string, v: number | Vec3) => void; keyPrefix: string;
}) {
  return (
    <>
      {params.map(p => {
        const v = values[p.key] ?? p.def;
        if (Array.isArray(p.def)) {
          const vv = (Array.isArray(v) ? v : [Number(v), Number(v), Number(v)]) as Vec3;
          return <Vec3Row key={`${keyPrefix}${p.key}`} label={p.label} hint={p.hint} value={vv} min={p.min} max={p.max} step={p.step} onChange={nv => onChange(p.key, nv)} />;
        }
        return <NumRow key={`${keyPrefix}${p.key}`} label={p.label} hint={p.hint} unit={p.deg ? '°' : undefined} value={Number(v)} min={p.min} max={p.max} step={p.step} integer={p.step === 1} onChange={nv => onChange(p.key, nv)} />;
      })}
    </>
  );
}

// ── Shapes ──────────────────────────────────────────────────────────────────

/** The six combines, as the inspector's operator buttons. */
const OPS: Array<{ value: string; glyph: string; label: string }> = [
  { value: 'union', glyph: '∪', label: 'Union' },
  { value: 'smooth-union', glyph: '∪', label: 'Smooth union' },
  { value: 'subtract', glyph: '−', label: 'Subtract' },
  { value: 'smooth-subtract', glyph: '−', label: 'Smooth subtract' },
  { value: 'intersect', glyph: '∩', label: 'Intersect' },
  { value: 'smooth-intersect', glyph: '∩', label: 'Smooth intersect' },
];

/** The drag type a modifier chip carries (its warp id), for reordering. */
const MOD_DRAG = 'application/x-scene-modifier';

/**
 * An item's modifiers as chips, in order (the first bends the most, outside in): click one to edit
 * it below, drag to reorder (or Earlier / Later on the open one), × to remove, + to add.
 */
function ModifierStack({ item }: { item: SceneItem }) {
  const tk = useTokens();
  const edit = useSceneBuilder(s => s.edit);
  const warpId = useSceneBuilder(s => s.warpId);
  const selectWarp = useSceneBuilder(s => s.selectWarp);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const open = item.warps.find(w => w.id === warpId) ?? null;
  const add = (kind: string) => { let id = ''; edit(d => { id = addModifier(d, item.id, kind); }); selectWarp(item.id, id); };
  const more = WARPS.filter(w => !(MODIFIER_KINDS as readonly string[]).includes(w.kind));
  return (
    <div data-modifier-stack style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <BuilderLabel meta={item.warps.length ? `${item.warps.length} · outside in` : undefined}
        hint="Modifiers change only this item, in order: the first is applied last to the shape, like wrapping it (move, then rotate, then twist). Distance modifiers (Round, Onion, Displace) reshape its surface.">
        Modifiers
      </BuilderLabel>
      <div role="list" aria-label="Modifiers" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {item.warps.map((w, i) => {
          const sum = modifierSummary(w);
          const on = w.id === warpId;
          return (
            <span role="listitem" key={w.id} data-modifier-chip={w.kind} draggable={!NO_DRAG}
              onDragStart={e => { e.dataTransfer.setData(MOD_DRAG, w.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={e => { if (e.dataTransfer.types.includes(MOD_DRAG)) { e.preventDefault(); setOver(i); } }}
              onDragLeave={() => setOver(o => (o === i ? null : o))}
              onDrop={e => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData(MOD_DRAG); if (id && id !== w.id) edit(d => moveModifierTo(d, item.id, id, i)); }}
              onClick={() => selectWarp(item.id, on ? null : w.id)}
              title={WARP_BY_KIND[w.kind]?.blurb ?? 'A part of a described graph the builder can\'t build.'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 4px 0 9px', borderRadius: 14, cursor: NO_DRAG ? 'pointer' : 'grab', userSelect: 'none',
                background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.primary,
                boxShadow: `inset 0 0 0 ${on || over === i ? 1.5 : 1}px ${on || over === i ? tk.accent.base : tk.border.default}`,
                font: `600 11.5px ${fontFamily.ui}`,
              }}>
              <span style={{ font: `600 10px ${fontFamily.mono}`, color: tk.text.faint }}>{i + 1}</span>
              {sum.label}
              {sum.value && <span style={{ font: `500 11px ${fontFamily.mono}`, color: on ? tk.accent.text : tk.text.muted }}>{sum.value}</span>}
              <button type="button" aria-label={`Remove ${sum.label}`} title="Remove"
                onClick={e => { e.stopPropagation(); edit(d => removeWarp(d, item.id, w.id)); }}
                style={{ width: 20, height: 20, border: 0, borderRadius: 10, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                <Icon name="close" size={11} />
              </button>
            </span>
          );
        })}
        <Button size="sm" variant="ghost" icon="plus" onClick={e => setMenu({ x: e.clientX, y: e.clientY })}>Modifier</Button>
      </div>
      {open && <WarpCard key={open.id} item={item} w={open} index={item.warps.indexOf(open)} count={item.warps.length} />}
      {!item.warps.length && <BuilderNote>None yet: move, rotate, scale, twist, bend, repeat, mirror, round or hollow just this {item.type === 'group' ? 'group' : 'shape'}.</BuilderNote>}
      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} title="Add a modifier" items={[
        ...MODIFIER_KINDS.map(k => ({ label: WARP_BY_KIND[k].label, hint: WARP_BY_KIND[k].blurb, onSelect: () => add(k) })),
        { heading: 'More warps' },
        ...more.map(w => ({ label: w.label, hint: w.blurb, onSelect: () => add(w.kind) })),
      ]} />}
    </div>
  );
}

function ShapeInspector({ sh }: { sh: ShapeSpec }) {
  const spec = useSceneBuilder(s => s.spec);
  const edit = useSceneBuilder(s => s.edit);
  const mode = spec.look.mode;
  const def = SHAPE_BY_KIND[sh.kind];
  const set = (fn: (s: ShapeSpec) => void, key?: string) => edit(d => { const it = findItem(d, sh.id)?.item; if (it?.type === 'shape') fn(it); }, key);
  if (!def) return <BuilderNote>custom({sh.label}): a part of a described graph the builder can't build. Build leaves it out.</BuilderNote>;
  return <>
    <Row label="Name" hint="Optional: what the notes, the tree and the recipe call it."><Field value={sh.name} placeholder={def.label} aria-label="Shape name" onChange={e => set(s => { s.name = e.target.value; }, `name:${sh.id}`)} /></Row>
    <Row label="Shape" hint="Its kind. Changing it resets the size settings to the new kind's.">
      <Select ariaLabel="Shape kind" value={sh.kind} options={SHAPES.map(s => ({ value: s.kind, label: s.label }))}
        onChange={k => set(s => { s.kind = k; s.size = defaultSize(k); })} style={{ width: '100%' }} />
    </Row>
    <BuilderNote>{def.blurb}</BuilderNote>
    <ParamRows keyPrefix={sh.id} params={def.params} values={sh.size} onChange={(k, v) => set(s => { s.size[k] = v; }, `size:${sh.id}:${k}`)} />
    <Vec3Row label="Position" hint="Where its centre is: X right, Y up, Z toward the camera." value={sh.at} min={-5} max={5} onChange={v => set(s => { s.at = v; }, `at:${sh.id}`)} />
    <Vec3Row label="Rotation" hint="Degrees about X, then Y, then Z." value={sh.rot} min={-180} max={180} step={0.5} onChange={v => set(s => { s.rot = v; }, `rot:${sh.id}`)} />
    <ColourRow label="Colour" value={sh.color} hint={mode === 'surface' ? 'Its surface colour (Surface mode picks one per shape).' : 'Colours show in Surface mode; GI uses the first shape\'s, Volumetric its glow tint.'} onChange={v => set(s => { s.color = v; }, `color:${sh.id}`)} />
    <NumRow label="Shine" hint="How strong its highlight is: 0 matt, 1 glossy (Surface mode)." value={sh.shine} min={0} max={1} onChange={v => set(s => { s.shine = v; }, `shine:${sh.id}`)} />
    {mode === 'glass' && <Row label="Glass" hint="In Glass mode: glass shapes refract the others."><Toggle checked={sh.glass} onChange={v => set(s => { s.glass = v; })} label={sh.glass ? 'Made of glass' : 'Seen through the glass'} /></Row>}
  </>;
}

function GroupInspector({ g }: { g: GroupSpec }) {
  const spec = useSceneBuilder(s => s.spec);
  const edit = useSceneBuilder(s => s.edit);
  const select = useSceneBuilder(s => s.select);
  const tk = useTokens();
  const isRoot = g.id === spec.root.id;
  const set = (fn: (x: GroupSpec) => void, key?: string) => edit(d => { const it = findItem(d, g.id)?.item; if (it?.type === 'group') fn(it); }, key);
  const value = `${g.k > 0 ? 'smooth-' : ''}${g.op}`;
  return <>
    {!isRoot && <Row label="Name" hint="Optional: a name for the group in notes and the tree."><Field value={g.name} placeholder={opLabel(g)} aria-label="Group name" onChange={e => set(x => { x.name = e.target.value; }, `gname:${g.id}`)} /></Row>}
    <div role="radiogroup" aria-label="Operator" data-op-grid style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 6 }}>
      {OPS.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} data-op={o.value}
            onClick={() => set(x => { const smooth = o.value.startsWith('smooth-'); x.op = o.value.replace('smooth-', '') as GroupSpec['op']; x.k = smooth ? (x.k > 0 ? x.k : 0.3) : 0; })}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left',
              background: on ? tk.bg.selected : tk.bg.panel, color: on ? tk.accent.text : tk.text.secondary,
              boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? tk.accent.base : tk.border.default}`, font: `${on ? 650 : 500} 12px ${fontFamily.ui}`,
            }}>
            <span style={{ font: `700 15px ${fontFamily.mono}`, width: 14, textAlign: 'center' }}>{o.glyph}</span>
            {o.label}{o.value.startsWith('smooth') && <span style={{ marginLeft: 'auto', font: `600 10px ${fontFamily.mono}`, color: tk.text.faint }}>k</span>}
          </button>
        );
      })}
    </div>
    {g.k > 0 && <NumRow label="Blend radius (k)" hint="How wide the blend is, in scene units." value={g.k} min={0.01} max={1} step={0.005} onChange={v => set(x => { x.k = v; }, `k:${g.id}`)} />}
    <BuilderLabel hint="Order matters for Subtract: the first item is the shape, the rest cut it.">Items, in order</BuilderLabel>
    {g.children.map((c, i) => (
      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
        <span style={{ width: 18, font: `600 11px ${fontFamily.mono}`, color: tk.text.faint }}>{i + 1}</span>
        {c.type === 'shape' ? <ShapeThumb kind={c.kind} size={20} /> : <span style={{ width: 20, textAlign: 'center', font: `700 13px ${fontFamily.mono}`, color: tk.text.secondary }}>{OP_GLYPH[c.op]}</span>}
        <button type="button" onClick={() => select(c.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, fontSize: 12.5, color: tk.text.primary, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {itemName(spec, c)} <span style={{ color: tk.text.faint }}>{c.type === 'group' ? opLabel(c) : SHAPE_BY_KIND[c.kind]?.label}{g.op === 'subtract' ? (i === 0 ? ' · the shape' : ' · cuts') : ''}</span>
        </button>
        <IconButton icon="chevU" size="sm" tooltip={false} label="Move up" disabled={i === 0} onClick={() => edit(d => { moveBy(d, c.id, -1); })} />
        <IconButton icon="chevD" size="sm" tooltip={false} label="Move down" disabled={i === g.children.length - 1} onClick={() => edit(d => { moveBy(d, c.id, 1); })} />
      </div>
    ))}
    {g.children.length === 0 && <BuilderNote>Empty: add a shape from the gallery, or drag items onto it in the Scene tree.</BuilderNote>}
  </>;
}

/** The selected item, to edit: its settings, then its modifiers. */
function Inspector({ item }: { item: SceneItem }) {
  const spec = useSceneBuilder(s => s.spec);
  const edit = useSceneBuilder(s => s.edit);
  const select = useSceneBuilder(s => s.select);
  const tk = useTokens();
  const isRoot = item.id === spec.root.id;
  return (
    <section data-inspector={item.id} aria-label="Inspector" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px 14px', borderRadius: radius.control, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36 }}>
        {item.type === 'shape'
          ? <ShapeThumb kind={item.kind} size={36} />
          : <span style={{ width: 36, height: 36, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tk.bg.field, color: tk.text.secondary, font: `700 18px ${fontFamily.mono}` }}>{OP_GLYPH[item.op]}</span>}
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 650, fontSize: 14, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isRoot ? 'The whole scene' : itemName(spec, item)}</span>
          <span style={{ fontSize: 11.5, color: tk.text.muted }}>{item.type === 'shape' ? SHAPE_BY_KIND[item.kind]?.label ?? 'custom' : `${opLabel(item)}${item.k > 0 ? ` · k ${item.k}` : ''} · ${item.children.length} item${item.children.length === 1 ? '' : 's'}`}</span>
        </span>
        {item.type === 'shape' && item.color && <span title="Its colour" style={{ width: 14, height: 14, borderRadius: 4, background: rgbCss(item.color), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.18)' }} />}
        <IconButton icon="dice" size="sm" label={isRoot ? 'Randomise this: a new look and camera (one undo step)' : 'Randomise this: new settings for it (one undo step)'} onClick={() => randomiseThisAction(item.id)} data-randomise-this />
        {!isRoot && <IconButton icon="copy" size="sm" label="Duplicate" onClick={() => { let id = ''; edit(d => { id = duplicateItem(d, item.id)?.id ?? ''; }); if (id) select(id); }} />}
        {!isRoot && item.type === 'group' && <IconButton icon="unlink" size="sm" label="Ungroup (its items take its place)" onClick={() => edit(d => ungroup(d, item.id))} />}
        {!isRoot && <IconButton icon="trash" size="sm" tone="danger" label="Remove" onClick={() => { edit(d => removeItem(d, item.id)); select(null); }} />}
      </div>
      {item.type === 'shape' ? <ShapeInspector sh={item} /> : <GroupInspector g={item} />}
      <div style={{ height: 1, background: tk.border.subtle, margin: '4px 0' }} />
      {isRoot
        ? <BuilderNote>The whole scene's warps are under Bend space.</BuilderNote>
        : <ModifierStack key={item.id} item={item} />}
    </section>
  );
}

export function ShapesTab() {
  const spec = useSceneBuilder(s => s.spec);
  const selectedId = useSceneBuilder(s => s.selectedId);
  const edit = useSceneBuilder(s => s.edit);
  const select = useSceneBuilder(s => s.select);
  const shapes = allShapes(spec);
  const insert = useInsertExample();
  const sel = (selectedId && findItem(spec, selectedId)?.item) || null;
  const add = (g: GalleryShape) => {
    let id = '';
    edit(d => { const sh = addShape(d, g.kind, selectedId); if (g.size) Object.assign(sh.size, structuredClone(g.size)); if (g.key !== g.kind) sh.name = ''; id = sh.id; });
    select(id);
  };
  return (
    <Pane>
      <BuilderLabel meta={`${shapes.length} shape${shapes.length === 1 ? '' : 's'}`}>Shapes</BuilderLabel>
      {shapes.length === 0 ? <EmptyHelp id="shapes" onExample={insert} /> : <BuilderHelp id="shapes" onExample={insert} />}
      <Card id="gallery" title="Add a shape" defaultOpen summary={`${GALLERY_SHAPES.length} shapes: click to add${NO_DRAG ? '' : ', or drag into the Scene tree'}`}>
        <BuilderNote>{NO_DRAG ? 'Tap a shape to add it beside the selection (into it, if it is a group).' : 'Click a shape to add it beside the selection (into it, if it is a group), or drag it onto a row of the Scene tree.'}</BuilderNote>
        <ShapeGallery onPick={add} />
        <Button size="sm" icon="dice" style={{ alignSelf: 'flex-start' }} onClick={() => randomShapeAction()} data-random-shape
          title="Add one random shape with a random size, place, turn and colour (one undo step)">Random shape</Button>
      </Card>
      {sel ? <Inspector item={sel} /> : shapes.length > 0 && <BuilderNote>Select a shape or a group in the Scene tree to edit it here.</BuilderNote>}
    </Pane>
  );
}

// ── Combine ─────────────────────────────────────────────────────────────────

const OP_OPTIONS = [
  { value: 'union', label: 'Union: the nearer surface wins' },
  { value: 'smooth-union', label: 'Smooth union: melt together' },
  { value: 'subtract', label: 'Subtract: cut the rest out of the first' },
  { value: 'smooth-subtract', label: 'Smooth subtract: a softened cut' },
  { value: 'intersect', label: 'Intersect: only where all overlap' },
  { value: 'smooth-intersect', label: 'Smooth intersect: a rounded overlap' },
];

/** The tree as a formula of chips: smooth-union(Body, Head, union(…)). */
function Formula({ spec, item }: { spec: SceneSpec; item: SceneItem }) {
  const tk = useTokens();
  if (item.type === 'shape') {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 7, background: tk.bg.field, color: tk.text.primary }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: rgbCss(item.color) }} />{itemName(spec, item)}
    </span>;
  }
  const op = `${item.k > 0 ? 'smooth-' : ''}${item.op}`;
  return <span style={{ color: tk.text.secondary }}>
    <b style={{ color: tk.accent.text }}>{op}</b>(
    {item.children.map((c, i) => <span key={c.id}>{i > 0 && ', '}<Formula spec={spec} item={c} /></span>)}
    ){item.k > 0 ? <span style={{ color: tk.text.faint }}> k={item.k}</span> : null}
  </span>;
}

export function CombineTab() {
  const spec = useSceneBuilder(s => s.spec);
  const selectedId = useSceneBuilder(s => s.selectedId);
  const edit = useSceneBuilder(s => s.edit);
  const select = useSceneBuilder(s => s.select);
  const tk = useTokens();
  const groups: Array<{ g: GroupSpec; depth: number }> = [];
  walkItems(spec.root, (it, _p, depth) => { if (it.type === 'group') groups.push({ g: it, depth }); });
  const setGroup = (id: string, fn: (g: GroupSpec) => void, key?: string) => edit(d => { const it = findItem(d, id)?.item; if (it?.type === 'group') fn(it); }, key);
  const insert = useInsertExample();
  return (
    <Pane>
      <BuilderLabel>Combine</BuilderLabel>
      <BuilderHelp id="combine" onExample={insert} />
      <BuilderNote>Drag items in the Scene tree to reorder or nest them.</BuilderNote>
      <div data-combine-formula style={{ padding: '10px 12px', borderRadius: radius.control, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, font: `12.5px ${fontFamily.mono}`, lineHeight: 2 }}>
        <Formula spec={spec} item={spec.root} />
      </div>
      {groups.map(({ g, depth }) => {
        const isRoot = g.id === spec.root.id;
        return (
          <Card key={g.id} id={`group:${g.id}`} title={isRoot ? 'Scene (the root)' : itemName(spec, g)} summary={`${opLabel(g)}${g.k > 0 ? ` k ${g.k}` : ''} · ${g.children.map(c => itemName(spec, c)).join(', ') || 'empty'}`}
            defaultOpen={g.id === selectedId || groups.length === 1} selected={g.id === selectedId} onHeaderClick={() => select(g.id)}
            actions={!isRoot && <>
              <IconButton icon="unlink" size="sm" label="Ungroup (its items take its place)" onClick={() => edit(d => ungroup(d, g.id))} />
              <IconButton icon="trash" size="sm" tone="danger" label="Remove the group and what is in it" onClick={() => edit(d => removeItem(d, g.id))} />
            </>}>
            <div style={{ marginLeft: depth * 4 }} />
            {!isRoot && <Row label="Name" hint="Optional: a name for the group in notes and the tree."><Field value={g.name} placeholder="Group" aria-label="Group name" onChange={e => setGroup(g.id, x => { x.name = e.target.value; }, `gname:${g.id}`)} /></Row>}
            <Row label="Operator" hint="How the items join: union keeps the nearer, subtract cuts later ones out of the first, intersect keeps the overlap. Smooth ones blend.">
              <Select ariaLabel="Operator" value={`${g.k > 0 ? 'smooth-' : ''}${g.op}`} options={OP_OPTIONS} style={{ width: '100%' }}
                onChange={v => setGroup(g.id, x => { const smooth = v.startsWith('smooth-'); x.op = v.replace('smooth-', '') as GroupSpec['op']; x.k = smooth ? (x.k > 0 ? x.k : 0.3) : 0; })} />
            </Row>
            {g.k > 0 && <NumRow label="Blend radius (k)" hint="How wide the blend is, in scene units." value={g.k} min={0.01} max={1} step={0.005} onChange={v => setGroup(g.id, x => { x.k = v; }, `k:${g.id}`)} />}
            <BuilderLabel hint="Order matters for Subtract: the first item is the shape, the rest cut it.">Items, in order</BuilderLabel>
            {g.children.map((c, i) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
                <span style={{ width: 18, font: `600 11px ${fontFamily.mono}`, color: tk.text.faint }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: tk.text.primary, cursor: 'pointer' }} onClick={() => select(c.id)}>
                  {itemName(spec, c)} <span style={{ color: tk.text.faint }}>{c.type === 'group' ? opLabel(c) : SHAPE_BY_KIND[c.type === 'shape' ? c.kind : '']?.label}{g.op === 'subtract' ? (i === 0 ? ' · the shape' : ' · cuts') : ''}</span>
                </span>
                <IconButton icon="chevU" size="sm" tooltip={false} label="Move up" disabled={i === 0} onClick={() => edit(d => { moveItem(d, c.id, g.children[i - 1].id, 'before'); })} />
                <IconButton icon="chevD" size="sm" tooltip={false} label="Move down" disabled={i === g.children.length - 1} onClick={() => edit(d => { moveItem(d, c.id, g.children[i + 1].id, 'after'); })} />
                {!isRoot && <IconButton icon="chevL" size="sm" label="Move out of this group" onClick={() => edit(d => { moveItem(d, c.id, g.id, 'after'); })} />}
              </div>
            ))}
            {g.children.length === 0 && <BuilderNote>Empty: drag shapes onto it in the Scene tree.</BuilderNote>}
          </Card>
        );
      })}
    </Pane>
  );
}

// ── Bend space ──────────────────────────────────────────────────────────────

function WarpCard({ item, w, index, count }: { item: SceneItem; w: WarpSpec; index: number; count: number }) {
  const edit = useSceneBuilder(s => s.edit);
  const tk = useTokens();
  const def = WARP_BY_KIND[w.kind];
  const set = (fn: (x: WarpSpec) => void, key?: string) => edit(d => { const it = findItem(d, item.id)?.item; const x = it?.warps.find(y => y.id === w.id); if (x) fn(x); }, key);
  const hint = def ? def.stepHint(w) : 1;
  return (
    <Card id={`warp:${w.id}`} title={`${index + 1}. ${def?.label ?? `custom(${w.label})`}`} defaultOpen
      summary={def ? def.params.map(p => `${p.key} ${Array.isArray(w.values[p.key]) ? vecText(w.values[p.key] as Vec3) : fmtN(Number(w.values[p.key]))}`).join(' · ') : ''}
      actions={<>
        {hint < 1 && <span title={`It stretches space: the march wants Step Scale ${hint} or less (Quality).`} style={{ padding: '1px 7px', borderRadius: 6, background: tk.status.warning, color: '#1a1b23', font: `700 10.5px ${fontFamily.ui}`, marginRight: 4 }}>step {hint}</span>}
        <IconButton icon="chevU" size="sm" tooltip={false} label="Earlier" disabled={index === 0} onClick={() => edit(d => moveWarp(d, item.id, w.id, -1))} />
        <IconButton icon="chevD" size="sm" tooltip={false} label="Later" disabled={index === count - 1} onClick={() => edit(d => moveWarp(d, item.id, w.id, 1))} />
        <IconButton icon="trash" size="sm" tone="danger" label="Remove" onClick={() => edit(d => removeWarp(d, item.id, w.id))} />
      </>}>
      {def ? <>
        <BuilderNote>{def.blurb}</BuilderNote>
        {def.axes?.kind === 'flags' && (
          <Row label={def.axes.label}>
            <span style={{ display: 'flex', gap: 12 }}>
              {(['x', 'y', 'z'] as const).map(a => {
                const on = String(w.values[def.axes!.key] ?? '').includes(a);
                return <Toggle key={a} checked={on} label={a.toUpperCase()} onChange={v => set(x => {
                  const cur = String(x.values[def.axes!.key] ?? '');
                  const next = 'xyz'.split('').filter(c => (c === a ? v : cur.includes(c))).join('');
                  x.values[def.axes!.key] = next || a;
                })} />;
              })}
            </span>
          </Row>
        )}
        {def.axes?.kind === 'one' && (
          <Row label={def.axes.label}>
            <Segmented size="sm" ariaLabel={def.axes.label} value={String(w.values[def.axes.key] ?? def.axes.def)} options={def.axes.options.map(o => ({ value: o, label: o.toUpperCase() }))}
              onChange={v => set(x => { x.values[def.axes!.key] = v; })} />
          </Row>
        )}
        {def.select && (
          <Row label={def.select.label}>
            <Segmented size="sm" ariaLabel={def.select.label} value={String(w.values[def.select.key] ?? def.select.def)} options={def.select.options.map(o => ({ value: o, label: o.length === 1 ? o.toUpperCase() : o }))}
              onChange={v => set(x => { x.values[def.select!.key] = v; })} />
          </Row>
        )}
        <ParamRows keyPrefix={w.id} params={def.params} values={w.values} onChange={(k, v) => set(x => { x.values[k] = v; }, `warp:${w.id}:${k}`)} />
      </> : <BuilderNote>A warp from a described graph the builder can't build; Build leaves it out.</BuilderNote>}
    </Card>
  );
}

export function WarpsTab() {
  const spec = useSceneBuilder(s => s.spec);
  const selectedId = useSceneBuilder(s => s.selectedId);
  const select = useSceneBuilder(s => s.select);
  const edit = useSceneBuilder(s => s.edit);
  const tk = useTokens();
  const target = (selectedId && findItem(spec, selectedId)?.item) || spec.root;
  const options: Array<{ value: string; label: string }> = [];
  walkItems(spec.root, (it, _p, depth) => options.push({ value: it.id, label: `${'  '.repeat(depth)}${it.id === spec.root.id ? 'The whole scene' : `${itemName(spec, it)} (${it.type === 'group' ? opLabel(it) : SHAPE_BY_KIND[it.kind]?.label ?? 'custom'})`}` }));
  const hints = stepHints(spec);
  const insert = useInsertExample();
  return (
    <Pane>
      <BuilderLabel>Bend space</BuilderLabel>
      <BuilderHelp id="warps" onExample={insert} />
      <Row label="Bend" hint="What the warps below bend: the whole scene, a group or one shape.">
        <Select ariaLabel="What to bend" value={target.id} options={options} onChange={id => select(id)} style={{ width: '100%' }} />
      </Row>
      {target.warps.map((w, i) => <WarpCard key={w.id} item={target} w={w} index={i} count={target.warps.length} />)}
      {target.warps.length === 0 && <BuilderNote>Nothing bends {target.id === spec.root.id ? 'the whole scene' : itemName(spec, target)} yet. Add a warp:</BuilderNote>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
        {WARPS.map(w => (
          <button key={w.kind} type="button" title={w.blurb} onClick={() => edit(d => addWarp(d, target.id, w.kind))}
            style={{ textAlign: 'left', padding: '7px 9px', borderRadius: radius.md, border: `1px dashed ${tk.border.strong}`, background: 'none', cursor: 'pointer', color: tk.text.secondary, font: `500 12px ${fontFamily.ui}` }}>
            + {w.label}
          </button>
        ))}
      </div>
      <Callout tone={hints.length ? 'warning' : 'info'} title={`Step Scale: ${spec.quality.stepScale === 'auto' ? `auto, ${autoStepScale(spec)}` : spec.quality.stepScale}`}>
        {hints.length
          ? <>Warps that stretch space make the scene's distances too large, and a full step can jump through a surface (holes, torn edges). The march loop takes a fraction of each step instead. Asking: {hints.slice(0, 4).map(h => `${h.why} (${h.value})`).join('; ')}.</>
          : <>Nothing here stretches space, so the march takes full steps (1).</>}
      </Callout>
    </Pane>
  );
}

// ── Look ────────────────────────────────────────────────────────────────────

const MODES: Array<{ value: RenderMode; label: string; blurb: string }> = [
  { value: 'surface', label: 'Surface', blurb: 'Lit surfaces: a March Loop finds them, then soft shadows, ambient occlusion and a sun-sky-bounce light rig (Multi-Light) shade them, with a colour and shine per shape.' },
  { value: 'volumetric', label: 'Volumetric glow', blurb: 'See-through glowing gas: the ray walks through the shapes and Volume Glow adds light at every step. Neon, plasma, nebulae.' },
  { value: 'glass', label: 'Glass', blurb: 'Glass shapes refract and reflect the rest of the scene (Glass Scene marches both). Mark shapes as glass under Shapes.' },
  { value: 'gi', label: 'GI lit', blurb: 'The GI Lit March Group: shadows, sky light, one bounce of light off nearby surfaces and a reflection. One colour for all shapes.' },
];

export function LookTab() {
  const spec = useSceneBuilder(s => s.spec);
  const edit = useSceneBuilder(s => s.edit);
  const L = spec.look;
  const set = (fn: (l: SceneSpec['look']) => void, key?: string) => edit(d => fn(d.look), key);
  const lit = L.mode === 'surface' || L.mode === 'gi';
  const insert = useInsertExample();
  return (
    <Pane>
      <BuilderLabel hint="The render mode: how the scene is drawn.">Look</BuilderLabel>
      <BuilderHelp id="look" onExample={insert} />
      <Segmented fill ariaLabel="Render mode" value={L.mode} options={MODES.map(m => ({ value: m.value, label: m.label }))} onChange={v => set(l => { l.mode = v; })} />
      <BuilderNote>{MODES.find(m => m.value === L.mode)?.blurb}</BuilderNote>
      {L.mode === 'volumetric' && (
        <Card id="look:glow" title="Glow" summary={`density ${L.glow.density} · falloff ${L.glow.falloff}`} defaultOpen>
          <NumRow label="Density" hint="Light added per bit of ray inside a shape." value={L.glow.density} min={0.001} max={0.3} step={0.001} onChange={v => set(l => { l.glow.density = v; }, 'glow:d')} />
          <NumRow label="Falloff" hint="How fast the glow fades outside a shape." value={L.glow.falloff} min={0.1} max={60} step={0.1} onChange={v => set(l => { l.glow.falloff = v; }, 'glow:f')} />
          <NumRow label="Shell" hint="Above 0 only a skin this thick glows: bubbles and rims." value={L.glow.shell} min={0} max={1} step={0.005} onChange={v => set(l => { l.glow.shell = v; }, 'glow:s')} />
          <NumRow label="Exposure" hint="How bright the gathered glow is before it is squeezed into colour." value={L.glow.exposure} min={0.01} max={20} onChange={v => set(l => { l.glow.exposure = v; }, 'glow:e')} />
          <ColourRow label="Tint" hint="The glow's colour." value={L.glow.tint} onChange={v => set(l => { l.glow.tint = v; }, 'glow:t')} />
        </Card>
      )}
      {L.mode === 'glass' && (
        <Card id="look:glass" title="Glass" summary={`IOR ${L.glass.ior}`} defaultOpen>
          <NumRow label="IOR" hint="How much the glass bends light: water 1.33, glass 1.5, diamond 2.4." value={L.glass.ior} min={1} max={3} step={0.01} onChange={v => set(l => { l.glass.ior = v; }, 'glass:ior')} />
          <NumRow label="Dispersion" hint="Splits the colours a little, like a prism." value={L.glass.dispersion} min={0} max={0.2} step={0.005} onChange={v => set(l => { l.glass.dispersion = v; }, 'glass:disp')} />
          <ColourRow label="Tint" hint="Light passing through the glass takes this colour." value={L.glass.tint} onChange={v => set(l => { l.glass.tint = v; }, 'glass:tint')} />
          <BuilderNote>{allShapes(spec).filter(s => s.glass).length} of {allShapes(spec).length} shapes are glass{allShapes(spec).some(s => s.glass) ? '' : ' (none marked: all of them are)'}. Glass Scene has its own sky behind everything.</BuilderNote>
        </Card>
      )}
      {L.mode === 'gi' && (
        <Card id="look:gi" title="Global illumination" summary={`bounce ${L.gi.strength} · rough ${L.gi.rough}`} defaultOpen>
          <NumRow label="Bounce" hint="How much light bounces off nearby surfaces." value={L.gi.strength} min={0} max={1} onChange={v => set(l => { l.gi.strength = v; }, 'gi:s')} />
          <NumRow label="Metallic" hint="0 plastic or stone, 1 metal (reflections take the surface colour)." value={L.gi.metal} min={0} max={1} onChange={v => set(l => { l.gi.metal = v; }, 'gi:m')} />
          <NumRow label="Roughness" hint="0 a mirror, 1 a blurry, matt reflection." value={L.gi.rough} min={0} max={1} onChange={v => set(l => { l.gi.rough = v; }, 'gi:r')} />
          <NumRow label="Reflection" hint="How strong the reflection is." value={L.gi.spec} min={0} max={1} onChange={v => set(l => { l.gi.spec = v; }, 'gi:spec')} />
        </Card>
      )}
      {L.mode !== 'volumetric' && (
        <Card id="look:lights" title="Lights" summary={`sun ${vecText(L.sunDir)}`} defaultOpen={L.mode === 'surface'}>
          <Vec3Row label="Sun direction" hint="Points toward the sun; only its direction matters." value={L.sunDir} min={-1} max={1} onChange={v => set(l => { l.sunDir = v; }, 'sun:dir')} />
          {L.mode !== 'glass' && <>
            <ColourRow label="Sun colour" hint="The sunlight's colour: warm for day, orange for sunset." value={L.sunColor} onChange={v => set(l => { l.sunColor = v; }, 'sun:c')} />
            <ColourRow label="Sky colour" hint="Light from above (the sky dome)." value={L.sky} onChange={v => set(l => { l.sky = v; }, 'sky')} />
            <ColourRow label="Bounce colour" hint="Light from below: the ground bouncing the sun back." value={L.bounce} onChange={v => set(l => { l.bounce = v; }, 'bounce')} />
          </>}
        </Card>
      )}
      {L.mode === 'surface' && (
        <Card id="look:shadow" title="Shadows & occlusion" summary={`${L.shadows ? `shadows ${L.shadows}` : 'no shadows'} · ${L.ao ? 'AO' : 'no AO'}`}>
          <Row label="Soft shadows" hint="Shadows from the sun, marched from each surface toward it."><Toggle checked={L.shadows > 0} onChange={v => set(l => { l.shadows = v ? DEFAULT_LOOK.shadows : 0; })} label={L.shadows > 0 ? 'On' : 'Off'} /></Row>
          {L.shadows > 0 && <NumRow label="Hardness" hint="8 soft … 32 hard." value={L.shadows} min={1} max={64} step={1} onChange={v => set(l => { l.shadows = v; }, 'shadows')} />}
          <Row label="Ambient occl." hint="Ambient occlusion: darkens creases and corners."><Toggle checked={L.ao > 0} onChange={v => set(l => { l.ao = v ? DEFAULT_LOOK.ao : 0; })} label={L.ao > 0 ? 'On' : 'Off'} /></Row>
          {L.ao > 0 && <NumRow label="AO step" hint="Smaller: finer contact shadows; larger: broader." value={L.ao} min={0.005} max={0.2} step={0.005} onChange={v => set(l => { l.ao = v; }, 'ao')} />}
        </Card>
      )}
      {lit && (
        <Card id="look:fog" title="Fog" summary={L.fog > 0 ? `density ${L.fog}` : 'clear'}>
          <NumRow label="Density" hint="0 is clear. Distance fades into the fog colour." value={L.fog} min={0} max={5} step={0.01} onChange={v => set(l => { l.fog = v; }, 'fog')} />
          <Row label="Colour" hint="Fog the colour of the background, or its own colour."><Toggle checked={!L.fogColor} onChange={v => set(l => { l.fogColor = v ? null : [...l.bg] as Vec3; })} label="Same as the background" /></Row>
          {L.fogColor && <ColourRow label="Fog colour" hint="What distance fades into." value={L.fogColor} onChange={v => set(l => { l.fogColor = v; }, 'fogc')} />}
        </Card>
      )}
      {L.mode !== 'glass' && (
        <Card id="look:bg" title="Background" summary={L.bg2 ? 'gradient' : 'solid'}>
          <Row label="Kind" hint="One colour, or a gradient from Top (looking up) to Bottom (looking down)."><Segmented size="sm" ariaLabel="Background kind" value={L.bg2 ? 'gradient' : 'solid'} options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]}
            onChange={v => set(l => { l.bg2 = v === 'gradient' ? [Math.min(1, l.bg[0] * 0.4), Math.min(1, l.bg[1] * 0.4), Math.min(1, l.bg[2] * 0.4)] : null; })} /></Row>
          <ColourRow label={L.bg2 ? 'Top' : 'Colour'} hint="What rays that miss every shape see." value={L.bg} onChange={v => set(l => { l.bg = v; }, 'bg')} />
          {L.bg2 && <ColourRow label="Bottom" hint="The bottom of the gradient (looking down)." value={L.bg2} onChange={v => set(l => { l.bg2 = v; }, 'bg2')} />}
        </Card>
      )}
      <Row label="Tone map" hint="Squeezes bright light into screen colours. None keeps colours as they are.">
        <Select ariaLabel="Tone map" value={L.tone} options={TONE_MODES.map(m => ({ value: m, label: m === 'none' ? 'None' : m.toUpperCase() }))} onChange={v => set(l => { l.tone = v as SceneSpec['look']['tone']; })} />
      </Row>
    </Pane>
  );
}

// ── Camera & quality ────────────────────────────────────────────────────────

export function CameraTab() {
  const C = useSceneBuilder(s => s.spec.camera);
  const edit = useSceneBuilder(s => s.edit);
  const set = (k: keyof SceneSpec['camera']) => (v: number) => edit(d => { d.camera[k] = v; }, `cam:${k}`);
  const insert = useInsertExample();
  return (
    <Pane>
      <BuilderLabel>Camera</BuilderLabel>
      <BuilderHelp id="camera" onExample={insert} />
      <BuilderNote>The orbit camera, as in Time Cube View, Frame Stack and Draw agents. Angles in degrees.</BuilderNote>
      <NumRow label="Distance" hint="How far the camera is from the point it looks at." value={C.dist} min={0.3} max={20} onChange={set('dist')} />
      <NumRow label="Angle" unit="°" hint="Where it stands round the point (0: in front)." value={C.angle} min={-180} max={180} step={0.5} onChange={set('angle')} />
      <NumRow label="Elevation" unit="°" hint="How far above it looks from: 0 level, 89 straight down." value={C.elev} min={-89} max={89} step={0.5} onChange={set('elev')} />
      <NumRow label="Orbit speed" unit="°/s" hint="Turns the camera round the point over time." value={C.orbit} min={-90} max={90} step={0.5} onChange={set('orbit')} />
      <NumRow label="Zoom" hint="Lens length: higher is zoomed in, with less perspective." value={C.zoom} min={0.5} max={5} onChange={set('zoom')} />
      <NumRow label="Flatten" hint="Perspective (0) to orthographic (1), like an isometric drawing." value={C.flatten} min={0} max={1} onChange={set('flatten')} />
      <NumRow label="Translate X" hint="Moves the camera and the point it looks at together." value={C.x} min={-5} max={5} onChange={set('x')} />
      <NumRow label="Translate Y" hint="Moves the camera and its point up or down together." value={C.y} min={-5} max={5} onChange={set('y')} />
      <NumRow label="Translate Z" hint="Moves the camera and its point toward or away together." value={C.z} min={-5} max={5} onChange={set('z')} />
    </Pane>
  );
}

export function QualityTab() {
  const spec = useSceneBuilder(s => s.spec);
  const edit = useSceneBuilder(s => s.edit);
  const Q = spec.quality;
  const hints = stepHints(spec);
  const insert = useInsertExample();
  return (
    <Pane>
      <BuilderLabel>Quality</BuilderLabel>
      <BuilderHelp id="quality" onExample={insert} />
      <NumRow label="Steps" hint="Most march steps per pixel. More reach further into detail, and cost more." value={Q.steps} min={16} max={256} step={1} integer onChange={v => edit(d => { d.quality.steps = Math.round(v); }, 'q:steps')} />
      <NumRow label="Max distance" hint="How far a ray goes before it gives up (the background)." value={Q.maxDist} min={5} max={100} step={1} onChange={v => edit(d => { d.quality.maxDist = v; }, 'q:dist')} />
      <Row label="Step scale" hint="The part of each step the ray takes. Lower for warps that stretch space.">
        <Toggle checked={Q.stepScale === 'auto'} label={Q.stepScale === 'auto' ? `Auto (${autoStepScale(spec)})` : 'Auto'} onChange={v => edit(d => { d.quality.stepScale = v ? 'auto' : autoStepScale(d); })} />
      </Row>
      {Q.stepScale !== 'auto' && <NumRow label="" value={Q.stepScale} min={0.3} max={1} step={0.05} onChange={v => edit(d => { d.quality.stepScale = v; }, 'q:step')} />}
      {hints.length > 0 && <BuilderNote>Asking for smaller steps: {hints.map(h => `${h.why} (${h.value})`).join('; ')}.</BuilderNote>}
      <NumRow label="Jitter" hint="Starts each pixel's ray a little way along so steps don't line up into rings." value={Q.jitter} min={0} max={1} onChange={v => edit(d => { d.quality.jitter = v; }, 'q:jitter')} />
      <Row label="Warp safety" hint="Stops twisted, bent or folded space from tearing: Auto learns the stretch, Careful also measures it each step, High takes shorter steps too. Slower in that order.">
        <Segmented size="sm" ariaLabel="Warp safety" value={Q.warp ?? 'off'}
          options={[{ value: 'off', label: 'Off' }, { value: 'auto', label: 'Auto' }, { value: 'careful', label: 'Careful' }, { value: 'high', label: 'High' }]}
          onChange={v => edit(d => { if (v === 'off') delete d.quality.warp; else d.quality.warp = v as 'auto' | 'careful' | 'high'; })} />
      </Row>
    </Pane>
  );
}

// ── Output ──────────────────────────────────────────────────────────────────

const PRESET_LOOKS: Array<{ label: string; show: OutputShow; palette?: string }> = [
  { label: 'Depth map', show: 'depth' },
  { label: 'Sunset depth', show: 'depth', palette: 'sunset' },
  { label: 'Height map', show: 'height', palette: 'terrain' },
  { label: 'Normals', show: 'normal' },
  { label: 'Heat steps', show: 'steps', palette: 'heat' },
  { label: 'Clay (AO)', show: 'ao' },
  { label: 'Ice distance', show: 'distance', palette: 'ice' },
];

/** A palette's colours across 0…1, for its swatch. */
function paletteCss(key: string): string {
  const p = PALETTES.find(x => x.key === key);
  if (!p) return 'none';
  if (p.kind === 'ramp') return `linear-gradient(90deg, ${(p.stops ?? []).map(c => rgbCss(c)).join(', ')})`;
  return 'linear-gradient(90deg, #333, #999)';
}

export function OutputTab() {
  const spec = useSceneBuilder(s => s.spec);
  const edit = useSceneBuilder(s => s.edit);
  const tk = useTokens();
  const insert = useInsertExample();
  const o = spec.output ?? { show: 'picture' as OutputShow };
  const set = (next: { show: OutputShow; palette?: string }) => edit(d => {
    if (next.show === 'picture') delete d.output;
    else d.output = next.palette ? { show: next.show, palette: next.palette } : { show: next.show };
  });
  const problem = outputProblem(spec.look.mode, spec.output);
  const def = OUTPUT_BY_SHOW[o.show];
  return (
    <Pane>
      <BuilderLabel meta={def.label}>Output</BuilderLabel>
      <BuilderHelp id="output" onExample={insert} />
      <BuilderLabel hint="What the Output node shows. Every option comes from the march loop's own outputs (Depth, Normal, Hit, Hit Pos, Iter…); the lit picture is still built beside it.">Show</BuilderLabel>
      <div role="radiogroup" aria-label="What the scene shows" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
        {OUTPUTS.map(x => {
          const on = x.show === o.show;
          return (
            <button key={x.show} type="button" role="radio" aria-checked={on} data-output={x.show} title={x.use}
              onClick={() => set({ show: x.show, palette: x.show === 'picture' ? undefined : o.palette })}
              style={{
                textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 10px', borderRadius: radius.md, cursor: 'pointer', border: 0,
                background: on ? tk.bg.selected : tk.bg.panel, boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? tk.accent.base : tk.border.default}`, color: tk.text.primary,
              }}>
              <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.primary }}>{x.label}</b>
              <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.35 }}>{x.blurb}</span>
            </button>
          );
        })}
      </div>
      {o.show !== 'picture' && (
        <Card id="output:colour" title="Colour the space" summary={o.palette ? PALETTES.find(p => p.key === o.palette)?.label : 'grey / as measured'} defaultOpen>
          <BuilderNote>{def.value === 'vec3' ? `Without a palette ${def.label.toLowerCase()} shows as a colour (X red, Y green, Z blue). Through a palette: ${o.show === 'normal' ? 'by how much it faces up' : 'by distance from the centre'}.` : `Without a palette ${def.label.toLowerCase()} shows as grey (0 black, 1 white). Through a palette each shade gets a colour.`}</BuilderNote>
          <Row label="Palette" hint="Palette: a cosine palette preset (the Palette node). Ramp: evenly spaced colour stops (the Color Ramp node). None: grey or the raw colour.">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button type="button" aria-pressed={!o.palette} onClick={() => set({ show: o.show })} data-palette="none"
                style={{ padding: '4px 10px', borderRadius: radius.md, border: 0, cursor: 'pointer', font: `500 12px ${fontFamily.ui}`, background: !o.palette ? tk.bg.selected : tk.bg.field, color: tk.text.primary, boxShadow: `inset 0 0 0 1px ${!o.palette ? tk.accent.base : tk.border.subtle}` }}>None</button>
              {PALETTES.map(p => (
                <button key={p.key} type="button" aria-pressed={o.palette === p.key} data-palette={p.key} title={`${p.label} (${p.kind === 'palette' ? 'Palette preset' : 'Color Ramp'})`}
                  onClick={() => set({ show: o.show, palette: p.key })}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: radius.md, border: 0, cursor: 'pointer', font: `500 12px ${fontFamily.ui}`, background: o.palette === p.key ? tk.bg.selected : tk.bg.field, color: tk.text.primary, boxShadow: `inset 0 0 0 1px ${o.palette === p.key ? tk.accent.base : tk.border.subtle}` }}>
                  {p.kind === 'ramp' && <span style={{ width: 22, height: 8, borderRadius: 3, background: paletteCss(p.key) }} />}{p.label}
                </button>
              ))}
            </div>
          </Row>
        </Card>
      )}
      <BuilderLabel hint="Common outputs in one click.">Presets</BuilderLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {PRESET_LOOKS.map(p => (
          <Button key={p.label} size="sm" variant="secondary" onClick={() => set({ show: p.show, palette: p.palette })}>{p.label}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => set({ show: o.show === 'picture' ? 'depth' : o.show, palette: o.palette ?? DEFAULT_PALETTE })}>Colour by…</Button>
      </div>
      {problem && <Callout tone="warning" title="Not in this render mode">{problem}</Callout>}
      <BuilderNote>Recipe: <code>{outputClause(spec.output) || 'output picture (the default: nothing to write)'}</code></BuilderNote>
    </Pane>
  );
}

// ── Recipe ──────────────────────────────────────────────────────────────────

/** Rows or text, remembered in this browser. */
const AS_TEXT_KEY = 'sceneBuilder.recipeAsText';
const readAsText = () => { try { return localStorage.getItem(AS_TEXT_KEY) === '1'; } catch { return false; } };

export function RecipeTab() {
  const spec = useSceneBuilder(s => s.spec);
  const edit = useSceneBuilder(s => s.edit);
  const replace = useSceneBuilder(s => s.replace);
  const tk = useTokens();
  // The pretty form (formatRecipe): each item of a combine on its own line. The parser reads it, the one-line form and any spacing alike.
  const printed = useMemo(() => printRecipe(spec, { pretty: true }), [spec]);
  const [asText, setAsTextState] = useState(readAsText);
  const setAsText = (v: boolean) => { setAsTextState(v); try { localStorage.setItem(AS_TEXT_KEY, v ? '1' : '0'); } catch { /* per session */ } };
  const [text, setText] = useState(printed);
  const [focused, setFocused] = useState(false);
  const [errors, setErrors] = useState<RecipeError[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Old words with their canonical ones, and what random values became (lang/random.ts).
  const [hints, setHints] = useState<RecipeHint[]>([]);
  const [resolved, setResolved] = useState<Resolved[]>([]);
  // The seed for `random` while you edit (a line's own seed= wins); Roll again picks another.
  const [seed, setSeed] = useState(freshSeed);
  const [showRef, setShowRef] = useState(false);
  const [caret, setCaret] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const insert = useInsertExample();
  // While you aren't typing, the text follows the form.
  useEffect(() => { if (!focused && !errors.length && !resolved.length) setText(printed); }, [printed, focused]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Read the recipe; when it reads cleanly the form follows. Returns the mistakes. */
  const onChange = (v: string, withSeed = seed): RecipeError[] => {
    setText(v);
    const r = parseRecipe(v, { seed: withSeed });
    setErrors(r.errors);
    setWarnings(r.warnings);
    setHints(r.hints ?? []);
    setResolved(r.resolved ?? []);
    // The spec is replaced as a whole: a clause taken out (an output, a fog) goes too.
    if (!r.errors.length) edit(d => { if (!r.spec.output) delete d.output; Object.assign(d, r.spec); }, 'recipe');
    return r.errors;
  };
  const ta = useTypeAhead(text, focused ? caret : null, recipeAssist, (next, at) => {
    onChange(next);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(at, at); setCaret(at); });
  });
  const jump = (e: RecipeError) => { if (!asText) setAsText(true); requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(e.from, e.to); }); };
  const danger = tk.status.danger;
  return (
    <Pane>
      <BuilderLabel meta={asText ? 'type or paste; the form follows' : 'one row per clause; click one to change it'}>Recipe</BuilderLabel>
      <BuilderHelp id="recipe" onExample={insert} />
      <BuilderNote><code>@twist(2)</code> after a shape bends only that shape. Suggestions appear as you type; the line under the box shows the settings the clause takes.</BuilderNote>
      {asText ? (
        <CodeField value={text} onChange={v => { onChange(v); }} completions={NO_COMPLETIONS} ariaLabel="Recipe" title="Recipe"
          textareaRef={el => { area.current = el; if (el) el.dataset.recipe = ''; }}
          highlight={(v, pal) => recipeHtml(v, pal, danger, errors)}
          keyFirst={e => ta.onKeyDown(e)}
          onFocus={el => { setFocused(true); setCaret(el.selectionStart); }} onBlur={() => { setFocused(false); setCaret(null); }}
          onSelect={el => { setCaret(el.selectionStart); }}
          invalid={errors.length > 0} minHeight={240} maxHeight={460} />
      ) : (
        <RecipeRows text={errors.length ? text : printed} onChange={onChange} />
      )}
      {asText && focused && ta.signature && <SignatureLine sig={ta.signature} />}
      {asText && ta.items.length > 0 && <AssistList items={ta.items} active={ta.active} onPick={ta.pick} onHover={ta.setActive} />}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="sm" icon="copy" onClick={() => { void navigator.clipboard?.writeText(errors.length ? text : printed).then(() => toast.success('Recipe copied')).catch(() => {}); }}>Copy</Button>
        <Button size="sm" variant="ghost" icon={asText ? 'layout' : 'text'} aria-pressed={asText} data-recipe-as-text onClick={() => setAsText(!asText)}
          title={asText ? 'Show the recipe as rows, one per clause' : 'Edit the whole recipe as text'}>{asText ? 'Show as rows' : 'Edit as text'}</Button>
        <Button size="sm" variant="ghost" icon="book" onClick={() => setShowRef(v => !v)}>{showRef ? 'Hide' : 'Show'} the words</Button>
        {errors.length > 0 && <Button size="sm" variant="ghost" onClick={() => { const r = parseRecipe(text); replace(r.spec); setErrors([]); }} title="Use everything that read cleanly, leaving out the clauses with mistakes">Apply what reads</Button>}
        <span style={{ flex: 1 }} />
        <BuilderNote>{errors.length ? `${errors.length} mistake${errors.length === 1 ? '' : 's'}: the form keeps the last clean recipe` : 'Reads cleanly'}</BuilderNote>
      </div>
      {asText && errors.map((e, i) => (
        <button key={i} type="button" onClick={() => jump(e)} data-recipe-error
          style={{ textAlign: 'left', border: 0, borderRadius: radius.md, padding: '6px 10px', background: tk.bg.field, color: tk.text.primary, cursor: 'pointer', font: `12px ${fontFamily.ui}` }}>
          <b style={{ color: tk.status.danger, font: `600 11px ${fontFamily.mono}` }}>{e.line}:{e.col}</b>&nbsp; {e.message}
        </button>
      ))}
      {warnings.map((w, i) => <BuilderNote key={i}>Note: {w}</BuilderNote>)}
      {resolved.length > 0 && (
        <div data-recipe-random style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field }}>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, font: `11.5px ${fontFamily.mono}` }}>
            {resolved.map((x, i) => <span key={i} title={x.key} style={{ padding: '1px 6px', borderRadius: 6, background: tk.bg.subtle }}>{x.key.split('.').pop()}={x.from} → <b>{x.to}</b></span>)}
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button size="sm" variant="secondary" icon="dice" data-recipe-reroll onClick={() => { const s2 = freshSeed(); setSeed(s2); onChange(text, s2); }}>Roll again</Button>
            <Button size="sm" variant="ghost" icon="check" data-recipe-keep onClick={() => { setResolved([]); setText(printRecipe(useSceneBuilder.getState().spec, { pretty: true })); }} title="Write the drawn values into the recipe">Keep these</Button>
            <BuilderNote>Random values{/seed\s*=?\s*\d/i.test(text) ? '' : ` (seed ${seed}: add seed=${seed} to repeat them)`}</BuilderNote>
          </span>
        </div>
      )}
      {asText && hints.map((h, i) => (
        <span key={`h${i}`} data-recipe-hint style={{ display: 'flex', alignItems: 'center', gap: 8, font: `12px ${fontFamily.ui}`, color: tk.text.secondary }}>
          <b style={{ font: `600 11px ${fontFamily.mono}`, color: tk.text.muted }}>{h.line}:{h.col}</b>{h.message}
          <Button size="sm" variant="ghost" onClick={() => onChange(`${text.slice(0, h.from)}${h.fix}${text.slice(h.to)}`)}>Use {h.fix}</Button>
        </span>
      ))}
      {showRef && (
        <div data-recipe-reference style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: radius.control, background: tk.bg.subtle, font: `12px/1.6 ${fontFamily.mono}`, color: tk.text.secondary }}>
          <span><b>modes</b> <RecipeCode text={RECIPE_VOCABULARY.modes.join(' · ')} errors={[]} /></span>
          <span><b>combines</b> <RecipeCode text={RECIPE_VOCABULARY.combines.join(' · ')} errors={[]} /> (k= blend radius, name=)</span>
          <span><b>shapes</b> <RecipeCode text={RECIPE_VOCABULARY.shapes.map(sh => `${sh.kind} ${sh.keys.map(k => `${k}=`).join(' ')}`).join(' · ')} errors={[]} /></span>
          <span><b>any shape</b> <RecipeCode text="at=(x,y,z) rot=(x,y,z) color=#ff8844|(0.9,0.5,0.3)|gold shine=0.4 glass name=Body" errors={[]} /></span>
          <span><b>warps</b> <RecipeCode text={RECIPE_VOCABULARY.warps.map(w => `${w.kind} ${w.keys.map(k => `${k}=`).join(' ')}`).join(' · ')} errors={[]} /></span>
          <span><b>settings</b> <RecipeCode text={RECIPE_VOCABULARY.settings.join(' · ')} errors={[]} /></span>
          <span><b>colours</b> <RecipeCode text={RECIPE_VOCABULARY.colours.join(' ')} errors={[]} /></span>
          <span><b>output</b> <RecipeCode text={`output ${RECIPE_VOCABULARY.outputs.join('|')} · colour by … palette ${RECIPE_VOCABULARY.palettes.join('|')}`} errors={[]} /></span>
        </div>
      )}
    </Pane>
  );
}

const NO_COMPLETIONS: Completion[] = [];

// ── Templates ───────────────────────────────────────────────────────────────

export function TemplatesTab() {
  const replace = useSceneBuilder(s => s.replace);
  const setTab = useSceneBuilder(s => s.setTab);
  const select = useSceneBuilder(s => s.select);
  const tk = useTokens();
  return (
    <Pane>
      <BuilderLabel>Start from</BuilderLabel>
      <BuilderHelp id="templates" />
      <BuilderNote>A template fills the whole form (Undo brings back what was there). Each is a recipe you can read and change.</BuilderNote>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
        {SCENE_TEMPLATES.map(t => (
          <button key={t.key} type="button" data-template={t.key}
            onClick={() => { const s = parseRecipe(t.recipe).spec; replace(s); select(s.root.children[0]?.id ?? null); setTab('shapes'); }}
            style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: radius.control, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, cursor: 'pointer', color: tk.text.primary }}>
            <b style={{ fontSize: 13.5 }}>{t.label}</b>
            <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>{t.blurb}</span>
            <code style={{ fontSize: 10.5, color: tk.text.faint, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{t.recipe.replace(/\n/g, ' · ')}</code>
          </button>
        ))}
      </div>
    </Pane>
  );
}

// ── Describe ────────────────────────────────────────────────────────────────

export function DescribeTab() {
  const d = useSceneBuilder(s => s.describe);
  const replace = useSceneBuilder(s => s.replace);
  const setTab = useSceneBuilder(s => s.setTab);
  const setTarget = useSceneBuilder(s => s.setTarget);
  const tk = useTokens();
  return (
    <Pane>
      <BuilderLabel>Describe this graph</BuilderLabel>
      <BuilderHelp id="describe" />
      <BuilderNote>Reads the 3D scene on the canvas back into words: the shapes, combines and warps in its Scene Group, the render mode, lights, fog and camera. What the builder doesn't know is marked custom(…).</BuilderNote>
      <Button icon="search" onClick={() => describeIntoBuilder()} style={{ alignSelf: 'flex-start' }}>{d ? 'Describe again' : 'Describe the graph on the canvas'}</Button>
      {d && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 8, borderRadius: 4, background: tk.bg.field, overflow: 'hidden' }}>
            <div style={{ width: `${d.coverage.total ? (100 * d.coverage.read) / d.coverage.total : 0}%`, height: '100%', background: tk.status.success }} />
          </div>
          <BuilderNote>Read {d.coverage.read} of {d.coverage.total} nodes{d.builderMade ? ' · made in the builder' : ''}</BuilderNote>
        </div>
        <textarea readOnly value={d.recipe} aria-label="The graph as a recipe" data-describe-recipe
          style={{ minHeight: 150, resize: 'vertical', padding: 12, borderRadius: radius.control, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `12.5px/1.6 ${fontFamily.mono}` }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="primary" icon="edit" onClick={() => { replace(d.spec); setTarget(d.builderMade ? d.sceneId : null); setTab('shapes'); }}>Open the recognised part in the builder</Button>
          <Button icon="copy" onClick={() => { void navigator.clipboard?.writeText(d.recipe).then(() => toast.success('Recipe copied')).catch(() => {}); }}>Copy recipe</Button>
        </div>
        <BuilderLabel>Recognised</BuilderLabel>
        {d.recognized.map((r, i) => <BuilderNote key={i}>✓ {r}</BuilderNote>)}
        {d.unknown.length > 0 && <BuilderLabel>Not recognised</BuilderLabel>}
        {d.unknown.map((r, i) => <BuilderNote key={i}>• {r}</BuilderNote>)}
        {!d.builderMade && <BuilderNote>Building the recognised part makes a new scene beside this one; the original stays as it is.</BuilderNote>}
      </>}
    </Pane>
  );
}
