/**
 * mappingEdit.ts — editing a projection mapping by its handles, shared by the
 * output window (drag on the projector itself) and the Mapping editor's
 * preview: which handles there are, which one a click hits, moving one,
 * nudging with the arrow keys, drawing them, and undo.
 */
import type { ProjectionRecord, ProjMask, ProjPoint, ProjQuad, ProjSurface } from '../types/projection';
import { apply, outputToSquare, pointInPolygon, squareToQuad, surfacePoint } from './warp';

export type HandleRef =
  | { kind: 'corner'; surfaceId: string; index: number }
  | { kind: 'mesh'; surfaceId: string; index: number }
  | { kind: 'mask'; maskId: string; index: number }
  /** The whole surface (grabbed inside it): all four corners move. */
  | { kind: 'surface'; surfaceId: string }
  | { kind: 'maskBody'; maskId: string };

export interface Handle { ref: HandleRef; x: number; y: number }

export function sameRef(a: HandleRef | null, b: HandleRef | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  const ia = 'index' in a ? a.index : -1, ib = 'index' in b ? b.index : -1;
  const ka = 'surfaceId' in a ? a.surfaceId : a.maskId, kb = 'surfaceId' in b ? b.surfaceId : b.maskId;
  return ia === ib && ka === kb;
}

/**
 * The handles to show: every enabled surface's corners, the selected
 * surface's mesh points (when its mesh is on), and every mask's points.
 */
export function handlesOf(p: ProjectionRecord, selected: string | null): Handle[] {
  const out: Handle[] = [];
  for (const m of p.masks) if (m.enabled) m.points.forEach((q, index) => out.push({ ref: { kind: 'mask', maskId: m.id, index }, x: q.x, y: q.y }));
  for (const s of p.surfaces) {
    if (!s.enabled) continue;
    if (s.id === selected && s.mesh.on) {
      const H = squareToQuad(s.corners);
      s.mesh.points.forEach((q, index) => { const o = apply(H, q.x, q.y); out.push({ ref: { kind: 'mesh', surfaceId: s.id, index }, x: o.x, y: o.y }); });
    }
    s.corners.forEach((q, index) => out.push({ ref: { kind: 'corner', surfaceId: s.id, index }, x: q.x, y: q.y }));
  }
  return out;
}

/**
 * What a press at output point (x, y) takes hold of, within `radius` pixels of
 * a handle (W × H the view's size). Corners win over mesh points; missing every
 * handle, the selected surface's body (or a mask's) moves as a whole.
 */
export function hitTest(p: ProjectionRecord, selected: string | null, x: number, y: number, W: number, H: number, radius = 14): HandleRef | null {
  let best: HandleRef | null = null, bestD = radius * radius;
  const hs = handlesOf(p, selected);
  // Later handles are drawn on top: check them first so a tie goes to what's seen.
  for (let i = hs.length - 1; i >= 0; i--) {
    const h = hs[i];
    const dx = (h.x - x) * W, dy = (h.y - y) * H;
    const d = dx * dx + dy * dy;
    const bias = h.ref.kind === 'corner' ? 0.8 : 1;
    if (d * bias < bestD) { bestD = d * bias; best = h.ref; }
  }
  if (best) return best;
  const sel = p.surfaces.find(s => s.id === selected && s.enabled);
  if (sel && pointInPolygon(outline(sel, 8), x, y)) return { kind: 'surface', surfaceId: sel.id };
  for (let i = p.masks.length - 1; i >= 0; i--) { const m = p.masks[i]; if (m.enabled && pointInPolygon(m.points, x, y)) return { kind: 'maskBody', maskId: m.id }; }
  for (let i = p.surfaces.length - 1; i >= 0; i--) { const s = p.surfaces[i]; if (s.enabled && pointInPolygon(outline(s, 8), x, y)) return { kind: 'surface', surfaceId: s.id }; }
  return null;
}

