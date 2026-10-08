/**
 * inspiredAction.ts — the Do bar's Surprise in the app (lang/inspired, docs/surprise.md "Inspired by").
 *
 * Gathers the source pool (the bundled examples and Convert examples, plus the user's saved graphs, GLSL
 * page shaders and Custom Function presets, read from storage), steers a fresh seed away from the last
 * few rolls, checks each try on the GPU (it compiles, and its frame isn't blank, blown out or flat), and
 * previews candidates in a carousel; the one kept replaces the graph as one undo step. The toast names
 * the sources; each name opens it.
 */
import { create } from 'zustand';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { loadExampleGraphs } from '../../store/exampleIndex';
import { CONVERT_EXAMPLES } from '../../glslToGraph/examples';
import { GLSL_KEY, isGraphEntry } from '../../files/inventory';
import { compileGraph } from '../../compiler/graphCompiler';
import { bestOf, degenerateReason, newSeed, scoreFrames, type Score, type Signature } from '../../lib/surprise';
import { inspire, makePool, remember, steerSeed, type InspPool, type InspireResult, type Inspiration, type RollMemory } from '../../lang/inspired/compose';
import type { InspSource } from '../../lang/inspired/fragments';
import { programFrameStats, programPixels } from '../sceneBuilder/surpriseActions';
import { announceSurprise } from './announce';
import { toast } from '../ui/toastStore';
import { makeRng } from '../../lib/surprise';
import { bans, blendScore, compositionFeatures, isAllowed, learnPair, learnSignal, planBonus, rankWithExploration, sampledScore, steeredBias, tasteWhy, type Features } from '../../taste';
import { steeredModel, tasteModel, tasteSteering, updateTaste, wakeDormant } from '../../taste/store';
import { contentHash, type PresentItem } from '../../taste/portable';
import type { SignalRef } from '../../taste/log';
import { stopWatchingKeep, watchAfterKeep } from '../taste/tasteActions';

const SAVED_PREFIX = 'shader-studio:';
const PRESET_CFP = 'shader-studio:cfp:';
const HISTORY_KEY = 'surprise:inspired:history';

let examples: InspSource[] | null = null;

async function exampleSources(): Promise<InspSource[]> {
  if (examples) return examples;
  const all = await loadExampleGraphs();
  examples = [
    ...Object.entries(all).filter(([k]) => k !== 'blank').map(([k, g]) => ({ id: `example:${k}`, label: g.label || k, kind: 'graph' as const, nodes: g.nodes })),
    ...Object.entries(CONVERT_EXAMPLES).map(([k, c]) => ({ id: `example-convert:${k}`, label: c.label, kind: 'glsl' as const, code: c.code })),
  ];
  return examples;
}

/** The user's own sources, read from storage (cheap; fragments are cached per source). */
export function userSources(store: Pick<Storage, 'length' | 'key' | 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): InspSource[] {
  const out: InspSource[] = [];
  if (!store) return out;
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(SAVED_PREFIX)) continue;
      let v: unknown;
      try { v = JSON.parse(store.getItem(key) ?? 'null'); } catch { continue; }
      if (key === GLSL_KEY && Array.isArray(v)) {
        for (const s of v as Array<Record<string, unknown>>) if (s && typeof s.code === 'string') out.push({ id: `shader:${String(s.id ?? s.name)}`, label: String(s.name ?? 'Shader'), kind: 'glsl', code: s.code });
      } else if (key.startsWith(PRESET_CFP)) {
        const p = v as Record<string, unknown> | null;
        if (p && typeof p.glslFunctions === 'string' && p.glslFunctions.trim()) out.push({ id: `preset:${key}`, label: String(p.label ?? 'Custom function'), kind: 'glsl', code: p.glslFunctions });
      } else if (isGraphEntry(key, v)) {
        const name = key.slice(SAVED_PREFIX.length);
        out.push({ id: `saved:${name}`, label: name, kind: 'graph', nodes: (v as { nodes: GraphNode[] }).nodes });
      }
    }
  } catch { /* storage unavailable: examples only */ }
  return out;
}

