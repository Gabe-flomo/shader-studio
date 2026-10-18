import { offerGraphExport } from '../playfile/exportMenus';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX, SAVED_GRAPHS_CHANGED, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { groupGraphsByTime, sortGraphsByRecent } from '../../store/graphRecency';
import { getMembership, loadFolders, toggleFolderCollapsed } from '../../utils/assetFolders';

/** The folder scope the sidebar's Saved Graphs list uses (FolderableList scopeKey) */
const GRAPH_FOLDER_SCOPE = 'graphs';
import { useThemeStore, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius, type ThemeMode } from '../../theme/tokens';
import { isPlayRecordEmpty } from '../../types/play';
import { loadShortcutMap } from '../../hooks/useShortcuts';
import { requestPage, type Page } from '../page';
import { openCommandsRef } from '../../suggestions/doBarStore';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Popover } from '../ui/Popover';
import { Menu, type MenuItem } from '../ui/Menu';
import { useLearnUi } from '../learn/learnStore';
import { ProBadgeFor } from '../account/ProSheet';
import { accountMenuItems, signedInLabel } from '../account/accountMenu';
import { usePlan } from '../../lib/plan';
import { Tooltip } from '../ui/Tooltip';
import { WorkspaceChip } from '../workspace/WorkspacePanel';
import { HandsLive } from '../play/HandsChip';
import { KeyboardPill } from '../play/engine/KeyboardPill';
import { reportFileResult, reportGlslImport } from './reportFileResult';
import { importAnyFile } from './importAnyFile';
import { SaveGraphForm, VersionsButton } from './GraphVersions';
import { AutosaveIndicator } from './AutosaveControls';
import { GraphLinkBadge } from './GraphLinks';
import { REBUILD_TOOLTIP, rebuildWithToast } from './rebuildAction';
import { getTopNavFold } from './topNavFold';
import { OPEN_SAVE_FORM, type OpenSaveFormDetail } from './graphShortcuts';

/** Opens a save form when ⌘S / ⇧⌘S ask for one (graphShortcuts.ts); `open` gets whether it's "save under a name". */
function useSaveFormRequests(enabled: boolean, open: (asNew: boolean) => void) {
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!enabled) return;
    const on = (e: Event) => openRef.current(!!(e as CustomEvent<OpenSaveFormDetail>).detail?.asNew);
    window.addEventListener(OPEN_SAVE_FORM, on);
    return () => window.removeEventListener(OPEN_SAVE_FORM, on);
  }, [enabled]);
}

/**
 * Tracks an element's border-box width via ResizeObserver, so layout can respond to the bar's
 * actual rendered space (a narrowed split view, a wide Hands pill) rather than a fixed breakpoint.
 * Returns 0 until the first measurement lands.
 */
function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w != null) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** The pages, as icons: the current one shows its name, and hovering the strip shows them all. Keys lives under Files (App settings) and the More menu. */
const TABS: { page: Page; label: string; icon: IconName }[] = [
  { page: 'studio', label: 'Studio', icon: 'layoutGraph' },
  { page: 'play', label: 'Play', icon: 'play' },
  { page: 'present', label: 'Present', icon: 'slides' },
  { page: 'fn', label: 'Builder', icon: 'wave' },
  { page: 'glsl', label: 'GLSL', icon: 'code' },
  { page: 'convert', label: 'Convert', icon: 'bidir' },
  { page: 'files', label: 'Files', icon: 'folder' },
];

/**
 * Desktop top bar (redesign): brand, page tabs, and the graph-level actions that used to hide
 * in the canvas "···" menu — undo/redo, save/load by name, theme, import/export, record.
 * Mobile and tablet keep TopNav until their own phase.
 */
