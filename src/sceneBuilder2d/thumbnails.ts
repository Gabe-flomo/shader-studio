/**
 * thumbnails.ts — small pictures for the 2D Scene Builder's galleries (docs/scene-builder-2d-plan.md).
 *
 *  - SHAPES: each shape's distance function (the same formulas as the Shape SDF node) at its
 *    default size, drawn filled with a soft edge on a clear background, so a thumbnail reads the
 *    same on a light or a dark theme.
 *  - SPACE: a checkerboard with a ring on it, seen through one space transform at its current
 *    settings: the warped checker the Space tab shows beside each transform.
 *
 * Pure (no DOM): the render functions return RGBA pixels; the components turn them into images.
 * Every shape and every space transform in spec.ts has an entry here (the tests check), so a new
 * one can't join the registry without a picture. The noise warp is drawn with a cheap stand-in
 * for the node's noise: the thumbnail shows the character of the warp, not its exact pattern.
 */
import { SHAPES, SPACES, defaultSize, num, type SpaceOp, type Vec2 } from './spec';

type Sdf = (x: number, y: number) => number;
type SizeMap = Record<string, number | Vec2>;

const len = (a: number, b: number) => Math.sqrt(a * a + b * b);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const fl = (v: number) => Math.floor(v);
const mod = (x: number, y: number) => x - y * Math.floor(x / y);
const dot2 = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by;

const vec = (s: SizeMap, k: string): Vec2 => (Array.isArray(s[k]) ? s[k] as Vec2 : [Number(s[k]), Number(s[k])]);
const n = (s: SizeMap, k: string) => Number(s[k]);

/** Folds a point round a regular polygon's symmetry (the iq polygon family). */
function polygon(absY: boolean, kz: number, r: number, folds: Array<[number, number]>): Sdf {
  return (x0, y0) => {
    let x = Math.abs(x0), y = absY ? Math.abs(y0) : y0;
    for (const [fx, fy] of folds) {
      const d = 2 * Math.min(dot2(fx, fy, x, y), 0);
      x -= d * fx; y -= d * fy;
    }
    x -= clamp(x, -kz * r, kz * r); y -= r;
    return len(x, y) * sgn(y);
  };
}

