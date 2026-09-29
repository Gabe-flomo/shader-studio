/**
 * BigEditorScaffold — the tab host every layer editor sits in (LayerRow wraps
 * each card and full editor in one), and that a few editors also put around
 * their own Sections (Particles, Relationship, Video, Drum pads, Finish →
 * Grade), where it's a pass-through when a host is already above it.
 *
 * With two or more Sections inside, it shows them as **tabs**: one section at
 * a time, a strip of tabs on top (sticky in the big panel, a compact scrolling
 * row in the sidebar card). The open tab is remembered per layer (per `scope`)
 * in playUi.ts; a fresh layer opens on its `primary` section. Sections
 * register themselves (sectionTabs.ts), so a conditional section simply
 * appears and disappears as a tab, and if the open one goes, the primary
 * shows. "Show all", at the end of the strip, stacks every section instead
 * (folded by default, with Expand all / Collapse all) — one global choice.
 *
 * docs/editor-layout.md describes the pattern.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily } from '../../../theme/tokens';
import { Tooltip } from '../../ui/Tooltip';
import { usePlayUi } from '../playUi';
import { SectionTabsContext, useSectionTabs, type SectionEntry, type SectionMeta, type SectionTabsApi } from './sectionTabs';

export interface BigEditorSection {
  /** Matches the `id` given to the Section. */
  id: string;
  label: string;
}

/** From this width, two short numeric rows sit side by side instead of stacking. */
export const TWO_COL_PX = 360;

