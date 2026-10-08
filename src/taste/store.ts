/**
 * store.ts — where the taste model lives: this browser's local storage, like the rest of your Playfield
 * data (one key, `shader-studio:taste`, carried by profile ZIPs and backups). Nothing leaves the device.
 *
 * The key holds, versioned together (TASTE_VERSION):
 *   - `model`: the local layer, what this install learned (model.ts);
 *   - `prior`: the profile layer, imported from another install (portable.ts), read-only here;
 *   - `dormant`: imported learning about items not on this install yet;
 *   - `log`: the signal log of the local layer (log.ts): each lesson, what it was about, the changes it made;
 *   - `steering`: yours (steering.ts), kept apart from what was learned.
 *
 * The app reads `model` from the store as the learned model: the profile layer plus the local layer
 * (portable.ts `combine`). Lessons are taken on that and written to the local layer only.
 *
 * Version 1 (the model alone) migrates: it becomes the local layer, its weights the log's "carried" part,
 * steering the defaults. Reset can forget what was learned, your steering, or both.
 */
import { create } from 'zustand';
import { emptyModel, TASTE_VERSION, type SignalKind, type TasteModel } from './model';
import { appendLog, emptyLog, migrateLog, parseLog, stageDelta, weightDelta, type SignalLog, type SignalRef } from './log';
import { defaultSteering, effectiveModel, parseSteering, type Steering } from './steering';
import {
  applyImport, combine, emptyDormant, emptyLayer, legacyAsExport, localAfter, makeExport, parseDormant, parseExport, parseLayer, reactivate,
  type Dormant, type Layer, type PresentItem,
} from './portable';

export const TASTE_KEY = 'shader-studio:taste';
const FORMAT = 'playfield-taste';

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const local = (): KV | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

/** What is stored. `model` is the local layer. */
export interface TasteFile { model: TasteModel; log: SignalLog; steering: Steering; prior: Layer; dormant: Dormant }

