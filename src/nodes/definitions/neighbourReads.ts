/**
 * Reading a colour at neighbouring pixels, shared by Convolve (docs/convolve.md) and Kuwahara (docs/kuwahara.md).
 *
 * Where the neighbours come from, in order:
 *  - Texture wired (a Pass, a picture's Texture): read at texel offsets, Spacing picture pixels apart.
 *  - Colour ƒ wired to a chain that can be a function (an optional field socket): the chain is worked out again at
 *    each offset, Spacing picture pixels apart (one picture pixel is 2 / height in picture units).
 *  - Otherwise only this pixel is known: the node passes its colour through, and its card says why.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { fieldFn } from './helpers';
import { passPxUniform, texUv } from './passes';
import { collectFieldChain, fieldProblemOf } from '../../compiler/fieldSockets';

export interface NeighbourSource {
  /** 'texture' or 'field': which input the reads come from. */
  from: 'texture' | 'field';
  /** Setup lines: declare `${id}_c`, this pixel's colour, and what the reads need. */
  lines: string[];
  /** A vec3 read at `offset` (a vec2 expression, in reads: x right, y up). */
  read: (offset: string) => string;
}

/**
 * The reads for node `id` from its `texture`, else its `colour` field function; null when neither can be read
 * elsewhere (the caller passes `colour` through). `spacing` is the GLSL for picture pixels between reads.
 */
export function neighbourSource(id: string, v: Record<string, string | undefined>, spacing: string): NeighbourSource | null {
  const tex = v.texture;
  if (tex) {
    return {
      from: 'texture',
      lines: [
        `    vec2 ${id}_st = ${texUv(v.uv ?? 'g_uv')};\n`,
        `    vec2 ${id}_d = ${passPxUniform(tex)} * ${spacing};\n`,
        `    vec3 ${id}_c = texture2D(${tex}, ${id}_st).rgb;\n`,
      ],
      read: o => `texture2D(${tex}, ${id}_st + ${o} * ${id}_d).rgb`,
    };
  }
  const fn = fieldFn(v.colour);
  if (fn) {
    // One picture pixel is 2 / height in picture units.
    return {
      from: 'field',
      lines: [
        `    vec2 ${id}_q = ${v.uv ?? 'g_uv'};\n`,
        `    float ${id}_e = ${spacing} * 2.0 / u_resolution.y;\n`,
        `    vec3 ${id}_c = ${fn}(${id}_q, vec2(0.0), 1.0, 0.0);\n`,
      ],
      read: o => `${fn}(${id}_q + ${o} * ${id}_e, vec2(0.0), 1.0, 0.0)`,
    };
  }
  return null;
}

export type NeighbourSourceKind = 'texture' | 'none' | 'blocked' | 'field';

/** Where a node's neighbours come from (its `texture` and `colour` inputs), in words for its card. */
export function neighbourSourceNote(node: GraphNode, nodes: readonly GraphNode[], defOf: (n: GraphNode) => NodeDefinition | undefined): { kind: NeighbourSourceKind; text: string } {
  if (node.inputs.texture?.connection) return { kind: 'texture', text: 'Reading the Texture at neighbouring pixels.' };
  const conn = node.inputs.colour?.connection;
  if (!conn) return { kind: 'none', text: 'Wire a Texture, or any colour chain into Colour ƒ.' };
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const id of collectFieldChain(conn.nodeId, byId)) {
    const n = byId.get(id)!;
    const why = fieldProblemOf(n, defOf);
    if (why) {
      const label = (typeof n.params.label === 'string' && n.params.label.trim()) || defOf(n)?.label || n.type;
      return { kind: 'blocked', text: `Can't work out the Colour chain at other places (${label}: ${why}), so it passes through unchanged. Send it through a Pass and wire the Pass's Texture into Texture.` };
    }
  }
  return { kind: 'field', text: 'Working out the Colour chain again at each neighbour.' };
}
