/**
 * playHistory.ts — what a Play edit was, in plain words, for the undo history.
 *
 * Every Play edit goes through the store's setPlay, which compares the record
 * before and after with describePlayChange and pushes one undo step named from
 * the difference: "Added layer Text 1", "Text 1 · Size 24 → 32", "Removed the
 * mapping Mouse X → Radius". A change to one value also gets a `key`: a slider
 * drag changes the same key many times a second, and the store folds those
 * into one step (like the Studio's knob bursts).
 *
 * The record is compared structurally: lists of things with ids (layers,
 * controls, mappings, actions, Finish effects, racks…) as added, removed,
 * reordered or changed items, everything else key by key. Unchanged parts keep
 * their identity between records, so the comparison is quick.
 */
import type { PlayRecord } from '../types/play';
import { FINISH_EFFECTS } from '../types/playFinish';
import { AUDIO_FX_EFFECTS } from '../types/playAudioFx';
import { sourceLabel } from '../play/playSources';
import { actionLabel } from '../components/play/layers/help';

export type PlayChangeKind = 'added' | 'removed' | 'edit' | 'moved' | 'comment' | 'changed';

export interface PlayChange {
  /** One line for the step: "Added layer Text 1". */
  label: string;
  /** Everything that changed, one line each. */
  lines: string[];
  kind: PlayChangeKind;
  /**
   * Set when the step changed values on one thing only (a slider, a drag, typing in the
   * notes): the same key changing again straight away is the same edit still going on.
   */
  key: string | null;
}

interface Line { text: string; key: string; kind: PlayChangeKind }

interface Item { id: string; [k: string]: unknown }
type Rec = Record<string, unknown>;

/** The record's top-level parts: what to call them, and (lists) what one of them is. */
const SECTIONS: Record<string, { name: string; noun?: string; kind?: PlayChangeKind }> = {
  layers: { name: 'Layers', noun: 'layer' },
  groups: { name: 'Groups', noun: 'group' },
  controls: { name: 'Controls', noun: 'control' },
  mappings: { name: 'Mappings', noun: 'mapping' },
  actions: { name: 'Actions', noun: 'action' },
  signals: { name: 'Signals', noun: 'signal' },
  pairs: { name: 'Pairs', noun: 'pair' },
  pairMappings: { name: 'Pair mappings', noun: 'pair mapping' },
  takes: { name: 'Takes', noun: 'take' },
  layerKinds: { name: 'Layer kinds', noun: 'layer kind' },
  notes: { name: 'Notes', kind: 'comment' },
  source: { name: 'Source credit' },
  display: { name: 'Background' },
  midiFile: { name: 'MIDI file' },
  padGrid: { name: 'Pad grid' },
  hands: { name: 'Hands' },
  audioReaders: { name: 'Audio readers' },
  finish: { name: 'Finish' },
  audioFx: { name: 'Audio effects' },
  audioEngine: { name: 'Audio engine' },
  projection: { name: 'Projection' },
};

/** Nouns for lists nested inside a section ("Finish · effects" → "effect"). */
const NESTED_NOUNS: Record<string, string> = {
  effects: 'effect', racks: 'rack', stops: 'stop', masks: 'mask', sources: 'source', pads: 'pad', zones: 'zone',
  readers: 'reader', tracks: 'track', surfaces: 'surface', lines: 'line', items: 'item', points: 'point', params: 'param', paramDefs: 'param',
};

/** Keys that change on their own while the setup is played, not edited (a rack taking the keyboard): never a step. */
const NOT_HISTORY = [/^audioEngine\.racks\.[^.]+\.keyboard$/];
const notHistory = (key: string) => NOT_HISTORY.some(re => re.test(key));

/**
 * The difference between two Play records as one undo step, or null when nothing worth a
 * step changed (the records are the same, or only a live flag moved).
 */
