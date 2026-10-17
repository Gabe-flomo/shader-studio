/**
 * March Camera's Lens: Smooth (docs/march-camera.md, "Depth of field").
 *
 * Grain (the camera's own, unchanged) gives every pixel one ray from a random
 * point on the lens, so out-of-focus parts are a noisy average. Smooth draws
 * the scene once through the pinhole instead, into a hidden Pass whose alpha
 * holds each pixel's signed circle of confusion (CoC), and blurs that picture
 * in the same frame with a depth-aware gather (compiler/smoothDofExpand.ts
 * wires it up). Both internal stages are this one node type, made by the
 * compiler and never in a graph:
 *
 *  - coc: the signed CoC from the march's Distance and the camera's lens
 *    (Aperture × FOV and 1 / Focal Dist, which the camera hands over as two
 *    outputs, so a wired or dragged Aperture keeps working);
 *  - gather: reads the Pass. Each tap counts only when its own CoC reaches
 *    this pixel (scatter-as-gather), and a tap behind this pixel may not be
 *    blurrier than this pixel allows, so a sharp foreground keeps its edge over
 *    a blurred background while a blurred foreground still spills over a sharp
 *    one.
 *
 * CoC (thin lens, the same geometry as Grain): a point at distance d along the
 * ray, seen through a lens of radius A focused at f, spreads over a disc of
 * radius A·|1/d − 1/f| radians; FOV turns radians into picture units (uv, 2 per
 * picture height), so in picture heights the radius is A·FOV·|1/d − 1/f| / 2.
 * Signed: positive behind the focus, negative in front, and increasing with
 * distance, so comparing two CoCs compares their depths.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { BL_BASE_GLSL } from '../../play/kit/blur.js';

export const LENS_DOF_STAGE_TYPE = 'lensDofStage';

export type LensShape = 'disc' | 'hex' | 'oct';

/** The signed CoC radius in picture heights (see the header): positive behind the focus. */
export function lensCoc(aperture: number, fov: number, focalDist: number, dist: number): number {
  return 0.5 * aperture * fov * (1 / Math.max(focalDist, 0.05) - 1 / Math.max(dist, 1e-3));
}

/** Gather taps per pixel (Quality). */
export const LENS_SAMPLES = [16, 32, 64] as const;
export const lensSamples = (v: unknown): number => {
  const n = Number(v);
  return (LENS_SAMPLES as readonly number[]).includes(n) ? n : 32;
};
export const lensShape = (v: unknown): LensShape => (v === 'hex' || v === 'oct' ? v : 'disc');
/** Max blur, in picture heights (the slider is a percentage). */
export const lensMaxBlur = (v: unknown): number => {
  const n = typeof v === 'number' && isFinite(v) ? v : 4;
  return Math.max(0.1, Math.min(20, n)) / 100;
};

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/**
 * The gather. `cc` is this pixel's signed CoC, `R` the largest radius in pixels, `n` the polygon's sides
 * (0: a disc). First a ring of probes finds how far a nearer, blurrier neighbour reaches (so a blurred
 * foreground spills over what is behind it); then N golden-angle taps over the larger of that and this
 * pixel's own radius, turned per pixel (fine noise instead of rings).
 */
