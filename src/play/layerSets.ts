/**
 * layerSets.ts — layer sets (docs/presets.md): a group of layers saved with
 * everything that comes with them, so loading one brings the whole thing
 * back, wired, in any setup.
 *
 * The boundary rule: wiring (mappings, actions, signals, conditions) travels
 * only with complete things. A set carries a piece when everything the piece
 * names is inside the set:
 *
 *   layers         the picked ones, in order, with their folders (#359)
 *   controls       every control on a set layer's property or action (and a
 *                  reader control when the readers come along); a control a
 *                  carried mapping reads as its source comes too (a knob on
 *                  the shader keeps its target, checked when loading)
 *   mappings       onto a carried control, when their source reads only
 *                  what the set holds (a set layer, a carried control or
 *                  reader) or nothing of the setup's (a MIDI knob, an LFO…)
 *   actions        on a set layer or fired from one, all references inside
 *   signals        the ones carried pieces send or listen for
 *   pairs          both controls carried; their mappings likewise
 *   mattes         a layer's matte when the matte layer is in the set; the
 *                  Background's matte when its layer is (applied if the
 *                  setup has a Background and no matte yet)
 *   relationships  members in the set (others leave the relationship)
 *   readers        when they listen to a set layer's sound (a Video layer,
 *                  a Drum pad layer)
 *   sound effects  a set layer's own chain (layer:<id>)
 *   layer kinds    the saved kinds the set's Script layers are made from
 *   media          pictures are inside the layers already; videos and sounds
 *                  are named by library id or linked-folder reference
 *                  (listed in `media`; a .playfile export bundles them)
 *
 * Anything that touches the set but names something outside is left out and
 * listed ("Not included: mapping Lows → Radius (Radius isn't in the set)").
 *
 * Loading gives every piece a fresh id, rewires every reference
 * (play/playRefs.ts), places the layers at the top of the list (or after the
 * selected layer) in a folder named after the set, dedupes control names, and
 * is one undo step for the caller.
 *
 * Stored like drum kits: one list in localStorage (`shader-studio:layer-sets`),
 * so sets travel in library ZIPs, `.playfile` library items (with the videos
 * and sounds they name), profile ZIPs and the workspace folder, and show on
 * the Files page under Presets → Layer sets. Pure over a KV.
 */
import { safeSetItem, type FileResult } from '../utils/fileIO';
import {
  parsePlayRecord, PLAY_VERSION, normaliseBackgroundLayer, backgroundLayerOf,
  type BackgroundMatte, type PlayAction, type PlayControl, type PlayMapping, type PlayPair, type PlayPairMapping, type PlayRecord, type PlaySignal, type AudioReader, type PlayAudioReaders,
} from '../types/play';
import { videoLayerOfInput, videoReaderInput, padsLayerOfInput, padsReaderInput, type PlayLayer } from '../types/playLayers';
import { pruneGroups, tidyGroups, type LayerGroup } from '../types/layerGroups';
import type { PlayAudioFx } from '../types/playAudioFx';
import { isLinkedRef, linkedName } from '../files/linkedRefs';
import { mapAction, mapControl, mapLayerRefs, mapMapping, mapPair, mapPairMapping, mapTarget, type RefFn, type RefKind } from './playRefs';
import { playId } from './playControls';

export const LAYER_SETS_KEY = 'shader-studio:layer-sets';
/** Fired on window when the list changes. */
export const LAYER_SETS_CHANGED = 'layer-sets-changed';

/** A video, sound or font a set's layers name (not inside the set: a library id or a linked-folder reference). */
export interface SetMedia { id: string; kind: 'video' | 'sound' | 'font'; linked: boolean; name: string; layer: string }

export interface LayerSet {
  id: string;
  name: string;
  savedAt: number;
  note?: string;
  /** A small JPEG of the picture when it was saved (data URL). */
  poster?: string;
  /** The captured piece, shaped like a Play record (parsePlayRecord reads it). */
  play: PlayRecord;
  /** The Background's matte, when its matte layer is in the set. */
  backgroundMatte?: BackgroundMatte;
  media: SetMedia[];
  /** What touched the set but was left out, in words. */
  excluded: string[];
}

