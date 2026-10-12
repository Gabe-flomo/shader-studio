/**
 * passRunner.ts — draws Pass nodes' programs into their textures before the
 * final picture (docs/pass-node-plan.md). ShaderCanvas makes one only when the
 * compile has `passes`; a graph without a Pass node never reaches this file.
 *
 * Every pass program shares the preview's uniforms object by reference, so
 * sliders, Play mappings, takes, time, video, Data textures, u_prevFrame and
 * echo reach each program with no extra code. The runner adds three uniforms
 * per pass to that table: u_pass_<slug> (its texture this frame),
 * u_passprev_<slug> (last frame's, for its Previous output) and their `_px`
 * (one picture pixel in texture coordinates).
 *
 * Targets live in a PassTargets set: the live preview has one, an offline
 * render (renderAtTime) another, so a render never disturbs the preview's
 * Previous buffers (the rule OfflineHistory follows for feedback).
 */
import * as THREE from 'three';
import type { PassProgram } from '../compiler/types';
import { passIterUniform, passPrevTargetUniform, passPrevUniform, passPxUniform, passTargetUniform, passUniform } from '../nodes/definitions/passes';

type Uniforms0 = Record<string, THREE.IUniform>;
/** A pass's textures as its samplers: every target of `rt` (MRT: textures[k] is target k), or none. */
function bindCur(u: Uniforms0, slug: string, rt: THREE.WebGLRenderTarget | null): void {
  if (u[passUniform(slug)]) u[passUniform(slug)].value = rt ? rt.textures[0] : null;
  for (let k = 1; rt ? k < rt.textures.length : k <= 3; k++) { const n = passTargetUniform(slug, k); if (u[n]) u[n].value = rt ? rt.textures[k] : null; }
}
/** Its frame before, the same way. */
function bindPrev(u: Uniforms0, slug: string, rt: THREE.WebGLRenderTarget): void {
  if (u[passPrevUniform(slug)]) u[passPrevUniform(slug)].value = rt.textures[0];
  for (let k = 1; k < rt.textures.length; k++) { const n = passPrevTargetUniform(slug, k); if (u[n]) u[n].value = rt.textures[k]; }
}
import { THUMB_FS, THUMB_MODES, bigThumbKey, drawArrows, readTexel, thumbViewOf } from './thumbView';
import { ppDrawn, ppKeeps, ppPixel, ppPrevBound, ppRepeat, ppSize, ppSplitsForParticles, ppStaged, ppTargetKey } from '../play/kit/passPlan.js';
import { CanvasProbeRegistry } from './canvasProbeRegistry';

/** Pass cards register a canvas here (by node id); the live runner draws their thumbnails into it. */
export const passThumbRegistry = new CanvasProbeRegistry();


type Uniforms = Record<string, THREE.IUniform>;

interface Entry { spec: PassProgram; material: THREE.ShaderMaterial; ready: boolean; failed: boolean; dropped?: boolean; reads?: string[] }

/** `drawn`: what a Shader Texture's target was last drawn with (passPlan ppKeeps); unset when new or cleared. */
interface Target { key: string; w: number; h: number; cur: THREE.WebGLRenderTarget; prev: THREE.WebGLRenderTarget | null; drawn?: string }

/**
 * The uniforms a program reads: those it declares and names again after the declaration (every
 * program declares Time, the mouse and so on; only one that uses them changes with them).
 */
export function uniformsRead(fragmentShader: string, skip: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const m of fragmentShader.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)) {
    const name = m[1];
    if (skip.has(name) || out.includes(name)) continue;
    const uses = fragmentShader.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0;
    if (uses > 1) out.push(name);
  }
  return out;
}

/** A uniform's value as text, for telling whether it changed (textures by id and version). */
export function uniformSig(v: unknown): string {
  if (v == null) return '-';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return String(v);
  if (Array.isArray(v)) return v.map(uniformSig).join(',');
  if (typeof v === 'object') {
    const o = v as { isTexture?: boolean; id?: number; version?: number; toArray?: () => number[] };
    if (o.isTexture) return `t${o.id}:${o.version}`;
    if (typeof o.toArray === 'function') return o.toArray().join(',');
  }
  return '?';
}

const WRAP: Record<PassProgram['wrap'], THREE.Wrapping> = {
  clamp: THREE.ClampToEdgeWrapping, repeat: THREE.RepeatWrapping, mirror: THREE.MirroredRepeatWrapping,
};

