/**
 * Simple Expression (docs/simple-expression.md): one line of GLSL on the card, as many inputs as you
 * add with + Input, and an Output type. No editor window: the card is the whole node.
 *
 * Inputs have no type of their own. Each takes the type of the wire into it (float, vec2, vec3,
 * vec4, mat2, mat3), kept in step before every compile by compiler/simpleExprSync.ts, the same way a
 * Send takes the type wired into it. An unwired input is a float 0.0. A texture can't come in: a
 * sampler isn't a value (Sample Texture first, or use an Expression Block, which takes pictures).
 *
 * Each input's socket key is stable (`in1`, `in2`…) and its name is a label, so renaming an input
 * keeps its wire. The name is what the expression uses, declared as a local of the inferred type:
 *
 *     vec3 simpleExpr_4_result;
 *     {
 *         vec3 a = circle_1_color;
 *         float b = 0.0;
 *         float t = u_time;
 *         simpleExpr_4_result = (mix(a, vec3(1.0), b * t));
 *     }
 *
 * Besides its inputs the expression can use t / time (seconds), uv (the canvas position, as Expression
 * Block and input expressions see it), res (canvas size in pixels), mouse, PI, TAU, the u_ uniforms and
 * GLSL's built-in functions. A problem the card can see (a bad name, unbalanced brackets, a type that
 * can't become the Output type) gives zero of the Output type, so the rest of the graph keeps drawing;
 * the card says what's wrong. What only the GPU can see is reported on the card like any node's error.
 */
import type { DataType, GraphNode, InputSocket, NodeDefinition, OutputSocket } from '../../types/nodeGraph';
import { inferType, fixesFor, typeWords, type GlslType } from '../../lang/typeCheck';
import { coerce } from '../../lib/typesCompatible';

export const SIMPLE_EXPR_TYPE = 'simpleExpr';

/** One input: a stable socket key and the name the expression uses. */
export interface SimpleExprVar { key: string; name: string }

/** What an input can be wired from. */
export const SIMPLE_EXPR_CARRIES: ReadonlySet<string> = new Set(['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3']);
/** The Output type choices. */
export const SIMPLE_EXPR_OUTPUTS = ['float', 'vec2', 'vec3', 'vec4'] as const;
export type SimpleExprOutput = typeof SIMPLE_EXPR_OUTPUTS[number];

/** The names the expression gets for free (unless an input takes the name), with their GLSL. */
export const SIMPLE_EXPR_ENV: ReadonlyArray<{ name: string; type: string; glsl: string; doc: string }> = [
  { name: 't', type: 'float', glsl: 'u_time', doc: 'Time in seconds.' },
  { name: 'time', type: 'float', glsl: 'u_time', doc: 'Time in seconds (same as t).' },
  { name: 'uv', type: 'vec2', glsl: 'g_uv', doc: 'The canvas position (centred, aspect-corrected), as the UV node gives it.' },
  { name: 'res', type: 'vec2', glsl: 'u_resolution', doc: 'The canvas size in pixels.' },
  { name: 'mouse', type: 'vec2', glsl: 'u_mouse', doc: 'The mouse position.' },
];
const ENV = new Map(SIMPLE_EXPR_ENV.map(e => [e.name, e] as const));
/** Raw names that are always there: constants and the shader's own globals. */
const RAW_TYPES: Record<string, GlslType> = { PI: 'float', TAU: 'float', u_time: 'float', u_resolution: 'vec2', u_mouse: 'vec2', g_uv: 'vec2' };