export interface SetCapture {
  play: PlayRecord;
  backgroundMatte?: BackgroundMatte;
  media: SetMedia[];
  excluded: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const q = (s: string) => `“${s}”`;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ── Capture ─────────────────────────────────────────────────────────────────

/** Every reference a piece makes, as [kind, id] (the piece itself unchanged). */
function refsOf(walk: (f: RefFn) => unknown): Array<[RefKind, string]> {
  const out: Array<[RefKind, string]> = [];
  walk((k, id) => { if (id) out.push([k, id]); return id; });
  return out;
}

const LINK_WORDS: Record<string, string> = {
  trackMatte: 'its matte', members: 'a member', layerId: 'the layer a member reads', pointIds: 'a corner of its path',
  followId: 'what it follows', nullId: 'the null it uses', sourceId: 'its source', targetId: 'its target', pathId: 'the path it follows',
};

/**
 * The part of `p` a set of these layers holds, and what was left out. The
 * Background layer never joins a set; ids that aren't layers are ignored.
 */
export function captureLayerSet(p: PlayRecord, layerIds: Iterable<string>): SetCapture {
  const byId = new Map(p.layers.map(l => [l.id, l]));
  const S = new Set([...layerIds].filter(id => byId.has(id) && byId.get(id)!.kind !== 'background'));
  const lname = (id: string) => byId.get(id)?.label ?? id;
  const excluded: string[] = [];
  const out = (s: string) => { if (!excluded.includes(s)) excluded.push(s); };
  const signals = new Set<string>();

  // Layers, their links to layers outside cut.
  const layers = p.layers.filter(l => S.has(l.id)).map(l => mapLayerRefs(clone(l), (k, id, where) => {
    if (k === 'signal') { signals.add(id); return id; }
    if (k !== 'layer' || S.has(id) || !byId.has(id)) return id;
    out(`${q(l.label)}: ${LINK_WORDS[where ?? ''] ?? 'a link'}, ${q(lname(id))} (${q(lname(id))} isn't in the set)`);
    return '';
  }));

  // Audio readers, when they listen to a set layer's sound.
  const input = p.audioReaders?.input ?? '';
  const readerLayer = videoLayerOfInput(input) ?? padsLayerOfInput(input);
  const R = new Set(readerLayer && S.has(readerLayer) ? (p.audioReaders?.readers ?? []).map(r => r.id) : []);
  const readersWord = (p.audioReaders?.readers.length ?? 0) ? `the audio readers (they listen to ${input ? (readerLayer ? q(lname(readerLayer)) : 'another sound') : 'the live input'})` : 'an audio reader';

  // Controls on the set's layers.
  const ctlById = new Map(p.controls.map(c => [c.id, c]));
  const clabel = (id: string) => ctlById.get(id)?.label ?? 'a control';
  const targetState = (t: string): 'in' | 'graph' | 'out' => {
    let state: 'in' | 'graph' | 'out' = 'in';
    mapTarget(t, (k, id) => {
      if ((k === 'layer' && !S.has(id)) || (k === 'reader' && !R.has(id)) || k === 'foreign') state = 'out';
      else if (k === 'graph' && state === 'in') state = 'graph';
      return id;
    });
    return state;
  };
  const core = new Set(p.controls.filter(c => targetState(c.target) === 'in').map(c => c.id));
  const C = new Set(core);

  // Why a reference isn't inside (null: it is, or can come along).
  const M = new Set<string>();
  const whyNot = (k: RefKind, id: string): string | null => {
    switch (k) {
      case 'layer': return S.has(id) ? null : `${q(lname(id))} isn't in the set`;
      case 'reader': return R.has(id) ? null : `${readersWord} aren't in the set`;
      case 'control': {
        if (C.has(id)) return null;
        const c = ctlById.get(id);
        if (c && targetState(c.target) !== 'out') return null; // it can come along
        return `${q(clabel(id))} isn't in the set`;
      }
      case 'mapping': return M.has(id) ? null : 'it reads a mapping that isn’t in the set';
      case 'foreign': return 'it reads the Finish stack or the Audio engine, which a set doesn’t carry';
      default: return null; // signals come along; graph refs are checked when loading
    }
  };
  const firstWhy = (refs: Array<[RefKind, string]>) => { for (const [k, id] of refs) { const w = whyNot(k, id); if (w) return w; } return null; };
  const touches = (refs: Array<[RefKind, string]>) => refs.some(([k, id]) => (k === 'layer' && S.has(id)) || (k === 'reader' && R.has(id)) || (k === 'control' && C.has(id)));
  const mlabel = (m: PlayMapping) => `mapping ${mappingWords(m, p)}`;

  // Mappings onto the set's controls whose sources are inside (a source control comes along), until nothing more joins.
  const mapRefs = new Map(p.mappings.map(m => [m.id, refsOf(f => mapMapping(m, f))]));
  for (let grew = true; grew;) {
    grew = false;
    for (const m of p.mappings) {
      if (M.has(m.id) || !core.has(m.controlId)) continue;
      const refs = mapRefs.get(m.id)!;
      if (firstWhy(refs)) continue;
      for (const [k, id] of refs) if (k === 'control') C.add(id);
      M.add(m.id);
      grew = true;
    }
  }
  const mappings: PlayMapping[] = [];
  for (const m of p.mappings) {
    const refs = mapRefs.get(m.id)!;
    if (M.has(m.id)) { mappings.push(clone(m)); for (const [k, id] of refs) if (k === 'signal') signals.add(id); continue; }
    if (!touches(refs)) continue;
    const why = core.has(m.controlId) ? firstWhy(refs)
      : C.has(m.controlId) ? `${q(clabel(m.controlId))} comes along as a source, without what drives it`
        : `${q(clabel(m.controlId))} isn't in the set`;
    out(`${mlabel(m)} (${why ?? 'it names something outside the set'})`);
  }

  // Actions on a set layer, fired from one, or listening for a signal the set sends (a catch, a burst…), until nothing more joins.
  const sent = new Set(signals);
  for (const m of mappings) for (const s of [m.increment?.stepSignal, m.increment?.resetSignal]) if (s) sent.add(s);
  const actionIn = new Set<string>();
  const actionRefs = new Map((p.actions ?? []).map(a => [a.id, refsOf(f => mapAction(a, f))]));
  const hears = (a: PlayAction) => a.trigger.on === 'signal' && !!a.trigger.signal && sent.has(a.trigger.signal);
  for (let grew = true; grew;) {
    grew = false;
    for (const a of p.actions ?? []) {
      const refs = actionRefs.get(a.id)!;
      if (actionIn.has(a.id) || !(touches(refs) || hears(a)) || firstWhy(refs)) continue;
      actionIn.add(a.id);
      if (a.signal) sent.add(a.signal);
      for (const [k, id] of refs) if (k === 'signal') signals.add(id); else if (k === 'control') C.add(id);
      grew = true;
    }
  }
  const actions: PlayAction[] = [];
  for (const a of p.actions ?? []) {
    if (actionIn.has(a.id)) { actions.push(clone(a)); continue; }
    const refs = actionRefs.get(a.id)!;
    if (!touches(refs)) continue;
    out(`action ${q(a.do)}${a.layerId && byId.has(a.layerId) ? ` on ${q(lname(a.layerId))}` : ''} (${firstWhy(refs) ?? 'it names something outside the set'})`);
  }

  // Pairs: both controls carried.
  const pairs: PlayPair[] = [];
  for (const pr of p.pairs ?? []) {
    const inA = C.has(pr.a), inB = C.has(pr.b);
    if (inA && inB) pairs.push(clone(pr));
    else if (inA || inB) out(`pair ${q(pr.label)} (${q(clabel(inA ? pr.b : pr.a))} isn't in the set)`);
  }
  const P = new Set(pairs.map(x => x.id));
  const pairMappings: PlayPairMapping[] = [];
  for (const pm of p.pairMappings ?? []) {
    if (!P.has(pm.pairId)) continue;
    const refs = refsOf(f => mapPairMapping(pm, f)).filter(([k]) => k !== 'pair');
    const why = firstWhy(refs);
    if (why) { out(`a mapping onto the pair ${q(p.pairs?.find(x => x.id === pm.pairId)?.label ?? '')} (${why})`); continue; }
    for (const [k, id] of refs) if (k === 'signal') signals.add(id); else if (k === 'control') C.add(id);
    pairMappings.push(clone(pm));
  }

  const controls: PlayControl[] = p.controls.filter(c => C.has(c.id)).map(clone);
  const playOut: PlayRecord = { version: PLAY_VERSION, controls, mappings, layers };

  // Folders, as far as they hold set layers.
  if (p.groups?.length) {
    const groups = pruneGroups(p.groups.map(g => ({ ...g, layers: g.layers.filter(id => S.has(id)) })), layers);
    if (groups.length) playOut.groups = clone(groups);
  }
  const kindIds = new Set(layers.map(l => (l as { kindId?: string }).kindId).filter((x): x is string => !!x));
  const kinds = (p.layerKinds ?? []).filter(k => kindIds.has(k.id));
  if (kinds.length) playOut.layerKinds = clone(kinds);
  if (actions.length) playOut.actions = actions;
  const sigs = (p.signals ?? []).filter(s => signals.has(s.id));
  if (sigs.length) playOut.signals = clone(sigs);
  if (pairs.length) playOut.pairs = pairs;
  if (pairMappings.length) playOut.pairMappings = pairMappings;
  if (R.size) playOut.audioReaders = clone(p.audioReaders!);
  const chains: PlayAudioFx['chains'] = {};
  for (const [id, c] of Object.entries(p.audioFx?.chains ?? {})) if (id.startsWith('layer:') && S.has(id.slice(6))) chains[id] = clone(c);
  if (Object.keys(chains).length) playOut.audioFx = { chains };

  const res: SetCapture = { play: playOut, media: setMedia(layers), excluded };
  if (p.backgroundMatte && S.has(p.backgroundMatte.id)) res.backgroundMatte = clone(p.backgroundMatte);
  // Datasets live in the graph file: a Data layer names its dataset by id.
  for (const l of layers) if (l.kind === 'data' && l.dataset) out(`the dataset ${q(l.label)} shows (datasets stay with their graph; the layer keeps its name)`);
  return res;
}

/** "Lows → Radius" */
function mappingWords(m: PlayMapping, p: PlayRecord): string {
  const s = m.source;
  const layer = (id: string) => p.layers.find(l => l.id === id)?.label ?? 'a layer';
  const src = s.kind === 'control' ? p.controls.find(c => c.id === s.controlId)?.label ?? 'a control'
    : s.kind === 'reader' ? p.audioReaders?.readers.find(r => r.id === s.readerId)?.name ?? 'a reader'
      : s.kind === 'null' || s.kind === 'sensor' ? `${layer(s.layerId)} ${s.kind === 'null' ? s.axis.toUpperCase() : s.read}`
        : s.kind === 'trigger' ? `a ${s.trigger.on} trigger`
          : s.kind === 'midi' ? `MIDI ${s.signal}${s.cc !== undefined ? ` ${s.cc}` : ''}`
            : s.kind;
  return `${src} → ${p.controls.find(c => c.id === m.controlId)?.label ?? 'a control'}`;
}

/** Videos, sounds and linked fonts the layers name. */
export function setMedia(layers: readonly PlayLayer[]): SetMedia[] {
  const out: SetMedia[] = [];
  const add = (id: string, kind: SetMedia['kind'], name: string, layer: string) => {
    if (!id || out.some(m => m.id === id)) return;
    out.push({ id, kind, linked: isLinkedRef(id), name: (isLinkedRef(id) ? linkedName(id) : name) || name || id, layer });
  };
  for (const l of layers) {
    const r = l as unknown as Record<string, unknown>;
    if (l.kind === 'video') add(l.videoId, 'video', l.fileName, l.label);
    if (l.kind === 'drumpad') for (const pad of l.pads) add(pad.sampleId, 'sound', pad.name || pad.fileName, l.label);
    if (typeof r.fontUrl === 'string' && isLinkedRef(r.fontUrl)) add(r.fontUrl, 'font', '', l.label);
  }
  return out;
}

/** "3 layers · 2 controls · 1 mapping · 1 action" */
export function setSummary(play: Pick<PlayRecord, 'layers' | 'controls' | 'mappings' | 'actions' | 'signals'>): string {
  const parts = [plural(play.layers.length, 'layer')];
  if (play.controls.length) parts.push(plural(play.controls.length, 'control'));
  if (play.mappings.length) parts.push(plural(play.mappings.length, 'mapping'));
  if (play.actions?.length) parts.push(plural(play.actions.length, 'action'));
  if (play.signals?.length) parts.push(plural(play.signals.length, 'signal'));
  return parts.join(' · ');
}

// ── Load ────────────────────────────────────────────────────────────────────

export interface LoadOptions {
  /** Place the layers right after this layer (else at the top of the list, above the Background's neighbours). */
  after?: string;
  /** Is this graph ref (a param path `node::param`, or a node id) in the current graph? Absent: every one is. */
  graphHas?: (ref: string) => boolean;
  /** Fresh ids (tests pass a counter). */
  newId?: (kind: 'layer' | 'group' | 'ctl' | 'map' | 'act' | 'pair' | 'pmap' | 'sig' | 'reader') => string;
}

export interface SetLoad {
  play: PlayRecord;
  /** The new layers' ids, in order. */
  layerIds: string[];
  /** The folder made for the set. */
  groupId: string;
  /** What didn't come in, in words. */
  notes: string[];
}

let seq = 0;
const defaultId: NonNullable<LoadOptions['newId']> = kind => {
  if (kind === 'group') return playId('layer').replace(/^layer_/, 'grp_');
  if (kind === 'reader') { seq += 1; return `rd${Date.now().toString(36)}${seq.toString(36)}s`; }
  return playId(kind);
};

/** "Fireflies (2)", "(3)"…: the first that isn't taken. */
function freeName(label: string, taken: ReadonlySet<string>): string {
  if (!taken.has(label)) return label;
  const base = label.replace(/\s*\(\d+\)$/, '');
  for (let n = 2; ; n++) { const name = `${base} (${n})`; if (!taken.has(name)) return name; }
}

/**
 * The record with the set added: fresh ids, every reference rewired, the
 * layers at the top of the list (or after `opts.after`) in a folder named
 * after the set. Pieces that can't come in (a shader knob this graph doesn't
 * have, readers when the setup already has its own) are left out and noted.
 */
export function loadLayerSet(p: PlayRecord, set: Pick<LayerSet, 'name' | 'play' | 'backgroundMatte'>, opts: LoadOptions = {}): SetLoad {
  const newId = opts.newId ?? defaultId;
  const notes: string[] = [];
  const src = parsePlayRecord(set.play);
  src.layers = src.layers.filter(l => l.kind !== 'background');
  if (!src.layers.length) return { play: p, layerIds: [], groupId: '', notes: ['The set has no layers.'] };

  // What can't come in: knobs on shader params this graph lacks, readers when the setup has its own.
  const dropControls = new Set<string>();
  let dropReaders = false;
  if (opts.graphHas) {
    for (const c of src.controls) {
      let missing = false;
      mapTarget(c.target, (k, id) => { if (k === 'graph' && !opts.graphHas!(id)) missing = true; return id; });
      if (missing) { dropControls.add(c.id); notes.push(`${q(c.label)} (it turns a shader param this graph doesn't have)`); }
    }
  }
  if (src.audioReaders?.readers.length && p.audioReaders?.readers.length) {
    dropReaders = true;
    notes.push(`the set's audio readers (this setup has readers of its own; one input at a time)`);
  }
  const readerIds = new Set(dropReaders ? [] : (src.audioReaders?.readers ?? []).map(r => r.id));
  // Everything that names a dropped piece goes too.
  const ok = (walk: (f: RefFn) => unknown) => {
    let fine = true;
    walk((k, id) => {
      if ((k === 'control' && dropControls.has(id)) || (k === 'reader' && !readerIds.has(id)) || (k === 'graph' && opts.graphHas && !opts.graphHas(id))) fine = false;
      return id;
    });
    return fine;
  };
  let controls = src.controls.filter(c => !dropControls.has(c.id) && ok(f => mapControl(c, f)));
  let mappings = src.mappings.filter(m => ok(f => mapMapping(m, f)));
  for (let changed = true; changed;) {
    const cids = new Set(controls.map(c => c.id));
    const before = mappings.length;
    mappings = mappings.filter(m => cids.has(m.controlId) && (m.source.kind !== 'control' || cids.has(m.source.controlId)));
    const mids = new Set(mappings.map(m => m.id));
    mappings = mappings.filter(m => { let fine = true; mapMapping(m, (k, id) => { if (k === 'mapping' && !mids.has(id)) fine = false; return id; }); return fine; });
    changed = mappings.length !== before;
  }
  const cids = new Set(controls.map(c => c.id)), mids = new Set(mappings.map(m => m.id));
  const inside = (walk: (f: RefFn) => unknown) => {
    let fine = ok(walk);
    walk((k, id) => { if ((k === 'control' && !cids.has(id)) || (k === 'mapping' && !mids.has(id))) fine = false; return id; });
    return fine;
  };
  const actions = (src.actions ?? []).filter(a => inside(f => mapAction(a, f)));
  const pairs = (src.pairs ?? []).filter(pr => cids.has(pr.a) && cids.has(pr.b));
  const pids = new Set(pairs.map(x => x.id));
  const pairMappings = (src.pairMappings ?? []).filter(pm => pids.has(pm.pairId) && inside(f => mapPairMapping(pm, f)));
  const lost = (src.mappings.length - mappings.length) + ((src.actions?.length ?? 0) - actions.length);
  if (lost) notes.push(`${plural(lost, 'mapping or action', 'mappings and actions')} that used those`);
  controls = controls.filter(c => cids.has(c.id));

  // Fresh ids.
  const ids: Record<RefKind, Map<string, string>> = { layer: new Map(), control: new Map(), mapping: new Map(), reader: new Map(), signal: new Map(), pair: new Map(), graph: new Map(), foreign: new Map() };
  for (const l of src.layers) ids.layer.set(l.id, newId('layer'));
  for (const c of controls) ids.control.set(c.id, newId('ctl'));
  for (const m of mappings) ids.mapping.set(m.id, newId('map'));
  for (const r of readerIds) ids.reader.set(r, newId('reader'));
  for (const x of pairs) ids.pair.set(x.id, newId('pair'));
  // Signals are names: one the setup already has (by name) is the same signal.
  const newSignals: PlaySignal[] = [];
  for (const s of src.signals ?? []) {
    const have = p.signals?.find(x => x.name === s.name);
    if (have) ids.signal.set(s.id, have.id);
    else { const id = newId('sig'); ids.signal.set(s.id, id); newSignals.push({ id, name: s.name }); }
  }
  const f: RefFn = (k, id) => ids[k].get(id) ?? id;

  // Layers, named apart from the setup's.
  const layerNames = new Set(p.layers.map(l => l.label));
  const newLabel = new Map<string, string>();
  const layers = src.layers.map(l => {
    const label = freeName(l.label, layerNames);
    layerNames.add(label);
    newLabel.set(l.id, label);
    const out = mapLayerRefs(l, f) as unknown as Record<string, unknown>;
    out.id = ids.layer.get(l.id); out.label = label;
    return out as unknown as PlayLayer;
  });

  // Controls: "Layer · Prop" follows the layer's new name; names deduped against the setup's.
  const controlNames = new Set(p.controls.map(c => c.label));
  const newControls: PlayControl[] = controls.map(c => {
    const mapped = mapControl(c, f);
    let label = c.label;
    for (const l of src.layers) if (label.startsWith(`${l.label} · `)) { label = newLabel.get(l.id)! + label.slice(l.label.length); break; }
    label = freeName(label, controlNames);
    controlNames.add(label);
    return { ...mapped, id: ids.control.get(c.id)!, label };
  });
  const newMappings = mappings.map(m => ({ ...mapMapping(m, f), id: ids.mapping.get(m.id)! }));
  const newActions = actions.map(a => ({ ...mapAction(a, f), id: newId('act') }));
  const newPairs = pairs.map(x => ({ ...mapPair(x, f), id: ids.pair.get(x.id)! }));
  const newPairMappings = pairMappings.map(pm => ({ ...mapPairMapping(pm, f), id: newId('pmap') }));

  // Folders: the set's own, inside one named after the set.
  const groupNames = new Set((p.groups ?? []).map(g => g.label));
  const folderId = newId('group');
  const gids = new Map((src.groups ?? []).map(g => [g.id, newId('group')]));
  const grouped = new Set((src.groups ?? []).flatMap(g => g.layers));
  const groups: LayerGroup[] = (src.groups ?? []).map(g => {
    const label = freeName(g.label, groupNames); groupNames.add(label);
    return { ...g, id: gids.get(g.id)!, label, layers: g.layers.map(id => ids.layer.get(id)!).filter(Boolean), parent: g.parent && gids.has(g.parent) ? gids.get(g.parent)! : folderId };
  });
  const folderLabel = freeName(set.name.trim() || 'Layer set', groupNames);
  const folder: LayerGroup = { id: folderId, label: folderLabel, colour: nextColour(p.groups), layers: src.layers.filter(l => !grouped.has(l.id)).map(l => ids.layer.get(l.id)!) };

  // Where they go: after the chosen layer, else at the top of the list (just under the Background).
  const at = opts.after ? p.layers.findIndex(l => l.id === opts.after) : -1;
  const top = backgroundLayerOf(p) ? 1 : 0;
  const index = at >= 0 ? at + 1 : top;
  const allLayers = normaliseBackgroundLayer([...p.layers.slice(0, index), ...layers, ...p.layers.slice(index)]);

  let out: PlayRecord = {
    ...p,
    layers: allLayers,
    controls: [...p.controls, ...newControls],
    mappings: [...p.mappings, ...newMappings],
    groups: [...(p.groups ?? []), folder, ...groups],
  };
  if (newActions.length) out.actions = [...(p.actions ?? []), ...newActions];
  if (newSignals.length) out.signals = [...(p.signals ?? []), ...newSignals];
  if (newPairs.length) out.pairs = [...(p.pairs ?? []), ...newPairs];
  if (newPairMappings.length) out.pairMappings = [...(p.pairMappings ?? []), ...newPairMappings];
  const haveKinds = new Set((p.layerKinds ?? []).map(k => k.id));
  const kinds = (src.layerKinds ?? []).filter(k => !haveKinds.has(k.id));
  if (kinds.length) out.layerKinds = [...(p.layerKinds ?? []), ...kinds];
  const chains = Object.entries(src.audioFx?.chains ?? {}).filter(([id]) => id.startsWith('layer:') && ids.layer.has(id.slice(6)));
  if (chains.length) out.audioFx = { ...(p.audioFx ?? {}), chains: { ...(p.audioFx?.chains ?? {}), ...Object.fromEntries(chains.map(([id, c]) => [`layer:${ids.layer.get(id.slice(6))}`, c])) } };
  if (readerIds.size && src.audioReaders) {
    const input = src.audioReaders.input;
    const vl = videoLayerOfInput(input), pl = padsLayerOfInput(input);
    const readers: AudioReader[] = src.audioReaders.readers.filter(r => readerIds.has(r.id)).map(r => ({ ...r, id: ids.reader.get(r.id)! }));
    const next: PlayAudioReaders = { input: vl ? videoReaderInput(f('layer', vl)) : pl ? padsReaderInput(f('layer', pl)) : input, readers };
    out.audioReaders = next;
  }
  if (set.backgroundMatte) {
    if (backgroundLayerOf(out) && !p.backgroundMatte && ids.layer.has(set.backgroundMatte.id)) out.backgroundMatte = { ...set.backgroundMatte, id: ids.layer.get(set.backgroundMatte.id)! };
    else notes.push(p.backgroundMatte ? 'the Background\'s matte (this setup\'s Background has one already)' : 'the Background\'s matte (this setup has no Background layer)');
  }
  out = tidyGroups(out);
  return { play: out, layerIds: layers.map(l => l.id), groupId: folderId, notes };
}

const COLOUR_ORDER = ['peach', 'teal', 'mauve', 'yellow', 'pink', 'green', 'sky', 'red', 'lavender', 'blue'] as const;
function nextColour(groups: readonly LayerGroup[] | undefined): LayerGroup['colour'] {
  const used = new Set((groups ?? []).map(g => g.colour));
  return (COLOUR_ORDER.find(c => !used.has(c)) ?? COLOUR_ORDER[(groups?.length ?? 0) % COLOUR_ORDER.length]) as LayerGroup['colour'];
}

// ── Storage ─────────────────────────────────────────────────────────────────

/** Where the list is kept: localStorage in the app, a map in tests. */
export interface ListKV { get(key: string): string | null; set(key: string, value: string): FileResult | void }
const localList: ListKV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => safeSetItem(k, v, 'layer sets'),
};
const newSetId = () => `lset_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`;
const readList = (kv: ListKV): unknown[] => { try { const a = JSON.parse(kv.get(LAYER_SETS_KEY) ?? '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
function writeList(kv: ListKV, list: LayerSet[]): FileResult {
  const r = kv.set(LAYER_SETS_KEY, JSON.stringify(list)) ?? { ok: true as const };
  if (r.ok && typeof window !== 'undefined' && kv === localList) window.dispatchEvent(new Event(LAYER_SETS_CHANGED));
  return r;
}

const POSTER_MAX = 400_000;

/** A set from storage or a file, checked; null when it isn't one (or holds no layers). */
export function parseLayerSet(raw: unknown): LayerSet | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || !r.play || typeof r.play !== 'object') return null;
  const play = parsePlayRecord(r.play);
  play.layers = play.layers.filter(l => l.kind !== 'background');
  if (!play.layers.length) return null;
  const out: LayerSet = {
    id: r.id.slice(0, 80),
    name: (typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Layer set').slice(0, 60),
    savedAt: typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : 0,
    play,
    media: Array.isArray(r.media) ? r.media.flatMap(m => {
      const o = m && typeof m === 'object' ? m as Record<string, unknown> : null;
      if (!o || typeof o.id !== 'string' || !o.id) return [];
      const kind = o.kind === 'video' || o.kind === 'font' ? o.kind : 'sound';
      return [{ id: o.id.slice(0, 400), kind, linked: isLinkedRef(o.id), name: typeof o.name === 'string' ? o.name.slice(0, 120) : '', layer: typeof o.layer === 'string' ? o.layer.slice(0, 80) : '' } as SetMedia];
    }).slice(0, 200) : setMedia(play.layers),
    excluded: Array.isArray(r.excluded) ? r.excluded.filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 300)).slice(0, 100) : [],
  };
  if (typeof r.note === 'string' && r.note.trim()) out.note = r.note.trim().slice(0, 2000);
  if (typeof r.poster === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(r.poster) && r.poster.length <= POSTER_MAX) out.poster = r.poster;
  const bm = r.backgroundMatte && typeof r.backgroundMatte === 'object' ? r.backgroundMatte as Record<string, unknown> : null;
  if (bm && typeof bm.id === 'string' && play.layers.some(l => l.id === bm.id)) {
    const m: BackgroundMatte = { id: bm.id, mode: bm.mode === 'luma' ? 'luma' : 'alpha' };
    if (bm.invert === true) m.invert = true;
    if (typeof bm.feather === 'number' && bm.feather > 0) m.feather = Math.min(200, bm.feather);
    if (typeof bm.opacityOutside === 'number' && bm.opacityOutside > 0) m.opacityOutside = Math.min(1, bm.opacityOutside);
    if (bm.showLayer === true) m.showLayer = true;
    out.backgroundMatte = m;
  }
  return out;
}

