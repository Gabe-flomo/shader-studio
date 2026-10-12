/**
 * An Expression Block as plain GLSL, and as a Custom Function.
 *
 *  - exprBlockLinesText: the block's lines as they compile, then `return …;` (Copy as code).
 *  - exprBlockFunctionText: the same as a whole GLSL function, its inputs as parameters
 *    (sliders included), so it pastes into any shader.
 *  - exprBlockToCustomFn: the block turned into a Custom Function in place (same id, so wires,
 *    sliders, keyframes and Play controls stay). The body is the lines and the return; what the
 *    block gave for free is written out: `float t = u_time;` and the scratch `p` when the lines
 *    use them, and a local copy of any input a line writes to (a Custom Function's inputs are
 *    the upstream values themselves, so they can't be assigned). Exposed locals become the
 *    function's extra outputs. A block whose inputs carry between loop iterations, or that
 *    outputs one of its inputs, stays a block (null, with the reason).
 */
import type { GraphNode } from '../types/nodeGraph';
import { codeLinesFor, fnNameFrom } from '../components/NodeGraph/codeCard/codeCardModel';
import { loopCode, loopCountValue, loopMax, loopOf } from './exprLoop';

type Line = { lhs: string; op?: string; rhs: string; off?: boolean };
type InputDef = { name: string; type: string; slider?: { min: number; max: number } | null; carry?: boolean; [k: string]: unknown };

const zeroOf = (t: string) => (t === 'float' ? '0.0' : t === 'int' ? '0' : t === 'bool' ? 'false' : `${t}(0.0)`);
const DECL = /^\s*(float|int|bool|vec[234]|mat[234])\s+([A-Za-z_]\w*)\s*$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const usable = (l: Line | undefined): l is Line => !!l && !!l.lhs?.trim() && !!l.rhs?.trim();
const linesOf = (node: GraphNode): Line[] => (Array.isArray(node.params.lines) ? (node.params.lines as Line[]) : []).filter(usable);
const inputsOf = (node: GraphNode): InputDef[] => (Array.isArray(node.params.inputs) ? (node.params.inputs as InputDef[]) : []).filter(i => i && typeof i.name === 'string' && i.name.trim());

/** The block's code as plain GLSL lines (off lines kept as comments), ending in `return …;`. */
export function exprBlockLinesText(node: GraphNode): string {
  return codeLinesFor(node).join('\n');
}

/** The block as one GLSL function: `vec3 ring_glow(vec2 uv, float radius) { … }`. */
export function exprBlockFunctionText(node: GraphNode): string {
  const outType = (node.params.outputType as string) || 'float';
  const label = typeof node.params.label === 'string' ? node.params.label : undefined;
  const name = fnNameFrom(label, 'expression');
  const params = inputsOf(node).map(i => `${i.type} ${i.name}`);
  const body = codeLinesFor(node);
  const pre: string[] = [];
  const all = body.join('\n');
  const declared = new Set(inputsOf(node).map(i => i.name));
  if (!declared.has('t') && /\bt\b/.test(all)) pre.push('float t = u_time;');
  if (!declared.has('p') && /\bp\b/.test(all) && !linesOf(node).some(l => DECL.exec(l.lhs)?.[2] === 'p')) pre.push(`${outType} p = ${zeroOf(outType)};`);
  const helpers = typeof node.params.glslFunctions === 'string' && node.params.glslFunctions.trim() ? `${node.params.glslFunctions.trim()}\n\n` : '';
  // Slider values as a comment, so the numbers the picture uses travel with the code
  const values = inputsOf(node).filter(i => i.slider && typeof node.params[i.name] === 'number').map(i => `${i.name} = ${node.params[i.name]}`);
  const head = values.length ? `// ${values.join(', ')}\n` : '';
  return `${helpers}${head}${outType} ${name}(${params.join(', ')}) {\n${[...pre, ...body].map(l => `  ${l}`).join('\n')}\n}`;
}

export type ToCustomFn = { ok: true; node: GraphNode } | { ok: false; reason: string };

