/**
 * Deep Glow (texture): a bloom in the spirit of After Effects' Deep Glow on a texture: a hot core with a long,
 * natural tail. The parts over Threshold (with a soft Knee) are halved again and again in a half-float
 * mip chain and built back up, many radii summed with an exponential falloff out to Radius
 * (play/kit/deepglow.js). The chain runs in hidden passes (compiler/hiddenBlurs.ts, planDeepGlow, the
 * same mechanism as Blur, Glow (texture) and Radial Fast Blur): each is an internal deepGlowTextureStage node
 * with this node's id, so its sliders are the same uniforms. The node then reads the chain's top level
 * and lays the glow over the picture (Add or Screen).
 *
 * Where hidden passes can't go (a group without a Pass, an Agents program, a repeated Pass reading
 * itself, past the budget) it draws a grainier glow in one pass (dgSingle: 32 reads on a spiral).
 * Since the 2026-10-17 sweep it is Glow (texture)'s Deep glow method (GlowTextureNode below); a saved Deep Glow (texture)
 * migrates there (NODE_ALIASES). Not SDF Glow's Deep glow mode, which glows an SDF shape. See docs/deep-glow.md.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, pv3, withParamSockets } from './helpers';
import { GlowTextureBase, passPxUniform, texUv } from './passes';
import { DG_BASE_GLSL, DG_GLSL2 } from '../../play/kit/deepglow.js';

/** The sliders a wire can drive (#829). */
export const DG_SOCKETS = ['radius', 'intensity', 'threshold', 'knee', 'spread', 'preserve', 'tint'] as const;

const paramDefs: NodeDefinition['paramDefs'] = {
  radius: { label: 'Radius', type: 'float', min: 1, max: 800, step: 1, hint: 'How far the glow\'s tail reaches, in picture pixels. The core stays hot whatever the Radius; a big Radius adds a long, soft falloff round it. Costs the same at any size.' },
  intensity: { label: 'Intensity', type: 'float', min: 0, max: 8, step: 0.01, hint: 'How bright the glow is (its exposure).' },
  threshold: { label: 'Threshold', type: 'float', min: 0, max: 2, step: 0.01, hint: 'How bright a part must be to glow (its brightest channel). 0 glows everything; above 1 only what is brighter than white (a half-float Pass).' },
  knee: { label: 'Knee', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How softly the glow fades in round Threshold: 0 a hard cut, 0.5 a gentle ramp.' },
  spread: { label: 'Chromatic spread', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Red\'s glow reaches a little further and blue\'s a little less, like a real lens: warm edges round a white core. 0 is off.' },
  preserve: { label: 'Preserve colour', type: 'float', min: 0, max: 1, step: 0.01, hint: '1 keeps the glow the colour of what glows; 0 lets its hot core bloom to white, as film does.' },
  tint: { label: 'Tint', type: 'vec3color', hint: 'Colour the glow is multiplied by (white keeps the picture\'s own).' },
  composite: { label: 'Composite', type: 'select', hint: 'Add: the glow\'s light added (it can pass white). Screen: softer, never past white.', options: [
    { value: 'add', label: 'Add' }, { value: 'screen', label: 'Screen' },
  ] },
};

const defaultParams = { radius: 120, intensity: 1, threshold: 0.6, knee: 0.3, spread: 0, preserve: 0.5, tint: [1, 1, 1], composite: 'add' };

/** The hidden pass the node reads (hiddenBlurs.ts sets these on the copy it compiles), or null. */
function chainOf(node: GraphNode): { sampler: string; scale: number; srcScale: number; levels: number } | null {
  const P = node.params;
  if (typeof P.__blurSrc !== 'string' || !P.__blurSrc) return null;
  const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
  return { sampler: P.__blurSrc, scale: num(P.__blurScale, 0.5), srcScale: num(P.__blurSrcScale, 1), levels: num(P.__blurLevels, 2) };
}
const fl = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

export const DeepGlowTextureNode: NodeDefinition = withParamSockets({
  type: 'deepGlowTexture',
  label: 'Deep Glow (texture)',
  category: 'Passes',
  aliases: ['Deep Glow', 'Bloom', 'Glow', 'Light bloom', 'Halo', 'Neon glow', 'Bloom (texture)', 'Glow (texture)', 'Light bleed'],
  description: 'A bloom like After Effects\' Deep Glow on a texture (a Pass, a Shader Texture, a picture): a hot core with a long, natural tail. What is over Threshold (with a soft Knee) is halved again and again in a half-float mip chain and built back up, many radii summed with an exponential falloff out to Radius. Chromatic spread lets red reach further than blue; Preserve colour 0 blooms the core to white. Add or Screen over the picture. Fast at any Radius: about 15 tiny hidden passes.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'A Pass\'s Texture (or a Shader Texture, a picture). Unwired, this reads black.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read, in picture coordinates. Leave empty for this pixel.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The picture with the glow over it.' },
    alpha: { type: 'float', label: 'Alpha' },
    glow: { type: 'vec3', label: 'Glow', hint: 'The glow alone (tinted, at Intensity), to add or screen over something else.' },
  },
  defaultParams,
  paramDefs,
  glslFunctions: [DG_BASE_GLSL, DG_GLSL2],
  declarationsFor: (node: GraphNode) => { const c = chainOf(node); return c ? [`uniform sampler2D ${c.sampler};`, `uniform vec2 ${passPxUniform(c.sampler)};`] : []; },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const tex = inputVars.texture;
    if (!tex) return { code: `    vec4 ${id}_o = vec4(0.0);\n    vec3 ${id}_glow = vec3(0.0);\n`, outputVars: { color: `${id}_o.rgb`, alpha: `${id}_o.a`, glow: `${id}_glow` } };
    const c = chainOf(node);
    const tint = pv3(P.tint, [1, 1, 1]);
    const lines = [
      `    vec2 ${id}_uv = ${texUv(inputVars.uv ?? 'g_uv')};\n`,
      `    vec4 ${id}_o = texture2D(${tex}, ${id}_uv);\n`,
    ];
    if (c) {
      // The chain's top level (half the source) through the dual-filter tent, divided by the levels' total weight.
      const reach = `dgReach(${p(P.radius, 120)}, ${fl(c.srcScale)})`;
      lines.push(
        `    vec3 ${id}_raw = dgUp(${c.sampler}, ${id}_uv, ${passPxUniform(c.sampler)} / ${fl(c.scale)}).rgb / max(dgWSum(${reach}, ${p(P.spread, 0)}, ${fl(c.levels)}), vec3(1e-4));\n`,
        // ±½ of an 8-bit step of noise: a wide, faint tail over black doesn't band on screen.
        `    ${id}_raw = max(${id}_raw + (dgIGN(gl_FragCoord.xy + 0.5) - 0.5) / 255.0, 0.0);\n`,
      );
    // One pass where hidden passes can't go: a jittered spiral out to Radius.
    } else lines.push(`    vec3 ${id}_raw = dgSingle(${tex}, ${id}_uv, ${passPxUniform(tex)}, ${p(P.radius, 120)}, ${p(P.threshold, 0.6)}, ${p(P.knee, 0.3)}, dgIGN(gl_FragCoord.xy));\n`);
    lines.push(
      `    vec3 ${id}_glow = dgComposite(vec3(0.0), ${id}_raw, ${p(P.intensity, 1)}, ${tint}, ${p(P.preserve, 0.5)}, 0.0);\n`,
      `    ${id}_o.rgb = dgComposite(${id}_o.rgb, ${id}_raw, ${p(P.intensity, 1)}, ${tint}, ${p(P.preserve, 0.5)}, ${P.composite === 'screen' ? '1.0' : '0.0'});\n`,
    );
    return { code: lines.join(''), outputVars: { color: `${id}_o.rgb`, alpha: `${id}_o.a`, glow: `${id}_glow` } };
  },
}, DG_SOCKETS);