export function loadLayerSets(kv: ListKV = localList): LayerSet[] {
  return readList(kv).flatMap(x => { const s = parseLayerSet(x); return s ? [s] : []; });
}

/** Save a capture as a set. One with the same name is replaced (keeping its id). */
export function saveLayerSet(name: string, cap: SetCapture, extra: { note?: string; poster?: string } = {}, kv: ListKV = localList): { result: FileResult; set: LayerSet | null } {
  const n = name.trim().slice(0, 60);
  if (!n) return { result: { ok: false, error: 'A set needs a name.' }, set: null };
  if (!cap.play.layers.length) return { result: { ok: false, error: 'A set needs at least one layer.' }, set: null };
  const list = loadLayerSets(kv);
  const had = list.find(s => s.name === n);
  const set = parseLayerSet({ id: had?.id ?? newSetId(), name: n, savedAt: Date.now(), ...extra, ...cap });
  if (!set) return { result: { ok: false, error: 'That set couldn’t be read back.' }, set: null };
  return { result: writeList(kv, [...list.filter(s => s.name !== n), set]), set };
}

export function renameLayerSet(id: string, name: string, kv: ListKV = localList): FileResult {
  const n = name.trim().slice(0, 60);
  if (!n) return { ok: false, error: 'A set needs a name.' };
  return writeList(kv, loadLayerSets(kv).map(s => (s.id === id ? { ...s, name: n } : s)));
}

export function deleteLayerSet(id: string, kv: ListKV = localList): FileResult {
  return writeList(kv, loadLayerSets(kv).filter(s => s.id !== id));
}

/** A set whose name is taken (for "Replaces the set called…"). */
export function layerSetNamed(name: string, kv: ListKV = localList): LayerSet | undefined {
  return loadLayerSets(kv).find(s => s.name === name.trim());
}
