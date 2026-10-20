/**
 * meta.ts — how a Combine build is known in a graph (docs/combine-plan.md §4), with no other imports, so the Scene
 * builder's recognizer (builders/sceneKinds.ts) can read it without pulling the builder in.
 *
 *  - The spec, on the top glue node (the one feeding the Output): `params.combine` (COMBINE_META).
 *  - Every glue node: its role (`_cbRole` = '<layerId>:<part>') and its build (`_cbBuild`).
 */
import type { GraphNode } from '../types/nodeGraph';
import type { CombineSpec, NodeRef } from './spec';

export const COMBINE_META = 'combine';
export const CB_ROLE = '_cbRole';
export const CB_BUILD = '_cbBuild';

export interface CombineMeta {
  v: 1;
  spec: CombineSpec;
  /** The build's key: every glue node carries it in `_cbBuild`. */
  build: string;
  /** role → fingerprint of the glue node as built (its settings and wires), to tell the user's edits apart. */
  built?: Record<string, string>;
  /**
   * Wires the build set on a product's own nodes ("nodeId.input" → what was there before, null for nothing): put back
   * before every rebuild, and when the build is taken away.
   */
  patched?: Record<string, NodeRef | null>;
  /**
   * Inside products' Agents groups (Collide with, Follow the shape), per group: the ports added (keys) and Agent
   * Output's wires before ("input" → what was there): put back before every rebuild, and when the build goes.
   */
  inner?: Record<string, { ports: string[]; out: Record<string, NodeRef | null> }>;
}

/** The Combine meta on `node` (the anchor), or null. */
export function combineMetaOf(node: GraphNode | undefined | null): CombineMeta | null {
  const m = node?.params?.[COMBINE_META] as CombineMeta | undefined;
  return m && m.v === 1 && typeof m.build === 'string' && Array.isArray(m.spec?.layers) ? m : null;
}

export const cbRoleOf = (n: GraphNode): string => (typeof n.params[CB_ROLE] === 'string' ? n.params[CB_ROLE] as string : '');

/** The anchor (the node holding the spec) of the Combine build `anyId` belongs to: itself, or a glue node's anchor. */
export function combineOfBuild(nodes: readonly GraphNode[], anyId: string): string | null {
  const hit = nodes.find(n => n.id === anyId);
  if (!hit) return null;
  if (combineMetaOf(hit)) return hit.id;
  const build = hit.params[CB_BUILD];
  if (typeof build !== 'string') return null;
  return nodes.find(n => combineMetaOf(n)?.build === build)?.id ?? null;
}

/** The glue nodes of the build anchored at `anchorId` (the anchor too), by role. */
export function findCombineBuild(nodes: readonly GraphNode[], anchorId: string): { anchor: GraphNode; meta: CombineMeta; byRole: Map<string, GraphNode> } | null {
  const anchor = nodes.find(n => n.id === anchorId);
  const meta = combineMetaOf(anchor);
  if (!anchor || !meta) return null;
  const mine = nodes.filter(n => n.params[CB_BUILD] === meta.build && cbRoleOf(n));
  return { anchor, meta, byRole: new Map(mine.map(n => [cbRoleOf(n), n])) };
}
