import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f } from './helpers';

const SDF_BOX_GLSL = `float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}`;

const SDF_SEGMENT_GLSL = `float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p-a, ba = b-a;
  float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);
  return length(pa - ba*h);
}`;

const SDF_ELLIPSE_GLSL = `float sdEllipse(vec2 p, vec2 ab) {
  p = abs(p);
  if(p.x > p.y){ p = p.yx; ab = ab.yx; }
  float l = ab.y*ab.y - ab.x*ab.x;
  float m = ab.x*p.x/l; float m2 = m*m;
  float n = ab.y*p.y/l; float n2 = n*n;
  float c = (m2+n2-1.0)/3.0;
  float c3 = c*c*c;
  float q = c3 + m2*n2*2.0;
  float d = c3 + m2*n2;
  float g = m + m*n2;
  float co;
  if(d < 0.0){
    float h2 = acos(q/c3)/3.0;
    float s2 = cos(h2); float t2 = sin(h2)*sqrt(3.0);
    float rx2 = sqrt(-c*(s2+t2+2.0)+m2);
    float ry2 = sqrt(-c*(s2-t2+2.0)+m2);
    co = (ry2+sign(l)*rx2+abs(g)/(rx2*ry2)-m)/2.0;
  } else {
    float h2 = 2.0*m*n*sqrt(d);
    float s2 = sign(q+h2)*pow(abs(q+h2),1.0/3.0);
    float t2 = sign(q-h2)*pow(abs(q-h2),1.0/3.0);
    float rx2 = -(s2+t2)-c*4.0+2.0*m2;
    float ry2 = (s2-t2)*sqrt(3.0);
    float rm2 = sqrt(rx2*rx2+ry2*ry2);
    co = (ry2/sqrt(rm2-rx2)+2.0*g/rm2-m)/2.0;
  }
  vec2 r2 = ab*vec2(co, sqrt(1.0-co*co));
  return length(r2-p)*sign(p.y-r2.y);
}`;

const OP_REPEAT_GLSL = `vec2 opRepeat(vec2 p, float s) {
  return mod(p + s*0.5, s) - s*0.5;
}`;

const OP_REPEAT_POLAR_GLSL = `vec2 opRepeatPolar(vec2 p, float n) {
  float angle = TAU / n;
  float a = atan(p.y, p.x) + angle * 0.5;
  a = mod(a, angle) - angle * 0.5;
  return vec2(cos(a), sin(a)) * length(p);
}`;

export const SdBoxNode: NodeDefinition = {
  type: 'sdBox', label: 'sdBox', category: 'SDF',
  description: 'Signed distance to a 2D box (IQ)',
  inputs: {
    p: { type: 'vec2', label: 'P' },
    b: { type: 'vec2', label: 'Half-size' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  glslFunction: SDF_BOX_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const p = inputVars['p'] ?? 'vec2(0.0)';
    const b = inputVars['b'] ?? `vec2(${f(node.params.bx as number ?? 0.3)}, ${f(node.params.by as number ?? 0.3)})`;
    const outVar = `${node.id}_distance`;
    return {
      code: `    float ${outVar} = sdBox(${p}, ${b});\n`,
      outputVars: { distance: outVar },
    };
  },
  defaultParams: { bx: 0.3, by: 0.3 },
};

export const SdSegmentNode: NodeDefinition = {
  type: 'sdSegment', label: 'sdSegment', category: 'SDF',
  description: 'Signed distance to a 2D line segment (IQ)',
  inputs: {
    p: { type: 'vec2', label: 'P' },
    a: { type: 'vec2', label: 'A' },
    b: { type: 'vec2', label: 'B' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  glslFunction: SDF_SEGMENT_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const p = inputVars['p'] ?? 'vec2(0.0)';
    const a = inputVars['a'] ?? 'vec2(-0.5, 0.0)';
    const b2 = inputVars['b'] ?? 'vec2(0.5, 0.0)';
    const outVar = `${node.id}_distance`;
    return {
      code: `    float ${outVar} = sdSegment(${p}, ${a}, ${b2});\n`,
      outputVars: { distance: outVar },
    };
  },
};

export const SdEllipseNode: NodeDefinition = {
  type: 'sdEllipse', label: 'sdEllipse', category: 'SDF',
  description: 'Signed distance to a 2D ellipse (IQ)',
  inputs: {
    p:  { type: 'vec2', label: 'P' },
    ab: { type: 'vec2', label: 'Radii (a,b)' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  glslFunction: SDF_ELLIPSE_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const p  = inputVars['p']  ?? 'vec2(0.0)';
    const ab = inputVars['ab'] ?? 'vec2(0.5, 0.25)';
    const outVar = `${node.id}_distance`;
    return {
      code: `    float ${outVar} = sdEllipse(${p}, ${ab});\n`,
      outputVars: { distance: outVar },
    };
  },
};

export const OpRepeatNode: NodeDefinition = {
  type: 'opRepeat', label: 'opRepeat', category: 'SDF',
  description: 'Infinite domain repetition — tiles p every s units',
  inputs: {
    p: { type: 'vec2', label: 'P' },
    s: { type: 'float', label: 'Spacing' },
  },
  outputs: { result: { type: 'vec2', label: 'Tiled P' } },
  glslFunction: OP_REPEAT_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const p = inputVars['p'] ?? 'vec2(0.0)';
    const s = inputVars['s'] ?? f(node.params.s as number ?? 1.0);
    const outVar = `${node.id}_result`;
    return {
      code: `    vec2 ${outVar} = opRepeat(${p}, ${s});\n`,
      outputVars: { result: outVar },
    };
  },
  defaultParams: { s: 1.0 },
};

export const OpRepeatPolarNode: NodeDefinition = {
  type: 'opRepeatPolar', label: 'opRepeatPolar', category: 'SDF',
  description: 'Polar domain repetition — n-fold rotational symmetry',
  inputs: {
    p: { type: 'vec2', label: 'P' },
    n: { type: 'float', label: 'Segments' },
  },
  outputs: { result: { type: 'vec2', label: 'Tiled P' } },
  glslFunction: OP_REPEAT_POLAR_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const p = inputVars['p'] ?? 'vec2(0.0)';
    const n = inputVars['n'] ?? f(node.params.n as number ?? 6.0);
    const outVar = `${node.id}_result`;
    return {
      code: `    vec2 ${outVar} = opRepeatPolar(${p}, ${n});\n`,
      outputVars: { result: outVar },
    };
  },
  defaultParams: { n: 6.0 },
};
