/**
 * CodeExplorerPanel — the Code Explorer (docs/code-explorer.md).
 *
 * Type a function (`smoothstep`) for the ways it is used, ranked: pattern
 * cards with counts, a sparkline of where they live, their exact variants,
 * merged patterns with holes, and the real instances with jump to source.
 * Or type plain words ("soft circle edge") for the patterns that match.
 * Chains, flow and co-occurrence start folded, one line each.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { C, C_LIGHT, tokenizeLine } from '../glslSyntax';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { queryIndex, rebuildIndex, startExplorer, useExplorerStatus } from '../../codeExplorer/client';
import { explainPattern } from '../../codeExplorer/explain';
import { jumpToSource } from '../../codeExplorer/jumpRun';
import type { Count, FunctionReport, Instance, IndexSummary, PatternCard, SearchHit, QueryScope } from '../../codeExplorer/queries';
import type { Origin, SourceKind } from '../../codeExplorer/types';

type Scope = 'all' | 'mine' | 'examples';
const SCOPES: Record<Scope, QueryScope> = {
  all: {},
  mine: { origins: ['saved', 'open', 'linked', 'workspace', 'presentation'] },
  examples: { origins: ['example'] },
};

const KIND_WORDS: Record<SourceKind, string> = {
  expr: 'Expression Block', customFn: 'Custom Function', inputExpr: 'Input expression', generated: 'Generated', nodeLib: 'Node library',
  shader: 'Shader', preset: 'Preset', import: 'Convert', file: 'File', present: 'Present', corpus: 'Corpus',
};
const ORIGIN_WORDS: Record<Origin, string> = { example: 'Example', saved: 'Saved', open: 'Open graph', linked: 'Linked folder', workspace: 'Workspace', presentation: 'Presentation' };

const fmt = (n: number) => (Math.abs(n) >= 100 || Number.isInteger(n) ? String(Math.round(n * 100) / 100) : n.toFixed(Math.abs(n) < 0.1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, ''));
const isIdent = (s: string) => /^[A-Za-z_]\w*$/.test(s);

/** Remembered per section: folded or open (collapsed by default). */
function useFold(key: string, initial = false): [boolean, () => void] {
  const k = `code-explorer:fold:${key}`;
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(k); return v == null ? initial : v === '1'; } catch { return initial; } });
  return [open, () => setOpen(o => { try { localStorage.setItem(k, o ? '0' : '1'); } catch { /* per session */ } return !o; })];
}

