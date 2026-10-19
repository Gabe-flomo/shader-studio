/**
 * mappingGroups.ts — sources grouped by their kind (MIDI, keys and mouse,
 * audio…), filtered by a search: the full-width Mappings page's table
 * (old mappings), and the Inputs board's sources column (the record's own
 * sources and the old mappings together, groupSourceItems). Pure, so the
 * pages and their tests share it.
 */
import type { PlayMapping, PlayRecord, PlaySource, PlaySourceDef } from '../../types/play';

/**
 * Mapping and source cards start folded to one line (the app's collapsed-by-default rule); a card
 * opened by hand stays open, remembered on this device in playUi's `folded` under these keys
 * (an entry of `false` = open, no entry = folded).
 */
export const mappingFoldKey = (id: string): string => `mapping:${id}`;
export const sourceFoldKey = (id: string): string => `source:${id}`;
/** The sources column's group headings (open unless folded). */
export const sourceGroupFoldKey = (id: string): string => `srcgroup:${id}`;
/** The built-in signals' group at the bottom of the sources column (folded unless opened). */
export const BUILT_IN_FOLD_KEY = 'srcgroup:builtin';

const CURVE_WORDS: Record<PlayMapping['curve'], string> = { linear: 'linear', exp: 'exp', log: 'log', custom: 'drawn' };
const num = (n: number) => `${Math.round(n * 1000) / 1000}`;

/** The rest of a folded mapping's line, after "source → control": "0.05–0.7 · linear" (an increment says its steps elsewhere). */
export function mappingRangeText(m: Pick<PlayMapping, 'outMin' | 'outMax' | 'curve'>): string {
  return `${num(m.outMin)}–${num(m.outMax)} · ${CURVE_WORDS[m.curve] ?? m.curve}`;
}

export type MappingGroupId ='midi' | 'keys' | 'audio' | 'motion' | 'triggers' | 'picture' | 'other';

export const MAPPING_GROUPS: ReadonlyArray<{ id: MappingGroupId; label: string; kinds: readonly PlaySource['kind'][] }> = [
  { id: 'midi', label: 'MIDI and OSC', kinds: ['midi', 'pad', 'osc'] },
  { id: 'keys', label: 'Keys, mouse and gamepad', kinds: ['key', 'mouse', 'gamepad'] },
  { id: 'audio', label: 'Audio', kinds: ['audio', 'live', 'reader'] },
  { id: 'motion', label: 'LFOs, clocks and noise', kinds: ['lfo', 'clock', 'noise'] },
  { id: 'triggers', label: 'Triggers', kinds: ['trigger'] },
  { id: 'picture', label: 'Picture, hands and sensors', kinds: ['null', 'sensor', 'hand', 'tilt'] },
  { id: 'other', label: 'Controls and data', kinds: [] },
];

/** The group of a source: a PlaySource itself, or anything carrying one (a mapping, a source of the record). */
export function mappingGroupOf(of: PlaySource | { source: PlaySource }): MappingGroupId {
  // A PlaySource has a kind; a mapping and a source of the record carry theirs in `source`.
  const source = 'kind' in of ? of : of.source;
  return MAPPING_GROUPS.find(g => g.kinds.includes(source.kind))?.id ?? 'other';
}

export interface MappingGroupRows { id: MappingGroupId; label: string; rows: PlayMapping[] }

/**
 * The mappings shown, in their groups (in MAPPING_GROUPS order, each keeping
 * the setup's order): those whose source or control matches `query` (any
 * case), in `group` ('all' for every group). Empty groups are left out.
 */
export function groupMappings(
  mappings: readonly PlayMapping[],
  label: (m: PlayMapping) => { source: string; control: string },
  query = '',
  group: MappingGroupId | 'all' = 'all',
): MappingGroupRows[] {
  const q = query.trim().toLowerCase();
  const out: MappingGroupRows[] = [];
  for (const g of MAPPING_GROUPS) {
    if (group !== 'all' && group !== g.id) continue;
    const rows = mappings.filter(m => {
      if (mappingGroupOf(m.source) !== g.id) return false;
      if (!q) return true;
      const l = label(m);
      return l.source.toLowerCase().includes(q) || l.control.toLowerCase().includes(q);
    });
    if (rows.length) out.push({ id: g.id, label: g.label, rows });
  }
  return out;
}

