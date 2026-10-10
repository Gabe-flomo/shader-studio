import { useMemo } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { addScopeOf, hiddenHere, scopeFromKey, scopeKey, type AddScope } from '../../nodes/addScope';

/** Where a node added now would go (nodes/addScope.ts): re-renders only when that changes. */
export function useAddScope(): AddScope {
  const key = useNodeGraphStore(s => scopeKey(addScopeOf(s.nodes, s.activeGroupPath)));
  return useMemo(() => scopeFromKey(key), [key]);
}

/** A browser's hidden set, adjusted for where a node would be added. */
export function useHiddenHere(base: ReadonlySet<string>): Set<string> {
  const scope = useAddScope();
  return useMemo(() => hiddenHere(base, scope), [base, scope]);
}
