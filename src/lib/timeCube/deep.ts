/**
 * 16-bit Time Cube atlases (docs/time-cube.md, "Precision"): Frames from's averages and medians
 * hold more than 8 bits of detail, which an 8-bit atlas rounds into bands. With Precision 16-bit
 * the volume keeps the unrounded frames and hands the shader a half-float (RGBA16F) texture.
 * WebGL2 filters half-float textures linearly everywhere (Safari / WKWebView included); nothing
 * renders into it, so EXT_color_buffer_float isn't needed. Web exports carry the 8-bit canvas.
 */
import * as THREE from 'three';
import { tileOrigin, type StackPlan } from './plan';

/**
 * The half-float texture of a float atlas (RGBA, 0–255, rows top down as on the canvas). Rows are
 * written bottom up, as a canvas texture's flip would put them, so the shader's tile maths is the
 * same for both. `canvas8` (the same atlas in 8 bits) rides along in userData for web exports.
 */
export function deepTexture(atlas: Float32Array, w: number, h: number, canvas8: HTMLCanvasElement | null): THREE.DataTexture {
  const data = new Uint16Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = y * w * 4, dst = (h - 1 - y) * w * 4;
    for (let i = 0; i < w * 4; i++) data[dst + i] = THREE.DataUtils.toHalfFloat(atlas[src + i] / 255);
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.flipY = false;
  tex.userData.canvas8 = canvas8;
  tex.needsUpdate = true;
  return tex;
}

/** A float atlas whose tile i is tile order[i] of `base` (volumes.ts reorderAtlas, for 16-bit frames). */
export function reorderDeep(base: Float32Array, plan: Pick<StackPlan, 'cols' | 'tileW' | 'tileH' | 'atlasW' | 'frames'>, order: readonly number[]): Float32Array {
  const out = new Float32Array(base.length);
  const row = plan.tileW * 4;
  for (let i = 0; i < plan.frames; i++) {
    const s = tileOrigin(plan, order[i]), d = tileOrigin(plan, i);
    for (let r = 0; r < plan.tileH; r++) {
      const from = ((s.y + r) * plan.atlasW + s.x) * 4, to = ((d.y + r) * plan.atlasW + d.x) * 4;
      out.set(base.subarray(from, from + row), to);
    }
  }
  return out;
}
