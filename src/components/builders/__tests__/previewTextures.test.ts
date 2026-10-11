// @vitest-environment jsdom
/**
 * The builders' previews bind their pictures (previewTextures.ts): each sampler the shader reads
 * gets the unit its picture is uploaded to, even when an earlier sampler was dropped by the GLSL
 * compiler (a picture no shape uses). Numbering units by the place in the list left the next
 * sampler on an empty unit: the 3D Scene Builder drew black after a picture was picked ("uploading
 * a picture made it all go black").
 */
import { describe, expect, it } from 'vitest';
import { bindPreviewTextures } from '../previewTextures';
import { compileGraph } from '../../../compiler/graphCompiler';
import { buildStandaloneGraph } from '../../../sceneBuilder/build';
import { parseRecipe } from '../../../sceneBuilder/recipe';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';

/** Pictures for the nodes (a canvas-like source with a size), so every bound sampler uploads one. */
function pictures(...ids: string[]) {
  useNodeGraphStore.setState({ nodeTextures: Object.fromEntries(ids.map(id => [id, { image: { width: 4, height: 4 } }])) as never });
}

/** A WebGL2 stand-in that records which unit each sampler is set to and which unit each texture is uploaded on. */
function fakeGl(readable: Set<string>) {
  let active = 0;
  const samplerUnit = new Map<string, number>();
  const uploadedOn = new Map<number, number>(); // texture id → unit
  const boundOn = new Map<number, number>(); // unit → texture id
  let next = 1;
  const gl = {
    TEXTURE0: 0x84c0, TEXTURE_2D: 1, RGBA: 2, UNSIGNED_BYTE: 3, UNPACK_FLIP_Y_WEBGL: 4, TEXTURE_MIN_FILTER: 5, TEXTURE_MAG_FILTER: 6,
    LINEAR_MIPMAP_LINEAR: 7, LINEAR: 8, TEXTURE_WRAP_S: 9, TEXTURE_WRAP_T: 10, CLAMP_TO_EDGE: 11,
    getExtension: () => null,
    getUniformLocation: (_p: unknown, name: string) => (readable.has(name) ? { name } : null),
    createTexture: () => ({ id: next++ }),
    useProgram: () => {},
    uniform1i: (loc: { name: string }, unit: number) => { samplerUnit.set(loc.name, unit); },
    activeTexture: (u: number) => { active = u - 0x84c0; },
    bindTexture: (_t: number, tex: { id: number }) => { boundOn.set(active, tex.id); },
    pixelStorei: () => {},
    texImage2D: () => { uploadedOn.set(boundOn.get(active)!, active); },
    generateMipmap: () => {},
    texParameteri: () => {},
    deleteTexture: () => {},
  };
  return { gl: gl as unknown as WebGL2RenderingContext, samplerUnit, uploadedOn, boundOn };
}

describe('preview pictures', () => {
  it('a sampler after a dropped one reads the unit its picture is on', () => {
    // u_tex_old: the template's picture, which no shape reads any more; u_tex_new: the one picked.
    pictures('tex_old', 'tex_new');
    const f = fakeGl(new Set(['u_tex_new']));
    const pics = bindPreviewTextures(f.gl, {} as WebGLProgram, { u_tex_old: 'tex_old', u_tex_new: 'tex_new' });
    pics.refresh(0);
    const unit = f.samplerUnit.get('u_tex_new');
    expect(unit).toBe(0);
    // The texture bound on that unit is the one that was uploaded there.
    const tex = f.boundOn.get(unit!)!;
    expect(f.uploadedOn.get(tex)).toBe(unit);
  });

  it('every read sampler gets its own unit, matching its upload', () => {
    pictures('n1', 'n2', 'n3');
    const f = fakeGl(new Set(['a', 'c']));
    bindPreviewTextures(f.gl, {} as WebGLProgram, { a: 'n1', b: 'n2', c: 'n3' }).refresh(0);
    expect([f.samplerUnit.get('a'), f.samplerUnit.get('c')]).toEqual([0, 1]);
    for (const u of [0, 1]) expect(f.uploadedOn.get(f.boundOn.get(u)!)).toBe(u);
  });

  it('the scene from the report (a cube painted, Repeat 2, an unused template picture before it) compiles with only its painted picture as a sampler', () => {
    const recipe = 'surface · texture picture · texture img aspect=1.5 · box size=0.5 texture=img tiles=2.97 tex-offset=(0.3,0.2) tex-rot=25 bump=0 @repeat(2)';
    for (const map of ['triplanar', 'face']) {
      const r0 = parseRecipe(recipe.replace('bump=0', `bump=0 map=${map}`));
      expect(r0.errors).toEqual([]);
      const g = buildStandaloneGraph(r0.spec);
      const r = compileGraph({ nodes: g.nodes });
      expect(r.success, String(r.errors)).toBe(true);
      // Only the painted picture is a sampler: the unread one gets no stand-in (docs/scene-builder-3d.md, "What Build makes").
      expect(Object.values(r.textureUniforms)).toEqual(['tex_img']);
      const used = Object.entries(r.textureUniforms).find(([, id]) => id === 'tex_img')![0];
      expect(r.fragmentShader).toMatch(new RegExp(`textureGrad\\(${used}|texture2D\\(${used}, [a-z]`));
    }
  });
});
