/**
 * fields.ts — the field builder behind "Follow a field" (docs/agent-builder.md "Follow a field"). Pure.
 *
 * A **field** is a velocity at every point of the picture: which way, and how fast, a particle
 * riding it would go. The card builds one from **layers** that add up, each with a weight:
 *
 *  - known fields from a gallery: curl noise (eddies), a vortex, a source or sink, a saddle, a
 *    dipole, waves, a uniform wind, a spiral (vortex + sink), a shear, or the slope of something
 *    in the graph (a picture's brightness, a shape's distance) read through Field ƒ;
 *  - **your own**: `vx = …`, `vy = …` (and `vz` in 3D) in x, y, t (and z), checked as the GPU will
 *    check them (glslPatterns parse and typecheck);
 *  - each layer can be turned (its velocity rotated), masked (only inside or outside a circle or a
 *    box) and animated (drifting, or spinning round its centre).
 *
 * One source of truth: `fieldLines` writes the layers as Expression Block lines (GLSL), and
 * `fieldFunction` runs those same lines on the CPU (glslPatterns' evaluator), so the arrows drawn
 * over the picture, the focus demo and the gallery tiles are the field the GPU runs, not a copy of
 * its maths. Only the slope layer can't be drawn: its field is a chain of nodes in the graph.
 */
import {
  type EvalEnv, type Expr, type GlslType, type Value,
  checkTypes, compileExpr, parseExpr, printExpr, walk, NAMED_CONSTANTS,
} from '../lib/glslPatterns';

export type FieldKind = 'curl' | 'vortex' | 'source' | 'saddle' | 'dipole' | 'waves' | 'wind' | 'spiral' | 'shear' | 'slope' | 'own';

/** Only inside (or outside) a circle (radius `size`) or a box (half-width `size`) round (x, y), picture units. */
export interface FieldMask { shape: 'circle' | 'box'; x: number; y: number; size: number; outside?: boolean }
/** Drift: the layer slides along `angle` at `speed` picture units a second (wrapping round the picture). Spin: it turns round its centre, `speed` degrees a second. */
export interface FieldAnimate { mode: 'drift' | 'spin'; speed: number; angle?: number }

export interface FieldLayer {
  kind: FieldKind;
  /** How much of it is added (its velocity times this). Negative turns it round. */
  weight: number;
  /** Its size: eddy size, a vortex's core, a wavelength, a shear's band… (FIELD_KINDS says which). */
  size?: number;
  /** Its centre (picture units). */
  x?: number; y?: number;
  /** Which way it points or lies, in degrees (0 right, 90 up). */
  angle?: number;
  /** Which way round: clockwise (vortex, spiral), in (source → sink), reversed (dipole, shear, waves), uphill (slope). */
  flip?: boolean;
  /** Slope only: round its contour lines instead of down the slope. */
  around?: boolean;
  /** Turn its velocity by this many degrees (a vortex turned −30° spirals in). */
  rotate?: number;
  mask?: FieldMask;
  animate?: FieldAnimate;
  /** Your own: the velocity's parts as GLSL expressions in x, y, t (and z in 3D). */
  vx?: string; vy?: string; vz?: string;
  off?: boolean;
}

export interface FieldSpec { layers: FieldLayer[] }

export interface FieldKindInfo {
  label: string;
  /** The tile's hover line. */
  hint: string;
  /** What its Size slider is called, and its range (none: no size). */
  size?: { label: string; min: number; max: number; hint: string };
  /** Has a centre (Across, Up). */
  centre?: boolean;
  /** Has a direction (Direction °). */
  angle?: boolean;
  /** Its "which way" choice: [off, on]. */
  flip?: [string, string];
  defaults: Omit<FieldLayer, 'kind'>;
}

