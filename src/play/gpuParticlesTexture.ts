/**
 * gpuParticlesTexture.ts — the Particles nodes in the app: the engine
 * (play/kit/gpuParticles.js) on ShaderCanvas's renderer, one per node, run
 * before each drawn frame and handed to three.js as ExternalTextures under
 * the nodes' sampler uniforms. The nodes' numbers are read from the same
 * material uniforms the sliders, Play controls and mappings write.
 *
 * Wired sockets (a setting driven by another node, an obstacle, a flow, a
 * scene's camera and depth) live only in the shader: when a node has any,
 * the graph is compiled a second time with GPP_PROBE (sharing the material's
 * uniforms), and before each frame that copy draws the wired values a pixel
 * each (read back asynchronously, so they reach the engine a frame or two
 * late) and a small field over the picture that the engine samples on the GPU.
 *
 * Sound from: the mic (lib/liveAudio) or the Play Audio engine's master or a
 * track (lib/engineSound), as spectra the engine listens to.
 *
 * Where the engine can't run (no WebGL2 float targets) the samplers read a
 * blank texture, the node passes its picture through, and a notice says why
 * once. See docs/gpu-particles-plan.md.
 */
import * as THREE from 'three';
import { GP_VOL, GP_VOL_TILES, gpHost, gpProbeField, gpProbeSlots, gpReadback } from './kit/gpuParticles.js';
import type { GpBinding, GpField, GpHost, GpReadback, GpSoundInput } from './kit/gpuParticles.js';
import { toast } from '../components/ui/toastStore';
import { liveAudio } from '../lib/liveAudio';
import { engineSound, ENGINE_MASTER } from '../lib/engineSound';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
blank.needsUpdate = true;

let renderer: THREE.WebGLRenderer | null = null;
let host: GpHost | null = null;
let shader = '';
/**
 * With Pass nodes: the pass programs' sources (docs/pass-node-plan.md). A Particles node placed before a
 * Pass is compiled into that pass's program, not the picture's: it is found there, and its probe draws
 * from there. Empty for every other graph.
 */
let passSources: readonly string[] = [];
let warned = false;
const externals = new Map<string, THREE.ExternalTexture>();

/** The graph compiled again with GPP_PROBE, on the live material's uniforms (one for all nodes). */
type Probe = { material: THREE.ShaderMaterial; source: THREE.ShaderMaterial; fs: string; scene: THREE.Scene; camera: THREE.Camera };
let probe: Probe | null = null;
/** The same for a pass program a Particles node is compiled into (by its source); none without Pass nodes. */
const passProbes = new Map<string, Probe>();
/** Each node's probe targets and its last values read back. */
interface NodeProbe { reader: GpReadback; valuesRT: THREE.WebGLRenderTarget | null; fieldRT: THREE.WebGLRenderTarget | null; volRT: THREE.WebGLRenderTarget | null }
const nodeProbes = new Map<string, NodeProbe>();
const PROBE_PIXELS = 16;

function disposeProbe(p: Probe): void {
  p.material.dispose(); (p.scene.children[0] as THREE.Mesh | undefined)?.geometry.dispose();
}

function dropProbe(): void {
  if (probe) disposeProbe(probe);
  probe = null;
  for (const p of passProbes.values()) disposeProbe(p);
  passProbes.clear();
  for (const np of nodeProbes.values()) { np.reader.dispose(); np.valuesRT?.dispose(); np.fieldRT?.dispose(); np.volRT?.dispose(); }
  nodeProbes.clear();
}

function ensureHost(): GpHost | null {
  if (!renderer) return null;
  if (!host) {
    host = gpHost(renderer.getContext());
    host.bind(shader);
  }
  return host;
}

/** ShaderCanvas's renderer (null when it goes away): the engines live on its context. */
export function setGpuParticlesRenderer(r: THREE.WebGLRenderer | null): void {
  if (r === renderer) return;
  host?.dispose();
  host = null;
  dropProbe();
  renderer = r;
  for (const e of externals.values()) e.sourceTexture = null;
}

