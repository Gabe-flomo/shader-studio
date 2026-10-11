/**
 * sectionPanels.tsx — the 3D Scene Builder's sections on the studio shell (docs/scene-builder-3d.md,
 * "The sections"): the right panel's settings for Mode, Shapes, Combine, Warps, Light & colour,
 * Camera and Output. Each opens with a short line and Learn more (sections.ts), then pictures
 * where a choice is visual (the render modes, the shapes, the combines, the warp stack) and the
 * builders' sliders (every one a BuilderSlider; right-click offers the Play menu of the node param
 * it builds, playParam.ts).
 */
import { useState, type ReactNode } from 'react';
import { useSceneBuilder } from '../../sceneBuilder/store';
import {
  SHAPE_BY_KIND, WARPS, allShapes, findItem, itemName, opLabel, pathTo, shapeDims, stepHints, autoStepScale, walkItems,
  type GroupSpec, type RenderMode, type SceneItem, type ShapeSpec, type Vec3,
} from '../../sceneBuilder/spec';
import { SECTION_BY_ID, type SceneSection } from '../../sceneBuilder/sections';
import { addShape, addWarp } from '../../sceneBuilder/edit';
import { parseRecipe } from '../../sceneBuilder/recipe';
import { linkedSize } from '../../sceneBuilder/viewMath';
import type { GalleryShape } from '../../sceneBuilder/thumbnails';
import { ShapeGallery, ShapeThumb } from './ShapeGallery';
import { SceneTree } from './SceneTree';
import { Card, ColourRow, NumRow, Row, rgbCss } from './controls';
import { CameraRows, GroupInspector, Inspector, LightSettings, MODES, ModeSettings, OutputRows, ParamRows, QualityRows, ToneRow, WarpCard } from './tabs';
import { useSpecThumbs } from './specThumbs';
import { randomShapeAction } from './surpriseActions';
import { BuilderLabel, BuilderNote } from '../builders/BuilderWindow';
import { Button } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';

/** A section's top: its name, what you can build there, and Learn more. */
export function SectionHead({ id, title, line, learn }: { id: string; title: string; line: string; learn?: string }) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  return (
    <div data-section-intro={id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 2px 4px' }}>
      <b style={{ fontSize: 15, fontWeight: 650 }}>{title}</b>
      <span data-builder-how style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>{line}</span>
      {learn && <button type="button" data-learn-more={id} aria-expanded={open} onClick={() => setOpen(v => !v)}
        style={{ alignSelf: 'flex-start', padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>
        {open ? 'Less' : 'Learn more'}
      </button>}
      {open && learn && <p data-learn-text style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: tk.text.secondary }}>{learn}</p>}
    </div>
  );
}

const Head = ({ id }: { id: SceneSection }) => { const s = SECTION_BY_ID[id]; return <SectionHead id={id} title={s.label} line={s.line} learn={s.learn} />; };

