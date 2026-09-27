/**
 * nodeCode.ts — a node type's GLSL, for a Present code block: its helper
 * functions (glslFunction / glslFunctions), the lines it adds to main() with
 * its default settings (generateGLSL on a fresh node, with UV and Time wired
 * so the lines read the way they do in a graph), its inputs and outputs with
 * their types and hints, its settings, and a short "how it works" from its
 * description.
 *
 * Some node types build nothing on their own (groups, loops, 3D scenes, the
 * output): they have no code to quote and are left out of the list.
 */
import { getNodeDefinition, getOfferedDefinitions } from '../nodes/definitions';
import { instantiateNode } from '../nodes/scene3dDefaults';
import { scoreNodeDef } from '../nodes/searchNodes';
import type { NodeDefinition } from '../types/nodeGraph';

export interface NodeSocketInfo { key: string; label: string; type: string; hint?: string; value?: string }
export interface NodeParamInfo { key: string; label: string; value: string; hint?: string; range?: string }

export interface NodeCodeInfo {
  type: string;
  label: string;
  category: string;
  subcategory?: string;
  description: string;
  inputs: NodeSocketInfo[];
  outputs: NodeSocketInfo[];
  params: NodeParamInfo[];
  /** Its helper functions, as the shader carries them. */
  functions: string;
  /** Its lines in main() with its default settings. */
  body: string;
  /** Where each output ends up in `body`: output key → variable. */
  outputVars: Record<string, string>;
  /** One or two sentences: what it does and how. */
  howItWorks: string;
}

/** What the generated lines are named after (a node's id): short and readable. */
const NODE_ID = 'node';

const fmtNum = (v: unknown): string => {
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (Array.isArray(v)) return `(${v.map(fmtNum).join(', ')})`;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return v;
  return '';
};

function dedent(s: string): string {
  const lines = s.replace(/\r/g, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => /^\s*/.exec(l)![0].length));
  return lines.map(l => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

/** The input variables a graph would hand the node for its position and time, so the lines read as they do there. */
function wiredInputs(def: NodeDefinition): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, s] of Object.entries(def.inputs)) {
    if (s.field) continue;
    const k = key.toLowerCase(), l = s.label.toLowerCase();
    if (s.type === 'vec2' && (/^(uv|p|pos|position|point|coord|coords|st)$/.test(k) || /^uv\b|position/.test(l))) out[key] = 'g_uv';
    else if (s.type === 'float' && (k === 'time' || l === 'time')) out[key] = 'u_time';
  }
  return out;
}

const firstSentences = (text: string, n = 2) => {
  const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [];
  return parts.slice(0, n).join('').trim();
};

