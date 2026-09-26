/** The Markdown + KaTeX module (present/markdown.ts), fetched when the Present page opens rather than with the app. */
import { useEffect, useState } from 'react';

type MarkdownModule = typeof import('../../present/markdown');
let loaded: MarkdownModule | null = null;
let loading: Promise<MarkdownModule> | null = null;

/** The Markdown + KaTeX module, fetched once the page is open. */
export function loadMarkdown(): Promise<MarkdownModule> {
  loading ??= import('../../present/markdown').then(m => { loaded = m; return m; });
  return loading;
}

export function useMarkdownModule(): MarkdownModule | null {
  const [m, setM] = useState<MarkdownModule | null>(loaded);
  useEffect(() => {
    if (m) return;
    let alive = true;
    void loadMarkdown().then(x => { if (alive) setM(x); });
    return () => { alive = false; };
  }, [m]);
  return m;
}
