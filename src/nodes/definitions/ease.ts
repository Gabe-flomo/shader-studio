/**
 * Ease (docs/ease-node.md): the named easing curves motion designers know (Sine, Cubic, Back, Elastic, Bounce…),
 * In / Out / In-Out / Out-In, with From → To on the output, so "move from A to B with ease-out back" is one node.
 * With Value unwired it drives itself from Time: Once, Repeat or Ping-pong, with a Duration and a Hold at each end.
 *
 * The curves are Robert Penner's easing equations (BSD licence, robertpenner.com/easing) in the forms
 * easings.net gives them. Every curve is written once as its "In" form; Out, In-Out and Out-In are built from it
 * (Out(x) = 1 − In(1 − x), and so on), so all four directions match easings.net's In and Out exactly and its
 * In-Out for every curve but Back and Elastic (whose In-Out easings.net tunes separately).
 *
 * Curve, Direction and Loop are picked when the shader is built (one small GLSL function per Curve × Direction);
 * Duration, Hold, Amount, Steps, From and To are live sliders (uniforms, no recompile).
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';

// ── The curves ─────────────────────────────────────────────────────────────────

export type EaseCurve = 'linear' | 'sine' | 'quad' | 'cubic' | 'quart' | 'quint' | 'expo' | 'circ' | 'back' | 'elastic' | 'bounce' | 'steps';
export type EaseDirection = 'in' | 'out' | 'inOut' | 'outIn';
export type EaseLoop = 'once' | 'repeat' | 'pingpong';

export const EASE_CURVES: ReadonlyArray<{ value: EaseCurve; label: string; hint: string }> = [
  { value: 'linear', label: 'Linear', hint: 'Constant speed, no easing: mechanical.' },
  { value: 'sine', label: 'Sine', hint: 'The gentlest ease: soft and natural.' },
  { value: 'quad', label: 'Quad', hint: 'A light ease (x²): the everyday choice.' },
  { value: 'cubic', label: 'Cubic', hint: 'A firmer ease (x³): clearly slow at the ends.' },
  { value: 'quart', label: 'Quart', hint: 'Strong (x⁴): a long, slow start or finish.' },
  { value: 'quint', label: 'Quint', hint: 'Stronger still (x⁵): almost still, then quick.' },
  { value: 'expo', label: 'Expo', hint: 'The most extreme: hardly moves, then rushes.' },
  { value: 'circ', label: 'Circ', hint: 'A quarter circle: a sudden, sharp change of pace.' },
  { value: 'back', label: 'Back (overshoot)', hint: 'Pulls back first (In) or goes past the end and settles (Out). Amount sets how far.' },
  { value: 'elastic', label: 'Elastic', hint: 'Springs about the end like a plucked ruler. Amount sets how many wobbles.' },
  { value: 'bounce', label: 'Bounce', hint: 'Bounces against the end like a dropped ball (Out).' },
  { value: 'steps', label: 'Steps', hint: 'A staircase: jumps in Steps equal steps, no motion between.' },
];
export const EASE_DIRECTIONS: ReadonlyArray<{ value: EaseDirection; label: string; hint: string }> = [
  { value: 'in', label: 'In', hint: 'The curve at the start: slow away, fast arrival.' },
  { value: 'out', label: 'Out', hint: 'The curve at the end: fast away, slow arrival. The usual one for things arriving.' },
  { value: 'inOut', label: 'In-Out', hint: 'Slow at both ends, fast in the middle.' },
  { value: 'outIn', label: 'Out-In', hint: 'Fast at both ends, slow in the middle.' },
];
export const EASE_LOOPS: ReadonlyArray<{ value: EaseLoop; label: string; hint: string }> = [
  { value: 'once', label: 'Once', hint: 'Waits Hold seconds, moves over Duration, then stays at the end.' },
  { value: 'repeat', label: 'Repeat', hint: 'Moves, holds at the end, jumps back to the start, holds, and again.' },
  { value: 'pingpong', label: 'Ping-pong', hint: 'There and back: the move plays forwards, holds, then plays backwards, holds.' },
];

const CURVE_SET = new Set<string>(EASE_CURVES.map(c => c.value));
const DIR_SET = new Set<string>(EASE_DIRECTIONS.map(d => d.value));
const LOOP_SET = new Set<string>(EASE_LOOPS.map(l => l.value));
export const easeCurveOf = (params: Record<string, unknown>): EaseCurve => (CURVE_SET.has(String(params.curve)) ? params.curve as EaseCurve : 'cubic');
export const easeDirectionOf = (params: Record<string, unknown>): EaseDirection => (DIR_SET.has(String(params.direction)) ? params.direction as EaseDirection : 'inOut');
export const easeLoopOf = (params: Record<string, unknown>): EaseLoop => (LOOP_SET.has(String(params.loop)) ? params.loop as EaseLoop : 'pingpong');

/** The curves that read Amount, and the one that reads Steps. */
const WITH_AMOUNT: EaseCurve[] = ['back', 'elastic'];