/** A surface's edge in output space (mesh bends included), `n` points a side. */
export function outline(s: ProjSurface, n = 16): ProjPoint[] {
  const H = squareToQuad(s.corners);
  const pts: ProjPoint[] = [];
  const side = (u0: number, v0: number, u1: number, v1: number) => { for (let i = 0; i < n; i++) { const t = i / n; pts.push(surfacePoint(s, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, H)); } };
  side(0, 0, 1, 0); side(1, 0, 1, 1); side(1, 1, 0, 1); side(0, 1, 0, 0);
  return pts;
}

const mapSurface = (p: ProjectionRecord, id: string, fn: (s: ProjSurface) => ProjSurface): ProjectionRecord => ({ ...p, surfaces: p.surfaces.map(s => (s.id === id ? fn(s) : s)) });
const mapMask = (p: ProjectionRecord, id: string, fn: (m: ProjMask) => ProjMask): ProjectionRecord => ({ ...p, masks: p.masks.map(m => (m.id === id ? fn(m) : m)) });

/** Move one handle to output point (x, y). A mesh point goes where the corner pin puts (x, y) back in its square. */
export function moveHandle(p: ProjectionRecord, ref: HandleRef, x: number, y: number): ProjectionRecord {
  switch (ref.kind) {
    case 'corner':
      return mapSurface(p, ref.surfaceId, s => ({ ...s, corners: s.corners.map((c, i) => (i === ref.index ? { x, y } : c)) as ProjQuad }));
    case 'mask':
      return mapMask(p, ref.maskId, m => ({ ...m, points: m.points.map((c, i) => (i === ref.index ? { x, y } : c)) }));
    case 'mesh':
      return mapSurface(p, ref.surfaceId, s => {
        const q = outputToSquare(s.corners, x, y);
        if (!q) return s;
        return { ...s, mesh: { ...s.mesh, points: s.mesh.points.map((c, i) => (i === ref.index ? q : c)) } };
      });
    default:
      return p;
  }
}

/** Move what `ref` holds by (dx, dy) in output space: a handle, a whole surface or a whole mask. */
export function nudge(p: ProjectionRecord, ref: HandleRef, dx: number, dy: number): ProjectionRecord {
  const by = (c: ProjPoint) => ({ x: c.x + dx, y: c.y + dy });
  switch (ref.kind) {
    case 'surface': return mapSurface(p, ref.surfaceId, s => ({ ...s, corners: s.corners.map(by) as ProjQuad }));
    case 'maskBody': return mapMask(p, ref.maskId, m => ({ ...m, points: m.points.map(by) }));
    case 'corner': case 'mask': {
      const h = handlesOf(p, 'surfaceId' in ref ? ref.surfaceId : null).find(x => sameRef(x.ref, ref));
      return h ? moveHandle(p, ref, h.x + dx, h.y + dy) : p;
    }
    case 'mesh': {
      const h = handlesOf(p, ref.surfaceId).find(x => sameRef(x.ref, ref));
      return h ? moveHandle(p, ref, h.x + dx, h.y + dy) : p;
    }
  }
}

/** The arrow keys: 1 pixel, 10 with Shift, in a W × H output. Null for any other key. */
export function arrowStep(key: string, shift: boolean, W: number, H: number): { dx: number; dy: number } | null {
  const px = shift ? 10 : 1;
  switch (key) {
    case 'ArrowLeft': return { dx: -px / W, dy: 0 };
    case 'ArrowRight': return { dx: px / W, dy: 0 };
    case 'ArrowUp': return { dx: 0, dy: -px / H };
    case 'ArrowDown': return { dx: 0, dy: px / H };
    default: return null;
  }
}

/** The surface a handle belongs to (to select it when grabbed). */
export function surfaceOf(ref: HandleRef | null): string | null {
  return ref && 'surfaceId' in ref ? ref.surfaceId : null;
}

// ── Drawing the handles (a 2D canvas over the picture) ─────────────────────

const BLUE = '#5b8cff', AMBER = '#f5c542';

