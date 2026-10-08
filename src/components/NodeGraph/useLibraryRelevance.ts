import { useEffect, useMemo, useState } from 'react';
import { getActiveNodes, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition, getOfferedDefinitions } from '../../nodes/definitions';
import { exampleFollowCounts, libraryContext, mainOutputType, rankFits, type FollowCounts, type LibraryContext } from '../../structure/relevance';
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

/** The "Fits here" nodes for the selected node, or for the wire being dragged (which wins). */
export function useFitsHere(enabled: boolean, hidden: ReadonlySet<string>): { defs: NodeDefinition[]; from: string | null } {
  const selectedId = useNodeGraphStore(s => s.selectedNodeId);
  const pathKey = useNodeGraphStore(s => s.activeGroupPath.join('/'));
  const wire = useLibraryPrefs(s => s.wire);
  const [counts, setCounts] = useState<FollowCounts | null>(null);

  // The selected node's type and main output, read when the selection changes (not per graph edit).
  const selected = useMemo(() => {
    if (!selectedId) return null;
    const s = useNodeGraphStore.getState();
    const node = getActiveNodes(s.nodes, s.activeGroupPath)?.find(n => n.id === selectedId);
    if (!node) return null;
    const outType = mainOutputType(getNodeDefinition(node.type)) ?? Object.values(node.outputs ?? {})[0]?.type ?? null;
    return outType ? { type: node.type, outType: outType as string } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, pathKey]);

  const source = wire ? { type: wire.nodeType, outType: wire.outType } : selected;
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
