/**
 * The link between a tab host (BigEditorScaffold / SectionTabs) and the
 * Section cards inside it. Sections register themselves, so an editor
 * doesn't have to list its sections anywhere: whatever Sections are mounted
 * (conditional ones included) are the tabs, in the order they sit on the page.
 * docs/editor-layout.md has the pattern.
 */
import { createContext, useContext } from 'react';

export interface SectionEntry {
  /** The tab's identity: the Section's `id`, else its title (a title that changes, like "Pad 3", needs an `id`). */
  key: string;
  title: string;
  kind: string;
  primary: boolean;
  /** The Section's root element (always rendered, hidden when not the open tab): its place in the page orders the tabs. */
  el: { readonly current: HTMLElement | null };
  /** A glance at what's set inside (only a plain string reaches the tab's tooltip). */
  summary?: string;
  hint?: string;
  /** A section with its own switch (Flocking, Sequence…): whether it's on. */
  on?: boolean;
}

export type SectionMeta = Pick<SectionEntry, 'summary' | 'hint' | 'on'>;

export interface SectionTabsApi {
  /**
   * 'pending': the host hasn't heard from its sections yet (their first render, before layout effects): render nothing heavy.
   * 'tabs': one section at a time. 'all': stacked, folded by default. 'single': fewer than two sections, as before.
   */
  mode: 'pending' | 'tabs' | 'all' | 'single';
  /** The open tab's key ('tabs' mode). */
  active: string;
  /** Tabs opened at least once: they stay mounted (hidden) so nothing held inside them is lost on a switch. */
  mounted: ReadonlySet<string>;
  register: (e: SectionEntry) => () => void;
  setMeta: (key: string, meta: SectionMeta) => void;
}

export const SectionTabsContext = createContext<SectionTabsApi | null>(null);

export function useSectionTabs(): SectionTabsApi | null {
  return useContext(SectionTabsContext);
}

/** The tab key a Section goes by. */
export const sectionKey = (id: string | undefined, title: string) => id || title;
