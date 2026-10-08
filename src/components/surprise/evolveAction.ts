/**
 * evolveAction.ts — Evolve in the Do bar (src/taste/evolve.ts, docs/taste.md): two candidates side by side,
 * pick one, the taste model learns, the next round is Refine (the pick mutated) and Branch (a new graph
 * grown from the pick). Keep commits the one on screen as one undo step (it replaces the graph, like
 * Surprise); Escape puts the original back exactly.
 *
 * Each candidate is drawn small at two moments: the later frame is its thumbnail, both are scored with
 * Deep's metrics (colourful, contrast, detail, motion, symmetry, novelty), which feed the model too.
 */
import { create } from 'zustand';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { newSeed, scoreFrames, type Score } from '../../lib/surprise';
import {
  compositionFeatures, escapeEvolve, keepEvolve, learnedLine, makeEvolveGen, pickEvolve, startEvolve, tasteWhy,
  type EvolveCand, type EvolveGen, type EvolveOptions, type EvolveState, type Features,
} from '../../taste';
import type { SignalRef } from '../../taste/log';
import { steeredModel, tasteModel, tasteSteering, updateTaste, useTaste } from '../../taste/store';
import { programPixels } from '../sceneBuilder/surpriseActions';
import { cancelSurprise, gpuCheck, openSource, poolNow, useSurpriseCarousel } from './inspiredAction';
import { announceSurprise } from './announce';
import { toast } from '../ui/toastStore';

const TW = 192, TH = 120;

export interface EvolveView { thumb: string | null; score: Score | null; why: string[] }

interface EvolveStore {
  open: boolean;
  state: EvolveState | null;
  /** Thumbnails and scores, per candidate (by object). */
  views: Map<EvolveCand, EvolveView>;
  /** The one on the canvas (0 or 1). */
  focus: 0 | 1;
  busy: boolean;
  /** The "learned: …" line. */
  learned: string;
}

export const useEvolve = create<EvolveStore>(() => ({ open: false, state: null, views: new Map(), focus: 0, busy: false, learned: '' }));

let gen: EvolveGen | null = null;
const scores = new WeakMap<EvolveCand, Score>();
const opts: EvolveOptions = {
  check: gpuCheck,
  steering: tasteSteering,
  nextId: () => useNodeGraphStore.getState().newNodeId(),
  features: (c: EvolveCand): Features => {
    const sc = scores.get(c);
    return compositionFeatures(c.comp, sc ? { metrics: sc.metrics, signature: sc.signature } : {});
  },
};

/** Draw a candidate small at two moments: the thumbnail (later frame, top row first) and its Deep score. */
function draw(c: EvolveCand): EvolveView {
  const r = compileGraph({ nodes: c.comp.nodes });
  if (!r.success) return { thumb: null, score: null, why: [] };
  const px = programPixels(r.vertexShader, r.fragmentShader, r.paramUniforms, [0.7, 2.3], TW, TH);
  if (!px || px === 'error') return { thumb: null, score: null, why: [] };
  const score = scoreFrames(px.map(rgba => ({ rgba, w: TW, h: TH })));
  scores.set(c, score);
  let thumb: string | null = null;
  try {
    const cv = document.createElement('canvas');
    cv.width = TW; cv.height = TH;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(TW, TH);
    const src = px[1] ?? px[0];
    // GL rows run bottom-up.
    for (let y = 0; y < TH; y++) img.data.set(src.subarray((TH - 1 - y) * TW * 4, (TH - y) * TW * 4), y * TW * 4);
    ctx.putImageData(img, 0, 0);
    thumb = cv.toDataURL('image/png');
  } catch { /* no 2D canvas */ }
  return { thumb, score, why: [] };
}

function viewsFor(s: EvolveState): Map<EvolveCand, EvolveView> {
  const old = useEvolve.getState().views;
  const m = new Map<EvolveCand, EvolveView>();
  const model = steeredModel();
  for (const c of s.pair) {
    const v = old.get(c) ?? draw(c);
    m.set(c, { ...v, why: [...new Set([...(v.score?.why ?? []).slice(0, 2), ...tasteWhy(model, opts.features!(c), 2)])] });
  }
  return m;
}

function show(nodes: GraphNode[]): void {
  useNodeGraphStore.setState({ nodes, selectedNodeId: null, selectedNodeIds: [] });
  useNodeGraphStore.getState().compile();
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => useNodeGraphStore.getState()._fitViewCallback?.());
}

const later = (f: () => void) => setTimeout(f, 30);

