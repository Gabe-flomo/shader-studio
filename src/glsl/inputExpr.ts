/**
 * Input expressions — a one-line GLSL expression on a float input, rooted in
 * `input`, that modifies the value arriving there: `input * 2.0 + sin(t)`.
 *
 * The raw input stays what it was (a wire, a slider, keyframes, a Play
 * control), so everything that targets it keeps working; the expression is a
 * layer on top, compiled inline where the card reads the input. Besides
 * `input` it can use the clock (`t`), the canvas (`res`, `uv`, `mouse`), the
 * card's other float inputs by their socket keys (their raw values) and the
 * card's float sliders by their param keys, plus GLSL's built-in functions.
 *
 * Stored on the card as `params["__inExpr_<inputKey>"]`. Applied by wrapping
 * every definition's generateGLSL (see nodes/definitions), so every compile
 * path (top level, groups, iterated groups) gets it without knowing.
 */
import type { GraphNode, NodeDefinition } from '../types/nodeGraph';
import { FIELD_FN_PREFIX } from '../nodes/definitions/helpers';

export const INPUT_EXPR_PREFIX = '__inExpr_';
export const inputExprKey = (inputKey: string) => `${INPUT_EXPR_PREFIX}${inputKey}`;

/** The expression on an input, or null when there is none. */
export function getInputExpr(node: GraphNode, inputKey: string): string | null {
  const v = node.params[inputExprKey(inputKey)];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Whether an input can take an expression: a float socket on a card that
 * emits GLSL. A field socket (pass the definition to know) cannot: what
 * arrives there is a function, not a value.
 */
export function canHaveInputExpr(node: GraphNode, inputKey: string, def?: NodeDefinition): boolean {
  const s = node.inputs[inputKey];
  if (def?.inputs[inputKey]?.field) return false;
  return !!s && s.type === 'float' && !['output', 'vec4Output', 'group', 'loopCarry'].includes(node.type);
}

/** The built-ins an expression may call or name. */
const GLSL_FUNCTIONS = new Set('sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep length distance dot normalize radians degrees'.split(' '));
const GLSL_CONSTANTS = new Set(['PI', 'TAU', 'true', 'false']);
const ENV: Record<string, string> = { t: 'u_time', time: 'u_time', res: 'u_resolution', resolution: 'u_resolution', mouse: 'u_mouse', uv: 'g_uv' };

export interface InputExprVariable { name: string; type: string; doc: string }

/** What an expression on `inputKey` of this card may name, for the editor and the validator. */
export function inputExprVariables(node: GraphNode, def: NodeDefinition | undefined, inputKey: string): InputExprVariable[] {
  const out: InputExprVariable[] = [
    { name: 'input', type: 'float', doc: 'The value arriving at this input: its wire, slider or keyframes. Always the root.' },
    { name: 't', type: 'float', doc: 'Time in seconds.' },
    { name: 'uv', type: 'vec2', doc: 'The canvas UV (centred, aspect-corrected).' },
    { name: 'res', type: 'vec2', doc: 'The canvas size in pixels.' },
    { name: 'mouse', type: 'vec2', doc: 'The mouse, 0..1.' },
  ];
  for (const [k, s] of Object.entries(node.inputs)) if (k !== inputKey && s.type === 'float') out.push({ name: k, type: 'float', doc: `This card's ${s.label} input, as it arrives (before its own expression).` });
  for (const [k, pd] of Object.entries(def?.paramDefs ?? {})) if (pd.type === 'float' && !(k in node.inputs) && !out.some(v => v.name === k)) out.push({ name: k, type: 'float', doc: `This card's ${pd.label} slider.` });
  return out;
}

export interface InputExprCheck { ok: boolean; error?: string }

/** Cheap checks before the compiler sees it: rooted in `input`, balanced, only known names, one expression. */
export function validateInputExpr(expr: string, variables: readonly InputExprVariable[]): InputExprCheck {
  const e = expr.trim();
  if (!e) return { ok: false, error: 'Empty' };
  if (/[;{}]/.test(e)) return { ok: false, error: 'One expression only: no ; or braces' };
  if (/(^|[^=!<>])=([^=]|$)/.test(e)) return { ok: false, error: 'No assignment: the expression is a value' };
  let depth = 0;
  for (const c of e) { if (c === '(') depth++; else if (c === ')') { depth--; if (depth < 0) return { ok: false, error: 'A ) before its (' }; } }
  if (depth !== 0) return { ok: false, error: 'Unbalanced parentheses' };
  const names = new Set(variables.map(v => v.name));
  const ids = [...e.matchAll(/\b[A-Za-z_]\w*\b/g)].map(m => m[0]);
  if (!ids.includes('input')) return { ok: false, error: 'Use `input` somewhere: the expression modifies what arrives' };
  for (const m of e.matchAll(/\b([A-Za-z_]\w*)\b(\s*\()?/g)) {
    const [, id, call] = m;
    if (/^\d/.test(id)) continue;
    if (call) { if (!GLSL_FUNCTIONS.has(id) && !/^(vec[234]|float|int|bool)$/.test(id)) return { ok: false, error: `${id}() isn't a GLSL function this expression can call` }; continue; }
    if (names.has(id) || GLSL_CONSTANTS.has(id)) continue;
    if (/^[xyzwrgba]{1,4}$/.test(id) && e[m.index! - 1] === '.') continue; // a swizzle
    return { ok: false, error: `${id} isn't available here` };
  }
  return { ok: true };
}

const fmt = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/**
 * The expression as GLSL with its names bound: `input` to the resolved raw
 * value, the environment names to the shader's uniforms, sibling inputs to
 * their resolved values and sliders to their (uniform or literal) params.
 */
export function bindInputExpr(expr: string, raw: string, node: GraphNode, inputVars: Record<string, string>): string {
  return '(' + expr.replace(/\b([A-Za-z_]\w*)\b(?!\s*\()/g, (whole, id: string, offset: number) => {
    if (expr[offset - 1] === '.') return whole; // a swizzle
    if (id === 'input') return `(${raw})`;
    if (id in ENV) return ENV[id];
    if (id in inputVars && inputVars[id] !== undefined) return `(${inputVars[id]})`;
    const p = node.params[id];
    if (typeof p === 'number') return fmt(p);
    if (typeof p === 'string' && p.trim()) return `(${p})`; // a uniform name or keyframe call the patcher put there
    return whole;
  }) + ')';
}

/**
 * Apply every input expression a card has to its resolved input variables.
 * An input with no resolved value (a slider the definition reads itself, as
 * Mix's `t`) takes the slider's param as `input`.
 */
export function applyInputExpressions(node: GraphNode, inputVars: Record<string, string>): Record<string, string> {
  let out: Record<string, string> | null = null;
  for (const [k, v] of Object.entries(node.params)) {
    if (!k.startsWith(INPUT_EXPR_PREFIX) || typeof v !== 'string' || !v.trim()) continue;
    const inputKey = k.slice(INPUT_EXPR_PREFIX.length);
    const socket = node.inputs[inputKey];
    if (!socket || socket.type !== 'float') continue;
    let raw = inputVars[inputKey];
    if (raw?.startsWith(FIELD_FN_PREFIX)) continue; // a field socket: a function name, not a value
    if (raw === undefined) {
      const p = node.params[inputKey];
      if (typeof p === 'number') raw = fmt(p); else if (typeof p === 'string' && p.trim()) raw = p; else continue;
    }
    if (!out) out = { ...inputVars };
    out[inputKey] = bindInputExpr(v, raw, node, inputVars);
  }
  return out ?? inputVars;
}

/** A definition whose generateGLSL applies input expressions first. Memoised per definition. */
const wrapped = new WeakMap<NodeDefinition, NodeDefinition>();
export function withInputExpressions(def: NodeDefinition): NodeDefinition {
  let w = wrapped.get(def);
  if (!w) {
    const original = def.generateGLSL;
    w = { ...def, generateGLSL: (node, inputVars) => original(node, applyInputExpressions(node, inputVars)) };
    wrapped.set(def, w);
  }
  return w;
}
