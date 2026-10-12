/**
 * SceneViewport — the 3D Scene Builder's centre (docs/scene-builder-3d.md, "The viewport"): the
 * scene Build will make, compiled and drawn live, big, with the camera and the selected shape in
 * reach of the pointer.
 *
 *  - Drag the picture to turn the camera round (Angle and Elevation); scroll to come closer
 *    (Distance). Both write the Camera section's values: what you see is what Build makes.
 *  - Click a shape to pick it (viewMath.ts pickShape: each shape's own distance, placed as built).
 *  - The picked shape has a gizmo: its middle moves it across the picture, its X, Y and Z arrows
 *    along one axis, the square on its ring sizes it (every length together, as the linked size).
 *    A drag writes the same values as the sliders and is one undo step (store beginGesture).
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useSceneBuilder } from '../../sceneBuilder/store';
import { buildSceneGraph } from '../../sceneBuilder/build';
import { SHAPE_BY_KIND, allShapes, findItem, itemName, type ShapeSpec, type Vec3 } from '../../sceneBuilder/spec';
import {
  AXES, axisMove, cameraBasis, pickShape, planeMove, project, pxToUv, reachOf, scaleSize, shapeCenter, tidy, unitsPerUv, uvToPx, type CamBasis,
} from '../../sceneBuilder/viewMath';
import { compileSpec } from './previewGl';
import { DEPTH_VIEW_LABELS, useDepthView } from '../../builders/depthPreview';
import { useBuilderPreview, useThrottled } from '../builders/useBuilderPreview';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';

type Axis = 'x' | 'y' | 'z';
type Drag =
  | { kind: 'orbit'; x: number; y: number; angle: number; elev: number; moved: boolean }
  | { kind: 'move' | 'axis' | 'size'; axis?: Axis; id: string; x: number; y: number; b: CamBasis; p: Vec3; z: number; at: Vec3; size: ShapeSpec['size']; cx: number; cy: number; moved: boolean };

const AXIS_COLOUR: Record<Axis, string> = { x: '#f2555a', y: '#46c27a', z: '#4d8dff' };
const chip = { background: 'rgba(13,13,18,0.72)', color: '#e8e8f0', borderRadius: 8, font: `500 11.5px ${fontFamily.ui}`, padding: '4px 9px' } as const;

/** What a drag says while it runs. */
function readout(d: Drag, sh: ShapeSpec | null): string {
  if (d.kind === 'orbit') return '';
  if (!sh) return '';
  if (d.kind === 'size') {
    const k = Object.keys(sh.size)[0];
    const now = k ? sh.size[k] : undefined, was = k ? d.size[k] : undefined;
    const f = typeof now === 'number' && typeof was === 'number' && was ? now / was : Array.isArray(now) && Array.isArray(was) && was[0] ? now[0] / was[0] : 1;
    return `size ×${tidy(f)}`;
  }
  return `at (${sh.at.map(v => tidy(v)).join(', ')})`;
}