export function describePlayChange(before: PlayRecord, after: PlayRecord): PlayChange | null {
  if (before === after) return null;
  const ctx: Ctx = { before, after };
  const lines: Line[] = [];
  const b = before as unknown as Rec, a = after as unknown as Rec;
  for (const key of union(Object.keys(b), Object.keys(a))) {
    if (key === 'version' || same(b[key], a[key])) continue;
    const sec = SECTIONS[key] ?? { name: humanize(key) };
    if (sec.noun && (isItemList(b[key]) || isItemList(a[key]))) {
      diffItems(ctx, key, sec.noun, asItems(b[key]), asItems(a[key]), lines, key);
    } else if (sec.kind === 'comment') {
      lines.push({ text: b[key] == null ? 'Wrote the notes' : a[key] == null ? 'Cleared the notes' : 'Edited the notes', key, kind: 'comment' });
    } else if (isRec(b[key]) && isRec(a[key])) {
      diffObject(ctx, key, sec.name, b[key] as Rec, a[key] as Rec, lines, key);
    } else if (b[key] == null) {
      lines.push({ text: `Set up ${lower(sec.name)}`, key, kind: 'added' });
    } else if (a[key] == null) {
      lines.push({ text: `Removed ${lower(sec.name)}`, key, kind: 'removed' });
    } else {
      lines.push({ text: `${sec.name} ${valueChange(b[key], a[key])}`, key, kind: 'edit' });
    }
  }
  const kept = lines.filter(l => !notHistory(l.key));
  if (!kept.length) return null;
  const kinds = new Set(kept.map(l => l.kind));
  const kind: PlayChangeKind = kinds.has('added') && !kinds.has('removed') ? 'added'
    : kinds.has('removed') && !kinds.has('added') ? 'removed'
      : kinds.has('added') ? 'changed'
        : kinds.size === 1 ? kept[0].kind : 'edit';
  // One thing edited (several of its values at once, as a drag of a point changes X and Y): one key, one label.
  const owners = new Set(kept.map(l => l.key.replace(/\.[^.]+$/, '')));
  const single = kept.length === 1 || (owners.size === 1 && kept.every(l => l.kind === 'edit' || l.kind === 'comment'));
  const key = single ? kept.map(l => l.key).sort().join('|') : null;
  const label = kept.length === 1 ? kept[0].text : single && kept.length <= 3 ? joinSameOwner(kept) : `${kept[0].text} and ${kept.length - 1} more`;
  return { label, lines: kept.map(l => l.text), kind, key };
}

interface Ctx { before: PlayRecord; after: PlayRecord }

// ── Lists of things with ids ─────────────────────────────────────────────────

function diffItems(ctx: Ctx, path: string, noun: string, before: Item[], after: Item[], out: Line[], section: string): void {
  const bIds = new Map(before.map(i => [i.id, i])), aIds = new Map(after.map(i => [i.id, i]));
  for (const it of after) if (!bIds.has(it.id)) out.push({ text: `Added ${noun} ${itemName(section, path, it, ctx.after)}`, key: `${path}.${it.id}`, kind: 'added' });
  for (const it of before) if (!aIds.has(it.id)) out.push({ text: `Removed ${noun === 'mapping' || noun === 'pair mapping' ? `the ${noun}` : noun} ${itemName(section, path, it, ctx.before)}`, key: `${path}.${it.id}`, kind: 'removed' });
  const shared = before.filter(i => aIds.has(i.id)).map(i => i.id);
  const sharedAfter = after.filter(i => bIds.has(i.id)).map(i => i.id);
  if (shared.some((id, i) => sharedAfter[i] !== id)) out.push({ text: `Reordered ${plural(noun)}`, key: `${path}:order`, kind: 'moved' });
  for (const id of shared) {
    const b = bIds.get(id)!, a = aIds.get(id)!;
    if (b === a) continue;
    const name = itemName(section, path, a, ctx.after);
    for (const k of union(Object.keys(b), Object.keys(a))) {
      if (k === 'id' || same(b[k], a[k])) continue;
      const bv = b[k], av = a[k], sub = `${path}.${id}.${k}`;
      if (k === 'label' || (k === 'name' && typeof av === 'string')) { out.push({ text: `Renamed ${noun} ${text(bv)} to ${text(av)}`, key: `${sub}`, kind: 'edit' }); continue; }
      if (k === 'visible' && typeof av === 'boolean') { out.push({ text: `${av ? 'Showed' : 'Hid'} ${noun} ${name}`, key: sub, kind: 'edit' }); continue; }
      if (k === 'enabled' || k === 'on') { if (typeof av === 'boolean') { out.push({ text: `Turned ${noun} ${name} ${av ? 'on' : 'off'}`, key: sub, kind: 'edit' }); continue; } }
      if (NESTED_NOUNS[k] && (isItemList(bv) || isItemList(av))) { diffItems(ctx, sub, NESTED_NOUNS[k], asItems(bv), asItems(av), out, section); continue; }
      if (isRec(bv) && isRec(av) && !isColour(bv)) { diffObject(ctx, sub, `${name} · ${keyLabel(section, a, k)}`, bv as Rec, av as Rec, out, section); continue; }
      out.push({ text: `${name} · ${keyLabel(section, a, k)} ${valueChange(bv, av)}`, key: sub, kind: 'edit' });
    }
  }
}

