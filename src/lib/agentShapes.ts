/**
 * agentShapes.ts — Draw agents' Shapes in 3D (docs/particle-shapes.md): every walker drawn as a solid
 * cube, sphere, rod, tile or voxel instead of a soft dot, with a depth buffer so shapes hide each other
 * (and a ray-marched scene's Depth hides them). The settings, the maths the shaders share with the
 * tests (voxel snap, the dedupe grid, how many are drawn), the cost note, and the GLSL. Pure: the
 * THREE side is agentShapeRenderer.ts.
 *
 * How it draws (vertex pulling, like the Splats look): one draw call over an empty geometry with
 * V × shapes vertices; the vertex shader takes gl_VertexID / V as the shape and gl_VertexID % V as the
 * corner, and reads the walker from the state texture with texelFetch. That is instancing without
 * the attribute plumbing (and without a second geometry kind in the runner): every shape kind is a
 * shader variant over the same empty geometry the points, streaks and splats already use.
 *
 * Fewest vertices:
 *  - boxes (Cube, Rod, Voxel): 18 — only the three faces turned toward the camera (a convex box
 *    never shows more), so no back face is shaded or rasterised;
 *  - Tile: 6 (one quad, both sides);
 *  - Sphere, Impostor: 6 — a camera-facing quad shaded as a sphere, with its own depth;
 *  - Sphere, Low / Smooth: a hemisphere turned toward the camera (the half you can see), 8 × 3 or
 *    16 × 6 quads: 144 or 576 vertices.
 */
import { gpFade, gpPaletteGlsl } from '../play/kit/gpuParticles.js';
import { AG_CAM_GLSL } from '../play/kit/agentShaders.js';

export const SHAPES = ['dot', 'cube', 'sphere', 'rod', 'tile', 'voxel'] as const;
export type ShapeKind = typeof SHAPES[number];
export const SHADINGS = ['flat', 'faces', 'facesEdges', 'lit', 'litEdges'] as const;
export type Shading = typeof SHADINGS[number];
export const FACINGS = ['motion', 'tumble', 'aligned', 'camera'] as const;
export type Facing = typeof FACINGS[number];
export const SPHERE_DETAILS = ['impostor', 'low', 'smooth'] as const;
export type SphereDetail = typeof SPHERE_DETAILS[number];
/** Size by for shapes: the Splats' choices plus Age (shrinking to 15 % over its life). */
export const SHAPE_SIZE_BY = ['fixed', 'speed', 'age', 'memX', 'memY', 'memZ', 'memW'] as const;

/**
 * Draw agents' settings that only a Shape reads: left out of the engine's spec unless the group is
 * 3D and Shape isn't Dot, so every other drawing's spec is as it always was.
 */
export const SHAPE_ONLY = new Set([
  'shape', 'shading', 'shapeSize', 'shapeSizeBy', 'facing', 'spin', 'rodLength', 'rodStretch', 'voxelGrid', 'voxelDedupe',
  'sphereDetail', 'every', 'maxShapes', 'farDots', 'halfRes', 'ambient', 'rim', 'edgeWidth',
]);

export const SHAPE_DEFAULTS = {
  shape: 'dot', shading: 'faces', shapeSize: 0.012, shapeSizeBy: 'fixed', facing: 'motion', spin: 1, rodLength: 4, rodStretch: 0,
  voxelGrid: 0.04, voxelDedupe: 'on', sphereDetail: 'impostor', every: 1, maxShapes: 0, farDots: 0, halfRes: 'off',
  ambient: 0.3, rim: 0.35, edgeWidth: 0.12,
};

const pick = <T extends string>(v: unknown, all: readonly T[], d: T): T => (typeof v === 'string' && (all as readonly string[]).includes(v) ? v as T : d);
export const shapeOf = (v: unknown): ShapeKind => pick(v, SHAPES, 'dot');
export const shadingOf = (v: unknown): Shading => pick(v, SHADINGS, 'faces');
export const facingOf = (v: unknown): Facing => pick(v, FACINGS, 'motion');
export const sphereDetailOf = (v: unknown): SphereDetail => pick(v, SPHERE_DETAILS, 'impostor');
export const shapeSizeByIndex = (v: unknown): number => Math.max(0, (SHAPE_SIZE_BY as readonly unknown[]).indexOf(v));