export const FIELD_KINDS: Record<FieldKind, FieldKindInfo> = {
  curl: {
    label: 'Curl noise', hint: 'Eddies: swirls that never bunch particles up.',
    size: { label: 'Eddy size', min: 0.05, max: 2, hint: 'How wide one swirl is (picture units: the picture is 2 tall).' },
    defaults: { weight: 0.5, size: 0.4 },
  },
  vortex: {
    label: 'Vortex', hint: 'Round and round a point, fastest at its core\'s edge.',
    size: { label: 'Core', min: 0.02, max: 1.5, hint: 'How far out it is fastest; further out it slows.' }, centre: true, flip: ['↺ Anticlockwise', '↻ Clockwise'],
    defaults: { weight: 0.6, size: 0.3, x: 0, y: 0 },
  },
  source: {
    label: 'Source / sink', hint: 'Out from a point (a source) or into it (a sink).',
    size: { label: 'Core', min: 0.02, max: 1.5, hint: 'How far out it is fastest; further out it slows.' }, centre: true, flip: ['Out (source)', 'In (sink)'],
    defaults: { weight: 0.5, size: 0.3, x: 0, y: 0 },
  },
  saddle: {
    label: 'Saddle', hint: 'In from two sides, out the other two.',
    size: { label: 'Scale', min: 0.05, max: 2, hint: 'How far out it reaches full speed.' }, centre: true, angle: true,
    defaults: { weight: 0.5, size: 0.5, x: 0, y: 0, angle: 0 },
  },
  dipole: {
    label: 'Dipole', hint: 'Out of one pole and into the other, looping round.',
    size: { label: 'Spread', min: 0.05, max: 1.5, hint: 'How far each pole is from the centre.' }, centre: true, angle: true, flip: ['Left → right', 'Right → left'],
    defaults: { weight: 0.6, size: 0.4, x: 0, y: 0, angle: 0 },
  },
  waves: {
    label: 'Waves', hint: 'A flow that weaves from side to side.',
    size: { label: 'Wavelength', min: 0.05, max: 3, hint: 'From one crest to the next.' }, angle: true,
    defaults: { weight: 0.5, size: 0.6, angle: 0 },
  },
  wind: {
    label: 'Uniform wind', hint: 'The same push everywhere, one way.',
    angle: true,
    defaults: { weight: 0.4, angle: 0 },
  },
  spiral: {
    label: 'Spiral', hint: 'A vortex that drains into its middle.',
    size: { label: 'Core', min: 0.02, max: 1.5, hint: 'How far out it is fastest; further out it slows.' }, centre: true, flip: ['↺ Anticlockwise', '↻ Clockwise'],
    defaults: { weight: 0.6, size: 0.3, x: 0, y: 0 },
  },
  shear: {
    label: 'Shear', hint: 'One way on one side of a line, the other way on the other.',
    size: { label: 'Band', min: 0.02, max: 1.5, hint: 'How wide the change-over is.' }, centre: true, angle: true, flip: ['Top goes right', 'Top goes left'],
    defaults: { weight: 0.5, size: 0.3, x: 0, y: 0, angle: 0 },
  },
  slope: {
    label: 'Slope of a picture', hint: 'Down (or round) a picture or a shape in your graph, wired into Field ƒ.',
    flip: ['Downhill', 'Uphill'],
    defaults: { weight: 1 },
  },
  own: {
    label: 'Your own', hint: 'Write vx and vy in x, y and t.',
    defaults: { weight: 0.5, vx: '-y', vy: 'x' },
  },
};

/** The gallery's order. */
export const FIELD_GALLERY: readonly FieldKind[] = ['curl', 'vortex', 'source', 'saddle', 'dipole', 'waves', 'wind', 'spiral', 'shear', 'slope', 'own'];

export const newLayer = (kind: FieldKind): FieldLayer => ({ kind, ...structuredClone(FIELD_KINDS[kind].defaults) });
export const DEFAULT_FIELD: () => FieldSpec = () => ({ layers: [newLayer('vortex')] });

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
const isKind = (k: unknown): k is FieldKind => typeof k === 'string' && k in FIELD_KINDS;

