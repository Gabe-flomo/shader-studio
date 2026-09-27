/** Hooks that read links between graphs and presentations (present/links.ts), kept current as they change. */
import { useEffect, useState } from 'react';
import { SAVED_GRAPHS_CHANGED } from '../../store/useNodeGraphStore';
import { PRESENTATIONS_CHANGED } from '../../present/storage';
import { linkedGraphsOf, linkedPresentationsOf, LINKS_CHANGED } from '../../present/links';

/** Re-render when links, graphs or presentations change. */
export function useLinksVersion(): number {
  const [n, bump] = useState(0);
  useEffect(() => {
    const on = () => bump(x => x + 1);
    const events = [LINKS_CHANGED, PRESENTATIONS_CHANGED, SAVED_GRAPHS_CHANGED];
    for (const e of events) window.addEventListener(e, on);
    return () => { for (const e of events) window.removeEventListener(e, on); };
  }, []);
  return n;
}

/** A saved graph's linked presentations. */
export function useGraphLinks(graph: string | null | undefined): string[] {
  useLinksVersion();
  return graph ? linkedPresentationsOf(graph) : [];
}

/** A presentation's linked graphs. */
export function usePresentationLinks(pres: string | null | undefined): string[] {
  useLinksVersion();
  return pres ? linkedGraphsOf(pres) : [];
}