/** A choice drawn as a picture card. */
function PictureChoice({ id, label, blurb, src, on, onClick, children }: { id: string; label: string; blurb?: string; src?: string | null; on: boolean; onClick: () => void; children?: ReactNode }) {
  const tk = useTokens();
  return (
    <button type="button" role="radio" aria-checked={on} data-choice={id} title={blurb} onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, padding: 6, border: 0, borderRadius: radius.control, cursor: 'pointer', textAlign: 'left', minWidth: 0,
        background: on ? tk.bg.selected : tk.bg.panel, boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? tk.accent.base : tk.border.default}`, color: tk.text.primary,
      }}>
      <span style={{ display: 'block', width: '100%', aspectRatio: '264 / 152', borderRadius: radius.md, overflow: 'hidden', background: tk.bg.render }}>
        {src ? <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : children}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 2px 2px' }}>
        <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.primary }}>{label}</b>
        {blurb && <span style={{ fontSize: 11, color: tk.text.muted, lineHeight: 1.35 }}>{blurb}</span>}
      </span>
    </button>
  );
}

// ── Mode ─────────────────────────────────────────────────────────────────────

const MODE_SHORT: Record<RenderMode, string> = {
  surface: 'Solid, lit surfaces with shadows; a colour per shape.',
  volumetric: 'See-through glowing gas: neon, plasma, nebulae.',
  glass: 'Glass shapes bend the light through them.',
  gi: 'Light bounces between surfaces; one colour.',
};
const MODE_DEMO_SHAPES = 'sphere r=0.5 at=(-0.38,0.02,0) color=(0.92,0.5,0.3) shine=0.5 · box size=0.34 round=0.05 at=(0.42,-0.08,0.12) rot=(0,30,0) color=(0.35,0.6,0.92)';
const MODE_DEMO: Record<RenderMode, string> = {
  surface: `surface · ${MODE_DEMO_SHAPES} · plane y=-0.5 color=(0.55,0.55,0.6) · background top=(0.45,0.6,0.85) bottom=(0.8,0.75,0.7) · camera dist=3.2 elev=16`,
  volumetric: 'volumetric density=0.04 falloff=12 shell=0.1 exposure=1.4 · smooth-union(sphere r=0.45 at=(-0.3,0,0), torus R=0.6 r=0.06 rot=(70,0,0) at=(0.3,0,0)) k=0.2 · background night · tone none · camera dist=3.2 elev=16',
  glass: 'glass ior=1.45 · sphere r=0.5 at=(-0.3,0.02,0) glass · box size=0.3 round=0.04 at=(0.45,-0.12,0.2) rot=(0,30,0) color=(0.9,0.5,0.3) · plane y=-0.5 color=(0.5,0.45,0.55) · camera dist=3.2 elev=16',
  gi: `gi · ${MODE_DEMO_SHAPES} · plane y=-0.5 · camera dist=3.2 elev=16`,
};

export function ModePanel() {
  const mode = useSceneBuilder(s => s.spec.look.mode);
  const edit = useSceneBuilder(s => s.edit);
  const thumbs = useSpecThumbs(MODES.map(m => ({ key: `mode:${m.value}`, spec: () => parseRecipe(MODE_DEMO[m.value]).spec })));
  return <>
    <Head id="mode" />
    <div role="radiogroup" aria-label="Render mode" data-mode-cards style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
      {MODES.map(m => (
        <PictureChoice key={m.value} id={`mode:${m.value}`} label={m.label} blurb={MODE_SHORT[m.value]} src={thumbs[`mode:${m.value}`]} on={mode === m.value}
          onClick={() => edit(d => { d.look.mode = m.value; })} />
      ))}
    </div>
    <BuilderNote>{MODES.find(m => m.value === mode)?.blurb}</BuilderNote>
    <ModeSettings />
    {mode === 'glass' && <GlassPicks />}
  </>;
}

/** In Glass mode: which shapes are glass. */
function GlassPicks() {
  const spec = useSceneBuilder(s => s.spec);
  const edit = useSceneBuilder(s => s.edit);
  const shapes = allShapes(spec);
  return (
    <Card id="mode:glass-shapes" title="Which shapes are glass" defaultOpen summary={`${shapes.filter(s => s.glass).length} of ${shapes.length}`}>
      {shapes.map(sh => (
        <Row key={sh.id} label={<span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><ShapeThumb kind={sh.kind} size={18} />{itemName(spec, sh)}</span>}>
          <Toggle checked={sh.glass} label={sh.glass ? 'Glass' : 'Seen through it'} onChange={v => edit(d => { const it = findItem(d, sh.id)?.item; if (it?.type === 'shape') it.glass = v; })} />
        </Row>
      ))}
    </Card>
  );
}

// ── Shapes ───────────────────────────────────────────────────────────────────

/** Linked or separate sizes, remembered per shape while the app runs. */
const sizeMode = new Map<string, 'linked' | 'separate'>();

/** A shape's sizes: one linked Size (keeps its proportions), or each dimension on its own (width, height, depth; or radius and height). */
export function SizeRows({ sh }: { sh: ShapeSpec }) {
  const edit = useSceneBuilder(s => s.edit);
  const def = SHAPE_BY_KIND[sh.kind];
  const dims = def ? shapeDims(def) : null;
  const vector = dims?.vector ?? false;
  const equal = vector && Array.isArray(sh.size.size) && (sh.size.size as Vec3).every(v => v === (sh.size.size as Vec3)[0]);
  const [mode, setModeState] = useState<'linked' | 'separate'>(() => sizeMode.get(sh.id) ?? (vector ? (equal ? 'linked' : 'separate') : 'separate'));
  const setMode = (m: 'linked' | 'separate') => { sizeMode.set(sh.id, m); setModeState(m); };
  if (!def) return null;
  const set = (fn: (s: ShapeSpec) => void, key: string) => edit(d => { const it = findItem(d, sh.id)?.item; if (it?.type === 'shape') fn(it); }, key);
  const linkedKeys = new Set(dims?.linked.map(t => t.key) ?? []);
  const rest = def.params.filter(p => !linkedKeys.has(p.key));
  const restRows = <ParamRows keyPrefix={sh.id} params={rest} values={sh.size} onChange={(k, v) => set(s => { s.size[k] = v; }, `size:${sh.id}:${k}`)} play={(key, part) => ({ at: 'size', id: sh.id, key, part })} />;
  if (!dims) return <ParamRows keyPrefix={sh.id} params={def.params} values={sh.size} onChange={(k, v) => set(s => { s.size[k] = v; }, `size:${sh.id}:${k}`)} play={(key, part) => ({ at: 'size', id: sh.id, key, part })} />;
  const now = linkedSize(sh) ?? 0.5;
  const scaleTo = (v: number) => set(s => {
    const f = now > 0 ? v / now : 1;
    for (const t of dims.linked) {
      const x = s.size[t.key] ?? def.params.find(p => p.key === t.key)?.def;
      s.size[t.key] = Array.isArray(x) ? (x as Vec3).map(n => Math.round(Math.max(0.005, n * f) * 1e4) / 1e4) as Vec3 : Math.round(Math.max(0.005, Number(x) * f) * 1e4) / 1e4;
    }
  }, `size:${sh.id}:linked`);
  const vec = vector ? (sh.size.size as Vec3 | undefined) ?? (def.params.find(p => p.key === 'size')!.def as Vec3) : null;
  const param = (key: string) => def.params.find(p => p.key === key)!;
  return <>
    <Row label="Size" hint={vector ? 'Linked: one Size for its width, height and depth together (it keeps its proportions). Separate: each on its own.' : 'Linked: one Size for its radius and height together. Separate: each on its own.'}>
      <Segmented size="sm" ariaLabel="Linked or separate sizes" value={mode} onChange={setMode}
        options={[{ value: 'linked' as const, label: 'Linked' }, { value: 'separate' as const, label: vector ? 'Width · height · depth' : 'Radius · height' }]} />
    </Row>
    {mode === 'linked' && <NumRow label="Size" hint="Every dimension together, keeping the proportions (the square on its ring in the viewport does the same)." value={now} min={0.01} max={5} step={0.005}
      onChange={scaleTo} play={vector ? { at: 'size', id: sh.id, key: 'size', part: 0 } : { at: 'size', id: sh.id, key: 'r' }} />}
    {mode === 'separate' && vector && vec && (['Width', 'Height', 'Depth'] as const).map((label, i) => (
      <NumRow key={label} label={label} hint={`Half its ${label.toLowerCase()}: from its middle to a side.`} value={vec[i]} min={param('size').min} max={param('size').max} step={param('size').step}
        defaultValue={(param('size').def as Vec3)[i]}
        onChange={v => set(s => { const cur = [...((s.size.size as Vec3 | undefined) ?? vec)] as Vec3; cur[i] = v; s.size.size = cur; }, `size:${sh.id}:size:${i}`)}
        play={{ at: 'size', id: sh.id, key: 'size', part: i as 0 | 1 | 2 }} />
    ))}
    {mode === 'separate' && !vector && <>
      <NumRow label="Radius" hint={param('r').hint ?? 'How far it reaches across, from its middle.'} value={Number(sh.size.r ?? param('r').def)} min={param('r').min} max={param('r').max} step={param('r').step} defaultValue={Number(param('r').def)}
        onChange={v => set(s => { s.size.r = v; }, `size:${sh.id}:r`)} play={{ at: 'size', id: sh.id, key: 'r' }} />
      <NumRow label={param('h').label} hint={param('h').hint ?? 'How tall it is.'} value={Number(sh.size.h ?? param('h').def)} min={param('h').min} max={param('h').max} step={param('h').step} defaultValue={Number(param('h').def)}
        onChange={v => set(s => { s.size.h = v; }, `size:${sh.id}:h`)} play={{ at: 'size', id: sh.id, key: 'h' }} />
    </>}
    {restRows}
  </>;
}

export function ShapesPanel() {
  const spec = useSceneBuilder(s => s.spec);
  const selectedId = useSceneBuilder(s => s.selectedId);
  const edit = useSceneBuilder(s => s.edit);
  const select = useSceneBuilder(s => s.select);
  const setTab = useSceneBuilder(s => s.setTab);
  const tk = useTokens();
  const shapes = allShapes(spec);
  const sel = (selectedId && findItem(spec, selectedId)?.item) || null;
  const add = (g: GalleryShape) => {
    let id = '';
    edit(d => { const sh = addShape(d, g.kind, selectedId); if (g.size) Object.assign(sh.size, structuredClone(g.size)); id = sh.id; });
    select(id);
  };
  return <>
    <Head id="shapes" />
    <Card id="studio:gallery" title="Add a shape" defaultOpen={shapes.length < 2} summary="click a picture to add it">
      <ShapeGallery onPick={add} size={44} minTile={66} />
      <Button size="sm" icon="dice" style={{ alignSelf: 'flex-start' }} onClick={() => randomShapeAction()} data-random-shape
        title="Add one random shape with a random size, place, turn and colour (one undo step)">Random shape</Button>
    </Card>
    <BuilderLabel meta={`${shapes.length}`}>In the scene</BuilderLabel>
    <div role="list" aria-label="Shapes in the scene" data-scene-shapes style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {shapes.map(sh => {
        const on = sh.id === selectedId;
        return (
          <button key={sh.id} role="listitem" type="button" data-scene-shape={sh.id} aria-pressed={on} onClick={() => select(sh.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px 0 4px', border: 0, borderRadius: 15, cursor: 'pointer',
              background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.primary, boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? tk.accent.base : tk.border.subtle}`, font: `600 12px ${fontFamily.ui}` }}>
            <ShapeThumb kind={sh.kind} size={22} />
            <span style={{ width: 8, height: 8, borderRadius: 2, background: rgbCss(sh.color) }} />
            {itemName(spec, sh)}
          </button>
        );
      })}
      {!shapes.length && <BuilderNote>None yet: click a picture above, or pick a preset below.</BuilderNote>}
    </div>
    {sel?.type === 'shape' && <Inspector item={sel} sizes={sh => <SizeRows key={sh.id} sh={sh} />} />}
    {sel?.type === 'group' && (
      <Callout tone="info" title={`${sel.id === spec.root.id ? 'The whole scene' : itemName(spec, sel)} is a group`}>
        Groups join shapes. <Button size="sm" variant="ghost" onClick={() => setTab('combine')}>Edit it in Combine</Button>
      </Callout>
    )}
    {!sel && shapes.length > 0 && <BuilderNote>Click a shape in the viewport or above to change it.</BuilderNote>}
  </>;
}