/** The stored value's text. */
export function serialiseTaste(m: TasteModel, extra: Partial<Omit<TasteFile, 'model'>> = {}): string {
  const { steered: _s, ...model } = m;
  void _s;
  return JSON.stringify({
    format: FORMAT, version: TASTE_VERSION, model, log: extra.log ?? migrateLog(m.w), steering: extra.steering ?? defaultSteering(),
    prior: extra.prior ?? emptyLayer(), dormant: extra.dormant ?? emptyDormant(),
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numbers = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  return out;
};

/** Read the stored value (versions 1 and 2): the layers, the log and steering, or why it can't be read. */
export function parseTaste(text: string): ({ ok: true } & TasteFile & { /** It had steering of its own. */ hasSteering: boolean }) | { ok: false; error: string } {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { ok: false, error: 'This isn’t a taste file (it isn’t JSON).' }; }
  if (!isRecord(v) || v.format !== FORMAT || !isRecord(v.model)) return { ok: false, error: 'This isn’t a Playfield taste file.' };
  const version = Number(v.version);
  if (!(version >= 1)) return { ok: false, error: 'This taste file has no version.' };
  if (version > TASTE_VERSION) return { ok: false, error: `This taste file is from a newer Playfield (version ${version}); update to read it.` };
  const m = v.model;
  const stages: TasteModel['stages'] = {};
  if (isRecord(m.stages)) for (const [st, row] of Object.entries(m.stages)) stages[st] = numbers(row);
  const ratings: TasteModel['ratings'] = {};
  if (isRecord(m.ratings)) for (const [id, r] of Object.entries(m.ratings)) {
    if (isRecord(r) && typeof r.v === 'number' && typeof r.kind === 'string') ratings[id] = { v: Math.max(-1, Math.min(1, r.v)), kind: r.kind as TasteModel['ratings'][string]['kind'], ...(typeof r.label === 'string' ? { label: r.label } : {}), at: Number(r.at) || 0 };
  }
  const model: TasteModel = {
    ...emptyModel(), w: numbers(m.w), n: numbers(m.n), stages, ratings, signals: numbers(m.signals), opens: numbers(m.opens),
    ...(typeof m.embedder === 'string' ? { embedder: m.embedder } : {}),
  };
  // Version 1 had no log: what it learned is carried (traces say "from before the log").
  const log = version >= 2 && isRecord(v.log) ? parseLog(v.log) : migrateLog(model.w);
  const hasSteering = version >= 2 && isRecord(v.steering);
  return { ok: true, model, log, steering: hasSteering ? parseSteering(v.steering) : defaultSteering(), hasSteering, prior: parseLayer(v.prior), dormant: parseDormant(v.dormant) };
}

const blank = (): TasteFile => ({ model: emptyModel(), log: emptyLog(), steering: defaultSteering(), prior: emptyLayer(), dormant: emptyDormant() });

export function loadTasteFile(store: KV | null = local()): TasteFile {
  try {
    const text = store?.getItem(TASTE_KEY);
    if (text) {
      const r = parseTaste(text);
      if (r.ok) return { model: r.model, log: r.log, steering: r.steering, prior: r.prior, dormant: r.dormant };
    }
  } catch { /* unreadable: start again */ }
  return blank();
}

/** The learned model stored (the profile layer plus the local layer). */
export const loadTaste = (store: KV | null = local()): TasteModel => { const f = loadTasteFile(store); return combine(f.prior, f.model); };

export function saveTaste(m: TasteModel, store: KV | null = local(), extra: Partial<Omit<TasteFile, 'model'>> = {}): void {
  try { store?.setItem(TASTE_KEY, serialiseTaste(m, extra)); } catch { /* full or blocked: this session only */ }
}

interface TasteState {
  /** The learned model: profile + local (what everything reads). */
  model: TasteModel;
  /** The local layer: what this install learned. */
  local: TasteModel;
  prior: Layer;
  dormant: Dormant;
  log: SignalLog;
  steering: Steering;
}

const stateOf = (f: TasteFile): TasteState => ({ model: combine(f.prior, f.model), local: f.model, prior: f.prior, dormant: f.dormant, log: f.log, steering: f.steering });

/** The taste state in the app; every change is saved. */
export const useTaste = create<TasteState>(() => stateOf(loadTasteFile()));

const persist = () => { const s = useTaste.getState(); saveTaste(s.local, local(), { log: s.log, steering: s.steering, prior: s.prior, dormant: s.dormant }); };

/** The learned model (profile + local; what the page traces). */
export const tasteModel = (): TasteModel => useTaste.getState().model;
export const tasteSteering = (): Steering => useTaste.getState().steering;

let effCache: { m: TasteModel; s: Steering; out: TasteModel } | null = null;
/** The model the generators use: learned + your steering, times the lean (steering.ts). */
export function steeredModel(m: TasteModel = useTaste.getState().model, s: Steering = useTaste.getState().steering): TasteModel {
  if (effCache && effCache.m === m && effCache.s === s) return effCache.out;
  const out = effectiveModel(m, s);
  effCache = { m, s, out };
  return out;
}

/** What a change was about, for the log. The kind is read from the signal counts when not given. */
export interface LogContext { kind?: SignalKind; ref?: SignalRef }

const KIND_ORDER: SignalKind[] = ['pick', 'kept', 'undone', 'rating', 'favourited', 'edited', 'opened'];

const addInto = (a: Record<string, number>, d: Record<string, number>) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(d)) { const x = (out[k] ?? 0) + v; if (Math.abs(x) < 1e-12) delete out[k]; else out[k] = x; }
  return out;
};

/**
 * Learn: `fn` takes a lesson on the learned model (profile + local); the change goes to the local layer
 * (the profile is never changed) and is logged with `ctx`.
 */