export function CodeExplorerPanel({ initialQuery = '', queryKey = 0, compact = false, autoFocus = false }: { initialQuery?: string; queryKey?: number; compact?: boolean; autoFocus?: boolean }) {
  const tk = useTokens();
  const status = useExplorerStatus();
  const [text, setText] = useState(initialQuery);
  const [scope, setScope] = useState<Scope>(() => { try { return (localStorage.getItem('code-explorer:scope') as Scope) || 'all'; } catch { return 'all'; } });
  const [withFn, setWithFn] = useState<string | undefined>();
  const [report, setReport] = useState<FunctionReport | null>(null);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [summary, setSummary] = useState<IndexSummary | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [focusL2, setFocusL2] = useState<string | null>(null);

  useEffect(() => { void startExplorer(); }, []);
  useEffect(() => { setText(initialQuery); setWithFn(undefined); setFocusL2(null); }, [initialQuery, queryKey]);
  useEffect(() => { try { localStorage.setItem('code-explorer:scope', scope); } catch { /* per session */ } }, [scope]);

  const q = text.trim();
  useEffect(() => {
    let live = true;
    const sc = SCOPES[scope];
    const t = setTimeout(async () => {
      try {
        if (!q) {
          const r = await queryIndex({ q: 'summary', scope: sc });
          if (live) { setSummary(r.result); setReport(null); setHits(null); setMs(r.ms); }
          return;
        }
        if (isIdent(q)) {
          const r = await queryIndex({ q: 'function', fn: q, scope: sc, withFn });
          if (!live) return;
          if (r.result.calls > 0) { setReport(r.result); setHits(null); setMs(r.ms); return; }
        }
        const s = await queryIndex({ q: 'search', text: q, scope: sc });
        if (live) { setHits(s.result); setReport(null); setMs(s.ms); }
      } catch (e) { console.warn('[code explorer]', e); }
    }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [q, scope, withFn, status.revision]);

  const init = status.init;
  const busy = status.busy > 0 || status.phase === 'starting';
  const syncMs = (status.syncs.examples?.ms ?? 0) + (status.syncs.user?.ms ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', background: tk.bg.panel, color: tk.text.primary }}>
      <div style={{ padding: compact ? '10px 12px 8px' : '14px 16px 10px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: `1px solid ${tk.border.subtle}` }}>
        <Field
          autoFocus={autoFocus}
          leading={<Icon name="search" size={15} style={{ color: tk.text.faint }} />}
          placeholder="A function (smoothstep) or plain words (soft circle edge)"
          aria-label="Search code"
          value={text}
          onChange={e => { setText(e.target.value); setWithFn(undefined); setFocusL2(null); }}
          height={34}
          mono
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Segmented size="sm" ariaLabel="Where to look" value={scope} onChange={setScope} options={[{ value: 'all', label: 'Everything' }, { value: 'mine', label: 'Mine' }, { value: 'examples', label: 'Examples' }]} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: tk.text.faint }} data-testid="explorer-status">
            {status.phase === 'error' ? `Index unavailable: ${status.error}` : busy ? 'Indexing…' : init ? `Written code · ${ms != null ? `query ${fmt(ms)} ms` : ''}${syncMs ? ` · indexed ${fmt(syncMs)} ms` : ''}` : ''}
          </span>
          <button type="button" title="Throw the index away and build it again" onClick={() => void rebuildIndex()} disabled={busy}
            style={{ border: 0, background: 'none', padding: 0, cursor: busy ? 'default' : 'pointer', color: tk.accent.text, font: `500 11px ${fontFamily.ui}` }}>Rebuild</button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: compact ? '10px 12px 16px' : '14px 16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!q && summary && <Home summary={summary} onPick={fn => setText(fn)} />}
        {report && <Report report={report} withFn={withFn} onWith={setWithFn} focusL2={focusL2} />}
        {hits && <Hits hits={hits} query={q} onOpen={h => { setText(h.callee); setFocusL2(h.l2); }} />}
      </div>
    </div>
  );
}

// ── Home ───────────────────────────────────────────────────────────────────

function Home({ summary, onPick }: { summary: IndexSummary; onPick: (fn: string) => void }) {
  const tk = useTokens();
  const origins = Object.entries(summary.byOrigin).map(([o, n]) => `${n} ${ORIGIN_WORDS[o as Origin]?.toLowerCase() ?? o}`).join(' · ');
  return (
    <>
      <Note>{summary.sites.toLocaleString()} calls in {summary.docs} {summary.docs === 1 ? 'place' : 'places'} you can open{origins ? ` (${origins})` : ''}. Everything stays on this device.</Note>
      <SectionTitle>Most-called functions</SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {summary.top.map(c => <ChipButton key={c.key} onClick={() => onPick(c.key)} label={c.key} count={c.count} />)}
      </div>
      <Note>Try plain words too: <Code>soft circle edge</Code>, <Code>random</Code>, <Code>repeat tile</Code>. In the Expression Block and Custom Function editors, put the caret on a function and press <b>How is this used?</b>; in the Functions panel, right-click a function.</Note>
      <span style={{ fontSize: 11, color: tk.text.faint }}>Phase 1 searches written code: Expression Blocks, Custom Functions, input expressions, presets, shaders, Convert sources, linked .glsl files and Present code blocks. Generated code comes later.</span>
    </>
  );
}

// ── Function report ────────────────────────────────────────────────────────

function Report({ report, withFn, onWith, focusL2 }: { report: FunctionReport; withFn?: string; onWith: (fn: string | undefined) => void; focusL2: string | null }) {
  const tk = useTokens();
  const chainSummary = report.chains.slice(0, 2).map(c => `${c.key === report.fn ? 'standalone' : c.key} ${c.count}`).join(' · ');
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ font: `650 16px ${fontFamily.mono}` }}>{report.fn}</span>
        <span style={{ fontSize: 12.5, color: tk.text.muted }} data-testid="explorer-header"><b>{report.calls}</b> {report.calls === 1 ? 'call' : 'calls'} in <b>{report.docs}</b> {report.docs === 1 ? 'place' : 'places'} · written · {report.patterns.length} {report.patterns.length === 1 ? 'pattern' : 'patterns'}</span>
        {withFn && <ChipButton active label={`with ${withFn} ✕`} onClick={() => onWith(undefined)} title="Show every use again" />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {report.patterns.map((p, i) => <PatternCardView key={p.l2} card={p} buckets={report.buckets} rank={i + 1} startOpen={p.l2 === focusL2} />)}
      </div>
      <Fold id="chains" title="Inside" summary={chainSummary}>
        <Counts items={report.chains.map(c => ({ ...c, key: c.key === report.fn ? `${report.fn} (standalone)` : c.key }))} />
        <SectionTitle>Statement</SectionTitle>
        <Counts items={report.statements} />
      </Fold>
      <Fold id="flow" title="Flow" summary={report.flows.slice(0, 2).map(f => `${f.key} ${f.count}`).join(' · ')}>
        <Note>What feeds it → it → what its value goes into. “·” is an input or nothing; “(arith)” is plain arithmetic.</Note>
        <Counts items={report.flows} />
      </Fold>
      <Fold id="same" title="Used alongside" summary={report.sameLine.slice(0, 4).map(c => `${c.key} ${c.count}`).join(' · ')}>
        <SectionTitle>Same statement (click to narrow)</SectionTitle>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {report.sameLine.map(c => <ChipButton key={c.key} label={c.key} count={c.count} active={withFn === c.key} onClick={() => onWith(withFn === c.key ? undefined : c.key)} />)}
        </div>
        <SectionTitle>Same node or function (lift: how much more often than chance)</SectionTitle>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {report.sameFn.map(c => <ChipButton key={c.key} label={c.key} count={c.count} title={`lift ${fmt(c.lift ?? 1)}×`} onClick={() => onWith(c.key)} />)}
        </div>
      </Fold>
    </>
  );
}

