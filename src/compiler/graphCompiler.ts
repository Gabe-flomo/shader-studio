/**
 * graphCompiler.ts — orchestrator
 *
 * Coordinates the five compilation steps and re-exports CompilationResult so
 * consumers only need to import from this one file.
 *
 * Step order:
 *   1. Collect loop-internal node IDs (excluded from the main pass)
 *   2. Validate the graph (type checks, output-node existence)
 *   3. Topological sort the main-pass nodes
 *   4. Assemble the fragment shader (resolves vars, patches uniforms, emits GLSL)
 *   5. Return CompilationResult
 */

export type { CompilationResult } from './types';
export { VERTEX_SHADER } from './types';

import type { NodeGraph } from '../types/nodeGraph';
import type { CompilationResult } from './types';
import { VERTEX_SHADER } from './types';
import {
  collectLoopPairChains,
  collectLoopPairInternalIds,
  topologicalSort,
} from './topoSort';
import { validateGraph } from './validate';
import { generateFragmentShader } from './shaderAssembler';

const EMPTY_OUTPUT_VARS = new Map<string, Record<string, string>>();

export function compileGraph(graph: NodeGraph): CompilationResult {
  try {
    const { nodes } = graph;

    // 1. Determine which node IDs are loop-internal (excluded from main pass)
    const loopPairChains   = collectLoopPairChains(nodes);
    const allInternalIds   = collectLoopPairInternalIds(loopPairChains);

    // 2. Validate
    const validation = validateGraph(nodes, allInternalIds);
    if (!validation.valid) {
      return {
        vertexShader: '',
        fragmentShader: '',
        success: false,
        errors: validation.errors,
        nodeOutputVars: EMPTY_OUTPUT_VARS,
        paramUniforms: {},
        textureUniforms: {},
        audioUniforms: {},
        isStateful: false,
      };
    }

    // 3. Topological sort (main-pass nodes only)
    // Pass loopPairChains so loopStart is always ordered before its loopEnd.
    const sortedNodes = topologicalSort(nodes, allInternalIds, loopPairChains);

    // 4. Assemble fragment shader
    const { fragmentShader, nodeOutputVars, paramUniforms, textureUniforms, audioUniforms, isStateful, nodeSlugMap, mlgDynamicOutputs } =
      generateFragmentShader(sortedNodes, nodes, allInternalIds, loopPairChains);

    return {
      vertexShader: VERTEX_SHADER,
      fragmentShader,
      success: true,
      nodeOutputVars,
      paramUniforms,
      textureUniforms,
      audioUniforms,
      isStateful,
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
      textureUniforms: {},
      audioUniforms: {},
      isStateful: false,
    };
  }
}
