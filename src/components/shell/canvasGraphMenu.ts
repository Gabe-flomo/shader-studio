/**
 * The canvas toolbar's "Graph ⋯" menu (UX audit §3.4): the rarely used whole-graph actions that
 * used to be icon buttons on the toolbar, which now keeps only view controls (count, frame time,
 * zoom, Fit, Auto layout, maximize, minimap, Next, flow strip, Do…). Pure, so a test can check
 * every action is still here.
 */
import type { MenuItem } from '../ui/Menu';

export interface GraphMenuActions {
  /** A locked canvas: only the outline and the passes view. */
  readOnly: boolean;
  /** Bake is for the whole graph only. */
  topLevel: boolean;
  /** Show passes: only when the graph compiles to more than one program. */
  multiProgram: boolean;
  showPasses: boolean;
  showOutline: boolean;
  /** The randomise options' one-line summary (strength, locks…), if worked out. */
  randomizeSummary?: string;
  onToggleOutline?: () => void;
  onTogglePasses: () => void;
  onBake?: () => void;
  onRandomize: () => void;
  onRandomizeOptions: () => void;
  onOptimize?: () => void;
  onClear: () => void;
  onClearMinimal?: () => void;
}

export function graphMenuItems(a: GraphMenuActions): MenuItem[] {
  const items: MenuItem[] = [];
  items.push({ heading: 'See' });
  if (a.onToggleOutline) items.push({ label: a.showOutline ? 'Hide the outline' : 'Outline', icon: 'layoutGraph', hint: 'List every node, jump to one, or step through the graph', onSelect: a.onToggleOutline });
  if (a.multiProgram) items.push({ label: a.showPasses ? 'Hide passes' : 'Show passes', icon: 'layers', hint: 'Tint each node by the program it runs in (a Pass, an Agents group, the picture)', onSelect: a.onTogglePasses });
  if (a.readOnly) return items;
  items.push({ heading: 'Change' });
  items.push({ label: 'Randomise settings', icon: 'dice', hint: `Every setting on this level, one undo step${a.randomizeSummary ? ` (${a.randomizeSummary})` : ''}`, onSelect: a.onRandomize });
  items.push({ label: 'Randomise options…', icon: 'sliders', hint: 'Strength, locks, groups, focus and a seed', onSelect: a.onRandomizeOptions });
  if (a.onOptimize) items.push({ label: 'Optimise graph…', icon: 'spark', hint: 'Fold runs of math cards into Expression Blocks, sliders kept, picture unchanged', onSelect: a.onOptimize });
  if (a.onBake && a.topLevel) items.push({ label: 'Bake the picture…', icon: 'record', hint: 'Render it once to a video and play that instead (much lighter to run; Unbake brings it back)', onSelect: a.onBake });
  items.push('separator');
  items.push({ label: a.onClearMinimal ? 'Reset to the starter graph' : 'Clear all nodes', icon: 'trash', danger: true, onSelect: a.onClear });
  if (a.onClearMinimal) items.push({ label: 'Clear to UV and Output', icon: 'trash', danger: true, onSelect: a.onClearMinimal });
  return items;
}
