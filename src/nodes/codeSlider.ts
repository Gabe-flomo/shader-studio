/**
 * "Make a slider" on a code node: a number in an Expression Block's line or Return, or in a
 * Custom Function's body, becomes a float input with a slider, starting at that number, and the
 * code reads the input instead. The picture doesn't change (the slider holds the same value).
 *
 * Pure: returns the params to write; the editor writes them (one undo step) and refreshes the
 * sockets. The text work is lib/glslPatterns/literalSlider.ts, shared with any code host.
 */
import type { GraphNode } from '../types/nodeGraph';
import { literalToSlider, namesIn, type LiteralNameContext, type LiteralSpan } from '../lib/glslPatterns/literalSlider';

export interface CodeInputDef {
  name: string;
  type: string;
  slider?: { min: number; max: number } | null;
  [k: string]: unknown;
}

/** Where in an Expression Block the number is: a line's target or expression, or Return. */
export type ExprSliderWhere = { kind: 'line'; index: number; field: 'lhs' | 'rhs' } | { kind: 'return' };

export interface CodeSliderResult {
  /** Params to write: the inputs, the changed code and the new input's value. */
  params: Record<string, unknown>;
  inputs: CodeInputDef[];
  name: string;
  value: number;
  /** The changed text and where the input now sits in it (for the caret). */
  text: string;
  start: number;
  end: number;
}

type Line = { lhs: string; op: string; rhs: string; off?: boolean };

const inputsOf = (node: GraphNode): CodeInputDef[] =>
  Array.isArray(node.params.inputs) ? (node.params.inputs as CodeInputDef[]).filter(i => i && typeof i.name === 'string') : [];

const addInput = (inputs: CodeInputDef[], made: { name: string; slider: { min: number; max: number } }): CodeInputDef[] =>
  [...inputs, { name: made.name, type: 'float', slider: made.slider }];

/** Every name the node's code already uses: inputs, line variables, helpers, and the block's own `t` and `p`. */
export function namesInCodeNode(node: GraphNode): Set<string> {
  const lines = Array.isArray(node.params.lines) ? (node.params.lines as Line[]) : [];
  const texts = [
    ...lines.flatMap(l => [l?.lhs ?? '', l?.rhs ?? '']),
    typeof node.params.result === 'string' ? node.params.result : '',
    typeof node.params.body === 'string' ? node.params.body : '',
    typeof node.params.glslFunctions === 'string' ? node.params.glslFunctions : '',
  ];
  const taken = namesIn(...texts);
  for (const i of inputsOf(node)) taken.add(i.name);
  for (const o of Array.isArray(node.params.outputs) ? node.params.outputs as Array<string | { name: string }> : []) taken.add(typeof o === 'string' ? o : o?.name);
  // Names the compiler gives the block, and params the node already keeps (a stale value under a reused name)
  for (const n of ['t', 'p', 'result', 'label', 'inputs', 'lines', 'body', 'expr', 'outputs', 'outputType']) taken.add(n);
  for (const k of Object.keys(node.params)) taken.add(k);
  return taken;
}

/** An Expression Block: the number `lit` in a line or Return becomes a slider input. */
export function exprBlockMakeSlider(node: GraphNode, where: ExprSliderWhere, lit: LiteralSpan, ctx: LiteralNameContext = {}): CodeSliderResult | null {
  const lines = Array.isArray(node.params.lines) ? (node.params.lines as Line[]) : [];
  const text = where.kind === 'return'
    ? (typeof node.params.result === 'string' ? node.params.result : '')
    : (lines[where.index]?.[where.field] ?? '');
  if (text.slice(lit.start, lit.end) !== lit.text) return null;
  const made = literalToSlider(text, lit, namesInCodeNode(node), ctx);
  const inputs = addInput(inputsOf(node), made);
  const code = where.kind === 'return'
    ? { result: made.text }
    : { lines: lines.map((l, i) => (i === where.index ? { ...l, [where.field]: made.text } : l)) };
  return { params: { inputs, ...code, [made.name]: made.value }, inputs, name: made.name, value: made.value, text: made.text, start: made.start, end: made.end };
}

/** A Custom Function: the number `lit` in its body becomes a slider input. */
export function customFnMakeSlider(node: GraphNode, lit: LiteralSpan, ctx: LiteralNameContext = {}): CodeSliderResult | null {
  const body = typeof node.params.body === 'string' ? node.params.body : '';
  if (body.slice(lit.start, lit.end) !== lit.text) return null;
  const made = literalToSlider(body, lit, namesInCodeNode(node), ctx);
  const inputs = addInput(inputsOf(node), made);
  return { params: { inputs, body: made.text, [made.name]: made.value }, inputs, name: made.name, value: made.value, text: made.text, start: made.start, end: made.end };
}
