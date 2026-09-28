/**
 * ProjectionDialog — the output window and its projection mapping
 * (docs/projection.md). Left: the output (display, full screen, open/close)
 * and the surfaces, masks and presets. Middle: a live preview of the output
 * with the mapping's handles, to drag (arrows nudge, ⌘Z undoes). Right: the
 * selected surface's settings.
 *
 * The same edits can be made on the output itself (edit mode shows the
 * handles there); both go through outputHost, which keeps the mapping in the
 * Play record (so it saves with the graph and travels in .playfile).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Modal } from '../ui/Modal';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Select } from '../ui/Select';
import { Field } from '../ui/Field';
import { RulerSlider } from '../ui/RulerSlider';
import { ProBadgeFor } from '../account/ProSheet';
import { useCan, requireFeature } from '../../lib/plan';
import { playOverlay } from '../../play/overlay';
import { PREVIEW_ASPECTS } from '../../utils/graphImportPlan';
import { WarpRenderer } from '../../output/warpRenderer';
import { arrowStep, drawHandles, handlesOf, hitTest, isOffView, moveHandle, nudge, sameRef, surfaceOf, type HandleRef } from '../../output/mappingEdit';
import { FrameLoop, watchVisible } from '../../output/frameLoop';
import { isConvexQuad } from '../../output/warp';
import { isDesktopApp } from '../../output/transport';
import {
  closeOutput, currentProjection, mappingHistory, moveOutputTo, openOutput, redoMapping, refreshMonitors, setOutputFullscreen, setOutputUi,
  setProjection, undoMapping, useOutput, pickMonitor,
} from '../../output/outputHost';
import {
  defaultProjection, displayProjection, fullQuad, loadPresets, meshGrid, MESH_MAX, MESH_MIN, newId, newSurface, savePresets, TEST_PATTERNS,
  type ProjectionPreset, type ProjectionRecord, type ProjQuad, type ProjSurface, type SurfaceSource, type TestPattern,
} from '../../types/projection';

export function ProjectionDialog({ onClose }: { onClose: () => void }) {
  const tk = useTokens();
  const out = useOutput();
  const saved = useNodeGraphStore(s => s.play.projection);
  const previewAspect = useNodeGraphStore(s => s.previewAspect);
  const chosen = out.monitors.length ? pickMonitor(out.monitors, out.display.name) : null;
  const aspect = out.status && out.status.height > 0 ? out.status.width / out.status.height : chosen ? chosen.width / chosen.height : 16 / 9;
  // The picture's shape (a Play of any shape takes the output's). A mapping that changes nothing shows it
  // letterboxed, as the output does, and every edit starts from that, so nothing jumps.
  const picAspect = PREVIEW_ASPECTS.find(a => a.id === previewAspect)?.ratio ?? aspect;
  const projection = displayProjection(saved ?? currentProjection(), picAspect, aspect);
  const canMap = useCan('play.projection');
  const [drawingMask, setDrawingMask] = useState<{ x: number; y: number }[] | null>(null);
  const selected = out.ui.selected && projection.surfaces.some(s => s.id === out.ui.selected) ? out.ui.selected : projection.surfaces[0]?.id ?? null;
  const surface = projection.surfaces.find(s => s.id === selected) ?? null;
  const [, bump] = useState(0);

  useEffect(() => { void refreshMonitors(); }, []);
  // Keep the selection valid (a surface deleted, a mapping loaded).
  useEffect(() => { if (selected !== out.ui.selected) setOutputUi({ selected }); }, [selected, out.ui.selected]);

  const edit = (next: ProjectionRecord) => { setProjection(next, projection); bump(n => n + 1); };
  const patchSurface = (patch: Partial<ProjSurface>) => {
    if (!surface) return;
    edit({ ...projection, surfaces: projection.surfaces.map(s => (s.id === surface.id ? { ...s, ...patch } : s)) });
  };

  const monitorOptions = out.monitors.map(m => ({ value: m.name, label: `${m.name} · ${m.width} × ${m.height}${m.primary ? ' (main)' : ''}` }));
  const status = !out.open ? 'Closed' : !out.connected ? 'Opening…' : out.status ? `Showing · ${out.status.width} × ${out.status.height} · ${out.status.fps} fps${out.status.fullscreen ? ' · full screen' : ''}` : 'Showing';

  const outputPx = out.status ? { w: out.status.width, h: out.status.height } : chosen ? { w: chosen.width, h: chosen.height } : { w: 1920, h: 1080 };

  return (
    <Modal
      title="Output and mapping"
      subtitle="The picture alone on a projector or second display, mapped onto surfaces"
      icon="grid"
      width={1240}
      height={800}
      onClose={onClose}
      headerActions={<>
        <IconButton icon="undo" label="Undo (⌘Z)" disabled={!mappingHistory.canUndo()} onClick={() => { undoMapping(); bump(n => n + 1); }} />
        <IconButton icon="redo" label="Redo (⇧⌘Z)" disabled={!mappingHistory.canRedo()} onClick={() => { redoMapping(); bump(n => n + 1); }} />
      </>}
    >
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* ── Left: the output, surfaces, masks, presets ── */}
        <div style={{ width: 280, flexShrink: 0, overflowY: 'auto', padding: '14px 14px 20px', borderRight: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Section title="Output" extra={<ProBadgeFor feature="play.output" />}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: tk.text.muted }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: out.connected ? tk.status.success : out.open ? tk.status.warning : tk.border.strong }} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status}</span>
            </div>
            {monitorOptions.length > 0 ? (
              <Row label="Display">
                <Select ariaLabel="Display" value={chosen?.name ?? ''} options={monitorOptions} onChange={v => { void moveOutputTo(v); }} style={{ flex: 1 }} />
                <IconButton icon="reset" label="Look for displays again" size="sm" onClick={() => { void refreshMonitors(); }} />
              </Row>
            ) : (
              <div style={{ color: tk.text.faint, lineHeight: 1.45 }}>
                {isDesktopApp() ? 'No displays found yet.' : 'The output opens as a window: drag it onto the projector, then press F there for full screen.'}
                {!isDesktopApp() && 'getScreenDetails' in window && <> <button type="button" onClick={() => { void refreshMonitors(); }} style={linkStyle(tk.accent.text)}>Find my screens</button></>}
              </div>
            )}
            {isDesktopApp() && <Toggle checked={out.display.fullscreen} onChange={v => { void setOutputFullscreen(v); }} label="Full screen on that display" />}
            <div style={{ display: 'flex', gap: 8 }}>
              {out.open
                ? <Button size="sm" icon="close" onClick={() => { void closeOutput(); }}>Close output</Button>
                : <Button size="sm" variant="primary" icon="popout" onClick={() => { void openOutput(); }}>Open output window<ProBadgeFor feature="play.output" /></Button>}
            </div>
            {out.source === 'snapshot' && <div style={{ color: tk.text.muted, lineHeight: 1.45 }}>Showing the Stage’s Present canvas. Leave the Stage to go back to this Play.</div>}
            {out.notes.map(n => <div key={n} style={{ color: tk.status.warningText, lineHeight: 1.45 }}>{n}</div>)}
          </Section>

          <Section title="On the output">
            <Toggle checked={out.ui.edit} onChange={v => setOutputUi({ edit: v })} label="Show handles (H)" />
            <Row label="Pattern">
              <Select ariaLabel="Test pattern" value={out.ui.pattern} options={TEST_PATTERNS.map(p => ({ value: p.id, label: p.label }))} onChange={v => setOutputUi({ pattern: v as TestPattern })} style={{ flex: 1 }} />
            </Row>
          </Section>

          <Section title="Surfaces" extra={<ProBadgeFor feature="play.projection" />}>
            {projection.surfaces.map(s => (
              <ListRow key={s.id} selected={s.id === selected} onClick={() => setOutputUi({ selected: s.id })}
                warn={!isConvexQuad(s.corners) ? 'The corners cross over: drag them back into order' : undefined}
                left={<Toggle checked={s.enabled} onChange={v => { if (canMap) edit({ ...projection, surfaces: projection.surfaces.map(x => (x.id === s.id ? { ...x, enabled: v } : x)) }); }} />}
                label={s.name}
                right={<>
                  <IconButton icon="copy" label="Duplicate" size="sm" onClick={e => { e.stopPropagation(); if (!requireFeature('play.projection')) return; const c: ProjSurface = { ...s, id: newId('surf'), name: `${s.name} copy`, corners: s.corners.map(q => ({ x: q.x + 0.03, y: q.y + 0.03 })) as ProjQuad }; edit({ ...projection, surfaces: [...projection.surfaces, c] }); setOutputUi({ selected: c.id }); }} />
                  <IconButton icon="trash" label="Delete" size="sm" tone="danger" disabled={projection.surfaces.length <= 1} onClick={e => { e.stopPropagation(); if (canMap) edit({ ...projection, surfaces: projection.surfaces.filter(x => x.id !== s.id) }); }} />
                </>}
              />
            ))}
            <Button size="sm" icon="plus" onClick={() => {
              if (!requireFeature('play.projection')) return;
              const n = projection.surfaces.length;
              const k = 0.2 + 0.05 * (n % 4);
              const s = newSurface(`Surface ${n + 1}`, [{ x: k, y: k }, { x: 1 - k, y: k }, { x: 1 - k, y: 1 - k }, { x: k, y: 1 - k }]);
              edit({ ...projection, surfaces: [...projection.surfaces, s] });
              setOutputUi({ selected: s.id });
            }}>Add surface</Button>
          </Section>

          <Section title="Masks">
            {projection.masks.length === 0 && !drawingMask && <div style={{ color: tk.text.faint, lineHeight: 1.45 }}>Black out part of the output: a doorway, a window, a spill onto the ceiling.</div>}
            {projection.masks.map(m => (
              <ListRow key={m.id} label={m.name}
                left={<Toggle checked={m.enabled} onChange={v => { if (canMap) edit({ ...projection, masks: projection.masks.map(x => (x.id === m.id ? { ...x, enabled: v } : x)) }); }} />}
                right={<>
                  <IconButton icon="bidir" label={m.invert ? 'Blacks out the outside (click: the inside)' : 'Blacks out the inside (click: the outside)'} active={m.invert} size="sm" onClick={() => { if (canMap) edit({ ...projection, masks: projection.masks.map(x => (x.id === m.id ? { ...x, invert: !x.invert } : x)) }); }} />
                  <IconButton icon="trash" label="Delete" size="sm" tone="danger" onClick={() => { if (canMap) edit({ ...projection, masks: projection.masks.filter(x => x.id !== m.id) }); }} />
                </>}
              />
            ))}
            {drawingMask
              ? <div style={{ color: tk.accent.text, lineHeight: 1.45 }}>Click the mask’s corners on the preview. Enter or a click on the first point finishes; Esc cancels. ({drawingMask.length} points)</div>
              : <Button size="sm" icon="mask" onClick={() => { if (requireFeature('play.projection')) setDrawingMask([]); }}>Draw a mask</Button>}
          </Section>

          <Presets projection={projection} onLoad={p => edit(p)} />
        </div>

        {/* ── Middle: the preview ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: tk.bg.render }}>
          <Preview
            projection={projection}
            aspect={aspect}
            outputPx={outputPx}
            selected={selected}
            pattern={out.ui.pattern}
            canEdit={canMap}
            drawingMask={drawingMask}
            setDrawingMask={setDrawingMask}
            onFinishMask={pts => {
              setDrawingMask(null);
              if (pts.length < 3) return;
              edit({ ...projection, masks: [...projection.masks, { id: newId('mask'), name: `Mask ${projection.masks.length + 1}`, enabled: true, points: pts, invert: false }] });
            }}
          />
          <div style={{ padding: '8px 14px', color: alpha('#ffffff', 0.55), font: `11.5px ${fontFamily.ui}`, borderTop: `1px solid ${alpha('#ffffff', 0.06)}` }}>
            Drag corners (and mesh points) · drag inside the selected surface to move it · arrows nudge 1 px, Shift 10 · ⌘Z undo. The preview shows the whole picture on every surface; the output shows each surface’s own source.
          </div>
        </div>

        {/* ── Right: the selected surface ── */}
        <div style={{ width: 290, flexShrink: 0, overflowY: 'auto', padding: '14px 14px 20px', borderLeft: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {surface ? <SurfaceSettings surface={surface} patch={patchSurface} disabled={!canMap} /> : <div style={{ color: tk.text.faint }}>No surface selected.</div>}
        </div>
      </div>
    </Modal>
  );
}