type Tokens = ReturnType<typeof useTokens>;
const SMALL_BTN = (tk: Tokens): React.CSSProperties => ({
  border: 0, background: 'none', padding: '4px 6px', cursor: 'pointer', color: tk.text.faint, font: `600 10.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', flexShrink: 0,
});

/** Tabs in page order: by where each Section's element sits. */
function inPageOrder(entries: SectionEntry[]): SectionEntry[] {
  return [...entries].sort((a, b) => {
    const x = a.el.current, y = b.el.current;
    if (!x || !y || x === y) return 0;
    return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

export function BigEditorScaffold({ kind, scope, compact = false, children }: {
  /**
   * Kept for the editors that list their sections; the tabs now come from the
   * Sections themselves (their titles, in page order), so this isn't read.
   */
  sections?: BigEditorSection[];
  /** The Section cards' `kind`: the default `scope`. */
  kind?: string;
  /** What the open tab is remembered under: `layer:<id>` for a layer, else the kind. */
  scope?: string;
  /** The sidebar's narrow card: a compact scrolling row of small tabs, not sticky. */
  compact?: boolean;
  children: ReactNode;
}) {
  const outer = useSectionTabs();
  // A host is already above (the layer card's): its tabs cover these Sections too.
  if (outer) return <>{children}</>;
  return <SectionTabsHost scope={scope ?? kind ?? ''} compact={compact}>{children}</SectionTabsHost>;
}

function SectionTabsHost({ scope, compact, children }: { scope: string; compact: boolean; children: ReactNode }) {
  const tk = useTokens();
  const [entries, setEntries] = useState<Map<string, SectionEntry>>(() => new Map());
  const [ready, setReady] = useState(false);
  const showAll = usePlayUi(s => s.sectionsShowAll);
  const setShowAll = usePlayUi(s => s.setSectionsShowAll);
  const stored = usePlayUi(s => (scope ? s.sectionTabs[scope] : undefined));
  const setTab = usePlayUi(s => s.setSectionTab);
  const expandAll = usePlayUi(s => s.expandAllSections);
  const collapseAll = usePlayUi(s => s.collapseAllSections);
  const toggleFold = usePlayUi(s => s.toggleFold);
  const [local, setLocal] = useState<string | undefined>(undefined);

  const register = useCallback((e: SectionEntry) => {
    setEntries(m => new Map(m).set(e.key, { ...m.get(e.key), ...e }));
    return () => setEntries(m => {
      if (m.get(e.key)?.el !== e.el) return m;
      const n = new Map(m);
      n.delete(e.key);
      return n;
    });
  }, []);
  const setMeta = useCallback((key: string, meta: SectionMeta) => {
    setEntries(m => {
      const e = m.get(key);
      if (!e || (e.summary === meta.summary && e.hint === meta.hint && e.on === meta.on)) return m;
      return new Map(m).set(key, { ...e, ...meta });
    });
  }, []);
  // By the time this runs, every Section mounted with this render has registered (child layout effects run first).
  useLayoutEffect(() => { setReady(true); }, []);

  const ordered = useMemo(() => inPageOrder([...entries.values()]), [entries]);
  const fallback = (ordered.find(e => e.primary) ?? ordered[0])?.key ?? '';
  const wanted = scope ? stored : local;
  // The remembered tab, unless its section isn't showing (a conditional one switched off): then the primary.
  const active = wanted && entries.has(wanted) ? wanted : fallback;
  const mode: SectionTabsApi['mode'] = !ready ? 'pending' : showAll ? 'all' : ordered.length >= 2 ? 'tabs' : 'single';

  // Opened tabs stay mounted (hidden) so what's held inside survives a switch.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set());
  useLayoutEffect(() => {
    if (active && !mounted.has(active)) setMounted(s => new Set(s).add(active));
  }, [active, mounted]);

  const choose = useCallback((key: string) => { if (scope) setTab(scope, key); else setLocal(key); }, [scope, setTab]);

  // Something asked for a section (revealSection): in Show all, unfold it and bring it into view.
  const focusTick = usePlayUi(s => s.sectionFocusTick);
  const seenTick = useRef(focusTick);
  useEffect(() => {
    if (focusTick === seenTick.current) return;
    seenTick.current = focusTick;
    const f = usePlayUi.getState().sectionFocus;
    if (!scope || f.scope !== scope) return;
    const e = entries.get(f.key);
    if (!e) return;
    if (mode === 'all') toggleFold(`${e.kind}:${e.title}`, false);
    requestAnimationFrame(() => e.el.current?.scrollIntoView?.({ block: 'nearest' }));
  }, [focusTick, scope, entries, mode, toggleFold]);

  const api = useMemo<SectionTabsApi>(() => ({ mode, active, mounted, register, setMeta }), [mode, active, mounted, register, setMeta]);

  const kinds = [...new Set(ordered.map(e => e.kind))];
  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the open tab in view in a scrolling row (without scrolling the page around it).
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || mode !== 'tabs') return;
    const btn = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!btn || strip.scrollWidth <= strip.clientWidth) return;
    const l = btn.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft, r = l + btn.offsetWidth;
    if (l < strip.scrollLeft) strip.scrollLeft = l - 8;
    else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth + 8;
  }, [active, mode]);

  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    const i = ordered.findIndex(e => e.key === active);
    const mod = ev.metaKey || ev.ctrlKey;
    let step = 0;
    if (ev.key === 'ArrowRight' || (mod && ev.key === ']')) step = 1;
    else if (ev.key === 'ArrowLeft' || (mod && ev.key === '[')) step = -1;
    else if (ev.key === 'Home') step = -i;
    else if (ev.key === 'End') step = ordered.length - 1 - i;
    if (!step || i < 0) return;
    ev.preventDefault();
    const next = ordered[(i + step + ordered.length) % ordered.length];
    choose(next.key);
    requestAnimationFrame(() => stripRef.current?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(next.key)}"]`)?.focus());
  };

  const stickyStyle: React.CSSProperties = compact
    ? { margin: '6px 0 2px' }
    : { position: 'sticky', top: 0, zIndex: 2, background: tk.bg.subtle, padding: '4px 0 8px', marginBottom: 4, borderBottom: `1px solid ${tk.border.default}` };

  let strip: ReactNode = null;
  if (mode === 'tabs') {
    strip = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...stickyStyle }}>
        <div
          ref={stripRef}
          role="tablist"
          aria-label="Sections"
          onKeyDown={onKeyDown}
          className="section-tabs"
          style={{
            display: 'flex', alignItems: 'center', gap: compact ? 3 : 4, flex: 1, minWidth: 0,
            flexWrap: compact ? 'nowrap' : 'wrap', overflowX: compact ? 'auto' : 'visible', scrollbarWidth: 'none',
          }}
        >
          {ordered.map(e => {
            const on = e.key === active;
            const btn = (
              <button
                key={e.key}
                type="button"
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                data-tab-key={e.key}
                aria-description={e.summary}
                onClick={() => choose(e.key)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
                  border: 0, borderRadius: 999, padding: compact ? '3px 8px' : '4px 10px', cursor: 'pointer',
                  background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.base : tk.text.secondary,
                  font: `600 ${compact ? 10 : 10.5}px ${fontFamily.ui}`, whiteSpace: 'nowrap',
                }}
              >
                {e.on !== undefined && <span aria-hidden style={{ width: 5, height: 5, borderRadius: 3, background: e.on ? tk.accent.base : tk.border.strong }} />}
                {e.title}
              </button>
            );
            return e.summary || e.hint
              ? <Tooltip key={e.key} label={e.summary ? `${e.title} · ${e.summary}` : e.title} description={e.hint} placement="bottom">{btn}</Tooltip>
              : btn;
          })}
        </div>
        <Tooltip label="Show all sections" description="Stack every section in one list (folded, with Expand all) instead of one tab at a time. Applies to every editor.">
          <button type="button" onClick={() => setShowAll(true)} style={SMALL_BTN(tk)}>Show all</button>
        </Tooltip>
      </div>
    );
  } else if (mode === 'all' && ordered.length >= 2) {
    const jump = (e: SectionEntry) => { toggleFold(`${e.kind}:${e.title}`, false); requestAnimationFrame(() => e.el.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })); };
    strip = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: compact ? 'nowrap' : 'wrap', ...stickyStyle, ...(compact ? {} : { position: ordered.length >= 4 ? 'sticky' : 'static' }) }}>
        {!compact && ordered.length >= 4 && ordered.map(e => (
          <button key={e.key} type="button" onClick={() => jump(e)} style={{ border: 0, borderRadius: 999, padding: '4px 10px', cursor: 'pointer', background: tk.bg.field, color: tk.text.secondary, font: `600 10.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{e.title}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => kinds.forEach(k => expandAll(k))} style={SMALL_BTN(tk)}>Expand all</button>
        <button type="button" onClick={() => kinds.forEach(k => collapseAll(k))} style={SMALL_BTN(tk)}>Collapse all</button>
        <Tooltip label="Tabs" description="One section at a time, as tabs. Applies to every editor.">
          <button type="button" onClick={() => setShowAll(false)} style={{ ...SMALL_BTN(tk), color: tk.accent.text }}>Tabs</button>
        </Tooltip>
      </div>
    );
  }

  return (
    <SectionTabsContext.Provider value={api}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {strip}
        {children}
      </div>
    </SectionTabsContext.Provider>
  );
}

/** A short numeric row that pairs with the next one on a wide panel instead of always stacking full width. */
export function TwoCol({ wide, children }: { wide: boolean; children: ReactNode }) {
  return (
    <div style={{ display: wide ? 'grid' : 'block', gridTemplateColumns: wide ? '1fr 1fr' : undefined, columnGap: wide ? 16 : 0 }}>
      {children}
    </div>
  );
}
