/**
 * signalVerbs.ts — the sentences a rule's When offers for each kind of input
 * (implementation guide 6.3): "When [Space] [is pressed]", "When [Right ·
 * Pinch] [closes]", "When [the pointer] [moves to the left half]". Pure.
 *
 * A verb is the trigger it makes (a value condition's comparison and
 * threshold, say) and how the rule's reactions fire on it: on the rise (the
 * default), while it lasts, or when it stops. The sentence builder renders
 * from this table; Quick rule picks the first verb of what was learned.
 */
import type { FireSpec, TriggerSpec } from '../types/play';
import { HAND_GESTURE_LABELS, keyName, triggerLabel, valueRefLabel, type LabelContext } from './playSources';

export interface Verb {
  id: string;
  /** The words after the subject: "is pressed", "goes above 60%". */
  label: string;
  /** The trigger it makes, without a firing mode. */
  trigger: TriggerSpec;
  /** How reactions fire on it (absent: once, on the rise). */
  fire?: FireSpec;
}

// Literals, not built from DEFAULT_FIRE at load: nothing here reads another module's constants while modules load.
const HELD: FireSpec = { mode: 'held', every: 3, unit: 'frames' };
const RELEASE: FireSpec = { mode: 'release', every: 3, unit: 'frames' };

/** A trigger without its firing mode. */
export function bareTrigger(t: TriggerSpec): TriggerSpec {
  const { fire: _f, ...rest } = t;
  void _f;
  return rest as TriggerSpec;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The thing a rule watches, as the sentence's subject. */
export function subjectOf(t: TriggerSpec, ctx: LabelContext = {}): string {
  switch (t.on) {
    case 'key': return keyName(t.code);
    case 'mouse': return 'the mouse';
    case 'audio': return t.band === 'level' ? 'the sound' : `the ${t.band === 'lowmid' ? 'low mids' : t.band === 'highmid' ? 'high mids' : t.band}`;
    case 'hand': return `${t.side === 'left' ? 'Left' : 'Right'} · ${HAND_GESTURE_LABELS[t.gesture]}`;
    case 'value':
      if (t.value === 'mouse:x' || t.value === 'mouse:y' || t.value === 'ax:x:pointer' || t.value === 'ax:y:pointer') return 'the pointer';
      return valueRefLabel(t.value, ctx);
    default: return triggerLabel(t, ctx.layers ?? [], ctx);
  }
}

const isPinch = (g: string) => g.startsWith('pinch');

/** The verbs offered for what a trigger watches; the first is the likely one. */
export function verbsFor(t0: TriggerSpec): Verb[] {
  const t = bareTrigger(t0);
  const three = (on: string, held: string, off: string): Verb[] => [
    { id: 'rise', label: on, trigger: t },
    { id: 'fall', label: off, trigger: t, fire: RELEASE },
    { id: 'held', label: held, trigger: t, fire: HELD },
  ];
  switch (t.on) {
    case 'key': return three('is pressed', 'is held', 'is released');
    case 'note': return three('is played', 'is held', 'is released');
    case 'mouse': return three('clicks', 'is held down', 'is let go');
    case 'osc': return [{ id: 'rise', label: 'arrives', trigger: t }];
    case 'beat': return [{ id: 'rise', label: 'comes round', trigger: t }];
    case 'signal': return three('fires', 'is on', 'stops');
    case 'hand':
      if (t.gesture === 'appear' || t.gesture === 'leave') return [{ id: 'rise', label: 'happens', trigger: t }];
      return isPinch(t.gesture) ? three('closes', 'stays closed', 'opens') : three('starts', 'is held', 'stops');
    case 'face': case 'pose':
      if (t.gesture === 'appear' || t.gesture === 'leave') return [{ id: 'rise', label: 'happens', trigger: t }];
      return three('starts', 'is held', 'stops');
    case 'audio': return three('hits', 'stays loud', 'drops back');
    case 'reader': return three('hits', 'stays loud', 'drops back');
    case 'zone': return three(t.event === 'click' ? 'is clicked' : t.event === 'enter' ? 'is entered' : 'fills up', 'lasts', 'ends');
    case 'proximity': return three(t.when === 'closer' ? 'comes close' : 'moves away', 'stays', 'ends');
    case 'value': {
      const v = (cmp: 'above' | 'below', threshold: number, label: string, id: string): Verb => ({ id, label, trigger: { ...t, cmp, threshold, unit: 'pct', hysteresis: 0.05, tolerance: 0.01 } });
      if (t.value === 'mouse:x' || t.value === 'ax:x:pointer') return [v('below', 0.5, 'moves to the left half', 'left'), v('above', 0.5, 'moves to the right half', 'right')];
      if (t.value === 'mouse:y' || t.value === 'ax:y:pointer') return [v('above', 0.5, 'moves to the top half', 'top'), v('below', 0.5, 'moves to the bottom half', 'bottom')];
      // Above or below the same line (in its own units, or % of its range), or staying there.
      const n = (x: number) => (t.unit === 'pct' ? pct(x) : String(Math.round(x * 1000) / 1000));
      const at = (cmp: 'above' | 'below'): Verb => ({ id: cmp, label: `goes ${cmp} ${n(t.threshold)}`, trigger: { ...t, cmp } });
      const side = t.cmp === 'below' ? 'below' : 'above';
      return [at('above'), at('below'), { id: 'held', label: `stays ${side} ${n(t.threshold)}`, trigger: at(side).trigger, fire: HELD }];
    }
  }
}

const sameFire = (a: FireSpec | undefined, b: FireSpec | undefined) => (a?.mode ?? 'once') === (b?.mode ?? 'once');
/** A trigger as a string with its keys in order (a saved file may order them differently). */
const canon = (t: TriggerSpec) => JSON.stringify(bareTrigger(t), (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
export const sameTrigger = (a: TriggerSpec, b: TriggerSpec) => canon(a) === canon(b);

/** Which verb a trigger and its reactions' firing mode read as (undefined: none of them, shown as its own words). */
export function verbOf(t: TriggerSpec, fire: FireSpec | undefined): Verb | undefined {
  return verbsFor(t).find(v => sameTrigger(v.trigger, t) && sameFire(v.fire, fire));
}

/** "When Space is pressed": a rule's sentence for one trigger. */
export function verbSentence(t: TriggerSpec, fire: FireSpec | undefined, ctx: LabelContext = {}): string {
  const v = verbOf(t, fire);
  if (v) return `When ${subjectOf(t, ctx)} ${v.label}`;
  return `When ${triggerLabel(t, ctx.layers ?? [], ctx)}`;
}