function diffObject(ctx: Ctx, path: string, name: string, b: Rec, a: Rec, out: Line[], section: string): void {
  for (const k of union(Object.keys(b), Object.keys(a))) {
    if (same(b[k], a[k])) continue;
    const bv = b[k], av = a[k], sub = `${path}.${k}`;
    if (NESTED_NOUNS[k] && (isItemList(bv) || isItemList(av))) { diffItems(ctx, sub, NESTED_NOUNS[k], asItems(bv), asItems(av), out, section); continue; }
    if (isRec(bv) && isRec(av) && !isColour(bv) && !Array.isArray(bv)) {
      // A map of things by id (audio effect chains by sound): each one on its own.
      if (Object.values(av).every(isRec) && Object.values(bv).every(isRec) && Object.keys(av).length + Object.keys(bv).length > 0 && !('on' in av) && !('kind' in av)) {
        for (const ck of union(Object.keys(bv), Object.keys(av))) {
          if (same((bv as Rec)[ck], (av as Rec)[ck])) continue;
          if ((bv as Rec)[ck] == null) { out.push({ text: `Added ${lower(name)} on ${chainName(ctx, ck)}`, key: `${sub}.${ck}`, kind: 'added' }); continue; }
          if ((av as Rec)[ck] == null) { out.push({ text: `Removed ${lower(name)} from ${chainName(ctx, ck)}`, key: `${sub}.${ck}`, kind: 'removed' }); continue; }
          diffObject(ctx, `${sub}.${ck}`, `${name} · ${chainName(ctx, ck)}`, (bv as Rec)[ck] as Rec, (av as Rec)[ck] as Rec, out, section);
        }
        continue;
      }
      diffObject(ctx, sub, `${name} · ${humanize(k)}`, bv as Rec, av as Rec, out, section);
      continue;
    }
    if ((k === 'on' || k === 'enabled') && typeof av === 'boolean') { out.push({ text: `Turned ${lower(name)} ${av ? 'on' : 'off'}`, key: sub, kind: 'edit' }); continue; }
    out.push({ text: `${name} · ${humanize(k)} ${valueChange(bv, av)}`, key: sub, kind: 'edit' });
  }
}

// ── Names ────────────────────────────────────────────────────────────────────

function itemName(section: string, path: string, it: Item, rec: PlayRecord): string {
  if (section === 'mappings' || section === 'pairMappings') {
    const target = section === 'mappings' ? rec.controls.find(c => c.id === it.controlId)?.label : rec.pairs?.find(p => p.id === it.pairId)?.label;
    const src = it.source && typeof it.source === 'object' ? safe(() => sourceLabel(it.source as never, rec.controls, rec.layers)) : null;
    return `${src ?? 'a source'} → ${target ?? 'a control'}`;
  }
  if (section === 'actions') {
    const layer = rec.layers.find(l => l.id === it.layerId);
    const act = safe(() => actionLabel(it.do as never, layer)) ?? String(it.do);
    return layer ? `${act} on ${layer.label}` : act;
  }
  if (section === 'finish' && path.endsWith('effects')) {
    const kind = String(it.kind);
    return typeof it.name === 'string' && it.name ? it.name : (FINISH_EFFECTS as Record<string, { label: string }>)[kind]?.label ?? humanize(kind);
  }
  if (section === 'audioFx') {
    const kind = String(it.kind);
    return (AUDIO_FX_EFFECTS as Record<string, { label: string }>)[kind]?.label ?? humanize(kind);
  }
  if (typeof it.label === 'string' && it.label) return it.label;
  if (typeof it.name === 'string' && it.name) return it.name;
  if (typeof it.kind === 'string') return humanize(it.kind);
  return 'item';
}

/** What a sound's effect chain is called: the layer's label, or the bus. */
function chainName(ctx: Ctx, chainId: string): string {
  if (chainId === 'master') return 'the master bus';
  const [kind, id] = chainId.split(':');
  const layer = ctx.after.layers.find(l => l.id === (id ?? chainId)) ?? ctx.before.layers.find(l => l.id === (id ?? chainId));
  return layer ? layer.label : kind === 'midi' ? 'the MIDI synth' : humanize(chainId);
}

