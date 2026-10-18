/**
 * SplatViewport — the Splat builder's centre (docs/splat-builder.md, "The viewport"): the main preview, mirrored and
 * big (the scan is drawn by its raster pass; every change is already in the graph), with the camera and the scan
 * in reach of the pointer. The 3D Scene Builder's viewport maths (sceneBuilder/viewMath.ts: March Camera's own).
 *
 *  - Drag the picture to turn the camera round (Angle, Elevation); scroll to come closer (Distance).
 *  - In Place, the scan has a gizmo: its middle moves it across the picture, X / Y / Z along one axis, the yellow
 *    square on its ring sizes it and the X / Y / Z rings turn it round that axis. Each drag is one undo step.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import { LiveViewport, type ViewRect } from '../builders/studio/LiveViewport';
import { useSplatBuilder } from '../../splatBuilder/store';
import { AXES, axisMove, cameraBasis, planeMove, project, unitsPerUv, uvToPx, type CamBasis } from '../../sceneBuilder/viewMath';
import { keepMiddle, scanCenter, scanReach, turnAbout, type ScanBox } from '../../splatBuilder/place';
import { splatEngine } from '../../lib/splats/engine';
import { clockNow } from '../../lib/timeTick';
import { fontFamily } from '../../theme/tokens';
import type { CameraSpec, PlaceSpec, Vec3 } from '../../splatBuilder/spec';

type Axis = 'x' | 'y' | 'z';
type Drag =
  | { kind: 'orbit'; x: number; y: number; angle: number; elev: number; moved: boolean }
  | { kind: 'move' | 'axis' | 'size' | 'turn'; axis?: Axis; x: number; y: number; b: CamBasis; p: Vec3; z: number; place: PlaceSpec; cx: number; cy: number; moved: boolean; facing?: number };

const AXIS_COLOUR: Record<Axis, string> = { x: '#f2555a', y: '#46c27a', z: '#4d8dff' };
const chip = { background: 'rgba(13,13,18,0.72)', color: '#e8e8f0', borderRadius: 8, font: `500 11.5px ${fontFamily.ui}`, padding: '4px 9px' } as const;
const tidy = (v: number) => Math.round(v * 1000) / 1000;

/** What the engine knows about the scan (its box), for the gizmo and Fit. */
export function useScanBox(scanId: string | null): ScanBox | null {
  const sub = useMemo(() => (fn: () => void) => splatEngine.onChange(fn), []);
  const key = useSyncExternalStore(sub, () => {
    const info = scanId ? splatEngine.status(scanId).info : undefined;
    return info ? JSON.stringify({ center: info.center, radius: info.radius, coreMin: info.coreMin, coreMax: info.coreMax }) : '';
  });
  return useMemo(() => (key ? JSON.parse(key) as ScanBox : null), [key]);
}

/** What the engine knows about a scan's box now (for actions that run on a click: Surprise me). */
export function scanBoxNow(scanId: string | null): ScanBox | null {
  const info = scanId ? splatEngine.status(scanId).info : undefined;
  return info ? { center: info.center, radius: info.radius, coreMin: info.coreMin, coreMax: info.coreMax } : null;
}

/** The builder's camera as the 3D viewport maths takes it. */
export const camOf = (c: CameraSpec) => ({ dist: c.dist, angle: c.angle, elev: c.elev, orbit: c.turntable, zoom: c.fov, flatten: 0, x: c.target[0], y: c.target[1], z: c.target[2] });

