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

/** What to show for a source node now (and whether it changes by itself, a Shader Texture). */
export function previewImageFor(nodeId: string): { image: PreviewImage | null; live: boolean } {
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
