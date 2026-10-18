/**
 * Radial Fast Blur (alias Light rays): After Effects' CC Radial Fast Blur on a texture. Long zoom
 * streaks and light rays, made by blurring the picture toward (or away from) a centre.
 *
 * The streak is drawn in hidden passes (compiler/hiddenBlurs.ts, the same mechanism as Blur and
 * Glow (texture)): RF_PASSES log-step passes of RF_TAPS reads, each reading the one before at
 * RF_TAPS times the spacing, so 4 × 8 reads add up to 4096 along the streak (play/kit/rays.js).
 * Each pass is an internal radialFastBlurStage node with this node's id, so its sliders are the
 * same uniforms. The node then reads the last pass and lays it over the picture: Average (the
 * zoom blur), Brightest (lighten: CC's light rays) or Add.
 *
 * Where hidden passes can't go (a group without a Pass, an Agents program, a repeated Pass reading
 * itself, past the budget) it draws the streak in one pass of 48 jittered reads.
 * See docs/radial-fast-blur.md.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, pv3, withParamSockets } from './helpers';
import { passPxUniform, texUv } from './passes';
import { RF_BASE_GLSL, RF_GLSL2, RF_OPACITY, RF_PASSES } from '../../play/kit/rays.js';

const TEX_HINT = 'A Pass\'s Texture (or a Shader Texture, a picture). Unwired, this reads black.';
const UV_HINT = 'Where to read, in picture coordinates. Leave empty for this pixel; wire a warp to bend the read.';

/** The sliders a wire can drive (#829): every number and the tint. */
export const RFB_SOCKETS = ['length', 'centerX', 'centerY', 'threshold', 'knee', 'intensity', 'opacity', 'decay', 'falloff', 'tint'] as const;

const MODE_HELP = 'Average: the classic zoom blur, the picture smeared along lines from the centre (in place of the picture). Brightest: the brightest colour along each streak, laid over the picture where it is brighter: CC Radial Fast Blur\'s light rays, best with a Threshold. Add: the streaks\' light added over the picture, for glowing god rays.';

