/**
 * nodePreviewRenderer.ts
 *
 * Singleton offscreen Three.js renderer that renders per-node preview
 * thumbnails on demand. Keeps a dataUrl cache keyed by nodeId + size,
 * invalidated when the node's fragment shader changes (tracked via sourceHash).
 */

import * as THREE from 'three';

const PREVIEW_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`.trim();

// Cache entry
interface CacheEntry {
  dataUrl: string;
  sourceHash: string;
}

let renderer: THREE.WebGLRenderer | null = null;
let renderTarget: THREE.WebGLRenderTarget | null = null;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 1;
const geometry = new THREE.PlaneGeometry(2, 2);
const cache = new Map<string, CacheEntry>();

// Cap concurrent renders (shared semaphore across all callers)
let inFlight = 0;
const MAX_CONCURRENT = 3;
const queue: Array<() => void> = [];

function getRenderer(size: number): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderTarget = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });
  }
  // Resize if needed (renders are serialised by the semaphore, so this is safe)
  const currentSize = renderer.getSize(new THREE.Vector2());
  if (currentSize.x !== size) {
    renderer.setSize(size, size);
    renderTarget!.setSize(size, size);
  }
  return renderer;
}

function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise(resolve => queue.push(resolve));
}

function releaseSlot() {
  const next = queue.shift();
  if (next) {
    next();
  } else {
    inFlight--;
  }
}

/**
 * Render the given fragment shader into an 80×80 offscreen canvas and return
 * a data URL. Results are cached by nodeId + sourceHash.
 */
export async function renderNodePreview(
  nodeId: string,
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
  size = 80,
): Promise<string> {
  const cacheKey = `${nodeId}@${size}`;
  const sourceHash = fragmentShader.slice(0, 200) + Object.keys(uniforms).join(',');
  const cached = cache.get(cacheKey);
  if (cached?.sourceHash === sourceHash) return cached.dataUrl;

  await acquireSlot();
  try {
    const r = getRenderer(size);
    const rt = renderTarget!;

    const material = new THREE.ShaderMaterial({
      vertexShader: PREVIEW_VERTEX,
      fragmentShader,
      uniforms: {
        u_time:       { value: uniforms.u_time?.value ?? 0 },
        u_resolution: { value: new THREE.Vector2(size, size) },
        u_mouse:      { value: new THREE.Vector2(0, 0) },
        ...uniforms,
      },
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    r.setRenderTarget(rt);
    r.render(scene, camera);
    r.setRenderTarget(null);

    scene.remove(mesh);
    material.dispose();

    // Read pixels → offscreen canvas → data URL
    const buf = new Uint8Array(size * size * 4);
    r.readRenderTargetPixels(rt, 0, 0, size, size, buf);

    const offscreen = document.createElement('canvas');
    offscreen.width  = size;
    offscreen.height = size;
    const ctx = offscreen.getContext('2d')!;
    const imgData = ctx.createImageData(size, size);

    // WebGL is bottom-up; flip vertically
    for (let y = 0; y < size; y++) {
      const srcRow = (size - 1 - y) * size * 4;
      const dstRow = y * size * 4;
      imgData.data.set(buf.subarray(srcRow, srcRow + size * 4), dstRow);
    }
    ctx.putImageData(imgData, 0, 0);

    const dataUrl = offscreen.toDataURL('image/jpeg', 0.85);
    cache.set(cacheKey, { dataUrl, sourceHash });
    return dataUrl;
  } finally {
    releaseSlot();
  }
}

/** Invalidate all cached previews for a node (call when its connections change). */
export function invalidatePreview(nodeId: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${nodeId}@`)) cache.delete(key);
  }
}
