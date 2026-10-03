/**
 * Pass (render to texture) and the nodes that sample a Pass's texture.
 * See docs/pass-node-plan.md.
 *
 * A graph is normally one fragment shader, so no node can look at the pixel
 * next door in something the graph has just made. A Pass node changes that
 * when it is added: everything wired into it is drawn first into a texture of
 * its own, and nodes after it sample that texture anywhere (an offset, a blur,
 * edges). The compiler cuts the graph at Pass nodes (compiler/passGraph.ts);
 * a graph without one compiles exactly as before.
 *
 * Here the Pass node is only ever compiled as a SOURCE: in every program that
 * reads it, the compiler swaps it for a copy with no inputs, whose GLSL reads
 * its texture. Its own program ends in a Pass output (passOutput) instead.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';

/** The sampler a Pass's picture is bound to, named by its slug (as its uniforms are). */
export const passUniform = (slug: string) => `u_pass_${slug}`;
/** The sampler holding the Pass's picture from the frame before (its Previous output). */
export const passPrevUniform = (slug: string) => `u_passprev_${slug}`;
/**
 * One picture pixel in the texture's 0–1 coordinates (1 / the picture's size),
 * declared next to each Pass sampler. Sampling nodes measure offsets with it,
 * so a 4-pixel blur is 4 pixels of the final picture at any Pass Scale.
 */
export const passPxUniform = (sampler: string) => `${sampler}_px`;

/** Settings of a Pass that the engine reads (they never change the shader). */
export const PASS_SCALES: Record<string, number> = { '1': 1, '0.5': 0.5, '0.25': 0.25, '0.125': 0.125 };

export const PassNode: NodeDefinition = {
  type: 'pass',
  label: 'Pass',
  category: 'Passes',
  aliases: ['Render to texture', 'Buffer', 'TOP', 'Cache', 'FBO', 'Feedback buffer'],
  description: 'Draws everything wired into it into a texture of its own first, so the nodes after it can look around in that picture: sample it at an offset, blur it, find its edges, glow it. Wire Texture into Sample, Edges, Blur or Glow (texture). Color and Alpha are the texture at this pixel, so a Pass can also sit in an ordinary chain.',
  inputs: {
    color: { type: 'vec3', label: 'Color', hint: 'What to draw into the texture.' },
    alpha: { type: 'float', label: 'Alpha', defaultValue: 1, hint: 'Stored with the colour (1 when unwired).' },
  },
  outputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'The picture as a texture: wire it into Sample, Edges, Blur or Glow (texture).' },
    color: { type: 'vec3', label: 'Color', hint: 'The texture at this pixel.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'The texture\'s alpha at this pixel.' },
    previous: { type: 'texture', label: 'Previous', hint: 'This Pass\'s own picture from the frame before (feedback). Sample it, warp it and mix it back into this Pass\'s input for trails, smoke and reaction-diffusion.' },
  },
  defaultParams: { scale: '1', format: 'half', filter: 'linear', wrap: 'clamp' },
  paramDefs: {
    scale: { label: 'Scale', type: 'select', hint: 'Size of the texture relative to the picture. ½ or ¼ makes wide blurs and glows cheap (and softer).', options: [
      { value: '1', label: '1 (full size)' }, { value: '0.5', label: '½' }, { value: '0.25', label: '¼' }, { value: '0.125', label: '⅛' },
    ] },
    format: { label: 'Format', type: 'select', hint: 'Half float keeps brightness above 1, so glows don\'t clip. 8-bit uses half the memory.', options: [
      { value: 'half', label: 'Half float' }, { value: 'byte', label: '8-bit' },
    ] },
    filter: { label: 'Filter', type: 'select', hint: 'Linear blends between texels; Nearest keeps them sharp (pixel art).', options: [
      { value: 'linear', label: 'Linear' }, { value: 'nearest', label: 'Nearest' },
    ] },
    wrap: { label: 'Edges', type: 'select', hint: 'What a read past the edge of the texture sees.', options: [
      { value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' },
    ] },
  },
  assignable: false,
  // Compiled as a source only (see the file comment): node.id is the slug.
  declarationsFor: (node: GraphNode) => {
    const tex = passUniform(node.id), prev = passPrevUniform(node.id);
    return [
      `uniform sampler2D ${tex};`, `uniform vec2 ${passPxUniform(tex)};`,
      `uniform sampler2D ${prev};`, `uniform vec2 ${passPxUniform(prev)};`,
    ];
  },
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    const tex = passUniform(id);
    return {
      // vUv is 0–1 over the picture in every program, whatever its size.
      code: `    vec4 ${id}_s = texture2D(${tex}, vUv);\n`,
      outputVars: { texture: tex, color: `${id}_s.rgb`, alpha: `${id}_s.a`, previous: passPrevUniform(id) },
    };
  },
};

/** The end of a Pass's own program: what it draws into its texture. Made by the compiler; never in a graph. */
export const PassOutputNode: NodeDefinition = {
  type: 'passOutput',
  label: 'Pass output',
  category: 'Output',
  description: 'Internal: the colour and alpha a Pass draws into its texture.',
  inputs: {
    color: { type: 'vec3', label: 'Color' },
    alpha: { type: 'float', label: 'Alpha', defaultValue: 1 },
  },
  outputs: {},
  generateGLSL: (_node: GraphNode, inputVars) => ({
    code: `    gl_FragColor = vec4(${inputVars.color || 'vec3(0.0)'}, ${inputVars.alpha || '1.0'});\n`,
    outputVars: {},
  }),
};