/** A field read from saved data, anything missing filled in (never throws). Unknown layers are dropped. */
export function normalizeFieldSpec(raw: unknown): FieldSpec {
  const r = raw && typeof raw === 'object' ? raw as { layers?: unknown } : {};
  const layers = Array.isArray(r.layers) ? r.layers : [];
  return {
    layers: layers.filter((l): l is FieldLayer => !!l && typeof l === 'object' && isKind((l as FieldLayer).kind)).slice(0, MAX_LAYERS).map(l => {
      const d = FIELD_KINDS[l.kind].defaults;
      const out: FieldLayer = { kind: l.kind, weight: num(l.weight, d.weight) };
      for (const k of ['size', 'x', 'y', 'angle', 'rotate'] as const) if (typeof l[k] === 'number' && isFinite(l[k]!)) out[k] = l[k]; else if (d[k] !== undefined) out[k] = d[k];
      if (l.flip) out.flip = true;
      if (l.around) out.around = true;
      if (l.off) out.off = true;
      for (const k of ['vx', 'vy', 'vz'] as const) if (typeof l[k] === 'string') out[k] = l[k]; else if (d[k] !== undefined) out[k] = d[k];
      if (l.mask && typeof l.mask === 'object') out.mask = { shape: l.mask.shape === 'box' ? 'box' : 'circle', x: num(l.mask.x, 0), y: num(l.mask.y, 0), size: Math.max(0, num(l.mask.size, 0.5)), ...(l.mask.outside ? { outside: true } : {}) };
      if (l.animate && typeof l.animate === 'object') out.animate = { mode: l.animate.mode === 'spin' ? 'spin' : 'drift', speed: num(l.animate.speed, 0.1), ...(typeof l.animate.angle === 'number' ? { angle: l.animate.angle } : {}) };
      return out;
    }),
  };
}

export const MAX_LAYERS = 6;

// ── Your own: checking an expression ─────────────────────────────────────────

/** Built-ins an own expression may call: GLSL ES 3.0's that the CPU evaluator also runs, so it can be drawn. */
const OWN_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'exp2', 'log', 'log2', 'sqrt', 'inversesqrt',
  'abs', 'sign', 'floor', 'ceil', 'fract', 'round', 'trunc', 'mod', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'pow',
  'radians', 'degrees', 'length', 'distance', 'dot', 'normalize', 'float', 'vec2', 'vec3',
]);
const CONSTANTS = new Set(['PI', 'TAU']);

export interface OwnCheck { ok: boolean; error?: string; expr?: Expr }

/** The names an own expression may use. */
export const ownNames = (d3: boolean) => (d3 ? ['x', 'y', 'z', 't'] : ['x', 'y', 't']);

/**
 * Check one part of your own field (`vx`, `vy` or `vz`) as the GPU will: it parses, names only x,
 * y, t (z in 3D) and PI / TAU, calls only built-ins it can draw, and typechecks to a float under
 * GLSL ES 3.0's strict rules (`x * 2` is an error: 2 is an int). The error is one plain line.
 */
export function checkOwn(text: string | undefined, d3 = false): OwnCheck {
  const src = (text ?? '').trim();
  if (!src) return { ok: false, error: 'Write an expression (0.0 for none).' };
  const p = parseExpr(src);
  if (!p.ok) return { ok: false, error: p.error };
  const names = new Set(ownNames(d3));
  let bad: string | null = null;
  walk(p.expr, n => {
    if (bad) return;
    if (n.kind === 'ident' && !names.has(n.name) && !CONSTANTS.has(n.name)) {
      bad = n.name === 'z' ? 'z is only there in 3D.' : `${n.name} isn't known here: use ${ownNames(d3).join(', ')} (and PI, TAU).`;
    }
    if (n.kind === 'call' && !OWN_FUNCTIONS.has(n.callee)) bad = `${n.callee}() isn't available here: use the built-ins (sin, cos, length, atan, mix…).`;
  });
  if (bad) return { ok: false, error: bad };
  const env: Record<string, GlslType> = { x: 'float', y: 'float', z: 'float', t: 'float', PI: 'float', TAU: 'float' };
  const tc = checkTypes(p.expr, env);
  if (!tc.ok) {
    const e = tc.errors[0] ?? 'it doesn\'t typecheck';
    const ints = /\bint\b/.test(tc.errors.join(' ')) && !/2\.0/.test(e);
    return { ok: false, error: ints ? `${e}. Whole numbers need a decimal point here: write 2.0, not 2.` : e };
  }
  if (tc.type !== 'float' && tc.type !== 'unknown') return { ok: false, error: `It gives a ${tc.type}; each part is one number (a float).` };
  try {
    const v = compileExpr(p.expr)({ x: 0.31, y: -0.17, z: 0.05, t: 0.5 });
    if (typeof v !== 'number') return { ok: false, error: 'Each part is one number (a float).' };
  } catch (e) { return { ok: false, error: String((e as Error).message ?? e).replace(/^evaluate: /, '') }; }
  return { ok: true, expr: p.expr };
}

