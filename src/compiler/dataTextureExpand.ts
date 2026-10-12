/**
 * dataTextureExpand.ts — opens each Data Texture node (nodes/definitions/dataTexture.ts) into the Pass
 * machinery before the pass compile cuts the graph (compiler/passGraph.ts), as a Feedback (texture)
 * is (feedbackExpand.ts):
 *
 *   dataTexturePack (`<id>__pack`) ──▶ Pass (the node's own id) ──▶ Texture / Previous wires
 *                                            └──▶ Read channels (`<id>__out<i>`) ──▶ output i's wires
 *
 *  - the Pass keeps the node's id, so Texture and Previous wires read it as they are, and the Pass
 *    card thumbnail (keyed by node id) draws the card's preview. Precision, Read (exact: nearest),
 *    Size and Edges come from the node;
 *  - the pack is the Pass's program: every wired field into its channels;
 *  - each output's wires read a Read channels node with the output's channels, at Read at.
 *
 * A read that feeds the node itself is a frame delay (compiler/graphLoops.ts, isFrameDelayWire): it
 * reads the Pass's Previous (`<id>__prev<i>`), so a node can keep state: position += velocity.
 *
 * Graphs without a Data Texture come back as they are (the same array).
 */
import type { GraphNode, InputSocket } from '../types/nodeGraph';
import { PassNode } from '../nodes/definitions/passes';
import {
  DATA_PACK_TYPE, DATA_TEXTURE_TYPE, READ_CHANNELS_TYPE, fieldsOf, inKey, outKey, readsOf, typeForWidth,
} from '../nodes/definitions/dataTexture';

type Wire = { nodeId: string; outputKey: string };

export const dataPackId = (id: string) => `${id}__pack`;
export const dataReadId = (id: string, i: number, delayed: boolean) => `${id}__${delayed ? 'prev' : 'out'}${i}`;

export const isDataTexture = (n: GraphNode): boolean => n.type === DATA_TEXTURE_TYPE;
export const hasDataTexture = (nodes: GraphNode[]): boolean => nodes.some(n => isDataTexture(n) && !n.bypassed);

const passOutputs = (): GraphNode['outputs'] => Object.fromEntries(Object.entries(PassNode.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }]));
const wire = (nodeId: string, outputKey: string, type: InputSocket['type'], label: string): InputSocket => ({ type, label, connection: { nodeId, outputKey } });

const sel = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : fallback) as T;

/** The Pass params a Data Texture's settings give. */
export function dataPassParams(n: GraphNode): Record<string, unknown> {
  const label = typeof n.params.label === 'string' && n.params.label.trim() ? n.params.label.trim() : 'Data Texture';
  return {
    label,
    scale: sel(n.params.scale, ['1', '0.5', '0.25', '0.125', '0.0625', '0.03125'], '1'),
    format: sel(n.params.format, ['float', 'half', 'byte'], 'float'),
    filter: n.params.read === 'smooth' ? 'linear' : 'nearest',
    wrap: sel(n.params.wrap, ['clamp', 'repeat', 'mirror'], 'clamp'),
    repeat: 1,
  };
}

/** The nodes upstream of `dt`'s inputs within one frame (stopping at `dt` and at wires already a frame ago). */
function upstreamOf(nodes: GraphNode[], dt: GraphNode): Set<string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const up = new Set<string>();
  const stack: Wire[] = Object.values(dt.inputs).flatMap(i => (i.connection ? [i.connection] : []));
  while (stack.length) {
    const c = stack.pop()!;
    if (c.nodeId === dt.id || up.has(c.nodeId)) continue;
    const src = byId.get(c.nodeId);
    if (!src) continue;
    if (src.type === 'pass' && (c.outputKey === 'previous' || c.outputKey === 'step' || c.outputKey === 'steps')) continue;
    up.add(c.nodeId);
    for (const i of Object.values(src.inputs)) if (i.connection) stack.push(i.connection);
  }
  return up;
}

/** Open every top-level Data Texture into its pack, its Pass and a Read channels per output in use. */
export function expandDataTextures(nodes: GraphNode[]): GraphNode[] {
  if (!hasDataTexture(nodes)) return nodes;
  let list = nodes;
  for (const dt of nodes.filter(n => isDataTexture(n) && !n.bypassed)) {
    const cur = list.find(n => n.id === dt.id)!;
    const up = upstreamOf(list, cur);
    const reads = readsOf(cur);
    const readers = new Map<string, GraphNode>();
    // A consumer that feeds the node (or the node itself) reads it a frame ago.
    const delayedFor = (consumer: GraphNode) => consumer.id === cur.id || up.has(consumer.id);
    const reader = (i: number, delayed: boolean): string => {
      const rid = dataReadId(cur.id, i, delayed);
      if (!readers.has(rid)) {
        const at = cur.inputs.at?.connection;
        readers.set(rid, {
          id: rid, type: READ_CHANNELS_TYPE, position: cur.position,
          params: { channels: reads[i].channels, read: cur.params.read, storage: cur.params.storage, rangeMin: cur.params.rangeMin, rangeMax: cur.params.rangeMax },
          inputs: {
            texture: wire(cur.id, delayed ? 'previous' : 'texture', 'texture', 'Texture'),
            ...(at ? { uv: wire(at.nodeId, at.outputKey, 'vec2', 'UV') } : {}),
          },
          outputs: { value: { type: typeForWidth(reads[i].channels.length), label: reads[i].name } },
        });
      }
      return rid;
    };
    const retarget = (n: GraphNode): GraphNode => {
      let changed = false;
      const inputs: GraphNode['inputs'] = {};
      for (const [k, inp] of Object.entries(n.inputs)) {
        const c = inp.connection;
        if (!c || c.nodeId !== cur.id) { inputs[k] = inp; continue; }
        const i = reads.findIndex((_, j) => outKey(j) === c.outputKey);
        if (i >= 0) { changed = true; inputs[k] = { ...inp, connection: { nodeId: reader(i, delayedFor(n)), outputKey: 'value' } }; continue; }
        // Its texture, read by what feeds it: the texture a frame ago.
        if (c.outputKey === 'texture' && delayedFor(n)) { changed = true; inputs[k] = { ...inp, connection: { nodeId: cur.id, outputKey: 'previous' } }; continue; }
        inputs[k] = inp;
      }
      return changed ? { ...n, inputs } : n;
    };
    list = list.map(retarget);
    const self = list.find(n => n.id === cur.id)!;
    const fields = fieldsOf(self);
    const packInputs: GraphNode['inputs'] = {};
    fields.forEach((f, i) => {
      const c = self.inputs[inKey(i)]?.connection;
      if (c) packInputs[inKey(i)] = wire(c.nodeId, c.outputKey, f.type, f.name);
    });
    const pack: GraphNode = {
      id: dataPackId(cur.id), type: DATA_PACK_TYPE, position: cur.position,
      params: { ...self.params }, inputs: packInputs,
      outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
    };
    const pass: GraphNode = {
      id: cur.id, type: 'pass', position: cur.position, outputs: passOutputs(),
      params: dataPassParams(self),
      inputs: { color: wire(pack.id, 'color', 'vec3', 'Color'), alpha: wire(pack.id, 'alpha', 'float', 'Alpha') },
    };
    list = list.flatMap(n => (n.id === cur.id ? [pack, pass] : [n]));
    list = [...list, ...readers.values()];
  }
  return list;
}
