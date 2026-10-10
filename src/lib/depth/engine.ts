/**
 * depthEngine — runs each Depth node's model and hands the result to the shader (docs/depth-node.md).
 *
 * - `sync(nodes)`: on every graph change. Each Depth node gets a slot; a baked one opens its depth video (or
 *   image) from the library.
 * - `setProgram(shaders, textureUniforms, videoUniforms)`: after each compile. Each node's code names the texture
 *   wired into it (`// depth-source <its sampler> <wired sampler>`, nodes/definitions/depth.ts), or `picture`.
 * - `afterFrame(ctx)`: right after the preview draws. For each node due a run (plan.ts shouldRun) one frame of its
 *   source is grabbed at the model's size (a texture is copied on the GPU and read back; the picture is read from
 *   the canvas while its drawing buffer holds it) and sent to the worker. The picture never waits: the last depth
 *   stays until the next arrives, then it is smoothed, uploaded to a half-float texture and a frame is asked for.
 * - `follow()` once a frame and `seek()` before offline frames keep baked depth videos on their source video.
 *
 * Nothing runs until the node's model is downloaded (src/depthModel/client.ts): the card offers the download.
 * Textures go through the store's `nodeTextures` (live, and a baked image) or `videoTextures` (a baked video),
 * so the preview, Pass programs and web exports bind them as a Texture Input's or a Video Input's.
 */
import * as THREE from 'three';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { DEPTH_SOURCE_MARK, DEPTH_TYPE, depthBakeId, depthPlaysBake, depthSideOf, depthUpdateOf, type DepthBakeInfo } from '../../nodes/definitions/depth';
import { depthModelUsable, estimateDepth, type DepthFrame } from '../../depthModel/client';
import { depthModelById } from '../../depthModel/config';
import { effectiveDepthModel } from '../../depthModel/experimental';
import { metricDistance } from '../../depthModel/workerCore';
import { blendDepth, depthRowsUp, followSource, grabSize, shouldRun } from './plan';
import { getImage, getVideo } from '../backgroundLibrary';
import { forgetMedia, rememberMedia } from '../mediaSources';

export type DepthState = 'idle' | 'needs-download' | 'needs-bake' | 'no-source' | 'running' | 'ready' | 'baked' | 'missing' | 'error';

export interface DepthStatus {
  state: DepthState;
  /** Last model time per frame (ms). */
  ms: number | null;
  /** Depth size (model output). */
  w: number;
  h: number;
  runs: number;
  message?: string;
}

export interface DepthHost {
  setTexture(nodeId: string, tex: THREE.Texture | null): void;
  setVideoTexture(nodeId: string, tex: THREE.VideoTexture | null): void;
  requestRender(): void;
}

export interface FrameContext {
  renderer: THREE.WebGLRenderer;
  uniforms: Record<string, THREE.IUniform>;
  /** The preview canvas, its drawing buffer still holding this frame. */
  canvas: HTMLCanvasElement;
  playing: boolean;
}

/** Every Depth node in a node list, inside groups too. */
export function depthNodesIn(nodes: readonly GraphNode[], out: GraphNode[] = []): GraphNode[] {
  for (const n of nodes) {
    if (n.type === DEPTH_TYPE) out.push(n);
    const sg = n.params?.subgraph as SubgraphData | undefined;
    if (sg?.nodes?.length) depthNodesIn(sg.nodes, out);
  }
  return out;
}

/** The marks a compiled shader carries: the Depth sampler → the sampler wired into it (or 'picture'). */
export function depthSources(shaders: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`${DEPTH_SOURCE_MARK.replace(/[/]/g, '\\/')}(\\w+) (\\w+)`, 'g');
  for (const fs of shaders) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(fs || ''))) if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

// ── GPU copy of a texture, read back small ──────────────────────────────────

class Grabber {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat = new THREE.ShaderMaterial({
    uniforms: { t: { value: null }, srgb: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `precision highp float; uniform sampler2D t; uniform float srgb; varying vec2 vUv;
      vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() { vec4 c = texture2D(t, vUv); gl_FragColor = vec4(clamp(srgb > 0.5 ? enc(c.rgb) : c.rgb, 0.0, 1.0), 1.0); }`,
    depthTest: false, depthWrite: false,
  });
  private rt: THREE.WebGLRenderTarget | null = null;
  constructor() { this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat)); }

  /** RGBA bytes, rows bottom-up. */
  grab(renderer: THREE.WebGLRenderer, tex: THREE.Texture, w: number, h: number): Uint8Array {
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
    }
    this.mat.uniforms.t.value = tex;
    this.mat.uniforms.srgb.value = tex.colorSpace === THREE.SRGBColorSpace ? 1 : 0;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.camera);
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(this.rt, 0, 0, w, h, buf);
    renderer.setRenderTarget(prev);
    this.mat.uniforms.t.value = null;
    return buf;
  }
}

