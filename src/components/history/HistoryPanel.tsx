/**
 * The History panel: the undo history as named steps (Changes), every notice the app has shown
 * this session (Activity), and the release notes (What's new). Lives in the sidebar's History
 * tab on desktop, in the Browse sheet on a phone, and popped out in its own floating window
 * (HistoryWindow.tsx).
 *
 * Every entry is a card with a coloured chip for its kind, grouped under time headings. A card
 * opens its details: beside the sidebar on desktop (a popover), as a sheet on a phone, and in a
 * pane next to the list in a wide History window.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useNodeGraphStore, undoManager } from '../../store/useNodeGraphStore';
import { buildTimeline, diffGraphs, type StepDiff, type TimelineState, type TimelineStep } from '../../store/historyLabels';
import { describePlayChange, type PlayChange } from '../../store/playHistory';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius, type Tokens } from '../../theme/tokens';
import { Segmented } from '../ui/Choice';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toastStore';
import { LinkedText } from '../ui/Links';
import { ACTIVITY_CAP, actionAvailable, useActivityStore, useUnseenActivity, type ActivityEntry, type ActivityKind } from '../ui/activityStore';
import { OPEN_WHATS_NEW, takePendingOpen, unreadReleases, useWhatsNew, useWhatsNewUnread } from '../../changelog/releaseNotes';
import { WhatsNewView } from './WhatsNewView';
import { activityKind, CHIP_LABEL, fullTime, groupByTime, stepKind, whenText, type ChipKind } from './historyModel';
import { useHistoryWindow } from './historyWindowStore';

export type HistoryView = 'changes' | 'activity' | 'whatsnew';
/** side: the desktop sidebar · window: the pop-out window · compact: a phone's sheet. */
export type HistoryMode = 'side' | 'window' | 'compact';

let lastView: HistoryView = 'changes';

/** The window is wide enough for the list and a details pane side by side. */
const SPLIT_MIN = 620;

