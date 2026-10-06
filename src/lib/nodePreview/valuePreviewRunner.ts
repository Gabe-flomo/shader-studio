/**
 * The GPU side of the "Show as" previews (docs/node-previews.md), run by ShaderCanvas while the
 * eye preview shows a node whose output is a float or a vec2:
 *
 *  - display(): the program the frame is drawn with: the graph's own shader ending in the chosen
 *    mode's colour map (previewGlsl buildDisplayShader). One program per (shader, node), compiled
 *    off-thread; switching mode only changes a uniform.
 *  - sample(): a few times a second, the node's raw value (plus its primary input) is drawn into a
 *    small float target and read back asynchronously (PIXEL_PACK_BUFFER + fence: no stall). The
 *    readback gives the auto-range, the constant check, the slice plot and the arrows, a frame or
 *    two late, and is published on previewBus for the node card and the eye overlay.
 */
import * as THREE from 'three';
import type { GraphNode } from '../../types/nodeGraph';
import { buildDisplayShader, buildValueShader, MODE_CODE } from './previewGlsl';
import { displayStats, fieldStats, isColourType, niceStep, type FieldType, type ValueField } from './valueField';
import type { PreviewStats } from '../previewExplain';
import { previewBus, previewPerf } from './previewBus';
import { probedNode } from './lineProbe';
import { detailFor, gridDensity, pickPreviewOutput, prefOf, primaryInput, showAsFor, type Detail, type ShowAsMode } from './showAs';

export interface PreviewTarget {
  nodeId: string;
  outputKey: string;
  type: FieldType;
  varName: string;
  /** The primary input's variable (float nodes), drawn grey under the slice plot. */
  inputVar: string | null;
  mode: ShowAsMode;
  /** Grid / Arrows density (a uniform: never a recompile). */
  detail: Detail;
}

/** Find a node at the top level or inside any group (the eye can preview a node inside a group). */
export function findNodeDeep(nodes: readonly GraphNode[], id: string): GraphNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sg?.nodes) { const hit = findNodeDeep(sg.nodes, id); if (hit) return hit; }
  }
  return null;
}

/**
 * What the eye preview of `previewId` shows as a value, or null when it isn't a float / vec2 (a
 * colour draws as before) or the shader doesn't declare the variable (a recompile settling, a
 * node only a Pass draws).
 */
export function resolvePreviewTarget(
  previewId: string,
  nodes: readonly GraphNode[],
  varMap: Map<string, Record<string, string>>,
  fs: string,
  declares: (fs: string, v: string) => boolean,
): PreviewTarget | null {
  // A line preview's probe: the copy the preview compiled (its only output is the probed variable)
  const node = probedNode(findNodeDeep(nodes, previewId));
  if (!node) return null;
  const picked = pickPreviewOutput(node, prefOf(node).output);
  if (!picked) return null;
  const [outputKey, t] = picked;
  if (t !== 'float' && t !== 'vec2' && t !== 'vec3' && t !== 'vec4') return null;
  const varName = varMap.get(previewId)?.[outputKey];
  if (!varName || !declares(fs, varName)) return null;
  let inputVar: string | null = null;
  if (t === 'float') {
    const pi = primaryInput(node);
    const v = pi ? varMap.get(pi.nodeId)?.[pi.outputKey] : undefined;
    if (v && v !== varName && declares(fs, v)) inputVar = v;
  }
  // A colour has no "Show as" map: Raw (as the picture draws it); the card reads it back too.
  const mode = t === 'float' || t === 'vec2' ? showAsFor(node, t, outputKey) : 'raw';
  return { nodeId: previewId, outputKey, type: t, varName, inputVar, mode, detail: detailFor(node) };
}

/** Texels in the value target (256 × 144 at 16:9); its shape follows the picture's aspect. */
export const VALUE_TEXELS = 256 * 144;

/** The value target's size for a picture of this aspect: about VALUE_TEXELS, at least 8 on a side. */
export function valueTargetSize(canvasW: number, canvasH: number): [number, number] {
  const asp = Math.max(1 / 16, Math.min(16, canvasW / Math.max(1, canvasH)));
  const w = Math.max(8, Math.round(Math.sqrt(VALUE_TEXELS * asp)));
  const h = Math.max(8, Math.round(w / asp));
  return [w, h];
}
/** Least time between readbacks while the picture animates (ms). */
export const SAMPLE_MS = 150;

type Uniforms = Record<string, THREE.IUniform>;