/** An own expression as GLSL for layer `i`: x, y → its local point, t → the clock, z → the walker's depth. */
function ownGlsl(e: Expr, i: number, P: string): string {
  const subst = new Map<number, string>();
  walk(e, n => {
    if (n.kind !== 'ident') return;
    if (n.name === 'x') subst.set(n.id, `q${i}.x`);
    else if (n.name === 'y') subst.set(n.id, `q${i}.y`);
    else if (n.name === 't') subst.set(n.id, 'u_time');
    else if (n.name === 'z') subst.set(n.id, `${P}.z`);
    else if (n.name in NAMED_CONSTANTS) subst.set(n.id, glf(NAMED_CONSTANTS[n.name]));
  });
  return printExpr(e, subst);
}

/** Examples to insert in your own field. */
export const OWN_EXAMPLES: ReadonlyArray<{ label: string; vx: string; vy: string; vz?: string }> = [
  { label: 'Whirlpool', vx: '-y', vy: 'x' },
  { label: 'Drain', vx: '-y - x * 0.6', vy: 'x - y * 0.6' },
  { label: 'Ripples', vx: 'sin(y * 6.0 + t)', vy: 'cos(x * 6.0 - t)' },
  { label: 'Four eddies', vx: 'sin(x * 3.0) * cos(y * 3.0)', vy: '-cos(x * 3.0) * sin(y * 3.0)' },
  { label: 'Rings', vx: '-y * sin(length(vec2(x, y)) * 9.0)', vy: 'x * sin(length(vec2(x, y)) * 9.0)' },
  { label: 'Pulse', vx: 'x * sin(t * 2.0)', vy: 'y * sin(t * 2.0)' },
];

// ── The layers as GLSL (an Expression Block's lines) ─────────────────────────

export interface FieldLine { lhs: string; op: string; rhs: string; why?: string }

/** A GLSL float literal. */
export const glf = (v: number): string => {
  const r = Math.round((isFinite(v) ? v : 0) * 1e6) / 1e6;
  const s = String(r);
  return /[.e]/.test(s) ? s : `${s}.0`;
};
const v2 = (x: number, y: number) => `vec2(${glf(x)}, ${glf(y)})`;
const DEG = Math.PI / 180;

/** Curl noise's four waves: directions, frequency multipliers and phases (fixed: the same field every run). */
const CURL_WAVES = [
  { a: 0.31, m: 1, p: 0.4 }, { a: 1.93, m: 1.37, p: 2.1 }, { a: 2.83, m: 0.83, p: 4.4 }, { a: 4.41, m: 1.71, p: 1.3 },
];
const CURL_NORM = 1 / Math.sqrt(CURL_WAVES.reduce((s, w) => s + w.m * w.m, 0) / 2);

/** Does a layer draw on the CPU (slope reads the graph: it can't)? */
export const drawable = (l: FieldLayer) => l.kind !== 'slope';

/** The layers that run: switched on, and an own layer only when every part checks. */
export function liveLayers(spec: FieldSpec, d3 = false): Array<{ layer: FieldLayer; i: number }> {
  return (spec?.layers ?? []).map((layer, k) => ({ layer, i: k + 1 })).filter(({ layer }) => !layer.off && (layer.kind !== 'own' || ownParts(layer, d3).every(p => p.check.ok)));
}

/** An own layer's parts, each checked. */
export function ownParts(l: FieldLayer, d3: boolean): Array<{ key: 'vx' | 'vy' | 'vz'; text: string; check: OwnCheck }> {
  const keys: Array<'vx' | 'vy' | 'vz'> = d3 ? ['vx', 'vy', 'vz'] : ['vx', 'vy'];
  return keys.map(k => ({ key: k, text: l[k] ?? (k === 'vz' ? '0.0' : ''), check: checkOwn(l[k] ?? (k === 'vz' ? '0.0' : ''), d3) }));
}

