// @vitest-environment jsdom
/**
 * The Texture card (docs/texture-node.md): the Source switch turns the same node into a video
 * or the webcam (the webcam adds Play's Camera layer and shows its controls), a blocked image
 * URL says why, a kept video this browser lacks shows Missing with Re-link, and Generate depth
 * adds a Depth node wired to the texture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
vi.mock('../../../lib/backgroundLibrary', async importOriginal => {
  const real = await importOriginal<typeof import('../../../lib/backgroundLibrary')>();
  return { ...real, getVideo: async () => null, listImages: async () => [], listVideos: async () => [] };
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { n } from '../../../store/graphBuilder';
import { emptyPlayRecord } from '../../../types/play';
import { TextureCardBody } from '../TextureCardBody';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let root: Root | null = null;
let host: HTMLElement | null = null;

function render() {
  const node = useNodeGraphStore.getState().nodes.find(x => x.id === 'tex')!;
  act(() => { root!.render(<TextureCardBody node={node} onEditClip={() => {}} />); });
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const button = (text: string) => [...host!.querySelectorAll('button')].find(b => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useNodeGraphStore.setState({
    nodes: [n('uv', 'uv', 0, 0), n('textureInput', 'tex', 100, 100, {}, { uv: ['uv', 'uv'] }), n('output', 'out', 600, 100, {}, { color: ['tex', 'color'] })],
    play: emptyPlayRecord(), nodeTextures: {}, videoTextures: {},
  });
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; vi.unstubAllGlobals(); });

describe('Texture card', () => {
  it('shows the picture controls, and Webcam turns the same node into the camera with Play\'s controls', () => {
    render();
    expect(host!.querySelector('[data-texture-card="image"]')).toBeTruthy();
    expect(host!.querySelector('input[aria-label="Image URL"]')).toBeTruthy();
    expect(button('Library')).toBeTruthy();
    expect(button('Generate depth')!.disabled).toBe(true);
    act(() => { button('Webcam')!.click(); });
    const st = useNodeGraphStore.getState();
    const tex = st.nodes.find(x => x.id === 'tex')!;
    expect(tex.type).toBe('videoInput');
    expect(tex.params.source).toBe('webcam');
    expect(st.nodes.find(x => x.id === 'out')!.inputs.color.connection).toEqual({ nodeId: 'tex', outputKey: 'color' });
    expect(st.play.layers.filter(l => l.kind === 'camera')).toHaveLength(1);
    render();
    expect(host!.querySelector('[data-texture-webcam]')).toBeTruthy();
    expect(host!.textContent).toMatch(/Turn on camera|Not available here/);
    expect(host!.textContent).toContain('Mirror');
    expect(host!.querySelector('[aria-label="Map a hand to"]')).toBeTruthy();
  });

  it('a blocked image URL says why', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    render();
    const input = host!.querySelector('input[aria-label="Image URL"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setValue.call(input, 'https://example.com/a.jpg'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { button('Load')!.click(); });
    await flush();
    expect(host!.querySelector('[data-texture-error]')!.textContent).toMatch(/CORS/);
  });

  it('a kept video this browser doesn\'t have shows Missing and Re-link', async () => {
    useNodeGraphStore.setState(s => ({ nodes: s.nodes.map(x => (x.id === 'tex' ? { ...n('videoInput', 'tex', 100, 100, { videoId: 'vid_gone', _fileName: 'surf.mp4', _hasFile: true }), inputs: x.inputs } : x)) }));
    render();
    await flush();
    expect(host!.querySelector('[data-texture-missing]')!.textContent).toContain('surf.mp4');
    expect(button('Re-link…')).toBeTruthy();
  });

  it('Generate depth adds a Depth node wired to the texture', () => {
    useNodeGraphStore.setState({ nodeTextures: { tex: {} as never } });
    render();
    act(() => { button('Generate depth')!.click(); });
    const depth = useNodeGraphStore.getState().nodes.find(x => x.type === 'depth')!;
    expect(depth.inputs.texture.connection).toEqual({ nodeId: 'tex', outputKey: 'texture' });
  });
});
