/**
 * simpleExprExamples.ts — Simple Expression (docs/simple-expression.md): one-line GLSL right on the card,
 * inputs that take the type of what's wired in. Every node carries a note saying what it does and why.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';

export const SIMPLE_EXPR_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  simpleExprBlend: {
    label: 'Simple Expression · rings and a blend',
    description: 'Two Simple Expressions do the maths a chain of small nodes would: one turns a circle\'s distance into moving rings, the other blends two colours with mix(a, b, smoothstep(0.2, 0.8, c)). Their inputs took their types from the wires: two colours (vec3), the rings (float) and the UV (vec2).',
  },
};

export const SIMPLE_EXPR_EXAMPLE_KEYS = Object.keys(SIMPLE_EXPR_EXAMPLE_INDEX);

const note = (text: string[]) => ({ __comment: text.join('\n') });

/** A Simple Expression with named inputs wired as given (their types follow the wires when the graph compiles). */
function simple(id: string, x: number, y: number, o: { label: string; outputType: string; expr: string; inputs: Array<[name: string, from: [string, string]]>; note: string[] }): GraphNode {
  const vars = o.inputs.map(([name], i) => ({ key: `in${i + 1}`, name }));
  const wires = Object.fromEntries(o.inputs.map(([, from], i) => [`in${i + 1}`, from])) as Record<string, [string, string]>;
  return n('simpleExpr', id, x, y, { label: o.label, vars, expr: o.expr, outputType: o.outputType, ...note(o.note) }, wires);
}

export function buildSimpleExprExamples(): Record<string, ExampleGraph> {
  return {
    simpleExprBlend: {
      ...SIMPLE_EXPR_EXAMPLE_INDEX.simpleExprBlend,
      counter: 20,
      nodes: [
        n('uv', 'se_uv', 40, 200, note(['UV: where each pixel is. It feeds the circle, and the blend reads it too (as p, a vec2).'])),
        n('circleSDF', 'se_circle', 380, 120, { radius: 0.35, ...note(['Circle SDF: how far each pixel is from a circle. The Rings expression turns that distance into stripes.']) }, { position: ['se_uv', 'uv'] }),
        simple('se_rings', 760, 80, {
          label: 'Rings', outputType: 'float',
          expr: '0.5 + 0.5 * sin(d * 24.0 - t * 3.0)',
          inputs: [['d', ['se_circle', 'distance']]],
          note: [
            'Simple Expression “Rings”: one line, d → stripes.',
            'sin(d * 24.0 …) makes a ring every 2π/24 of distance; − t * 3.0 moves them outward over time (t is seconds, free in every expression).',
            '0.5 + 0.5 * … maps the wave from −1..1 to 0..1, the range smoothstep below expects.',
            'd was added with + Input and took float from the Circle\'s Distance wire.',
          ],
        }),
        n('colorPicker', 'se_warm', 760, 300, { color: [0.98, 0.55, 0.2], ...note(['Colour A: the warm colour (a vec3, so input a is a vec3).']) }),
        n('colorPicker', 'se_cool', 760, 470, { color: [0.15, 0.35, 0.95], ...note(['Colour B: the cool colour, the other end of the blend.']) }),
        simple('se_blend', 1140, 220, {
          label: 'Blend', outputType: 'vec3',
          expr: 'mix(a, b, smoothstep(0.2, 0.8, c)) * (0.75 + 0.25 * p.y)',
          inputs: [['a', ['se_warm', 'rgb']], ['b', ['se_cool', 'rgb']], ['c', ['se_rings', 'result']], ['p', ['se_uv', 'uv']]],
          note: [
            'Simple Expression “Blend”: four inputs of three types, each from its wire: a and b are colours (vec3), c is the rings (float), p is the UV (vec2).',
            'smoothstep(0.2, 0.8, c) softens the rings into a 0..1 blend amount; mix(a, b, …) goes from colour A to colour B by it.',
            '* (0.75 + 0.25 * p.y) darkens the bottom a little: p.y runs −1 (bottom) to 1 (top).',
            'Output type vec3: what the Output takes. Right-click → Convert to Expression Block to grow it into several lines.',
          ],
        }),
        n('output', 'se_out', 1520, 240, {}, { color: ['se_blend', 'result'] }),
      ],
    },
  };
}
