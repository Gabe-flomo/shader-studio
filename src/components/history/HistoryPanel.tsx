/**
 * The History panel: the undo history as a timeline of named steps (Changes), and every notice
 * the app has shown this session (Activity). Lives in the sidebar's History tab on desktop and
 * in the Browse sheet on a phone.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { useNodeGraphStore, undoManager } from '../../store/useNodeGraphStore';
import { buildTimeline, diffGraphs, type StepDiff, type TimelineStep } from '../../store/historyLabels';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius, type Tokens } from '../../theme/tokens';
import { Segmented } from '../ui/Choice';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { toneStyle } from '../ui/tone';
import { toast } from '../ui/toastStore';
import { ACTIVITY_CAP, actionAvailable, useActivityStore, useUnseenActivity, type ActivityEntry, type ActivityKind } from '../ui/activityStore';

export type HistoryView = 'changes' | 'activity';

let lastView: HistoryView = 'changes';

/** "just now", "4 min ago", "14:03" — refreshed by the caller's clock tick. */
function whenText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const d = new Date(at);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return new Date(now).toDateString() === d.toDateString() ? hm : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${hm}`;
}

function useClock(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** The graph, but at most every 300 ms: a slider drag doesn't re-describe the history every frame. */
function useThrottledNodes(): GraphNode[] {
  const [nodes, setNodes] = useState(() => useNodeGraphStore.getState().nodes);
  useEffect(() => {
    let timer: number | null = null;
    let last = useNodeGraphStore.getState().nodes;
    const flush = () => { timer = null; setNodes(useNodeGraphStore.getState().nodes); };
    const unsub = useNodeGraphStore.subscribe(s => {
      if (s.nodes === last) return;
      last = s.nodes;
      if (timer === null) timer = window.setTimeout(flush, 300);
    });
    return () => { unsub(); if (timer !== null) window.clearTimeout(timer); };
  }, []);
  return nodes;
}

export function HistoryPanel({ compact = false, onShowOnCanvas }: {
  /** Phone sheet: bigger touch targets, no hover-only controls. */
  compact?: boolean;
  /** After "Show on canvas" (the phone closes its sheet). */
  onShowOnCanvas?: () => void;
}) {
  const [view, setViewState] = useState<HistoryView>(lastView);
  const setView = (v: HistoryView) => { lastView = v; setViewState(v); };
  const unseen = useUnseenActivity();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      <Segmented
        fill
        ariaLabel="History"
        value={view}
        onChange={setView}
        options={[
          { value: 'changes', label: 'Changes' },
          { value: 'activity', label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Activity{unseen.count > 0 && view !== 'activity' && <CountBadge count={unseen.count} error={unseen.error} />}</span> },
        ]}
      />
      {view === 'changes' ? <ChangesView compact={compact} onShowOnCanvas={onShowOnCanvas} /> : <ActivityView compact={compact} />}
    </div>
  );
}

/** The small count pill (rail icon, segment, Browse button). */
export function CountBadge({ count, error = false, style }: { count: number; error?: boolean; style?: CSSProperties }) {
  const tk = useTokens();
  return (
    <span aria-label={`${count} new`} style={{
      minWidth: 16, height: 16, padding: '0 4px', boxSizing: 'border-box', borderRadius: 8,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: error ? tk.status.danger : tk.accent.base, color: tk.bg.panel,
      font: `700 10px/1 ${fontFamily.ui}`, fontVariantNumeric: 'tabular-nums', ...style,
    }}>{count > 99 ? '99+' : count}</span>
  );
}

// ── Changes ──────────────────────────────────────────────────────────────────

function ChangesView({ compact, onShowOnCanvas }: { compact: boolean; onShowOnCanvas?: () => void }) {
  const tk = useTokens();
  const version = useSyncExternalStore(undoManager.subscribe, undoManager.getVersion);
  const nodes = useThrottledNodes();
  const scratch = useNodeGraphStore(s => !!s.scratch);
  const now = useClock();
  const [openId, setOpenId] = useState<number | null>(null);

  const steps = useMemo(() => {
    void version; // the stacks are mutable: the version says when they changed
    return buildTimeline(undoManager.done(), undoManager.undone(), nodes);
  }, [version, nodes]);
  const origin = undoManager.getOrigin();
  const trimmed = undoManager.isTrimmed();
  const doneCount = steps.filter(s => s.status !== 'undone').length;
  const undoneCount = steps.length - doneCount;

  const restore = (step: TimelineStep | null) => {
    const st = useNodeGraphStore.getState();
    const back = step ? step.undoToHere : undoManager.canUndo;
    if (step && step.status === 'undone') {
      const n = st.redoSteps(step.redoToHere);
      if (!n) return;
      const v = undoManager.getVersion();
      toast.info(`Redid ${n} ${n === 1 ? 'step' : 'steps'}`, {
        message: `Back to “${step.label}”.`,
        action: { label: 'Undo', onClick: () => useNodeGraphStore.getState().undoSteps(n), stillValid: () => undoManager.getVersion() === v },
      });
      return;
    }
    const n = st.undoSteps(back);
    if (!n) return;
    const v = undoManager.getVersion();
    toast.info(`Went back ${n} ${n === 1 ? 'step' : 'steps'}`, {
      message: `${step ? `To “${step.label}”.` : 'To the start of the history.'} Redo brings ${n === 1 ? 'it' : 'them'} back.`,
      action: { label: 'Undo', onClick: () => useNodeGraphStore.getState().redoSteps(n), stillValid: () => undoManager.getVersion() === v },
    });
  };

  const showOnCanvas = (ids: string[]) => {
    const st = useNodeGraphStore.getState();
    const top = new Set(st.nodes.map(n => n.id));
    const live = [...new Set(ids)].filter(id => top.has(id));
    if (!live.length) return false;
    if (st.activeGroupPath.length) st.exitToDepth(0);
    st.focusNode(live[0]);
    if (live.length > 1) st.selectNodes(live);
    onShowOnCanvas?.();
    return true;
  };

  const newestFirst = [...steps].reverse();
  const rowH = compact ? 48 : 40;

  if (scratch) {
    return <Note>The Convert page is showing a graph-to-be. Its history starts when you Materialize it.</Note>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 4px 8px', color: tk.text.faint, fontSize: 11.5, lineHeight: 1.4 }}>
        <span style={{ flex: 1 }}>
          {steps.length === 0 ? `Keeps the last ${undoManager.maxDepth} changes.` : `${doneCount} ${doneCount === 1 ? 'change' : 'changes'}${undoneCount ? ` · ${undoneCount} undone` : ''} · keeps the last ${undoManager.maxDepth}`}
        </span>
      </div>
      {steps.length === 0 && (
        <Note>Nothing to undo yet. Each change you make to the graph shows up here, newest first, and you can step back to any of them.</Note>
      )}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
        {newestFirst.map((s, i) => (
          <StepRow
            key={s.id}
            step={s}
            now={now}
            rowH={rowH}
            compact={compact}
            first={i === 0}
            open={openId === s.id}
            onToggle={() => {
              const opening = openId !== s.id;
              setOpenId(opening ? s.id : null);
              if (opening && !compact) showOnCanvas([...s.nodeIds, ...diffGraphs(s.before, s.after).touchedTopIds]);
            }}
            onRestore={() => restore(s)}
            onShow={() => showOnCanvas([...s.nodeIds, ...diffGraphs(s.before, s.after).touchedTopIds])}
          />
        ))}
        {(steps.length > 0 || origin) && (
          <OriginRow
            label={trimmed ? `Older changes aren’t kept` : origin?.label ?? 'Start of this session'}
            at={trimmed ? null : origin?.at ?? null}
            now={now}
            rowH={rowH}
            current={doneCount === 0}
            onRestore={doneCount > 0 ? () => restore(null) : undefined}
            compact={compact}
          />
        )}
      </ol>
    </div>
  );
}

const RAIL_X = 11; // centre of the timeline line, from the row's left edge

function Dot({ status, tk }: { status: TimelineStep['status'] | 'origin'; tk: Tokens }) {
  const current = status === 'current';
  const undone = status === 'undone';
  return (
    <span aria-hidden style={{
      position: 'absolute', left: RAIL_X - (current ? 6 : 4), top: '50%', transform: 'translateY(-50%)',
      width: current ? 12 : 8, height: current ? 12 : 8, borderRadius: '50%', boxSizing: 'border-box',
      background: undone ? tk.bg.panel : current ? tk.accent.base : status === 'origin' ? tk.text.faint : tk.text.muted,
      border: undone ? `1.5px dashed ${tk.text.disabled}` : current ? `2px solid ${tk.bg.panel}` : 'none',
      boxShadow: current ? `0 0 0 2px ${alpha(tk.accent.base, 0.35)}` : 'none',
    }} />
  );
}

function StepRow({ step, now, rowH, compact, first, open, onToggle, onRestore, onShow }: {
  step: TimelineStep; now: number; rowH: number; compact: boolean; first: boolean; open: boolean;
  onToggle: () => void; onRestore: () => void; onShow: () => void;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const undone = step.status === 'undone', current = step.status === 'current';
  const quickAction = !current && hover && !compact && !open;
  return (
    <li style={{ position: 'relative' }}>
      {/* The timeline line: from this row's dot down to the next */}
      <span aria-hidden style={{ position: 'absolute', left: RAIL_X - 1, top: first ? rowH / 2 : 0, bottom: 0, width: 2, background: undone ? 'transparent' : tk.border.default, borderLeft: undone ? `2px dotted ${tk.border.strong}` : 'none', boxSizing: 'border-box' }} />
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ position: 'relative', minHeight: rowH, display: 'flex', alignItems: 'center', gap: 4, borderRadius: radius.md, background: open ? tk.bg.selected : hover ? tk.bg.hover : 'transparent' }}
      >
        <Dot status={step.status} tk={tk} />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          title={step.label}
          style={{
            flex: 1, minWidth: 0, alignSelf: 'stretch', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left',
            padding: `4px 4px 4px ${RAIL_X + 13}px`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1,
          }}
        >
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
            font: `${current ? 600 : 500} ${compact ? 13.5 : 12.5}px ${fontFamily.ui}`,
            color: undone ? tk.text.faint : current ? tk.text.primary : tk.text.secondary,
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{step.label}</span>
          </span>
          <Meta>
            {current && <Pill color={tk.accent.text} bg={alpha(tk.accent.base, 0.14)}>Now</Pill>}
            {undone ? `Undone · ${whenText(step.at, now)}` : whenText(step.at, now)}
          </Meta>
        </button>
        {quickAction && (
          <QuickButton overlay icon={undone ? 'redo' : 'undo'} onClick={onRestore} compact={compact}
            title={undone ? 'Redo every step up to this one' : 'Undo every step after this one (they stay redoable)'}>
            {undone ? 'Redo to here' : 'Restore'}
          </QuickButton>
        )}
      </div>
      {open && <StepDetail step={step} compact={compact} onRestore={onRestore} onShow={onShow} />}
    </li>
  );
}

function OriginRow({ label, at, now, rowH, current, onRestore, compact }: {
  label: string; at: number | null; now: number; rowH: number; current: boolean; onRestore?: () => void; compact: boolean;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <li style={{ position: 'relative' }}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ position: 'relative', minHeight: rowH, display: 'flex', alignItems: 'center', gap: 4, borderRadius: radius.md, background: hover ? tk.bg.hover : 'transparent' }}
      >
        <Dot status={current ? 'current' : 'origin'} tk={tk} />
        <div style={{ flex: 1, minWidth: 0, padding: `4px 4px 4px ${RAIL_X + 13}px`, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `${current ? 600 : 500} ${compact ? 13.5 : 12.5}px ${fontFamily.ui}`, color: current ? tk.text.primary : tk.text.muted }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          </span>
          <Meta>
            {current && <Pill color={tk.accent.text} bg={alpha(tk.accent.base, 0.14)}>Now</Pill>}
            {at ? `Start · ${whenText(at, now)}` : 'Start of the kept history'}
          </Meta>
        </div>
        {onRestore && (hover || compact) && (
          <QuickButton overlay={!compact} icon="undo" onClick={onRestore} compact={compact} title="Undo every step (they stay redoable)">Restore</QuickButton>
        )}
      </div>
    </li>
  );
}

function Meta({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `11px ${fontFamily.ui}`, color: tk.text.faint, whiteSpace: 'nowrap', overflow: 'hidden' }}>{children}</span>;
}

/** The hover button on a row. `overlay` floats it over the row's right end so the label doesn't reflow. */
function QuickButton({ icon, onClick, title, children, compact, overlay = false }: {
  icon: 'undo' | 'redo'; onClick: () => void; title: string; children: ReactNode; compact: boolean; overlay?: boolean;
}) {
  const tk = useTokens();
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        flexShrink: 0, height: compact ? 32 : 26, padding: '0 8px', marginRight: 4, borderRadius: radius.sm, cursor: 'pointer',
        border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.secondary,
        font: `500 11.5px ${fontFamily.ui}`, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
        ...(overlay ? { position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', boxShadow: `-14px 0 10px -4px ${tk.bg.hover}` } : {}),
      }}
    >
      <Icon name={icon} size={13} />{children}
    </button>
  );
}

function Pill({ children, color, bg }: { children: ReactNode; color: string; bg: string }) {
  return (
    <span style={{ flexShrink: 0, height: 15, padding: '0 5px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', background: bg, color, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.02em' }}>{children}</span>
  );
}

const MAX_LINES = 8;

function StepDetail({ step, compact, onRestore, onShow }: { step: TimelineStep; compact: boolean; onRestore: () => void; onShow: () => void }) {
  const tk = useTokens();
  const d = useMemo(() => diffGraphs(step.before, step.after), [step.before, step.after]);
  const lines = detailLines(d, tk);
  const shown = lines.slice(0, MAX_LINES);
  const canShow = useNodeGraphStore(s => {
    const top = new Set(s.nodes.map(n => n.id));
    return [...step.nodeIds, ...d.touchedTopIds].some(id => top.has(id));
  });
  const undone = step.status === 'undone';
  return (
    <div style={{ margin: '2px 0 8px', padding: `8px 10px 10px ${RAIL_X + 13}px`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {shown.length === 0
        ? <span style={{ fontSize: 12, color: tk.text.faint }}>Nothing the graph shows changed (a view or layout detail).</span>
        : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {shown.map((l, i) => <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, font: `12px/1.4 ${fontFamily.ui}`, color: tk.text.secondary, minWidth: 0 }}>{l}</li>)}
            {lines.length > MAX_LINES && <li style={{ fontSize: 11.5, color: tk.text.faint }}>and {lines.length - MAX_LINES} more</li>}
          </ul>
        )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {step.status !== 'current' && (
          <Button size="sm" icon={undone ? 'redo' : 'undo'} onClick={onRestore} style={compact ? { height: 38 } : undefined}
            title={undone ? 'Redo every step up to this one' : 'Undo every step after this one (they stay redoable)'}>
            {undone ? 'Redo to here' : 'Restore to here'}
          </Button>
        )}
        {canShow && <Button size="sm" variant="ghost" icon="target" onClick={onShow} style={compact ? { height: 38 } : undefined}>Show on canvas</Button>}
      </div>
    </div>
  );
}

function Sign({ c, children }: { c: string; children: ReactNode }) {
  return <span aria-hidden style={{ width: 12, flexShrink: 0, textAlign: 'center', color: c, fontWeight: 700 }}>{children}</span>;
}

function Swatch({ rgb, tk }: { rgb: number[]; tk: Tokens }) {
  const c = `rgb(${rgb.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',')})`;
  return <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 3, background: c, border: `1px solid ${tk.border.strong}`, verticalAlign: '-1px' }} />;
}

function detailLines(d: StepDiff, tk: Tokens): ReactNode[] {
  const out: ReactNode[] = [];
  const muted = (t: ReactNode) => <span style={{ color: tk.text.muted }}>{t}</span>;
  const text = (t: ReactNode) => <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{t}</span>;
  for (const r of d.added) out.push(<><Sign c={tk.status.success}>+</Sign>{text(<>Added <b style={{ fontWeight: 600 }}>{r.name}</b></>)}</>);
  for (const r of d.removed) out.push(<><Sign c={tk.status.danger}>−</Sign>{text(<>Removed <b style={{ fontWeight: 600 }}>{r.name}</b></>)}</>);
  for (const p of d.params) {
    const val = p.fromColor && p.toColor
      ? <><Swatch rgb={p.fromColor} tk={tk} /> → <Swatch rgb={p.toColor} tk={tk} /></>
      : p.from !== null && p.to !== null
        ? <><span style={{ color: tk.text.faint, textDecoration: 'line-through' }}>{p.from}</span> → <b style={{ fontWeight: 600 }}>{p.to}</b></>
        : muted('edited');
    out.push(<><Sign c={tk.accent.base}>~</Sign>{text(<>{muted(`${p.name} · `)}{p.label} {val}</>)}</>);
  }
  for (const w of d.wires) {
    out.push(<><Sign c={w.kind === 'added' ? tk.status.success : tk.status.danger}>{w.kind === 'added' ? '+' : '−'}</Sign>{text(<>{w.kind === 'added' ? 'Wired' : 'Unwired'} {w.fromName} {muted(w.fromPort)} → {w.toName} {muted(w.toPort)}</>)}</>);
  }
  for (const o of d.other) out.push(<><Sign c={tk.status.warning}>•</Sign>{text(<>{muted(`${o.name} · `)}{o.what}</>)}</>);
  if (d.moved.length) out.push(<><Sign c={tk.text.faint}>↔</Sign>{text(muted(d.moved.length === 1 ? `Moved ${d.moved[0].name}` : `Moved ${d.moved.length} nodes`))}</>);
  return out;
}

function Note({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <div style={{ fontSize: 12, color: tk.text.faint, padding: '4px 4px 8px', lineHeight: 1.5 }}>{children}</div>;
}

// ── Activity ─────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<ActivityKind, string> = { error: 'Errors', warning: 'Warnings', success: 'Done', info: 'Info' };
const KIND_ORDER: ActivityKind[] = ['error', 'warning', 'success', 'info'];

function ActivityView({ compact }: { compact: boolean }) {
  const tk = useTokens();
  const entries = useActivityStore(s => s.entries);
  const clear = useActivityStore(s => s.clear);
  const [filter, setFilter] = useState<ActivityKind | 'all'>('all');
  const now = useClock();
  // While this list is on screen, what arrives counts as seen
  useEffect(() => useActivityStore.getState().watch(), []);

  const counts = useMemo(() => {
    const c: Record<ActivityKind, number> = { error: 0, warning: 0, success: 0, info: 0 };
    for (const e of entries) c[e.kind]++;
    return c;
  }, [entries]);
  const list = useMemo(() => entries.filter(e => filter === 'all' || e.kind === filter).reverse(), [entries, filter]);
  const current = list.filter(e => !e.earlier), earlier = list.filter(e => e.earlier);
  const kinds = KIND_ORDER.filter(k => counts[k] > 0);

  if (entries.length === 0) {
    return <Note>No notices yet. Everything the app tells you — saved, imported, exported, a Play setup loaded, an error — is kept here for the session.</Note>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 4px 0', color: tk.text.faint, fontSize: 11.5, lineHeight: 1.4 }}>
        <span style={{ flex: 1 }} title={`Keeps the last ${ACTIVITY_CAP} for this session`}>{entries.length} {entries.length === 1 ? 'notice' : 'notices'}</span>
        <button type="button" onClick={() => { clear(); setFilter('all'); }}
          style={{ border: 0, background: 'none', padding: compact ? '8px 0' : 0, cursor: 'pointer', color: tk.text.muted, font: `600 11.5px ${fontFamily.ui}` }}>Clear all</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...(compact ? { overflowX: 'auto', scrollbarWidth: 'none', margin: '0 -16px', padding: '0 16px' } : { flexWrap: 'wrap' }) }}>
        <FilterChip on={filter === 'all'} onClick={() => setFilter('all')} compact={compact}>All</FilterChip>
        {kinds.map(k => {
          const { color, icon } = toneStyle(tk, k === 'error' ? 'danger' : k);
          return (
            <FilterChip key={k} on={filter === k} onClick={() => setFilter(filter === k ? 'all' : k)} compact={compact}
              title={`${KIND_LABEL[k]}: ${counts[k]}`}>
              <span style={{ color, display: 'inline-flex' }}><Icon name={icon} size={12} /></span>
              {compact ? <>{KIND_LABEL[k]} <Count n={counts[k]} /></> : counts[k]}
            </FilterChip>
          );
        })}
      </div>
      {list.length === 0 && <Note>None of this kind.</Note>}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {current.map(e => <ActivityRow key={e.id} e={e} now={now} compact={compact} />)}
      </ol>
      {earlier.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 2px' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>Before the last reload</span>
            <div style={{ flex: 1, height: 1, background: tk.border.subtle }} />
          </div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2, opacity: 0.8 }}>
            {earlier.map(e => <ActivityRow key={e.id} e={e} now={now} compact={compact} />)}
          </ol>
        </>
      )}
    </div>
  );
}

function Count({ n }: { n: number }) {
  const tk = useTokens();
  return <span style={{ color: tk.text.faint, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{n}</span>;
}

function FilterChip({ on, onClick, children, title, compact }: { on: boolean; onClick: () => void; children: ReactNode; title?: string; compact: boolean }) {
  const tk = useTokens();
  return (
    <button type="button" onClick={onClick} aria-pressed={on} title={title} aria-label={title} style={{
      height: compact ? 32 : 26, padding: compact ? '0 9px' : '0 6px', borderRadius: radius.md - 1, cursor: 'pointer', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
      border: `1px solid ${on ? alpha(tk.accent.base, 0.45) : tk.border.default}`,
      background: on ? tk.bg.selected : tk.bg.panel, color: on ? tk.accent.text : tk.text.secondary,
      font: `500 11.5px ${fontFamily.ui}`,
    }}>
      {children}
    </button>
  );
}

function ActivityRow({ e, now, compact }: { e: ActivityEntry; now: number; compact: boolean }) {
  const tk = useTokens();
  const runAction = useActivityStore(s => s.runAction);
  const [copied, setCopied] = useState(false);
  const { color, icon } = toneStyle(tk, e.kind === 'error' ? 'danger' : e.kind);
  const canAct = actionAvailable(e, now);
  const link = { border: 0, background: 'none', padding: compact ? '6px 0' : 0, cursor: 'pointer', font: `600 12px ${fontFamily.ui}` } as const;
  return (
    <li style={{ display: 'flex', gap: 9, padding: compact ? '9px 6px' : '7px 6px', borderRadius: radius.md }}>
      <span style={{ color, marginTop: 1, flexShrink: 0 }}><Icon name={icon} size={15} /></span>
      <div style={{ flex: 1, minWidth: 0, font: `12px/1.45 ${fontFamily.ui}`, color: tk.text.secondary }}>
        <div style={{ fontWeight: 600, color: tk.text.primary, fontSize: compact ? 13 : 12.5, overflowWrap: 'anywhere' }}>{e.title}</div>
        {e.message && <div style={{ marginTop: 1, overflowWrap: 'anywhere' }}>{e.message}</div>}
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 14, rowGap: 2, marginTop: 3 }}>
          <span style={{ fontSize: 11, color: tk.text.faint }}>{whenText(e.at, now)}</span>
          {canAct && e.action && (
            <button type="button" style={{ ...link, color: tk.accent.text }} onClick={() => {
              if (!runAction(e.id)) toast.info('That no longer applies', { message: 'Things have changed since this notice.' });
            }}>{e.action.label}</button>
          )}
          {e.details && (
            <button type="button" style={{ ...link, color: tk.text.muted }}
              onClick={() => navigator.clipboard?.writeText(e.details ?? '').then(() => setCopied(true), () => {})}>
              {copied ? 'Copied' : 'Copy details'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