export function SceneViewport({ onPicked }: { onPicked?: (id: string) => void }) {
  const tk = useTokens();
  const spec = useSceneBuilder(s => s.spec);
  const selectedId = useSceneBuilder(s => s.selectedId);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clock = useRef(0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [paused, setPaused] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  // The picture: compiles follow a drag (a compile every 50 ms at most; uniforms only when the shaders stay the same).
  const shown = useThrottled(spec);
  // The Picture with depth card's preview switch: the picture, the depth, the shaped depth… instead of the result.
  const view = useDepthView(s => (shown.depth ? s.view : 'result'));
  const heat = useDepthView(s => s.heat);
  const compiled = useMemo(() => compileSpec(shown, { view, heat }), [shown, view, heat]);
  const error = useBuilderPreview(canvasRef, compiled, paused, clock);
  // Build's warnings, a few times a second.
  const counted = useThrottled(spec, 300);
  const warnings = useMemo(() => { try { return buildSceneGraph(counted).warnings; } catch { return []; } }, [counted]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => { const r = el.getBoundingClientRect(); setBox(b => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height })); };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // An orbiting camera moves on its own: the gizmo follows it every frame.
  const [, tick] = useState(0);
  const orbiting = spec.camera.orbit !== 0 && !paused;
  useEffect(() => {
    if (!orbiting) return;
    let raf = 0;
    const f = () => { tick(n => (n + 1) % 1e6); raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [orbiting]);

  // Scroll: closer or further (Distance), one undo step a burst.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sb = useSceneBuilder.getState();
      const next = Math.min(50, Math.max(0.3, sb.spec.camera.dist * Math.exp(e.deltaY * 0.0015)));
      sb.edit(d => { d.camera.dist = tidy(next); }, 'cam:dist');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const { w, h } = box;
  const b = cameraBasis(spec.camera, clock.current);
  const sel = selectedId ? findItem(spec, selectedId)?.item : null;
  const shape = sel?.type === 'shape' && SHAPE_BY_KIND[sel.kind] ? sel : null;

  // The gizmo: where the picked shape is on the picture.
  const gizmo = (() => {
    if (!shape || !w || !h) return null;
    const P = shapeCenter(spec, shape);
    const pr = project(b, P);
    if (!pr) return null;
    const [cx, cy] = uvToPx(pr.uv, w, h);
    const pxPerUnit = (h / 2) / unitsPerUv(b, pr.z);
    const len = 64 / pxPerUnit;
    const ends = (Object.keys(AXES) as Axis[]).map(a => {
      const e = project(b, [P[0] + AXES[a][0] * len, P[1] + AXES[a][1] * len, P[2] + AXES[a][2] * len]);
      return e ? { a, p: uvToPx(e.uv, w, h) } : null;
    }).filter((x): x is { a: Axis; p: [number, number] } => !!x);
    const ring = Math.max(22, Math.min(Math.min(w, h) * 0.45, reachOf(shape) * pxPerUnit));
    return { P, z: pr.z, cx, cy, ends, ring };
  })();

  const rel = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startHandle = (kind: 'move' | 'axis' | 'size', axis?: Axis) => (e: RPointerEvent) => {
    if (!shape || !gizmo || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    boxRef.current?.setPointerCapture?.(e.pointerId);
    const { x, y } = rel(e);
    useSceneBuilder.getState().beginGesture();
    setDrag({ kind, axis, id: shape.id, x, y, b: cameraBasis(spec.camera, clock.current), p: gizmo.P, z: gizmo.z, at: [...shape.at] as Vec3, size: structuredClone(shape.size), cx: gizmo.cx, cy: gizmo.cy, moved: false });
  };

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    boxRef.current?.setPointerCapture?.(e.pointerId);
    const { x, y } = rel(e);
    setDrag({ kind: 'orbit', x, y, angle: spec.camera.angle, elev: spec.camera.elev, moved: false });
  };

  const onPointerMove = (e: RPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const { x, y } = rel(e);
    const dx = x - d.x, dy = y - d.y;
    const sb = useSceneBuilder.getState();
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 3) return;
      if (d.kind === 'orbit') sb.beginGesture();
      setDrag({ ...d, moved: true });
    }
    if (d.kind === 'orbit') {
      sb.edit(s => { s.camera.angle = tidy(d.angle - dx * 0.4); s.camera.elev = tidy(Math.max(-89, Math.min(89, d.elev + dy * 0.3))); });
      return;
    }
    const duv: [number, number] = [dx * 2 / h, -dy * 2 / h];
    sb.edit(s => {
      const it = findItem(s, d.id)?.item;
      if (it?.type !== 'shape') return;
      if (d.kind === 'move') {
        const m = planeMove(d.b, d.z, duv);
        it.at = [tidy(d.at[0] + m[0]), tidy(d.at[1] + m[1]), tidy(d.at[2] + m[2])];
      } else if (d.kind === 'axis' && d.axis) {
        const amt = axisMove(d.b, d.p, AXES[d.axis], duv);
        const i = 'xyz'.indexOf(d.axis);
        const at = [...d.at] as Vec3;
        at[i] = tidy(d.at[i] + amt);
        it.at = at;
      } else if (d.kind === 'size') {
        const r0 = Math.hypot(d.x - d.cx, d.y - d.cy), r1 = Math.hypot(x - d.cx, y - d.cy);
        if (r0 > 2) it.size = scaleSize(it.kind, d.size, Math.max(0.05, r1 / r0));
      }
    });
  };

  const onPointerUp = (e: RPointerEvent) => {
    const d = dragRef.current;
    setDrag(null);
    const sb = useSceneBuilder.getState();
    sb.endGesture();
    if (!d || d.moved || d.kind !== 'orbit' || !w || !h) return;
    // A click: pick the shape under the pointer.
    const { x, y } = rel(e);
    const hit = pickShape(sb.spec, cameraBasis(sb.spec.camera, clock.current), pxToUv(x, y, w, h));
    if (hit) { sb.select(hit.id); onPicked?.(hit.id); } else sb.select(null);
  };

  const shapes = allShapes(spec).length;
  const live = drag && drag.kind !== 'orbit' && drag.moved ? readout(drag, shape) : '';
  return (
    <div ref={boxRef} data-scene-viewport onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      style={{ position: 'relative', flex: 1, minHeight: 0, background: tk.bg.render, overflow: 'hidden', touchAction: 'none', cursor: drag?.kind === 'orbit' && drag.moved ? 'grabbing' : 'grab', userSelect: 'none' }}>
      <canvas ref={canvasRef} data-scene-preview aria-label="Live preview of the scene: drag to turn the camera, scroll to zoom, click a shape to pick it"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      {gizmo && (
        <svg data-scene-gizmo={shape!.id} width={w} height={h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <circle cx={gizmo.cx} cy={gizmo.cy} r={gizmo.ring} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1.25} strokeDasharray="4 4" />
          {gizmo.ends.map(({ a, p }) => (
            <g key={a}>
              <line x1={gizmo.cx} y1={gizmo.cy} x2={p[0]} y2={p[1]} stroke={AXIS_COLOUR[a]} strokeWidth={2.5} strokeLinecap="round" />
              <g data-gizmo-axis={a} style={{ pointerEvents: 'all', cursor: 'move' }} onPointerDown={startHandle('axis', a)}>
                <circle cx={p[0]} cy={p[1]} r={11} fill={AXIS_COLOUR[a]} stroke="rgba(0,0,0,0.35)" />
                <text x={p[0]} y={p[1] + 4} textAnchor="middle" fill="#fff" style={{ font: `700 11px ${fontFamily.ui}`, pointerEvents: 'none' }}>{a.toUpperCase()}</text>
              </g>
            </g>
          ))}
          <circle data-gizmo-move cx={gizmo.cx} cy={gizmo.cy} r={9} fill="rgba(255,255,255,0.92)" stroke="rgba(0,0,0,0.45)" strokeWidth={1.5}
            style={{ pointerEvents: 'all', cursor: 'move' }} onPointerDown={startHandle('move')} />
          <rect data-gizmo-size x={gizmo.cx + gizmo.ring * Math.SQRT1_2 - 7} y={gizmo.cy - gizmo.ring * Math.SQRT1_2 - 7} width={14} height={14} rx={3}
            fill="#ffd166" stroke="rgba(0,0,0,0.45)" style={{ pointerEvents: 'all', cursor: 'nesw-resize' }} onPointerDown={startHandle('size')} />
        </svg>
      )}
      {/* Labels and controls over the picture. */}
      <div style={{ position: 'absolute', left: 12, top: 12, display: 'flex', gap: 6, alignItems: 'center', pointerEvents: 'none', flexWrap: 'wrap', right: 120 }}>
        {view !== 'result' && (
          <button type="button" data-depth-view-chip={view} onPointerDown={e => e.stopPropagation()} onClick={() => useDepthView.getState().setView('result')} title="Showing a depth view: back to the result"
            style={{ ...chip, border: 0, cursor: 'pointer', pointerEvents: 'all', font: `600 11.5px ${fontFamily.ui}` }}>{DEPTH_VIEW_LABELS[view].label} ×</button>
        )}
        {shape && <span data-viewport-picked style={chip}>{itemName(spec, shape)}{live ? ` · ${live}` : ' · drag the arrows to move, the square to size'}</span>}
        {!shape && shapes > 0 && <span style={{ ...chip, color: '#b8b8c8' }}>Drag to turn the camera · scroll to zoom · click a shape to pick it</span>}
      </div>
      <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => setPaused(p => !p)} title={paused ? 'Play the preview' : 'Pause the preview'}
        style={{ position: 'absolute', right: 12, top: 12, height: 26, padding: '0 10px', border: 0, borderRadius: 8, background: 'rgba(13,13,18,0.72)', color: '#e8e8f0', font: `600 11.5px ${fontFamily.ui}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon name={paused ? 'play' : 'pause'} size={12} />{paused ? 'Play' : 'Pause'}
      </button>
      {shapes === 0 && (
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 13, color: '#b8b8c8', textAlign: 'center', maxWidth: 320, pointerEvents: 'none' }}>
          Nothing to see yet: add a shape under Shapes, pick a preset below, or press Surprise me.
        </span>
      )}
      <div style={{ position: 'absolute', left: 12, bottom: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', pointerEvents: 'none' }}>
        {warnings.slice(0, 3).map((x, i) => (
          <span key={i} style={{ ...chip, color: '#f9e2af', display: 'flex', gap: 6, alignItems: 'flex-start', maxWidth: 560 }}><Icon name="warning" size={13} style={{ flexShrink: 0, marginTop: 1 }} />{x}</span>
        ))}
        <span data-viewport-status style={{ ...chip, color: '#9a9aae' }}>{error ? 'The preview could not draw this scene.' : `Live: the graph Build makes · compiled in ${Math.round(compiled.ms)} ms`}</span>
      </div>
      {error && (
        <div style={{ position: 'absolute', inset: 0, padding: 16, overflow: 'auto', color: '#f38ba8', font: `500 11px ${fontFamily.mono}`, background: 'rgba(13,13,18,0.86)', pointerEvents: 'none' }}>{error}</div>
      )}
    </div>
  );
}