// ── JavaScript reference (the card's curve, and the tests) ───────────────────────

const BACK_C1 = 1.70158;
/** Penner's easeOutBounce (easings.net). */
export function bounceOut(x: number): number {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) { x -= 1.5 / d1; return n1 * x * x + 0.75; }
  if (x < 2.5 / d1) { x -= 2.25 / d1; return n1 * x * x + 0.9375; }
  x -= 2.625 / d1; return n1 * x * x + 0.984375;
}

/** A curve's In form at x in 0…1. `a` is Amount (Back, Elastic) or the Steps count (Steps). */
export function easeInJs(curve: EaseCurve, x: number, a = 1): number {
  switch (curve) {
    case 'linear': return x;
    case 'sine': return 1 - Math.cos(x * Math.PI / 2);
    case 'quad': return x * x;
    case 'cubic': return x * x * x;
    case 'quart': return x * x * x * x;
    case 'quint': return x * x * x * x * x;
    case 'expo': return x <= 0 ? 0 : Math.pow(2, 10 * x - 10);
    case 'circ': return 1 - Math.sqrt(Math.max(0, 1 - x * x));
    case 'back': { const c1 = BACK_C1 * a, c3 = c1 + 1; return c3 * x * x * x - c1 * x * x; }
    case 'elastic': {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      const per = 0.3 / Math.max(a, 0.05);
      return -Math.pow(2, 10 * x - 10) * Math.sin((x - 1 - per * 0.25) * 2 * Math.PI / per);
    }
    case 'bounce': return 1 - bounceOut(1 - x);
    case 'steps': { const n = Math.max(Math.floor(a + 0.5), 1); return Math.floor(x * n) / n; }
  }
}

/** The eased value at progress x (clamped to 0…1), in the given direction. */
export function easeJs(curve: EaseCurve, dir: EaseDirection, x: number, a = 1): number {
  x = Math.min(Math.max(x, 0), 1);
  const e = (v: number) => easeInJs(curve, v, a);
  switch (dir) {
    case 'in': return e(x);
    case 'out': return 1 - e(1 - x);
    case 'inOut': return x < 0.5 ? 0.5 * e(2 * x) : 1 - 0.5 * e(2 - 2 * x);
    case 'outIn': return x < 0.5 ? 0.5 - 0.5 * e(1 - 2 * x) : 0.5 + 0.5 * e(2 * x - 1);
  }
}

const glslMod = (x: number, y: number) => x - y * Math.floor(x / y);
/** Progress 0…1 at time t when the node drives itself (Value unwired). */
export function easeLoopProgress(loop: EaseLoop, t: number, duration: number, hold: number): number {
  const d = Math.max(duration, 0.0001), h = Math.max(hold, 0);
  const c = (v: number) => Math.min(Math.max(v, 0), 1);
  if (loop === 'once') return c((t - h) / d);
  if (loop === 'repeat') return c((glslMod(t, d + 2 * h) - h) / d);
  const half = d + h, l = glslMod(t, 2 * half);
  return l < half ? c((l - h) / d) : 1 - c((l - half - h) / d);
}

// ── GLSL ───────────────────────────────────────────────────────────────────────

const BOUNCE_OUT_GLSL = `float ssEaseBounceOut(float x){
  float n1 = 7.5625; float d1 = 2.75;
  if (x < 1.0 / d1) return n1 * x * x;
  if (x < 2.0 / d1) { x -= 1.5 / d1; return n1 * x * x + 0.75; }
  if (x < 2.5 / d1) { x -= 2.25 / d1; return n1 * x * x + 0.9375; }
  x -= 2.625 / d1; return n1 * x * x + 0.984375;
}`;

