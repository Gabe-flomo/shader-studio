/**
 * ⌘V a picture into the graph (docs/texture-node.md, "Pasting a picture"): clipboard image data
 * goes straight onto the Texture node, a link goes through the URL fetch (the Rust fetch in the
 * desktop app), the link is kept through save → load, and copying nodes is unaffected.
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

// Decoding and uploading need a GPU canvas: record what the node was given instead.
const taken = vi.hoisted(() => [] as Array<{ nodeId: string; blob: Blob; o: { name: string; url?: string } }>);
vi.mock('../pictureHost', () => ({
  takePicture: vi.fn(async (nodeId: string, blob: Blob, o: { name: string; url?: string }) => {
    taken.push({ nodeId, blob, o });
    const { useNodeGraphStore: st } = await import('../../../store/useNodeGraphStore');
    st.getState().updateNodeParams(nodeId, { _imageName: o.name, _imageUrl: o.url || undefined, _imageSrc: 'data:image/jpeg;base64,EMBED' }, { immediate: true });
    return { libraryId: '', name: o.name };
  }),
}));
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { n } from '../../../store/graphBuilder';
import { imageSrcInHtml, isEditableTarget, nameFromUrl, onTexturePaste, pasteTarget, readClipboardPicture, type ClipboardLike } from '../texturePaste';
import { pasteIntoGraph, pasteOntoNode } from '../texturePasteHost';
import { fetchMedia, URL_MESSAGES } from '../pictures';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const pngFile = (name = 'image.png') => new File([PNG], name, { type: 'image/png' });

/** A clipboard as a paste event hands it over. */
function clip(data: Record<string, string>, files: File[] = []): ClipboardLike {
  return {
    items: files.map(f => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    files,
    getData: (t: string) => data[t] ?? '',
  };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('reading the clipboard', () => {
  it('image data (Copy Image) wins, and keeps the address from its HTML', () => {
    const got = readClipboardPicture(clip({ 'text/html': '<meta charset="utf-8"><img src="https://upload.wikimedia.org/a/Dusk%20sky.jpg?x=1&amp;y=2" alt="">' }, [pngFile()]));
    expect(got).toMatchObject({ kind: 'image', name: 'Dusk sky', url: 'https://upload.wikimedia.org/a/Dusk%20sky.jpg?x=1&y=2' });
    expect(got?.kind === 'image' && got.blob.size).toBe(PNG.length);
    // No HTML (a screenshot): a plain name, no source.
    expect(readClipboardPicture(clip({}, [pngFile()]))).toMatchObject({ kind: 'image', name: 'Pasted picture' });
    expect(readClipboardPicture(clip({}, [pngFile()]))).not.toHaveProperty('url');
  });

  it('a link as text is a link; other text is not ours', () => {
    expect(readClipboardPicture(clip({ 'text/plain': ' https://picsum.photos/id/1015/640/400 ' }))).toEqual({ kind: 'url', url: 'https://picsum.photos/id/1015/640/400' });
    expect(readClipboardPicture(clip({ 'text/uri-list': '# comment\r\nhttps://example.com/a.png' }))).toEqual({ kind: 'url', url: 'https://example.com/a.png' });
    expect(readClipboardPicture(clip({ 'text/plain': 'hello world' }))).toBeNull();
    expect(readClipboardPicture(clip({ 'text/plain': 'see https://example.com/a.png' }))).toBeNull();
    expect(readClipboardPicture(clip({ 'text/plain': 'ftp://x/y.png' }))).toBeNull();
    expect(readClipboardPicture(clip({}, [new File(['x'], 'a.txt', { type: 'text/plain' })]))).toBeNull();
    expect(readClipboardPicture(null)).toBeNull();
  });

  it('helpers', () => {
    expect(imageSrcInHtml("<img alt='' src='https://a.b/c.png'>")).toBe('https://a.b/c.png');
    expect(imageSrcInHtml('<img src="data:image/png;base64,AAA">')).toBeUndefined();
    expect(nameFromUrl('https://picsum.photos/id/1015/640/400')).toBe('picsum.photos');
    expect(nameFromUrl('https://x.org/p/Sunset.webp')).toBe('Sunset');
    expect(isEditableTarget({ tagName: 'INPUT' } as Element)).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as Element)).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', closest: () => null } as unknown as Element)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('the target: the card under the pointer, else the one selected Texture node, else a new node', () => {
    const nodes = [n('uv', 'u', 0, 0), n('textureInput', 't1', 0, 0), n('videoInput', 't2', 0, 0)];
    expect(pasteTarget(nodes, 't2', ['t1'], 't1')).toBe('t2');
    expect(pasteTarget(nodes, 'u', ['t1'], 't1')).toBe('t1');
    expect(pasteTarget(nodes, null, [], 't1')).toBe('t1');
    expect(pasteTarget(nodes, null, ['t1', 'u'], 't1')).toBeNull();
    expect(pasteTarget(nodes, null, ['u'], 'u')).toBeNull();
    expect(pasteTarget(nodes, null, [], null)).toBeNull();
  });
});