export async function currentPool(): Promise<InspPool> {
  const mine = userSources();
  // Imported taste about items that are here now wakes up (docs/taste.md "Portable profiles").
  try { wakeDormant(presentItems(mine)); } catch { /* nothing dormant */ }
  return makePool([...(await exampleSources()), ...mine]);
}

/** Your graphs, shaders and presets as items the taste profile can match (by id, or by content hash). */
export function presentItems(sources: readonly InspSource[] = userSources()): PresentItem[] {
  return sources.map(s => ({ id: s.id, label: s.label, hash: contentHash(s.kind === 'glsl' ? { code: s.code ?? '' } : { nodes: s.nodes ?? [] }) }));
}

function readHistory(): RollMemory[] {
  try { const v = JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeHistory(h: RollMemory[]): void {
  try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch { /* per page */ }
}

/** Why a graph isn't worth showing, read off the GPU (null without WebGL2: no check). */
export function gpuCheck(nodes: GraphNode[]): string | null {
  const r = compileGraph({ nodes });
  if (!r.success) return (r.errors ?? ['did not compile']).join('; ');
  // Two moments: a picture that's blank at one and alive at the other is fine.
  const reasons: string[] = [];
  for (const t of [0.7, 2.3]) {
    const s = programFrameStats(r.vertexShader, r.fragmentShader, r.paramUniforms, t);
    if (!s) return null;
    const why = degenerateReason(s);
    if (!why) return null;
    reasons.push(why);
  }
  return reasons[0];
}

/** Open the source a piece came from. */
async function openInspiration(i: Inspiration): Promise<void> {
  const jr = await import('../../codeExplorer/jumpRun');
  if (i.id.startsWith('example:')) return jr.openGraphSelecting({ kind: 'example', key: i.id.slice('example:'.length) }, i.at);
  if (i.id.startsWith('saved:')) return jr.openGraphSelecting({ kind: 'saved', name: i.id.slice('saved:'.length) }, i.at);
  const sourceKind = i.id.startsWith('shader:') ? 'shader' : i.id.startsWith('preset:') ? 'preset' : 'import';
  return jr.jumpToSource({ sourceKind, origin: i.id.startsWith('example') ? 'example' : 'saved', docId: i.id, docLabel: i.label, field: 'code', line: i.line ?? 1, column: 1 });
}

// ── The carousel ─────────────────────────────────────────────────────────────
//
// A roll shows its first candidate at once (a full replacement of the graph, previewed without an undo
// step) and makes two more in the background; ‹ › step between them, past the end makes another. Keep,
// Enter or closing the bar commits the one on screen as one undo step; Escape or Undo puts the original
// graph back. Deep makes many candidates, draws each small at two moments, scores them (lib/surprise
// score.ts) and keeps the best few, best first.

export interface Candidate { res: InspireResult; score?: Score; /** Why-chips from the taste model ("your: exp falloff"). */ taste?: string[] }

/** What the taste model sees of a candidate (with Deep's metrics when it was drawn). */
export const candidateFeatures = (c: Candidate): Features => compositionFeatures(c.res, c.score ? { metrics: c.score.metrics, signature: c.score.signature } : {});

/** The candidates looked at in this carousel (for "kept over the ones looked at"). */
const viewed = new Set<Candidate>();

interface CarouselState {
  open: boolean;
  items: Candidate[];
  index: number;
  /** Making candidates in the background. */
  generating: boolean;
  /** Deep: how far along. */
  progress: { done: number; total: number } | null;
  deep: boolean;
  original: GraphNode[] | null;
}

const DEEP_KEY = 'surprise:deep';
const readDeep = () => { try { return localStorage.getItem(DEEP_KEY) === '1'; } catch { return false; } };

export const useSurpriseCarousel = create<CarouselState>(() => ({ open: false, items: [], index: 0, generating: false, progress: null, deep: readDeep(), original: null }));

export function setDeep(deep: boolean): void {
  useSurpriseCarousel.setState({ deep });
  try { localStorage.setItem(DEEP_KEY, deep ? '1' : '0'); } catch { /* this session only */ }
}

/** The last few kept results' signatures, for novelty. */
const keptSignatures: Signature[] = [];
/** Bumped when a carousel closes, so background work for it stops. */
let generation = 0;

const later = (f: () => void) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(f, { timeout: 120 }); else setTimeout(f, 16);
};

function preview(c: Candidate): void {
  viewed.add(c);
  useNodeGraphStore.setState({ nodes: c.res.nodes, selectedNodeId: null, selectedNodeIds: [] });
  useNodeGraphStore.getState().compile();
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => useNodeGraphStore.getState()._fitViewCallback?.());
}

