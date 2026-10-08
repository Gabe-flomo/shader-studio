/**
 * inspiredAction.ts — the Do bar's Surprise in the app (lang/inspired, docs/surprise.md "Inspired by").
 *
 * Gathers the source pool (the bundled examples and Convert examples, plus the user's saved graphs, GLSL
 * page shaders and Custom Function presets, read from storage), steers a fresh seed away from the last
 * few rolls, checks each try on the GPU (it compiles, and its frame isn't blank, blown out or flat), and
 * replaces the graph with the result as one undo step. The toast names the sources; each name opens it.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { loadExampleGraphs } from '../../store/exampleIndex';
import { CONVERT_EXAMPLES } from '../../glslToGraph/examples';
import { GLSL_KEY, isGraphEntry } from '../../files/inventory';
import { compileGraph } from '../../compiler/graphCompiler';
import { degenerateReason, newSeed } from '../../lib/surprise';
import { inspire, makePool, remember, steerSeed, type InspPool, type InspireResult, type Inspiration, type RollMemory } from '../../lang/inspired/compose';
import type { InspSource } from '../../lang/inspired/fragments';
import { programFrameStats } from '../sceneBuilder/surpriseActions';
import { announceSurprise } from './announce';
import { toast } from '../ui/toastStore';

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
  return makePool([...(await exampleSources()), ...userSources()]);
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

let busy = false;

/** Surprise: a new graph inspired by 2–3 sources, replacing the graph (one undo step). A seed given makes that one exactly. */
export async function inspiredSurprise(o: { seed?: number } = {}): Promise<InspireResult | null> {
  if (busy) return null;
  busy = true;
  try {
    const pool = await currentPool();
    const history = readHistory();
    const fresh = () => steerSeed(pool, Array.from({ length: 6 }, () => newSeed()), history);
    const seed = o.seed ?? fresh();
    const st = useNodeGraphStore.getState();
    if (st.activeGroupPath.length) st.exitToRoot();
    const res = inspire({ pool, seed, tries: 10, check: gpuCheck, ...(o.seed == null ? { seedFor: () => fresh() } : {}), nextId: () => useNodeGraphStore.getState().newNodeId() });
    useNodeGraphStore.getState().setNodesRewritten(res.nodes, `Surprise · seed ${res.seed}`);
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => useNodeGraphStore.getState()._fitViewCallback?.());
    if (!res.fallback) writeHistory(remember(history, res));
    const after = useNodeGraphStore.getState().nodes;
    const skipped = res.rejected.length ? ` Skipped ${res.rejected.length} ${res.rejected.length === 1 ? 'try' : 'tries'}.` : '';
    announceSurprise({
      title: 'Surprise', seed: res.seed,
      links: res.inspirations.length ? { lead: 'Inspired by', items: res.inspirations.map(i => ({ label: i.label, onClick: () => { void openInspiration(i); } })) } : undefined,
      message: res.fallback
        ? `Nothing inspired compiled, so this is a random line: ${res.line ?? ''}.${skipped}`
        : `${res.stages.map(s => s.what).join(' → ')}.${skipped} Type “surprise me seed=${res.seed}” to make it again.`,
      stillCurrent: () => useNodeGraphStore.getState().nodes === after,
      undo: () => useNodeGraphStore.getState().undo(),
      reroll: () => { useNodeGraphStore.getState().undo(); void inspiredSurprise(); },
    });
    return res;
  } catch (e) {
    console.error('[surprise]', e);
    toast.error('Surprise didn’t work', { details: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    busy = false;
  }
}
