/**
 * Bounds (docs/bounds-node.md): keeps a number or a position inside a range or a box.
 *
 *   Clip    clamp: it stops at the edge.
 *   Wrap    it leaves one side and comes back in on the other (mod).
 *   Bounce  it ping-pongs between the edges, as a ball between walls; Direction is +1 while it moves
 *           the same way as the input and −1 on the way back, so velocity × Direction flips at a wall.
 *   Soft    it slows into the edge and never quite reaches it (a soft knee Softness wide).
 *
 * Works on a float, a vec2 or a vec3: the card's type pills (VECTORIZABLE_NODES, alsoOutputs for
 * Direction) or a wire retype Value, Min, Max, the bounded Value and Direction. Min and Max are a
 * slider pair per axis, or a wire into Min / Max (every axis at once). Everything is inline GLSL
 * (no helper function) so the tests run the emitted code on the CPU.
 */
import type { DataType, GraphNode, NodeDefinition, ParamDef } from '../../types/nodeGraph';
import { p } from './helpers';

export type BoundsType = 'float' | 'vec2' | 'vec3';
export type BoundsBehaviour = 'clip' | 'wrap' | 'bounce' | 'soft';

export function boundsType(node: { params: Record<string, unknown> }): BoundsType {
  const t = node.params.outputType;
  return t === 'vec2' || t === 'vec3' ? t : 'float';
}
const behaviourOf = (v: unknown): BoundsBehaviour => (v === 'wrap' || v === 'bounce' || v === 'soft' ? v : 'clip');

/** The sockets that follow the type: Value, Min, Max in; Value and Direction out. */
const TYPED_INPUTS = ['value', 'min', 'max'] as const;
const TYPED_OUTPUTS = ['value', 'direction'] as const;

/** A Bounds card's sockets after its type changed (or on load): wires whose type no longer fits come off. */
export function retypeBounds(n: GraphNode): GraphNode {
  const t: DataType = boundsType(n);
  const same = TYPED_INPUTS.every(k => !n.inputs[k] || n.inputs[k].type === t) && TYPED_OUTPUTS.every(k => !n.outputs[k] || n.outputs[k].type === t);
  if (same) return n;
  const inputs = { ...n.inputs };
  for (const k of TYPED_INPUTS) {
    const s = inputs[k];
    if (s && s.type !== t) inputs[k] = { ...s, type: t, connection: undefined };
  }
  const outputs = { ...n.outputs };
  for (const k of TYPED_OUTPUTS) if (outputs[k]) outputs[k] = { ...outputs[k], type: t };
  return { ...n, inputs, outputs };
}

const AXES = ['X', 'Y', 'Z'] as const;
const vecTypes = (from: number): string[] => (['vec2', 'vec3'] as const).slice(from - 1);

const paramDefs: Record<string, ParamDef> = {
  behaviour: { label: 'Behaviour', type: 'select', hint: 'What happens at the edge. Clip stops it there. Wrap brings it back in on the other side. Bounce sends it back and forth between the edges, like a ball between walls. Soft slows it into the edge so it never quite gets there.', options: [
    { value: 'clip', label: 'Clip (stop at the edge)' }, { value: 'wrap', label: 'Wrap (come back on the other side)' },
    { value: 'bounce', label: 'Bounce (back and forth)' }, { value: 'soft', label: 'Soft (slow into the edge)' },
  ] },
  min: { label: 'Min', type: 'float', min: -10, max: 10, step: 0.001, pair: { with: 'max', label: 'Range' }, showWhen: { param: 'outputType', value: 'float' }, hint: 'The lowest the Value can be.' },
  max: { label: 'Max', type: 'float', min: -10, max: 10, step: 0.001, showWhen: { param: 'outputType', value: 'float' }, hint: 'The highest the Value can be.' },
  ...Object.fromEntries(AXES.flatMap((a, i) => [
    [`min${a}`, { label: `Min ${a}`, type: 'float', min: -10, max: 10, step: 0.001, pair: { with: `max${a}`, label: `Range ${a}` }, showWhen: { param: 'outputType', value: vecTypes(Math.max(i, 1)) }, hint: `The lowest ${a} can be: one side of the box.` }],
    [`max${a}`, { label: `Max ${a}`, type: 'float', min: -10, max: 10, step: 0.001, showWhen: { param: 'outputType', value: vecTypes(Math.max(i, 1)) }, hint: `The highest ${a} can be: the other side of the box.` }],
  ])),
  softness: { label: 'Softness', type: 'float', min: 0, max: 1, step: 0.001, hard: true, showWhen: { param: 'behaviour', value: 'soft' }, hint: 'How much of the range is spent slowing down: 0 is a hard stop (as Clip), 1 starts easing from the middle.' },
};
// Z only for a vec3
for (const k of ['minZ', 'maxZ']) paramDefs[k] = { ...paramDefs[k], showWhen: { param: 'outputType', value: 'vec3' } };

const bc = (t: BoundsType, e: string) => (t === 'float' ? e : `${t}(${e})`);

