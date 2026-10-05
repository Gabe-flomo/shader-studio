/**
 * Bake runner (docs/bake.md): renders a graph offline, frame by exact frame,
 * through the preview's own offline renderer (the one Record's FFmpeg export
 * uses, so 3D, Passes, Particles and Agents step deterministically), encodes
 * the frames, keeps the file in the video library and puts a Baked node in
 * the graph (or a new video under an existing one, for Re-bake).
 *
 * While it runs, the store compiles the bake's graph (`bakeGraph`) in place of
 * the open graph, the preview is held at the bake's size, and autosaves wait;
 * everything goes back as it was when it ends, fails or is cancelled.
 */
import { compileGraph } from '../../compiler/graphCompiler';
import { holdAutosave } from '../../files/recovery';
import { getNodeDefinition } from '../../nodes/definitions';
import { BakedNode, type BakedInfo } from '../../nodes/definitions/baked';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';
import { defaultLayer, type VideoLayer } from '../../types/play';
import { playId } from '../../play/playControls';
import { requireFeature } from '../plan';
import { addVideoFile } from '../backgroundLibrary';
import { bakedVideos } from '../bakedVideos';
import { timeCubes } from '../timeCube/volumes';
import { usePreviewHost } from '../previewHost';
import { usePreviewQuality } from '../previewQuality';
import { bakeEncoder, type BakeEncoder } from './encode';
import { applyBake, bakeRenderGraph, frozenInputs, hasAlpha, rebakeNodes, stashOf, tuckSet, bakeableOutput, unbake as unbakeNodes, BAKED_OUTPUT_FOR, type BakeStash } from './graphOps';
import { bakeFileName, bakeSteps, blendInto, packAlpha, planBake, type BakePlan, type BakeSettings } from './plan';

export interface BakeProgress {
  phase: 'preparing' | 'rendering' | 'saving';
  /** Frames rendered of `total` (pre-roll included). */
  done: number;
  total: number;
  /** Seconds since the render started. */
  elapsed: number;
}

export interface BakeHandle {
  cancelled: boolean;
}

const tick = () => new Promise<void>(r => setTimeout(r, 0));

/** A node's name as its card shows it. */
export function nodeLabel(n: GraphNode | undefined): string {
  if (!n) return 'a node';
  const own = typeof n.params.label === 'string' ? n.params.label.trim() : '';
  return own || getNodeDefinition(n.type)?.label || n.type;
}

/** The preview's current drawing size (what "Full" means). */
export function previewSize(): { width: number; height: number } {
  const c = usePreviewHost.getState().canvas;
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const w = c ? (c.clientWidth || c.width / dpr) * dpr : 1280;
  const h = c ? (c.clientHeight || c.height / dpr) * dpr : 720;
  return { width: Math.max(16, Math.round(w)), height: Math.max(16, Math.round(h)) };
}

/** Wait for `test`, checking every frame or so, up to `ms`. */
async function until(test: () => boolean, ms: number, what: string): Promise<void> {
  const t0 = performance.now();
  while (!test()) {
    if (performance.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 16));
  }
}

/** A small JPEG of one frame for the Library's poster. */
function posterOf(rgba: Uint8Array, w: number, h: number): string {
  try {
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.subarray(0, w * h * 4)), w, h), 0, 0);
    const s = Math.min(1, 320 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } catch { return ''; }
}

export interface RenderedBake {
  blob: Blob;
  codec: string;
  ext: string;
  thumb: string;
  plan: BakePlan;
}

/**
 * Render `graph` (a whole graph ending in an output) for `plan` and encode it.
 * The store's open graph is untouched; the preview shows the bake while it runs.
 */
