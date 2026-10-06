/**
 * builderLayout.ts — a builder window's sections on a phone (BuilderWindow: the 3D Scene Builder,
 * Grid Rules). A wide window shows the side panels beside the main area, a window under 1100 px
 * as drawers over it (code/SidePanels.tsx); a phone (ui/phoneDialog.ts: either way up) shows one
 * section at a time, full screen, picked from a tab row.
 */
export type BuilderTab = 'left' | 'main' | 'right';

/** The tab row on a phone: the left panel, the main area, the right panel (those that exist). */
export function builderTabs(left: string | undefined, mainLabel: string, right: string | undefined): Array<{ value: BuilderTab; label: string }> {
  return [
    ...(left ? [{ value: 'left' as const, label: left }] : []),
    { value: 'main' as const, label: mainLabel },
    ...(right ? [{ value: 'right' as const, label: right }] : []),
  ];
}
