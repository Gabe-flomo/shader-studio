/**
 * Keeps a material's data textures (dataGlsl.ts) filled: `bind(shader)` after
 * each compile creates the textures and row-count uniforms the shader
 * declares, and every change to a dataset re-uploads its textures in place
 * (datasetStore.subscribeAll), without touching the shader.
 *
 * Float textures (RGBA32F, nearest) read with texelFetch are core WebGL2, which
 * the preview always runs on.
 */
import * as THREE from 'three';
import { dataBindingsFromShader } from './dataGlsl';
import { datasetStore } from './datasetStore';
import { packColumns } from './texturePack';
import { isTable } from './types';

type Uniforms = Record<string, THREE.IUniform>;

interface Bound { dataset: string; columns: string[]; tex: THREE.DataTexture; version: number }

export class DataTextureBinder {
  private textures = new Map<string, Bound>();
  private counts = new Map<string, string>();
  private readonly uniforms: Uniforms;
  private readonly onChange: () => void;
  private readonly unsubscribe: () => void;

  constructor(uniforms: Uniforms, onChange: () => void) {
    this.uniforms = uniforms;
    this.onChange = onChange;
    this.unsubscribe = datasetStore.subscribeAll(id => this.refresh(id));
  }

  /** Match the textures to what `fragmentShader` declares. */
  bind(fragmentShader: string): void {
    const b = dataBindingsFromShader(fragmentShader);
    const want = new Set(b.textures.map(t => t.uniform));
    for (const [u, t] of this.textures) {
      if (want.has(u)) continue;
      t.tex.dispose();
      this.textures.delete(u);
      // The uniform entry stays (another program may still declare it) but no longer holds a texture.
      if (this.uniforms[u]) this.uniforms[u].value = null;
    }
    for (const t of b.textures) {
      const had = this.textures.get(t.uniform);
      if (had && had.version === datasetStore.version(t.dataset)) { this.uniforms[t.uniform] = this.uniforms[t.uniform] ?? { value: had.tex }; this.uniforms[t.uniform].value = had.tex; continue; }
      this.upload(t.uniform, t.dataset, t.columns);
    }
    this.counts = new Map(b.counts.map(c => [c.uniform, c.dataset]));
    for (const [u, ds] of this.counts) this.setCount(u, ds);
  }

  private setCount(uniform: string, dataset: string): void {
    const r = datasetStore.effective(dataset);
    const n = isTable(r) ? r.rows : 0;
    if (this.uniforms[uniform]) this.uniforms[uniform].value = n;
    else this.uniforms[uniform] = { value: n };
  }

  private upload(uniform: string, dataset: string, columns: string[]): void {
    const r = datasetStore.effective(dataset);
    const packed = packColumns(isTable(r) ? r : null, columns);
    const had = this.textures.get(uniform);
    let tex: THREE.DataTexture;
    if (had && had.tex.image.width === packed.width && had.tex.image.height === packed.height) {
      tex = had.tex;
      (tex.image.data as Float32Array).set(packed.data);
      tex.needsUpdate = true;
    } else {
      had?.tex.dispose();
      tex = new THREE.DataTexture(packed.data, packed.width, packed.height, THREE.RGBAFormat, THREE.FloatType);
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
    }
    this.textures.set(uniform, { dataset, columns, tex, version: datasetStore.version(dataset) });
    if (this.uniforms[uniform]) this.uniforms[uniform].value = tex;
    else this.uniforms[uniform] = { value: tex };
  }

  /** A dataset changed: re-upload its textures and row count. */
  private refresh(dataset: string): void {
    let touched = false;
    for (const [u, t] of this.textures) if (t.dataset === dataset) { this.upload(u, t.dataset, t.columns); touched = true; }
    for (const [u, ds] of this.counts) if (ds === dataset) { this.setCount(u, ds); touched = true; }
    if (touched) this.onChange();
  }

  dispose(): void {
    this.unsubscribe();
    for (const t of this.textures.values()) t.tex.dispose();
    this.textures.clear();
  }
}
