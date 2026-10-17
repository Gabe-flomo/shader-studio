/**
 * The Pictures folder (store/pictureExamples.ts) and the built-in photos (lib/builtinImages.ts): every
 * example compiles and opens on a built-in photo, every node carries a note, and the pixel sort's Pass
 * really sorts: its compiled program is run on the CPU (glslRun.ts, nearest reads as a Nearest Pass)
 * step after step on a small random picture.
 */
import { describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../graphCompiler';
import type { CompilationResult } from '../types';
import { buildPictureExamples, PICTURE_EXAMPLE_KEYS } from '../../store/pictureExamples';
import { EXAMPLE_FOLDERS } from '../../store/exampleIndex';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import {
  BUILTIN_IMAGES, ROOM_AND_CAT_ID, WALKWAY_CAT_ID, builtinImageBlob, builtinImageParams, builtinImageUrl, canDecodeImage, isBuiltinImage,
} from '../../lib/builtinImages';
import { getImage, hasImage } from '../../lib/backgroundLibrary';
import { compileFragment, drawPass, makeBoard, setTexel, texel, type Board, type Env } from './glslRun';

describe('built-in pictures', () => {
  it('name two photos under media/, with their shapes', () => {
    expect(Object.keys(BUILTIN_IMAGES)).toEqual([ROOM_AND_CAT_ID, WALKWAY_CAT_ID]);
    expect(builtinImageUrl(ROOM_AND_CAT_ID)).toMatch(/media\/room-and-cat\.jpg$/);
    expect(builtinImageUrl(WALKWAY_CAT_ID)).toMatch(/media\/walkway-cat\.jpg$/);
    expect(builtinImageUrl('bg_nope')).toBe('');
    expect(isBuiltinImage(ROOM_AND_CAT_ID)).toBe(true);
    expect(isBuiltinImage('bg_123')).toBe(false);
    expect(builtinImageParams(ROOM_AND_CAT_ID)).toMatchObject({ libraryId: ROOM_AND_CAT_ID, _imageName: 'Room and cat', _imageAspect: 1280 / 720 });
    expect(builtinImageParams(WALKWAY_CAT_ID)._imageAspect).toBeCloseTo(0.75, 6);
  });
  it('are never fetched where pictures cannot be decoded (tests); the library still counts them as there', async () => {
    expect(canDecodeImage()).toBe(false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await builtinImageBlob(ROOM_AND_CAT_ID)).toBeNull();
    expect(await getImage(ROOM_AND_CAT_ID)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(await hasImage(WALKWAY_CAT_ID)).toBe(true);
  });
});

describe('the Pictures examples', () => {
  const built = buildPictureExamples();
  it('are a folder of their own, all registered', () => {
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Pictures')?.keys).toEqual(PICTURE_EXAMPLE_KEYS);
    expect(Object.keys(built)).toEqual(PICTURE_EXAMPLE_KEYS);
    for (const k of PICTURE_EXAMPLE_KEYS) expect(EXAMPLE_GRAPHS[k]).toBeDefined();
  });
  it.each(PICTURE_EXAMPLE_KEYS)('%s compiles, opens on a built-in photo, and every node has a note', key => {
    const g = built[key];
    const r = compileGraph({ nodes: g.nodes }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    const pics = g.nodes.filter(nd => nd.type === 'textureInput');
    expect(pics.length).toBeGreaterThan(0);
    for (const p of pics) expect(isBuiltinImage(String(p.params.libraryId))).toBe(true);
    for (const nd of g.nodes) expect(typeof nd.params.__comment === 'string' && (nd.params.__comment as string).length > 10, nd.id).toBe(true);
    expect(g.description).toMatch(/choose your own picture on the Texture Input/i);
    // Play controls aim at nodes that exist.
    for (const c of g.play?.controls ?? []) expect(g.nodes.some(nd => nd.id === c.target.split('::')[0]), c.target).toBe(true);
  });
});

// ── The pixel sort, run on the CPU ───────────────────────────────────────────────────────────────

const W = 14, H = 5;
const LUMA = [0.299, 0.587, 0.114];
const lum = (c: number[]) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

function sortRig(vertical: number) {
  const g = buildPictureExamples().picPixelSort;
  const nodes = g.nodes.map(nd => (nd.id === 'vertical' ? { ...nd, params: { ...nd.params, value: vertical } } : nd));
  const r = compileGraph({ nodes }) as CompilationResult;
  expect(r.errors ?? []).toEqual([]);
  const pass = r.passes!.find(p => p.nodeId === 'sort')!;
  const prog = compileFragment(pass.fragmentShader);
  const prevName = `u_passprev_${pass.slug}`;
  const texName = (/texture2D\((u_tex_\w+)/.exec(pass.fragmentShader) ?? [])[1];
  const uniforms: Env = { u_time: 0, u_resolution: [W, H], [`${prevName}_px`]: [1 / W, 1 / H] };
  for (const [k, v] of Object.entries(r.paramUniforms)) uniforms[k] = Array.isArray(v) ? [...v] : v as number;
  // A random photo, quantised to 8 bits as a JPEG's texels are.
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return Math.round(((s - 1) / 2147483646) * 255) / 255; };
  const photo = makeBoard(W, H, 'clamp');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) setTexel(photo, x, y, [rnd(), rnd(), rnd(), 1]);
  let prev: Board = makeBoard(W, H, 'clamp');
  const step = () => { prev = drawPass(prog, W, H, 'clamp', { [texName]: photo, [prevName]: prev }, uniforms); return prev; };
  return { pass, photo, step, uniforms, prog, texName, prevName };
}

const line = (b: Board, i: number, vertical: boolean) =>
  Array.from({ length: vertical ? H : W }, (_, k) => texel(b, vertical ? i : k, vertical ? k : i));

describe('Pictures 7 · Pixel sort', () => {
  it('reads its own Previous exactly: a full-size Nearest Pass, the neighbours one texel away', () => {
    const { pass } = sortRig(0);
    expect(pass).toMatchObject({ filter: 'nearest', scale: 1, previous: true, repeat: 4 });
    expect(pass.readsPrevious).toEqual([pass.slug]);
    const g = buildPictureExamples().picPixelSort;
    const offs = g.nodes.filter(nd => nd.type === 'sampleTexture').map(nd => [nd.params.offsetX, nd.params.offsetY]);
    expect(offs).toEqual([[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]);
    // Every Sample reads the Pass's Previous, offset by its own texel size.
    expect(pass.fragmentShader.match(new RegExp(`\\* u_passprev_${pass.slug}_px`, 'g'))?.length).toBe(5);
  });

  for (const vertical of [0, 1]) {
    it(`starts from the photo, then sorts every in-range run dark to bright, moving colours without changing them (${vertical ? 'columns' : 'rows'})`, () => {
      const { photo, step, uniforms } = sortRig(vertical);
      const low = uniforms.u_p_lowx0_value as number, high = uniforms.u_p_highx0_value as number;
      expect(low).toBeGreaterThan(0); expect(high).toBeLessThan(1);
      // The empty Pass takes the photo, alpha 1 (the step counter).
      const first = step();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        expect(texel(first, x, y).slice(0, 3)).toEqual(texel(photo, x, y).slice(0, 3));
        expect(texel(first, x, y)[3]).toBe(1);
      }
      // The counter alternates 1 → 0.5 → 1, the same everywhere.
      const second = step();
      expect(new Set(Array.from({ length: W * H }, (_, i) => second.data[i * 4 + 3]))).toEqual(new Set([0.5]));
      let b = second;
      const n = vertical ? H : W;
      for (let k = 0; k < n + 2; k++) b = step();
      const lines = vertical ? W : H;
      let swapped = 0;
      for (let i = 0; i < lines; i++) {
        const before = line(photo, i, !!vertical), after = line(b, i, !!vertical);
        // Exact copies: the same colours, rearranged (nothing blended or invented).
        const key = (c: number[]) => c.slice(0, 3).join(',');
        expect(after.map(key).sort()).toEqual(before.map(key).sort());
        const inside = (c: number[]) => lum(c) >= low && lum(c) <= high;
        for (let k = 0; k < before.length; k++) {
          // Pixels outside Low–High stay put; the runs between them keep their places.
          expect(inside(after[k])).toBe(inside(before[k]));
          if (!inside(before[k])) expect(key(after[k])).toBe(key(before[k]));
          else if (key(after[k]) !== key(before[k])) swapped++;
          // Sorted within each run: dark to bright.
          if (k > 0 && inside(after[k]) && inside(after[k - 1])) expect(lum(after[k])).toBeGreaterThanOrEqual(lum(after[k - 1]) - 1e-9);
        }
      }
      expect(swapped).toBeGreaterThan(0);
    });
  }
});
