/**
 * The Play panel's one Layout menu (UX audit §3.4): where the panel sits beside the picture (four
 * sides) and what the sidebar does (beside it, folded into the rail, hidden). These used to be seven
 * radio buttons in the panel's header. Pure, for PlaySplitArea.tsx and its test.
 */
import type { MenuItem } from '../ui/Menu';
import type { IconName } from '../ui/iconPaths';
import type { SidebarMode, SplitSide } from './playSplit';

export const SIDE_OPTIONS: ReadonlyArray<{ value: SplitSide; icon: IconName; label: string }> = [
  { value: 'left', icon: 'panelLeft', label: 'Panel left of the picture' },
  { value: 'right', icon: 'panelRight', label: 'Panel right of the picture' },
  { value: 'top', icon: 'panelTop', label: 'Panel above the picture' },
  { value: 'bottom', icon: 'panelBottom', label: 'Panel below the picture' },
];

export const SIDEBAR_OPTIONS: ReadonlyArray<{ value: SidebarMode; icon: IconName; label: string; hint: string }> = [
  { value: 'full', icon: 'sidebar', label: 'Sidebar beside the panel', hint: 'The Play sidebar stays as it is' },
  { value: 'rail', icon: 'rail', label: 'Fold the sidebar into icons', hint: 'This panel takes its width, one page at a time (⌘⇧B)' },
  { value: 'hidden', icon: 'sidebarOff', label: 'No sidebar', hint: 'Just the picture and this panel' },
];

/** The menu's rows; the current side and sidebar mode are tinted and say "Now". */
export function playLayoutItems(side: SplitSide, sidebar: SidebarMode, setSide: (s: SplitSide) => void, setSidebar: (m: SidebarMode) => void, accent: string): MenuItem[] {
  return [
    { heading: 'Panel' },
    ...SIDE_OPTIONS.map(o => ({ label: o.label, icon: o.icon, ...(o.value === side ? { iconColor: accent, hint: 'Now' } : {}), onSelect: () => setSide(o.value) })),
    { heading: 'Sidebar' },
    ...SIDEBAR_OPTIONS.map(o => ({ label: o.label, icon: o.icon, hint: o.value === sidebar ? `Now · ${o.hint}` : o.hint, ...(o.value === sidebar ? { iconColor: accent } : {}), onSelect: () => setSidebar(o.value) })),
  ];
}

/** The Layout button's icon: where the panel sits now. */
export function sideIcon(side: SplitSide): IconName {
  return SIDE_OPTIONS.find(o => o.value === side)?.icon ?? 'panelRight';
}