/** A shape's distance at a size (its defaults, or a variant's): the node formulas, primitives.ts. */
export function shapeSdf(kind: string, over: SizeMap = {}): Sdf {
  const s: SizeMap = { ...defaultSize(kind), ...over };
  switch (kind) {
    case 'circle': { const r = n(s, 'r'); return (x, y) => len(x, y) - r; }
    case 'ring': { const r = n(s, 'r'), th = n(s, 'th'); return (x, y) => Math.abs(len(x, y) - r) - th; }
    case 'box': { const b = vec(s, 'size'); return (x, y) => { const qx = Math.abs(x) - b[0], qy = Math.abs(y) - b[1]; return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0); }; }
    case 'rounded-box': {
      const b = vec(s, 'size'), r = n(s, 'round');
      return (x, y) => { const qx = Math.abs(x) - b[0] + r, qy = Math.abs(y) - b[1] + r; return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
    }
    case 'triangle': {
      const r = n(s, 'r'), k = Math.sqrt(3);
      return (x0, y0) => {
        let x = Math.abs(x0) - r, y = y0 + r / k;
        if (x + k * y > 0) { const nx = (x - k * y) / 2, ny = (-k * x - y) / 2; x = nx; y = ny; }
        x -= clamp(x, -2 * r, 0);
        return -len(x, y) * sgn(y);
      };
    }
    case 'diamond': {
      const b = vec(s, 'size'), bx = b[0], by = -b[1];
      return (x0, y0) => {
        let x = Math.abs(x0), y = Math.abs(y0);
        const h = clamp((bx * x + by * y + by * by) / (bx * bx + by * by), 0, 1);
        x -= bx * h; y -= by * (h - 1);
        return len(x, y) * sgn(x);
      };
    }
    case 'pentagon': return polygon(false, 0.726542528, n(s, 'r'), [[-0.809016994, 0.587785252], [0.809016994, 0.587785252]]);
    case 'hexagon': return polygon(true, 0.577350269, n(s, 'r'), [[-0.866025404, 0.5]]);
    case 'octagon': return polygon(true, 0.4142135623, n(s, 'r'), [[-0.9238795325, 0.3826834323], [0.9238795325, 0.3826834323]]);
    case 'hexagram': {
      const r = n(s, 'r');
      return (x0, y0) => {
        let x = Math.abs(x0), y = Math.abs(y0);
        let d = 2 * Math.min(dot2(-0.5, 0.8660254038, x, y), 0); x -= d * -0.5; y -= d * 0.8660254038;
        d = 2 * Math.min(dot2(0.8660254038, -0.5, x, y), 0); x -= d * 0.8660254038; y -= d * -0.5;
        x -= clamp(x, r * 0.5773502692, r * 1.7320508076); y -= r;
        return len(x, y) * sgn(y);
      };
    }
    case 'star': {
      const r = n(s, 'r'), rf = n(s, 'inner');
      const k1x = 0.809016994375, k1y = -0.587785252192, k2x = -0.809016994375, k2y = -0.587785252192;
      const bax = rf * -k1y - 0, bay = rf * k1x - 1;
      return (x0, y0) => {
        let x = Math.abs(x0), y = y0;
        let d = 2 * Math.max(dot2(k1x, k1y, x, y), 0); x -= d * k1x; y -= d * k1y;
        d = 2 * Math.max(dot2(k2x, k2y, x, y), 0); x -= d * k2x; y -= d * k2y;
        x = Math.abs(x); y -= r;
        const h = clamp(dot2(x, y, bax, bay) / dot2(bax, bay, bax, bay), 0, r);
        return len(x - bax * h, y - bay * h) * sgn(y * bax - x * bay);
      };
    }
    case 'burst': {
      const r = n(s, 'r'), nf = n(s, 'points'), m = n(s, 'sharp');
      const an = Math.PI / nf, en = Math.PI / m;
      const acs: Vec2 = [Math.cos(an), Math.sin(an)], ecs: Vec2 = [Math.cos(en), Math.sin(en)];
      return (x0, y0) => {
        const bn = mod(Math.atan2(x0, y0), 2 * an) - an;
        const l = len(x0, y0);
        let x = l * Math.cos(bn), y = l * Math.abs(Math.sin(bn));
        x -= r * acs[0]; y -= r * acs[1];
        const t = clamp(-dot2(x, y, ecs[0], ecs[1]), 0, r * acs[1] / ecs[1]);
        x += ecs[0] * t; y += ecs[1] * t;
        return len(x, y) * sgn(x);
      };
    }
    case 'heart': {
      const sz = n(s, 'size');
      return (x0, y0) => {
        const x = Math.abs(x0) / sz, y = y0 / sz + 0.5;
        if (y + x > 1) return (len(x - 0.25, y - 0.75) - Math.SQRT2 / 4) * sz;
        const a = x * x + (y - 1) * (y - 1);
        const m = 0.5 * Math.max(x + y, 0);
        const b = (x - m) * (x - m) + (y - m) * (y - m);
        return Math.sqrt(Math.min(a, b)) * sgn(x - y) * sz;
      };
    }
    case 'cross': {
      const b = vec(s, 'size'), r = n(s, 'round');
      return (x0, y0) => {
        let x = Math.abs(x0), y = Math.abs(y0);
        if (y > x) [x, y] = [y, x];
        const qx = x - b[0], qy = y - b[1];
        const k = Math.max(qy, qx);
        const wx = k > 0 ? qx : b[1] - x, wy = k > 0 ? qy : -k;
        return sgn(k) * len(Math.max(wx, 0), Math.max(wy, 0)) + r;
      };
    }
    case 'ellipse': {
      const r = vec(s, 'size');
      return (x, y) => {
        const k0 = len(x / r[0], y / r[1]);
        const k1 = len(x / (r[0] * r[0]), y / (r[1] * r[1]));
        return k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(r[0], r[1]);
      };
    }
    case 'moon': {
      const ra = n(s, 'r'), rb = n(s, 'cut'), d = n(s, 'd');
      return (x, y0) => {
        const y = Math.abs(y0);
        const a = (ra * ra - rb * rb + d * d) / (2 * d || 1e-6);
        const b = Math.sqrt(Math.max(ra * ra - a * a, 0));
        if (d * (x * b - y * a) > d * d * Math.max(b - y, 0)) return len(x - a, y - b);
        return Math.max(len(x, y) - ra, -(len(x - d, y) - rb));
      };
    }
    case 'vesica': {
      const w = n(s, 'w'), h = n(s, 'h');
      const d = 0.5 * (w * w - h * h) / h;
      return (x0, y0) => {
        const x = Math.abs(x0), y = Math.abs(y0);
        const useA = w * y < d * (x - w);
        const cx = useA ? 0 : -d, cy = useA ? w : 0, cz = useA ? 0 : d + h;
        return len(x - cy, y - cx) - cz;
      };
    }
    default: return (x, y) => len(x, y) - 0.3;
  }
}