/** Min or Max as an expression of the node's type: the wire, else the slider(s). */
function edge(node: GraphNode, t: BoundsType, which: 'min' | 'max', wired: string | undefined): string {
  if (wired) return wired;
  const P = node.params;
  const fb = which === 'min' ? (t === 'float' ? 0 : -1) : 1;
  if (t === 'float') return p(P[which], fb);
  const n = t === 'vec2' ? 2 : 3;
  return `${t}(${AXES.slice(0, n).map(a => p(P[`${which}${a}`], fb)).join(', ')})`;
}

export const BoundsNode: NodeDefinition = {
  type: 'bounds',
  label: 'Bounds',
  category: 'Math',
  subcategory: 'Comparison',
  aliases: ['Keep inside', 'Stay in bounds', 'Confine', 'Contain', 'Ping pong', 'Ping-pong', 'Bounce', 'Wrap around', 'Reflect at walls', 'Box limits', 'Soft clamp', 'Soft limit', 'Limit range'],
  description: 'Keeps a number or a position inside a range or a box: Clip stops it at the edge, Wrap brings it back in on the other side, Bounce sends it back and forth between the edges (ping-pong), Soft slows it into the edge. Works on a float, vec2 or vec3 (the type follows the wire). Inside says whether the input was in the box; Direction is −1 on the way back when bouncing, so a velocity × Direction flips at the walls. For copies that wander off (Repeat, Grid cells, noise drift). Agents have the same choice built in: Move\'s Edges.',
  inputs: {
    value: { type: 'float', label: 'Value', hint: 'The number or position to keep inside: a drifting position, a counter, Time.' },
    min: { type: 'float', label: 'Min', hint: 'The low edge, for every axis at once (wins over the Min sliders).' },
    max: { type: 'float', label: 'Max', hint: 'The high edge, for every axis at once (wins over the Max sliders).' },
  },
  outputs: {
    value: { type: 'float', label: 'Value', hint: 'The Value, kept inside.' },
    inside: { type: 'float', label: 'Inside', hint: '1 when the input was inside on every axis, 0 when it was out (Soft: fades out past the edge).' },
    direction: { type: 'float', label: 'Direction', hint: 'Bounce: +1 per axis while it moves the same way as the input, −1 on the way back. Multiply a velocity or a heading by it to flip it at the walls. 1 for the other behaviours.' },
  },
  defaultParams: { outputType: 'float', behaviour: 'clip', min: 0, max: 1, minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1, softness: 0.3 },
  paramDefs,
  syncSockets: retypeBounds,
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const t = boundsType(node);
    const mode = behaviourOf(node.params.behaviour);
    const one = bc(t, '1.0');
    const L = [
      `    ${t} ${id}_in = ${v.value ?? bc(t, '0.0')};\n`,
      `    ${t} ${id}_lo = ${edge(node, t, 'min', v.min)};\n`,
      `    ${t} ${id}_hi = ${edge(node, t, 'max', v.max)};\n`,
      `    ${t} ${id}_sz = max(${id}_hi - ${id}_lo, ${bc(t, '1e-6')});\n`,
    ];
    let dir = one;
    if (mode === 'clip') {
      L.push(`    ${t} ${id}_v = clamp(${id}_in, ${id}_lo, ${id}_hi);\n`);
    } else if (mode === 'wrap') {
      L.push(`    ${t} ${id}_v = ${id}_lo + mod(${id}_in - ${id}_lo, ${id}_sz);\n`);
    } else if (mode === 'bounce') {
      // Where it is along one there-and-back (0 … 2 × size): the first half forward, the second back.
      L.push(
        `    ${t} ${id}_m = mod(${id}_in - ${id}_lo, 2.0 * ${id}_sz);\n`,
        `    ${t} ${id}_v = ${id}_hi - abs(${id}_m - ${id}_sz);\n`,
        `    ${t} ${id}_d = 1.0 - 2.0 * step(${id}_sz, ${id}_m);\n`,
      );
      dir = `${id}_d`;
    } else {
      // A soft knee k wide inside each edge: straight through the middle, easing towards the edge after.
      L.push(
        `    ${t} ${id}_k = max(clamp(${p(node.params.softness, 0.3)}, 0.0, 1.0) * 0.5 * ${id}_sz, ${bc(t, '1e-6')});\n`,
        `    ${t} ${id}_ov = max(${id}_in - (${id}_hi - ${id}_k), 0.0);\n`,
        `    ${t} ${id}_un = max(${id}_lo + ${id}_k - ${id}_in, 0.0);\n`,
        `    ${t} ${id}_v = clamp(${id}_in, ${id}_lo + ${id}_k, ${id}_hi - ${id}_k) + ${id}_k * (exp(-${id}_un / ${id}_k) - exp(-${id}_ov / ${id}_k));\n`,
      );
    }
    L.push(mode === 'soft'
      ? `    ${t} ${id}_ins = exp(-(max(${id}_lo - ${id}_in, 0.0) + max(${id}_in - ${id}_hi, 0.0)) / ${id}_k);\n`
      : `    ${t} ${id}_ins = step(${id}_lo, ${id}_in) * step(${id}_in, ${id}_hi);\n`);
    const inside = t === 'float' ? `${id}_ins` : t === 'vec2' ? `(${id}_ins.x * ${id}_ins.y)` : `(${id}_ins.x * ${id}_ins.y * ${id}_ins.z)`;
    return { code: L.join(''), outputVars: { value: `${id}_v`, inside, direction: dir } };
  },
};
