/**
 * thumbnails.ts — small pictures of the Scene Builder's shapes for the gallery (docs/scene-builder.md,
 * "The shape gallery").
 *
 * A tiny CPU ray marcher: each shape's distance function (the same formulas as the 3D SDF
 * nodes, at the shape's default size), marched from a three-quarter view, shaded with one soft
 * light and drawn on a clear background, so a thumbnail reads the same on a light or a dark
 * theme. Pure (no DOM): `renderThumbnail` returns RGBA pixels; the gallery turns them into an
 * image once per shape and keeps it (components/sceneBuilder/ShapeGallery.tsx).
 *
 * Every shape in spec.ts SHAPES has an entry here (the tests check), so a new shape can't join
 * the registry without a picture.
 */
import { SHAPES, defaultSize, type ShapeDef, type Vec3 } from './spec';

type Sdf = (x: number, y: number, z: number) => number;

const len2 = (a: number, b: number) => Math.sqrt(a * a + b * b);
const len3 = (a: number, b: number, c: number) => Math.sqrt(a * a + b * b + c * c);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const rad = (d: number) => d * Math.PI / 180;

function box(x: number, y: number, z: number, b: Vec3): number {
  const dx = Math.abs(x) - b[0], dy = Math.abs(y) - b[1], dz = Math.abs(z) - b[2];
  return len3(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, Math.max(dy, dz)), 0);
}

const num = (s: Record<string, number | Vec3>, k: string) => Number(s[k]);
const v3 = (s: Record<string, number | Vec3>, k: string) => s[k] as Vec3;