function PatternCardView({ card, buckets, rank, startOpen }: { card: PatternCard; buckets: string[]; rank: number; startOpen: boolean }) {
  const tk = useTokens();
  const info = useMemo(() => explainPattern({ callee: card.callee, l2: card.l2, l1: card.variants[0]?.l1, sample: card.sample }), [card]);
  const [show, setShow] = useState<'none' | 'variants' | 'instances'>(startOpen || rank === 1 ? 'instances' : 'none');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (startOpen) ref.current?.scrollIntoView({ block: 'nearest' }); }, [startOpen]);
  const instances = card.variants.flatMap(v => v.instances);
  const spread = card.literals.map(l => `arg ${l.arg + 1}: ${l.min === l.max ? fmt(l.median) : `median ${fmt(l.median)} (${fmt(l.min)} → ${fmt(l.max)})`}`).join(' · ');
  const toggle = (k: 'variants' | 'instances') => setShow(s => (s === k ? 'none' : k));
  return (
    <div ref={ref} data-testid="pattern-card" style={{ border: `1px solid ${startOpen ? tk.accent.base : tk.border.default}`, borderRadius: radius.lg, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, background: tk.bg.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: `600 13px ${fontFamily.ui}`, flex: 1, minWidth: 0 }}>{info?.name ?? <span style={{ color: tk.text.muted, fontWeight: 500 }}>Unnamed pattern</span>}</span>
        <span style={{ font: `650 14px ${fontFamily.ui}` }}>{card.count}</span>
        <Sparkline values={card.spark} labels={buckets} />
        <span style={{ fontSize: 11, color: tk.text.faint, whiteSpace: 'nowrap' }}>{card.docs} {card.docs === 1 ? 'place' : 'places'}</span>
      </div>
      <code style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.secondary, overflowWrap: 'anywhere' }}>{card.l2}</code>
      {info?.phrase && <span style={{ fontSize: 12, color: tk.text.muted }}>{info.phrase}</span>}
      {(spread || card.flipped > 0) && (
        <span style={{ fontSize: 11.5, color: tk.text.muted }}>
          {spread}{spread && card.flipped > 0 ? ' · ' : ''}{card.flipped > 0 ? `${card.flipped} of ${card.count} flipped (1.0 − …)` : ''}
        </span>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <LinkButton open={show === 'variants'} onClick={() => toggle('variants')}>{card.variants.length} {card.variants.length === 1 ? 'variant' : 'variants'}{card.merged.length ? ` · ${card.merged.length} merged` : ''}</LinkButton>
        <LinkButton open={show === 'instances'} onClick={() => toggle('instances')}>{card.count} {card.count === 1 ? 'instance' : 'instances'}</LinkButton>
      </div>
      {show === 'variants' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}>
          {card.merged.map(m => (
            <div key={m.l3} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }} title={`Merged from:\n${m.variants.join('\n')}`}>
              <Tag>merged</Tag><code style={{ font: `500 11.5px ${fontFamily.mono}`, flex: 1 }}>{m.l3}</code><span style={{ fontSize: 11.5 }}>{m.count}</span>
            </div>
          ))}
          {card.variants.map(v => (
            <div key={v.l1} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <Tag>exact</Tag><code style={{ font: `500 11.5px ${fontFamily.mono}`, flex: 1, overflowWrap: 'anywhere' }}>{v.l1}</code><span style={{ fontSize: 11.5 }}>{v.count}</span>
            </div>
          ))}
        </div>
      )}
      {show === 'instances' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {instances.map((inst, i) => <InstanceRow key={i} inst={inst} />)}
          {instances.length < card.count && <Note>Showing {instances.length} of {card.count}.</Note>}
        </div>
      )}
    </div>
  );
}