const linkStyle = (color: string) => ({ border: 0, background: 'none', padding: 0, color, cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }) as const;

function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: tk.text.faint, font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}{extra}</div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 70, flexShrink: 0, color: tk.text.muted }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

function ListRow({ label, left, right, selected, onClick, warn }: { label: string; left?: ReactNode; right?: ReactNode; selected?: boolean; onClick?: () => void; warn?: string }) {
  const tk = useTokens();
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px 5px 8px', borderRadius: radius.md, cursor: onClick ? 'pointer' : 'default', background: selected ? tk.bg.selected : tk.bg.field }}>
      <span onClick={e => e.stopPropagation()}>{left}</span>
      <span title={warn} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: warn ? tk.status.warningText : tk.text.primary, fontWeight: selected ? 600 : 500 }}>{label}{warn ? ' ⚠' : ''}</span>
      {right}
    </div>
  );
}

function Slider({ label, value, min, max, step = 0.01, onChange, disabled, integer }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; disabled?: boolean; integer?: boolean }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ color: tk.text.muted }}>{label}</span>
      <RulerSlider value={value} min={min} max={max} step={step} integer={integer} onChange={onChange} ariaLabel={label} disabled={disabled} />
    </div>
  );
}

function SurfaceSettings({ surface: s, patch, disabled }: { surface: ProjSurface; patch: (p: Partial<ProjSurface>) => void; disabled: boolean }) {
  const tk = useTokens();
  const layers = useNodeGraphStore(st => st.play.layers);
  const groups = useNodeGraphStore(st => st.play.groups);
  const sourceValue = s.source.kind === 'layer' || s.source.kind === 'group' ? `${s.source.kind}:${s.source.id}` : s.source.kind;
  const sourceOptions = [
    { value: 'picture', label: 'The whole picture' },
    { value: 'shader', label: 'The shader only' },
    { value: 'layers', label: 'The layers only' },
    ...layers.filter(l => l.kind !== 'background').map(l => ({ value: `layer:${l.id}`, label: l.label || l.kind, group: 'One layer' })),
    ...(groups ?? []).map(g => ({ value: `group:${g.id}`, label: g.label, group: 'A group' })),
  ];
  const setSource = (v: string) => {
    const [kind, ...rest] = v.split(':');
    const id = rest.join(':');
    const src: SurfaceSource = kind === 'layer' || kind === 'group' ? { kind, id } : { kind: kind as 'picture' | 'shader' | 'layers' };
    patch({ source: src });
  };
  const r = s.region, b = s.blend;
  return (
    <>
      <Section title="Surface">
        <Field value={s.name} onChange={e => patch({ name: e.target.value.slice(0, 80) })} aria-label="Surface name" disabled={disabled} />
        <Row label="Shows"><Select ariaLabel="What this surface shows" value={sourceValue} options={sourceOptions} onChange={setSource} style={{ flex: 1 }} /></Row>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" disabled={disabled} onClick={() => patch({ corners: fullQuad() })}>Fill the output</Button>
          <Button size="sm" disabled={disabled} onClick={() => patch({ corners: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }] })}>Inset</Button>
        </div>
      </Section>

      <Section title="Part of the picture">
        <Slider label="Left" value={r.x} min={0} max={0.99} disabled={disabled} onChange={x => patch({ region: { ...r, x, w: Math.min(r.w, 1 - x) } })} />
        <Slider label="Top" value={r.y} min={0} max={0.99} disabled={disabled} onChange={y => patch({ region: { ...r, y, h: Math.min(r.h, 1 - y) } })} />
        <Slider label="Width" value={r.w} min={0.01} max={1 - r.x} disabled={disabled} onChange={w => patch({ region: { ...r, w } })} />
        <Slider label="Height" value={r.h} min={0.01} max={1 - r.y} disabled={disabled} onChange={h => patch({ region: { ...r, h } })} />
      </Section>

      <Section title="Mesh warp">
        <Toggle checked={s.mesh.on} disabled={disabled} onChange={on => patch({ mesh: { ...s.mesh, on } })} label="Bend with a grid of points" />
        {s.mesh.on && <>
          <Row label="Points">
            <Select ariaLabel="Mesh size" value={`${s.mesh.cols}`} options={Array.from({ length: MESH_MAX - MESH_MIN + 1 }, (_, i) => ({ value: `${i + MESH_MIN}`, label: `${i + MESH_MIN} × ${i + MESH_MIN}` }))}
              onChange={v => { const n = Number(v); patch({ mesh: { ...s.mesh, cols: n, rows: n, points: meshGrid(n, n) } }); }} style={{ flex: 1 }} />
          </Row>
          <Segmented size="sm" ariaLabel="Between the points" value={s.mesh.interp} onChange={interp => patch({ mesh: { ...s.mesh, interp } })} options={[
            { value: 'smooth', label: 'Smooth', title: 'A curve through the points: domes, columns, curved screens' },
            { value: 'linear', label: 'Straight', title: 'Straight between the points: folded or faceted surfaces' },
          ]} />
          <Button size="sm" disabled={disabled} onClick={() => patch({ mesh: { ...s.mesh, points: meshGrid(s.mesh.cols, s.mesh.rows) } })}>Reset the mesh</Button>
        </>}
      </Section>

      <Section title="Edge blend">
        <div style={{ color: tk.text.faint, lineHeight: 1.45 }}>Feather the edges that overlap another projector’s.</div>
        <Slider label="Left" value={b.left} min={0} max={0.5} disabled={disabled} onChange={left => patch({ blend: { ...b, left } })} />
        <Slider label="Right" value={b.right} min={0} max={0.5} disabled={disabled} onChange={right => patch({ blend: { ...b, right } })} />
        <Slider label="Top" value={b.top} min={0} max={0.5} disabled={disabled} onChange={top => patch({ blend: { ...b, top } })} />
        <Slider label="Bottom" value={b.bottom} min={0} max={0.5} disabled={disabled} onChange={bottom => patch({ blend: { ...b, bottom } })} />
        <Slider label="Curve" value={b.curve} min={1} max={4} disabled={disabled} onChange={curve => patch({ blend: { ...b, curve } })} />
        <Slider label="Projector gamma" value={b.gamma} min={1} max={3} disabled={disabled} onChange={gamma => patch({ blend: { ...b, gamma } })} />
      </Section>

      <Section title="Light">
        <Slider label="Brightness" value={s.brightness} min={0} max={2} disabled={disabled} onChange={brightness => patch({ brightness })} />
        <Slider label="Gamma" value={s.gamma} min={0.2} max={3} disabled={disabled} onChange={gamma => patch({ gamma })} />
      </Section>
    </>
  );
}