function useClock(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** The graph and the Play setup, but at most every 300 ms: a slider drag doesn't re-describe the history every frame. */
function useThrottledState(): TimelineState {
  const read = (): TimelineState => { const s = useNodeGraphStore.getState(); return { nodes: s.nodes, play: s.play }; };
  const [state, setState] = useState(read);
  useEffect(() => {
    let timer: number | null = null;
    let last = read();
    const flush = () => { timer = null; setState(read()); };
    const unsub = useNodeGraphStore.subscribe(s => {
      if (s.nodes === last.nodes && s.play === last.play) return;
      last = { nodes: s.nodes, play: s.play };
      if (timer === null) timer = window.setTimeout(flush, 300);
    });
    return () => { unsub(); if (timer !== null) window.clearTimeout(timer); };
  }, []);
  return state;
}

/** A Play-only step: nothing in the graph to show or diff. */
const playOnly = (s: TimelineStep) => !!s.play && s.before === s.after;

/** What a Play step changed (memoised on the records themselves, as the cards render often and the steps are rebuilt each time). */
function usePlayChange(s: TimelineStep): PlayChange | null {
  const before = s.play?.before, after = s.play?.after;
  return useMemo(() => (before && after ? describePlayChange(before, after) : null), [before, after]);
}

/** The chip for a Play step: what kind of change it was. */
function playChipKind(c: PlayChange | null): ChipKind {
  switch (c?.kind) {
    case 'added': return 'added';
    case 'removed': return 'removed';
    case 'moved': return 'moved';
    case 'comment': return 'comment';
    default: return 'play';
  }
}

export function HistoryPanel({ compact = false, mode: modeProp, onShowOnCanvas }: {
  /** Phone sheet: bigger touch targets, no hover-only controls. */
  compact?: boolean;
  mode?: HistoryMode;
  /** After "Show on canvas" (the phone closes its sheet). */
  onShowOnCanvas?: () => void;
}) {
  const mode: HistoryMode = modeProp ?? (compact ? 'compact' : 'side');
  const isCompact = mode === 'compact';
  const tk = useTokens();
  // Release notes this device hasn't seen (or "What's new" on the Updated notice) open What's new first.
  const [view, setViewState] = useState<HistoryView>(() => (takePendingOpen() || unreadReleases(useWhatsNew.getState().seen).length > 0 ? 'whatsnew' : lastView));
  const setView = (v: HistoryView) => { lastView = v; setViewState(v); };
  const unseen = useUnseenActivity();
  const unreadRelease = useWhatsNewUnread();
  const popped = useHistoryWindow(s => s.open);
  useEffect(() => {
    const open = () => { takePendingOpen(); lastView = 'whatsnew'; setViewState('whatsnew'); };
    window.addEventListener(OPEN_WHATS_NEW, open);
    return () => window.removeEventListener(OPEN_WHATS_NEW, open);
  }, []);
  // A narrow sidebar can't fit three worded segments: What's new becomes its icon.
  const [width, setWidth] = useState(Infinity);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const attachRoot = useCallback((el: HTMLDivElement | null) => { rootRef.current = el; setRoot(el); }, []);
  useEffect(() => {
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(root.clientWidth));
    ro.observe(root);
    return () => ro.disconnect();
  }, [root]);
  const narrow = mode === 'side' && width < (unseen.count > 0 && view !== 'activity' ? 290 : 268);
  const split = mode === 'window' && width >= SPLIT_MIN;

  // The sidebar steps aside while the window is open, so there's one live list.
  if (mode === 'side' && popped) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 4px', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.5 }}>History is open in its own window.</span>
        <Button size="sm" icon="sidebar" onClick={() => useHistoryWindow.getState().setOpen(false)}>Put it back here</Button>
      </div>
    );
  }

  const inWindow = mode === 'window';
  return (
    <div ref={attachRoot} style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, ...(inWindow ? { flex: 1 } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Segmented
            fill
            ariaLabel="History"
            value={view}
            onChange={setView}
            options={[
              { value: 'changes', label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="undo" size={12} />Changes</span> },
              { value: 'activity', label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="info" size={12} />Activity{unseen.count > 0 && view !== 'activity' && <CountBadge count={unseen.count} error={unseen.error} />}</span> },
              {
                value: 'whatsnew', title: 'What’s new: the release notes',
                label: (
                  <span aria-label={narrow ? 'What’s new' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                    <Icon name="spark" size={12} />{!narrow && 'What’s new'}
                    {unreadRelease && view !== 'whatsnew' && <UnreadDot />}
                  </span>
                ),
              },
            ]}
          />
        </div>
        {mode === 'side' && (
          <IconButton icon="popout" size="sm" label="Pop History out into a bigger window" onClick={() => useHistoryWindow.getState().setOpen(true)} />
        )}
      </div>
      <div style={inWindow ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : { display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {view === 'changes'
          ? <ChangesView mode={mode} split={split} rootRef={rootRef} onShowOnCanvas={onShowOnCanvas} />
          : view === 'activity'
            ? <ActivityView mode={mode} split={split} rootRef={rootRef} />
            : <Scroller on={inWindow}><WhatsNewView compact={isCompact} /></Scroller>}
      </div>
    </div>
  );
}

/** In the window the list scrolls on its own (the sidebar and the sheet scroll their whole body). */
function Scroller({ on, children, style }: { on: boolean; children: ReactNode; style?: CSSProperties }) {
  return on ? <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 12, paddingRight: 2, ...style }}>{children}</div> : <>{children}</>;
}

/** The dot for release notes not seen yet (What's new segment, History rail icon, Browse button). */
export function UnreadDot({ style, label = 'New release notes' }: { style?: CSSProperties; label?: string }) {
  const tk = useTokens();
  return <span {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: tk.accent.base, ...style }} />;
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

// ── Cards ────────────────────────────────────────────────────────────────────

const CHIP_ICON: Record<ChipKind, IconName> = {
  added: 'plus', removed: 'trash', wiring: 'link', edit: 'sliders', comment: 'comment', moved: 'fit', changed: 'edit', graph: 'nodes',
  error: 'alert', warning: 'warning', export: 'export', import: 'import', play: 'play', saved: 'save', done: 'check', info: 'info', release: 'spark',
};

function chipColor(tk: Tokens, k: ChipKind): string {
  switch (k) {
    case 'added': case 'saved': case 'done': return tk.status.success;
    case 'removed': case 'error': return tk.status.danger;
    case 'warning': case 'changed': return tk.status.warning;
    case 'wiring': case 'export': case 'import': return tk.kind.fn;
    case 'play': case 'comment': return tk.kind.expr;
    case 'moved': case 'graph': return tk.text.muted;
    default: return tk.accent.base;
  }
}

/** The kind chip: a tinted tile with the kind's icon. */
function KindChip({ kind, size = 28 }: { kind: ChipKind; size?: number }) {
  const tk = useTokens();
  const c = chipColor(tk, kind);
  return (
    <span aria-hidden title={CHIP_LABEL[kind]} style={{
      width: size, height: size, borderRadius: Math.round(size * 0.3), flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: alpha(c, 0.15), color: c, boxShadow: `inset 0 0 0 1px ${alpha(c, 0.22)}`,
    }}><Icon name={CHIP_ICON[kind]} size={Math.round(size * 0.52)} /></span>
  );
}

function Pill({ children, color, bg, dashed }: { children: ReactNode; color: string; bg: string; dashed?: string }) {
  return (
    <span style={{ flexShrink: 0, height: 16, padding: '0 6px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', background: bg, color, font: `650 10px ${fontFamily.ui}`, letterSpacing: '0.02em', ...(dashed ? { border: `1px dashed ${dashed}` } : {}) }}>{children}</span>
  );
}

/** The card surface every entry sits on. */
function cardSurface(tk: Tokens, s: { hover: boolean; selected: boolean; current?: boolean; undone?: boolean }): CSSProperties {
  const border = s.selected ? alpha(tk.accent.base, 0.6) : s.current ? alpha(tk.accent.base, 0.4) : s.hover ? tk.border.strong : tk.border.default;
  return {
    position: 'relative', borderRadius: radius.md + 2, boxSizing: 'border-box',
    border: `1px ${s.undone && !s.selected ? 'dashed' : 'solid'} ${border}`,
    background: s.selected ? tk.bg.selected : s.hover ? tk.bg.hover : s.current ? alpha(tk.accent.base, 0.05) : alpha(tk.text.primary, 0.022),
    boxShadow: s.current && !s.selected ? `inset 3px 0 0 ${tk.accent.base}` : 'none',
    transition: 'background 120ms, border-color 120ms',
  };
}

function EntryCard({ kind, title, body, meta, trailing, selected, current, undone, dim, compact, onOpen, anchorRef, label }: {
  kind: ChipKind;
  title: ReactNode;
  /** A line or two under the title (clamped). */
  body?: ReactNode;
  meta: ReactNode;
  /** Buttons on the right: shown on hover (desktop) or always (phone). */
  trailing?: (hover: boolean) => ReactNode;
  selected: boolean;
  current?: boolean;
  undone?: boolean;
  dim?: boolean;
  compact: boolean;
  onOpen: () => void;
  anchorRef?: RefObject<HTMLDivElement | null>;
  label: string;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <div
      ref={anchorRef}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...cardSurface(tk, { hover, selected, current, undone }), opacity: dim ? 0.72 : 1, display: 'flex', alignItems: 'stretch' }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={selected}
        aria-label={label}
        style={{
          flex: 1, minWidth: 0, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit',
          padding: compact ? '11px 10px' : '9px 10px', display: 'flex', alignItems: 'flex-start', gap: 10, borderRadius: radius.md + 2,
        }}
      >
        <KindChip kind={kind} size={compact ? 30 : 28} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{
            font: `${current ? 650 : 600} ${compact ? 13.5 : 12.5}px/1.35 ${fontFamily.ui}`, color: undone ? tk.text.muted : tk.text.primary,
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere',
          }}>{title}</span>
          {body && (
            <span style={{
              font: `${compact ? 12.5 : 12}px/1.4 ${fontFamily.ui}`, color: tk.text.secondary,
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere',
            }}>{body}</span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, font: `11px ${fontFamily.ui}`, color: tk.text.faint }}>{meta}</span>
        </span>
      </button>
      {trailing && <div style={{ display: 'flex', alignItems: 'center', paddingRight: 6 }}>{trailing(hover)}</div>}
    </div>
  );
}

