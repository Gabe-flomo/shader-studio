/**
 * Bake depth (docs/depth-node.md): run a Depth node's model once over its whole source and keep the result
 * beside it in the library, as Bake does for nodes (docs/bake.md). Then playback, recordings and web pages read
 * the stored depth: smooth, exact, no model.
 *
 * - A video (Video Input, Baked): every frame at 30 fps (up to a minute), seeked exactly, the model run on each,
 *   smoothed as the node smooths, encoded as a grey video (WebCodecs VP8/VP9 in a browser, FFmpeg on the
 *   desktop: lib/bake/encode.ts) into the video library.
 * - An image (Texture Input): one run, kept as a grey PNG in the image library.
 *
 * The node's params then say where it is (`depthBake`) and Update turns to Baked. Values are 8-bit, as any bake.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';
import { depthSideOf, type DepthBakeInfo } from '../../nodes/definitions/depth';
import { depthModelUsable, estimateDepth } from '../../depthModel/client';
import { depthModelById } from '../../depthModel/config';
import { effectiveDepthModel } from '../../depthModel/experimental';
import { addImage, addVideoFile, getVideo } from '../backgroundLibrary';
import { videoEngine } from '../videoEngine';
import { bakeEncoder, type BakeEncoder } from '../bake/encode';
import type { BakePlan } from '../bake/plan';
import { nodeLabel } from '../bake/runner';
import { bakedParams, blendDepth, depthBakeFileName, depthToGreyRgba, grabSize, planDepthBake } from './plan';

export interface DepthBakeProgress { done: number; total: number; ms: number | null }

/** What a Depth node can bake from: its wired Texture Input, Video Input or Baked node. */
export function depthBakeSource(node: GraphNode, nodes: readonly GraphNode[]): { kind: 'image' | 'video'; node: GraphNode } | { kind: null; why: string } {
  const c = node.inputs.texture?.connection;
  if (!c) return { kind: null, why: 'Bake depth needs an Image or a Video wired into Texture (the picture itself can’t be baked).' };
  const src = nodes.find(n => n.id === c.nodeId);
  if (!src) return { kind: null, why: 'Its texture comes from inside a group: wire the Image or Video straight in to bake.' };
  if (src.type === 'textureInput') return { kind: 'image', node: src };
  if (src.type === 'videoInput' || src.type === 'baked') return { kind: 'video', node: src };
  return { kind: null, why: 'Bake depth works on an Image, a Video or a Baked node wired straight into Texture. For a Pass, bake the Pass first.' };
}

const grabCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d', { willReadFrequently: true })! };
};

async function videoBlobOf(src: GraphNode): Promise<Blob | null> {
  if (src.type === 'videoInput') return videoEngine.file(src.id);
  const id = typeof src.params.videoId === 'string' ? src.params.videoId : '';
  return id ? (await getVideo(id))?.blob ?? null : null;
}

const waitFor = (el: HTMLVideoElement, ev: string, ms: number) => new Promise<boolean>(res => {
  const t = setTimeout(() => res(false), ms);
  el.addEventListener(ev, () => { clearTimeout(t); res(true); }, { once: true });
  el.addEventListener('error', () => { clearTimeout(t); res(false); }, { once: true });
});