/** One candidate: steered away from recent rolls and from what's already in the carousel. */
function makeCandidate(pool: InspPool, seed?: number, tries = 10): InspireResult {
  const inCarousel = useSurpriseCarousel.getState().items.map(c => ({ sources: c.res.inspirations.map(i => i.id), families: c.res.families }));
  const history = [...readHistory(), ...inCarousel];
  // Taste leans on the plan and, three times in four, on which fresh seed is used (the fourth explores).
  // Learned + your steering (src/taste/steering.ts); its bans hold in the plan; its exploration dial sets the share.
  const steering = tasteSteering();
  const model = steeredModel();
  const bias = steeredBias(tasteModel(), steering);
  const fresh = () => steerSeed(pool, Array.from({ length: 6 }, () => newSeed()), history, { bias, bonus: Math.random() < steering.explore ? undefined : planBonus(model) });
  return inspire({ pool, seed: seed ?? fresh(), tries, check: gpuCheck, bias, ...(seed == null ? { seedFor: () => fresh() } : {}), nextId: () => useNodeGraphStore.getState().newNodeId() });
}

/** Draw a candidate small at two moments and score it (null without WebGL2). */
function scoreCandidate(res: InspireResult): Score | undefined {
  const r = compileGraph({ nodes: res.nodes });
  if (!r.success) return undefined;
  const px = programPixels(r.vertexShader, r.fragmentShader, r.paramUniforms, [0.7, 2.3], 64, 40);
  if (!px || px === 'error') return undefined;
  return scoreFrames(px.map(rgba => ({ rgba, w: 64, h: 40 })), keptSignatures);
}

let poolPromise: Promise<InspPool> | null = null;
export const poolNow = () => (poolPromise ??= currentPool().finally(() => { poolPromise = null; }));

/** Roll: open the carousel (or add to it) with a new candidate, and more in the background. */
export async function startSurprise(o: { seed?: number; deep?: boolean } = {}): Promise<void> {
  const deep = o.deep ?? useSurpriseCarousel.getState().deep;
  const pool = await poolNow();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const cur = useSurpriseCarousel.getState();
  if (!cur.open) {
    generation++;
    useSurpriseCarousel.setState({ open: true, items: [], index: 0, original: useNodeGraphStore.getState().nodes, progress: null, generating: false });
  }
  const gen = generation;
  if (deep && o.seed == null) { runDeep(pool, gen); return; }
  try {
    const c: Candidate = { res: makeCandidate(pool, o.seed) };
    const items = [...useSurpriseCarousel.getState().items, c];
    useSurpriseCarousel.setState({ items, index: items.length - 1 });
    preview(c);
  } catch (e) {
    console.error('[surprise]', e);
    toast.error('Surprise didn’t work', { details: e instanceof Error ? e.message : String(e) });
    return;
  }
  // Two more, made while you look at the first.
  if (useSurpriseCarousel.getState().items.length < 3) fillTo(pool, gen, 3);
}