// ── Combine ──────────────────────────────────────────────────────────────────

/** Two overlapping discs, shaded the way the combine keeps them. */
export function CombinePicture({ op, smooth, size = 44 }: { op: GroupSpec['op']; smooth: boolean; size?: number }) {
  const tk = useTokens();
  const id = `cp-${op}-${smooth ? 's' : 'h'}`;
  const fill = tk.accent.base, line = tk.text.faint;
  const A = { cx: 17, cy: 16, r: 11 }, B = { cx: 29, cy: 16, r: 11 };
  return (
    <svg width={size} height={size * 32 / 46} viewBox="0 0 46 32" aria-hidden style={{ flexShrink: 0 }}>
      <defs>
        <clipPath id={`${id}-b`}><circle {...B} /></clipPath>
        <mask id={`${id}-m`}><rect width="46" height="32" fill="#fff" /><circle {...B} fill="#000" /></mask>
      </defs>
      {op === 'union' && <><circle {...A} fill={fill} /><circle {...B} fill={fill} />{smooth && <rect x={17} y={9} width={12} height={14} fill={fill} />}</>}
      {op === 'subtract' && <circle {...A} fill={fill} mask={`url(#${id}-m)`} />}
      {op === 'intersect' && <circle {...A} fill={fill} clipPath={`url(#${id}-b)`} />}
      <circle {...A} fill="none" stroke={line} strokeWidth={1} strokeDasharray={op === 'union' ? undefined : '2 2'} />
      <circle {...B} fill="none" stroke={line} strokeWidth={1} strokeDasharray={op === 'union' ? undefined : '2 2'} />
    </svg>
  );
}