/**
 * The field as Expression Block lines. In 2D the block reads `pos` (vec2) and returns `f` (vec2);
 * in 3D it reads a vec3 and returns `vec3(f, fz)` (the known fields lie in the picture's plane;
 * your own can push in z). A slope layer reads `slope<i>` (vec2: a Flow node's push, wired in).
 */
export function fieldLines(spec: FieldSpec, d3 = false): { lines: FieldLine[]; result: string; slopes: number[] } {
  const P = 'pos';
  const PXY = d3 ? 'pos.xy' : 'pos';
  const lines: FieldLine[] = [];
  const add = (lhs: string, op: string, rhs: string, why?: string) => lines.push({ lhs, op, rhs, ...(why ? { why } : {}) });
  const slopes: number[] = [];
  add('vec2 f', '=', 'vec2(0.0)', 'f: the field\'s velocity here, the layers below added up (picture units a second).');
  if (d3) add('float fz', '=', '0.0', 'fz: its depth part (only your own layers push in z).');
  for (const { layer: l, i } of liveLayers(spec, d3)) {
    const info = FIELD_KINDS[l.kind];
    const name = info.label.toLowerCase();
    const s = Math.max(num(l.size, info.defaults.size ?? 0.5), 1e-3);
    const cx = num(l.x, 0), cy = num(l.y, 0);
    const an = l.animate;
    const sg = l.flip ? -1 : 1;
    if (l.kind === 'slope') {
      // The Flow node beside it reads Field ƒ's slope; its push is this layer's velocity.
      slopes.push(i);
      add(`vec2 v${i}`, '=', `slope${i}.xy`, `v${i}: ${name}: the push of the Flow node beside it (${l.around ? 'round the contours' : l.flip ? 'uphill' : 'downhill'} of the field wired into the group's Field ƒ).`);
    } else {
      // Its centre, drifting (wrapping round the picture) when it drifts.
      if (an?.mode === 'drift' && an.speed) {
        const d = num(an.angle, 0) * DEG;
        const move = `${v2(cx, cy)} + ${v2(Math.cos(d) * an.speed, Math.sin(d) * an.speed)} * u_time`;
        add(`vec2 c${i}`, '=', l.kind === 'curl' || l.kind === 'wind' || l.kind === 'waves' || l.kind === 'own' ? move : `mod(${move} + vec2(1.8, 1.0), vec2(3.6, 2.0)) - vec2(1.8, 1.0)`,
          `c${i}: where the ${name} is now: it drifts ${an.speed} a second toward ${num(an.angle, 0)}°.`);
      } else add(`vec2 c${i}`, '=', v2(cx, cy), `c${i}: the ${name}'s centre.`);
      add(`vec2 q${i}`, '=', `${PXY} - c${i}`, `q${i}: the walker seen from the ${name}'s centre.`);
      // Its frame: turned by Direction, and by the spin.
      const ang = info.angle ? num(l.angle, 0) : 0;
      const spin = an?.mode === 'spin' && an.speed ? an.speed : 0;
      let frame: { c: string; s: string } | null = null;
      if (spin) {
        add(`float a${i}`, '=', `${glf(ang * DEG)} + ${glf(spin * DEG)} * u_time`, `a${i}: the way it faces, turning ${spin}° a second.`);
        add(`float ca${i}`, '=', `cos(a${i})`); add(`float sa${i}`, '=', `sin(a${i})`);
        frame = { c: `ca${i}`, s: `sa${i}` };
      } else if (ang) frame = { c: glf(Math.cos(ang * DEG)), s: glf(Math.sin(ang * DEG)) };
      if (frame) add(`q${i}`, '=', `vec2(${frame.c} * q${i}.x + ${frame.s} * q${i}.y, ${frame.c} * q${i}.y - ${frame.s} * q${i}.x)`, `q${i}: in the ${name}'s own frame (turned back by its direction).`);
      const q = `q${i}`;
      switch (l.kind) {
        case 'curl': {
          const F = Math.PI / s;
          const g = CURL_WAVES.map(w => `cos(dot(${q}, ${v2(Math.cos(w.a), Math.sin(w.a))}) * ${glf(F * w.m)} + ${glf(w.p)}) * ${v2(Math.cos(w.a) * w.m, Math.sin(w.a) * w.m)}`).join(' + ');
          add(`vec2 g${i}`, '=', g, `g${i}: the slope of a stream function, four waves of eddies ${s} across.`);
          add(`vec2 v${i}`, '=', `vec2(g${i}.y, -g${i}.x) * ${glf(CURL_NORM)}`, `v${i}: curl noise: the stream function's slope turned a quarter, so it only swirls (it never bunches particles up).`);
          break;
        }
        case 'vortex':
          add(`vec2 v${i}`, '=', `${glf(2 * s * sg)} * vec2(-${q}.y, ${q}.x) / (dot(${q}, ${q}) + ${glf(s * s)})`, `v${i}: round the centre ${l.flip ? 'clockwise' : 'anticlockwise'}, fastest (1) at ${s} out, slower further away.`);
          break;
        case 'source':
          add(`vec2 v${i}`, '=', `${glf(2 * s * sg)} * ${q} / (dot(${q}, ${q}) + ${glf(s * s)})`, `v${i}: straight ${l.flip ? 'in to' : 'out from'} the centre, fastest (1) at ${s} out.`);
          break;
        case 'spiral':
          add(`vec2 v${i}`, '=', `${glf(2 * s)} * (vec2(-${q}.y, ${q}.x) * ${glf(sg)} - ${q} * 0.6) / (dot(${q}, ${q}) + ${glf(s * s)})`, `v${i}: round the centre ${l.flip ? 'clockwise' : 'anticlockwise'} and in toward it (a vortex and a sink).`);
          break;
        case 'saddle':
          add(`vec2 v${i}`, '=', `2.0 * vec2(${q}.x, -${q}.y) / (${glf(s)} + length(${q}))`, `v${i}: in along one line and out along the other, full speed ${s} out.`);
          break;
        case 'dipole':
          add(`vec2 da${i}`, '=', `${q} + ${v2(s, 0)}`, `da${i}: from the pole it flows out of.`);
          add(`vec2 db${i}`, '=', `${q} - ${v2(s, 0)}`, `db${i}: from the pole it flows into.`);
          add(`vec2 v${i}`, '=', `${glf(s * sg)} * (da${i} / (dot(da${i}, da${i}) + ${glf(s * s * 0.25)}) - db${i} / (dot(db${i}, db${i}) + ${glf(s * s * 0.25)}))`, `v${i}: out of one pole and into the other, ${s} each side of the centre.`);
          break;
        case 'waves':
          add(`vec2 v${i}`, '=', `${glf(sg / 1.5)} * vec2(1.0, 2.5 * cos(${q}.x * ${glf(2 * Math.PI / s)}))`, `v${i}: along, weaving from side to side every ${s}.`);
          break;
        case 'wind':
          add(`vec2 v${i}`, '=', 'vec2(1.0, 0.0)', `v${i}: the same everywhere, along its direction.`);
          break;
        case 'shear':
          add(`vec2 v${i}`, '=', `vec2(${glf(sg)} * tanh(${q}.y / ${glf(s)}), 0.0)`, `v${i}: one way on one side of its line, the other way on the other, changing over within ${s}.`);
          break;
        case 'own': {
          const parts = ownParts(l, d3);
          const g = (k: 'vx' | 'vy' | 'vz') => ownGlsl(parts.find(p => p.key === k)!.check.expr!, i, P);
          add(`vec2 v${i}`, '=', `vec2(${g('vx')}, ${g('vy')})`, `v${i}: your own field: vx = ${l.vx}, vy = ${l.vy} (x, y from its centre, t the clock).`);
          if (d3) add('fz', '+=', `${glf(l.weight)} * (${g('vz')})`, `fz: your own depth part: vz = ${l.vz ?? '0.0'}.`);
          break;
        }
      }
      if (frame) add(`v${i}`, '=', `vec2(${frame.c} * v${i}.x - ${frame.s} * v${i}.y, ${frame.s} * v${i}.x + ${frame.c} * v${i}.y)`, `v${i}: turned back to the picture's frame.`);
    }
    if (l.rotate) {
      const r = l.rotate * DEG;
      add(`v${i}`, '=', `vec2(${glf(Math.cos(r))} * v${i}.x - ${glf(Math.sin(r))} * v${i}.y, ${glf(Math.sin(r))} * v${i}.x + ${glf(Math.cos(r))} * v${i}.y)`, `v${i}: turned ${l.rotate}°.`);
    }
    let w = glf(l.weight);
    if (l.mask) {
      const m = l.mask;
      const dist = m.shape === 'circle' ? `length(${PXY} - ${v2(m.x, m.y)})` : `max(abs(${PXY}.x - ${glf(m.x)}), abs(${PXY}.y - ${glf(m.y)}))`;
      const edge = `smoothstep(${glf(Math.max(m.size, 0) - 0.02)}, ${glf(Math.max(m.size, 0) + 0.02)}, ${dist})`;
      add(`float m${i}`, '=', m.outside ? edge : `1.0 - ${edge}`, `m${i}: 1 ${m.outside ? 'outside' : 'inside'} a ${m.shape} round (${m.x}, ${m.y}), ${m.shape === 'circle' ? 'radius' : 'half-width'} ${m.size}, 0 elsewhere (a soft edge).`);
      w = `${w} * m${i}`;
    }
    add('f', '+=', `${w} * v${i}`, `f: plus the ${name} × ${l.weight}${l.mask ? ` ${l.mask.outside ? 'outside' : 'inside'} its ${l.mask.shape}` : ''}.`);
  }
  return { lines, result: d3 ? 'vec3(f, fz)' : 'f', slopes };
}