/**
 * Glow (texture): THE picture glow since the 2026-10-17 sweep. Bloom chain, Smooth and Fast are passes.ts's
 * (GlowTextureBase); Deep glow is the node above (the old Deep Glow (texture), which migrates here as Method =
 * Deep glow through NODE_ALIASES): its own mip chain of hidden passes (compiler/blurPasses.ts isDeepGlow), its
 * Chromatic spread, Preserve colour and Composite. Every slider can be wired (#829); a wire drives every hidden
 * pass too. Color is the picture with the glow over it (for every method), Glow the glow alone.
 */
const base = GlowTextureBase;
const deepOnly = { showWhen: { param: 'method', value: 'deep' } };
/** Deep glow: the Method, or a saved Deep Glow (texture) compiled before its alias ran. */
const glowDeep = (node: GraphNode) => node.params.method === 'deep' || node.type === 'deepGlowTexture';

export const GlowTextureNode: NodeDefinition = withParamSockets({
  ...base,
  aliases: [...(base.aliases ?? []), 'Deep Glow', 'Deep Glow (texture)', 'Bloom'],
  description: `${base.description} Deep glow is After Effects' Deep Glow: a hot core with a long, natural tail out to Radius (hundreds of pixels cost the same), Chromatic spread and Preserve colour, added or screened over the picture.`,
  outputs: {
    ...base.outputs,
    color: { type: 'vec3', label: 'Color', hint: 'The picture with the glow over it (Deep glow: Add or Screen, as Composite says; the others add).' },
    alpha: { type: 'float', label: 'Alpha' },
  },
  defaultParams: { ...base.defaultParams, spread: 0, preserve: 0.5, composite: 'add' },
  paramDefs: {
    ...base.paramDefs,
    method: { ...base.paramDefs!.method, hint: 'Bloom chain: soft core, long tail. Smooth: one Gaussian. Fast: one pass, grainy when wide. Deep glow: a hot core with a very long tail, chromatic spread, add or screen.', options: [
      ...base.paramDefs!.method.options!, { value: 'deep', label: 'Deep glow' },
    ] },
    radius: { ...base.paramDefs!.radius, max: 200, hint: 'How far the glow spreads, in picture pixels. The Bloom chain\'s tail reaches a few times further; Deep glow\'s tail reaches Radius whatever its size (try 100–400).' },
    spread: { ...paramDefs!.spread, ...deepOnly },
    preserve: { ...paramDefs!.preserve, ...deepOnly },
    composite: { ...paramDefs!.composite, ...deepOnly },
  },
  glslFunctionsFor: node => (glowDeep(node) ? [DG_BASE_GLSL, DG_GLSL2] : []),
  declarationsFor: node => (glowDeep(node) ? DeepGlowTextureNode.declarationsFor!(node) : base.declarationsFor!(node)),
  generateGLSL: (node: GraphNode, inputVars) => {
    if (glowDeep(node)) return DeepGlowTextureNode.generateGLSL(node, inputVars);
    const r = base.generateGLSL(node, inputVars);
    const tex = inputVars.texture;
    // The picture with the glow added, as expressions: written into the shader only where something reads them.
    const at = `texture2D(${tex}, ${node.id}_uv)`;
    return { ...r, outputVars: { ...r.outputVars, color: tex ? `(${at}.rgb + ${r.outputVars.glow})` : 'vec3(0.0)', alpha: tex ? `${at}.a` : '0.0' } };
  },
}, ['radius', 'intensity', 'threshold', 'knee', 'tail', 'spread', 'preserve', 'tint']);

