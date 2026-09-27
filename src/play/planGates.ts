/**
 * What Play does on each plan (docs/accounts-and-plans.md §4, decision 3).
 *
 * Free: controls, and mappings whose source is the mouse, a key, audio (a live
 * band, an audio reader, an Audio Input node's band) or another control, plus
 * triggers fired by those. Pro: everything else (layers and their actions,
 * every other source, backgrounds, a MIDI file, takes, the Finish stack).
 *
 * A setup made on Pro opens on Free unchanged: the store keeps the whole
 * record, and `playableForPlan` is only the copy that plays, so nothing is
 * ever dropped from a file.
 */
import type { PlayMapping, PlayPairMapping, PlayRecord, PlaySource, TriggerSpec } from '../types/play';
import { canOn, type Plan } from '../lib/plan';

/** Sources Free can map from. `control` is another slider on the panel: controls are Free. */
export const FREE_SOURCE_KINDS: ReadonlySet<PlaySource['kind']> = new Set(['mouse', 'key', 'live', 'reader', 'audio', 'control']);
/** What can fire a trigger on Free: the same inputs. */
export const FREE_TRIGGER_ONS: ReadonlySet<TriggerSpec['on']> = new Set(['mouse', 'key', 'audio', 'reader']);

export function triggerNeedsPro(t: TriggerSpec): boolean {
  return !FREE_TRIGGER_ONS.has(t.on);
}

export function sourceNeedsPro(s: PlaySource): boolean {
  if (s.kind === 'trigger') return triggerNeedsPro(s.trigger);
  return !FREE_SOURCE_KINDS.has(s.kind);
}

/**
 * The source drop-down's values (play/playSources.ts SourceType, plus
 * `reader:<id>` and the readers entry): which ones are Pro. A trigger is Free
 * as a type; what fires it is checked by `triggerNeedsPro`.
 */
export function sourceTypeNeedsPro(type: string): boolean {
  if (type.startsWith('mouse:') || type.startsWith('reader')) return false;
  return !['key', 'control', 'live', 'audio', 'trigger'].includes(type);
}

export function mappingAllowed(m: PlayMapping, plan: Plan | null): boolean {
  return canOn(plan, 'play.sources') || !sourceNeedsPro(m.source);
}

/** A pair mapping on Free: the pointer as a position, or a Free source, with no conditions or swap signals (those are Pro sources). */
export function pairMappingNeedsPro(m: PlayPairMapping): boolean {
  if (m.source.kind === 'position' ? m.source.anchor !== 'mouse' : sourceNeedsPro(m.source.source)) return true;
  return !!(m.a.when || m.b.when || m.swap?.signal || m.swap?.backSignal);
}

const cache = new WeakMap<PlayRecord, PlayRecord>();

/**
 * The record as it plays on `plan`. Pro: the record itself. Free: no layers,
 * groups or actions, no background but the shader, no MIDI file, and only the
 * mappings Free can run. The input is never changed.
 */
export function playableForPlan(record: PlayRecord, plan: Plan | null): PlayRecord {
  if (canOn(plan, 'play.layers') && canOn(plan, 'play.sources') && canOn(plan, 'play.backgrounds') && canOn(plan, 'play.midiFile') && canOn(plan, 'play.finish')) return record;
  const hit = cache.get(record);
  if (hit) return hit;
  const out: PlayRecord = {
    ...record,
    mappings: record.mappings.filter(m => mappingAllowed(m, plan)),
    pairMappings: canOn(plan, 'play.sources') ? record.pairMappings : record.pairMappings?.filter(m => !pairMappingNeedsPro(m)),
    layers: [],
    groups: undefined,
    actions: undefined,
    midiFile: undefined,
    padGrid: canOn(plan, 'play.sources') ? record.padGrid : undefined,
    finish: canOn(plan, 'play.finish') ? record.finish : undefined,
    display: record.display ? { picture: true, backdrop: record.display.backdrop } : undefined,
  };
  cache.set(record, out);
  return out;
}

/** What a setup uses that this plan can't run, for a "needs Pro" note. Empty when it all runs. */
export function proOnlyParts(record: PlayRecord, plan: Plan | null): string[] {
  const out: string[] = [];
  if (!canOn(plan, 'play.layers') && record.layers.length) out.push(`${record.layers.length} layer${record.layers.length === 1 ? '' : 's'}`);
  if (!canOn(plan, 'play.layers') && record.actions?.length) out.push(`${record.actions.length} action${record.actions.length === 1 ? '' : 's'}`);
  const locked = record.mappings.filter(m => !mappingAllowed(m, plan)).length + (canOn(plan, 'play.sources') ? 0 : (record.pairMappings ?? []).filter(pairMappingNeedsPro).length);
  if (locked) out.push(`${locked} mapping${locked === 1 ? '' : 's'}`);
  if (!canOn(plan, 'play.backgrounds') && record.display?.source && record.display.source !== 'shader') out.push('the background');
  if (!canOn(plan, 'play.midiFile') && record.midiFile) out.push('the MIDI file');
  if (!canOn(plan, 'play.finish') && record.finish?.effects.some(e => e.enabled) && record.finish.on) out.push('the Finish stack');
  return out;
}
