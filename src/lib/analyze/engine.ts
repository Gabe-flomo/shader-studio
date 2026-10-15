/**
 * analyzeEngine — measures each Analyze node's picture and hands the numbers to the shader (docs/analyze-node.md).
 *
 * - `sync(nodes)`: on every graph change. Each Analyze node gets a slot; a changed setting measures again.
 * - `setProgram(shaders, textureUniforms)`: after each compile. Each node's code names the texture wired into it
 *   (`// analyze-source <its sampler> <wired sampler>`, nodes/definitions/analyze.ts), or `picture`.
 * - `afterFrame(ctx)`: right after the preview draws, while playing (or once after a change while paused): the
 *   source is copied small on the GPU and read back (lib/depth/engine.ts Grabber; the picture is read from the
 *   canvas), measured (lib/analyze/stats.ts), smoothed, and uploaded to the node's 4 × 1 float texture through the
 *   store's `nodeTextures`.
 */
import * as THREE from 'three';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { ANALYZE_SOURCE_MARK, ANALYZE_TYPE, analyzeSideOf } from '../../nodes/definitions/analyze';
import { Grabber } from '../depth/engine';
import { ANALYZE_TEXELS, analyzeFrame, analyzeGrabSize, packAnalysis, smoothAnalysis, type Analysis } from './stats';

export interface AnalyzeStatus {
  state: 'idle' | 'no-source' | 'running' | 'error';
  /** The last numbers (for the card). */
  last: Analysis | null;
  ms: number | null;
  w: number;
  h: number;
  message?: string;
}

export interface AnalyzeHost {
  setTexture(nodeId: string, tex: THREE.Texture | null): void;
  requestRender(): void;
}

export interface AnalyzeFrameContext {
  renderer: THREE.WebGLRenderer;
  uniforms: Record<string, THREE.IUniform>;
  canvas: HTMLCanvasElement;
  playing: boolean;
}

/** Every Analyze node in a node list, inside groups too. */
export function analyzeNodesIn(nodes: readonly GraphNode[], out: GraphNode[] = []): GraphNode[] {
  for (const n of nodes) {
    if (n.type === ANALYZE_TYPE) out.push(n);
    const sg = n.params?.subgraph as SubgraphData | undefined;
    if (sg?.nodes?.length) analyzeNodesIn(sg.nodes, out);
  }
  return out;
}

/** The marks a compiled shader carries: the Analyze sampler → the sampler wired into it (or 'picture'). */
export function analyzeSources(shaders: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`${ANALYZE_SOURCE_MARK.replace(/[/]/g, '\\/')}(\\w+) (\\w+)`, 'g');
  for (const fs of shaders) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(fs || ''))) if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

const settingsKey = (n: GraphNode) => JSON.stringify(['resolution', 'threshold', 'smoothing'].map(k => n.params[k]));
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

interface Slot {
  node: GraphNode;
  status: AnalyzeStatus;
  last: Analysis | null;
  luma: Float32Array | null;
  tex: THREE.DataTexture | null;
  key: string;
  dirty: boolean;
}

const idleStatus = (): AnalyzeStatus => ({ state: 'idle', last: null, ms: null, w: 0, h: 0 });

class AnalyzeEngine {
  private host: AnalyzeHost | null = null;
  private slots = new Map<string, Slot>();
  private samplerNode = new Map<string, string>();
  private sources = new Map<string, string>();
  private grabber: Grabber | null = null;
  private canvas2d: HTMLCanvasElement | null = null;
  private listeners = new Set<() => void>();
  private lastNotify = 0;

  contextLost(): void {
    this.grabber?.drop(); this.grabber = null;
    for (const s of this.slots.values()) { s.tex?.dispose(); s.tex = null; }
  }