/** The four geometry kinds the shaders come in. */
export type ShapeClass = 'box' | 'tile' | 'impostor' | 'sphere';
export function shapeClass(shape: ShapeKind, detail: SphereDetail): ShapeClass {
  if (shape === 'tile') return 'tile';
  if (shape === 'sphere') return detail === 'impostor' ? 'impostor' : 'sphere';
  return 'box';
}
/** A Low / Smooth sphere's hemisphere: segments round, rings from the pole to the rim. */
export const SPHERE_MESH: Record<'low' | 'smooth', { seg: number; rings: number }> = { low: { seg: 8, rings: 3 }, smooth: { seg: 16, rings: 6 } };
/** Vertices one shape costs (triangles × 3). */
export function shapeVertices(shape: ShapeKind, detail: SphereDetail = 'impostor'): number {
  const cls = shapeClass(shape, detail);
  if (cls === 'box') return 18;
  if (cls === 'sphere') { const m = SPHERE_MESH[detail === 'smooth' ? 'smooth' : 'low']; return m.seg * m.rings * 6; }
  return 6;
}

/**
 * Which walkers are drawn: every `every`-th, and fewer still (spread over all of them, not the first
 * ones) when Max shapes caps it. Returns the stride between drawn walkers and how many are drawn.
 */
export function shapeStride(n: number, every: number, maxShapes: number): { stride: number; drawn: number } {
  let stride = Math.max(1, Math.round(every) || 1);
  if (maxShapes >= 1) stride = Math.max(stride, Math.ceil(n / Math.floor(maxShapes)));
  return { stride, drawn: Math.max(0, Math.ceil(n / stride)) };
}

/**
 * Voxels: the grid is anchored at the 3D box's corner (−aspect, −1, −1) with cells `g` wide; a
 * walker's cell and the centre it snaps to. The shaders do the same sums (AG_SHAPE_CELL).
 */
export function voxelCell(p: readonly number[], g: number, aspect: number): [number, number, number] {
  const half = [aspect, 1, 1];
  return [0, 1, 2].map(i => Math.floor((p[i] + half[i]) / g)) as [number, number, number];
}
export function voxelSnap(p: readonly number[], g: number, aspect: number): [number, number, number] {
  const half = [aspect, 1, 1];
  return voxelCell(p, g, aspect).map((c, i) => (c + 0.5) * g - half[i]) as [number, number, number];
}
/** Smallest grid cell (the dedupe grid stays under 4096² texels). */
export const VOXEL_MIN_GRID = 0.01;
/**
 * The dedupe grid over the box for cells `g` wide: nx × ny × nz cells, the z-slices side by side,
 * `tiles` to a row, in an atlas of w × h texels (at most 4096 wide).
 */
export function voxelGrid(g: number, aspect: number): { nx: number; ny: number; nz: number; tiles: number; w: number; h: number } {
  const c = Math.max(VOXEL_MIN_GRID, g);
  const nx = Math.max(1, Math.ceil((2 * aspect) / c)), ny = Math.max(1, Math.ceil(2 / c)), nz = ny;
  const tiles = Math.max(1, Math.min(nz, Math.floor(4096 / nx)));
  return { nx, ny, nz, tiles, w: nx * tiles, h: ny * Math.ceil(nz / tiles) };
}
/** A cell's texel in the dedupe atlas, or null outside the box (such a walker is always drawn). */
export function voxelTexel(cell: readonly number[], grid: ReturnType<typeof voxelGrid>): [number, number] | null {
  const [x, y, z] = cell;
  if (x < 0 || y < 0 || z < 0 || x >= grid.nx || y >= grid.ny || z >= grid.nz) return null;
  return [(z % grid.tiles) * grid.nx + x, Math.floor(z / grid.tiles) * grid.ny + y];
}

