/**
 * mappingGroups.ts — the full-width Mappings page's table: mappings grouped
 * by the kind of source (MIDI, keys and mouse, audio…), filtered by a search
 * and a group. Pure, so the page and its tests share it.
 */
import type { PlayMapping, PlaySource } from '../../types/play';

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

export function mappingGroupOf(source: PlaySource): MappingGroupId {
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