/** Words an input can't be called: GLSL's keywords, types and built-ins, and the free names above. */
const RESERVED = new Set([
  ...'attribute const uniform varying layout centroid flat smooth noperspective break continue do for while switch case default if else in out inout float int void bool true false invariant discard return mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 lowp mediump highp precision sampler2D sampler3D samplerCube struct asm class union enum typedef template this goto inline noinline volatile public static extern external interface long short double half fixed unsigned superp input output hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 sizeof cast namespace using'.split(' '),
  ...'sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil trunc round roundEven fract mod modf min max clamp mix step smoothstep length distance dot cross normalize faceforward reflect refract matrixCompMult outerProduct transpose determinant inverse lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not texture textureLod texelFetch radians degrees sinh cosh tanh asinh acosh atanh isnan isinf dFdx dFdy fwidth'.split(' '),
  'PI', 'TAU', 'main',
]);

/** Why `name` can't name an input (null: it can). `others` are the other inputs' names. */
export function simpleExprNameProblem(name: string, others: readonly string[] = []): string | null {
  if (!name) return 'Give the input a name';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `“${name}” isn't a GLSL name: letters, digits and _, not starting with a digit`;
  if (name.includes('__')) return 'Two underscores in a row are reserved in GLSL';
  if (/^(gl_|u_|g_)/.test(name)) return `Names starting with ${name.slice(0, 2)} belong to the shader`;
  if (RESERVED.has(name)) return `“${name}” is a GLSL word`;
  if (name.length > 24) return 'Keep the name under 25 characters';
  if (others.includes(name)) return `There's already an input called ${name}`;
  return null;
}

/** The next free name: a, b, c … z, then a1, b1 … (skipping the free names t, uv …). */
export function nextSimpleExprName(taken: readonly string[]): string {
  for (let round = 0; ; round++) {
    for (const c of 'abcdefghijklmnopqrsuvwxyz') {
      const name = round ? `${c}${round}` : c;
      if (!taken.includes(name) && !ENV.has(name)) return name;
    }
  }
}

/** The next free socket key (in1, in2 …). */
export function nextSimpleExprKey(taken: readonly string[]): string {
  for (let i = 1; ; i++) if (!taken.includes(`in${i}`)) return `in${i}`;
}

export function simpleExprVars(node: Pick<GraphNode, 'params'>): SimpleExprVar[] {
  const v = node.params?.vars;
  return Array.isArray(v) ? (v as SimpleExprVar[]).filter(x => x && typeof x.key === 'string' && typeof x.name === 'string') : [];
}

export function simpleExprOutputType(node: Pick<GraphNode, 'params'>): SimpleExprOutput {
  const t = node.params?.outputType;
  return (SIMPLE_EXPR_OUTPUTS as readonly string[]).includes(t as string) ? (t as SimpleExprOutput) : 'float';
}

export function simpleExprText(node: Pick<GraphNode, 'params'>): string {
  return typeof node.params?.expr === 'string' ? node.params.expr : '';
}

/** An input's type as the expression sees it: the wire's, or float when unwired. */
export function simpleExprVarType(node: Pick<GraphNode, 'inputs'>, key: string): string {
  const s = node.inputs?.[key];
  return s?.connection ? s.type : 'float';
}

export const zeroOf = (t: string): string => (t === 'float' ? '0.0' : t === 'int' ? '0' : t === 'bool' ? 'false' : `${t}(0.0)`);

/** The sockets the params describe, keeping each existing socket's wire and type (a wire's type is set by the sync). */
export function simpleExprSockets(node: GraphNode): { inputs: Record<string, InputSocket>; outputs: Record<string, OutputSocket> } {
  const inputs: Record<string, InputSocket> = {};
  for (const v of simpleExprVars(node)) {
    const old = node.inputs?.[v.key];
    inputs[v.key] = { type: old?.connection ? old.type : 'float', label: v.name, ...(old?.connection ? { connection: old.connection } : {}) };
  }
  const outputs: Record<string, OutputSocket> = { result: { type: simpleExprOutputType(node), label: 'Result' } };
  return { inputs, outputs };
}

/** The node with its sockets rebuilt from its params (unchanged when they already match). */
export function retypeSimpleExpr(node: GraphNode): GraphNode {
  const { inputs, outputs } = simpleExprSockets(node);
  const same = JSON.stringify(inputs) === JSON.stringify(node.inputs) && JSON.stringify(outputs) === JSON.stringify(node.outputs);
  return same ? node : { ...node, inputs, outputs };
}

