/**
 * render.ts — one Splat Scene's GPU side (docs/splat-scene.md): its splat textures, its probe, its back-to-front
 * order, and the instanced draw into two half-float targets (colour, and distance), which the node samples.
 *
 * Per frame (SplatPass.draw): the probe program (the picture's uniforms, compiler/splatGraph.ts) draws the camera and
 * placement into 8 × 1 float texels; the splats draw with them, in the last order the worker sent. The probe's texels
 * are read back without stalling (a pixel-pack buffer and a fence, polled next frame), only to decide when to sort.
 *
 * With a Modifier wired (docs/splat-scene.md "Per-splat modifiers"), the modifier program draws after the probe, one
 * texel per splat, into two targets the splat shader then reads (SPLAT_VERT_MOD). While it moves splats, the engine
 * asks for their depths (a small pass, four splats a texel) to be read back the same way, and sorts by those.
 */
import * as THREE from 'three';
import { SPLAT_DEPTH_FRAG, SPLAT_DEPTH_VERT, SPLAT_FRAG, SPLAT_VERT, SPLAT_VERT_MOD } from './shaders';
import { PACK_WIDTH, SH_WIDTH, type PackedSplats } from './pack';

/** The modifier targets' width (compiler/splatGraph.ts SPLAT_MOD_WIDTH): one texel per splat. */
export const MOD_WIDTH = 2048;
/** A modifier program's own uniform names (compiler/splatGraph.ts splatModUniformNames). */
export interface ModNames { data: string; probe: string; count: string; box?: string }

/** The probe's texels as numbers: eye, three rays, three model columns (w: size, opacity), offset. */
export type ProbeReading = Float32Array;

const quad = (() => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
});

function uintTexture(data: Uint32Array, w: number, h: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAIntegerFormat, THREE.UnsignedIntType);
  t.internalFormat = 'RGBA32UI';
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

let blank: HTMLCanvasElement | null = null;
/** A 1×1 clear canvas: what a web export carries for the splats (docs/web-export.md: not supported yet). */
function blankCanvas(): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  if (!blank) { blank = document.createElement('canvas'); blank.width = blank.height = 1; }
  return blank;
}

export class SplatPass {
  readonly target: THREE.WebGLRenderTarget;
  private probeTarget: THREE.WebGLRenderTarget;
  private probeMat: THREE.ShaderMaterial | null = null;
  private probeKey = '';
  private quadScene = new THREE.Scene();
  private quadMesh: THREE.Mesh;
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geometry: THREE.InstancedBufferGeometry;
  private order: THREE.InstancedBufferAttribute | null = null;
  private material: THREE.RawShaderMaterial;
  private mesh: THREE.Mesh;
  private scene = new THREE.Scene();
  private data: THREE.DataTexture | null = null;
  private sh: THREE.DataTexture | null = null;
  private count = 0;
  private pbo: WebGLBuffer | null = null;
  private fence: WebGLSync | null = null;
  private floatProbe: boolean;
  private splatUniforms: Record<string, THREE.IUniform>;
  // Per-splat modifiers: the program, its targets, the splat shader that reads them, and the moved-centres read.
  private modMat: THREE.ShaderMaterial | null = null;
  private modKey = '';
  private modNames: ModNames | null = null;
  private modTarget: THREE.WebGLRenderTarget | null = null;
  private modScene = new THREE.Scene();
  private modMesh: THREE.Mesh;
  private modSplatMat: THREE.RawShaderMaterial | null = null;
  private movedPbo: WebGLBuffer | null = null;
  private movedFence: WebGLSync | null = null;
  private movedBytes = 0;
  private spareDepths: Float32Array | null = null;
  private depthTarget: THREE.WebGLRenderTarget | null = null;
  private depthMat: THREE.RawShaderMaterial | null = null;
  private depthScene = new THREE.Scene();
  private depthMesh: THREE.Mesh;
  /** A modifier was asked for but this GPU has no float render targets: the scan draws unmodified. */
  modifierRefused = false;
  /** The last reading that came back (null until the first). */
  reading: ProbeReading | null = null;
  /** Bumped each time a reading arrives. */
  readings = 0;