/** A shape's distance at a size (its defaults, or a gallery variant's): the node formulas, sdf3d.ts. */
function makeSdf(def: ShapeDef, over: Record<string, number | Vec3> = {}): Sdf {
  const s = { ...defaultSize(def.kind), ...over };
  switch (def.kind) {
    case 'sphere': { const r = num(s, 'r'); return (x, y, z) => len3(x, y, z) - r; }
    case 'box': { const b = v3(s, 'size'); const r = num(s, 'round'); const bb: Vec3 = [b[0] - r, b[1] - r, b[2] - r]; return (x, y, z) => box(x, y, z, bb) - r; }
    case 'torus': { const R = num(s, 'R'), r = num(s, 'r'); return (x, y, z) => len2(len2(x, z) - R, y) - r; }
    case 'cone': {
      const a = rad(num(s, 'angle')), h = num(s, 'h');
      const wx = h * Math.tan(a), wy = h;
      return (x, y, z) => {
        const qx = len2(x, z), qy = y;
        const t = clamp((qx * wx + qy * wy) / (wx * wx + wy * wy), 0, 1);
        const ax = qx - wx * t, ay = qy - wy * t;
        const bx = qx - wx * clamp(qx / wx, 0, 1), by = qy - wy;
        const d2 = Math.min(ax * ax + ay * ay, bx * bx + by * by);
        const sv = Math.max(qx * wy - qy * wx, qy - wy);
        return Math.sqrt(d2) * sgn(sv);
      };
    }
    case 'capped-cone': {
      const h = num(s, 'h'), r1 = num(s, 'r1'), r2 = num(s, 'r2');
      return (x, y, z) => {
        const qx = len2(x, z), qy = y;
        const k1x = r2, k1y = h, k2x = r2 - r1, k2y = 2 * h;
        const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h;
        const t = clamp(((k1x - qx) * k2x + (k1y - qy) * k2y) / (k2x * k2x + k2y * k2y), 0, 1);
        const cbx = qx - k1x + k2x * t, cby = qy - k1y + k2y * t;
        const sv = cbx < 0 && cay < 0 ? -1 : 1;
        return sv * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
      };
    }
    case 'cylinder': {
      const rr = num(s, 'round'), r = num(s, 'r') - rr, h = num(s, 'h') - rr;
      return (x, y, z) => {
        const dx = len2(x, z) - r, dy = Math.abs(y) - h;
        return Math.min(Math.max(dx, dy), 0) + len2(Math.max(dx, 0), Math.max(dy, 0)) - rr;
      };
    }
    case 'capsule': { const h = num(s, 'h'), r = num(s, 'r'); return (x, y, z) => len3(x, y - clamp(y, 0, h), z) - r; }
    case 'plane': {
      // An endless floor, shown as a tile of it.
      const h = num(s, 'y');
      return (x, y, z) => box(x, y - h + 0.04, z, [0.9, 0.04, 0.9]);
    }
    case 'octahedron': {
      const sz = num(s, 's');
      return (x0, y0, z0) => {
        const x = Math.abs(x0), y = Math.abs(y0), z = Math.abs(z0);
        const m = x + y + z - sz;
        let q: Vec3;
        if (3 * x < m) q = [x, y, z];
        else if (3 * y < m) q = [y, z, x];
        else if (3 * z < m) q = [z, x, y];
        else return m * 0.57735027;
        const k = clamp(0.5 * (q[2] - q[1] + sz), 0, sz);
        return len3(q[0], q[1] - sz + k, q[2] - k);
      };
    }
    case 'pyramid': {
      const h = num(s, 'h');
      const m2 = h * h + 0.25;
      return (x0, y, z0) => {
        let px = Math.abs(x0), pz = Math.abs(z0);
        if (pz > px) [px, pz] = [pz, px];
        px -= 0.5; pz -= 0.5;
        const qx = pz, qy = h * y - 0.5 * px, qz = h * px + 0.5 * y;
        const sv = Math.max(-qx, 0);
        const t = clamp((qy - 0.5 * pz) / (m2 + 0.25), 0, 1);
        const a = m2 * (qx + sv) * (qx + sv) + qy * qy;
        const b = m2 * (qx + 0.5 * t) * (qx + 0.5 * t) + (qy - m2 * t) * (qy - m2 * t);
        const d2 = Math.min(qy, -qx * m2 - qy * 0.5) > 0 ? 0 : Math.min(a, b);
        return Math.sqrt((d2 + qz * qz) / m2) * sgn(Math.max(qz, -y));
      };
    }
    case 'ellipsoid': {
      const r = v3(s, 'size');
      return (x, y, z) => {
        const k0 = len3(x / r[0], y / r[1], z / r[2]);
        const k1 = len3(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
        return k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(...r);
      };
    }
    case 'hex-prism': {
      const hx = num(s, 'r'), hy = num(s, 'h');
      const kx = -0.8660254, ky = 0.5, kz = 0.57735;
      return (x0, y0, z0) => {
        let x = Math.abs(x0), y = Math.abs(y0);
        const z = Math.abs(z0);
        const d = 2 * Math.min(kx * x + ky * y, 0);
        x -= d * kx; y -= d * ky;
        const dx = len2(x - clamp(x, -kz * hx, kz * hx), y - hx) * sgn(y - hx);
        const dy = z - hy;
        return Math.min(Math.max(dx, dy), 0) + len2(Math.max(dx, 0), Math.max(dy, 0));
      };
    }
    case 'tri-prism': {
      const hx = num(s, 'r'), hy = num(s, 'h');
      return (x, y, z) => Math.max(Math.abs(z) - hy, Math.max(Math.abs(x) * 0.866025 + y * 0.5, -y) - hx * 0.5);
    }
    case 'link': {
      const le = num(s, 'len'), r1 = num(s, 'R'), r2 = num(s, 'r');
      return (x, y, z) => len2(len2(x, Math.max(Math.abs(y) - le, 0)) - r1, z) - r2;
    }
    case 'box-frame': {
      const b = v3(s, 'size'), e = num(s, 't');
      return (x0, y0, z0) => {
        const px = Math.abs(x0) - b[0], py = Math.abs(y0) - b[1], pz = Math.abs(z0) - b[2];
        const qx = Math.abs(px + e) - e, qy = Math.abs(py + e) - e, qz = Math.abs(pz + e) - e;
        const f = (a: number, bb: number, c: number) => len3(Math.max(a, 0), Math.max(bb, 0), Math.max(c, 0)) + Math.min(Math.max(a, Math.max(bb, c)), 0);
        return Math.min(f(px, qy, qz), f(qx, py, qz), f(qx, qy, pz));
      };
    }
    case 'capped-torus': {
      const ra = num(s, 'R'), rb = num(s, 'r'), a = rad(num(s, 'angle'));
      const sx = Math.sin(a), sy = Math.cos(a);
      return (x0, y, z) => {
        const x = Math.abs(x0);
        const k = sy * x > sx * y ? x * sx + y * sy : len2(x, y);
        return Math.sqrt(Math.max(0, x * x + y * y + z * z + ra * ra - 2 * ra * k)) - rb;
      };
    }
    case 'solid-angle': {
      const ra = num(s, 'r'), a = rad(num(s, 'angle'));
      const cx = Math.sin(a), cy = Math.cos(a);
      return (x, y, z) => {
        const qx = len2(x, z), qy = y;
        const l = len2(qx, qy) - ra;
        const t = clamp(qx * cx + qy * cy, 0, ra);
        const m = len2(qx - cx * t, qy - cy * t);
        return Math.max(l, m * sgn(cy * qx - cx * qy));
      };
    }
    case 'cross': {
      // Three endless bars, cut to a box so the picture has an edge.
      const sz = num(s, 's');
      return (x, y, z) => {
        const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
        const d = Math.min(Math.max(ax, ay), Math.max(ay, az), Math.max(az, ax)) - sz;
        return Math.max(d, box(x, y, z, [0.9, 0.9, 0.9]));
      };
    }
    case 'gyroid': case 'schwarz-p': {
      const f = num(s, 'freq'), t = num(s, 't'), ball = num(s, 'ball') || 1.1;
      const gyroid = def.kind === 'gyroid';
      return (x, y, z) => {
        const fx = x * f, fy = y * f, fz = z * f;
        const dens = gyroid
          ? Math.sin(fx) * Math.cos(fy) + Math.sin(fy) * Math.cos(fz) + Math.sin(fz) * Math.cos(fx)
          : Math.cos(fx) + Math.cos(fy) + Math.cos(fz);
        // The field isn't a true distance: scaled down so the march doesn't step through it.
        return Math.max((Math.abs(dens) - t) / (f * 1.6), len3(x, y, z) - ball);
      };
    }
    default: return (x, y, z) => len3(x, y, z) - 0.5;
  }
}

/** Every shape's thumbnail distance at its default size, by kind. */
export const THUMB_SDF: Record<string, Sdf> = Object.fromEntries(SHAPES.map(s => [s.kind, makeSdf(s)]));

/** A tile of the gallery: a shape, or a variant of one at other sizes (Rounded box). */
export interface GalleryShape {
  key: string;
  kind: string;
  label: string;
  blurb: string;
  /** Sizes the added shape starts with (over its defaults). */
  size?: Record<string, number | Vec3>;
}

/** Variants that get a tile of their own, after the shape they vary. */
const VARIANTS: Record<string, Omit<GalleryShape, 'kind'>> = {
  box: { key: 'rounded-box', label: 'Rounded box', blurb: 'A box with softened edges (Round 0.1).', size: { round: 0.1 } },
  cylinder: { key: 'rounded-cylinder', label: 'Rounded cylinder', blurb: 'A cylinder with softened rims (Round 0.05).', size: { round: 0.05 } },
};

/** The gallery's tiles: every shape of the registry in its order, and the rounded variants. */
export const GALLERY_SHAPES: GalleryShape[] = SHAPES.flatMap(s => [
  { key: s.kind, kind: s.kind, label: s.label, blurb: s.blurb },
  ...(VARIANTS[s.kind] ? [{ ...VARIANTS[s.kind], kind: s.kind }] : []),
]);

const GALLERY_SDF = new Map<string, Sdf>(GALLERY_SHAPES.map(g => [g.key, g.size ? makeSdf(SHAPES.find(s => s.kind === g.kind)!, g.size) : THUMB_SDF[g.kind]]));

/** Where a shape sits and how big it is (sampled), so each one fills its tile. */
function framing(f: Sdf): { c: Vec3; r: number } {
  const N = 28, E = 2.2;
  let lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const x = -E + (2 * E * (i + 0.5)) / N, y = -E + (2 * E * (j + 0.5)) / N, z = -E + (2 * E * (k + 0.5)) / N;
    if (f(x, y, z) < 0.04) {
      lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
      hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
    }
  }
  if (!Number.isFinite(lo[0])) return { c: [0, 0, 0], r: 1 };
  const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const r = 0.5 * len3(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) + (2 * E) / N;
  return { c, r: Math.max(0.2, r) };
}

