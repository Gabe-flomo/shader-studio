/**
 * compileNodePreviewShader
 *
 * Builds a minimal preview graph for a specific node (it + all its ancestors),
 * compiles it, and returns the fragment shader string (or null on failure).
 */

import type { GraphNode } from '../types/nodeGraph';
import { compileGraph } from '../compiler/graphCompiler';

const SKIP_TYPES = new Set(['output', 'vec4Output', 'loopStart', 'loopEnd', 'scope']);

export function compileNodePreviewShader(
  nodeId: string,
  nodes: GraphNode[],
): string | null {
  const targetNode = nodes.find(n => n.id === nodeId);
  if (!targetNode || SKIP_TYPES.has(targetNode.type)) return null;

  // BFS: collect all transitive dependencies of targetNode
  const included = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (included.has(id)) continue;
    included.add(id);
    const node = nodes.find(n => n.id === id);
    if (!node) continue;
    for (const input of Object.values(node.inputs)) {
      if (input.connection) queue.push(input.connection.nodeId);
    }
  }

  const subgraph = nodes.filter(n => included.has(n.id));

  // Pick the best output to preview — prefer vec3, then vec4, then vec2, then float
  const outputEntries = Object.entries(targetNode.outputs);
  const vec3Entry  = outputEntries.find(([, s]) => s.type === 'vec3');
  const vec4Entry  = outputEntries.find(([, s]) => s.type === 'vec4');
  const vec2Entry  = outputEntries.find(([, s]) => s.type === 'vec2');
  const floatEntry = outputEntries.find(([, s]) => s.type === 'float');
  const chosen = vec3Entry ?? vec4Entry ?? vec2Entry ?? floatEntry;
  if (!chosen) return null; // mat2/mat3/scene3d etc. — no meaningful pixel preview

  const [chosenKey, chosenSocket] = chosen;
  const outType = chosenSocket.type;

  const extraNodes: GraphNode[] = [];
  let outputSourceNodeId = nodeId;
  let outputSourceKey    = chosenKey;

  if (outType === 'float') {
    extraNodes.push({
      id: '__preview_f2v3__',
      type: 'floatToVec3',
      position: { x: 0, y: 0 },
      params: {},
      inputs: { input: { type: 'float', label: 'Float', connection: { nodeId, outputKey: chosenKey } } },
      outputs: { rgb: { type: 'vec3', label: 'RGB' } },
    });
    outputSourceNodeId = '__preview_f2v3__';
    outputSourceKey    = 'rgb';
  } else if (outType === 'vec2') {
    // Show vec2 as (R=x, G=y, B=0)
    extraNodes.push(
      { id: '__preview_extX__', type: 'extractX', position: { x:0,y:0 }, params: {},
        inputs: { v: { type: 'vec2', label: 'Vec2', connection: { nodeId, outputKey: chosenKey } } },
        outputs: { x: { type: 'float', label: 'X' } } },
      { id: '__preview_extY__', type: 'extractY', position: { x:0,y:0 }, params: {},
        inputs: { v: { type: 'vec2', label: 'Vec2', connection: { nodeId, outputKey: chosenKey } } },
        outputs: { y: { type: 'float', label: 'Y' } } },
      { id: '__preview_mkV3__', type: 'makeVec3', position: { x:0,y:0 }, params: {},
        inputs: {
          r: { type: 'float', label: 'R', connection: { nodeId: '__preview_extX__', outputKey: 'x' } },
          g: { type: 'float', label: 'G', connection: { nodeId: '__preview_extY__', outputKey: 'y' } },
          b: { type: 'float', label: 'B' },
        },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } } },
    );
    outputSourceNodeId = '__preview_mkV3__';
    outputSourceKey    = 'rgb';
  }

  const isVec4 = outType === 'vec4';
  const syntheticOutput: GraphNode = {
    id: '__preview_output__',
    type: isVec4 ? 'vec4Output' : 'output',
    position: { x: 0, y: 0 },
    params: {},
    inputs: {
      color: {
        type: isVec4 ? 'vec4' : 'vec3',
        label: 'Color',
        connection: { nodeId: outputSourceNodeId, outputKey: outputSourceKey },
      },
    },
    outputs: {},
  };

  const result = compileGraph({ nodes: [...subgraph, ...extraNodes, syntheticOutput] });
  return result.success ? result.fragmentShader : null;
}
