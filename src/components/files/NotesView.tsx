/**
 * Notes: every note in the saved graphs (and the open one), grouped by graph
 * (files/notes.ts): Play notes and node comments, with their links and
 * credits, the numbers (how many, where, which nodes), search, filter and
 * sort. Read-only: Go to opens the note where it lives to edit it; Delete
 * takes one out of its saved graph, with Undo.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { Segmented } from '../ui/Choice';
import { LinkedText } from '../ui/Links';
import { CreditTag } from '../ui/Credit';
import { collectNotes, groupByGraph, notesStats, ownerPath, previewText, queryNotes, type NoteEntry, type NoteKind, type NoteSort } from '../../files/notes';
import type { Inventory } from '../../files/inventory';
import { localMutableKV } from '../../files/mutate';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';
import { capsLabel, cardStyle, when } from './fileUiShared';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const labelOf = (type: string) => getNodeDefinition(type)?.label;

export function NotesView({ inv, compact, onGoTo, onDelete }: {
  /** Rebuilt when storage changes: the notes are read again with it. */
  inv: Inventory;
  compact: boolean;
  onGoTo: (n: NoteEntry) => void;
  onDelete: (n: NoteEntry) => void;
}) {
  const tk = useTokens();
  const openName = useNodeGraphStore(s => s.currentGraph?.name ?? null);
  const dirty = useNodeGraphStore(s => s.graphDirty);
  const collection = useMemo(() => {
    const st = useNodeGraphStore.getState();
    const open = st.currentGraph || st.nodes.length ? { name: st.currentGraph?.name ?? null, dirty: st.graphDirty || !st.currentGraph, nodes: st.nodes, play: st.play } : null;
    return collectNotes(localMutableKV, { open, labelOf });
    // `inv` stands for "storage changed"; the open graph's name and dirty flag for "the open graph changed".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv, openName, dirty]);
  const stats = useMemo(() => notesStats(collection), [collection]);

  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<NoteKind | 'all'>('all');
  const [graph, setGraph] = useState<string>('\u0000all');
  const [sort, setSort] = useState<NoteSort>('graph');
  const shown = useMemo(() => queryNotes(collection.notes, { search, kind, graph: graph === '\u0000all' ? undefined : graph, sort }), [collection, search, kind, graph, sort]);
  const groups = sort === 'graph' ? groupByGraph(shown) : null;

  const pad = compact ? '14px 12px 40px' : '22px 28px 60px';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 14 : 18, padding: pad, maxWidth: 980, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ width: compact ? 36 : 42, height: compact ? 36 : 42, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}>
          <Icon name="comment" size={19} />
        </span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 style={{ margin: 0, font: `650 ${compact ? 17 : 20}px ${fontFamily.ui}`, letterSpacing: '-0.015em', color: tk.text.primary }}>Notes</h1>
          <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>
            {stats.total ? `${plural(stats.total, 'note')} in ${plural(stats.perGraph.length, 'graph')}: Play notes and node comments. Go to opens one where it lives to edit it.` : 'No notes yet. Write Play notes on the Play page, or comment on a node in the Studio (right-click a node → Comment).'}
          </span>
        </div>
      </div>

      {stats.total > 0 && <StatsPanel stats={stats} compact={compact} onGraph={g => { setGraph(g ?? ''); setSort('graph'); }} />}

      {stats.total > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Field value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes, nodes, graphs, credits" aria-label="Search notes" height={32}
            leading={<Icon name="search" size={14} style={{ color: tk.text.faint }} />} style={{ flex: '1 1 220px' }}
            suffix={search ? <IconButton icon="close" size="sm" label="Clear the search" tooltip={false} onClick={() => setSearch('')} /> : undefined} />
          <Segmented size="sm" ariaLabel="Kind of note" value={kind} onChange={setKind}
            options={[{ value: 'all', label: 'All' }, { value: 'play', label: 'Play notes' }, { value: 'comment', label: 'Comments' }]} />
          <Select ariaLabel="Graph" value={graph} onChange={setGraph} style={{ maxWidth: compact ? '100%' : 220, flex: compact ? '1 1 140px' : undefined }}
            options={[{ value: '\u0000all', label: 'All graphs' }, ...stats.perGraph.map(g => ({ value: g.graph ?? '', label: `${g.label} (${g.count})` }))]} />
          <Select ariaLabel="Sort" value={sort} onChange={v => setSort(v as NoteSort)} style={{ flex: compact ? '1 1 120px' : undefined }}
            options={[{ value: 'graph', label: 'By graph' }, { value: 'date', label: 'Newest first' }, { value: 'length', label: 'Longest first' }]} />
        </div>
      )}

      {stats.total > 0 && !shown.length && <div style={{ padding: '18px 4px', color: tk.text.muted, fontSize: 12.5 }}>No note matches. <button type="button" onClick={() => { setSearch(''); setKind('all'); setGraph('\u0000all'); }} style={{ border: 0, background: 'none', padding: 0, color: tk.accent.text, font: 'inherit', cursor: 'pointer' }}>Show all</button></div>}

      {groups ? groups.map(g => (
        <section key={g.graph ?? '\u0000open'} aria-label={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 26 }}>
            <Icon name="graphs" size={14} style={{ color: tk.text.muted }} />
            <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
            <span style={{ fontSize: 12, color: tk.text.faint, whiteSpace: 'nowrap' }}>{plural(g.notes.length, 'note')}{g.graph != null && g.graph === openName ? ' · open now' : ''}</span>
          </div>
          <div style={{ ...cardStyle(tk), overflow: 'hidden' }}>
            {g.notes.map((n, i) => <NoteRow key={n.id} n={n} first={i === 0} compact={compact} showGraph={false} openName={openName} onGoTo={() => onGoTo(n)} onDelete={() => onDelete(n)} />)}
          </div>
        </section>
      )) : shown.length > 0 && (
        <div style={{ ...cardStyle(tk), overflow: 'hidden' }}>
          {shown.map((n, i) => <NoteRow key={n.id} n={n} first={i === 0} compact={compact} showGraph openName={openName} onGoTo={() => onGoTo(n)} onDelete={() => onDelete(n)} />)}
        </div>
      )}
    </div>
  );
}

