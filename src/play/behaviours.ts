/**
 * behaviours.ts — Behaviours (implementation guide 8, phase 9): recipes for
 * the common things, each a few rules and sources with open slots (which
 * layer, which control). Adding one fills the slots and gives every piece a
 * fresh id: what lands is ordinary rules and sources, edited like any other
 * ("open as rules").
 *
 * A template names a slot as `$slot:<key>` (a layer id, a control id, or
 * inside a value path: `ctl:$slot:<key>`), and its own rules and sources by
 * their template ids. A route onto a control slot can ask for its range:
 * `outMin`/`outMax` of '$full' (the control's range) or '$swing' (±half of
 * it, for Add).
 *
 * The starter set is built in; your own (Save as behaviour on a rule card)
 * are kept beside layer sets in localStorage (`shader-studio:behaviours`).
 * Pure over a KV.
 */
import { safeSetItem, type FileResult } from '../utils/fileIO';
import { newRuleId } from './rules';
import { actionsForLayer, usesHands, type PlayLayerKind, type PlayRecord, type PlayRoute, type PlaySignal, type PlaySourceDef, type TriggerSpec } from '../types/play';

export type BehaviourNeed = 'hands' | 'audio' | 'midi';
export interface BehaviourSlot {
  key: string;
  kind: 'layer' | 'control';
  label: string;
  /** A layer slot: the kinds it takes (any when absent). */
  layerKinds?: PlayLayerKind[];
}
export interface Behaviour {
  id: string;
  name: string;
  hint: string;
  needs: BehaviourNeed[];
  slots: BehaviourSlot[];
  rules: PlaySignal[];
  sources: PlaySourceDef[];
  builtIn?: boolean;
}

const slot = (key: string) => `$slot:${key}`;
const tmplRoute = (to: string, mode: 'add' | 'replace'): PlayRoute => ({ id: 'r', to: slot(to), mode, outMin: mode === 'add' ? '$swing' : '$full', outMax: mode === 'add' ? '$swing' : '$full', curve: 'linear', enabled: true } as unknown as PlayRoute);
const tmplSource = (id: string, source: PlaySourceDef['source'], route: PlayRoute): PlaySourceDef => ({ id, enabled: true, source, outputs: [{ kind: 'value', routes: [route] }] });
const tmplRule = (id: string, name: string, trigger: TriggerSpec, layerKey: string, act: string, amount = 1): PlaySignal => ({ id, name, inputs: [{ kind: 'trigger', trigger }], do: [{ id: `${id}_do`, do: act as never, layerId: slot(layerKey), amount, enabled: true }] });

/** The starter set. `$first` as an action means the slot layer's first action. */
export const BUILT_IN_BEHAVIOURS: readonly Behaviour[] = [
  { id: 'b_pinch_burst', name: 'Pinch to burst', hint: 'Close your right pinch: the particles burst', needs: ['hands'], builtIn: true,
    slots: [{ key: 'layer', kind: 'layer', label: 'Particles', layerKinds: ['particles'] }],
    rules: [tmplRule('t1', 'When Right · Pinch closes', { on: 'hand', side: 'right', gesture: 'pinch' }, 'layer', 'burst', 60)], sources: [] },
  { id: 'b_pulse_beat', name: 'Pulse to the beat', hint: 'A slider swells and falls with a 120 bpm beat', needs: [], builtIn: true,
    slots: [{ key: 'control', kind: 'control', label: 'Slider' }],
    rules: [], sources: [tmplSource('s1', { kind: 'clock', shape: 'sine', bpm: 120, beats: 1 }, tmplRoute('control', 'add'))] },
  { id: 'b_bass_shake', name: 'Bass shakes it', hint: 'The bass of the live sound pushes a slider up', needs: ['audio'], builtIn: true,
    slots: [{ key: 'control', kind: 'control', label: 'Slider' }],
    rules: [], sources: [tmplSource('s1', { kind: 'live', band: 'bass', gain: 1 }, tmplRoute('control', 'add'))] },
  { id: 'b_mouse_moves', name: 'Mouse moves it', hint: 'Across the window, left to right, sets a slider end to end', needs: [], builtIn: true,
    slots: [{ key: 'control', kind: 'control', label: 'Slider' }],
    rules: [], sources: [tmplSource('s1', { kind: 'mouse', axis: 'x' }, tmplRoute('control', 'replace'))] },
  { id: 'b_wander', name: 'Wander', hint: 'A slider drifts slowly around where it is', needs: [], builtIn: true,
    slots: [{ key: 'control', kind: 'control', label: 'Slider' }],
    rules: [], sources: [tmplSource('s1', { kind: 'noise', type: 'drift', rate: 0.2, seed: 7, steps: 0 }, tmplRoute('control', 'add'))] },
  { id: 'b_space_toggle', name: 'Space shows and hides', hint: 'Each press of Space turns a layer on or off', needs: [], builtIn: true,
    slots: [{ key: 'layer', kind: 'layer', label: 'Layer' }],
    rules: [tmplRule('t1', 'When Space is pressed', { on: 'key', code: 'Space' }, 'layer', 'toggle')], sources: [] },
  { id: 'b_kick_text', name: 'Kick steps the text', hint: 'Each bass hit moves a text to its next line', needs: ['audio'], builtIn: true,
    slots: [{ key: 'layer', kind: 'layer', label: 'Text', layerKinds: ['text'] }],
    rules: [tmplRule('t1', 'When the bass hits', { on: 'audio', band: 'bass', threshold: 0.6 }, 'layer', 'next')], sources: [] },
  { id: 'b_every_bar', name: 'Every bar', hint: 'Every 4 beats at 120 bpm, do a layer’s first action', needs: [], builtIn: true,
    slots: [{ key: 'layer', kind: 'layer', label: 'Layer' }],
    rules: [tmplRule('t1', 'Every 4 beats', { on: 'beat', bpm: 120, beats: 4 }, 'layer', '$first')], sources: [] },
];

