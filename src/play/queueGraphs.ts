/**
 * queueGraphs.ts — a Background layer's graph sources, compiled off-screen.
 *
 * A graph source other than "this graph" is a bundled example (by key) or a
 * copy of a saved graph's nodes. The compiler is pure, so each is compiled
 * here without loading it, once per version of its nodes, into what a second
 * program needs: the fragment shader and its uniforms at the graph's saved
 * values (Play controls and mappings belong to the open graph, not to these).
 * The preview renders it into the background (ShaderCanvas), and web pages and
 * presentations carry it in their bundle (`queueGraphsForWeb`).
 *
 * The examples load on first use (their chunk is big): `compiledQueueGraph`
 * answers 'loading' until then and `onQueueGraphsChange` says when to ask again.
 */
import { compileGraph } from '../compiler/graphCompiler';
import { loadExampleGraphs, type ExampleGraph } from '../store/exampleIndex';
import { migrateLoadedNodes } from '../store/useNodeGraphStore';
import type { GraphNode } from '../types/nodeGraph';
import type { BackgroundItem, PlayRecord } from '../types/play';
import { backgroundLayerOf } from '../types/play';

export interface QueueGraph {
  /** Changes when the source's nodes do (a new program is needed). */
  key: string;
  vertexShader: string;
  fragmentShader: string;
  /** Uniform name → value: the graph's sliders and colours as saved. */
  uniforms: Record<string, number | number[]>;
  /** Things the background pass doesn't run for this graph (feedback, particles…), for the panel. */
  limits: string[];
}
export type QueueGraphResult = QueueGraph | { error: string } | 'loading';

let examples: Record<string, ExampleGraph> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const cache = new Map<string, QueueGraph | { error: string }>();

/** Something that was loading is ready (the examples): ask again. Returns an unsubscribe. */
export function onQueueGraphsChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** Start loading the bundled examples (a setup with an example in its background asks on open). */
export function preloadQueueExamples(): Promise<void> {
  if (examples) return Promise.resolve();
  if (!loading) {
    loading = loadExampleGraphs().then(all => { examples = all; for (const cb of listeners) cb(); }, () => { loading = null; });
  }
  return loading;
}

/** Does this setup's background have example graphs (so their chunk is worth loading now)? */
export function needsExamples(play: PlayRecord): boolean {
  return !!backgroundLayerOf(play)?.sources.some(s => s.kind === 'graph' && s.graph?.startsWith('example:'));
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/** The nodes a graph source compiles from (null: this graph, or an example still loading). */
function nodesOf(item: BackgroundItem): GraphNode[] | null | 'loading' | { error: string } {
  const g = item.graph ?? '';
  if (g === 'this') return null;
  if (g.startsWith('example:')) {
    if (!examples) { void preloadQueueExamples(); return 'loading'; }
    const ex = examples[g.slice(8)];
    return ex ? ex.nodes : { error: `There is no example “${g.slice(8)}” in this version.` };
  }
  if (g.startsWith('saved:') && Array.isArray(item.nodes)) return item.nodes as GraphNode[];
  return { error: 'This source has no graph.' };
}

/** A key for a graph source's program: changes when its nodes change. */
export function queueGraphKey(item: BackgroundItem): string {
  const g = item.graph ?? '';
  return g.startsWith('saved:') ? `${g}#${hash(JSON.stringify(item.nodes ?? []))}` : g;
}

/**
 * A graph source compiled (cached per version of its nodes), 'loading' while
 * its example loads, an error when it doesn't compile, or null for "this
 * graph" (the preview's own program).
 */
export function compiledQueueGraph(item: BackgroundItem): QueueGraphResult | null {
  if (item.kind !== 'graph' || item.graph === 'this') return null;
  const key = queueGraphKey(item);
  const hit = cache.get(key);
  if (hit) return hit;
  const nodes = nodesOf(item);
  if (nodes === null) return null;
  if (nodes === 'loading') return 'loading';
  if ('error' in nodes) return nodes;
  let out: QueueGraph | { error: string };
  try {
    const r = compileGraph({ nodes: migrateLoadedNodes(nodes) });
    if (!r.success || !r.fragmentShader) out = { error: r.errors?.join('; ') || 'The graph did not compile.' };
    else {
      const limits: string[] = [];
      if (r.isStateful) limits.push('feedback (Previous Frame) starts from black each frame');
      if (r.echo && r.echo.copies > 0) limits.push('echo');
      if (Object.keys(r.textureUniforms).length || Object.keys(r.videoUniforms).length) limits.push('its image and video inputs');
      if (Object.keys(r.audioUniforms).length || Object.keys(r.liveUniforms).length) limits.push('its audio and MIDI inputs');
      out = { key, vertexShader: r.vertexShader, fragmentShader: r.fragmentShader, uniforms: { ...r.paramUniforms }, limits };
    }
  } catch (e) { out = { error: e instanceof Error ? e.message : String(e) }; }
  if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  cache.set(key, out);
  return out;
}

/** What a web page runs for a graph source: its shader and uniforms. */
export interface WebQueueGraph { fragmentShader: string; uniforms: Record<string, number | number[]> }

/**
 * The background's graph sources for a web page or a presentation, compiled
 * (by source id), and the names of the ones that couldn't be (still loading,
 * or not compiling). "This graph" is the page's own shader, so it isn't here.
 */
export function queueGraphsForWeb(play: PlayRecord): { graphs: Record<string, WebQueueGraph>; missing: string[] } {
  const graphs: Record<string, WebQueueGraph> = {};
  const missing: string[] = [];
  for (const s of backgroundLayerOf(play)?.sources ?? []) {
    const c = compiledQueueGraph(s);
    if (c === null) continue;
    if (c === 'loading' || 'error' in c) { missing.push(s.name); continue; }
    graphs[s.id] = { fragmentShader: c.fragmentShader, uniforms: c.uniforms };
  }
  return { graphs, missing };
}
