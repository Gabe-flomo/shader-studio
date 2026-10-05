/**
 * What adding a Time Cube View or a Time Slice on the top level wires up
 * (docs/time-cube.md), the way a 3D node added on its own gets a scene round
 * it (nodes/smart3d.ts):
 *
 * - its Volume comes from the nearest Time Cube, or a new one (the test clip)
 *   to its left;
 * - a Time Cube View in a graph that already ray-marches a scene joins it:
 *   the March Camera's rays, the loop's Color behind the box and the loop's
 *   Distance in front, its Zoom matched to the camera's FOV; the Output then
 *   shows the view (it shows the scene through it);
 * - otherwise the Output shows it only when nothing was wired into it.
 *
 * Pure: ids come from the caller; the store pushes the undo step.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { graphOutput, instantiateNode } from '../../nodes/scene3dDefaults';
import { MARCH_GROUP_TYPES } from '../../nodes/smart3d';

export const TIME_CUBE_AUTO_TYPES = new Set(['timeCubeView', 'timeSlice']);

const near = (nodes: GraphNode[], at: { x: number; y: number }) =>
  nodes.reduce<GraphNode | null>((best, n) => (!best || (n.position.x - at.x) ** 2 + (n.position.y - at.y) ** 2 < (best.position.x - at.x) ** 2 + (best.position.y - at.y) ** 2 ? n : best), null);

const wire = (n: GraphNode, key: string, from: string, outputKey: string): GraphNode =>
  n.inputs[key] ? { ...n, inputs: { ...n.inputs, [key]: { ...n.inputs[key], connection: { nodeId: from, outputKey } } } } : n;

export interface TimeCubeAddPlan {
  nodes: GraphNode[];
  /** The node that was asked for. */
  id: string;
  message: string;
}

export function planTimeCubeAdd(type: string, nodes: GraphNode[], position: { x: number; y: number }, nextId: () => string): TimeCubeAddPlan | null {
  if (!TIME_CUBE_AUTO_TYPES.has(type)) return null;
  const def = getNodeDefinition(type), srcDef = getNodeDefinition('timeCube');
  if (!def || !srcDef) return null;
  const said: string[] = [];
  let out = [...nodes];
  let source = near(nodes.filter(n => n.type === 'timeCube'), position);
  if (!source) {
    source = instantiateNode(nextId(), 'timeCube', srcDef, { x: position.x - 440, y: position.y }, {
      __comment: 'Time Cube: stacks a video\'s frames into a box of time. It starts with the built-in test clip; press Choose video to use yours.',
    });
    out.push(source);
    said.push('a Time Cube (the test clip; Choose video on it for yours) feeds it');
  } else said.push(`it reads ${typeof source.params.label === 'string' && source.params.label ? source.params.label : 'the Time Cube'}`);
  let node = wire(instantiateNode(nextId(), type, def, position), 'volume', source.id, 'volume');

  const output = graphOutput(out);
  const fed = output?.inputs.color?.connection ?? null;
  let toOutput = !!output && !fed;
  if (type === 'timeCubeView') {
    const loop = near(out.filter(n => MARCH_GROUP_TYPES.has(n.type)), position);
    const camId = loop?.inputs.ro?.connection?.nodeId ?? loop?.inputs.rd?.connection?.nodeId;
    const cam = camId ? out.find(n => n.id === camId && n.type === 'marchCamera') : undefined;
    if (loop && cam) {
      node = wire(wire(wire(wire(node, 'ro', cam.id, 'ro'), 'rd', cam.id, 'rd'), 'background', loop.id, 'color'), 'sceneDist', loop.id, 'dist');
      if (typeof cam.params.fov === 'number') node = { ...node, params: { ...node.params, fov: cam.params.fov } };
      said.push('it sits in the 3D scene: the March Camera\'s rays, the loop\'s picture behind it and its Distance in front');
      // The Output showed the scene: now it shows the scene with the box in it.
      if (output && (!fed || fed.nodeId === loop.id)) toOutput = true;
    }
  }
  out.push(node);
  if (output && toOutput) {
    out = out.map(n => (n.id === output.id ? wire(n, 'color', node.id, 'color') : n));
    said.push('the Output shows it');
  }
  return { nodes: out, id: node.id, message: `${def.label} added: ${said.join('; ')}.` };
}