  setHost(host: AnalyzeHost | null): void {
    this.host = host;
    if (host) for (const [id, s] of this.slots) if (s.tex) host.setTexture(id, s.tex);
  }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) fn(); }

  status(nodeId: string): AnalyzeStatus { return this.slots.get(nodeId)?.status ?? idleStatus(); }

  sync(nodes: readonly GraphNode[]): void {
    const want = new Map(analyzeNodesIn(nodes).map(n => [n.id, n]));
    for (const [id, s] of this.slots) if (!want.has(id)) { s.tex?.dispose(); this.slots.delete(id); this.host?.setTexture(id, null); }
    let rerun = false;
    for (const [id, n] of want) {
      let s = this.slots.get(id);
      if (!s) { s = { node: n, status: idleStatus(), last: null, luma: null, tex: null, key: '', dirty: true }; this.slots.set(id, s); rerun = true; }
      s.node = n;
      const key = settingsKey(n);
      if (key !== s.key) { s.key = key; s.dirty = true; s.luma = null; rerun = true; }
    }
    if (rerun) this.host?.requestRender();
  }

  setProgram(shaders: readonly string[], textureUniforms: Record<string, string>): void {
    this.sources = analyzeSources(shaders);
    this.samplerNode.clear();
    for (const sampler of this.sources.keys()) { const id = textureUniforms[sampler]; if (id) this.samplerNode.set(sampler, id); }
    for (const s of this.slots.values()) s.dirty = true;
  }

  wants(playing: boolean): boolean {
    if (!this.samplerNode.size) return false;
    if (playing) return true;
    for (const s of this.slots.values()) if (s.dirty) return true;
    return false;
  }

  afterFrame(ctx: AnalyzeFrameContext): void {
    let notify = false;
    for (const [sampler, id] of this.samplerNode) {
      const s = this.slots.get(id);
      if (!s || (!ctx.playing && !s.dirty)) continue;
      s.dirty = false;
      const t0 = performance.now();
      const src = this.sources.get(sampler) ?? 'picture';
      const tex = src === 'picture' ? null : (ctx.uniforms[src]?.value as THREE.Texture | null | undefined) ?? null;
      const img = tex?.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined;
      const sw = tex ? img?.videoWidth || img?.width || 0 : ctx.canvas.width;
      const sh = tex ? img?.videoHeight || img?.height || 0 : ctx.canvas.height;
      if (src !== 'picture' && (!tex || !(sw > 0 && sh > 0))) {
        if (s.status.state !== 'no-source') { s.status = { ...idleStatus(), state: 'no-source', message: 'Its texture has no picture yet.' }; this.changed(); }
        continue;
      }
      const { w, h } = analyzeGrabSize(sw, sh, analyzeSideOf(s.node));
      let rgba: Uint8Array;
      try {
        if (tex) {
          this.grabber ??= new Grabber();
          rgba = this.grabber.grab(ctx.renderer, tex, w, h);
        } else {
          const c = (this.canvas2d ??= document.createElement('canvas'));
          if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
          const g = c.getContext('2d', { willReadFrequently: true });
          if (!g) continue;
          g.drawImage(ctx.canvas, 0, 0, w, h);
          rgba = flipRows(new Uint8Array(g.getImageData(0, 0, w, h).data.buffer), w, h);
        }
      } catch (e) {
        s.status = { ...s.status, state: 'error', message: e instanceof Error ? e.message : String(e) };
        this.changed();
        continue;
      }
      const sameSize = s.status.w === w && s.status.h === h;
      const { a, luma } = analyzeFrame(rgba, w, h, num(s.node.params.threshold, 0.5), sameSize ? s.luma : null);
      s.luma = luma;
      s.last = smoothAnalysis(sameSize ? s.last : null, a, num(s.node.params.smoothing, 0.3));
      this.upload(id, s);
      const first = s.status.state !== 'running';
      s.status = { state: 'running', last: s.last, ms: performance.now() - t0, w, h };
      if (first) this.changed(); else notify = true;
      if (!ctx.playing) this.host?.requestRender();
    }
    // The card's live numbers: a few times a second, not every frame.
    const now = performance.now();
    if (notify && now - this.lastNotify > 250) { this.lastNotify = now; this.changed(); }
  }

  private upload(id: string, s: Slot): void {
    let tex = s.tex;
    if (!tex) {
      tex = new THREE.DataTexture(new Float32Array(ANALYZE_TEXELS * 4), ANALYZE_TEXELS, 1, THREE.RGBAFormat, THREE.FloatType);
      tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.flipY = false;
      // Web pages don't measure yet: the export encodes this blank in its place.
      tex.userData.canvas8 = blankCanvas();
      s.tex = tex;
      this.host?.setTexture(id, tex);
    }
    if (s.last) packAnalysis(s.last, tex.image.data as Float32Array<ArrayBuffer>);
    tex.needsUpdate = true;
  }
}

let blank: HTMLCanvasElement | null = null;
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

export const analyzeEngine = new AnalyzeEngine();

/** For checking in dev: `window.__analyzeEngine`. */
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __analyzeEngine?: unknown }).__analyzeEngine = analyzeEngine;
