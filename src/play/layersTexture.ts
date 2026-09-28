/**
 * layersTexture.ts — the textures behind the graph's Layers node in the app:
 * the layers' colour (half resolution) and their distance field, refreshed
 * from the layer kit's shader tap after every drawn frame. ShaderCanvas puts
 * `layersUniforms` into every material; a shader without a Layers node just
 * never reads them.
 *
 * The field is built on the GPU (a jump flood, kit/jfa.js) on ShaderCanvas's
 * renderer, once per tapped frame, and handed to three.js as an
 * ExternalTexture. Without WebGL2 float render targets it falls back to the
 * kit's CPU field (16-bit packed, 180 rows). See docs/layers-node.md.
 */
import * as THREE from 'three';
import { playOverlay } from './overlay';
import { jfCreate } from './kit/jfa.js';
import type { JfBuilder } from './kit/jfa.js';
import type { ShaderTap } from './kit/kit.js';

const blank = document.createElement('canvas');
blank.width = blank.height = 1;

const colour = new THREE.CanvasTexture(blank);
colour.minFilter = THREE.LinearFilter; colour.magFilter = THREE.LinearFilter; colour.generateMipmaps = false;

function fieldTexture(data: Uint8Array, w: number, h: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  // Packed 16-bit distances must not be blended between texels; the shader interpolates after unpacking.
  t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** The GPU field, as three.js sees it (the jump flood's own texture). */
const gpuField = new THREE.ExternalTexture(null);
let cpuField: THREE.DataTexture = fieldTexture(new Uint8Array([255, 255, 0, 255]), 1, 1);

export const layersUniforms = {
  u_layers: { value: colour as THREE.Texture },
  u_layersField: { value: cpuField as THREE.Texture },
  u_layersFieldSize: { value: new THREE.Vector2(0, 0) },
  /** 1: u_layersField is the GPU float field (linear, row 0 at the bottom); 0: the CPU packed one. */
  u_layersFieldLinear: { value: 0 },
};

let renderer: THREE.WebGLRenderer | null = null;
/** undefined: not tried on this renderer yet; null: can't run there (the CPU field is used). */
let jfa: JfBuilder | null | undefined;

/** ShaderCanvas's renderer, for the GPU field (null when it goes away). */
export function setLayersRenderer(r: THREE.WebGLRenderer | null): void {
  if (r === renderer) return;
  jfa?.dispose();
  jfa = undefined;
  renderer = r;
  gpuField.sourceTexture = null;
}

/** A renderer going away: forget it if it is the one the field is built on. */
export function releaseLayersRenderer(r: THREE.WebGLRenderer): void {
  if (r !== renderer) return;
  setLayersRenderer(null);
  // Back to the CPU field until a renderer returns (the GPU one belonged to the lost context).
  layersUniforms.u_layersField.value = cpuField;
  layersUniforms.u_layersFieldLinear.value = 0;
}

/** Which field the Layers node reads now: 'gpu', 'cpu', or 'off' (for the dev tools and tests). */
export function layersFieldMode(): 'gpu' | 'cpu' | 'off' {
  if (layersUniforms.u_layersFieldSize.value.x < 1) return 'off';
  return layersUniforms.u_layersFieldLinear.value > 0.5 ? 'gpu' : 'cpu';
}

/** Build this frame's field on the GPU; false when it can't (the caller then uses the CPU one). */
function gpuFieldFrom(tap: ShaderTap): boolean {
  if (!renderer) return false;
  if (jfa === undefined) jfa = jfCreate(renderer.getContext());
  if (!jfa) return false;
  const src = tap.layers;
  const out = jfa.run({ canvas: src, width: src.width, height: src.height });
  // The flood bound its own programs and framebuffers; three.js must not trust its cache.
  renderer.resetState();
  if (!out) return false;
  gpuField.sourceTexture = out.texture;
  layersUniforms.u_layersField.value = gpuField;
  layersUniforms.u_layersFieldSize.value.set(out.width, out.height);
  layersUniforms.u_layersFieldLinear.value = 1;
  return true;
}

function cpuFieldFrom(tap: ShaderTap): void {
  const data = tap.field;
  if (cpuField.image.width !== tap.gw || cpuField.image.height !== tap.gh) {
    cpuField.dispose();
    cpuField = fieldTexture(data, tap.gw, tap.gh);
  } else {
    (cpuField.image.data as Uint8Array).set(data);
    cpuField.needsUpdate = true;
  }
  layersUniforms.u_layersField.value = cpuField;
  layersUniforms.u_layersFieldSize.value.set(tap.gw, tap.gh);
  layersUniforms.u_layersFieldLinear.value = 0;
}

let lastSig = NaN;

/**
 * Turn the tap on while the shader uses the Layers node. `requestRender` is
 * called when the layers changed, so a still picture that reads them still
 * updates (one frame behind), without drawing forever when nothing moves.
 */
export function setLayersTap(on: boolean, requestRender: () => void): void {
  if (!on) { playOverlay.setShaderTap(null); layersUniforms.u_layersFieldSize.value.set(0, 0); lastSig = NaN; return; }
  playOverlay.setShaderTap(tap => {
    if (colour.image !== tap.color) colour.image = tap.color;
    colour.needsUpdate = true;
    if (!gpuFieldFrom(tap)) cpuFieldFrom(tap);
    if (tap.sig !== lastSig) { lastSig = tap.sig; requestRender(); }
  });
}
