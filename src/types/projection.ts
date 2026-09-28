/**
 * projection.ts — projection mapping for the output window (docs/projection.md).
 *
 * A Play's mapping setup travels in its record (`play.projection`), so it is
 * saved with the graph and carried in .playfile; presets (per venue or
 * projector) are kept on this device.
 *
 * Coordinates:
 *   output space   0..1 across and down the output window (0,0 top left)
 *   picture space  0..1 across and down the finished picture (0,0 top left)
 *   surface space  0..1 across and down one surface (u, v), before its warp
 *
 * A surface takes a region of the picture (or only the shader, only the
 * layers, or one layer or group) and lays it on the output through a corner
 * pin (a perspective-correct quad), optionally bent further by a mesh (a grid
 * of points inside the corner pin), with feathered edges for overlapping
 * projectors, and its own brightness and gamma. Masks are polygons in output
 * space drawn black over everything.
 */

export const PROJECTION_VERSION = 2;

export interface ProjPoint { x: number; y: number }
/** Top left, top right, bottom right, bottom left. */
export type ProjQuad = [ProjPoint, ProjPoint, ProjPoint, ProjPoint];

/** What a surface shows. `layer`/`group`: only that layer, or the layers in that group. */
export type SurfaceSource =
  | { kind: 'picture' }
  | { kind: 'shader' }
  | { kind: 'layers' }
  | { kind: 'layer'; id: string }
  | { kind: 'group'; id: string };

export interface ProjMesh {
  on: boolean;
  /** Points across and down (2..8 each): a 4 × 4 mesh has 3 × 3 cells. */
  cols: number;
  rows: number;
  /** Row by row, top row first, in the corner pin's own square (0..1); identity is the even grid. */
  points: ProjPoint[];
  /** smooth: a spline through the points (curved projection surfaces); linear: straight between them. */
  interp: 'linear' | 'smooth';
}

/** Feathered edges for overlapping projectors: each side's width as a fraction of the surface (0 = none, up to 0.5). */
export interface ProjBlend {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** The ramp's shape: 1 straight, 2 an S-curve (the usual), up to 4. */
  curve: number;
  /** The projector's gamma the ramp is corrected for (2.2 typical; 1 = no correction). */
  gamma: number;
}

export interface ProjRegion { x: number; y: number; w: number; h: number }

export interface ProjSurface {
  id: string;
  name: string;
  enabled: boolean;
  corners: ProjQuad;
  mesh: ProjMesh;
  source: SurfaceSource;
  /** The part of the picture this surface shows (picture space). */
  region: ProjRegion;
  blend: ProjBlend;
  /** 0..2, 1 = as is. */
  brightness: number;
  /** 0.2..3, 1 = as is (above 1 lifts the mid tones). */
  gamma: number;
}

export interface ProjMask {
  id: string;
  name: string;
  enabled: boolean;
  /** The polygon, output space. */
  points: ProjPoint[];
  /** Invert: black out everything outside the polygon instead. */
  invert: boolean;
}

export interface ProjectionRecord {
  version: typeof PROJECTION_VERSION;
  surfaces: ProjSurface[];
  masks: ProjMask[];
}

export type TestPattern = 'none' | 'grid' | 'crosshair' | 'bars' | 'white';
export const TEST_PATTERNS: { id: TestPattern; label: string }[] = [
  { id: 'none', label: 'Picture' },
  { id: 'grid', label: 'Grid' },
  { id: 'crosshair', label: 'Crosshair' },
  { id: 'bars', label: 'Colour bars' },
  { id: 'white', label: 'White' },
];

export const MESH_MIN = 2;
export const MESH_MAX = 8;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const num = (v: unknown, fb: number, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fb);
const str = (v: unknown, fb: string, max = 80) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : fb);

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/** The corner pin that fills the output. */
export function fullQuad(): ProjQuad {
  return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
}

/** The even grid: a mesh that bends nothing. */
export function meshGrid(cols: number, rows: number): ProjPoint[] {
  const out: ProjPoint[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ x: i / (cols - 1), y: j / (rows - 1) });
  return out;
}

export function defaultMesh(): ProjMesh {
  return { on: false, cols: 4, rows: 4, points: meshGrid(4, 4), interp: 'smooth' };
}

export function defaultBlend(): ProjBlend {
  return { left: 0, right: 0, top: 0, bottom: 0, curve: 2, gamma: 2.2 };
}

export function newSurface(name = 'Surface 1', corners: ProjQuad = fullQuad()): ProjSurface {
  return {
    id: newId('surf'), name, enabled: true, corners,
    mesh: defaultMesh(), source: { kind: 'picture' }, region: { x: 0, y: 0, w: 1, h: 1 },
    blend: defaultBlend(), brightness: 1, gamma: 1,
  };
}

