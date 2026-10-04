/**
 * agentReadings.ts — an Agents group's readings for Play (docs/agents-plan.md §6, P6): how many
 * walkers are alive, where their centre is, how spread out and how fast they are, and each
 * species' share. Play reads them as sensors on the layer id `ag:<group node id>` (mapping
 * sources, rule conditions), like an Agents layer's readings.
 *
 * Only what is read is computed: a Play read marks its group wanted, and the live runner
 * (lib/agentRunner.ts) sums that group's state on the GPU and reads the result back without a
 * stall, a frame or two late, while it stays wanted. The values are the live simulation's: a
 * take records what its mappings made of them.
 */
import { AG_GROUP_READS, type AgGroupRead } from '../play/kit/agentPlan.js';

/** Sensor layer ids of the Agents groups' readings. */
export const AGENT_READ_PREFIX = 'ag:';
export const agentReadLayer = (nodeId: string) => `${AGENT_READ_PREFIX}${nodeId}`;
export const isAgentReadLayer = (layerId: string) => layerId.startsWith(AGENT_READ_PREFIX);
export const AGENT_GROUP_READS = AG_GROUP_READS;
export type { AgGroupRead };

/** How long a read keeps its group's readings coming (ms): Play reads every frame while it uses them. */
const WANTED_MS = 2000;
const wantedAt = new Map<string, number>();
const values = new Map<string, Record<AgGroupRead, number>>();
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Something reads group `nodeId`'s readings now (the runner keeps them coming). */
export function wantAgentReadings(nodeId: string): void { wantedAt.set(nodeId, now()); }

/** Does anything read group `nodeId`'s readings (lately)? */
export function agentReadingsWanted(nodeId: string): boolean {
  const t = wantedAt.get(nodeId);
  return t !== undefined && now() - t < WANTED_MS;
}

/** The runner's latest readings for a group (when they arrive from the GPU). */
export function publishAgentReadings(nodeId: string, r: Record<AgGroupRead, number>): void { values.set(nodeId, r); }

/** A reading of sensor layer `layerId` (`ag:<id>`), marking it wanted; undefined until one has arrived. */
export function agentReading(layerId: string, read: string): number | undefined {
  if (!isAgentReadLayer(layerId)) return undefined;
  const id = layerId.slice(AGENT_READ_PREFIX.length);
  wantAgentReadings(id);
  const v = values.get(id)?.[read as AgGroupRead];
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

/** A sensor key (`ag:<id>::<read>`), as Play's engine keeps its sensors: the reading, or undefined. */
export function agentReadingByKey(key: string): number | undefined {
  if (!isAgentReadLayer(key)) return undefined;
  const i = key.indexOf('::');
  return i < 0 ? undefined : agentReading(key.slice(0, i), key.slice(i + 2));
}

/** The groups the live graph has (node id → its label), for the pickers and labels; set by the runner on each compile. */
const groups = new Map<string, string>();
export function setAgentGroups(list: Array<{ nodeId: string; label: string }>): void {
  groups.clear();
  for (const g of list) groups.set(g.nodeId, g.label);
}
/** The live graph's Agents groups, in order. */
export function agentGroups(): Array<{ nodeId: string; label: string }> { return [...groups].map(([nodeId, label]) => ({ nodeId, label })); }
/** A reading layer's name (`ag:<id>`): its group's label, or null for another layer. */
export function agentReadLabel(layerId: string): string | null {
  if (!isAgentReadLayer(layerId)) return null;
  return groups.get(layerId.slice(AGENT_READ_PREFIX.length)) ?? 'An Agents group';
}

/** Forget a group (its node is gone). */
export function dropAgentReadings(nodeId: string): void { values.delete(nodeId); wantedAt.delete(nodeId); }