function NoteRow({ n, first, compact, showGraph, openName, onGoTo, onDelete }: { n: NoteEntry; first: boolean; compact: boolean; showGraph: boolean; openName: string | null; onGoTo: () => void; onDelete: () => void }) {
  const tk = useTokens();
  const path = ownerPath(n).slice(showGraph ? 0 : 1);
  const isOpen = n.live || (n.graph != null && n.graph === openName);
  const date = n.live ? 'Not saved yet' : when(n.date);
  return (
    <div data-note={n.id} style={{ display: 'flex', gap: 10, padding: compact ? '11px 10px 11px 12px' : '12px 12px 12px 14px', borderTop: first ? 0 : `1px solid ${tk.border.subtle}` }}>
      <Icon name={n.kind === 'play' ? 'play' : 'comment'} size={15} style={{ flexShrink: 0, marginTop: 2, color: n.kind === 'play' ? tk.accent.base : tk.text.muted }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          <span title={ownerPath(n).join(' → ')} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 0, font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>
            {path.map((p, i) => <Crumb key={i} last={i === path.length - 1}>{p}</Crumb>)}
          </span>
          <span style={{ fontSize: 11.5, color: tk.text.faint, whiteSpace: 'nowrap' }}>{[n.kind === 'play' ? '' : 'Comment', date, plural(n.text.length, 'character')].filter(Boolean).join(' · ')}</span>
        </div>
        <div style={{ font: `12.5px/1.5 ${fontFamily.ui}`, color: tk.text.secondary, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          <LinkedText text={previewText(n.text)} linkStyle={{ color: tk.accent.text }} />
        </div>
        {n.credit && <CreditTag source={n.credit} style={{ alignSelf: 'flex-start', maxWidth: '100%', padding: '2px 7px 2px 5px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.08) }} />}
      </div>
      <div style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'flex-end' : 'flex-start', gap: 4, flexShrink: 0 }}>
        <Button size="sm" icon={n.kind === 'play' ? 'play' : 'target'} onClick={onGoTo} title={n.kind === 'play' ? 'Open the graph on the Play page, where its notes are' : 'Open the graph in the Studio and show this node'}>Go to</Button>
        <IconButton icon="trash" size="sm" tone="danger" disabled={isOpen} tooltip={false}
          label={isOpen ? 'This graph is open: change the note there (Go to)' : n.kind === 'play' ? 'Delete these Play notes (you can undo)' : 'Delete this comment (you can undo)'}
          onClick={onDelete} />
      </div>
    </div>
  );
}

function Crumb({ children, last }: { children: ReactNode; last: boolean }) {
  const tk = useTokens();
  return (
    <>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: last ? tk.text.primary : tk.text.muted, fontWeight: last ? 600 : 500 }}>{children}</span>
      {!last && <Icon name="chevR" size={10} style={{ color: tk.text.disabled, flexShrink: 0 }} />}
    </>
  );
}

function StatsPanel({ stats, compact, onGraph }: { stats: ReturnType<typeof notesStats>; compact: boolean; onGraph: (g: string | null) => void }) {
  const tk = useTokens();
  const [allGraphs, setAllGraphs] = useState(false);
  const nodes = stats.nodesWith + stats.nodesWithout;
  const graphs = allGraphs ? stats.perGraph : stats.topGraphs;
  const tile = (value: ReactNode, label: string) => (
    <div style={{ ...cardStyle(tk), padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ font: `650 20px ${fontFamily.ui}`, color: tk.text.primary, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 11.5, color: tk.text.muted }}>{label}</span>
    </div>
  );
  const maxG = Math.max(1, ...stats.perGraph.map(g => g.count));
  const maxN = Math.max(1, ...stats.topNodes.map(g => g.count));
  return (
    <section aria-label="Notes in numbers" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8 }}>
        {tile(stats.total, 'notes in all')}
        {tile(stats.play, stats.play === 1 ? 'graph with Play notes' : 'graphs with Play notes')}
        {tile(stats.comments, stats.comments === 1 ? 'node comment' : 'node comments')}
        {tile(stats.withCredit, stats.withCredit === 1 ? 'with a credit' : 'with credits')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr 1fr', gap: 8 }}>
        <StatCard title={allGraphs ? 'Notes per graph' : 'Most-commented graphs'}
          extra={stats.perGraph.length > 5 ? <button type="button" onClick={() => setAllGraphs(v => !v)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `500 11.5px ${fontFamily.ui}` }}>{allGraphs ? 'Top 5' : `All ${stats.perGraph.length}`}</button> : undefined}>
          {graphs.map(g => <BarRow key={g.graph ?? '\u0000'} label={g.label} value={g.count} max={maxG} onClick={() => onGraph(g.graph)} />)}
        </StatCard>
        <StatCard title="Most-commented nodes">
          {stats.topNodes.length ? stats.topNodes.map(n => <BarRow key={n.label} label={n.label} value={n.count} max={maxN} />) : <span style={{ fontSize: 12, color: tk.text.faint }}>No node comments yet</span>}
        </StatCard>
        <StatCard title="Nodes with comments">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ font: `650 18px ${fontFamily.ui}`, color: tk.text.primary }}>{stats.nodesWith}</span>
            <span style={{ fontSize: 12, color: tk.text.muted }}>of {plural(nodes, 'node')} in your graphs</span>
          </div>
          <div role="img" aria-label={`${stats.nodesWith} nodes with a comment, ${stats.nodesWithout} without`} style={{ height: 8, borderRadius: 4, background: tk.bg.field, overflow: 'hidden', display: 'flex' }}>
            <span style={{ width: `${nodes ? (stats.nodesWith / nodes) * 100 : 0}%`, minWidth: stats.nodesWith ? 4 : 0, background: tk.accent.base }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: tk.text.muted }}>
            <span>With: {stats.nodesWith}</span><span>Without: {stats.nodesWithout}</span>
          </div>
        </StatCard>
      </div>
    </section>
  );
}

function StatCard({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ ...cardStyle(tk), padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...capsLabel(tk), flex: 1 }}>{title}</span>
        {extra}
      </div>
      {children}
    </div>
  );
}

function BarRow({ label, value, max, onClick }: { label: string; value: number; max: number; onClick?: () => void }) {
  const tk = useTokens();
  const body = (
    <>
      <span style={{ flex: '0 1 auto', width: '45%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', color: tk.text.secondary }}>{label}</span>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${(value / max) * 100}%`, background: alpha(tk.accent.base, 0.75), borderRadius: 3 }} />
      </span>
      <span style={{ width: 22, textAlign: 'right', font: `600 11.5px ${fontFamily.mono}`, color: tk.text.muted }}>{value}</span>
    </>
  );
  const style = { display: 'flex', alignItems: 'center', gap: 8, font: `500 12px ${fontFamily.ui}`, minWidth: 0, width: '100%' } as const;
  return onClick
    ? <button type="button" onClick={onClick} title={`Show the notes of “${label}”`} style={{ ...style, border: 0, background: 'none', padding: 0, cursor: 'pointer' }}>{body}</button>
    : <div style={style}>{body}</div>;
}