export function DesktopTopNav({ page, onPageChange, onRecord, compact = false }: {
  page: Page;
  onPageChange: (page: Page) => void;
  onRecord: () => void;
  /** Tablet: no wordmark, icon-only Import/Export. */
  compact?: boolean;
}) {
  const tk = useTokens();
  const mode = useThemeStore(s => s.mode);
  const toggleTheme = useThemeStore(s => s.toggle);
  const undo = useNodeGraphStore(s => s.undo);
  const redo = useNodeGraphStore(s => s.redo);
  const importGlslFromFile = useNodeGraphStore(s => s.importGlslFromFile);
  // Shortcut labels follow the user's rebinding on the Keys page.
  const [shortcuts] = useState(loadShortcutMap);
  // The Play tab shows a dot while the graph carries controls or mappings.
  const hasPlay = useNodeGraphStore(s => !isPlayRecordEmpty(s.play));

  // Responsive folding: measured off the bar itself, so a narrowed split view or a wide Hands
  // pill fold things just as a narrow window would. See topNavFold.ts for the stages.
  const [barRef, barWidth] = useElementWidth<HTMLDivElement>();
  const fold = getTopNavFold(barWidth);
  const iconOnly = compact || fold.iconOnly;
  const foldAux = compact || fold.foldAux;
  const hideWordmark = compact || fold.hideWordmark;
  const showRecordLabel = !compact && fold.recordLabel;
  // Desktop widths: every tab named, always (positions never move). Narrower: icons, the current page named.
  const tabLabels = !compact && fold.tabLabels;
  // Tabs that don't fit go in a "···" after the strip (never hidden without a way to them).
  const tabsRef = useRef<HTMLDivElement>(null);
  const hiddenTabs = useOverflowingTabs(tabsRef, barWidth, page);

  return (
    <div
      ref={barRef}
      style={{
        height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px 0 18px',
        background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}`, color: tk.text.primary,
        font: `12.5px ${fontFamily.ui}`, userSelect: 'none', minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: hideWordmark || fold.compactBrand ? 'auto' : 250, flexShrink: hideWordmark || fold.compactBrand ? 0 : 1, minWidth: hideWordmark ? undefined : 36, overflow: 'hidden' }}>
        <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: radius.md, background: tk.ink.base, color: tk.ink.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="presets" size={13} />
        </span>
        {!hideWordmark && <span style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Playfield</span>}
      </div>

      {/* The name sits before the tabs, so the strip opening on hover only takes up empty space.
          Save and Load sit beside it: everything about which graph is open is in one place. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flexShrink: 1 }}>
        <GraphNameChip compact={iconOnly || barWidth < 1500} />
        <SaveGraphButton compact={iconOnly} align="start" />
        <LoadGraphButton align="start" />
      </div>

      <div
        ref={tabsRef}
        role="tablist"
        aria-label="Pages"
        style={{
          display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: tk.bg.hover, flexShrink: 1, minWidth: 0,
          // Always scrollable, not just once `fold.scrollTabs` kicks in: the right cluster
          // (never shrinks below its own content — see below) can still squeeze this strip
          // narrower than its tabs' natural width in between fold stages, and every tab has to
          // stay reachable rather than clip silently.
          overflowX: 'auto', scrollbarWidth: 'none',
        }}
      >
        {TABS.map(t => {
          const on = page === t.page;
          const named = on || tabLabels;
          return (
            <button
              key={t.page}
              data-page-tab={t.page}
              role="tab"
              aria-selected={on}
              aria-label={t.label}
              title={named ? undefined : t.label}
              onClick={() => onPageChange(t.page)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: named ? 6 : 0,
                padding: named ? '6px 12px 6px 10px' : '6px 9px', borderRadius: 7, border: 0, cursor: 'pointer',
                background: on ? tk.bg.panel : 'transparent', boxShadow: on ? '0 1px 2px rgba(20,20,30,0.1)' : 'none',
                color: on ? tk.text.primary : tk.text.faint, font: `${on ? 600 : 500} 13px ${fontFamily.ui}`, whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <Icon name={t.icon} size={15} />
              {named && <span style={{ display: 'inline-block', verticalAlign: 'middle' }}>{t.label}</span>}
              {t.page === 'convert' && <ProBadgeFor feature="convert" style={{ marginLeft: 6 }} />}
              {t.page === 'play' && hasPlay && <span aria-label="This graph has a Play setup" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: tk.accent.base, marginLeft: 6, verticalAlign: 'middle' }} />}
            </button>
          );
        })}
      </div>
      {hiddenTabs.length > 0 && <MoreTabsButton tabs={TABS.filter(t => hiddenTabs.includes(t.page))} page={page} onPageChange={onPageChange} />}

      {/* No `minWidth: 0` here: this cluster must never shrink below its content's natural width
          (buttons/pills don't wrap or shrink themselves) — that's what stops it overlapping the
          tab strip when the bar gets tight. The tab strip (flexShrink: 1, minWidth: 0, scrollable)
          gives way instead; see topNavFold.ts for the width stages that also reduce this cluster's
          own content before it gets that far. */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, flexShrink: 0 }}>
        {!foldAux && <KeyboardPill compact={compact} />}
        {!foldAux && <HandsLive compact={compact} />}
        {!foldAux && <WorkspaceChip compact={compact} />}
        <IconButton icon="undo" label="Undo" shortcut={shortcuts.undo} onClick={undo} />
        <IconButton icon="redo" label="Redo" onClick={redo} />
        {!iconOnly && <Divider />}
        {foldAux ? (
          <OverflowMenu mode={mode} toggleTheme={toggleTheme} rebuildShortcut={shortcuts.rebuild} />
        ) : (
          <>
            <IconButton icon="rebuild" label={REBUILD_TOOLTIP} shortcut={shortcuts.rebuild} onClick={() => { void rebuildWithToast(); }} />
            <IconButton
              icon={mode === 'light' ? 'moon' : 'sun'}
              label={mode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              onClick={toggleTheme}
            />
          </>
        )}
        {!iconOnly && <Divider />}
        {iconOnly ? (
          <>
            <IconButton icon="import" label="Import a .play file, graph or presentation file" shortcut={shortcuts.import}
              onClick={() => { void importAnyFile(onPageChange); }} />
            <IconButton icon="code" label="Import a GLSL shader as a node"
              onClick={async () => { reportGlslImport(await importGlslFromFile()); }} />
            <IconButton icon="export" label="Export this graph as a .play file" shortcut={shortcuts.export}
              onClick={e => offerGraphExport(e.currentTarget)} />
          </>
        ) : (
          <>
            <Tooltip label="Import a .play file, a graph file, or a .present.json (opens on the Present page)" shortcut={shortcuts.import}>
              <Button size="sm" icon="import" aria-label="Import a .play file, graph or presentation file" onClick={() => { void importAnyFile(onPageChange); }}>Import</Button>
            </Tooltip>
            <Tooltip label="Import a GLSL fragment shader (Shadertoy or raw) as a node, wired UV → shader → Output">
              <Button size="sm" icon="code" aria-label="Import a GLSL shader as a node" onClick={async () => { reportGlslImport(await importGlslFromFile()); }}>GLSL</Button>
            </Tooltip>
            <Tooltip label="Export this graph as a .play file, with what it uses" shortcut={shortcuts.export}>
              <Button size="sm" icon="export" aria-label="Export this graph as a .play file" onClick={e => offerGraphExport(e.currentTarget)}>Export</Button>
            </Tooltip>
          </>
        )}
        <HelpMenu />
        <Tooltip label="Record the preview as video or a still" shortcut={shortcuts.toggleRecord}>
          <button
            type="button"
            aria-label="Record the preview as video or a still"
            onClick={onRecord}
            style={{
              height: 32, marginLeft: 4, padding: showRecordLabel ? '0 13px 0 11px' : '0 11px', border: 0, borderRadius: radius.control, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 7, background: tk.ink.base, color: tk.ink.text,
              font: `600 12.5px ${fontFamily.ui}`,
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: tk.status.danger, boxShadow: `0 0 0 3px ${alpha(tk.status.danger, 0.25)}` }} />
            {showRecordLabel && 'Record'}
          </button>
        </Tooltip>
        <AccountButton />
      </div>
    </div>
  );
}

/**
 * The tabs scrolled out of the strip's sight, measured after every layout change: those go in its "···".
 * The current page's tab is kept in view.
 */
function useOverflowingTabs(ref: RefObject<HTMLDivElement | null>, barWidth: number, page: Page): Page[] {
  const [hidden, setHidden] = useState<Page[]>([]);
  useLayoutEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    strip.querySelector<HTMLElement>(`[data-page-tab="${page}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const box = strip.getBoundingClientRect();
    const out: Page[] = [];
    strip.querySelectorAll<HTMLElement>('[data-page-tab]').forEach(b => {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1)) out.push(b.dataset.pageTab as Page);
    });
    setHidden(prev => (prev.join() === out.join() ? prev : out));
  }, [ref, barWidth, page]);
  return hidden;
}

