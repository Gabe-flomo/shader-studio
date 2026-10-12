/**
 * modify.ts — the 2D Scene Builder's Modify section (docs/scene-builder-2d.md, "Modify"): operations
 * on a shape's (or a combine's) distance, before it is drawn. Each is a card in a stack per item,
 * applied top to bottom, built as one Expression Block whose numbers are sliders (live uniforms,
 * wireable on the node).
 *
 *   onion     abs(d) − width, a disc into a ring; Count repeats it (concentric rings)
 *   negate    −d: inside and outside swap
 *   ripples   d + amount · sin(d · freq − t · speed): rings near the edge that travel
 *   grow      d − r: grows (or, below 0, shrinks) and rounds
 *   bands     the distance repeated every Period: rings of Width all the way out
 *   displace  d pushed by smooth noise read at the point (Scale, Speed)
 *   abs       abs(d): a fold, both sides of the edge alike
 *   custom    d = f(d), one line checked like a space block (d, x, y, uv, t, PI, TAU and its sliders)
 *
 * Pure: no React, no store.
 */
import { checkLine, type BlockParam } from './blocks';

export type ModKind = 'onion' | 'negate' | 'ripples' | 'grow' | 'bands' | 'displace' | 'abs' | 'custom';

export interface ModParamDef { key: string; label: string; def: number; min: number; max: number; step: number; hint: string; integer?: boolean }

export interface ModDef {
  kind: ModKind;
  label: string;
  /** Recipe words (the first is printed). */
  words: string[];
  blurb: string;
  params: ModParamDef[];
  /** Reads the point (uv) or time (t). */
  uv?: boolean;
  time?: boolean;
}

const P = (key: string, label: string, def: number, min: number, max: number, step: number, hint: string, integer = false): ModParamDef => ({ key, label, def, min, max, step, hint, integer });

export const MODS: ModDef[] = [
  { kind: 'onion', label: 'Ring (onion)', words: ['onion', 'shell'], blurb: 'abs(d) − width: the edge becomes a ring of that width. Count above 1 does it again, ring inside ring.',
    params: [P('width', 'Width', 0.02, 0.001, 0.3, 0.001, 'Half the ring\'s thickness.'), P('count', 'Count', 1, 1, 6, 1, 'How many times: each doubles the rings.', true)] },
  { kind: 'negate', label: 'Invert', words: ['negate', 'invert'], blurb: '−d: inside becomes outside. The shape becomes a hole in a filled frame.', params: [] },
  { kind: 'ripples', label: 'Ripples', words: ['ripples', 'ripple', 'waves'], time: true,
    blurb: 'd + amount · sin(d · freq − t · speed): rings that follow the outline, within Amount of the edge, travelling out (speed above 0) or in.',
    params: [P('freq', 'Frequency', 40, 1, 160, 0.5, 'Rings per unit of distance.'), P('speed', 'Speed', 2, -10, 10, 0.05, 'How fast they travel (radians a second). 0 stands still.'), P('amount', 'Amount', 0.06, 0, 0.5, 0.002, 'How far from the edge the rings reach (0: none).')] },
  { kind: 'grow', label: 'Grow / shrink', words: ['grow', 'round', 'shrink'], blurb: 'd − r: the edge moves out by r (rounding corners); below 0 it moves in.',
    params: [P('r', 'By', 0.03, -0.3, 0.3, 0.002, 'Above 0 grows, below 0 shrinks.')] },
  { kind: 'bands', label: 'Repeat rings', words: ['bands', 'repeat-rings', 'contours'], blurb: 'The distance repeated every Period: rings of Width all the way out, like contour lines.',
    params: [P('period', 'Period', 0.12, 0.01, 1, 0.005, 'The gap from one ring to the next.'), P('width', 'Width', 0.01, 0.001, 0.2, 0.001, 'Half each ring\'s thickness.')] },
  { kind: 'displace', label: 'Displace', words: ['displace', 'noise'], uv: true, time: true, blurb: 'Pushes the edge in and out by smooth noise read at the point: an organic, wobbly outline.',
    params: [P('amount', 'Amount', 0.05, 0, 0.5, 0.002, 'How far the edge moves.'), P('scale', 'Scale', 4, 0.2, 30, 0.1, 'The noise\'s size: bigger is finer.'), P('speed', 'Speed', 0.3, -3, 3, 0.01, 'How fast the noise drifts. 0 stands still.')] },
  { kind: 'abs', label: 'Fold (abs)', words: ['abs', 'fold'], blurb: 'abs(d): the inside folded out, so both sides of the edge read alike (an outline with no width).', params: [] },
  { kind: 'custom', label: 'f(d)', words: ['fd', 'f'], uv: true, time: true,
    blurb: 'Your own line, d = f(d): any expression of d (the distance), x, y, uv (the point), t, PI, TAU and the sliders you add, checked as you type like a space block.',
    params: [] },
];
export const MOD_BY_KIND = Object.fromEntries(MODS.map(m => [m.kind, m])) as Record<ModKind, ModDef>;
export const MOD_WORDS: Record<string, ModKind> = Object.fromEntries(MODS.flatMap(m => m.words.map(w => [w, m.kind])));

