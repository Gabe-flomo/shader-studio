/**
 * Frame Stack maths (docs/frame-stack.md). Pure: no DOM, no GL.
 *
 * A Frame Stack draws a Time Cube's frames as separate cards. Each card has
 * a pose (a centre, a normal and an up direction) from its layout, a random
 * offset (scatter and drift), and the scan's and the highlights' effects.
 * The GLSL in nodes/definitions/frameStack.ts writes the same maths out; the
 * tests check these functions, so the two are kept in step by hand.
 *
 * Space: y is up; the stack's first card is nearest +z; a card facing +z is
 * read from +z. The app's cameras put screen right at −x when looking down
 * −z, so a card's own "right" (the way its picture's u runs) is
 * cross(normal, up).
 */

export type Vec3 = [number, number, number];

/** Cards are drawn in one bounded loop: never more than this many. */
export const MAX_CARDS = 128;
/** The nearest this many cards are composited at each pixel (front to back); any further ones are hidden. */
export const LAYERS = 4;

export const LAYOUTS = ['stack', 'fan', 'ring', 'helix', 'grid'] as const;
export type Layout = typeof LAYOUTS[number];

export const layoutOf = (v: unknown): Layout => (LAYOUTS as readonly string[]).includes(v as string) ? v as Layout : 'stack';
/** The morph target: a layout, or none (no morph: the shader computes one layout). */
export const morphTargetOf = (v: unknown): Layout | null => (LAYOUTS as readonly string[]).includes(v as string) ? v as Layout : null;

/** The number of cards a slider value asks for: a whole number, 1 to MAX_CARDS. */
export function cardCount(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v + 0.5) : 48;
  return Math.min(MAX_CARDS, Math.max(1, n));
}

export interface ShapeSettings {
  spacing: number;
  radius: number;
  /** Ring / helix: 0 cards face along the ring (like a rolodex), 1 face outward. */
  twist: number;
  /** Ring: how much of the circle the cards go round (1 = all of it). */
  arc: number;
  /** Ring: the tube radius (0 = a flat ring, more = a torus). */
  tube: number;
  /** Ring: times round the tube while going once round the ring. */
  windings: number;
  /** Helix: turns from the first card to the last. */
  turns: number;
  /** Fan: the spread from the first card to the last, degrees. */
  fanAngle: number;
  /** Grid: columns (0 = about square). */
  columns: number;
}

export interface Pose { pos: Vec3; normal: Vec3; up: Vec3 }

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const mixV = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3) => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.max(length(a), 1e-9));
const fract = (x: number) => x - Math.floor(x);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** GLSL mod: the result has the sign of the divisor. */
export const gmod = (x: number, y: number) => x - y * Math.floor(x / y);

/** Grid columns: the setting, or about square (taking the card's shape into account). */
export function gridColumns(n: number, columns: number, aspect: number): number {
  const c = Math.floor(columns + 0.5);
  return c >= 1 ? c : Math.max(1, Math.floor(Math.sqrt(n / Math.max(aspect, 0.05)) + 0.5));
}

/**
 * Where card `e` (a card index, possibly fractional: the scan's gap shifts it) of `n` sits in a
 * layout, and which way it faces. `half` is the card's half width and height.
 */
