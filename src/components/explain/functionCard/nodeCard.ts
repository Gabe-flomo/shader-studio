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
import { functionInfo } from '../../../lib/glslPatterns/functions';
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
    model.meaning = `Gives ${info.meaning}.`;
    if (info.use) model.use = info.use;
    model.fnName = info.name;
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
