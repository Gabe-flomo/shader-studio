/**
 * spriteExpand.ts — Draw agents' Sprite takes any texture (docs/agent-sprites.md). The agents engine
 * reads a sprite from a Pass, so a texture that isn't a Pass's (a Texture Input, a Video Input, the
 * camera, Baked…) gets one, hidden, in between, before the passes are cut:
 *
 *   source ──texture──▶ Sample (texture) `<draw>__spriteRead` ──▶ Pass `<draw>__sprite` ──▶ Sprite
 *
 * A Pass's Texture is left as it is. Graphs without a Sprite come back unchanged (the same array).
 */
import type { GraphNode } from '../types/nodeGraph';
import { PassNode } from '../nodes/definitions/passes';

export const spritePassId = (drawId: string) => `${drawId}__sprite`;

export function expandSpriteSources(nodes: GraphNode[]): GraphNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const draws = nodes.filter(n => n.type === 'drawAgents' && !n.bypassed && n.inputs.sprite?.connection);
  const needs = draws.filter(d => {
    const c = d.inputs.sprite!.connection!;
    return !(byId.get(c.nodeId)?.type === 'pass' && c.outputKey === 'texture');
  });
  if (!needs.length) return nodes;
  const added: GraphNode[] = [];
  const rewired = new Map<string, GraphNode>();
  for (const d of needs) {
    const c = d.inputs.sprite!.connection!;
    const readId = `${d.id}__spriteRead`, passId = spritePassId(d.id);
    added.push({
      id: readId, type: 'sampleTexture', position: d.position, params: { offsetX: 0, offsetY: 0 },
      inputs: { texture: { type: 'texture', label: 'Texture', connection: { nodeId: c.nodeId, outputKey: c.outputKey } } },
      outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
    });
    added.push({
      id: passId, type: 'pass', position: d.position, params: { label: 'Sprite', scale: '0.5', format: 'byte', filter: 'linear', wrap: 'clamp', repeat: 1 },
      inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: readId, outputKey: 'color' } }, alpha: { type: 'float', label: 'Alpha', connection: { nodeId: readId, outputKey: 'alpha' } } },
      outputs: Object.fromEntries(Object.entries(PassNode.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }])),
    });
    rewired.set(d.id, { ...d, inputs: { ...d.inputs, sprite: { ...d.inputs.sprite!, connection: { nodeId: passId, outputKey: 'texture' } } } });
  }
  return [...nodes.map(n => rewired.get(n.id) ?? n), ...added];
}
