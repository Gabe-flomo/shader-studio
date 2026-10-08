/**
 * portable.ts — a taste profile that travels (docs/taste.md "Portable profiles"). Pure.
 *
 * Features come in two kinds:
 *   - portable: they mean the same on every install. Technique and family ids (the patterns catalogue),
 *     stage choices named by technique or node type, palette traits, settings-range buckets by setting
 *     name, code yes/no, image-look metrics (img:, look:), the image embedding (emb:), node-type buckets
 *     (nh: — a fixed FNV hash of the node type's name, the same in every version) and example sources
 *     (`src:example:<key>`: the example key is the same everywhere).
 *   - local: install-specific. Sources that are your own graphs, shaders and presets (`src:saved:…`,
 *     `src:shader:…`, `src:preset:…`), stage choices named after your own GLSL functions, and item
 *     ratings by id.
 *
 * The learned model is layered: score = profile + local + steering.
 *   - The profile layer (`Layer`) is what was imported: read-only here; Import loads it as a prior.
 *   - The local layer (store.ts `local`, a TasteModel) is what this install learned, on top of the prior.
 *     Learning predicts with both layers and writes the change to the local layer only, so the prior is
 *     never corrupted and the local layer's trace stays exact (log.ts).
 *   - Dormant: imported local features whose item isn't here. Kept, shown "not on this install", and
 *     moved into the profile layer when the item appears (same id, or the same content hash).
 *
 * Export folds this install's portable learning into the profile (profile + local, additively: they're
 * additive layers). Import replaces the profile, or merges it, weighted by evidence:
 *     w = (w₁·n₁ + w₂·n₂) / (n₁ + n₂),  n = n₁ + n₂.
 *
 * The look (look.ts): each layer carries its liked / disliked look centroids (projected image embeddings,
 * never pictures). They're portable; layers add up weighted by evidence, like the weights.
 *
 * Accounts are licence-only today, so a file is the transport. `TasteFileV2` is the seam for syncing a
 * profile later: the same object, sent somewhere else.
 */
import { TECHNIQUE_BY_ID } from '../patterns/catalogue';
import { emptyModel, type Rating, type SignalKind, type TasteModel } from './model';
import type { LogEntry, SignalLog } from './log';
import { parseSteering, type Steering } from './steering';
import { addLook, emptyLook, isEmptyLook, lookForFile, parseLook, type LookState } from './look';

/** A learned layer: weights, evidence, the stage table, signal counts and ratings. */
export interface Layer {
  w: Record<string, number>;
  n: Record<string, number>;
  stages: Record<string, Record<string, number>>;
  signals: Partial<Record<SignalKind, number>>;
  ratings: Record<string, Rating>;
  /** Where it came from: a file's name, when, and its summary. */
  from?: { label: string; at: number; summary?: string };
  /** The imported signal log (refs to items not here are marked foreign). For reading only. */
  log?: LogEntry[];
  /** Liked / disliked look centroids (projected image embeddings, look.ts), when the image model was on. */
  look?: LookState;
}

export interface Dormant {
  w: Record<string, number>;
  n: Record<string, number>;
  ratings: Record<string, Rating>;
  /** Item id → its content hash and name on the install it came from. */
  items: Record<string, { hash?: string; label?: string }>;
}

export const emptyLayer = (): Layer => ({ w: {}, n: {}, stages: {}, signals: {}, ratings: {} });
export const emptyDormant = (): Dormant => ({ w: {}, n: {}, ratings: {}, items: {} });
export const isEmptyLayer = (l: Layer) => !Object.keys(l.w).length && !Object.keys(l.stages).length && !Object.keys(l.ratings).length && isEmptyLook(l.look);

const CODE_CHOICES = new Set(['Expression Block', 'Custom Function']);
let TECH_NAMES: Set<string> | null = null;
const techNames = () => (TECH_NAMES ??= new Set([...TECHNIQUE_BY_ID.values()].map(t => t.name)));

