/**
 * Shader Texture: a node that holds its own shader graph, drawn into a texture (docs/texture-builder.md).
 *
 * Open it (double-click, or Edit inside on the card) and you are inside its own graph, like a group.
 * The inside ends in Texture Output; what is wired into it is drawn into a texture at the node's
 * Resolution. The node's Texture output is that texture, ready for anything that takes one (an
 * Agents group's Emit Picture, a Trail's Add through Sample, Grid Rules' Start image, the Texture
 * tools, Depth); Color and Alpha are the texture at this pixel.
 *
 * Under the hood it is a Pass (nodes/definitions/passes.ts): the compiler opens it into its inner
 * nodes plus a Pass with the node's own id (compiler/shaderTextureExpand.ts), so the render target,
 * thumbnails, timers and web pages are the Pass machinery's. Outside a pass compile (which never
 * happens for a graph that has one: hasPassNode says yes) it reads its texture as a Pass does.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { PassNode } from './passes';

export const SHADER_TEXTURE_TYPE = 'shaderTexture';
export const SHADER_TEXTURE_OUTPUT_TYPE = 'shaderTextureOutput';

/** Resolution choices: a square texture of that many pixels, or the picture's own size ('canvas'). */
export const SHADER_TEXTURE_SIZES: Array<{ value: string; label: string; px: number | null }> = [
  { value: '128', label: '128 × 128', px: 128 },
  { value: '256', label: '256 × 256', px: 256 },
  { value: '512', label: '512 × 512', px: 512 },
  { value: '1024', label: '1024 × 1024', px: 1024 },
  { value: '2048', label: '2048 × 2048', px: 2048 },
  { value: 'canvas', label: 'Match the picture', px: null },
];

/** The texture's side in pixels, or null for "match the picture". Unknown values fall back to 512. */
export function shaderTextureSize(v: unknown): number | null {
  const hit = SHADER_TEXTURE_SIZES.find(s => s.value === String(v));
  return hit ? hit.px : 512;
}

export type ShaderTextureUpdate = 'frame' | 'change' | 'once';
/** How often it draws: every frame, when something it reads changes (a slider, Time if it uses it), or once. */
export function shaderTextureUpdate(v: unknown): ShaderTextureUpdate {
  return v === 'frame' || v === 'once' ? v : 'change';
}

export const SHADER_TEXTURE_STARTERS: Array<{ value: string; label: string }> = [
  { value: 'noise', label: 'Noise' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'circles', label: 'Circles' },
  { value: 'stripes', label: 'Stripes' },
];

export const ShaderTextureNode: NodeDefinition = {
  type: SHADER_TEXTURE_TYPE,
  label: 'Shader Texture',
  category: 'Sources',
  aliases: ['Create a new texture', 'Texture builder', 'Shader as texture', 'Render to texture', 'Procedural texture', 'Generated texture', 'Make a texture'],
  description: 'Makes a new texture from a shader graph of its own. Open it (double-click, or Edit inside) to edit its graph: whatever reaches Texture Output inside is drawn into a texture at Resolution. Wire Texture anywhere a texture goes (food or a birth picture for agents, Grid Rules\' start, a mask, Depth, the Texture tools); Color is the texture at this pixel. Starts from a small graph (noise, a gradient, circles or stripes). Update On change draws it again only when something it reads changes, so a still texture costs nothing per frame.',
  inputs: {},
  outputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'The texture this node draws: wire it into Sample, Edges, Blur or Glow (texture), a Texture tool, an Agents group\'s Emit Picture, Grid Rules\' Start image, or anything else that takes a texture.' },
    color: { type: 'vec3', label: 'Color', hint: 'The texture at this pixel (stretched over the picture).' },
    alpha: { type: 'float', label: 'Alpha', hint: 'The texture\'s alpha at this pixel.' },
  },
  defaultParams: { label: 'Shader Texture', size: '512', update: 'change', filter: 'linear', wrap: 'repeat', format: 'half', starter: 'noise' },
  paramDefs: {
    size: { label: 'Resolution', type: 'select', hint: 'How many pixels the texture has. Small is cheap and soft; Match the picture follows the preview\'s size.', options: SHADER_TEXTURE_SIZES.map(s => ({ value: s.value, label: s.label })) },
    update: { label: 'Update', type: 'select', hint: 'Every frame: always drawn again. On change: drawn again only when a slider or a Play control changes, or the clock when a Time node is inside. Once: drawn when the graph inside changes, then kept.', options: [
      { value: 'change', label: 'On change' }, { value: 'frame', label: 'Every frame' }, { value: 'once', label: 'Once' },
    ] },
    filter: { label: 'Filter', type: 'select', hint: 'Linear blends between texels; Nearest keeps them sharp (pixel art).', options: [
      { value: 'linear', label: 'Linear' }, { value: 'nearest', label: 'Nearest' },
    ] },
    wrap: { label: 'Edges', type: 'select', hint: 'What a read past the edge of the texture sees: Repeat tiles it.', options: [
      { value: 'repeat', label: 'Repeat' }, { value: 'clamp', label: 'Clamp' }, { value: 'mirror', label: 'Mirror' },
    ] },
    format: { label: 'Format', type: 'select', hint: 'Half float keeps values above 1 and below 0; 8-bit uses half the memory.', options: [
      { value: 'half', label: 'Half float' }, { value: 'byte', label: '8-bit' },
    ] },
  },
  assignable: false,
  // As a Pass read as a source: its id is its slug. Only reached outside a pass compile.
  declarationsFor: (node: GraphNode) => PassNode.declarationsFor!({ ...node, params: { ...node.params, repeat: 1 } }),
  generateGLSL: (node: GraphNode) => {
    const r = PassNode.generateGLSL({ ...node, params: { ...node.params, repeat: 1 } }, {});
    return { code: '', outputVars: { texture: r.outputVars.texture, color: r.outputVars.color, alpha: r.outputVars.alpha } };
  },
};

/** The end of a Shader Texture's inside: what is drawn into its texture. Made with the node; can't be deleted. */
export const ShaderTextureOutputNode: NodeDefinition = {
  type: SHADER_TEXTURE_OUTPUT_TYPE,
  label: 'Texture Output',
  category: 'Output',
  description: 'Inside a Shader Texture: the colour (and alpha) wired here is drawn into the texture, one texel at a time. UV inside reads the texture\'s own square (−1 to 1 across), not the picture.',
  anchored: true,
  inputs: {
    color: { type: 'vec3', label: 'Color', hint: 'What to draw into the texture.' },
    alpha: { type: 'float', label: 'Alpha', defaultValue: 1, hint: 'Stored with the colour (1 when unwired).' },
  },
  outputs: {},
  defaultParams: {},
  paramDefs: {},
  assignable: false,
  // Replaced by the compiler: its wires go into the Pass the node becomes.
  generateGLSL: () => ({ code: '', outputVars: {} }),
};
