/**
 * graphCompiler.ts — orchestrator
 *
 * Coordinates the four compilation steps and re-exports CompilationResult so
 * consumers only need to import from this one file.
 *
 * Step order:
 *   1. Validate the graph (type checks, output-node existence)
 *   2. Topological sort
 *   3. Assemble the fragment shader (resolves vars, patches uniforms, emits GLSL)
 *   4. Return CompilationResult
 */

export type { CompilationResult } from './types';
export { VERTEX_SHADER } from './types';

import type { NodeGraph } from '../types/nodeGraph';
import type { CompilationResult } from './types';
import { VERTEX_SHADER } from './types';
import { topologicalSort } from './topoSort';
import { validateGraph } from './validate';
import { generateFragmentShader } from './shaderAssembler';

const EMPTY_OUTPUT_VARS = new Map<string, Record<string, string>>();

export function compileGraph(graph: NodeGraph): CompilationResult {
  try {
    const { nodes } = graph;

    // 1. Validate
    const validation = validateGraph(nodes);
    if (!validation.valid) {
      return {
        vertexShader: '',
        fragmentShader: '',
        success: false,
        errors: validation.errors,
        nodeOutputVars: EMPTY_OUTPUT_VARS,
        paramUniforms: {},
        paramBindings: {},
        textureUniforms: {},
        audioUniforms: {},
        liveUniforms: {},
        videoUniforms: {},
        isStateful: false,
      };
    }

    // 2. Topological sort
    const sortedNodes = topologicalSort(nodes);

    // 3. Assemble fragment shader
    const { fragmentShader, nodeOutputVars, paramUniforms, paramBindings, textureUniforms, audioUniforms, liveUniforms, videoUniforms, isStateful, echo, nodeSlugMap, mlgDynamicOutputs } =
      generateFragmentShader(sortedNodes, nodes);

    return {
      vertexShader: VERTEX_SHADER,
      fragmentShader,
      success: true,
      nodeOutputVars,
      paramUniforms,
      paramBindings,
      textureUniforms,
      audioUniforms,
      liveUniforms,
      videoUniforms,
      isStateful,
      echo,
      nodeSlugMap,
      mlgDynamicOutputs,
    };
  } catch (error) {
    return {
      vertexShader: '',
      fragmentShader: '',
      success: false,
      errors: [error instanceof Error ? error.message : 'Unknown compilation error'],
      nodeOutputVars: EMPTY_OUTPUT_VARS,
      paramUniforms: {},
      paramBindings: {},
      textureUniforms: {},
      audioUniforms: {},
      liveUniforms: {},
      videoUniforms: {},
      isStateful: false,
    };
  }
}