/** One set of textures for the passes: the live preview's, or an offline render's. */
export class PassTargets {
  private targets = new Map<string, Target>();
  private renderer: THREE.WebGLRenderer;
  private halfFloat: boolean;

  constructor(renderer: THREE.WebGLRenderer, halfFloat: boolean) { this.renderer = renderer; this.halfFloat = halfFloat; }

  /** The pass's targets for a picture of w × h, made (and cleared) when its size or settings change. */
  ensure(p: PassProgram, w: number, h: number): Target {
    const key = ppTargetKey(p, w, h);
    let t = this.targets.get(p.slug);
    if (t && t.key === key) return t;
    if (t) { t.cur.dispose(); t.prev?.dispose(); }
    const [tw, th] = ppSize(w, h, p.scale, p.size);
    // Full float (32-bit, for data): only where the GPU can draw into it, else half float. Smooth reads of
    // it need OES_texture_float_linear; without that it reads exact texels.
    const ext = this.renderer.extensions;
    const full = p.format === 'float' && this.halfFloat && ext.has('EXT_color_buffer_float');
    const filter = p.filter === 'nearest' || (full && !ext.has('OES_texture_float_linear')) ? THREE.NearestFilter : THREE.LinearFilter;
    const make = () => {
      const rt = new THREE.WebGLRenderTarget(tw, th, {
        type: p.format === 'byte' || !this.halfFloat ? THREE.UnsignedByteType : full ? THREE.FloatType : THREE.HalfFloatType,
        format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
        minFilter: filter, magFilter: filter, wrapS: WRAP[p.wrap], wrapT: WRAP[p.wrap],
        // MRT (docs/render-targets.md): one attachment per target, drawn in the same draw.
        count: 1 + (p.extra?.length ?? 0),
      });
      // Each extra target keeps its own precision and filter.
      (p.extra ?? []).forEach((x, i) => {
        const tex = rt.textures[i + 1];
        const xFull = x.format === 'float' && this.halfFloat && ext.has('EXT_color_buffer_float');
        tex.type = x.format === 'byte' || !this.halfFloat ? THREE.UnsignedByteType : xFull ? THREE.FloatType : THREE.HalfFloatType;
        const f = x.filter === 'nearest' || (xFull && !ext.has('OES_texture_float_linear')) ? THREE.NearestFilter : THREE.LinearFilter;
        tex.minFilter = f; tex.magFilter = f;
      });
      this.renderer.setRenderTarget(rt); this.renderer.clear();
      return rt;
    };
    t = { key, w: tw, h: th, cur: make(), prev: p.previous ? make() : null };
    this.renderer.setRenderTarget(null);
    this.targets.set(p.slug, t);
    return t;
  }

  /** Start every Previous buffer over (black): a new render, a resize, a structural recompile. */
  clearPrevious(): void {
    for (const t of this.targets.values()) {
      t.drawn = undefined;
      for (const rt of [t.cur, t.prev]) { if (!rt) continue; this.renderer.setRenderTarget(rt); this.renderer.clear(); }
    }
    this.renderer.setRenderTarget(null);
  }

  get(slug: string): Target | undefined { return this.targets.get(slug); }

  /** Drop the targets of passes no longer in the graph. */
  prune(keep: ReadonlySet<string>): void {
    for (const [slug, t] of this.targets) if (!keep.has(slug)) { t.cur.dispose(); t.prev?.dispose(); this.targets.delete(slug); }
  }

  dispose(): void {
    for (const t of this.targets.values()) { t.cur.dispose(); t.prev?.dispose(); }
    this.targets.clear();
  }
}

export interface PassRunnerHost {
  renderer: THREE.WebGLRenderer;
  geometry: THREE.BufferGeometry;
  camera: THREE.Camera;
  /** The preview's uniforms object (it changes only on a GPU rebuild). */
  uniforms: () => Uniforms;
  /** A program finished compiling: draw a frame. */
  onReady: () => void;
  /** A program didn't link: report the driver's log against its source. */
  onLinkFailed: (fragmentShader: string) => void;
}

