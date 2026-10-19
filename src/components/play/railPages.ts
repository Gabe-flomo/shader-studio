/**
 * railPages.ts — the Play page's one navigation model (docs/split-view.md,
 * "Rail and pages"; Play audit P1): the labelled rail's categories (Controls,
 * Layers, Rules, Finish, Sound), each with its pages. A page is what the
 * panel beside the rail shows; the phone's bottom row offers the same
 * categories and pages. There is no other set of sections: the old sidebar's
 * tab strip (and its PlayTab union) is gone.
 *
 * Pure data and helpers: PlayRail.tsx draws the rail, PlayPage renders each
 * page (pages/*Page.tsx) into the panel.
 */
import type { PlayRecord } from '../../types/play';
import type { IconName } from '../ui/iconPaths';
import { asRules } from '../../play/rules';

/** The rail's categories, one icon each (RAIL_CATEGORIES below). */
export type RailCategory = 'controls' | 'layers' | 'signals' | 'finish' | 'engine';

export type RailPage =
  | 'controls'
  | 'layers' | 'signals'
  | 'finish-picture' | 'finish-sound'
  | 'engine-performance'
  | 'midi-file' | 'pad-grid';

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
  controls: { id: 'controls', category: 'controls', label: 'Controls', description: 'The controls people play beside the sources that drive them' },
  layers: { id: 'layers', category: 'layers', label: 'Layers', description: 'What sits on the picture, with the selected layer’s editor' },
  signals: { id: 'signals', category: 'signals', label: 'Rules', description: 'When something happens, what to do: a pinch bursts the sparks' },
  'finish-picture': { id: 'finish-picture', category: 'finish', label: 'Picture', description: 'Grade, lens, film and time effects over the whole picture' },
  'finish-sound': { id: 'finish-sound', category: 'engine', label: 'Effects', description: 'Reverb, echo, filter and more on each sound and the master' },
  'engine-performance': { id: 'engine-performance', category: 'engine', label: 'Arrangement', description: 'Racks of synths and effects, played live' },
  'midi-file': { id: 'midi-file', category: 'controls', label: 'MIDI file', description: 'A MIDI file played as if from a controller' },
  'pad-grid': { id: 'pad-grid', category: 'controls', label: 'Pad grid', description: 'A grid of pads from a controller, read as sources' },
};

export const RAIL_CATEGORIES: readonly RailCategoryDef[] = [
  { id: 'controls', label: 'Controls', icon: 'sliders', description: 'The controls people play, and the sources that drive them', pages: ['controls', 'midi-file', 'pad-grid'] },
  { id: 'layers', label: 'Layers', icon: 'layers', description: 'What acts on the picture, with the background pinned on top', pages: ['layers'] },
  { id: 'signals', label: 'Rules', icon: 'bolt', description: 'When something happens, what to do', pages: ['signals'] },
  { id: 'finish', label: 'Finish', icon: 'finish', description: 'Grade, lens, film and time effects over the whole picture', pages: ['finish-picture'] },
  { id: 'engine', label: 'Sound', icon: 'piano', description: 'The Audio engine, and effects on the sound', pages: ['engine-performance', 'finish-sound'] },
];

/**
 * Each rail category's keyboard shortcut, ⌘1–5 in the rail's own order
 * (top to bottom: Controls, Layers, Rules, Finish, Sound). useShortcuts.ts's
 * own `DEFAULT_ACTIONS` strings must match — App.tsx wires these up, and also
 * binds the ⌃ equivalent, since a plain browser tab claims ⌘1–5 for its own
 * tabs before the page ever sees the keydown.
 */
export const RAIL_CATEGORY_SHORTCUT: Readonly<Record<RailCategory, string>> = {
  controls: 'cmd+1', layers: 'cmd+2', signals: 'cmd+3', finish: 'cmd+4', engine: 'cmd+5',
};

export const RAIL_PAGE_IDS = Object.keys(RAIL_PAGES) as RailPage[];

export function isRailPage(v: unknown): v is RailPage {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(RAIL_PAGES, v);
}

/**
 * A saved page id from before a page was folded into another, as today's:
 * Actions into Signals (2026-09-30), Mappings into Controls, and Background
 * into Layers (its pinned top row, Play audit P13).
 */
export function currentRailPage(v: unknown): unknown {
  return v === 'actions' ? 'signals' : v === 'mappings' ? 'controls' : v === 'background' ? 'layers' : v;
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

/** How many things a page holds, for the drawer (undefined: nothing worth counting). */
export function pageCount(page: RailPage, play: PlayRecord): number | undefined {
  switch (page) {
    case 'controls': return play.controls.length;
    case 'layers': return play.layers.length;
    case 'signals': return asRules(play).signals?.length ?? 0;
    case 'finish-picture': return play.finish?.effects.length ?? 0;
    case 'finish-sound': return Object.values(play.audioFx?.chains ?? {}).reduce((n, c) => n + c.effects.length, 0);
    case 'engine-performance': return play.audioEngine?.racks.length ?? 0;
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
 * The pages a phone's bottom row offers for a category (Play audit P20). Controls
 * and Layers go straight to their page, with no sheet in between: the Controls
 * page has a Controls / Sources switch (the MIDI file and the pad grid sit in
 * Sources), and the Layers page carries the canvas shape at its top and the
 * Background as its pinned first row. Sound keeps its two pages.
 */
export function phonePagesOf(cat: RailCategory): readonly RailPage[] {
  if (cat === 'controls') return ['controls'];
  return categoryDef(cat).pages;
}

/** The page a phone shows for the page in view: the same, unless a phone has no page of its own for it (MIDI file, Pad grid: in Sources there). */
export function phonePageFor(page: RailPage): RailPage {
  const cat = categoryOf(page);
  return phonePagesOf(cat).includes(page) ? page : firstPageOf(cat);
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