/**
 * One hidden pass of a Deep Glow (made by the compiler, never in a graph): __stage 'pre' (reads the
 * node's own texture: Threshold, halved), 'down' (halves __src) or 'up' (__low upsampled + __cur × level
 * __level's weight; __lowRaw: __low is the smallest level, weighed too).
 */
export const DeepGlowTextureStageNode: NodeDefinition = {
  type: 'deepGlowTextureStage',
  label: 'Deep Glow stage',
  category: 'Output',
  description: 'Internal: one hidden pass of a Deep Glow.',
  // The node's own sockets (wired sliders), so each pass computes what is wired into them.
  inputs: Object.fromEntries(Object.entries(DeepGlowTextureNode.inputs).filter(([k]) => k !== 'uv')),
  outputs: {
    color: { type: 'vec3', label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
  },
  paramDefs,
  assignable: false,
  glslFunctions: [DG_BASE_GLSL, DG_GLSL2],
  declarationsFor: (node: GraphNode) => {
    const P = node.params;
    return [P.__src, P.__low, P.__cur].filter((s): s is string => typeof s === 'string' && !!s).flatMap(s => [`uniform sampler2D ${s};`, `uniform vec2 ${passPxUniform(s)};`]);
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P: Record<string, unknown> = { ...node.params };
    for (const k of DG_SOCKETS) if (inputVars[k]) P[k] = inputVars[k];
    const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
    const out = `${id}_o`;
    // pre and down read __src (or, the first, the node's own texture); up reads __cur and __low.
    const src = P.__stage === 'up' ? (typeof P.__cur === 'string' && typeof P.__low === 'string' ? P.__cur : '') : (typeof P.__src === 'string' && P.__src) || inputVars.texture;
    if (!src) return { code: `    vec4 ${out} = vec4(0.0);\n`, outputVars: { color: `${out}.rgb`, alpha: `${out}.a` } };
    const texel = (s: string, scale: number) => `(${passPxUniform(s)} / ${fl(scale)})`;
    let code: string;
    if (P.__stage === 'pre') code = `    vec4 ${out} = dgPre(${src}, vUv, ${texel(src, num(P.__srcScale, 1))}, ${p(P.threshold, 0.6)}, ${p(P.knee, 0.3)});\n`;
    else if (P.__stage === 'down') code = `    vec4 ${out} = dgDown(${src}, vUv, ${texel(src, num(P.__srcScale, 1))});\n`;
    else {
      const low = P.__low as string, cur = P.__cur as string;
      const reach = `dgReach(${p(P.radius, 120)}, ${fl(num(P.__bloomScale, 1))})`;
      const W = (k: number) => `dgW(${fl(k)}, ${reach}, ${p(P.spread, 0)})`;
      const k = num(P.__level, 1), levels = num(P.__levels, 2);
      code = `    vec4 ${out} = vec4(texture2D(${cur}, vUv).rgb * ${W(k)} + dgUp(${low}, vUv, ${texel(low, num(P.__lowScale, 1))}).rgb${P.__lowRaw === true ? ` * ${W(levels)}` : ''}, 1.0);\n`;
    }
    return { code, outputVars: { color: `${out}.rgb`, alpha: `${out}.a` } };
  },
};