export class PassRunner {
  private host: PassRunnerHost;
  private entries: Entry[] = [];
  private scene = new THREE.Scene();
  private mesh: THREE.Mesh;
  private compileScene = new THREE.Scene();
  private compileMesh: THREE.Mesh;
  private boundTo: Uniforms | null = null;
  private bindEpoch = 0;
  private vertexShader = '';
  // Thumbnails: a small 8-bit copy of a pass, read back into its card's canvas.
  private thumbRt: THREE.WebGLRenderTarget | null = null;
  private thumbBuf: Uint8Array | null = null;
  private thumbMat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position, 1.0); }',
    fragmentShader: THUMB_FS,
    uniforms: { t: { value: null }, mode: { value: 0 }, lo: { value: 0 }, hi: { value: 1 } }, depthTest: false, depthWrite: false,
  });

  constructor(host: PassRunnerHost) {
    this.host = host;
    this.mesh = new THREE.Mesh(host.geometry, this.thumbMat);
    this.scene.add(this.mesh);
    this.compileMesh = new THREE.Mesh(host.geometry, this.thumbMat);
    this.compileScene.add(this.compileMesh);
  }

  get passes(): readonly PassProgram[] { return this.entries.map(e => e.spec); }
  /** Some pass keeps its previous frame: the preview keeps drawing while the clock runs. */
  /** Every program compiled (or failed): a render started now draws them all (lib/bake/runner.ts waits for this). */
  get settled(): boolean { return this.entries.every(e => e.ready || e.failed); }
  get hasPrevious(): boolean { return this.entries.some(e => e.spec.live && e.spec.previous); }
  /** Some pass the frame draws is read by the Particles nodes: run part 'particles' before them, then 'rest'. */
  get splitsForParticles(): boolean { return ppSplitsForParticles(ppDrawn(this.entries.map(e => e.spec))); }

  /** The uniforms each pass adds to the shared table. */
  private ensureUniforms(): void {
    const u = this.host.uniforms();
    for (const { spec } of this.entries) {
      const names = [passUniform(spec.slug), passPrevUniform(spec.slug)];
      (spec.extra ?? []).forEach((_, i) => names.push(passTargetUniform(spec.slug, i + 1), passPrevTargetUniform(spec.slug, i + 1)));
      for (const name of names) {
        if (!u[name]) u[name] = { value: null };
        const px = passPxUniform(name);
        if (!u[px] || !(u[px].value instanceof THREE.Vector2)) u[px] = { value: new THREE.Vector2(1, 1) };
      }
      // Repeat: the step uniform ([step, count]), only for a repeated pass (it alone declares it).
      if (ppRepeat(spec) > 1) {
        const it = passIterUniform(spec.slug);
        if (!u[it] || !(u[it].value instanceof THREE.Vector2)) u[it] = { value: new THREE.Vector2(0, ppRepeat(spec)) };
      }
    }
    if (this.boundTo !== u) {
      for (const e of this.entries) e.material.uniforms = u;
      this.boundTo = u;
      // A Shader Texture kept from before this (re)binding may have been drawn with uniforms not yet in the table.
      this.bindEpoch++;
    }
  }

  /**
   * Take a new compile's passes. Programs whose source is unchanged are kept
   * (a slider never gets here: it changes uniforms, not source); the others
   * compile off to the side and draw once linked.
   */
  update(passes: readonly PassProgram[], vertexShader: string): void {
    const old = new Map(this.entries.map(e => [e.spec.slug, e]));
    const vsChanged = vertexShader !== this.vertexShader;
    this.vertexShader = vertexShader;
    const u = this.host.uniforms();
    this.entries = passes.map(spec => {
      const prev = old.get(spec.slug);
      if (prev && !vsChanged && prev.material.fragmentShader === spec.fragmentShader) {
        old.delete(spec.slug);
        prev.spec = spec; // in place: a compile still settling holds this object
        return prev;
      }
      const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader: spec.fragmentShader, uniforms: u, depthTest: false, depthWrite: false });
      return { spec, material, ready: false, failed: false };
    });
    for (const e of old.values()) this.drop(e);
    this.boundTo = null;
    this.ensureUniforms();
    for (const e of this.entries) if (!e.ready && !e.failed) this.compile(e);
  }

  /** Dispose a program; one still compiling goes once its compile settles (three.js polls it until then). */
  private drop(e: Entry): void {
    e.dropped = true;
    if (e.ready || e.failed) e.material.dispose();
  }

  private compile(e: Entry): void {
    const { renderer, camera } = this.host;
    this.compileMesh.material = e.material;
    const settle = () => {
      e.ready = true;
      if (e.dropped) { e.material.dispose(); return; }
      const gl = renderer.getContext();
      const prog = (renderer.properties.get(e.material) as { currentProgram?: { program?: WebGLProgram } }).currentProgram?.program;
      if (prog && gl.getProgramParameter(prog, gl.LINK_STATUS) === false) { e.failed = true; this.host.onLinkFailed(e.spec.fragmentShader); }
      this.host.onReady();
    };
    renderer.compileAsync(this.compileScene, camera).then(settle, () => { e.failed = true; if (e.dropped) e.material.dispose(); });
    this.compileMesh.material = this.thumbMat;
  }

  /** The WebGL context was lost: the thumbnail target goes now (made again on its next use), while deleting is a no-op. */
  contextLost(): void {
    this.thumbRt?.dispose();
    this.thumbRt = null;
  }

  /** Compile every program again (after the GPU context was rebuilt). */
  recompileAll(): void {
    const passes = this.entries.map(e => e.spec);
    const vs = this.vertexShader;
    for (const e of this.entries) this.drop(e);
    this.entries = [];
    this.vertexShader = '';
    this.update(passes, vs);
  }

  /**
   * Draw the passes the picture needs into `targets`, for a picture of w × h,
   * and bind their textures for the final program. `time` labels GPU timers
   * (live only). u_resolution is each pass's own size while it draws. `stage`
   * (graphs with agents only) draws just the passes before ('pre') or after
   * ('post') the agents step. `part` (when splitsForParticles) draws the passes
   * the particles read ('particles', before them) or the others ('rest').
   */
  run(targets: PassTargets, w: number, h: number, timer?: { begin(name: string): boolean; end(): void }, stage?: 'pre' | 'post', part?: 'particles' | 'rest'): void {
    this.ensureUniforms();
    const u = this.host.uniforms();
    const { renderer, camera } = this.host;
    const drawn = ppDrawn(this.entries.map(e => ({ ...e.spec, entry: e })));
    targets.prune(new Set(drawn.map(d => d.slug)));
    const [pxX, pxY] = ppPixel(w, h);
    // Every pass's previous frame first: a pass earlier in the order may read a later one's Previous.
    // (Not a pass an earlier call this frame drew: its sampler keeps the frame before: ppPrevBound.)
    const fresh = new Set(ppPrevBound(drawn, stage, part).map(d => d.slug));
    for (const d of drawn) {
      const t = targets.ensure(d, w, h);
      if (t.prev && fresh.has(d.slug)) bindPrev(u, d.slug, t.prev);
      for (let k = 0; k <= (d.extra?.length ?? 0); k++) {
        (u[passPxUniform(passTargetUniform(d.slug, k))].value as THREE.Vector2).set(pxX, pxY);
        (u[passPxUniform(passPrevTargetUniform(d.slug, k))].value as THREE.Vector2).set(pxX, pxY);
      }
    }
    const res = u.u_resolution?.value as THREE.Vector2 | undefined;
    const rx = res?.x ?? w, ry = res?.y ?? h;
    // A pass whose input pass is still compiling waits for it (a board seeded from a start picture
    // would otherwise take the picture's empty texture as its start, and keep it).
    const compiling = new Set(this.entries.filter(x => !x.ready && !x.failed).map(x => x.spec.slug));
    // With agents (lib/agentRunner.ts) the frame draws passes in two stages: before the agents step, and after it.
    for (const d of ppStaged(drawn, stage, part)) {
      const t = targets.get(d.slug)!;
      const e = d.entry;
      if (!e.ready || e.failed || (compiling.size > 0 && d.reads.some(r => compiling.has(r)))) { bindCur(u, d.slug, null); continue; }
      res?.set(t.w, t.h);
      // A Shader Texture on Update On change / Once (docs/texture-builder.md): keep the picture it has when
      // nothing it reads changed since it was drawn into this target.
      const sig = d.update ? this.drawSig(e, t, u) : undefined;
      if (sig !== undefined && ppKeeps(d, t.drawn, sig)) { bindCur(u, d.slug, t.cur); continue; }
      t.drawn = sig;
      this.mesh.material = e.material;
      const timed = timer?.begin(`pass:${d.slug}`) ?? false;
      // Repeat (phase 7): N draws, each reading the one before through Previous (the timer covers all N).
      const n = ppRepeat(d);
      const iter = n > 1 ? u[passIterUniform(d.slug)]?.value as THREE.Vector2 | undefined : undefined;
      for (let i = 0; i < n; i++) {
        if (iter) iter.set(i, n);
        if (i > 0 && t.prev) bindPrev(u, d.slug, t.prev);
        renderer.setRenderTarget(t.cur);
        renderer.render(this.scene, camera);
        bindCur(u, d.slug, t.cur);
        // Ping-pong: this frame's picture is the next frame's Previous (and the next repeat's).
        if (t.prev) { const c = t.cur; t.cur = t.prev; t.prev = c; }
      }
      if (timed) timer!.end();
    }
    res?.set(rx, ry);
    renderer.setRenderTarget(null);
  }

  /** What a Shader Texture would be drawn with now: its program and target, and (On change) the values it reads. */
  private drawSig(e: Entry, t: Target, u: Uniforms): string {
    const head = `${e.material.uuid}|${t.key}|${this.bindEpoch}`;
    if (e.spec.update !== 'change') return head;
    e.reads ??= uniformsRead(e.spec.fragmentShader, new Set([passUniform(e.spec.slug), passPrevUniform(e.spec.slug), ...(e.spec.stillTime ? ['u_time'] : [])]));
    let sig = head;
    for (const name of e.reads) sig += `|${uniformSig(u[name]?.value)}`;
    return sig;
  }

  /**
   * Thumbnails for the Pass cards that are showing (the live runner, every few frames), and a Data
   * Texture's big view (`<id>#big`). A canvas's dataset picks the view (thumbView.ts): Raw, Range,
   * Channels or Arrows, its Min…Max, its width, and a point to read exactly (`probe`).
   */
  drawThumbnails(targets: PassTargets): void {
    for (const { spec } of this.entries) {
      for (const key of [spec.nodeId, bigThumbKey(spec.nodeId)]) {
        const canvas = passThumbRegistry.get(key);
        if (canvas) this.drawThumb(canvas, targets.get(spec.slug));
      }
    }
  }

  private drawThumb(canvas: HTMLCanvasElement, t: ReturnType<PassTargets['get']>): void {
    const { renderer, camera } = this.host;
    {
      const tex = t ? (t.prev ?? t.cur).texture : null;
      const view = thumbViewOf(canvas.dataset);
      // After the swap, prev holds the picture just drawn.
      const W = view.width, H = Math.max(8, Math.round(W * (t ? t.h / t.w : 9 / 16)));
      if (!this.thumbRt || this.thumbRt.height !== H || this.thumbRt.width !== W) {
        this.thumbRt?.dispose();
        this.thumbRt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false });
        this.thumbBuf = new Uint8Array(W * H * 4);
      }
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (!tex) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
      this.thumbMat.uniforms.t.value = tex;
      this.thumbMat.uniforms.mode.value = THUMB_MODES.indexOf(view.mode);
      this.thumbMat.uniforms.lo.value = view.lo;
      this.thumbMat.uniforms.hi.value = view.hi;
      this.mesh.material = this.thumbMat;
      renderer.setRenderTarget(this.thumbRt);
      renderer.render(this.scene, camera);
      renderer.readRenderTargetPixels(this.thumbRt, 0, 0, W, H, this.thumbBuf!);
      renderer.setRenderTarget(null);
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) img.data.set(this.thumbBuf!.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      if (view.mode === 'arrows') drawArrows(ctx, img, view);
      else ctx.putImageData(img, 0, 0);
      canvas.dataset.size = t ? `${t.w}×${t.h}` : '';
      // A point to read exactly (the big view's cursor): the stored texel, at full precision.
      if (t && view.probe) canvas.dataset.probeValue = readTexel(renderer, t.prev ?? t.cur, view.probe[0], view.probe[1]).map(v => v.toPrecision(5)).join(',');
    }
  }

  dispose(): void {
    for (const e of this.entries) this.drop(e);
    const u = this.boundTo;
    if (u) for (const { spec } of this.entries) {
      for (let k = 0; k <= (spec.extra?.length ?? 0); k++) for (const name of [passTargetUniform(spec.slug, k), passPrevTargetUniform(spec.slug, k)]) if (u[name]) u[name].value = null;
    }
    this.entries = [];
    this.thumbRt?.dispose();
    this.thumbMat.dispose();
  }
}