function GroupHeading({ children, count }: { children: ReactNode; count?: number }) {
  const tk = useTokens();
  return (
    <li aria-hidden={false} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 2px 0' }}>
      <span style={{ font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.muted }}>{children}</span>
      {count !== undefined && <span style={{ font: `600 10px ${fontFamily.ui}`, color: tk.text.faint, fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
      <span style={{ flex: 1, height: 1, background: tk.border.subtle }} />
    </li>
  );
}

/** The hover button on a card. */
function QuickButton({ icon, onClick, title, children, compact }: { icon: IconName; onClick: () => void; title: string; children: ReactNode; compact: boolean }) {
  const tk = useTokens();
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick(); }}
      title={title}
      style={{
        flexShrink: 0, height: compact ? 34 : 26, padding: '0 8px', borderRadius: radius.sm, cursor: 'pointer',
        border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.secondary,
        font: `500 11.5px ${fontFamily.ui}`, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
      }}
    >
      <Icon name={icon} size={13} />{children}
    </button>
  );
}

/**
 * Where a card's details open: a popover beside the panel (sidebar, narrow window), a sheet
 * (phone), or nothing here when the window shows them in its own pane.
 */
function DetailHost({ mode, split, anchorRef, clearRef, title, onClose, children }: {
  mode: HistoryMode; split: boolean;
  anchorRef: RefObject<HTMLElement | null>; clearRef: RefObject<HTMLElement | null>;
  title: ReactNode; onClose: () => void; children: ReactNode;
}) {
  if (split) return null;
  if (mode === 'compact') return <Sheet title={title} onClose={onClose} maxHeight="85dvh"><div style={{ padding: '0 16px 20px' }}>{children}</div></Sheet>;
  return (
    <Popover anchorRef={anchorRef} clearRef={clearRef} onClose={onClose} width={400} padding={0}>
      <div style={{ padding: 14 }}>{children}</div>
    </Popover>
  );
}

