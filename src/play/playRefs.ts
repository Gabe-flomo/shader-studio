/**
 * playRefs.ts — every place a Play record's pieces name each other, in one
 * visitor: controls name their target (a layer's property, an action, a
 * reader, a graph param…), mappings their control and whatever their source
 * reads, actions their layer, trigger and signal, conditions a control, a
 * mapping, a layer or two anchors, pairs their controls, layers the layers
 * they follow, matte, copy or chase, and the signals they send.
 *
 * Each `map…` function calls `f(kind, id)` for every reference and puts back
 * what it returns (a piece's own id is left alone: the caller gives it one), so the same walk both lists references (return the id
 * unchanged) and rewires them (return the new id). Layer sets use it
 * (play/layerSets.ts): capture asks "is everything this names inside the
 * set?", load gives every piece fresh ids.
 *
 * Kinds:
 *   layer    a layer id (a property, an action, a sensor, a zone, an anchor…)
 *   control  a control id
 *   mapping  a mapping id (a condition on a mapping's source)
 *   reader   an audio reader id
 *   signal   a signal id
 *   pair     a pair control id
 *   graph    a graph param path or node id (a control on the shader, an Audio Input node)
 *   foreign  something a set of layers can never hold: a Finish effect, a
 *            rack, a sound chain that isn't a layer's, a grain readout
 *
 * `f` returning '' clears a reference (the caller decides what that means).
 * Pure.
 */
import {
  ACTION_TARGET_PREFIX, CAPTURE_POS, EVENT_ANCHOR, LAYER_TARGET_PREFIX, parseEventAnchor, PAD_ANCHOR, SIGNAL_ANCHOR, parseActionTarget, parseHandAnchor, parseSignalAnchor, parseLayerTarget, parseReaderTarget, readerControlTarget,
  type PairSource, type PlayAction, type PlayControl, type PlayIncrement, type PlayMapping, type PlayPair, type PlayPairMapping, type PlaySignal, type PlaySource, type TriggerSpec, type ValueCondition,
} from '../types/play';
import type { PlayLayer } from '../types/playLayers';
import { parseAudioFxTarget, audioFxTarget, AUDIO_FX_TARGET_PREFIX } from '../types/playAudioFx';
import { FINISH_TARGET_PREFIX } from '../types/playFinish';
import { AU_TARGET_PREFIX, GRAINS_TARGET_PREFIX, MACRO_TARGET_PREFIX, RACK_ACT_PREFIX } from '../types/playAudioEngine';

export type RefKind = 'layer' | 'control' | 'mapping' | 'reader' | 'signal' | 'pair' | 'graph' | 'foreign';
/** `where`: inside a layer, the key the reference sits under (trackMatte, members, pointIds, followId…). */
export type RefFn = (kind: RefKind, id: string, where?: string) => string;

/** A point on the picture: a layer's centre (a layer ref), or a hand point, the pad grid, the mouse or a fixed point (no ref). */
export function mapAnchor(ref: string, f: RefFn): string {
  if (!ref || parseHandAnchor(ref) || ref === PAD_ANCHOR || ref === 'mouse' || ref === 'pointer' || ref.startsWith('pt:')) return ref;
  // A particles layer's latest event.
  const ev = parseEventAnchor(ref);
  if (ev) { const id = f('layer', ev.layerId); return id ? `${EVENT_ANCHOR}${id}:${ev.event}` : ''; }
  // A signal's captured position.
  const sa = parseSignalAnchor(ref);
  if (sa) { const id = f('signal', sa.id); return id ? `${SIGNAL_ANCHOR}${id}${sa.held ? ':held' : ''}` : ''; }
  return f('layer', ref);
}

/** A control's target. */
export function mapTarget(target: string, f: RefFn): string {
  if (target.startsWith(LAYER_TARGET_PREFIX)) {
    const t = parseLayerTarget(target);
    return t ? `${LAYER_TARGET_PREFIX}${f('layer', t.layerId)}::${t.key}` : target;
  }
  if (target.startsWith(ACTION_TARGET_PREFIX)) {
    const t = parseActionTarget(target);
    return t ? `${ACTION_TARGET_PREFIX}${f('layer', t.layerId)}::${t.do}` : target;
  }
  const rt = parseReaderTarget(target);
  if (rt) return readerControlTarget(f('reader', rt.readerId));
  if (target.startsWith(AUDIO_FX_TARGET_PREFIX)) {
    const t = parseAudioFxTarget(target);
    if (t && t.chainId.startsWith('layer:')) return audioFxTarget(`layer:${f('layer', t.chainId.slice(6))}`, t.effectId, t.key);
    return f('foreign', target);
  }
  if (target.startsWith(FINISH_TARGET_PREFIX) || target.startsWith(AU_TARGET_PREFIX) || target.startsWith(GRAINS_TARGET_PREFIX) || target.startsWith(MACRO_TARGET_PREFIX)) return f('foreign', target);
  return f('graph', target);
}

