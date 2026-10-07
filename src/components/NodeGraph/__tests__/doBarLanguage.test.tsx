// @vitest-environment jsdom
/**
 * The Do… bar and the shared language, drawn (docs/playfield-language-plan.md §10.1): plain English
 * shows its canonical line (click to edit it), a canonical line shows ✓ and runs, random values show
 * what they drew, a line mixing 3D and 2D is refused, "surprise me" offers a line, history keeps what
 * was typed, and a grid line adds Grid Rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { DoBar } from '../DoBar';
import { openDoBar, closeDoBar } from '../../../suggestions/doBarStore';
import { pushHistory } from '../../../suggestions/doBarHistory';
import { n } from '../../../store/graphBuilder';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let root: Root | null = null;
let host: HTMLElement | null = null;
function open(text: string) {
  act(() => { closeDoBar(); });
  act(() => { openDoBar({ text }); });
  if (!root) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<DoBar />));
  }
}
afterEach(() => { act(() => { closeDoBar(); root?.unmount(); }); root = null; host?.remove(); host = null; });
beforeEach(() => {
  localStorage.clear();
  useNodeGraphStore.setState({ nodes: [n('output', 'o', 900, 0)], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
});
const $ = (sel: string) => document.body.querySelector(sel);
const input = () => $('[data-do-input]') as HTMLInputElement;

describe('the Do… bar speaks the language', () => {
  it('plain English shows its canonical line; clicking it puts it in the bar', () => {
    open('circle with a glow, falloff 8');
    const line = $('[data-do-canonical]');
    expect(line?.textContent).toContain('circle · glow falloff=8');
    act(() => { (line as HTMLElement).click(); });
    expect(input().value).toBe('circle · glow falloff=8');
    expect($('[data-do-canonical]')?.textContent).toMatch(/^✓/);
  });
  it('a canonical line runs as one undo step', () => {
    open('circle · glow · colour by length');
    expect($('[data-do-plan]')?.textContent).toMatch(/Glow/);
    act(() => { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    const types = useNodeGraphStore.getState().nodes.map(x => x.type);
    expect(types).toEqual(expect.arrayContaining(['circleSDF', 'light', 'palette', 'multiply']));
  });
  it('random values show what they drew, with Roll again', () => {
    open('circle · glow falloff=random');
    expect($('[data-do-random]')?.textContent).toMatch(/glow\.falloff=random → \d/);
    expect($('[data-do-reroll]')).toBeTruthy();
  });
  it('refuses a line that mixes a 3D scene and a 2D picture', () => {
    open('cone · heart');
    expect($('[data-do-lang-errors]')?.textContent).toMatch(/mixes a 3D scene/);
  });
  it('"surprise me" offers a line, and Enter puts it in the bar', () => {
    open('surprise me small');
    const shown = $('[data-do-surprise-line] code')?.textContent ?? '';
    expect(shown).toMatch(/·/);
    act(() => { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(input().value).toBe(shown);
  });
  it('↑ brings back what was typed (not its canonical line)', () => {
    pushHistory('circle with a glow, falloff 8');
    open('');
    act(() => { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
    expect(input().value).toBe('circle with a glow, falloff 8');
  });
  it('a grid line adds Grid Rules', () => {
    open('grid life walls board=480');
    expect($('[data-do-dialect="grid"]')).toBeTruthy();
    act(() => { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    const g = useNodeGraphStore.getState().nodes.find(x => x.type === 'gridRules');
    expect(g?.params).toMatchObject({ edges: 'walls', board: '0.25' });
  });
});
