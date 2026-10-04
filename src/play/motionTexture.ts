/**
 * motionTexture.ts — the texture behind the graph's Motion (texture) node
 * (nodes/definitions/motionMap.ts): the setup's first Motion layer's grid,
 * copied from the layer kit after every overlay frame. ShaderCanvas puts
 * `motionUniforms` into every material (and so into Pass and agent programs,
 * which share the preview's uniforms); a shader without the node never reads
 * them. Like the Layers node it is a frame late.
 *
 * The grid is 8-bit here (0..1 × 255, linear-filtered): it is a smoothed
 * amount on a coarse grid, so 8 bits lose nothing visible. Row 0 is turned to
 * the bottom, so the texture covers the picture as a Pass or a Trail does.
 */
import * as THREE from 'three';
import { playOverlay } from './overlay';
import { MOTION_MAP_UNIFORM } from '../nodes/definitions/motionMap';

function makeTexture(w: number, h: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export const motionUniforms = {
  [MOTION_MAP_UNIFORM]: { value: makeTexture(1, 1) as THREE.Texture },
  /** One picture pixel in 0–1 texture units, for the sampling nodes' offsets (as a Pass's `_px`). */
  [`${MOTION_MAP_UNIFORM}_px`]: { value: new THREE.Vector2(1, 1) },
};

/** Does a program read the Motion (texture) node's uniforms? */
export const readsMotionMap = (glsl: string | null | undefined) => !!glsl && glsl.includes(MOTION_MAP_UNIFORM);

let lastSeq = -1, lastId = '', empty = true;
/** The texture holds a grid (not the empty one): a frame is still owed to clear it if the layer goes. */
export const motionTextureHasData = () => !empty;

/**
 * Copy the first Motion layer's grid into the texture when it changed (after the overlay drew).
 * `width` × `height` is the picture, for `_px`. Returns whether the texture changed.
 */
export function refreshMotionTexture(width: number, height: number): boolean {
  (motionUniforms[`${MOTION_MAP_UNIFORM}_px`].value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
  const g = playOverlay.motionGrid();
  if (!g) {
    if (empty) return false;
    // No Motion layer (any more): read 0 everywhere.
    const t = motionUniforms[MOTION_MAP_UNIFORM].value as THREE.DataTexture;
    (t.image.data as Uint8Array).fill(0);
    t.needsUpdate = true;
    empty = true; lastSeq = -1; lastId = '';
    return true;
  }
  if (g.seq === lastSeq && g.id === lastId) return false;
  lastSeq = g.seq; lastId = g.id; empty = false;
  let t = motionUniforms[MOTION_MAP_UNIFORM].value as THREE.DataTexture;
  if (t.image.width !== g.cols || t.image.height !== g.rows) {
    t.dispose();
    t = makeTexture(g.cols, g.rows);
    motionUniforms[MOTION_MAP_UNIFORM].value = t;
  }
  const data = t.image.data as Uint8Array;
  for (let r = 0; r < g.rows; r++) {
    // Kit row r (from the top) → texture row rows-1-r (from the bottom).
    const src = r * g.cols, dst = (g.rows - 1 - r) * g.cols;
    for (let c = 0; c < g.cols; c++) {
      const v = Math.max(0, Math.min(255, Math.round(g.grid[src + c] * 255)));
      const i = (dst + c) * 4;
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
  }
  t.needsUpdate = true;
  return true;
}
