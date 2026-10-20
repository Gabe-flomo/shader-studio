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
import { findLoop, loopMessage } from './graphLoops';
import { validateGraph } from './validate';
import { generateFragmentShader } from './shaderAssembler';
import { compilePassGraph, hasPassNode } from './passGraph';
import { hasAgentsNode } from './agentGraph';
import { hasHiddenBlur } from './blurPasses';
import { hasSmoothDof } from './smoothDofExpand';
import { compileSplatProbes, hasSplatScene, pictureGraphOf } from './splatGraph';
import { resolveSendReceive } from './sendReceive';
import { syncSimpleExprTypes } from './simpleExprSync';

const EMPTY_OUTPUT_VARS = new Map<string, Record<string, string>>();

export function compileGraph(input: NodeGraph): CompilationResult {
  // Send / Receive (docs/send-receive.md): each Receive becomes a real wire to its Send, through group
  // ports added for this compile, before anything else looks at the graph.
  // Simple Expressions' inputs take the types of the wires into them (simpleExprSync.ts).
  const sr = resolveSendReceive(syncSimpleExprTypes(input.nodes));
  if (sr.errors.length) {
    return {
      vertexShader: '', fragmentShader: '', success: false, errors: sr.errors,
      nodeOutputVars: EMPTY_OUTPUT_VARS, paramUniforms: {}, paramBindings: {}, textureUniforms: {},
      audioUniforms: {}, liveUniforms: {}, videoUniforms: {}, isStateful: false,
    };
  }
  const graph: NodeGraph = sr.nodes === input.nodes ? input : { ...input, nodes: sr.nodes };
  // A Splat Scene's Modifier chain runs in a program of its own (docs/splat-scene.md "Per-splat modifiers"): the
  // picture compiles without it.
  const result = compileProgram(pictureGraphOf(graph));
  // Splat Scene nodes (docs/splat-scene.md): each gets a probe program for its camera, named as the picture's.
  if (!result.success || !hasSplatScene(graph.nodes)) return result;
  const { programs, errors, tables } = compileSplatProbes(graph, result.nodeSlugMap);
  if (errors.length) return { ...result, success: false, errors: [...(result.errors ?? []), ...errors] };
  // The Modifier chains' sliders join the picture's uniform table, so a drag, Play and keyframes reach them.
  return {
    ...result, splats: programs,
    paramUniforms: { ...result.paramUniforms, ...tables.paramUniforms },
    paramBindings: { ...result.paramBindings, ...tables.paramBindings },
    textureUniforms: { ...result.textureUniforms, ...tables.textureUniforms },
    videoUniforms: { ...result.videoUniforms, ...tables.videoUniforms },
    audioUniforms: { ...result.audioUniforms, ...tables.audioUniforms },
    liveUniforms: { ...result.liveUniforms, ...tables.liveUniforms },
  };
}

function compileProgram(graph: NodeGraph): CompilationResult {
  // Pass nodes (render to texture) and the Agents family (docs/agents-plan.md) cut the graph into
  // several programs. Only graphs that have one take this branch; everything below is the
  // single-program compile, unchanged.
  // A Smooth / Bloom-chain Blur or Glow (texture) adds hidden passes of its own (compiler/hiddenBlurs.ts).
  // A March Camera with Lens: Smooth adds a hidden Pass of its own (compiler/smoothDofExpand.ts).
  if (hasPassNode(graph.nodes) || hasAgentsNode(graph.nodes) || hasHiddenBlur(graph.nodes) || hasSmoothDof(graph.nodes)) return compilePassGraph(graph);
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

    // 2. Topological sort (a loop is named, with its nodes, for the error's fix buttons)
    const loop = findLoop(nodes);
    if (loop) {
      return {
        vertexShader: '', fragmentShader: '', success: false, errors: [loopMessage(nodes, loop)], loop,
        nodeOutputVars: EMPTY_OUTPUT_VARS, paramUniforms: {}, paramBindings: {}, textureUniforms: {},
        audioUniforms: {}, liveUniforms: {}, videoUniforms: {}, isStateful: false,
      };
    }
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