/** A new mapping: one surface filling the output, as if there were no mapping at all. */
export function defaultProjection(): ProjectionRecord {
  return { version: PROJECTION_VERSION, surfaces: [newSurface()], masks: [] };
}

/**
 * The corner pin that shows a picture of `pictureAspect` whole and undistorted
 * on an output of `outputAspect` (bars at the sides or top and bottom).
 */
export function fitQuad(pictureAspect: number, outputAspect: number): ProjQuad {
  if (!(pictureAspect > 0) || !(outputAspect > 0)) return fullQuad();
  let w = 1, h = 1;
  if (pictureAspect > outputAspect) h = outputAspect / pictureAspect; else w = pictureAspect / outputAspect;
  const x = (1 - w) / 2, y = (1 - h) / 2;
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

/**
 * What the output draws: the mapping, except that one that changes nothing
 * shows the picture letterboxed rather than stretched to the output's shape.
 */
export function displayProjection(p: ProjectionRecord, pictureAspect: number, outputAspect: number): ProjectionRecord {
  if (!isIdentityProjection(p)) return p;
  const s = p.surfaces.find(x => x.enabled)!;
  return { ...p, surfaces: p.surfaces.map(x => (x === s ? { ...s, corners: fitQuad(pictureAspect, outputAspect) } : x)) };
}

/** Does this mapping change anything (so the output can skip the warp pass's extra work)? */
export function isIdentityProjection(p: ProjectionRecord | undefined): boolean {
  if (!p) return true;
  if (p.masks.some(m => m.enabled)) return false;
  const on = p.surfaces.filter(s => s.enabled);
  if (on.length !== 1) return false;
  const s = on[0], q = fullQuad();
  return s.source.kind === 'picture' && !s.mesh.on && s.brightness === 1 && s.gamma === 1
    && s.region.x === 0 && s.region.y === 0 && s.region.w === 1 && s.region.h === 1
    && !s.blend.left && !s.blend.right && !s.blend.top && !s.blend.bottom
    && s.corners.every((c, i) => c.x === q[i].x && c.y === q[i].y);
}

// ── Reading (and migrating) a record from a file ────────────────────────────

function parsePoint(raw: unknown, fb: ProjPoint): ProjPoint {
  if (Array.isArray(raw) && raw.length >= 2) return { x: num(raw[0], fb.x, -4, 5), y: num(raw[1], fb.y, -4, 5) };
  const r = raw as Partial<ProjPoint> | null;
  if (!r || typeof r !== 'object') return fb;
  return { x: num(r.x, fb.x, -4, 5), y: num(r.y, fb.y, -4, 5) };
}

/** Points as objects, [x, y] pairs or one flat [x0, y0, x1, y1…] array (version 1 wrote flat arrays). */
function pointList(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length && raw.every(v => typeof v === 'number')) {
    const out: number[][] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) out.push([raw[i] as number, raw[i + 1] as number]);
    return out;
  }
  return raw;
}

function parseQuad(raw: unknown): ProjQuad {
  const pts = pointList(raw);
  const q = fullQuad();
  if (pts.length !== 4) return q;
  return [parsePoint(pts[0], q[0]), parsePoint(pts[1], q[1]), parsePoint(pts[2], q[2]), parsePoint(pts[3], q[3])];
}

function parseMesh(raw: unknown): ProjMesh {
  const d = defaultMesh();
  const r = raw as Partial<ProjMesh> & { size?: number } | null;
  if (!r || typeof r !== 'object') return d;
  // Version 1 had one `size` for both directions.
  const cols = Math.round(num(r.cols ?? r.size, d.cols, MESH_MIN, MESH_MAX));
  const rows = Math.round(num(r.rows ?? r.size, d.rows, MESH_MIN, MESH_MAX));
  const grid = meshGrid(cols, rows);
  const pts = pointList(r.points);
  const points = pts.length === grid.length ? grid.map((g, i) => parsePoint(pts[i], g)) : grid;
  return { on: r.on === true, cols, rows, points, interp: r.interp === 'linear' ? 'linear' : 'smooth' };
}

function parseSource(raw: unknown): SurfaceSource {
  const r = raw as { kind?: unknown; id?: unknown } | string | null;
  // Version 1 wrote the source as a word: 'picture', 'shader', 'layers' or 'layer:<id>'.
  if (typeof r === 'string') {
    if (r === 'shader' || r === 'layers') return { kind: r };
    if (r.startsWith('layer:') && r.length > 6) return { kind: 'layer', id: r.slice(6) };
    if (r.startsWith('group:') && r.length > 6) return { kind: 'group', id: r.slice(6) };
    return { kind: 'picture' };
  }
  if (!r || typeof r !== 'object') return { kind: 'picture' };
  if (r.kind === 'shader' || r.kind === 'layers') return { kind: r.kind };
  if ((r.kind === 'layer' || r.kind === 'group') && typeof r.id === 'string' && r.id) return { kind: r.kind, id: r.id };
  return { kind: 'picture' };
}

