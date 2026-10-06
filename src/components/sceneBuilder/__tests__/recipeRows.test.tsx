// @vitest-environment jsdom
/**
 * The Recipe tab's rows (RecipeRows): one numbered row per clause, a combine's items on their own
 * lines; a row edited, deleted or moved hands back a recipe that reads as meant.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { formatRecipe, parseRecipe, type RecipeError } from '../../../sceneBuilder/recipe';
import { SCENE_TEMPLATES } from '../../../sceneBuilder/templates';
import { RecipeRows } from '../RecipeRows';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const BLOBS = formatRecipe(SCENE_TEMPLATES.find(t => t.key === 'blobs')!.recipe);

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });
function mount(onChange: (t: string) => RecipeError[]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<RecipeRows text={BLOBS} onChange={onChange} />));
  mounted.push({ root, host });
  return host;
}
const setValue = (el: HTMLTextAreaElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('RecipeRows', () => {
  it('draws a row per clause, the combine as lines, coloured', () => {
    const host = mount(() => []);
    expect(host.querySelectorAll('[data-recipe-row]')).toHaveLength(7);
    const combine = host.querySelector('[data-recipe-row="1"]')!;
    expect(combine.querySelectorAll('[data-recipe-line]')).toHaveLength(6);
    expect(combine.querySelector('[data-recipe-token="op"]')?.textContent).toBe('smooth-union');
    expect(combine.querySelectorAll('[data-recipe-swatch]').length).toBeGreaterThanOrEqual(4);
    expect([...combine.querySelectorAll('[data-recipe-line]')].pop()!.textContent).toBe(') k=0.35 name=Sculpture');
  });
  it('a row edited hands back a recipe that reads, with the new clause', () => {
    const seen: string[] = [];
    const host = mount(t => { seen.push(t); return parseRecipe(t).errors; });
    act(() => { (host.querySelector('[data-recipe-row="4"] [data-recipe-row-text]') as HTMLElement).click(); });
    const ed = host.querySelector('[data-recipe-row-editor]') as HTMLTextAreaElement;
    expect(ed.value).toBe('shadows 12');
    act(() => setValue(ed, 'shadows off'));
    act(() => { ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(seen).toHaveLength(1);
    const r = parseRecipe(seen[0]);
    expect(r.errors).toEqual([]);
    expect(r.spec.look.shadows).toBe(0);
    expect(host.querySelector('[data-recipe-row-editor]')).toBeNull();
  });
  it('keeps the row open with the mistake when it doesn\'t read', () => {
    const host = mount(t => parseRecipe(t).errors);
    act(() => { (host.querySelector('[data-recipe-row="2"] [data-recipe-row-text]') as HTMLElement).click(); });
    const ed = host.querySelector('[data-recipe-row-editor]') as HTMLTextAreaElement;
    act(() => setValue(ed, 'plnae y=-1'));
    act(() => { ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(host.querySelector('[data-recipe-row-editor]')).toBeTruthy();
    expect(host.querySelector('[data-recipe-row-error]')?.textContent).toMatch(/plane/);
  });
  it('deletes a row', () => {
    const seen: string[] = [];
    const host = mount(t => { seen.push(t); return []; });
    act(() => { (host.querySelector('[data-recipe-row="3"] [aria-label="Delete this clause"]') as HTMLElement).click(); });
    expect(seen[0]).not.toContain('sun dir');
    expect(parseRecipe(seen[0]).errors).toEqual([]);
  });
});
