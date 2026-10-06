/**
 * The card face of an Expression Block (exprNode) or a Custom Function (customFn): what each
 * page of its carousel shows, worked out from the node alone (plus the labels of what feeds it).
 * Pure, so the card, the mobile browser and the tests share it.
 *
 *   code        the block's lines as they compile (read-only on the card), or the function body
 *   signature   an abstract signature from the inputs, their types and their wiring
 *   note        the node's comment (params.__comment) and its credit
 *   description the block's own description (params.__description), else the definition's
 */
import type { GraphNode } from '../../../types/nodeGraph';

export type CardPageId = 'code' | 'signature' | 'note' | 'description';
export const CARD_PAGE_ORDER: readonly CardPageId[] = ['code', 'signature', 'note', 'description'];
export const CARD_PAGE_LABEL: Record<CardPageId, string> = { code: 'Code', signature: 'Signature', note: 'Note', description: 'Description' };

export function isCodeCardNode(node: Pick<GraphNode, 'type'>): boolean {
  return node.type === 'exprNode' || node.type === 'customFn';
}

type ExprLine = { lhs?: string; op?: string; rhs?: string; off?: boolean };
type InputDef = { name: string; type: string; slider?: { min: number; max: number } | null; carry?: boolean };

const zeroOf = (t: string) => (t === 'float' ? '0.0' : /^(vec[234]|mat[234]|int|bool)$/.test(t) ? `${t}(0.0)` : 'vec3(0.0)');

/** The declared inputs: params.inputs, or (old graphs without it) the node's own input sockets. */
export function declaredInputs(node: GraphNode): InputDef[] {
  const raw = node.params.inputs;
  if (Array.isArray(raw)) {
    return raw
      .filter((i): i is InputDef => !!i && typeof i === 'object' && typeof (i as InputDef).name === 'string' && (i as InputDef).name.trim() !== '')
      .map(i => ({ ...i, type: typeof i.type === 'string' && i.type ? i.type : (node.inputs[i.name]?.type ?? 'float') }));
  }
  return Object.entries(node.inputs ?? {}).map(([name, s]) => ({ name, type: s.type }));
}

/**
 * The read-only code shown on the card, one string per line.
 * Expression Block: each line exactly as it compiles (incomplete lines are skipped, off lines
 * are kept as `// off: …` comments), then `return <result>;`. Custom Function: its body as written.
 */
export function codeLinesFor(node: GraphNode): string[] {
  if (node.type === 'customFn') {
    const body = typeof node.params.body === 'string' ? node.params.body : '';
    const lines = body.replace(/\s+$/, '').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    return lines.length ? lines : [];
  }
  const outType = (node.params.outputType as string) || 'vec3';
  const lines = node.params.lines as ExprLine[] | undefined;
  const out: string[] = [];
  if (Array.isArray(lines)) {
    for (const l of lines) {
      if (!l || !l.lhs || !l.rhs) continue;
      if (l.off) out.push(`// off: ${`${l.lhs} ${l.op || '='} ${l.rhs}`.replace(/\n/g, ' ')}`);
      else out.push(...`${l.lhs} ${l.op || '='} ${l.rhs};`.split('\n'));
    }
    const result = (node.params.result as string | undefined)?.trim() || '';
    out.push(...`return ${result || zeroOf(outType)};`.split('\n'));
    return out;
  }
  // Legacy semicolon-separated `expr`
  const parts = (((node.params.expr as string) || zeroOf(outType)).trim()).split(';').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return [`return ${zeroOf(outType)};`];
  for (let i = 0; i < parts.length - 1; i++) out.push(`${parts[i]};`);
  out.push(`return ${parts[parts.length - 1]};`);
  return out;
}

/** Nothing written yet: no lines (or body) of its own, the result is blank, an input passed through, or the default. */
export function isEmptyCodeNode(node: GraphNode): boolean {
  if (node.type === 'customFn') {
    const body = typeof node.params.body === 'string' ? node.params.body.trim() : '';
    return body === '' || /^(return\s+)?0(\.0*)?;?$/.test(body);
  }
  const lines = node.params.lines;
  if (!Array.isArray(lines)) {
    const expr = typeof node.params.expr === 'string' ? node.params.expr.trim() : '';
    return expr === '' || declaredInputs(node).some(i => i.name === expr);
  }
  if ((lines as ExprLine[]).some(l => l && l.lhs && l.rhs)) return false;
  const result = typeof node.params.result === 'string' ? node.params.result.trim() : '';
  return result === '' || result === 'p' || declaredInputs(node).some(i => i.name === result);
}

// ── Signature ────────────────────────────────────────────────────────────────

export interface SignatureParam {
  name: string;
  type: string;
  /** How the value arrives: a wire, the card's slider, a loop carry, or nothing (the type's zero). */
  source: 'wire' | 'slider' | 'carry' | 'unwired';
  /** For a wire: "<node label> · <output>". */
  from?: string;
  /** For a slider: its current value. */
  value?: number;
}
export interface Signature {
  returnType: string;
  name: string;
  params: SignatureParam[];
  /** Extra outputs (exposed locals, or a Custom Function's `out` parameters). */
  outs: Array<{ name: string; type: string }>;
}