export function InstanceRow({ inst }: { inst: Instance }) {
  const tk = useTokens();
  const p = inst.prov;
  const where = [p.docLabel, p.nodeLabel, p.field.startsWith('lines[') || p.field === 'result' ? `line ${p.line}` : `${p.field === 'code' ? '' : `${p.field} · `}line ${p.line}`].filter(Boolean).join(' · ');
  return (
    <div data-testid="instance" style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', borderRadius: radius.md, background: tk.bg.field }}>
      <HighlightedLine text={inst.text} hs={inst.hs} he={inst.he} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Tag>{KIND_WORDS[p.sourceKind]}</Tag>
        <span style={{ fontSize: 11.5, color: tk.text.muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${ORIGIN_WORDS[p.origin]} · ${where}`}>{where}</span>
        <Button size="sm" variant="ghost" title="Open where it is written" onClick={() => void jumpToSource({ ...p, length: inst.he - inst.hs })}>Open</Button>
      </div>
    </div>
  );
}

/** One line of code, coloured like the editors, with the call's span marked. */
export function HighlightedLine({ text, hs, he }: { text: string; hs: number; he: number }) {
  const tk = useTokens();
  const pal = useThemeMode() === 'dark' ? C : C_LIGHT;
  const parts: ReactNode[] = [];
  let at = 0;
  tokenizeLine(text, pal).forEach((t, i) => {
    const s = at, e = at + t.text.length;
    at = e;
    // Split a token across the marked span's edges.
    const cuts = [s, Math.max(s, Math.min(e, hs)), Math.max(s, Math.min(e, he)), e];
    for (let c = 0; c < 3; c++) {
      const a = cuts[c], b = cuts[c + 1];
      if (b <= a) continue;
      const marked = a >= hs && b <= he;
      parts.push(<span key={`${i}-${c}`} style={{ color: t.color, background: marked ? alpha(tk.accent.base, 0.18) : undefined }}>{text.slice(a, b)}</span>);
    }
  });
  return <code style={{ font: `500 12px ${fontFamily.mono}`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{parts}</code>;
}

function Sparkline({ values, labels }: { values: number[]; labels: string[] }) {
  const tk = useTokens();
  const max = Math.max(1, ...values);
  const w = Math.max(24, values.length * 4);
  const title = values.map((v, i) => (v ? `${labels[i]}: ${v}` : '')).filter(Boolean).join('\n');
  return (
    <svg width={w} height={16} viewBox={`0 0 ${w} 16`} role="img" aria-label={`Where it is used: ${title.replace(/\n/g, ', ')}`} style={{ flexShrink: 0 }}>
      <title>{title}</title>
      {values.map((v, i) => (
        <rect key={i} x={i * (w / values.length) + 0.5} width={Math.max(1, w / values.length - 1)} y={16 - (v ? Math.max(2, (v / max) * 16) : 1)} height={v ? Math.max(2, (v / max) * 16) : 1} rx={0.5}
          fill={v ? tk.accent.base : tk.border.default} />
      ))}
    </svg>
  );
}

// ── Search hits ────────────────────────────────────────────────────────────

function Hits({ hits, query, onOpen }: { hits: SearchHit[]; query: string; onOpen: (h: SearchHit) => void }) {
  const tk = useTokens();
  if (!hits.length) return <Note>Nothing matches “{query}”. Try a function name, or other words.</Note>;
  return (
    <>
      <Note>Patterns that match “{query}” (with synonyms), best first.</Note>
      {hits.map(h => {
        const info = explainPattern({ callee: h.callee, l2: h.l2, l1: h.sample.l1, sample: h.sample.text });
        return (
          <button key={`${h.callee}|${h.l2}`} type="button" data-testid="search-hit" onClick={() => onOpen(h)}
            style={{ textAlign: 'left', border: `1px solid ${tk.border.default}`, borderRadius: radius.lg, background: tk.bg.panel, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5, cursor: 'pointer', color: tk.text.primary }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ font: `600 13px ${fontFamily.ui}`, flex: 1 }}>{info?.name ?? h.callee}</span>
              <span style={{ fontSize: 12 }}><b>{h.count}</b> in {h.docs}</span>
            </div>
            <code style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.secondary }}>{h.l2}</code>
            <HighlightedLine text={h.sample.text} hs={h.sample.hs} he={h.sample.he} />
            <span style={{ fontSize: 11, color: tk.text.faint }}>matched: {h.matched.join(', ')}</span>
          </button>
        );
      })}
    </>
  );
}

// ── Small parts ────────────────────────────────────────────────────────────

function Fold({ id, title, summary, children }: { id: string; title: string; summary: string; children: ReactNode }) {
  const tk = useTokens();
  const [open, toggle] = useFold(id);
  return (
    <div style={{ borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" aria-expanded={open} onClick={toggle}
        style={{ display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.primary, textAlign: 'left' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={14} />
        <span style={{ font: `600 12.5px ${fontFamily.ui}` }}>{title}</span>
        {!open && <span style={{ fontSize: 11.5, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1, fontFamily: fontFamily.mono }}>{summary}</span>}
      </button>
      {open && children}
    </div>
  );
}

function Counts({ items }: { items: Count[] }) {
  const tk = useTokens();
  const max = Math.max(1, ...items.map(i => i.count));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {items.map(i => (
        <div key={i.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 80px 28px', gap: 8, alignItems: 'center' }}>
          <code style={{ font: `500 11.5px ${fontFamily.mono}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.key}>{i.key}</code>
          <span style={{ height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(i.count / max) * 100}%`, background: tk.accent.base }} /></span>
          <span style={{ fontSize: 11.5, textAlign: 'right' }}>{i.count}</span>
        </div>
      ))}
    </div>
  );
}

function ChipButton({ label, count, onClick, active = false, title }: { label: string; count?: number; onClick: () => void; active?: boolean; title?: string }) {
  const tk = useTokens();
  return (
    <button type="button" onClick={onClick} title={title}
      style={{ height: 26, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', border: 0, borderRadius: radius.md - 1, cursor: 'pointer',
        background: active ? tk.bg.selected : tk.bg.field, boxShadow: `inset 0 0 0 1px ${active ? tk.accent.base : tk.border.default}`, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}` }}>
      {label}{count != null && <span style={{ color: tk.text.faint }}>{count}</span>}
    </button>
  );
}

function LinkButton({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  const tk = useTokens();
  return (
    <button type="button" aria-expanded={open} onClick={onClick} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `500 12px ${fontFamily.ui}`, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Icon name={open ? 'chevD' : 'chevR'} size={12} />{children}
    </button>
  );
}

function Tag({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', padding: '1px 6px', borderRadius: 4, background: tk.bg.hover, color: tk.text.muted, whiteSpace: 'nowrap' }}>{children}</span>;
}

function Note({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.5 }}>{children}</span>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>{children}</span>;
}

function Code({ children }: { children: ReactNode }) {
  return <code style={{ fontFamily: fontFamily.mono, fontSize: 11.5 }}>{children}</code>;
}