/** The item id inside a src: feature, or a rating id. */
export const itemOfSource = (key: string) => (key.startsWith('src:') ? key.slice(4) : null);
/** Whether an item id means the same thing on every install (an example). */
export const isPortableItem = (id: string) => id.startsWith('example:') || id.startsWith('example-convert:') || id.startsWith('technique:') || id.startsWith('palette:') || id.startsWith('node:');

/** Whether a feature means the same on every install. */
export function isPortable(key: string): boolean {
  const p = key.split(':')[0];
  if (p === 'src') return isPortableItem(key.slice(4));
  if (p === 'st') { const choice = key.slice(3).split('=')[1] ?? ''; return techNames().has(choice) || CODE_CHOICES.has(choice); }
  return ['tech', 'fam', 'pal', 'set', 'code', 'img', 'look', 'emb', 'nh', '_bias'].includes(p);
}

const sumInto = (a: Record<string, number>, b: Record<string, number>, k = 1) => {
  const out = { ...a };
  for (const [key, v] of Object.entries(b)) { const x = (out[key] ?? 0) + k * v; if (Math.abs(x) < 1e-12) delete out[key]; else out[key] = x; }
  return out;
};
const sumStages = (a: Layer['stages'], b: Layer['stages'], k = 1) => {
  const out: Layer['stages'] = {};
  for (const st of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const row = sumInto(a[st] ?? {}, b[st] ?? {}, k);
    for (const c of Object.keys(row)) if (row[c] <= 1e-9) delete row[c];
    if (Object.keys(row).length) out[st] = row;
  }
  return out;
};
const sumSignals = (a: Layer['signals'], b: Layer['signals'], k = 1) => sumInto(a as Record<string, number>, b as Record<string, number>, k) as Layer['signals'];

/** The learned model: the profile layer plus the local layer (ratings: local wins; a local 0 clears an imported one). */
export function combine(prior: Layer, local: TasteModel): TasteModel {
  if (isEmptyLayer(prior) && !Object.keys(prior.signals).length) return local;
  const ratings: TasteModel['ratings'] = {};
  for (const [id, r] of Object.entries({ ...prior.ratings, ...local.ratings })) if (r.v) ratings[id] = r;
  const look = addLook(prior.look, local.look);
  return {
    ...local,
    w: sumInto(prior.w, local.w), n: sumInto(prior.n, local.n), stages: sumStages(prior.stages, local.stages),
    signals: sumSignals(prior.signals, local.signals), ratings, ...(look ? { look, embedder: look.embedder } : {}),
  };
}

/**
 * After a lesson on the combined model (`before` → `after`), the local layer that makes it: the change goes
 * to the local layer, the prior is untouched.
 */
export function localAfter(prior: Layer, local: TasteModel, before: TasteModel, after: TasteModel): TasteModel {
  const dw: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before.w), ...Object.keys(after.w)])) { const d = (after.w[k] ?? 0) - (before.w[k] ?? 0); if (d) dw[k] = d; }
  const dn: Record<string, number> = {};
  for (const k of Object.keys(after.n)) { const d = after.n[k] - (before.n[k] ?? 0); if (d) dn[k] = d; }
  const stages: Layer['stages'] = {};
  // Stage evidence: the local row is what's above the prior's (never below 0 overall; the prior keeps its own).
  for (const st of new Set([...Object.keys(local.stages), ...Object.keys(before.stages), ...Object.keys(after.stages)])) {
    const row: Record<string, number> = { ...(local.stages[st] ?? {}) };
    for (const c of new Set([...Object.keys(before.stages[st] ?? {}), ...Object.keys(after.stages[st] ?? {})])) {
      const d = (after.stages[st]?.[c] ?? 0) - (before.stages[st]?.[c] ?? 0);
      if (d) row[c] = Math.max(-(prior.stages[st]?.[c] ?? 0), (row[c] ?? 0) + d);
    }
    for (const c of Object.keys(row)) if (Math.abs(row[c]) < 1e-9) delete row[c];
    if (Object.keys(row).length) stages[st] = row;
  }
  const signals = sumSignals(local.signals, sumSignals(after.signals, before.signals, -1));
  // Ratings: what differs from the prior's is local; an imported rating cleared here is a local 0.
  const ratings: TasteModel['ratings'] = {};
  for (const [id, r] of Object.entries(after.ratings)) if (prior.ratings[id]?.v !== r.v || prior.ratings[id]?.at !== r.at) ratings[id] = r;
  for (const [id, r] of Object.entries(prior.ratings)) if (r.v && !after.ratings[id]) ratings[id] = { ...r, v: 0, at: Date.now() };
  // The look: this lesson's change (after − before) on top of the local layer's.
  const look = after.look === before.look ? local.look
    : !before.look || before.look.embedder !== after.look?.embedder ? after.look
    : addLook(local.look ?? emptyLook(before.look.embedder, before.look.dims), lookChange(before.look, after.look));
  return { ...after, w: sumInto(local.w, dw), n: sumInto(local.n, dn), stages, signals, ratings, opens: after.opens, look };
}

