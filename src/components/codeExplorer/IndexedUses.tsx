/**
 * The explainer's "Where else is this used?", through the Code Explorer's index: the same
 * idiom or pattern match (lib/glslPatterns), run over everything the index holds that the
 * in-memory scan doesn't reach (saved graphs, presets, shaders, linked files, presentations).
 */
import { useEffect, useState } from 'react';
import type { UseQuery } from '../../lib/glslPatterns';
import type { Instance } from '../../codeExplorer/queries';
import { queryIndex } from '../../codeExplorer/client';
import { useTokens } from '../../theme/themeStore';
import { InstanceRow } from './CodeExplorerPanel';

export function IndexedUses({ query }: { query: UseQuery }) {
  const tk = useTokens();
  const [hits, setHits] = useState<Instance[] | null>(null);
  useEffect(() => {
    let live = true;
    setHits(null);
    queryIndex({ q: 'uses', query, scope: { origins: ['saved', 'linked', 'presentation', 'workspace'] }, limit: 200 })
      .then(r => { if (live) setHits(r.result); }, () => { if (live) setHits([]); });
    return () => { live = false; };
  }, [query]);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>In your saved code and files</span>
        {hits && <span style={{ fontSize: 12, color: tk.text.muted }}>{hits.length === 0 ? 'Nowhere in your saved graphs, presets, shaders, linked files or presentations.' : `${hits.length} place${hits.length === 1 ? '' : 's'}`}</span>}
      </div>
      {hits === null
        ? <span style={{ fontSize: 12, color: tk.text.muted }}>Looking through the Code Explorer’s index…</span>
        : <div data-indexed-uses="" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{hits.map((h, i) => <InstanceRow key={i} inst={h} />)}</div>}
    </>
  );
}