/** A node type's code and what it takes and gives, or null when it has none of its own. */
export function nodeCode(type: string): NodeCodeInfo | null {
  const def = getNodeDefinition(type);
  if (!def) return null;
  const functions = [def.glslFunction ?? '', ...(def.glslFunctions ?? [])].map(s => s.trim()).filter(Boolean);
  let body = '';
  let outputVars: Record<string, string> = {};
  try {
    const node = instantiateNode(NODE_ID, def.type, def, { x: 0, y: 0 });
    const r = def.generateGLSL(node, wiredInputs(def));
    body = dedent(r.code ?? '');
    outputVars = r.outputVars ?? {};
    for (const f of def.glslFunctionsFor?.(node) ?? []) if (f.trim() && !functions.includes(f.trim())) functions.push(f.trim());
  } catch { /* some types only compile inside a graph (groups, scenes): no body */ }
  if (!functions.length && !body.trim()) return null;
  const desc = (Array.isArray(def.description) ? def.description.join(' ') : def.description ?? '').trim();
  const wired = wiredInputs(def);
  const inputs = Object.entries(def.inputs).map(([key, s]) => {
    const v = def.defaultParams?.[key];
    return { key, label: s.label, type: s.type, ...(s.hint ? { hint: s.hint } : {}), ...(wired[key] ? { value: wired[key] === 'g_uv' ? 'the position (g_uv)' : 'the time (u_time)' } : v !== undefined ? { value: fmtNum(v) } : {}) };
  });
  const outputs = Object.entries(def.outputs).map(([key, s]) => ({ key, label: s.label, type: s.type, ...(s.hint ? { hint: s.hint } : {}), ...(outputVars[key] ? { value: outputVars[key] } : {}) }));
  const params = Object.entries(def.paramDefs ?? {}).filter(([key]) => !(key in def.inputs)).map(([key, pd]) => ({
    key, label: pd.label, value: fmtNum(def.defaultParams?.[key]),
    ...(pd.hint ? { hint: pd.hint } : {}), ...(pd.min !== undefined && pd.max !== undefined ? { range: `${pd.min} to ${pd.max}` } : {}),
  }));
  const how = [firstSentences(desc) || `${def.label}, from the ${def.category} nodes.`];
  if (functions.length) {
    const names = functions.flatMap(f => [...f.matchAll(/^\s*(?:\w+)\s+(\w+)\s*\([^)]*\)\s*\{/gm)].map(m => m[1]));
    if (names.length) how.push(`Its work is done by ${names.length === 1 ? `the function ${names[0]}()` : `the functions ${names.slice(0, -1).map(n => `${n}()`).join(', ')} and ${names[names.length - 1]}()`}${body.trim() ? ', which its line in main() calls' : ''}.`);
  }
  return {
    type: def.type, label: def.label, category: def.category, ...(def.subcategory ? { subcategory: def.subcategory } : {}),
    description: desc, inputs, outputs, params, functions: functions.join('\n\n'), body, outputVars, howItWorks: how.join(' '),
  };
}

export interface NodeCodeParts { functions: boolean; body: boolean; sockets: boolean }

/** The text a code block gets: any of the header comment (inputs and outputs), the helpers and the lines. */
export function nodeCodeText(info: NodeCodeInfo, parts: NodeCodeParts): string {
  const out: string[] = [];
  if (parts.sockets) {
    const line = (s: NodeSocketInfo) => `//   ${s.type.padEnd(5)} ${s.label}${s.value ? ` = ${s.value}` : ''}${s.hint ? `: ${s.hint}` : ''}`;
    out.push([
      `// ${info.label} (${info.category})`,
      ...(info.inputs.length ? ['// Inputs:', ...info.inputs.map(line)] : []),
      ...(info.outputs.length ? ['// Outputs:', ...info.outputs.map(line)] : []),
    ].join('\n'));
  }
  if (parts.functions && info.functions) out.push(info.functions);
  if (parts.body && info.body) out.push(`${(parts.functions && info.functions) || parts.sockets ? '// In main(), with its default settings:\n' : ''}${info.body}`);
  return out.join('\n\n');
}

export interface NodeListEntry { type: string; label: string; category: string; description: string }

/** Every node type with code of its own, by category, for browsing; `query` narrows and ranks. */
export function listNodeTypes(query = ''): NodeListEntry[] {
  const defs = getOfferedDefinitions();
  const scored = defs.map(d => ({ d, s: scoreNodeDef(d, query) })).filter(x => x.s > 0);
  if (query.trim()) scored.sort((a, b) => b.s - a.s || a.d.label.localeCompare(b.d.label));
  const out: NodeListEntry[] = [];
  for (const { d } of scored) {
    if (!d.glslFunction && !(d.glslFunctions?.length) && !hasBody(d)) continue;
    out.push({ type: d.type, label: d.label, category: d.category, description: (Array.isArray(d.description) ? d.description.join(' ') : d.description ?? '').trim() });
  }
  return out;
}

const bodyCache = new Map<string, boolean>();
function hasBody(def: NodeDefinition): boolean {
  const hit = bodyCache.get(def.type);
  if (hit !== undefined) return hit;
  let ok = false;
  try { ok = !!def.generateGLSL(instantiateNode(NODE_ID, def.type, def, { x: 0, y: 0 }), wiredInputs(def)).code?.trim(); } catch { ok = false; }
  bodyCache.set(def.type, ok);
  return ok;
}