/** A GLSL-safe function name from a label: "Ring Glow" → ring_glow. */
export function fnNameFrom(label: string | undefined, fallback: string): string {
  const s = (label ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '');
  return s || fallback;
}

/** Labels of what feeds the node's inputs, keyed by input name: "<node label> · <output>". */
export type SourceLabels = Record<string, string>;

/** The upstream labels for one node, from the whole graph. */
export function sourceLabelsFor(node: GraphNode, nodes: readonly GraphNode[], labelOf: (n: GraphNode) => string): SourceLabels {
  const out: SourceLabels = {};
  for (const [name, sock] of Object.entries(node.inputs ?? {})) {
    const c = sock?.connection;
    if (!c) continue;
    const src = nodes.find(n => n.id === c.nodeId);
    const outLabel = src?.outputs?.[c.outputKey]?.label ?? c.outputKey;
    out[name] = src ? `${labelOf(src)} · ${outLabel}` : c.nodeId;
  }
  return out;
}

/** A stable string for the source labels, so a store selector only changes when they do. */
export function sourceLabelsKey(labels: SourceLabels): string {
  return Object.keys(labels).sort().map(k => `${k}\u0001${labels[k]}`).join('\u0002');
}
export function parseSourceLabelsKey(key: string): SourceLabels {
  const out: SourceLabels = {};
  if (!key) return out;
  for (const part of key.split('\u0002')) { const [k, v] = part.split('\u0001'); out[k] = v; }
  return out;
}

/**
 * The function signature the card shows, built from the node's own declarations and its wiring:
 * `vec3 spiral_field(float angle, float radius, …)`. A Custom Function's is its real one
 * (inputs, output type, `out` parameters); an Expression Block's reads like one.
 */
export function signatureFor(node: GraphNode, sources: SourceLabels = {}): Signature {
  const isFn = node.type === 'customFn';
  const label = typeof node.params.label === 'string' ? node.params.label : undefined;
  const name = isFn
    ? fnNameFrom(label && label !== 'Custom Function' ? label : undefined, 'custom_fn')
    : fnNameFrom(label, 'expression');
  const returnType = (node.params.outputType as string) || node.outputs?.result?.type || (isFn ? 'float' : 'vec3');
  const params: SignatureParam[] = declaredInputs(node).map(inp => {
    const type = node.inputs?.[inp.name]?.type ?? inp.type;
    const wired = !!node.inputs?.[inp.name]?.connection;
    if (wired) return { name: inp.name, type, source: 'wire', from: sources[inp.name] };
    if (inp.carry) return { name: inp.name, type, source: 'carry' };
    if (inp.slider && type === 'float') {
      const v = node.params[inp.name];
      return { name: inp.name, type, source: 'slider', value: typeof v === 'number' ? v : (inp.slider.min + inp.slider.max) / 2 };
    }
    return { name: inp.name, type, source: 'unwired' };
  });
  let outs: Array<{ name: string; type: string }> = [];
  if (isFn) {
    outs = ((node.params.outputs as Array<{ name: string; type: string }> | undefined) ?? [])
      .filter(o => o && /^[A-Za-z_]\w*$/.test(o.name) && o.name !== 'result')
      .map(o => ({ name: o.name, type: o.type || 'float' }));
  } else {
    const exposed = ((node.params.outputs as string[] | undefined) ?? []).filter(n => typeof n === 'string' && /^[A-Za-z_]\w*$/.test(n) && n !== 'result');
    outs = exposed.map(n => ({ name: n, type: node.outputs?.[n]?.type ?? params.find(p => p.name === n)?.type ?? returnType }));
  }
  return { returnType, name, params, outs };
}

/** The signature as one line of GLSL-ish text (for titles, copy, tests). */
export function signatureText(sig: Signature): string {
  const ps = [...sig.params.map(p => `${p.type} ${p.name}`), ...sig.outs.map(o => `out ${o.type} ${o.name}`)];
  return `${sig.returnType} ${sig.name}(${ps.join(', ')})`;
}

// ── Pages ────────────────────────────────────────────────────────────────────

export function noteOf(node: GraphNode): string {
  return typeof node.params.__comment === 'string' ? node.params.__comment.trim() : '';
}
export function userDescriptionOf(node: GraphNode): string {
  return typeof node.params.__description === 'string' ? node.params.__description.trim() : '';
}

/** Which pages the card has, in order. Empty pages are left out; the signature is always there. */
export function cardPages(node: GraphNode, defDescription?: string): CardPageId[] {
  const pages: CardPageId[] = [];
  if (!isEmptyCodeNode(node)) pages.push('code');
  pages.push('signature');
  if (noteOf(node) || node.params.__credit) pages.push('note');
  if (userDescriptionOf(node) || (defDescription ?? '').trim()) pages.push('description');
  return pages;
}

/** The page to show: the remembered one if the card still has it, else the first. */
export function resolvePage(pages: readonly CardPageId[], remembered: CardPageId | undefined): CardPageId {
  return remembered && pages.includes(remembered) ? remembered : pages[0];
}

/** The page `step` away (wrapping), for arrows, swipes and keys. */
export function stepPage(pages: readonly CardPageId[], current: CardPageId, step: number): CardPageId {
  const i = Math.max(0, pages.indexOf(current));
  return pages[(i + step + pages.length * 4) % pages.length];
}
