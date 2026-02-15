import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { f } from './helpers';

export const CircleSDFNode: NodeDefinition = {
  type: 'circleSDF',
  label: 'Circle SDF',
  category: '2D Primitives',
  description: 'Signed distance function for a circle. Use X/Y sliders or wire an Offset vec2 to position it.',
  inputs: {
    position: { type: 'vec2', label: 'Position' },
    radius: { type: 'float', label: 'Radius' },
    offset: { type: 'vec2', label: 'Offset' },
  },
  outputs: {
    distance: { type: 'float', label: 'Distance' },
  },
  defaultParams: { radius: 0.3, posX: 0.0, posY: 0.0 },
  paramDefs: {
    radius: { label: 'Radius', type: 'float', min: 0.01, max: 2, step: 0.01 },
    posX: { label: 'X', type: 'float', min: -1, max: 1, step: 0.01 },
    posY: { label: 'Y', type: 'float', min: -1, max: 1, step: 0.01 },
  },
  glslFunction: `
float circleSDF(vec2 point, float size) {
    return length(point) - size;
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_dist`;
    const posVar = inputVars.position || 'vec2(0.0)';
    const radiusVar = inputVars.radius || f(typeof node.params.radius === 'number' ? node.params.radius : 0.3);
    const px = f(typeof node.params.posX === 'number' ? node.params.posX : 0.0);
    const py = f(typeof node.params.posY === 'number' ? node.params.posY : 0.0);
    const offsetVar = inputVars.offset || `vec2(${px}, ${py})`;
    const offsetPos = `(${posVar} - ${offsetVar})`;
    return {
      code: `    float ${outVar} = circleSDF(${offsetPos}, ${radiusVar});\n`,
      outputVars: { distance: outVar },
    };
  },
};

export const BoxSDFNode: NodeDefinition = {
  type: 'boxSDF',
  label: 'Box SDF',
  category: '2D Primitives',
  description: 'Signed distance function for a box. Use X/Y sliders or wire an Offset vec2 to position it.',
  inputs: {
    position: { type: 'vec2', label: 'Position' },
    dimensions: { type: 'vec2', label: 'Dimensions' },
    offset: { type: 'vec2', label: 'Offset' },
  },
  outputs: {
    distance: { type: 'float', label: 'Distance' },
  },
  defaultParams: { width: 0.5, height: 0.5, posX: 0.0, posY: 0.0 },
  paramDefs: {
    width: { label: 'Width', type: 'float', min: 0.01, max: 2, step: 0.01 },
    height: { label: 'Height', type: 'float', min: 0.01, max: 2, step: 0.01 },
    posX: { label: 'X', type: 'float', min: -1, max: 1, step: 0.01 },
    posY: { label: 'Y', type: 'float', min: -1, max: 1, step: 0.01 },
  },
  glslFunction: `
float boxSDF(in vec2 position, in vec2 dimensions) {
    vec2 d = abs(position) - dimensions;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_dist`;
    const posVar = inputVars.position || 'vec2(0.0)';
    const w = f(typeof node.params.width === 'number' ? node.params.width : 0.5);
    const h = f(typeof node.params.height === 'number' ? node.params.height : 0.5);
    const dimsVar = inputVars.dimensions || `vec2(${w}, ${h})`;
    const px = f(typeof node.params.posX === 'number' ? node.params.posX : 0.0);
    const py = f(typeof node.params.posY === 'number' ? node.params.posY : 0.0);
    const offsetVar = inputVars.offset || `vec2(${px}, ${py})`;
    const offsetPos = `(${posVar} - ${offsetVar})`;
    return {
      code: `    float ${outVar} = boxSDF(${offsetPos}, ${dimsVar});\n`,
      outputVars: { distance: outVar },
    };
  },
};