export function exprBlockToCustomFn(node: GraphNode): ToCustomFn {
  if (node.type !== 'exprNode') return { ok: false, reason: 'Only an Expression Block turns into a Custom Function.' };
  const inputs = inputsOf(node);
  if (inputs.some(i => i.carry)) return { ok: false, reason: 'Its inputs carry from one loop iteration to the next, which a Custom Function can’t do.' };
  const outType = (node.params.outputType as string) || 'float';
  const lines = linesOf(node);
  const exposed = ((node.params.outputs as string[] | undefined) ?? []).filter(n => typeof n === 'string' && /^[A-Za-z_]\w*$/.test(n) && n !== 'result');
  const inputNames = new Set(inputs.map(i => i.name));
  const exposedInput = exposed.find(n => inputNames.has(n));
  if (exposedInput) return { ok: false, reason: `It also outputs its input “${exposedInput}”, which a Custom Function can’t.` };

  const loop = loopOf(node.params);
  const sections = loop ? { before: (loop.before ?? []).filter(usable), after: (loop.after ?? []).filter(usable) } : { before: [], after: [] };
  const every = [...sections.before, ...lines, ...sections.after];
  // Inputs a line writes to get a local copy: `uv *= 2.0` reads `uv_v *= 2.0` after `vec2 uv_v = uv;`
  const written = new Set<string>();
  for (const l of every) {
    if (l.off || DECL.test(l.lhs)) continue;
    const root = /^\s*([A-Za-z_]\w*)/.exec(l.lhs)?.[1];
    if (root && inputNames.has(root)) written.add(root);
  }
  const allText = [...every.map(l => `${l.lhs} ${l.rhs}`), String(node.params.result ?? ''), loop?.breakWhen ?? ''].join('\n');
  const taken = new Set([...inputNames, ...(allText.match(/[A-Za-z_]\w*/g) ?? [])]);
  const local: Record<string, string> = {};
  for (const n of written) { let v = `${n}_v`, k = 2; while (taken.has(v)) v = `${n}_v${k++}`; taken.add(v); local[n] = v; }
  const renameLocals = (s: string) => Object.entries(local).reduce((acc, [from, to]) => acc.replace(new RegExp(`(^|[^.\\w])${esc(from)}\\b`, 'g'), `$1${to}`), s);

  // The exposed locals are the function's outputs: their declarations lose the type (the output is declared outside)
  const exposedTypes: Record<string, string> = {};
  const body: string[] = [];
  const declaredHere = new Set<string>();
  // A line as the function writes it: renamed locals, an exposed local's declaration without its type
  const rewrite = (l: Line): Line => {
    let lhs = l.lhs.trim();
    const d = DECL.exec(lhs);
    if (d) {
      declaredHere.add(d[2]);
      if (exposed.includes(d[2])) { exposedTypes[d[2]] = d[1]; lhs = d[2]; }
    }
    return { ...l, lhs: renameLocals(lhs), rhs: renameLocals(l.rhs.trim()) };
  };
  let iterInput: InputDef | null = null;
  if (loop) {
    // The loop as a real for loop; Iterations becomes a slider input of the function (still live)
    let iterName = 'iterations', k = 2;
    while (taken.has(iterName)) iterName = `iterations${k++}`;
    const max = loopMax(loop);
    iterInput = { name: iterName, type: 'float', slider: { min: 1, max } };
    const declared = new Set<string>([...inputNames, ...Object.values(local), 't', 'p', ...exposed]);
    const code = loopCode({
      before: sections.before.map(rewrite), body: lines.map(rewrite), after: sections.after.map(rewrite),
      breakWhen: loop.breakWhen ? renameLocals(loop.breakWhen) : undefined, max, count: iterName, declared, countVar: 'loop_n',
    });
    for (const c of code) body.push(...c.text.split('\n').map(t => `${'  '.repeat(c.depth)}${t}`));
  } else {
    for (const l of lines) {
      const r = rewrite(l);
      const stmt = `${r.lhs} ${l.op || '='} ${r.rhs};`;
      body.push(l.off ? `// off: ${stmt.replace(/\n/g, ' ')}` : stmt);
    }
  }
  const result = (typeof node.params.result === 'string' ? node.params.result.trim() : '') || zeroOf(outType);
  body.push(`return ${renameLocals(result)};`);

  const pre: string[] = [];
  const used = body.join('\n');
  if (!inputNames.has('t') && !declaredHere.has('t') && /(^|[^.\w])t\b/.test(used)) pre.push('float t = u_time;');
  if (!inputNames.has('p') && !declaredHere.has('p') && /(^|[^.\w])p\b/.test(used)) pre.push(`${outType} p = ${zeroOf(outType)};`);
  for (const [from, to] of Object.entries(local)) pre.push(`${inputs.find(i => i.name === from)!.type} ${to} = ${from};`);

  const outputs = exposed.map(n => ({ name: n, type: exposedTypes[n] ?? node.outputs?.[n]?.type ?? outType }));
  const { lines: _l, result: _r, expr: _e, outputs: _o, fnBuilderFns: _f, fnBuilderActiveId: _a, loop: _lp, loopN: _ln, ...keep } = node.params as Record<string, unknown>;
  void _l; void _r; void _e; void _o; void _f; void _a; void _lp; void _ln;
  const label = typeof node.params.label === 'string' && node.params.label.trim() && node.params.label !== 'Expression Block' ? node.params.label : 'Custom Function';
  return {
    ok: true,
    node: {
      ...node,
      type: 'customFn',
      params: {
        ...keep,
        label,
        inputs: iterInput ? [...inputs, iterInput] : inputs,
        ...(iterInput ? { [iterInput.name]: loopCountValue(node.params) } : {}),
        outputType: outType,
        body: [...pre, ...body].join('\n'),
        glslFunctions: typeof node.params.glslFunctions === 'string' ? node.params.glslFunctions : '',
        ...(outputs.length ? { outputs } : {}),
      },
    },
  };
}
