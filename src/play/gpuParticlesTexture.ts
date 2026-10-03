/**
 * gpuParticlesTexture.ts — the Particles nodes in the app: the engine
 * (play/kit/gpuParticles.js) on ShaderCanvas's renderer, one per node, run
 * before each drawn frame and handed to three.js as ExternalTextures under
 * the nodes' sampler uniforms. The nodes' numbers are read from the same
 * material uniforms the sliders, Play controls and mappings write.
 *
 * Where the engine can't run (no WebGL2 float targets) the samplers read a
 * blank texture, the node passes its picture through, and a notice says why
 * once. See docs/gpu-particles-plan.md.
 */
import * as THREE from 'three';
import { gpHost } from './kit/gpuParticles.js';
import type { GpHost } from './kit/gpuParticles.js';
import { toast } from '../components/ui/toastStore';

const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
blank.needsUpdate = true;

let renderer: THREE.WebGLRenderer | null = null;
let host: GpHost | null = null;
let shader = '';
let warned = false;
const externals = new Map<string, THREE.ExternalTexture>();

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
 */
export function bindGpuParticles(uniforms: Record<string, THREE.IUniform>, fragmentShader: string): boolean {
  shader = fragmentShader;
  const h = ensureHost();
  const bindings = h ? h.bind(fragmentShader) : [];
  const want = new Set(bindings.map(b => b.uniform));
  for (const [name, ext] of externals) if (!want.has(name)) { ext.sourceTexture = null; externals.delete(name); }
  for (const b of bindings) {
    const ext = externals.get(b.uniform);
    if (uniforms[b.uniform]) uniforms[b.uniform].value = ext?.sourceTexture ? ext : blank;
    else uniforms[b.uniform] = { value: ext?.sourceTexture ? ext : blank };
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
 * Step (by dt; 0 holds still) and draw every Particles node at width × height
 * and point its sampler at the result. `mouse` is the pointer in 0…1 of the
 * picture (y up), or null.
 */
export function drawGpuParticles(uniforms: Record<string, THREE.IUniform>, o: { width: number; height: number; dt: number; time: number; mouse: [number, number] | null; reset?: boolean }): void {
  const h = ensureHost();
  if (!renderer || !h || !h.active()) return;
  if (h.unsupported) {
    if (!warned) { warned = true; toast.warning('Particles can\'t run here', { message: h.unsupported }); }
    return;
  }
  const out = h.frame({ ...o, read: name => readUniform(uniforms, name) });
  // The engine bound its own programs, framebuffers and textures: three.js must not trust its cache.
  renderer.resetState();
  for (const { uniform, texture } of out) {
    let ext = externals.get(uniform);
    if (!ext) { ext = new THREE.ExternalTexture(null); externals.set(uniform, ext); }
    ext.sourceTexture = texture;
    const value = texture ? ext : blank;
    if (uniforms[uniform]) uniforms[uniform].value = value;
    else uniforms[uniform] = { value };
  }
}