/** What a lesson added to a look (after − before, as a look of its own: the added evidence and its means). */
function lookChange(before: LookState, after: LookState): LookState {
  const part = (a: number[], wa: number, b: number[], wb: number) => {
    const w = wb - wa;
    return { v: w > 1e-12 ? b.map((x, i) => (x * wb - a[i] * wa) / w) : b.map(() => 0), w: Math.max(0, w) };
  };
  const L = part(before.like, before.likeW, after.like, after.likeW), D = part(before.dislike, before.dislikeW, after.dislike, after.dislikeW), S = part(before.seen, before.seenW, after.seen, after.seenW);
  return { embedder: after.embedder, dims: after.dims, like: L.v, likeW: L.w, dislike: D.v, dislikeW: D.w, seen: S.v, seenW: S.w };
}

/** The portable part of a model, as a layer (what travels). */
export function portablePart(m: Pick<TasteModel, 'w' | 'n' | 'stages' | 'signals' | 'ratings' | 'look'>): Layer {
  const pick = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).filter(([k]) => isPortable(k)));
  const stages: Layer['stages'] = {};
  for (const [st, row] of Object.entries(m.stages)) {
    const kept = Object.fromEntries(Object.entries(row).filter(([c]) => isPortable(`st:${st}=${c}`)));
    if (Object.keys(kept).length) stages[st] = kept;
  }
  const ratings = Object.fromEntries(Object.entries(m.ratings).filter(([id, r]) => r.v && isPortableItem(id)));
  return { w: pick(m.w), n: pick(m.n), stages, signals: { ...m.signals }, ratings, ...(isEmptyLook(m.look) ? {} : { look: m.look }) };
}

/** The install-specific part (sources and ratings of your own items). */
export function localPart(m: Pick<TasteModel, 'w' | 'n' | 'ratings'>): Pick<Dormant, 'w' | 'n' | 'ratings'> {
  const pick = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).filter(([k]) => !isPortable(k)));
  return { w: pick(m.w), n: pick(m.n), ratings: Object.fromEntries(Object.entries(m.ratings).filter(([id, r]) => r.v && !isPortableItem(id))) };
}

/** The profile that travels: the imported profile plus this install's portable learning (additive layers). */
export function foldProfile(prior: Layer, local: TasteModel): Layer {
  const p = portablePart(local);
  const pp = portablePart(prior);
  const look = lookForFile(addLook(prior.look, local.look));
  return {
    w: sumInto(pp.w, p.w), n: sumInto(pp.n, p.n), stages: sumStages(pp.stages, p.stages), signals: sumSignals(prior.signals, local.signals),
    ratings: { ...pp.ratings, ...p.ratings }, ...(look ? { look } : {}),
  };
}