// ── Checking ────────────────────────────────────────────────────────────────

/** Calls inferType understands; an expression calling anything else is left to the GPU to type. */
const TYPED_CALLS = new Set('sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep normalize radians degrees reflect length distance dot float cross vec2 vec3 vec4'.split(' '));

export type SimpleExprCheck =
  | { ok: true; glsl: string; type: string | null; note?: string; used: string[] }
  | { ok: false; error: string };

/**
 * Check the expression against its inputs (name → type) and the Output type. On success `glsl` is the
 * value to assign (cast when the graph's wire rule allows it: a float spreads into a vector, vec3 → vec2
 * takes .xy, vec2 → vec3 adds 0, vec3 → vec4 adds alpha 1), `type` what it makes when that can be told,
 * and `used` the free names (t, uv …) it reads.
 */
export function checkSimpleExpr(expr: string, vars: ReadonlyArray<{ name: string; type: string }>, outType: string): SimpleExprCheck {
  const e = expr.trim();
  if (!e) return { ok: false, error: 'Write an expression, like a * 2.0 or mix(a, b, 0.5)' };
  if (/[;{}]/.test(e)) return { ok: false, error: 'One expression only: no ; or braces. For several lines, convert it to an Expression Block' };
  if (/(^|[^=!<>])=([^=]|$)/.test(e)) return { ok: false, error: 'No assignment here: the expression is the value (no =, +=, …)' };
  if (/\+\+|--/.test(e)) return { ok: false, error: 'No ++ or --: the expression is the value' };
  const open: string[] = [];
  for (const c of e) {
    if (c === '(' || c === '[') open.push(c);
    else if (c === ')' || c === ']') {
      const want = c === ')' ? '(' : '[';
      if (open.pop() !== want) return { ok: false, error: `A ${c} without its ${want}` };
    }
  }
  if (open.length) return { ok: false, error: `A ${open[open.length - 1]} is never closed` };

  const byName = new Map(vars.map(v => [v.name, v.type] as const));
  for (const v of vars) {
    if (!SIMPLE_EXPR_CARRIES.has(v.type)) {
      return { ok: false, error: v.type === 'texture'
        ? `${v.name} is wired to a texture: a Simple Expression reads numbers and vectors. Sample it first (Sample Texture), or convert to an Expression Block`
        : `${v.name} is wired to a ${v.type}, which a Simple Expression can't read` };
    }
  }
  const used = new Set<string>();
  let typeable = !e.includes('[');
  for (const m of e.matchAll(/\b([A-Za-z_]\w*)\b(\s*\()?/g)) {
    const [, id, call] = m;
    const at = m.index ?? 0;
    if (e[at - 1] === '.') {
      if (!/^[xyzwrgbastpq]{1,4}$/.test(id)) return { ok: false, error: `.${id} isn't a swizzle (use .x, .xy, .rgb …)` };
      continue;
    }
    if (call) { if (!TYPED_CALLS.has(id)) typeable = false; continue; }
    if (byName.has(id)) { if (/^mat/.test(byName.get(id)!)) typeable = false; continue; }
    if (ENV.has(id)) { used.add(id); continue; }
    if (id in RAW_TYPES || id === 'true' || id === 'false') continue;
    if (/^u_\w+$/.test(id)) { typeable = false; continue; }
    const names = vars.map(v => v.name);
    return { ok: false, error: `“${id}” isn't an input here. ${names.length ? `Inputs: ${names.join(', ')}. ` : ''}Add one with + Input, or use t, uv, res, mouse, PI` };
  }

  if (!typeable) return { ok: true, glsl: `(${e})`, type: null, used: [...used] };
  const names: Record<string, GlslType> = { ...RAW_TYPES };
  for (const env of SIMPLE_EXPR_ENV) names[env.name] = env.type;
  for (const v of vars) names[v.name] = v.type;
  const r = inferType(e, names);
  if ('error' in r) return { ok: false, error: `Can't read it: ${r.error}` };
  const made = r.type;
  if (made === outType) return { ok: true, glsl: `(${e})`, type: made, used: [...used] };
  const cast = coerce(`(${e})`, made, outType);
  if (cast !== null) {
    const how = made === 'float' ? `the number fills every part of the ${typeWords(outType)}`
      : made === 'vec3' && outType === 'vec2' ? 'keeps .xy'
      : made === 'vec2' && outType === 'vec3' ? 'adds z = 0'
      : made === 'vec3' && outType === 'vec4' ? 'adds alpha 1' : '';
    return { ok: true, glsl: cast, type: made, used: [...used], note: `Makes ${made}, cast to ${outType}${how ? `: ${how}` : ''}` };
  }
  const fixes = fixesFor(made, outType, { colour: false });
  const fix = fixes.find(f => f.rewrite);
  return {
    ok: false,
    error: `This makes ${typeWords(made)}, but the Output type is ${typeWords(outType)}. ${fix?.rewrite ? `Try ${fix.rewrite(e)}, or set` : 'Set'} Output to ${made}`,
  };
}

/** The check for a node as it stands (its inputs' types as wired). */
export function checkSimpleExprNode(node: GraphNode): SimpleExprCheck {
  const vars = simpleExprVars(node).map(v => ({ name: v.name, type: simpleExprVarType(node, v.key) }));
  // Two inputs with one name, or a bad name (a file edited by hand): say so before anything else.
  const seen: string[] = [];
  for (const v of vars) {
    const p = simpleExprNameProblem(v.name, seen);
    if (p) return { ok: false, error: `Input ${v.name || '(no name)'}: ${p}` };
    seen.push(v.name);
  }
  return checkSimpleExpr(simpleExprText(node), vars, simpleExprOutputType(node));
}

// ── The node ────────────────────────────────────────────────────────────────

export const SIMPLE_EXPR_DEFAULTS = {
  vars: [{ key: 'in1', name: 'a' }] as SimpleExprVar[],
  expr: 'a',
  outputType: 'float',
};

export const SimpleExprNode: NodeDefinition = {
  type: SIMPLE_EXPR_TYPE,
  label: 'Simple Expression',
  aliases: ['One-liner', 'Quick expression', 'Formula'],
  category: 'Functions',
  description: 'One line of GLSL right on the card, like mix(a, b, smoothstep(0.2, 0.8, c)). Add inputs with + Input: each takes the type of the wire into it (a float until wired). Pick the Output type. It can also use t (time), uv, res, mouse, PI and GLSL\'s functions. For several lines, convert it to an Expression Block.',
  inputs: {},
  outputs: { result: { type: 'float', label: 'Result', hint: 'The expression\'s value, as the Output type.' } },
  defaultParams: SIMPLE_EXPR_DEFAULTS,
  paramDefs: {},
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const outT = simpleExprOutputType(node);
    const outVar = `${id}_result`;
    const check = checkSimpleExprNode(node);
    if (!check.ok) {
      return { code: `    ${outT} ${outVar} = ${zeroOf(outT)}; // Simple Expression: ${check.error.replace(/[\r\n*/]/g, ' ')}\n`, outputVars: { result: outVar } };
    }
    const vars = simpleExprVars(node);
    const decls: string[] = [];
    for (const v of vars) {
      const t = simpleExprVarType(node, v.key);
      decls.push(`        ${t} ${v.name} = ${inputVars[v.key] ?? zeroOf(t)};\n`);
    }
    for (const name of check.used) {
      if (vars.some(v => v.name === name)) continue;
      const env = ENV.get(name)!;
      decls.push(`        ${env.type} ${name} = ${env.glsl};\n`);
    }
    const code = `    ${outT} ${outVar};\n    {\n${decls.join('')}        ${outVar} = ${check.glsl};\n    }\n`;
    return { code, outputVars: { result: outVar } };
  },
};

