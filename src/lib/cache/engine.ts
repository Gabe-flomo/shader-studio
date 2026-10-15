/**
 * cacheEngine — records each Cache node's frames and tells the shader which is newest (docs/cache-node.md).
 *
 * - `sync(nodes)`: on every graph change. Each Cache node gets a slot; a new Frames or Frame size starts it over.
 * - `setProgram(shaders, textureUniforms)`: after each compile. Each node's code names the texture wired into it
 *   (`// cache-source <its sampler> <wired sampler>`, nodes/definitions/cache.ts).
 * - `beforeFrame(ctx)`: after the Passes, before the picture draws. While the clock runs (and Record is on, every
 *   Every frames) the source is drawn into the next tile of the node's atlas: `frames` tiles of the frame size, in a
 *   grid. Then the newest tile and the count filled are written to `<sampler>_head` / `_filled` on the material.
 *   Paused, an empty cache still takes one frame, so a still shows at once.
 * - `clear(id)` forgets the frames (the card's Clear).
 *
 * The atlas is an 8-bit sRGB target: what the shader read from the source (linear) is stored with sRGB's steps,
 * so dark frames don't band, at a quarter of half float's memory.
 */
import * as THREE from 'three';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { CACHE_SOURCE_MARK, CACHE_TYPE, cacheFramesOf, cacheGrid, cacheSizeOf } from '../../nodes/definitions/cache';

export interface CacheStatus {
  state: 'idle' | 'no-source' | 'recording' | 'held' | 'error';
  frames: number;
  filled: number;
  /** One frame's size. */
  w: number;
  h: number;
  bytes: number;
  message?: string;
}

export interface CacheHost {
  setTexture(nodeId: string, tex: THREE.Texture | null): void;
  requestRender(): void;
}

export interface CacheFrameContext {
  renderer: THREE.WebGLRenderer;
  uniforms: Record<string, THREE.IUniform>;
  playing: boolean;
}

/** The largest atlas side (WebGL2 guarantees 4096 on the devices Playfield targets). */
export const CACHE_MAX_SIDE = 4096;

/** Every Cache node in a node list, inside groups too. */
export function cacheNodesIn(nodes: readonly GraphNode[], out: GraphNode[] = []): GraphNode[] {
  for (const n of nodes) {
    if (n.type === CACHE_TYPE) out.push(n);
    const sg = n.params?.subgraph as SubgraphData | undefined;
    if (sg?.nodes?.length) cacheNodesIn(sg.nodes, out);
  }
  return out;
}

/** The marks a compiled shader carries: the Cache sampler → the sampler wired into it (or 'none'). */
export function cacheSources(shaders: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`${CACHE_SOURCE_MARK.replace(/[/]/g, '\\/')}(\\w+) (\\w+)`, 'g');
  for (const fs of shaders) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(fs || ''))) if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

/**
 * One frame's size in the atlas: `size` wide, the source's shape (height a multiple of 8, at least 8), made
 * smaller if the grid wouldn't fit CACHE_MAX_SIDE either way.
 */
export function cacheFrameSize(srcW: number, srcH: number, size: number, frames: number, maxSide = CACHE_MAX_SIDE): { w: number; h: number } {
  const { cols, rows } = cacheGrid(frames);
  const aspect = srcW > 0 && srcH > 0 ? srcH / srcW : 9 / 16;
  let w = Math.min(size, Math.floor(maxSide / cols));
  let h = Math.max(8, Math.round((w * aspect) / 8) * 8);
  if (h * rows > maxSide) { h = Math.max(8, Math.floor(maxSide / rows / 8) * 8); w = Math.min(w, Math.max(8, Math.round(h / aspect))); }
  return { w, h };
}

/** After recording one frame: the new head and count. */
export const cacheAdvance = (head: number, filled: number, frames: number): { head: number; filled: number } =>
  ({ head: (head + 1) % frames, filled: Math.min(frames, filled + 1) });

interface Slot {
  node: GraphNode;
  rt: THREE.WebGLRenderTarget | null;
  frames: number;
  w: number;
  h: number;
  /** Source shape the atlas was made for. */
  shape: string;
  head: number;
  filled: number;
  tick: number;
  status: CacheStatus;
}

const idle = (frames = 0): CacheStatus => ({ state: 'idle', frames, filled: 0, w: 0, h: 0, bytes: 0 });

class CacheEngine {
  private host: CacheHost | null = null;
  private slots = new Map<string, Slot>();
  private samplerNode = new Map<string, string>();
  private sources = new Map<string, string>();
  private listeners = new Set<() => void>();
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat = new THREE.ShaderMaterial({
    uniforms: { t: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'precision highp float; uniform sampler2D t; varying vec2 vUv; void main() { gl_FragColor = texture2D(t, vUv); }',
    depthTest: false, depthWrite: false,
  });
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);

  constructor() { this.scene.add(this.quad); }