function Presets({ projection, onLoad }: { projection: ProjectionRecord; onLoad: (p: ProjectionRecord) => void }) {
  const tk = useTokens();
  const [list, setList] = useState<ProjectionPreset[]>(() => loadPresets());
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const save = () => {
    if (!requireFeature('play.projection')) return;
    const p: ProjectionPreset = { id: newId('preset'), name: name.trim() || `Mapping ${list.length + 1}`, venue: venue.trim(), savedAt: Date.now(), projection };
    const next = [p, ...list];
    setList(next); savePresets(next); setName('');
  };
  return (
    <Section title="Presets">
      <div style={{ color: tk.text.faint, lineHeight: 1.45 }}>Kept on this computer, for a venue or a projector. The mapping itself saves with this Play.</div>
      <Field placeholder="Name" value={name} onChange={e => setName(e.target.value)} height={30} />
      <Field placeholder="Venue or projector" value={venue} onChange={e => setVenue(e.target.value)} height={30} />
      <Button size="sm" icon="save" onClick={save}>Save as preset</Button>
      {list.map(p => (
        <ListRow key={p.id} label={p.venue ? `${p.name} · ${p.venue}` : p.name}
          right={<>
            <Button size="sm" variant="ghost" onClick={() => { if (requireFeature('play.projection')) onLoad(p.projection); }}>Load</Button>
            <IconButton icon="trash" label="Delete preset" size="sm" tone="danger" onClick={() => { const next = list.filter(x => x.id !== p.id); setList(next); savePresets(next); }} />
          </>}
        />
      ))}
      <Button size="sm" variant="ghost" onClick={() => { if (requireFeature('play.projection')) onLoad(defaultProjection()); }}>Start over (one surface)</Button>
    </Section>
  );
}

