/**
 * Time Cube from pictures (docs/time-cube.md, "From pictures"): N pictures fill N frames in order,
 * past Frames they are refused with a note, a saved graph keeps them (embedded, nothing added to the
 * Library), the desktop keeps paths (not bytes), reorder / reverse, and the builder offers Pictures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const ls: Record<string, string> = {};
  const hidden = (k: string, v: unknown) => Object.defineProperty(ls, k, { value: v, enumerable: false });
  hidden('getItem', (k: string) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null));
  hidden('setItem', (k: string, v: string) => { ls[k] = String(v); });
  hidden('removeItem', (k: string) => { delete ls[k]; });
  hidden('clear', () => { for (const k of Object.keys(ls)) delete ls[k]; });
  hidden('key', (i: number) => Object.keys(ls)[i] ?? null);
  Object.defineProperty(ls, 'length', { get: () => Object.keys(ls).length, enumerable: false });
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});

// Nothing may be added to the Library: every way in is a spy.
const library = vi.hoisted(() => ({ addImage: vi.fn(), addVideoFile: vi.fn(), importImageFile: vi.fn() }));
vi.mock('../../backgroundLibrary', async orig => ({ ...(await orig<typeof import('../../backgroundLibrary')>()), ...library }));

// The desktop's file system: a file's bytes are its path, so the test can tell which was read.
const fs = vi.hoisted(() => ({ readFile: vi.fn(async (path: string) => new TextEncoder().encode(`disk:${path}`)) }));
vi.mock('@tauri-apps/plugin-fs', () => fs);
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => ['/Users/me/shots/frame 10.png', '/Users/me/shots/frame 2.png']) }));

import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../../nodes/definitions';
import { timeCubeDeclarations } from '../../../nodes/definitions/timeCube';
import type { GraphNode } from '../../../types/nodeGraph';
import {
  EMBED_TOTAL, fitRect, movePicture, pictureForTile, picturesKey, picturesOf, reversePictures, sortByName, takePictures, usedPictures, type TcPicture,
} from '../pictures';
import { clearPictureSession, drawPictures, picturesFromFiles, picturesFromPaths, pickPicturePaths, type PictureIO } from '../pictureSource';
import { timeCubePlan, timeCubeSource, timeCubeSourceName, volumeKey } from '../volumes';
import { blankSpec, groupsFor, sectionSummary, sourceName } from '../../../timeCubeBuilder/spec';
import { withPreset } from '../../../timeCubeBuilder/presets';

/** A picture's "decoding": its bytes as text stand for the image (size 640 × 360 unless the name says). */
const io: PictureIO = {
  decode: async blob => {
    const text = await blob.text();
    const tall = text.includes('tall');
    return { el: text as unknown as CanvasImageSource, width: tall ? 300 : 640, height: tall ? 600 : 360, close: () => {} };
  },
  embed: (d, max) => `data:text/plain,${encodeURIComponent(String(d.el))}`.slice(0, max),
  thumb: () => '',
};

const file = (name: string, body = name) => Object.assign(new Blob([body], { type: 'image/png' }), { name });
const timeCube = (params: Record<string, unknown>): GraphNode => {
  const def = getNodeDefinition('timeCube')!;
  return { id: 'tc', type: 'timeCube', position: { x: 0, y: 0 }, inputs: {}, outputs: { volume: { type: 'volume', label: 'Volume' } }, params: { ...structuredClone(def.defaultParams), ...params } } as GraphNode;
};

