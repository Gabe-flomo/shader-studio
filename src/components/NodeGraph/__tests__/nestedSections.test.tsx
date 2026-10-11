// @vitest-environment jsdom
/**
 * Folding sub-sections inside a card section are stepped in (components/ui/nesting.ts): Splat Scene's Place › Position
 * and Rotation sit under Place's header with a guide line, and their sliders read X / Y / Z. A section that can't act
 * as the node is wired (Compositing with no Scene) is dimmed and says why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { NodeComponent } from '../NodeComponent';
import { NEST_INDENT, nestedSectionStyle } from '../../ui/nesting';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (function (this: HTMLCanvasElement, kind: string) {
  return kind === '2d' ? { font: '', measureText: (t: string) => ({ width: t.length * 6 }) } : null;
}) as unknown as HTMLCanvasElement['getContext'];
if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

let root: Root | null = null;
let host: HTMLElement | null = null;
const st = () => useNodeGraphStore.getState();
const noop = () => {};

function show(id: string) {
  const node = st().nodes.find(n => n.id === id)!;
  act(() => { root!.render(<NodeComponent node={node} onStartConnection={noop} onEndConnection={noop} />); });
}
const openSection = (name: string) => {
  const b = [...host!.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(x => x.textContent?.startsWith(name))!;
  expect(b).toBeTruthy();
  if (b.getAttribute('aria-expanded') === 'false') act(() => { b.click(); });
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
  st().replaceGraph([]);
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

describe('nested sub-sections', () => {
  it('the shared style steps in past the section and draws a guide line', () => {
    const s = nestedSectionStyle('#123', 6);
    expect(s.marginLeft).toBe(6 + NEST_INDENT);
    expect(s.borderLeft).toBe('1px solid #123');
    expect(Number(s.paddingLeft)).toBeGreaterThan(0);
  });

  it("Splat Scene's Position and Rotation sit inside Place, stepped in, with X / Y / Z sliders", () => {
    const id = st().addNode('splatScene', { x: 0, y: 0 })!;
    show(id);
    for (const key of ['position', 'rotation']) {
      const el = host!.querySelector<HTMLElement>(`[data-param-key="${key}"]`)!;
      expect(el.getAttribute('data-nested-section')).toBe('true');
      expect(el.style.marginLeft).toBe(`${6 + NEST_INDENT}px`);
      expect(el.style.borderLeft).toContain('1px solid');
    }
    const axes = [...host!.querySelectorAll('[data-param-key="rotation"] [data-axis-label]')].map(e => e.textContent);
    expect(axes).toEqual(['X', 'Y', 'Z']);
  });

  it('a vec3 outside any section is not nested and keeps r / g / b (Palette)', () => {
    const id = st().addNode('palette', { x: 0, y: 0 })!;
    show(id);
    const vec = [...host!.querySelectorAll<HTMLElement>('[data-param-key]')].find(e => e.querySelector('[data-axis-label]'));
    expect(vec).toBeTruthy();
    expect(vec!.getAttribute('data-nested-section')).toBeNull();
    expect([...vec!.querySelectorAll('[data-axis-label]')].map(e => e.textContent)).toEqual(['r', 'g', 'b']);
  });
});

describe('a section that needs a wire', () => {
  it('Compositing is dimmed with a line saying why while nothing is wired into Scene', () => {
    const id = st().addNode('splatScene', { x: 0, y: 0 })!;
    show(id);
    openSection('Compositing');
    const note = host!.querySelector('[data-section-needs="Compositing"]');
    expect(note?.textContent).toBe('Add a world to blend the scan with it.');
    const dimmed = [...host!.querySelectorAll<HTMLElement>('[data-section-disabled]')];
    expect(dimmed.length).toBe(2);
    expect(dimmed.every(d => d.style.pointerEvents === 'none' && d.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(dimmed.map(d => d.querySelector('[data-param-key]')?.getAttribute('data-param-key')).sort()).toEqual(['hitAt', 'softness']);
  });

  it('with a scene wired, Compositing works as usual', () => {
    const id = st().addNode('splatScene', { x: 0, y: 0 })!;
    const col = st().addNode('palette', { x: -300, y: 0 })!;
    const out = Object.keys(st().nodes.find(n => n.id === col)!.outputs)[0];
    act(() => { st().connectNodes(col, out, id, 'scene'); });
    expect(st().nodes.find(n => n.id === id)!.inputs.scene.connection).toBeTruthy();
    show(id);
    openSection('Compositing');
    expect(host!.querySelector('[data-section-needs]')).toBeNull();
    expect(host!.querySelectorAll('[data-section-disabled]').length).toBe(0);
  });
});
