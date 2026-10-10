/**
 * shaderTextureStarters.ts — what a new Shader Texture holds (docs/texture-builder.md), and the
 * edits that make one: from a starter, from a Texture node, from a selection or a plain group.
 *
 * Pure: ids come from the caller (the store's id generator), and every edit returns a new top-level
 * node list for rewriteTopLevel (one undo step and a compile), or null when nothing changes.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import { getNodeDefinition } from './definitions';
import { instantiateNode } from './scene3dDefaults';
import { SHADER_TEXTURE_OUTPUT_TYPE, SHADER_TEXTURE_TYPE } from './definitions/shaderTexture';

type NextId = () => string;
type Wire = [fromId: string, outputKey: string];

const note = (lines: string[]) => ({ __comment: lines.join('\n') });

function make(nextId: NextId, type: string, x: number, y: number, params: Record<string, unknown> = {}, wires: Record<string, Wire> = {}): GraphNode {
  const node = instantiateNode(nextId(), type, getNodeDefinition(type)!, { x, y }, params);
  for (const [k, [from, key]] of Object.entries(wires)) if (node.inputs[k]) node.inputs[k] = { ...node.inputs[k], connection: { nodeId: from, outputKey: key } };
  return node;
}

/** An Expression Block reading UV, returning a colour. */
function exprBlock(nextId: NextId, x: number, y: number, uvId: string, label: string, lines: Array<[string, string]>, result: string, comment: string[]): GraphNode {
  const node = make(nextId, 'exprNode', x, y, {
    label,
    inputs: [{ name: 'uv', type: 'vec2', slider: null }],
    outputType: 'vec3',
    lines: lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })),
    result, expr: result,
    ...note(comment),
  });
  node.inputs = { uv: { type: 'vec2', label: 'uv', connection: { nodeId: uvId, outputKey: 'uv' } } };
  node.outputs = { result: { type: 'vec3', label: 'Result' } };
  return node;
}

const UV_NOTE = 'UV: this texel\'s place in the texture. Inside a Shader Texture it runs −1 to 1 across its own square, whatever the picture\'s shape.';

/** A Shader Texture's inside: a starter graph wired into Texture Output. */
export function buildShaderTextureSubgraph(nextId: NextId, starter: unknown = 'noise'): SubgraphData {
  const uv = make(nextId, 'uv', 0, 160, note([UV_NOTE]));
  const nodes: GraphNode[] = [uv];
  let color: Wire;
  if (starter === 'gradient') {
    const g = exprBlock(nextId, 300, 140, uv.id, 'Gradient', [
      ['float t', 'uv.y * 0.5 + 0.5'],
    ], 'mix(vec3(0.05, 0.08, 0.3), vec3(1.0, 0.6, 0.25), t)', [
      'What: a vertical gradient, deep blue at the bottom to warm orange at the top.',
      't = uv.y * 0.5 + 0.5: UV\'s height (−1 to 1) as 0 to 1, so the mix runs over the whole texture.',
      'result: mix the two colours by t. Change the two vec3s to change the ends.',
    ]);
    nodes.push(g);
    color = [g.id, 'result'];
  } else if (starter === 'circles') {
    const c = exprBlock(nextId, 300, 140, uv.id, 'Circles', [
      ['vec2 cell', 'fract(uv * 3.0) - 0.5'],
      ['float d', 'length(cell)'],
      ['float disc', 'smoothstep(0.32, 0.29, d)'],
    ], 'vec3(disc)', [
      'What: a grid of white discs on black. With Edges on Repeat it tiles without seams.',
      'cell = fract(uv * 3.0) − 0.5: cut the texture into 6 × 6 cells, each centred on 0.',
      'd = length(cell): how far this texel is from its cell\'s centre.',
      'disc = smoothstep(0.32, 0.29, d): 1 inside radius 0.3, 0 outside, with a soft rim.',
    ]);
    nodes.push(c);
    color = [c.id, 'result'];
  } else if (starter === 'stripes') {
    const s = exprBlock(nextId, 300, 140, uv.id, 'Stripes', [
      ['float wave', 'sin(uv.x * 3.14159265 * 8.0)'],
      ['float band', 'smoothstep(-0.15, 0.15, wave)'],
    ], 'vec3(band)', [
      'What: 8 vertical stripes, white and black. Whole periods across the texture, so it tiles.',
      'wave = sin(uv.x · π · 8): a wave that goes up and down 8 times across.',
      'band = smoothstep(−0.15, 0.15, wave): squash the wave into stripes with soft edges.',
    ]);
    nodes.push(s);
    color = [s.id, 'result'];
  } else {
    const fbm = make(nextId, 'fbm', 300, 120, { scale: 3, octaves: 5, ...note([
      'Fractal noise read at UV: clouds of light and dark, 0 to 1. Frequency is how busy it is.',
      'Time isn\'t wired, so the texture stays still and (on Update: On change) costs nothing per frame. Wire Time to make it drift.',
    ]) }, { uv: [uv.id, 'uv'] });
    const pal = make(nextId, 'palette', 600, 120, note(['Colours the noise with a cosine palette: each level of the noise gets its own hue.']), { value: [fbm.id, 'value'] });
    nodes.push(fbm, pal);
    color = [pal.id, 'color'];
  }
  const out = make(nextId, SHADER_TEXTURE_OUTPUT_TYPE, 900, 160, { _groupOriginal: true }, { color });
  nodes.push(out);
  return { nodes, inputPorts: [], outputPorts: [] };
}

