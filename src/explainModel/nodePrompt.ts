/**
 * nodePrompt.ts — "Explain this node" (docs/explain-model.md): what a whole node is doing in this graph.
 * User-given labels and titles are never included (they steer a small model); nodes are named by TYPE.
 * Simple retrieval keeps the prompt small: only what this question needs — the node's own help text, its
 * stage in the picture's pipeline, the techniques found on it, what feeds it and what it feeds, the settings
 * that differ from a fresh node's, and (for code nodes) the code. Pure.
 */
import type { GraphNode } from '../types/nodeGraph';
import { STAGES, stageOfType } from '../structure/stages';
import { nodeContextFor, type BuiltPrompt, type NodeNamer } from './prompt';

/** What the node registry says about a node type (passed in, so this file stays free of the registry). */
export interface NodeDefInfo {
  label: string;
  category?: string;
  /** Its help text: the brief's summary, else the description. */
  help?: string;
  defaultParams?: Record<string, unknown>;
}

const SKIP_PARAMS = /^(__|label$|subgraph$|comment$|lines$|body$|glslFunctions$|result$|inputs$|outputs$|outputType$)/;

const showValue = (v: unknown): string => {
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (typeof v === 'string') return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  try { const j = JSON.stringify(v); return j.length > 50 ? `${j.slice(0, 50)}…` : j; } catch { return '…'; }
};

/** The settings that differ from a fresh node's, as "name = value (a fresh node has …)". */
export function changedParams(params: Record<string, unknown>, defaults: Record<string, unknown> = {}): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params ?? {})) {
    if (SKIP_PARAMS.test(k) || v === undefined || typeof v === 'function') continue;
    const d = defaults[k];
    if (d !== undefined && JSON.stringify(d) === JSON.stringify(v)) continue;
    out.push(d === undefined ? `${k} = ${showValue(v)}` : `${k} = ${showValue(v)} (a fresh node has ${showValue(d)})`);
    if (out.length >= 10) break;
  }
  return out;
}

/** The code a node holds, when it is a code node (an Expression Block or a Custom Function). */
export function nodeCode(node: GraphNode): string {
  if (node.type === 'customFn') return typeof node.params.body === 'string' ? node.params.body : '';
  if (node.type !== 'exprNode') return '';
  const lines = (node.params.lines as Array<{ lhs?: string; op?: string; rhs?: string; off?: boolean }> | undefined) ?? [];
  const out = lines.filter(l => l.rhs?.trim() && !l.off).map(l => `${l.lhs ?? ''} ${l.op || '='} ${l.rhs}`.trim());
  const ret = typeof node.params.result === 'string' ? node.params.result.trim() : '';
  if (ret) out.push(`return ${ret}`);
  return out.join('\n');
}

export const NODE_SYSTEM_PROMPT =
  'You explain one node of a shader node graph to a visual artist. ' +
  'In at most 3 short sentences say what this node is doing in this graph: its role, what feeds it, what it feeds, and what its current settings do to the picture. ' +
  'Use only the facts given. Do not repeat the code or list every setting. If something is not clear from the facts, say so briefly.';

/** The prompt for a whole node. */
export function promptForNode(node: GraphNode, nodes: readonly GraphNode[], def: NodeDefInfo, namer?: NodeNamer): BuiltPrompt {
  const ctx = nodeContextFor(nodes, node.id, namer);
  const stage = stageOfType(node.type);
  const facts: string[] = [];
  facts.push(`Node type: ${def.label}${def.category ? ` (category ${def.category})` : ''}`);
  if (def.help) facts.push(`What the node is for (its help): ${def.help.replace(/\s+/g, ' ').slice(0, 500)}`);
  if (stage !== 'any') facts.push(`Stage of the picture's pipeline: ${STAGES[stage].label}: ${STAGES[stage].line}`);
  for (const t of ctx?.techniques ?? []) facts.push(`Technique found on this node: ${t.name}: ${t.explain}`);
  if (ctx?.upstream.length) facts.push(`Fed by: ${ctx.upstream.map(u => `${u.name} -> ${u.socket}`).join('; ')}`);
  else facts.push('Fed by: nothing wired');
  if (ctx?.downstream.length) facts.push(`Feeds: ${ctx.downstream.map(d => `${d.name} (from ${d.socket})`).join('; ')}`);
  const changed = changedParams(node.params, def.defaultParams);
  if (changed.length) facts.push(`Settings changed from the defaults: ${changed.join('; ')}`);
  const code = nodeCode(node).trim();
  let body = `FACTS:\n${facts.map(f => `- ${f}`).join('\n')}`;
  if (code) {
    body += `\n\nIts code:\n${code.length > 900 ? `${code.slice(0, 900)}\n…` : code}`;
  }
  return {
    messages: [{ role: 'system', content: NODE_SYSTEM_PROMPT }, { role: 'user', content: `${body}\n\nExplain this node.` }],
    maxTokens: 140,
    context: body,
    used: facts,
  };
}
