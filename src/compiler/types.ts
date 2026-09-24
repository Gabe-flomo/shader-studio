import type { NodeGraph } from '../types/nodeGraph';

export interface ParticleSystemData {
  /** ID of the pRender node that terminates this chain */
  nodeId: string;
  vertexShader: string;
  fragmentShader: string;
  /** Number of particles — baked from pInit.count */
  count: number;
  /** Shape index — baked from pInit.shape (0=Sphere, 1=Ball, 2=Box, 3=Disk, 4=Ring, 5=Spiral) */
  shape: number;
  /** Float param uniforms for this chain — merged into CompilationResult.paramUniforms */
  paramUniforms: Record<string, number | number[]>;
  /** `${nodeId}::${paramKey}` → uniform name — merged into CompilationResult.paramBindings */
  paramBindings: Record<string, string>;
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
   * Maps float uniform name (e.g. "u_audio_nodeId") → nodeId.
   * ShaderCanvas pushes amplitude values each animation frame for AudioInput nodes.
   */
  audioUniforms: Record<string, string>;
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
   * Maps nodeId → short GLSL slug (e.g. "node_49" → "cos_49").
   * Used by CodePanel to highlight the lines belonging to a selected node.
   * Absent on validation-failure results.
   */
  nodeSlugMap?: Map<string, string>;
  /** Maps marchLoopGroup nodeId → dynamic acc* output sockets added at compile time.
   *  Store uses this to patch node.outputs so sockets appear on the card. */
  mlgDynamicOutputs?: Map<string, Record<string, { type: string; label: string }>>;
  /** One entry per vParticles node in the graph — ShaderCanvas creates a THREE.Points for each. */
  particleSystems?: ParticleSystemData[];
}

export const VERTEX_SHADER = `varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}`.trim();

/** Opaque graph passed into the compiler. Same shape as NodeGraph. */
export type { NodeGraph };
