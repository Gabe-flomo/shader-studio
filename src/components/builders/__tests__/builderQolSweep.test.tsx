// @vitest-environment jsdom
/**
 * The QoL sweep in the builders:
 * - builder sliders carry their Play menu (lazyParam) and the builders' switches are Toggles / mute switches.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {};

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
const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => Array.from(document.body.querySelectorAll<HTMLElement>(sel));

describe('builders: Play menus and switches', () => {
  it('the Grid builder: repeat sliders carry the Play menu; rules and the glow use the mute switch', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    const { openNewGridScene } = await import('../../../gridScene/actions');
    const { useGridBuilder } = await import('../../../gridScene/store');
    const { newRule } = await import('../../../gridScene/spec');
    act(() => openNewGridScene());
    act(() => useGridBuilder.getState().edit(d => { d.draw = { ...(d.draw ?? {}), mode: 'repeat', period: [2, 2], offset: [0, 0], shift: 0 } as NonNullable<typeof d.draw>; d.rules.push(newRule(d)); }));
    const { GridSceneBuilder } = await import('../../gridScene/GridSceneBuilder');
    mount(<GridSceneBuilder />);
    const lazy = $$('[data-builder-lazy-param] [role="slider"]').map(s => s.getAttribute('aria-label'));
    expect(lazy).toEqual(expect.arrayContaining(['Repeat period X', 'Repeat period Y', 'Repeat offset X', 'Repeat row shift']));
    act(() => useGridBuilder.getState().setSection('rules'));
    const rule = $('[data-sb-card^="gs-rule-"]')!;
    expect(rule.querySelector('[data-mute-toggle]')).toBeTruthy();
    // The header's own switch is the mute; no bare Toggle beside it.
    expect(rule.firstElementChild?.querySelector('[role="switch"]')).toBeNull();
    act(() => useGridBuilder.getState().setSection('look'));
    expect($('[data-sb-card="gs-glow"] [data-mute-toggle]')).toBeTruthy();
    expect($('[data-group-head="Grid lines"] [data-mute-toggle]')).toBeTruthy();
    act(() => useGridBuilder.getState().close());
  });

  it('Save this block: "Random may offer it" is a Toggle', async () => {
    const { SaveBlockForm } = await import('../../sceneBuilder2d/MyBlocks');
    mount(<SaveBlockForm src={{}} onSaved={() => {}} onCancel={() => {}} />);
    const sw = $$('[role="switch"]').find(s => s.textContent?.includes('Random may offer it'));
    expect(sw).toBeTruthy();
    expect($('input[type="checkbox"]')).toBeNull();
  });
});