/** A texture's size and whether it is a still (and its key when it is). */
function textureInfo(tex: THREE.Texture): { w: number; h: number; still: string | null } {
  const img = tex.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined;
  const w = img?.videoWidth || img?.width || 0, h = img?.videoHeight || img?.height || 0;
  const moving = (tex as THREE.VideoTexture).isVideoTexture || (tex as { isRenderTargetTexture?: boolean }).isRenderTargetTexture || (typeof HTMLCanvasElement !== 'undefined' && tex.image instanceof HTMLCanvasElement && !(tex as THREE.CanvasTexture).isCanvasTexture);
  return { w, h, still: moving ? null : `${tex.uuid}:${tex.version}` };
}

// ── The engine ───────────────────────────────────────────────────────────────

interface Slot {
  node: GraphNode;
  status: DepthStatus;
  busy: boolean;
  framesSince: number;
  lastKey: string | null;
  ranSinceProgram: boolean;
  depth: Float32Array | null;
  tex: THREE.DataTexture | null;
  /** The last frame sent to the model (for Compare), RGBA top-down. */
  lastFrame: { rgba: Uint8Array; w: number; h: number } | null;
  /** The model it last ran (the effective one: experimental models fall back to the default while off). */
  model: string;
  /** A metric model's nearest and farthest distance in the last frame (metres); null for relative models. */
  range: [number, number] | null;
  bake: { key: string; el: HTMLVideoElement | null; tex: THREE.Texture | null; url: string | null } | null;
}

const idleStatus = (): DepthStatus => ({ state: 'idle', ms: null, w: 0, h: 0, runs: 0 });

class DepthEngine {
  private host: DepthHost | null = null;
  private slots = new Map<string, Slot>();
  /** Depth sampler → node id, and → its source sampler. */
  private samplerNode = new Map<string, string>();
  private sources = new Map<string, string>();
  private grabber: Grabber | null = null;
  private canvas2d: HTMLCanvasElement | null = null;
  private listeners = new Set<() => void>();
  /** Source video elements of baked nodes (by source sampler's node id), from the hosts that play them. */
  private videoElementOf: ((nodeId: string) => HTMLVideoElement | null) | null = null;
  private videoUniforms: Record<string, string> = {};