/** A condition's value path (sgParseValueRef): `ctl:`, `map:`, `layer:<id>::<key>`, `read:<id>::<read>`, `dist:<A>|<B>`… */
export function mapValueRef(ref: string, f: RefFn): string {
  if (ref.startsWith('ctl:')) return `ctl:${f('control', ref.slice(4))}`;
  if (ref.startsWith('map:')) return `map:${f('mapping', ref.slice(4))}`;
  if (ref.startsWith('dist:')) {
    const i = ref.indexOf('|');
    if (i < 6) return ref;
    return `dist:${mapAnchor(ref.slice(5, i), f)}|${mapAnchor(ref.slice(i + 1), f)}`;
  }
  if (ref.startsWith(LAYER_TARGET_PREFIX)) return mapTarget(ref, f);
  // The picture's brightness around a position: pic:<ch>:<anchor> ('all' is the whole picture).
  if (ref.startsWith('pic:')) { const m = /^(pic:(?:lum|r|g|b):)(.+)$/.exec(ref); return m ? (m[2] === 'all' ? ref : `${m[1]}${mapAnchor(m[2], f)}`) : ref; }
  // One axis of a position: ax:x:<anchor>.
  if (ref.startsWith('ax:x:') || ref.startsWith('ax:y:')) return `${ref.slice(0, 5)}${mapAnchor(ref.slice(5), f)}`;
  // A layer's reading: `read:<layerId>::<read>`.
  if (ref.startsWith('read:')) {
    const i = ref.lastIndexOf('::');
    return i > 5 ? `read:${f('layer', ref.slice(5, i))}${ref.slice(i)}` : ref;
  }
  if (ref.startsWith(FINISH_TARGET_PREFIX) || ref.startsWith(AUDIO_FX_TARGET_PREFIX)) return mapTarget(ref, f);
  return ref;
}

export function mapCondition<T extends ValueCondition>(c: T, f: RefFn): T {
  return { ...c, value: mapValueRef(c.value, f) };
}

const sig = (id: string | undefined, f: RefFn) => (id ? f('signal', id) : id);

export function mapTrigger(t: TriggerSpec, f: RefFn): TriggerSpec {
  switch (t.on) {
    case 'zone': return { ...t, layerId: f('layer', t.layerId) };
    case 'proximity': return { ...t, a: mapAnchor(t.a, f), b: mapAnchor(t.b, f) };
    case 'reader': return { ...t, readerId: f('reader', t.readerId) };
    case 'value': return mapCondition(t, f);
    case 'signal': return t.signal ? { ...t, signal: f('signal', t.signal) } : t;
    default: return t;
  }
}

export function mapSource(s: PlaySource, f: RefFn): PlaySource {
  switch (s.kind) {
    case 'control': return { ...s, controlId: f('control', s.controlId) };
    case 'captured': return { ...s, signal: f('signal', s.signal) };
    case 'null': return { ...s, layerId: f('layer', s.layerId) };
    case 'sensor':
      // A Granulator rack's grains read as a sensor on `ae:<rackId>`: a rack, not a layer.
      if (s.layerId.startsWith(RACK_ACT_PREFIX)) return { ...s, layerId: f('foreign', s.layerId) };
      return { ...s, layerId: f('layer', s.layerId), otherId: s.read === 'distance' ? mapAnchor(s.otherId, f) : s.otherId };
    case 'reader': return { ...s, readerId: f('reader', s.readerId) };
    case 'trigger': return { ...s, trigger: mapTrigger(s.trigger, f) };
    case 'data': return s.layerId ? { ...s, layerId: f('layer', s.layerId) } : s;
    case 'audio': return { ...s, nodeId: f('graph', s.nodeId) };
    default: return s;
  }
}

export function mapIncrement(inc: PlayIncrement, f: RefFn): PlayIncrement {
  const out: PlayIncrement = { ...inc, trigger: mapTrigger(inc.trigger, f) };
  if (inc.when) out.when = mapCondition(inc.when, f);
  if (inc.resetOn) out.resetOn = sig(inc.resetOn, f);
  if (inc.stepSignal) out.stepSignal = sig(inc.stepSignal, f);
  if (inc.resetSignal) out.resetSignal = sig(inc.resetSignal, f);
  return out;
}

export function mapControl(c: PlayControl, f: RefFn): PlayControl {
  return { ...c, target: mapTarget(c.target, f) };
}

export function mapMapping(m: PlayMapping, f: RefFn): PlayMapping {
  const out: PlayMapping = { ...m, controlId: f('control', m.controlId), source: mapSource(m.source, f) };
  if (m.increment) out.increment = mapIncrement(m.increment, f);
  return out;
}

