/**
 * meta.ts — recognising a Texture Lab build (docs/texture-lab.md), with nothing heavy: its saved spec on the source
 * node, the build a node belongs to, its nodes by role. The Scene builder's kind list (builders/builtScenes.ts) reads
 * these; apply.ts builds. Pure.
 */
import type { GraphNode } from '../types/nodeGraph';
import { TX_BUILD, TX_META, TX_ROLE, normalizeSpec, sourceName, type TextureLabSpec } from './spec';

export const roleOf = (n: GraphNode | undefined): string => (n && typeof n.params[TX_ROLE] === 'string' ? n.params[TX_ROLE] as string : '');

export interface TxMeta { v: 1; build: string; spec: TextureLabSpec }


/** The builder's saved build on its source node, or null. */
export function txMetaOf(n: GraphNode | undefined | null): TxMeta | null {
  const m = n?.params?.[TX_META] as TxMeta | undefined;
  return m && typeof m === 'object' && m.v === 1 && typeof m.build === 'string' && m.spec && typeof m.spec === 'object' ? m : null;
}

/** The source node (its id) of the build a node belongs to, from any of its nodes. */
export function labOfBuild(graph: readonly GraphNode[], anyId: string): string | null {
  const hit = graph.find(n => n.id === anyId);
  if (!hit) return null;
  if (txMetaOf(hit)) return hit.id;
  const build = hit.params[TX_BUILD];
  if (!build) return null;
  return graph.find(n => txMetaOf(n)?.build === build)?.id ?? null;
}

/** The nodes of one build, by role. */
export function findTxBuild(graph: readonly GraphNode[], sourceId: string): { source: GraphNode; meta: TxMeta; byRole: Map<string, GraphNode> } | null {
  const source = graph.find(n => n.id === sourceId);
  const meta = txMetaOf(source);
  if (!source || !meta) return null;
  const mine = graph.filter(n => n.params[TX_BUILD] === meta.build && roleOf(n));
  return { source, meta, byRole: new Map(mine.map(n => [roleOf(n), n])) };
}

/** Whether the build's source node is the builder's own (a built-in picture or clip), not one of yours. */
export const ownsSource = (spec: TextureLabSpec) => spec.source.kind !== 'node';

/** The top-level node ids of a build (the builder's own: not a source of yours). */
export function txBuildIds(graph: readonly GraphNode[], sourceId: string | null | undefined): string[] {
  const b = sourceId ? findTxBuild(graph, sourceId) : null;
  if (!b) return [];
  const own = ownsSource(normalizeSpec(b.meta.spec));
  return [...b.byRole.entries()].filter(([role, nd]) => (role !== 'source' || own) && !role.startsWith('view:') && nd).map(([, nd]) => nd.id);
}

/** The label of what a build reads, for lists ("Room and cat · 3 blocks"). */
export function buildDetail(spec: TextureLabSpec): string {
  const s = normalizeSpec(spec);
  return `${sourceName(s.source)} · ${s.blocks.length} ${s.blocks.length === 1 ? 'block' : 'blocks'}`;
}
