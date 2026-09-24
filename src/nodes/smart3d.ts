/**
 * smart3d.ts — where a 3D node belongs when it's added at the top level.
 *
 * Shader Studio's 3D pipeline has a fixed shape: SDF nodes live *inside* a
 * Scene Group (Scene Pos → shapes → Scene Output), a March Camera feeds a
 * March Loop Group that ray-marches the scene, and lighting nodes read the
 * loop's outputs (hit position, normal, hit mask…). A Sphere dropped on the
 * top-level canvas does nothing on its own, so this module decides what to
 * do instead:
 *
 *   - scene-space nodes (primitives, 3D transforms, boolean ops, 3D fractals)
 *     are wrapped in a new Scene Group, wired from Scene Pos and, when they
 *     produce a distance, into Scene Output; the group is wired into an
 *     existing march loop with a free Scene input, or a camera + loop is
 *     spawned and the loop's colour goes to the graph's Output if it's free;
 *   - lighting nodes are wired to the nearest march loop's outputs by socket
 *     name (pos, normal, hit, dist, depth) and, when they take a scene, to the
 *     scene feeding that loop.
 *
 * Pure: the store turns a plan into nodes.
 */

import type { GraphNode, NodeDefinition } from '../types/nodeGraph';

export const SCENE_SPACE_CATEGORIES = new Set(['3D Primitives', '3D Transforms', '3D Boolean Ops', '3D Fractals']);
export const LIGHTING_CATEGORY = '3D Lighting';
export const MARCH_GROUP_TYPES = new Set(['marchLoopGroup', 'giLitMarchGroup']);

export type Smart3DPlan =
  | {
      kind: 'wrap-scene';
      /** Wire Scene Pos into this input of the new node (its position input), if any. */
      posInput: string | null;
      /** Wire this output of the new node into Scene Output, if it produces a distance. */
      distOutput: string | null;
      /** An existing march loop whose Scene input is free, to receive the new group. */
      attachToMarchId: string | null;
      /** No loop to attach to: spawn a camera + loop, and wire its colour to this Output node if free. */
      spawnMarch: boolean;
      outputNodeId: string | null;
    }
  | {
      kind: 'wire-lighting';
      marchId: string;
      /** newNodeInput → march output key */
      wires: Array<{ input: string; fromKey: string }>;
      /** The scene group feeding that loop, for a `scene` input. */
      sceneSourceId: string | null;
      /** A March Camera, for `viewDir` / `rd` inputs. */
      cameraId: string | null;
    }
  | { kind: 'none' };

function nearest(nodes: GraphNode[], to: { x: number; y: number }): GraphNode | null {
  let best: GraphNode | null = null; let bestD = Infinity;
  for (const n of nodes) {
    const d = (n.position.x - to.x) ** 2 + (n.position.y - to.y) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

export function planSmart3DAdd(type: string, def: NodeDefinition, topLevel: GraphNode[], position: { x: number; y: number }): Smart3DPlan {
  if (MARCH_GROUP_TYPES.has(type) || type === 'sceneGroup' || type === 'spaceWarpGroup') return { kind: 'none' };

  if (SCENE_SPACE_CATEGORIES.has(def.category)) {
    const posInput = def.inputs.pos ? 'pos' : def.inputs.p ? 'p' : null;
    const distOutput = def.outputs.dist?.type === 'float' ? 'dist' : null;
    const loops = topLevel.filter(n => MARCH_GROUP_TYPES.has(n.type));
    const free = loops.filter(n => !n.inputs.scene?.connection);
    const attach = nearest(free, position);
    const output = topLevel.find(n => (n.type === 'output' || n.type === 'vec4Output') && !n.inputs.color?.connection) ?? null;
    return {
      kind: 'wrap-scene',
      posInput,
      distOutput,
      attachToMarchId: attach?.id ?? null,
      spawnMarch: loops.length === 0,
      outputNodeId: loops.length === 0 ? (output?.id ?? null) : null,
    };
  }

  if (def.category === LIGHTING_CATEGORY) {
    const march = nearest(topLevel.filter(n => MARCH_GROUP_TYPES.has(n.type)), position);
    if (!march) return { kind: 'none' };
    const wires: Array<{ input: string; fromKey: string }> = [];
    for (const key of Object.keys(def.inputs)) {
      if (key === 'scene' || key === 'viewDir' || key === 'rd') continue;
      // Same-named loop output (pos, normal, hit, dist, depth, iter)
      if (march.outputs[key] && march.outputs[key].type === def.inputs[key].type) wires.push({ input: key, fromKey: key });
      else if (key === 'hitPos' && march.outputs.pos) wires.push({ input: key, fromKey: 'pos' });
    }
    const sceneSourceId = march.inputs.scene?.connection?.nodeId ?? null;
    const camera = nearest(topLevel.filter(n => n.type === 'marchCamera'), march.position);
    return { kind: 'wire-lighting', marchId: march.id, wires, sceneSourceId, cameraId: camera?.id ?? null };
  }

  return { kind: 'none' };
}