// ── Shapes ──────────────────────────────────────────────────────────────────

/** RGBA pixels of a shape at its default size: a soft fill, a lighter edge, a clear background. */
export function renderShapeThumbnail(kind: string, size: number, ss = 2, over: SizeMap = {}): Uint8ClampedArray {
  const sdf = shapeSdf(kind, over);
  const out = new Uint8ClampedArray(size * size * 4);
  const view = 0.46 * 2; // the view spans -0.46…0.46
  const px = view / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let cov = 0, edge = 0;
      for (let b = 0; b < ss; b++) {
        for (let a = 0; a < ss; a++) {
          const x = ((i + (a + 0.5) / ss) / size - 0.5) * view;
          const y = (0.5 - (j + (b + 0.5) / ss) / size) * view;
          const d = sdf(x, y);
          if (d < 0) { cov++; if (d > -px * 2.2) edge++; }
        }
      }
      const q = ss * ss, o = (j * size + i) * 4;
      const a = cov / q, e = edge / q;
      // A blue-grey body with a lighter rim: reads on light and dark themes.
      const t = e * 0.7;
      out[o] = 90 + 120 * t; out[o + 1] = 130 + 100 * t; out[o + 2] = 190 + 55 * t;
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

// ── Space ───────────────────────────────────────────────────────────────────

type Map2 = (x: number, y: number) => [number, number];

/** Where a space transform sends a point: what the shapes below it see. Settings from the op, as the node reads them. */
export function spaceMap(op: SpaceOp): Map2 {
  const v = op.values;
  const g = (k: string, d: number) => num(v[k], d);
  switch (op.kind) {
    case 'zoom': { const by = Math.max(0.01, g('by', 1.5)); return (x, y) => [x / by, y / by]; }
    case 'rotate': {
      const a = g('angle', 30) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      return (x, y) => [c * x - s * y, s * x + c * y];
    }
    case 'move': { const by = (Array.isArray(v.by) ? v.by : [0, 0]) as Vec2; return (x, y) => [x - by[0], y - by[1]]; }
    case 'pixelate': { const sz = Math.max(0.005, g('size', 0.06)); return (x, y) => [(fl(x / sz) + 0.5) * sz, (fl(y / sz) + 0.5) * sz]; }
    case 'tile': {
      const c = (Array.isArray(v.cell) ? v.cell : [1, 1]) as Vec2;
      return (x, y) => [mod(x + c[0] / 2, c[0]) - c[0] / 2, mod(y + c[1] / 2, c[1]) - c[1] / 2];
    }
    case 'mirror-tile': {
      const c = (Array.isArray(v.cell) ? v.cell : [1, 1]) as Vec2;
      const f = (p: number, cell: number) => { const m = mod(p, 2 * cell); return (m > cell ? 2 * cell - m : m) - cell / 2; };
      return (x, y) => [f(x, c[0]), f(y, c[1])];
    }
    case 'mirror': {
      const axes = String(v.axes ?? 'x');
      return (x, y) => [axes.includes('x') ? Math.abs(x) : x, axes.includes('y') ? Math.abs(y) : y];
    }
    case 'kaleidoscope': {
      const segs = Math.max(1, g('n', 6)), rot = g('angle', 0) * Math.PI / 180;
      return (x, y) => {
        const l = len(x, y), s = 2 * Math.PI / segs;
        let a = mod(Math.atan2(y, x) + rot, s);
        if (a > s / 2) a = s - a;
        return [Math.cos(a) * l, Math.sin(a) * l];
      };
    }
    case 'polar-repeat': {
      const cnt = Math.max(2, g('count', 6));
      return (x, y) => {
        const sp = 2 * Math.PI / cnt, l = len(x, y);
        const aw = Math.atan2(y, x) - sp * Math.floor(Math.atan2(y, x) / sp + 0.5);
        return [Math.cos(aw) * l, Math.sin(aw) * l];
      };
    }
    case 'polar': {
      const tw = g('twist', 0), sc = g('scale', 1);
      return (x, y) => {
        const r = len(x, y) * sc, a = mod(Math.atan2(y, x) / (2 * Math.PI) + 0.5, 1);
        return [(a + r * tw) * 2 - 1, r * 2 - 1];
      };
    }
    case 'swirl': {
      const st = g('amount', 2), fo = g('falloff', 1);
      return (x, y) => { const a = st * Math.exp(-len(x, y) * fo), c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
    }
    case 'warp': {
      const am = g('amount', 0.3), sc = g('scale', 1.5);
      return (x, y) => [x + am * (Math.sin(y * sc * 2.3 + 1.3) + 0.5 * Math.sin(x * sc * 4.1 + 0.4)) * 0.8, y + am * (Math.sin(x * sc * 2.1 + 0.7) + 0.5 * Math.sin(y * sc * 3.7 + 2.1)) * 0.8];
    }
    case 'wave': { const f = g('freq', 5), a = g('amp', 0.1); return (x, y) => [x + Math.sin(y * f) * a, y + Math.sin(x * f) * a]; }
    case 'fisheye': { const s = g('amount', 0.5); return (x, y) => { const r2 = x * x + y * y; const k = 1 - s * 0.6 * r2; return [x * k, y * k]; }; }
    case 'invert': { const R = g('radius', 1); return (x, y) => { const d = x * x + y * y; return d < 1e-6 ? [0, 0] : [x * R * R / d, y * R * R / d]; }; }
    default: return (x, y) => [x, y];
  }
}

const CHECK_A: [number, number, number] = [44, 52, 70];
const CHECK_B: [number, number, number] = [188, 198, 218];
const ACCENT: [number, number, number] = [255, 138, 76];

/** RGBA pixels of the warped checker for one space transform: a checkerboard and a ring, drawn through it. */
export function renderSpaceThumbnail(op: SpaceOp, size: number): Uint8ClampedArray {
  const map = spaceMap(op);
  const out = new Uint8ClampedArray(size * size * 4);
  const view = 2; // -1…1
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size - 0.5) * view;
      const y = (0.5 - (j + 0.5) / size) * view;
      const [qx, qy] = map(x, y);
      const cx = fl(qx * 3), cy = fl(qy * 3);
      const checker = (cx + cy) & 1;
      let c = checker ? CHECK_B : CHECK_A;
      const ring = Math.abs(len(qx, qy) - 0.62);
      if (ring < 0.05) c = ACCENT;
      const o = (j * size + i) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
  }
  return out;
}

/** Every key a gallery draws: the tests check each shape and space transform has a picture. */
export const THUMBNAIL_KINDS = { shapes: SHAPES.map(s => s.kind), spaces: SPACES.map(s => s.kind) };
