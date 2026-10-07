/**
 * builderLayout.ts — a builder window's sections (BuilderWindow: the 3D Scene Builder, Grid Rules,
 * Agent Rules).
 *
 * Every builder shows its main area as tabs (one section at a time instead of one long scroll),
 * each with a one-line "how this works". A wide window shows the side panels beside the tabs, a
 * window under 1100 px as drawers over them (code/SidePanels.tsx). A phone (ui/phoneDialog.ts:
 * either way up) uses the same tab model: one row of tabs, the side panels joining it as tabs of
 * their own (sectionRow), one section at a time, full screen.
 *
 * The chosen tab is remembered per builder (rememberedTab / rememberTab).
 */
import type { IconName } from '../ui/iconPaths';
import type { GridRuleType } from '../../gridRules/spec';

/** One tab of a builder's main area. */
export interface BuilderSectionTab {
  id: string;
  label: string;
  icon?: IconName;
  /** The one-line "How this works" shown at the top of the tab. */
  how?: string;
  /** A little space before it (a new group of tabs). */
  gapBefore?: boolean;
}

/** On a phone, the side panels are tabs too: their values. */
export const PANEL_LEFT = 'panel:left';
export const PANEL_RIGHT = 'panel:right';

/** The tab row on a phone: the left panel, the builder's tabs, the right panel (those that exist). */
export function sectionRow(tabs: BuilderSectionTab[], left?: string, right?: string): Array<{ value: string; label: string; gapBefore?: boolean }> {
  return [
    ...(left ? [{ value: PANEL_LEFT, label: left }] : []),
    ...tabs.map(t => ({ value: t.id, label: t.label, ...(t.gapBefore ? { gapBefore: true } : {}) })),
    ...(right ? [{ value: PANEL_RIGHT, label: right }] : []),
  ];
}

export type BuilderTab = 'left' | 'main' | 'right';

/** The phone row of a builder with one main area (no tabs of its own): left panel, main, right panel. */
export function builderTabs(left: string | undefined, mainLabel: string, right: string | undefined): Array<{ value: BuilderTab; label: string }> {
  return sectionRow([{ id: 'main', label: mainLabel }], left, right).map(t => ({
    value: (t.value === PANEL_LEFT ? 'left' : t.value === PANEL_RIGHT ? 'right' : 'main') as BuilderTab, label: t.label,
  }));
}

// ── Remembering the tab ─────────────────────────────────────────────────────────────────────────

const tabKey = (builder: string) => `builder:${builder}:tab`;

/** The tab last used in this builder, when it is still one of `ids`; otherwise the fallback. */
export function rememberedTab(builder: string, ids: string[], fallback: string): string {
  let v: string | null = null;
  try { v = localStorage.getItem(tabKey(builder)); } catch { /* storage unavailable */ }
  return v && ids.includes(v) ? v : fallback;
}
export function rememberTab(builder: string, id: string): void {
  try { localStorage.setItem(tabKey(builder), id); } catch { /* kept for this session only */ }
}

/** A tab id that is in the list, or the fallback (a rule type change can take a tab away). */
export const validTab = (id: string, tabs: BuilderSectionTab[], fallback: string) => (tabs.some(t => t.id === id) ? id : fallback);

// ── Grid Rules ──────────────────────────────────────────────────────────────────────────────────

/** The rule tab's name and words, per rule type (its id is always `rule`, so the choice is kept). */
const GRID_RULE_TAB: Record<GridRuleType, { label: string; how: string }> = {
  count: { label: 'Born & Survive', how: 'Each step every cell counts its live neighbours: switch on the counts that bring an empty cell alive (Born) and keep a live one alive (Survive).' },
  stages: { label: 'Stages', how: 'Born and Survive as in Life, but a cell that stops surviving fades through dying stages before it is empty.' },
  patterns: { label: 'Stencils', how: 'Rules as 3×3 pictures, tried in order: the first one the block round a cell matches says what the cell becomes.' },
  blocks: { label: 'Blocks', how: 'The board in 2×2 blocks that shift every step: a block that looks like a before picture becomes its after picture.' },
  smooth: { label: 'Smooth', how: 'Every cell holds a number instead of a state and runs the same small update each step: tune it with the sliders.' },
};

/** Grid Rules' tabs for a rule type: Presets · Neighbourhood · (the rule) · Start · Brush · Colours. */
export function gridRulesTabs(type: GridRuleType): BuilderSectionTab[] {
  const counting = type === 'count' || type === 'stages';
  return [
    { id: 'presets', label: 'Presets', icon: 'presets', how: 'Pick the kind of rule, then start from a preset: everything after this tab fine-tunes it.' },
    ...(counting ? [{ id: 'neighbourhood', label: 'Neighbourhood', icon: 'grid' as IconName, how: 'Which cells round a cell count as its neighbours: the 8 round it, the 4 beside it, or every cell within a radius.' }] : []),
    { id: 'rule', label: GRID_RULE_TAB[type].label, icon: 'sliders', how: GRID_RULE_TAB[type].how },
    { id: 'start', label: 'Start', icon: 'play', how: 'What a new board starts as, how big it is, what its edges do and how fast it runs.' },
    { id: 'brush', label: 'Brush', icon: 'hand', how: 'Hold the mouse button over the picture to paint cells in: its size, what it paints and how thickly.' },
    { id: 'colours', label: 'Colours', icon: 'spark', how: 'What the picture shows and the colour of each state, with an afterglow where cells die.' },
  ];
}

// ── Agent Rules ─────────────────────────────────────────────────────────────────────────────────

export const AGENT_RULES_TABS: BuilderSectionTab[] = [
  { id: 'species', label: 'Species', icon: 'swarm', how: 'Up to four kinds of walker, each with its own speed, states and rules: pick one here to edit it.' },
  { id: 'rules', label: 'Rules', icon: 'expr', how: 'Every step each walker runs its rules top to bottom: When the condition holds, it does the actions.' },
  { id: 'trails', label: 'Trails', icon: 'wave', how: 'Walkers leave trails in four channels and steer by reading them ahead and to the sides.' },
  { id: 'look', label: 'Look', icon: 'eye', how: 'What the group\'s picture shows: the trail, one channel, or the walkers themselves.' },
];
