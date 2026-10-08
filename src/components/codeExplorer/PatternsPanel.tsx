/**
 * PatternsPanel — the Code Explorer's Patterns view (src/patterns, docs/reports/pattern-discovery.md).
 *
 * One level up from functions: multi-node techniques (ways to attenuate light, to tile space…),
 * found across the examples, the saved graphs and the open graph. Families → techniques, each with
 * its explanation, maths and variants side by side, and the graphs that use it: clicking one opens it
 * with the matched nodes selected. Families start folded with a summary line (remembered per family);
 * "Patterns this is part of" (a node's right-click menu) shows that node's techniques on top.
 * Loaded lazily with the tab: the index is built when the view opens.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Choice';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { EXAMPLE_FOLDERS, loadExampleGraphs } from '../../store/exampleIndex';
import { isGraphEntry } from '../../files/inventory';
import { getNodeDefinition } from '../../nodes/definitions';
import { FAMILIES, TECHNIQUES, type FamilyId, type Technique } from '../../patterns/catalogue';
import { analyseGraph, buildPatternIndex, familySummary, findTechniques, techniquesAtNode, type GraphInput, type GraphPatterns, type PatternIndex, type TechniqueHit } from '../../patterns/patternIndex';
import { minePatterns } from '../../patterns/mine';
import { toDataflow } from '../../patterns/dataflow';
import { rankCandidates, type Candidate } from '../../patterns/candidates';
import { openGraphSelecting } from '../../codeExplorer/jumpRun';
import type { GraphRef } from '../../codeExplorer/jump';

type Scope = 'all' | 'mine' | 'examples';

const SAVED_PREFIX = 'shader-studio:';

function savedGraphs(): GraphInput[] {
  const out: GraphInput[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(SAVED_PREFIX)) continue;
      let v: unknown;
      try { v = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { continue; }
      if (!isGraphEntry(key, v)) continue;
      const name = key.slice(SAVED_PREFIX.length);
      out.push({ id: `saved:${name}`, label: name, origin: 'saved', folder: 'Saved graphs', nodes: (v as { nodes: GraphInput['nodes'] }).nodes });
    }
  } catch { /* storage unavailable: examples only */ }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function refOf(graphId: string): GraphRef {
  if (graphId.startsWith('example:')) return { kind: 'example', key: graphId.slice('example:'.length) };
  if (graphId.startsWith('saved:')) return { kind: 'saved', name: graphId.slice('saved:'.length) };
  return { kind: 'open' };
}

/** Remembered per section: folded or open (folded by default). */
function useFold(key: string, initial = false): [boolean, () => void] {
  const k = `patterns:fold:${key}`;
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(k); return v == null ? initial : v === '1'; } catch { return initial; } });
  return [open, () => setOpen(o => { try { localStorage.setItem(k, o ? '0' : '1'); } catch { /* per session */ } return !o; })];
}