/** Merge two profiles, weighted by evidence: w = (w₁n₁ + w₂n₂)/(n₁ + n₂); evidence, stages and counts add. */
export function mergeLayers(a: Layer, b: Layer): Layer {
  const w: Record<string, number> = {}, n: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a.w), ...Object.keys(b.w), ...Object.keys(a.n), ...Object.keys(b.n)])) {
    const na = a.n[k] ?? 0, nb = b.n[k] ?? 0, wa = a.w[k] ?? 0, wb = b.w[k] ?? 0;
    const tot = na + nb;
    const v = tot > 0 ? (wa * na + wb * nb) / tot : (wa + wb) / ((k in a.w ? 1 : 0) + (k in b.w ? 1 : 0) || 1);
    if (Math.abs(v) >= 1e-9) w[k] = v;
    if (tot) n[k] = tot;
  }
  const ratings: Layer['ratings'] = { ...a.ratings };
  for (const [id, r] of Object.entries(b.ratings)) if (!ratings[id] || r.at > ratings[id].at) ratings[id] = r;
  const look = addLook(a.look, b.look);
  return { w, n, stages: sumStages(a.stages, b.stages), signals: sumSignals(a.signals, b.signals), ratings, ...(b.from ?? a.from ? { from: b.from ?? a.from } : {}), ...(look ? { look } : {}) };
}

// ── Dormant items ────────────────────────────────────────────────────────────

/** An item on this install: its id and a content hash (graphs and GLSL), for matching moved or renamed things. */
export interface PresentItem { id: string; hash?: string; label?: string }

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
};
/** A content hash: of a graph's node types and settings (ids and positions don't count), or of GLSL text. */
export function contentHash(x: { nodes?: ReadonlyArray<{ type: string; params?: Record<string, unknown> }>; code?: string }): string {
  if (typeof x.code === 'string') return `g${fnv(x.code.replace(/\s+/g, ' ').trim())}`;
  const parts = (x.nodes ?? []).map(n => `${n.type}:${JSON.stringify(Object.entries(n.params ?? {}).filter(([k]) => !k.startsWith('__')).sort((p, q) => p[0].localeCompare(q[0])))}`).sort();
  return `n${fnv(parts.join('|'))}`;
}

/** The item ids a local part refers to. */
export function itemsOf(part: Pick<Dormant, 'w' | 'ratings'>): string[] {
  const ids = new Set<string>(Object.keys(part.ratings));
  for (const k of Object.keys(part.w)) { const id = itemOfSource(k); if (id) ids.add(id); }
  return [...ids];
}

const renameItem = (part: Pick<Dormant, 'w' | 'n' | 'ratings'>, from: string, to: string, into: Pick<Dormant, 'w' | 'n' | 'ratings'>) => {
  for (const [k, v] of Object.entries(part.w)) if (k === `src:${from}`) into.w[`src:${to}`] = (into.w[`src:${to}`] ?? 0) + v;
  for (const [k, v] of Object.entries(part.n)) if (k === `src:${from}`) into.n[`src:${to}`] = (into.n[`src:${to}`] ?? 0) + v;
  if (part.ratings[from]) into.ratings[to] = part.ratings[from];
};

/**
 * Wake dormant features whose item is here now (by id, else by content hash): they move into the profile
 * layer (renamed to this install's id when matched by hash). The rest stay dormant.
 */
export function reactivate(prior: Layer, dormant: Dormant, present: readonly PresentItem[]): { prior: Layer; dormant: Dormant; woke: string[] } {
  const byId = new Map(present.map(p => [p.id, p]));
  const byHash = new Map(present.filter(p => p.hash).map(p => [p.hash!, p]));
  const woke: string[] = [];
  const add = { w: {} as Record<string, number>, n: {} as Record<string, number>, ratings: {} as Layer['ratings'] };
  const left: Dormant = { w: { ...dormant.w }, n: { ...dormant.n }, ratings: { ...dormant.ratings }, items: { ...dormant.items } };
  for (const id of itemsOf(dormant)) {
    const here = byId.get(id) ?? (dormant.items[id]?.hash ? byHash.get(dormant.items[id].hash!) : undefined);
    if (!here) continue;
    renameItem(dormant, id, here.id, add);
    delete left.w[`src:${id}`]; delete left.n[`src:${id}`]; delete left.ratings[id]; delete left.items[id];
    woke.push(here.id);
  }
  if (!woke.length) return { prior, dormant, woke };
  return { prior: { ...prior, w: sumInto(prior.w, add.w), n: sumInto(prior.n, add.n), ratings: { ...prior.ratings, ...add.ratings } }, dormant: left, woke };
}

