import type * as THREE from 'three';

/** A 3D sketch's state (sketch3d.js): its scene, camera and pools. `api` is what the sketch sees as `s.three`. */
export interface K3Sketch {
  T: typeof THREE;
  scene: THREE.Scene;
  /** The p5-style shapes and lights: flipped in y, so y goes down. */
  root: THREE.Group;
  persp: THREE.PerspectiveCamera;
  batchList: Array<{ key: string; n: number; cap: number; mesh: THREE.InstancedMesh }>;
  lineN: number;
  lights: { ambient: THREE.AmbientLight[]; directional: THREE.DirectionalLight[]; point: THREE.PointLight[] };
  lightUse: { ambient: number; directional: number; point: number };
  api: { THREE: typeof THREE; scene: THREE.Scene; camera: THREE.Camera; renderer: THREE.WebGLRenderer | null; root: THREE.Group };
}

export const K3_SKETCH_NAMES: readonly string[];
export function k3Create(T: unknown): K3Sketch;
export function k3Helpers(g: K3Sketch, base: Record<string, unknown>, get: () => unknown): Record<string, unknown>;
export function k3Setup(g: K3Sketch, W: number, H: number): void;
export function k3Begin(g: K3Sketch, W: number, H: number): void;
export function k3End(g: K3Sketch): void;
export function k3Dispose(g: K3Sketch): void;
/** A shared WebGL renderer for a W × H picture (null without a document or WebGL). */
export function k3Renderer(T: unknown, W: number, H: number): THREE.WebGLRenderer | null;
/** Render the sketch's scene; returns the renderer's canvas to copy from at once. */
export function k3Render(g: K3Sketch, renderer: THREE.WebGLRenderer | null, W: number, H: number): HTMLCanvasElement | null;
/** A canvas (the picture) as a texture, re-uploaded when `stamp` changes. */
export function k3PictureTexture(T: unknown, src: CanvasImageSource | null, stamp: number): THREE.Texture | null;
