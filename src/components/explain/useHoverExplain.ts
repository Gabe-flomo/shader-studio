/**
 * One line's explanation for a hover (the code card's Code page). The explainer loads on the
 * first hover, so cards cost nothing until someone points at a line.
 */
import { useEffect, useMemo, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';

type Lib = typeof import('../../lib/glslPatterns');
let lib: Lib | null = null;
let loading: Promise<Lib> | null = null;

export function useHoverExplain(node: GraphNode, line: string | null): string | null {
  const [ready, setReady] = useState(!!lib);
  useEffect(() => {
    if (!line || lib) return;
    loading ??= import('../../lib/glslPatterns');
    let live = true;
    loading.then(m => { lib = m; if (live) setReady(true); });
    return () => { live = false; };
  }, [line]);
  return useMemo(() => {
    const text = line?.trim();
    if (!text || !ready || !lib || text.startsWith('//')) return null;
    const types = node.type === 'customFn' ? lib.customFnEnv(node) : lib.exprBlockEnv(node);
    const r = lib.explainLine(text, { types });
    return r.ok ? r.lineSentence : null;
  }, [line, ready, node]);
}
