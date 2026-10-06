/**
 * tabs.tsx — the Scene Builder's sections: Shapes, Combine, Bend space, Look,
 * Camera, Quality, Recipe, Templates and Describe. Each reads the spec from the
 * builder store and changes it through `edit` (one undo step per change, one
 * per drag).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSceneBuilder } from '../../sceneBuilder/store';
import {
  DEFAULT_LOOK, SHAPES, SHAPE_BY_KIND, TONE_MODES, WARPS, WARP_BY_KIND, allShapes, autoStepScale, defaultSize, findItem, itemName, opLabel, stepHints, walkItems,
  type GroupSpec, type ParamDef, type RenderMode, type SceneItem, type SceneSpec, type ShapeSpec, type Vec3, type WarpSpec,
} from '../../sceneBuilder/spec';
import { addShape, addWarp, duplicateItem, moveItem, moveWarp, removeItem, removeWarp, ungroup } from '../../sceneBuilder/edit';
import { RECIPE_VOCABULARY, parseRecipe, printRecipe, type RecipeError } from '../../sceneBuilder/recipe';
import { SCENE_TEMPLATES } from '../../sceneBuilder/templates';
import { describeIntoBuilder } from '../../sceneBuilder/actions';
import { Card, ColourRow, NumRow, Row, Vec3Row, rgbCss } from './controls';
import { BuilderLabel, BuilderNote } from '../builders/BuilderWindow';
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

function shapeSummary(sh: ShapeSpec): string {
  const def = SHAPE_BY_KIND[sh.kind];
  if (!def) return sh.label ?? 'custom';
  const first = def.params[0];
  const v = sh.size[first.key];
  const size = `${first.key} ${Array.isArray(v) ? vecText(v as Vec3) : fmtN(Number(v))}`;
  const at = sh.at.some(x => x) ? ` · at ${vecText(sh.at)}` : '';
  return `${def.label} · ${size}${at}${sh.warps.length ? ` · ${sh.warps.length} warp${sh.warps.length === 1 ? '' : 's'}` : ''}`;
}

export function ShapesTab() {
  const spec = useSceneBuilder(s => s.spec);
  const selectedId = useSceneBuilder(s => s.selectedId);
  const edit = useSceneBuilder(s => s.edit);
  const select = useSceneBuilder(s => s.select);
  const setTab = useSceneBuilder(s => s.setTab);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const shapes = allShapes(spec);
  const mode = spec.look.mode;
  const setShape = (id: string, fn: (s: ShapeSpec) => void, key?: string) => edit(d => { const it = findItem(d, id)?.item; if (it?.type === 'shape') fn(it); }, key);
  return (
    <Pane>
      <BuilderLabel meta={`${shapes.length} shape${shapes.length === 1 ? '' : 's'}`}>Shapes</BuilderLabel>
      <BuilderNote>Each shape has a place, a turn, its size, and a colour and shine (its material). How shapes join is under Combine; how space bends, under Bend space.</BuilderNote>
      {shapes.map(sh => {
        const def = SHAPE_BY_KIND[sh.kind];
        return (
          <Card key={sh.id} id={`shape:${sh.id}`} title={itemName(spec, sh)} summary={shapeSummary(sh)} accent={rgbCss(sh.color)}
            defaultOpen={sh.id === selectedId || shapes.length === 1} selected={sh.id === selectedId} onHeaderClick={() => select(sh.id)}
            actions={<>
              <IconButton icon="copy" size="sm" label="Duplicate" onClick={() => { let id = ''; edit(d => { id = duplicateItem(d, sh.id)?.id ?? ''; }); if (id) select(id); }} />
              <IconButton icon="trash" size="sm" tone="danger" label="Remove" onClick={() => edit(d => removeItem(d, sh.id))} />
            </>}>
            {!def ? <BuilderNote>custom({sh.label}): a part of a described graph the builder can't build. Build leaves it out.</BuilderNote> : <>
              <Row label="Name"><Field value={sh.name} placeholder={def.label} aria-label="Shape name" onChange={e => setShape(sh.id, s => { s.name = e.target.value; }, `name:${sh.id}`)} /></Row>
              <Row label="Shape">
                <Select ariaLabel="Shape kind" value={sh.kind} options={SHAPES.map(s => ({ value: s.kind, label: s.label }))}
                  onChange={k => setShape(sh.id, s => { s.kind = k; s.size = defaultSize(k); })} style={{ width: '100%' }} />
              </Row>
              <BuilderNote>{def.blurb}</BuilderNote>
              <ParamRows keyPrefix={sh.id} params={def.params} values={sh.size} onChange={(k, v) => setShape(sh.id, s => { s.size[k] = v; }, `size:${sh.id}:${k}`)} />
              <Vec3Row label="Position" value={sh.at} min={-5} max={5} onChange={v => setShape(sh.id, s => { s.at = v; }, `at:${sh.id}`)} />
              <Vec3Row label="Rotation" hint="Degrees about X, then Y, then Z." value={sh.rot} min={-180} max={180} step={0.5} onChange={v => setShape(sh.id, s => { s.rot = v; }, `rot:${sh.id}`)} />
              <ColourRow label="Colour" value={sh.color} hint={mode === 'surface' ? undefined : 'Colours show in Surface mode; GI uses the first shape\'s, Volumetric its glow tint.'} onChange={v => setShape(sh.id, s => { s.color = v; }, `color:${sh.id}`)} />
              <NumRow label="Shine" hint="How strong its highlight is: 0 matt, 1 glossy (Surface mode)." value={sh.shine} min={0} max={1} onChange={v => setShape(sh.id, s => { s.shine = v; }, `shine:${sh.id}`)} />
              {mode === 'glass' && <Row label="Glass" hint="In Glass mode: glass shapes refract the others."><Toggle checked={sh.glass} onChange={v => setShape(sh.id, s => { s.glass = v; })} label={sh.glass ? 'Made of glass' : 'Seen through the glass'} /></Row>}
              <Row label="Bent by">
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <BuilderNote>{sh.warps.length ? sh.warps.map(w => WARP_BY_KIND[w.kind]?.label ?? w.label).join(' → ') : 'nothing'}</BuilderNote>
                  <Button size="sm" variant="ghost" icon="wave" onClick={() => { select(sh.id); setTab('warps'); }}>Bend space…</Button>
                </span>
              </Row>
            </>}
          </Card>
        );
      })}
      <Button icon="plus" onClick={e => setMenu({ x: e.clientX, y: e.clientY })} style={{ alignSelf: 'flex-start' }}>Add a shape</Button>
      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} title="Add a shape" items={SHAPES.map(s => ({
        label: s.label, hint: s.blurb, onSelect: () => { let id = ''; edit(d => { id = addShape(d, s.kind, selectedId).id; }); select(id); },
      }))} />}
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
  return (
    <Pane>
      <BuilderLabel>Combine</BuilderLabel>
      <BuilderNote>Groups join what is inside them, in order: Union keeps the nearer surface, Subtract cuts every later item out of the first, Intersect keeps only the overlap. The smooth ones blend over a Blend radius (k). Drag items in the Scene tree to reorder or nest them.</BuilderNote>
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
            {!isRoot && <Row label="Name"><Field value={g.name} placeholder="Group" aria-label="Group name" onChange={e => setGroup(g.id, x => { x.name = e.target.value; }, `gname:${g.id}`)} /></Row>}
            <Row label="Operator">
              <Select ariaLabel="Operator" value={`${g.k > 0 ? 'smooth-' : ''}${g.op}`} options={OP_OPTIONS} style={{ width: '100%' }}
                onChange={v => setGroup(g.id, x => { const smooth = v.startsWith('smooth-'); x.op = v.replace('smooth-', '') as GroupSpec['op']; x.k = smooth ? (x.k > 0 ? x.k : 0.3) : 0; })} />
            </Row>
            {g.k > 0 && <NumRow label="Blend radius (k)" hint="How wide the blend is, in scene units." value={g.k} min={0.01} max={1} step={0.005} onChange={v => setGroup(g.id, x => { x.k = v; }, `k:${g.id}`)} />}
            <BuilderLabel>Items, in order</BuilderLabel>
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
  return (
    <Pane>
      <BuilderLabel>Bend space</BuilderLabel>
      <BuilderNote>Warps change the space a shape lives in rather than the shape: repeat it forever, mirror it, twist or bend it. They stack top to bottom. On the whole scene they bend every shape; on a group, everything in it.</BuilderNote>
      <Row label="Bend">
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
  return (
    <Pane>
      <BuilderLabel>Look</BuilderLabel>
      <Segmented fill ariaLabel="Render mode" value={L.mode} options={MODES.map(m => ({ value: m.value, label: m.label }))} onChange={v => set(l => { l.mode = v; })} />
      <BuilderNote>{MODES.find(m => m.value === L.mode)?.blurb}</BuilderNote>
      {L.mode === 'volumetric' && (
        <Card id="look:glow" title="Glow" summary={`density ${L.glow.density} · falloff ${L.glow.falloff}`} defaultOpen>
          <NumRow label="Density" hint="Light added per bit of ray inside a shape." value={L.glow.density} min={0.001} max={0.3} step={0.001} onChange={v => set(l => { l.glow.density = v; }, 'glow:d')} />
          <NumRow label="Falloff" hint="How fast the glow fades outside a shape." value={L.glow.falloff} min={0.1} max={60} step={0.1} onChange={v => set(l => { l.glow.falloff = v; }, 'glow:f')} />
          <NumRow label="Shell" hint="Above 0 only a skin this thick glows: bubbles and rims." value={L.glow.shell} min={0} max={1} step={0.005} onChange={v => set(l => { l.glow.shell = v; }, 'glow:s')} />
          <NumRow label="Exposure" value={L.glow.exposure} min={0.01} max={20} onChange={v => set(l => { l.glow.exposure = v; }, 'glow:e')} />
          <ColourRow label="Tint" value={L.glow.tint} onChange={v => set(l => { l.glow.tint = v; }, 'glow:t')} />
        </Card>
      )}
      {L.mode === 'glass' && (
        <Card id="look:glass" title="Glass" summary={`IOR ${L.glass.ior}`} defaultOpen>
          <NumRow label="IOR" hint="How much the glass bends light: water 1.33, glass 1.5, diamond 2.4." value={L.glass.ior} min={1} max={3} step={0.01} onChange={v => set(l => { l.glass.ior = v; }, 'glass:ior')} />
          <NumRow label="Dispersion" hint="Splits the colours a little, like a prism." value={L.glass.dispersion} min={0} max={0.2} step={0.005} onChange={v => set(l => { l.glass.dispersion = v; }, 'glass:disp')} />
          <ColourRow label="Tint" value={L.glass.tint} onChange={v => set(l => { l.glass.tint = v; }, 'glass:tint')} />
          <BuilderNote>{allShapes(spec).filter(s => s.glass).length} of {allShapes(spec).length} shapes are glass{allShapes(spec).some(s => s.glass) ? '' : ' (none marked: all of them are)'}. Glass Scene has its own sky behind everything.</BuilderNote>
        </Card>
      )}
      {L.mode === 'gi' && (
        <Card id="look:gi" title="Global illumination" summary={`bounce ${L.gi.strength} · rough ${L.gi.rough}`} defaultOpen>
          <NumRow label="Bounce" hint="How much light bounces off nearby surfaces." value={L.gi.strength} min={0} max={1} onChange={v => set(l => { l.gi.strength = v; }, 'gi:s')} />
          <NumRow label="Metallic" value={L.gi.metal} min={0} max={1} onChange={v => set(l => { l.gi.metal = v; }, 'gi:m')} />
          <NumRow label="Roughness" value={L.gi.rough} min={0} max={1} onChange={v => set(l => { l.gi.rough = v; }, 'gi:r')} />
          <NumRow label="Reflection" value={L.gi.spec} min={0} max={1} onChange={v => set(l => { l.gi.spec = v; }, 'gi:spec')} />
        </Card>
      )}
      {L.mode !== 'volumetric' && (
        <Card id="look:lights" title="Lights" summary={`sun ${vecText(L.sunDir)}`} defaultOpen={L.mode === 'surface'}>
          <Vec3Row label="Sun direction" hint="Points toward the sun; only its direction matters." value={L.sunDir} min={-1} max={1} onChange={v => set(l => { l.sunDir = v; }, 'sun:dir')} />
          {L.mode !== 'glass' && <>
            <ColourRow label="Sun colour" value={L.sunColor} onChange={v => set(l => { l.sunColor = v; }, 'sun:c')} />
            <ColourRow label="Sky colour" hint="Light from above (the sky dome)." value={L.sky} onChange={v => set(l => { l.sky = v; }, 'sky')} />
            <ColourRow label="Bounce colour" hint="Light from below: the ground bouncing the sun back." value={L.bounce} onChange={v => set(l => { l.bounce = v; }, 'bounce')} />
          </>}
        </Card>
      )}
      {L.mode === 'surface' && (
        <Card id="look:shadow" title="Shadows & occlusion" summary={`${L.shadows ? `shadows ${L.shadows}` : 'no shadows'} · ${L.ao ? 'AO' : 'no AO'}`}>
          <Row label="Soft shadows"><Toggle checked={L.shadows > 0} onChange={v => set(l => { l.shadows = v ? DEFAULT_LOOK.shadows : 0; })} label={L.shadows > 0 ? 'On' : 'Off'} /></Row>
          {L.shadows > 0 && <NumRow label="Hardness" hint="8 soft … 32 hard." value={L.shadows} min={1} max={64} step={1} onChange={v => set(l => { l.shadows = v; }, 'shadows')} />}
          <Row label="Ambient occl."><Toggle checked={L.ao > 0} onChange={v => set(l => { l.ao = v ? DEFAULT_LOOK.ao : 0; })} label={L.ao > 0 ? 'On' : 'Off'} /></Row>
          {L.ao > 0 && <NumRow label="AO step" hint="Smaller: finer contact shadows; larger: broader." value={L.ao} min={0.005} max={0.2} step={0.005} onChange={v => set(l => { l.ao = v; }, 'ao')} />}
        </Card>
      )}
      {lit && (
        <Card id="look:fog" title="Fog" summary={L.fog > 0 ? `density ${L.fog}` : 'clear'}>
          <NumRow label="Density" hint="0 is clear. Distance fades into the fog colour." value={L.fog} min={0} max={5} step={0.01} onChange={v => set(l => { l.fog = v; }, 'fog')} />
          <Row label="Colour"><Toggle checked={!L.fogColor} onChange={v => set(l => { l.fogColor = v ? null : [...l.bg] as Vec3; })} label="Same as the background" /></Row>
          {L.fogColor && <ColourRow label="Fog colour" value={L.fogColor} onChange={v => set(l => { l.fogColor = v; }, 'fogc')} />}
        </Card>
      )}
      {L.mode !== 'glass' && (
        <Card id="look:bg" title="Background" summary={L.bg2 ? 'gradient' : 'solid'}>
          <Row label="Kind"><Segmented size="sm" ariaLabel="Background kind" value={L.bg2 ? 'gradient' : 'solid'} options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]}
            onChange={v => set(l => { l.bg2 = v === 'gradient' ? [Math.min(1, l.bg[0] * 0.4), Math.min(1, l.bg[1] * 0.4), Math.min(1, l.bg[2] * 0.4)] : null; })} /></Row>
          <ColourRow label={L.bg2 ? 'Top' : 'Colour'} value={L.bg} onChange={v => set(l => { l.bg = v; }, 'bg')} />
          {L.bg2 && <ColourRow label="Bottom" value={L.bg2} onChange={v => set(l => { l.bg2 = v; }, 'bg2')} />}
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
  return (
    <Pane>
      <BuilderLabel>Camera</BuilderLabel>
      <BuilderNote>The orbit camera, as in Time Cube View, Frame Stack and Draw agents: it circles the point it looks at. Angles in degrees.</BuilderNote>
      <NumRow label="Distance" hint="How far the camera is from the point it looks at." value={C.dist} min={0.3} max={20} onChange={set('dist')} />
      <NumRow label="Angle" unit="°" hint="Where it stands round the point (0: in front)." value={C.angle} min={-180} max={180} step={0.5} onChange={set('angle')} />
      <NumRow label="Elevation" unit="°" hint="How far above it looks from: 0 level, 89 straight down." value={C.elev} min={-89} max={89} step={0.5} onChange={set('elev')} />
      <NumRow label="Orbit speed" unit="°/s" hint="Turns the camera round the point over time." value={C.orbit} min={-90} max={90} step={0.5} onChange={set('orbit')} />
      <NumRow label="Zoom" hint="Lens length: higher is zoomed in, with less perspective." value={C.zoom} min={0.5} max={5} onChange={set('zoom')} />
      <NumRow label="Flatten" hint="Perspective (0) to orthographic (1), like an isometric drawing." value={C.flatten} min={0} max={1} onChange={set('flatten')} />
      <NumRow label="Translate X" hint="Moves the camera and the point it looks at together." value={C.x} min={-5} max={5} onChange={set('x')} />
      <NumRow label="Translate Y" value={C.y} min={-5} max={5} onChange={set('y')} />
      <NumRow label="Translate Z" value={C.z} min={-5} max={5} onChange={set('z')} />
    </Pane>
  );
}

export function QualityTab() {
  const spec = useSceneBuilder(s => s.spec);
  const edit = useSceneBuilder(s => s.edit);
  const Q = spec.quality;
  const hints = stepHints(spec);
  return (
    <Pane>
      <BuilderLabel>Quality</BuilderLabel>
      <NumRow label="Steps" hint="Most march steps per pixel. More reach further into detail, and cost more." value={Q.steps} min={16} max={256} step={1} integer onChange={v => edit(d => { d.quality.steps = Math.round(v); }, 'q:steps')} />
      <NumRow label="Max distance" hint="How far a ray goes before it gives up (the background)." value={Q.maxDist} min={5} max={100} step={1} onChange={v => edit(d => { d.quality.maxDist = v; }, 'q:dist')} />
      <Row label="Step scale" hint="The part of each step the ray takes. Lower for warps that stretch space.">
        <Toggle checked={Q.stepScale === 'auto'} label={Q.stepScale === 'auto' ? `Auto (${autoStepScale(spec)})` : 'Auto'} onChange={v => edit(d => { d.quality.stepScale = v ? 'auto' : autoStepScale(d); })} />
      </Row>
      {Q.stepScale !== 'auto' && <NumRow label="" value={Q.stepScale} min={0.3} max={1} step={0.05} onChange={v => edit(d => { d.quality.stepScale = v; }, 'q:step')} />}
      {hints.length > 0 && <BuilderNote>Asking for smaller steps: {hints.map(h => `${h.why} (${h.value})`).join('; ')}.</BuilderNote>}
      <NumRow label="Jitter" hint="Starts each pixel's ray a little way along so steps don't line up into rings." value={Q.jitter} min={0} max={1} onChange={v => edit(d => { d.quality.jitter = v; }, 'q:jitter')} />
    </Pane>
  );
}

// ── Recipe ──────────────────────────────────────────────────────────────────

export function RecipeTab() {
  const spec = useSceneBuilder(s => s.spec);
  const edit = useSceneBuilder(s => s.edit);
  const replace = useSceneBuilder(s => s.replace);
  const tk = useTokens();
  const printed = useMemo(() => printRecipe(spec, { multiline: true }), [spec]);
  const [text, setText] = useState(printed);
  const [focused, setFocused] = useState(false);
  const [errors, setErrors] = useState<RecipeError[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showRef, setShowRef] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // While you aren't typing, the text follows the form.
  useEffect(() => { if (!focused) setText(printed); }, [printed, focused]);
  const onChange = (v: string) => {
    setText(v);
    const r = parseRecipe(v);
    setErrors(r.errors);
    setWarnings(r.warnings);
    if (!r.errors.length) edit(d => { Object.assign(d, r.spec); }, 'recipe');
  };
  const jump = (e: RecipeError) => { area.current?.focus(); area.current?.setSelectionRange(e.from, e.to); };
  return (
    <Pane>
      <BuilderLabel meta="type or paste; the form follows">Recipe</BuilderLabel>
      <BuilderNote>The whole scene in words. Clauses are separated by new lines or ·: a render mode, shapes and combines, warps for the whole scene, then settings. <code>@twist(2)</code> after a shape bends only that shape.</BuilderNote>
      <textarea ref={area} data-recipe value={text} spellCheck={false} aria-label="Recipe"
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={e => onChange(e.target.value)}
        style={{ minHeight: 220, resize: 'vertical', padding: 12, borderRadius: radius.control, border: `1px solid ${errors.length ? tk.status.danger : tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `12.5px/1.6 ${fontFamily.mono}`, outline: 'none' }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="sm" icon="copy" onClick={() => { void navigator.clipboard?.writeText(text).then(() => toast.success('Recipe copied')).catch(() => {}); }}>Copy</Button>
        <Button size="sm" variant="ghost" icon="book" onClick={() => setShowRef(v => !v)}>{showRef ? 'Hide' : 'Show'} the words</Button>
        {errors.length > 0 && <Button size="sm" variant="ghost" onClick={() => { const r = parseRecipe(text); replace(r.spec); }} title="Use everything that read cleanly, leaving out the clauses with mistakes">Apply what reads</Button>}
        <span style={{ flex: 1 }} />
        <BuilderNote>{errors.length ? `${errors.length} mistake${errors.length === 1 ? '' : 's'}: the form keeps the last clean recipe` : 'Reads cleanly'}</BuilderNote>
      </div>
      {errors.map((e, i) => (
        <button key={i} type="button" onClick={() => jump(e)} data-recipe-error
          style={{ textAlign: 'left', border: 0, borderRadius: radius.md, padding: '6px 10px', background: tk.bg.field, color: tk.text.primary, cursor: 'pointer', font: `12px ${fontFamily.ui}` }}>
          <b style={{ color: tk.status.danger, font: `600 11px ${fontFamily.mono}` }}>{e.line}:{e.col}</b>&nbsp; {e.message}
        </button>
      ))}
      {warnings.map((w, i) => <BuilderNote key={i}>Note: {w}</BuilderNote>)}
      {showRef && (
        <div data-recipe-reference style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: radius.control, background: tk.bg.subtle, font: `12px/1.6 ${fontFamily.mono}`, color: tk.text.secondary }}>
          <span><b>modes</b> {RECIPE_VOCABULARY.modes.join(' · ')}</span>
          <span><b>combines</b> {RECIPE_VOCABULARY.combines.join(' · ')} (k= blend radius, name=)</span>
          <span><b>shapes</b> {RECIPE_VOCABULARY.shapes.map(s => `${s.kind} ${s.keys.join(' ')}`).join(' · ')}</span>
          <span><b>any shape</b> at=(x,y,z) rot=(x,y,z)° color=#rrggbb|(r,g,b)|name shine=0…1 glass name=…</span>
          <span><b>warps</b> {RECIPE_VOCABULARY.warps.map(w => `${w.kind} ${w.keys.join(' ')}`).join(' · ')}</span>
          <span><b>settings</b> {RECIPE_VOCABULARY.settings.join(' · ')}</span>
          <span><b>colours</b> {RECIPE_VOCABULARY.colours.join(' ')}</span>
        </div>
      )}
    </Pane>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────

export function TemplatesTab() {
  const replace = useSceneBuilder(s => s.replace);
  const setTab = useSceneBuilder(s => s.setTab);
  const select = useSceneBuilder(s => s.select);
  const tk = useTokens();
  return (
    <Pane>
      <BuilderLabel>Start from</BuilderLabel>
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
