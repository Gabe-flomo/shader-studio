import { useSyncExternalStore } from 'react';
import { getAllUserNodes, getUserNodesVersion, subscribeUserNodes } from './userNodeRegistry';
import type { UserNodeDefinition } from '../../types/userNode';

/**
 * Re-render when the set of user-published node types changes. Components
 * that enumerate the registry (palettes, browsers, search) call this so a
 * freshly published node shows up without a reload.
 */
export function useUserNodesVersion(): number {
  return useSyncExternalStore(subscribeUserNodes, getUserNodesVersion, getUserNodesVersion);
}

let cache: { version: number; list: UserNodeDefinition[] } | null = null;
function snapshot(): UserNodeDefinition[] {
  const v = getUserNodesVersion();
  if (!cache || cache.version !== v) cache = { version: v, list: getAllUserNodes() };
  return cache.list;
}

/** The user's published node definitions, newest first. */
export function useUserNodes(): UserNodeDefinition[] {
  return useSyncExternalStore(subscribeUserNodes, snapshot, snapshot);
}
