/**
 * focusWeights.ts — draws the graph small, with each setting nudged, for Randomize's Focus
 * (nodes/randomizeFocus.ts does the maths). One shader compile and one WebGL2 context carry every
 * setting that is a live uniform; the few that aren't (compile-time ones) recompile, as far as the
 * time box allows. Cached per graph version; null when nothing can be drawn (a test, no WebGL2, a
 * graph that doesn't compile): the caller then uses even weights.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { programFrames } from '../sceneBuilder/surpriseActions';
import { imageModelReady, embedImage } from '../../imageModel/client';
import { measureSensitivity, setParamAtPath, type FocusItem, type Frame } from '../../nodes/randomizeFocus';
import { useRandomizeProgress, type RandomizeOptions } from '../../nodes/randomizeOptions';

const SIDE = 64;
const TIME = 1.7;
const BUDGET_MS = 1000;
const CACHE_MAX = 6;
const cache = new Map<string, Record<string, number> | null>();

/** A short hash of text (FNV-1a), to name a graph version. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

type Uniforms = Record<string, number | number[]>;
type PixFrame = Frame & { w: number; h: number };

/**
 * Sensitivity (0–1) of each item, measured on the whole graph `full`, or null. `levelPath` is the
 * group path of the level the items were listed on.
 */
export async function focusWeights(full: GraphNode[], levelPath: string[], items: FocusItem[], opts: RandomizeOptions): Promise<Record<string, number> | null> {
  if (!items.length || typeof document === 'undefined') return null;
  const sig = `${hashText(JSON.stringify(full))}:${levelPath.join('/')}:${opts.groupFace ? 'f' : ''}${opts.insideGroups ? 'i' : ''}${opts.includeChoices ? 'c' : ''}${opts.colours ? 'k' : ''}:${items.length}:${imageModelReady() ? 'm' : 'p'}`;
  if (cache.has(sig)) { const hit = cache.get(sig)!; cache.delete(sig); cache.set(sig, hit); return hit; }
  useRandomizeProgress.setState({ busy: true, done: 0, total: items.length });
  try {
    const result = await measure(full, levelPath, items);
    cache.set(sig, result);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return result;
  } catch {
    return null;
  } finally {
    useRandomizeProgress.setState({ busy: false, done: 0, total: 0 });
  }
}

async function measure(full: GraphNode[], levelPath: string[], items: FocusItem[]): Promise<Record<string, number> | null> {
  const t0 = performance.now();
  const base = compileGraph({ nodes: full });
  if (!base.success) return null;
  const bindings = base.paramBindings ?? {};
  // Live-uniform settings first: they all share one compile and one context.
  const uniformOf = (it: FocusItem) => bindings[it.binding];
  const ordered = [...items.filter(uniformOf), ...items.filter(it => !uniformOf(it))];
  const bound = ordered.filter(uniformOf);
  const jobs: Array<{ uniforms: Uniforms; t: number }> = [{ uniforms: base.paramUniforms, t: TIME }];
  for (const it of bound) for (const v of [it.down, it.up]) jobs.push({ uniforms: { ...base.paramUniforms, [uniformOf(it)]: v as number | number[] }, t: TIME });
  const px = programFrames(base.vertexShader, base.fragmentShader, jobs, SIDE, SIDE, () => performance.now() - t0 > BUDGET_MS * 0.7);
  if (!px || px === 'error' || !px.length) return null;
  const pre = new Map<string, PixFrame>();
  const frameOf = (a?: Uint8Array): PixFrame | null => (a ? { rgba: a, w: SIDE, h: SIDE } : null);
  bound.forEach((it, i) => {
    const d = frameOf(px[1 + 2 * i]), u = frameOf(px[2 + 2 * i]);
    if (d && u) { pre.set(`${it.weightKey}:d`, d); pre.set(`${it.weightKey}:u`, u); }
  });
  const render = (item: FocusItem | null, value?: unknown): Frame | null => {
    if (!item) return frameOf(px[0]);
    const which = value === item.down ? 'd' : 'u';
    const hit = pre.get(`${item.weightKey}:${which}`);
    if (hit) return hit;
    if (uniformOf(item)) return null; // drawn out of time
    // Not a live uniform (baked into the GLSL): recompile with the value, as long as the box allows.
    if (performance.now() - t0 > BUDGET_MS) return null;
    const r = compileGraph({ nodes: setParamAtPath(full, [...levelPath, ...item.path].filter(Boolean), item.nodeId, item.key, value) });
    if (!r.success) return null;
    const out = programFrames(r.vertexShader, r.fragmentShader, [{ uniforms: r.paramUniforms, t: TIME }], SIDE, SIDE);
    return !out || out === 'error' ? null : frameOf(out[0]);
  };
  return measureSensitivity(ordered, {
    render,
    embed: imageModelReady() ? async f => embedImage(f as PixFrame) : undefined,
    budgetMs: Math.max(100, BUDGET_MS - (performance.now() - t0)),
    onProgress: (done, total) => useRandomizeProgress.setState({ busy: true, done, total }),
  });
}
