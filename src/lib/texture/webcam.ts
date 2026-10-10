/**
 * webcam.ts — the Texture node's Webcam source (docs/texture-node.md).
 *
 * - The picture: the shared camera (lib/cameraInput.ts) as one VideoTexture, bound into each
 *   webcam Texture node's `u_vid_<slug>` through the store's video textures, as a Video
 *   Input's file is.
 * - The settings and hand tracking live in Play: choosing Webcam adds a Camera layer to the
 *   graph's Play setup (hidden, so it doesn't cover the picture) when there is none. Its
 *   camera, mirror and hand tracking are what the card shows, and the hands map to the
 *   graph's nodes through Play's mappings (the card opens Play's mini mapper).
 */
import * as THREE from 'three';
import type { GraphNode } from '../../types/nodeGraph';
import type { PlayRecord } from '../../types/play';
import type { CameraLayer } from '../../types/playLayers';
import { defaultLayer } from '../../types/playLayers';
import { webcamNodes } from './textureSource';

/** The Play setup's first Camera layer, if any. */
export function cameraLayerOf(play: Pick<PlayRecord, 'layers'>): CameraLayer | null {
  return (play.layers.find(l => l.kind === 'camera') as CameraLayer | undefined) ?? null;
}

/**
 * The Play setup with a Camera layer: the one it has, or a new one (hidden and not drawn
 * into the shader's layers: the Texture node shows the camera; the layer carries its
 * settings, hand tracking and mappings). Same object when nothing had to change.
 */
export function ensureCameraLayer(play: PlayRecord, newId: () => string, mirror = true): { play: PlayRecord; layer: CameraLayer; created: boolean } {
  const had = cameraLayerOf(play);
  if (had) return { play, layer: had, created: false };
  const layer = { ...(defaultLayer('camera', newId(), 'Webcam (Texture node)') as CameraLayer), visible: false, toShader: false, mirror };
  return { play: { ...play, layers: [...play.layers, layer] }, layer, created: true };
}

/** The camera layer's mirror set (both the layer and every webcam Texture node follow it). */
export function setCameraMirror(play: PlayRecord, mirror: boolean): PlayRecord {
  const cam = cameraLayerOf(play);
  if (!cam) return play;
  return { ...play, layers: play.layers.map(l => (l.id === cam.id ? { ...l, mirror } as typeof l : l)) };
}

/** A webcam node's params for a mirror (a horizontal flip in its GLSL). */
export const mirrorParams = (mirror: boolean): Record<string, unknown> => ({ mirror, clip: mirror ? { flipX: true } : undefined });

export interface WebcamHost {
  element(): HTMLVideoElement | null;
  setTexture(nodeId: string, tex: THREE.VideoTexture | null): void;
}

/** Binds the camera's picture into every webcam Texture node. */
export class WebcamTextures {
  private tex: THREE.VideoTexture | null = null;
  private bound = new Map<string, THREE.VideoTexture | null>();
  private host: WebcamHost;
  constructor(host: WebcamHost) { this.host = host; }

  /** Is a webcam node showing the camera (the preview keeps drawing)? */
  active(): boolean { return !!this.tex && this.bound.size > 0 && [...this.bound.values()].some(Boolean); }

  sync(nodes: readonly GraphNode[]): void {
    const ids = new Set(webcamNodes(nodes).map(n => n.id));
    const el = ids.size ? this.host.element() : null;
    if (el && (!this.tex || this.tex.image !== el)) {
      this.tex?.dispose();
      // As a Video Input's file (lib/videoEngine.ts): no mipmaps, linear.
      this.tex = new THREE.VideoTexture(el);
      this.tex.minFilter = THREE.LinearFilter;
      this.tex.magFilter = THREE.LinearFilter;
      this.tex.format = THREE.RGBAFormat;
    } else if (!el && this.tex && !ids.size) {
      this.tex.dispose();
      this.tex = null;
    }
    const want = el ? this.tex : null;
    for (const id of ids) if (this.bound.get(id) !== want) { this.bound.set(id, want); this.host.setTexture(id, want); }
    for (const id of [...this.bound.keys()]) if (!ids.has(id)) { this.bound.delete(id); this.host.setTexture(id, null); }
  }
}