/** The top of a details view: the chip, the title, the kind and the time. */
function DetailHeader({ kind, title, sub, onClose }: { kind: ChipKind; title: ReactNode; sub: ReactNode; onClose?: () => void }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
      <KindChip kind={kind} size={34} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ font: `650 14px/1.35 ${fontFamily.ui}`, color: tk.text.primary, overflowWrap: 'anywhere' }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, font: `11.5px ${fontFamily.ui}`, color: tk.text.faint }}>
          <span style={{ color: chipColor(tk, kind), fontWeight: 650 }}>{CHIP_LABEL[kind]}</span>{sub}
        </div>
      </div>
      {onClose && <IconButton icon="close" size="sm" label="Close details" onClick={onClose} />}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <div style={{ font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, margin: '12px 0 6px' }}>{children}</div>;
}

/** The window's details pane: the chosen entry, or a hint. */
function Pane({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, overflowY: 'auto', borderLeft: `1px solid ${tk.border.subtle}`, padding: '4px 4px 16px 16px' }}>
      {children ?? <div style={{ color: tk.text.faint, fontSize: 12, padding: '24px 4px', lineHeight: 1.5 }}>Pick an entry to see everything about it here.</div>}
    </div>
  );
}

// ── Changes ──────────────────────────────────────────────────────────────────

function ChangesView({ mode, split, rootRef, onShowOnCanvas }: { mode: HistoryMode; split: boolean; rootRef: RefObject<HTMLDivElement | null>; onShowOnCanvas?: () => void }) {
  const tk = useTokens();
  const compact = mode === 'compact';
  const version = useSyncExternalStore(undoManager.subscribe, undoManager.getVersion);
  const state = useThrottledState();
  const scratch = useNodeGraphStore(s => !!s.scratch);
  const now = useClock();
  const [openId, setOpenId] = useState<number | null>(null);

  const steps = useMemo(() => {
    void version; // the stacks are mutable: the version says when they changed
    return buildTimeline(undoManager.done(), undoManager.undone(), state);
  }, [version, state]);
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
  const touched = (s: TimelineStep) => [...s.nodeIds, ...diffGraphs(s.before, s.after).touchedTopIds];

  const newestFirst = useMemo(() => [...steps].reverse(), [steps]);
  const groups = groupByTime(newestFirst, s => s.at, now);
  const openStep = openId === null ? null : steps.find(s => s.id === openId) ?? null;

  if (scratch) {
    return <Note>The Convert page is showing a graph-to-be. Its history starts when you Materialize it.</Note>;
  }

  const detailFor = (s: TimelineStep, onClose?: () => void) => (
    <StepDetail step={s} now={now} compact={compact} onClose={onClose}
      onRestore={() => restore(s)} onShow={ids => showOnCanvas(ids ?? touched(s))} />
  );

  const list = (
    <Scroller on={mode === 'window'} style={split ? { flex: '1 1 0', minWidth: 260, maxWidth: 420 } : undefined}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '0 2px 6px', color: tk.text.faint, fontSize: 11.5, lineHeight: 1.4 }}>
        <span style={{ flex: 1 }}>
          {steps.length === 0 ? `Keeps the last ${undoManager.maxDepth} changes.` : `${doneCount} ${doneCount === 1 ? 'change' : 'changes'}${undoneCount ? ` · ${undoneCount} undone` : ''} · keeps the last ${undoManager.maxDepth}`}
        </span>
      </div>
      {steps.length === 0 && (
        <Note>Nothing to undo yet. Each change you make to the graph or the Play setup shows up here, newest first, and you can step back to any of them.</Note>
      )}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {groups.map((g, gi) => (
          <GroupBlock key={`${g.bucket}:${gi}`} heading={g.bucket} count={g.items.length}>
            {g.items.map(s => (
              <StepCard
                key={s.id}
                step={s}
                now={now}
                mode={mode}
                split={split}
                rootRef={rootRef}
                open={openId === s.id}
                onToggle={() => {
                  const opening = openId !== s.id;
                  setOpenId(opening ? s.id : null);
                  if (opening && !compact && !playOnly(s)) showOnCanvas(touched(s));
                }}
                onRestore={() => restore(s)}
                detail={detailFor(s)}
              />
            ))}
          </GroupBlock>
        ))}
        {(steps.length > 0 || origin) && (
          <li style={{ listStyle: 'none', marginTop: 4 }}>
            <OriginCard
              label={trimmed ? 'Older changes aren’t kept' : origin?.label ?? 'Start of this session'}
              at={trimmed ? null : origin?.at ?? null}
              now={now}
              current={doneCount === 0}
              onRestore={doneCount > 0 ? () => restore(null) : undefined}
              compact={compact}
            />
          </li>
        )}
      </ol>
    </Scroller>
  );

  if (!split) return list;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 0 }}>
      {list}
      <Pane>{openStep ? detailFor(openStep, () => setOpenId(null)) : null}</Pane>
    </div>
  );
}