function MoreTabsButton({ tabs, page, onPageChange }: { tabs: typeof TABS; page: Page; onPageChange: (p: Page) => void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <span ref={anchor} style={{ display: 'inline-flex', marginLeft: -8, flexShrink: 0 }}>
      <IconButton icon="more" label={`More pages: ${tabs.map(t => t.label).join(', ')}`} active={!!menu} tooltip={!menu}
        onClick={() => { const r = anchor.current?.getBoundingClientRect(); setMenu(r ? { x: r.left, y: r.bottom + 6 } : null); }} />
      {menu && <Menu x={menu.x} y={menu.y} minWidth={180} onClose={() => setMenu(null)}
        items={tabs.map(t => ({ label: t.label, icon: t.icon, onSelect: () => onPageChange(t.page), ...(t.page === page ? { hint: 'This page' } : {}) }))} />}
    </span>
  );
}

/**
 * The bar's "···" overflow, holding the least-used items once the bar is too narrow for them
 * inline: the Workspace/Keyboard/Hands chips (each already hides itself when it has nothing to
 * show) and Rebuild + the theme toggle. Everything here stays reachable by keyboard through this
 * one button rather than disappearing.
 */
function OverflowMenu({ mode, toggleTheme, rebuildShortcut }: { mode: ThemeMode; toggleTheme: () => void; rebuildShortcut?: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <IconButton icon="more" label="More tools" active={open} tooltip={!open} onClick={() => setOpen(o => !o)} />
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={230} padding={6}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <WorkspaceChip />
            <KeyboardPill />
            <HandsLive />
            <OverflowRow icon="rebuild" label={`${REBUILD_TOOLTIP}${rebuildShortcut ? ` (${rebuildShortcut})` : ''}`}
              onClick={() => { void rebuildWithToast(); setOpen(false); }} />
            <OverflowRow icon={mode === 'light' ? 'moon' : 'sun'} label={mode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              onClick={() => { toggleTheme(); setOpen(false); }} />
          </div>
        </Popover>
      )}
    </span>
  );
}

