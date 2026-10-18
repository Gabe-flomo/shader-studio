import { randomizeGraphAction } from '../surprise/surpriseActions';
import { RandomizePopover } from '../surprise/RandomizePopover';
import { getRandomizeOptions, optionsSummary } from '../../nodes/randomizeOptions';
import { lockedItems } from '../../nodes/randomizeParams';
import { Suspense, useMemo, useRef, useState, type ReactNode } from 'react';
import { lazySafe } from '../lazyWithSuspense';
import { useNodeGraphStore, getActiveNodes } from '../../store/useNodeGraphStore';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { categoryColor } from '../../theme/categories';
import type { GraphNode } from '../../types/nodeGraph';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Popover } from '../ui/Popover';
import { Menu } from '../ui/Menu';
import { randomiseMenuItems } from './canvasGraphMenu';
import { Tooltip } from '../ui/Tooltip';
import { computeGraphStats, countNodes, mainBodyLines } from './graphStats';
import { PerfBadge, PerfPanel } from './PerfPanel';
import { useGraphMaximize } from './graphLayout';
import { isDesktop, useBreakpoint } from '../../hooks/useBreakpoint';
import { loadShortcutMap } from '../../hooks/useShortcuts';
import { useLongPress } from '../../lib/longPress';

// Loaded on first use: the finder pulls in the compiler and the offscreen renderer.
const SuggestControlsPanel = lazySafe(() => import('../play/SuggestControlsPanel'));

/**
 * Floating toolbar at the top centre of the canvas: exactly three controls. Maximize graph (the
 * picture goes behind the graph, shell/graphLayout.ts), the Outline, and Randomise (click: one undo
 * step; right-click or a long press: Randomise settings / Randomise options…).
 *
 * Everything else lives elsewhere (docs/page-canvas.md): zoom by scroll/pinch and the keys, with
 * the percentage in the canvas corner; Fit (F), Auto layout, the minimap, Next suggestions, Show
 * passes, Optimise, Bake and the resets in the canvas's right-click menu (canvasGraphMenu.ts); the
 * node count and frame time in the status bar under the graph (GraphStatus).
 */
export function CanvasToolbar({ showOutline = false, onToggleOutline, readOnly = false }: {
  /** The outline panel: a list of the nodes in evaluation order, with step-through. */
  showOutline?: boolean;
  onToggleOutline?: () => void;
  /** A locked canvas: no maximize and no randomise; the outline stays. */
  readOnly?: boolean;
}) {
  const tk = useTokens();
  return (
    <div
      data-graph-overlay=""
      data-canvas-toolbar=""
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 15,
        display: 'flex', alignItems: 'center', gap: 2, padding: 5, borderRadius: 12, whiteSpace: 'nowrap',
        background: tk.bg.panel, boxShadow: tk.shadow.float, font: `12px ${fontFamily.ui}`,
      }}
    >
      {!readOnly && <MaximizeGraphButton />}
      {onToggleOutline && (
        <IconButton icon="layoutGraph" size="sm" active={showOutline} data-outline-toggle=""
          label={showOutline ? 'Hide the outline' : 'Outline: list every node, jump to one, or step through the graph'} onClick={onToggleOutline} />
      )}
      {!readOnly && <RandomiseButton />}
    </div>
  );
}

/** Desktop Studio: the graph takes the whole window and the picture goes behind it (shell/graphLayout.ts), or the split comes back. */
function MaximizeGraphButton() {
  const on = useGraphMaximize(s => s.on);
  const toggle = useGraphMaximize(s => s.toggle);
  const bp = useBreakpoint();
  if (!isDesktop(bp)) return null;
  return (
    <IconButton icon={on ? 'splitPanel' : 'layoutCanvas'} data-maximize-graph=""
      label={on ? 'Bring the preview back beside the graph' : 'Maximize the graph: the picture goes behind it, full size'}
      shortcut={loadShortcutMap().maximizeGraph} size="sm" active={on} onClick={toggle} />
  );
}

/**
 * Randomise (docs/surprise.md): a click moves every setting on the level on screen by the saved
 * strength, locks and group options, as one undo step. A right-click (or a long press) opens its
 * small menu: Randomise settings, and Randomise options… (strength, locks, groups, focus, seed).
 */