function GroupBlock({ heading, count, children }: { heading: string; count: number; children: ReactNode }) {
  return (
    <>
      <GroupHeading count={count}>{heading}</GroupHeading>
      {children}
    </>
  );
}

function StepCard({ step, now, mode, split, rootRef, open, onToggle, onRestore, detail }: {
  step: TimelineStep; now: number; mode: HistoryMode; split: boolean; rootRef: RefObject<HTMLDivElement | null>;
  open: boolean; onToggle: () => void; onRestore: () => void; detail: ReactNode;
}) {
  const tk = useTokens();
  const compact = mode === 'compact';
  const ref = useRef<HTMLDivElement>(null);
  const d = diffGraphs(step.before, step.after);
  const pc = usePlayChange(step);
  const kind = playOnly(step) ? playChipKind(pc) : stepKind(d);
  const undone = step.status === 'undone', current = step.status === 'current';
  const summary = playOnly(step) ? playSummary(pc) : changeSummary(d);
  return (
    <li style={{ listStyle: 'none' }}>
      <EntryCard
        anchorRef={ref}
        kind={kind}
        title={step.label}
        label={`${step.label}${current ? ' (now)' : undone ? ' (undone)' : ''}. Show details`}
        meta={(
          <>
            {current && <Pill color={tk.accent.text} bg={alpha(tk.accent.base, 0.16)}>Now</Pill>}
            {undone && <Pill color={tk.text.muted} bg="transparent" dashed={tk.border.strong}>Undone</Pill>}
            <span>{whenText(step.at, now)}</span>
            {summary && <><span aria-hidden>·</span><span>{summary}</span></>}
          </>
        )}
        selected={open}
        current={current}
        undone={undone}
        dim={undone}
        compact={compact}
        onOpen={onToggle}
        trailing={current ? undefined : hover => ((hover && !open) || compact) && (
          <QuickButton icon={undone ? 'redo' : 'undo'} onClick={onRestore} compact={compact}
            title={undone ? 'Redo every step up to this one' : 'Undo every step after this one (they stay redoable)'}>
            {undone ? 'Redo to here' : 'Restore'}
          </QuickButton>
        )}
      />
      {open && (
        <DetailHost mode={mode} split={split} anchorRef={ref} clearRef={rootRef} title="Change" onClose={onToggle}>{detail}</DetailHost>
      )}
    </li>
  );
}

/** "Play · 3 changes" — a Play step, counted. */
function playSummary(c: PlayChange | null): string {
  if (!c) return 'Play';
  return c.lines.length > 1 ? `Play · ${c.lines.length} changes` : 'Play';
}

/** "2 params · 1 wire" — what a step touched, counted. */
function changeSummary(d: StepDiff): string {
  const parts: string[] = [];
  if (d.added.length) parts.push(`+${d.added.length}`);
  if (d.removed.length) parts.push(`−${d.removed.length}`);
  if (d.params.length) parts.push(`${d.params.length} ${d.params.length === 1 ? 'value' : 'values'}`);
  if (d.wires.length) parts.push(`${d.wires.length} ${d.wires.length === 1 ? 'wire' : 'wires'}`);
  return parts.join(' · ');
}

