/**
 * snapshot.ts — a Present source: a copy of a Play taken off-screen.
 *
 * A saved graph (or an example) is compiled with the pure compiler, without
 * loading it into the editor, and turned into exactly what the web export
 * would build for it (webInputFrom). The presentation keeps that copy, so a
 * later edit of the graph changes nothing until Refresh takes a new one.
 */
import { compileGraph } from '../compiler/graphCompiler';
import { EXAMPLE_INDEX, loadExampleGraphs } from '../store/exampleIndex';
import { nodeLabelOf } from '../play/paramDrivers';
import { nodeSlicePrefix } from '../components/code/nodeSlice';
import { webInputFrom, type CompiledForWeb } from '../play/webInput';
import { unsupportedFeatures, type GraphFeatures, type PlayMedia } from '../play/exportHtml';
import { migrateLoadedNodes, migrateLoadedPlay, useNodeGraphStore } from '../store/useNodeGraphStore';
import { parsePlayRecord, type PlayRecord } from '../types/play';
import { newId, type PresentSource, type SourceFeatures, type SourceNode, type SourceOrigin } from '../types/presentation';
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import type { PreviewAspect } from '../utils/graphImportPlan';

export type SnapshotResult = { ok: true; source: PresentSource } | { ok: false; error: string };

/** Every node, including those inside groups, by id. */
function allNodes(nodes: GraphNode[], out = new Map<string, GraphNode>()): Map<string, GraphNode> {
  for (const n of nodes) {
    out.set(n.id, n);
    const sg = n.params?.subgraph as SubgraphData | undefined;
    if (sg && Array.isArray(sg.nodes)) allNodes(sg.nodes, out);
  }
  return out;
}

/** The features a source's limits are worked out from. */
export function featuresOf(c: CompiledForWeb): SourceFeatures {
  return {
    textureUniforms: c.textureUniforms, videoUniforms: c.videoUniforms, audioUniforms: c.audioUniforms, liveUniforms: c.liveUniforms,
    isStateful: c.isStateful, particleSystems: c.particleSystems.length, usesEcho: /\bu_echo0\b/.test(c.fragmentShader),
  };
}

/**
 * What the runtime can't run in this source, asked of the runtime's own list
 * each time (so a snapshot taken before the runtime learned something stops
 * being a still once it has).
 */
export function sourceLimits(s: PresentSource): string[] {
  if (!s.features) return s.limits;
  const f = s.features;
  // Everything the snapshot knows, whatever the runtime's list asks about.
  const features = { ...f, particleSystems: new Array(f.particleSystems).fill(null), play: s.bundle.play };
  return unsupportedFeatures(features as GraphFeatures & typeof features);
}

/**
 * Inputs whose files the snapshot doesn't have: images, videos and songs live
 * in the open graph only, so a Play copied without being open in the Studio
 * shows those inputs blank. Open it (with its files loaded) and Refresh.
 */
export function missingMedia(s: PresentSource): string[] {
  const f = s.features;
  if (!f) return [];
  const m = s.bundle.media;
  const out: string[] = [];
  const noImage = Object.keys(f.textureUniforms).filter(u => !m?.textures?.[u]?.src).length;
  const noVideo = Object.keys(f.videoUniforms).filter(u => !m?.videos?.[u]?.src).length;
  const songs = new Set(Object.values(f.audioUniforms ?? {}));
  const noSong = [...songs].filter(id => !m?.audio?.some(a => a.id === id && a.src)).length;
  if (noImage) out.push(noImage === 1 ? 'an image' : `${noImage} images`);
  if (noVideo) out.push(noVideo === 1 ? 'a video' : `${noVideo} videos`);
  if (noSong) out.push(noSong === 1 ? 'a song' : `${noSong} songs`);
  return out;
}

/** Compile `nodes` + `play` into a source. Pure apart from the id and the clock. */
export function snapshotFromGraph(nodes: GraphNode[], play: PlayRecord, meta: { title: string; from: SourceOrigin; id?: string; aspect?: PreviewAspect; now?: number; media?: PlayMedia }): SnapshotResult {
  let result;
  try { result = compileGraph({ nodes }); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  if (!result.success || !result.fragmentShader) return { ok: false, error: result.errors?.join('; ') || 'The graph did not compile' };
  const compiled: CompiledForWeb = { ...result, particleSystems: result.particleSystems ?? [] };
  const { input, missing } = webInputFrom(compiled, play, { title: meta.title, aspect: meta.aspect ?? 'free', media: meta.media ?? { textures: {}, videos: {}, audio: [] } });
  const byId = allNodes(nodes);
  const shaderNodes: SourceNode[] = [];
  for (const [id, slug] of result.nodeSlugMap ?? []) {
    const node = byId.get(id);
    if (!node || node.type === 'output' || !input.fragmentShader.includes(nodeSlicePrefix(slug))) continue;
    shaderNodes.push({ id, slug, label: nodeLabelOf(node) });
  }
  return {
    ok: true,
    source: {
      id: meta.id ?? newId('src'), from: meta.from, title: meta.title, bundle: input,
      shader: { nodes: shaderNodes }, capturedAt: meta.now ?? Date.now(), limits: missing, features: featuresOf(compiled),
    },
  };
}

/** A saved graph, read from storage without loading it. */
export function snapshotSaved(name: string, id?: string): SnapshotResult {
  let parsed: { nodes?: unknown; play?: unknown; savedAt?: unknown } | null;
  try { parsed = JSON.parse(localStorage.getItem(`shader-studio:${name}`) ?? 'null'); } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.nodes)) return { ok: false, error: `No saved graph named “${name}”` };
  const nodes = migrateLoadedNodes(parsed.nodes as GraphNode[]);
  const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
  // The graph's image, video and song files exist only while it's open: take them when it is, as saved.
  const st = useNodeGraphStore.getState();
  const media = st.currentGraph?.name === name && !st.graphDirty ? st.playWebInput(name).input.media : undefined;
  return snapshotFromGraph(nodes, migrateLoadedPlay(parsePlayRecord(parsed.play), parsed.nodes as GraphNode[]), { title: name, from: { kind: 'saved', name, savedAt }, id, media });
}

/** A bundled example (its chunk loads on first use). */
export async function snapshotExample(key: string, id?: string): Promise<SnapshotResult> {
  let all;
  try { all = await loadExampleGraphs(); } catch (e) { return { ok: false, error: `Couldn’t load the examples: ${e instanceof Error ? e.message : String(e)}` }; }
  const g = all[key];
  if (!g) return { ok: false, error: `No example “${key}”` };
  const title = EXAMPLE_INDEX[key]?.label ?? g.label;
  return snapshotFromGraph(migrateLoadedNodes(g.nodes), migrateLoadedPlay(parsePlayRecord(g.play ?? null), g.nodes), { title, from: { kind: 'example', key }, id });
}

/** A new copy of a source from where it came from, keeping its id (Refresh from graph). */
export async function refreshSnapshot(s: PresentSource): Promise<SnapshotResult> {
  const r = s.from.kind === 'saved' ? snapshotSaved(s.from.name, s.id) : await snapshotExample(s.from.key, s.id);
  if (r.ok) r.source.title = s.title;
  return r;
}
