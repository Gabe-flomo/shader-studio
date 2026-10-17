/**
 * The GPU side of the preview Overlay: a few times a second the chosen space (a vec2 output) and,
 * in Position mode, the chosen point are drawn into a small float target with the picture's own
 * uniforms and read back asynchronously (as the eye preview's valuePreviewRunner does). The values
 * are the picture's: u_resolution stays the canvas's size and gl_FragCoord is scaled up to it, so
 * Pixel Coordinates reads real pixels. The result goes to overlayBus; nothing is drawn on screen.
 */
import * as THREE from 'three';
import type { GraphNode } from '../../types/nodeGraph';
import { inject } from '../nodePreview/previewGlsl';
import { SAMPLE_MS } from '../nodePreview/valuePreviewRunner';
import { overlayBus } from './overlayBus';
import { plainUvField, type Field2 } from './overlayMath';
import { overlayKey, useOverlay, type SocketRef } from './overlayStore';

/** Texels read back (96 × 54 at 16:9; the shape follows the picture). */
export const OVERLAY_TEXELS = 96 * 54;

export function overlayTargetSize(canvasW: number, canvasH: number): [number, number] {
  const asp = Math.max(1 / 16, Math.min(16, canvasW / Math.max(1, canvasH)));
  const w = Math.max(4, Math.round(Math.sqrt(OVERLAY_TEXELS * asp)));
  return [w, Math.max(4, Math.round(w / asp))];
}

/**
 * The picture's shader with gl_FragCoord scaled to the canvas, ending in vec4(space, position), or
 * with an SDF (Shape mode) vec4(space, distance, 0).
 */
export function buildOverlayShader(fs: string, spaceVar: string | null, posVar: string | null, sdfVar: string | null = null): string | null {
  const scaled = fs.replace(/\bgl_FragCoord\b/g, '(gl_FragCoord * vec4(u_ovScale, 1.0, 1.0))');
  const at = scaled.search(/^\s*uniform\s/m);
  const withU = at >= 0 ? `${scaled.slice(0, at)}\nuniform vec2 u_ovScale;\n${scaled.slice(at)}` : null;
  const src = withU ?? scaled;
  return inject(src, withU ? '' : 'uniform vec2 u_ovScale;\n', `  gl_FragColor = vec4(${spaceVar ? `vec2(${spaceVar})` : 'vec2(0.0)'}, ${sdfVar ? `float(${sdfVar}), 0.0` : posVar ? `vec2(${posVar})` : 'vec2(0.0)'});`);
}

type Uniforms = Record<string, THREE.IUniform>;

export class OverlayRunner {
  private rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private mesh: THREE.Mesh;
  private dummy = new THREE.ShaderMaterial();
  private mats = new Map<string, THREE.ShaderMaterial>();
  private lastFs = '';
  private pending = false;
  private lastSample = -Infinity;
  private gen = 0;
  private lastKey = '';
  private lastCpu = '';
  private scale = new THREE.Vector2(1, 1);
  private ready = new WeakSet<THREE.ShaderMaterial>();
  private compiling = new WeakSet<THREE.ShaderMaterial>();
  private broken = new WeakSet<THREE.ShaderMaterial>();
  private disposeLater = new WeakSet<THREE.ShaderMaterial>();

  private renderer: THREE.WebGLRenderer;
  private camera: THREE.Camera;
  private quietly: <T>(fn: () => T) => T;
  private requestRender: () => void;

  constructor(renderer: THREE.WebGLRenderer, camera: THREE.Camera, quietly: <T>(fn: () => T) => T, requestRender: () => void) {
    this.renderer = renderer;
    this.camera = camera;
    this.quietly = quietly;
    this.requestRender = requestRender;
    this.rt = new THREE.WebGLRenderTarget(96, 54, {
      type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dummy);
    this.scene.add(this.mesh);
  }

  private isReady(m: THREE.ShaderMaterial): boolean {
    if (this.broken.has(m)) return false;
    if (this.ready.has(m)) return true;
    if (this.compiling.has(m)) return false;
    this.compiling.add(m);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(this.mesh.geometry, m));
    const settle = (ok: boolean) => {
      const prog = (this.renderer.properties.get(m) as { currentProgram?: { program?: WebGLProgram } }).currentProgram?.program;
      const gl = this.renderer.getContext();
      if (!ok || (prog && gl.getProgramParameter(prog, gl.LINK_STATUS) === false)) this.broken.add(m); else this.ready.add(m);
      if (this.disposeLater.has(m)) m.dispose(); else this.requestRender();
    };
    try {
      this.quietly(() => this.renderer.compileAsync(scene, this.camera)).then(() => settle(true), () => settle(false));
    } catch { this.broken.add(m); }
    return false;
  }