function OriginCard({ label, at, now, current, onRestore, compact }: {
  label: string; at: number | null; now: number; current: boolean; onRestore?: () => void; compact: boolean;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...cardSurface(tk, { hover, selected: false, current }), background: 'transparent', borderStyle: 'dashed', display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '10px 8px 10px 10px' : '8px 6px 8px 10px' }}
    >
      <span aria-hidden style={{ width: compact ? 30 : 28, height: compact ? 30 : 28, borderRadius: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint, border: `1px dashed ${tk.border.strong}` }}>
        <Icon name="history" size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: `${current ? 650 : 550} ${compact ? 13.5 : 12.5}px ${fontFamily.ui}`, color: current ? tk.text.primary : tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `11px ${fontFamily.ui}`, color: tk.text.faint }}>
          {current && <Pill color={tk.accent.text} bg={alpha(tk.accent.base, 0.16)}>Now</Pill>}
          {at ? `Start · ${whenText(at, now)}` : 'Start of the kept history'}
        </span>
      </div>
      {onRestore && (hover || compact) && (
        <QuickButton icon="undo" onClick={onRestore} compact={compact} title="Undo every step (they stay redoable)">Restore</QuickButton>
      )}
    </div>
  );
}

const MAX_LINES = 60;

function StepDetail({ step, now, compact, onClose, onRestore, onShow }: {
  step: TimelineStep; now: number; compact: boolean; onClose?: () => void; onRestore: () => void; onShow: (ids?: string[]) => void;
}) {
  const tk = useTokens();
  const d = useMemo(() => diffGraphs(step.before, step.after), [step.before, step.after]);
  const pc = usePlayChange(step);
  const isPlay = playOnly(step);
  const lines = isPlay ? playLines(pc, tk) : detailLines(d, tk);
  const shown = lines.slice(0, MAX_LINES);
  const liveIds = useNodeGraphStore(s => s.nodes.map(n => n.id).join('\n'));
  const live = useMemo(() => new Set(liveIds.split('\n')), [liveIds]);
  const canShow = !isPlay && [...step.nodeIds, ...d.touchedTopIds].some(id => live.has(id));
  const affected = isPlay ? [] : affectedNodes(d);
  const undone = step.status === 'undone', current = step.status === 'current';
  const btn = compact ? { height: 38 } : undefined;
  return (
    <div>
      <DetailHeader
        kind={isPlay ? playChipKind(pc) : stepKind(d)}
        title={step.label}
        onClose={onClose}
        sub={(
          <>
            {current && <Pill color={tk.accent.text} bg={alpha(tk.accent.base, 0.16)}>Now</Pill>}
            {undone && <Pill color={tk.text.muted} bg="transparent" dashed={tk.border.strong}>Undone</Pill>}
            <span title={fullTime(step.at)}>{whenText(step.at, now)}</span>
          </>
        )}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!current && (
          <Button size="sm" variant="primary" icon={undone ? 'redo' : 'undo'} onClick={onRestore} style={btn}
            title={undone ? 'Redo every step up to this one' : 'Undo every step after this one (they stay redoable)'}>
            {undone ? 'Redo to here' : 'Restore to here'}
          </Button>
        )}
        {canShow && <Button size="sm" icon="target" onClick={() => onShow()} style={btn}>Show on canvas</Button>}
      </div>
      <SectionLabel>What changed</SectionLabel>
      {shown.length === 0
        ? <span style={{ fontSize: 12, color: tk.text.faint }}>{isPlay ? 'The Play setup changed.' : 'Nothing the graph shows changed (a view or layout detail).'}</span>
        : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {shown.map((l, i) => <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, font: `12.5px/1.45 ${fontFamily.ui}`, color: tk.text.secondary, minWidth: 0 }}>{l}</li>)}
            {lines.length > MAX_LINES && <li style={{ fontSize: 11.5, color: tk.text.faint }}>and {lines.length - MAX_LINES} more</li>}
          </ul>
        )}
      {affected.length > 0 && (
        <>
          <SectionLabel>Nodes</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {affected.map(a => {
              const here = live.has(a.topId);
              return (
                <button key={a.key} type="button" disabled={!here} onClick={() => onShow([a.topId])}
                  title={here ? `Show ${a.name} on the canvas` : `${a.name} isn’t in the graph now`}
                  style={{
                    height: compact ? 32 : 24, padding: '0 8px', borderRadius: 12, cursor: here ? 'pointer' : 'default',
                    display: 'inline-flex', alignItems: 'center', gap: 5, font: `550 11.5px ${fontFamily.ui}`,
                    border: `1px solid ${here ? tk.border.default : 'transparent'}`, background: here ? tk.bg.panel : tk.bg.field,
                    color: here ? tk.text.secondary : tk.text.faint, textDecoration: here ? 'none' : 'line-through',
                  }}>
                  {here && <Icon name="target" size={11} style={{ color: tk.accent.base }} />}{a.name}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Every node the step touched, once, with the top-level node to jump to. */
function affectedNodes(d: StepDiff): { key: string; name: string; topId: string }[] {
  const out = new Map<string, { key: string; name: string; topId: string }>();
  const add = (key: string, name: string, topId: string) => { if (!out.has(key)) out.set(key, { key, name, topId }); };
  for (const r of [...d.added, ...d.params, ...d.other, ...d.moved, ...d.removed]) add(r.key, r.name, r.topId);
  for (const w of d.wires) { add(`w:${w.toTopId}`, w.toName, w.toTopId); }
  return [...out.values()].slice(0, 40);
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

/** A Play step's lines, each signed by what it did. */
function playLines(c: PlayChange | null, tk: Tokens): ReactNode[] {
  if (!c) return [];
  const text = (t: ReactNode) => <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{t}</span>;
  return c.lines.map(l => {
    const sign = /^Added /.test(l) ? <Sign c={tk.status.success}>+</Sign>
      : /^Removed /.test(l) ? <Sign c={tk.status.danger}>−</Sign>
        : /^Reordered /.test(l) ? <Sign c={tk.text.faint}>↔</Sign>
          : <Sign c={tk.accent.base}>~</Sign>;
    return <>{sign}{text(l)}</>;
  });
}

function Note({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <div style={{ fontSize: 12, color: tk.text.faint, padding: '4px 4px 8px', lineHeight: 1.5 }}>{children}</div>;
}

// ── Activity ─────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<ActivityKind, string> = { error: 'Errors', warning: 'Warnings', success: 'Done', info: 'Info' };
const KIND_ORDER: ActivityKind[] = ['error', 'warning', 'success', 'info'];
const toneChip = (k: ActivityKind): ChipKind => (k === 'success' ? 'done' : k);

function ActivityView({ mode, split, rootRef }: { mode: HistoryMode; split: boolean; rootRef: RefObject<HTMLDivElement | null> }) {
  const tk = useTokens();
  const compact = mode === 'compact';
  const entries = useActivityStore(s => s.entries);
  const clear = useActivityStore(s => s.clear);
  const [filter, setFilter] = useState<ActivityKind | 'all'>('all');
  const [openId, setOpenId] = useState<number | null>(null);
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
  const openEntry = openId === null ? null : entries.find(e => e.id === openId) ?? null;

  if (entries.length === 0) {
    return <Note>No notices yet. Everything the app tells you — saved, imported, exported, a Play setup loaded, an error — is kept here for the session.</Note>;
  }

  const card = (e: ActivityEntry) => (
    <ActivityCard key={e.id} e={e} now={now} mode={mode} split={split} rootRef={rootRef}
      open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)} />
  );

  const body = (
    <Scroller on={mode === 'window'} style={split ? { flex: '1 1 0', minWidth: 260, maxWidth: 420 } : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '0 2px', color: tk.text.faint, fontSize: 11.5, lineHeight: 1.4 }}>
          <span style={{ flex: 1 }} title={`Keeps the last ${ACTIVITY_CAP} for this session`}>{entries.length} {entries.length === 1 ? 'notice' : 'notices'}</span>
          <button type="button" onClick={() => { clear(); setFilter('all'); setOpenId(null); }}
            style={{ border: 0, background: 'none', padding: compact ? '8px 0' : 0, cursor: 'pointer', color: tk.text.muted, font: `600 11.5px ${fontFamily.ui}` }}>Clear all</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...(compact ? { overflowX: 'auto', scrollbarWidth: 'none', margin: '0 -16px', padding: '0 16px' } : { flexWrap: 'wrap' }) }}>
          <FilterChip on={filter === 'all'} onClick={() => setFilter('all')} compact={compact}>All</FilterChip>
          {kinds.map(k => (
            <FilterChip key={k} on={filter === k} onClick={() => setFilter(filter === k ? 'all' : k)} compact={compact}
              title={`${KIND_LABEL[k]}: ${counts[k]}`}>
              <span style={{ color: chipColor(tk, toneChip(k)), display: 'inline-flex' }}><Icon name={CHIP_ICON[toneChip(k)]} size={12} /></span>
              {compact || mode === 'window' ? <>{KIND_LABEL[k]} <Count n={counts[k]} /></> : counts[k]}
            </FilterChip>
          ))}
        </div>
        {list.length === 0 && <Note>None of this kind.</Note>}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {groupByTime(current, e => e.at, now).map((g, gi) => (
            <GroupBlock key={`${g.bucket}:${gi}`} heading={g.bucket} count={g.items.length}>{g.items.map(card)}</GroupBlock>
          ))}
          {earlier.length > 0 && (
            <GroupBlock heading="Before the last reload" count={earlier.length}>{earlier.map(card)}</GroupBlock>
          )}
        </ol>
      </div>
    </Scroller>
  );

  if (!split) return body;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {body}
      <Pane>{openEntry ? <ActivityDetail e={openEntry} now={now} compact={false} onClose={() => setOpenId(null)} /> : null}</Pane>
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
      height: compact ? 32 : 26, padding: compact ? '0 9px' : '0 7px', borderRadius: radius.md - 1, cursor: 'pointer', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
      border: `1px solid ${on ? alpha(tk.accent.base, 0.45) : tk.border.default}`,
      background: on ? tk.bg.selected : tk.bg.panel, color: on ? tk.accent.text : tk.text.secondary,
      font: `500 11.5px ${fontFamily.ui}`,
    }}>
      {children}
    </button>
  );
}

