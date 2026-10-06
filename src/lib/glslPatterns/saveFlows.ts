/**
 * Where a made function goes: an Expression Block preset, a user node (through the publish
 * flow), or back into code ("Use it here too"). Pure: the UI saves and wires what these build.
 */
import type { DataType, GraphNode, InputSocket } from '../../types/nodeGraph';
import type { ExprPreset } from '../../types/exprPreset';
import type { BuiltFunction, Generalised } from './generalise';

const asData = (t: string): DataType => (t === 'vec2' || t === 'vec3' || t === 'vec4' ? t : 'float') as DataType;

/** An Expression Block preset: inputs (float literals as sliders, with their defaults), no lines, the body as Return. */
export function toExprPreset(g: Generalised, built: BuiltFunction, label: string, description?: string): Omit<ExprPreset, 'id' | 'savedAt'> {
  const values: Record<string, number> = {};
  const inputs = built.params.map(p => {
    const slider = p.type === 'float' && p.default !== undefined ? { min: Math.min(p.slider?.min ?? 0, p.default), max: Math.max(p.slider?.max ?? 1, p.default) } : null;
    if (slider && p.default !== undefined) values[p.name] = p.default;
    return { name: p.name, type: asData(p.type), slider };
  });
  return {
    label: label.trim() || g.label,
    inputs,
    outputType: asData(built.outputType),
    lines: [],
    result: built.body,
    comment: description ?? g.description,
    values,
    pattern: built.pattern,
  };
}

/** The node params an Expression Block preset places with (shared by the palette and "Use it here too"). */
export function exprPresetParams(p: Pick<ExprPreset, 'label' | 'inputs' | 'outputType' | 'lines' | 'result' | 'comment' | 'values'>): Record<string, unknown> {
  return {
    label: p.label, inputs: p.inputs, outputType: p.outputType, lines: p.lines, result: p.result,
    ...(p.comment ? { __comment: p.comment } : {}),
    ...(p.values ?? {}),
  };
}

/**
 * A detached Expression Block standing for the made function, for the publish dialog
 * (`PublishNodeModal source={{ kind: 'node', node }} detached`): every parameter is an input
 * port, float literals carry their slider and default.
 */
export function toPublishNode(g: Generalised, built: BuiltFunction, label: string, description?: string): GraphNode {
  const preset = toExprPreset(g, built, label, description);
  const inputs: Record<string, InputSocket> = {};
  for (const i of preset.inputs) inputs[i.name] = { type: i.type, label: i.name, ...(i.slider ? { defaultValue: preset.values?.[i.name] ?? 0 } : {}) };
  return {
    id: 'made_fn',
    type: 'exprNode',
    position: { x: 0, y: 0 },
    inputs,
    outputs: { result: { type: preset.outputType, label: 'Result' } },
    params: { ...exprPresetParams(preset), __description: description ?? g.description },
  } as GraphNode;
}

/**
 * GLSL page / any shader text: put the function above the function that holds `span` (or
 * above `main`, or at the end), and replace the span with the call. Returns the new text and
 * where the call now sits.
 */
export function insertFunction(code: string, fnCode: string, span: { start: number; end: number }, call: string): { code: string; callStart: number; callEnd: number } {
  // The start of the top-level function that contains the span
  const fnHead = /^[ \t]*(?:void|float|int|bool|vec[234]|mat[234])\s+[A-Za-z_]\w*\s*\([^)]*\)\s*\{/gm;
  let insertAt = -1;
  let m: RegExpExecArray | null;
  while ((m = fnHead.exec(code))) { if (m.index <= span.start) insertAt = m.index; else break; }
  if (insertAt < 0) { const main = /^[ \t]*void\s+main\s*\(/m.exec(code); insertAt = main ? main.index : code.length; }
  const block = `${fnCode}\n\n`;
  const replaced = code.slice(0, span.start) + call + code.slice(span.end);
  const before = insertAt <= span.start;
  const out = replaced.slice(0, insertAt) + (insertAt === replaced.length && !replaced.endsWith('\n') ? '\n\n' : '') + block + replaced.slice(insertAt);
  const shift = before ? block.length + (insertAt === replaced.length && !replaced.endsWith('\n') ? 2 : 0) : 0;
  return { code: out, callStart: span.start + shift, callEnd: span.start + shift + call.length };
}

/** Custom Function: the helper block gains the function, the body's span becomes the call. */
export function callInCustomFn(body: string, helpers: string, fnCode: string, span: { start: number; end: number }, call: string): { body: string; helpers: string } {
  const name = /\s([A-Za-z_]\w*)\s*\(/.exec(fnCode)?.[1];
  const has = name ? new RegExp(`\\b${name}\\s*\\(`).test(helpers) : false;
  return {
    body: body.slice(0, span.start) + call + body.slice(span.end),
    helpers: has ? helpers : `${helpers.replace(/\s+$/, '')}${helpers.trim() ? '\n\n' : ''}${fnCode}\n`,
  };
}
