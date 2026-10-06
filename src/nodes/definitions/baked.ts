import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';

/**
 * Baked (docs/bake.md): a part of the graph rendered once to a video and
 * played back in its place, in step with the clock. Made by Bake… (a node's
 * menu) or Bake the picture; never from the node browser.
 *
 * The video lives in the video library (`videoId`, the same key Video layers
 * use, so the Library and Files pages count it as used and play files carry
 * it). The live nodes it replaced wait in `params._bake` (lib/bake/graphOps.ts)
 * until Unbake puts them back.
 *
 * The shader samples `u_vid_<slug>` (bound like a Video Input's texture, by
 * lib/bakedVideos.ts, which keeps the video on frame (t − start) × fps). An
 * alpha bake stores colour on top and alpha (as grey) beneath in one frame;
 * the node puts them back together here.
 */

/** What the Baked node shows about its video (params.bakeInfo). */
export interface BakedInfo {
  /** What was baked: the node's name, or "the picture". */
  source: string;
  fps: number;
  /** Seconds of video. */
  duration: number;
  /** Clock time of its first frame. */
  start: number;
  loop: 'none' | 'seamless';
  width: number;
  height: number;
  /** Colour on top, alpha beneath (see lib/bake/plan.ts packAlpha). */
  alpha: boolean;
  /** The file's size in bytes. */
  bytes: number;
  /** Live inputs the baked nodes read that no longer move it (the mouse, sound, MIDI, Play controls…). */
  frozen: string[];
  /** When it was baked (ms since 1970). */
  bakedAt: number;
  /** The video format: 'h264' (desktop, .mp4), or 'vp8' / 'vp9' (browser, .webm). */
  codec: string;
}

export const bakedInfo = (node: GraphNode): BakedInfo | null => {
  const i = node.params.bakeInfo as BakedInfo | undefined;
  return i && typeof i === 'object' && typeof i.fps === 'number' ? i : null;
};

/** What a Baked node's card calls it: the name of what was baked. */
export const bakedSourceName = (node: GraphNode) => bakedInfo(node)?.source ?? 'Baked';

export const BakedNode: NodeDefinition = {
  type: 'baked',
  label: 'Baked',
  category: 'Sources',
  description: 'A part of the graph rendered to a video and played back in its place, frame for frame with the clock. Much cheaper to draw than the nodes it replaced; Unbake brings them back.',
  inputs: {
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the video. Unwired, it covers the picture exactly as the baked nodes did.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The baked picture at this pixel.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'Its alpha (1 unless the bake kept alpha).' },
    rgba: { type: 'vec4', label: 'RGBA', hint: 'Colour and alpha together.' },
    value: { type: 'float', label: 'Value', hint: 'The picture as one number (its brightness): what a baked value or mask was.' },
    texture: { type: 'texture', label: 'Texture', hint: 'The video as a texture: for Sample, Blur, Edges, the Texture tools (Mask, Levels, Flow…), Particles (Emit from) and the Agents family.' },
  },
  defaultParams: { videoId: '', fileName: '' },
  assignable: false,
  declarationsFor: (node: GraphNode) => [`uniform vec2 u_vid_${node.id}_px;`],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const tex = `u_vid_${id}`;
    const uvVar = inputVars.uv ?? 'g_uv';
    const alpha = !!bakedInfo(node)?.alpha;
    // Centred picture coordinates back to 0–1 over the frame (as Texture Input reads).
    const lines = [`    vec2 ${id}_st = clamp(${uvVar} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`];
    if (alpha) {
      // Colour fills the top half of the frame (v 0.5–1 with the video's flipY), alpha the bottom; half a texel in from the seam.
      lines.push(
        `    float ${id}_m = ${tex}_px.y * 0.5;\n`,
        `    vec3 ${id}_color = texture2D(${tex}, vec2(${id}_st.x, clamp(0.5 + ${id}_st.y * 0.5, 0.5 + ${id}_m, 1.0))).rgb;\n`,
        `    float ${id}_alpha = texture2D(${tex}, vec2(${id}_st.x, clamp(${id}_st.y * 0.5, 0.0, 0.5 - ${id}_m))).r;\n`,
      );
    } else {
      lines.push(
        `    vec4 ${id}_s = texture2D(${tex}, ${id}_st);\n`,
        `    vec3 ${id}_color = ${id}_s.rgb;\n`,
        `    float ${id}_alpha = 1.0;\n`,
      );
    }
    lines.push(
      `    vec4 ${id}_rgba = vec4(${id}_color, ${id}_alpha);\n`,
      `    float ${id}_value = dot(${id}_color, vec3(0.299, 0.587, 0.114));\n`,
    );
    return {
      code: lines.join(''),
      outputVars: { color: `${id}_color`, alpha: `${id}_alpha`, rgba: `${id}_rgba`, value: `${id}_value`, texture: tex },
    };
  },
};