export function PatternsPanel({ patternNode }: { patternNode: string | null }) {
  const tk = useTokens();
  const [examples, setExamples] = useState<GraphInput[] | null>(null);
  const [scope, setScope] = useState<Scope>(() => { try { return (localStorage.getItem('patterns:scope') as Scope) || 'all'; } catch { return 'all'; } });
  const [text, setText] = useState('');
  const openNodes = useNodeGraphStore(s => s.nodes);
  const graphName = useNodeGraphStore(s => s.currentGraph?.name ?? null);

  useEffect(() => { try { localStorage.setItem('patterns:scope', scope); } catch { /* per session */ } }, [scope]);
  useEffect(() => {
    let live = true;
    void loadExampleGraphs().then(all => {
      if (!live) return;
      const folderOf = new Map<string, string>();
      for (const f of EXAMPLE_FOLDERS) for (const k of f.keys) if (!folderOf.has(k)) folderOf.set(k, f.label);
      setExamples(Object.entries(all).filter(([k]) => k !== 'blank').map(([k, g]) => ({ id: `example:${k}`, label: g.label || k, origin: 'example', folder: folderOf.get(k) ?? 'Other examples', nodes: g.nodes })));
    });
    return () => { live = false; };
  }, []);

  const saved = useMemo(() => savedGraphs(), []);
  const index: PatternIndex | null = useMemo(() => {
    if (!examples) return null;
    const list = scope === 'examples' ? examples : scope === 'mine' ? saved : [...saved, ...examples];
    return buildPatternIndex(list);
  }, [examples, saved, scope]);

  // The open graph, for "Patterns this is part of".
  const openPatterns: GraphPatterns | null = useMemo(() => (patternNode ? analyseGraph({ id: 'open:', label: graphName ?? 'Open graph', origin: 'open', nodes: openNodes }) : null), [patternNode, openNodes, graphName]);
  const atNode = openPatterns && patternNode ? techniquesAtNode(openPatterns, patternNode) : null;
  const focusNode = patternNode ? openNodes.find(n => n.id === patternNode) : undefined;
  const nodeLabel = patternNode ? (focusNode?.params?.label as string | undefined) || (focusNode && getNodeDefinition(focusNode.type)?.label) || focusNode?.type || 'This node' : '';

  const q = text.trim();
  const matched = useMemo(() => (q ? new Set(findTechniques(q).map(t => t.id)) : null), [q]);
  const summary = useMemo(() => (index ? familySummary(index) : []), [index]);
  const withAny = index ? index.graphs.filter(g => g.techniques.length).length : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', background: tk.bg.panel, color: tk.text.primary }}>
      <div style={{ padding: '14px 16px 10px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: `1px solid ${tk.border.subtle}` }}>
        <Field
          leading={<Icon name="search" size={15} style={{ color: tk.text.faint }} />}
          placeholder="A technique (wave interference, glow, tile, warp…)"
          aria-label="Find a technique"
          value={text}
          onChange={e => setText(e.target.value)}
          height={34}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Segmented size="sm" ariaLabel="Which graphs" value={scope} onChange={setScope} options={[{ value: 'all', label: 'Everything' }, { value: 'mine', label: 'Mine' }, { value: 'examples', label: 'Examples' }]} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: tk.text.faint }} data-testid="patterns-status">
            {index ? `${index.graphs.length} graphs · ${withAny} use a technique · ${Math.round(index.ms)} ms` : 'Reading the graphs…'}
          </span>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {patternNode && (
          <div data-testid="patterns-at-node" style={{ border: `1px solid ${tk.accent.base}`, borderRadius: radius.lg, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: `600 13px ${fontFamily.ui}` }}>Patterns <Code>{nodeLabel}</Code> is part of</span>
            {atNode && atNode.length ? atNode.map(({ technique, hits }) => (
              <div key={technique.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{technique.name}</span>
                <span style={{ fontSize: 11.5, color: tk.text.faint }}>{FAMILIES.find(f => f.id === technique.family)?.name} · {[...new Set(hits.map(h => technique.variants.find(v => v.id === h.variant)?.name))].join(', ')}</span>
                <span style={{ fontSize: 12, color: tk.text.muted, flexBasis: '100%' }}>{technique.explain}</span>
              </div>
            )) : <Note>Not part of a named technique yet.</Note>}
          </div>
        )}
        {!index && <Note>Reading the examples…</Note>}
        {index && summary.map(f => {
          const ts = f.techniques.filter(t => !matched || matched.has(t.technique.id));
          if (!ts.length) return null;
          return <FamilyFold key={f.family.id} id={f.family.id} forceOpen={!!matched} title={f.family.name}
            summary={`${f.techniques.length} ${f.family.ways} · ${f.graphs} ${f.graphs === 1 ? 'graph' : 'graphs'}`} line={f.family.line}>
            {ts.map(t => <TechniqueCard key={t.technique.id} technique={t.technique} index={index} />)}
          </FamilyFold>;
        })}
        {index && matched && matched.size === 0 && <Note>No technique matches “{q}”. Try glow, tile, warp, ripple, palette.</Note>}
        {index && !matched && <CandidatesFold index={index} graphs={scope === 'mine' ? saved : scope === 'examples' ? examples ?? [] : [...saved, ...(examples ?? [])]} />}
      </div>
    </div>
  );
}