// ── The same lines on the CPU ────────────────────────────────────────────────

export type FieldFn = (x: number, y: number, t?: number, z?: number) => [number, number, number];

const fnCache = new Map<string, FieldFn>();
const ZERO: FieldFn = () => [0, 0, 0];

/**
 * The field as a function of position and time, running `fieldLines` on the CPU (cached by the
 * spec: the same field is compiled once). Slope layers give nothing here (their field is the graph's).
 */
export function fieldFunction(spec: FieldSpec, d3 = false): FieldFn {
  const key = `${d3 ? 3 : 2}:${JSON.stringify(spec)}`;
  const hit = fnCache.get(key);
  if (hit) return hit;
  const { lines, result } = fieldLines(spec, d3);
  const steps: Array<{ name: string; part?: string; op: string; run: (env: EvalEnv) => Value }> = [];
  try {
    for (const l of lines) {
      const p = parseExpr(l.rhs);
      if (!p.ok) throw new Error(p.error);
      const target = l.lhs.trim().split(/\s+/).pop()!;
      const [name, part] = target.split('.');
      steps.push({ name, part, op: l.op, run: compileExpr(p.expr) });
    }
  } catch { fnCache.set(key, ZERO); return ZERO; }
  const res = parseExpr(result);
  const out = res.ok ? compileExpr(res.expr) : () => [0, 0];
  const fn: FieldFn = (x, y, t = 0, z = 0) => {
    const env: EvalEnv = { pos: d3 ? [x, y, z] : [x, y], u_time: t };
    let i = 0;
    for (const sl of spec.layers) { i++; if (sl.kind === 'slope') env[`slope${i}`] = [0, 0]; }
    try {
      for (const s of steps) {
        const v = s.run(env);
        const prev = env[s.name];
        if (s.op === '=') env[s.name] = v;
        else if (s.op === '+=') env[s.name] = Array.isArray(prev) ? prev.map((p, k) => p + ((v as number[])[k] ?? 0)) : (prev as number) + (v as number);
      }
      const r = out(env) as number[];
      return [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0];
    } catch { return [0, 0, 0]; }
  };
  if (fnCache.size > 48) fnCache.delete(fnCache.keys().next().value!);
  fnCache.set(key, fn);
  return fn;
}