// ── The preview ─────────────────────────────────────────────────────────────

function Preview({ projection, aspect, outputPx, selected, pattern, canEdit, drawingMask, setDrawingMask, onFinishMask }: {
  projection: ProjectionRecord; aspect: number; outputPx: { w: number; h: number }; selected: string | null; pattern: TestPattern; canEdit: boolean;
  drawingMask: { x: number; y: number }[] | null; setDrawingMask: (p: { x: number; y: number }[] | null) => void; onFinishMask: (p: { x: number; y: number }[]) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const hRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  // The newest props for the draw loop and the handlers, without restarting them.
  const live = useRef({ projection, selected, pattern, drawingMask, active: null as HandleRef | null });
  const drag = useRef<{ ref: HandleRef; before: ProjectionRecord; last: { x: number; y: number }; moved: boolean; relative: boolean } | null>(null);
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) mappingHistory.push(d.before);
  };
  useEffect(() => {
    const L = live.current;
    L.projection = projection; L.selected = selected; L.pattern = pattern; L.drawingMask = drawingMask;
  });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const size = useMemo(() => {
    const pad = 24, w = Math.max(10, box.w - pad * 2), h = Math.max(10, box.h - pad * 2);
    return w / h > aspect ? { w: Math.round(h * aspect), h: Math.round(h) } : { w: Math.round(w), h: Math.round(w / aspect) };
  }, [box, aspect]);

  // The draw loop: every frame while the preview can be seen, the app's live picture (a canvas the
  // render loop refreshes each time it draws, so it is never a stale or cleared frame) warped onto
  // the surfaces, then the handles over it. Hidden (the tab, or scrolled away), it rests.
  useEffect(() => {
    const gl = glRef.current, hc = hRef.current;
    if (!gl || !hc) return;
    const warp = new WarpRenderer(gl);
    const picture = playOverlay.acquirePicture();
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round(gl.clientWidth * dpr)), H = Math.max(1, Math.round(gl.clientHeight * dpr));
      if (gl.width !== W || gl.height !== H) { gl.width = W; gl.height = H; }
      if (hc.width !== W || hc.height !== H) { hc.width = W; hc.height = H; }
      const pic = picture.canvas.width > 0 && picture.canvas.height > 0 ? picture.canvas : null;
      const L = live.current;
      warp.render(L.projection, { shader: pic, layers: null, finished: pic, surfaceLayers: () => pic }, L.pattern, L.selected);
      const x = hc.getContext('2d')!;
      x.clearRect(0, 0, W, H);
      drawHandles(x, L.projection, L.selected, drag.current?.ref ?? L.active, W, H, dpr);
      if (L.drawingMask && L.drawingMask.length) {
        x.save(); x.strokeStyle = '#f5c542'; x.lineWidth = 2 * dpr; x.setLineDash([5 * dpr, 4 * dpr]);
        x.beginPath(); L.drawingMask.forEach((q, i) => (i ? x.lineTo(q.x * W, q.y * H) : x.moveTo(q.x * W, q.y * H))); x.stroke();
        x.fillStyle = '#f5c542'; for (const q of L.drawingMask) { x.beginPath(); x.arc(q.x * W, q.y * H, 4 * dpr, 0, Math.PI * 2); x.fill(); }
        x.restore();
      }
    };
    const loop = new FrameLoop(draw);
    const unwatch = watchVisible(gl, v => loop.setVisible(v));
    loop.start();
    return () => { unwatch(); loop.stop(); picture.release(); warp.dispose(); };
  }, []);

  const unit = (e: { clientX: number; clientY: number }) => {
    const r = hRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / Math.max(1, r.width), y: (e.clientY - r.top) / Math.max(1, r.height) };
  };

  // Keys while the dialog is open: arrows nudge, ⌘Z / ⇧⌘Z, H handles on the output, Enter / Esc for a mask being drawn.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const L = live.current;
      if (L.drawingMask) {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onFinishMask(L.drawingMask); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDrawingMask(null); return; }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redoMapping(); else undoMapping(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 'h') { setOutputUi({ edit: !useOutput.getState().ui.edit }); return; }
      const step = arrowStep(e.key, e.shiftKey, outputPx.w, outputPx.h);
      if (!step || !canEdit) return;
      const ref: HandleRef | null = L.active ?? (L.selected ? { kind: 'surface', surfaceId: L.selected } : null);
      if (!ref) return;
      e.preventDefault(); e.stopPropagation();
      setProjection(nudge(L.projection, ref, step.dx, step.dy), L.projection);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [outputPx.w, outputPx.h, canEdit, onFinishMask, setDrawingMask]);

  return (
    <div ref={boxRef} style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: size.w, height: size.h, boxShadow: '0 0 0 1px rgba(255,255,255,0.12)' }}>
        <canvas ref={glRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        <canvas
          ref={hRef}
          aria-label="The output: drag the handles to map the picture"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', cursor: drawingMask ? 'crosshair' : 'default', touchAction: 'none' }}
          onPointerDown={e => {
            const u = unit(e);
            const L = live.current;
            if (L.drawingMask) {
              const first = L.drawingMask[0];
              const r = hRef.current!.getBoundingClientRect();
              if (first && L.drawingMask.length >= 3 && Math.hypot((first.x - u.x) * r.width, (first.y - u.y) * r.height) < 10) { onFinishMask(L.drawingMask); return; }
              setDrawingMask([...L.drawingMask, u]);
              return;
            }
            if (!canEdit) { requireFeature('play.projection'); return; }
            const r = hRef.current!.getBoundingClientRect();
            const ref = hitTest(L.projection, L.selected, u.x, u.y, r.width, r.height);
            L.active = ref && ref.kind !== 'surface' && ref.kind !== 'maskBody' ? ref : null;
            const sid = surfaceOf(ref);
            if (sid && sid !== L.selected) setOutputUi({ selected: sid });
            if (!ref) return;
            // A handle grabbed at the edge (it sits outside the preview) follows the pointer's movement, not its place.
            const spot = handlesOf(L.projection, L.selected).find(h => sameRef(h.ref, ref));
            const relative = !!spot && isOffView(spot.x, spot.y);
            drag.current = { ref, before: L.projection, last: u, moved: false, relative };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            const d = drag.current;
            if (!d) return;
            const u = unit(e);
            const p = live.current.projection;
            const next = d.ref.kind === 'surface' || d.ref.kind === 'maskBody' || d.relative ? nudge(p, d.ref, u.x - d.last.x, u.y - d.last.y) : moveHandle(p, d.ref, u.x, u.y);
            d.last = u; d.moved = true;
            live.current.projection = next;
            setProjection(next);
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
    </div>
  );
}
