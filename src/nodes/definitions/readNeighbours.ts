/**
 * Read neighbours (texture) (docs/data-texture.md, "Read neighbours"): the four texels round this one,
 * exactly, in one node. Here, Left, Right, Up and Down are the channels you pick (one to four of
 * r g b a, typed like Read channels: one channel a float … four a vec4), Distance texels away.
 * Laplacian is Left + Right + Up + Down − 4 × Here (how curved the field is: what makes waves travel
 * and heat spread); Gradient is (Right − Left, Up − Down) / 2 of the first channel (which way it rises).
 *
 * Exact: texelFetch, clamped to the texture, so data is never blended. The common stencil of
 * simulations (waves, diffusion, reaction-diffusion, edges) without four Sample nodes.
 */
import type { DataType, GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';
import { CHANNELS, typeForWidth } from './dataTexture';

export const READ_NEIGHBOURS_TYPE = 'readNeighbours';

export const neighboursPattern = (n: Pick<GraphNode, 'params'>): string =>
  [...String(n.params.channels ?? 'r').toLowerCase()].filter(c => CHANNELS.includes(c)).slice(0, 4).join('') || 'r';

const TYPED = ['here', 'left', 'right', 'up', 'down', 'laplacian'] as const;

/** Its outputs, typed by the channel count. */
export function readNeighboursOutputs(n: Pick<GraphNode, 'params'>): GraphNode['outputs'] {
  const t = typeForWidth(neighboursPattern(n).length) as DataType;
  return {
    here: { type: t, label: 'Here' }, left: { type: t, label: 'Left' }, right: { type: t, label: 'Right' },
    up: { type: t, label: 'Up' }, down: { type: t, label: 'Down' },
    laplacian: { type: t, label: 'Laplacian' }, gradient: { type: 'vec2', label: 'Gradient' },
  };
}

export function retypeReadNeighbours(n: GraphNode): GraphNode {
  if (n.type !== READ_NEIGHBOURS_TYPE) return n;
  const want = readNeighboursOutputs(n);
  if (TYPED.every(k => n.outputs[k]?.type === want[k].type)) return n;
  return { ...n, outputs: want };
}

export const ReadNeighboursNode: NodeDefinition = {
  type: READ_NEIGHBOURS_TYPE,
  label: 'Read Neighbours (texture)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Read neighbours (texture)', 'Neighbours 4', 'Stencil', 'Laplacian', 'Gradient', 'Four neighbours', 'Left right up down', 'Finite difference'],
  description: 'The four texels round this one, read exactly, in one node: Here, Left, Right, Up and Down for the channels you pick (one channel a float … four a vec4), Distance texels away. Laplacian (Left + Right + Up + Down − 4 × Here) is how curved the field is, what makes waves travel and heat spread; Gradient is which way the first channel rises. The usual stencil of a simulation, without four Sample nodes.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'Usually a Data Texture\'s Previous (last frame), or any texture.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where "here" is, in picture coordinates. Leave empty for this pixel.' },
  },
  outputs: readNeighboursOutputs({ params: { channels: 'r' } }),
  defaultParams: { channels: 'r', distance: 1 },
  paramDefs: {
    channels: { label: 'Channels', type: 'string', hint: 'One to four of r g b a: rg, b, rgba… Every output but Gradient is as wide as this.' },
    distance: { label: 'Distance', type: 'float', min: 1, max: 16, step: 1, hint: 'How many texels away the neighbours are (1: the ones touching this one).' },
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pat = neighboursPattern(node);
    const t = typeForWidth(pat.length);
    const tex = inputVars.texture;
    const names = ['here', 'left', 'right', 'up', 'down'] as const;
    const d = `int(${p(node.params.distance, 1)})`;
    if (!tex) {
      // Distance is still declared, so its slider stays a live uniform the shader reads.
      const code = `    int ${id}_d = max(${d}, 1);\n` + names.map(k => `    ${t} ${id}_${k} = ${t}(0.0);\n`).join('') + `    ${t} ${id}_lap = ${t}(0.0);\n    vec2 ${id}_grad = vec2(0.0);\n`;
      return { code, outputVars: { here: `${id}_here`, left: `${id}_left`, right: `${id}_right`, up: `${id}_up`, down: `${id}_down`, laplacian: `${id}_lap`, gradient: `${id}_grad` } };
    }
    const offs: Record<(typeof names)[number], string> = { here: 'ivec2(0, 0)', left: `ivec2(-${id}_d, 0)`, right: `ivec2(${id}_d, 0)`, up: `ivec2(0, ${id}_d)`, down: `ivec2(0, -${id}_d)` };
    let code = `    ivec2 ${id}_sz = textureSize(${tex}, 0);\n`
      + `    ivec2 ${id}_c = clamp(ivec2(floor(${texUv(inputVars.uv ?? 'g_uv')} * vec2(${id}_sz))), ivec2(0), ${id}_sz - 1);\n`
      + `    int ${id}_d = max(${d}, 1);\n`;
    for (const k of names) code += `    ${t} ${id}_${k} = texelFetch(${tex}, clamp(${id}_c + ${offs[k]}, ivec2(0), ${id}_sz - 1), 0).${pat};\n`;
    code += `    ${t} ${id}_lap = ${id}_left + ${id}_right + ${id}_up + ${id}_down - 4.0 * ${id}_here;\n`;
    const first = (v: string) => (pat.length === 1 ? v : `${v}.x`);
    code += `    vec2 ${id}_grad = vec2(${first(`${id}_right`)} - ${first(`${id}_left`)}, ${first(`${id}_up`)} - ${first(`${id}_down`)}) * 0.5;\n`;
    return { code, outputVars: { here: `${id}_here`, left: `${id}_left`, right: `${id}_right`, up: `${id}_up`, down: `${id}_down`, laplacian: `${id}_lap`, gradient: `${id}_grad` } };
  },
};