export async function renderBake(graph: GraphNode[], plan: BakePlan, handle: BakeHandle, onProgress: (p: BakeProgress) => void): Promise<RenderedBake> {
  const offline = usePreviewHost.getState().offline;
  if (!offline) throw new Error('The preview isn’t ready yet. Open the graph’s preview and try again.');
  const store = useNodeGraphStore.getState();
  const releaseAutosave = holdAutosave();
  const releaseQuality = usePreviewQuality.getState().hold();
  let encoder: BakeEncoder | null = null;
  const t0 = performance.now();
  try {
    onProgress({ phase: 'preparing', done: 0, total: plan.renders, elapsed: 0 });
    store.setBakeGraph(graph);
    const st = useNodeGraphStore.getState();
    if (st.compilationErrors.length) throw new Error(`The part to bake doesn’t compile: ${st.compilationErrors.join('; ')}`);
    // Baked nodes inside the part (a bake of a bake) open their videos first.
    bakedVideos.sync([...st.nodes, ...graph]);
    await bakedVideos.whenLoaded();
    await until(() => offline.programReady(useNodeGraphStore.getState().fragmentShader), 20_000, 'the shader to compile');
    const got = offline.setRenderSize({ width: plan.width, height: plan.height });
    if (got.width !== plan.width || got.height !== plan.height) throw new Error(`This device can’t render ${plan.width}×${plan.height} (it gave ${got.width}×${got.height}). Pick a smaller resolution.`);
    encoder = await bakeEncoder(plan);
    const w = plan.width, h = plan.height;
    const pixels = new Uint8Array(w * h * 4);
    const packed = plan.alpha ? new Uint8Array(plan.frameWidth * plan.frameHeight * 4) : null;
    const pre: Uint8Array[] = [];
    let thumb = '';
    const posterAt = Math.floor(plan.frames / 3);
    const steps = bakeSteps(plan);
    for (let j = 0; j < steps.length; j++) {
      if (handle.cancelled) throw new Error('cancelled');
      const step = steps[j];
      await Promise.all([bakedVideos.seek(step.time), timeCubes.settled()]);
      offline.renderAtTime(step.time, { dt: 1 / plan.fps, first: j === 0 });
      offline.readPixels(pixels, w, h);
      if (step.preIndex !== null) { pre[step.preIndex] = pixels.slice(); }
      else {
        if (step.blend) blendInto(pixels, pre[step.blend.index], step.blend.weight);
        if (step.frame === posterAt) thumb = posterOf(pixels, w, h);
        let frame = pixels;
        if (packed) { packAlpha(pixels, w, h, packed); frame = packed; }
        await encoder.addFrame(frame, step.frame!);
      }
      if (j % 2 === 1) {
        onProgress({ phase: 'rendering', done: j + 1, total: steps.length, elapsed: (performance.now() - t0) / 1000 });
        // Let the page breathe (progress, Cancel) without slowing the render much.
        await tick();
      }
    }
    onProgress({ phase: 'saving', done: steps.length, total: steps.length, elapsed: (performance.now() - t0) / 1000 });
    const { codec, ext } = encoder;
    const blob = await encoder.finish();
    encoder = null;
    return { blob, codec, ext, thumb, plan };
  } catch (e) {
    if (encoder) await encoder.cancel().catch(() => {});
    throw e;
  } finally {
    offline.setRenderSize(null);
    useNodeGraphStore.getState().setBakeGraph(null);
    releaseQuality();
    releaseAutosave();
  }
}


/** What a bake would freeze, worked out from its graph before it renders. */
export function bakeFreezes(graph: GraphNode[], tucked: GraphNode[]): string[] {
  const r = compileGraph({ nodes: graph });
  if (!r.success) return [];
  return frozenInputs(r, tucked.map(n => n.id), tucked.map(n => n.type), JSON.stringify(useNodeGraphStore.getState().play ?? {}));
}

/** Keep the rendered file in the video library; its id and size. */
async function keep(r: RenderedBake, source: string): Promise<{ videoId: string; fileName: string; bytes: number }> {
  const name = bakeFileName(source, r.ext);
  const file = Object.assign(r.blob, { name });
  const meta = await addVideoFile(file, { name, poster: { thumb: r.thumb, width: r.plan.frameWidth, height: r.plan.frameHeight, duration: r.plan.frames / r.plan.fps } });
  return { videoId: meta.id, fileName: meta.name, bytes: meta.bytes };
}

