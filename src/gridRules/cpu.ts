/**
 * cpu.ts — a small CPU run of a Grid Rules rule set, for the editor's live preview
 * (components/gridRules/RulePreview.tsx): the same rules as the GLSL (gridRules/glsl.ts) on a board
 * of a few thousand cells, so a rule can be tried while it is being written, without the GPU.
 * Boards wrap or have walls as the node's do. Two channels per cell: a (state, or u) and b (age, or v).
 */
import { GRID_DEFAULTS, gridShape, neighbourOffsets, type GridShape } from './spec';

export interface CpuBoard { w: number; h: number; a: Float32Array; b: Float32Array }

export function cpuBoard(w: number, h: number): CpuBoard {
  return { w, h, a: new Float32Array(w * h), b: new Float32Array(w * h) };
}

/** A new board as the node's Start would deal it (Image previews as noise). */
export function cpuSeed(params: Record<string, unknown>, w: number, h: number, rnd: () => number = Math.random): CpuBoard {
  const P = { ...GRID_DEFAULTS, ...params };
  const s = gridShape(P);
  const B = cpuBoard(w, h);
  const density = Number(P.density);
  const centre = (x: number, y: number, r: number) => Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) < Math.min(w, h) * r;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (s.start === 'empty') continue;
    if (s.type !== 'smooth') {
      const on = rnd() < density;
      B.a[i] = s.start === 'centre' ? (centre(x, y, 0.15) && on ? 1 : 0) : on ? 1 : 0;
      continue;
    }
    const disc = centre(x, y, 0.08) ? 1 : 0;
    if (s.template === 'reaction') {
      B.a[i] = 1;
      B.b[i] = s.start === 'centre' ? disc : rnd() < density * 0.012 ? 1 : 0;
    } else if (s.template === 'waves') {
      const v = s.start === 'centre' ? disc : rnd() < density * 0.02 ? 1 : 0;
      B.a[i] = v; B.b[i] = v;
    } else B.a[i] = s.start === 'centre' ? disc : rnd() < density ? 1 : 0;
  }
  if (s.type === 'smooth' && s.template === 'reaction' && s.start !== 'centre') {
    // Blobs, as the node's 6 × 6 cell hash does: grow each seed into a small square.
    const seeds = [...B.b.keys()].filter(i => B.b[i] > 0);
    for (const i of seeds) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const x = (i % w) + dx, y = Math.floor(i / w) + dy;
      if (x < w && y < h) B.b[y * w + x] = 1;
    }
  }
  return B;
}

/** One step of the rule. */
export function cpuStep(params: Record<string, unknown>, B: CpuBoard): CpuBoard {
  const P = { ...GRID_DEFAULTS, ...params };
  const s = gridShape(P);
  return s.type === 'smooth' ? smooth(s, P, B) : discrete(s, P, B);
}

function at(B: CpuBoard, ch: 'a' | 'b', x: number, y: number, wrap: boolean): number {
  if (wrap) { x = (x + B.w) % B.w; y = (y + B.h) % B.h; } else { x = Math.max(0, Math.min(B.w - 1, x)); y = Math.max(0, Math.min(B.h - 1, y)); }
  return B[ch][y * B.w + x];
}

function discrete(s: GridShape, P: Record<string, unknown>, B: CpuBoard): CpuBoard {
  const out = cpuBoard(B.w, B.h);
  const offsets = neighbourOffsets(s.neighbourhood, s.radius, s.shape);
  const radius = s.neighbourhood === 'radius';
  const born = Math.round(Number(P.bornMask)), surv = Math.round(Number(P.surviveMask));
  const [bl, bh, sl, sh] = [P.bornLo, P.bornHi, P.surviveLo, P.surviveHi].map(Number);
  const N = Math.max(2, Math.round(Number(P.states)));
  const glow = Number(P.afterglow), ageRate = Number(P.ageRate);
  for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) {
    const i = y * B.w + x;
    const st = Math.round(B.a[i]);
    let c = 0;
    for (const [dx, dy] of offsets) if (Math.round(at(B, 'a', x + dx, y + dy, s.wrap)) === 1) c++;
    const b = radius ? c >= bl && c <= bh : ((born >> c) & 1) === 1;
    const sv = radius ? c >= sl && c <= sh : ((surv >> c) & 1) === 1;
    let next: number;
    if (s.type === 'stages') next = st === 0 ? (b ? 1 : 0) : st === 1 ? (sv ? 1 : N > 2 ? 2 : 0) : st + 1 >= N ? 0 : st + 1;
    else next = st === 1 ? (sv ? 1 : 0) : b ? 1 : 0;
    const g = B.b[i];
    const ng = next === 1 ? (st === 1 ? Math.min(1, g + ageRate) : 0) : next === 0 ? (st > 0 ? glow : g * glow) : 0;
    const inside = s.wrap || (x > 0 && y > 0 && x < B.w - 1 && y < B.h - 1);
    out.a[i] = inside ? next : 0;
    out.b[i] = inside ? ng : 0;
  }
  return out;
}