export const LENS_DOF_GLSL = `
float ldShape(float a, float n) {
  if (n < 2.5) return 1.0;
  float seg = 6.2831853 / n;
  return cos(0.5 * seg) / cos(mod(a, seg) - 0.5 * seg);
}
vec3 lensDofGather(sampler2D tex, vec2 uv, vec2 px, float res, float R, float n, int N) {
  vec4 c0 = texture2D(tex, uv);
  float cc = c0.a;
  float own = min(abs(cc) * res, R);
  // How far nearer, blurrier neighbours reach in: two rings of 8 probes.
  float reach = own;
  for (int i = 0; i < 16; i++) {
    float d = (i < 8 ? 0.5 : 1.0) * R;
    float a = float(i) * 0.7853982 + (i < 8 ? 0.0 : 0.3926991);
    vec4 s = texture2D(tex, uv + vec2(cos(a), sin(a)) * d * px);
    float ss = min(abs(s.a) * res, R);
    if (s.a < cc && ss >= d) reach = max(reach, ss);
  }
  if (reach < 0.5) return c0.rgb;
  float rot = blIGN(gl_FragCoord.xy) * 6.2831853;
  float fn = float(N);
  // Taps are about this far apart: the edge of a CoC is softened over it.
  float soft = max(reach / sqrt(fn), 0.5);
  vec3 acc = c0.rgb;
  float tot = 1.0;
  for (int i = 0; i < 64; i++) {
    if (i >= N) break;
    float r = sqrt((float(i) + 0.5) / fn) * reach;
    float a = float(i) * 2.3999632 + rot;
    vec2 off = vec2(cos(a), sin(a)) * r * ldShape(a, n);
    vec4 s = texture2D(tex, uv + off * px);
    float ss = min(abs(s.a) * res, R);
    // A tap behind this pixel can't blur over it more than this pixel is blurred (sharp edges stay sharp).
    if (s.a > cc) ss = min(ss, max(own, 1.0) * 2.0);
    float m = smoothstep(r - soft, r + soft, ss);
    acc += mix(acc / tot, s.rgb, m);
    tot += 1.0;
  }
  return acc / tot;
}`;

const samplerDecl = (s: string) => [`uniform sampler2D ${s};`, `uniform vec2 ${s}_px;`];

export const LensDofStageNode: NodeDefinition = {
  type: LENS_DOF_STAGE_TYPE,
  label: 'Smooth lens',
  category: 'Output',
  description: 'Internal: March Camera Lens: Smooth (its CoC, or its gather blur).',
  inputs: {
    dist: { type: 'float', label: 'Distance' },
    k: { type: 'float', label: 'Aperture × FOV' },
    invF: { type: 'float', label: '1 / Focal Dist' },
    texture: { type: 'texture', label: 'Texture' },
  },
  outputs: {
    coc: { type: 'float', label: 'CoC' },
    color: { type: 'vec3', label: 'Color' },
  },
  assignable: false,
  glslFunctionsFor: (node: GraphNode) => (node.params.__stage === 'gather' ? [BL_BASE_GLSL, LENS_DOF_GLSL] : []),
  declarationsFor: (node: GraphNode) => (typeof node.params.__src === 'string' && node.params.__src ? samplerDecl(node.params.__src) : []),
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    if (node.params.__stage !== 'gather') {
      // Signed CoC in picture heights; the far limit (a miss) reads as far away.
      const d = inputVars.dist || '1e4';
      const k = inputVars.k || '0.0', invF = inputVars.invF || '0.0';
      return {
        code: `    float ${id}_coc = 0.5 * ${k} * (${invF} - 1.0 / max(${d}, 1e-3));\n`,
        outputVars: { coc: `${id}_coc`, color: 'vec3(0.0)' },
      };
    }
    const tex = inputVars.texture || (typeof node.params.__src === 'string' ? node.params.__src : '');
    if (!tex) return { code: `    vec3 ${id}_c = vec3(0.0);\n`, outputVars: { color: `${id}_c`, coc: '0.0' } };
    const shape = lensShape(node.params.dofShape);
    const sides = shape === 'hex' ? 6 : shape === 'oct' ? 8 : 0;
    const n = lensSamples(node.params.dofSamples);
    const maxBlur = lensMaxBlur(node.params.dofMaxBlur);
    return {
      code: `    vec3 ${id}_c = lensDofGather(${tex}, vUv, ${tex}_px, u_resolution.y, max(${f(maxBlur)} * u_resolution.y, 1.0), ${f(sides)}, ${n});\n`,
      outputVars: { color: `${id}_c`, coc: `texture2D(${tex}, vUv).a` },
    };
  },
};