/** One layer alone (weight, rotate, mask and animation kept), for drawing it lit. */
export const layerSpec = (spec: FieldSpec, k: number): FieldSpec => ({ layers: spec.layers.map((l, j) => (j === k ? { ...l, off: undefined } : { ...l, off: true })) });

/** Arrows of a field over a picture rect (screen px; the picture ±aspect across, ±1 up): start, end and how strong (0–1 of the strongest). */
export function fieldArrows(rect: { x: number; y: number; w: number; h: number }, fn: FieldFn, cols = 16, t = 0): Array<{ from: { x: number; y: number }; to: { x: number; y: number }; k: number; at: { x: number; y: number } }> {
  const aspect = rect.w / Math.max(rect.h, 1);
  const rows = Math.max(3, Math.round(cols / aspect));
  const cell = rect.w / cols;
  const pts: Array<{ px: number; py: number; vx: number; vy: number; m: number }> = [];
  let top = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const px = rect.x + (i + 0.5) * cell, py = rect.y + (j + 0.5) * (rect.h / rows);
    const x = ((px - rect.x) / rect.w - 0.5) * 2 * aspect, y = (0.5 - (py - rect.y) / rect.h) * 2;
    const [vx, vy] = fn(x, y, t);
    const m = Math.hypot(vx, vy);
    top = Math.max(top, m);
    pts.push({ px, py, vx, vy, m });
  }
  return pts.map(({ px, py, vx, vy, m }) => {
    const k = top > 1e-6 ? m / top : 0;
    const len = cell * 0.42 * Math.min(1, 0.25 + k);
    const ux = m > 1e-6 ? vx / m : 0, uy = m > 1e-6 ? vy / m : 0;
    return { from: { x: px - ux * len, y: py + uy * len }, to: { x: px + ux * len, y: py - uy * len }, k, at: { x: px, y: py } };
  });
}

