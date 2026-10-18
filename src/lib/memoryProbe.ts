/**
 * memoryProbe — a memory node's state (nodes/definitions/memory.ts) read back from the GPU for its card, while
 * a card asks for it: the Envelope card's playhead (components/NodeGraph/EnvelopeCardViz.tsx).
 *
 * Every top-level memory node keeps a vec4 in the shared `__memory` Pass (compiler/memoryExpand.ts), texel i of
 * row 0 for the i-th memory node (in graph order, bypassed ones left out). After its passes run, the live preview
 * (ShaderCanvas.tsx → PassRunner.readMemory) hands that texture here; one asynchronous read of row 0 a frame, only
 * while a card watches, so the CPU never waits on the GPU.
 */
import * as THREE from 'three';
import type { GraphNode } from '../types/nodeGraph';
import { isMemoryNode } from '../compiler/memoryExpand';

const watchers = new Map<string, number>();
const values = new Map<string, Float32Array>();
let pending = false;
let buf: Float32Array | Uint16Array | Uint8Array | null = null;

/** Each memory node's texel in the `__memory` Pass (as memoryExpand numbers them). */
export function memoryIndexOf(nodes: readonly GraphNode[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of nodes) if (isMemoryNode(n) && !n.bypassed) out.set(n.id, out.size);
  return out;
}

export const memoryProbe = {
  /** Start reading a node's state; the returned function stops. */
  watch(id: string): () => void {
    watchers.set(id, (watchers.get(id) ?? 0) + 1);
    return () => {
      const n = (watchers.get(id) ?? 1) - 1;
      if (n > 0) watchers.set(id, n);
      else { watchers.delete(id); values.delete(id); }
    };
  },
  wanted(): boolean { return watchers.size > 0; },
  /** The node's last state read (s.x, s.y, s.z, s.w), or undefined before the first read. */
  get(id: string): Float32Array | undefined { return values.get(id); },

  /** The live preview, after its passes: read row 0 of the memory Pass's texture (`rt`). */
  read(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget, nodes: readonly GraphNode[]): void {
    if (pending || !watchers.size) return;
    const index = memoryIndexOf(nodes);
    const w = Math.min(rt.width, Math.max(1, index.size));
    const type = rt.texture.type;
    const len = w * 4;
    if (type === THREE.FloatType) { if (!(buf instanceof Float32Array) || buf.length !== len) buf = new Float32Array(len); }
    else if (type === THREE.HalfFloatType) { if (!(buf instanceof Uint16Array) || buf.length !== len) buf = new Uint16Array(len); }
    else if (!(buf instanceof Uint8Array) || buf.length !== len) buf = new Uint8Array(len);
    const b = buf;
    const done = () => {
      pending = false;
      for (const id of watchers.keys()) {
        const i = index.get(id);
        if (i === undefined || i >= w) continue;
        const v = values.get(id) ?? new Float32Array(4);
        for (let k = 0; k < 4; k++) {
          const raw = b[i * 4 + k];
          v[k] = b instanceof Float32Array ? raw : b instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(raw) : raw / 255;
        }
        values.set(id, v);
      }
    };
    pending = true;
    try {
      const p = (renderer as unknown as { readRenderTargetPixelsAsync?: (...a: unknown[]) => Promise<unknown> }).readRenderTargetPixelsAsync;
      if (p) p.call(renderer, rt, 0, 0, w, 1, b).then(done, () => { pending = false; });
      else { renderer.readRenderTargetPixels(rt, 0, 0, w, 1, b); done(); }
    } catch { pending = false; }
  },
};
