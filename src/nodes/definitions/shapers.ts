/**
 * Shaper / easing nodes — mathematical curve functions for remapping float values.
 * All functions take x ∈ [0,1] and return a shaped value in [0,1].
 * Bipolar mode extends to x ∈ [-1,1] via odd extension: f_bip(x) = sign(x) * f(abs(x)).
 * Formulas from Golan Levin: https://www.flong.com/archive/texts/code/
 */

import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';

// ── Shared GLSL helpers ───────────────────────────────────────────────────────

const CUBIC_BEZIER_GLSL = `float _shaperXfromT(float t,float A,float B,float C,float D){return A*(t*t*t)+B*(t*t)+C*t+D;}
float _shaperYfromT(float t,float E,float F,float G,float H){return E*(t*t*t)+F*(t*t)+G*t+H;}
float _shaperSlope(float t,float A,float B,float C){return 1.0/(3.0*A*t*t+2.0*B*t+C);}
float cubicBezierShaper(float x,float a,float b,float c,float d){
  float x0=0.0,y0=0.0,x1=a,y1=b,x2=c,y2=d,x3=1.0,y3=1.0;
  float A=x3-3.0*x2+3.0*x1-x0,B=3.0*x2-6.0*x1+3.0*x0,C=3.0*x1-3.0*x0,D=x0;
  float E=y3-3.0*y2+3.0*y1-y0,F=3.0*y2-6.0*y1+3.0*y0,G=3.0*y1-3.0*y0,H=y0;
  float t=x;
  for(int i=0;i<5;i++){
    float cx=_shaperXfromT(t,A,B,C,D);
    float sl=_shaperSlope(t,A,B,C);
    t-=(cx-x)*sl;
    t=clamp(t,0.0,1.0);
  }
  return clamp(_shaperYfromT(t,E,F,G,H),0.0,1.0);
}`;

const QUAD_BEZIER_GLSL = `float quadBezierShaper(float x,float a,float b){
  float eps=0.00001;
  a=clamp(a,0.0,1.0);b=clamp(b,0.0,1.0);
  if(abs(a-0.5)<eps)a+=eps;
  float om2a=1.0-2.0*a;
  float t=(sqrt(a*a+om2a*x)-a)/om2a;
  return clamp((1.0-2.0*b)*t*t+2.0*b*t,0.0,1.0);
}`;

// ── Node definitions ──────────────────────────────────────────────────────────

const floatIO = {
  inputs:  { x: { type: 'float' as const, label: 'x' } },
  outputs: { y: { type: 'float' as const, label: 'y' } },
};

// Bipolar preamble: captures abs(x) and sign(x) into node-scoped vars.
// Returns the variable name to use for the effective input.
function bipPre(id: string, rawX: string, bip: boolean): { pre: string; xi: string } {
  if (!bip) return { pre: '', xi: rawX };
  return {
    pre: `    float ${id}_xin = abs(${rawX});\n    float ${id}_xsgn = (${rawX}) < 0.0 ? -1.0 : 1.0;\n`,
    xi:  `${id}_xin`,
  };
}

// Bipolar postfix: multiply y by the captured sign.
const bipPost = (id: string, bip: boolean) =>
  bip ? `    ${id}_y *= ${id}_xsgn;\n` : '';

// ── Exponential Ease ──────────────────────────────────────────────────────────