  setHost(host: DepthHost | null): void {
    this.host = host;
    if (host) for (const [id, s] of this.slots) {
      if (s.tex) host.setTexture(id, s.tex);
      if (s.bake?.tex) (s.bake.el ? host.setVideoTexture(id, s.bake.tex as THREE.VideoTexture) : host.setTexture(id, s.bake.tex));
    }
  }
  /** How to find the video element a Video Input / Baked node plays (lib/videoEngine.ts, lib/bakedVideos.ts). */
  setVideoElements(fn: ((nodeId: string) => HTMLVideoElement | null) | null): void { this.videoElementOf = fn; }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) fn(); }

  status(nodeId: string): DepthStatus { return this.slots.get(nodeId)?.status ?? idleStatus(); }
  /** The frame the node last sent to its model (RGBA, top-down), for Compare. */
  lastFrame(nodeId: string): { rgba: Uint8Array; w: number; h: number } | null { return this.slots.get(nodeId)?.lastFrame ?? null; }
  /** A metric model's distance range in the node's last frame (metres), or null. */
  metricRange(nodeId: string): [number, number] | null { return this.slots.get(nodeId)?.range ?? null; }
  /** The node's current depth (0–1 nearness, top-down) and its size. */
  currentDepth(nodeId: string): { depth: Float32Array; w: number; h: number } | null {
    const s = this.slots.get(nodeId);
    return s?.depth ? { depth: s.depth, w: s.status.w, h: s.status.h } : null;
  }
  /** The source sampler wired into a node ('picture' when none), once compiled. */
  sourceOf(nodeId: string): string | null {
    for (const [sampler, id] of this.samplerNode) if (id === nodeId) return this.sources.get(sampler) ?? null;
    return null;
  }

  sync(nodes: readonly GraphNode[]): void {
    const want = new Map(depthNodesIn(nodes).map(n => [n.id, n]));
    for (const [id, s] of this.slots) if (!want.has(id)) this.drop(id, s);
    for (const [id, n] of want) {
      let s = this.slots.get(id);
      if (!s) {
        s = { node: n, status: idleStatus(), busy: false, framesSince: 0, lastKey: null, ranSinceProgram: false, depth: null, tex: null, lastFrame: null, model: effectiveDepthModel(n.params.model).id, range: null, bake: null };
        this.slots.set(id, s);
      }
      const before = s.node;
      s.node = n;
      // A new model or size runs again (a still too), and smoothing doesn't blend across them.
      if (before.params.model !== n.params.model || before.params.resolution !== n.params.resolution) { s.lastKey = null; s.depth = null; s.ranSinceProgram = false; }
      this.syncBake(id, s);
      const usable = depthModelUsable(effectiveDepthModel(n.params.model).id);
      const playsBake = !!depthPlaysBake(n);
      if (!playsBake && !usable && s.status.state !== 'needs-download') { s.status = { ...s.status, state: 'needs-download' }; this.changed(); }
      else if (!playsBake && usable && s.status.state === 'needs-download') { s.status = { ...s.status, state: 'idle' }; this.changed(); this.host?.requestRender(); }
    }
  }

  setProgram(shaders: readonly string[], textureUniforms: Record<string, string>, videoUniforms: Record<string, string>): void {
    this.sources = depthSources(shaders);
    this.videoUniforms = videoUniforms;
    this.samplerNode.clear();
    for (const sampler of this.sources.keys()) {
      const id = textureUniforms[sampler] ?? videoUniforms[sampler];
      if (id) this.samplerNode.set(sampler, id);
    }
    for (const s of this.slots.values()) s.ranSinceProgram = false;
  }

  /** Any node that might run this frame (ShaderCanvas skips afterFrame otherwise). */
  wants(): boolean {
    for (const s of this.slots.values()) if (!s.busy && depthUpdateOf(s.node) !== 'baked' && depthModelUsable(effectiveDepthModel(s.node.params.model).id)) return true;
    return false;
  }

  afterFrame(ctx: FrameContext): void {
    for (const [sampler, id] of this.samplerNode) {
      const s = this.slots.get(id);
      if (!s) continue;
      s.framesSince++;
      const n = s.node;
      const model = effectiveDepthModel(n.params.model).id;
      // The experimental setting switched the model under it: run again, no blending across models.
      if (model !== s.model) { s.model = model; s.lastKey = null; s.depth = null; s.range = null; s.ranSinceProgram = false; }
      const update = depthUpdateOf(n);
      if (update === 'baked') continue;
      const usable = depthModelUsable(model);
      const src = this.sources.get(sampler) ?? 'picture';
      const tex = src === 'picture' ? null : (ctx.uniforms[src]?.value as THREE.Texture | null | undefined) ?? null;
      const info = tex ? textureInfo(tex) : { w: ctx.canvas.width, h: ctx.canvas.height, still: null };
      const hasSource = src === 'picture' ? ctx.canvas.width > 0 : !!tex && info.w > 0 && info.h > 0;
      const side = depthSideOf(n);
      const runKey = info.still ? `${info.still}|${model}|${side}` : null;
      // A video's depth is baked first (it plays smoothly then), never worked out live
      const video = src !== 'picture' && src in this.videoUniforms;
      if (video) {
        if (usable && s.status.state !== 'needs-bake') { s.status = { ...s.status, state: 'needs-bake', message: undefined }; this.changed(); }
        continue;
      }
      if (!shouldRun({ update, every: Number(n.params.every) || 4, framesSince: s.framesSince, busy: s.busy, usable, hasSource, stillKey: info.still, lastKey: s.lastKey, runKey, playing: ctx.playing, ranSinceProgram: s.ranSinceProgram })) {
        if (usable && !hasSource && s.status.state !== 'no-source') { s.status = { ...s.status, state: 'no-source', message: 'Its texture has no picture yet.' }; this.changed(); }
        continue;
      }
      const { w, h } = grabSize(info.w, info.h, side);
      let frame: DepthFrame;
      try {
        if (tex) {
          this.grabber ??= new Grabber();
          frame = { rgba: this.grabber.grab(ctx.renderer, tex, w, h), w, h, flipY: true };
        } else {
          const c = (this.canvas2d ??= document.createElement('canvas'));
          if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
          const g = c.getContext('2d', { willReadFrequently: true });
          if (!g) continue;
          g.drawImage(ctx.canvas, 0, 0, w, h);
          frame = { rgba: new Uint8Array(g.getImageData(0, 0, w, h).data.buffer), w, h, flipY: false };
        }
      } catch (e) {
        s.status = { ...s.status, state: 'error', message: e instanceof Error ? e.message : String(e) };
        this.changed();
        continue;
      }
      s.lastFrame = { rgba: frame.flipY ? flipRows(frame.rgba, w, h) : frame.rgba.slice(), w, h };
      s.busy = true; s.framesSince = 0; s.ranSinceProgram = true;
      if (runKey) s.lastKey = runKey;
      if (s.status.state !== 'ready') { s.status = { ...s.status, state: 'running' }; this.changed(); }
      void estimateDepth(model, frame, side).then(r => {
        s.busy = false;
        if (this.slots.get(id) !== s) return;
        if (!r) {
          const usableNow = depthModelUsable(model);
          s.status = { ...s.status, state: usableNow ? 'error' : 'needs-download', message: usableNow ? 'The model failed (see the console).' : undefined };
          if (runKey) s.lastKey = null;
          this.changed();
          return;
        }
        // A still runs once: no blending with what another picture left.
        const smoothing = runKey ? 0 : Number(s.node.params.smoothing) || 0;
        const sameSize = s.status.w === r.w && s.status.h === r.h;
        s.depth = blendDepth(sameSize ? s.depth : null, r.depth, smoothing);
        s.range = r.range ?? null;
        this.upload(id, s, r.w, r.h);
        s.status = { state: 'ready', ms: r.ms, w: r.w, h: r.h, runs: s.status.runs + 1 };
        this.changed();
        this.host?.requestRender();
      });
    }
  }

  private upload(id: string, s: Slot, w: number, h: number): void {
    if (!s.depth) return;
    let tex = s.tex;
    if (!tex || tex.image.width !== w || tex.image.height !== h) {
      tex?.dispose();
      tex = new THREE.DataTexture(new Uint16Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.HalfFloatType);
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.flipY = false;
      // Web pages get no live depth yet (docs/depth-node.md): the export encodes this blank in its place (a bake plays there).
      tex.userData.canvas8 = blankCanvas();
      s.tex = tex;
      this.host?.setTexture(id, tex);
    }
    const one = THREE.DataUtils.toHalfFloat(1);
    const data = tex.image.data as Uint16Array;
    depthRowsUp(s.depth, w, h, data, THREE.DataUtils.toHalfFloat, one);
    // A metric model: green holds the distance in metres (the Depth node's Distance output), red stays nearness.
    const range = s.range;
    if (range) {
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * w;
        for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 1] = THREE.DataUtils.toHalfFloat(metricDistance(s.depth[src + x], range[0], range[1]));
      }
    }
    tex.needsUpdate = true;
  }

  // ── Baked depth ────────────────────────────────────────────────────────────

  private syncBake(id: string, s: Slot): void {
    const b = depthPlaysBake(s.node);
    const key = b ? `${b.kind}:${depthBakeId(b)}` : '';
    if (s.bake?.key === key) return;
    this.closeBake(id, s);
    if (!b) {
      // Back to live: its live texture again (if any).
      if (s.tex) this.host?.setTexture(id, s.tex);
      return;
    }
    s.bake = { key, el: null, tex: null, url: null };
    s.status = { ...s.status, state: 'baked', message: 'Loading the baked depth…' };
    this.changed();
    void this.openBake(id, s, b);
  }

  private async openBake(id: string, s: Slot, b: DepthBakeInfo): Promise<void> {
    const mine = s.bake;
    const fail = (state: DepthState, message: string) => { if (s.bake === mine) { s.status = { ...s.status, state, message }; this.changed(); } };
    try {
      if (b.kind === 'image') {
        const got = await getImage(depthBakeId(b));
        if (s.bake !== mine) return;
        if (!got) return fail('missing', 'The baked depth image isn’t in the library any more. Bake again.');
        const bmp = await createImageBitmap(got.blob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        bmp.close?.();
        const tex = new THREE.CanvasTexture(c);
        tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
        if (s.bake !== mine || !mine) return;
        mine.tex = tex;
        this.host?.setTexture(id, tex);
      } else {
        const got = await getVideo(depthBakeId(b));
        if (s.bake !== mine) return;
        if (!got) return fail('missing', 'The baked depth video isn’t in the library any more. Bake again.');
        const el = document.createElement('video');
        el.muted = true; el.playsInline = true; el.preload = 'auto'; el.loop = false;
        el.setAttribute('playsinline', ''); el.setAttribute('muted', '');
        const url = URL.createObjectURL(got.blob);
        el.src = url;
        await new Promise<void>((ok, no) => { el.addEventListener('loadeddata', () => ok(), { once: true }); el.addEventListener('error', () => no(new Error('The depth video can’t be played here')), { once: true }); });
        if (s.bake !== mine || !mine) { URL.revokeObjectURL(url); return; }
        el.width = el.videoWidth; el.height = el.videoHeight;
        const tex = new THREE.VideoTexture(el);
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
        Object.assign(mine, { el, tex, url });
        // Kept for web exports (lib/mediaSources.ts): the page plays it beside its source video.
        rememberMedia(id, 'video', got.name, got.type, got.blob);
        this.host?.setVideoTexture(id, tex);
      }
      s.status = { state: 'baked', ms: null, w: b.width, h: b.height, runs: b.frames, message: undefined };
      this.changed();
      this.host?.requestRender();
    } catch (e) {
      fail('error', e instanceof Error ? e.message : String(e));
    }
  }

  private closeBake(id: string, s: Slot): void {
    const b = s.bake;
    if (!b) return;
    s.bake = null;
    if (b.el) { b.el.pause(); b.el.removeAttribute('src'); b.el.load(); this.host?.setVideoTexture(id, null); forgetMedia(id); }
    else if (b.tex) this.host?.setTexture(id, s.tex);
    b.tex?.dispose();
    if (b.url) URL.revokeObjectURL(b.url);
  }

  /** The source video a baked node keeps to: the element of the Video Input / Baked node wired into it. */
  private sourceVideo(id: string): HTMLVideoElement | null {
    const src = this.sourceOf(id);
    if (!src || !this.videoElementOf) return null;
    const srcId = this.videoUniforms[src];
    return srcId ? this.videoElementOf(srcId) : null;
  }

  /** Once a frame: baked depth videos follow their source video's time. */
  follow(): void {
    for (const [id, s] of this.slots) {
      const el = s.bake?.el, b = depthPlaysBake(s.node);
      if (!el || !b || el.readyState < 1) continue;
      const src = this.sourceVideo(id);
      if (!src) continue;
      const act = followSource({ time: src.currentTime, paused: src.paused, rate: src.playbackRate }, { time: el.currentTime, paused: el.paused }, b.fps, b.duration);
      if (act.seek !== null) { el.currentTime = act.seek; (s.bake!.tex as THREE.VideoTexture).needsUpdate = true; }
      if (el.playbackRate !== act.rate) el.playbackRate = act.rate;
      if (act.play && el.paused) void el.play().catch(() => {});
      else if (!act.play && !el.paused) el.pause();
    }
  }

  /** Offline: each baked depth video on its source's frame, decoded, before the shader draws. */
  async seek(): Promise<void> {
    await Promise.all([...this.slots].map(async ([id, s]) => {
      const el = s.bake?.el;
      const src = el ? this.sourceVideo(id) : null;
      if (!el || !src) return;
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - src.currentTime) < 1e-4 && el.readyState >= 2) return;
      await new Promise<void>(ok => { const t = setTimeout(ok, 4000); el.addEventListener('seeked', () => { clearTimeout(t); ok(); }, { once: true }); el.currentTime = src.currentTime; });
      (s.bake!.tex as THREE.VideoTexture).needsUpdate = true;
    }));
  }

  private drop(id: string, s: Slot): void {
    this.closeBake(id, s);
    s.tex?.dispose();
    this.slots.delete(id);
    this.host?.setTexture(id, null);
    this.changed();
  }
}

let blank: HTMLCanvasElement | null = null;
/** A 1×1 black canvas: what a web export carries for a live depth (it reads 0 there). */
function blankCanvas(): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  if (!blank) { blank = document.createElement('canvas'); blank.width = blank.height = 1; const g = blank.getContext('2d'); if (g) { g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1); } }
  return blank;
}

function flipRows(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(rgba.length), row = w * 4;
  for (let y = 0; y < h; y++) out.set(rgba.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return out;
}

export const depthEngine = new DepthEngine();

/** A model's name for the card. */
export const depthModelName = (id: unknown): string => depthModelById(id).name;

/** For checking in dev: `window.__depthEngine`. */
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __depthEngine?: unknown }).__depthEngine = depthEngine;