  private disposeMat = (m: THREE.ShaderMaterial) => {
    if (this.compiling.has(m) && !this.ready.has(m) && !this.broken.has(m)) this.disposeLater.add(m);
    else m.dispose();
  };

  /**
   * Read the overlay's space / position, at most every SAMPLE_MS while animating (`force`: a frame
   * drawn on demand always samples), one readback in flight. Off: clears the bus.
   */
  sample(fs: string, vs: string, main: THREE.ShaderMaterial, canvasW: number, canvasH: number, force: boolean,
    varMap: Map<string, Record<string, string>>, declares: (fs: string, v: string) => boolean) {
    const st = useOverlay.getState();
    if (st.mode === 'off') {
      if (this.lastKey) { this.lastKey = ''; this.lastCpu = ''; this.gen++; overlayBus.clear(); }
      return;
    }
    const posRef: SocketRef | null = st.mode === 'position' ? st.position : null;
    const sdfRef: SocketRef | null = st.mode === 'shape' ? st.sdf : null;
    const key = overlayKey(st);
    if (key !== this.lastKey) { this.lastKey = key; this.gen++; this.pending = false; }
    const [w, h] = overlayTargetSize(canvasW, canvasH);
    const plain = plainUvField(w, h, canvasW / Math.max(1, canvasH));

    // Plain UV and no point: nothing to read, the values are the convention itself
    if (!st.space && !posRef && st.mode !== 'shape') {
      const cpu = `${key}|${canvasW}x${canvasH}`;
      if (cpu !== this.lastCpu) { this.lastCpu = cpu; overlayBus.publish({ space: plain, plain, sdf: null, pos: null, error: null, key }); }
      return;
    }
    this.lastCpu = '';
    const fail = (error: string) => {
      const cur = overlayBus.get();
      if (cur?.key !== key || cur.error !== error) overlayBus.publish({ space: null, plain, sdf: null, pos: null, error, key });
    };
    const varOf = (r: SocketRef | null) => (r ? varMap.get(r.nodeId)?.[r.outputKey] ?? null : null);
    const spaceVar = varOf(st.space), posVar = varOf(posRef), sdfVar = varOf(sdfRef);
    if (st.space && (!spaceVar || !declares(fs, spaceVar))) return fail("The space isn't in the picture's shader (wired to the output?)");
    if (posRef && (!posVar || !declares(fs, posVar))) return fail("The position isn't in the picture's shader (wired to the output?)");
    if (st.mode === 'position' && !posRef) return fail('Pick a position');
    if (st.mode === 'shape' && !sdfRef) return fail('Pick an SDF (a float distance output)');
    if (sdfRef && (!sdfVar || !declares(fs, sdfVar))) return fail("The SDF isn't in the picture's shader (wired to the output?)");

    const now = performance.now();
    if (this.pending || (!force && now - this.lastSample < SAMPLE_MS)) return;
    if (fs !== this.lastFs) { this.lastFs = fs; this.mats.forEach(this.disposeMat); this.mats.clear(); }
    const mkey = `${spaceVar ?? ''}|${posVar ?? ''}|${sdfVar ?? ''}`;
    let m = this.mats.get(mkey);
    if (!m) {
      const src = buildOverlayShader(fs, spaceVar, posVar, sdfVar);
      if (!src) return fail("Can't read the picture's shader");
      m = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: src, uniforms: { u_ovScale: { value: this.scale } } });
      this.mats.set(mkey, m);
    }
    // The picture's uniforms by reference (time, sliders, textures, its real size and pointer)
    const u: Uniforms = m.uniforms;
    for (const k in main.uniforms) if (u[k] !== main.uniforms[k]) u[k] = main.uniforms[k];
    if (this.broken.has(m)) return fail("This output can't be read on its own (declared inside a block?)");
    if (!this.isReady(m)) return;
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const res = main.uniforms.u_resolution?.value as THREE.Vector2 | undefined;
    this.scale.set((res?.x || canvasW) / w, (res?.y || canvasH) / h);

    this.mesh.material = m;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
    this.mesh.material = this.dummy;

    const buf = new Float32Array(w * h * 4);
    this.pending = true;
    this.lastSample = now;
    const gen = this.gen;
    const hasSpace = !!st.space;
    this.renderer.readRenderTargetPixelsAsync(this.rt, 0, 0, w, h, buf).then(() => {
      this.pending = false;
      if (gen !== this.gen) return;
      let space: Field2 = plain;
      if (hasSpace) {
        const data = new Float32Array(w * h * 2);
        for (let k = 0; k < w * h; k++) { data[k * 2] = buf[k * 4]; data[k * 2 + 1] = buf[k * 4 + 1]; }
        space = { data, w, h };
      }
      let sdf: Float32Array | null = null;
      if (sdfRef) {
        sdf = new Float32Array(w * h);
        for (let k = 0; k < w * h; k++) sdf[k] = buf[k * 4 + 2];
      }
      let pos: [number, number] | null = null;
      if (posRef) {
        const c = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4;
        pos = [buf[c + 2], buf[c + 3]];
      }
      overlayBus.publish({ space, plain, sdf, pos, error: null, key });
    }, () => { this.pending = false; });
  }

  reset() {
    this.mats.forEach(this.disposeMat); this.mats.clear();
    this.lastFs = ''; this.pending = false; this.gen++; this.lastCpu = '';
    this.rt.dispose();
  }

  dispose() {
    this.mats.forEach(this.disposeMat); this.mats.clear();
    this.rt.dispose();
    (this.mesh.geometry as THREE.BufferGeometry).dispose();
    this.dummy.dispose();
    overlayBus.clear();
  }
}

