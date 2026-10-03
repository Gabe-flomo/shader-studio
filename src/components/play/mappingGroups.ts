/**
 * mappingGroups.ts — sources grouped by their kind (MIDI, keys and mouse,
 * audio…), filtered by a search: the full-width Mappings page's table
 * (old mappings), and the Inputs board's sources column (the record's own
 * sources and the old mappings together, groupSourceItems). Pure, so the
 * pages and their tests share it.
 */
import type { PlayMapping, PlaySource, PlaySourceDef } from '../../types/play';

export type MappingGroupId = 'midi' | 'keys' | 'audio' | 'motion' | 'triggers' | 'picture' | 'other';

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