/** Add local features to the dormant set (summed when already there). */
export function addDormant(d: Dormant, part: Pick<Dormant, 'w' | 'n' | 'ratings'>, items: Dormant['items'] = {}): Dormant {
  return { w: sumInto(d.w, part.w), n: sumInto(d.n, part.n), ratings: { ...d.ratings, ...part.ratings }, items: { ...d.items, ...items } };
}

// ── The file ─────────────────────────────────────────────────────────────────

export const FILE_FORMAT = 'playfield-taste';
/** The export file's version (the stored key has its own, model.ts TASTE_VERSION). */
export const FILE_VERSION = 3;

/** What a `.playfield-taste` file holds (and what account sync would send later). */
export interface TasteFileV2 {
  format: typeof FILE_FORMAT;
  version: typeof FILE_VERSION;
  /** 'profile': the portable profile and steering; 'everything': also this install's own items' learning and the log with refs. */
  kind: 'profile' | 'everything';
  exportedAt: number;
  /** The summary at export, for reading the file. */
  summary: string;
  profile: Layer;
  steering: Steering;
  /** Install-specific learning, with each item's content hash (everything only). */
  local?: Dormant;
  /** The signal log: portable refs only for a profile; everything keeps item refs. */
  log: LogEntry[];
}

/** Strip a log entry of install-specific refs (a profile export): its own items' ids and names go, seeds stay. */
function stripEntry(e: LogEntry): LogEntry {
  const d = Object.fromEntries(Object.entries(e.d).filter(([k]) => isPortable(k)));
  if (!e.ref) return { ...e, d };
  const { item, label, ...rest } = e.ref;
  const keep = item && isPortableItem(item);
  return { ...e, d, ref: { ...rest, ...(keep ? { item, label } : {}) } };
}

export interface ExportInput { prior: Layer; local: TasteModel; dormant: Dormant; log: SignalLog; steering: Steering; summary: string; present: readonly PresentItem[] }