/** A canvas context that records which picture went into which tile. */
function recordingCtx() {
  const drawn: Array<{ what: string; x: number; y: number; w: number; h: number }> = [];
  let clip = { x: 0, y: 0 };
  const ctx = {
    save() {}, restore() {}, beginPath() {}, clip() {}, imageSmoothingQuality: 'low',
    rect(x: number, y: number) { clip = { x, y }; },
    drawImage(el: unknown, _sx: number, _sy: number, _sw: number, _sh: number, dx: number, dy: number, dw: number, dh: number) { drawn.push({ what: String(el), x: clip.x, y: clip.y, w: dw, h: dh }); void dx; void dy; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

beforeEach(() => { clearPictureSession(); library.addImage.mockClear(); library.addVideoFile.mockClear(); library.importImageFile.mockClear(); fs.readFile.mockClear(); });

describe('picking pictures', () => {
  it('fills N frames with N pictures, in file-name order', async () => {
    const names = Array.from({ length: 24 }, (_, i) => `dot ${24 - i}.png`);
    const { pictures, unreadable } = await picturesFromFiles(names.map(n => file(n)), 24, io);
    expect(unreadable).toBe(0);
    const { list, refused, note } = takePictures([], pictures, 128);
    expect(refused).toBe(0); expect(note).toBe('');
    expect(list.map(p => p.name)).toEqual(Array.from({ length: 24 }, (_, i) => `dot ${i + 1}.png`));

    const node = timeCube({ source: 'pictures', pictures: list });
    expect(timeCubeSource(node)).toEqual({ kind: 'pictures' });
    expect(timeCubeSourceName(node)).toBe('24 pictures');
    const plan = timeCubePlan(node)!;
    expect(plan.frames).toBe(24);
    expect(plan.tileH).toBe(Math.round(256 / (640 / 360) / 8) * 8);
    // The shader's layout define says 24 frames.
    expect(timeCubeDeclarations(node)[0]).toMatch(/vec4\([\d.]+, [\d.]+, 24\.0,/);

    // Each tile is its picture, in order.
    const { ctx, drawn } = recordingCtx();
    const done: number[] = [];
    const unread = await drawPictures(usedPictures(node.params), plan, ctx, 'cover', d => done.push(d), new AbortController().signal, io);
    expect(unread).toBe(0);
    expect(drawn.map(d => d.what)).toEqual(list.map(p => p.name));
    expect(drawn[1].x).toBe(plan.tileW);
    expect(done.at(-1)).toBe(24);
  });

  it('refuses pictures past the frame count, with a note; fewer fill only what they can', () => {
    const pics = Array.from({ length: 130 }, (_, i) => ({ name: `p${i}.png` }));
    const r = takePictures([], pics, 128);
    expect(r.list).toHaveLength(128);
    expect(r.refused).toBe(2);
    expect(r.note).toMatch(/2 pictures were left out: the cube holds 128 frames/);
    // Added to what is there: only the room left.
    const more = takePictures(r.list.slice(0, 120), pics.slice(0, 10), 128);
    expect(more.list).toHaveLength(128);
    expect(more.refused).toBe(2);
    // Lowering Frames later keeps the list but uses only the first ones.
    const node = timeCube({ source: 'pictures', frames: 16, pictures: r.list.map((p, i) => ({ id: `i${i}`, name: p.name, w: 4, h: 3, src: 'data:,x' })) });
    expect(usedPictures(node.params)).toHaveLength(16);
    expect(timeCubePlan(node)!.frames).toBe(16);
  });

  it('a single picture is stacked twice', () => {
    const node = timeCube({ source: 'pictures', pictures: [{ id: 'a', name: 'a.png', w: 10, h: 10, src: 'data:,a' }] });
    expect(timeCubePlan(node)!.frames).toBe(2);
    expect([0, 1].map(i => pictureForTile(i, 1))).toEqual([0, 0]);
  });

  it('no pictures yet: nothing to build', () => {
    const node = timeCube({ source: 'pictures' });
    expect(timeCubeSource(node)).toBeNull();
    expect(volumeKey(node)).toBeNull();
    expect(timeCubeSourceName(node)).toMatch(/none chosen/);
  });

  it('mixed sizes fit the first picture\'s frame: fill crops, fit letterboxes', () => {
    expect(fitRect(300, 600, 256, 144, 'cover')).toMatchObject({ dx: 0, dy: 0, dw: 256, dh: 144, sw: 300 });
    const fit = fitRect(300, 600, 256, 144, 'contain');
    expect(fit.dh).toBe(144); expect(fit.dw).toBeCloseTo(72); expect(fit.dx).toBeCloseTo(92);
    expect(fitRect(300, 600, 256, 144, 'stretch')).toMatchObject({ dw: 256, dh: 144, sw: 300, sh: 600 });
  });
});

describe('order', () => {
  const p = (name: string): TcPicture => ({ id: name, name, w: 1, h: 1, src: 'data:,' });
  it('sorts by name naturally, moves, reverses; the volume follows the order', () => {
    expect(sortByName([p('f10.png'), p('F2.png'), p('f1.png')]).map(x => x.name)).toEqual(['f1.png', 'F2.png', 'f10.png']);
    const list = [p('a'), p('b'), p('c'), p('d')];
    expect(movePicture(list, 3, 0).map(x => x.name)).toEqual(['d', 'a', 'b', 'c']);
    expect(movePicture(list, 0, 2).map(x => x.name)).toEqual(['b', 'c', 'a', 'd']);
    expect(reversePictures(list).map(x => x.name)).toEqual(['d', 'c', 'b', 'a']);
    const key = (l: TcPicture[]) => picturesKey({ pictures: l });
    expect(key(reversePictures(list))).not.toBe(key(list));
    expect(volumeKey(timeCube({ source: 'pictures', pictures: list }))).not.toBe(volumeKey(timeCube({ source: 'pictures', pictures: reversePictures(list) })));
  });
});

describe('where the pictures are kept', () => {
  it('a saved graph keeps them embedded and round-trips; nothing goes into the Library', async () => {
    const { pictures } = await picturesFromFiles([file('b.png'), file('a.png')], 2, io);
    const list = takePictures([], pictures, 128).list;
    expect(list.every(x => x.src?.startsWith('data:') && !x.path && !x.libraryId)).toBe(true);
    expect(list.reduce((a, x) => a + (x.src?.length ?? 0), 0)).toBeLessThanOrEqual(EMBED_TOTAL);

    useNodeGraphStore.setState({ nodes: [timeCube({ source: 'pictures', pictures: list, pictureFit: 'contain' })] });
    expect((await useNodeGraphStore.getState().saveGraph('Pictures cube')).ok).toBe(true);
    const saved = Object.keys(localStorage).map(k => localStorage.getItem(k)!).find(v => v.includes('"Pictures cube"') || v.includes(list[0].id));
    expect(saved).toBeTruthy();
    const stored = JSON.parse(Object.values(localStorage as unknown as Record<string, string>).find(v => v.includes(list[0].id) && v.includes('"nodes"'))!);

    useNodeGraphStore.setState({ nodes: [] });
    expect(useNodeGraphStore.getState().importGraph(JSON.stringify(stored)).ok).toBe(true);
    const back = useNodeGraphStore.getState().nodes.find(x => x.type === 'timeCube')!;
    expect(picturesOf(back.params)).toEqual(list);
    expect(back.params.pictureFit).toBe('contain');
    expect(timeCubePlan(back)!.frames).toBe(2);

    // After a reload (no session copies) the embedded copies are what the cube is built from.
    clearPictureSession();
    const { ctx, drawn } = recordingCtx();
    await drawPictures(usedPictures(back.params), timeCubePlan(back)!, ctx, 'contain', () => {}, new AbortController().signal, io);
    expect(drawn.map(d => d.what)).toEqual(['a.png', 'b.png']);

    expect(library.addImage).not.toHaveBeenCalled();
    expect(library.addVideoFile).not.toHaveBeenCalled();
    expect(library.importImageFile).not.toHaveBeenCalled();
  });

  it('desktop: keeps paths on disk, not bytes, and reads them from disk when building', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      const paths = await pickPicturePaths();
      expect(paths).toHaveLength(2);
      const ordered = sortByName(paths!.map(x => ({ name: x.split('/').pop()!, x }))).map(o => o.x);
      const { pictures } = await picturesFromPaths(ordered, {}, io);
      expect(pictures.map(x => x.path)).toEqual(['/Users/me/shots/frame 2.png', '/Users/me/shots/frame 10.png']);
      expect(pictures.every(x => !x.src && !x.libraryId)).toBe(true);
      expect(JSON.stringify(pictures)).not.toMatch(/data:/);

      fs.readFile.mockClear();
      const node = timeCube({ source: 'pictures', pictures });
      const { ctx, drawn } = recordingCtx();
      await drawPictures(usedPictures(node.params), timeCubePlan(node)!, ctx, 'cover', () => {}, new AbortController().signal, io);
      expect(fs.readFile.mock.calls.map(c => c[0])).toEqual(['/Users/me/shots/frame 2.png', '/Users/me/shots/frame 10.png']);
      expect(drawn.map(d => d.what)).toEqual(['disk:/Users/me/shots/frame 2.png', 'disk:/Users/me/shots/frame 10.png']);
      expect(library.addImage).not.toHaveBeenCalled();

      // Keep in graph instead: copies, no paths.
      const kept = await picturesFromPaths(ordered, { embed: true }, io);
      expect(kept.pictures.every(x => x.src && !x.path)).toBe(true);
    } finally { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; }
  });

  it('a picture that can\'t be read is counted, its frame left black', async () => {
    const node = timeCube({ source: 'pictures', pictures: [{ id: 'a', name: 'a.png', w: 4, h: 3, src: 'data:,a' }, { id: 'b', name: 'b.png', w: 4, h: 3, path: '/gone.png' }] });
    fs.readFile.mockRejectedValueOnce(new Error('gone'));
    const { ctx, drawn } = recordingCtx();
    const unread = await drawPictures(usedPictures(node.params), timeCubePlan(node)!, ctx, 'cover', () => {}, new AbortController().signal, io);
    expect(unread).toBe(1);
    expect(drawn).toHaveLength(1);
  });
});

describe('the Time Cube builder', () => {
  it('offers Pictures as a source, keeps them through a preset, and says so', () => {
    const pics = [{ id: 'a', name: 'a.png', w: 4, h: 3, src: 'data:,a' }, { id: 'b', name: 'b.png', w: 4, h: 3, src: 'data:,b' }];
    const spec = blankSpec('cube');
    spec.source = { ...spec.source, source: 'pictures', pictures: pics, pictureFit: 'contain' };
    expect(sourceName(spec.source)).toBe('2 pictures');
    expect(sectionSummary(spec, 'source')).toBe('2 pictures · fit');
    expect(groupsFor('source', 'cube').flatMap(g => g.keys)).toContain('pictureFit');
    const after = withPreset(spec, 'ring');
    expect(after.source.pictures).toEqual(pics);
    expect(after.source.source).toBe('pictures');
    // The Source section shows the Time Cube card itself: components/timeCube/__tests__/timeCubePicturesCard.test.tsx.
  });
});
