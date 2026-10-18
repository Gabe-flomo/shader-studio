/**
 * controlGroups.ts — the Controls board's groups (ControlsBoard.tsx): each
 * control by where it comes from. A group the author named (PlayControl.group,
 * audio readers' too) wins; otherwise a rack's parameters sit under their
 * rack, a layer's numbers and buttons under their layer, the Finish stack's
 * and the sound effects' under theirs, and the graph's sliders under
 * "From the graph". Groups keep the panel's order (first control first); the
 * second of a pair shows inside the first's card, so it isn't listed apart.
 */
import { parseActionTarget, parseLayerTarget, parseReaderTarget, parseSpreadTarget, type PlayControl, type PlayRecord } from '../../types/play';
import { aeRack, aeSlotName, parseAuTarget, parseGrainsTarget, parseMacroTarget } from '../../types/playAudioEngine';
import { parseFinishTarget } from '../../types/playFinish';
import { parseAudioFxTarget } from '../../types/playAudioFx';
import { pairOf } from '../../play/pairs';

export type ControlOriginKind = 'group' | 'rack' | 'layer' | 'readers' | 'finish' | 'sound' | 'graph';

export interface ControlOrigin { id: string; label: string; kind: ControlOriginKind }

export function controlOrigin(c: PlayControl, play: PlayRecord): ControlOrigin {
  if (c.group) return { id: `group:${c.group}`, label: c.group, kind: parseReaderTarget(c.target) ? 'readers' : 'group' };
  if (parseReaderTarget(c.target)) return { id: 'readers', label: 'Audio readers', kind: 'readers' };
  const st = parseSpreadTarget(c.target);
  if (st) return { id: `spread:${st.spreadId}`, label: play.spreads?.find(x => x.id === st.spreadId)?.label ?? 'Spread', kind: 'group' };
  const au = parseAuTarget(c.target), gr = parseGrainsTarget(c.target);
  const rackId = au?.rackId ?? gr?.rackId ?? parseMacroTarget(c.target)?.rackId;
  if (rackId) {
    const racks = play.audioEngine?.racks ?? [];
    const r = aeRack(play.audioEngine, rackId);
    const n = racks.findIndex(x => x.id === rackId) + 1;
    const name = r ? (r.name || `Rack ${n}`) : 'A removed rack';
    return { id: `rack:${rackId}`, label: r?.instrument ? `${name} · ${aeSlotName(r.instrument)}` : name, kind: 'rack' };
  }
  const layerId = parseLayerTarget(c.target)?.layerId ?? parseActionTarget(c.target)?.layerId;
  if (layerId) {
    const l = play.layers.find(x => x.id === layerId);
    return { id: `layer:${layerId}`, label: l?.label ?? 'A deleted layer', kind: 'layer' };
  }
  if (parseFinishTarget(c.target)) return { id: 'finish', label: 'Finish', kind: 'finish' };
  if (parseAudioFxTarget(c.target)) return { id: 'sound', label: 'Sound effects', kind: 'sound' };
  return { id: 'graph', label: 'From the graph', kind: 'graph' };
}

export type MappedFilter = 'all' | 'mapped' | 'unmapped';
export type KindFilter = 'all' | PlayControl['kind'];

export interface BoardFilter {
  query?: string;
  /** An origin id, or 'all'. */
  group?: string;
  mapped?: MappedFilter;
  kind?: KindFilter;
}

/** Does anything map onto this control (a mapping, or a pair mapping onto its pair)? */
export function isMapped(c: PlayControl, play: PlayRecord): boolean {
  if (play.mappings.some(m => m.controlId === c.id)) return true;
  const pair = pairOf(play, c.id);
  return !!pair && !!play.pairMappings?.some(m => m.pairId === pair.id);
}

export interface BoardGroup { origin: ControlOrigin; items: Array<{ control: PlayControl; index: number }> }

/** The board's groups, filtered. Empty groups are left out. */
export function groupControls(play: PlayRecord, filter: BoardFilter = {}): BoardGroup[] {
  const q = filter.query?.trim().toLowerCase() ?? '';
  const byId = new Map<string, BoardGroup>();
  const out: BoardGroup[] = [];
  play.controls.forEach((c, index) => {
    const pair = pairOf(play, c.id);
    if (pair && pair.b === c.id) return;
    const origin = controlOrigin(c, play);
    if (filter.group && filter.group !== 'all' && filter.group !== origin.id) return;
    if (filter.kind && filter.kind !== 'all' && filter.kind !== c.kind) return;
    if (filter.mapped && filter.mapped !== 'all' && (filter.mapped === 'mapped') !== isMapped(c, play)) return;
    if (q) {
      const partner = pair ? play.controls.find(x => x.id === pair.b)?.label ?? '' : '';
      const text = `${c.label} ${pair?.label ?? ''} ${partner} ${origin.label}`.toLowerCase();
      if (!text.includes(q)) return;
    }
    let g = byId.get(origin.id);
    if (!g) { g = { origin, items: [] }; byId.set(origin.id, g); out.push(g); }
    g.items.push({ control: c, index });
  });
  return out;
}

/** Every group the setup has (for the filter chips), with how many cards each shows unfiltered. */
export function boardGroupList(play: PlayRecord): Array<ControlOrigin & { count: number }> {
  return groupControls(play).map(g => ({ ...g.origin, count: g.items.length }));
}

/**
 * The board's one filter dropdown (docs/split-view.md, Controls board): everything, mapped or
 * unmapped, one kind, or one group, as a single value — `all`, `mapped`, `unmapped`,
 * `kind:<kind>` or `group:<origin id>`.
 */
export type BoardShow = string;

/** Below this many controls the search and the filter stay hidden (a scroll is quicker). */
export const FILTERS_FROM = 8;

/** Show the search and the filter: enough controls to need them, or one is already in use. */
export function boardFiltersShown(controlCount: number, active: boolean): boolean {
  return active || controlCount >= FILTERS_FROM;
}

/** The filter that a dropdown value stands for. */
export function filterOfShow(show: BoardShow): Pick<BoardFilter, 'group' | 'mapped' | 'kind'> {
  if (show === 'mapped' || show === 'unmapped') return { mapped: show };
  if (show.startsWith('kind:')) return { kind: show.slice(5) as KindFilter };
  if (show.startsWith('group:')) return { group: show.slice(6) };
  return {};
}

const KIND_LABELS: Record<PlayControl['kind'], string> = { float: 'Sliders', color: 'Colours', action: 'Buttons' };

/** The dropdown's options: All, Mapped, Unmapped, then the kinds and the groups the setup has (with counts), when there's more than one. */
export function showOptions(play: PlayRecord): Array<{ value: BoardShow; label: string }> {
  const kinds = (Object.keys(KIND_LABELS) as Array<PlayControl['kind']>)
    .map(k => ({ k, n: play.controls.filter(c => c.kind === k).length }))
    .filter(x => x.n > 0);
  const groups = boardGroupList(play);
  return [
    { value: 'all', label: `All controls · ${play.controls.length}` },
    { value: 'mapped', label: 'Mapped' },
    { value: 'unmapped', label: 'Unmapped' },
    ...(kinds.length > 1 ? kinds.map(x => ({ value: `kind:${x.k}`, label: `${KIND_LABELS[x.k]} · ${x.n}` })) : []),
    ...(groups.length > 1 ? groups.map(g => ({ value: `group:${g.id}`, label: `${g.label} · ${g.count}` })) : []),
  ];
}