function FamilyFold({ id, title, summary, line, forceOpen, children }: { id: FamilyId; title: string; summary: string; line: string; forceOpen: boolean; children: ReactNode }) {
  const tk = useTokens();
  const [open, toggle] = useFold(`family:${id}`);
  const shown = open || forceOpen;
  return (
    <div data-testid={`patterns-family-${id}`} style={{ border: `1px solid ${tk.border.default}`, borderRadius: radius.lg, background: tk.bg.panel }}>
      <button type="button" aria-expanded={shown} onClick={toggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: 0, background: 'none', cursor: 'pointer', color: tk.text.primary, textAlign: 'left' }}>
        <Icon name={shown ? 'chevD' : 'chevR'} size={13} style={{ color: tk.text.faint }} />
        <span style={{ font: `600 13px ${fontFamily.ui}` }}>{title}</span>
        <span style={{ fontSize: 11.5, color: tk.text.faint, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
      </button>
      {shown && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Note>{line}</Note>
          {children}
        </div>
      )}
    </div>
  );
}

function TechniqueCard({ technique: t, index }: { technique: Technique; index: PatternIndex }) {
  const tk = useTokens();
  const users = index.byTechnique.get(t.id) ?? [];
  const [variant, setVariant] = useState<string | null>(null);
  const [showGraphs, setShowGraphs] = useState(false);
  const [all, setAll] = useState(false);
  const list = variant ? users.filter(u => u.hits.some(h => h.variant === variant)) : users;
  const slots = `${t.slots.in.map(s => s.name).join(' · ') || 'nothing'} → ${t.slots.out.map(s => s.name).join(' · ')}`;
  return (
    <div data-testid="technique-card" style={{ border: `1px solid ${tk.border.subtle}`, borderRadius: radius.md, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, background: tk.bg.subtle }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ font: `600 13px ${fontFamily.ui}`, flex: 1, minWidth: 0 }}>{t.name}</span>
        <span style={{ fontSize: 11.5, color: users.length ? tk.text.muted : tk.text.faint }}>{users.length} {users.length === 1 ? 'graph' : 'graphs'}</span>
      </div>
      <span style={{ fontSize: 12, lineHeight: 1.5, color: tk.text.muted }}>{t.explain}</span>
      <code style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.secondary }}>{t.maths}</code>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
        {t.variants.map(v => {
          const n = users.filter(u => u.hits.some(h => h.variant === v.id)).length;
          const on = variant === v.id;
          return (
            <button key={v.id} type="button" disabled={!n} onClick={() => { setVariant(on ? null : v.id); setShowGraphs(true); }}
              title={n ? (on ? 'Show every graph again' : 'Only the graphs using this variant') : 'Not in these graphs yet'}
              style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', border: 0, borderRadius: radius.md - 1, cursor: n ? 'pointer' : 'default',
                background: on ? tk.bg.selected : tk.bg.field, boxShadow: `inset 0 0 0 1px ${on ? tk.accent.base : tk.border.default}`, color: n ? tk.text.primary : tk.text.faint, opacity: n ? 1 : 0.7 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>{v.name}</span>
              {v.maths && <code style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.muted }}>{v.maths}</code>}
              <span style={{ fontSize: 10.5, color: tk.text.faint }}>{n} {n === 1 ? 'graph' : 'graphs'}</span>
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 11, color: tk.text.faint }} title="The slots a future “apply technique” would wire">Takes {slots}</span>
      {users.length > 0 && (
        <button type="button" aria-expanded={showGraphs} onClick={() => setShowGraphs(s => !s)}
          style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `500 12px ${fontFamily.ui}`, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <Icon name={showGraphs ? 'chevD' : 'chevR'} size={12} />{variant ? `Graphs with ${t.variants.find(v => v.id === variant)?.name}` : 'Graphs'} ({list.length})
        </button>
      )}
      {showGraphs && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(all ? list : list.slice(0, 12)).map(u => <GraphChip key={u.graph.graphId} graph={u.graph} hits={variant ? u.hits.filter(h => h.variant === variant) : u.hits} />)}
          {!all && list.length > 12 && <button type="button" onClick={() => setAll(true)} style={{ border: 0, background: 'none', cursor: 'pointer', color: tk.accent.text, fontSize: 11.5 }}>+{list.length - 12} more</button>}
        </div>
      )}
    </div>
  );
}

