/**
 * uniformPrint.ts: what a program reads (declared and used), and a print of those values that stays the same while
 * nothing it reads changes, so the splat engine skips its readbacks (and sorts) for a still camera.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { uniformsPrint, usedUniforms } from '../uniformPrint';

const SRC = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_p_cam_dist, u_p_cam_angle;
uniform sampler2D u_prevFrame;
uniform vec3 u_unused;
void main() {
  float a = u_p_cam_angle + u_p_cam_dist * 0.5;
  gl_FragColor = vec4(a, u_resolution.x, 0.0, 1.0);
}`;

describe('usedUniforms', () => {
  it('lists the uniforms a shader reads, not the ones it only declares', () => {
    expect(usedUniforms(SRC).sort()).toEqual(['u_p_cam_angle', 'u_p_cam_dist', 'u_resolution']);
  });
});

describe('uniformsPrint', () => {
  const names = ['u_p_cam_angle', 'u_p_cam_dist', 'u_resolution'];
  const table = () => ({
    u_p_cam_angle: { value: 0.4 }, u_p_cam_dist: { value: 3.6 }, u_resolution: { value: new THREE.Vector2(800, 600) },
    u_time: { value: 1 }, u_prevFrame: { value: new THREE.Texture() },
  });

  it('is the same while nothing it reads changes, the clock included when it isn\'t read', () => {
    const u = table();
    const a = uniformsPrint(names, u);
    u.u_time.value = 2;
    expect(uniformsPrint(names, u)).toBe(a);
    u.u_p_cam_angle.value = 0.41;
    expect(uniformsPrint(names, u)).not.toBe(a);
    u.u_p_cam_angle.value = 0.4;
    (u.u_resolution.value as THREE.Vector2).set(801, 600);
    expect(uniformsPrint(names, u)).not.toBe(a);
  });

  it('has none for a texture (its content can change unseen) unless it is named as fixed', () => {
    const u = table();
    expect(uniformsPrint([...names, 'u_prevFrame'], u)).toBeNull();
    const fixed = new Set<unknown>([u.u_prevFrame.value]);
    const p = uniformsPrint([...names, 'u_prevFrame'], u, fixed);
    expect(p).not.toBeNull();
    expect(uniformsPrint([...names, 'u_prevFrame'], u, fixed)).toBe(p);
  });

  it('reads arrays, colours and matrices by value', () => {
    const u = { a: { value: [1, 2, 3] }, c: { value: new THREE.Color(1, 0, 0) }, m: { value: new THREE.Matrix4() } };
    const p = uniformsPrint(['a', 'c', 'm'], u);
    u.a.value = [1, 2, 4];
    expect(uniformsPrint(['a', 'c', 'm'], u)).not.toBe(p);
  });
});
