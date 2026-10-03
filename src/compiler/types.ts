import type { NodeGraph } from '../types/nodeGraph';

/**
 * One Pass node's program (compiler/passGraph.ts): drawn into the Pass's own
 * texture before the final picture. Only graphs with a Pass node have these.
 */
export interface PassProgram {
  /** The Pass node's id. */
  nodeId: string;
  /** Its slug: its samplers are u_pass_<slug> and u_passprev_<slug>. */
  slug: string;
  /** Shown in timers and the card: the node's label or "Pass". */
  label: string;
  fragmentShader: string;
  /** Slugs of the passes this program samples this frame (drawn before it). */
  reads: string[];
  /** Slugs of the passes whose previous frame this program samples. */
  readsPrevious: string[];
  /** Size relative to the picture: 1, 0.5, 0.25 or 0.125. */
  scale: number;
  format: 'half' | 'byte';
  filter: 'linear' | 'nearest';
  wrap: 'clamp' | 'repeat' | 'mirror';
  /** Something samples this Pass's Previous output: it keeps a second (ping-pong) texture. */
  previous: boolean;
  /** The final picture needs it, directly or through other passes; a pass nothing reads isn't drawn. */
  live: boolean;
  /** The graph nodes compiled into this program (not counting upstream Pass nodes it samples). */
  nodeIds: string[];
}

export interface CompilationResult {
  vertexShader: string;
  fragmentShader: string;
  success: boolean;
  errors?: string[];
  /** Maps nodeId → { outputKey → glslVarName } — used by ShaderCanvas node-probe. */
  nodeOutputVars: Map<string, Record<string, string>>;
  /**
   * Maps uniform name (e.g. "u_p_nodeId_scale") → current value: a number for a
   * float slider, a [r, g, b] array for a vec3 / colour param. Slider and
   * colour-picker changes push new values here instead of triggering a recompile.
   */
  paramUniforms: Record<string, number | number[]>;
  /**
   * Maps `${nodeId}::${paramKey}` (the node's ORIGINAL id, the one the store
   * edits — not its slug) → the uniform name in `paramUniforms`. Absent from
   * this map means the param is baked into the GLSL and changing it needs a
   * recompile. This is the only place uniform names should be looked up from;
   * never rebuild them from the id.
   */
  paramBindings: Record<string, string>;
  /**
   * Maps sampler2D uniform name (e.g. "u_tex_nodeId") → nodeId.
   * ShaderCanvas uses this to bind THREE.Texture objects for TextureInput nodes.
   */
  textureUniforms: Record<string, string>;
  /**
   * Maps float uniform name (e.g. "u_audio_audio_5_0": `u_audio_<slug>_<band>`,
   * see audioUniformNames.ts) → nodeId. ShaderCanvas hands this to the audio
   * engine, which pushes one amplitude per band into these names each frame.
   */
  audioUniforms: Record<string, string>;
  /**
   * Maps float uniform name (e.g. "u_midi_<slug>_note") → `${nodeId}::${channel}`.
   * The input bus (lib/inputBus.ts) writes these every frame from JS-side
   * sources (MIDI now; audio, mouse, keyboard mappings later).
   */
  liveUniforms: Record<string, string>;
  /**
   * Maps sampler2D uniform name (e.g. "u_vid_nodeId") → nodeId.
   * ShaderCanvas uses this to bind THREE.VideoTexture objects for VideoInput nodes.
   */
  videoUniforms: Record<string, string>;
  /**
   * True when any PrevFrame node exists in the graph — ShaderCanvas enables
   * ping-pong render targets when this is set.
   */
  isStateful: boolean;
  /**
   * Echo nodes: how many snapshot frames the preview must keep (`copies`) and
   * how many frames apart they are captured (`delay`). Null when none.
   */
  echo?: { copies: number; delay: number } | null;
  /**
   * Maps nodeId → short GLSL slug (e.g. "node_49" → "cos_49").
   * Used by CodePanel to highlight the lines belonging to a selected node.
   * Absent on validation-failure results.
   */
  nodeSlugMap?: Map<string, string>;
  /** Maps marchLoopGroup nodeId → dynamic acc* output sockets added at compile time.
   *  Store uses this to patch node.outputs so sockets appear on the card. */
  mlgDynamicOutputs?: Map<string, Record<string, { type: string; label: string }>>;
  /**
   * Pass nodes' programs, in drawing order (compiler/passGraph.ts). Present
   * only when the graph has a Pass node; `fragmentShader` is then the final
   * picture's program, which samples them.
   */
  passes?: PassProgram[];
}

export const VERTEX_SHADER = `varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}`.trim();

/** Opaque graph passed into the compiler. Same shape as NodeGraph. */
export type { NodeGraph };