function fillTo(pool: InspPool, gen: number, n: number): void {
  useSurpriseCarousel.setState({ generating: true });
  const step = () => {
    if (gen !== generation || !useSurpriseCarousel.getState().open) return;
    if (useSurpriseCarousel.getState().items.length >= n) { useSurpriseCarousel.setState({ generating: false }); return; }
    try {
      const c: Candidate = { res: makeCandidate(pool) };
      if (gen !== generation) return;
      useSurpriseCarousel.setState(s => ({ items: [...s.items, c] }));
    } catch (e) { console.warn('[surprise] background candidate', e); useSurpriseCarousel.setState({ generating: false }); return; }
    later(step);
  };
  later(step);
}

/** Deep: up to 16 candidates in at most 6 seconds, each drawn and scored; the best five go into the carousel. */
function runDeep(pool: InspPool, gen: number, total = 16, budgetMs = 6000): void {
  const t0 = Date.now();
  const scored: Candidate[] = [];
  useSurpriseCarousel.setState({ generating: true, progress: { done: 0, total } });
  const finish = () => {
    if (gen !== generation) return;
    // Banned features (your steering) never make the cut, when anything else is left.
    const banned = bans(tasteSteering());
    const scoredOk = scored.filter((c): c is Candidate & { score: Score } => !!c.score);
    const allowed = scoredOk.filter(c => isAllowed(candidateFeatures(c), banned));
    const withScore = allowed.length ? allowed : scoredOk;
    // Deep's score blended with taste (learned + steering), ranked with your exploration share (src/taste), the best five kept.
    const model = steeredModel();
    const rng = makeRng(newSeed());
    const ranked = rankWithExploration(bestOf(withScore, withScore.length), (c, r) => blendScore(c.score.score, sampledScore(model, candidateFeatures(c), r), model), rng, tasteSteering().explore)
      .map(x => ({ ...x.item, taste: x.explored ? ['exploring'] : tasteWhy(model, candidateFeatures(x.item)) }));
    const best = withScore.length ? ranked.slice(0, 5) : scored.slice(0, 3);
    const items = [...useSurpriseCarousel.getState().items, ...best];
    useSurpriseCarousel.setState({ items, index: Math.max(0, items.length - best.length), generating: false, progress: null });
    if (items.length) preview(items[useSurpriseCarousel.getState().index]);
    else cancelSurprise();
  };
  const step = () => {
    if (gen !== generation || !useSurpriseCarousel.getState().open) return;
    if (scored.length >= total || Date.now() - t0 > budgetMs) { finish(); return; }
    try {
      const res = makeCandidate(pool, undefined, 4);
      if (!res.fallback) scored.push({ res, score: scoreCandidate(res) });
    } catch (e) { console.warn('[surprise] deep candidate', e); }
    useSurpriseCarousel.setState({ progress: { done: Math.min(total, scored.length), total } });
    later(step);
  };
  later(step);
}

/** ‹ or ›: the candidate before or after; past the end makes another. */
export async function stepSurprise(dir: -1 | 1): Promise<void> {
  const s = useSurpriseCarousel.getState();
  if (!s.open) return;
  const next = s.index + dir;
  if (next < 0) return;
  if (next < s.items.length) { useSurpriseCarousel.setState({ index: next }); preview(s.items[next]); return; }
  const gen = generation;
  const pool = await poolNow();
  if (gen !== generation) return;
  const c: Candidate = { res: makeCandidate(pool) };
  const items = [...useSurpriseCarousel.getState().items, c];
  useSurpriseCarousel.setState({ items, index: items.length - 1 });
  preview(c);
}

function close(): void {
  generation++;
  viewed.clear();
  useSurpriseCarousel.setState({ open: false, items: [], index: 0, original: null, generating: false, progress: null });
}