function parseRegion(raw: unknown): ProjRegion {
  const r = raw as Partial<ProjRegion> | null;
  if (!r || typeof r !== 'object') return { x: 0, y: 0, w: 1, h: 1 };
  const x = num(r.x, 0, 0, 0.99), y = num(r.y, 0, 0, 0.99);
  return { x, y, w: num(r.w, 1, 0.01, 1 - x), h: num(r.h, 1, 0.01, 1 - y) };
}

function parseBlend(raw: unknown): ProjBlend {
  const d = defaultBlend();
  const r = raw as Partial<ProjBlend> | null;
  if (!r || typeof r !== 'object') return d;
  return {
    left: num(r.left, 0, 0, 0.5), right: num(r.right, 0, 0, 0.5), top: num(r.top, 0, 0, 0.5), bottom: num(r.bottom, 0, 0, 0.5),
    curve: num(r.curve, d.curve, 1, 4), gamma: num(r.gamma, d.gamma, 1, 3),
  };
}

function parseSurface(raw: unknown, i: number): ProjSurface | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  return {
    id: str(r.id, newId('surf'), 60),
    name: str(r.name, `Surface ${i + 1}`),
    enabled: r.enabled !== false,
    corners: parseQuad(r.corners),
    mesh: parseMesh(r.mesh),
    source: parseSource(r.source),
    region: parseRegion(r.region),
    blend: parseBlend(r.blend),
    brightness: num(r.brightness, 1, 0, 2),
    gamma: num(r.gamma, 1, 0.2, 3),
  };
}

function parseMask(raw: unknown, i: number): ProjMask | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const points = pointList(r.points).slice(0, 64).map(p => parsePoint(p, { x: 0.5, y: 0.5 }));
  if (points.length < 3) return null;
  return { id: str(r.id, newId('mask'), 60), name: str(r.name, `Mask ${i + 1}`), enabled: r.enabled !== false, points, invert: r.invert === true };
}

/**
 * A mapping from a file (or a preset), tidied: bad entries dropped, numbers
 * clamped, ids made unique. Version 1 (flat point arrays, one mesh `size`,
 * the source as a word) is read too. Null when there is nothing usable.
 */
export function parseProjection(raw: unknown): ProjectionRecord | undefined {
  const r = raw as { version?: unknown; surfaces?: unknown; masks?: unknown } | null;
  if (!r || typeof r !== 'object') return undefined;
  const version = typeof r.version === 'number' ? r.version : 1;
  if (version > PROJECTION_VERSION) return undefined; // from a newer app: left alone rather than half-read
  const seen = new Set<string>();
  const unique = <T extends { id: string }>(x: T, prefix: string): T => {
    if (!seen.has(x.id)) { seen.add(x.id); return x; }
    const id = newId(prefix); seen.add(id); return { ...x, id };
  };
  const surfaces = (Array.isArray(r.surfaces) ? r.surfaces : []).slice(0, 16)
    .map(parseSurface).filter((s): s is ProjSurface => !!s).map(s => unique(s, 'surf'));
  const masks = (Array.isArray(r.masks) ? r.masks : []).slice(0, 32)
    .map(parseMask).filter((m): m is ProjMask => !!m).map(m => unique(m, 'mask'));
  if (!surfaces.length && !masks.length) return undefined;
  return { version: PROJECTION_VERSION, surfaces, masks };
}

// ── Presets (this device) ────────────────────────────────────────────────────

export interface ProjectionPreset {
  id: string;
  name: string;
  /** Where it was set up (a venue, a projector). */
  venue: string;
  savedAt: number;
  projection: ProjectionRecord;
}

export const PRESETS_KEY = 'playfield:projection-presets';

export function parsePresets(raw: unknown): ProjectionPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectionPreset[] = [];
  for (const x of raw.slice(0, 100)) {
    const r = x as Partial<ProjectionPreset> | null;
    const projection = r ? parseProjection(r.projection) : undefined;
    if (!r || !projection) continue;
    out.push({ id: str(r.id, newId('preset'), 60), name: str(r.name, 'Mapping'), venue: typeof r.venue === 'string' ? r.venue.slice(0, 80) : '', savedAt: num(r.savedAt, 0), projection });
  }
  return out;
}

export function loadPresets(): ProjectionPreset[] {
  try { return parsePresets(JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]')); } catch { return []; }
}

export function savePresets(list: ProjectionPreset[]): void {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch { /* storage full or blocked: presets stay in memory */ }
}