export function updateTaste(fn: (m: TasteModel) => TasteModel, ctx: LogContext = {}, now = Date.now()): TasteModel {
  const st0 = useTaste.getState();
  const before = st0.model;
  const next = fn(before);
  if (next === before) return next;
  const loc = localAfter(st0.prior, st0.local, before, next);
  const delta = weightDelta(st0.local.w, loc.w);
  const sd = stageDelta(st0.local.stages, loc.stages);
  const kind = ctx.kind ?? KIND_ORDER.find(k => (next.signals[k] ?? 0) > (before.signals[k] ?? 0));
  const log = kind && (Object.keys(delta).length || Object.keys(sd).length)
    ? appendLog(st0.log, { at: now, kind, ref: ctx.ref, delta, st: sd })
    // Not a lesson (an open counted, nothing learned), or one with no kind: its change is carried, so traces still add up.
    : Object.keys(delta).length ? { ...st0.log, carried: addInto(st0.log.carried, delta) } : st0.log;
  useTaste.setState({ local: loc, model: combine(st0.prior, loc), log });
  persist();
  return useTaste.getState().model;
}

/** Change your steering (never the learned model). */
export function updateSteering(fn: (s: Steering) => Steering): Steering {
  const next = fn(useTaste.getState().steering);
  useTaste.setState({ steering: next });
  persist();
  return next;
}

/** Reset: what was learned (both layers, dormant learning and the log), your steering, or both. */
export function resetTaste(what: 'learned' | 'steering' | 'both' = 'both'): void {
  const s = useTaste.getState();
  const b = blank();
  const next: TasteFile = what === 'steering'
    ? { model: s.local, log: s.log, steering: b.steering, prior: s.prior, dormant: s.dormant }
    : { ...b, steering: what === 'learned' ? s.steering : b.steering };
  useTaste.setState(stateOf(next));
  if (what === 'both') { try { local()?.removeItem(TASTE_KEY); } catch { /* nothing stored */ } } else persist();
}

/** The export file's text: the portable profile (and, for everything, this install's own items' learning). */
export function exportTaste(kind: 'profile' | 'everything' = 'everything', summary = '', present: readonly PresentItem[] = []): string {
  const s = useTaste.getState();
  return JSON.stringify(makeExport({ prior: s.prior, local: s.local, dormant: s.dormant, log: s.log, steering: s.steering, summary, present }, kind));
}

/**
 * Import a file: replace (its profile becomes the prior; learning here starts afresh on top) or merge (by
 * evidence; learning here stays). Older files (the model alone) import as everything.
 */
export function importTaste(text: string, o: { mode?: 'merge' | 'replace'; present?: readonly PresentItem[]; label?: string } = {}): { ok: true; woke: string[]; kind: 'profile' | 'everything' } | { ok: false; error: string } {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { ok: false, error: 'This isn’t a taste file (it isn’t JSON).' }; }
  let file = parseExport(v);
  if (!file) {
    const r = parseTaste(text);
    if (!r.ok) return r;
    file = legacyAsExport(combine(r.prior, r.model), r.hasSteering ? r.steering : useTaste.getState().steering);
  }
  const s = useTaste.getState();
  const out = applyImport({ prior: s.prior, local: s.local, dormant: s.dormant, log: s.log, steering: s.steering }, file, o.mode ?? 'replace', o.present ?? [], o.label);
  useTaste.setState(stateOf({ model: out.local, prior: out.prior, dormant: out.dormant, log: out.log, steering: out.steering }));
  persist();
  return { ok: true, woke: out.woke, kind: file.kind };
}

/** Wake dormant learning whose items are on this install now. Returns the items that woke. */
export function wakeDormant(present: readonly PresentItem[]): string[] {
  const s = useTaste.getState();
  if (!Object.keys(s.dormant.w).length && !Object.keys(s.dormant.ratings).length) return [];
  const r = reactivate(s.prior, s.dormant, present);
  if (!r.woke.length) return [];
  useTaste.setState({ prior: r.prior, dormant: r.dormant, model: combine(r.prior, s.local) });
  persist();
  return r.woke;
}

// The model changed in another window of this browser: pick it up.
if (typeof window !== 'undefined') {
  try {
    window.addEventListener('storage', e => { if (e.key === TASTE_KEY) useTaste.setState(stateOf(loadTasteFile())); });
  } catch { /* no window events */ }
}
