/**
 * panels.tsx — the Splat builder's sections (docs/splat-builder.md): Scan, Place, Effects, Scene, Camera, Look, and
 * Under the hood (the recipe). Every number is a BuilderSlider; where it is a node's param, right-click offers the
 * node card's Play menu (the scene is built as you go, so the node is there).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';
import { BuilderSlider } from '../builders/BuilderSlider';
import { BuilderNote } from '../builders/BuilderWindow';
import { TexturePicker } from '../builders/TexturePicker';
import { Row } from '../sceneBuilder/controls';
import { ColorSwatch } from '../ui/ColorPicker';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { NEST_INDENT, nestedSectionStyle } from '../ui/nesting';
import { MiniCloud } from './MiniCloud';
import { useScanBox } from './SplatViewport';
import { useSplatBuilder } from '../../splatBuilder/store';
import { findSplatBuild } from '../../splatBuilder/apply';
import { withSource, type TexSource } from '../../builders/textures';
import { splatEngine, type SplatStatus } from '../../lib/splats/engine';
import { SPLAT_ACCEPT, addSplatFile, isSplatFileName, listSplats } from '../../lib/splats/library';
import { subscribe as onLibraryChange, type LibraryVideoMeta } from '../../lib/backgroundLibrary';
import { SPLAT_MAX_OPTIONS } from '../../nodes/definitions/splatScene';
import { centrePlace, fitPlace, onFloorPlace, quarterTurn, scanCenter } from '../../splatBuilder/place';
import { readSplatRecipe, splatRecipe } from '../../splatBuilder/recipe';
import {
  EFFECT_INFO, EFFECT_KINDS, EFFECT_TYPE, LIGHTS, LIGHT_INFO, PROP_KINDS, PROP_LABELS, QUALITY_KEYS, QUALITY_PRESETS, TONES, TONE_LABELS,
  animateFor, effectSummary, moveEffect, newEffect, nextEffectId, placeEffect, qualityOf, scanName,
  type EffectKind, type EffectSpec, type ParamValue, type PropKind, type SplatBuilderSpec, type SplatSection, type Vec3,
} from '../../splatBuilder/spec';

const edit = (fn: (d: SplatBuilderSpec) => void, key?: string) => useSplatBuilder.getState().edit(fn, key);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const NO_TEXTURES: TexSource[] = [];

/** The node a role was built as (looked up when the Play menu opens). */
function playParam(role: string, key: string): () => { nodeId: string; key: string } | { missing: string } {
  return () => {
    const id = useSplatBuilder.getState().targetId;
    const b = id ? findSplatBuild(useNodeGraphStore.getState().nodes, id) : null;
    const node = b?.byRole.get(role);
    return node ? { nodeId: node.id, key } : { missing: 'Not built yet: this part is off.' };
  };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function Num({ label, value, min, max, step = 0.01, onChange, hint, play, rangeKey, defaultValue, unit }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; hint?: string;
  play?: [string, string]; rangeKey?: string; defaultValue?: number; unit?: string;
}) {
  return (
    <Row label={unit ? <>{label} <span style={{ opacity: 0.6 }}>{unit}</span></> : label} hint={hint}>
      <BuilderSlider value={value} min={min} max={max} step={step} onChange={onChange} ariaLabel={label} rangeKey={rangeKey} defaultValue={defaultValue}
        lazyParam={play ? playParam(play[0], play[1]) : undefined} />
    </Row>
  );
}

function Vec({ label, value, min, max, step = 0.01, onChange, hint, axes = ['X', 'Y', 'Z'], defaultValue }: {
  label: string; value: Vec3; min: number; max: number; step?: number; onChange: (v: Vec3) => void; hint?: string; axes?: [string, string, string]; defaultValue?: Vec3;
}) {
  const tk = useTokens();
  return (
    <Row label={label} hint={hint}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
        {value.map((v, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span style={{ font: `600 10.5px ${fontFamily.mono}`, color: tk.text.faint, width: 10 }}>{axes[i]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <BuilderSlider value={v} min={min} max={max} step={step} ariaLabel={`${label} ${axes[i]}`} defaultValue={defaultValue?.[i]}
                onChange={n => { const next = [...value] as Vec3; next[i] = n; onChange(next); }} />
            </div>
          </div>
        ))}
      </div>
    </Row>
  );
}

function Colour({ label, value, onChange, hint }: { label: string; value: Vec3; onChange: (v: Vec3) => void; hint?: string }) {
  return <Row label={label} hint={hint}><ColorSwatch value={value} label={label} onChange={c => onChange([c[0], c[1], c[2]])} /></Row>;
}

function Group({ title, children, meta }: { title: string; children: ReactNode; meta?: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>
        <span style={{ flex: 1 }}>{title}</span>{meta}
      </span>
      {/* A group inside a section is stepped in under its title (components/ui/nesting.ts). */}
      <div data-nested-section="true" style={{ display: 'flex', flexDirection: 'column', gap: 6, ...nestedSectionStyle(tk.border.subtle, -NEST_INDENT + 4) }}>
        {children}
      </div>
    </div>
  );
}

// ── Scan ─────────────────────────────────────────────────────────────────────

function useStatus(nodeId: string | null): SplatStatus | null {
  const sub = useMemo(() => (fn: () => void) => splatEngine.onChange(fn), []);
  const snap = useRef<{ key: string; v: SplatStatus | null } | null>(null);
  return useSyncExternalStore(sub, () => {
    const v = nodeId ? splatEngine.status(nodeId) : null;
    const key = v ? `${v.state}:${v.drawn}:${v.shDegree}:${v.message ?? ''}:${v.thumb ? v.thumb.length : 0}:${v.fileName ?? ''}:${v.info?.count ?? 0}` : '';
    if (key !== snap.current?.key) snap.current = { key, v };
    return snap.current.v;
  });
}

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const short = (n: number) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : `${Math.round(n / 1e3)}k`);