const COMBINES: Array<{ op: GroupSpec['op']; smooth: boolean; label: string; blurb: string }> = [
  { op: 'union', smooth: false, label: 'Union', blurb: 'Both; the nearer surface wins.' },
  { op: 'union', smooth: true, label: 'Smooth union', blurb: 'Melted together like putty.' },
  { op: 'subtract', smooth: false, label: 'Subtract', blurb: 'The first, with the rest cut out.' },
  { op: 'subtract', smooth: true, label: 'Smooth subtract', blurb: 'A cut with a soft edge.' },
  { op: 'intersect', smooth: false, label: 'Intersect', blurb: 'Only where they overlap.' },
  { op: 'intersect', smooth: true, label: 'Smooth intersect', blurb: 'The overlap, rounded.' },
];

export function CombinePanel() {
  const spec = useSceneBuilder(s => s.spec);
  const selectedId = useSceneBuilder(s => s.selectedId);
  const edit = useSceneBuilder(s => s.edit);
  const tk = useTokens();
  // The group being edited: the selected group, or the one round the selected shape, or the whole scene.
  const sel = (selectedId && findItem(spec, selectedId)?.item) || null;
  const g: GroupSpec = sel?.type === 'group' ? sel : (sel ? pathTo(spec, sel.id).slice(-1)[0] : undefined) ?? spec.root;
  const value = `${g.k > 0 ? 'smooth-' : ''}${g.op}`;
  return <>
    <Head id="combine" />
    <BuilderLabel meta={g.id === spec.root.id ? 'the whole scene' : itemName(spec, g)}>How it joins</BuilderLabel>
    <div role="radiogroup" aria-label="Combine" data-combine-cards style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
      {COMBINES.map(c => {
        const key = `${c.smooth ? 'smooth-' : ''}${c.op}`;
        const on = key === value;
        return (
          <button key={key} type="button" role="radio" aria-checked={on} data-op={key}
            onClick={() => edit(d => { const it = findItem(d, g.id)?.item; if (it?.type === 'group') { it.op = c.op; it.k = c.smooth ? (it.k > 0 ? it.k : 0.3) : 0; } })}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left',
              background: on ? tk.bg.selected : tk.bg.panel, boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? tk.accent.base : tk.border.default}`, color: tk.text.primary }}>
            <CombinePicture op={c.op} smooth={c.smooth} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <b style={{ font: `600 12px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.primary }}>{c.label}</b>
              <span style={{ fontSize: 11, color: tk.text.muted, lineHeight: 1.3 }}>{c.blurb}</span>
            </span>
          </button>
        );
      })}
    </div>
    {g.k > 0 && <NumRow label="Blend (k)" hint="How wide the melted join is, in scene units." value={g.k} min={0.01} max={1} step={0.005}
      onChange={v => edit(d => { const it = findItem(d, g.id)?.item; if (it?.type === 'group') it.k = v; }, `k:${g.id}`)} play={{ at: 'k', id: g.id }} />}
    <BuilderLabel meta="drag rows to reorder or nest">The scene, as a tree</BuilderLabel>
    <div data-combine-tree style={{ borderRadius: radius.control, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, overflow: 'hidden' }}>
      <SceneTree />
    </div>
    {sel?.type === 'group' && sel.id !== spec.root.id && (
      <Card id={`studio:group:${sel.id}`} title="This group" summary={opLabel(sel)}>
        <GroupInspector g={sel} />
      </Card>
    )}
  </>;
}

