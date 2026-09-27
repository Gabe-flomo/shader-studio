/**
 * The small export format menu (".playfile" or the readable format), opened
 * at the button that asked; PlayfileHost renders it.
 */
import { create } from 'zustand';
import type { MenuItem } from '../ui/Menu';
import type { IconName } from '../ui/iconPaths';

export const useFormatMenu = create<{ at: { x: number; y: number } | null; items: MenuItem[]; title?: string }>(() => ({ at: null, items: [] }));

/**
 * Offer ".playfile" and the readable format at a button (or a point).
 * Each option is `[label, hint, run]`; the first is the .playfile one.
 */
export function chooseExportFormat(anchor: Element | { x: number; y: number } | null, options: Array<{ label: string; hint?: string; icon?: IconName; run: () => unknown }>, title = 'Export'): void {
  let at = { x: window.innerWidth / 2 - 130, y: window.innerHeight / 2 - 60 };
  if (anchor && 'getBoundingClientRect' in anchor) { const r = anchor.getBoundingClientRect(); at = { x: Math.max(8, r.right - 280), y: r.bottom + 4 }; }
  else if (anchor) at = anchor as { x: number; y: number };
  useFormatMenu.setState({ at, title, items: options.map(o => ({ label: o.label, hint: o.hint, icon: o.icon ?? 'export', onSelect: () => { void o.run(); } })) });
}