/**
 * The cost note under Shape (docs/particle-shapes.md "Cost"): how many shapes, how many vertices,
 * roughly how long a frame of them takes on an M3 Pro at 1080p (measured, see the doc's table), and
 * amber past SHAPE_WARN_MS.
 */
/** Amber past this many ms a frame (about half a 60 fps frame). */
export const SHAPE_WARN_MS = 8;
/**
 * Measured GPU ms per million shapes (M3 Pro, Chrome, 1920 × 1080, walkers spread through the box at
 * Size 0.008; dev/shapesBench.ts, docs/particle-shapes.md): `base` for Flat, Faces and Lit (a box shades
 * once per face, per vertex, so they cost the same), `edges` with + edges, `lit` where Lit shades per
 * pixel (the impostor sphere).
 */
export const SHAPE_MS_PER_M: Record<ShapeClass | 'sphereSmooth', { base: number; edges: number; lit: number }> = {
  box: { base: 10.3, edges: 14.5, lit: 10.3 },
  tile: { base: 5.8, edges: 8, lit: 5.8 },
  impostor: { base: 10.1, edges: 10.1, lit: 11.4 },
  sphere: { base: 42, edges: 42, lit: 42 },
  sphereSmooth: { base: 140, edges: 140, lit: 140 },
};
/** Half resolution's measured share of the full-size cost (Lit cubes, 1M: 8.9 of 10.4 ms). */
export const SHAPE_HALF_RES = 0.86;
export interface ShapeCostInput {
  count: number; shape: ShapeKind; shading: Shading; sphereDetail?: SphereDetail; every?: number; maxShapes?: number; halfRes?: boolean;
}
export interface ShapeCost { drawn: number; vertices: number; ms: number; level: 'ok' | 'high'; text: string }
const LABELS: Record<ShapeKind, [string, string]> = {
  dot: ['dot', 'dots'], cube: ['cube', 'cubes'], sphere: ['sphere', 'spheres'], rod: ['rod', 'rods'], tile: ['tile', 'tiles'], voxel: ['voxel', 'voxels'],
};
const fmt = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));
export function shapeCost(o: ShapeCostInput): ShapeCost | null {
  if (o.shape === 'dot') return null;
  const detail = o.sphereDetail ?? 'impostor';
  const { drawn } = shapeStride(o.count, o.every ?? 1, o.maxShapes ?? 0);
  const v = shapeVertices(o.shape, detail);
  const cls = shapeClass(o.shape, detail);
  const r = SHAPE_MS_PER_M[cls === 'sphere' && detail === 'smooth' ? 'sphereSmooth' : cls];
  const rate = (o.shading === 'facesEdges' || o.shading === 'litEdges' ? r.edges : o.shading === 'lit' ? r.lit : r.base) * (o.halfRes ? SHAPE_HALF_RES : 1);
  const ms = (drawn / 1e6) * rate;
  const level = ms > SHAPE_WARN_MS ? 'high' : 'ok';
  const [one, many] = LABELS[o.shape];
  const msText = ms < 0.5 ? 'under ½ ms' : `about ${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
  const text = `Up to ${fmt(drawn)} ${drawn === 1 ? one : many} (${v} vertices each, ${fmt(drawn * v)} in all): ${msText} a frame on an M3 Pro at 1080p.`
    + (level === 'high' ? ' This could be expensive.' : '');
  return { drawn, vertices: v, ms, level, text };
}
export const SHAPE_COST_TIP = 'Flat or Faces shading (no edges) and a Max shapes cap keep it fast.';

/** Linear depth's far end (picture units): the shapes' depth buffer holds view depth / this. */
export const SHAPE_FAR = 128;

/**
 * The shading tiers on a unit normal `n` (R, U, F the camera's axes): Faces a fixed brightness per box
 * face (`boxFaces`; a sphere's by how far up it points), Lit a key light from above left of the camera
 * with Ambient and a Rim. Boxes, tiles and mesh spheres shade per vertex (a box face is flat, so this is
 * exact for them and costs no pixel work); only the impostor shades per pixel.
 */
const SHADE_GLSL = `vec3 agShade(vec3 c, vec3 n, vec3 R, vec3 U, vec3 F, bool boxFaces) {
#if SHADE == 1
  if (boxFaces) return c * (n.y > 0.5 ? 1.0 : n.y < -0.5 ? 0.45 : (abs(n.x) > abs(n.z) ? 0.8 : 0.64));
  return c * mix(0.45, 1.0, 0.5 + 0.5 * n.y);
#elif SHADE == 2
  vec3 L = normalize(-0.45 * R + 0.75 * U - 0.5 * F);
  float lam = max(dot(n, L), 0.0), k = 1.0 - clamp(dot(n, -F), 0.0, 1.0);
  return c * (u_ambient + (1.0 - u_ambient) * lam) + u_rim * k * k * k * mix(c, vec3(1.0), 0.5);
#else
  return c;
#endif
}`;

/** A walker's voxel cell in the box (both the claim pass and the shapes read it with these exact sums). */
const CELL_GLSL = `ivec3 agCell(vec3 p) { return ivec3(floor((p + u_boxHalf) / u_grid)); }
bool agCellIn(ivec3 c) { return all(greaterThanEqual(c, ivec3(0))) && all(lessThan(c, u_gridN)); }
ivec2 agCellTexel(ivec3 c) { return ivec2((c.z % u_tiles) * u_gridN.x + c.x, (c.z / u_tiles) * u_gridN.y + c.y); }`;

/**
 * The dedupe's claim pass (Voxel, One per cell): every drawn walker writes its index into its cell,
 * one point each, no blending: drawn in index order, the highest index in a cell stays (the GL keeps
 * primitive order). A voxel then draws only when it owns its cell. Every cell a walker reads this
 * frame was written this frame (by it, at least); the grid is cleared anyway, so no frame depends on
 * the last.
 */
export const AG_SHAPE_CLAIM_VERT = `precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform int u_side, u_stride, u_tiles;
uniform float u_grid;
uniform vec3 u_boxHalf;
uniform ivec3 u_gridN;
uniform vec2 u_atlas;
flat out float v_id;
${CELL_GLSL}
void main() {
  int id = gl_VertexID * u_stride;
  gl_PointSize = 1.0;
  v_id = float(id);
  if (id >= u_side * u_side) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  ivec2 t = ivec2(id % u_side, id / u_side);
  vec4 A = texelFetch(u_a, t, 0), B = texelFetch(u_b, t, 0);
  ivec3 c = agCell(A.xyz);
  if (B.w <= 0.0 || !agCellIn(c)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  gl_Position = vec4((vec2(agCellTexel(c)) + 0.5) / u_atlas * 2.0 - 1.0, 0.0, 1.0);
}`;
export const AG_SHAPE_CLAIM_FRAG = `precision highp float;
flat in float v_id;
out vec4 o;
void main() { o = vec4(v_id, 0.0, 0.0, 1.0); }`;

/** A shader variant: its geometry kind, shading, and whether it draws edges. */
export interface ShapeVariant { cls: ShapeClass; shading: Shading; detail: SphereDetail }
export const shapeVariantKey = (v: ShapeVariant) => `${v.cls}:${v.shading}${v.cls === 'sphere' ? `:${v.detail}` : ''}`;

function defines(v: ShapeVariant): string {
  const lit = v.shading === 'lit' || v.shading === 'litEdges';
  const shade = v.shading === 'flat' ? 0 : lit ? 2 : 1;
  const edges = (v.shading === 'facesEdges' || v.shading === 'litEdges') && (v.cls === 'box' || v.cls === 'tile') ? 1 : 0;
  const m = SPHERE_MESH[v.detail === 'smooth' ? 'smooth' : 'low'];
  const verts = v.cls === 'box' ? 18 : v.cls === 'sphere' ? m.seg * m.rings * 6 : 6;
  return [
    `#define CLS_${v.cls.toUpperCase()} 1`, `#define SHADE ${shade}`, `#define EDGES ${edges}`, `#define V ${verts}`,
    `#define SEG ${m.seg}`, `#define RINGS ${m.rings}`, `#define SHAPE_FAR ${SHAPE_FAR.toFixed(1)}`,
  ].join('\n');
}