  private renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.floatProbe = renderer.extensions.has('EXT_color_buffer_float');
    this.target = new THREE.WebGLRenderTarget(1, 1, { count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    for (const t of this.target.textures) { t.generateMipmaps = false; t.userData.canvas8 = blankCanvas(); }
    this.target.textures[0].name = 'splat-color';
    this.target.textures[1].name = 'splat-depth';
    this.probeTarget = new THREE.WebGLRenderTarget(8, 1, { type: this.floatProbe ? THREE.FloatType : THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.probeTarget.texture.generateMipmaps = false;
    this.quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);
    this.geometry = quad();
    this.splatUniforms = {
      u_data: { value: null }, u_sh: { value: null }, u_probe: { value: this.probeTarget.texture },
      u_shDeg: { value: 0 }, u_view: { value: new THREE.Vector2(1, 1) },
      u_modA: { value: null }, u_modB: { value: null },
    };
    this.material = this.splatMaterial(SPLAT_VERT);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.modMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.modMesh.frustumCulled = false;
    this.modScene.add(this.modMesh);
    this.depthMesh = new THREE.Mesh(this.modMesh.geometry);
    this.depthMesh.frustumCulled = false;
    this.depthScene.add(this.depthMesh);
  }

  /** The splat shader (both variants share one uniform table). */
  private splatMaterial(vertexShader: string): THREE.RawShaderMaterial {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader: SPLAT_FRAG,
      uniforms: this.splatUniforms,
      // Either winding: the quad's axes turn either way round depending on the ellipse.
      side: THREE.DoubleSide,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
  }

  // ── Per-splat modifiers (docs/splat-scene.md) ───────────────────────────────

  /**
   * The modifier program (compiler/splatGraph.ts), drawn with the picture's uniforms plus its own three (the splat
   * data, the probe, the count, by `names`), or none (null). Needs float render targets; without them the scan draws
   * unmodified and `modifierRefused` says so.
   */
  setModifier(vertexShader: string, fragmentShader: string | null, uniforms: Record<string, THREE.IUniform>, names: ModNames | null): void {
    if (!fragmentShader || !names || !this.floatProbe) {
      this.modifierRefused = !!fragmentShader && !this.floatProbe;
      if (this.modMat) { this.modMat.dispose(); this.modMat = null; this.modKey = ''; }
      this.modNames = null;
      return;
    }
    if (this.modMat && this.modKey === fragmentShader && this.modMat.uniforms === uniforms) return;
    this.modMat?.dispose();
    this.modMat = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    this.modKey = fragmentShader;
    this.modNames = names;
    this.modMesh.material = this.modMat;
    if (!this.modSplatMat) this.modSplatMat = this.splatMaterial(SPLAT_VERT_MOD);
  }

  hasModifier(): boolean { return !!this.modMat; }

  /** The scan's box for the modifier program: its middle (in its own coordinates) and its core radius. */
  private box = new THREE.Vector4(0, 0, 0, 1);
  setBox(center: readonly number[] | undefined, radius: number | undefined): void {
    this.box.set(center?.[0] ?? 0, center?.[1] ?? 0, center?.[2] ?? 0, radius && radius > 1e-6 ? radius : 1);
  }

  /** The two modifier targets, one texel per splat: (centre, size) as floats, (colour, opacity) as half floats. */
  private ensureModTarget(): THREE.WebGLRenderTarget {
    const rows = Math.max(1, Math.ceil(this.count / MOD_WIDTH));
    if (this.modTarget && this.modTarget.height === rows) return this.modTarget;
    this.modTarget?.dispose();
    const t = new THREE.WebGLRenderTarget(MOD_WIDTH, rows, { count: 2, type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    t.textures[1].type = THREE.HalfFloatType;
    for (const x of t.textures) x.generateMipmaps = false;
    this.modTarget = t;
    return t;
  }

  /** Draw the modifier program over every splat (after the probe, which it reads). */
  private runModifier(): void {
    const r = this.renderer, t = this.ensureModTarget(), u = this.modMat!.uniforms, nm = this.modNames!;
    const set = (k: string, value: unknown) => { if (u[k]) u[k].value = value; else u[k] = { value }; };
    set(nm.data, this.data);
    set(nm.probe, this.probeTarget.texture);
    set(nm.count, this.count);
    if (nm.box) set(nm.box, this.box);
    r.setRenderTarget(t);
    r.render(this.modScene, this.ortho);
    this.splatUniforms.u_modA.value = t.textures[0];
    this.splatUniforms.u_modB.value = t.textures[1];
  }

  /** The moved splats' depths along the camera's forward ray, four a texel (shaders.ts SPLAT_DEPTH_FRAG). */
  private runDepths(): THREE.WebGLRenderTarget {
    const rows = Math.max(1, Math.ceil(this.count / (4 * MOD_WIDTH)));
    if (!this.depthTarget || this.depthTarget.height !== rows) {
      this.depthTarget?.dispose();
      this.depthTarget = new THREE.WebGLRenderTarget(MOD_WIDTH, rows, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.depthTarget.texture.generateMipmaps = false;
    }
    if (!this.depthMat) {
      this.depthMat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: SPLAT_DEPTH_VERT, fragmentShader: SPLAT_DEPTH_FRAG,
        uniforms: { u_modA: { value: null }, u_probe: { value: this.probeTarget.texture }, u_count: { value: 0 } },
        depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      });
      this.depthMesh.material = this.depthMat;
    }
    this.depthMat.uniforms.u_modA.value = this.modTarget!.textures[0];
    this.depthMat.uniforms.u_count.value = this.count;
    const r = this.renderer;
    r.setRenderTarget(this.depthTarget);
    r.render(this.depthScene, this.ortho);
    return this.depthTarget;
  }

  /** A read of the moved splats' depths is on its way. */
  get movedPending(): boolean { return !!this.movedFence; }

  /**
   * Start reading the moved splats' depths back (for the sort): worked out on the GPU from this frame's modifier
   * targets, then a pixel-pack buffer and a fence, so nothing waits. They come back from pollDepths on a later frame.
   * False when there is nothing to read or a read is on its way.
   */
  startDepthRead(): boolean {
    if (!this.modTarget || !this.modMat || this.movedFence || this.count === 0) return false;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync !== 'function') return false;
    const prev = this.renderer.getRenderTarget();
    const t = this.runDepths();
    const bytes = MOD_WIDTH * t.height * 16;
    if (!this.movedPbo || this.movedBytes !== bytes) {
      if (this.movedPbo) gl.deleteBuffer(this.movedPbo);
      this.movedPbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.movedPbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.movedBytes = bytes;
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.movedPbo);
    gl.readPixels(0, 0, MOD_WIDTH, t.height, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.renderer.setRenderTarget(prev);
    this.movedFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    return true;
  }

  /** The moved splats' depths (splat i at [i], bigger is farther) once the read has landed, else null. */
  pollDepths(): Float32Array | null {
    if (!this.movedFence || !this.movedPbo) return null;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const st = gl.clientWaitSync(this.movedFence, 0, 0);
    if (st === gl.TIMEOUT_EXPIRED) return null;
    gl.deleteSync(this.movedFence);
    this.movedFence = null;
    if (st === gl.WAIT_FAILED) return null;
    const out = this.spareDepths && this.spareDepths.length * 4 === this.movedBytes ? this.spareDepths : new Float32Array(this.movedBytes / 4);
    this.spareDepths = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.movedPbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return out;
  }

  /** The moved splats' depths now (stalls: offline renders only; after runProbe). */
  readDepthsNow(): Float32Array | null {
    if (!this.modTarget || !this.modMat || this.count === 0) return null;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const prev = this.renderer.getRenderTarget();
    const t = this.runDepths();
    const out = new Float32Array(MOD_WIDTH * t.height * 4);
    gl.readPixels(0, 0, MOD_WIDTH, t.height, gl.RGBA, gl.FLOAT, out);
    this.renderer.setRenderTarget(prev);
    return out;
  }

  /** A buffer the sort has finished with: the next read lands in it (no allocation per sort). */
  recycleDepths(buf: Float32Array): void { this.spareDepths = buf; }


  get splatCount(): number { return this.count; }

  /** New splats (a load, or Max splats / SH degree changed). The order starts as file order until the first sort. */
  setSplats(p: PackedSplats): void {
    this.data?.dispose(); this.sh?.dispose();
    this.data = uintTexture(p.data, PACK_WIDTH, p.rows);
    this.sh = p.sh && p.shRows ? uintTexture(p.sh, SH_WIDTH, p.shRows) : null;
    this.count = p.count;
    const u = this.material.uniforms;
    u.u_data.value = this.data;
    u.u_sh.value = this.sh ?? this.data;
    u.u_shDeg.value = this.sh ? p.shDegree : 0;
    const order = new Uint32Array(p.count);
    for (let i = 0; i < p.count; i++) order[i] = i;
    this.setOrder(order);
  }

  /** The worker's far-to-near order. */
  setOrder(order: Uint32Array): void {
    if (this.order && this.order.array.length === order.length) {
      (this.order.array as Uint32Array).set(order);
      this.order.needsUpdate = true;
    } else {
      if (this.order) this.geometry.deleteAttribute('splatIndex');
      this.order = new THREE.InstancedBufferAttribute(order, 1);
      this.order.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute('splatIndex', this.order);
    }
    this.geometry.instanceCount = order.length;
  }

  /** The probe program (a fragment shader of the picture's kind), drawn with the picture's uniforms. */
  setProbe(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): void {
    const key = `${fragmentShader.length}:${fragmentShader}`;
    if (this.probeMat && this.probeKey === key && this.probeMat.uniforms === uniforms) return;
    this.probeMat?.dispose();
    this.probeMat = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    this.probeKey = key;
    this.quadMesh.material = this.probeMat;
  }

  hasProbe(): boolean { return !!this.probeMat; }

  /** Draw: the probe, then the splats into the targets (`w` × `h`), then ask for the probe's numbers. */
  draw(w: number, h: number, readBack = true): void {
    const r = this.renderer;
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const prev = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    if (this.probeMat) {
      // The picture's u_resolution stays: the probe reads g_uv from its texel, not the pixel.
      r.setRenderTarget(this.probeTarget);
      r.render(this.quadScene, this.ortho);
    }
    // The modifier program, over every splat, before the splats that read it.
    const modOn = this.modifierReady();
    if (modOn) this.runModifier();
    this.mesh.material = modOn ? this.modSplatMat! : this.material;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    if (this.count > 0 && this.probeMat && this.data) {
      (this.splatUniforms.u_view.value as THREE.Vector2).set(w, h);
      r.render(this.scene, this.ortho);
    }
    r.setClearColor(prevColor, prevAlpha);
    r.autoClear = prevAutoClear;
    if (readBack && this.probeMat) this.readProbe();
    r.setRenderTarget(prev);
  }

  /** Draw only the probe, and the modifier program after it (offline renders read them at once after). */
  runProbe(): void {
    if (!this.probeMat) return;
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(this.probeTarget);
    r.render(this.quadScene, this.ortho);
    if (this.modifierReady()) this.runModifier();
    r.setRenderTarget(prev);
  }

  private modifierReady(): boolean {
    return !!(this.modMat && this.modNames && this.modSplatMat && this.count > 0 && this.data && this.probeMat);
  }

  /** Read the probe now (stalls: offline renders only). */
  readProbeNow(): ProbeReading | null {
    if (!this.probeMat) return null;
    const out = new Float32Array(32);
    if (this.floatProbe) this.renderer.readRenderTargetPixels(this.probeTarget, 0, 0, 8, 1, out);
    else {
      const half = new Uint16Array(32);
      this.renderer.readRenderTargetPixels(this.probeTarget, 0, 0, 8, 1, half);
      for (let i = 0; i < 32; i++) out[i] = THREE.DataUtils.fromHalfFloat(half[i]);
    }
    this.reading = out;
    this.readings++;
    return out;
  }

  /** Poll last frame's read; start this frame's (WebGL2: a pixel-pack buffer and a fence, so nothing waits). */
  private readProbe(): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!this.floatProbe || typeof gl.fenceSync !== 'function') {
      // Without float targets the read is small and rare enough to do directly.
      if (this.readings === 0 || this.readings % 4 === 0) this.readProbeNow(); else this.readings++;
      return;
    }
    if (this.fence) {
      const st = gl.clientWaitSync(this.fence, 0, 0);
      if (st === gl.TIMEOUT_EXPIRED) return;
      gl.deleteSync(this.fence);
      this.fence = null;
      if (st !== gl.WAIT_FAILED) {
        const out = new Float32Array(32);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        this.reading = out;
        this.readings++;
      }
    }
    if (!this.pbo) {
      this.pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 32 * 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
    this.renderer.setRenderTarget(this.probeTarget);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, 8, 1, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  }

  /** The context was lost: let everything go (made again on the next use). */
  contextLost(): void {
    this.pbo = null; this.fence = null;
    this.movedPbo = null; this.movedFence = null;
  }

  dispose(): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    for (const f of [this.fence, this.movedFence]) if (f) { try { gl.deleteSync(f); } catch { /* lost */ } }
    for (const b of [this.pbo, this.movedPbo]) if (b) { try { gl.deleteBuffer(b); } catch { /* lost */ } }
    this.pbo = null; this.fence = null; this.movedPbo = null; this.movedFence = null;
    this.target.dispose(); this.probeTarget.dispose(); this.modTarget?.dispose(); this.depthTarget?.dispose();
    this.probeMat?.dispose(); this.material.dispose(); this.geometry.dispose();
    this.modMat?.dispose(); this.modSplatMat?.dispose(); this.depthMat?.dispose();
    this.data?.dispose(); this.sh?.dispose();
    (this.quadMesh.geometry as THREE.BufferGeometry).dispose();
    (this.modMesh.geometry as THREE.BufferGeometry).dispose();
  }
}
