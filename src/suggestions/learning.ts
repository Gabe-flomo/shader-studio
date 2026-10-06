/**
 * learning.ts — what the suggestions learn from your own graphs (docs/suggestions.md).
 *
 * Four sources, weighted, all local to this browser (localStorage `playfield:suggestions:learning`):
 *
 *  - (a) your saved graphs: weight 1. Learned when you save, and on first use from every graph
 *        already saved here.
 *  - (b) graphs that arrived without you saving them: imported files, converted GLSL, bulk
 *        imports, graphs a workspace folder brought in: weight 0.5.
 *  - (c) wires you make as you work: weight 0.75, halving every week (recency).
 *  - (d) the bundled examples (examplePrior.json): a prior worth PRIOR_MASS wires while you have
 *        nothing of your own, fading as your own data grows: PRIOR_MASS · K / (K + yours).
 *
 * Incremental: a graph is (re)learned only when its saved text changed (its signature), and a
 * graph that is gone is forgotten. Reset learning (App settings, or `resetLearning`) clears all
 * of it; graphs saved before the reset are not read again, so it stays forgotten.
 *
 * Stored compactly: one dictionary of pair strings, each graph a list of indices into it.
 */
import { CoTable, graphPairs, normaliseEnd, pairKey, WILDCARD_TYPES } from './usage';
import priorJson from './examplePrior.json';
import type { PriorTable } from './prior';

export const LEARNING_KEY = 'playfield:suggestions:learning';

export const WEIGHTS = { saved: 1, imported: 0.5, live: 0.75 } as const;
/** Live wires lose half their weight every week. */
export const LIVE_HALF_LIFE_MS = 7 * 24 * 3600 * 1000;
export const MAX_LIVE = 400;
/** The examples count as this many wires while you have none of your own… */
export const PRIOR_MASS = 40;
/** …and fade as yours grow: at K of your own wires the prior is worth half. */
export const PRIOR_K = 40;

export type GraphSource = 'saved' | 'imported';

interface GraphEntry { src: GraphSource; sig: string; at: number; p: number[] }

export interface LearningState {
  v: 1;
  /** Pair strings; graphs and live wires refer to them by index. */
  dict: string[];
  graphs: Record<string, GraphEntry>;
  /** [pair index, time] per wire you made, newest last. */
  live: Array<[number, number]>;
  /** Saved graphs have been read once (seeding). */
  seeded: boolean;
  /** When learning was last reset: graphs saved before it aren't read again. */
  resetAt: number;
}

const empty = (): LearningState => ({ v: 1, dict: [], graphs: {}, live: [], seeded: false, resetAt: 0 });

// ── Storage (overridable for tests) ─────────────────────────────────────────

export interface KV { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void; keys(): string[] }
const browserKV: KV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* full or blocked: learning is a nicety */ } },
  remove: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  keys: () => { try { return Object.keys(localStorage); } catch { return []; } },
};
let kv: KV = browserKV;
let state: LearningState | null = null;
let version = 0;
const listeners = new Set<() => void>();

/** For tests: another key-value store, and a fresh state. */
export function setLearningStorage(next: KV | null): void {
  kv = next ?? browserKV;
  written = false;
  state = null;
  cache = null;
  version++;
}

