import type { NodeGraph } from '../types/nodeGraph';

export interface CompilationResult {
  vertexShader: string;
  fragmentShader: string;
  success: boolean;
  errors?: string[];
  /** Maps nodeId → { outputKey → glslVarName } — used by ShaderCanvas node-probe. */
  nodeOutputVars: Map<string, Record<string, string>>;
  /**
   * Maps uniform name (e.g. "u_p_nodeId_scale") → current numeric value.
   * Slider changes push new values here instead of triggering a recompile.
   */
  paramUniforms: Record<string, number>;
  /**
   * Maps sampler2D uniform name (e.g. "u_tex_nodeId") → nodeId.
   * ShaderCanvas uses this to bind THREE.Texture objects for TextureInput nodes.
   */
  textureUniforms: Record<string, string>;
  /**
   * True when any PrevFrame node exists in the graph — ShaderCanvas enables
   * ping-pong render targets when this is set.
   */
  isStateful: boolean;
}

export const VERTEX_SHADER = `varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}`.trim();

/** Opaque graph passed into the compiler. Same shape as NodeGraph. */
export type { NodeGraph };
