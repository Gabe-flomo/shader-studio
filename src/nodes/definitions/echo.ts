import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

/** Most copies an Echo node can layer: one sampler each, on top of the shader's other textures. */
export const ECHO_MAX_COPIES = 6;

/**
 * Echo — After Effects style after-images.
 *
 * Previous Frame samples exactly one frame back, so trails from it are an
 * infinite fade. Echo layers *discrete* copies of the picture from `delay`
 * frames ago, 2 × delay frames ago, and so on, each dimmer by `decay`. The
 * preview keeps a small ring of snapshot frames for it (see ShaderCanvas):
 * every `delay` frames the ring rotates and the newest frame is captured, so
 * copy i always shows the picture (i + 1) × delay frames back.
 */
export const EchoNode: NodeDefinition = {
  type: 'echo',
  label: 'Echo (After-image)',
  category: 'Post Processing',
  aliases: ['After-image', 'Trails'],
  description: 'Layers dimmer copies of earlier frames — the After Effects echo. `Copies` is how many, `Delay` how many frames apart, `Decay` how much each copy fades. Wire the result over your picture with Max or Add for smears and ghosting.',
  inputs: {
    uv: { type: 'vec2', label: 'UV', hint: 'Where to sample the earlier frames. Leave empty for the screen; wire a warp to smear the copies.' },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Echoes', hint: 'The layered copies. Combine with the live picture using Max, Add or Mix.' },
    alpha: { type: 'float', label: 'Coverage', hint: 'How much echo lands here, 0–1.' },
  },
  defaultParams: { copies: 3, delay: 6, decay: 0.7, blend: 'max' },
  paramDefs: {
    copies: { label: 'Copies', type: 'float', min: 1, max: ECHO_MAX_COPIES, step: 1, compileTime: true, hint: 'How many earlier frames to layer. Each one costs a frame of GPU memory.' },
    delay:  { label: 'Delay',  type: 'float', min: 1, max: 60, step: 1, compileTime: true, hint: 'Frames between copies. 6 at 60 fps is a tenth of a second.' },
    decay:  { label: 'Decay',  type: 'float', min: 0, max: 1, step: 0.01, hint: 'Brightness of each copy relative to the one before it. 1 keeps them all full strength.' },
    blend:  { label: 'Blend',  type: 'select', options: [
      { value: 'max',    label: 'Max (ghosts)' },
      { value: 'add',    label: 'Add (glow)' },
      { value: 'screen', label: 'Screen (soft)' },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const copies = Math.max(1, Math.min(ECHO_MAX_COPIES, Math.round(Number(node.params.copies ?? 3))));
    const blend = typeof node.params.blend === 'string' ? node.params.blend : 'max';
    const uvVar = inputVars.uv ?? 'g_uv';
    const samplerUV = `(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5)`;
    const decay = p(node.params.decay, 0.7);
    const lines: string[] = [
      `    vec2 ${id}_uv = clamp(${samplerUV}, 0.0, 1.0);\n`,
      `    vec3 ${id}_color = vec3(0.0);\n`,
      `    float ${id}_alpha = 0.0;\n`,
      `    float ${id}_w = 1.0;\n`,
    ];
    for (let i = 0; i < copies; i++) {
      lines.push(`    ${id}_w *= ${decay};\n`);
      lines.push(`    vec4 ${id}_e${i} = texture2D(u_echo${i}, ${id}_uv);\n`);
      if (blend === 'add') {
        lines.push(`    ${id}_color += ${id}_e${i}.rgb * ${id}_w;\n`);
      } else if (blend === 'screen') {
        lines.push(`    ${id}_color = 1.0 - (1.0 - ${id}_color) * (1.0 - ${id}_e${i}.rgb * ${id}_w);\n`);
      } else {
        lines.push(`    ${id}_color = max(${id}_color, ${id}_e${i}.rgb * ${id}_w);\n`);
      }
      lines.push(`    ${id}_alpha = max(${id}_alpha, ${id}_e${i}.a * ${id}_w);\n`);
    }
    return { code: lines.join(''), outputVars: { color: `${id}_color`, alpha: `${id}_alpha` } };
  },
};