export class ValuePreviewRunner {
  private rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private mesh: THREE.Mesh;
  private dummy: THREE.ShaderMaterial;
  private display_ = new Map<string, THREE.ShaderMaterial>();
  private value_ = new Map<string, THREE.ShaderMaterial>();
  private lastFs = '';
  private pending = false;
  private lastSample = -Infinity;
  private bufs: [Float32Array, Float32Array] = [new Float32Array(4), new Float32Array(4)];
  private bufIdx = 0;
  private gen = 0;
  private lastKey = '';
  private res = new THREE.Vector2(1, 1);
  private mouse = new THREE.Vector2(0, 0);
  /** Uniform objects the display programs read (put into the picture's shared uniforms object). */
  readonly pv: Uniforms = {
    u_pvMode: { value: 0 }, u_pvMin: { value: 0 }, u_pvMax: { value: 1 },
    u_pvStep: { value: 0.1 }, u_pvMag: { value: 1 }, u_pvFlat: { value: 0 },
    u_pvGrid: { value: new THREE.Vector2(10, 2) },
  };

  // Programs compile off-thread (compileAsync), quietly: one that fails (a variable the shader
  // only declares inside a block) is never the graph's error, it just leaves the preview Raw.
  private ready = new WeakSet<THREE.ShaderMaterial>();
  private compiling = new WeakSet<THREE.ShaderMaterial>();
  private broken = new WeakSet<THREE.ShaderMaterial>();
  private disposeLater = new WeakSet<THREE.ShaderMaterial>();

  private renderer: THREE.WebGLRenderer;
  private camera: THREE.Camera;
  /** Runs a compile without reporting its errors as the graph's (ShaderCanvas captureGlslErrors). */
  private quietly: <T>(fn: () => T) => T;
  /** Ask for a frame (a program finished compiling). */
  private requestRender: () => void;

  constructor(renderer: THREE.WebGLRenderer, camera: THREE.Camera, quietly: <T>(fn: () => T) => T, requestRender: () => void) {
    this.renderer = renderer;
    this.camera = camera;
    this.quietly = quietly;
    this.requestRender = requestRender;
    this.rt = new THREE.WebGLRenderTarget(256, 144, {
      type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    this.dummy = new THREE.ShaderMaterial();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dummy);
    this.scene.add(this.mesh);
  }

  /** True once the program is compiled and linked; starts the compile the first time. */
  private isReady(m: THREE.ShaderMaterial): boolean {
    if (this.broken.has(m)) return false;
    if (this.ready.has(m)) return true;
    if (this.compiling.has(m)) return false;
    this.compiling.add(m);
    // A scene of its own: compileAsync polls every material in the scene it's given, and one
    // shared with another compile could be disposed under it.
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

  /** compileAsync polls a material until it's ready: one dropped mid-compile is disposed once it settles. */
  private disposeMat = (m: THREE.ShaderMaterial) => {
    if (this.compiling.has(m) && !this.ready.has(m) && !this.broken.has(m)) this.disposeLater.add(m);
    else m.dispose();
  };

  /** Drop programs built for another shader. */
  private sync(fs: string) {
    if (fs === this.lastFs) return;
    this.lastFs = fs;
    this.display_.forEach(this.disposeMat); this.display_.clear();
    this.value_.forEach(this.disposeMat); this.value_.clear();
  }

  /** Put the display uniforms into the picture's uniforms object (shared across its recompiles). */
  private ensureUniforms(u: Uniforms) {
    for (const k in this.pv) if (u[k] !== this.pv[k]) u[k] = this.pv[k];
  }

  /**
   * The material to draw this frame with instead of the picture's, or null to draw as usual
   * (Raw, nothing to show, or the program still compiling: it shows the next frame it's ready).
   */
  display(t: PreviewTarget | null, fs: string, vs: string, main: THREE.ShaderMaterial): THREE.ShaderMaterial | null {
    if (!t || t.mode === 'raw' || isColourType(t.type)) return null;
    this.sync(fs);
    this.ensureUniforms(main.uniforms);
    const key = `${t.varName}:${t.type}`;
    let m = this.display_.get(key);
    if (m && m.uniforms !== main.uniforms) { this.disposeMat(m); this.display_.delete(key); m = undefined; }
    if (!m) {
      const src = buildDisplayShader(fs, t.varName, t.type as 'float' | 'vec2');
      if (!src) return null;
      m = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: src, uniforms: main.uniforms });
      this.display_.set(key, m);
    }
    if (!this.isReady(m)) return null;
    this.pv.u_pvMode.value = MODE_CODE[t.mode] ?? 0;
    const g = gridDensity(t.detail);
    (this.pv.u_pvGrid.value as THREE.Vector2).set(g.checks, g.lines);
    return m;
  }

