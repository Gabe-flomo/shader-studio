/**
 * renderTargetsExpand.ts — opens each Render Targets node (nodes/definitions/renderTargets.ts) into a
 * pack and one Pass with extra targets (MRT, docs/render-targets.md):
 *
 *   renderTargetsPack (`<id>__pack`) ──▶ Pass (the node's own id, `__extra`: targets 2…4)
 *
 * The Pass keeps the node's id and output keys (texture / previous, texture1 / previous1 …), so every
 * wire out of the node reads it as it is. Its sink draws target 1 as gl_FragColor and the others as
 * pc_mrt<k>, in the same draw.
 *
 * Graphs without one come back as they are (the same array).
 */
import type { GraphNode, InputSocket } from '../types/nodeGraph';
import { PassNode } from '../nodes/definitions/passes';
import { inKey } from '../nodes/definitions/dataTexture';
import {
  RENDER_TARGETS_PACK_TYPE, RENDER_TARGETS_TYPE, targetPrevKey, targetTexKey, targetsOf,
} from '../nodes/definitions/renderTargets';

export const targetsPackId = (id: string) => `${id}__pack`;
export const isRenderTargets = (n: GraphNode): boolean => n.type === RENDER_TARGETS_TYPE;
export const hasRenderTargets = (nodes: GraphNode[]): boolean => nodes.some(n => isRenderTargets(n) && !n.bypassed);

const wire = (nodeId: string, outputKey: string, type: InputSocket['type'], label: string): InputSocket => ({ type, label, connection: { nodeId, outputKey } });
const sel = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : fallback) as T;

export function expandRenderTargets(nodes: GraphNode[]): GraphNode[] {
  if (!hasRenderTargets(nodes)) return nodes;
  return nodes.flatMap(n => {
    if (!isRenderTargets(n) || n.bypassed) return [n];
    const targets = targetsOf(n);
    const packInputs: GraphNode['inputs'] = {};
    targets.forEach((t, i) => {
      const c = n.inputs[inKey(i)]?.connection;
      if (c) packInputs[inKey(i)] = wire(c.nodeId, c.outputKey, t.type, t.name);
    });
    const pack: GraphNode = {
      id: targetsPackId(n.id), type: RENDER_TARGETS_PACK_TYPE, position: n.position, params: { ...n.params }, inputs: packInputs,
      outputs: {
        color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' },
        ...Object.fromEntries(targets.slice(1).map((_, i) => [`mrt${i + 1}`, { type: 'vec4' as const, label: `Target ${i + 2}` }])),
      },
    };
    const outputs: GraphNode['outputs'] = Object.fromEntries(Object.entries(PassNode.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }]));
    targets.slice(1).forEach((t, i) => {
      outputs[targetTexKey(i + 1)] = { type: 'texture', label: t.name };
      outputs[targetPrevKey(i + 1)] = { type: 'texture', label: `${t.name} (last frame)` };
    });
    const label = typeof n.params.label === 'string' && n.params.label.trim() ? n.params.label.trim() : 'Render Targets';
    const pass: GraphNode = {
      id: n.id, type: 'pass', position: n.position, outputs,
      params: {
        label, repeat: 1,
        scale: sel(n.params.scale, ['1', '0.5', '0.25', '0.125'], '1'),
        wrap: sel(n.params.wrap, ['clamp', 'repeat', 'mirror'], 'clamp'),
        format: targets[0].format, filter: targets[0].read === 'exact' ? 'nearest' : 'linear',
        __extra: targets.slice(1).map(t => ({ format: t.format, filter: t.read === 'exact' ? 'nearest' : 'linear' })),
      },
      inputs: {
        color: wire(pack.id, 'color', 'vec3', 'Color'), alpha: wire(pack.id, 'alpha', 'float', 'Alpha'),
        ...Object.fromEntries(targets.slice(1).map((_, i) => [`mrt${i + 1}`, wire(pack.id, `mrt${i + 1}`, 'vec4', `Target ${i + 2}`)])),
      },
    };
    return [pack, pass];
  });
}