  setHost(host: CacheHost | null): void {
    this.host = host;
    if (host) for (const [id, s] of this.slots) if (s.rt) host.setTexture(id, s.rt.texture);
  }
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) fn(); }
  status(nodeId: string): CacheStatus { return this.slots.get(nodeId)?.status ?? idle(); }

  /** The context was lost: the atlases go (made again, empty, on the next frame). */
  contextLost(): void {
    for (const s of this.slots.values()) { s.rt?.dispose(); s.rt = null; s.filled = 0; }
  }

  clear(nodeId: string): void {
    const s = this.slots.get(nodeId);
    if (!s) return;
    s.filled = 0; s.head = s.frames - 1; s.tick = 0;
    s.status = { ...s.status, filled: 0 };
    this.changed();
    this.host?.requestRender();
  }

  sync(nodes: readonly GraphNode[]): void {
    const want = new Map(cacheNodesIn(nodes).map(n => [n.id, n]));
    for (const [id, s] of this.slots) if (!want.has(id)) { s.rt?.dispose(); this.slots.delete(id); this.host?.setTexture(id, null); }
    for (const [id, n] of want) {
      let s = this.slots.get(id);
      const frames = cacheFramesOf(n);
      if (!s) { s = { node: n, rt: null, frames, w: 0, h: 0, shape: '', head: frames - 1, filled: 0, tick: 0, status: idle(frames) }; this.slots.set(id, s); }
      // A new frame count or size starts over (the atlas is remade on the next frame).
      if (s.frames !== frames || cacheSizeOf(s.node) !== cacheSizeOf(n)) { s.rt?.dispose(); s.rt = null; s.frames = frames; s.head = frames - 1; s.filled = 0; s.shape = ''; }
      s.node = n;
    }
    this.host?.requestRender();
  }

  setProgram(shaders: readonly string[], textureUniforms: Record<string, string>): void {
    this.sources = cacheSources(shaders);
    this.samplerNode.clear();
    for (const sampler of this.sources.keys()) { const id = textureUniforms[sampler]; if (id) this.samplerNode.set(sampler, id); }
  }

  wants(): boolean { return this.samplerNode.size > 0; }

  beforeFrame(ctx: CacheFrameContext): void {
    for (const [sampler, id] of this.samplerNode) {
      const s = this.slots.get(id);
      if (!s) continue;
      const src = this.sources.get(sampler) ?? 'none';
      const tex = src === 'none' ? null : (ctx.uniforms[src]?.value as THREE.Texture | null | undefined) ?? null;
      const img = tex?.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined;
      const sw = img?.videoWidth || img?.width || 0, sh = img?.videoHeight || img?.height || 0;
      if (!tex || !(sw > 0 && sh > 0)) {
        if (s.status.state !== 'no-source') { s.status = { ...idle(s.frames), state: 'no-source', message: src === 'none' ? 'Wire a texture into Texture.' : 'Its texture has no picture yet.' }; this.changed(); }
        this.write(ctx, sampler, s);
        continue;
      }
      // The atlas for this source's shape (remade, empty, when it changes).
      const shape = `${sw}x${sh}`;
      if (!s.rt || s.shape !== shape) {
        const { w, h } = cacheFrameSize(sw, sh, cacheSizeOf(s.node), s.frames);
        const { cols, rows } = cacheGrid(s.frames);
        s.rt?.dispose();
        s.rt = new THREE.WebGLRenderTarget(cols * w, rows * h, { depthBuffer: false, colorSpace: THREE.SRGBColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
        // Web pages don't record yet: the export encodes a blank in its place.
        s.rt.texture.userData.canvas8 = blankCanvas();
        s.w = w; s.h = h; s.shape = shape; s.head = s.frames - 1; s.filled = 0; s.tick = 0;
        this.host?.setTexture(id, s.rt.texture);
      }
      const record = s.node.params.record !== false;
      const every = Math.max(1, Math.round(Number(s.node.params.every) || 1));
      const due = record && ((ctx.playing && s.tick++ % every === 0) || s.filled === 0);
      if (due) {
        const next = cacheAdvance(s.head, s.filled, s.frames);
        const { cols } = cacheGrid(s.frames);
        const tx = next.head % cols, ty = Math.floor(next.head / cols);
        this.mat.uniforms.t.value = tex;
        const prev = ctx.renderer.getRenderTarget(), autoClear = ctx.renderer.autoClear;
        // Only this tile: no clear (it would wipe the others), drawn and cut to its rectangle.
        s.rt.viewport.set(tx * s.w, ty * s.h, s.w, s.h);
        s.rt.scissor.set(tx * s.w, ty * s.h, s.w, s.h);
        s.rt.scissorTest = true;
        ctx.renderer.autoClear = false;
        ctx.renderer.setRenderTarget(s.rt);
        ctx.renderer.render(this.scene, this.camera);
        ctx.renderer.setRenderTarget(prev);
        ctx.renderer.autoClear = autoClear;
        this.mat.uniforms.t.value = null;
        s.head = next.head; s.filled = next.filled;
      }
      const state: CacheStatus['state'] = record ? 'recording' : 'held';
      const before = s.status;
      s.status = { state, frames: s.frames, filled: s.filled, w: s.w, h: s.h, bytes: s.rt.width * s.rt.height * 4 };
      if (before.state !== state || before.filled !== s.filled || before.w !== s.w || before.frames !== s.frames) this.changed();
      this.write(ctx, sampler, s);
    }
  }

  private write(ctx: CacheFrameContext, sampler: string, s: Slot): void {
    const h = ctx.uniforms[`${sampler}_head`], f = ctx.uniforms[`${sampler}_filled`];
    if (h) h.value = s.head;
    if (f) f.value = s.rt ? s.filled : 0;
  }
}

let blank: HTMLCanvasElement | null = null;
function blankCanvas(): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  if (!blank) { blank = document.createElement('canvas'); blank.width = blank.height = 1; const g = blank.getContext('2d'); if (g) { g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1); } }
  return blank;
}

export const cacheEngine = new CacheEngine();

/** For checking in dev: `window.__cacheEngine`. */
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __cacheEngine?: unknown }).__cacheEngine = cacheEngine;