/** A new Shader Texture node at `position` (its inside from `starter`). */
export function makeShaderTexture(nextId: NextId, position: { x: number; y: number }, params: Record<string, unknown> = {}): GraphNode {
  const def = getNodeDefinition(SHADER_TEXTURE_TYPE)!;
  const merged = { ...(def.defaultParams ?? {}), ...params };
  return instantiateNode(nextId(), SHADER_TEXTURE_TYPE, def, position, { ...merged, subgraph: (params.subgraph as SubgraphData | undefined) ?? buildShaderTextureSubgraph(nextId, merged.starter) });
}

/** Start the node's inside over from a starter (its settings and wires out are kept). */
export function restartShaderTexture(nodes: GraphNode[], nodeId: string, starter: string, nextId: NextId): GraphNode[] | null {
  const st = nodes.find(n => n.id === nodeId && n.type === SHADER_TEXTURE_TYPE);
  if (!st) return null;
  // The old inside's overrides (`innerId::key`) go with it.
  const params = Object.fromEntries(Object.entries(st.params).filter(([k]) => !k.includes('::')));
  return nodes.map(n => (n === st ? { ...st, params: { ...params, starter, subgraph: buildShaderTextureSubgraph(nextId, starter) } } : n));
}

/** Every wire reading `fromId`, moved to read `toId` (same output keys, for those `toId` has). */
function rewireReaders(nodes: GraphNode[], fromId: string, toId: string, keyMap: (key: string) => string | null): GraphNode[] {
  return nodes.map(n => {
    let changed = false;
    const inputs: GraphNode['inputs'] = {};
    for (const [k, inp] of Object.entries(n.inputs)) {
      if (inp.connection?.nodeId !== fromId) { inputs[k] = inp; continue; }
      changed = true;
      const key = keyMap(inp.connection.outputKey);
      const { connection: _drop, ...rest } = inp;
      inputs[k] = key ? { ...rest, connection: { nodeId: toId, outputKey: key } } : rest;
    }
    return changed ? { ...n, inputs } : n;
  });
}

/**
 * A Texture node's "Create a new texture": a Shader Texture in its place, at its position, with every
 * wire that read its Texture or Color reading the new node's.
 */
export function textureNodeToShaderTexture(nodes: GraphNode[], nodeId: string, nextId: NextId): GraphNode[] | null {
  const tex = nodes.find(n => n.id === nodeId);
  if (!tex) return null;
  const st = makeShaderTexture(nextId, tex.position);
  const rest = nodes.filter(n => n !== tex);
  return [...rewireReaders(rest, tex.id, st.id, k => (k === 'texture' || k === 'color' || k === 'alpha' ? k : k === 'rgba' ? null : 'color')), st];
}

/** Source nodes copied into the inside when the selection reads them (they have no inputs of their own). */
const COPYABLE = new Set(['uv', 'time', 'constant', 'colorPicker', 'resolution', 'mouse', 'constants']);

export type ConvertResult = { nodes: GraphNode[]; id: string } | { error: string };

/**
 * "Turn into a Shader Texture" on a selection at the top level (or on one plain group): the selected
 * nodes become the inside, the one whose output leaves the selection (else the last one) feeds Texture
 * Output, and the wires that read it read the node's Color. A UV, Time or Constant the selection reads
 * from outside is copied in; any other wire from outside can't come along (a Shader Texture has no
 * inputs), and the conversion says which.
 */
