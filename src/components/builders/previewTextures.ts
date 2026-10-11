/**
 * previewTextures.ts — pictures in the builders' own previews (docs/scene-builder.md, "Textures").
 *
 * A builder's preview compiles a stand-alone graph whose pictures are stand-in Texture nodes with the
 * real sources' ids (builders/textures.ts `standIns`), so the compile's `textureUniforms` say which
 * graph node each sampler shows. This finds what to upload for a node: the picture the app holds for
 * a Texture node, the last frame of a Shader Texture (its card's thumbnail), or a grey checker while
 * there is none yet. And it binds them into the preview's own WebGL2 context, with mipmaps and
 * anisotropic filtering, refreshing when the picture changes.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { passThumbRegistry } from '../../lib/passRunner';
import { depthEngine } from '../../lib/depth/engine';
import { getImage } from '../../lib/backgroundLibrary';
import { DEPTH_TYPE, depthBakeId, depthPlaysBake, type DepthBakeInfo } from '../../nodes/definitions/depth';
import type { GraphNode } from '../../types/nodeGraph';

export type PreviewImage = TexImageSource;

let checker: HTMLCanvasElement | null = null;
/** A grey checker: a source with no picture yet. */
function checkerImage(): HTMLCanvasElement | null {
  if (checker || typeof document === 'undefined') return checker;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  if (!x) return null;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.fillStyle = (i + j) % 2 ? '#3a3a44' : '#5c5c68'; x.fillRect(i * 8, j * 8, 8, 8); }
  checker = c;
  return c;
}

// ── Depth in the previews (docs/depth-mix.md) ───────────────────────────────
//
// A built scene's Depth node reads a texture the depth engine fills in the main preview; a builder's preview is a
// graph of its own (its own ids), so it shows, in order: the depth Generate depth baked (an image in the library),
// the depth a Depth node of the main graph already worked out for the same picture, or else the picture's brightness
// as a stand-in (so the looks can be tried before the model runs).

interface DepthPreview { bake: DepthBakeInfo | null; picture: string | null }
const depthPreviews = new Map<string, DepthPreview>();
const bakedImages = new Map<string, HTMLCanvasElement | 'loading' | 'missing'>();
const liveCanvases = new WeakMap<Float32Array, HTMLCanvasElement>();
const standIns = new WeakMap<object, HTMLCanvasElement>();

/** A builder's preview graph: note its Depth nodes, so their sampler shows a depth (not the checker). */
export function registerPreviewDepth(nodes: readonly GraphNode[]): void {
  for (const n of nodes) {
    if (n.type !== DEPTH_TYPE) continue;
    depthPreviews.set(n.id, { bake: depthPlaysBake(n), picture: n.inputs.texture?.connection?.nodeId ?? null });
  }
}

const canvasOf = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function bakedImage(b: DepthBakeInfo): HTMLCanvasElement | null {
  const id = depthBakeId(b);
  const got = bakedImages.get(id);
  if (got && got !== 'loading' && got !== 'missing') return got;
  if (!got && typeof document !== 'undefined') {
    bakedImages.set(id, 'loading');
    void getImage(id).then(async img => {
      if (!img) { bakedImages.set(id, 'missing'); return; }
      const bmp = await createImageBitmap(img.blob);
      const c = canvasOf(bmp.width, bmp.height);
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      bmp.close?.();
      bakedImages.set(id, c);
    }).catch(() => bakedImages.set(id, 'missing'));
  }
  return null;
}

/** The depth a Depth node of the main graph already has for this picture, as a grey canvas (top row first). */
function liveDepth(picture: string | null): HTMLCanvasElement | null {
  if (!picture || typeof document === 'undefined') return null;
  for (const n of useNodeGraphStore.getState().nodes) {
    if (n.type !== DEPTH_TYPE || n.inputs.texture?.connection?.nodeId !== picture) continue;
    const d = depthEngine.currentDepth(n.id);
    if (!d) continue;
    let c = liveCanvases.get(d.depth);
    if (!c) {
      c = canvasOf(d.w, d.h);
      const px = new Uint8ClampedArray(d.w * d.h * 4);
      for (let i = 0; i < d.w * d.h; i++) { const v = Math.round(Math.max(0, Math.min(1, d.depth[i])) * 255); px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
      c.getContext('2d')!.putImageData(new ImageData(px, d.w, d.h), 0, 0);
      liveCanvases.set(d.depth, c);
    }
    return c;
  }
  return null;
}

/** The picture's brightness, softened: a stand-in depth until the model has run. */
function brightnessDepth(picture: string | null): HTMLCanvasElement | null {
  if (!picture || typeof document === 'undefined') return null;
  const img = useNodeGraphStore.getState().nodeTextures[picture]?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width) return null;
  let c = standIns.get(img);
  if (!c) {
    const w = Math.min(256, img.width), h = Math.max(1, Math.round(w * img.height / img.width));
    c = canvasOf(w, h);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.filter = 'grayscale(1) blur(2px)';
    g.drawImage(img, 0, 0, w, h);
    standIns.set(img, c);
  }
  return c;
}

