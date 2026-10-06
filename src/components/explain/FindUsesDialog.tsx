/**
 * "Where else is this used?": the current graph and the bundled examples, scanned in memory
 * for an idiom or a made function's shape (lib/glslPatterns/findUses.ts), listed with their
 * provenance and a jump to each.
 */
import { useEffect, useMemo, useState } from 'react';
import { findUses, provenance, type UseHit, type UseQuery, type UseSource } from '../../lib/glslPatterns';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { loadExampleGraphs } from '../../store/exampleIndex';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { askConfirm } from '../ui/dialogStore';

export function FindUsesDialog({ query, title, onClose, onJumped }: { query: UseQuery; title: string; onClose: () => void; onJumped?: () => void }) {
  const tk = useTokens();
  const nodes = useNodeGraphStore(s => s.nodes);
  const here = useMemo(() => findUses(query, [{ graph: 'This graph', nodes }]), [query, nodes]);
  const [examples, setExamples] = useState<UseHit[] | null>(null);
  useEffect(() => {
    let live = true;
    loadExampleGraphs().then(all => {
      if (!live) return;
      const sources: UseSource[] = Object.entries(all).filter(([k]) => k !== 'blank').map(([k, ex]) => ({ graph: ex.label, exampleKey: k, nodes: ex.nodes }));
      setExamples(findUses(query, sources, 300));
    }).catch(() => { if (live) setExamples([]); });
    return () => { live = false; };
  }, [query]);

  const jump = async (h: UseHit) => {
    const st = useNodeGraphStore.getState();
    if (h.exampleKey) {
      const ok = await askConfirm(`Open the example “${h.graph}”?`, { message: 'It replaces the graph on the canvas. Save yours first if you want to keep it.', confirmLabel: 'Open example' });
      if (!ok) return;
      await st.loadExampleGraph(h.exampleKey);
    }
    // A node inside a group: show the group it is in (outermost)
    useNodeGraphStore.getState().focusNode(h.groupPath[0]?.id ?? h.nodeId);
    onClose();
    onJumped?.();
  };

  const row = (h: UseHit, i: number) => {
    const at = h.code.indexOf(h.match);
    return (
      <li key={`${h.exampleKey ?? ''}:${h.nodeId}:${h.line}:${i}`} data-use-hit="" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 10px', borderRadius: radius.md, background: tk.bg.subtle }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: `500 11.5px ${fontFamily.ui}`, color: tk.text.muted }}>{provenance(h)}</span>
          <code style={{ font: `500 12px/1.45 ${fontFamily.mono}`, color: tk.text.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {at >= 0 ? <>{h.code.slice(0, at)}<mark style={{ background: alpha(tk.accent.base, 0.2), color: tk.text.primary, borderRadius: 3 }}>{h.match}</mark>{h.code.slice(at + h.match.length)}</> : h.code}
          </code>
        </span>
        <Button size="sm" variant="ghost" icon="target" onClick={() => void jump(h)} title={h.exampleKey ? 'Open this example and show the node' : 'Show the node'}>{h.exampleKey ? 'Open' : 'Show'}</Button>
      </li>
    );
  };

  return (
    <Modal title="Where else is this used?" subtitle={title} icon="search" onClose={onClose} width={720} height={600}>
      <div data-find-uses="" style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Section title="In this graph" count={here.length} empty="Nowhere else in this graph." />
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>{here.map(row)}</ul>
        <Section title="In the examples" count={examples?.length ?? null} empty="In none of the examples." />
        {examples === null
          ? <span style={{ fontSize: 12, color: tk.text.muted }}>Looking through the examples…</span>
          : <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>{examples.map(row)}</ul>}
        <span style={{ fontSize: 11.5, color: tk.text.faint }}>Looks at Expression Block lines and Custom Function statements, in this graph and the bundled examples. Matches are by shape: the same structure with any inputs.</span>
      </div>
    </Modal>
  );
}

function Section({ title, count, empty }: { title: string; count: number | null; empty: string }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>{title}</span>
      {count !== null && <span style={{ fontSize: 12, color: tk.text.muted }}>{count === 0 ? empty : `${count} place${count === 1 ? '' : 's'}`}</span>}
    </div>
  );
}