/**
 * The shapes' vertex shader. Per shape: the walker (dead ones and those outside the picture culled),
 * its colour (the Splats look's Colour by and palette), its size (Size × Size by × fade with age),
 * its place (Voxel: snapped to the grid, and skipped unless it owns its cell when deduped), the
 * camera (the built-in one, or a scene's rebuilt from its probe as AG_SPLAT_VERT does), its axes
 * (Facing), then the corner. Far ones (Distant as dots) are a screen square of their size instead.
 * Depth is linear (view depth / SHAPE_FAR), interpolated with the true perspective w.
 */
function vert(v: ShapeVariant): string {
  return `${defines(v)}
precision highp float;
precision highp int;
uniform highp sampler2D u_a;
uniform highp sampler2D u_b;
uniform highp sampler2D u_c;
uniform highp sampler2D u_e;
uniform highp sampler2D u_cam;
uniform highp sampler2D u_owner;
uniform int u_side, u_species, u_colorBy, u_fade, u_usePal, u_rainbow, u_stateC, u_stateE, u_camSrc, u_sizeBy, u_stride, u_facing, u_voxel, u_dedupe, u_tiles;
uniform float u_aspect, u_bright, u_speedRef, u_size, u_rodLen, u_rodStretch, u_spin, u_time, u_grid, u_far, u_ambient, u_rim;
uniform vec3 u_colA, u_colB;
uniform vec3 u_pal[4];
uniform vec2 u_viewSize;
uniform vec3 u_eye, u_fwd, u_right, u_up, u_boxHalf;
uniform ivec3 u_gridN;
uniform float u_lens, u_ortho, u_camDist;
uniform vec2 u_proj;
${AG_CAM_GLSL}
out vec3 v_col;
out vec3 v_n;
out vec4 v_face;
out vec3 v_q;
out float v_dist;
flat out float v_zc;
flat out float v_far;
flat out vec3 v_R;
flat out vec3 v_U;
flat out vec3 v_F;
${gpPaletteGlsl('agPalette', 'u_rainbow', 'u_pal')}
${CELL_GLSL}
${SHADE_GLSL}
float agHash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return float(x) / 4294967296.0; }
void agCull() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); v_col = vec3(0.0); v_n = vec3(0.0, 0.0, 1.0); v_face = vec4(0.0, 0.0, 1.0, 1.0); v_q = vec3(0.0); v_dist = 0.0; v_zc = 0.0; v_far = 0.0; v_R = vec3(1.0, 0.0, 0.0); v_U = vec3(0.0, 1.0, 0.0); v_F = vec3(0.0, 0.0, -1.0); }
mat3 agRot(vec3 a, float t) {
  float c = cos(t), s = sin(t), k = 1.0 - c;
  return mat3(c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
              a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s,
              a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k);
}
vec2 agCorner(int j) { return j == 0 || j == 3 ? vec2(-1.0, -1.0) : j == 1 ? vec2(1.0, -1.0) : j == 5 ? vec2(-1.0, 1.0) : vec2(1.0, 1.0); }
void main() {
  int inst = gl_VertexID / V;
  int k = gl_VertexID - inst * V;
  int id = inst * u_stride;
  if (id >= u_side * u_side) { agCull(); return; }
  ivec2 t = ivec2(id % u_side, id / u_side);
  vec4 A = texelFetch(u_a, t, 0), B = texelFetch(u_b, t, 0);
  if (B.w <= 0.0) { agCull(); return; }
  float age = B.w > 1.0e20 ? 0.0 : clamp(A.w / B.w, 0.0, 1.0);
  float fade = u_fade == 1 && B.w < 1.0e20 ? ${gpFade('age')} : 1.0;
  vec3 vel = B.xyz;
  float sp = length(vel);
  float kk = 0.0;
  vec4 C = u_stateC == 1 ? texelFetch(u_c, t, 0) : vec4(float(id % u_species), 0.0, 0.0, 16777215.0);
  if (u_colorBy == 1) kk = u_species > 1 ? C.x / float(u_species - 1) : 0.0;
  else if (u_colorBy == 2) kk = clamp(sp / max(u_speedRef, 1e-4), 0.0, 1.0);
  else if (u_colorBy == 3) kk = sp > 1e-9 ? 0.5 + 0.5 * B.x / sp : 0.5;
  else if (u_colorBy == 4) kk = age;
  else if (u_colorBy == 6) kk = 1.0 - clamp(sp / max(u_speedRef, 1e-4), 0.0, 1.0);
  else if (u_colorBy == 7) kk = fract(atan(vel.y, vel.x) / 6.2831853 + 0.5);
  vec3 c = u_usePal == 1 ? agPalette(kk) : mix(u_colA, u_colB, kk);
  if (u_colorBy == 5) {
    float bb = floor(C.w / 65536.0), gg = floor((C.w - bb * 65536.0) / 256.0);
    c = vec3(C.w - bb * 65536.0 - gg * 256.0, gg, bb) / 255.0;
  }
  // Size: Size × Size by, shrinking in and out with Fade with age.
  float fast = sp / max(u_speedRef, 1e-4);
  float f0 = fade;
  if (u_sizeBy == 1) f0 *= 0.35 + 0.65 * min(fast, 3.0);
  else if (u_sizeBy == 2) f0 *= mix(1.0, 0.15, age);
  else if (u_sizeBy >= 3) f0 *= u_stateE == 1 ? max(texelFetch(u_e, t, 0)[u_sizeBy - 3], 0.0) : 1.0;
  float s = u_size * f0;
  vec3 P = A.xyz;
  if (u_voxel == 1) {
    ivec3 cell = agCell(P);
    if (u_dedupe == 1 && agCellIn(cell) && texelFetch(u_owner, agCellTexel(cell), 0).r != float(id)) { agCull(); return; }
    P = (vec3(cell) + 0.5) * u_grid - u_boxHalf;
    s = 0.5 * u_grid * min(f0, 1.0);
  }
  if (!(s > 1e-6)) { agCull(); return; }
  // The camera: the built-in one, or a scene's from its probe.
  vec3 eye = u_eye, f = u_fwd, r = u_right, u = u_up;
  float lens = u_lens, cd = u_camDist, fl = clamp(u_ortho, 0.0, 1.0);
  // Perspective (Normal / Orthographic / Reverse, docs/camera-projections.md): the dots' own maths (AG_CAM_GLSL).
  vec2 proj = u_proj;
  if (u_camSrc == 1) {
    agSceneCam(u_cam, eye, f, r, u, lens, cd, proj);
    fl = 0.0;
  }
  v_R = r; v_U = u; v_F = f;
  // Its half sizes along its own axes (Rod: long along X).
  vec3 h = vec3(s);
#if defined(CLS_BOX)
  if (u_voxel == 0 && u_rodLen > 0.0) h.x = s * u_rodLen * (1.0 + max(u_rodStretch, 0.0) * min(fast, 4.0));
#elif defined(CLS_TILE)
  h.z = 0.0;
#endif
  float rad = length(h);
  vec3 d = P - eye;
  float z = dot(d, f);
  if (fl < 0.999 && z < 0.06 + rad) { agCull(); return; }
  float W = agCamW(z, cd, proj, fl);
  vec2 ndc = vec2(dot(d, r) / u_aspect, dot(d, u)) * lens / W;
  float m = 1.05 + rad * lens / W;
  if (abs(ndc.x) > m + 1.0 / u_aspect || abs(ndc.y) > m) { agCull(); return; }
  vec3 toEye = normalize(mix(-d, -f * cd, fl));
  v_col = c * u_bright;
  v_zc = z;
  v_q = vec3(0.0);
  v_face = vec4(0.0, 0.0, 1.0, 1.0);
  v_far = 0.0;
  vec3 pos = P, n = toEye;
  if (u_far > 0.0 && z > u_far) {
    // Distant as dots: a square of its size on the screen, at least a pixel and a half across.
    if (k >= 6) { agCull(); return; }
    float px = max(s * lens / W * 0.5 * u_viewSize.y, 0.75);
    v_far = 1.0; v_n = toEye; v_dist = length(d);
    gl_Position = vec4(ndc + agCorner(k) * px * 2.0 / u_viewSize, clamp(z / SHAPE_FAR, 0.0, 1.0) * 2.0 - 1.0, 1.0);
    return;
  }
#if defined(CLS_IMPOSTOR)
  // A camera-facing quad a little larger than the sphere (its outline grows in perspective).
  vec2 cq = agCorner(k) * 1.15;
  pos = P + (cq.x * r + cq.y * u) * s;
  v_q = vec3(cq, s);
#elif defined(CLS_SPHERE)
  // The hemisphere turned toward the camera: SEG × RINGS quads from the pole (facing it) to the rim.
  int tri = k / 3, cr = k - tri * 3;
  int q = tri / 2, half_ = tri - q * 2;
  int ring = q / SEG, seg = q - ring * SEG;
  ivec2 rc = half_ == 0 ? (cr == 0 ? ivec2(ring, seg) : cr == 1 ? ivec2(ring, seg + 1) : ivec2(ring + 1, seg + 1))
                        : (cr == 0 ? ivec2(ring, seg) : cr == 1 ? ivec2(ring + 1, seg + 1) : ivec2(ring + 1, seg));
  float th = float(rc.x) / float(RINGS) * 1.5707963, ph = float(rc.y) / float(SEG) * 6.2831853;
  vec3 t1 = normalize(abs(toEye.y) < 0.95 ? cross(toEye, vec3(0.0, 1.0, 0.0)) : cross(toEye, vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(toEye, t1);
  n = cos(th) * toEye + sin(th) * (cos(ph) * t1 + sin(ph) * t2);
  pos = P + n * s;
#else
  // Its axes (Facing): along its motion, tumbling, the world's, or the camera's.
  vec3 X = vec3(1.0, 0.0, 0.0), Y = vec3(0.0, 1.0, 0.0), Z = vec3(0.0, 0.0, 1.0);
  if (u_voxel == 0) {
    if (u_facing == 0) {
      X = sp > 1e-7 ? vel / sp : X;
      vec3 ref = abs(X.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      Z = normalize(cross(X, ref)); Y = cross(Z, X);
    } else if (u_facing == 1) {
      uint hs = uint(id) * 2654435761u + 1013904223u;
      vec3 ax = normalize(vec3(agHash(hs), agHash(hs ^ 0x9e3779b9u), agHash(hs ^ 0x85ebca6bu)) * 2.0 - 1.0 + vec3(1e-3, 2e-3, 3e-3));
      mat3 R = agRot(ax, agHash(hs ^ 0x27d4eb2fu) * 6.2831853 + u_time * u_spin * (0.5 + agHash(hs ^ 0x165667b1u)));
      X = R[0]; Y = R[1]; Z = R[2];
    } else if (u_facing == 3) { X = r; Y = u; Z = -f; }
  }
#if defined(CLS_TILE)
  vec2 cq = agCorner(k);
  pos = P + cq.x * h.x * X + cq.y * h.y * Y;
  n = dot(Z, toEye) >= 0.0 ? Z : -Z;
  v_face = vec4(cq.x * h.x, cq.y * h.y, h.x, h.y);
#else
  // The three faces toward the camera (a convex box never shows more): face k / 6 of axis X, Y or Z.
  int fi = k / 6;
  vec2 cq = agCorner(k - fi * 6);
  vec3 a = fi == 0 ? X : fi == 1 ? Y : Z, b = fi == 0 ? Y : fi == 1 ? Z : X, e = fi == 0 ? Z : fi == 1 ? X : Y;
  vec3 hh = fi == 0 ? h : fi == 1 ? h.yzx : h.zxy;
  float sg = dot(a, toEye) >= 0.0 ? 1.0 : -1.0;
  pos = P + sg * hh.x * a + cq.x * hh.y * b + cq.y * hh.z * e;
  n = sg * a;
  v_face = vec4(cq.x * hh.y, cq.y * hh.z, hh.y, hh.z);
#endif
#endif
  v_n = n;
#if !defined(CLS_IMPOSTOR)
  v_col = agShade(v_col, normalize(n), r, u, f, ${v.cls === 'box' || v.cls === 'tile'});
#endif
  vec3 dd = pos - eye;
  float zz = dot(dd, f), WW = agCamW(zz, cd, proj, fl);
  v_dist = length(dd);
  gl_Position = vec4(dot(dd, r) * lens / u_aspect, dot(dd, u) * lens, (clamp(zz / SHAPE_FAR, 0.0, 1.0) * 2.0 - 1.0) * WW, WW);
}`;
}

