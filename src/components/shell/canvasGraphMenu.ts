/**
 * The canvas's own menus (docs/page-canvas.md). The canvas toolbar keeps three controls (Maximize
 * graph, Outline, Randomise); everything else that used to sit on it, or in its "Graph ⋯" menu,
 * is in the canvas background's right-click menu (a long press on touch): Fit, zoom to 100%, Auto
 * layout, the minimap, Next suggestions, Show passes, Optimise, Bake, and the resets. Randomise
 * has one place: its toolbar button, whose right-click menu is `randomiseMenuItems`.
 *
 * Pure, so a test can check every action is still here and wired to its handler.
 */
import type { MenuItem } from '../ui/Menu';

/** One row of the canvas background menu. */
export interface CanvasMenuRow {
  /** Stable id (data-ctx-canvas on the row), for tests and docs. */
  id: string;
  label: string;
  /** Shown faint at the row's end (a key, the zoom now). */
  shortcut?: string;
  /** The row's tooltip. */
  hint?: string;
  danger?: boolean;
  onSelect: () => void;
}
export type CanvasMenuItem = CanvasMenuRow | { heading: string } | 'separator';

export interface CanvasMenuActions {
  /** A locked canvas: only the view items (Fit, zoom, minimap, passes). */
  readOnly: boolean;
  /** Bake is for the whole graph only. */
  topLevel: boolean;
  /** Show passes: only when the graph compiles to more than one program. */
  multiProgram: boolean;
  showPasses: boolean;
  /** The minimap toggle (absent where there is no minimap: touch screens). */
  showMinimap?: boolean;
  onToggleMinimap?: () => void;
  /** Next: the suggestions under the selected node. */
  showNext: boolean;
  onToggleNext: () => void;
  /** The zoom now (1 = 100%). */
  zoom: number;
  onResetZoom: () => void;
  onFit: () => void;
  onAutoLayout: () => void;
  onTogglePasses: () => void;
  onOptimize?: () => void;
  onBake?: () => void;
  onClear: () => void;
  onClearMinimal?: () => void;
}

export function canvasMenuItems(a: CanvasMenuActions): CanvasMenuItem[] {
  const items: CanvasMenuItem[] = [{ heading: 'View' }];
  items.push({ id: 'fit', label: 'Fit all nodes in view', shortcut: 'F', onSelect: a.onFit });
  items.push({ id: 'zoom', label: 'Zoom to 100%', shortcut: `${Math.round(a.zoom * 100)}%`, hint: 'Scroll or pinch to zoom; the corner shows the zoom', onSelect: a.onResetZoom });
  if (!a.readOnly) items.push({ id: 'layout', label: 'Auto layout', hint: 'Arrange left-to-right by data flow (one undo step)', onSelect: a.onAutoLayout });
  if (a.onToggleMinimap) items.push({ id: 'minimap', label: a.showMinimap ? 'Hide the minimap' : 'Show the minimap', onSelect: a.onToggleMinimap });
  if (!a.readOnly) items.push({ id: 'next', label: a.showNext ? 'Hide Next suggestions' : 'Show Next suggestions', hint: 'Suggested moves under the selected node, learned from your graphs', onSelect: a.onToggleNext });
  if (a.multiProgram) items.push({ id: 'passes', label: a.showPasses ? 'Hide passes' : 'Show passes', hint: 'Tint each node by the program it runs in (a Pass, an Agents group, the picture)', onSelect: a.onTogglePasses });
  if (a.readOnly) return items;
  items.push({ heading: 'Graph' });
  if (a.onOptimize) items.push({ id: 'optimise', label: 'Optimise graph…', hint: 'Fold runs of math cards into Expression Blocks, sliders kept, picture unchanged', onSelect: a.onOptimize });
  if (a.onBake && a.topLevel) items.push({ id: 'bake', label: 'Bake the picture…', hint: 'Render it once to a video and play that instead (much lighter to run; Unbake brings it back)', onSelect: a.onBake });
  items.push({ id: 'reset', label: a.onClearMinimal ? 'Reset to the starter graph' : 'Clear all nodes', danger: true, onSelect: a.onClear });
  if (a.onClearMinimal) items.push({ id: 'clearMinimal', label: 'Clear to UV and Output', danger: true, onSelect: a.onClearMinimal });
  return items;
}

/** The Randomise button's right-click menu: the one place for randomising the graph's settings. */
export function randomiseMenuItems(a: { summary?: string; onRandomize: () => void; onOptions: () => void }): MenuItem[] {
  return [
    { label: 'Randomise settings', icon: 'dice', hint: `Every setting on this level, one undo step${a.summary ? ` (${a.summary})` : ''}`, onSelect: a.onRandomize },
    { label: 'Randomise options…', icon: 'sliders', hint: 'Strength, locks, groups, focus and a seed', onSelect: a.onOptions },
  ];
}
