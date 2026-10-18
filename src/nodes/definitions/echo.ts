import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';

/** Most copies an Echo node can layer: one sampler each, on top of the shader's other textures. */
export const ECHO_MAX_COPIES = 6;

/**
 * Set while the renderer draws the frame the echo ring keeps (1 for that draw, else 0). In that
 * draw the shader writes the Echo node's Color input (g_echoIn) instead of the picture, and a
 * legacy Echo's outputs are zero: the ring holds the picture without its own echoes, so the
 * copies never echo themselves (they used to, which made Add / Screen run away to white and left
 * Copies with nothing to change: copy 1 already held the whole trail).
 */
export const ECHO_CAPTURE_UNIFORM = 'u_echoCap';
/** The global the shader keeps the Echo's Color input in, for the capture draw. */
export const ECHO_INPUT_GLOBAL = 'g_echoIn';

/** Echo nodes made before Echo took a Color input: UV in, Echoes / Coverage out (see migrateParams). */
export const isLegacyEcho = (node: Pick<GraphNode, 'params'>): boolean => node.params?.legacy === true;

export type EchoBlend = 'max' | 'add' | 'screen';
const blendOf = (v: unknown): EchoBlend => (v === 'add' || v === 'screen' ? v : 'max');

/**
 * The Echo blend on the CPU, the same maths as the GLSL below (tests and the card's picture).
 * `live` is the picture now, `copies[i]` the picture (i + 1) × delay frames ago; copy i weighs
 * decay^(i+1). Every mode stays within the brightest of what goes in, and a still picture comes
 * out as it went in for Ghosts and Add (Screen brightens it a little, as screening does):
 *  - Ghosts: the brightest of the live picture and each weighted copy.
 *  - Add: the live picture and the weighted copies summed and divided by their total weight,
 *    never darker than the live picture (so the live picture stays at full strength).
 *  - Screen: the copies screened over the live picture, each weight divided by the total.
 * `echoes` is the copies alone (Echoes only): weights divided by their sum once it passes 1.
 */
export function echoBlendCPU(live: number, copies: readonly number[], decay: number, blend: EchoBlend): { color: number; echoes: number } {
  let ws = 0, w = 1;
  for (let i = 0; i < copies.length; i++) { w *= decay; ws += w; }
  const n = Math.max(1, ws), n1 = 1 + ws;
  const sat = (x: number) => Math.min(1, Math.max(0, x));
  w = 1;
  let mx = 0, sum = 0, pe = 1, pc = 1;
  for (const e of copies) {
    w *= decay;
    mx = Math.max(mx, e * w);
    sum += e * w;
    pe *= 1 - sat(e) * w / n;
    pc *= 1 - sat(e) * w / n1;
  }
  if (blend === 'add') return { color: Math.max(live, (live + sum) / n1), echoes: sum / n };
  if (blend === 'screen') return { color: 1 - (1 - live) * pc, echoes: 1 - pe };
  return { color: Math.max(live, mx), echoes: mx };
}

/**
 * Echo — After Effects style after-images, as an effect on a colour.
 *
 * Previous Frame samples exactly one frame back, so trails from it are an
 * infinite fade. Echo layers *discrete* copies of its Color input from `delay`
 * frames ago, 2 × delay frames ago, and so on, each dimmer by `decay`, and
 * blends them with the live colour. The preview keeps a small ring of
 * snapshot frames for it (see ShaderCanvas): every `delay` frames the ring
 * rotates and the newest slot takes the Echo's input (a second draw of the
 * shader with u_echoCap set), so copy i always shows the input (i + 1) × delay
 * frames back, without the echoes themselves.
 *
 * Saved graphs from before (UV in, Echoes out, laid over the picture with Add /
 * Max by hand) load with `legacy: true` and keep those sockets: their echoes are
 * of the whole picture, as before.
 */