export const RingSDFNode: NodeDefinition = {
  type: 'ringSDF',
  label: 'Ring SDF',
  category: '2D Primitives',
  description: 'Signed distance function for a ring (absolute circle SDF). Use X/Y sliders or wire an Offset vec2 to position it.',
  inputs: {
    position: { type: 'vec2', label: 'Position' },
    radius: { type: 'float', label: 'Radius' },
    offset: { type: 'vec2', label: 'Offset' },
  },
  outputs: {
    distance: { type: 'float', label: 'Distance' },
  },
  defaultParams: { radius: 0.3, posX: 0.0, posY: 0.0 },
  paramDefs: {
    radius: { label: 'Radius', type: 'float', min: 0.01, max: 2, step: 0.01 },
    posX: { label: 'X', type: 'float', min: -1, max: 1, step: 0.01 },
    posY: { label: 'Y', type: 'float', min: -1, max: 1, step: 0.01 },
  },
  glslFunction: `
float ringSDF(vec2 point, float size) {
    float dist = length(point) - size;
    return abs(dist);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_dist`;
    const posVar = inputVars.position || 'vec2(0.0)';
    const radiusVar = inputVars.radius || f(typeof node.params.radius === 'number' ? node.params.radius : 0.3);
    const px = f(typeof node.params.posX === 'number' ? node.params.posX : 0.0);
    const py = f(typeof node.params.posY === 'number' ? node.params.posY : 0.0);
    const offsetVar = inputVars.offset || `vec2(${px}, ${py})`;
    const offsetPos = `(${posVar} - ${offsetVar})`;
    return {
      code: `    float ${outVar} = ringSDF(${offsetPos}, ${radiusVar});\n`,
      outputVars: { distance: outVar },
    };
  },
};

// ─── Shape SDF Node (multi-shape selector) ────────────────────────────────────

const SHAPE_SDF_GLSL = `float sdCircle2(vec2 p, float r) { return length(p) - r; }
float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r;
}
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p-a, ba = b-a;
  float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);
  return length(pa - ba*h);
}
float sdEquilateralTriangle(vec2 p, float r) {
  const float k = sqrt(3.0);
  p.x = abs(p.x) - r;
  p.y = p.y + r/k;
  if(p.x+k*p.y>0.0) p=vec2(p.x-k*p.y,-k*p.x-p.y)/2.0;
  p.x -= clamp(p.x,-2.0*r,0.0);
  return -length(p)*sign(p.y);
}
float sdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025,0.5,0.577350);
  p = abs(p);
  p -= 2.0*min(dot(k.xy,p),0.0)*k.xy;
  p -= vec2(clamp(p.x,-k.z*r,k.z*r),r);
  return length(p)*sign(p.y);
}
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375,-0.587785252192);
  const vec2 k2 = vec2(-k1.x,k1.y);
  p.x = abs(p.x);
  p -= 2.0*max(dot(k1,p),0.0)*k1;
  p -= 2.0*max(dot(k2,p),0.0)*k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf*vec2(-k1.y,k1.x) - vec2(0,1);
  float h = clamp(dot(p,ba)/dot(ba,ba),-r,0.0);
  return length(p-ba*h)*sign(p.x*ba.y-p.y*ba.x);
}
float sdPie(vec2 p, vec2 c, float r) {
  p.x = abs(p.x);
  float l = length(p) - r;
  float m = length(p - c*clamp(dot(p,c),0.0,r));
  return max(l, m*sign(c.y*p.x-c.x*p.y));
}
float sdRing2(vec2 p, vec2 n, float r, float th) {
  p.x = abs(p.x);
  p = mat2(n.x,n.y,-n.y,n.x)*p;
  return max(abs(length(p)-r)-th*0.5,
             length(vec2(p.x,max(0.0,abs(r-p.y)-th*0.5)))*sign(p.x));
}
float sdCross(vec2 p, vec2 b, float r) {
  p = abs(p); p = (p.y>p.x) ? p.yx : p.xy;
  vec2 q = p - b;
  float k = max(q.y,q.x);
  vec2 w = (k>0.0) ? q : vec2(b.y-p.x,0.0-k);
  return sign(k)*length(max(w,0.0)) + r;
}`;

