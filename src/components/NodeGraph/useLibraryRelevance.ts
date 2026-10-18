import { useEffect, useMemo, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition, getOfferedDefinitions } from '../../nodes/definitions';
import { exampleFollowCounts, libraryContext, rankFits, type FollowCounts, type LibraryContext } from '../../structure/relevance';
import { useLibraryPrefs } from '../../structure/libraryPrefs';
import type { NodeDefinition } from '../../types/nodeGraph';

const compute = (): LibraryContext => {
  const s = useNodeGraphStore.getState();
  return libraryContext(s.nodes, s.activeGroupPath);
};

/**
 * The flow the library serves. Read from the store outside React's render path: the graph changes
 * on every drag frame, so a trailing timer re-reads it at most a few times a second and the
 * component only re-renders when the answer actually changes.
 */
export function useLibraryContext(enabled: boolean): LibraryContext {
  const [ctx, setCtx] = useState<LibraryContext>(compute);
  useEffect(() => {
    if (!enabled) return;
    setCtx(prev => { const c = compute(); return c.flow === prev.flow && c.inside === prev.inside ? prev : c; });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useNodeGraphStore.subscribe((s, prev) => {
      if (s.nodes === prev.nodes && s.activeGroupPath === prev.activeGroupPath) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setCtx(p => { const c = compute(); return c.flow === p.flow && c.inside === p.inside ? p : c; });
      }, 300);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [enabled]);
  return ctx;
}

/**
 * The "Fits here" nodes for the wire being dragged. Only while dragging: the Next strip under the
 * selected card is the one suggestion surface (docs/glossary.md), so selecting a card adds nothing here.
 */
export function useFitsHere(enabled: boolean, hidden: ReadonlySet<string>): { defs: NodeDefinition[]; from: string | null } {
  const wire = useLibraryPrefs(s => s.wire);
  const [counts, setCounts] = useState<FollowCounts | null>(null);
  const source = wire ? { type: wire.nodeType, outType: wire.outType } : null;
  const wanted = enabled && !!source;
  useEffect(() => {
    if (!wanted || counts) return;
    let live = true;
    exampleFollowCounts().then(c => { if (live) setCounts(c); });
    return () => { live = false; };
  }, [wanted, counts]);

  return useMemo(() => {
    if (!wanted || !counts || !source) return { defs: [], from: null };
    const defs = rankFits(source.type, source.outType, getOfferedDefinitions(), counts, 8, hidden);
    return { defs, from: getNodeDefinition(source.type)?.label ?? source.type };
  }, [wanted, counts, source?.type, source?.outType, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
}