export function layoutPose(layout: Layout, e: number, n: number, s: ShapeSettings, half: [number, number]): Pose {
  const mid = (n - 1) / 2;
  const k = e - mid;
  const Y: Vec3 = [0, 1, 0], Z: Vec3 = [0, 0, 1];
  switch (layout) {
    case 'fan': {
      // A hand of cards: each turned about a pivot below the middle, a little behind the one before.
      const a = n > 1 ? (k / Math.max(n - 1, 1)) * s.fanAngle * Math.PI / 180 : 0;
      const up: Vec3 = [-Math.sin(a), Math.cos(a), 0];
      return { pos: add(add([0, -s.radius, 0], scale(up, s.radius)), [0, 0, -k * s.spacing * 0.25]), normal: Z, up };
    }
    case 'ring': {
      const th = (e / n) * 2 * Math.PI * s.arc;
      const radial: Vec3 = [Math.sin(th), 0, Math.cos(th)];
      const tangent: Vec3 = [Math.cos(th), 0, -Math.sin(th)];
      const ph = th * s.windings;
      const pos = add(scale(radial, s.radius + s.tube * Math.cos(ph)), [0, s.tube * Math.sin(ph), 0]);
      const al = s.twist * Math.PI / 2;
      const normal = add(scale(tangent, Math.cos(al)), scale(radial, Math.sin(al)));
      // Round a torus's tube the cards roll with it.
      const up = add(scale(Y, Math.cos(ph)), scale(radial, -Math.sin(ph)));
      return { pos, normal, up };
    }
    case 'helix': {
      const th = n > 1 ? (e / (n - 1)) * 2 * Math.PI * s.turns : 0;
      const radial: Vec3 = [Math.sin(th), 0, Math.cos(th)];
      const tangent: Vec3 = [Math.cos(th), 0, -Math.sin(th)];
      const al = s.twist * Math.PI / 2;
      return { pos: add(scale(radial, s.radius), [0, k * s.spacing, 0]), normal: add(scale(tangent, Math.cos(al)), scale(radial, Math.sin(al))), up: Y };
    }
    case 'grid': {
      const cols = gridColumns(n, s.columns, half[0] / Math.max(half[1], 1e-6));
      const rows = Math.ceil(n / cols);
      const row = Math.floor((e + 0.5) / cols);
      const col = e - row * cols;
      const gap = s.spacing;
      return { pos: [-(col - (cols - 1) / 2) * (2 * half[0] + gap), -(row - (rows - 1) / 2) * (2 * half[1] + gap), 0], normal: Z, up: Y };
    }
    default:
      return { pos: [0, 0, -k * s.spacing], normal: Z, up: Y };
  }
}

/** Each card's own morph amount: with Stagger, the first cards go first. */
export function morphWeight(morph: number, stagger: number, s: number): number {
  return smoothstep(0, 1, clamp(morph * (1 + stagger) - s * stagger, 0, 1));
}

/** Between two poses: positions and directions mixed (the directions are made square again afterwards). */
export function mixPose(a: Pose, b: Pose, t: number): Pose {
  return { pos: mixV(a.pos, b.pos, t), normal: mixV(a.normal, b.normal, t), up: mixV(a.up, b.up, t) };
}

/** A pose's frame made orthonormal: normal, up (square to it), right = cross(normal, up). */
export function frameOf(p: Pose): { normal: Vec3; up: Vec3; right: Vec3 } {
  const normal = normalize(add(p.normal, [0, 0, 1e-4]));
  const up = normalize(add(p.up, scale(normal, -dot(p.up, normal))));
  return { normal, up, right: cross(normal, up) };
}

/** Dave Hoskins' hash33, as the GLSL writes it: 0–1 each. */
export function hash33(p: Vec3): Vec3 {
  let q: Vec3 = [fract(p[0] * 0.1031), fract(p[1] * 0.1030), fract(p[2] * 0.0973)];
  const d = q[0] * (q[1] + 33.33) + q[1] * (q[0] + 33.33) + q[2] * (q[2] + 33.33);
  q = [q[0] + d, q[1] + d, q[2] + d];
  return [fract((q[0] + q[1]) * q[2]), fract((q[0] + q[0]) * q[1]), fract((q[1] + q[0]) * q[0])];
}

export interface ScatterSettings { position: number; rotation: number; spread: number; seed: number; drift: number; driftSpeed: number }

/** A card's random offset: a fixed scatter (times Spread) plus a slow drift, by card and seed. Deterministic. */
export function scatterOf(i: number, s: ScatterSettings, time: number): { offset: Vec3; turnN: Vec3; turnU: Vec3 } {
  const seed = Math.floor(s.seed + 0.5) + 1;
  const h1 = hash33([i + 1, seed, 1]);
  const h2 = hash33([i + 1, seed, 2]);
  const h3 = hash33([i + 1, seed, 3]);
  const sym = (h: Vec3): Vec3 => [h[0] * 2 - 1, h[1] * 2 - 1, h[2] * 2 - 1];
  const r1 = sym(h1), r2 = sym(h2);
  const w = 2 * Math.PI;
  const wander: Vec3 = [0, 1, 2].map(j => Math.sin(time * s.driftSpeed * w * (0.6 + 0.4 * h3[j]) + w * h3[(j + 1) % 3])) as Vec3;
  return {
    offset: add(scale(r1, s.position * s.spread), scale(wander, s.drift)),
    turnN: scale(r2, s.rotation * s.spread),
    turnU: scale([r2[1], r2[2], r2[0]], s.rotation * s.spread),
  };
}

