// @vitest-environment jsdom
/**
 * The slider's two rules that the whole app relies on:
 * - typing a value sets the range (rangeAfterTyping): a number past the end widens the range and
 *   the slider keeps that range, `onRange` tells the owner; a hard limit clamps instead;
 * - the slider has no right-click of its own: a right-click reaches the row's menu (a node card's
 *   Add to Play, a Play control's Pair with…), which #306's "Set range" had swallowed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RulerSlider } from '../RulerSlider';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return { host, rerender: (next: React.ReactElement) => act(() => root.render(next)) };
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });

/** Types into the value chip the way a person does: React sees an input event with the new text. */
function type(host: HTMLElement, text: string) {
  const chip = host.querySelector<HTMLInputElement>('input[type="text"]')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(chip, text);
    chip.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const track = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-ruler-track]')!;

describe('RulerSlider: typing a value sets the range', () => {
  it('200 typed into a 0–1 slider makes the range 0–200, and the slider keeps it', () => {
    const onChange = vi.fn(), onRange = vi.fn();
    const ui = (value: number) => <RulerSlider ariaLabel="Radius" value={value} min={0} max={1} onChange={onChange} onRange={onRange} />;
    const { host, rerender } = mount(ui(0.5));
    type(host, '200');
    expect(onRange).toHaveBeenCalledWith(0, 200);
    expect(onChange).toHaveBeenLastCalledWith(200);
    // The owner stores the value but not the range (a Finish param, say): the slider's own range is 0–200 exactly.
    rerender(ui(200));
    expect(track(host).getAttribute('aria-valuemin')).toBe('0');
    expect(track(host).getAttribute('aria-valuemax')).toBe('200');
    // A smaller number is just the value: the range stays.
    type(host, '3');
    expect(onChange).toHaveBeenLastCalledWith(3);
    expect(onRange).toHaveBeenCalledTimes(1);
    rerender(ui(3));
    expect(track(host).getAttribute('aria-valuemax')).toBe('200');
  });

  it('a bidirectional slider (−10–10) typed 50 becomes −50–50', () => {
    const onRange = vi.fn();
    const { host } = mount(<RulerSlider ariaLabel="B" value={0} min={-10} max={10} onChange={() => {}} onRange={onRange} />);
    type(host, '50');
    expect(onRange).toHaveBeenLastCalledWith(-50, 50);
  });

  it('a number below the min of a one-way slider extends the min', () => {
    const onRange = vi.fn();
    const { host } = mount(<RulerSlider ariaLabel="B" value={0.5} min={0} max={1} onChange={() => {}} onRange={onRange} />);
    type(host, '-3');
    expect(onRange).toHaveBeenLastCalledWith(-3, 1);
  });

  it('a hard limit clamps the typed value and never widens', () => {
    const onChange = vi.fn(), onRange = vi.fn();
    const { host } = mount(<RulerSlider ariaLabel="Opacity" value={0.5} min={0} max={1} hard onChange={onChange} onRange={onRange} />);
    type(host, '200');
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(onRange).not.toHaveBeenCalled();
    expect(track(host).getAttribute('aria-valuemax')).toBe('1');
  });

  it('the owner’s new range replaces the slider’s own, and a reset by the owner is honoured', () => {
    const ui = (value: number, min: number, max: number) => <RulerSlider ariaLabel="B" value={value} min={min} max={max} onChange={() => {}} />;
    const { host, rerender } = mount(ui(0.5, 0, 1));
    type(host, '200');
    rerender(ui(200, 0, 200)); // stored by the owner
    expect(track(host).getAttribute('aria-valuemax')).toBe('200');
    rerender(ui(0.5, 0, 1)); // Reset range on the card
    expect(track(host).getAttribute('aria-valuemax')).toBe('1');
  });
});

describe('RulerSlider: right-click is the row’s', () => {
  it('a right-click on the track reaches the menu around it and opens no range fields (#306 regression)', () => {
    const onMenu = vi.fn((e: React.MouseEvent) => { e.preventDefault(); });
    const { host } = mount(
      <div data-param-key="radius" onContextMenu={onMenu}>
        <RulerSlider ariaLabel="Radius" value={0.5} min={0} max={1} onChange={() => {}} onRange={() => {}} />
      </div>,
    );
    act(() => { track(host).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })); });
    expect(onMenu).toHaveBeenCalledTimes(1);
    // The row found the param the way the graph's menu does.
    expect((onMenu.mock.calls[0][0].target as HTMLElement).closest('[data-param-key]')?.getAttribute('data-param-key')).toBe('radius');
    expect(host.querySelector('[data-range-label], [data-range-end], input[aria-label="Slider minimum"]')).toBeNull();
  });

  it('shows no min/max labels or fields of its own', () => {
    const { host } = mount(<RulerSlider ariaLabel="Radius" value={0.5} min={0} max={1} onChange={() => {}} onRange={() => {}} />);
    expect(host.querySelectorAll('input').length).toBe(1); // the value chip only
    expect(track(host).textContent).toBe(''); // ticks and the needle, no numbers at the ends
  });
});