/** The body of a curve's In form, `x` in 0…1, `a` its Amount or Steps. */
const IN_BODY: Record<EaseCurve, string> = {
  linear: 'return x;',
  sine: 'return 1.0 - cos(x * 1.5707963);',
  quad: 'return x * x;',
  cubic: 'return x * x * x;',
  quart: 'return x * x * x * x;',
  quint: 'return x * x * x * x * x;',
  expo: 'return x <= 0.0 ? 0.0 : pow(2.0, 10.0 * x - 10.0);',
  circ: 'return 1.0 - sqrt(max(0.0, 1.0 - x * x));',
  back: 'float c1 = 1.70158 * a; float c3 = c1 + 1.0; return c3 * x * x * x - c1 * x * x;',
  elastic: 'if (x <= 0.0) return 0.0; if (x >= 1.0) return 1.0; float per = 0.3 / max(a, 0.05); return -pow(2.0, 10.0 * x - 10.0) * sin((x - 1.0 - per * 0.25) * 6.2831853 / per);',
  bounce: 'return 1.0 - ssEaseBounceOut(1.0 - x);',
  steps: 'float n = max(floor(a + 0.5), 1.0); return floor(x * n) / n;',
};

const DIR_BODY: Record<EaseDirection, (fn: string) => string> = {
  in: fn => `return ${fn}(x, a);`,
  out: fn => `return 1.0 - ${fn}(1.0 - x, a);`,
  inOut: fn => `return x < 0.5 ? 0.5 * ${fn}(2.0 * x, a) : 1.0 - 0.5 * ${fn}(2.0 - 2.0 * x, a);`,
  outIn: fn => `return x < 0.5 ? 0.5 - 0.5 * ${fn}(1.0 - 2.0 * x, a) : 0.5 + 0.5 * ${fn}(2.0 * x - 1.0, a);`,
};

const LOOP_BODY: Record<EaseLoop, string> = {
  once: 'return clamp((t - h) / d, 0.0, 1.0);',
  repeat: 'return clamp((mod(t, d + 2.0 * h) - h) / d, 0.0, 1.0);',
  pingpong: 'float half1 = d + h; float l = mod(t, 2.0 * half1); return l < half1 ? clamp((l - h) / d, 0.0, 1.0) : 1.0 - clamp((l - half1 - h) / d, 0.0, 1.0);',
};

/** The name of the GLSL function that eases x (0…1) for this Curve × Direction. */
export const easeFnName = (curve: EaseCurve, dir: EaseDirection) => `ssEase_${curve}_${dir}`;
const loopFnName = (loop: EaseLoop) => `ssEaseLoop_${loop}`;

/** The GLSL helper functions a Curve × Direction (and, self-driven, a Loop) needs, each declared before use. */
export function easeGlslFunctions(curve: EaseCurve, dir: EaseDirection, loop?: EaseLoop): string[] {
  const inFn = `ssEaseIn_${curve}`;
  return [
    ...(curve === 'bounce' ? [BOUNCE_OUT_GLSL] : []),
    `float ${inFn}(float x, float a){ ${IN_BODY[curve]} }`,
    `float ${easeFnName(curve, dir)}(float x, float a){ x = clamp(x, 0.0, 1.0); ${DIR_BODY[dir](inFn)} }`,
    ...(loop ? [`float ${loopFnName(loop)}(float t, float d, float h){ d = max(d, 0.0001); h = max(h, 0.0); ${LOOP_BODY[loop]} }`] : []),
  ];
}

// ── The node ───────────────────────────────────────────────────────────────────

