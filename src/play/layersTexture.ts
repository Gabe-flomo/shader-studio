/**
 * layersTexture.ts — the textures behind the graph's Layers node in the app:
 * the layers' colour (half resolution) and their distance field, refreshed
 * from the layer kit's shader tap after every drawn frame. ShaderCanvas puts
 * `layersUniforms` into every material; a shader without a Layers node just
 * never reads them.
 */
import * as THREE from 'three';
import { playOverlay } from './overlay';

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

export const layersUniforms = {
  u_layers: { value: colour as THREE.Texture },
  u_layersField: { value: fieldTexture(new Uint8Array([255, 255, 0, 255]), 1, 1) as THREE.Texture },
  u_layersFieldSize: { value: new THREE.Vector2(0, 0) },
};

let lastSum = -1;

/**
 * Turn the tap on while the shader uses the Layers node. `requestRender` is
 * called when the layers changed, so a still picture that reads them still
 * updates (one frame behind), without drawing forever when nothing moves.
 */
export function setLayersTap(on: boolean, requestRender: () => void): void {
  if (!on) { playOverlay.setShaderTap(null); layersUniforms.u_layersFieldSize.value.set(0, 0); lastSum = -1; return; }
  playOverlay.setShaderTap(tap => {
    if (colour.image !== tap.color) colour.image = tap.color;
    colour.needsUpdate = true;
    const f = layersUniforms.u_layersField.value as THREE.DataTexture;
    if (f.image.width !== tap.gw || f.image.height !== tap.gh) {
      f.dispose();
      layersUniforms.u_layersField.value = fieldTexture(tap.field, tap.gw, tap.gh);
    } else {
      (f.image.data as Uint8Array).set(tap.field);
      f.needsUpdate = true;
    }
    layersUniforms.u_layersFieldSize.value.set(tap.gw, tap.gh);
    let sum = 0;
    for (let i = 0; i < tap.field.length; i += 13) sum = (sum + tap.field[i] * (i + 1)) % 1000000007;
    if (sum !== lastSum) { lastSum = sum; requestRender(); }
  });
}