/**
 * The scan's profile for a card `d` cards from it: 0 within 0.35 of a card (that card is "at" the
 * scan), easing up to 1 by Falloff cards further on. As the scan moves, one card hands over to
 * the next in a short glide instead of every card sliding all the time.
 */
export function scanProfile(d: number, falloff: number): number {
  return smoothstep(0, 1, clamp((Math.abs(d) - 0.35) / (Math.max(falloff, 0) + 0.3), 0, 1));
}

/** How much the scan lifts card `i` (0–1): 1 at the scan, falling to 0 Falloff cards away. */
export function scanWeight(i: number, scanCard: number, falloff: number): number {
  return 1 - scanProfile(i - scanCard, falloff);
}

/** The scan's position as a card index: Offset 0 is the first card, 1 the last. */
export const scanCardOf = (offset: number, n: number) => clamp(offset, 0, 1) * (n - 1);

/** The scan's Gap: cards either side of it slide apart along the layout (card units). */
export function gapShift(i: number, scanCard: number, gap: number, falloff: number): number {
  return gap * Math.sign(i - scanCard) * scanProfile(i - scanCard, falloff);
}

export interface HighlightSettings { frame: number; count: number; every: number; loop: boolean }

/**
 * Is card `i` highlighted? Count cards, Every apart, from card Frame; with Loop, counted from the
 * scan's card and wrapping round the stack, so the highlights travel with the scan.
 */
export function isHighlighted(i: number, n: number, scanCard: number, h: HighlightSettings): boolean {
  const count = Math.floor(h.count + 0.5);
  const every = Math.max(1, Math.floor(h.every + 0.5));
  let r = i - Math.floor(h.frame + 0.5) - (h.loop ? Math.floor(scanCard + 0.5) : 0);
  if (h.loop) r = gmod(r, n);
  return r >= 0 && gmod(r, every) < 0.5 && r / every < count - 0.5 + 1e-6;
}

export type Playback = 'own' | 'echo' | 'frozen';
export const playbackOf = (v: unknown): Playback => (v === 'echo' || v === 'frozen' ? v : 'own');

/** Which frame of the volume (0 … frames − 1) card `i` of `n` shows. */
export function cardFrame(mode: Playback, i: number, n: number, frames: number, o: { rate: number; shift: number; delay: number; frozen: number; time: number }): number {
  const s = n > 1 ? i / (n - 1) : 0;
  if (mode === 'frozen') return Math.floor(clamp(o.frozen, 0, 1) * (frames - 1) + 0.5);
  if (mode === 'echo') return gmod(Math.floor(o.time * o.rate - i * o.delay + o.shift), frames);
  return gmod(Math.floor(s * (frames - 1) + 0.5 + o.time * o.rate + o.shift), frames);
}

/** Signed distance to a rounded rectangle of half size `b` and corner radius `r` (in the same units). */
export function sdRoundRect(x: number, y: number, b: [number, number], r: number): number {
  const rr = Math.min(r, Math.min(b[0], b[1]));
  const qx = Math.abs(x) - b[0] + rr, qy = Math.abs(y) - b[1] + rr;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - rr;
}

/** One three-round Feistel pass on an s × s square (the GLSL's fsFeistel), forward or back. */
function feistel(x: number, s: number, seed: number, inv: boolean): number {
  let L = Math.floor(x / s);
  let R = x - L * s;
  for (let k = 0; k < 3; k++) {
    if (!inv) {
      const F = Math.floor(hash33([R, seed, k])[0] * s);
      const nl = R; R = gmod(L + F, s); L = nl;
    } else {
      const F = Math.floor(hash33([L, seed, 2 - k])[0] * s);
      const nr = L; L = gmod(R - F, s); R = nr;
    }
  }
  return L * s + R;
}

/**
 * Shuffle: card `i`'s place in a seeded random order of `n` (with inv, which card is in place
 * `i`). A Feistel network on the smallest square that holds n, walking the cycle until it lands
 * below n, so it is a true permutation: every card gets its own place. (GLSL fsPerm.)
 */
export function shufflePlace(i: number, n: number, seed: number, inv = false): number {
  const s = Math.ceil(Math.sqrt(n) - 1e-3);
  let y = i;
  for (let w = 0; w < 32; w++) {
    y = feistel(y, s, Math.floor(seed + 0.5), inv);
    if (y < n - 0.5) return y;
  }
  return i;
}