function keyLabel(section: string, item: Item, k: string): string {
  if (section === 'finish' && typeof item.kind === 'string') {
    const p = (FINISH_EFFECTS as Record<string, { params?: { key: string; label: string }[] }>)[item.kind]?.params?.find(x => x.key === k);
    if (p) return p.label;
  }
  if (section === 'audioFx' && typeof item.kind === 'string') {
    const p = (AUDIO_FX_EFFECTS as Record<string, { params?: { key: string; label: string }[] }>)[item.kind]?.params?.find(x => x.key === k);
    if (p) return p.label;
  }
  return humanize(k);
}

// ── Values ───────────────────────────────────────────────────────────────────

function valueChange(b: unknown, a: unknown): string {
  const bt = text(b), at = text(a);
  if (bt === null || at === null) return b == null && a != null ? 'set' : a == null ? 'cleared' : 'edited';
  return `${bt} → ${at}`;
}

/** A value as the History panel shows it, or null for one too big to show (a table, a picture). */
export function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') {
    if (v.startsWith('data:')) return null;
    const s = v.length > 24 ? `${v.slice(0, 22)}…` : v;
    return `“${s}”`;
  }
  if (Array.isArray(v)) {
    if (v.length <= 4 && v.every(x => typeof x === 'number')) return `(${v.map(num).join(', ')})`;
    return null;
  }
  return null;
}

function num(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 1000) / 1000;
  return String(r);
}

function joinSameOwner(lines: Line[]): string {
  // "Null 1 · X 0.2 → 0.5" + "Null 1 · Y 0.1 → 0.3" → "Null 1 · X 0.2 → 0.5 · Y 0.1 → 0.3"
  const first = lines[0].text, sep = first.indexOf(' · ');
  if (sep < 0) return `${first} and ${lines.length - 1} more`;
  const owner = first.slice(0, sep);
  if (!lines.every(l => l.text.startsWith(`${owner} · `))) return `${first} and ${lines.length - 1} more`;
  return `${owner} · ${lines.map(l => l.text.slice(sep + 3)).join(' · ')}`;
}

// ── Small helpers ────────────────────────────────────────────────────────────

function union(a: string[], b: string[]): string[] { return [...new Set([...a, ...b])]; }
function isRec(v: unknown): v is Rec { return !!v && typeof v === 'object'; }
function isItemList(v: unknown): v is Item[] { return Array.isArray(v) && v.length > 0 && v.every(x => isRec(x) && typeof x.id === 'string'); }
function asItems(v: unknown): Item[] { return Array.isArray(v) ? (v as Item[]).filter(x => isRec(x) && typeof x.id === 'string') : []; }
function isColour(v: unknown): boolean { return Array.isArray(v) && v.length <= 4 && v.every(x => typeof x === 'number'); }
function lower(s: string): string { return s.charAt(0).toLowerCase() + s.slice(1); }
function plural(noun: string): string { return noun.endsWith('s') ? noun : `${noun}s`; }
function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }

/** camelCase or snake_case → "Camel case". */
export function humanize(k: string): string {
  const words = k.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  if (!words) return k;
  const short: Record<string, string> = { x: 'X', y: 'Y', z: 'Z', w: 'W', h: 'H', hz: 'Hz', ms: 'ms', db: 'dB', uv: 'UV', midi: 'MIDI', osc: 'OSC', lfo: 'LFO', cc: 'CC', fps: 'FPS', bpm: 'BPM' };
  const parts = words.split(' ');
  return parts.map((w, i) => {
    const lw = w.toLowerCase();
    if (short[lw]) return short[lw];
    return i === 0 ? lw.charAt(0).toUpperCase() + lw.slice(1) : lw;
  }).join(' ');
}

/**
 * Same value? Identity first (unchanged parts of an edited record keep theirs), then a
 * bounded structural look, so a spread that rebuilt an equal object isn't a change.
 */
export function same(a: unknown, b: unknown, depth = 6): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return Number.isNaN(a as number) && Number.isNaN(b as number);
  if (depth <= 0) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], (b as unknown[])[i], depth - 1)) return false;
    return true;
  }
  const ka = Object.keys(a as Rec), kb = Object.keys(b as Rec);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!same((a as Rec)[k], (b as Rec)[k], depth - 1)) return false;
  return true;
}