describe('pasting onto the graph', () => {
  beforeEach(() => {
    taken.length = 0;
    invoke.mockReset();
    vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
    localStorage.clear();
    useNodeGraphStore.setState({ currentGraph: null, graphDirty: false, activeGroupPath: [], selectedNodeIds: [], selectedNodeId: null,
      nodes: [n('uv', 'node_1', 0, 0), n('textureInput', 'node_2', 0, 0, {}, { uv: ['node_1', 'uv'] }), n('output', 'node_3', 0, 0, {}, { color: ['node_2', 'color'] })] });
  });

  it('clipboard image data → the Texture node, with no fetch at all', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const pic = readClipboardPicture(clip({ 'text/html': '<img src="https://site.example/cat.jpg">' }, [pngFile()]));
    expect(pasteIntoGraph(pic, 'node_2', () => ({ x: 0, y: 0 }))).toBe(true);
    await flush(); await flush();
    expect(f).not.toHaveBeenCalled();
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ nodeId: 'node_2', o: { name: 'cat', url: 'https://site.example/cat.jpg' } });
    expect(new Uint8Array(await taken[0].blob.arrayBuffer())).toEqual(PNG);
    expect(useNodeGraphStore.getState().nodes.find(x => x.id === 'node_2')!.params._imageUrl).toBe('https://site.example/cat.jpg');
  });

  it('clipboard link → the URL fetch (CORS on the web), onto the selected Texture node', async () => {
    const f = vi.fn(async () => new Response(PNG, { headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', f);
    useNodeGraphStore.setState({ selectedNodeId: 'node_2', selectedNodeIds: ['node_2'] });
    pasteIntoGraph(readClipboardPicture(clip({ 'text/plain': 'https://picsum.photos/id/1015/640/400' })), null, () => ({ x: 0, y: 0 }));
    await vi.waitFor(() => expect(taken).toHaveLength(1));
    expect(f).toHaveBeenCalledWith('https://picsum.photos/id/1015/640/400', { mode: 'cors', credentials: 'omit' });
    expect(taken[0]).toMatchObject({ nodeId: 'node_2', o: { name: 'picsum.photos', url: 'https://picsum.photos/id/1015/640/400' } });
  });

  it('a mounted card runs the paste itself, so a blocked site shows the Copy Image hint on it', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    let shown = '';
    const off = onTexturePaste('node_2', async (_label, job) => { try { await job(); } catch (e) { shown = (e as Error).message; } });
    await pasteOntoNode('node_2', { kind: 'url', url: 'https://blocked.example/p.jpg' });
    off();
    expect(shown).toBe(URL_MESSAGES.blocked);
    expect(URL_MESSAGES.blocked).toMatch(/Copy Image/);
    expect(taken).toHaveLength(0);
  });

  it('with no Texture node to take it, a new one is added in view with the picture', async () => {
    const before = useNodeGraphStore.getState().nodes.length;
    pasteIntoGraph(readClipboardPicture(clip({}, [pngFile('photo.png')])), null, () => ({ x: 120, y: 80 }));
    await vi.waitFor(() => expect(taken).toHaveLength(1));
    const st = useNodeGraphStore.getState();
    expect(st.nodes).toHaveLength(before + 1);
    const added = st.nodes.find(x => x.id === taken[0].nodeId)!;
    expect(added).toMatchObject({ type: 'textureInput', position: { x: 120, y: 80 } });
    expect(taken[0].o.name).toBe('photo');
    expect(st.selectedNodeId).toBe(added.id);
  });

  it('a link that can’t be read adds no node', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    const before = useNodeGraphStore.getState().nodes.length;
    pasteIntoGraph({ kind: 'url', url: 'https://example.com/gallery' }, null, () => ({ x: 0, y: 0 }));
    await flush(); await flush(); await flush();
    expect(useNodeGraphStore.getState().nodes).toHaveLength(before);
    expect(pasteIntoGraph(null, null, () => ({ x: 0, y: 0 }))).toBe(false);
  });
});