// ── Warps ────────────────────────────────────────────────────────────────────

const WARP_ICON: Record<string, IconName> = { repeat: 'grid', 'mirror-repeat': 'grid', 'limited-repeat': 'grid', mirror: 'bidir', fold: 'bidir', 'polar-repeat': 'loop', kaleido: 'spark', twist: 'rebuild', bend: 'curve', sine: 'wave', noise: 'wave', displace: 'wave', round: 'cube', onion: 'layers', move: 'hand', turn: 'rebuild', rotate: 'rebuild', scale: 'fit' };

export function WarpsPanel() {
  const spec = useSceneBuilder(s => s.spec);
  const selectedId = useSceneBuilder(s => s.selectedId);
  const select = useSceneBuilder(s => s.select);
  const edit = useSceneBuilder(s => s.edit);
  const tk = useTokens();
  const target: SceneItem = (selectedId && findItem(spec, selectedId)?.item) || spec.root;
  const items: SceneItem[] = [];
  walkItems(spec.root, it => items.push(it));
  const hints = stepHints(spec);
  const name = (it: SceneItem) => (it.id === spec.root.id ? 'Whole scene' : itemName(spec, it));
  const pill = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 13, font: `600 11.5px ${fontFamily.ui}` } as const;
  return <>
    <Head id="warps" />
    <BuilderLabel>What to bend</BuilderLabel>
    <div role="radiogroup" aria-label="What to bend" data-warp-targets style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map(it => {
        const on = it.id === target.id;
        return (
          <button key={it.id} type="button" role="radio" aria-checked={on} data-warp-target={it.id} onClick={() => select(it.id === spec.root.id ? null : it.id)}
            style={{ ...pill, border: 0, cursor: 'pointer', background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.primary, boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? tk.accent.base : tk.border.subtle}` }}>
            {it.type === 'shape' ? <ShapeThumb kind={it.kind} size={18} /> : <Icon name={it.id === spec.root.id ? 'cube' : 'layers'} size={13} />}
            {name(it)}{it.warps.length ? <span style={{ font: `600 10.5px ${fontFamily.mono}`, color: tk.text.faint }}>{it.warps.length}</span> : null}
          </button>
        );
      })}
    </div>
    <BuilderLabel meta="top to bottom">The stack</BuilderLabel>
    {/* The stack as a flow: space comes in at the top, each warp bends it, the shapes are measured at the bottom. */}
    <div data-warp-stack style={{ display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'stretch' }}>
      <span style={{ ...pill, alignSelf: 'flex-start', background: tk.bg.field, color: tk.text.secondary }}><Icon name="grid" size={13} />Space comes in</span>
      {target.warps.map((w, i) => (
        <div key={w.id} style={{ display: 'flex', flexDirection: 'column' }}>
          <span aria-hidden style={{ width: 2, height: 12, background: alpha(tk.accent.base, 0.5), marginLeft: 18 }} />
          <WarpCard item={target} w={w} index={i} count={target.warps.length} />
        </div>
      ))}
      <span aria-hidden style={{ width: 2, height: 12, background: alpha(tk.accent.base, 0.5), marginLeft: 18 }} />
      <span style={{ ...pill, alignSelf: 'flex-start', background: tk.bg.selected, color: tk.accent.text }}>
        {target.type === 'shape' ? <ShapeThumb kind={target.kind} size={18} /> : <Icon name="cube" size={13} />}{name(target)} is measured
      </span>
    </div>
    {!target.warps.length && <BuilderNote>Nothing bends {target.id === spec.root.id ? 'the whole scene' : itemName(spec, target)} yet: add a warp.</BuilderNote>}
    <BuilderLabel>Add a warp</BuilderLabel>
    <div data-warp-add style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))', gap: 6 }}>
      {WARPS.map(w => (
        <button key={w.kind} type="button" title={w.blurb} data-add-warp={w.kind} onClick={() => edit(d => addWarp(d, target.id, w.kind))}
          style={{ display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', padding: '7px 9px', borderRadius: radius.md, border: `1px dashed ${tk.border.strong}`, background: 'none', cursor: 'pointer', color: tk.text.secondary, font: `500 12px ${fontFamily.ui}` }}>
          <Icon name={WARP_ICON[w.kind] ?? 'wave'} size={13} />{w.label}
        </button>
      ))}
    </div>
    {hints.length > 0 && (
      <Callout tone="warning" title={`Smaller steps: ${spec.quality.stepScale === 'auto' ? `auto, ${autoStepScale(spec)}` : spec.quality.stepScale}`}>
        These stretch space, so the march takes smaller steps (Output › Quality): {hints.slice(0, 3).map(h => `${h.why} (${h.value})`).join('; ')}.
      </Callout>
    )}
  </>;
}

// ── Light & colour ───────────────────────────────────────────────────────────

export function LightPanel() {
  const spec = useSceneBuilder(s => s.spec);
  const edit = useSceneBuilder(s => s.edit);
  const select = useSceneBuilder(s => s.select);
  const shapes = allShapes(spec).filter(s => s.kind !== 'custom');
  const mode = spec.look.mode;
  const setShape = (id: string, fn: (s: ShapeSpec) => void, key?: string) => edit(d => { const it = findItem(d, id)?.item; if (it?.type === 'shape') fn(it); }, key);
  return <>
    <Head id="light" />
    {shapes.length > 0 && (
      <Card id="studio:colours" title="Shape colours" defaultOpen summary={`${shapes.length} shape${shapes.length === 1 ? '' : 's'}`}>
        {mode !== 'surface' && <BuilderNote>{mode === 'gi' ? 'GI lit uses the first shape\'s colour for every shape.' : mode === 'volumetric' ? 'Volumetric glow has one tint (under Mode).' : 'Glass colours what is behind it with one colour.'} Each shape's own colour shows in Surface mode.</BuilderNote>}
        {shapes.map(sh => (
          <div key={sh.id} data-shape-colour={sh.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <ColourRow label={<span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }} onClick={() => select(sh.id)}><ShapeThumb kind={sh.kind} size={18} />{itemName(spec, sh)}</span>}
              value={sh.color} onChange={v => setShape(sh.id, s => { s.color = v; }, `color:${sh.id}`)} />
            {mode === 'surface' && <NumRow label="Shine" hint="How strong its highlight is: 0 matt, 1 glossy." value={sh.shine} min={0} max={1} onChange={v => setShape(sh.id, s => { s.shine = v; }, `shine:${sh.id}`)} />}
          </div>
        ))}
      </Card>
    )}
    <LightSettings />
  </>;
}

// ── Camera ───────────────────────────────────────────────────────────────────

export function CameraPanel() {
  return <>
    <Head id="camera" />
    <BuilderNote>Drag the viewport to turn round, scroll to come closer: the sliders follow.</BuilderNote>
    <CameraRows />
  </>;
}

// ── Output ───────────────────────────────────────────────────────────────────

export function OutputPanel() {
  return <>
    <Head id="output" />
    <OutputRows />
    <ToneRow />
    <Card id="studio:quality" title="Quality" summary="steps, distance, step scale">
      <QualityRows />
    </Card>
  </>;
}

/** The panel for a section. */
export function SectionPanel({ id }: { id: SceneSection }) {
  switch (id) {
    case 'mode': return <ModePanel />;
    case 'shapes': return <ShapesPanel />;
    case 'combine': return <CombinePanel />;
    case 'warps': return <WarpsPanel />;
    case 'light': return <LightPanel />;
    case 'camera': return <CameraPanel />;
    case 'output': return <OutputPanel />;
  }
}

