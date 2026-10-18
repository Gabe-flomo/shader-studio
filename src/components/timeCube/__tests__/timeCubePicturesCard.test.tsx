// @vitest-environment jsdom
/**
 * The Time Cube card (shown as is in the Time Cube builder's Source section) offers Pictures as a
 * source, and its pictures list reorders, reverses and removes (docs/time-cube.md, "From pictures").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../../nodes/definitions';
import type { GraphNode } from '../../../types/nodeGraph';
import { picturesOf } from '../../../lib/timeCube/pictures';
import { TimeCubeCardBody } from '../TimeCubeCardBody';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const node = () => useNodeGraphStore.getState().nodes.find(n => n.id === 'tc')!;
function Card() {
  const n = useNodeGraphStore(s => s.nodes.find(x => x.id === 'tc'));
  return n ? <TimeCubeCardBody node={n} /> : null;
}
const mount = (params: Record<string, unknown>) => {
  const def = getNodeDefinition('timeCube')!;
  const tc = { id: 'tc', type: 'timeCube', position: { x: 0, y: 0 }, inputs: {}, outputs: { volume: { type: 'volume', label: 'Volume' } }, params: { ...structuredClone(def.defaultParams), ...params } } as GraphNode;
  useNodeGraphStore.setState({ nodes: [tc] });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Card />));
};
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text) as HTMLButtonElement | undefined;
const click = (el: Element | null | undefined) => act(() => { (el as HTMLElement).click(); });

describe('Time Cube card: Pictures', () => {
  it('Choose video offers Pictures…, which switches the source (the video\'s clip and spacing reset)', () => {
    mount({ spacing: 'step' });
    click(button('Choose video'));
    const pick = document.querySelector('[data-tc-source-pictures]');
    expect(pick?.textContent).toBe('Pictures…');
    click(pick);
    expect(node().params.source).toBe('pictures');
    expect(node().params.spacing).toBe('count');
    // The pictures panel: a multi-file input that takes pictures (a phone's photo picker too).
    const input = document.querySelector('[data-tc-pictures-input]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('image/*');
    expect(button('Edit clip…')).toBeUndefined();
  });

  it('reorders, reverses, sorts by name and removes', () => {
    const pics = ['c 10.png', 'a 2.png', 'b 1.png'].map((name, i) => ({ id: `p${i}`, name, w: 4, h: 3, src: 'data:,x' }));
    mount({ source: 'pictures', pictures: pics });
    const text = host!.textContent ?? '';
    expect(text).toContain('3 of 128 frames · 3 kept in the graph');
    expect(button('Add pictures…')).toBeTruthy();
    expect(button('From the Library…')).toBeTruthy();
    const names = () => picturesOf(node().params).map(p => p.name);
    click(button('Sort by name'));
    expect(names()).toEqual(['a 2.png', 'b 1.png', 'c 10.png']);
    click(button('Reverse'));
    expect(names()).toEqual(['c 10.png', 'b 1.png', 'a 2.png']);
    click(document.querySelector('[aria-label="Move a 2.png earlier"]'));
    expect(names()).toEqual(['c 10.png', 'a 2.png', 'b 1.png']);
    click(document.querySelector('[aria-label="Remove c 10.png"]'));
    expect(names()).toEqual(['a 2.png', 'b 1.png']);
    // Choosing a video again takes the pictures off (they are not kept for nothing in the graph).
    click(button('Choose source'));
    click(button('Test clip: a red car crossing a street (built in)'));
    expect(node().params.source).toBe('demo');
    expect(picturesOf(node().params)).toEqual([]);
  });
});