const paramDefs: NodeDefinition['paramDefs'] = {
  mode: { label: 'Mode', type: 'select', hint: 'Average: a zoom blur. Brightest: light rays (the brightest along each streak). Add: the streaks added as light.', help: MODE_HELP, options: [
    { value: 'average', label: 'Average (zoom blur)' }, { value: 'brightest', label: 'Brightest (light rays)' }, { value: 'add', label: 'Add (glow rays)' },
  ] },
  direction: { label: 'Zoom', type: 'select', hint: 'Out: the streaks fly outward from the centre. In: they pull in toward it.', options: [
    { value: 'out', label: 'Out from the centre' }, { value: 'in', label: 'Into the centre' },
  ] },
  length: { label: 'Length', type: 'float', min: 0, max: 4, step: 0.01, hint: 'How long the streaks are: the farthest copy is 1 + Length times bigger. 0.1 is a short smear, 1 reaches half way to the centre, 3 is a light-speed burst. Long streaks cost the same.' },
  centerX: { label: 'Centre X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the streaks come from, across, in picture coordinates (0 the middle). Wire Centre instead to follow a point (Mouse UV).' },
  centerY: { label: 'Centre Y', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Where the streaks come from, up and down (0 the middle, 1 the top).' },
  threshold: { label: 'Threshold', type: 'float', min: 0, max: 1.5, step: 0.01, hint: 'Only parts brighter than this streak. 0 streaks everything (a zoom blur); 0.5 and up gives rays from the bright parts only.' },
  knee: { label: 'Knee', type: 'float', min: 0, max: 0.5, step: 0.01, hint: 'How softly the streaks fade in round Threshold: 0 a hard cut.' },
  intensity: { label: 'Intensity', type: 'float', min: 0, max: 4, step: 0.01, hint: 'How strong the streaks are. In Average, 1 shows only the blur and below 1 mixes the picture back.' },
  opacity: { label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Brightest and Add: how much of the rays shows over the picture. Below 1, what is behind them shows through. (Average ignores it.)' },
  decay: { label: 'Decay', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How much the streaks fade along their length. Brightest always tails off smoothly (2 % at the far end at 0); higher keeps the rays shorter and softer. Average and Add: 0 even, 1 a bright head with a faint tail.' },
  falloff: { label: 'Falloff', type: 'float', min: 0, max: 4, step: 0.01, hint: 'How much the effect fades with the distance from the centre: 0 the same everywhere, 2 mostly round the centre.' },
  tint: { label: 'Tint', type: 'vec3color', hint: 'Colour the streaks are multiplied by (white keeps the picture\'s own).' },
};

const defaultParams = { mode: 'brightest', direction: 'out', length: 0.6, centerX: 0, centerY: 0, threshold: 0.35, knee: 0.15, intensity: 1, opacity: RF_OPACITY, decay: 0.5, falloff: 0, tint: [1, 1, 1] };

const modeNum = (v: unknown) => (v === 'average' ? 0 : v === 'add' ? 2 : 1);
const dirNum = (v: unknown) => (v === 'in' ? '-1.0' : '1.0');

/** The centre in 0–1 texture coordinates: the Centre wire, else Centre X / Y (both centred picture coordinates). */
const centreOf = (node: GraphNode, center: string | undefined) => texUv(center ?? `vec2(${p(node.params.centerX, 0)}, ${p(node.params.centerY, 0)})`);

/** The hidden pass the node reads (hiddenBlurs.ts sets __blurSrc on the copy it compiles), or null. */
const hiddenOf = (node: GraphNode) => (typeof node.params.__blurSrc === 'string' && node.params.__blurSrc ? node.params.__blurSrc : null);
const decl = (s: string) => [`uniform sampler2D ${s};`, `uniform vec2 ${passPxUniform(s)};`];

export const RadialFastBlurNode: NodeDefinition = withParamSockets({
  type: 'radialFastBlur',
  label: 'Radial Fast Blur',
  category: 'Texture tools',
  aliases: ['Light rays', 'God rays', 'Sun rays', 'CC Radial Fast Blur', 'Zoom blur (texture)', 'Radial blur (texture)', 'Light streaks', 'Volumetric light', 'Zoom burst'],
  description: 'Long zoom streaks and light rays from a texture (a Pass, a Shader Texture, a picture), like After Effects\' CC Radial Fast Blur: the picture blurred along lines from a Centre. Average is a zoom blur; Brightest takes the brightest colour along each streak, so bright shapes and text throw rays; Add adds the streaks as light. Threshold keeps only the bright parts. Fast at any Length: four hidden passes of 8 reads, each reading the one before 8 times further apart (4096 reads along a streak). Wire Mouse UV into Centre to aim it.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: TEX_HINT },
    uv: { type: 'vec2', label: 'UV', hint: UV_HINT },
    center: { type: 'vec2', label: 'Centre', hint: 'Where the streaks come from, in picture coordinates (Mouse UV, a UV-space point). Unwired: Centre X / Y.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The picture with the streaks.' },
    alpha: { type: 'float', label: 'Alpha' },
    rays: { type: 'vec3', label: 'Rays', hint: 'The streaks alone (tinted, at Intensity), to add or screen over something else.' },
  },
  defaultParams,
  paramDefs,
  glslFunctions: [RF_BASE_GLSL, RF_GLSL2],
  declarationsFor: (node: GraphNode) => { const s = hiddenOf(node); return s ? decl(s) : []; },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const tex = inputVars.texture;
    if (!tex) return { code: `    vec4 ${id}_o = vec4(0.0);\n    vec3 ${id}_rays = vec3(0.0);\n`, outputVars: { color: `${id}_o.rgb`, alpha: `${id}_o.a`, rays: `${id}_rays` } };
    const len = p(P.length, 0.6);
    const mode = modeNum(P.mode);
    const hidden = hiddenOf(node);
    const lines = [
      `    vec2 ${id}_uv = ${texUv(inputVars.uv ?? 'g_uv')};\n`,
      `    vec2 ${id}_c = ${centreOf(node, inputVars.center)};\n`,
      `    vec4 ${id}_src = texture2D(${tex}, ${id}_uv);\n`,
      hidden
        ? `    vec4 ${id}_r = texture2D(${hidden}, ${id}_uv);\n`
        // One pass where hidden passes can't go: 48 reads, each pixel starting at its own fraction of a step.
        : `    vec4 ${id}_r = rfSingle(${tex}, ${id}_uv, ${id}_c, ${len}, ${dirNum(P.direction)}, rfDecayRate(${len}, ${p(P.decay, 0.5)}, ${mode === 1 ? '1.0' : '0.0'}), ${mode === 1 ? '1.0' : '0.0'}, ${p(P.threshold, 0.35)}, ${p(P.knee, 0.15)}, rfIGN(gl_FragCoord.xy));\n`,
      `    float ${id}_amt = ${p(P.intensity, 1)} * rfFalloff(${id}_uv, ${id}_c, u_resolution.x / u_resolution.y, ${p(P.falloff, 0)});\n`,
      `    vec4 ${id}_o = rfComposite(${id}_src, ${id}_r, ${mode}.0, ${id}_amt, ${pv3(P.tint, [1, 1, 1])}, ${p(P.opacity, RF_OPACITY)});\n`,
      // ±½ of an 8-bit step of noise, so a long faint streak over black doesn't band on screen.
      `    ${id}_o.rgb = max(${id}_o.rgb + (rfIGN(gl_FragCoord.xy + 0.5) - 0.5) / 255.0, 0.0);\n`,
      `    vec3 ${id}_rays = ${id}_r.rgb * ${pv3(P.tint, [1, 1, 1])} * ${id}_amt${mode === 0 ? '' : ` * ${p(P.opacity, RF_OPACITY)}`};\n`,
    ];
    return { code: lines.join(''), outputVars: { color: `${id}_o.rgb`, alpha: `${id}_o.a`, rays: `${id}_rays` } };
  },
}, RFB_SOCKETS);

/**
 * One hidden pass of a Radial Fast Blur (made by the compiler, never in a graph). __k is the pass
 * (0 the finest, which reads the node's own texture and applies Threshold); __src the pass before.
 */
export const RadialFastBlurStageNode: NodeDefinition = {
  type: 'radialFastBlurStage',
  label: 'Radial Fast Blur stage',
  category: 'Output',
  description: 'Internal: one hidden pass of a Radial Fast Blur.',
  // The node's own sockets (wired sliders and Centre), so each pass computes what is wired into them.
  inputs: Object.fromEntries(Object.entries(RadialFastBlurNode.inputs).filter(([k]) => k !== 'uv')),
  outputs: {
    color: { type: 'vec3', label: 'Color' },
    alpha: { type: 'float', label: 'Alpha' },
  },
  paramDefs,
  assignable: false,
  glslFunctions: [RF_BASE_GLSL, RF_GLSL2],
  declarationsFor: (node: GraphNode) => (typeof node.params.__src === 'string' && node.params.__src ? decl(node.params.__src) : []),
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    // A wired slider takes its slider's place (as withParamSockets does for the node itself).
    const P: Record<string, unknown> = { ...node.params };
    for (const k of RFB_SOCKETS) if (inputVars[k]) P[k] = inputVars[k];
    const src = (typeof P.__src === 'string' && P.__src) || inputVars.texture;
    const out = `${id}_o`;
    if (!src) return { code: `    vec4 ${out} = vec4(0.0);\n`, outputVars: { color: `${out}.rgb`, alpha: `${out}.a` } };
    const k = Math.max(0, Math.min(RF_PASSES - 1, typeof P.__k === 'number' ? Math.round(P.__k) : 0));
    const len = p(P.length, 0.6);
    const code = [
      `    vec2 ${id}_c = ${centreOf({ ...node, params: P }, inputVars.center)};\n`,
      `    vec4 ${out} = rfPass(${src}, vUv, ${id}_c, rfStep(${len}, ${k}.0, ${modeNum(P.mode) === 1 ? '1.0' : '0.0'}), ${dirNum(P.direction)}, rfDecayRate(${len}, ${p(P.decay, 0.5)}, ${modeNum(P.mode) === 1 ? '1.0' : '0.0'}), ${modeNum(P.mode) === 1 ? '1.0' : '0.0'}, ${k === 0 ? p(P.threshold, 0.35) : '0.0'}, ${p(P.knee, 0.15)});\n`,
    ].join('');
    return { code, outputVars: { color: `${out}.rgb`, alpha: `${out}.a` } };
  },
};
