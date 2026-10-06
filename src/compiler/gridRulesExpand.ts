/**
 * gridRulesExpand.ts — opens each Grid Rules node (docs/grid-rules.md) into the Pass machinery,
 * before the pass compile cuts the graph (compiler/passGraph.ts):
 *
 *   gridRulesStep (`<id>__step`) ──▶ Pass `<label> cells` (`<id>__cells`, the board) ──▶ the node
 *        ▲ reads the board's Previous                     Texture ▲
 *
 *  - the board: an ordinary Pass node, at the node's Board size, Nearest, Edges Repeat (wrap) or
 *    Clamp (walls), Repeat = Steps a frame. Its slug comes from its label, so its texture lives as
 *    long as the node does (and is new for a node of another label);
 *  - the step: an internal node whose GLSL is the rule (gridRules/glsl.ts), the board Pass's
 *    whole program. It gets the node's params and its Start image wire;
 *  - the node itself stays (same id, so every wire out of it, its probes and thumbnails still
 *    work), reading the board's Texture through an internal `__board` input, and compiles to the
 *    board coloured;
 *  - only when its Texture output is wired: a second small Pass (`<id>__pic`) holding the coloured
 *    board, drawn by a copy of the node (`<id>__picview`), so Glow, Texture tools and Agents
 *    groups get the picture as a texture.
 *
 * The step and the picture copy compile under the node's own slug and bind their sliders to its
 * id (`__bindAs`), so the node's params are one set of uniforms in every program: a slider or a
 * Play control moves the rule without a recompile.
 */
import type { GraphNode } from '../types/nodeGraph';
import { PassNode } from '../nodes/definitions/passes';
import { gridShape } from '../gridRules/spec';

export const GRID_TYPE = 'gridRules';
export const gridCellsId = (id: string) => `${id}__cells`;
export const gridStepId = (id: string) => `${id}__step`;
export const gridPicId = (id: string) => `${id}__pic`;
export const gridPicViewId = (id: string) => `${id}__picview`;

type Sub = { nodes?: GraphNode[] } | undefined;

/** Does the graph have a Grid Rules node (at the top level or inside a group)? */
export function hasGridRules(nodes: GraphNode[]): boolean {
  for (const n of nodes) {
    if (n.type === GRID_TYPE) return true;
    const sg = n.params?.subgraph as Sub;
    if (sg?.nodes && hasGridRules(sg.nodes)) return true;
  }
  return false;
}

export interface ExpandedGridRules {
  nodes: GraphNode[];
  /** Nodes made here that compile under another node's slug and bind its sliders: made id → Grid Rules id. */
  bindAs: Map<string, string>;
}

const passOutputs = (): GraphNode['outputs'] => Object.fromEntries(Object.entries(PassNode.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }]));
const wire = (nodeId: string, outputKey: string, type: GraphNode['inputs'][string]['type'], label: string) => ({ type, label, connection: { nodeId, outputKey } });

export function gridLabel(n: GraphNode): string {
  return typeof n.params.label === 'string' && n.params.label.trim() ? n.params.label.trim() : 'Grid';
}

export function expandGridRules(nodes: GraphNode[]): ExpandedGridRules {
  const bindAs = new Map<string, string>();
  if (!nodes.some(n => n.type === GRID_TYPE)) return { nodes, bindAs };
  const textureRead = new Set<string>();
  for (const n of nodes) for (const i of Object.values(n.inputs)) {
    if (i.connection?.outputKey === 'texture') textureRead.add(i.connection.nodeId);
  }
  const out: GraphNode[] = [];
  for (const n of nodes) {
    if (n.type !== GRID_TYPE) { out.push(n); continue; }
    const s = gridShape(n.params);
    const label = gridLabel(n);
    const at = n.position;
    // Wires into the node's sliders (a group's param sockets, `__param_<key>`) drive the step too.
    const paramWires = Object.fromEntries(Object.entries(n.inputs).filter(([k, i]) => k.startsWith('__param_') && i.connection));
    const step: GraphNode = {
      id: gridStepId(n.id), type: 'gridRulesStep', position: at, outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
      params: { ...n.params, __bindAs: n.id },
      inputs: {
        ...paramWires,
        prev: wire(gridCellsId(n.id), 'previous', 'texture', 'Board a step ago'),
        image: { type: 'texture', label: 'Start image', ...(n.inputs.image?.connection ? { connection: { ...n.inputs.image.connection } } : {}) },
      },
    };
    const cells: GraphNode = {
      id: gridCellsId(n.id), type: 'pass', position: at, outputs: passOutputs(),
      params: { label: `${label} cells`, scale: String(s.scale), filter: 'nearest', wrap: s.wrap ? 'repeat' : 'clamp', format: 'half', repeat: s.steps },
      inputs: { color: wire(step.id, 'color', 'vec3', 'Color'), alpha: wire(step.id, 'alpha', 'float', 'Alpha') },
    };
    const board = wire(cells.id, 'texture', 'texture', 'Cells');
    // The node: its Start image is the step's business only.
    const inputs: GraphNode['inputs'] = { ...n.inputs, image: { type: 'texture', label: 'Start image' }, __board: board };
    bindAs.set(step.id, n.id);
    out.push(step, cells);
    if (textureRead.has(n.id)) {
      const picView: GraphNode = { ...n, id: gridPicViewId(n.id), params: { ...n.params, __bindAs: n.id }, inputs: { ...paramWires, __board: board } };
      const pic: GraphNode = {
        id: gridPicId(n.id), type: 'pass', position: at, outputs: passOutputs(),
        params: { label: `${label} picture`, scale: String(s.scale), filter: 'nearest', wrap: 'clamp', format: 'half' },
        inputs: { color: wire(picView.id, 'color', 'vec3', 'Color') },
      };
      inputs.__pic = wire(pic.id, 'texture', 'texture', 'Picture');
      bindAs.set(picView.id, n.id);
      out.push(picView, pic);
    }
    out.push({ ...n, inputs });
  }
  return { nodes: out, bindAs };
}