/** Start Evolve: round 1, two fresh candidates (any open Surprise carousel is put back first). */
export async function startEvolveSession(seed = newSeed()): Promise<void> {
  if (useEvolve.getState().open) return;
  if (useSurpriseCarousel.getState().open) cancelSurprise();
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const original = useNodeGraphStore.getState().nodes;
  useEvolve.setState({ open: true, busy: true, state: null, views: new Map(), focus: 0, learned: learnedLine(tasteModel()) });
  const pool = await poolNow();
  gen = makeEvolveGen(pool, opts);
  later(() => {
    try {
      const s = startEvolve(original, seed, gen!, tasteModel());
      useEvolve.setState({ state: s, views: viewsFor(s), busy: false });
      show(s.pair[0].comp.nodes);
    } catch (e) {
      console.error('[evolve]', e);
      toast.error('Evolve didn’t start', { details: e instanceof Error ? e.message : String(e) });
      useEvolve.setState({ open: false, busy: false });
    }
  });
}

/** Show one of the pair on the canvas (hover or ← →). */
export function focusEvolve(which: 0 | 1): void {
  const { state, focus } = useEvolve.getState();
  if (!state || focus === which) return;
  useEvolve.setState({ focus: which });
  show(state.pair[which].comp.nodes);
}

/** Pick one: the model learns, and the next round (Refine, Branch) is made. */
export function pickEvolveCandidate(which: 0 | 1): void {
  const { state, busy } = useEvolve.getState();
  if (!state || busy || !gen) return;
  useEvolve.setState({ busy: true, focus: which });
  show(state.pair[which].comp.nodes);
  later(() => {
    try {
      const r = pickEvolve(state, which, gen!, tasteModel(), opts);
      updateTaste(() => r.model, { kind: 'pick', ref: evolveRef(state, which) });
      useEvolve.setState({ state: r.state, views: viewsFor(r.state), focus: 0, busy: false, learned: learnedLine(r.model) });
      show(r.state.pair[0].comp.nodes);
    } catch (e) {
      console.error('[evolve]', e);
      toast.error('Evolve couldn’t make the next round', { details: e instanceof Error ? e.message : String(e) });
      useEvolve.setState({ busy: false });
    }
  });
}

/** What the log keeps of an Evolve pick: the session's seed, the round and the pair (docs/taste.md). */
function evolveRef(state: EvolveState, which: 0 | 1): SignalRef {
  const c = state.pair[which], o = state.pair[1 - which];
  const what = (x: EvolveCand) => x.comp.stages.map(st => st.what).join(' → ') || x.kind;
  return { via: 'evolve', seed: state.seed, label: `Evolve round ${state.round}`, pair: { round: state.round, chosen: c.id, other: o.id, chosenWhat: what(c), otherWhat: what(o) } };
}

function close(): void {
  gen = null;
  useEvolve.setState({ open: false, state: null, views: new Map(), busy: false, focus: 0 });
}

/** Escape: the original graph back, exactly. */
export function escapeEvolveSession(): void {
  const { state } = useEvolve.getState();
  if (!state) { close(); return; }
  const done = escapeEvolve(state);
  useNodeGraphStore.setState({ nodes: done.result! });
  useNodeGraphStore.getState().compile();
  close();
}

/** Keep the one on screen: one undo step back to the original. */
export function keepEvolveSession(): void {
  const { state, focus } = useEvolve.getState();
  if (!state) { close(); return; }
  const r = keepEvolve(state, focus, tasteModel(), opts);
  updateTaste(() => r.model, { kind: 'kept', ref: evolveRef(state, focus) });
  const c = state.pair[focus];
  useNodeGraphStore.setState({ nodes: state.original });
  useNodeGraphStore.getState().setNodesRewritten(r.state.result!, `Evolve · round ${state.round}`);
  close();
  const after = useNodeGraphStore.getState().nodes;
  announceSurprise({
    title: `Evolved over ${state.round} round${state.round === 1 ? '' : 's'}`, seed: c.seed,
    links: c.comp.inspirations.length ? { lead: 'Inspired by', items: c.comp.inspirations.filter(i => !i.id.startsWith('evolve:')).map(i => ({ label: i.label, onClick: () => openSource(i) })) } : undefined,
    message: `${c.comp.stages.map(x => x.what).join(' → ')}. ${learnedLine(useTaste.getState().model).replace(/^./, ch => ch.toUpperCase())}.`,
    stillCurrent: () => useNodeGraphStore.getState().nodes === after,
    undo: () => useNodeGraphStore.getState().undo(),
    reroll: () => { useNodeGraphStore.getState().undo(); void startEvolveSession(); },
  });
}