export const EchoNode: NodeDefinition = withParamSockets({
  type: 'echo',
  label: 'Echo (After-image)',
  category: 'Post Processing',
  aliases: ['After-image', 'Trails'],
  description: 'Feed it a colour: it comes out with dimmer copies of its earlier frames blended in, the After Effects echo. `Copies` is how many, `Delay` how many frames apart, `Decay` how much each copy fades, `Blend` how they combine. Wire it like any effect: … → Echo → Tone Map → Output.',
  version: 2,
  inputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The picture to echo: its earlier frames are the copies.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to sample the earlier frames. Leave empty for the screen; wire a warp to smear the copies.' },
  },
  outputs: {
    color:  { type: 'vec3',  label: 'Color', hint: 'The colour with its echoes blended in.' },
    echoes: { type: 'vec3',  label: 'Echoes only', hint: 'The layered copies alone, without the live colour.' },
    alpha:  { type: 'float', label: 'Coverage', hint: 'How much echo lands here, 0–1.' },
  },
  defaultParams: { copies: 3, delay: 6, decay: 0.7, blend: 'max', _schemaVersion: 2 },
  // Saved before version 2: the UV-in, Echoes-out node. It keeps that shape (syncSockets).
  migrateParams: (params, fromVersion) => (fromVersion < 2 ? { ...params, legacy: true } : params),
  syncSockets: (node) => {
    if (!isLegacyEcho(node)) return node;
    const { color: _unused, ...inputs } = node.inputs;
    const outputs = { color: { type: 'vec3' as const, label: 'Echoes' }, alpha: { type: 'float' as const, label: 'Coverage' } };
    const same = !('color' in node.inputs) && Object.keys(node.outputs).join() === 'color,alpha' && node.outputs.color?.label === 'Echoes';
    return same ? node : { ...node, inputs, outputs };
  },
  paramDefs: {
    copies: { label: 'Copies', type: 'float', min: 1, max: ECHO_MAX_COPIES, step: 1, compileTime: true, hint: 'How many earlier frames to layer. Each one costs a frame of GPU memory.' },
    delay:  { label: 'Delay',  type: 'float', min: 1, max: 60, step: 1, compileTime: true, hint: 'Frames between copies. 6 at 60 fps is a tenth of a second. Every Delay frames the shader draws once more, to keep the newest copy.' },
    decay:  { label: 'Decay',  type: 'float', min: 0, max: 1, step: 0.01, hint: 'Brightness of each copy relative to the one before it. 1 keeps them all full strength.' },
    blend:  { label: 'Blend',  type: 'select', hint: 'How the copies combine. None of them can run away to white: the weights are shared out so the total stays within the brightest copy.', options: [
      { value: 'max',    label: 'Max (ghosts)' },
      { value: 'add',    label: 'Add (glow)' },
      { value: 'screen', label: 'Screen (soft)' },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars): { code: string; outputVars: Record<string, string> } => {
    const id = node.id;
    const legacy = isLegacyEcho(node);
    const copies = Math.max(1, Math.min(ECHO_MAX_COPIES, Math.round(Number(node.params.copies ?? 3))));
    const blend = blendOf(node.params.blend);
    const uvVar = inputVars.uv ?? 'g_uv';
    const samplerUV = `(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5)`;
    const decay = p(node.params.decay, 0.7);
    const L: string[] = [
      `    vec2 ${id}_uv = clamp(${samplerUV}, 0.0, 1.0);\n`,
      ...(legacy ? [] : [
        `    vec3 ${id}_in = ${inputVars.color ?? 'vec3(0.0)'};\n`,
        `    ${ECHO_INPUT_GLOBAL} = ${id}_in;\n`,
      ]),
      // The weights' total, for sharing them out (see echoBlendCPU).
      `    float ${id}_w = 1.0;\n`,
      `    float ${id}_ws = 0.0;\n`,
    ];
    for (let i = 0; i < copies; i++) L.push(`    ${id}_w *= ${decay}; ${id}_ws += ${id}_w;\n`);
    L.push(
      `    float ${id}_n = max(1.0, ${id}_ws);\n`,
      `    float ${id}_n1 = 1.0 + ${id}_ws;\n`,
      `    ${id}_w = 1.0;\n`,
      `    vec3 ${id}_echoes = vec3(0.0);\n`,
      `    vec3 ${id}_pc = vec3(1.0);\n`,
      `    float ${id}_alpha = 0.0;\n`,
    );
    for (let i = 0; i < copies; i++) {
      L.push(`    ${id}_w *= ${decay};\n`);
      L.push(`    vec4 ${id}_e${i} = texture2D(u_echo${i}, ${id}_uv);\n`);
      if (blend === 'add') {
        L.push(`    ${id}_echoes += ${id}_e${i}.rgb * ${id}_w;\n`);
      } else if (blend === 'screen') {
        L.push(`    ${id}_echoes = 1.0 - (1.0 - ${id}_echoes) * (1.0 - clamp(${id}_e${i}.rgb, 0.0, 1.0) * (${id}_w / ${id}_n));\n`);
        if (!legacy) L.push(`    ${id}_pc *= 1.0 - clamp(${id}_e${i}.rgb, 0.0, 1.0) * (${id}_w / ${id}_n1);\n`);
      } else {
        L.push(`    ${id}_echoes = max(${id}_echoes, ${id}_e${i}.rgb * ${id}_w);\n`);
      }
      if (legacy) L.push(`    ${id}_alpha = max(${id}_alpha, ${id}_e${i}.a * ${id}_w);\n`);
    }
    // Add keeps the plain weighted sum for the Color blend; Echoes only divides it by the total past 1.
    const sum = `${id}_echoes`;
    if (blend === 'add') L.push(`    vec3 ${id}_sum = ${sum};\n    ${id}_echoes = ${sum} / ${id}_n;\n`);
    if (legacy) {
      // The capture draw leaves the echoes out, so the ring keeps the picture without them.
      L.push(`    ${id}_echoes *= 1.0 - ${ECHO_CAPTURE_UNIFORM};\n    ${id}_alpha *= 1.0 - ${ECHO_CAPTURE_UNIFORM};\n`);
      return { code: L.join(''), outputVars: { color: `${id}_echoes`, alpha: `${id}_alpha` } };
    }
    const mix = blend === 'add' ? `max(${id}_in, (${id}_in + ${id}_sum) / ${id}_n1)`
      : blend === 'screen' ? `1.0 - (1.0 - ${id}_in) * ${id}_pc`
      : `max(${id}_in, ${id}_echoes)`;
    L.push(
      `    vec3 ${id}_color = ${mix};\n`,
      `    ${id}_alpha = clamp(max(${id}_echoes.r, max(${id}_echoes.g, ${id}_echoes.b)), 0.0, 1.0);\n`,
    );
    return { code: L.join(''), outputVars: { color: `${id}_color`, echoes: `${id}_echoes`, alpha: `${id}_alpha` } };
  },
}, ['decay']);