// ── Converting to and from an Expression Block ─────────────────────────────

/** The free names as the Expression Block has them (it gives t; the rest are the shader's own globals). */
const TO_BLOCK_NAMES: Record<string, string> = { time: 'u_time', uv: 'g_uv', res: 'u_resolution', mouse: 'u_mouse' };

function renameIds(text: string, map: (id: string) => string | undefined): string {
  return text.replace(/\b([A-Za-z_]\w*)\b(?!\s*\()/g, (whole, id: string, offset: number) => (text[offset - 1] === '.' ? whole : map(id) ?? whole));
}

/** A Simple Expression as an Expression Block: same id, inputs (by name), wires, expression and output. */
export function simpleExprToBlock(node: GraphNode): GraphNode {
  const vars = simpleExprVars(node);
  const outT = simpleExprOutputType(node);
  const names = new Set(vars.map(v => v.name));
  const result = renameIds(simpleExprText(node).trim(), id => (names.has(id) ? undefined : TO_BLOCK_NAMES[id])) || zeroOf(outT);
  const inputs: Record<string, InputSocket> = {};
  for (const v of vars) {
    const s = node.inputs[v.key];
    const t = simpleExprVarType(node, v.key);
    inputs[v.name] = { type: t as DataType, label: v.name, ...(s?.connection ? { connection: s.connection } : {}) };
  }
  // Keep the card's own extras (note, label, colour…); drop what only the Simple Expression reads.
  const { vars: _v, expr: _e, outputType: _o, ...rest } = node.params;
  void _v; void _e; void _o;
  return {
    ...node,
    type: 'exprNode',
    inputs,
    outputs: { result: { type: outT, label: 'Result' } },
    params: {
      ...rest,
      inputs: vars.map(v => ({ name: v.name, type: simpleExprVarType(node, v.key), slider: null })),
      outputType: outT,
      lines: [],
      result,
      expr: result,
    },
  };
}

/** Why an Expression Block can't become a Simple Expression (null: it can). */
export function blockSimplifyProblem(node: GraphNode): string | null {
  if (node.type !== 'exprNode') return 'Not an Expression Block';
  const p = node.params;
  const inputs = p.inputs as Array<{ name: string; type: string; slider?: unknown; carry?: boolean }> | undefined;
  if (!Array.isArray(inputs) || !Array.isArray(p.lines)) return 'An old-style block';
  if ((p.lines as Array<{ lhs: string; rhs: string; off?: boolean }>).some(l => l.lhs?.trim() && l.rhs?.trim() && !l.off)) return 'It has lines before the result';
  if (p.loop) return 'It loops';
  if (Array.isArray(p.outputs) && (p.outputs as unknown[]).length) return 'It has extra outputs';
  if (typeof p.glslFunctions === 'string' && p.glslFunctions.trim()) return 'It has helper functions';
  if (!(SIMPLE_EXPR_OUTPUTS as readonly string[]).includes(String(p.outputType ?? 'float'))) return `Its output is ${String(p.outputType)}`;
  for (const i of inputs) {
    if (i.slider != null) return `${i.name} is a slider`;
    if (i.carry) return `${i.name} carries between iterations`;
    if (!SIMPLE_EXPR_CARRIES.has(i.type)) return `${i.name} is a ${i.type}`;
    if (!node.inputs[i.name]?.connection && i.type !== 'float') return `${i.name} is an unwired ${i.type}`;
    if (simpleExprNameProblem(i.name)) return `${i.name} can't be an input name here`;
  }
  const result = typeof p.result === 'string' ? p.result.trim() : '';
  if (!result) return 'It has no result';
  if (/[;{}]/.test(result)) return 'Its result is more than one expression';
  // A name the block gives that a Simple Expression doesn't (its scratch p): it stays a block.
  const check = checkSimpleExprNode(buildFromBlock(node));
  if (!check.ok && /isn't an input here/.test(check.error)) return check.error.split('.')[0];
  return null;
}

/** An Expression Block with just a result line as a Simple Expression (null when it can't be one). */
export function blockToSimpleExpr(node: GraphNode): GraphNode | null {
  if (blockSimplifyProblem(node)) return null;
  return buildFromBlock(node);
}

function buildFromBlock(node: GraphNode): GraphNode {
  const inputs = node.params.inputs as Array<{ name: string; type: string }>;
  const vars: SimpleExprVar[] = inputs.map((i, k) => ({ key: `in${k + 1}`, name: i.name }));
  const outT = String(node.params.outputType ?? 'float');
  const { inputs: _i, lines: _l, result: _r, expr: _e, outputType: _o, ...rest } = node.params;
  void _i; void _l; void _r; void _e; void _o;
  const sockets: Record<string, InputSocket> = {};
  for (const v of vars) {
    const s = node.inputs[v.name];
    sockets[v.key] = { type: s?.connection ? s.type : 'float', label: v.name, ...(s?.connection ? { connection: s.connection } : {}) };
  }
  return {
    ...node,
    type: SIMPLE_EXPR_TYPE,
    inputs: sockets,
    outputs: { result: { type: outT as DataType, label: 'Result' } },
    params: { ...rest, vars, expr: String(node.params.result).trim(), outputType: outT },
  };
}

// ── Card edits (pure: the card applies them through replaceNodeInScope) ────

/** Add an input named a, b, c … (unwired, so a float until something is wired in). */
export function addSimpleExprVar(node: GraphNode): GraphNode {
  const vars = simpleExprVars(node);
  const v = { key: nextSimpleExprKey([...vars.map(x => x.key), ...Object.keys(node.inputs)]), name: nextSimpleExprName(vars.map(x => x.name)) };
  return retypeSimpleExpr({ ...node, params: { ...node.params, vars: [...vars, v] } });
}

/** Remove an input and its wire (the expression is left as written: the card then names what's missing). */
export function removeSimpleExprVar(node: GraphNode, key: string): GraphNode {
  const vars = simpleExprVars(node).filter(v => v.key !== key);
  const { [key]: _gone, ...inputs } = node.inputs;
  void _gone;
  return retypeSimpleExpr({ ...node, inputs, params: { ...node.params, vars } });
}

/** Rename an input: its wire stays (the socket key doesn't change) and the expression follows the new name. */
export function renameSimpleExprVar(node: GraphNode, key: string, name: string): { node: GraphNode } | { error: string } {
  const vars = simpleExprVars(node);
  const old = vars.find(v => v.key === key);
  if (!old) return { error: 'No such input' };
  if (old.name === name) return { node };
  const problem = simpleExprNameProblem(name, vars.filter(v => v.key !== key).map(v => v.name));
  if (problem) return { error: problem };
  const expr = renameIds(simpleExprText(node), id => (id === old.name ? name : undefined));
  return { node: retypeSimpleExpr({ ...node, params: { ...node.params, expr, vars: vars.map(v => (v.key === key ? { ...v, name } : v)) } }) };
}

/** Move an input up or down the list (the order of the rows on the card). */
export function moveSimpleExprVar(node: GraphNode, key: string, by: -1 | 1): GraphNode {
  const vars = [...simpleExprVars(node)];
  const i = vars.findIndex(v => v.key === key), j = i + by;
  if (i < 0 || j < 0 || j >= vars.length) return node;
  [vars[i], vars[j]] = [vars[j], vars[i]];
  return retypeSimpleExpr({ ...node, params: { ...node.params, vars } });
}

export function setSimpleExprOutput(node: GraphNode, outputType: SimpleExprOutput): GraphNode {
  if (simpleExprOutputType(node) === outputType) return node;
  return retypeSimpleExpr({ ...node, params: { ...node.params, outputType } });
}
