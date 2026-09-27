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
 *
 * Knobs: names of the expression's own (`k` in `input * k`) that are
 * sliders. They're listed in `params["__inKnobs_<inputKey>"]` as
 * `{ name, min, max }`, and each value is an ordinary float param,
 * `params["knob_<inputKey>_<name>"]`, which getNodeDefinitionFor declares as
 * a paramDef (knobParamDefs). So the uniform patcher makes it a uniform
 * (dragging never recompiles), keyframes and Play controls reach it like any
 * other slider, and the binder below reads whatever the patcher left there.
 */
import type { GraphNode, NodeDefinition, ParamDef } from '../types/nodeGraph';
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

export interface InputExprVariable { name: string; type: string; doc: string; knob?: boolean }

/** What an expression on `inputKey` of this card may name, for the editor and the validator. Knobs are added by the caller (knobVariables). */
export function inputExprVariables(node: GraphNode, def: NodeDefinition | undefined, inputKey: string): InputExprVariable[] {
  const out: InputExprVariable[] = [
    { name: 'input', type: 'float', doc: 'The value arriving at this input: its wire, slider or keyframes. Always the root.' },
    { name: 't', type: 'float', doc: 'Time in seconds.' },
    { name: 'uv', type: 'vec2', doc: 'The canvas UV (centred, aspect-corrected).' },
    { name: 'res', type: 'vec2', doc: 'The canvas size in pixels.' },
    { name: 'mouse', type: 'vec2', doc: 'The mouse, 0..1.' },
  ];
  for (const [k, s] of Object.entries(node.inputs)) if (k !== inputKey && s.type === 'float') out.push({ name: k, type: 'float', doc: `This card's ${s.label} input, as it arrives (before its own expression).` });
  for (const [k, pd] of Object.entries(def?.paramDefs ?? {})) if (pd.type === 'float' && !(k in node.inputs) && !isKnobKey(k) && !out.some(v => v.name === k)) out.push({ name: k, type: 'float', doc: `This card's ${pd.label} slider.` });
  return out;
}

// ── Knobs ───────────────────────────────────────────────────────────────────

export const INPUT_KNOBS_PREFIX = '__inKnobs_';
export const inputKnobsKey = (inputKey: string) => `${INPUT_KNOBS_PREFIX}${inputKey}`;
const KNOB_PARAM_PREFIX = 'knob_';
const isKnobKey = (key: string) => key.startsWith(KNOB_PARAM_PREFIX);
/**
 * The param holding a knob's value. Safe inside a uniform name
 * (`u_p_<node>_<key>`): underscores in the input key become `x`, as they do
 * in node ids, and knob names never hold `__` (reserved in GLSL ES).
 */
export const knobParamKey = (inputKey: string, name: string) => `${KNOB_PARAM_PREFIX}${inputKey.replace(/_/g, 'x')}_${name}`;

export interface InputKnob { name: string; min: number; max: number }

/** A knob name: a letter, then letters, digits and single underscores. */
const KNOB_NAME = /^[A-Za-z](?:_?[A-Za-z0-9])*$/;

/** The knobs listed on an input (well-formed entries only, first of each name). */
export function getInputKnobs(node: GraphNode, inputKey: string): InputKnob[] {
  const raw = node.params[inputKnobsKey(inputKey)];
  if (!Array.isArray(raw)) return [];
  const out: InputKnob[] = [];
  for (const k of raw) {
    if (!k || typeof k !== 'object') continue;
    const { name, min, max } = k as Record<string, unknown>;
    if (typeof name !== 'string' || !KNOB_NAME.test(name) || out.some(o => o.name === name)) continue;
    const lo = typeof min === 'number' && Number.isFinite(min) ? min : 0;
    const hi = typeof max === 'number' && Number.isFinite(max) && max > lo ? max : lo + 1;
    out.push({ name, min: lo, max: hi });
  }
  return out;
}