/**
 * Particles riding a field from `starts` for `seconds` (30 steps a second): their tracks, wrapped in
 * `box`. Push: the field is a force (strength × field a second², slowed by a little drag so they
 * don't fly off). Ride (grip > 0): the velocity eases to strength × field at `grip` a second.
 */
export function rideField(fn: FieldFn, starts: ReadonlyArray<{ x: number; y: number }>, o: { seconds: number; strength: number; grip?: number; box: { x0: number; y0: number; x1: number; y1: number }; fps?: number }): Array<Array<{ x: number; y: number }>> {
  const fps = o.fps ?? 30, dt = 1 / fps;
  const wrap = (v: number, lo: number, hi: number) => (v < lo ? v + (hi - lo) : v > hi ? v - (hi - lo) : v);
  return starts.map(p0 => {
    let p = { ...p0 }, v = { x: 0, y: 0 };
    const out = [{ ...p }];
    for (let k = 1; k <= o.seconds * fps; k++) {
      const [fx, fy] = fn(p.x, p.y, k * dt);
      if (o.grip && o.grip > 0) {
        const a = 1 - Math.exp(-o.grip * dt);
        v = { x: v.x + (fx * o.strength - v.x) * a, y: v.y + (fy * o.strength - v.y) * a };
      } else {
        const keep = Math.exp(-0.8 * dt);
        v = { x: (v.x + fx * o.strength * dt) * keep, y: (v.y + fy * o.strength * dt) * keep };
      }
      p = { x: wrap(p.x + v.x * dt, o.box.x0, o.box.x1), y: wrap(p.y + v.y * dt, o.box.y0, o.box.y1) };
      out.push(p);
    }
    return out;
  });
}

// ── Saving the field in the language (agents dialect) ────────────────────────

/** The layers as one string the agents language can carry in quotes (JSON with ' for "). */
export const fieldToText = (spec: FieldSpec): string => JSON.stringify(normalizeFieldSpec(spec)).replace(/"/g, '\'');
/** Back from `fieldToText` (null when it isn't one). */
export function fieldFromText(text: string): FieldSpec | null {
  try { return normalizeFieldSpec(JSON.parse(text.replace(/'/g, '"'))); } catch { return null; }
}

/** A short name for a field: "vortex + curl noise × 0.3". */
export function fieldName(spec: FieldSpec): string {
  const on = (spec?.layers ?? []).filter(l => !l.off);
  if (!on.length) return 'no layers';
  const w0 = on[0].weight;
  const masked = on.find(l => l.mask)?.mask;
  return on.map((l, i) => {
    const n = l.kind === 'slope' ? 'slope' : FIELD_KINDS[l.kind].label.toLowerCase();
    return i > 0 && w0 && Math.abs(l.weight / w0 - 1) > 1e-3 ? `${n} × ${Math.round(l.weight / w0 * 100) / 100}` : n;
  }).join(' + ') + (masked ? `, ${masked.outside ? 'outside' : 'inside'} a ${masked.shape}` : '');
}
