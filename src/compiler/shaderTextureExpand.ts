/**
 * shaderTextureExpand.ts — opens each Shader Texture (docs/texture-builder.md) into the Pass
 * machinery, before the pass compile cuts the graph (compiler/passGraph.ts):
 *
 *   its inner nodes ──▶ (Texture Output's wires) ──▶ Pass `<label>` with the node's own id
 *
 *  - the inner nodes join the top level with their ids (a clash with another node gets
 *    `<nodeId>__` in front, as compiler/passGroups.ts does), so their sliders, probes and the
 *    eye find them by the ids the inside shows. The node's overrides of inner params
 *    (`innerId::key`, written when a slider moves inside) are applied;
 *  - Texture Output goes: its Color and Alpha wires feed the Pass;
 *  - an Output (or a Group Input/Output terminal) left inside is dropped: the inside has no picture
 *    of its own;
 *  - the Pass keeps the node's id, so every wire out of the node (Texture, Color, Alpha) reads
 *    the Pass, and the Pass card thumbnail registry (keyed by node id) draws the card's preview.
 *    Its settings: Resolution as a fixed size (`__size`, px) or the picture's (scale 1), Update
 *    (`__update`), Filter, Edges, Format; `__alwaysLive` draws it even when nothing reads it yet,
 *    so its card and the inside preview show the texture while you build.
 *
 * Graphs without a Shader Texture come back as they are (the same array).
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import { PassNode } from '../nodes/definitions/passes';
import { SHADER_TEXTURE_OUTPUT_TYPE, SHADER_TEXTURE_TYPE, shaderTextureSize, shaderTextureUpdate } from '../nodes/definitions/shaderTexture';

type Wire = { nodeId: string; outputKey: string };

const DROPPED = new Set(['output', 'vec4Output', 'groupInput', 'groupOutput', SHADER_TEXTURE_OUTPUT_TYPE]);

const passOutputs = (): GraphNode['outputs'] => Object.fromEntries(Object.entries(PassNode.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }]));

export function shaderTextureLabel(n: GraphNode): string {
  return typeof n.params.label === 'string' && n.params.label.trim() ? n.params.label.trim() : 'Shader Texture';
}

/** The Pass params a Shader Texture's settings give. */
export function shaderTexturePassParams(n: GraphNode): Record<string, unknown> {
  const size = shaderTextureSize(n.params.size);
  const update = shaderTextureUpdate(n.params.update);
  return {
    label: shaderTextureLabel(n), scale: '1',
    format: n.params.format === 'byte' ? 'byte' : 'half',
    filter: n.params.filter === 'nearest' ? 'nearest' : 'linear',
    wrap: n.params.wrap === 'clamp' || n.params.wrap === 'mirror' ? n.params.wrap : 'repeat',
    repeat: 1,
    ...(size ? { __size: size } : {}),
    ...(update !== 'frame' ? { __update: update } : {}),
    __alwaysLive: true,
  };
}

/** Does the list (at the top level) have a Shader Texture? */
export function hasShaderTexture(nodes: GraphNode[]): boolean {
  return nodes.some(n => n.type === SHADER_TEXTURE_TYPE);
}

/** Open every top-level Shader Texture. Nested ones (inside a plain group) arrive here once passGroups has opened their group. */
export function expandShaderTextures(nodes: GraphNode[]): GraphNode[] {
  if (!hasShaderTexture(nodes)) return nodes;
  let list = nodes;
  const taken = new Set(nodes.map(n => n.id));
  for (let guard = 0; guard < 64; guard++) {
    const st = list.find(n => n.type === SHADER_TEXTURE_TYPE);
    if (!st) break;
    const sg = st.params.subgraph as SubgraphData | undefined;
    const innerAll = sg?.nodes ?? [];
    const idOf = new Map<string, string>();
    for (const m of innerAll) {
      const id = taken.has(m.id) ? `${st.id}__${m.id}` : m.id;
      idOf.set(m.id, id);
      taken.add(id);
    }
    const remap = (c: Wire | undefined): Wire | undefined => {
      if (!c || c.nodeId === GROUP_PORT_SENTINEL) return undefined;
      const to = idOf.get(c.nodeId);
      return to ? { nodeId: to, outputKey: c.outputKey } : undefined;
    };
    const out = innerAll.find(m => m.type === SHADER_TEXTURE_OUTPUT_TYPE);
    const inner: GraphNode[] = [];
    for (const m of innerAll) {
      if (DROPPED.has(m.type)) continue;
      const head = `${m.id}::`;
      const params: Record<string, unknown> = { ...m.params };
      for (const [k, v] of Object.entries(st.params)) if (k.startsWith(head)) params[k.slice(head.length)] = v;
      const inputs: GraphNode['inputs'] = {};
      for (const [k, inp] of Object.entries(m.inputs)) {
        if (!inp.connection) { inputs[k] = inp; continue; }
        const to = remap(inp.connection);
        const { connection: _drop, ...rest } = inp;
        inputs[k] = to ? { ...rest, connection: to } : rest;
      }
      inner.push({ ...m, id: idOf.get(m.id)!, inputs, params });
    }
    const color = remap(out?.inputs.color?.connection);
    const alpha = remap(out?.inputs.alpha?.connection);
    const pass: GraphNode = {
      id: st.id, type: 'pass', position: st.position, outputs: passOutputs(),
      params: shaderTexturePassParams(st),
      inputs: {
        color: { type: 'vec3', label: 'Color', ...(color ? { connection: color } : {}) },
        alpha: { type: 'float', label: 'Alpha', ...(alpha ? { connection: alpha } : { defaultValue: 1 }) },
      },
    };
    // On change watches the clock only when a Time node is inside: nodes with an unwired Time input read
    // the clock by default (and are still while their own speed is 0), so without this a still noise would
    // be drawn again every frame.
    if (!inner.some(m => m.type === 'time')) pass.params.__stillTime = true;
    list = [...list.filter(n => n !== st), ...inner, pass];
  }
  return list;
}