export function mapAction(a: PlayAction, f: RefFn): PlayAction {
  const layerId = !a.layerId ? a.layerId : a.layerId.startsWith(RACK_ACT_PREFIX) ? f('foreign', a.layerId) : f('layer', a.layerId);
  const out: PlayAction = { ...a, layerId, trigger: mapTrigger(a.trigger, f) };
  if (a.signal) out.signal = f('signal', a.signal);
  return out;
}

/** A signal's own id and what it is defined by: its trigger, or the signals it combines. */
export function mapSignal(s: PlaySignal, f: RefFn): PlaySignal {
  const out: PlaySignal = { ...s, id: f('signal', s.id) };
  if (s.links) out.links = s.links.map(l => ({ ...l, to: f('signal', l.to) })).filter(l => l.to);
  if (s.capture) out.capture = { ...s.capture, what: s.capture.what.startsWith(CAPTURE_POS) ? `${CAPTURE_POS}${mapAnchor(s.capture.what.slice(CAPTURE_POS.length), f)}` : mapValueRef(s.capture.what, f) };
  if (s.when?.kind === 'trigger') out.when = { kind: 'trigger', trigger: mapTrigger(s.when.trigger, f) };
  else if (s.when?.kind === 'logic') out.when = { ...s.when, inputs: s.when.inputs.map(i => f('signal', i)).filter(Boolean) };
  return out;
}

export function mapPair(p: PlayPair, f: RefFn): PlayPair {
  return { ...p, a: f('control', p.a), b: f('control', p.b) };
}

function mapPairSource(s: PairSource, f: RefFn): PairSource {
  return s.kind === 'position' ? { ...s, anchor: mapAnchor(s.anchor, f) } : { ...s, source: mapSource(s.source, f) };
}

export function mapPairMapping(m: PlayPairMapping, f: RefFn): PlayPairMapping {
  const out: PlayPairMapping = { ...m, pairId: f('pair', m.pairId), source: mapPairSource(m.source, f), a: { ...m.a }, b: { ...m.b } };
  if (m.a.when) out.a.when = mapCondition(m.a.when, f);
  if (m.b.when) out.b.when = mapCondition(m.b.when, f);
  if (m.swap) out.swap = { ...m.swap, ...(m.swap.signal ? { signal: f('signal', m.swap.signal) } : {}), ...(m.swap.backSignal ? { backSignal: f('signal', m.swap.backSignal) } : {}) };
  return out;
}

// ── Inside a layer ──────────────────────────────────────────────────────────

/** Keys that hold another layer's id, wherever they sit in a layer (a particle field's null, an Agents rule's target…). */
const LAYER_REF_KEYS = new Set(['followId', 'nullId', 'sourceId', 'targetId', 'pathId', 'pointIds', 'layerId']);
/** Keys holding a signal id: `catchSignal`, `bornSignal`, `splitSignal`… */
const SIGNAL_KEY = /Signal$/;

/**
 * A layer's references to other layers (its matte, the nulls it follows, a
 * cloner's source, a relationship's members, a path's corners, an Agents
 * rule's target…) and to the signals it sends. `f` returning '' drops the
 * reference: a matte goes, a member leaves the relationship, a corner leaves
 * the path, a follow or a target is left empty. The layer's own id is not
 * touched (the caller gives it one).
 */
export function mapLayerRefs(l: PlayLayer, f: RefFn): PlayLayer {
  const walk = (v: unknown, key: string): unknown => {
    if (Array.isArray(v)) {
      if (key === 'pointIds') return v.map(x => (typeof x === 'string' && x ? f('layer', x, 'pointIds') : x)).filter(x => x !== '');
      if (key === 'members') {
        return v.flatMap(m => {
          if (!m || typeof m !== 'object') return [m];
          const o = walk(m, '') as Record<string, unknown>;
          const id = typeof o.id === 'string' && o.id ? f('layer', o.id, 'members') : o.id;
          return id === '' ? [] : [{ ...o, id }];
        });
      }
      return v.map(x => walk(x, ''));
    }
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === 'string' && x && LAYER_REF_KEYS.has(k)) out[k] = f('layer', x, k);
      else if (typeof x === 'string' && x && SIGNAL_KEY.test(k)) out[k] = f('signal', x);
      else out[k] = walk(x, k);
    }
    return out;
  };
  const top = { ...(l as unknown as Record<string, unknown>) };
  const matte = top.trackMatte as { id: string } | undefined;
  delete top.trackMatte;
  const out = walk(top, '') as Record<string, unknown>;
  out.id = l.id; out.kind = l.kind;
  if (matte?.id) { const id = f('layer', matte.id, 'trackMatte'); if (id) out.trackMatte = { ...matte, id }; }
  return out as unknown as PlayLayer;
}