function OverflowRow({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 8px', border: 0, borderRadius: radius.md,
        background: hover ? tk.bg.hover : 'none', cursor: 'pointer', color: tk.text.secondary, font: `500 12.5px ${fontFamily.ui}`,
        width: '100%', textAlign: 'left',
      }}
    >
      <Icon name={icon} size={15} />
      {label}
    </button>
  );
}

/**
 * Help: the Start sheet again, the Learn lessons (moved out of Present), the Do… bar's commands,
 * the keyboard shortcuts and Report a problem, in one place (UX audit §3.2).
 */
function HelpMenu() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const items: MenuItem[] = [
    { label: 'Start…', icon: 'presets', hint: 'Examples, the Scene builder, a lesson or a blank graph', onSelect: () => useLearnUi.getState().openStart() },
    { label: 'Learn the app…', icon: 'book', hint: 'Lessons on the Studio, Play, Convert and more', onSelect: () => useLearnUi.getState().openLearn() },
    'separator',
    { label: 'Do… bar commands', icon: 'spark', onSelect: () => { requestPage('studio'); openCommandsRef(); } },
    { label: 'Keyboard shortcuts', icon: 'keyboard', onSelect: () => requestPage('shortcuts') },
    'separator',
    { label: 'Report a problem…', icon: 'warning', onSelect: () => { void import('../../files/crashReports').then(m => m.reportProblem()); } },
  ];
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <IconButton icon="book" label="Help: start, lessons, shortcuts" active={!!menu} tooltip={!menu}
        onClick={() => { const r = anchor.current?.getBoundingClientRect(); setMenu(r ? { x: Math.max(8, r.right - 260), y: r.bottom + 6 } : null); }} />
      {menu && <Menu x={menu.x} y={menu.y} minWidth={260} title="Help" items={items} onClose={() => setMenu(null)} />}
    </span>
  );
}

