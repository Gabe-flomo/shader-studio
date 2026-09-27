/**
 * groupedPickerModel — the pure parts of GroupedPicker: filtering sections by a
 * search, the flat list the arrow keys walk (headings are never in it), moving
 * through that list and type-ahead. No React, so it is unit-tested directly.
 */
import type { IconName } from './iconPaths';

export interface PickerItem {
  value: string;
  label: string;
  /** One short muted line under the label. */
  description?: string;
  icon?: IconName;
  /** Shows the Pro badge. The item stays pickable: the caller decides what picking it does. */
  pro?: boolean;
  disabled?: boolean;
  /** Extra words the search matches (not shown). */
  keywords?: string;
}

export interface PickerSection { heading?: string; items: readonly PickerItem[] }

/** Above this many items the search field shows by default. */
export const SEARCH_ABOVE = 10;

export function countItems(sections: readonly PickerSection[]): number {
  return sections.reduce((n, s) => n + s.items.length, 0);
}

/**
 * Sections whose items match every word of `query` (case-insensitive) in their
 * label, description, keywords or section heading. Empty sections drop out; an
 * empty query returns the sections as they are.
 */
export function filterSections(sections: readonly PickerSection[], query: string): PickerSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return sections.filter(s => s.items.length > 0);
  const out: PickerSection[] = [];
  for (const s of sections) {
    const items = s.items.filter(it => {
      const hay = `${it.label} ${it.description ?? ''} ${it.keywords ?? ''} ${s.heading ?? ''}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
    if (items.length) out.push({ heading: s.heading, items });
  }
  return out;
}

/** The values the keyboard moves through, in order: every enabled item, headings skipped. */
export function navigableValues(sections: readonly PickerSection[]): string[] {
  const out: string[] = [];
  for (const s of sections) for (const it of s.items) if (!it.disabled) out.push(it.value);
  return out;
}

export type NavKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'PageDown' | 'PageUp';
const PAGE = 8;

/**
 * The active value after a navigation key. Arrows wrap; Home/End jump to the
 * ends; Page keys move eight and stop at the ends. From nothing active, Down
 * starts at the top and Up at the bottom.
 */
export function moveActive(values: readonly string[], active: string | null, key: NavKey): string | null {
  const n = values.length;
  if (!n) return null;
  const at = active === null ? -1 : values.indexOf(active);
  switch (key) {
    case 'Home': return values[0];
    case 'End': return values[n - 1];
    case 'ArrowDown': return values[at < 0 ? 0 : (at + 1) % n];
    case 'ArrowUp': return values[at < 0 ? n - 1 : (at - 1 + n) % n];
    case 'PageDown': return values[at < 0 ? Math.min(PAGE - 1, n - 1) : Math.min(at + PAGE, n - 1)];
    case 'PageUp': return values[at < 0 ? 0 : Math.max(at - PAGE, 0)];
  }
}

/**
 * Type-ahead without a search field: the next enabled item (after `active`,
 * wrapping) whose label starts with `prefix`, or null. A prefix of one letter
 * repeated ("mmm") cycles through the items starting with that letter.
 */
export function typeahead(sections: readonly PickerSection[], active: string | null, prefix: string): string | null {
  const p = prefix.toLowerCase();
  if (!p) return null;
  const items = sections.flatMap(s => s.items).filter(it => !it.disabled);
  if (!items.length) return null;
  const same = p.split('').every(c => c === p[0]);
  const want = same ? p[0] : p;
  const at = active === null ? -1 : items.findIndex(it => it.value === active);
  // A longer prefix may still match the current item; a single repeated letter moves on.
  const start = same ? at + 1 : Math.max(at, 0);
  for (let k = 0; k < items.length; k++) {
    const it = items[(start + k) % items.length];
    if (it.label.toLowerCase().startsWith(want)) return it.value;
  }
  return null;
}

/** The item for a value, wherever it sits. */
export function findItem(sections: readonly PickerSection[], value: string): PickerItem | undefined {
  for (const s of sections) for (const it of s.items) if (it.value === value) return it;
  return undefined;
}

/** Select-style options (`group` on each) as sections: a run of options sharing a group is one section. */
export function sectionsFromOptions(options: readonly { value: string; label: string; group?: string }[]): PickerSection[] {
  const out: { heading?: string; items: PickerItem[] }[] = [];
  for (const o of options) {
    const last = out[out.length - 1];
    const item = { value: o.value, label: o.label };
    if (last && last.heading === o.group) last.items.push(item);
    else out.push({ heading: o.group, items: [item] });
  }
  return out;
}