export type PreviewDepthKind = 'baked' | 'live' | 'stand-in' | 'none';

/** What a builder's preview shows for a picture's depth now: for the "the preview uses…" note. */
export function previewDepthKind(picture: string | null | undefined, bake: DepthBakeInfo | null | undefined): PreviewDepthKind {
  if (bake && bakedImage(bake)) return 'baked';
  if (liveDepth(picture ?? null)) return 'live';
  if (brightnessDepth(picture ?? null)) return 'stand-in';
  return 'none';
}

/** What to show for a source node now (and whether it changes by itself, a Shader Texture). */
export function previewImageFor(nodeId: string): { image: PreviewImage | null; live: boolean } {
  const dp = depthPreviews.get(nodeId);
  if (dp) {
    const img = (dp.bake ? bakedImage(dp.bake) : null) ?? liveDepth(dp.picture) ?? brightnessDepth(dp.picture);
    // A new image (the bake loaded, the model ran) is a new object: refresh picks it up within ten frames.
    return { image: img ?? checkerImage(), live: false };
  }
  const tex = useNodeGraphStore.getState().nodeTextures[nodeId];
  const img = tex?.image as PreviewImage | undefined;
  if (img && (img as { width?: number }).width) return { image: img, live: false };
  const thumb = passThumbRegistry.get(nodeId);
  if (thumb && thumb.width > 0) return { image: thumb, live: true };
  return { image: checkerImage(), live: false };
}

interface Bound { uniform: string; nodeId: string; tex: WebGLTexture; src: PreviewImage | null; live: boolean; unit: number }

/** Bind the samplers of a compiled preview: returns `refresh` (call every frame) and `dispose`. */
export function bindPreviewTextures(gl: WebGL2RenderingContext, prog: WebGLProgram, uniforms: Record<string, string> | undefined): { refresh: (frame: number) => void; dispose: () => void } {
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const maxAniso = aniso ? Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0;
  const bound: Bound[] = [];
  // A sampler the shader doesn't read (a picture no shape uses: the GLSL compiler drops it) has no
  // location and gets no unit. The unit is the bound texture's own, so the samplers after it read
  // the unit their picture is uploaded to: numbering them by their place in `uniforms` set the next
  // sampler to unit 1 while its picture went to unit 0, and the scene read black ("uploading a
  // picture made it all go black": the template's unused picture before the new one).
  Object.entries(uniforms ?? {}).forEach(([uniform, nodeId]) => {
    const loc = gl.getUniformLocation(prog, uniform);
    if (!loc) return;
    const tex = gl.createTexture();
    if (!tex) return;
    const unit = bound.length;
    gl.useProgram(prog);
    gl.uniform1i(loc, unit);
    bound.push({ uniform, nodeId, tex, src: null, live: false, unit });
  });
  const upload = (b: Bound, unit: number, img: PreviewImage) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, b.tex);
    // As three uploads a picture: rows flipped, so 0 is the bottom.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); } catch { return; }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso && maxAniso > 1) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
  };
  const refresh = (frame: number) => {
    bound.forEach(b => {
      const { unit } = b;
      // A new picture shows at once; a Shader Texture's frame is copied a few times a second.
      if (b.src && frame % 10 !== 0) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, b.tex); return; }
      const now = previewImageFor(b.nodeId);
      if (now.image && (now.image !== b.src || (now.live && frame % 20 === 0))) upload(b, unit, now.image);
      else { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, b.tex); }
      b.src = now.image; b.live = now.live;
    });
  };
  return { refresh, dispose: () => { for (const b of bound) gl.deleteTexture(b.tex); } };
}