function load(): LearningState {
  if (state) return state;
  try {
    const raw = JSON.parse(kv.get(LEARNING_KEY) ?? 'null') as LearningState | null;
    state = raw && raw.v === 1 && Array.isArray(raw.dict) ? { ...empty(), ...raw } : empty();
  } catch { state = empty(); }
  return state;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Whether this session has written the store (so its key going missing means a reset). */
let written = false;

/**
 * App settings' Reset removes the key. When it goes missing after this session wrote it (and no
 * write is pending), that is Reset learning: forget, and don't re-read the old saved graphs.
 */
function noticeExternalReset(): void {
  if (!written || saveTimer || !state) return;
  if (kv.get(LEARNING_KEY) === null) { written = false; resetLearning(); }
}
function persist(now = false): void {
  version++;
  cache = null;
  for (const fn of listeners) fn();
  const write = () => { saveTimer = null; if (state) { kv.set(LEARNING_KEY, JSON.stringify(compact(state))); written = true; } };
  if (now || typeof window === 'undefined') { write(); return; }
  if (!saveTimer) saveTimer = setTimeout(write, 400);
}

/** Drop dictionary entries nothing refers to any more (after forgetting graphs). */
function compact(s: LearningState): LearningState {
  const used = new Set<number>();
  for (const g of Object.values(s.graphs)) for (const i of g.p) used.add(i);
  for (const [i] of s.live) used.add(i);
  if (used.size === s.dict.length) return s;
  const remap = new Map<number, number>();
  const dict: string[] = [];
  s.dict.forEach((p, i) => { if (used.has(i)) { remap.set(i, dict.length); dict.push(p); } });
  // In place: callers may hold the state object.
  for (const g of Object.values(s.graphs)) g.p = g.p.map(i => remap.get(i)!);
  s.live = s.live.map(([i, t]) => [remap.get(i)!, t] as [number, number]);
  s.dict = dict;
  dictIndex = null;
  return s;
}

function indexOf(s: LearningState, pair: string): number {
  // The dictionary is small (hundreds); a lookup map is rebuilt lazily.
  if (!dictIndex || dictIndex.size !== s.dict.length) dictIndex = new Map(s.dict.map((p, i) => [p, i]));
  let i = dictIndex.get(pair);
  if (i === undefined) { i = s.dict.length; s.dict.push(pair); dictIndex.set(pair, i); }
  return i;
}
let dictIndex: Map<string, number> | null = null;

export function subscribeLearning(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export const learningVersion = () => version;

// ── Feeding it ──────────────────────────────────────────────────────────────

/** A signature of a graph's saved text: re-learn only when it changed. */
export function textSignature(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/** Learn (or re-learn) one graph. `id` names it ("my graph", "import:file.json"). */
export function learnGraph(id: string, src: GraphSource, nodes: unknown, sig: string, at = Date.now()): void {
  const s = load();
  const prev = s.graphs[id];
  if (prev && prev.sig === sig && prev.src === src) return;
  dictIndex = null;
  const p = [...graphPairs(nodes)].map(pair => indexOf(s, pair));
  s.graphs[id] = { src, sig, at, p };
  persist();
}

export function forgetGraph(id: string): void {
  const s = load();
  if (!s.graphs[id]) return;
  delete s.graphs[id];
  dictIndex = null;
  persist();
}

/** A wire you just made (from-type.out → to-type.in, ends already normalised or not). */
export function recordWire(pair: string, at = Date.now()): void {
  const s = load();
  s.live.push([indexOf(s, pair), at]);
  if (s.live.length > MAX_LIVE) s.live.splice(0, s.live.length - MAX_LIVE);
  persist();
}

/** A wire you made between two nodes (types and socket keys as on the canvas). */
export function recordWireBetween(fromType: string, outKey: string, toType: string, inKey: string, at = Date.now()): void {
  if (WILDCARD_TYPES.has(fromType) || WILDCARD_TYPES.has(toType)) return;
  const a = normaliseEnd(fromType, outKey, 'out'), b = normaliseEnd(toType, inKey, 'in');
  recordWire(pairKey(a.type, a.key, b.type, b.key), at);
}

/** Forget everything learned; graphs saved before now aren't read again. */
export function resetLearning(at = Date.now()): void {
  state = { ...empty(), seeded: true, resetAt: at };
  dictIndex = null;
  persist(true);
}

/** The saved-graph keys and texts this store can see (`shader-studio:<name>` holding `nodes`). */
function savedGraphTexts(): Array<{ name: string; text: string; savedAt: number }> {
  const out: Array<{ name: string; text: string; savedAt: number }> = [];
  for (const k of kv.keys()) {
    if (!k.startsWith('shader-studio:')) continue;
    if (/^shader-studio:(settings|play|osc|theme|shortcuts|minimap|glsl-editor|session|v:|versions)/.test(k)) continue;
    const text = kv.get(k);
    if (!text || text[0] !== '{' || !text.includes('"nodes"')) continue;
    try {
      const g = JSON.parse(text) as { nodes?: unknown; savedAt?: unknown };
      if (!Array.isArray(g.nodes)) continue;
      out.push({ name: k.slice('shader-studio:'.length), text, savedAt: typeof g.savedAt === 'number' ? g.savedAt : 0 });
    } catch { /* not a graph */ }
  }
  return out;
}

/**
 * Bring the table in line with the saved graphs: new or changed ones are learned (as
 * `imported` when they didn't come through your Save, see `learnSaved`), deleted ones
 * forgotten. Cheap when nothing changed (one hash per graph).
 */
export function reconcileSavedGraphs(): void {
  noticeExternalReset();
  const s = load();
  const seen = new Set<string>();
  let changed = false;
  for (const g of savedGraphTexts()) {
    seen.add(g.name);
    const sig = textSignature(g.text);
    const prev = s.graphs[g.name];
    if (prev && prev.sig === sig) continue;
    // Saved before a reset: stays forgotten.
    if (s.resetAt && g.savedAt && g.savedAt < s.resetAt) continue;
    // Seeding (the first time) reads your saved graphs as yours; later arrivals came from elsewhere.
    const src: GraphSource = !s.seeded ? 'saved' : prev?.src === 'saved' ? 'saved' : 'imported';
    try { learnGraph(g.name, src, (JSON.parse(g.text) as { nodes: unknown }).nodes, sig, g.savedAt || Date.now()); changed = true; } catch { /* skip */ }
  }
  for (const id of Object.keys(s.graphs)) {
    if (id.includes(':')) continue; // imports and conversions keyed "import:…" aren't saved graphs
    if (!seen.has(id)) { delete s.graphs[id]; changed = true; }
  }
  if (!s.seeded) { s.seeded = true; changed = true; }
  if (changed) persist();
}

/** You saved `name`: learn it as yours (call after the save wrote it). */
export function learnSaved(name: string, nodes: unknown, text?: string): void {
  learnGraph(name, 'saved', nodes, text ? textSignature(text) : `t:${Date.now()}`);
}

// ── The combined table ──────────────────────────────────────────────────────

let cache: { table: CoTable; personal: number; priorWeight: number; prior: PriorTable } | null = null;

/** How much the examples count now, given `personal` weighted wires of your own. */
export function priorScale(personal: number): number {
  return PRIOR_MASS * PRIOR_K / (PRIOR_K + Math.max(0, personal));
}

/** The table every suggestion ranks with: your graphs, your wires and the fading prior. */
export function learnedTable(now = Date.now(), prior: PriorTable = priorJson as PriorTable): { table: CoTable; personal: number; priorWeight: number } {
  noticeExternalReset();
  if (cache && cache.prior === prior) return cache;
  const s = load();
  const table = new CoTable();
  let personal = 0;
  for (const g of Object.values(s.graphs)) {
    const w = WEIGHTS[g.src];
    for (const i of g.p) { const pair = s.dict[i]; if (pair) { table.add(pair, w); personal += w; } }
  }
  for (const [i, t] of s.live) {
    const w = WEIGHTS.live * Math.pow(0.5, Math.max(0, now - t) / LIVE_HALF_LIFE_MS);
    const pair = s.dict[i];
    if (pair) { table.add(pair, w); personal += w; }
  }
  const priorTotal = Object.values(prior.pairs).reduce((a, b) => a + b, 0) || 1;
  const scale = priorScale(personal) / priorTotal;
  for (const [pair, w] of Object.entries(prior.pairs)) table.add(pair, w * scale);
  cache = { table, personal, priorWeight: priorScale(personal), prior };
  return cache;
}

/** Only your own data (no prior): for "you often…" reasons. */
export function personalTable(now = Date.now()): CoTable {
  return personalOnly(now);
}
let personalCache: { v: number; table: CoTable } | null = null;
function personalOnly(now: number): CoTable {
  if (personalCache && personalCache.v === version) return personalCache.table;
  const s = load();
  const table = new CoTable();
  for (const g of Object.values(s.graphs)) for (const i of g.p) if (s.dict[i]) table.add(s.dict[i], WEIGHTS[g.src]);
  for (const [i, t] of s.live) if (s.dict[i]) table.add(s.dict[i], WEIGHTS.live * Math.pow(0.5, Math.max(0, now - t) / LIVE_HALF_LIFE_MS));
  personalCache = { v: version, table };
  return table;
}

/** The example-only table (for "common in the examples" reasons). */
let priorCache: CoTable | null = null;
export function priorTable(prior: PriorTable = priorJson as PriorTable): CoTable {
  if (priorCache && prior === priorJson) return priorCache;
  const t = new CoTable();
  for (const [pair, w] of Object.entries(prior.pairs)) t.add(pair, w);
  if (prior === priorJson) priorCache = t;
  return t;
}

/** A summary for the settings line: how many graphs and wires it learned from. */
export function learningSummary(): { saved: number; imported: number; live: number } {
  const s = load();
  const g = Object.values(s.graphs);
  return { saved: g.filter(x => x.src === 'saved').length, imported: g.filter(x => x.src === 'imported').length, live: s.live.length };
}

/**
 * Where a set of pairs was seen together (one pair, or the wires of a chain): how many of your
 * saved graphs and of the imported ones hold every pair, how many times you wired them live
 * (one pair only), and the examples' weight (the smallest of the pairs': an upper bound for a chain).
 */
export function pairSources(pairs: string[], prior: PriorTable = priorJson as PriorTable): { saved: number; imported: number; live: number; examples: number } {
  const s = load();
  const idx = new Map(s.dict.map((p, i) => [p, i]));
  const want = pairs.map(p => idx.get(p));
  let saved = 0, imported = 0, live = 0;
  if (pairs.length && want.every(i => i !== undefined)) {
    for (const g of Object.values(s.graphs)) {
      const has = new Set(g.p);
      if (want.every(i => has.has(i!))) { if (g.src === 'saved') saved++; else imported++; }
    }
    if (want.length === 1) live = s.live.filter(([i]) => i === want[0]).length;
  }
  const examples = pairs.length ? Math.min(...pairs.map(p => prior.pairs[p] ?? 0)) : 0;
  return { saved, imported, live, examples: Math.round(examples * 10) / 10 };
}
