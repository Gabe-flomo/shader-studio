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
import { compilePassGraph, hasPassNode } from './passGraph';
import { hasAgentsNode } from './agentGraph';
import { hasHiddenBlur } from './blurPasses';

const EMPTY_OUTPUT_VARS = new Map<string, Record<string, string>>();

export function compileGraph(graph: NodeGraph): CompilationResult {
  // Pass nodes (render to texture) and the Agents family (docs/agents-plan.md) cut the graph into
  // several programs. Only graphs that have one take this branch; everything below is the
  // single-program compile, unchanged.
  // A Smooth / Bloom-chain Blur or Glow (texture) adds hidden passes of its own (compiler/hiddenBlurs.ts).
  if (hasPassNode(graph.nodes) || hasAgentsNode(graph.nodes) || hasHiddenBlur(graph.nodes)) return compilePassGraph(graph);
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