/** A renderer going away (or its context lost): forget it if the engines are on it. */
export function releaseGpuParticlesRenderer(r: THREE.WebGLRenderer): void {
  if (r === renderer) setGpuParticlesRenderer(null);
}

/**
 * After a compile: find the shader's Particles nodes and give each sampler a
 * uniform entry (blank until its first frame). True when there are any.
 * `passes`: with Pass nodes, the pass programs' sources, searched as well
 * (a Particles node before a Pass is in that pass's program).
 */
export function bindGpuParticles(uniforms: Record<string, THREE.IUniform>, fragmentShader: string, passes?: readonly string[]): boolean {
  passSources = passes?.length ? passes : [];
  shader = passSources.length ? [fragmentShader, ...passSources].join('\n') : fragmentShader;
  for (const [fs, p] of passProbes) if (!passSources.includes(fs)) { disposeProbe(p); passProbes.delete(fs); }
  const h = ensureHost();
  const bindings = h ? h.bind(shader) : [];
  const want = new Set(bindings.map(b => b.uniform));
  for (const [name, ext] of externals) if (!want.has(name)) { ext.sourceTexture = null; externals.delete(name); }
  for (const b of bindings) {
    const ext = externals.get(b.uniform);
    if (uniforms[b.uniform]) uniforms[b.uniform].value = ext?.sourceTexture ? ext : blank;
    else uniforms[b.uniform] = { value: ext?.sourceTexture ? ext : blank };
    // The probe's steering uniforms (off in the live picture).
    if (b.probe) for (const n of [b.probe.m, b.probe.s]) { if (uniforms[n]) uniforms[n].value = 0; else uniforms[n] = { value: 0 }; }
    if (b.probe?.c && !uniforms[b.probe.c]) uniforms[b.probe.c] = { value: new THREE.Vector4(0, 0, 0, 2) };
  }
  return bindings.length > 0;
}

/** Does the live shader have a Particles node? (Then the picture moves while the clock runs.) */
export function gpuParticlesActive(): boolean {
  return !!host && host.active();
}

/** Start every system over on its next frame (a new render, ↺). */
export function resetGpuParticles(): void {
  host?.reset();
}

/** A uniform's value as the engine reads it: a number, or [r, g, b]. */
function readUniform(uniforms: Record<string, THREE.IUniform>, name: string): unknown {
  const v = uniforms[name]?.value;
  if (v instanceof THREE.Vector3) return [v.x, v.y, v.z];
  if (v instanceof THREE.Color) return [v.r, v.g, v.b];
  return v;
}

/**
 * A node's picture (its Image slot) as the engine reads it: three's own
 * WebGLTexture (uploaded first if it hasn't been) and its width / height.
 * Null while no picture is loaded.
 */
function nodePicture(r: THREE.WebGLRenderer, uniforms: Record<string, THREE.IUniform>, name: string): { texture: WebGLTexture; aspect: number } | null {
  const t = uniforms[name]?.value;
  if (!(t instanceof THREE.Texture) || t === blank) return null;
  // A Video's texture (Emit from wired straight to a Video Input, phase 7): an element, sized by videoWidth.
  const raw = t.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | null;
  const img = raw && raw.videoWidth ? { width: raw.videoWidth, height: raw.videoHeight } : raw;
  if (!img || !img.width || !img.height) return null;
  r.initTexture(t);
  const gl = (r.properties.get(t) as { __webglTexture?: WebGLTexture }).__webglTexture;
  return gl ? { texture: gl, aspect: img.width / img.height } : null;
}

