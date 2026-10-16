/**
 * The node card (the ⓘ on a canvas node): the same card as a function's, for a node: its
 * description, plus a plain-meaning line from its main idiom when one applies:
 *  - a node that is one GLSL function (Smoothstep, Sin, Mix…): that function's meaning;
 *  - an Expression Block: what it returns, when that is a recognised idiom (its own line, if
 *    it returns a variable one of its lines declares), else its last line that is one, else what
 *    its last call to a known function does;
 *  - a Custom Function: its return expression, the same way.
 */
import type { GraphNode, NodeDefinition } from '../../../types/nodeGraph';
import { explainExpression, type ExplainContext } from '../../../lib/glslPatterns/explain';
import { exprBlockEnv, customFnEnv } from '../../../lib/glslPatterns/findUses';
import { functionInfo, type FnInfo } from '../../../lib/glslPatterns/functions';
import { explainCall } from '../../../lib/glslPatterns/fnCard';
import { toPlainText } from '../../../lib/glslPatterns/segments';

export interface NodeCardModel {
  title: string;
  kindLabel: string;
  description?: string;
  /** The plain meaning, as plain text (names in backticks). */
  meaning?: string;
  /** The code the meaning is about. */
  meaningOf?: string;
  use?: string;
  /** The GLSL function the node is, when it is one (How is this used?). */
  fnName?: string;
}

function descriptionOf(def: NodeDefinition): string | undefined {
  if (def.brief?.summary) return def.brief.summary;
  const d = def.description as string | string[] | undefined;
  if (!d) return undefined;
  return Array.isArray(d) ? d.join(' ') : d;
}

function idiomMeaning(code: string, ctx: ExplainContext): { meaning: string; use?: string } | null {
  const ex = explainExpression(code, ctx);
  if (!ex.ok || !ex.meaningSegs?.length) return null;
  return { meaning: toPlainText(ex.meaningSegs), ...(ex.use ? { use: ex.use } : {}) };
}

/** The expression an Expression Block or a Custom Function returns, followed back to the line that makes it. */
export function mainExpression(node: GraphNode): string | null {
  if (node.type === 'exprNode') {
    const result = typeof node.params.result === 'string' ? node.params.result.trim() : '';
    const lines = (node.params.lines as Array<{ lhs?: string; rhs?: string; off?: boolean }> | undefined) ?? [];
    if (/^[A-Za-z_]\w*$/.test(result)) {
      const line = [...lines].reverse().find(l => !l.off && new RegExp(`(^|\\s)${result}$`).test((l.lhs ?? '').trim()));
      if (line?.rhs) return line.rhs.trim();
    }
    return result || null;
  }
  if (node.type === 'customFn') {
    const body = typeof node.params.body === 'string' ? node.params.body : '';
    const m = /\breturn\s+([^;]+);?\s*$/.exec(body.trim());
    if (m) return m[1].trim();
    return body.includes(';') ? null : body.trim() || null;
  }
  return null;
}

export function nodeCardModel(node: GraphNode, def: NodeDefinition): NodeCardModel {
  const label = typeof node.params.label === 'string' && node.params.label ? node.params.label : def.label;
  const model: NodeCardModel = {
    title: label,
    kindLabel: [def.category, def.subcategory].filter(Boolean).join(' · ') || 'Node',
    description: descriptionOf(def),
  };
  const info = functionInfo(node.type);
  if (info && info.kind === 'builtin') {
    model.fnName = info.name;
    // The catalogue speaks in GLSL's argument names (edge, x); the card speaks in the node's own
    // labels (Threshold, Value). No mapping, no meaning line: a name the node doesn't show misleads.
    const mapped = nodeFunctionMeaning(node, def, info);
    if (mapped) {
      model.meaning = `Gives ${mapped.meaning}.`;
      model.meaningOf = mapped.call;
      if (info.use) model.use = info.use;
    }
    return model;
  }
  const ctx: ExplainContext = { types: node.type === 'exprNode' ? exprBlockEnv(node) : customFnEnv(node) };
  // What it returns first; else the last of its lines that is a known idiom
  const main = mainExpression(node);
  const lines = node.type === 'exprNode' ? ((node.params.lines as Array<{ lhs?: string; op?: string; rhs?: string; off?: boolean }> | undefined) ?? []).filter(l => !l.off && l.rhs) : [];
  const candidates: Array<{ code: string; shown: string }> = [
    ...(main ? [{ code: main, shown: main }] : []),
    ...[...lines].reverse().map(l => ({ code: l.rhs!.trim(), shown: `${(l.lhs ?? '').trim()} ${l.op || '='} ${l.rhs!.trim()}`.trim() })),
  ];
  for (const c of candidates) {
    const m = idiomMeaning(c.code, ctx);
    if (m) { model.meaning = m.meaning; model.meaningOf = c.shown; if (m.use) model.use = m.use; return model; }
  }
  // No idiom: what the main call does (the last line or return that is a known function's call)
  for (const c of candidates) {
    const callee = /^([A-Za-z_]\w*)\s*\(/.exec(c.code)?.[1];
    if (!callee || !functionInfo(callee) || functionInfo(callee)!.kind === 'constructor') continue;
    const segs = explainCall(c.code, ctx);
    if (segs) { model.meaning = `${toPlainText(segs)}.`; model.meaningOf = c.shown; model.fnName = callee; break; }
  }
  return model;
}

const marker = (key: string) => `__pf_in_${key}__`;

/** The top-level arguments of the first call to `fn` in `code`, or null. */
function callArgs(code: string, fn: string): string[] | null {
  const m = new RegExp(`\\b${fn}\\s*\\(`).exec(code);
  if (!m) return null;
  const args: string[] = [];
  let depth = 0;
  let start = m.index + m[0].length;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      if (depth === 0) { args.push(code.slice(start, i).trim()); return args; }
      depth--;
    } else if (c === ',' && depth === 0) { args.push(code.slice(start, i).trim()); start = i + 1; }
  }
  return null;
}