export function RandomiseButton() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; summary: string } | null>(null);
  const [options, setOptions] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const openMenu = (x: number, y: number) => {
    // Counting locks walks the whole graph: worked out when the menu opens, not per render.
    const summary = optionsSummary(getRandomizeOptions(), lockedItems(useNodeGraphStore.getState().nodes).length);
    setMenu({ x, y, summary });
  };
  const hold = useLongPress(openMenu);
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <IconButton icon="dice" size="sm" data-randomize="" aria-haspopup="menu" active={!!menu || options}
        label="Randomise settings (one undo step). Right-click for options"
        onClick={() => { if (hold.consumeClick()) return; void randomizeGraphAction(); }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY); }}
        onPointerDown={hold.onPointerDown} onPointerMove={hold.onPointerMove} onPointerUp={hold.onPointerUp} onPointerCancel={hold.onPointerCancel}
        style={hold.style} />
      {menu && (
        <Menu x={menu.x} y={menu.y} minWidth={260} title="Randomise" onClose={() => setMenu(null)}
          items={randomiseMenuItems({ summary: menu.summary, onRandomize: () => void randomizeGraphAction(), onOptions: () => setOptions(true) })} />
      )}
      {options && <RandomizePopover anchorRef={anchor} onClose={() => setOptions(false)} onSuggest={() => setSuggest(true)} />}
      {suggest && <Suspense fallback={null}><SuggestControlsPanel anchorRef={anchor} offerOpenPlay onClose={() => setSuggest(false)} /></Suspense>}
    </span>
  );
}

/**
 * The graph's status, for the bar under the canvas: the node count on the level on screen (click:
 * the graph's stats) and the frame time (click: the performance panel). Reads the store itself.
 */
export function GraphStatus() {
  const nodes = useNodeGraphStore(s => s.nodes);
  const activeGroupPath = useNodeGraphStore(s => s.activeGroupPath);
  const activeGroupId = useNodeGraphStore(s => s.activeGroupId);
  const selected = useNodeGraphStore(s => s.selectedNodeIds.length);
  const level = useMemo(() => (activeGroupPath.length ? getActiveNodes(nodes, activeGroupPath) ?? [] : nodes), [nodes, activeGroupPath]);
  const topLevel = activeGroupPath.length === 0;
  const groupName = useMemo(() => {
    if (!activeGroupId) return undefined;
    const parent = activeGroupPath.length > 1 ? getActiveNodes(nodes, activeGroupPath.slice(0, -1)) ?? [] : nodes;
    const g = parent.find(n => n.id === activeGroupId);
    return g ? (typeof g.params?.label === 'string' && g.params.label) || 'Group' : undefined;
  }, [nodes, activeGroupId, activeGroupPath]);
  const { total, insideGroups } = useMemo(() => countNodes(level), [level]);
  const countRef = useRef<HTMLSpanElement>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const perfRef = useRef<HTMLSpanElement>(null);
  const [perfOpen, setPerfOpen] = useState(false);
  const countLabel = selected > 1 ? `${selected} of ${total} selected` : `${total} ${total === 1 ? 'node' : 'nodes'}`;
  const countTip = topLevel
    ? `${total} nodes in the whole graph${insideGroups ? ` (${insideGroups} inside groups)` : ''}`
    : `${total} nodes in ${groupName ?? 'this group'}`;
  return (
    // The bar this sits in opens the code on a click: keep these clicks (and their popovers') here.
    <span data-graph-status="" onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <span ref={countRef} style={{ display: 'inline-flex' }}>
        <Tooltip label={countTip} disabled={statsOpen}>
          <ToolButton icon="nodes" active={statsOpen || selected > 1} onClick={() => setStatsOpen(o => !o)}>{countLabel}</ToolButton>
        </Tooltip>
      </span>
      {statsOpen && (
        <Popover anchorRef={countRef} onClose={() => setStatsOpen(false)} align="end" width={420} padding={0}>
          <GraphStatsPanel nodes={level} topLevel={topLevel} groupName={groupName} onClose={() => setStatsOpen(false)} />
        </Popover>
      )}
      <span ref={perfRef} style={{ display: 'inline-flex' }}>
        <Tooltip label="Performance: frame time, compiles, cost by node" disabled={perfOpen}>
          <ToolButton icon="wave" active={perfOpen} onClick={() => setPerfOpen(o => !o)}><PerfBadge /></ToolButton>
        </Tooltip>
      </span>
      {perfOpen && (
        <Popover anchorRef={perfRef} onClose={() => setPerfOpen(false)} align="end" width={420} padding={0}>
          <PerfPanel onClose={() => setPerfOpen(false)} />
        </Popover>
      )}
    </span>
  );
}

