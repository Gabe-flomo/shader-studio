/**
 * scene3dDefaults.ts — what a new 3D group contains the moment it exists.
 *
 * A Scene Group always has its two required parts, Scene Pos (the point being
 * measured) and Scene Output (the distance the scene returns), and a fresh one
 * comes with a Sphere between them so it renders something straight away, the
 * way a new 2D graph starts with a glowing circle. A March Loop / GI Lit March
 * Loop body starts with its Group Inputs and Group Output, position passed
 * straight through.
 *
 * Pure: ids come from the caller, so the store's id generator stays in charge.
 */

import type { GraphNode, InputSocket, NodeDefinition, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinition } from './definitions';

/** A fresh node from its definition, the way addNode/spawnGraph build one. */
export function instantiateNode(id: string, type: string, def: NodeDefinition, position: { x: number; y: number }, params?: Record<string, unknown>): GraphNode {
  const inputs: Record<string, InputSocket> = {};
  for (const [key, socket] of Object.entries(def.inputs)) {
    inputs[key] = { ...socket, defaultValue: def.paramDefs?.[key] ? undefined : def.defaultParams?.[key] as number | number[] | undefined };
  }
  return { id, type, position, inputs, outputs: { ...def.outputs }, params: { ...(def.defaultParams ?? {}), ...(params ?? {}) } };
}

function fresh(nextId: () => string, type: string, position: { x: number; y: number }, params?: Record<string, unknown>): GraphNode {
  return instantiateNode(nextId(), type, getNodeDefinition(type)!, position, params);
}

const connect = (node: GraphNode, key: string, from: GraphNode, outputKey: string): void => {
  if (node.inputs[key]) node.inputs[key] = { ...node.inputs[key], connection: { nodeId: from.id, outputKey } };
};

/**
 * Scene Pos → inner → Scene Output. `inner` defaults to a Sphere; `posInput`
 * and `distOutput` say how it is wired (a 3D transform has no distance, so
 * Scene Output is left for the user to wire).
 */
export function buildSceneSubgraph(
  nextId: () => string,
  inner?: { node: GraphNode; posInput: string | null; distOutput: string | null },
): SubgraphData {
  const scenePos = fresh(nextId, 'scenePos', { x: 0, y: 200 }, { _groupOriginal: true });
  const shape = inner ?? { node: fresh(nextId, 'sphereSDF3D', { x: 440, y: 200 }), posInput: 'pos', distOutput: 'dist' };
  shape.node.position = { x: 440, y: 200 };
  const sceneOut = fresh(nextId, 'sceneOutput', { x: 880, y: 200 }, { _groupOriginal: true });
  if (shape.posInput) connect(shape.node, shape.posInput, scenePos, 'pos');
  if (shape.distOutput) connect(sceneOut, 'dist', shape.node, shape.distOutput);
  return { nodes: [scenePos, shape.node, sceneOut], inputPorts: [], outputPorts: [] };
}

/** Group Inputs → Group Output for a march loop body: the ray position, unwarped. */
export function buildMarchSubgraph(nextId: () => string): SubgraphData {
  const inputs = fresh(nextId, 'marchLoopInputs', { x: 0, y: 180 }, { _groupOriginal: true });
  const output = fresh(nextId, 'marchLoopOutput', { x: 440, y: 180 }, { _groupOriginal: true });
  connect(output, 'pos', inputs, 'marchPos');
  return { nodes: [inputs, output], inputPorts: [], outputPorts: [] };
}

export type MarchLoopType = 'marchLoopGroup' | 'giLitMarchGroup';

/**
 * A working 3D scene: March Camera → Scene Group (Sphere) → march loop, laid
 * out left to right from `origin`. The caller adds the nodes and, when the
 * graph's Output is free, wires the loop's Color into it.
 */
export function buildMarchRig(
  nextId: () => string,
  loopType: MarchLoopType,
  at: { camera: { x: number; y: number }; scene: { x: number; y: number }; loop: { x: number; y: number } },
  scene?: GraphNode,
): { camera: GraphNode; scene: GraphNode; loop: GraphNode } {
  const camera = fresh(nextId, 'marchCamera', at.camera);
  const sceneGroup = scene ?? fresh(nextId, 'sceneGroup', at.scene, { subgraph: buildSceneSubgraph(nextId) });
  const loop = fresh(nextId, loopType, at.loop, { subgraph: buildMarchSubgraph(nextId) });
  connect(loop, 'ro', camera, 'ro');
  connect(loop, 'rd', camera, 'rd');
  connect(loop, 'scene', sceneGroup, 'scene');
  return { camera, scene: sceneGroup, loop };
}

/** The graph's Output node when its colour input is still free. */
export function freeOutput(nodes: GraphNode[]): GraphNode | null {
  return nodes.find(n => (n.type === 'output' || n.type === 'vec4Output') && !n.inputs.color?.connection) ?? null;
}

/**
 * The Volumetric Scene starter: a glowing see-through sphere. The loop runs in
 * volumetric mode (no surface hit, the ray walks through); its body measures
 * the scene at each step (Scene Distance) and adds a little light
 * (Volume Glow, +=), which comes out of the loop as Glow; Glow to Color
 * turns the total into a colour. Same values as the Volume Glow example.
 */
export function buildVolumetricRig(nextId: () => string, origin: { x: number; y: number }): {
  camera: GraphNode; scene: GraphNode; loop: GraphNode; colour: GraphNode;
} {
  const scene = fresh(nextId, 'sceneGroup', { x: origin.x - 440, y: origin.y + 360 }, { subgraph: buildSceneSubgraph(nextId) });
  const sphere = (scene.params.subgraph as SubgraphData).nodes.find(n => n.type === 'sphereSDF3D')!;
  sphere.params = { ...sphere.params, radius: 0.7 };

  const inputs = fresh(nextId, 'marchLoopInputs', { x: 0, y: 180 }, { _groupOriginal: true });
  const sceneDist = fresh(nextId, 'marchSceneDist', { x: 440, y: 180 });
  const glow: GraphNode = { ...fresh(nextId, 'volumeGlow', { x: 880, y: 180 }, { density: 0.03, falloff: 10, shell: 0.15 }), assignOp: '+=' };
  const output = fresh(nextId, 'marchLoopOutput', { x: 440, y: 520 }, { _groupOriginal: true });
  connect(sceneDist, 'pos', inputs, 'marchPos');
  connect(glow, 'dist', sceneDist, 'rawDist');
  connect(output, 'pos', inputs, 'marchPos');

  const rig = buildMarchRig(nextId, 'marchLoopGroup', {
    camera: { x: origin.x - 440, y: origin.y }, scene: scene.position, loop: origin,
  }, scene);
  const camera = { ...rig.camera, params: { ...rig.camera.params, camDist: 3.2, camAngle: 0.5, camElevation: 0.25, rotSpeed: 0.15 } };
  const loop: GraphNode = {
    ...rig.loop,
    // The accumulated glow leaves the loop as acc0; declared now so it can be wired straight away.
    outputs: { ...rig.loop.outputs, acc0: { type: 'float', label: 'Glow' } },
    params: {
      ...rig.loop.params, volumetric: true, maxSteps: 96, maxDist: 8,
      subgraph: { nodes: [inputs, sceneDist, glow, output], inputPorts: [], outputPorts: [] },
    },
  };
  const colour = fresh(nextId, 'glowToColor', { x: origin.x + 440, y: origin.y }, { exposure: 1.2, tint: [0.3, 0.8, 1.0] });
  connect(colour, 'glow', loop, 'acc0');
  return { camera, scene: rig.scene, loop, colour };
}