/**
 * Which of the node's sockets feeds each argument of the GLSL function the node is: its code is
 * generated with a marker in every input, and an argument that is just a marker is that socket.
 * The label per argument (null where the argument is an expression or a constant), or null when
 * the node's code doesn't call the function.
 */
export function nodeFunctionArgLabels(node: GraphNode, def: NodeDefinition, fn: string): Array<string | null> | null {
  const inputVars: Record<string, string> = {};
  const byMarker = new Map<string, string>();
  for (const [key, sock] of Object.entries(def.inputs ?? {})) {
    inputVars[key] = marker(key);
    byMarker.set(marker(key), sock.label ?? def.paramDefs?.[key]?.label ?? key);
  }
  let code: string;
  try {
    code = def.generateGLSL({ ...node, params: { ...(def.defaultParams ?? {}), ...node.params } }, inputVars).code;
  } catch { return null; }
  const args = callArgs(code, fn);
  if (!args) return null;
  return args.map(a => byMarker.get(unwrapSafety(a)) ?? null);
}

/**
 * An argument with only a safety wrapper still is its socket: Pow's and Square Root's
 * `max(x, 0.0)` (off Exact), Reflect's `normalize(n)`, a cast that broadcasts a float.
 */
function unwrapSafety(arg: string): string {
  let a = arg.trim();
  for (let i = 0; i < 3; i++) {
    const m = /^\((.*)\)$/.exec(a)
      ?? /^max\(\s*([\w]+)\s*,\s*[\d.]+\s*\)$/.exec(a)
      ?? /^(?:normalize|float|vec[234])\(\s*([\w]+)\s*\)$/.exec(a);
    if (!m) break;
    a = m[1].trim();
  }
  return a;
}

/** Where an argument name stands in a meaning. `a` is also the article: "a straight blend" is not the argument. */
function argNamePattern(name: string): RegExp {
  if (name === 'a') return /(?<![\w.])a(?=\s*(?:is\b|=|[),.;:]|$))/g;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w.])${esc}(?!\\w)`, 'g');
}

/**
 * A built-in's plain meaning in the node's own words: each GLSL argument name the meaning uses
 * becomes the label of the socket that feeds it (step's "0 while x is below edge" → "0 while
 * Value is below Threshold"), with the call written in labels (`step(Threshold, Value)`). Null
 * unless every argument is one socket: Sin is amp × sin(input × freq), not sin's plain wave.
 */
export function nodeFunctionMeaning(node: GraphNode, def: NodeDefinition, info: FnInfo): { meaning: string; call: string } | null {
  const labels = nodeFunctionArgLabels(node, def, info.name);
  if (!labels || !labels.every((l): l is string => !!l)) return null;
  const ov = info.overloads.find(o => o.params.length === labels.length);
  if (!ov) return null;
  const parts: string[] = [];
  let meaning = info.meaning;
  // Longest names first (edge0 before edge); a placeholder per label, so a label that happens to
  // be another argument's name isn't replaced twice
  const order = ov.params.map((p, i) => ({ name: p.name, label: labels[i] })).sort((x, y) => y.name.length - x.name.length);
  for (const { name, label } of order) {
    const re = argNamePattern(name);
    meaning = meaning.replace(re, () => `\u0000${parts.push(label) - 1}\u0000`);
  }
  meaning = meaning.replace(/\u0000(\d+)\u0000/g, (_, i: string) => parts[Number(i)]);
  return { meaning, call: `${info.name}(${labels.join(', ')})` };
}