function ActivityCard({ e, now, mode, split, rootRef, open, onToggle }: {
  e: ActivityEntry; now: number; mode: HistoryMode; split: boolean; rootRef: RefObject<HTMLDivElement | null>; open: boolean; onToggle: () => void;
}) {
  const compact = mode === 'compact';
  const ref = useRef<HTMLDivElement>(null);
  const runAction = useActivityStore(s => s.runAction);
  const kind = activityKind(e);
  const canAct = actionAvailable(e, now);
  return (
    <li style={{ listStyle: 'none' }}>
      <EntryCard
        anchorRef={ref}
        kind={kind}
        title={e.title}
        body={e.message}
        label={`${e.title}. Show details`}
        meta={(
          <>
            <span>{whenText(e.at, now)}</span>
            {e.details && <><span aria-hidden>·</span><span>has details</span></>}
          </>
        )}
        selected={open}
        dim={e.earlier}
        compact={compact}
        onOpen={onToggle}
        trailing={canAct && e.action ? hover => ((hover && !open) || compact) && (
          <QuickButton icon="chevR" compact={compact} title={e.action!.label}
            onClick={() => { if (!runAction(e.id)) toast.info('That no longer applies', { message: 'Things have changed since this notice.' }); }}>
            {e.action!.label}
          </QuickButton>
        ) : undefined}
      />
      {open && (
        <DetailHost mode={mode} split={split} anchorRef={ref} clearRef={rootRef} title={CHIP_LABEL[kind]} onClose={onToggle}>
          <ActivityDetail e={e} now={now} compact={compact} />
        </DetailHost>
      )}
    </li>
  );
}

