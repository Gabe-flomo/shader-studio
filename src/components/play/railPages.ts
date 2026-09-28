/**
 * railPages.ts — what the split view's icon rail offers (docs/split-view.md,
 * "Rail and full-width pages"): the Play page's categories (Controls —
 * Mappings included, Layers, Finish, Engine), each with its pages. A page is
 * what the big panel shows full width once the sidebar is collapsed into the
 * rail; the phone's bottom row offers the same pages in a sheet.
 *
 * Pure data and helpers: PlayRail.tsx draws the rail and its drawer,
 * PlayPage renders each page into the panel.
 */
import type { PlayRecord } from '../../types/play';
import type { IconName } from '../ui/iconPaths';
import { tabForPage, type PlayTab } from './playUi';

/**
 * The rail's own grouping of pages, which sections its icons (RAIL_CATEGORIES
 * below). It used to be the same union as PlayTab (the sidebar's own tab-strip
 * sections, playUi.ts), one category per tab; Controls and Mappings merged
 * into one rail category (the owner's call, 2026-09-28) while the tab-strip
 * elsewhere still keeps them apart, so the two unions parted ways here.
 */
export type RailCategory = 'controls' | 'layers' | 'finish' | 'engine';

export type RailPage =
  | 'controls'
  | 'layers' | 'actions' | 'signals' | 'background'
  | 'finish-picture' | 'finish-sound'
  | 'engine-performance'
  | 'mappings' | 'midi-file' | 'pad-grid';

export interface RailPageDef {
  id: RailPage;
  category: RailCategory;
  label: string;
  /** One line under the name in the drawer. */
  description: string;
}

export interface RailCategoryDef {
  id: RailCategory;
  label: string;
  icon: IconName;
  /** The rail icon's tooltip. */
  description: string;
  pages: readonly RailPage[];
}

export const RAIL_PAGES: Readonly<Record<RailPage, RailPageDef>> = {
  controls: { id: 'controls', category: 'controls', label: 'Controls', description: 'The sliders, colours and buttons people play' },
  layers: { id: 'layers', category: 'layers', label: 'Layers', description: 'What sits on the picture, with the selected layer’s editor' },
  actions: { id: 'actions', category: 'layers', label: 'Actions', description: 'When something happens, do something to a layer' },
  signals: { id: 'signals', category: 'layers', label: 'Signals', description: 'Named events that actions send and others listen for' },
  background: { id: 'background', category: 'layers', label: 'Background', description: 'What the picture is under the layers' },
  'finish-picture': { id: 'finish-picture', category: 'finish', label: 'Picture', description: 'Grade, lens, film and time effects over the whole picture' },
  'finish-sound': { id: 'finish-sound', category: 'finish', label: 'Sound', description: 'Reverb, echo, filter and more on each sound and the master' },
  'engine-performance': { id: 'engine-performance', category: 'engine', label: 'Arrangement', description: 'Racks of synths and effects, played live' },
  mappings: { id: 'mappings', category: 'controls', label: 'Mappings', description: 'Inputs onto controls: source, range, curve, smoothing' },
  'midi-file': { id: 'midi-file', category: 'controls', label: 'MIDI file', description: 'A MIDI file played as if from a controller' },
  'pad-grid': { id: 'pad-grid', category: 'controls', label: 'Pad grid', description: 'A grid of pads from a controller, read as sources' },
};

export const RAIL_CATEGORIES: readonly RailCategoryDef[] = [
  { id: 'controls', label: 'Controls', icon: 'sliders', description: 'The panel people play, and what maps onto it', pages: ['controls', 'mappings', 'midi-file', 'pad-grid'] },
  { id: 'layers', label: 'Layers', icon: 'layers', description: 'Layers, actions, signals and the background', pages: ['layers', 'actions', 'signals', 'background'] },
  { id: 'finish', label: 'Finish', icon: 'curve', description: 'Effects over the picture and the sound', pages: ['finish-picture', 'finish-sound'] },
  { id: 'engine', label: 'Engine', icon: 'piano', description: 'The Audio engine', pages: ['engine-performance'] },
];

