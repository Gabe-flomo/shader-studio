/**
 * conditionRange.ts — the range a condition's value is measured against when
 * its thresholds are a percentage (ValueCondition.unit 'pct'): a control's own
 * min and max, a layer property's, a Finish or sound effect number's, 0..1
 * for a mapping's reading and the pointer. A distance has none: the kit
 * (sgCondStep) then uses the range seen so far. Resolved from the record, so
 * editing a slider's range keeps "50%" meaning its middle.
 *
 * The app's engine looks these up once per record; a website export carries
 * the table (`condRanges` in the bundle) since the page has no property list.
 */
import { sgParseValueRef } from './kit/signals.js';
import { layerNumericProps, type PlayRecord, type ValueCondition } from '../types/play';
import { finishHost, finishParamOf } from '../types/playFinish';
import { audioFxControlFor } from '../types/playAudioFx';

export type ValueRange = readonly [number, number];

/** The range `ref` (a condition's value path) moves in, or null when it has none fixed. */
export function valueRange(play: PlayRecord, ref: string): ValueRange | null {
  const r = sgParseValueRef(ref);
  if (!r) return null;
  switch (r.kind) {
    case 'mapping': case 'mouse': return [0, 1];
    case 'distance': return null;
    case 'control': {
      const c = play.controls.find(x => x.id === r.id);
      if (!c) return null;
      return c.kind === 'float' ? [c.min, c.max] : [0, 1];
    }
    case 'prop': {
      if (r.layerId.startsWith('finish:')) {
        const e = finishHost(play.finish, r.layerId.slice('finish:'.length));
        const d = e && finishParamOf(e, r.key);
        return d ? [d.min, d.max] : null;
      }
      if (r.layerId.startsWith('audiofx:')) {
        const c = audioFxControlFor(play.audioFx, play.layers, `${r.layerId}::${r.key}`);
        return c ? [c.min, c.max] : null;
      }
      const l = play.layers.find(x => x.id === r.layerId);
      const d = l && layerNumericProps(l).find(x => x.key === r.key);
      return d ? [d.min, d.max] : null;
    }
  }
}

/** Every condition in the record: triggers of mappings, increments and actions, increments' repeat conditions, pair mappings' "only while". */
export function recordConditions(play: PlayRecord): ValueCondition[] {
  const out: ValueCondition[] = [];
  const trig = (t: { on: string } | undefined) => { if (t && t.on === 'value') out.push(t as unknown as ValueCondition); };
  for (const m of play.mappings) {
    if (m.source.kind === 'trigger') trig(m.source.trigger);
    if (m.increment?.on === 'trigger') trig(m.increment.trigger);
    if (m.increment?.when) out.push(m.increment.when);
  }
  for (const a of play.actions ?? []) trig(a.trigger);
  for (const m of play.pairMappings ?? []) {
    if (m.source.kind === 'value' && m.source.source.kind === 'trigger') trig(m.source.source.trigger);
    if (m.a.when) out.push(m.a.when);
    if (m.b.when) out.push(m.b.when);
  }
  return out;
}

/** The ranges every percent condition needs, by value path (what a website export carries). */
export function conditionRanges(play: PlayRecord): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const c of recordConditions(play)) {
    if (c.unit !== 'pct' || c.value in out) continue;
    const r = valueRange(play, c.value);
    if (r) out[c.value] = [r[0], r[1]];
  }
  return out;
}
