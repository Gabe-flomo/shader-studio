/**
 * curveBeamExpand.ts — opens each Curve Trace in Draw: Beam (docs/curve-trace.md) into the Pass
 * machinery before the pass compile cuts the graph (compiler/passGraph.ts), as Grid Rules does
 * (compiler/gridRulesExpand.ts):
 *
 *   curveTraceBeamStep (`<id>__beamstep`) ──▶ Pass `<label> screen` (`<id>__beam`) ──▶ the node
 *        ▲ reads the screen's Previous                       Texture ▲
 *
 *  - the screen: an ordinary Pass, half float, at the node's Screen size. Its slug comes from its
 *    label, so its texture lives as long as the node does;
 *  - the step: the screen's whole program. It fades last frame's screen and lays in the stretch the
 *    dot covered since then (nodes/definitions/curveTrace.ts, beamStepCode). It gets the node's
 *    params and every wire into the node (UV, Time, frequencies, phases, Morph, param sockets);
 *  - the node itself stays (same id, so its wires out, probes and thumbnails still work) and reads
 *    the screen's Texture through an internal `__beam` input.
 *
 * The step compiles under the node's slug and binds its sliders to the node's id (`__bindAs`), so a
 * slider or a Play control moves the beam without a recompile.
 *
 * Nothing else is new: the screen is drawn, kept and exported exactly as any Pass with feedback is
 * (lib/passRunner.ts live and offline, kit/passHost.js on pages).
 */
import type { GraphNode } from '../types/nodeGraph';
import { PassNode } from '../nodes/definitions/passes';

export const CURVE_TYPE = 'curveTrace';
export const beamScreenId = (id: string) => `${id}__beam`;
export const beamStepId = (id: string) => `${id}__beamstep`;

/** A Curve Trace drawing into a screen of its own. */
export const isBeamTrace = (n: GraphNode): boolean => n.type === CURVE_TYPE && n.params?.draw === 'beam';

const passOutputs = (): GraphNode['outputs'] => Object.fromEntries(Object.entries(PassNode.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }]));
const wire = (nodeId: string, outputKey: string, type: GraphNode['inputs'][string]['type'], label: string) => ({ type, label, connection: { nodeId, outputKey } });
const SCALES = new Set(['1', '0.5', '0.25']);

export interface ExpandedBeams {
  nodes: GraphNode[];
  /** Nodes made here that compile under another node's slug and bind its sliders: made id → Curve Trace id. */
  bindAs: Map<string, string>;
}

export function expandCurveBeams(nodes: GraphNode[]): ExpandedBeams {
  const bindAs = new Map<string, string>();
  if (!nodes.some(isBeamTrace)) return { nodes, bindAs };
  const out: GraphNode[] = [];
  for (const n of nodes) {
    if (!isBeamTrace(n)) { out.push(n); continue; }
    const label = typeof n.params.label === 'string' && n.params.label.trim() ? n.params.label.trim() : 'Curve';
    const scale = String(n.params.beamScale ?? '1');
    // Every wire into the node (UV, Time, frequencies, phases, Morph, `__param_<key>` sockets) drives the step too.
    const wired = Object.fromEntries(Object.entries(n.inputs).filter(([k, i]) => i.connection && k !== '__beam').map(([k, i]) => [k, { ...i, connection: { ...i.connection! } }]));
    const step: GraphNode = {
      id: beamStepId(n.id), type: 'curveTraceBeamStep', position: n.position,
      outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
      params: { ...n.params, __bindAs: n.id },
      inputs: { ...wired, prev: wire(beamScreenId(n.id), 'previous', 'texture', 'Screen a frame ago') },
    };
    const screen: GraphNode = {
      id: beamScreenId(n.id), type: 'pass', position: n.position, outputs: passOutputs(),
      params: { label: `${label} screen`, scale: SCALES.has(scale) ? scale : '1', filter: 'linear', wrap: 'clamp', format: 'half' },
      inputs: { color: wire(step.id, 'color', 'vec3', 'Color'), alpha: wire(step.id, 'alpha', 'float', 'Alpha') },
    };
    bindAs.set(step.id, n.id);
    out.push(step, screen, { ...n, inputs: { ...n.inputs, __beam: wire(screen.id, 'texture', 'texture', 'Screen') } });
  }
  return { nodes: out, bindAs };
}
