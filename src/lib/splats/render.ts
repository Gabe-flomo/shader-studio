/**
 * render.ts — one Splat Scene's GPU side (docs/splat-scene.md): its splat textures, its probe, its back-to-front
 * order, and the instanced draw into two half-float targets (colour, and distance), which the node samples.
 *
 * Per frame (SplatPass.draw): the probe program (the picture's uniforms, compiler/splatGraph.ts) draws the camera and
 * placement into 8 × 1 float texels; the splats draw with them, in the last order the worker sent. The probe's texels
 * are read back without stalling (a pixel-pack buffer and a fence, polled next frame), only to decide when to sort.
 */
import * as THREE from 'three';
import { SPLAT_FRAG, SPLAT_VERT } from './shaders';
import { PACK_WIDTH, SH_WIDTH, type PackedSplats } from './pack';

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
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SPLAT_VERT,
      fragmentShader: SPLAT_FRAG,
      uniforms: {
        u_data: { value: null }, u_sh: { value: null }, u_probe: { value: this.probeTarget.texture },
        u_shDeg: { value: 0 }, u_view: { value: new THREE.Vector2(1, 1) },
      },
      // Either winding: the quad's axes turn either way round depending on the ellipse.
      side: THREE.DoubleSide,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

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
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    if (this.count > 0 && this.probeMat && this.data) {
      (this.material.uniforms.u_view.value as THREE.Vector2).set(w, h);
      r.render(this.scene, this.ortho);
    }
    r.setClearColor(prevColor, prevAlpha);
    r.autoClear = prevAutoClear;
    if (readBack && this.probeMat) this.readProbe();
    r.setRenderTarget(prev);
  }

  /** Draw only the probe (offline renders read it at once after). */
  runProbe(): void {
    if (!this.probeMat) return;
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(this.probeTarget);
    r.render(this.quadScene, this.ortho);
    r.setRenderTarget(prev);
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
  }

  dispose(): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (this.fence) { try { gl.deleteSync(this.fence); } catch { /* lost */ } }
    if (this.pbo) { try { gl.deleteBuffer(this.pbo); } catch { /* lost */ } }
    this.pbo = null; this.fence = null;
    this.target.dispose(); this.probeTarget.dispose();
    this.probeMat?.dispose(); this.material.dispose(); this.geometry.dispose();
    this.data?.dispose(); this.sh?.dispose();
    (this.quadMesh.geometry as THREE.BufferGeometry).dispose();
  }
}