export const EaseNode: NodeDefinition = withParamSockets({
  type: 'ease',
  label: 'Ease',
  category: 'Animation',
  aliases: ['Easing', 'Tween', 'Ease in', 'Ease out', 'Ease in out', 'Penner', 'Overshoot', 'Motion curve'],
  searchOptions: ['curve'],
  description: 'Moves a value from From to To along a named easing curve (Sine, Cubic, Back, Elastic, Bounce…), In, Out, In-Out or Out-In. Wire a 0 to 1 progress into Value, or leave it unwired and it plays by itself from Time: Once, Repeat or Ping-pong, Duration seconds a move, holding Hold seconds at each end.',
  inputs: {
    value: { type: 'float', label: 'Value', hint: 'The progress, 0 to 1. Unwired: it plays by itself from Time, as Loop, Duration and Hold say.' },
    time: { type: 'float', label: 'Time', hint: 'Seconds, for playing by itself. Falls back to the global clock when unwired; wire Time minus a number to start later.' },
  },
  outputs: {
    value: { type: 'float', label: 'Value', hint: 'From…To, eased. Back and Elastic go a little past To (or From).' },
    progress: { type: 'float', label: 'Progress', hint: 'The 0 to 1 progress before easing (straight, no curve).' },
    speed: { type: 'float', label: 'Speed', hint: 'How fast Value is changing: per second when it plays by itself, per unit of progress when Value is wired. 0 while holding.' },
  },
  defaultParams: { curve: 'cubic', direction: 'inOut', loop: 'pingpong', duration: 1, hold: 0.25, amount: 1, steps: 5, from: 0, to: 1 },
  paramDefs: {
    curve: { label: 'Curve', type: 'select', hint: 'Which easing curve: how the move speeds up and slows down.', options: EASE_CURVES.map(c => ({ value: c.value, label: c.label, hint: c.hint })) },
    direction: { label: 'Direction', type: 'select', hint: 'Where the curve acts: at the start (In), the end (Out), both (In-Out) or the middle (Out-In).', options: EASE_DIRECTIONS.map(d => ({ value: d.value, label: d.label, hint: d.hint })) },
    loop: { label: 'Loop', type: 'select', hint: 'With Value unwired: play Once, Repeat, or Ping-pong there and back.', options: EASE_LOOPS.map(l => ({ value: l.value, label: l.label, hint: l.hint })) },
    duration: { label: 'Duration', type: 'float', min: 0.05, max: 10, step: 0.05, hint: 'Seconds one move takes (Value unwired).' },
    hold: { label: 'Hold', type: 'float', min: 0, max: 5, step: 0.05, hint: 'Seconds it waits at each end before moving again, so a loop pauses between moves. With Once, the wait before it starts.' },
    amount: { label: 'Amount', type: 'float', min: 0, max: 4, step: 0.01, showWhen: { param: 'curve', value: WITH_AMOUNT }, hint: 'Back: how far it overshoots (1 is the usual, about 10%). Elastic: how many wobbles (1 is the usual).' },
    steps: { label: 'Steps', type: 'float', min: 1, max: 32, step: 1, showWhen: { param: 'curve', value: 'steps' }, hint: 'How many equal jumps the staircase makes.' },
    from: { label: 'From', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Value at the start. Type any number: a position, a size, an angle.' },
    to: { label: 'To', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Value at the end.' },
  },
  // The Loop's function too (the compiler drops it when Value is wired and nothing calls it).
  glslFunctionsFor: node => easeGlslFunctions(easeCurveOf(node.params), easeDirectionOf(node.params), easeLoopOf(node.params)),
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const curve = easeCurveOf(node.params);
    const dir = easeDirectionOf(node.params);
    const fn = easeFnName(curve, dir);
    const a = curve === 'steps' ? p(node.params.steps, 5) : WITH_AMOUNT.includes(curve) ? p(node.params.amount, 1) : '1.0';
    const from = p(node.params.from, 0), to = p(node.params.to, 1);
    const lines: string[] = [];
    if (inputVars.value) {
      lines.push(`    float ${id}_progress = clamp(${inputVars.value}, 0.0, 1.0);\n`);
      lines.push(`    float ${id}_e = ${fn}(${id}_progress, ${a});\n`);
      // Speed per unit of progress: a central difference, kept inside 0…1.
      lines.push(`    float ${id}_x0 = max(${id}_progress - 0.001, 0.0);\n    float ${id}_x1 = min(${id}_progress + 0.001, 1.0);\n`);
      lines.push(`    float ${id}_speed = (${fn}(${id}_x1, ${a}) - ${fn}(${id}_x0, ${a})) / (${id}_x1 - ${id}_x0) * (${to} - ${from});\n`);
    } else {
      const lf = loopFnName(easeLoopOf(node.params));
      const t = inputVars.time ?? 'u_time';
      const d = p(node.params.duration, 1), h = p(node.params.hold, 0.25);
      lines.push(`    float ${id}_t = ${t};\n`);
      lines.push(`    float ${id}_progress = ${lf}(${id}_t, ${d}, ${h});\n`);
      lines.push(`    float ${id}_e = ${fn}(${id}_progress, ${a});\n`);
      // Speed per second: a central difference in time (0 while holding).
      lines.push(`    float ${id}_speed = (${fn}(${lf}(${id}_t + 0.005, ${d}, ${h}), ${a}) - ${fn}(${lf}(${id}_t - 0.005, ${d}, ${h}), ${a})) / 0.01 * (${to} - ${from});\n`);
    }
    lines.push(`    float ${id}_value = mix(${from}, ${to}, ${id}_e);\n`);
    return { code: lines.join(''), outputVars: { value: `${id}_value`, progress: `${id}_progress`, speed: `${id}_speed` } };
  },
}, ['duration', 'hold', 'amount', 'steps', 'from', 'to']);
