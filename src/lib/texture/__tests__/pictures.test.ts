/**
 * Saved graphs keep their pictures (docs/texture-node.md): a picture by URL (fetch mocked),
 * save → reload → the picture is back (from the library, or the copy embedded in the node on
 * another computer), a node with no picture drops one left by another graph, and a .playfile
 * carries the picture both ways.
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

import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { n } from '../../../store/graphBuilder';
import { createPictureRestorer, fetchMedia, pictureKey, pictureNodes, TextureUrlError, URL_MESSAGES, type PictureTexture } from '../pictures';
import { memoryKV } from '../../../files/mutate';
import { buildInventory } from '../../../files/inventory';
import { buildBundle } from '../../../playfile/bundle';
import { writePlayfile } from '../../../playfile/writer';
import { readPlayfile } from '../../../playfile/reader';

const SRC = 'data:image/jpeg;base64,/9j/EMBEDDEDCOPY';

function res(body: string, init: { status?: number; type?: string } = {}): Response {
  return new Response(body, { status: init.status ?? 200, headers: init.type ? { 'content-type': init.type } : {} });
}

describe('a picture by URL', () => {
  it('is fetched on the CPU and handed over as a blob, named from the link', async () => {
    const f = vi.fn(async () => res('PNGDATA', { type: 'image/png' }));
    const got = await fetchMedia('https://upload.wikimedia.org/a/b/Dusk%20sky.png', 'image', f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith('https://upload.wikimedia.org/a/b/Dusk%20sky.png', { mode: 'cors', credentials: 'omit' });
    expect(got.name).toBe('Dusk sky');
    expect(got.blob.type).toBe('image/png');
    expect(got.blob.size).toBe(7);
  });

  it('says clearly when the site blocks it (CORS), answers an error, or the link is a page', async () => {
    const blocked = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(fetchMedia('https://example.com/p.jpg', 'image', blocked)).rejects.toMatchObject({ problem: 'blocked', message: URL_MESSAGES.blocked });
    await expect(fetchMedia('https://example.com/p.jpg', 'image', (async () => res('', { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/answered 404/);
    await expect(fetchMedia('https://example.com/photo', 'image', (async () => res('<html>', { type: 'text/html' })) as unknown as typeof fetch)).rejects.toMatchObject({ problem: 'notPicture' });
    await expect(fetchMedia('not a link', 'image')).rejects.toBeInstanceOf(TextureUrlError);
    await expect(fetchMedia('ftp://x/y.png', 'image')).rejects.toMatchObject({ problem: 'invalid' });
  });

  it('a video by URL works when the site allows it, and refuses a video page', async () => {
    const ok = await fetchMedia('https://cdn.example.com/clip.mp4', 'video', (async () => res('MP4', { type: 'video/mp4' })) as unknown as typeof fetch);
    expect(ok).toMatchObject({ name: 'clip' });
    await expect(fetchMedia('https://www.youtube.com/watch?v=x', 'video', (async () => res('<html>', { type: 'text/html' })) as unknown as typeof fetch)).rejects.toMatchObject({ problem: 'notVideo' });
  });
});

/** A texture stand-in: what it was made from. */
class FakeTex implements PictureTexture {
  magFilter = 1006; minFilter = 1008; needsUpdate = false; disposed = false;
  from: string;
  constructor(from: string) { this.from = from; }
  dispose() { this.disposed = true; }
}

function host(library: Record<string, string>) {
  const textures: Record<string, FakeTex | null> = {};
  const h = {
    textures,
    getTexture: (id: string) => textures[id] ?? null,
    setTexture: (id: string, t: FakeTex | null) => { textures[id] = t; },
    libraryBlob: async (id: string) => (library[id] ? new Blob([library[id]]) : null),
    toTexture: async (src: Blob | string) => new FakeTex(typeof src === 'string' ? src : `library:${await src.text()}`),
    filters: { nearest: 1003, linear: 1006, linearMipmap: 1008 },
  };
  return h;
}

/** A picture as the card leaves it (lib/texture/pictureHost.ts takePicture). */
const withPicture = (libraryId?: string) => [
  n('uv', 'node_1', 0, 0),
  n('textureInput', 'node_2', 0, 0, { _imageSrc: SRC, _imageName: 'dusk', _imageAspect: 1.5, _thumbnailUrl: 'data:image/jpeg;base64,thumb', ...(libraryId ? { libraryId } : {}) }, { uv: ['node_1', 'uv'] }),
  n('output', 'node_3', 0, 0, {}, { color: ['node_2', 'color'] }),
];

