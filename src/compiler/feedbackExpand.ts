/**
 * feedbackExpand.ts — opens each Feedback (texture) node (nodes/definitions/textureFeedback.ts) into
 * the Pass machinery before the pass compile cuts the graph (compiler/passGraph.ts), as a Curve Trace
 * beam (curveBeamExpand.ts) and a Shader Texture (shaderTextureExpand.ts) are:
 *
 *   textureFeedbackStep (`<id>__fbstep`) ──▶ Pass (the node's own id) ──▶ every wire out of the node
 *        ▲ reads the Pass's Previous
 *
 *  - the Pass keeps the node's id, so every wire out of the node (Texture, Color, Alpha) reads it,
 *    and the Pass card thumbnail registry (keyed by node id) draws the card's preview. Its settings
 *    come from the node (Resolution, Edges), half float, linear. Its slug comes from its label, so
 *    each Feedback node is a Pass of its own: several keep several buffers;
 *  - the step is the Pass's whole program. It gets the node's params and every wire into the node
 *    (Texture, UV, Flow, Fresh, wired sliders), compiles under the node's slug and binds its sliders
 *    to the node's id (`__bindAs`), so a slider or a Play control is a uniform write.
 *
 * A loop through the node is a frame delay (compiler/graphLoops.ts, isFrameDelayWire): when what
 * feeds the node reads the node itself (its trail blurred and fed back in), those reads take the
 * buffer as it was a frame ago: Texture becomes the Pass's Previous, and Color / Alpha a read of it
 * (`<id>__fbprev`).
 *
 * Graphs without a Feedback node come back as they are (the same array).
 */
import type { GraphNode } from '../types/nodeGraph';
import { PassNode } from '../nodes/definitions/passes';
import { FEEDBACK_STEP_TYPE, FEEDBACK_TYPE, feedbackPassParams } from '../nodes/definitions/textureFeedback';

type Wire = { nodeId: string; outputKey: string };

export const feedbackStepId = (id: string) => `${id}__fbstep`;
export const feedbackPrevId = (id: string) => `${id}__fbprev`;

export const isFeedbackNode = (n: GraphNode): boolean => n.type === FEEDBACK_TYPE;

const passOutputs = (): GraphNode['outputs'] => Object.fromEntries(Object.entries(PassNode.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }]));
const wire = (nodeId: string, outputKey: string, type: GraphNode['inputs'][string]['type'], label: string) => ({ type, label, connection: { nodeId, outputKey } });

/** A wire that already carries the frame before: a Pass's Previous (or Step / Steps), or a Feedback's buffer a frame ago. */
function delayed(c: Wire, byId: Map<string, GraphNode>): boolean {
  const src = byId.get(c.nodeId);
  if (!src) return true;
  if ((src.type === 'pass' || src.type === FEEDBACK_TYPE) && (c.outputKey === 'previous' || c.outputKey === 'step' || c.outputKey === 'steps')) return true;
  return false;
}

/**
 * Rewire the reads of `fb` that feed `fb` itself (within one frame) to the buffer a frame ago.
 * Returns the new list, and whether a Previous reader was needed.
 */
function delayLoops(nodes: GraphNode[], fb: GraphNode): { nodes: GraphNode[]; needsPrevReader: boolean } {
  const byId = new Map(nodes.map(n => [n.id, n]));
  // Everything upstream of the node's inputs (stopping at the node itself and at wires already a frame ago).
  const up = new Set<string>();
  const stack: Wire[] = Object.values(fb.inputs).flatMap(i => (i.connection ? [i.connection] : []));
  let loops = false;
  while (stack.length) {
    const c = stack.pop()!;
    if (c.nodeId === fb.id) { loops = true; continue; }
    if (delayed(c, byId) || up.has(c.nodeId)) continue;
    up.add(c.nodeId);
    for (const i of Object.values(byId.get(c.nodeId)?.inputs ?? {})) if (i.connection) stack.push(i.connection);
  }
  if (!loops) return { nodes, needsPrevReader: false };
  let needsPrevReader = false;
  const retarget = (n: GraphNode): GraphNode => {
    let changed = false;
    const inputs: GraphNode['inputs'] = {};
    for (const [k, inp] of Object.entries(n.inputs)) {
      const c = inp.connection;
      if (!c || c.nodeId !== fb.id || c.outputKey === 'previous') { inputs[k] = inp; continue; }
      changed = true;
      if (c.outputKey === 'texture') inputs[k] = { ...inp, connection: { nodeId: fb.id, outputKey: 'previous' } };
      else { needsPrevReader = true; inputs[k] = { ...inp, connection: { nodeId: feedbackPrevId(fb.id), outputKey: c.outputKey === 'alpha' ? 'alpha' : 'color' } }; }
    }
    return changed ? { ...n, inputs } : n;
  };
  return { nodes: nodes.map(n => (n.id === fb.id || up.has(n.id) ? retarget(n) : n)), needsPrevReader };
}

export function hasFeedbackNode(nodes: GraphNode[]): boolean {
  return nodes.some(n => isFeedbackNode(n) && !n.bypassed);
}

/** Open every top-level Feedback node into its step and Pass. */
export function expandFeedback(nodes: GraphNode[]): { nodes: GraphNode[]; bindAs: Map<string, string> } {
  const bindAs = new Map<string, string>();
  if (!hasFeedbackNode(nodes)) return { nodes, bindAs };
  // First every loop through a Feedback node is turned into a read of the frame before…
  let list = nodes;
  const prevReaders: GraphNode[] = [];
  for (const fb of nodes.filter(n => isFeedbackNode(n) && !n.bypassed)) {
    const cur = list.find(n => n.id === fb.id)!;
    const r = delayLoops(list, cur);
    list = r.nodes;
    if (r.needsPrevReader) {
      prevReaders.push({
        id: feedbackPrevId(fb.id), type: 'sampleTexture', position: fb.position,
        params: { offsetX: 0, offsetY: 0 },
        outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
        inputs: { texture: wire(fb.id, 'previous', 'texture', 'Texture') },
      });
    }
  }
  // …then each node becomes its step and its Pass.
  const out: GraphNode[] = [];
  for (const n of list) {
    // A bypassed Feedback stays itself: it compiles as the picture coming in, with no trail.
    if (!isFeedbackNode(n) || n.bypassed) { out.push(n); continue; }
    const wired = Object.fromEntries(Object.entries(n.inputs).filter(([, i]) => i.connection).map(([k, i]) => [k, { ...i, connection: { ...i.connection! } }]));
    const step: GraphNode = {
      id: feedbackStepId(n.id), type: FEEDBACK_STEP_TYPE, position: n.position,
      outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
      params: { ...n.params, __bindAs: n.id },
      inputs: { ...wired, prev: wire(n.id, 'previous', 'texture', 'Buffer a frame ago') },
    };
    const pass: GraphNode = {
      id: n.id, type: 'pass', position: n.position, outputs: passOutputs(),
      params: feedbackPassParams(n),
      inputs: { color: wire(step.id, 'color', 'vec3', 'Color'), alpha: wire(step.id, 'alpha', 'float', 'Alpha') },
    };
    bindAs.set(step.id, n.id);
    out.push(step, pass);
  }
  return { nodes: [...out, ...prevReaders], bindAs };
}