export interface DistMod {
  id: string;
  kind: ModKind;
  /** Numbers by ModParamDef key (custom: its sliders by name). */
  values: Record<string, number>;
  /** custom: the right-hand side of d = …. */
  expr?: string;
  /** custom: its sliders' ranges. */
  sliders?: Array<{ name: string; min: number; max: number }>;
  muted?: boolean;
}

export function newMod(kind: ModKind, id: string, over: Partial<DistMod> = {}): DistMod {
  const d = MOD_BY_KIND[kind];
  return { id, kind, values: Object.fromEntries(d.params.map(p => [p.key, p.def])), ...(kind === 'custom' ? { expr: 'd - 0.05 * sin(d * 40.0 - t * 3.0)' } : {}), ...over };
}

/** A custom line's sliders as block params (checking and building). */
export function customParams(m: DistMod): BlockParam[] {
  return Object.entries(m.values).map(([name, value]) => {
    const r = m.sliders?.find(s => s.name === name);
    return { name, value, min: r?.min ?? Math.min(0, value * 2), max: r?.max ?? Math.max(1, value * 2) };
  });
}

/** A custom line checked: d is a number, the rest as in a space block. Ok gives the GLSL. */
export function checkCustom(m: DistMod): { ok: true; glsl: string } | { ok: false; error: string } {
  const rhs = (m.expr ?? '').trim();
  if (!rhs) return { ok: false, error: 'Write d = something: an expression of d (the distance).' };
  const chk = checkLine({ target: 'uv.x', op: '=', rhs }, [{ name: 'd', value: 0, min: 0, max: 1 }, ...customParams(m)]);
  if (!chk.ok || !chk.glsl) return { ok: false, error: (chk.error ?? 'It doesn\'t check.').replace(/uv\.x is one number/, 'd is one number') };
  return { ok: true, glsl: chk.glsl };
}

/** What a modifier's Expression Block computes: its lines and its result (d after it), or an error. */
export function modGlsl(m: DistMod): { lines: Array<{ lhs: string; op: string; rhs: string }>; result: string } | { error: string } {
  switch (m.kind) {
    case 'onion': {
      const n = Math.max(1, Math.min(6, Math.round(m.values.count ?? 1)));
      return { lines: Array.from({ length: n }, (_, i) => ({ lhs: 'd', op: '=', rhs: `abs(d) - width${i ? ' * pow(0.5, ' + i + '.0)' : ''}` })), result: 'd' };
    }
    case 'negate': return { lines: [], result: '-d' };
    case 'ripples': return { lines: [], result: 'd + amount * sin(d * freq - t * speed)' };
    case 'grow': return { lines: [], result: 'd - r' };
    case 'bands': return { lines: [], result: 'abs(mod(d + period * 0.5, period) - period * 0.5) - width' };
    case 'displace': return { lines: [], result: 'd + amount * (valueNoise(uv * scale + vec2(t * speed, 0.0)) * 2.0 - 1.0)' };
    case 'abs': return { lines: [], result: 'abs(d)' };
    case 'custom': {
      const c = checkCustom(m);
      return c.ok ? { lines: [], result: c.glsl } : { error: c.error };
    }
  }
}

/** Does the built line read the point or time? (Custom: only when it names them.) */
export function modReads(m: DistMod): { uv: boolean; t: boolean } {
  if (m.kind !== 'custom') return { uv: !!MOD_BY_KIND[m.kind].uv, t: !!MOD_BY_KIND[m.kind].time };
  const e = m.expr ?? '';
  return { uv: /\b(uv|x|y)\b/.test(e), t: /\bt\b/.test(e) };
}

/** The card's one-line summary. */
export function modSummary(m: DistMod): string {
  const d = MOD_BY_KIND[m.kind];
  if (m.kind === 'custom') return `d = ${m.expr ?? ''}`;
  const first = d.params[0];
  return first ? `${first.label.toLowerCase()} ${+(m.values[first.key] ?? first.def).toFixed(3)}` : d.blurb.split(':')[0];
}