function ActivityDetail({ e, now, compact, onClose }: { e: ActivityEntry; now: number; compact: boolean; onClose?: () => void }) {
  const tk = useTokens();
  const runAction = useActivityStore(s => s.runAction);
  const [copied, setCopied] = useState<'details' | 'all' | null>(null);
  const canAct = actionAvailable(e, now);
  const copy = (what: 'details' | 'all') => {
    const text = what === 'details' ? e.details ?? '' : [e.title, e.message, e.details, fullTime(e.at)].filter(Boolean).join('\n\n');
    navigator.clipboard?.writeText(text).then(() => setCopied(what), () => {});
  };
  const btn = compact ? { height: 38 } : undefined;
  return (
    <div>
      <DetailHeader
        kind={activityKind(e)}
        title={e.title}
        onClose={onClose}
        sub={<span title={fullTime(e.at)}>{whenText(e.at, now)} · {fullTime(e.at)}</span>}
      />
      {e.message && (
        <div data-selectable="" style={{ font: `13px/1.55 ${fontFamily.ui}`, color: tk.text.secondary, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
          <LinkedText text={e.message} linkStyle={{ color: tk.accent.text }} />
        </div>
      )}
      {e.details && (
        <>
          <SectionLabel>Details</SectionLabel>
          <pre data-selectable="" style={{
            margin: 0, maxHeight: 260, overflow: 'auto', padding: '8px 10px', borderRadius: radius.md,
            background: tk.bg.field, color: tk.text.secondary, font: `11.5px/1.5 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          }}>{e.details}</pre>
        </>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        {canAct && e.action && (
          <Button size="sm" variant="primary" style={btn} onClick={() => {
            if (!runAction(e.id)) toast.info('That no longer applies', { message: 'Things have changed since this notice.' });
          }}>{e.action.label}</Button>
        )}
        {e.details && <Button size="sm" icon="copy" style={btn} onClick={() => copy('details')}>{copied === 'details' ? 'Copied' : 'Copy details'}</Button>}
        <Button size="sm" variant="ghost" icon="copy" style={btn} onClick={() => copy('all')}>{copied === 'all' ? 'Copied' : 'Copy notice'}</Button>
      </div>
    </div>
  );
}