  /**
   * Draw the value into the small target and read it back, at most every SAMPLE_MS while
   * animating (`force`: a frame drawn on demand always samples), one readback in flight.
   * `onChange` runs when a readback moved the range, so a still picture redraws with it.
   */
  sample(t: PreviewTarget | null, fs: string, vs: string, main: THREE.ShaderMaterial, canvasW: number, canvasH: number, force: boolean, onChange: () => void, onStats?: (s: PreviewStats | null) => void) {
    if (!t) {
      if (this.lastKey) { this.lastKey = ''; this.gen++; previewBus.clear(); onStats?.(null); }
      return;
    }
    const key = `${t.nodeId}:${t.outputKey}:${t.varName}:${t.inputVar ?? ''}`;
    if (key !== this.lastKey) { this.lastKey = key; this.gen++; this.pending = false; }
    const now = performance.now();
    if (this.pending || (!force && now - this.lastSample < SAMPLE_MS)) return;
    this.sync(fs);
    const vkey = `${t.varName}:${t.type}:${t.inputVar ?? ''}`;
    let m = this.value_.get(vkey);
    if (!m) {
      const src = buildValueShader(fs, t.varName, t.type, t.inputVar);
      if (!src) return;
      m = new THREE.ShaderMaterial({
        vertexShader: vs, fragmentShader: src,
        uniforms: { u_resolution: { value: this.res }, u_mouse: { value: this.mouse } },
      });
      this.value_.set(vkey, m);
    }
    // The picture's uniforms by reference (sliders, textures, time), its own size and pointer.
    const u = m.uniforms;
    for (const k in main.uniforms) if (k !== 'u_resolution' && k !== 'u_mouse' && u[k] !== main.uniforms[k]) u[k] = main.uniforms[k];
    if (!this.isReady(m)) return; // compiling: its settle asks for a frame, which samples
    const [w, h] = valueTargetSize(canvasW, canvasH);
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    this.res.set(w, h);
    const mu = main.uniforms.u_mouse?.value as THREE.Vector2 | undefined;
    if (mu) this.mouse.set(mu.x * w / Math.max(1, canvasW), mu.y * h / Math.max(1, canvasH));

    const r0 = performance.now();
    this.mesh.material = m;
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);
    this.mesh.material = this.dummy;
    previewPerf.renderMs = performance.now() - r0;

    const need = w * h * 4;
    this.bufIdx ^= 1;
    if (this.bufs[this.bufIdx].length !== need) this.bufs[this.bufIdx] = new Float32Array(need);
    const buf = this.bufs[this.bufIdx];
    this.pending = true;
    this.lastSample = now;
    const gen = this.gen;
    const t0 = performance.now();
    this.renderer.readRenderTargetPixelsAsync(this.rt, 0, 0, w, h, buf).then(() => {
      this.pending = false;
      if (gen !== this.gen) return;
      previewPerf.readbackMs = performance.now() - t0;
      previewPerf.readbacks++;
      previewPerf.w = w; previewPerf.h = h;
      const field: ValueField = { data: buf, w, h, type: t.type, hasInput: !!t.inputVar };
      const s0 = performance.now();
      const stats = fieldStats(field);
      previewPerf.statsMs = performance.now() - s0;
      const before = [this.pv.u_pvMin.value, this.pv.u_pvMax.value, this.pv.u_pvMag.value, this.pv.u_pvFlat.value];
      if (stats.finite > 0) {
        this.pv.u_pvMin.value = stats.min;
        this.pv.u_pvMax.value = stats.max;
        this.pv.u_pvStep.value = niceStep(stats.min, stats.max);
        this.pv.u_pvMag.value = stats.maxMag || 1;
      }
      this.pv.u_pvFlat.value = stats.constant ? 1 : 0;
      previewBus.publish({ nodeId: t.nodeId, outputKey: t.outputKey, field, stats });
      // The caption's frame stats (clipping, black, flat), from the same readback: no extra read
      onStats?.(displayStats(field));
      const after = [this.pv.u_pvMin.value, this.pv.u_pvMax.value, this.pv.u_pvMag.value, this.pv.u_pvFlat.value];
      if (before.some((v, i) => v !== after[i])) onChange();
    }, () => { this.pending = false; });
  }

  /** After a GPU reset: programs and the target are made again on next use. */
  reset() {
    this.display_.forEach(this.disposeMat); this.display_.clear();
    this.value_.forEach(this.disposeMat); this.value_.clear();
    this.lastFs = '';
    this.pending = false;
    this.gen++;
    this.rt.dispose();
  }

  dispose() {
    this.display_.forEach(this.disposeMat); this.display_.clear();
    this.value_.forEach(this.disposeMat); this.value_.clear();
    this.rt.dispose();
    (this.mesh.geometry as THREE.BufferGeometry).dispose();
    this.dummy.dispose();
    previewBus.clear();
  }
}