/** How many mappings each group holds (for the filter chips), groups with none left out. */
export function groupCounts(mappings: readonly PlayMapping[]): Array<{ id: MappingGroupId; label: string; count: number }> {
  return MAPPING_GROUPS
    .map(g => ({ id: g.id, label: g.label, count: mappings.filter(m => mappingGroupOf(m.source) === g.id).length }))
    .filter(g => g.count > 0);
}

/** One card in the sources column: a source of the record, or an old mapping. */
export type SourceItem = { kind: 'source'; def: PlaySourceDef } | { kind: 'mapping'; mapping: PlayMapping };
export interface SourceItemGroup { id: MappingGroupId; label: string; items: SourceItem[] }

export const sourceItemId = (x: SourceItem) => (x.kind === 'source' ? x.def.id : x.mapping.id);

/**
 * The sources column's cards in their groups (MAPPING_GROUPS order; in each,
 * the record's own sources first, then the old mappings, each in the setup's
 * order, as the column showed them before): those where any of `words(item)`
 * (its name, what it reads, what it drives) holds `query`, any case. Empty
 * groups are left out.
 */
export function groupSourceItems(
  sources: readonly PlaySourceDef[],
  mappings: readonly PlayMapping[],
  words: (item: SourceItem) => ReadonlyArray<string | undefined>,
  query = '',
): SourceItemGroup[] {
  const q = query.trim().toLowerCase();
  const all: SourceItem[] = [...sources.map(def => ({ kind: 'source' as const, def })), ...mappings.map(mapping => ({ kind: 'mapping' as const, mapping }))];
  const shown = q ? all.filter(x => words(x).some(w => !!w && w.toLowerCase().includes(q))) : all;
  const out: SourceItemGroup[] = [];
  for (const g of MAPPING_GROUPS) {
    const items = shown.filter(x => mappingGroupOf(x.kind === 'source' ? x.def : x.mapping) === g.id);
    if (items.length) out.push({ id: g.id, label: g.label, items });
  }
  return out;
}

/** What drives a control, as the card to open in the Sources column: a mapping onto it, or a source routed onto it. */
export interface DriverCard { kind: 'mapping' | 'source'; id: string; group: MappingGroupId }

/**
 * The card a control's "driven by" chip opens (phones: Play audit P20): its first
 * enabled mapping, else the first enabled source with an enabled route onto it.
 * The fold keys to open are `mappingFoldKey`/`sourceFoldKey` and the group's
 * `sourceGroupFoldKey`. Null when nothing drives it.
 */
export function driverCardFor(p: Pick<PlayRecord, 'mappings' | 'sources'>, controlId: string): DriverCard | null {
  const m = p.mappings.find(x => x.enabled && x.controlId === controlId);
  if (m) return { kind: 'mapping', id: m.id, group: mappingGroupOf(m) };
  const s = (p.sources ?? []).find(x => x.enabled && x.outputs.some(o => o.routes.some(r => r.enabled && r.to === controlId)));
  return s ? { kind: 'source', id: s.id, group: mappingGroupOf(s) } : null;
}

/** The fold keys that show a driver's card opened: its group's heading and the card itself. */
export function driverFoldKeys(d: DriverCard): string[] {
  return [sourceGroupFoldKey(d.group), d.kind === 'mapping' ? mappingFoldKey(d.id) : sourceFoldKey(d.id)];
}

/** The card of one driver by its id (a mapping's or a source of the record's): a control card's "Mapped by" list opens it. */
export function driverCardOf(p: Pick<PlayRecord, 'mappings' | 'sources'>, id: string): DriverCard | null {
  const m = p.mappings.find(x => x.id === id);
  if (m) return { kind: 'mapping', id, group: mappingGroupOf(m) };
  const s = (p.sources ?? []).find(x => x.id === id);
  return s ? { kind: 'source', id, group: mappingGroupOf(s) } : null;
}
