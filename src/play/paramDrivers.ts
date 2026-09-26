/**
 * paramDrivers.ts — which of a node's sliders a wire has taken over.
 *
 * Many sockets stand in for sliders: Circle SDF's Center socket, when wired,
 * replaces its Center X / Center Y sliders; a wired Translate replaces tx and
 * ty. The slider still shows, but moving it does nothing, and it must not be
 * offered as a Play control (Play takes free sliders only; the free ones are
 * on the node feeding the wire).
 *
 * Node definitions don't declare this; their code generators just fall back
 * to the params when a socket is unwired. So it's found the way the compiler
 * itself would see it: generate the node's GLSL with a marker string in place
 * of each slider (the compiler puts uniform names there the same way), once
 * with the socket wired and once without. A slider whose marker appears only
 * in the unwired code is replaced by that socket.
 *
 * Results are cached per node object (nodes are replaced, not mutated).
 */
import type { GraphNode, ParamDef } from '../types/nodeGraph';
import { getNodeDefinitionFor } from '../nodes/definitions';

export interface ParamDriver {
  /** The socket whose wire replaces the slider. */
  socketKey: string;
  socketLabel: string;
  /** Where the wire comes from. */
  connection: { nodeId: string; outputKey: string };
}

const cache = new WeakMap<GraphNode, Map<string, ParamDriver>>();

/** Every slider of `node` a wire has taken over, by param key. */
export function paramDrivers(node: GraphNode): Map<string, ParamDriver> {
  const hit = cache.get(node);
  if (hit) return hit;
  const out = new Map<string, ParamDriver>();
  cache.set(node, out);
  const def = getNodeDefinitionFor(node);
  if (!def?.paramDefs) return out;
  const socketLabel = (k: string) => node.inputs[k]?.label || def.inputs?.[k]?.label || k;
  const sliders = Object.entries(def.paramDefs).filter(([, pd]) => (pd as ParamDef).type === 'float').map(([k]) => k);
  // A slider's own socket, or its param socket, wired: the plain case.
  for (const k of sliders) {
    for (const sk of [k, `__param_${k}`]) {
      const c = node.inputs[sk]?.connection;
      if (c && !out.has(k)) out.set(k, { socketKey: sk, socketLabel: socketLabel(sk), connection: { nodeId: c.nodeId, outputKey: c.outputKey } });
    }
  }
  const wired = Object.entries(node.inputs).filter(([k, s]) => s.connection && !k.startsWith('__param_') && !sliders.includes(k));
  if (!wired.length || !def.generateGLSL) return out;
  const marker = (k: string) => `__SS_PARAM_${k}__`;
  const params: Record<string, unknown> = { ...node.params };
  for (const k of sliders) if (!out.has(k)) params[k] = marker(k);
  const probe = { ...node, params } as GraphNode;
  const vars = (skip: string | null) => {
    const v: Record<string, string> = {};
    for (const [k] of wired) if (k !== skip) v[k] = `__SS_IN_${k}__`;
    return v;
  };
  const code = (skip: string | null): string | null => {
    try {
      const r = def.generateGLSL(probe, vars(skip)) as { code?: string; functions?: string[] } | string | undefined;
      if (!r) return '';
      return typeof r === 'string' ? r : `${r.code ?? ''}\n${(r.functions ?? []).join('\n')}`;
    } catch { return null; }
  };
  const withAll = code(null);
  if (withAll === null) return out;
  for (const [sk, s] of wired) {
    const without = code(sk);
    if (without === null) continue;
    for (const k of sliders) {
      if (out.has(k)) continue;
      const m = marker(k);
      if (!withAll.includes(m) && without.includes(m)) {
        out.set(k, { socketKey: sk, socketLabel: socketLabel(sk), connection: { nodeId: s.connection!.nodeId, outputKey: s.connection!.outputKey } });
      }
    }
  }
  return out;
}

/** The wire that has taken over this slider, or null while it's free. */
export function driverOf(node: GraphNode, paramKey: string): ParamDriver | null {
  return paramDrivers(node).get(paramKey) ?? null;
}

/** A node's name as its card shows it. */
export function nodeLabelOf(node: GraphNode): string {
  return (typeof node.params.label === 'string' && node.params.label.trim()) || getNodeDefinitionFor(node)?.label || node.type;
}