const infoFor = (r: RenderedBake, source: string, bytes: number, frozen: string[]): BakedInfo => ({
  source, fps: r.plan.fps, duration: r.plan.frames / r.plan.fps, start: r.plan.start, loop: r.plan.loop,
  width: r.plan.width, height: r.plan.height, alpha: r.plan.alpha, bytes, frozen, bakedAt: Date.now(), codec: r.codec,
});

const commentFor = (source: string, i: BakedInfo, tucked: number) =>
  `Baked: ${source}. ${tucked} ${tucked === 1 ? 'node was' : 'nodes were'} rendered once to a ${i.duration.toFixed(i.duration % 1 ? 1 : 0)} s video (${i.fps} fps, ${i.width}×${i.height}${i.loop === 'seamless' ? ', looping seamlessly' : ', holding its last frame'}) that plays here in step with the clock, so the graph no longer runs them every frame. Unbake brings the live nodes back; Re-bake renders them again.`;

/** The Baked node's outputs: no Texture for an alpha bake (its frame holds colour above alpha). */
function bakedOutputs(alpha: boolean): GraphNode['outputs'] {
  const out = { ...BakedNode.outputs };
  if (alpha) delete out.texture;
  return out;
}

export interface BakeRequest {
  /** The node to bake, or null for the whole picture (the node wired into the output). */
  nodeId: string;
  outputKey: string;
  settings: BakeSettings;
  /** "the picture" or the node's name. */
  source: string;
}

/** Everything the dialog shows before a bake: the plan, what gets tucked, what freezes, which wires drop. */
export function prepareBake(req: BakeRequest) {
  const { nodes } = useNodeGraphStore.getState();
  const target = nodes.find(n => n.id === req.nodeId);
  if (!target) throw new Error('The node to bake is gone');
  const out = bakeableOutput(target, req.outputKey);
  if (!out) throw new Error('That output can’t be baked');
  const alpha = req.settings.alpha && hasAlpha(target, out.type);
  const { width, height } = previewSize();
  const plan = planBake({ ...req.settings, alpha }, width, height);
  const tuckIds = tuckSet(nodes, req.nodeId);
  const tucked = nodes.filter(n => tuckIds.has(n.id));
  const graph = bakeRenderGraph(nodes, req.nodeId, out.key, alpha);
  const mapped = BAKED_OUTPUT_FOR[out.type];
  const dropped = nodes.filter(n => !tuckIds.has(n.id)).flatMap(n => Object.entries(n.inputs)
    .filter(([, s]) => s.connection?.nodeId === req.nodeId && s.connection.outputKey !== out.key && !(s.connection.outputKey === 'alpha' && alpha && out.type === 'vec3'))
    .map(([k, s]) => `${nodeLabel(n)} ← ${target.outputs[s.connection!.outputKey]?.label ?? s.connection!.outputKey} (${k})`));
  return { plan, tucked, graph, out, mapped, dropped, alpha, target };
}

/** Bake a node (or the picture): render, keep the video, replace the nodes (one undo step). Returns the Baked node's id. */
export async function bakeNode(req: BakeRequest, handle: BakeHandle, onProgress: (p: BakeProgress) => void): Promise<string> {
  const prep = prepareBake(req);
  const frozen = bakeFreezes(prep.graph, prep.tucked);
  const rendered = await renderBake(prep.graph, prep.plan, handle, onProgress);
  if (handle.cancelled) throw new Error('cancelled');
  const kept = await keep(rendered, req.source);
  const info = infoFor(rendered, req.source, kept.bytes, frozen);
  const st = useNodeGraphStore.getState();
  // The graph may have changed while it rendered: bake what is there now.
  if (!st.nodes.some(n => n.id === req.nodeId)) throw new Error('The baked node was removed while it rendered; the video is in the Library.');
  const id = st.newNodeId();
  const baked: GraphNode = {
    id, type: BakedNode.type, position: { x: 0, y: 0 },
    inputs: { uv: { ...BakedNode.inputs.uv } }, outputs: bakedOutputs(info.alpha),
    params: { videoId: kept.videoId, fileName: kept.fileName, bakeInfo: info, __comment: commentFor(req.source, info, prep.tucked.length) },
  };
  const settings: BakeSettings = { ...req.settings, alpha: info.alpha };
  const result = applyBake(st.nodes, req.nodeId, prep.out.key, baked, settings);
  st.setNodesRewritten(result.nodes, `Baked ${req.source}`);
  return id;
}