function GraphChip({ graph, hits }: { graph: GraphPatterns; hits: TechniqueHit[] }) {
  const tk = useTokens();
  const nodes = hits.flatMap(h => h.nodes);
  const line = hits.find(h => h.line)?.line;
  return (
    <button type="button" data-testid="pattern-graph" onClick={() => void openGraphSelecting(refOf(graph.graphId), nodes)}
      title={`Open it with the ${nodes.length === 1 ? 'node' : `${new Set(nodes.map(n => n.id)).size} nodes`} selected${line ? `\n${line}` : ''}`}
      style={{ height: 26, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', border: 0, borderRadius: radius.md - 1, cursor: 'pointer',
        background: tk.bg.field, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, color: tk.text.primary, font: `500 11.5px ${fontFamily.ui}`, maxWidth: '100%' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{graph.label}</span>
      {graph.folder && <span style={{ color: tk.text.faint, fontSize: 10.5, whiteSpace: 'nowrap' }}>{graph.folder}</span>}
    </button>
  );
}

/** Frequent multi-node clusters no technique names yet: mined when opened. */
function CandidatesFold({ index, graphs }: { index: PatternIndex; graphs: GraphInput[] }) {
  const tk = useTokens();
  const [open, toggle] = useFold('candidates');
  const [cands, setCands] = useState<Candidate[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setCands(null);
    const t = setTimeout(() => setCands(rankCandidates(minePatterns(graphs.map(g => ({ graphId: g.id, df: toDataflow(g.nodes) }))), index, { limit: 15 })), 30);
    return () => clearTimeout(t);
  }, [open, graphs, index]);
  const label = new Map(index.graphs.map(g => [g.graphId, g.label]));
  return (
    <div style={{ border: `1px dashed ${tk.border.default}`, borderRadius: radius.lg }}>
      <button type="button" aria-expanded={open} onClick={toggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: 0, background: 'none', cursor: 'pointer', color: tk.text.primary, textAlign: 'left' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={13} style={{ color: tk.text.faint }} />
        <span style={{ font: `600 13px ${fontFamily.ui}` }}>Unnamed clusters</span>
        <span style={{ fontSize: 11.5, color: tk.text.faint }}>frequent node groups no technique names yet · {TECHNIQUES.length} named</span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!cands && <Note>Mining…</Note>}
          {cands?.map(c => (
            <div key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <code style={{ font: `500 11.5px ${fontFamily.mono}`, overflowWrap: 'anywhere' }}>{c.text}</code>
              <span style={{ fontSize: 11, color: tk.text.faint }}>{c.support} graphs · {c.size} nodes · e.g. {c.graphs.slice(0, 3).map(g => label.get(g) ?? g).join(', ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.5 }}>{children}</span>;
}

function Code({ children }: { children: ReactNode }) {
  return <code style={{ fontFamily: fontFamily.mono, fontSize: 11.5 }}>{children}</code>;
}

export default PatternsPanel;