/** The export file: the profile (folded), steering, a summary and the log; `everything` adds local learning. */
export function makeExport(x: ExportInput, kind: 'profile' | 'everything', now = Date.now()): TasteFileV2 {
  const profile = foldProfile(x.prior, x.local);
  const out: TasteFileV2 = { format: FILE_FORMAT, version: FILE_VERSION, kind, exportedAt: now, summary: x.summary, profile, steering: x.steering, log: x.log.entries.map(stripEntry) };
  if (kind === 'everything') {
    const lp = localPart(x.local);
    const byId = new Map(x.present.map(p => [p.id, p]));
    const items: Dormant['items'] = {};
    for (const id of itemsOf(lp)) { const p = byId.get(id); items[id] = { ...(p?.hash ? { hash: p.hash } : {}), label: p?.label ?? lp.ratings[id]?.label ?? id }; }
    out.local = addDormant(addDormant(emptyDormant(), lp, items), x.dormant, x.dormant.items);
    out.log = x.log.entries;
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numbers = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  return out;
};
const ratingsOf = (v: unknown): Layer['ratings'] => {
  const out: Layer['ratings'] = {};
  if (isRecord(v)) for (const [id, r] of Object.entries(v)) if (isRecord(r) && typeof r.v === 'number' && typeof r.kind === 'string') out[id] = { v: Math.max(-1, Math.min(1, r.v)), kind: r.kind as Rating['kind'], ...(typeof r.label === 'string' ? { label: r.label } : {}), at: Number(r.at) || 0 };
  return out;
};

/** Read a layer (whatever is unreadable is dropped). */
export function parseLayer(v: unknown): Layer {
  if (!isRecord(v)) return emptyLayer();
  const stages: Layer['stages'] = {};
  if (isRecord(v.stages)) for (const [st, row] of Object.entries(v.stages)) stages[st] = numbers(row);
  const from = isRecord(v.from) && typeof v.from.label === 'string' ? { label: v.from.label, at: Number(v.from.at) || 0, ...(typeof v.from.summary === 'string' ? { summary: v.from.summary } : {}) } : undefined;
  const look = parseLook(v.look);
  return { w: numbers(v.w), n: numbers(v.n), stages, signals: numbers(v.signals), ratings: ratingsOf(v.ratings), ...(from ? { from } : {}), ...(Array.isArray(v.log) ? { log: v.log as LogEntry[] } : {}), ...(look ? { look } : {}) };
}

export function parseDormant(v: unknown): Dormant {
  if (!isRecord(v)) return emptyDormant();
  const items: Dormant['items'] = {};
  if (isRecord(v.items)) for (const [id, it] of Object.entries(v.items)) if (isRecord(it)) items[id] = { ...(typeof it.hash === 'string' ? { hash: it.hash } : {}), ...(typeof it.label === 'string' ? { label: it.label } : {}) };
  return { w: numbers(v.w), n: numbers(v.n), ratings: ratingsOf(v.ratings), items };
}

/** Read an export file (version 3); null when it isn't one. */
export function parseExport(v: unknown): Omit<TasteFileV2, 'format' | 'version'> | null {
  if (!isRecord(v) || v.format !== FILE_FORMAT || !isRecord(v.profile)) return null;
  return {
    kind: v.kind === 'everything' ? 'everything' : 'profile', exportedAt: Number(v.exportedAt) || 0, summary: typeof v.summary === 'string' ? v.summary : '',
    profile: parseLayer(v.profile), steering: parseSteering(v.steering), ...(isRecord(v.local) ? { local: parseDormant(v.local) } : {}),
    log: Array.isArray(v.log) ? (v.log as LogEntry[]) : [],
  };
}

export interface ImportState { prior: Layer; local: TasteModel; dormant: Dormant; log: SignalLog; steering: Steering }

/**
 * Bring a file in. Replace: its profile becomes the prior and this install starts learning afresh on top
 * (the local layer and its log empty). Merge: the profile merges into the prior by evidence, and this
 * install's learning stays. Either way, its local learning goes dormant until its items are here (those
 * already here wake at once), its log is kept for reading (refs to items not here marked foreign), and its
 * steering comes too.
 */
export function applyImport(cur: ImportState, file: Omit<TasteFileV2, 'format' | 'version'>, mode: 'merge' | 'replace', present: readonly PresentItem[], label = 'Imported profile', now = Date.now()): ImportState & { woke: string[] } {
  const here = new Set(present.map(p => p.id));
  const foreignLog = file.log.slice(-1000).map(e => (e.ref?.item && !isPortableItem(e.ref.item) && !here.has(e.ref.item) ? { ...e, ref: { ...e.ref, foreign: true } } : e));
  const incoming: Layer = { ...file.profile, from: { label, at: now, summary: file.summary }, log: foreignLog };
  const prior = mode === 'replace' ? incoming : { ...mergeLayers(cur.prior, incoming), log: [...(cur.prior.log ?? []), ...foreignLog].slice(-1000) };
  let dormant = mode === 'replace' ? emptyDormant() : cur.dormant;
  if (file.local) dormant = addDormant(dormant, file.local, file.local.items);
  const r = reactivate(prior, dormant, present);
  const local = mode === 'replace' ? { ...emptyModel(), opens: cur.local.opens } : cur.local;
  const log = mode === 'replace' ? { entries: [], carried: {}, next: cur.log.next, dropped: 0 } : cur.log;
  return { prior: r.prior, local, dormant: r.dormant, log, steering: file.steering, woke: r.woke };
}

/** A version-1/2 export (the model alone) as an export file: its portable part a profile, the rest local. */
export function legacyAsExport(m: TasteModel, steering: Steering): Omit<TasteFileV2, 'format' | 'version'> {
  const lp = localPart(m);
  return { kind: 'everything', exportedAt: 0, summary: '', profile: portablePart(m), steering, local: { ...lp, items: {} }, log: [] };
}