export const ShapeSDFNode: NodeDefinition = {
  type: 'shapeSDF',
  label: 'Shape SDF',
  category: '2D Primitives',
  description: 'Signed distance function — select shape from dropdown. Inputs shown for all shapes.',
  inputs: {
    p:  { type: 'vec2',  label: 'Position' },
    r:  { type: 'float', label: 'Radius / Size' },
    b:  { type: 'vec2',  label: 'Half-size (box)' },
    a:  { type: 'vec2',  label: 'Point A (segment)' },
    b2: { type: 'vec2',  label: 'Point B (segment)' },
    rf: { type: 'float', label: 'Inner ratio (star)' },
    c:  { type: 'vec2',  label: 'Angle vec (pie)' },
    th: { type: 'float', label: 'Thickness (ring)' },
    n:  { type: 'vec2',  label: 'Normal (ring)' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  defaultParams: {
    shape: 'circle',
    r: 0.3, rx: 0.3, ry: 0.3, roundness: 0.05,
    rf: 0.5,
    cx: 0.866, cy: 0.5,
    th: 0.05,
    nx: 0.0, ny: 1.0,
  },
  paramDefs: {
    shape: {
      label: 'Shape', type: 'select',
      options: [
        { value: 'circle',     label: 'Circle'       },
        { value: 'box',        label: 'Box'          },
        { value: 'roundedBox', label: 'Rounded Box'  },
        { value: 'segment',    label: 'Segment'      },
        { value: 'triangle',   label: 'Triangle'     },
        { value: 'hexagon',    label: 'Hexagon'      },
        { value: 'star',       label: 'Star 5'       },
        { value: 'pie',        label: 'Pie'          },
        { value: 'ring',       label: 'Ring'         },
        { value: 'cross',      label: 'Cross'        },
      ],
    },
    r:        { label: 'Radius',       type: 'float', min: 0.01, max: 2.0,  step: 0.01,  showWhen: { param: 'shape', value: ['circle','triangle','hexagon','star','pie','ring'] } },
    rx:       { label: 'Width/2',      type: 'float', min: 0.01, max: 2.0,  step: 0.01,  showWhen: { param: 'shape', value: ['box','roundedBox','cross'] } },
    ry:       { label: 'Height/2',     type: 'float', min: 0.01, max: 2.0,  step: 0.01,  showWhen: { param: 'shape', value: ['box','roundedBox','cross'] } },
    roundness:{ label: 'Roundness',    type: 'float', min: 0.0,  max: 0.5,  step: 0.005, showWhen: { param: 'shape', value: ['roundedBox','cross'] } },
    rf:       { label: 'Inner ratio',  type: 'float', min: 0.1,  max: 0.9,  step: 0.01,  showWhen: { param: 'shape', value: 'star' } },
    th:       { label: 'Thickness',    type: 'float', min: 0.001,max: 0.5,  step: 0.001, showWhen: { param: 'shape', value: 'ring' } },
    nx:       { label: 'Normal X',     type: 'float', min: -1.0, max: 1.0,  step: 0.01,  showWhen: { param: 'shape', value: 'ring' } },
    ny:       { label: 'Normal Y',     type: 'float', min: -1.0, max: 1.0,  step: 0.01,  showWhen: { param: 'shape', value: 'ring' } },
    cx:       { label: 'Angle cos',    type: 'float', min: -1.0, max: 1.0,  step: 0.01,  showWhen: { param: 'shape', value: 'pie' } },
    cy:       { label: 'Angle sin',    type: 'float', min: -1.0, max: 1.0,  step: 0.01,  showWhen: { param: 'shape', value: 'pie' } },
  },
  glslFunction: SHAPE_SDF_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_distance`;
    const p  = inputVars.p  ?? 'vec2(0.0)';
    const shape = (node.params.shape as string) ?? 'circle';

    const r  = inputVars.r  ?? f(typeof node.params.r  === 'number' ? node.params.r  : 0.3);
    const rx = f(typeof node.params.rx === 'number' ? node.params.rx : 0.3);
    const ry = f(typeof node.params.ry === 'number' ? node.params.ry : 0.3);
    const rnd= f(typeof node.params.roundness === 'number' ? node.params.roundness : 0.05);
    const rf = inputVars.rf ?? f(typeof node.params.rf === 'number' ? node.params.rf : 0.5);
    const th = inputVars.th ?? f(typeof node.params.th === 'number' ? node.params.th : 0.05);
    const nx = f(typeof node.params.nx === 'number' ? node.params.nx : 0.0);
    const ny = f(typeof node.params.ny === 'number' ? node.params.ny : 1.0);
    const cx = f(typeof node.params.cx === 'number' ? node.params.cx : 0.866);
    const cy = f(typeof node.params.cy === 'number' ? node.params.cy : 0.5);
    const bVec  = inputVars.b  ?? `vec2(${rx}, ${ry})`;
    const aVec  = inputVars.a  ?? 'vec2(-0.5, 0.0)';
    const b2Vec = inputVars.b2 ?? 'vec2(0.5, 0.0)';
    const cVec  = inputVars.c  ?? `vec2(${cx}, ${cy})`;
    const nVec  = inputVars.n  ?? `vec2(${nx}, ${ny})`;

    let call: string;
    switch (shape) {
      case 'box':        call = `sdBox(${p}, ${bVec})`;                        break;
      case 'roundedBox': call = `sdRoundedBox(${p}, ${bVec}, ${rnd})`;         break;
      case 'segment':    call = `sdSegment(${p}, ${aVec}, ${b2Vec})`;          break;
      case 'triangle':   call = `sdEquilateralTriangle(${p}, ${r})`;           break;
      case 'hexagon':    call = `sdHexagon(${p}, ${r})`;                       break;
      case 'star':       call = `sdStar5(${p}, ${r}, ${rf})`;                  break;
      case 'pie':        call = `sdPie(${p}, ${cVec}, ${r})`;                  break;
      case 'ring':       call = `sdRing2(${p}, ${nVec}, ${r}, ${th})`;         break;
      case 'cross':      call = `sdCross(${p}, ${bVec}, ${rnd})`;              break;
      default:           call = `sdCircle2(${p}, ${r})`;                       break;
    }

    return {
      code: `    float ${outVar} = ${call};\n`,
      outputVars: { distance: outVar },
    };
  },
};

// ─── Simple SDF Node (circle / box / ring — quick, clean) ─────────────────────

export const SimpleSDFNode: NodeDefinition = {
  type: 'simpleSDF',
  label: 'Simple SDF',
  category: '2D Primitives',
  description: 'Fast SDF for circle, box, or ring — each with just 1–3 clean params. Wire p for position.',
  inputs: {
    p: { type: 'vec2',  label: 'Position' },
    r: { type: 'float', label: 'Radius'   },
    b: { type: 'vec2',  label: 'Half-size (box)' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  glslFunction: SHAPE_SDF_GLSL,
  defaultParams: { shape: 'circle', r: 0.3, wx: 0.3, wy: 0.3 },
  paramDefs: {
    shape: {
      label: 'Shape', type: 'select',
      options: [
        { value: 'circle', label: 'Circle' },
        { value: 'box',    label: 'Box'    },
        { value: 'ring',   label: 'Ring'   },
      ],
    },
    r:  { label: 'Radius',   type: 'float', min: 0.01, max: 2.0, step: 0.01, showWhen: { param: 'shape', value: ['circle','ring'] } },
    wx: { label: 'Width/2',  type: 'float', min: 0.01, max: 2.0, step: 0.01, showWhen: { param: 'shape', value: 'box' } },
    wy: { label: 'Height/2', type: 'float', min: 0.01, max: 2.0, step: 0.01, showWhen: { param: 'shape', value: 'box' } },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_distance`;
    const p      = inputVars.p ?? 'vec2(0.0)';
    const shape  = (node.params.shape as string) ?? 'circle';
    const r      = inputVars.r ?? f(typeof node.params.r  === 'number' ? node.params.r  : 0.3);
    const wx     = f(typeof node.params.wx === 'number' ? node.params.wx : 0.3);
    const wy     = f(typeof node.params.wy === 'number' ? node.params.wy : 0.3);
    const bVec   = inputVars.b ?? `vec2(${wx}, ${wy})`;

    let call: string;
    switch (shape) {
      case 'box':  call = `sdBox(${p}, ${bVec})`;          break;
      case 'ring': call = `abs(length(${p}) - ${r})`;      break;
      default:     call = `length(${p}) - ${r}`;           break;
    }
    return {
      code: `    float ${outVar} = ${call};\n`,
      outputVars: { distance: outVar },
    };
  },
};