/** Bake the node's depth. Resolves with what it stored (the node's params are updated), or throws with a reason. */
export async function bakeDepth(nodeId: string, onProgress: (p: DepthBakeProgress) => void, signal?: AbortSignal): Promise<DepthBakeInfo> {
  const st = useNodeGraphStore.getState();
  const node = st.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error('Bake depth works on a Depth node at the top level of the graph.');
  const model = effectiveDepthModel(node.params.model).id;
  if (!depthModelUsable(model)) throw new Error(`Download ${depthModelById(model).name} first.`);
  const src = depthBakeSource(node, st.nodes);
  if (!src.kind) throw new Error(src.why);
  const side = depthSideOf(node);
  const smoothing = Number(node.params.smoothing) || 0;
  const source = nodeLabel(src.node);
  let info: DepthBakeInfo;

  if (src.kind === 'image') {
    const img = st.nodeTextures[src.node.id]?.image as CanvasImageSource & { width: number; height: number } | undefined;
    if (!img || !img.width) throw new Error('Load a picture into the Texture Input first.');
    const { w, h } = grabSize(img.width, img.height, side);
    const { g } = grabCanvas(w, h);
    g.drawImage(img, 0, 0, w, h);
    onProgress({ done: 0, total: 1, ms: null });
    const r = await estimateDepth(model, { rgba: new Uint8Array(g.getImageData(0, 0, w, h).data.buffer), w, h, flipY: false }, side);
    if (!r) throw new Error('The depth model failed (see the console).');
    const out = grabCanvas(r.w, r.h);
    out.g.putImageData(new ImageData(new Uint8ClampedArray(depthToGreyRgba(r.depth, r.w, r.h, r.w, r.h).buffer as ArrayBuffer), r.w, r.h), 0, 0);
    const blob = await new Promise<Blob>((ok, no) => out.c.toBlob(b => (b ? ok(b) : no(new Error('The depth image couldn’t be made'))), 'image/png'));
    const meta = await addImage(blob, { name: depthBakeFileName(source, 'png').replace(/\.png$/, ''), width: r.w, height: r.h });
    onProgress({ done: 1, total: 1, ms: r.ms });
    info = { kind: 'image', libraryId: meta.id, model, side, width: r.w, height: r.h, fps: 0, frames: 1, duration: 0, smoothing: 0, bytes: blob.size, bakedAt: Date.now(), source };
  } else {
    const blob = await videoBlobOf(src.node);
    if (!blob) throw new Error('Load a video into the Video node first.');
    const el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto';
    const url = URL.createObjectURL(blob);
    el.src = url;
    let enc: BakeEncoder | null = null;
    try {
      if (!(await waitFor(el, 'loadeddata', 20_000))) throw new Error('The video couldn’t be opened.');
      const plan = planDepthBake(el.duration);
      const { w, h } = grabSize(el.videoWidth, el.videoHeight, side);
      const { g } = grabCanvas(w, h);
      let prev: Float32Array | null = null;
      let outW = 0, outH = 0;
      for (let i = 0; i < plan.frames; i++) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (Math.abs(el.currentTime - plan.times[i]) > 1e-4) {
          const seeked = waitFor(el, 'seeked', 5000);
          el.currentTime = plan.times[i];
          await seeked;
        }
        g.drawImage(el, 0, 0, w, h);
        const r = await estimateDepth(model, { rgba: new Uint8Array(g.getImageData(0, 0, w, h).data.buffer), w, h, flipY: false }, side);
        if (!r) throw new Error('The depth model failed (see the console).');
        prev = blendDepth(prev && prev.length === r.depth.length ? prev : null, r.depth, smoothing);
        if (!enc) {
          outW = r.w & ~1; outH = r.h & ~1;
          enc = await bakeEncoder({ width: outW, height: outH, frameWidth: outW, frameHeight: outH, fps: plan.fps, start: 0, duration: plan.duration, loop: 'none', alpha: false, frames: plan.frames, fadeFrames: 0, renders: plan.frames } satisfies BakePlan);
        }
        await enc.addFrame(depthToGreyRgba(prev, r.w, r.h, outW, outH), i);
        onProgress({ done: i + 1, total: plan.frames, ms: r.ms });
      }
      const file = await enc!.finish();
      enc = null;
      const meta = await addVideoFile(file, { name: depthBakeFileName(source, file.type.includes('webm') ? 'webm' : 'mp4'), poster: { width: outW, height: outH, duration: plan.duration } });
      info = { kind: 'video', videoId: meta.id, model, side, width: outW, height: outH, fps: plan.fps, frames: plan.frames, duration: plan.duration, smoothing, bytes: file.size, bakedAt: Date.now(), source };
    } finally {
      if (enc) await enc.cancel().catch(() => {});
      el.removeAttribute('src'); el.load();
      URL.revokeObjectURL(url);
    }
  }
  useNodeGraphStore.getState().updateNodeParams(nodeId, bakedParams(info), { immediate: true });
  return info;
}