function ToolButton({ icon, active = false, onClick, children }: { icon: IconName; active?: boolean; onClick: () => void; children: ReactNode }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 28, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', border: 0, borderRadius: radius.md,
        cursor: 'pointer', font: `500 12px ${fontFamily.ui}`,
        background: active ? tk.bg.selected : hover ? tk.bg.hover : 'transparent',
        color: active ? tk.accent.base : tk.text.secondary,
      }}
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}

// ── Stats panel ─────────────────────────────────────────────────────────────

function GraphStatsPanel({ nodes, topLevel, groupName, onClose }: {
  nodes: readonly GraphNode[];
  topLevel: boolean;
  groupName?: string;
  onClose: () => void;
}) {
  const tk = useTokens();
  const mode = useThemeMode();
  const selectNodes = useNodeGraphStore(s => s.selectNodes);
  const errorCount = useNodeGraphStore(s => s.compilationErrors.length + s.glslErrors.length);
  const fragmentShader = useNodeGraphStore(s => s.fragmentShader);
  const stats = useMemo(() => computeGraphStats(nodes, topLevel), [nodes, topLevel]);
  const maxCat = Math.max(1, ...stats.byCategory.map(c => c.count));
  const glslLines = fragmentShader ? fragmentShader.split('\n').length : 0;
  const mainLines = useMemo(() => (fragmentShader ? mainBodyLines(fragmentShader) : null), [fragmentShader]);
  const [wholeFile, setWholeFile] = useState(false);
  const uniforms = fragmentShader ? (fragmentShader.match(/^\s*uniform\s/gm) ?? []).length : 0;
  const select = (ids: string[]) => { selectNodes(ids); onClose(); };

  const caps = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' as const };
  const section = { padding: '12px 16px', borderBottom: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column' as const, gap: 7 };
  const link = { border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` };

  const kpis: [number, string][] = [[stats.nodes, 'nodes'], [stats.wires, 'wires'], [stats.groups, 'groups'], [stats.keyframed, 'keyframed']];

  return (
    <div style={{ color: tk.text.secondary }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 10px 16px', borderBottom: `1px solid ${tk.border.subtle}` }}>
        <b style={{ fontSize: 14, fontWeight: 650, color: tk.text.primary, marginRight: 'auto' }}>{topLevel ? 'Graph' : groupName ?? 'Group'}</b>
        <span style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.muted, background: tk.bg.hover, borderRadius: 6, padding: '2px 6px' }}>
          {topLevel ? `whole graph${stats.groups ? ` · incl. ${stats.groups} ${stats.groups === 1 ? 'group' : 'groups'}` : ''}` : 'this group'}
        </span>
        <IconButton icon="close" label="Close" size="sm" tooltip={false} onClick={onClose} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: `1px solid ${tk.border.subtle}` }}>
        {kpis.map(([n, l], i) => (
          <div key={l} style={{ padding: '12px 14px', borderLeft: i ? `1px solid ${tk.border.subtle}` : 'none' }}>
            <div style={{ font: `650 20px ${fontFamily.ui}`, color: tk.text.primary }}>{n}</div>
            <div style={{ fontSize: 11.5, color: tk.text.muted }}>{l}</div>
          </div>
        ))}
      </div>

      {stats.byCategory.length > 0 && (
        <div style={section}>
          <div style={caps}>By category</div>
          {stats.byCategory.map(c => (
            <div key={c.category} style={{ display: 'grid', gridTemplateColumns: '104px 1fr 24px', alignItems: 'center', gap: 10, fontSize: 12 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.category}</span>
              <span style={{ height: 8, borderRadius: 4, background: tk.bg.field, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(c.count / maxCat) * 100}%`, borderRadius: 4, background: categoryColor(c.category, mode) }} />
              </span>
              <span style={{ textAlign: 'right', font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>{c.count}</span>
            </div>
          ))}
        </div>
      )}

      {(stats.mostUsed.length > 0 || stats.mostConnected.length > 0) && (
        <div style={{ ...section, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px' }}>
          <div>
            <div style={{ ...caps, marginBottom: 4 }}>Most used</div>
            {stats.mostUsed.length === 0 && <div style={{ fontSize: 12, color: tk.text.faint }}>No repeats</div>}
            {stats.mostUsed.map(t => (
              <StatRow key={t.type} dot={categoryColor(t.category, mode)} label={t.label} value={`×${t.count}`} action={`Select ${t.count}`} onClick={() => select(t.ids)} />
            ))}
          </div>
          <div>
            <div style={{ ...caps, marginBottom: 4 }}>Most connected</div>
            {stats.mostConnected.map(h => (
              <StatRow key={h.id} label={h.label} value={`${h.wires} ${h.wires === 1 ? 'wire' : 'wires'}`} action="Select" onClick={() => select([h.id])} />
            ))}
          </div>
        </div>
      )}

      <div style={section}>
        <div style={caps}>Worth a look</div>
        {topLevel && stats.deadEnds.length > 0 && (
          <Issue icon="unlink" tone={tk.status.warning} text={`${stats.deadEnds.length} ${stats.deadEnds.length === 1 ? 'node doesn’t' : 'nodes don’t'} reach the Output`}
            action={<button type="button" style={link} onClick={() => select(stats.deadEnds)}>Select</button>} />
        )}
        {stats.bypassed.length > 0 && (
          <Issue icon="bypass" tone={tk.text.muted} text={`${stats.bypassed.length} ${stats.bypassed.length === 1 ? 'node' : 'nodes'} bypassed`}
            action={<button type="button" style={link} onClick={() => select(stats.bypassed)}>Select</button>} />
        )}
        {errorCount > 0
          ? <Issue icon="alert" tone={tk.status.danger} text={`${errorCount} compile ${errorCount === 1 ? 'error' : 'errors'}`} />
          : <Issue icon="check" tone={tk.status.success} text="No compile errors" />}
      </div>

      <div style={{ display: 'flex', gap: 14, padding: '10px 16px', background: tk.bg.subtle, borderRadius: `0 0 ${radius.lg}px ${radius.lg}px`, font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted }}>
        <Tooltip label={wholeFile ? 'Show lines in main() only' : 'Show lines in the whole shader file'}>
          <button
            type="button"
            onClick={() => setWholeFile(w => !w)}
            style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: tk.text.secondary, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
          >
            {wholeFile || mainLines === null ? `${glslLines} lines in the whole file` : `${mainLines} lines in main()`}
          </button>
        </Tooltip>
        <span>{uniforms} uniforms</span>
      </div>
    </div>
  );
}

function StatRow({ dot, label, value, action, onClick }: { dot?: string; label: string; value: string; action: string; onClick: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 'calc(100% + 12px)', height: 28, margin: '0 -6px', padding: '0 6px', display: 'flex', alignItems: 'center', gap: 8,
        border: 0, borderRadius: 7, cursor: 'pointer', background: hover ? tk.bg.field : 'transparent', textAlign: 'left',
        font: `12.5px ${fontFamily.ui}`, color: tk.text.primary,
      }}
    >
      {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {hover && <span style={{ color: tk.accent.text, fontSize: 11.5, fontWeight: 600 }}>{action}</span>}
      <span style={{ font: `600 11.5px ${fontFamily.mono}`, color: tk.text.muted }}>{value}</span>
    </button>
  );
}

function Issue({ icon, tone, text, action }: { icon: IconName; tone: string; text: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
      <span style={{ width: 22, height: 22, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tone, 0.14), color: tone }}>
        <Icon name={icon} size={13} />
      </span>
      <span style={{ flex: 1 }}>{text}</span>
      {action}
    </div>
  );
}
