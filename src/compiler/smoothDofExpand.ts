/**
 * smoothDofExpand.ts — March Camera's Lens: Smooth (docs/march-camera.md,
 * nodes/definitions/lensDof.ts), opened before the passes are cut:
 *
 *   camera ─ro/rd─▶ march ─Distance─▶ CoC `<cam>__dofCoc` ─┐ (alpha)
 *   … ─▶ Output's colour ─────────────────────────────────┴▶ Pass `<cam>__dof`
 *   Pass ─Texture─▶ gather `<cam>__dofGather` ─▶ Output
 *
 * The camera is marked (`__dofSmooth`) so it shoots pinhole rays and hands
 * over its lens (Aperture × FOV, 1 / Focal Dist) for the CoC. Everything the
 * picture had is drawn once, into the Pass; the final program is the gather.
 *
 * Only a top-level camera with its Ray Dir wired straight into a march that
 * has a Distance output (March Loop Group, GI Lit March Group, …), and an
 * Output with its colour wired, is opened; anything else stays Grain (the
 * camera isn't marked, so it compiles as it always has). Graphs without a
 * Smooth camera come back unchanged (the same array).
 */
import type { GraphNode } from '../types/nodeGraph';
import { PassNode } from '../nodes/definitions/passes';
import { LENS_DOF_STAGE_TYPE } from '../nodes/definitions/lensDof';
import { getNodeDefinitionFor } from '../nodes/definitions';

export const dofPassId = (camId: string) => `${camId}__dof`;

interface DofPlan { cam: GraphNode; march: GraphNode; output: GraphNode }

// Smooth: pinhole rays blurred by depth. Soft grain: the grain rays, with a lighter blur of the same kind on top.
const isSmoothCamera = (n: GraphNode) => n.type === 'marchCamera' && !n.bypassed && (n.params.lens === 'smooth' || n.params.lens === 'soft');

/** The Smooth cameras that can be opened (at most one per graph: the one the Output sees). */
export function planSmoothDof(nodes: readonly GraphNode[]): DofPlan | null {
  if (!nodes.some(isSmoothCamera)) return null;
  const output = nodes.find(n => n.type === 'output');
  if (!output?.inputs.color?.connection) return null;
  for (const cam of nodes) {
    if (!isSmoothCamera(cam)) continue;
    const march = nodes.find(m => {
      const c = m.inputs.rd?.connection;
      if (!c || c.nodeId !== cam.id || c.outputKey !== 'rd' || m.bypassed) return false;
      return !!(m.outputs.dist ?? getNodeDefinitionFor(m)?.outputs.dist);
    });
    if (march) return { cam, march, output };
  }
  return null;
}

export const hasSmoothDof = (nodes: readonly GraphNode[]) => planSmoothDof(nodes) !== null;

export function expandSmoothDof(nodes: GraphNode[]): GraphNode[] {
  const plan = planSmoothDof(nodes);
  if (!plan) return nodes;
  const { cam, march, output } = plan;
  const cocId = `${cam.id}__dofCoc`, passId = dofPassId(cam.id), gatherId = `${cam.id}__dofGather`;
  const at = cam.position;
  const coc: GraphNode = {
    id: cocId, type: LENS_DOF_STAGE_TYPE, position: at, params: { __stage: 'coc' },
    inputs: {
      dist: { type: 'float', label: 'Distance', connection: { nodeId: march.id, outputKey: 'dist' } },
      k: { type: 'float', label: 'Aperture × FOV', connection: { nodeId: cam.id, outputKey: 'dofK' } },
      invF: { type: 'float', label: '1 / Focal Dist', connection: { nodeId: cam.id, outputKey: 'dofInvF' } },
    },
    outputs: { coc: { type: 'float', label: 'CoC' } },
  };
  const pass: GraphNode = {
    id: passId, type: 'pass', position: at,
    // Nearest: the gather reads each tap's own CoC, which a linear read would blend across an edge.
    params: { label: cam.params.lens === 'soft' ? 'Soft grain lens' : 'Smooth lens', scale: '1', format: 'half', filter: 'nearest', wrap: 'clamp', repeat: 1 },
    inputs: {
      color: { type: 'vec3', label: 'Color', connection: { ...output.inputs.color.connection! } },
      alpha: { type: 'float', label: 'Alpha', connection: { nodeId: cocId, outputKey: 'coc' } },
    },
    outputs: Object.fromEntries(Object.entries(PassNode.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }])),
  };
  const gather: GraphNode = {
    id: gatherId, type: LENS_DOF_STAGE_TYPE, position: at,
    params: { __stage: 'gather', dofSamples: cam.params.dofSamples, dofShape: cam.params.dofShape, dofMaxBlur: cam.params.dofMaxBlur },
    inputs: { texture: { type: 'texture', label: 'Texture', connection: { nodeId: passId, outputKey: 'texture' } } },
    outputs: { color: { type: 'vec3', label: 'Color' } },
  };
  const camOut: GraphNode = {
    ...cam, params: { ...cam.params, ...(cam.params.lens === 'soft' ? { __dofSoft: true } : { __dofSmooth: true }) },
    outputs: { ...cam.outputs, dofK: { type: 'float', label: 'Aperture × FOV' }, dofInvF: { type: 'float', label: '1 / Focal Dist' } },
  };
  const outOut: GraphNode = { ...output, inputs: { ...output.inputs, color: { ...output.inputs.color, connection: { nodeId: gatherId, outputKey: 'color' } } } };
  return [...nodes.map(n => (n.id === cam.id ? camOut : n.id === output.id ? outOut : n)), coc, pass, gather];
}
