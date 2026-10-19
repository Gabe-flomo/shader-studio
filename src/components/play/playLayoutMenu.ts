/**
 * The Play panel's one Layout menu (UX audit §3.4): what the sidebar does beside the panel (beside
 * it, folded into the rail, hidden). Where the panel sits isn't a choice any more: the picture is
 * always on the right and the panel on its left (Play audit, user decision 2026-10-18), so the
 * four "Panel left/right/above/below" rows are gone. Pure, for PlaySplitArea.tsx and its test.
 */
import type { MenuItem } from '../ui/Menu';
import type { IconName } from '../ui/iconPaths';
import type { SidebarMode } from './playSplit';

export const SIDEBAR_OPTIONS: ReadonlyArray<{ value: SidebarMode; icon: IconName; label: string; hint: string }> = [
  { value: 'full', icon: 'sidebar', label: 'Sidebar beside the panel', hint: 'The Play sidebar stays as it is' },
  { value: 'rail', icon: 'rail', label: 'Fold the sidebar into icons', hint: 'This panel takes its width, one page at a time (⌘⇧B)' },
  { value: 'hidden', icon: 'sidebarOff', label: 'No sidebar', hint: 'Just the picture and this panel' },
];

/** The menu's rows; the current sidebar mode is tinted and says "Now". */
export function playLayoutItems(sidebar: SidebarMode, setSidebar: (m: SidebarMode) => void, accent: string): MenuItem[] {
  return [
    { heading: 'Sidebar' },
    ...SIDEBAR_OPTIONS.map(o => ({ label: o.label, icon: o.icon, hint: o.value === sidebar ? `Now · ${o.hint}` : o.hint, ...(o.value === sidebar ? { iconColor: accent } : {}), onSelect: () => setSidebar(o.value) })),
  ];
}

/** The Layout button's icon: the sidebar mode now. */
export function sidebarIcon(sidebar: SidebarMode): IconName {
  return SIDEBAR_OPTIONS.find(o => o.value === sidebar)?.icon ?? 'rail';
}