/**
 * Each rail category's keyboard shortcut (⌘1–4; useShortcuts.ts's own
 * `DEFAULT_ACTIONS` strings must match — App.tsx wires these up, and also
 * binds the ⌃ equivalent, since a plain browser tab claims ⌘1–4 for its own
 * tabs before the page ever sees the keydown).
 */
export const RAIL_CATEGORY_SHORTCUT: Readonly<Record<RailCategory, string>> = {
  controls: 'cmd+1', layers: 'cmd+2', finish: 'cmd+3', engine: 'cmd+4',
};

export const RAIL_PAGE_IDS = Object.keys(RAIL_PAGES) as RailPage[];

export function isRailPage(v: unknown): v is RailPage {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(RAIL_PAGES, v);
}

export function categoryOf(page: RailPage): RailCategory {
  return RAIL_PAGES[page].category;
}

export function categoryDef(cat: RailCategory): RailCategoryDef {
  return RAIL_CATEGORIES.find(c => c.id === cat) ?? RAIL_CATEGORIES[0];
}

/** The page a category opens on. */
export function firstPageOf(cat: RailCategory): RailPage {
  return categoryDef(cat).pages[0];
}

/**
 * The page matching what the tab-strip panel shows (the rail starts where the
 * panel was). Independent of the rail's own category grouping (RailCategory):
 * Mappings is its own tab-strip tab even though it shares the Controls rail
 * icon.
 */
export function pageForTab(tab: PlayTab, finishView: 'picture' | 'sound' = 'picture'): RailPage {
  switch (tab) {
    case 'finish': return finishView === 'sound' ? 'finish-sound' : 'finish-picture';
    case 'mappings': return 'mappings';
    case 'engine': return 'engine-performance';
    case 'layers': return 'layers';
    default: return 'controls';
  }
}

/** How many things a page holds, for the drawer (undefined: nothing worth counting). */
export function pageCount(page: RailPage, play: PlayRecord): number | undefined {
  switch (page) {
    case 'controls': return play.controls.length;
    case 'layers': return play.layers.length;
    case 'actions': return play.actions?.length ?? 0;
    case 'signals': return play.signals?.length ?? 0;
    case 'finish-picture': return play.finish?.effects.length ?? 0;
    case 'finish-sound': return Object.values(play.audioFx?.chains ?? {}).reduce((n, c) => n + c.effects.length, 0);
    case 'engine-performance': return play.audioEngine?.racks.length ?? 0;
    case 'mappings': return play.mappings.length + (play.pairMappings?.length ?? 0);
    default: return undefined;
  }
}

/**
 * The small number on a rail icon: only where a count helps at a glance
 * (layers, controls). Controls carries Mappings too now, but the badge stays
 * the controls count — the mappings count goes in the tooltip instead
 * (PlayRail.tsx), so the two counts don't get added into one confusing number.
 */
export function categoryBadge(cat: RailCategory, play: PlayRecord): number | undefined {
  const n = cat === 'layers' ? play.layers.length
    : cat === 'controls' ? play.controls.length
    : 0;
  return n > 0 ? n : undefined;
}

/** The mappings count for the Controls rail icon's tooltip (pair mappings included). */
export function mappingsCountOf(play: PlayRecord): number {
  return play.mappings.length + (play.pairMappings?.length ?? 0);
}

/**
 * The page a phone shows: the one picked from the bottom row's sheet while
 * its category is the open tab, else the tab's own (Finish follows its
 * Picture or Sound view).
 */
export function phonePageShown(tab: PlayTab, finishView: 'picture' | 'sound', picked: RailPage | ''): RailPage {
  if (tab === 'finish') return pageForTab(tab, finishView);
  if (picked && tabForPage(picked) === tab) return picked;
  return pageForTab(tab, finishView);
}

/** Arrow-key movement through a list of `count` items (wraps; Home and End jump). */
export function stepIndex(index: number, key: string, count: number): number {
  if (count <= 0) return -1;
  if (key === 'ArrowDown' || key === 'ArrowRight') return (index + 1 + count) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return index;
}