describe('the desktop app fetches any link', () => {
  it('goes through the Rust fetch_url, not the page’s fetch', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    invoke.mockResolvedValue({ status: 200, contentType: 'image/png', finalUrl: 'https://nocors.example/a.png', body: btoa(String.fromCharCode(...PNG)) });
    const got = await fetchMedia('https://nocors.example/a.png', 'image');
    expect(invoke).toHaveBeenCalledWith('fetch_url', { url: 'https://nocors.example/a.png', kaggle: false });
    expect(f).not.toHaveBeenCalled();
    expect(got.name).toBe('a');
    expect(new Uint8Array(await got.blob.arrayBuffer())).toEqual(PNG);
    // Its errors read as the card's.
    invoke.mockRejectedValue('No answer after 30 s.');
    await expect(fetchMedia('https://slow.example/a.png', 'image')).rejects.toMatchObject({ problem: 'blocked', message: /No answer/ });
    invoke.mockResolvedValue({ status: 404, contentType: 'text/html', finalUrl: 'x', body: '' });
    await expect(fetchMedia('https://gone.example/a.png', 'image')).rejects.toThrow(/answered 404/);
    vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
  });
});

describe('the link is kept', () => {
  beforeEach(() => { localStorage.clear(); useNodeGraphStore.setState({ currentGraph: null, graphDirty: false, nodes: [] }); });

  it('through save → load, beside the stored picture', async () => {
    const s = useNodeGraphStore.getState();
    useNodeGraphStore.setState({ nodes: [n('textureInput', 'node_2', 0, 0, { _imageSrc: 'data:image/jpeg;base64,EMBED', _imageUrl: 'https://picsum.photos/id/1015/640/400', _imageName: 'picsum.photos' })] });
    await s.saveGraph('Pasted');
    expect(localStorage.getItem('shader-studio:Pasted')).toContain('"_imageUrl":"https://picsum.photos/id/1015/640/400"');
    useNodeGraphStore.setState({ nodes: [n('output', 'node_9', 0, 0)] });
    expect(s.loadSavedGraph('Pasted').ok).toBe(true);
    expect(useNodeGraphStore.getState().nodes[0].params).toMatchObject({ _imageUrl: 'https://picsum.photos/id/1015/640/400', _imageSrc: 'data:image/jpeg;base64,EMBED' });
  });

  it('copying nodes is unaffected: a duplicate keeps the picture and its link', () => {
    useNodeGraphStore.setState({ nodes: [n('textureInput', 'node_2', 0, 0, { _imageSrc: 'data:x', _imageUrl: 'https://a.b/c.png' })] });
    useNodeGraphStore.getState().duplicateNodes(['node_2']);
    const nodes = useNodeGraphStore.getState().nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[1].id).not.toBe('node_2');
    expect(nodes[1].params).toMatchObject({ _imageSrc: 'data:x', _imageUrl: 'https://a.b/c.png' });
  });
});