function smooth(s: GridShape, P: Record<string, unknown>, B: CpuBoard): CpuBoard {
  const out = cpuBoard(B.w, B.h);
  const num = (k: string) => Number(P[k]);
  for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) {
    const i = y * B.w + x;
    const u = B.a[i], v = B.b[i];
    const r = (ch: 'a' | 'b', dx: number, dy: number) => at(B, ch, x + dx, y + dy, s.wrap);
    const edge = (ch: 'a' | 'b') => r(ch, 0, 1) + r(ch, 1, 0) + r(ch, 0, -1) + r(ch, -1, 0);
    const corn = (ch: 'a' | 'b') => r(ch, 1, 1) + r(ch, 1, -1) + r(ch, -1, -1) + r(ch, -1, 1);
    let nu = u, nv = v;
    if (s.template === 'diffusion') nu = (u + (edge('a') * 0.25 - u) * num('spread')) * (1 - num('decay'));
    else if (s.template === 'waves') { nu = (2 * u - v + num('waveSpeed') * 0.5 * (edge('a') - 4 * u)) * num('damping'); nv = u; } else if (s.template === 'reaction') {
      const lapA = 0.2 * edge('a') + 0.05 * corn('a') - u, lapB = 0.2 * edge('b') + 0.05 * corn('b') - v, abb = u * v * v;
      nu = Math.min(1, Math.max(0, u + num('diffA') * lapA - abb + num('feed') * (1 - u)));
      nv = Math.min(1, Math.max(0, v + num('diffB') * lapB + abb - (num('kill') + num('feed')) * v));
    } else {
      // The custom update isn't run on the CPU: the preview shows it as diffusion would.
      nu = u + (edge('a') * 0.25 - u) * 0.5;
    }
    out.a[i] = nu; out.b[i] = nv;
  }
  return out;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mixC = (a: number[], b: number[], t: number) => a.map((x, k) => x + (b[k] - x) * t);

/** The board's colours, as the node's view does it, into RGBA bytes. */
export function cpuColours(params: Record<string, unknown>, B: CpuBoard, out: Uint8ClampedArray): void {
  const P = { ...GRID_DEFAULTS, ...params };
  const s = gridShape(P);
  const C = (k: string) => (Array.isArray(P[k]) ? P[k] as number[] : GRID_DEFAULTS[k] as number[]);
  const N = Math.max(2, Math.round(Number(P.states)));
  for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) {
    const i = y * B.w + x;
    let col: number[];
    if (s.type === 'smooth') {
      const g = Number(P.gain);
      const k = clamp01(s.template === 'waves' ? B.a[i] * g * 0.5 + 0.5 : s.template === 'reaction' ? B.b[i] * 3 * g : B.a[i] * g);
      col = k < 1 / 3 ? mixC(C('color0'), C('color1'), k * 3) : k < 2 / 3 ? mixC(C('color1'), C('color2'), k * 3 - 1) : mixC(C('color2'), C('color3'), k * 3 - 2);
    } else {
      const st = Math.round(B.a[i]), g = clamp01(B.b[i]);
      const dead = mixC(C('color0'), C('glowColor'), g);
      const live = mixC(C('color1'), C('oldColor'), clamp01(Number(P.ageFade) * g));
      col = st === 0 ? dead : st === 1 ? live : s.type === 'stages' ? mixC(C('color2'), C('color3'), clamp01((st - 2) / Math.max(N - 3, 1))) : C(`color${Math.min(7, st)}`);
    }
    // Rows go up the board, down the canvas.
    const o = ((B.h - 1 - y) * B.w + x) * 4;
    out[o] = col[0] * 255; out[o + 1] = col[1] * 255; out[o + 2] = col[2] * 255; out[o + 3] = 255;
  }
}