export function ScanSection() {
  const tk = useTokens();
  const scan = useSplatBuilder(s => s.spec.scan);
  const targetId = useSplatBuilder(s => s.targetId);
  const status = useStatus(targetId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<LibraryVideoMeta[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!picking) return;
    let live = true;
    const load = () => { listSplats().then(l => { if (live) setLibrary(l); }).catch(() => { if (live) setLibrary([]); }); };
    load();
    const off = onLibraryChange(load);
    return () => { live = false; off(); };
  }, [picking]);

  const box = useScanBox(targetId);
  // A new file is fitted to the view once it is read (effects measure in scene units: a scan metres across would
  // dissolve in specks), as Place → Fit to view does.
  const useFile = (m: { id: string; name: string; bytes: number }) => {
    useSplatBuilder.getState().setFitPending({ was: JSON.stringify(box) });
    edit(d => { d.scan.source = { kind: 'file', videoId: m.id, fileName: m.name, bytes: m.bytes }; });
  };
  const take = async (file: File) => {
    setMsg('');
    if (!isSplatFileName(file.name)) { setMsg(`“${file.name}” isn’t a splat scan (.ply, .splat or .spz).`); return; }
    setBusy(true);
    try { useFile(await addSplatFile(file)); setMsg('Loaded and fitted to the view: Place moves, turns and sizes it.'); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const info = status?.info;
  const facts = (() => {
    if (!status) return '';
    if (status.state === 'loading') return status.message ?? 'Reading the scan…';
    if (status.state === 'error' || status.state === 'missing' || status.state === 'nested') return status.message ?? 'The scan can’t be read.';
    if (!info) return '';
    return [`${info.count.toLocaleString()} splats${status.drawn && status.drawn < info.count ? ` (drawing ${short(status.drawn)})` : ''}`, status.bytes ? mb(status.bytes) : '', `.${info.format}`, `SH ${status.shDegree}${info.shDegree > status.shDegree ? ` of ${info.shDegree}` : ''}`].filter(Boolean).join(' · ');
  })();
  const q = qualityOf(scan);
  return (
    <>
      <div data-splat-drop onClick={() => fileRef.current?.click()} title="Click to pick a scan, or drop a .ply, .splat or .spz"
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void take(f); }}
        style={{
          position: 'relative', borderRadius: radius.md, overflow: 'hidden', cursor: 'pointer', aspectRatio: '16 / 9', background: tk.bg.render,
          boxShadow: over ? `0 0 0 2px ${tk.accent.base}` : `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        {status?.thumb
          ? <img src={status.thumb} alt="The scan, seen from the front" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <MiniCloud effects={[]} width={312} height={176} label="The scan" />}
        <span style={{ position: 'absolute', left: 8, bottom: 8, padding: '3px 8px', borderRadius: 6, background: 'rgba(13,13,18,0.72)', color: '#e8e8f0', fontSize: 11.5 }}>
          {busy ? 'Reading…' : 'Drop a scan here'}
        </span>
      </div>
      <input ref={fileRef} type="file" accept={SPLAT_ACCEPT} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void take(f); }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b data-splat-scan-name style={{ fontSize: 13 }}>{scanName(scan.source)}</b>
        {facts && <span data-splat-facts style={{ fontSize: 11.5, color: tk.text.muted }}>{facts}</span>}
        {info && <span style={{ fontSize: 11.5, color: tk.text.muted }}>About {info.coreMax.map((v, i) => { const d = v - info.coreMin[i]; return d >= 10 ? Math.round(d) : Math.round(d * 10) / 10; }).join(' × ')} units across</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" icon="import" data-splat-load onClick={() => fileRef.current?.click()} disabled={busy}>{scan.source.kind === 'file' ? 'Replace…' : 'Load…'}</Button>
        <Button size="sm" variant="ghost" icon="folder" data-splat-library onClick={() => setPicking(p => !p)}>From the library</Button>
        <Button size="sm" variant="ghost" onClick={() => edit(d => { d.scan.source = { kind: 'demo', demo: scan.source.kind === 'demo' && scan.source.demo === 'blob' ? 'rings' : 'blob', count: 150_000 }; })}
          title="A generated scan (no file): a lumpy ball or two rings">Example</Button>
      </div>
      {picking && (
        <div data-splat-library-list style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: radius.md, background: tk.bg.field, maxHeight: 200, overflowY: 'auto' }}>
          {library === null ? <BuilderNote>Looking…</BuilderNote>
            : library.length === 0 ? <BuilderNote>No scans in the library yet: Load… keeps one there.</BuilderNote>
            : library.map(v => (
              <button key={v.id} type="button" onClick={() => { useFile({ id: v.id, name: v.name, bytes: v.bytes }); setPicking(false); }}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: scan.source.kind === 'file' && scan.source.videoId === v.id ? tk.accent.text : tk.text.primary }}>
                {v.thumb ? <img src={v.thumb} alt="" style={{ width: 48, height: 27, objectFit: 'cover', borderRadius: 3 }} /> : <span style={{ width: 48, height: 27, borderRadius: 3, background: tk.bg.subtle, display: 'inline-block' }} />}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                <span style={{ color: tk.text.muted }}>{mb(v.bytes)}</span>
              </button>
            ))}
        </div>
      )}
      {msg && <BuilderNote>{msg}</BuilderNote>}
      <Group title="Quality">
        <Segmented ariaLabel="Quality" fill value={q ?? ('custom' as never)} onChange={(k: string) => {
          const p = QUALITY_PRESETS[k as keyof typeof QUALITY_PRESETS];
          if (p) edit(d => { d.scan.maxSplats = p.maxSplats; d.scan.shDegree = p.shDegree; d.scan.sort = p.sort; d.scan.resolution = p.resolution; });
        }} options={QUALITY_KEYS.map(k => ({ value: k, label: QUALITY_PRESETS[k].label }))} />
        <BuilderNote>{q ? QUALITY_PRESETS[q].line : 'Your own mix, below.'}</BuilderNote>
        <Row label="Max splats" hint="Draw at most this many (spread evenly through the scan): fewer is faster.">
          <Select ariaLabel="Max splats" value={String(scan.maxSplats)} onChange={v => edit(d => { d.scan.maxSplats = Number(v); })}
            options={SPLAT_MAX_OPTIONS.map(n => ({ value: String(n), label: short(n) }))} />
        </Row>
        <Row label="Shine (SH)" hint="View-dependent colour: 0 is flat and fastest; 1–3 add the shine that changes as you move round (.ply and .spz can have it).">
          <Segmented ariaLabel="SH degree" size="sm" value={String(scan.shDegree)} onChange={v => edit(d => { d.scan.shDegree = Number(v); })}
            options={['0', '1', '2', '3'].map(v => ({ value: v, label: v }))} />
        </Row>
        <Row label="Sort" hint="Splats are sorted far to near so they blend right: when the camera moves, or every frame.">
          <Segmented ariaLabel="Sort" size="sm" value={scan.sort} onChange={v => edit(d => { d.scan.sort = v; })} options={[{ value: 'moves', label: 'When it moves' }, { value: 'frame', label: 'Every frame' }]} />
        </Row>
        <Row label="Resolution">
          <Segmented ariaLabel="Resolution" size="sm" value={scan.resolution} onChange={v => edit(d => { d.scan.resolution = v; })} options={[{ value: 'full', label: 'Full' }, { value: 'half', label: 'Half' }]} />
        </Row>
      </Group>
    </>
  );
}

// ── Place ────────────────────────────────────────────────────────────────────

export function PlaceSection() {
  const place = useSplatBuilder(s => s.spec.place);
  const floorY = useSplatBuilder(s => (s.spec.world.on && s.spec.world.floor.on ? s.spec.world.floor.y : -1));
  const targetId = useSplatBuilder(s => s.targetId);
  const box = useScanBox(targetId);
  const set = (fn: (d: SplatBuilderSpec) => void) => edit(fn);
  return (
    <>
      <BuilderNote>Drag the gizmo in the picture: arrows move it, the square sizes it, the X / Y / Z rings turn it.</BuilderNote>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" icon="fit" data-splat-fit disabled={!box} onClick={() => box && set(d => { d.place = fitPlace(d.place, box); })} title="Its middle at the centre, about 3 units across">Fit to view</Button>
        <Button size="sm" variant="ghost" data-splat-centre onClick={() => set(d => { d.place = centrePlace(d.place, box); })} title="Its middle at the centre, its size as it is">Centre</Button>
        <Button size="sm" variant="ghost" data-splat-floor disabled={!box} onClick={() => box && set(d => { d.place = onFloorPlace(d.place, box, floorY); })} title={`Moved up or down so it stands on the floor (height ${floorY})`}>Stand on the floor</Button>
      </div>
      <Group title="Which way is up">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" variant={place.up === 'y' ? 'secondary' : 'ghost'} data-splat-flip onClick={() => set(d => { d.place.up = d.place.up === 'y' ? 'minusY' : 'y'; })}
            title="Most scans come with y pointing down; this turns it over">Turn over</Button>
          <Button size="sm" variant="ghost" onClick={() => set(d => { d.place = quarterTurn(d.place, box, 0, -90); })} title="For a scan lying on its back (Z up)">Stand it up</Button>
          <Button size="sm" variant="ghost" onClick={() => set(d => { d.place = quarterTurn(d.place, box, 1, 90); })} title="A quarter turn round the vertical">Turn 90°</Button>
        </div>
        <BuilderNote>Up is {place.up === 'y' ? '+Y (as it comes)' : '−Y (the 3DGS way, most scans)'}.</BuilderNote>
      </Group>
      <Group title="Where">
        <Vec label="Position" value={place.position} min={-5} max={5} defaultValue={[0, 0, 0]} onChange={v => edit(d => { d.place.position = v; }, 'place:pos')} />
        <Vec label="Turn" value={place.rotation} min={-180} max={180} step={0.5} defaultValue={[0, 0, 0]} onChange={v => edit(d => { d.place = keepTurn(d, v, box); }, 'place:rot')} hint="Degrees: X, then Y, then Z. Its middle stays where it is." />
        <Num label="Scale" value={place.scale} min={0.05} max={5} defaultValue={1} play={['scan', 'scale']} onChange={v => edit(d => { d.place = { ...d.place, ...sized(d, v, box) }; }, 'place:scale')} />
      </Group>
      <Group title="The splats">
        <Num label="Splat size" value={place.splatSize} min={0.05} max={4} defaultValue={1} play={['scan', 'splatSize']} onChange={v => edit(d => { d.place.splatSize = v; }, 'place:size')} hint="Below 1 thins the scan into dots, above 1 softens it." />
        <Num label="Opacity" value={place.opacity} min={0} max={2} defaultValue={1} play={['scan', 'opacity']} onChange={v => edit(d => { d.place.opacity = v; }, 'place:op')} />
      </Group>
    </>
  );
}

function keepTurn(d: SplatBuilderSpec, rotation: Vec3, box: ReturnType<typeof useScanBox>) {
  const at = scanCenter(d.place, box);
  const next = { ...d.place, rotation };
  const c = scanCenter({ ...next, position: [0, 0, 0] }, box);
  return { ...next, position: [r3(at[0] - c[0]), r3(at[1] - c[1]), r3(at[2] - c[2])] as Vec3 };
}
function sized(d: SplatBuilderSpec, scale: number, box: ReturnType<typeof useScanBox>) {
  const at = scanCenter(d.place, box);
  const c = scanCenter({ ...d.place, scale, position: [0, 0, 0] }, box);
  return { scale, position: [r3(at[0] - c[0]), r3(at[1] - c[1]), r3(at[2] - c[2])] as Vec3 };
}

// ── Effects ──────────────────────────────────────────────────────────────────

function ParamControl({ e, k }: { e: EffectSpec; k: string }) {
  const def = getNodeDefinition(EFFECT_TYPE[e.kind])?.paramDefs?.[k];
  const v = e.params[k];
  if (!def) return null;
  const show = def.showWhen;
  if (show) {
    const cur = e.params[show.param];
    const want = Array.isArray(show.value) ? show.value : [show.value];
    if (!want.includes(cur as never)) return null;
  }
  const set = (val: ParamValue) => edit(d => { const x = d.effects.find(y => y.id === e.id); if (x) x.params[k] = val; }, `fx:${e.id}:${k}`);
  const label = def.label ?? k;
  if (def.type === 'select') {
    return (
      <Row label={label} hint={def.hint}>
        <Select ariaLabel={label} value={String(v)} onChange={set} options={(def.options ?? []).map(o => ({ value: String(o.value), label: o.label }))} />
      </Row>
    );
  }
  if (def.type === 'vec3color') return <Colour label={label} hint={def.hint} value={(v as Vec3) ?? [1, 1, 1]} onChange={set} />;
  if (def.type === 'vec3') return <Vec label={label} hint={def.hint} value={(v as Vec3) ?? [0, 0, 0]} min={def.min ?? -5} max={def.max ?? 5} step={def.step ?? 0.01} onChange={set} />;
  if (typeof v !== 'number') return null;
  const dflt = getNodeDefinition(EFFECT_TYPE[e.kind])?.defaultParams?.[k];
  return <Num label={label} hint={def.hint} value={v} min={def.min ?? 0} max={def.max ?? 1} step={def.step ?? 0.01} defaultValue={typeof dflt === 'number' ? dflt : undefined}
    rangeKey={`splat:${e.kind}:${k}`} play={[`fx:${e.id}`, k]} onChange={set} />;
}

function EffectCard({ e, index, count }: { e: EffectSpec; index: number; count: number }) {
  const tk = useTokens();
  const picked = useSplatBuilder(s => s.picked === e.id);
  const bg = useSplatBuilder(s => s.spec.background.color);
  const [dragOver, setDragOver] = useState(false);
  const info = EFFECT_INFO[e.kind];
  const custom = e.kind === 'custom';
  // Relative to the scan is always on for the builder's nodes (build.ts), so it isn't a setting here.
  const keys = custom ? [] : Object.keys(getNodeDefinition(EFFECT_TYPE[e.kind])?.paramDefs ?? {}).filter(k => k !== 'on' && k !== 'relative');
  const up = (fn: (x: EffectSpec) => void) => edit(d => { const x = d.effects.find(y => y.id === e.id); if (x) fn(x); });
  return (
    <div data-splat-effect={e.id} data-splat-effect-kind={e.kind} draggable
      onDragStart={ev => { ev.dataTransfer.setData('text/x-splat-effect', e.id); ev.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={ev => { if (ev.dataTransfer.types.includes('text/x-splat-effect')) { ev.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={ev => { ev.preventDefault(); setDragOver(false); const id = ev.dataTransfer.getData('text/x-splat-effect'); if (id && id !== e.id) edit(d => { d.effects = placeEffect(d.effects, id, e.id); }); }}
      style={{
        borderRadius: radius.control, background: tk.bg.panel, flexShrink: 0, overflow: 'hidden', opacity: e.on ? 1 : 0.6,
        boxShadow: dragOver ? `inset 0 3px 0 ${tk.accent.base}, inset 0 0 0 1px ${tk.border.default}` : `inset 0 0 0 1px ${picked ? tk.accent.base : tk.border.default}`,
      }}>
      <div onClick={() => useSplatBuilder.getState().setPicked(picked ? null : e.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 8px', minHeight: 42, cursor: 'pointer' }}>
        <Icon name="grip" size={13} style={{ color: tk.text.faint, cursor: 'grab', flexShrink: 0 }} />
        <span style={{ width: 18, height: 18, borderRadius: 5, background: alpha(tk.accent.base, 0.14), color: tk.accent.text, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{index + 1}</span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 13 }}>{info.label}</b>
          <span data-splat-effect-summary style={{ fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{effectSummary(e)}</span>
        </span>
        <span onClick={ev => ev.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Toggle checked={e.on} onChange={on => up(x => { x.on = on; })} />
          <IconButton icon="chevU" size="sm" label="Earlier (applied before)" disabled={index === 0} onClick={() => edit(d => { d.effects = moveEffect(d.effects, e.id, -1); })} data-effect-up />
          <IconButton icon="chevD" size="sm" label="Later (applied after)" disabled={index === count - 1} onClick={() => edit(d => { d.effects = moveEffect(d.effects, e.id, 1); })} data-effect-down />
          <IconButton icon="trash" size="sm" label={custom ? 'Take out of the stack (the nodes stay on the graph, unwired)' : 'Remove'} onClick={() => edit(d => { d.effects = d.effects.filter(x => x.id !== e.id); })} data-effect-remove />
        </span>
      </div>
      {picked && custom && (
        <div data-splat-custom-note style={{ padding: '8px 12px 12px', borderTop: `1px solid ${tk.border.subtle}` }}>
          <BuilderNote>Nodes you added on the Splat Scene card. The builder never changes them: it keeps them wired here in the stack, so move the card to change what they come before or after. Edit them on the graph.</BuilderNote>
        </div>
      )}
      {picked && !custom && (
        <div style={{ padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${tk.border.subtle}` }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <MiniCloud effects={[e]} bg={bg} width={128} height={80} label={`${info.label}: a live preview on a point cloud`} />
            <BuilderNote>{info.line}. Live on a small cloud here; on your scan in the picture.</BuilderNote>
          </div>
          {keys.map(k => <ParamControl key={k} e={e} k={k} />)}
          <Row label="Animate" hint="Sweeps one setting slowly back and forth with an LFO wired into its socket (a Play control can take over).">
            <Toggle checked={!!e.animate} onChange={on => up(x => { x.animate = on ? animateFor(x.kind) : null; })} />
          </Row>
          {e.animate && (
            <>
              <Row label="Setting">
                <Select ariaLabel="Animated setting" value={e.animate.param} onChange={p => up(x => { x.animate = animateFor(x.kind, p, x.animate?.speed ?? 0.1); })}
                  options={keys.filter(k => typeof e.params[k] === 'number').map(k => ({ value: k, label: getNodeDefinition(EFFECT_TYPE[e.kind])?.paramDefs?.[k]?.label ?? k }))} />
              </Row>
              <Num label="Speed" unit="Hz" value={e.animate.speed} min={0.01} max={1} defaultValue={0.1} play={[`fx:${e.id}:lfo`, 'freq']} onChange={v => up(x => { if (x.animate) x.animate.speed = v; })} />
              <Num label="From" value={e.animate.from} min={-5} max={5} onChange={v => up(x => { if (x.animate) x.animate.from = v; })} />
              <Num label="To" value={e.animate.to} min={-5} max={5} onChange={v => up(x => { if (x.animate) x.animate.to = v; })} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function EffectsSection() {
  const tk = useTokens();
  const effects = useSplatBuilder(s => s.spec.effects);
  const bg = useSplatBuilder(s => s.spec.background.color);
  const add = (kind: EffectKind) => {
    const id = nextEffectId(useSplatBuilder.getState().spec.effects);
    edit(d => { d.effects.push(newEffect(kind, id)); });
    useSplatBuilder.getState().setPicked(id);
  };
  const preview = useMemo(() => Object.fromEntries(EFFECT_KINDS.map(k => [k, [newEffect(k, 'x')]])), []);
  return (
    <>
      <Group title="Add an effect">
        <div data-splat-add-effects style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
          {EFFECT_KINDS.map(k => (
            <button key={k} type="button" data-splat-add={k} title={EFFECT_INFO[k].line} onClick={() => add(k)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 4, border: 0, borderRadius: radius.sm, background: tk.bg.field, color: tk.text.secondary, cursor: 'pointer', font: `500 11px ${fontFamily.ui}`, minWidth: 0 }}>
              <MiniCloud effects={preview[k]} bg={bg} width={64} height={40} fps={12} small label={EFFECT_INFO[k].label} />
              <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{EFFECT_INFO[k].label}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group title="The stack" meta={<span style={{ fontSize: 11.5, color: tk.text.muted, textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>first applies first</span>}>
        {effects.length === 0 && <BuilderNote>No effects yet: add one above, pick a template below, or press Surprise me.</BuilderNote>}
        <div data-splat-stack style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {effects.map((e, i) => <EffectCard key={e.id} e={e} index={i} count={effects.length} />)}
        </div>
        {effects.length > 1 && <BuilderNote>Drag a card onto another to put it before that one. Order matters: an Opacity floor after a Dissolve brings dissolved splats back.</BuilderNote>}
      </Group>
    </>
  );
}

// ── Scene ────────────────────────────────────────────────────────────────────

export function SceneSection() {
  const tk = useTokens();
  const world = useSplatBuilder(s => s.spec.world);
  const bg = useSplatBuilder(s => s.spec.background);
  const textures = useSplatBuilder(s => s.spec.textures) ?? NO_TEXTURES;
  const addProp = (kind: PropKind) => edit(d => {
    const n = d.world.props.length;
    d.world.on = true;
    d.world.props.push({ id: `p${Date.now() % 1e6}`, kind, at: [r3((n % 2 ? -1 : 1) * (1.2 + 0.3 * n)), -0.6, r3(-0.3 * n)], size: 0.4, color: [0.8, 0.45, 0.3] });
  });
  return (
    <>
      <Row label="A world" hint="Ray-marched shapes and a floor round the scan, lit; the nearer one wins at each pixel.">
        <Toggle checked={world.on} onChange={on => edit(d => { d.world.on = on; })} label={world.on ? 'The scan in a world' : 'Just the scan'} />
      </Row>
      {world.on && (
        <>
          <Group title="Floor">
            <Row label="Floor"><Toggle checked={world.floor.on} onChange={on => edit(d => { d.world.floor.on = on; })} /></Row>
            {world.floor.on && <>
              <Num label="Height" value={world.floor.y} min={-3} max={1} defaultValue={-1} onChange={v => edit(d => { d.world.floor.y = v; }, 'floor:y')} />
              <Colour label="Colour" value={world.floor.color} onChange={v => edit(d => { d.world.floor.color = v; }, 'floor:c')} />
            </>}
          </Group>
          <Group title="Shapes">
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {PROP_KINDS.map(k => <Button key={k} size="sm" variant="ghost" icon="plus" data-splat-prop={k} onClick={() => addProp(k)}>{PROP_LABELS[k]}</Button>)}
            </div>
            {world.props.map((p, i) => (
              <div key={p.id} data-splat-prop-card={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: radius.control, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Select ariaLabel="Shape" value={p.kind} onChange={v => edit(d => { d.world.props[i].kind = v as PropKind; })} options={PROP_KINDS.map(k => ({ value: k, label: PROP_LABELS[k] }))} style={{ flex: 1 }} />
                  <IconButton icon="trash" size="sm" label="Remove the shape" onClick={() => edit(d => { d.world.props.splice(i, 1); })} />
                </div>
                <Vec label="Where" value={p.at} min={-4} max={4} onChange={v => edit(d => { d.world.props[i].at = v; }, `prop:${p.id}:at`)} />
                <Num label="Size" value={p.size} min={0.05} max={2} onChange={v => edit(d => { d.world.props[i].size = v; }, `prop:${p.id}:size`)} />
                <Colour label="Colour" value={p.color} onChange={v => edit(d => { d.world.props[i].color = v; }, `prop:${p.id}:c`)} />
              </div>
            ))}
          </Group>
          <Group title="Light">
            <Segmented ariaLabel="Light" fill size="sm" value={world.light} onChange={v => edit(d => { d.world.light = v; })} options={LIGHTS.map(l => ({ value: l, label: LIGHT_INFO[l].label }))} />
            <Row label="Shadows"><Toggle checked={world.shadows} onChange={on => edit(d => { d.world.shadows = on; })} /></Row>
            <Num label="Fog" value={world.fog} min={0} max={0.3} step={0.001} defaultValue={0} onChange={v => edit(d => { d.world.fog = v; }, 'fog')} />
          </Group>
        </>
      )}
      <BlendGroup worldOn={world.on} />
      <Group title="Background">
        <Segmented ariaLabel="Background" fill size="sm" value={bg.kind} onChange={v => edit(d => { d.background.kind = v; })}
          options={[{ value: 'solid', label: 'Colour' }, { value: 'gradient', label: 'Gradient' }, { value: 'picture', label: 'Picture' }]} />
        {bg.kind !== 'picture' && <Colour label={bg.kind === 'gradient' ? 'Top' : 'Colour'} value={bg.color} onChange={v => edit(d => { d.background.color = v; }, 'bg:c')} />}
        {bg.kind === 'gradient' && <Colour label="Bottom" value={bg.color2} onChange={v => edit(d => { d.background.color2 = v; }, 'bg:c2')} />}
        {bg.kind === 'picture' && (
          <TexturePicker id="splat-bg" sources={textures} value={bg.picture} startOpen={!bg.picture}
            onChange={name => edit(d => { d.background.picture = name; })}
            onAdd={(src: TexSource) => edit(d => { d.textures = withSource(d.textures, src); d.background.picture = src.name; })} />
        )}
      </Group>
    </>
  );
}

/**
 * How the scan and the world meet (the Splat Scene's Compositing: Edge softness, Solid at), written on the scan node
 * itself (a rebuild keeps a param set by hand). With no world they do nothing, so they are dimmed and say why.
 */
function BlendGroup({ worldOn }: { worldOn: boolean }) {
  const targetId = useSplatBuilder(s => s.targetId);
  const scan = useNodeGraphStore(s => (targetId ? findSplatBuild(s.nodes, targetId)?.byRole.get('scan') ?? null : null));
  if (!scan) return null;
  const set = (k: string, v: number) => useNodeGraphStore.getState().updateNodeParams(scan.id, { [k]: v }, { immediate: true });
  const num = (k: string, d: number) => (typeof scan.params[k] === 'number' ? (scan.params[k] as number) : d);
  return (
    <Group title="Blending with the world">
      {!worldOn && <BuilderNote>Add a world to blend the scan with it.</BuilderNote>}
      <div data-splat-blend aria-disabled={!worldOn} style={{ display: 'flex', flexDirection: 'column', gap: 6, ...(worldOn ? {} : { opacity: 0.45, pointerEvents: 'none' as const }) }}>
        <Num label="Edge softness" value={num('softness', 0.05)} min={0} max={1} step={0.005} defaultValue={0.05} play={['scan', 'softness']} onChange={v => set('softness', v)}
          hint="How gently the world and the splats cross where they meet, in scene units." />
        <Num label="Solid at" value={num('hitAt', 0.5)} min={0.01} max={1} defaultValue={0.5} play={['scan', 'hitAt']} onChange={v => set('hitAt', v)}
          hint="The splats' alpha from which a pixel counts as solid where they meet the world." />
      </div>
    </Group>
  );
}

// ── Camera, Look ─────────────────────────────────────────────────────────────

export function CameraSection() {
  const c = useSplatBuilder(s => s.spec.camera);
  const targetId = useSplatBuilder(s => s.targetId);
  const box = useScanBox(targetId);
  return (
    <>
      <BuilderNote>Drag the picture to turn round the scan; scroll to come closer.</BuilderNote>
      <Num label="Distance" value={c.dist} min={0.5} max={12} defaultValue={3.6} play={['camera', 'camDist']} onChange={v => edit(d => { d.camera.dist = v; }, 'cam:dist')} />
      <Num label="Angle" unit="°" value={c.angle} min={-180} max={180} step={0.5} defaultValue={25} onChange={v => edit(d => { d.camera.angle = v; }, 'cam:angle')} />
      <Num label="Elevation" unit="°" value={c.elev} min={-89} max={89} step={0.5} defaultValue={12} onChange={v => edit(d => { d.camera.elev = v; }, 'cam:elev')} />
      <Num label="Lens" value={c.fov} min={0.5} max={3.14} defaultValue={1.5} play={['camera', 'fov']} onChange={v => edit(d => { d.camera.fov = v; }, 'cam:fov')} hint="Higher is narrower (zoomed in), lower is wider." />
      <Row label="Turntable" hint="The camera turns slowly round the scan.">
        <Toggle checked={c.turntable !== 0} onChange={on => edit(d => { d.camera.turntable = on ? 8 : 0; })} />
      </Row>
      {c.turntable !== 0 && <Num label="Turn speed" unit="°/s" value={c.turntable} min={-45} max={45} step={0.5} defaultValue={8} onChange={v => edit(d => { d.camera.turntable = v; }, 'cam:turn')} />}
      <Vec label="Looks at" value={c.target} min={-4} max={4} defaultValue={[0, 0, 0]} onChange={v => edit(d => { d.camera.target = v; }, 'cam:target')} />
      <div><Button size="sm" variant="ghost" icon="target" onClick={() => edit(d => { d.camera.target = scanCenter(d.place, box).map(r3) as Vec3; })}>Look at the scan</Button></div>
    </>
  );
}

export function LookSection() {
  const l = useSplatBuilder(s => s.spec.look);
  return (
    <>
      <Group title="Tone">
        <Segmented ariaLabel="Tone" fill size="sm" wrap value={l.tone} onChange={v => edit(d => { d.look.tone = v; })} options={TONES.map(t => ({ value: t, label: TONE_LABELS[t] }))} />
        <BuilderNote>{l.tone === 'none' ? 'The scan’s colours as captured.' : 'Rolls bright colours off instead of clipping them: glowing edges and highlights stay soft.'}</BuilderNote>
      </Group>
      <Group title="Bloom">
        <Row label="Bloom"><Toggle checked={l.bloom.on} onChange={on => edit(d => { d.look.bloom.on = on; })} /></Row>
        {l.bloom.on && <>
          <Num label="Intensity" value={l.bloom.intensity} min={0} max={5} defaultValue={0.5} play={['bloom', 'intensity']} onChange={v => edit(d => { d.look.bloom.intensity = v; }, 'bloom:i')} />
          <Num label="Threshold" value={l.bloom.threshold} min={0} max={2} defaultValue={0.8} play={['bloom', 'threshold']} onChange={v => edit(d => { d.look.bloom.threshold = v; }, 'bloom:t')} />
          <Num label="Radius" unit="px" value={l.bloom.radius} min={1} max={128} step={1} defaultValue={32} play={['bloom', 'radius']} onChange={v => edit(d => { d.look.bloom.radius = v; }, 'bloom:r')} />
        </>}
      </Group>
    </>
  );
}

// ── Under the hood ───────────────────────────────────────────────────────────

export function RecipeSection() {
  const tk = useTokens();
  const spec = useSplatBuilder(s => s.spec);
  const text = useMemo(() => splatRecipe(spec), [spec]);
  const [draft, setDraft] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const apply = () => {
    if (draft === null) return;
    const r = readSplatRecipe(draft, useSplatBuilder.getState().spec);
    setErrors(r.errors);
    useSplatBuilder.getState().replace(r.spec);
    setDraft(null);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <BuilderNote>The whole scene as text, one line per part. Edit it and press Apply (⌘↵). An effect line is its kind and the settings on its node.</BuilderNote>
      <textarea data-splat-recipe value={draft ?? text} spellCheck={false} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); apply(); } }}
        style={{ minHeight: 360, resize: 'vertical', padding: 10, borderRadius: radius.md, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `12px/1.55 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" variant="primary" data-splat-recipe-apply disabled={draft === null} onClick={apply}>Apply</Button>
        <Button size="sm" variant="ghost" disabled={draft === null} onClick={() => { setDraft(null); setErrors([]); }}>Revert</Button>
        <Button size="sm" variant="ghost" icon="copy" onClick={() => { void navigator.clipboard?.writeText(draft ?? text); }}>Copy</Button>
      </div>
      {errors.map((e, i) => <span key={i} style={{ fontSize: 12, color: tk.status.warningText }}>{e}</span>)}
    </div>
  );
}

export const SECTION_PANELS: Record<SplatSection, ComponentType> = {
  scan: ScanSection, place: PlaceSection, effects: EffectsSection, scene: SceneSection, camera: CameraSection, look: LookSection,
};
