/**
 * migratePlay.ts — a saved Play record brought along with its graph's node migrations.
 *
 * When a node definition changes what a param's number means (Grid's Columns,
 * see nodes/definitions/gridColumns.ts), migrateNodeParams converts the value
 * stored on the node. A Play control on that param keeps its own numbers: the
 * slider's min / max / step, the output range of every mapping into it, and
 * the values of recorded takes. This converts those with the definition's
 * migrateParamValue, so the slider still covers the same pictures.
 *
 * Needs the nodes as saved (before migrateNodeParams stamps the new version),
 * so call it on the raw or alias-resolved nodes, not the migrated ones.
 */

import type { GraphNode, NodeDefinition, SubgraphData } from '../types/nodeGraph';
import { savedSchemaVersion } from '../types/nodeGraph';
import { parseActionTarget, parsePropTarget, type PlayRecord } from '../types/play';

type Convert = (value: number) => number;

/** The node a control target names (`id::key`, `groupId::id::key`, …), walking into groups. */
function nodeAt(nodes: GraphNode[], ids: string[]): GraphNode | undefined {
  let list: GraphNode[] | undefined = nodes;
  let n: GraphNode | undefined;
  for (const id of ids) {
    n = list?.find(x => x.id === id);
    if (!n) return undefined;
    list = (n.params?.subgraph as SubgraphData | undefined)?.nodes;
  }
  return n;
}

/** Scales every value in a width-1 take track's keys (`gap,value,gap,value…`). */
function convertKeys(keys: string, convert: Convert): string {
  if (!keys) return keys;
  return keys.split(',').map((s, i) => (i % 2 === 1 && s !== '' && Number.isFinite(Number(s)) ? String(convert(Number(s))) : s)).join(',');
}

export function migratePlayRecord(
  play: PlayRecord,
  savedNodes: GraphNode[],
  getDef: (type: string) => NodeDefinition | undefined,
): PlayRecord {
  const converters = new Map<string, Convert>();
  for (const c of play.controls) {
    if (c.kind !== 'float' || parsePropTarget(c.target) || parseActionTarget(c.target)) continue;
    const parts = c.target.split('::');
    if (parts.length < 2) continue;
    const node = nodeAt(savedNodes, parts.slice(0, -1));
    if (!node) continue;
    const def = getDef(node.type);
    const from = savedSchemaVersion(node);
    if (!def?.migrateParamValue || from >= (def.version ?? 1)) continue;
    const key = parts[parts.length - 1];
    const convert: Convert = v => { const r = def.migrateParamValue!(key, v, from); return typeof r === 'number' ? r : v; };
    if (convert(1) === 1) continue; // this param's meaning didn't change
    converters.set(c.id, convert);
  }
  if (converters.size === 0) return play;

  const controls = play.controls.map(c => {
    const convert = converters.get(c.id);
    if (!convert) return c;
    return { ...c, min: convert(c.min), max: convert(c.max), ...(c.step !== undefined ? { step: convert(c.step) } : {}) };
  });
  const mappings = play.mappings.map(m => {
    const convert = converters.get(m.controlId);
    return convert ? { ...m, outMin: convert(m.outMin), outMax: convert(m.outMax) } : m;
  });
  const takes = play.takes?.map(take => ({
    ...take,
    tracks: take.tracks.map(tr => {
      const convert = tr.kind === 'control' && tr.width === 1 ? converters.get(tr.id) : undefined;
      return convert ? { ...tr, keys: convertKeys(tr.keys, convert) } : tr;
    }),
  }));
  return { ...play, controls, mappings, ...(takes ? { takes } : {}) };
}