/**
 * The shapes' fragment shader: hidden behind a scene's Depth (u_depth); the colour arrives shaded (per
 * vertex, agShade) except on the impostor sphere, which shades its disc here and writes its own depth;
 * then Edges (a darker outline from the face's own coordinates).
 */
function frag(v: ShapeVariant): string {
  return `${defines(v)}
precision highp float;
uniform int u_depth;
uniform highp sampler2D u_field;
uniform vec2 u_viewSize;
uniform float u_ambient, u_rim, u_edgeW;
${SHADE_GLSL}
in vec3 v_col;
in vec3 v_n;
in vec4 v_face;
in vec3 v_q;
in float v_dist;
flat in float v_zc;
flat in float v_far;
flat in vec3 v_R;
flat in vec3 v_U;
flat in vec3 v_F;
layout(location = 0) out vec4 o;
void main() {
  vec3 n = v_n;
  float dist = v_dist;
#if defined(CLS_IMPOSTOR)
  if (v_far < 0.5) {
    float q2 = dot(v_q.xy, v_q.xy);
    if (q2 > 1.0) discard;
    float nz = sqrt(1.0 - q2);
    n = v_q.x * v_R + v_q.y * v_U - nz * v_F;
    dist -= v_q.z * nz;
    gl_FragDepth = clamp((v_zc - v_q.z * nz) / SHAPE_FAR, 0.0, 1.0);
  } else gl_FragDepth = gl_FragCoord.z;
#endif
  if (u_depth == 1 && dist > texture(u_field, gl_FragCoord.xy / u_viewSize).b) discard;
  vec3 c = v_col;
  if (v_far < 0.5) {
#if defined(CLS_IMPOSTOR)
    c = agShade(c, n, v_R, v_U, v_F, false);
#endif
#if EDGES == 1
    float ed = min(v_face.z - abs(v_face.x), v_face.w - abs(v_face.y));
    float w0 = u_edgeW * min(v_face.z, v_face.w), px = fwidth(ed);
    c *= mix(0.22, 1.0, smoothstep(w0 - px, w0 + px, ed));
#endif
  }
  o = vec4(c, 1.0);
}`;
}

export function shapeShaders(v: ShapeVariant): { vertex: string; fragment: string } {
  return { vertex: vert(v), fragment: frag(v) };
}

/** Every variant the renderer can ask for (the compile tests and the browser sweep). */
export function allShapeVariants(): ShapeVariant[] {
  const out: ShapeVariant[] = [];
  for (const cls of ['box', 'tile', 'impostor', 'sphere'] as const) {
    for (const shading of SHADINGS) {
      if (cls === 'sphere') for (const detail of ['low', 'smooth'] as const) out.push({ cls, shading, detail });
      else out.push({ cls, shading, detail: 'impostor' });
    }
  }
  return out;
}
