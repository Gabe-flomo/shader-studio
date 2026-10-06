/**
 * Motion (texture) — a Play Motion layer's grid of where things moved lately,
 * as a texture the graph can read (docs/motion-layer.md's follow-up, Agents P4).
 *
 * Amount is how much moved at a point (0..1); Texture is the whole grid, for
 * anything that samples textures: an Agents group's port (Sense smells it),
 * Emit's Picture (walkers are born where it moves), a Trail's Add (food where
 * people move, through Sample (texture) or straight from Amount), Glow, Blur.
 *
 * The app fills the shared uniforms from the setup's first Motion layer after
 * every overlay frame (play/motionTexture.ts → ShaderCanvas), so the picture
 * reads it a frame late, as the Layers node does. Row 0 is the bottom and it
 * covers the picture (texture coordinates 0–1, like a Pass or a Trail). With
 * no Motion layer it reads 0 everywhere. A live camera is live input: renders
 * read whatever the Motion layer saw then.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p } from './helpers';

/** The shared uniforms (play/motionTexture.ts fills them; every Motion (texture) node reads the same). */
export const MOTION_MAP_UNIFORM = 'u_motionMap';
export const MOTION_MAP_GLSL = `uniform sampler2D ${MOTION_MAP_UNIFORM};
uniform vec2 ${MOTION_MAP_UNIFORM}_px;
float mtMapAt(vec2 q) { return texture2D(${MOTION_MAP_UNIFORM}, clamp(q / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0)).r; }`;

export const MotionMapNode: NodeDefinition = {
  type: 'motionMap',
  label: 'Motion (texture)',
  category: 'Sources',
  aliases: ['Motion layer', 'Movement', 'Motion map', 'Where it moves', 'Camera motion'],
  description: 'Where the Play page\'s Motion layer saw movement lately, as a texture: Amount (0–1) at a point, or the whole grid for an Agents group (Sense smells it), Emit\'s Picture (born where it moves), a Trail\'s Add (food where people move), Glow or Blur. Add a Motion layer in Play first. It reads the previous frame.',
  brief: {
    summary: 'A Play Motion layer\'s grid of where things moved, as a texture.',
    start: [
      'In Play: Add layer → Picture effects → Motion (it watches the camera, a Video layer or the picture).',
      'Amount → anything that takes a number; Texture → an Agents group\'s port, Emit\'s Picture or Sample (texture).',
      'Gain makes small movements count for more.',
    ],
  },
  inputs: {
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read Amount (the UV node\'s centred coordinates). Unwired: this pixel (inside an Agents group, the walker).' },
  },
  outputs: {
    amount: { type: 'float', label: 'Amount', hint: 'How much moved here lately, 0 (still) to 1, times Gain.' },
    texture: { type: 'texture', label: 'Texture', hint: 'The whole grid (0–1 in red): into an Agents group\'s port, Emit\'s Picture, Sample (texture), Glow, Blur or a Texture tool (Mask, Levels, Flow).' },
  },
  defaultParams: { gain: 1 },
  paramDefs: {
    gain: { label: 'Gain', type: 'float', min: 0, max: 8, step: 0.01, hint: 'Amount is the grid times this (1: as measured).' },
  },
  glslFunction: MOTION_MAP_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    return {
      code: `    float ${id}_m = mtMapAt(${inputVars.uv ?? 'g_uv'}) * ${p(node.params.gain, 1)};\n`,
      outputVars: { amount: `${id}_m`, texture: MOTION_MAP_UNIFORM },
    };
  },
};