/** A knob's current value (0 when it has none). */
export function knobValue(node: GraphNode, inputKey: string, name: string): number {
  const v = node.params[knobParamKey(inputKey, name)];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * The paramDefs a card's knobs declare, keyed by their value params, for
 * inputs that have an expression. The label names the input, so a Play
 * control reads "Radius · k"; the card shows the bare name under the row.
 */
export function knobParamDefs(node: GraphNode): Record<string, ParamDef> | null {
  let out: Record<string, ParamDef> | null = null;
  for (const [k, v] of Object.entries(node.params)) {
    if (!k.startsWith(INPUT_KNOBS_PREFIX) || !Array.isArray(v) || v.length === 0) continue;
    const inputKey = k.slice(INPUT_KNOBS_PREFIX.length);
    const expr = getInputExpr(node, inputKey);
    if (!expr || node.inputs[inputKey]?.type !== 'float') continue;
    const label = node.inputs[inputKey]?.label ?? inputKey;
    for (const knob of getInputKnobs(node, inputKey)) {
      (out ??= {})[knobParamKey(inputKey, knob.name)] = {
        label: `${label} · ${knob.name}`, type: 'float', min: knob.min, max: knob.max,
        step: Math.min(0.01, (knob.max - knob.min) / 200),
        hint: `A knob in the expression on ${label}: ${expr}`,
      };
    }
  }
  return out;
}

/** Is `key` one of this card's knob value params? The card draws those under their expression, not with its other sliders. */
export function isKnobParamKey(node: GraphNode, key: string): boolean {
  return isKnobKey(key) && !!knobParamDefs(node)?.[key];
}

/** The names an expression mentions that aren't calls or swizzles, in order, once each. */
export function exprNames(expr: string): string[] {
  const out: string[] = [];
  for (const m of expr.matchAll(/\b([A-Za-z_]\w*)\b(\s*\()?/g)) {
    const [, id, call] = m;
    if (call || expr[m.index! - 1] === '.') continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

const RESERVED = new Set([
  'input', 't', 'time', 'uv', 'res', 'resolution', 'mouse', 'PI', 'TAU', 'true', 'false',
  'in', 'out', 'inout', 'float', 'int', 'bool', 'mat2', 'mat3', 'mat4', 'if', 'else', 'for', 'while', 'do',
  'return', 'break', 'continue', 'discard', 'uniform', 'varying', 'attribute', 'const', 'void', 'struct',
  'sampler2D', 'precision', 'highp', 'mediump', 'lowp', 'main', 'texture',
]);

/** Why a name can't be a knob on this input, or null when it can. */
export function knobNameProblem(name: string, variables: readonly InputExprVariable[], knobs: readonly InputKnob[] = []): string | null {
  if (!KNOB_NAME.test(name)) return 'A knob name starts with a letter, then letters, digits or single underscores';
  if (name.length > 16) return 'A knob name is 16 characters at most';
  if (RESERVED.has(name) || GLSL_FUNCTIONS.has(name) || /^[biu]?vec\d$/.test(name) || /^(gl|u|kf)_/.test(name)) return `${name} is a reserved name`;
  if (knobs.some(k => k.name === name)) return `${name} is already a knob`;
  if (variables.some(v => v.name === name)) return `${name} is already a name here`;
  return null;
}

/** Names in the expression that aren't known yet and could become knobs, in order of appearance. */
export function knobCandidates(expr: string, variables: readonly InputExprVariable[]): string[] {
  const known = new Set(variables.map(v => v.name));
  return exprNames(expr).filter(id => !known.has(id) && knobNameProblem(id, variables) === null);
}

/** A fresh knob name: k, then k2, k3… (skipping names the draft already uses). */
export function nextKnobName(variables: readonly InputExprVariable[], knobs: readonly InputKnob[], draft = ''): string {
  const used = new Set(exprNames(draft));
  for (let i = 1; ; i++) {
    const name = i === 1 ? 'k' : `k${i}`;
    if (!used.has(name) && knobNameProblem(name, variables, knobs) === null) return name;
  }
}

/** The input's knobs as expression names. */
export function knobVariables(knobs: readonly InputKnob[]): InputExprVariable[] {
  return knobs.map(k => ({ name: k.name, type: 'float', doc: `A knob: a slider from ${k.min} to ${k.max} under the expression. Play and keyframes can drive it.`, knob: true }));
}

/**
 * The params patch that sets an input's expression and its knobs in one
 * step (one undo step): the expression; the knob list, keeping only knobs the
 * expression mentions; each kept knob's value (its current one, else
 * `values[name]`, else the middle of its range); and no value for knobs that
 * went away. An empty expression clears the expression and every knob.
 */
export function inputExprPatch(node: GraphNode, inputKey: string, expr: string, knobs: readonly InputKnob[], values: Record<string, number> = {}): Record<string, unknown> {
  const e = expr.trim();
  const used = new Set(e ? exprNames(e) : []);
  const keep = knobs.filter(k => used.has(k.name));
  const patch: Record<string, unknown> = {
    [inputExprKey(inputKey)]: e,
    [inputKnobsKey(inputKey)]: keep.length ? keep.map(k => ({ name: k.name, min: k.min, max: k.max })) : undefined,
  };
  for (const k of getInputKnobs(node, inputKey)) {
    if (keep.some(x => x.name === k.name)) continue;
    const key = knobParamKey(inputKey, k.name);
    patch[key] = undefined;
    for (const p of ['__keyframes_', '__kfMode_', '__kfLoopBack_', '__kfBypass_', '__kfOffset_', '__kfLoopCount_']) if (`${p}${key}` in node.params) patch[`${p}${key}`] = undefined;
  }
  for (const k of keep) {
    const current = node.params[knobParamKey(inputKey, k.name)];
    patch[knobParamKey(inputKey, k.name)] = values[k.name] ?? (typeof current === 'number' ? current : (k.min + k.max) / 2);
  }
  return patch;
}

// ── Checking and binding ────────────────────────────────────────────────────

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
 * value, the environment names to the shader's uniforms, the input's knobs
 * to their (uniform, keyframe or literal) params, sibling inputs to their
 * resolved values and sliders to their (uniform or literal) params.
 */
export function bindInputExpr(expr: string, raw: string, node: GraphNode, inputVars: Record<string, string>, inputKey?: string): string {
  const knobs = inputKey ? new Set(getInputKnobs(node, inputKey).map(k => k.name)) : null;
  return '(' + expr.replace(/\b([A-Za-z_]\w*)\b(?!\s*\()/g, (whole, id: string, offset: number) => {
    if (expr[offset - 1] === '.') return whole; // a swizzle
    if (id === 'input') return `(${raw})`;
    if (id in ENV) return ENV[id];
    if (knobs?.has(id)) {
      // The patcher put a uniform name or a keyframe call here; on a card that stays baked it's still a number.
      const p = node.params[knobParamKey(inputKey!, id)];
      return typeof p === 'number' ? fmt(p) : typeof p === 'string' && p.trim() ? `(${p})` : '0.0';
    }
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
    out[inputKey] = bindInputExpr(v, raw, node, inputVars, inputKey);
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