/**
 * The float outputs an SDF can be picked from (groups included), SDF nodes first: a 2D primitive
 * or SDF-category node, or an output called distance.
 */
export function sdfOutputs(nodes: readonly GraphNode[], label: (n: GraphNode) => string, isSdfNode: (n: GraphNode) => boolean, inGroup = ''): Array<{ ref: SocketRef; label: string; type: string; group: string; sdf: boolean }> {
  const out: Array<{ ref: SocketRef; label: string; type: string; group: string; sdf: boolean }> = [];
  const walk = (list: readonly GraphNode[], group: string) => {
    for (const n of list) {
      for (const [k, o] of Object.entries(n.outputs ?? {})) {
        if (o.type === 'float') out.push({ ref: { nodeId: n.id, outputKey: k }, label: `${label(n)} · ${o.label || k}`, type: n.type, group, sdf: isSdfNode(n) || /^(distance|dist|sdf)$/i.test(k) });
      }
      const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
      if (sg?.nodes) walk(sg.nodes, label(n));
    }
  };
  walk(nodes, inGroup);
  return [...out.filter(o => o.sdf), ...out.filter(o => !o.sdf)];
}

/** The vec2 outputs a space or position can be picked from: every node, groups included. */
export function vec2Outputs(nodes: readonly GraphNode[], label: (n: GraphNode) => string, inGroup = ''): Array<{ ref: SocketRef; label: string; type: string; group: string }> {
  const out: Array<{ ref: SocketRef; label: string; type: string; group: string }> = [];
  for (const n of nodes) {
    for (const [k, o] of Object.entries(n.outputs ?? {})) {
      if (o.type === 'vec2') out.push({ ref: { nodeId: n.id, outputKey: k }, label: `${label(n)} · ${o.label || k}`, type: n.type, group: inGroup });
    }
    const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sg?.nodes) out.push(...vec2Outputs(sg.nodes, label, label(n)));
  }
  return out;
}