export function selectionToShaderTexture(nodes: GraphNode[], ids: string[], nextId: NextId): ConvertResult {
  let sel = nodes.filter(n => ids.includes(n.id));
  // One plain group: its inside, with the source of its first output port.
  let groupResult: Wire | null = null;
  let groupNode: GraphNode | null = null;
  if (sel.length === 1 && sel[0].type === 'group') {
    groupNode = sel[0];
    const sg = groupNode.params.subgraph as SubgraphData | undefined;
    if (!sg?.nodes.length) return { error: 'This group is empty.' };
    if (sg.nodes.some(m => Object.values(m.inputs).some(i => i.connection?.nodeId === GROUP_PORT_SENTINEL))) {
      return { error: 'This group reads values through its inputs; a Shader Texture has none. Move what feeds them inside the group first.' };
    }
    const port = sg.outputPorts[0];
    if (port?.fromNodeId) groupResult = [port.fromNodeId, port.fromOutputKey];
    // The group's overrides of its inner params (`innerId::key`) are the values the inside had.
    const g = groupNode;
    sel = sg.nodes.filter(m => m.type !== 'groupInput' && m.type !== 'groupOutput').map(m => {
      const head = `${m.id}::`;
      const over = Object.entries(g.params).filter(([k]) => k.startsWith(head) && !k.slice(head.length).includes('::'));
      return over.length ? { ...m, params: { ...m.params, ...Object.fromEntries(over.map(([k, v]) => [k.slice(head.length), v])) } } : m;
    });
  }
  if (!sel.length) return { error: 'Select the nodes that make the picture first.' };
  if (sel.some(n => n.type === 'output' || n.type === 'vec4Output')) return { error: 'The Output can\'t go inside a Shader Texture; leave it out of the selection.' };
  if (sel.some(n => n.type === SHADER_TEXTURE_TYPE || n.type === 'agentsGroup')) return { error: 'A Shader Texture or an Agents group can\'t go inside a Shader Texture.' };
  const inside = new Set(sel.map(n => n.id));
  const byId = new Map(nodes.map(n => [n.id, n]));
  // Outside sources read by the selection.
  const copies = new Map<string, GraphNode>();
  const blocked: string[] = [];
  if (!groupNode) for (const n of sel) for (const inp of Object.values(n.inputs)) {
    const c = inp.connection;
    if (!c || inside.has(c.nodeId)) continue;
    const src = byId.get(c.nodeId);
    if (src && COPYABLE.has(src.type) && !Object.values(src.inputs).some(i => i.connection)) {
      if (!copies.has(src.id)) copies.set(src.id, { ...src, id: nextId(), position: { x: src.position.x, y: src.position.y } });
    } else blocked.push(src ? (typeof src.params.label === 'string' && src.params.label ? src.params.label : getNodeDefinition(src.type)?.label ?? src.type) : c.nodeId);
  }
  if (blocked.length) return { error: `The selection reads ${[...new Set(blocked)].join(', ')} from outside, and a Shader Texture has no inputs. Select those too, or wire them differently first.` };
  // The result: the source of the group's port, else the selected node whose output leaves the selection, else the rightmost.
  let result = groupResult;
  const readers = nodes.filter(n => !inside.has(n.id));
  if (!result) for (const r of readers) {
    for (const inp of Object.values(r.inputs)) if (inp.connection && inside.has(inp.connection.nodeId)) { result = [inp.connection.nodeId, inp.connection.outputKey]; break; }
    if (result) break;
  }
  if (!result) {
    const last = [...sel].sort((a, b) => b.position.x - a.position.x).find(n => Object.keys(n.outputs).length > 0);
    if (!last) return { error: 'Nothing in the selection has an output to draw.' };
    const key = Object.entries(last.outputs).find(([, o]) => o.type === 'vec3' || o.type === 'vec4')?.[0] ?? Object.keys(last.outputs)[0];
    result = [last.id, key];
  }
  // The inside, placed from its own left edge; copied sources read by their new ids.
  const minX = Math.min(...sel.map(n => n.position.x), ...[...copies.values()].map(n => n.position.x));
  const minY = Math.min(...sel.map(n => n.position.y), ...[...copies.values()].map(n => n.position.y));
  const moved = (n: GraphNode): GraphNode => ({ ...n, position: { x: n.position.x - minX, y: n.position.y - minY + 80 } });
  const inner: GraphNode[] = [
    ...[...copies.values()].map(moved),
    ...sel.map(n => {
      const inputs: GraphNode['inputs'] = {};
      for (const [k, inp] of Object.entries(n.inputs)) {
        const cp = inp.connection ? copies.get(inp.connection.nodeId) : undefined;
        inputs[k] = cp ? { ...inp, connection: { nodeId: cp.id, outputKey: inp.connection!.outputKey } } : inp;
      }
      return moved({ ...n, inputs });
    }),
  ];
  const maxX = Math.max(...inner.map(n => n.position.x));
  const out = make(nextId, SHADER_TEXTURE_OUTPUT_TYPE, maxX + 320, 160, { _groupOriginal: true }, { color: result });
  const at = groupNode ? groupNode.position : { x: Math.max(...sel.map(n => n.position.x)), y: Math.min(...sel.map(n => n.position.y)) };
  const st = makeShaderTexture(nextId, at, { subgraph: { nodes: [...inner, out], inputPorts: [], outputPorts: [] }, starter: 'custom' });
  // Readers outside: of the group (any port) or of the result node, now read Color (vec3 wires) or Texture.
  let rest = nodes.filter(n => !inside.has(n.id) && n !== groupNode);
  const toColor = (k: string) => (k === 'texture' ? 'texture' : 'color');
  if (groupNode) rest = rewireReaders(rest, groupNode.id, st.id, toColor);
  else for (const id of inside) rest = rewireReaders(rest, id, st.id, k => (id === result![0] && k === result![1] ? 'color' : null));
  return { nodes: [...rest, st], id: st.id };
}