function Overlay({ image }: { image: ViewRect }) {
  const spec = useSplatBuilder(s => s.spec);
  const section = useSplatBuilder(s => s.section);
  const targetId = useSplatBuilder(s => s.targetId);
  const box = useScanBox(targetId);
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  // A turning camera moves on its own: the gizmo follows it.
  const [, tick] = useState(0);
  const turning = spec.camera.turntable !== 0;
  useEffect(() => {
    if (!turning) return;
    let raf = 0;
    const f = () => { tick(n => (n + 1) % 1e6); raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [turning]);

  // Scroll: closer or further (Distance), one undo step a burst.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sb = useSplatBuilder.getState();
      const next = Math.min(60, Math.max(0.3, sb.spec.camera.dist * Math.exp(e.deltaY * 0.0015)));
      sb.edit(d => { d.camera.dist = tidy(next); }, 'cam:dist');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const { w, h } = image;
  const t = clockNow() ?? 0;
  const b = cameraBasis(camOf(spec.camera), t);
  const showGizmo = section === 'place' && w > 0 && h > 0;
  const gizmo = (() => {
    if (!showGizmo) return null;
    const P = scanCenter(spec.place, box);
    const pr = project(b, P);
    if (!pr) return null;
    const [cx0, cy0] = uvToPx(pr.uv, w, h);
    const cx = cx0 + image.x, cy = cy0 + image.y;
    const pxPerUnit = (h / 2) / unitsPerUv(b, pr.z);
    const len = 70 / pxPerUnit;
    const ends = (Object.keys(AXES) as Axis[]).map(a => {
      const e = project(b, [P[0] + AXES[a][0] * len, P[1] + AXES[a][1] * len, P[2] + AXES[a][2] * len]);
      if (!e) return null;
      const [ex, ey] = uvToPx(e.uv, w, h);
      return { a, p: [ex + image.x, ey + image.y] as [number, number] };
    }).filter((x): x is { a: Axis; p: [number, number] } => !!x);
    const ring = Math.max(26, Math.min(Math.min(w, h) * 0.45, scanReach(spec.place, box) * pxPerUnit));
    // A turning ring round each axis, drawn as the circle (in the plane across that axis) projects.
    const rw = (ring * 0.78) / pxPerUnit;
    const rings = (Object.keys(AXES) as Axis[]).map(a => {
      const i = 'xyz'.indexOf(a), u = [0, 0, 0] as number[], v2 = [0, 0, 0] as number[];
      u[(i + 1) % 3] = 1; v2[(i + 2) % 3] = 1;
      const pts: string[] = [];
      for (let k = 0; k <= 48; k++) {
        const t = (k / 48) * Math.PI * 2, cs = Math.cos(t) * rw, sn = Math.sin(t) * rw;
        const e = project(b, [P[0] + u[0] * cs + v2[0] * sn, P[1] + u[1] * cs + v2[1] * sn, P[2] + u[2] * cs + v2[2] * sn]);
        if (!e) return null;
        const [ex, ey] = uvToPx(e.uv, w, h);
        pts.push(`${(ex + image.x).toFixed(1)},${(ey + image.y).toFixed(1)}`);
      }
      // Which way round a turn looks: +1 when the axis points at the camera (counter-clockwise on screen).
      const facing = -(AXES[a][0] * b.fwd[0] + AXES[a][1] * b.fwd[1] + AXES[a][2] * b.fwd[2]) >= 0 ? 1 : -1;
      return { a, pts: pts.join(' '), facing };
    }).filter((x): x is { a: Axis; pts: string; facing: number } => !!x);
    return { P, z: pr.z, cx, cy, ends, ring, rings };
  })();

  const rel = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startHandle = (kind: 'move' | 'axis' | 'size' | 'turn', axis?: Axis) => (e: RPointerEvent) => {
    if (!gizmo || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    ref.current?.setPointerCapture?.(e.pointerId);
    const { x, y } = rel(e);
    useSplatBuilder.getState().beginGesture();
    const facing = kind === 'turn' && axis ? gizmo.rings.find(r => r.a === axis)?.facing ?? 1 : 1;
    setDrag({ kind, axis, x, y, b: cameraBasis(camOf(spec.camera), clockNow() ?? 0), p: gizmo.P, z: gizmo.z, place: structuredClone(spec.place), cx: gizmo.cx, cy: gizmo.cy, moved: false, facing });
  };

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    ref.current?.setPointerCapture?.(e.pointerId);
    const { x, y } = rel(e);
    setDrag({ kind: 'orbit', x, y, angle: spec.camera.angle, elev: spec.camera.elev, moved: false });
  };

  const onPointerMove = (e: RPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const { x, y } = rel(e);
    const dx = x - d.x, dy = y - d.y;
    const sb = useSplatBuilder.getState();
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
      if (d.kind === 'move') {
        const m = planeMove(d.b, d.z, duv);
        s.place.position = [tidy(d.place.position[0] + m[0]), tidy(d.place.position[1] + m[1]), tidy(d.place.position[2] + m[2])];
      } else if (d.kind === 'axis' && d.axis) {
        const amt = axisMove(d.b, d.p, AXES[d.axis], duv);
        const i = 'xyz'.indexOf(d.axis);
        const at = [...d.place.position] as Vec3;
        at[i] = tidy(d.place.position[i] + amt);
        s.place.position = at;
      } else if (d.kind === 'size') {
        const r0 = Math.hypot(d.x - d.cx, d.y - d.cy), r1 = Math.hypot(x - d.cx, y - d.cy);
        if (r0 > 2) s.place = keepMiddle(d.place, box, { scale: tidy(Math.max(0.01, d.place.scale * r1 / r0)) });
      } else if (d.kind === 'turn' && d.axis) {
        // The pointer's angle round the gizmo's middle, counter-clockwise on screen, then the axis's way round.
        const a0 = Math.atan2(-(d.y - d.cy), d.x - d.cx), a1 = Math.atan2(-(y - d.cy), x - d.cx);
        let deg = (a1 - a0) * 180 / Math.PI;
        if (deg > 180) deg -= 360; else if (deg < -180) deg += 360;
        s.place = turnAbout(d.place, box, 'xyz'.indexOf(d.axis) as 0 | 1 | 2, tidy(deg * (d.facing ?? 1)));
      }
    });
  };

  const onPointerUp = () => {
    setDrag(null);
    useSplatBuilder.getState().endGesture();
  };

  const live = drag && drag.kind !== 'orbit' && drag.moved
    ? drag.kind === 'size' ? `scale ${tidy(spec.place.scale)}` : drag.kind === 'turn' ? `turned ${spec.place.rotation.map(tidy).join(', ')}°` : `at (${spec.place.position.map(tidy).join(', ')})`
    : '';
  return (
    <div ref={ref} data-splat-viewport onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: drag?.kind === 'orbit' && drag.moved ? 'grabbing' : 'grab', userSelect: 'none' }}>
      {gizmo && (
        <svg data-splat-gizmo width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
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
          {gizmo.rings.map(r => (
            <g key={r.a} data-gizmo-ring={r.a} style={{ pointerEvents: 'all', cursor: 'grab' }} onPointerDown={startHandle('turn', r.a)}>
              <polyline points={r.pts} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: 'stroke' }} />
              <polyline points={r.pts} fill="none" stroke={AXIS_COLOUR[r.a]} strokeOpacity={drag?.kind === 'turn' && drag.axis === r.a ? 1 : 0.7} strokeWidth={drag?.kind === 'turn' && drag.axis === r.a ? 3 : 1.75} style={{ pointerEvents: 'none' }} />
            </g>
          ))}
        </svg>
      )}
      <div style={{ position: 'absolute', left: 12, top: 12, display: 'flex', gap: 6, alignItems: 'center', pointerEvents: 'none', flexWrap: 'wrap', right: 12 }}>
        <span data-viewport-hint style={chip}>
          {showGizmo ? (live ? `The scan · ${live}` : 'Arrows move the scan, the square sizes it, the rings turn it') : 'Drag to turn the camera · scroll to zoom'}
        </span>
      </div>
    </div>
  );
}

export function SplatViewport() {
  return (
    <LiveViewport emptyNote="The preview is hidden: show it to see the scan here." ownSize clock
      overlay={({ image }) => <Overlay image={image} />} />
  );
}