export const ExpEaseNode: NodeDefinition = withParamSockets({
  type: 'expEase', label: 'Exp Ease', category: 'Shapers',
  description: 'Exponential ease. Curve 0 → strong ease-in, 0.5 → linear, 1 → strong ease-out.',
  ...floatIO,
  defaultParams: { a: 0.5, bipolar: false },
  paramDefs: {
    a:       { label: 'Curve',   type: 'float', min: 0, max: 1, step: 0.01, hint: '0=ease-in · 0.5=linear · 1=ease-out' },
    bipolar: { label: 'Bipolar', type: 'bool' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const bip = node.params.bipolar === true;
    const { pre, xi } = bipPre(id, inputVars.x || '0.0', bip);
    const a   = inputVars.a || p(node.params.a, 0.5);
    return {
      code: [
        pre,
        `    float ${id}_a = clamp(${a}, 0.00001, 0.99999);\n`,
        `    float ${id}_y;\n`,
        `    if (${id}_a < 0.5) {\n`,
        `        ${id}_y = pow(${xi}, 2.0 * ${id}_a);\n`,
        `    } else {\n`,
        `        ${id}_y = pow(${xi}, 1.0 / (1.0 - 2.0 * (${id}_a - 0.5)));\n`,
        `    }\n`,
        bipPost(id, bip),
      ].join(''),
      outputVars: { y: `${id}_y` },
    };
  },
}, ['a']);

// ── Double Exponential Seat ───────────────────────────────────────────────────

export const DoubleExpSeatNode: NodeDefinition = withParamSockets({
  type: 'doubleExpSeat', label: 'Exp Seat', category: 'Shapers',
  description: 'Double-exponential seat. Low Shape: a flat plateau; high Shape: a strong dip.',
  ...floatIO,
  defaultParams: { a: 0.5, bipolar: false },
  paramDefs: {
    a:       { label: 'Shape',   type: 'float', min: 0, max: 1, step: 0.01 },
    bipolar: { label: 'Bipolar', type: 'bool' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const bip = node.params.bipolar === true;
    const { pre, xi } = bipPre(id, inputVars.x || '0.0', bip);
    const a   = inputVars.a || p(node.params.a, 0.5);
    return {
      code: [
        pre,
        `    float ${id}_a = clamp(${a}, 0.00001, 0.99999);\n`,
        `    float ${id}_y;\n`,
        `    if ((${xi}) <= 0.5) {\n`,
        `        ${id}_y = pow(2.0*(${xi}), 1.0 - ${id}_a) / 2.0;\n`,
        `    } else {\n`,
        `        ${id}_y = 1.0 - pow(2.0*(1.0-(${xi})), 1.0 - ${id}_a) / 2.0;\n`,
        `    }\n`,
        bipPost(id, bip),
      ].join(''),
      outputVars: { y: `${id}_y` },
    };
  },
}, ['a']);

// ── Double Exponential Sigmoid ────────────────────────────────────────────────

export const DoubleExpSigmoidNode: NodeDefinition = withParamSockets({
  type: 'doubleExpSigmoid', label: 'Exp Sigmoid', category: 'Shapers',
  description: 'Double-exponential S-curve. a→0 = near-linear; a→1 = sharp step.',
  ...floatIO,
  defaultParams: { a: 0.5, bipolar: false },
  paramDefs: {
    a:       { label: 'Sharpness', type: 'float', min: 0, max: 1, step: 0.01 },
    bipolar: { label: 'Bipolar',   type: 'bool' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const bip = node.params.bipolar === true;
    const { pre, xi } = bipPre(id, inputVars.x || '0.0', bip);
    const a   = inputVars.a || p(node.params.a, 0.5);
    return {
      code: [
        pre,
        `    float ${id}_a = 1.0 - clamp(${a}, 0.00001, 0.99999);\n`,
        `    float ${id}_y;\n`,
        `    if ((${xi}) <= 0.5) {\n`,
        `        ${id}_y = pow(2.0*(${xi}), 1.0 / ${id}_a) / 2.0;\n`,
        `    } else {\n`,
        `        ${id}_y = 1.0 - pow(2.0*(1.0-(${xi})), 1.0 / ${id}_a) / 2.0;\n`,
        `    }\n`,
        bipPost(id, bip),
      ].join(''),
      outputVars: { y: `${id}_y` },
    };
  },
}, ['a']);

// ── Logistic Sigmoid ──────────────────────────────────────────────────────────

export const LogisticSigmoidNode: NodeDefinition = withParamSockets({
  type: 'logisticSigmoid', label: 'Logistic Sigmoid', category: 'Shapers',
  description: 'Classic logistic / smooth step. Steepness 0 → linear; toward 1 → a sharp step at 0.5.',
  ...floatIO,
  defaultParams: { a: 0.7, bipolar: false },
  paramDefs: {
    a:       { label: 'Steepness', type: 'float', min: 0, max: 1, step: 0.01 },
    bipolar: { label: 'Bipolar',   type: 'bool' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const bip = node.params.bipolar === true;
    const { pre, xi } = bipPre(id, inputVars.x || '0.0', bip);
    const a   = inputVars.a || p(node.params.a, 0.7);
    return {
      code: [
        pre,
        `    float ${id}_a = clamp(${a}, 0.0001, 0.9999);\n`,
        `    float ${id}_k = 1.0 / (1.0 - ${id}_a) - 1.0;\n`,
        `    float ${id}_A = 1.0 / (1.0 + exp(-(${xi} - 0.5) * ${id}_k * 2.0));\n`,
        `    float ${id}_B = 1.0 / (1.0 + exp(${id}_k));\n`,
        `    float ${id}_C = 1.0 / (1.0 + exp(-${id}_k));\n`,
        `    float ${id}_y = clamp((${id}_A - ${id}_B) / (${id}_C - ${id}_B), 0.0, 1.0);\n`,
        bipPost(id, bip),
      ].join(''),
      outputVars: { y: `${id}_y` },
    };
  },
}, ['a']);

// ── Circular Ease In ──────────────────────────────────────────────────────────

export const CircularEaseInNode: NodeDefinition = {
  type: 'circularEaseIn', label: 'Circ Ease In', category: 'Shapers',
  description: 'Circular ease-in: slow start, fast finish. y = 1 - sqrt(1 - x²)',
  ...floatIO,
  defaultParams: { bipolar: false },
  paramDefs: { bipolar: { label: 'Bipolar', type: 'bool' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const bip = node.params.bipolar === true;
    const { pre, xi } = bipPre(id, inputVars.x || '0.0', bip);
    return {
      code: pre + `    float ${id}_y = 1.0 - sqrt(max(0.0, 1.0 - (${xi})*(${xi})));\n` + bipPost(id, bip),
      outputVars: { y: `${id}_y` },
    };
  },
};

// ── Circular Ease Out ─────────────────────────────────────────────────────────

export const CircularEaseOutNode: NodeDefinition = {
  type: 'circularEaseOut', label: 'Circ Ease Out', category: 'Shapers',
  description: 'Circular ease-out: fast start, slow finish. y = sqrt(1 - (1-x)²)',
  ...floatIO,
  defaultParams: { bipolar: false },
  paramDefs: { bipolar: { label: 'Bipolar', type: 'bool' } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const bip = node.params.bipolar === true;
    const { pre, xi } = bipPre(id, inputVars.x || '0.0', bip);
    return {
      code: pre + `    float ${id}_t1 = 1.0 - (${xi});\n    float ${id}_y = sqrt(max(0.0, 1.0 - ${id}_t1*${id}_t1));\n` + bipPost(id, bip),
      outputVars: { y: `${id}_y` },
    };
  },
};

// ── Double Circle Seat ────────────────────────────────────────────────────────

export const DoubleCircleSeatNode: NodeDefinition = withParamSockets({
  type: 'doubleCircleSeat', label: 'Circle Seat', category: 'Shapers',
  description: 'Double-circle seat curve. a controls where the two arcs meet (0–1).',
  ...floatIO,
  defaultParams: { a: 0.5, bipolar: false },
  paramDefs: {
    a:       { label: 'Inflection', type: 'float', min: 0, max: 1, step: 0.01 },
    bipolar: { label: 'Bipolar',    type: 'bool' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const bip = node.params.bipolar === true;
    const { pre, xi } = bipPre(id, inputVars.x || '0.0', bip);
    const a   = inputVars.a || p(node.params.a, 0.5);
    return {
      code: [
        pre,
        `    float ${id}_a = clamp(${a}, 0.0, 1.0);\n`,
        `    float ${id}_y;\n`,
        `    if ((${xi}) <= ${id}_a) {\n`,
        `        ${id}_y = sqrt(max(0.0, ${id}_a*${id}_a - (${xi}-${id}_a)*(${xi}-${id}_a)));\n`,
        `    } else {\n`,
        `        float ${id}_t2 = 1.0 - ${id}_a;\n`,
        `        ${id}_y = 1.0 - sqrt(max(0.0, ${id}_t2*${id}_t2 - (${xi}-${id}_a)*(${xi}-${id}_a)));\n`,
        `    }\n`,
        bipPost(id, bip),
      ].join(''),
      outputVars: { y: `${id}_y` },
    };
  },
}, ['a']);

// ── Double Circle Sigmoid ─────────────────────────────────────────────────────

export const DoubleCircleSigmoidNode: NodeDefinition = withParamSockets({
  type: 'doubleCircleSigmoid', label: 'Circle Sigmoid', category: 'Shapers',
  description: 'S-curve made from two circular arcs. a controls the inflection point.',
  ...floatIO,
  defaultParams: { a: 0.5, bipolar: false },
  paramDefs: {
    a:       { label: 'Inflection', type: 'float', min: 0, max: 1, step: 0.01 },
    bipolar: { label: 'Bipolar',    type: 'bool' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const bip = node.params.bipolar === true;
    const { pre, xi } = bipPre(id, inputVars.x || '0.0', bip);
    const a   = inputVars.a || p(node.params.a, 0.5);
    return {
      code: [
        pre,
        `    float ${id}_a = clamp(${a}, 0.0, 1.0);\n`,
        `    float ${id}_y;\n`,
        `    if ((${xi}) <= ${id}_a) {\n`,
        `        ${id}_y = ${id}_a - sqrt(max(0.0, ${id}_a*${id}_a - (${xi})*(${xi})));\n`,
        `    } else {\n`,
        `        float ${id}_t2 = 1.0 - ${id}_a;\n`,
        `        ${id}_y = ${id}_a + sqrt(max(0.0, ${id}_t2*${id}_t2 - (${xi}-1.0)*(${xi}-1.0)));\n`,
        `    }\n`,
        bipPost(id, bip),
      ].join(''),
      outputVars: { y: `${id}_y` },
    };
  },
}, ['a']);

// ── Double Elliptic Sigmoid ───────────────────────────────────────────────────

export const DoubleEllipticSigmoidNode: NodeDefinition = withParamSockets({
  type: 'doubleEllipticSigmoid', label: 'Elliptic Sigmoid', category: 'Shapers',
  description: 'Asymmetric elliptic S-curve. Inflect X and Inflect Y place the inflection point.',
  ...floatIO,
  defaultParams: { a: 0.5, b: 0.5, bipolar: false },
  paramDefs: {
    a:       { label: 'Inflect X', type: 'float', min: 0, max: 1, step: 0.01 },
    b:       { label: 'Inflect Y', type: 'float', min: 0, max: 1, step: 0.01 },
    bipolar: { label: 'Bipolar',   type: 'bool' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const bip = node.params.bipolar === true;
    const { pre, xi } = bipPre(id, inputVars.x || '0.0', bip);
    const a   = inputVars.a || p(node.params.a, 0.5);
    const b   = inputVars.b || p(node.params.b, 0.5);
    return {
      code: [
        pre,
        `    float ${id}_a = clamp(${a}, 0.00001, 0.99999);\n`,
        `    float ${id}_b = clamp(${b}, 0.0, 1.0);\n`,
        `    float ${id}_y;\n`,
        `    if ((${xi}) <= ${id}_a) {\n`,
        `        ${id}_y = ${id}_b * (1.0 - sqrt(max(0.0, ${id}_a*${id}_a - (${xi})*(${xi}))) / ${id}_a);\n`,
        `    } else {\n`,
        `        float ${id}_ta = 1.0 - ${id}_a;\n`,
        `        ${id}_y = ${id}_b + (1.0 - ${id}_b) / (1.0 - ${id}_a) * sqrt(max(0.0, ${id}_ta*${id}_ta - (${xi}-1.0)*(${xi}-1.0)));\n`,
        `    }\n`,
        bipPost(id, bip),
      ].join(''),
      outputVars: { y: `${id}_y` },
    };
  },
}, ['a', 'b']);

// ── Quadratic Bezier Shaper ───────────────────────────────────────────────────

export const QuadBezierShaperNode: NodeDefinition = withParamSockets({
  type: 'quadBezierShaper', label: 'Quad Bezier', category: 'Shapers',
  description: 'Quadratic bezier curve shaper. (Control X, Control Y) is the single control point.',
  ...floatIO,
  glslFunction: QUAD_BEZIER_GLSL,
  defaultParams: { a: 0.5, b: 0.5, bipolar: false },
  paramDefs: {
    a:       { label: 'Control X', type: 'float', min: 0, max: 1, step: 0.01 },
    b:       { label: 'Control Y', type: 'float', min: 0, max: 1, step: 0.01 },
    bipolar: { label: 'Bipolar',   type: 'bool' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const bip = node.params.bipolar === true;
    const { pre, xi } = bipPre(id, inputVars.x || '0.0', bip);
    const a   = inputVars.a || p(node.params.a, 0.5);
    const b   = inputVars.b || p(node.params.b, 0.5);
    return {
      code: pre + `    float ${id}_y = quadBezierShaper(${xi}, ${a}, ${b});\n` + bipPost(id, bip),
      outputVars: { y: `${id}_y` },
    };
  },
}, ['a', 'b']);

// ── Cubic Bezier Shaper ───────────────────────────────────────────────────────

export const CubicBezierShaperNode: NodeDefinition = withParamSockets({
  type: 'cubicBezierShaper', label: 'Cubic Bezier', category: 'Shapers',
  description: 'Cubic bezier shaper. (P1 X, P1 Y) is the first control point, (P2 X, P2 Y) the second. Same parameterization as CSS cubic-bezier().',
  ...floatIO,
  glslFunction: CUBIC_BEZIER_GLSL,
  defaultParams: { a: 0.25, b: 0.1, c: 0.25, d: 1.0, bipolar: false },
  paramDefs: {
    a:       { label: 'P1 X',    type: 'float', min: 0, max: 1, step: 0.01 },
    b:       { label: 'P1 Y',    type: 'float', min: 0, max: 1, step: 0.01 },
    c:       { label: 'P2 X',    type: 'float', min: 0, max: 1, step: 0.01 },
    d:       { label: 'P2 Y',    type: 'float', min: 0, max: 1, step: 0.01 },
    bipolar: { label: 'Bipolar', type: 'bool' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const bip = node.params.bipolar === true;
    const { pre, xi } = bipPre(id, inputVars.x || '0.0', bip);
    const a   = inputVars.a || p(node.params.a, 0.25);
    const b   = inputVars.b || p(node.params.b, 0.1);
    const c   = inputVars.c || p(node.params.c, 0.25);
    const d   = inputVars.d || p(node.params.d, 1.0);
    return {
      code: pre + `    float ${id}_y = cubicBezierShaper(${xi}, ${a}, ${b}, ${c}, ${d});\n` + bipPost(id, bip),
      outputVars: { y: `${id}_y` },
    };
  },
}, ['a', 'b', 'c', 'd']);

// ── Shaper: the ten curves above in one node (docs/node-retirements.md) ─────────────────────────────────────
//
// Each Curve emits its old node's code exactly (the definitions above are no longer registered; a saved one is an
// alias to Shaper with its Curve set). Cubic Bezier stays its own node: it has four control settings.

/** Shaper's curves: the old node each one is, its label, and its Shape's default. */
export const SHAPER_CURVES: ReadonlyArray<{ value: string; label: string; node: NodeDefinition; a: number; hint: string }> = [
  { value: 'expEase', label: 'Exp ease', node: ExpEaseNode, a: 0.5, hint: 'Shape 0: a strong ease-in; 0.5: a straight line; 1: a strong ease-out.' },
  { value: 'circularEaseIn', label: 'Circular ease in', node: CircularEaseInNode, a: 0.5, hint: 'A quarter circle: slow start, fast finish.' },
  { value: 'circularEaseOut', label: 'Circular ease out', node: CircularEaseOutNode, a: 0.5, hint: 'A quarter circle: fast start, slow finish.' },
  { value: 'doubleExpSeat', label: 'Exp seat', node: DoubleExpSeatNode, a: 0.5, hint: 'Shape low: a flat plateau in the middle; high: a strong dip.' },
  { value: 'doubleCircleSeat', label: 'Circle seat', node: DoubleCircleSeatNode, a: 0.5, hint: 'Two arcs; Shape is where they meet.' },
  { value: 'doubleExpSigmoid', label: 'Exp sigmoid', node: DoubleExpSigmoidNode, a: 0.5, hint: 'An S-curve. Shape near 0: almost a straight line; near 1: a sharp step.' },
  { value: 'logisticSigmoid', label: 'Logistic sigmoid', node: LogisticSigmoidNode, a: 0.7, hint: 'The classic smooth step. Shape 0: a straight line; toward 1: a sharp step at 0.5.' },
  { value: 'doubleCircleSigmoid', label: 'Circle sigmoid', node: DoubleCircleSigmoidNode, a: 0.5, hint: 'An S-curve of two arcs; Shape is where they meet.' },
  { value: 'doubleEllipticSigmoid', label: 'Elliptic sigmoid', node: DoubleEllipticSigmoidNode, a: 0.5, hint: 'An S-curve of two quarter ellipses; Shape and Shape Y place the bend.' },
  { value: 'quadBezierShaper', label: 'Quadratic Bezier', node: QuadBezierShaperNode, a: 0.5, hint: 'A Bezier curve through (Shape, Shape Y).' },
];
const CURVE_OF: Record<string, (typeof SHAPER_CURVES)[number]> = Object.fromEntries(SHAPER_CURVES.map(c => [c.value, c]));
/** The curve a Shaper draws (an unknown one reads as Exp ease). */
export const shaperCurve = (node: { params: Record<string, unknown> }) => CURVE_OF[String(node.params.curve)] ?? SHAPER_CURVES[0];
/** The old node type a shaper node draws like: a Shaper's Curve, or the node's own type (Cubic Bezier). For the card's curve. */
export const shaperCurveType = (node: { type: string; params: Record<string, unknown> }) => (node.type === 'shaper' ? shaperCurve(node).value : node.type);

const WITH_A = SHAPER_CURVES.filter(c => c.value !== 'circularEaseIn' && c.value !== 'circularEaseOut').map(c => c.value);
const WITH_B = ['doubleEllipticSigmoid', 'quadBezierShaper'];

export const ShaperNode: NodeDefinition = withParamSockets({
  type: 'shaper', label: 'Shaper', category: 'Shapers',
  aliases: ['Ease', 'Easing', 'Ease in', 'Ease out', 'Sigmoid', 'S-curve', 'Seat', 'Exp Ease', 'Exp Seat', 'Exp Sigmoid', 'Logistic Sigmoid',
    'Circ Ease In', 'Circ Ease Out', 'Circle Seat', 'Circle Sigmoid', 'Elliptic Sigmoid', 'Quad Bezier', 'Curve', 'Response curve'],
  description: 'Bends a 0 to 1 value along a curve: pick the Curve (eases, seats, S-curves, a Bezier) and set its Shape. Bipolar extends it to −1…1, mirrored through 0. The card draws the curve. For a curve with two control points, use Cubic Bezier.',
  ...floatIO,
  defaultParams: { curve: 'expEase', a: 0.5, b: 0.5, bipolar: false },
  paramDefs: {
    curve: { label: 'Curve', type: 'select', hint: 'Which curve: each is one of Golan Levin\'s shaping functions.', options: SHAPER_CURVES.map(c => ({ value: c.value, label: c.label })) },
    a: { label: 'Shape', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'curve', value: WITH_A }, hint: 'What it does depends on the Curve (its hint on the Curve picker).' },
    b: { label: 'Shape Y', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'curve', value: WITH_B }, hint: 'The bend\'s height (Elliptic sigmoid) or the control point\'s (Quadratic Bezier).' },
    bipolar: { label: 'Bipolar', type: 'bool', hint: 'Takes −1…1: the curve mirrored through 0.' },
  },
  glslFunctionsFor: node => (shaperCurve(node).value === 'quadBezierShaper' ? [QUAD_BEZIER_GLSL] : []),
  // The curve's own (old) node writes the code, so every curve is exactly what it was.
  generateGLSL: (node, inputVars) => shaperCurve(node).node.generateGLSL(node, inputVars),
}, ['a', 'b']);