/** Escape or Undo: the original graph back, nothing committed. */
export function cancelSurprise(): void {
  const s = useSurpriseCarousel.getState();
  if (!s.open) return;
  // Undone: the one on screen wasn't wanted (a light lesson).
  const shown = s.items[s.index];
  if (shown && !shown.res.fallback) updateTaste(m => learnSignal(m, 'undone', candidateFeatures(shown)), { ref: surpriseRef(shown.res) });
  if (s.original) { useNodeGraphStore.setState({ nodes: s.original }); useNodeGraphStore.getState().compile(); }
  close();
}

/** Keep (Enter, or closing the bar): the candidate on screen, as one undo step back to the original. */
export function keepSurprise(): InspireResult | null {
  const s = useSurpriseCarousel.getState();
  if (!s.open) return null;
  const c = s.items[s.index];
  if (!c || !s.original) { cancelSurprise(); return null; }
  // What's on screen (with any change made while looking), committed over the original.
  const shown = useNodeGraphStore.getState().nodes;
  useNodeGraphStore.setState({ nodes: s.original });
  useNodeGraphStore.getState().setNodesRewritten(shown, `Surprise · seed ${c.res.seed}`);
  // Kept: it wins (lightly) over the others looked at, and counts as kept.
  const others = [...viewed].filter(v => v !== c && !v.res.fallback);
  const kf = candidateFeatures(c);
  if (!c.res.fallback) updateTaste(m => others.reduce((acc, o) => learnPair(acc, kf, candidateFeatures(o), 0.3, null), learnSignal(m, 'kept', kf)), { kind: 'kept', ref: surpriseRef(c.res, others.length) });
  const original = s.original;
  close();
  const res = c.res;
  if (!res.fallback) writeHistory(remember(readHistory(), res));
  const sig = c.score?.signature ?? scoreCandidate(res)?.signature;
  if (sig) { keptSignatures.push(sig); if (keptSignatures.length > 5) keptSignatures.shift(); }
  const after = useNodeGraphStore.getState().nodes;
  if (!res.fallback) watchAfterKeep(original, after, kf, surpriseRef(res));
  const skipped = res.rejected.length ? ` Skipped ${res.rejected.length} ${res.rejected.length === 1 ? 'try' : 'tries'}.` : '';
  announceSurprise({
    title: 'Surprise', seed: res.seed,
    links: res.inspirations.length ? { lead: 'Inspired by', items: res.inspirations.map(i => ({ label: i.label, onClick: () => { void openInspiration(i); } })) } : undefined,
    message: res.fallback
      ? `Nothing inspired compiled, so this is a random line: ${res.line ?? ''}.${skipped}`
      : `${res.stages.map(x => x.what).join(' → ')}.${skipped} Type “surprise me seed=${res.seed}” to make it again.`,
    stillCurrent: () => useNodeGraphStore.getState().nodes === after,
    undo: () => { stopWatchingKeep(); if (!res.fallback) updateTaste(m => learnSignal(m, 'undone', kf), { kind: 'undone', ref: surpriseRef(res) }); useNodeGraphStore.getState().undo(); },
    reroll: () => { stopWatchingKeep(); useNodeGraphStore.getState().undo(); void startSurprise({ deep: false }).then(() => keepSurprise()); },
  });
  return res;
}

/** What the log keeps of a surprise: its seed, what it was, and how many others were looked at. */
function surpriseRef(res: InspireResult, over = 0): SignalRef {
  const what = res.stages.map(x => x.what).join(' → ');
  return { via: useSurpriseCarousel.getState().deep ? 'deep' : 'surprise', seed: res.seed, label: `${what || 'Surprise'}${over ? ` (over ${over} looked at)` : ''}` };
}

/** Open a candidate's source. */
export function openSource(i: Inspiration): void { void openInspiration(i); }

/** Surprise and keep it at once (one undo step): a seed given makes that one exactly. */
export async function inspiredSurprise(o: { seed?: number } = {}): Promise<InspireResult | null> {
  await startSurprise({ seed: o.seed, deep: false });
  return keepSurprise();
}