/** The layers and controls of a setup that can fill a slot. */
export function slotChoices(play: PlayRecord, s: BehaviourSlot): Array<{ id: string; label: string }> {
  if (s.kind === 'control') return play.controls.filter(c => c.kind === 'float').map(c => ({ id: c.id, label: c.label }));
  return play.layers.filter(l => !s.layerKinds || s.layerKinds.includes(l.kind)).map(l => ({ id: l.id, label: l.label }));
}

/** What a setup lacks to add it: an empty slot's words, or null when it can be added. */
export function missingFor(play: PlayRecord, b: Behaviour): string | null {
  for (const s of b.slots) if (!slotChoices(play, s).length) return s.kind === 'control' ? 'Add a slider to the panel first' : `Add a ${s.layerKinds?.length === 1 ? s.layerKinds[0] : ''} layer first`.replace('a  layer', 'a layer');
  return null;
}

let seq = 0;
const fresh = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(++seq).toString(36)}`;

/**
 * Add a behaviour with its slots filled (slot key → a layer or control id).
 * Every rule and source gets a fresh id; references between them follow.
 */
export function applyBehaviour(play: PlayRecord, b: Behaviour, fill: Record<string, string>): { play: PlayRecord; ruleIds: string[]; sourceIds: string[] } {
  let json = JSON.stringify({ rules: b.rules, sources: b.sources });
  for (const s of b.slots) json = json.split(slot(s.key)).join(fill[s.key] ?? '');
  // Fresh ids, one template id at a time (longest first, so t1 doesn't eat t10).
  let p: PlayRecord = { ...play, signals: [...(play.signals ?? [])] };
  const ids = new Map<string, string>();
  for (const r of b.rules) { const id = newRuleId(p); ids.set(r.id, id); p = { ...p, signals: [...(p.signals ?? []), { id, name: '' }] }; }
  for (const s of b.sources) ids.set(s.id, fresh('src'));
  for (const r of b.rules) for (const x of r.do ?? []) ids.set(x.id, fresh('re'));
  for (const [from, to] of [...ids].sort((x, y) => y[0].length - x[0].length)) json = json.split(`"${from}"`).join(`"${to}"`).split(`sig:${from}"`).join(`sig:${to}"`);
  const { rules, sources } = JSON.parse(json) as { rules: PlaySignal[]; sources: PlaySourceDef[] };
  // A layer's first action, and a route's range from its control.
  for (const r of rules) for (const x of r.do ?? []) if ((x.do as string) === '$first') x.do = actionsForLayer(play.layers.find(l => l.id === x.layerId))[0];
  for (const s of sources) for (const o of s.outputs) o.routes = o.routes.map((r, i) => {
    const c = play.controls.find(x => x.id === r.to);
    const min = c?.kind === 'float' ? c.min : 0, max = c?.kind === 'float' ? c.max : 1;
    const out = { ...r, id: r.id === 'r' ? `${s.id}_r${i}` : r.id };
    if ((r.outMin as unknown) === '$swing') { out.outMin = -(max - min) / 2; out.outMax = (max - min) / 2; }
    if ((r.outMin as unknown) === '$full') { out.outMin = min; out.outMax = max; }
    return out;
  });
  const signals = [...(play.signals ?? []), ...rules];
  const next: PlayRecord = { ...play, signals };
  if (sources.length) next.sources = [...(play.sources ?? []), ...sources];
  return { play: next, ruleIds: rules.map(r => r.id), sourceIds: sources.map(s => s.id) };
}

/**
 * A rule as a behaviour of your own: the layers its reactions act on and the
 * controls its conditions read become slots. Inputs from other rules are left
 * out (named in `left`), as they would point at nothing elsewhere.
 */
export function behaviourFromRule(play: PlayRecord, ruleId: string, name: string): { behaviour: Behaviour | null; left: string[] } {
  const r = play.signals?.find(s => s.id === ruleId);
  if (!r) return { behaviour: null, left: [] };
  const left: string[] = [];
  const slots: BehaviourSlot[] = [];
  const keyOf = new Map<string, string>();
  const slotFor = (kind: 'layer' | 'control', id: string): string => {
    const k = keyOf.get(id);
    if (k) return k;
    const key = `${kind}${slots.length + 1}`;
    keyOf.set(id, key);
    const l = kind === 'layer' ? play.layers.find(x => x.id === id) : undefined;
    slots.push({ key, kind, label: kind === 'layer' ? (l?.label ?? 'Layer') : (play.controls.find(c => c.id === id)?.label ?? 'Slider'), ...(l ? { layerKinds: [l.kind] } : {}) });
    return key;
  };
  const inputs = (r.inputs ?? []).filter(x => {
    if (x.kind === 'signal') { left.push(`listening to ${play.signals?.find(s => s.id === x.signal)?.name ?? 'another rule'}`); return false; }
    return true;
  }).map(x => {
    if (x.kind !== 'trigger' || x.trigger.on !== 'value' || !x.trigger.value.startsWith('ctl:')) return x;
    return { ...x, trigger: { ...x.trigger, value: `ctl:${slot(slotFor('control', x.trigger.value.slice(4)))}` } };
  });
  const reactions = (r.do ?? []).map(x => (x.layerId ? { ...x, layerId: slot(slotFor('layer', x.layerId)) } : x));
  const rule: PlaySignal = { ...r, id: 't1', inputs, do: reactions };
  delete rule.when; delete rule.links;
  const needs: BehaviourNeed[] = [];
  if (usesHands({ mappings: [], layers: [], signals: [rule] })) needs.push('hands');
  if (inputs.some(x => x.kind === 'trigger' && (x.trigger.on === 'audio' || x.trigger.on === 'reader'))) needs.push('audio');
  if (inputs.some(x => x.kind === 'trigger' && x.trigger.on === 'note')) needs.push('midi');
  const n = name.trim().slice(0, 60) || r.name;
  return { behaviour: { id: fresh('beh'), name: n, hint: r.name, needs, slots, rules: [rule], sources: [] }, left };
}

// ── Your own, kept beside layer sets ─────────────────────────────────────────

export const BEHAVIOURS_KEY = 'shader-studio:behaviours';
export const BEHAVIOURS_CHANGED = 'behaviours-changed';
export interface ListKV { get(key: string): string | null; set(key: string, value: string): FileResult | void }
const localList: ListKV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => safeSetItem(k, v, 'behaviours'),
};

export function parseBehaviour(raw: unknown): Behaviour | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o.id !== 'string' || typeof o.name !== 'string' || !Array.isArray(o.rules) || !Array.isArray(o.slots)) return null;
  const slots = (o.slots as unknown[]).flatMap(s => {
    const x = s as Record<string, unknown> | null;
    return x && typeof x.key === 'string' && (x.kind === 'layer' || x.kind === 'control') ? [{ key: x.key, kind: x.kind, label: typeof x.label === 'string' ? x.label.slice(0, 60) : x.key, ...(Array.isArray(x.layerKinds) ? { layerKinds: x.layerKinds as PlayLayerKind[] } : {}) } as BehaviourSlot] : [];
  });
  const needs = (Array.isArray(o.needs) ? o.needs : []).filter((n): n is BehaviourNeed => n === 'hands' || n === 'audio' || n === 'midi');
  return { id: o.id.slice(0, 80), name: o.name.slice(0, 60), hint: typeof o.hint === 'string' ? o.hint.slice(0, 200) : '', needs, slots, rules: o.rules as PlaySignal[], sources: Array.isArray(o.sources) ? (o.sources as PlaySourceDef[]) : [] };
}

const readList = (kv: ListKV): unknown[] => { try { const a = JSON.parse(kv.get(BEHAVIOURS_KEY) ?? '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
function writeList(kv: ListKV, list: Behaviour[]): FileResult {
  const r = kv.set(BEHAVIOURS_KEY, JSON.stringify(list)) ?? { ok: true as const };
  if (r.ok && typeof window !== 'undefined' && kv === localList) window.dispatchEvent(new Event(BEHAVIOURS_CHANGED));
  return r;
}
export function loadBehaviours(kv: ListKV = localList): Behaviour[] {
  return readList(kv).flatMap(x => { const b = parseBehaviour(x); return b ? [b] : []; });
}
/** Save under its name; one with the same name is replaced. */
export function saveBehaviour(b: Behaviour, kv: ListKV = localList): FileResult {
  if (!b.name.trim()) return { ok: false, error: 'A behaviour needs a name.' };
  return writeList(kv, [...loadBehaviours(kv).filter(x => x.name !== b.name), b]);
}
export function deleteBehaviour(id: string, kv: ListKV = localList): FileResult {
  return writeList(kv, loadBehaviours(kv).filter(x => x.id !== id));
}