describe('save → reload keeps the picture', () => {
  beforeEach(() => { localStorage.clear(); useNodeGraphStore.setState({ currentGraph: null, graphDirty: false, nodes: [] }); });

  it('the saved graph holds the picture, and opening it brings it back', async () => {
    const s = useNodeGraphStore.getState();
    useNodeGraphStore.setState({ nodes: withPicture('img_1') });
    await s.saveGraph('Dusk');
    const stored = localStorage.getItem('shader-studio:Dusk')!;
    expect(stored).toContain('"libraryId":"img_1"');
    expect(stored).toContain(SRC);

    // A reload: another graph was open, then this one opens again.
    useNodeGraphStore.setState({ nodes: [n('output', 'node_9', 0, 0)] });
    expect(s.loadSavedGraph('Dusk').ok).toBe(true);
    const nodes = useNodeGraphStore.getState().nodes;
    expect(pictureNodes(nodes).map(x => x.params._imageSrc)).toEqual([SRC]);

    // This browser has the library copy: the full-size picture.
    const here = host({ img_1: 'FULL' });
    await createPictureRestorer(here).sync(nodes, true);
    expect(here.textures.node_2!.from).toBe('library:FULL');

    // Another computer (no library copy): the copy kept in the graph.
    const there = host({});
    await createPictureRestorer(there).sync(nodes, true);
    expect(there.textures.node_2!.from).toBe(SRC);
  });

  it('a saved version keeps it too', async () => {
    const s = useNodeGraphStore.getState();
    useNodeGraphStore.setState({ nodes: withPicture('img_1') });
    await s.saveGraph('Dusk');
    useNodeGraphStore.setState({ nodes: [n('output', 'node_9', 0, 0)] });
    await s.saveGraph('Dusk', 'no picture');
    expect(s.loadGraphVersion('Dusk', 1).ok).toBe(true);
    expect(pictureNodes(useNodeGraphStore.getState().nodes)[0].params._imageSrc).toBe(SRC);
  });

  it('a node with no picture of its own drops one left from another graph; the card\'s own load is not repeated', async () => {
    const h = host({});
    const r = createPictureRestorer(h);
    h.textures.node_2 = new FakeTex('another graph');
    await r.sync([n('textureInput', 'node_2', 0, 0)], true);
    expect(h.textures.node_2).toBeNull();
    // The card loaded it itself: no second load.
    const nodes = withPicture('img_9');
    h.textures.node_2 = new FakeTex('card');
    r.markLoaded('node_2', nodes[1].params);
    await r.sync(nodes, false);
    expect(h.textures.node_2!.from).toBe('card');
    // Filter: Pixels.
    await r.sync(nodes.map(x => (x.id === 'node_2' ? { ...x, params: { ...x.params, filter: 'nearest' } } : x)), false);
    expect(h.textures.node_2!.magFilter).toBe(1003);
    expect(pictureKey({})).toBe('');
  });

  it('pictures inside groups come back too', () => {
    const inner = withPicture()[1];
    const g = { ...n('output', 'g', 0, 0), type: 'group', params: { subgraph: { nodes: [inner], edges: [] } } };
    expect(pictureNodes([g]).map(x => x.id)).toEqual(['node_2']);
  });
});

describe('.playfile round trip', () => {
  it('the graph carries its embedded picture, and the library picture comes along', async () => {
    const graph = JSON.stringify({ nodes: withPicture('img_1'), version: 2, savedAt: 1 });
    const kv = memoryKV({ 'shader-studio:Dusk': graph });
    const inv = await buildInventory(kv, { external: [{ source: 'backgrounds', section: 'backgrounds', group: 'Images', refField: 'libraryId', items: [{ id: 'img_1', label: 'dusk', size: 5 }] }] });
    const b = await buildBundle(kv, inv, ['graph:Dusk'], {}, { backgroundFile: async () => ({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), type: 'image/png', name: 'dusk' }) });
    expect(b.items.map(i => i.kind).sort()).toEqual(['background', 'graph']);
    const w = await writePlayfile(b.items);
    const back = await readPlayfile(w.bytes);
    const g = back.items.find(i => i.kind === 'graph')!;
    const text = typeof g.data === 'string' ? g.data : new TextDecoder().decode(g.data as Uint8Array);
    const parsed = JSON.parse(text) as { nodes: Array<{ id: string; params: Record<string, unknown> }> };
    expect(parsed.nodes.find(x => x.id === 'node_2')!.params).toMatchObject({ _imageSrc: SRC, libraryId: 'img_1', _imageName: 'dusk' });
    expect(back.items.find(i => i.kind === 'background')).toBeTruthy();
  });
});
