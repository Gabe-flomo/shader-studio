/**
 * Bake (Segment, docs/segment-node.md): run a Segment node's model once over its whole source and keep the masks
 * beside it in the library, as Depth's Bake depth does (lib/depth/bake.ts). Then playback, exports and web pages
 * read the stored masks: smooth, exact, no model, the same every time.
 *
 * - A video (Video Input, Baked): every frame at 30 fps (up to a minute), seeked exactly, the model run on each,
 *   smoothed as the node smooths (Click with Follow tracks its point from frame to frame), encoded as a grey video
 *   (lib/bake/encode.ts) into the video library.
 * - An image (Texture Input): one run, kept as a grey PNG in the image library.
 *
 * The node's params then say where it is (`segmentBake`) and Update turns to Baked. The masks are 8-bit
 * confidence; Threshold, Softness, Grow, Invert and Edge refine still work on them live.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';
import { segmentClassesOf, segmentModeOf, segmentSideOf, type SegmentBakeInfo } from '../../nodes/definitions/segment';
import { addImage, addVideoFile, getVideo } from '../backgroundLibrary';
import { videoEngine } from '../videoEngine';
import { bakeEncoder, type BakeEncoder } from '../bake/encode';
import type { BakePlan } from '../bake/plan';
import { nodeLabel } from '../bake/runner';
import { depthToGreyRgba, planDepthBake } from '../depth/plan';
import { maskCentre, segmentEngine, segmentGrabSize, smoothMask } from './engine';

export interface SegmentBakeProgress { done: number; total: number; ms: number | null }

/** What a Segment node can bake from: its wired Texture Input, Video Input or Baked node. */
export function segmentBakeSource(node: GraphNode, nodes: readonly GraphNode[]): { kind: 'image' | 'video'; node: GraphNode } | { kind: null; why: string } {
  const c = node.inputs.texture?.connection;
  if (!c) return { kind: null, why: 'Bake needs an Image or a Video wired into Texture (the picture itself can’t be baked).' };
  const src = nodes.find(n => n.id === c.nodeId);
  if (!src) return { kind: null, why: 'Its texture comes from inside a group: wire the Image or Video straight in to bake.' };
  if (src.type === 'textureInput') {
    if (src.params.source === 'webcam') return { kind: null, why: 'A webcam is live: it can’t be baked. Record it first, or keep Update on Live.' };
    return { kind: 'image', node: src };
  }
  if (src.type === 'videoInput') {
    if (src.params.source === 'webcam') return { kind: null, why: 'A webcam is live: it can’t be baked. Record it first, or keep Update on Live.' };
    return { kind: 'video', node: src };
  }
  if (src.type === 'baked') return { kind: 'video', node: src };
  return { kind: null, why: 'Bake works on an Image, a Video or a Baked node wired straight into Texture. For a Pass, bake the Pass first.' };
}

/** The name a bake's file gets in the library. */
export function segmentBakeFileName(source: string, ext: string, now = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}.${p2(now.getMinutes())}.${p2(now.getSeconds())}`;
  const name = (source || 'picture').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'picture';
  return `Mask of ${name} ${stamp}.${ext}`;
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

/** Bake the node's masks. Resolves with what it stored (the node's params are updated), or throws with a reason. */
export async function bakeSegment(nodeId: string, onProgress: (p: SegmentBakeProgress) => void, signal?: AbortSignal): Promise<SegmentBakeInfo> {
  const st = useNodeGraphStore.getState();
  const node = st.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error('Bake works on a Segment node at the top level of the graph.');
  const src = segmentBakeSource(node, st.nodes);
  if (!src.kind) throw new Error(src.why);
  const mode = segmentModeOf(node), classes = segmentClassesOf(node), side = segmentSideOf(node);
  const smoothing = Number(node.params.smoothing) || 0;
  const follow = mode === 'click' && node.params.follow !== false;
  let point: [number, number] = [Number(node.params.pointX ?? 0.5), 1 - Number(node.params.pointY ?? 0.5)];
  const source = nodeLabel(src.node);
  let info: SegmentBakeInfo;

  if (src.kind === 'image') {
    const img = st.nodeTextures[src.node.id]?.image as CanvasImageSource & { width: number; height: number } | undefined;
    if (!img || !img.width) throw new Error('Load a picture into the Texture Input first.');
    const { w, h } = segmentGrabSize(img.width, img.height, side);
    const { g } = grabCanvas(w, h);
    g.drawImage(img, 0, 0, w, h);
    onProgress({ done: 0, total: 1, ms: null });
    const r = await segmentEngine.segmentOnce(mode, classes, point, g.getImageData(0, 0, w, h));
    const out = grabCanvas(r.w, r.h);
    out.g.putImageData(new ImageData(new Uint8ClampedArray(depthToGreyRgba(r.mask, r.w, r.h, r.w, r.h).buffer as ArrayBuffer), r.w, r.h), 0, 0);
    const blob = await new Promise<Blob>((ok, no) => out.c.toBlob(b => (b ? ok(b) : no(new Error('The mask image couldn’t be made'))), 'image/png'));
    const meta = await addImage(blob, { name: segmentBakeFileName(source, 'png').replace(/\.png$/, ''), width: r.w, height: r.h });
    onProgress({ done: 1, total: 1, ms: r.ms });
    info = { kind: 'image', libraryId: meta.id, mode, side, width: r.w, height: r.h, fps: 0, frames: 1, duration: 0, smoothing: 0, bytes: blob.size, bakedAt: Date.now(), source };
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
      const { w, h } = segmentGrabSize(el.videoWidth, el.videoHeight, side);
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
        const r = await segmentEngine.segmentOnce(mode, classes, point, g.getImageData(0, 0, w, h));
        prev = smoothMask(prev && prev.length === r.mask.length ? prev : null, r.mask, smoothing);
        // Click, Follow: next frame, look where the object is now.
        if (follow) { const c = maskCentre(prev, r.w, r.h); if (c) point = [c.x, c.y]; }
        if (!enc) {
          outW = r.w & ~1; outH = r.h & ~1;
          enc = await bakeEncoder({ width: outW, height: outH, frameWidth: outW, frameHeight: outH, fps: plan.fps, start: 0, duration: plan.duration, loop: 'none', alpha: false, frames: plan.frames, fadeFrames: 0, renders: plan.frames } satisfies BakePlan);
        }
        await enc.addFrame(depthToGreyRgba(prev, r.w, r.h, outW, outH), i);
        onProgress({ done: i + 1, total: plan.frames, ms: r.ms });
      }
      const file = await enc!.finish();
      enc = null;
      const meta = await addVideoFile(file, { name: segmentBakeFileName(source, file.type.includes('webm') ? 'webm' : 'mp4'), poster: { width: outW, height: outH, duration: plan.duration } });
      info = { kind: 'video', videoId: meta.id, mode, side, width: outW, height: outH, fps: plan.fps, frames: plan.frames, duration: plan.duration, smoothing, bytes: file.size, bakedAt: Date.now(), source };
    } finally {
      if (enc) await enc.cancel().catch(() => {});
      el.removeAttribute('src'); el.load();
      URL.revokeObjectURL(url);
    }
  }
  useNodeGraphStore.getState().updateNodeParams(nodeId, { segmentBake: info, update: 'baked' }, { immediate: true });
  return info;
}
