/**
 * addScope.ts — nodes that only make sense inside a certain group.
 *
 * Scene Pos (the point a scene is measured at) and Scene Output (the scene's
 * distance) are the two ends of a Scene Group's distance function; Scene
 * Distance measures the loop's scene at a March Loop step. On the top level, or
 * in any other group, they do nothing, so the node browser, the search palette,
 * the Do bar and the Do language's `create` offer them only inside the right
 * group (docs/groups.md, "Nodes that belong inside a 3D render"):
 *
 *   - Scene Pos:      inside a Scene Group or a Space Warp Group;
 *   - Scene Output:   inside a Scene Group that has none yet (it is the one return value);
 *   - Scene Distance: inside a March Loop / GI Lit March Group.
 *
 * Graphs that already have them anywhere still load and compile as before: this
 * only decides what is *offered*.
 *
 * Pure: the browser components read the scope from the store (useAddScope).
 */

import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { MARCH_GROUP_TYPES } from './smart3d';

export interface AddScope {
  /** The group being edited (its node type), or null on the top level. */
  groupType: string | null;
  /** Whether that group already has a Scene Output inside. */
  hasSceneOutput?: boolean;
}

export const TOP_LEVEL: AddScope = { groupType: null };

const SCOPED: Record<string, (s: AddScope) => boolean> = {
  scenePos: s => s.groupType === 'sceneGroup' || s.groupType === 'spaceWarpGroup',
  sceneOutput: s => s.groupType === 'sceneGroup' && !s.hasSceneOutput,
  marchSceneDist: s => !!s.groupType && MARCH_GROUP_TYPES.has(s.groupType),
};

/** Node types offered only inside a certain group. */
export const SCOPED_TYPES: ReadonlySet<string> = new Set(Object.keys(SCOPED));

/** Is `type` offered when adding a node here? (Unscoped types are always offered.) */
export function offeredHere(type: string, scope: AddScope): boolean {
  const rule = SCOPED[type];
  return rule ? rule(scope) : true;
}

/**
 * A browser's hidden set for this scope: its own hidden types, less the scoped
 * ones that belong here, plus the scoped ones that don't.
 */
export function hiddenHere(base: ReadonlySet<string>, scope: AddScope): Set<string> {
  const out = new Set(base);
  for (const type of SCOPED_TYPES) {
    if (offeredHere(type, scope)) out.delete(type);
    else out.add(type);
  }
  return out;
}

/** The scope of the group at `path` (activeGroupPath) in `nodes`. */
export function addScopeOf(nodes: GraphNode[], path: readonly string[]): AddScope {
  if (!path.length) return TOP_LEVEL;
  let level = nodes;
  let group: GraphNode | undefined;
  for (const id of path) {
    group = level.find(n => n.id === id);
    const sub = group?.params.subgraph as SubgraphData | undefined;
    if (!group || !sub) return TOP_LEVEL;
    level = sub.nodes;
  }
  return { groupType: group!.type, hasSceneOutput: level.some(n => n.type === 'sceneOutput') };
}

/** A stable string for a scope (a store selector can return it without re-rendering on every change). */
export function scopeKey(s: AddScope): string {
  return `${s.groupType ?? ''}|${s.hasSceneOutput ? 1 : 0}`;
}
export function scopeFromKey(key: string): AddScope {
  const [g, o] = key.split('|');
  return g ? { groupType: g, hasSceneOutput: o === '1' } : TOP_LEVEL;
}