/** The account menu (desktop's More): who is signed in and on which plan, and Sign out. Absent with no sign-in. */
function AccountButton() {
  const session = usePlan(s => s.session);
  const anchor = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const items = accountMenuItems(session);
  if (!items.length) return null;
  return (
    <span ref={anchor} style={{ display: 'inline-flex', marginLeft: 2 }}>
      <IconButton
        icon="more"
        label={signedInLabel(session) ?? 'More'}
        active={!!menu}
        tooltip={!menu}
        onClick={() => { const r = anchor.current?.getBoundingClientRect(); setMenu(r ? { x: r.right - 240, y: r.bottom + 6 } : null); }}
      />
      {menu && <Menu x={menu.x} y={menu.y} minWidth={240} onClose={() => setMenu(null)} items={items} />}
    </span>
  );
}

/**
 * The open graph's name, in the middle of the bar: "Untitled" until it is saved, its version,
 * and a dot while there are unsaved changes. Clicking it opens the save form (name it, or save
 * a new version): this is how a graph is saved.
 */
function GraphNameChip({ compact = false }: { /** A narrow bar: the autosave indicator shows only its countdown. */ compact?: boolean }) {
  const tk = useTokens();
  const current = useNodeGraphStore(s => s.currentGraph);
  const dirty = useNodeGraphStore(s => s.graphDirty);
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [asNew, setAsNew] = useState(false);
  useSaveFormRequests(true, n => { setAsNew(n); setOpen(true); });
  const name = current?.name ?? 'Untitled';
  return (
    <span ref={anchor} style={{ display: 'inline-flex', minWidth: 0, flexShrink: 1 }}>
      <Tooltip grow label={current ? (dirty ? `Unsaved changes: save “${name}” as a new version (Minor), a new family (Major), in place, or under another name` : `Saved: “${name}” ${current.major}.${current.minor}`) : 'Not saved yet: give it a name to save it'}>
        <button
          type="button"
          onClick={() => { setAsNew(false); setOpen(o => !o); }}
          aria-label={`${name}${current ? `, version ${current.major}.${current.minor}` : ''}${dirty ? ', unsaved changes' : ''}: save`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0, maxWidth: 280, height: 30, padding: '0 10px',
            border: `1px solid ${open ? tk.border.strong : 'transparent'}`, borderRadius: radius.md, background: open ? tk.bg.hover : 'none',
            cursor: 'pointer', color: current ? tk.text.primary : tk.text.faint, font: `${current ? 600 : 500} 13px ${fontFamily.ui}`,
          }}
          onMouseEnter={e => { if (!open) e.currentTarget.style.background = tk.bg.hover; }}
          onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'none'; }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{name}</span>
          {current && <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}`, flexShrink: 0 }}>{current.major}.{current.minor}</span>}
          {(dirty || !current) && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: dirty ? tk.status.warning : tk.border.strong, flexShrink: 0 }} />}
          <Icon name="chevD" size={11} style={{ color: tk.text.faint, flexShrink: 0 }} />
        </button>
      </Tooltip>
      <AutosaveIndicator compact={compact} onClick={() => setOpen(o => !o)} />
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="start" width={320} padding={10}>
          <SaveGraphForm key={asNew ? 'new' : 'version'} asNew={asNew} onDone={() => setOpen(false)} />
        </Popover>
      )}
    </span>
  );
}

function Divider() {
  const tk = useTokens();
  return <span style={{ width: 1, height: 20, background: tk.border.default, margin: '0 6px', flexShrink: 0 }} />;
}

/** Save (a new version of the open graph, or under a name). `compact` (phones) drops the name label; the dot stays on the icon. */
export function SaveGraphButton({ compact = false, align = 'end', listen = false }: {
  compact?: boolean;
  /** Which edge of the button the save form lines up with. */
  align?: 'start' | 'end';
  /** Opens for ⌘S / ⇧⌘S (where there's no name chip: the phone bar). */
  listen?: boolean;
}) {
  const tk = useTokens();
  const current = useNodeGraphStore(s => s.currentGraph);
  const dirty = useNodeGraphStore(s => s.graphDirty);
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [asNew, setAsNew] = useState(false);
  useSaveFormRequests(listen, n => { setAsNew(n); setOpen(true); });
  return (
    <span ref={anchor} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <IconButton icon="save" label={current ? `Save “${current.name}” as a new version` : 'Save graph'} shortcut={loadShortcutMap().save} active={open} tooltip={!open} onClick={() => { setAsNew(false); setOpen(o => !o); }} style={compact ? { width: 36, height: 40 } : undefined} />
        {compact && dirty && <span aria-label="Unsaved changes" style={{ position: 'absolute', top: 8, right: 6, width: 6, height: 6, borderRadius: '50%', background: tk.status.warning, pointerEvents: 'none' }} />}
      </span>
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align={align} width={300} padding={10}>
          <SaveGraphForm key={asNew ? 'new' : 'version'} asNew={asNew} onDone={() => setOpen(false)} />
        </Popover>
      )}
    </span>
  );
}

/**
 * The saved-graphs menu: the same list as the sidebar's Saved Graphs, in the same folders (shared
 * folder state, so collapsing one here collapses it there too).
 */
export function LoadGraphButton({ align = 'end' }: { /** Which edge of the button the list lines up with. */ align?: 'start' | 'end' } = {}) {
  const tk = useTokens();
  const getSavedGraphNames = useNodeGraphStore(s => s.getSavedGraphNames);
  const loadSavedGraph = useNodeGraphStore(s => s.loadSavedGraph);
  const deleteSavedGraph = useNodeGraphStore(s => s.deleteSavedGraph);
  const savedGraphHasPlay = useNodeGraphStore(s => s.savedGraphHasPlay);
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);
  useEffect(() => {
    const refresh = () => bump(n => n + 1);
    window.addEventListener(SAVED_GRAPHS_CHANGED, refresh);
    window.addEventListener('assetbrowser-folders-changed', refresh);
    return () => { window.removeEventListener(SAVED_GRAPHS_CHANGED, refresh); window.removeEventListener('assetbrowser-folders-changed', refresh); };
  }, []);

  const names = open ? getSavedGraphNames() : [];
  const folders = open ? loadFolders(GRAPH_FOLDER_SCOPE) : [];
  const membership = open ? getMembership(GRAPH_FOLDER_SCOPE) : {};
  // Recent work first: graphs outside folders under Today / This week / Earlier (by the newest save
  // of any version), then the folders, each newest first inside.
  const now = Date.now();
  const inFolder = (folderId: string) => sortGraphsByRecent(names.filter(n => membership[n] === folderId));
  const loose = groupGraphsByTime(names.filter(n => !membership[n] || !folders.some(f => f.id === membership[n])), now);
  const head = (label: string) => (
    <div style={{ padding: '8px 8px 3px', color: tk.text.faint, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
  );
  const row = (n: string, indent: boolean) => (
    <LoadRow
      key={n}
      name={n}
      indent={indent}
      hasPlay={savedGraphHasPlay(n)}
      onLoad={() => { reportFileResult(loadSavedGraph(n), { failTitle: `Couldn’t open “${n}”` }); setOpen(false); }}
      onDelete={() => deleteSavedGraph(n)}
      onOpened={() => setOpen(false)}
    />
  );
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <IconButton icon="folder" label="Open a saved graph or an example" active={open} tooltip={!open} onClick={() => setOpen(o => !o)} />
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align={align} width={280}>
          <div data-load-scroll="" style={{ maxHeight: 'min(480px, 66vh)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {names.length === 0 ? (
            <div style={{ padding: '10px 10px', color: tk.text.faint }}>No saved graphs yet.</div>
          ) : (
            <div>
              {loose.map(g => <div key={g.id}>{head(g.label)}{g.items.map(n => row(n, false))}</div>)}
              {folders.length > 0 && head('Folders')}
              {folders.map(f => {
                const items = inFolder(f.id);
                return (
                  <div key={f.id}>
                    <button
                      type="button"
                      onClick={() => toggleFolderCollapsed(GRAPH_FOLDER_SCOPE, f.id)}
                      style={{
                        width: '100%', height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 4px', border: 0,
                        borderRadius: radius.md, background: 'none', cursor: 'pointer', color: tk.text.secondary, font: `600 12.5px ${fontFamily.ui}`,
                      }}
                    >
                      <Icon name={f.collapsed ? 'chevR' : 'chevD'} size={14} style={{ color: tk.text.faint }} />
                      <Icon name="folder" size={15} style={{ color: tk.status.success }} />
                      <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: tk.text.faint }}>{items.length}</span>
                    </button>
                    {!f.collapsed && items.map(n => row(n, true))}
                  </div>
                );
              })}
            </div>
          )}
          <ExamplesSection onOpened={() => setOpen(false)} />
          </div>
        </Popover>
      )}
    </span>
  );
}

/** The Load menu's Examples: the bundled examples by folder (the node list's Examples, one click from the header). */
function ExamplesSection({ onOpened }: { onOpened: () => void }) {
  const tk = useTokens();
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());
  const folders = EXAMPLE_FOLDERS.filter(f => f.keys.some(k => EXAMPLE_INDEX[k]));
  const flip = (label: string) => setOpenFolders(prev => { const n = new Set(prev); if (n.has(label)) n.delete(label); else n.add(label); return n; });
  return (
    <div data-load-examples="" style={{ borderTop: `1px solid ${tk.border.subtle}`, marginTop: 4, paddingTop: 2 }}>
      <div style={{ padding: '8px 8px 3px', color: tk.text.faint, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Examples</div>
      {folders.map(f => {
        const isOpen = openFolders.has(f.label);
        const keys = f.keys.filter(k => EXAMPLE_INDEX[k]).sort((a, b) => EXAMPLE_INDEX[a].label.localeCompare(EXAMPLE_INDEX[b].label));
        return (
          <div key={f.label}>
            <button type="button" aria-expanded={isOpen} onClick={() => flip(f.label)}
              style={{ width: '100%', height: 30, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 4px', border: 0, borderRadius: radius.md, background: 'none', cursor: 'pointer', color: tk.text.secondary, font: `600 12.5px ${fontFamily.ui}` }}>
              <Icon name={isOpen ? 'chevD' : 'chevR'} size={14} style={{ color: tk.text.faint }} />
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.color, flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: tk.text.faint }}>{keys.length}</span>
            </button>
            {isOpen && keys.map(k => (
              <button key={k} type="button" title={EXAMPLE_INDEX[k].description ?? undefined}
                onClick={() => { void useNodeGraphStore.getState().loadExampleGraph(k); requestPage('studio'); onOpened(); }}
                style={{ width: '100%', height: 30, display: 'flex', alignItems: 'center', padding: '0 8px 0 30px', border: 0, borderRadius: radius.md, background: 'none', cursor: 'pointer', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, textAlign: 'left' }}
                onMouseEnter={e => { e.currentTarget.style.background = tk.bg.field; }} onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{EXAMPLE_INDEX[k].label}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function LoadRow({ name, indent = false, hasPlay = false, onLoad, onDelete, onOpened }: { name: string; indent?: boolean; hasPlay?: boolean; onLoad: () => void; onDelete: () => void; onOpened?: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 4, height: 32, padding: `0 2px 0 ${indent ? 30 : 8}px`, borderRadius: radius.md, background: hover ? tk.bg.field : 'transparent' }}
    >
      <button
        type="button"
        onClick={onLoad}
        style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >{name}</button>
      <GraphLinkBadge graph={name} compact />
      {hasPlay && <span title="Loads with a Play setup" style={{ height: 18, padding: '0 6px', borderRadius: 5, display: 'inline-flex', alignItems: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 10px ${fontFamily.ui}` }}>Play</span>}
      <VersionsButton name={name} onOpened={onOpened} />
      {hover && <IconButton icon="trash" label={`Delete “${name}”`} size="sm" tone="danger" tooltip={false} onClick={onDelete} />}
    </div>
  );
}