/** Render a Baked node's live nodes again with the same settings: a new video under the same node (one undo step). */
export async function rebakeNode(bakedId: string, handle: BakeHandle, onProgress: (p: BakeProgress) => void): Promise<void> {
  const st0 = useNodeGraphStore.getState();
  const node = st0.nodes.find(n => n.id === bakedId);
  const stash: BakeStash | null = stashOf(node);
  if (!node || !stash) throw new Error('This node has nothing baked to render again');
  const { nodes: all, targetId } = rebakeNodes(st0.nodes, bakedId, () => st0.newNodeId());
  const alpha = stash.settings.alpha;
  const graph = bakeRenderGraph(all, targetId, stash.outputKey, alpha);
  const { width, height } = previewSize();
  const plan = planBake(stash.settings, width, height);
  const source = (node.params.bakeInfo as BakedInfo | undefined)?.source ?? nodeLabel(stash.nodes.find(n => n.id === stash.targetId));
  const frozen = bakeFreezes(graph, stash.nodes);
  const rendered = await renderBake(graph, plan, handle, onProgress);
  if (handle.cancelled) throw new Error('cancelled');
  const kept = await keep(rendered, source);
  const info = infoFor(rendered, source, kept.bytes, frozen);
  const st = useNodeGraphStore.getState();
  if (!st.nodes.some(n => n.id === bakedId)) throw new Error('The Baked node was removed while it rendered; the video is in the Library.');
  st.setNodesRewritten(st.nodes.map(n => n.id === bakedId
    ? { ...n, outputs: bakedOutputs(info.alpha), params: { ...n.params, videoId: kept.videoId, fileName: kept.fileName, bakeInfo: info, __comment: commentFor(source, info, stash.nodes.length) } }
    : n), `Re-baked ${source}`);
}

/** Put a Baked node's live nodes and wires back (one undo step). */
export function unbakeNode(bakedId: string): void {
  const st = useNodeGraphStore.getState();
  const node = st.nodes.find(n => n.id === bakedId);
  const info = node?.params.bakeInfo as BakedInfo | undefined;
  st.setNodesRewritten(unbakeNodes(st.nodes, bakedId, () => st.newNodeId()), `Unbaked ${info?.source ?? 'a node'}`);
}

/** The baked video as a Play Video layer too (Pro, like every layer): it follows the clock from 0, looping as the bake does. */
export function addBakeAsVideoLayer(bakedId: string): string | null {
  if (!requireFeature('play.layers')) return null;
  const st = useNodeGraphStore.getState();
  const node = st.nodes.find(n => n.id === bakedId);
  const info = node?.params.bakeInfo as BakedInfo | undefined;
  const videoId = typeof node?.params.videoId === 'string' ? node.params.videoId : '';
  if (!node || !info || !videoId) return null;
  const layer: VideoLayer = {
    ...(defaultLayer('video', playId('layer'), `Baked ${info.source}`) as VideoLayer),
    videoId, fileName: String(node.params.fileName || ''), bytes: info.bytes, fit: 'cover', loop: info.loop === 'seamless',
  };
  st.setPlay(p => ({ ...p, layers: [...p.layers, layer] }));
  return layer.id;
}

