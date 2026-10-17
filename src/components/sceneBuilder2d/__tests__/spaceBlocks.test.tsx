// @vitest-environment jsdom
/**
 * The Space tab's blocks as drawn: the library picks a block, Random offers three to choose from,
 * a line that doesn't check shows why, and a number becomes a slider.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BlockEditor, BlockLibrary, SpaceView } from '../SpaceBlocks';
import { PhoneStudioContext } from '../../builders/studio/PhoneStudio';
import { BLOCK_LIBRARY } from '../../../sceneBuilder2d/blockLibrary';
import type { SpaceBlock } from '../../../sceneBuilder2d/blocks';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return host;
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });

const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
  act(() => { set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('the block library', () => {
  it('shows every entry and picks one', () => {
    const onPick = vi.fn();
    const host = mount(<BlockLibrary onPick={onPick} />);
    expect(host.querySelectorAll('[data-block-entry]').length).toBe(BLOCK_LIBRARY.length);
    click(host.querySelector('[data-block-entry="twirl"]'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect((onPick.mock.calls[0][0] as SpaceBlock).lib).toBe('twirl');
  });

  it('filters by category', () => {
    const host = mount(<BlockLibrary onPick={() => {}} />);
    const tab = [...host.querySelectorAll('[role="tab"]')].find(b => b.textContent === 'Noise warps');
    click(tab ?? null);
    const ids = [...host.querySelectorAll('[data-block-entry]')].map(e => e.getAttribute('data-block-entry'));
    expect(ids.length).toBe(BLOCK_LIBRARY.filter(e => e.category === 'noise').length);
  });

  it('Random offers three choices, and picking one adds it', () => {
    const onPick = vi.fn();
    const host = mount(<BlockLibrary onPick={onPick} />);
    click(host.querySelector('[data-block-random]'));
    const choices = host.querySelectorAll('[data-random-choice]');
    expect(choices.length).toBe(3);
    expect(new Set([...choices].map(c => c.getAttribute('data-random-choice'))).size).toBe(3);
    click(choices[1]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('[data-random-choice]').length).toBe(0);
  });
});

describe('the block editor', () => {
  function Harness({ start }: { start: SpaceBlock }) {
    const [b, setB] = useState(start);
    return <><BlockEditor block={b} idBase="t" update={fn => setB(old => { const n = structuredClone(old); fn(n); return n; })} /><pre data-state>{JSON.stringify(b)}</pre></>;
  }
  const start: SpaceBlock = { name: 'Mine', lines: [{ target: 'uv.x', op: '+=', rhs: '' }], params: [], times: 1 };

  it('says why a line does not check, as you type', () => {
    const host = mount(<Harness start={start} />);
    const input = host.querySelector('[data-block-rhs="0"]') as HTMLInputElement;
    type(input, 'sin(y + t) * ampp');
    expect(host.querySelector('[data-block-error="0"]')?.textContent).toMatch(/“ampp” isn't known/);
    // The line is the Expression Block's own editor: highlighted, its edge in the error colour.
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    type(input, 'sin(y + t) * 0.2');
    expect(host.querySelector('[data-block-error="0"]')).toBeNull();
  });

  it('turns a number into a slider', () => {
    const host = mount(<Harness start={{ ...start, lines: [{ target: 'uv.x', op: '+=', rhs: 'sin(y * 6.0)' }] }} />);
    const input = host.querySelector('[data-block-rhs="0"]') as HTMLInputElement;
    act(() => { input.focus(); input.setSelectionRange(9, 9); input.click(); });
    click(host.querySelector('[data-make-slider]'));
    const state = JSON.parse(host.querySelector('[data-state]')!.textContent!) as SpaceBlock;
    expect(state.params).toHaveLength(1);
    expect(state.params[0].value).toBe(6);
    expect(state.lines[0].rhs).toBe(`sin(y * ${state.params[0].name})`);
  });

  it('adds a line (at most three)', () => {
    const host = mount(<Harness start={start} />);
    const addLine = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Line') ?? null;
    click(addLine());
    click(addLine());
    expect(host.querySelectorAll('[data-block-line]').length).toBe(3);
    expect(addLine()).toBeNull();
  });
});

describe('saving a block (My blocks)', () => {
  function Harness({ start }: { start: SpaceBlock }) {
    const [b, setB] = useState(start);
    return <><BlockEditor block={b} idBase="t" update={fn => setB(old => { const n = structuredClone(old); fn(n); return n; })} /><pre data-state>{JSON.stringify(b)}</pre></>;
  }
  const typeInput = (el: HTMLInputElement, value: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
  };
  const mine: SpaceBlock = { name: 'My block', lines: [{ target: 'uv.x', op: '+=', rhs: 'amp * sin(y * 7 + t)' }], params: [{ name: 'amp', value: 0.2, min: 0, max: 1 }], times: 1 };

  it('saves a hand-written block; it shows in the library under My blocks, with its picture, and picks', () => {
    localStorage.removeItem('shader-studio:space-blocks');
    const host = mount(<Harness start={mine} />);
    click(host.querySelector('[data-save-block="t"]'));
    typeInput(host.querySelector('[aria-label="Block name"]') as HTMLInputElement, 'Wobble rows');
    typeInput(host.querySelector('[aria-label="What it does"]') as HTMLInputElement, 'Rows slide on a sine.');
    click(host.querySelector('[data-save-block-confirm]'));
    const state = JSON.parse(host.querySelector('[data-state]')!.textContent!) as SpaceBlock;
    expect(state.my).toBe('Wobble rows');
    expect(host.querySelector('[data-save-block="t"]')?.textContent).toMatch(/Save changes/);

    const onPick = vi.fn();
    const lib = mount(<BlockLibrary onPick={onPick} />);
    const tile = lib.querySelector('[data-saved-block="Wobble rows"]');
    expect(tile).toBeTruthy();
    expect(tile!.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(tile!.textContent).toMatch(/Rows slide on a sine/);
    // My blocks first, then the library.
    expect(lib.querySelector('[data-my-blocks]')!.compareDocumentPosition(lib.querySelector('[data-block-entry]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Searchable.
    const search = lib.querySelector('[aria-label="Search blocks"]') as HTMLInputElement;
    typeInput(search, 'slide on');
    expect(lib.querySelector('[data-saved-block="Wobble rows"]')).toBeTruthy();
    typeInput(search, 'zzzz');
    expect(lib.querySelector('[data-saved-block="Wobble rows"]')).toBeNull();
    typeInput(search, '');
    // The My blocks tab shows only yours.
    click(lib.querySelector('[data-cat-mine]'));
    expect(lib.querySelectorAll('[data-block-entry]').length).toBe(0);
    click(lib.querySelector('[data-saved-block="Wobble rows"]'));
    expect(onPick).toHaveBeenCalledTimes(1);
    const picked = onPick.mock.calls[0][0] as SpaceBlock;
    expect(picked.my).toBe('Wobble rows');
    expect(picked.lines).toEqual(mine.lines);
    expect(picked.params).toEqual(mine.params);
  });
});

describe('the Space picture', () => {
  it('on the desktop it stays in view (sticky) while the blocks scroll', () => {
    const host = mount(<SpaceView ops={[]} upTo={null} />);
    const view = host.querySelector('[data-space-view]') as HTMLElement;
    expect(view.style.position).toBe('sticky');
    expect(host.querySelector('[data-space-view-toggle]')).toBeNull();
  });

  it('on a phone it scrolls with the blocks and folds to one line (it used to fill the sheet)', () => {
    const host = mount(<PhoneStudioContext.Provider value={true}><SpaceView ops={[]} upTo={null} /></PhoneStudioContext.Provider>);
    const view = () => host.querySelector('[data-space-view]') as HTMLElement;
    expect(view().style.position).not.toBe('sticky');
    expect(host.querySelector('canvas')).toBeTruthy();
    click(host.querySelector('[data-space-view-toggle]'));
    expect(view().hasAttribute('data-space-view-folded')).toBe(true);
    expect(host.querySelector('canvas')).toBeNull();
    click(host.querySelector('[data-space-view-toggle]'));
    expect(host.querySelector('canvas')).toBeTruthy();
  });
});