/** The base colour (a warm clay that reads on light and dark backgrounds). */
const CLAY: Vec3 = [0.86, 0.6, 0.42];

/**
 * RGBA pixels (size × size, not premultiplied) of a gallery tile (`key`; a shape's kind works too), seen from the front-right and a little
 * above, with a clear background. Edges are smoothed (`samples` × `samples` per pixel; 1 is enough on a high-density screen).
 */
export function renderThumbnail(key: string, size: number, samples = 2): Uint8ClampedArray<ArrayBuffer> {
  const f = GALLERY_SDF.get(key) ?? THUMB_SDF[key] ?? THUMB_SDF.sphere;
  const { c, r } = framing(f);
  // An orthographic view: forward, right and up from the camera's angle and elevation.
  const yaw = rad(35), pitch = rad(24);
  const fw: Vec3 = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const rt: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up: Vec3 = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
  const half = r * 1.04;
  const L = (() => { const l: Vec3 = [0.45, 0.85, 0.5]; const n = len3(...l); return l.map(v => v / n) as Vec3; })();
  const out = new Uint8ClampedArray(size * size * 4);
  const SS = Math.max(1, Math.round(samples));
  const eps = r * 0.002;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let ar = 0, ag = 0, ab = 0, aa = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = ((px + (sx + 0.5) / SS) / size) * 2 - 1;
      const v = 1 - ((py + (sy + 0.5) / SS) / size) * 2;
      // The ray starts on a plane in front of the shape and walks forward.
      const ox = c[0] + rt[0] * u * half + up[0] * v * half - fw[0] * r * 2;
      const oy = c[1] + rt[1] * u * half + up[1] * v * half - fw[1] * r * 2;
      const oz = c[2] + rt[2] * u * half + up[2] * v * half - fw[2] * r * 2;
      let t = 0, hit = false;
      for (let i = 0; i < 96 && t < r * 4; i++) {
        const d = f(ox + fw[0] * t, oy + fw[1] * t, oz + fw[2] * t);
        if (d < eps) { hit = true; break; }
        t += d * 0.9;
      }
      if (!hit) continue;
      const x = ox + fw[0] * t, y = oy + fw[1] * t, z = oz + fw[2] * t;
      const h = r * 0.004;
      let nx = f(x + h, y, z) - f(x - h, y, z), ny = f(x, y + h, z) - f(x, y - h, z), nz = f(x, y, z + h) - f(x, y, z - h);
      const nl = len3(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const sky = 0.32 + 0.18 * ny;
      const facing = Math.max(0, -(nx * fw[0] + ny * fw[1] + nz * fw[2]));
      const rim = Math.pow(1 - facing, 3) * 0.25;
      // A soft, fake occlusion: darker where the surface is close to more of the shape.
      const ao = clamp(0.55 + f(x + nx * r * 0.12, y + ny * r * 0.12, z + nz * r * 0.12) / (r * 0.12) * 0.45, 0.35, 1);
      const light = (diff * 0.8 + sky) * ao + rim;
      ar += CLAY[0] * light; ag += CLAY[1] * light; ab += CLAY[2] * light; aa += 1;
    }
    if (!aa) continue;
    const n = SS * SS;
    const o = (py * size + px) * 4;
    // Colour averaged over the samples that hit; alpha is how many did.
    out[o] = Math.round(Math.pow(clamp(ar / aa, 0, 1), 1 / 1.6) * 255);
    out[o + 1] = Math.round(Math.pow(clamp(ag / aa, 0, 1), 1 / 1.6) * 255);
    out[o + 2] = Math.round(Math.pow(clamp(ab / aa, 0, 1), 1 / 1.6) * 255);
    out[o + 3] = Math.round((aa / n) * 255);
  }
  return out;
}
