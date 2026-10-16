/**
 * Channel names on dropdowns (docs/channel-tools.md): a Trail field's Channel names shown where a channel is
 * picked downstream. A select with `channelsFrom` (input keys) follows those inputs' wires to a Trail field,
 * directly or, inside an Agents group, through Agent Inputs to the wire into the group, and labels its
 * channel options "Channel 3 · crowd".
 */
import type { GraphNode, ParamDef } from '../types/nodeGraph';
import { trailChannelNames } from './definitions/agents';

/** The names of the Trail field feeding one of `keys` on `node`, or null (no trail, or no names given). */
export function channelNamesFor(node: GraphNode, keys: readonly string[], here: readonly GraphNode[], outer: readonly GraphNode[] | null, group: GraphNode | null): string[] | null {
  for (const k of keys) {
    const c = node.inputs[k]?.connection;
    if (!c) continue;
    let src = here.find(n => n.id === c.nodeId);
    // Inside an Agents group: Agent Inputs' port is the group's own input, wired from outside.
    if (src?.type === 'agentInputs' && group && outer) {
      const gc = group.inputs[c.outputKey]?.connection;
      src = gc ? outer.find(n => n.id === gc.nodeId) : undefined;
    }
    if (src?.type !== 'trailField') continue;
    if (!String(src.params.names ?? '').trim()) return null;
    return trailChannelNames(src);
  }
  return null;
}

/** The select's options with the channel names added: values 1–4, ch1–ch4 (or a1–a4) gain " · name". */
export function namedChannelOptions(options: NonNullable<ParamDef['options']>, names: readonly string[] | null): NonNullable<ParamDef['options']> {
  if (!names) return options;
  return options.map(o => {
    const m = /^(?:ch|a)?([1-4])$/.exec(o.value);
    const name = m ? names[Number(m[1]) - 1] : undefined;
    return name && !/^Channel \d$/.test(name) ? { ...o, label: `${o.label} · ${name}` } : o;
  });
}
