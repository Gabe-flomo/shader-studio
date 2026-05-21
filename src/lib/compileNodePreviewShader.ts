/**
 * compileNodePreviewShader
 *
 * Builds a minimal preview graph for a specific node (it + all its ancestors),
 * compiles it, and returns the fragment shader string (or null on failure).
 */

import type { GraphNode } from '../types/nodeGraph';
import { compileGraph } from '../compiler/graphCompiler';

const SKIP_TYPES = new Set(['output', 'vec4Output', 'scope']);

// NeighborDist preview: displaced dots rendered with 3×3 min-distance loop,
// colored per-cell so the grid structure and displacement are both visible.
const NEIGHBOR_DIST_PREVIEW = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
varying vec2 vUv;
void main() {
  float cols = 7.0;
  float asp  = u_resolution.x / u_resolution.y;
  float cell = asp / cols;
  vec2 uv    = vUv * vec2(asp, 1.0);
  vec2 gp    = uv / cell;
  vec2 cid   = floor(gp);
  vec2 cuv   = fract(gp) - 0.5;
  vec2 h     = sin(cid * vec2(127.1, 311.7) + cid.yx * vec2(269.5, 183.3));
  vec2 disp  = (fract(h * 43758.5453) - 0.5) * 0.38;
  vec2 sh    = cuv - disp;
  float md   = 999.0;
  for (int dy = -1; dy <= 1; dy++)
    for (int dx = -1; dx <= 1; dx++)
      md = min(md, length(sh - vec2(float(dx), float(dy))));
  float r    = 0.32;
  float mask = 1.0 - smoothstep(r - 0.025, r + 0.025, md);
  float hue  = fract(dot(cid, vec2(0.618, 0.381)));
  vec3 col   = 0.5 + 0.5 * cos(6.28318 * (hue + vec3(0.0, 0.33, 0.67)));
  gl_FragColor = vec4(mix(vec3(0.08), col * 0.85 + 0.08, mask), 1.0);
}`.trim();

function buildGridPreviewShader(cols: number): string {
  return `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
varying vec2 vUv;
void main() {
  float c = ${cols.toFixed(1)};
  float asp = u_resolution.x / u_resolution.y;
  float rows = c / asp;
  vec2 g = vec2(vUv.x * c, vUv.y * rows);
  vec2 f = fract(g);
  float lw = 0.05;
  float onLine = 1.0 - step(lw, min(f.x, f.y));
  vec3 bg   = vec3(0.1);
  vec3 line = vec3(0.45, 0.65, 0.85);
  gl_FragColor = vec4(mix(bg, line, onLine), 1.0);
}`.trim();
}

export function compileNodePreviewShader(
  nodeId: string,
  nodes: GraphNode[],
): string | null {
  const targetNode = nodes.find(n => n.id === nodeId);
  if (!targetNode || SKIP_TYPES.has(targetNode.type)) return null;

  if (targetNode.type === 'gridLayout') {
    const cols = typeof targetNode.params.columns === 'number' ? targetNode.params.columns : 10;
    return buildGridPreviewShader(cols);
  }
  if (targetNode.type === 'neighborDist') return NEIGHBOR_DIST_PREVIEW;

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
