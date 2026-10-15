/**
 * opticalFlowExpand.ts — opens each top-level Optical Flow node (nodes/definitions/opticalFlow.ts) into two Passes
 * before the pass compile cuts the graph (compiler/passGraph.ts), as Feedback (texture) is (feedbackExpand.ts):
 *
 *   Sample (`<id>__ofsrc`, the wired texture) ──▶ Pass `<id>__ofluma` (this frame; its Previous is the last)
 *   Optical Flow step (`<id>__ofstep`) ──▶ Pass `<id>__ofpass` (the flow; its Previous is last frame's flow)
 *   Optical Flow read (the node's own id) ──▶ every wire out of the node
 *
 * Both Passes are at the node's Resolution, half float. The step and the read bind their sliders to the node's id
 * (`__bindAs`), so Strength, Smoothing, Min speed and View gain are uniform writes. Without a wired texture (or
 * bypassed) the node stays itself: no motion. Graphs without one come back as they are.
 */
import type { GraphNode, InputSocket } from '../types/nodeGraph';
import { PassNode } from '../nodes/definitions/passes';
import { OPTICAL_FLOW_READ_TYPE, OPTICAL_FLOW_STEP_TYPE, OPTICAL_FLOW_TYPE, ofScaleOf } from '../nodes/definitions/opticalFlow';

export const ofIds = (id: string) => ({ src: `${id}__ofsrc`, luma: `${id}__ofluma`, step: `${id}__ofstep`, pass: `${id}__ofpass` });

export const isOpticalFlow = (n: GraphNode): boolean => n.type === OPTICAL_FLOW_TYPE;
const opens = (n: GraphNode) => isOpticalFlow(n) && !n.bypassed && !!n.inputs.texture?.connection;

const passOutputs = (): GraphNode['outputs'] => Object.fromEntries(Object.entries(PassNode.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }]));
const wire = (nodeId: string, outputKey: string, type: InputSocket['type'], label: string): InputSocket => ({ type, label, connection: { nodeId, outputKey } });

export function expandOpticalFlow(nodes: GraphNode[]): { nodes: GraphNode[]; bindAs: Map<string, string> } {
  const bindAs = new Map<string, string>();
  if (!nodes.some(opens)) return { nodes, bindAs };
  const out: GraphNode[] = [];
  for (const n of nodes) {
    if (!opens(n)) { out.push(n); continue; }
    const I = ofIds(n.id), c = n.inputs.texture.connection!, scale = ofScaleOf(n);
    const passParams = (label: string) => ({ label, scale, format: 'half', filter: 'linear', wrap: 'clamp', repeat: 1 });
    const src: GraphNode = {
      id: I.src, type: 'sampleTexture', position: n.position, params: { offsetX: 0, offsetY: 0 },
      inputs: { texture: wire(c.nodeId, c.outputKey, 'texture', 'Texture') },
      outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
    };
    const luma: GraphNode = { id: I.luma, type: 'pass', position: n.position, outputs: passOutputs(), params: passParams('Flow source'), inputs: { color: wire(I.src, 'color', 'vec3', 'Color') } };
    const step: GraphNode = {
      id: I.step, type: OPTICAL_FLOW_STEP_TYPE, position: n.position, params: { ...n.params, __bindAs: n.id },
      inputs: { cur: wire(I.luma, 'texture', 'texture', 'This frame'), prev: wire(I.luma, 'previous', 'texture', 'Last frame'), flowPrev: wire(I.pass, 'previous', 'texture', 'Last flow') },
      outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
    };
    const pass: GraphNode = { id: I.pass, type: 'pass', position: n.position, outputs: passOutputs(), params: passParams('Optical flow'), inputs: { color: wire(I.step, 'color', 'vec3', 'Color') } };
    const uv = n.inputs.uv?.connection;
    const read: GraphNode = {
      id: n.id, type: OPTICAL_FLOW_READ_TYPE, position: n.position, params: { viewGain: n.params.viewGain, __bindAs: n.id },
      inputs: { state: wire(I.pass, 'texture', 'texture', 'Flow'), ...(uv ? { uv: wire(uv.nodeId, uv.outputKey, 'vec2', 'UV') } : {}) },
      outputs: { ...n.outputs },
    };
    bindAs.set(I.step, n.id);
    bindAs.set(n.id, n.id);
    out.push(src, luma, step, pass, read);
  }
  return { nodes: out, bindAs };
}