/** Sound from: what the engine hears now from the mic, or the Play Audio engine's master or a track (the Agents group's listeners hear the same). */
export function particleSoundOf(source: string): GpSoundInput | null {
  if (source === 'live') return liveAudio.raw();
  let rack: string | null = null;
  if (source === 'master') rack = ENGINE_MASTER;
  else if (/^track\d$/.test(source)) rack = useNodeGraphStore.getState().play?.audioEngine?.racks?.[+source.slice(5) - 1]?.id ?? null;
  if (!rack) return null;
  const s = engineSound.spectrum(rack);
  return s ? { freq: s.freq, wave: s.wave, sampleRate: s.sampleRate } : null;
}

function makeProbe(material: THREE.ShaderMaterial, fs: string): Probe {
  const m = new THREE.ShaderMaterial({
    vertexShader: material.vertexShader, fragmentShader: fs, uniforms: material.uniforms,
    defines: { GPP_PROBE: 1 }, depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { material: m, source: material, fs, scene, camera: new THREE.Camera() };
}

/** The probe copy of `material` (rebuilt when the material or its shader changes); null when no node needs one. */
function ensureProbe(material: THREE.ShaderMaterial, bindings: GpBinding[]): typeof probe {
  if (!bindings.some(b => b.probe)) { if (probe) dropProbe(); return null; }
  if (probe && probe.source === material && probe.fs === material.fragmentShader) return probe;
  if (probe) disposeProbe(probe);
  probe = makeProbe(material, material.fragmentShader);
  return probe;
}

/**
 * The probe a node's wired values are drawn with: the picture's, or (a node the picture's program
 * doesn't have: it is before a Pass) a probe copy of the pass program it is compiled into.
 */
function probeFor(material: THREE.ShaderMaterial, pr: Probe | null, b: GpBinding): Probe | null {
  if (!passSources.length) return pr;
  const decl = `uniform sampler2D ${b.uniform};`;
  if (material.fragmentShader.includes(decl)) return pr;
  const fs = passSources.find(s => s.includes(decl));
  if (!fs) return pr;
  let p = passProbes.get(fs);
  if (p && p.source !== material) { disposeProbe(p); p = undefined; }
  if (!p) { p = makeProbe(material, fs); passProbes.set(fs, p); }
  return p;
}

/** Draw a node's probe (its wired values, its field) and hand back the latest values read and the field. */
function runProbe(r: THREE.WebGLRenderer, pr: Probe, b: GpBinding, width: number, height: number, vol: { centre: number[]; half: number }): { values: Float32Array | null; field: GpField | null; volume: GpField | null } | null {
  const spec = b.probe;
  if (!spec) return null;
  let np = nodeProbes.get(b.uniform);
  if (!np) { np = { reader: gpReadback(r.getContext() as WebGL2RenderingContext), valuesRT: null, fieldRT: null, volRT: null }; nodeProbes.set(b.uniform, np); }
  const u = pr.material.uniforms;
  const prevTarget = r.getRenderTarget(), prevClear = r.autoClear;
  r.autoClear = false;
  try {
    const slots = gpProbeSlots(spec).slice(0, PROBE_PIXELS);
    if (slots.length) {
      if (!np.valuesRT) np.valuesRT = new THREE.WebGLRenderTarget(PROBE_PIXELS, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
      const rt = np.valuesRT;
      u[spec.m].value = 1;
      slots.forEach((sl, i) => {
        // A one-pixel viewport reads the picture's centre; a two-pixel one, half a picture right or up of it.
        // The scissor keeps the wider viewport off its neighbour.
        rt.viewport.set(i - sl.dx, -sl.dy, 1 + sl.dx, 1 + sl.dy);
        rt.scissor.set(i, 0, 1, 1);
        rt.scissorTest = true;
        u[spec.s].value = i;
        r.setRenderTarget(rt);
        // (three skips the upload when one material draws twice in a row)
        pr.material.uniformsNeedUpdate = true;
        r.render(pr.scene, pr.camera);
      });
      // (Not three's readRenderTargetPixelsAsync: it leaves its pixel buffer bound while it waits,
      // which would catch the app's own readPixels: exports, scopes.)
      const fb = (r.properties.get(rt) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer;
      if (fb) np.reader.request(fb, PROBE_PIXELS, 1);
    }
    let field: GpField | null = null;
    if (gpProbeField(spec)) {
      // The field over the picture: a third of its height for a scene's depth, else a small grid.
      const fh = spec.field.depth ? Math.max(96, Math.round(height / 3)) : 160;
      const fw = Math.max(16, Math.round(fh * width / Math.max(1, height)));
      if (!np.fieldRT || np.fieldRT.width !== fw || np.fieldRT.height !== fh) {
        np.fieldRT?.dispose();
        np.fieldRT = new THREE.WebGLRenderTarget(fw, fh, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      }
      u[spec.m].value = 2;
      np.fieldRT.viewport.set(0, 0, fw, fh);
      r.setRenderTarget(np.fieldRT);
      pr.material.uniformsNeedUpdate = true;
      r.render(pr.scene, pr.camera);
      const tex = (r.properties.get(np.fieldRT.texture) as { __webglTexture?: WebGLTexture }).__webglTexture;
      if (tex) field = { texture: tex, w: fw, h: fh };
    }
    let volume: GpField | null = null;
    if (spec.field.scene && spec.c && u[spec.c]) {
      // The Scene's distance on a grid round the centre: GP_VOL² slices side by side.
      const vw = GP_VOL * GP_VOL_TILES[0], vh = GP_VOL * GP_VOL_TILES[1];
      if (!np.volRT) np.volRT = new THREE.WebGLRenderTarget(vw, vh, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      (u[spec.c].value as THREE.Vector4).set(vol.centre[0], vol.centre[1], vol.centre[2], vol.half);
      u[spec.m].value = 3;
      np.volRT.viewport.set(0, 0, vw, vh);
      r.setRenderTarget(np.volRT);
      pr.material.uniformsNeedUpdate = true;
      r.render(pr.scene, pr.camera);
      const tex = (r.properties.get(np.volRT.texture) as { __webglTexture?: WebGLTexture }).__webglTexture;
      if (tex) volume = { texture: tex, w: vw, h: vh };
    }
    return { values: np.reader.poll(), field, volume };
  } finally {
    u[spec.m].value = 0;
    r.autoClear = prevClear;
    r.setRenderTarget(prevTarget);
  }
}

/**
 * Step (by dt; 0 holds still) and draw every Particles node at width × height
 * and point its sampler at the result. `mouse` is the pointer in 0…1 of the
 * picture (y up), or null. `material` is the live picture's: its uniforms are
 * the nodes' settings, and its shader is what the probe draws from.
 */
export function drawGpuParticles(material: THREE.ShaderMaterial, o: { width: number; height: number; dt: number; time: number; mouse: [number, number] | null; reset?: boolean }): void {
  const h = ensureHost();
  const uniforms = material.uniforms;
  if (!renderer || !h || !h.active()) return;
  if (h.unsupported) {
    if (!warned) { warned = true; toast.warning('Particles can\'t run here', { message: h.unsupported }); }
    return;
  }
  const r = renderer;
  const pr = ensureProbe(material, h.bindings);
  const out = h.frame({
    ...o,
    read: name => readUniform(uniforms, name),
    texture: name => nodePicture(r, uniforms, name),
    probe: (b, vol) => { const p = pr ? probeFor(material, pr, b) : null; return p ? runProbe(r, p, b, o.width, o.height, vol) : null; },
    sound: particleSoundOf,
  });
  // The engine bound its own programs, framebuffers and textures: three.js must not trust its cache.
  r.resetState();
  for (const { uniform, texture } of out) {
    let ext = externals.get(uniform);
    if (!ext) { ext = new THREE.ExternalTexture(null); externals.set(uniform, ext); }
    ext.sourceTexture = texture;
    const value = texture ? ext : blank;
    if (uniforms[uniform]) uniforms[uniform].value = value;
    else uniforms[uniform] = { value };
  }
}
