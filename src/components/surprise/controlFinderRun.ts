/**
 * controlFinderRun.ts — runs Suggest controls (nodes/controlFinder.ts does the maths) on the open
 * graph. Like Randomize's Focus (focusWeights.ts) it draws the graph small, 64 × 64, on a WebGL2
 * canvas of its own, so the preview's frame loop is never touched; one shader compile carries every
 * setting that is a live uniform (the only kind Play can control), in chunks with a pause between
 * so the page stays responsive and shows progress. Cached per graph version.
 */
import { create } from 'zustand';
import { compileGraph } from '../../compiler/graphCompiler';
import { programFrames } from '../sceneBuilder/surpriseActions';
import { imageModelReady, embedImage } from '../../imageModel/client';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { collectPlayCandidates } from '../../play/playControls';
import { bindingKeyOf } from '../../lib/playEngine';
import { getRandomizeOptions } from '../../nodes/randomizeOptions';
import { controlItems, findControls, FRACS, type ControlItem, type FinderResult, type SampleFrame } from '../../nodes/controlFinder';
import { hashText } from './focusWeights';

const SIDE = 64;
const TIME = 1.7;
const LATER = 2.7;
const BUDGET_MS = 2500;
const CACHE_MAX = 4;
const cache = new Map<string, FinderResult>();

export type FinderStatus = 'idle' | 'running' | 'done' | 'cannot' | 'nothing';

export interface FinderState {
  status: FinderStatus;
  done: number;
  total: number;
  result: FinderResult | null;
  /** Free settings left out for being on Play already. */
  onPlay: number;
}

export const useControlFinder = create<FinderState>(() => ({ status: 'idle', done: 0, total: 0, result: null, onPlay: 0 }));

let runId = 0;

/**
 * Find the controls that matter in the open graph (the whole graph: Play's settings are the root
 * level's, and one group in). Resolves when finished; progress and the result are in useControlFinder.
 */
export async function runControlFinder(force = false): Promise<void> {
  const my = ++runId;
  const set = (p: Partial<FinderState>) => { if (my === runId) useControlFinder.setState(p); };
  const st = useNodeGraphStore.getState();
  const nodes = st.nodes;
  set({ status: 'running', done: 0, total: 0, result: null, onPlay: 0 });
  await new Promise(r => setTimeout(r, 0)); // let the panel show before the first compile
  if (typeof document === 'undefined') return set({ status: 'cannot' });
  const base = compileGraph({ nodes });
  if (!base.success) return set({ status: 'cannot' });
  const bindings = base.paramBindings ?? {};
  const candidates = collectPlayCandidates(nodes, bindings);
  const taken = new Set(st.play.controls.map(c => c.target));
  const opts = getRandomizeOptions();
  const { items, onPlay } = controlItems(nodes, opts, candidates, taken);
  if (!items.length) return set({ status: 'nothing', onPlay });

  const model = imageModelReady();
  const sig = `${hashText(JSON.stringify(nodes))}:${hashText([...taken].sort().join('|'))}:${opts.groupFace ? 'f' : ''}${opts.insideGroups ? 'i' : ''}:${items.length}:${model ? 'm' : 'p'}`;
  if (!force && cache.has(sig)) {
    const hit = cache.get(sig)!;
    cache.delete(sig); cache.set(sig, hit);
    return set({ status: hit.suggestions.length ? 'done' : 'nothing', result: hit, total: items.length, done: items.length, onPlay });
  }

  const uniformOf = (it: ControlItem) => bindings[bindingKeyOf(it.target)];
  const frames = new Map<string, SampleFrame>();
  const key = (target: string | null, value: number | undefined, later: boolean) => `${target ?? ''}|${value ?? ''}|${later ? 1 : 0}`;
  const wrap = (a: Uint8Array): SampleFrame => ({ rgba: a, w: SIDE, h: SIDE });
  const draw = (jobs: Array<{ uniforms: Record<string, number | number[]>; t: number }>) => {
    const px = programFrames(base.vertexShader, base.fragmentShader, jobs, SIDE, SIDE);
    return !px || px === 'error' ? null : px;
  };
  const baseFrames = draw([{ uniforms: base.paramUniforms, t: TIME }, { uniforms: base.paramUniforms, t: LATER }]);
  if (!baseFrames) return set({ status: 'cannot' });
  frames.set(key(null, undefined, false), wrap(baseFrames[0]));
  frames.set(key(null, undefined, true), wrap(baseFrames[1]));

  const valueAt = (it: ControlItem, i: number) => it.lo + (it.hi - it.lo) * FRACS[i];
  try {
    const result = await findControls(items, {
      render: (item, value, later = false) => frames.get(key(item?.target ?? null, value, later)) ?? null,
      prefetch: async (chunk, animated) => {
        const jobs: Array<{ uniforms: Record<string, number | number[]>; t: number }> = [];
        const names: string[] = [];
        for (const it of chunk) {
          const u = uniformOf(it);
          if (!u) continue;
          for (const later of animated ? [false, true] : [false]) {
            FRACS.forEach((_, i) => {
              const v = valueAt(it, i);
              jobs.push({ uniforms: { ...base.paramUniforms, [u]: v }, t: later ? LATER : TIME });
              names.push(key(it.target, v, later));
            });
          }
        }
        const px = jobs.length ? draw(jobs) : null;
        px?.forEach((a, i) => frames.set(names[i], wrap(a)));
      },
      embed: model ? async f => embedImage(f as SampleFrame & { w: number; h: number }) : undefined,
      budgetMs: BUDGET_MS,
      onProgress: (done, total) => set({ done, total }),
    });
    if (!result) return set({ status: 'cannot' });
    cache.set(sig, result);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    set({ status: result.suggestions.length ? 'done' : 'nothing', result, onPlay, done: result.measured, total: items.length });
  } catch {
    set({ status: 'cannot' });
  }
}
