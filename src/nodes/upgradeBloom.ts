/**
 * upgradeBloom.ts — turn the old Bloom node (it reads the frame before, so it lags and smears
 * anything moving) into the same-frame setup (docs/blur-and-glow.md):
 *
 *   picture ─► Pass ─texture─► Glow (texture), Bloom chain ─┐
 *        └──────── Pass Color ──────────────────────────────┴─► Add glow ─► (what Bloom fed)
 *
 * The Glow keeps the Bloom's id, label and the settings they share (Threshold, Intensity,
 * Radius; Softness becomes Knee), so Play controls on them keep working. Pure; the store
 * (upgradeBloom) runs it with undo, a compile and a toast.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';

export interface UpgradedBloom {
  nodes: GraphNode[];
  added: string[];
  /** Wires into Bloom's Threshold / Intensity sockets, which the Glow has as settings only. */
  droppedWires: number;
}

export function upgradeBloom(nodes: GraphNode[], id: string, nextId: () => string): UpgradedBloom | null {
  const bloom = nodes.find(nd => nd.id === id && nd.type === 'bloom');
  const src = bloom?.inputs.color?.connection;
  if (!bloom || !src) return null;
  const P = bloom.params;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const { x, y } = bloom.position;
  const passId = nextId(), addId = nextId();
  const label = typeof P.label === 'string' && P.label.trim() ? P.label : undefined;

  const pass = n('pass', passId, x - 420, y, {
    scale: '1', format: 'half',
    __comment: 'Pass: the picture as a texture, this frame, so the glow can read around each pixel without waiting a frame (the old Bloom read the frame before). Half float keeps brightness above 1.',
  }, { color: [src.nodeId, src.outputKey] });
  const glow = n('glowTexture', id, x, y, {
    method: 'bloom',
    threshold: num(P.threshold, 0.3), knee: Math.max(0.01, num(P.softness, 0.2)),
    radius: Math.min(64, Math.max(1, num(P.radius, 40) * 0.5)),
    intensity: num(P.intensity, 1.5), tail: 0.4,
    ...(label ? { label } : {}),
    __comment: 'Glow (texture), Bloom chain: the bright parts (above Threshold, softened by Knee), halved again and again and built back up: a tight core with a long, wide tail, in the same frame. Tail moves weight into the wide levels.',
  }, { texture: [passId, 'texture'] });
  const add = n('exprNode', addId, x + 420, y, {
    label: 'Add glow', outputType: 'vec3', lines: [], result: 'picture + glow', expr: 'picture + glow',
    inputs: [{ name: 'picture', type: 'vec3', slider: null }, { name: 'glow', type: 'vec3', slider: null }],
    __comment: 'Add glow: the picture with the glow added on top (light adds). Feed it a Tone Map if bright parts clip.',
  });
  add.inputs = {
    picture: { type: 'vec3', label: 'picture', connection: { nodeId: passId, outputKey: 'color' } },
    glow: { type: 'vec3', label: 'glow', connection: { nodeId: id, outputKey: 'glow' } },
  };
  add.outputs = { result: { type: 'vec3', label: 'Result' } };

  const droppedWires = ['threshold', 'intensity'].filter(k => bloom.inputs[k]?.connection).length;
  const rewired = nodes.flatMap(nd => {
    if (nd.id === id) return [pass, glow, add];
    const hit = Object.values(nd.inputs).some(i => i.connection?.nodeId === id);
    if (!hit) return [nd];
    return [{ ...nd, inputs: Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => [k, i.connection?.nodeId === id ? { ...i, connection: { nodeId: addId, outputKey: 'result' } } : i])) }];
  });
  return { nodes: rewired, added: [passId, addId], droppedWires };
}