export function drawHandles(ctx: CanvasRenderingContext2D, p: ProjectionRecord, selected: string | null, active: HandleRef | null, W: number, H: number, dpr = 1): void {
  ctx.save();
  ctx.lineWidth = 1.5 * dpr;
  for (const s of p.surfaces) {
    if (!s.enabled) continue;
    const sel = s.id === selected;
    ctx.strokeStyle = sel ? BLUE : 'rgba(255,255,255,0.55)';
    ctx.setLineDash(sel ? [] : [6 * dpr, 4 * dpr]);
    ctx.beginPath();
    outline(s, s.mesh.on ? 24 : 1).forEach((q, i) => (i ? ctx.lineTo(q.x * W, q.y * H) : ctx.moveTo(q.x * W, q.y * H)));
    ctx.closePath(); ctx.stroke();
    if (sel && s.mesh.on) {
      // The mesh's lines, so the grid being bent can be seen.
      const Hm = squareToQuad(s.corners);
      ctx.strokeStyle = 'rgba(91,140,255,0.45)'; ctx.setLineDash([]);
      const P = s.mesh.points.map(q => apply(Hm, q.x, q.y));
      for (let j = 0; j < s.mesh.rows; j++) { ctx.beginPath(); for (let i = 0; i < s.mesh.cols; i++) { const q = P[j * s.mesh.cols + i]; if (i) ctx.lineTo(q.x * W, q.y * H); else ctx.moveTo(q.x * W, q.y * H); } ctx.stroke(); }
      for (let i = 0; i < s.mesh.cols; i++) { ctx.beginPath(); for (let j = 0; j < s.mesh.rows; j++) { const q = P[j * s.mesh.cols + i]; if (j) ctx.lineTo(q.x * W, q.y * H); else ctx.moveTo(q.x * W, q.y * H); } ctx.stroke(); }
    }
    // The name at the top-left corner.
    ctx.setLineDash([]);
    ctx.font = `${12 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = sel ? BLUE : 'rgba(255,255,255,0.7)';
    ctx.fillText(s.name, s.corners[0].x * W + 8 * dpr, s.corners[0].y * H + 18 * dpr);
  }
  for (const m of p.masks) {
    if (!m.enabled) continue;
    ctx.strokeStyle = AMBER; ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.beginPath();
    m.points.forEach((q, i) => (i ? ctx.lineTo(q.x * W, q.y * H) : ctx.moveTo(q.x * W, q.y * H)));
    ctx.closePath(); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const h of handlesOf(p, selected)) {
    const on = sameRef(h.ref, active);
    const r = (h.ref.kind === 'corner' ? 7 : 5) * dpr;
    ctx.beginPath(); ctx.arc(h.x * W, h.y * H, r, 0, Math.PI * 2);
    ctx.fillStyle = on ? '#ffffff' : h.ref.kind === 'mask' ? AMBER : h.ref.kind === 'mesh' ? 'rgba(91,140,255,0.9)' : BLUE;
    ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    if (h.ref.kind === 'corner' && ('surfaceId' in h.ref) && h.ref.surfaceId === selected) {
      // Corner crosshairs: exact alignment on the projector.
      ctx.strokeStyle = on ? '#ffffff' : BLUE; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(h.x * W - 18 * dpr, h.y * H); ctx.lineTo(h.x * W + 18 * dpr, h.y * H); ctx.moveTo(h.x * W, h.y * H - 18 * dpr); ctx.lineTo(h.x * W, h.y * H + 18 * dpr); ctx.stroke();
    }
  }
  ctx.restore();
}

// ── Undo ────────────────────────────────────────────────────────────────────

/** A mapping's undo and redo: a step per finished drag, nudge or setting. */
export class MappingHistory {
  private past: ProjectionRecord[] = [];
  private future: ProjectionRecord[] = [];
  private limit: number;
  constructor(limit = 100) { this.limit = limit; }
  /** Call with the mapping as it was before a change. */
  push(before: ProjectionRecord): void {
    if (this.past[this.past.length - 1] === before) return;
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(now: ProjectionRecord): ProjectionRecord | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(now);
    return prev;
  }
  redo(now: ProjectionRecord): ProjectionRecord | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(now);
    return next;
  }
  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }
  clear(): void { this.past = []; this.future = []; }
}
