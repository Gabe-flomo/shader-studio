// @vitest-environment jsdom
/**
 * The QoL sweep's shared behaviour:
 * - a Tooltip with a description opens on a touch tap (a phone has no hover) and closes on a tap elsewhere;
 * - wheel gestures: what a wheel event over a zoomable view means, and who owns a swipe (wheelOwner);
 * - Select / GroupedPicker: a long choice has its full text as a title and wraps to two lines, not one cut short;
 * - the log ruler shows and takes the real value;
 * - builder sliders carry their Play menu (lazyParam) and the builders' switches are Toggles / mute switches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Tooltip } from '../Tooltip';
import { Select } from '../Select';
import { GroupedPicker } from '../GroupedPicker';
import { LogRulerSlider, fromLog, toLog } from '../LogRulerSlider';
import { claimWheel, mostlyVertical, ownsWheel, wheelIntent, SETTLE_MS } from '../wheelOwner';
import { clampLines, liveNumber } from '../textFit';

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

function fire(el: EventTarget, type: string, init: Record<string, unknown> = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  for (const [k, v] of Object.entries(init)) if (!(k in e) || k === 'pointerType' || k === 'movementX') Object.defineProperty(e, k, { value: v });
  act(() => { el.dispatchEvent(e); });
}
function type(input: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { set.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('Tooltip on a touch screen', () => {
  it('a tap on something with a description opens it; a tap elsewhere closes it', () => {
    mount(<div><Tooltip label="Speed" description="Cycles a second."><span data-anchor>Speed</span></Tooltip><span data-elsewhere>x</span></div>);
    expect($('[role="tooltip"]')).toBeNull();
    fire($('[data-anchor]')!, 'pointerdown', { pointerType: 'touch' });
    expect($('[role="tooltip"]')?.textContent).toContain('Cycles a second.');
    fire($('[data-elsewhere]')!, 'pointerdown', { pointerType: 'touch' });
    expect($('[role="tooltip"]')).toBeNull();
  });

  it('a second tap closes it, and a mouse press still only hides (no tip over a drag)', () => {
    mount(<Tooltip label="Speed" description="Cycles a second."><span data-anchor>Speed</span></Tooltip>);
    fire($('[data-anchor]')!, 'pointerdown', { pointerType: 'touch' });
    expect($('[role="tooltip"]')).toBeTruthy();
    fire($('[data-anchor]')!, 'pointerdown', { pointerType: 'touch' });
    expect($('[role="tooltip"]')).toBeNull();
    fire($('[data-anchor]')!, 'pointerdown', { pointerType: 'mouse' });
    expect($('[role="tooltip"]')).toBeNull();
  });

  it('a label-only tooltip does not open on a tap (nothing to explain)', () => {
    mount(<Tooltip label="Undo"><span data-anchor>↶</span></Tooltip>);
    fire($('[data-anchor]')!, 'pointerdown', { pointerType: 'touch' });
    expect($('[role="tooltip"]')).toBeNull();
  });
});

describe('wheel gestures', () => {
  it('ctrl / ⌘ (a pinch) zooms, a mostly-vertical wheel is vertical, a sideways swipe pans', () => {
    expect(wheelIntent({ deltaX: 0, deltaY: 10, ctrlKey: true, metaKey: false })).toBe('zoom');
    expect(wheelIntent({ deltaX: 0, deltaY: 10, ctrlKey: false, metaKey: true })).toBe('zoom');
    expect(wheelIntent({ deltaX: 2, deltaY: 10, ctrlKey: false, metaKey: false })).toBe('vertical');
    expect(wheelIntent({ deltaX: 12, deltaY: 3, ctrlKey: false, metaKey: false })).toBe('pan');
    expect(mostlyVertical({ deltaX: 5, deltaY: 5 })).toBe(false);
  });

  it('an element owns a swipe only when the pointer moved onto it and rested before the swipe began', () => {
    let now = 1000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const el = document.createElement('div');
    el.setAttribute('data-wheel-test', '');
    document.body.appendChild(el);
    const release = claimWheel(el, '[data-wheel-test]');
    // A pan that starts over it with a still pointer stays a pan.
    fire(el, 'wheel', { deltaX: 10 });
    expect(ownsWheel(el)).toBe(false);
    // The pointer really moves onto it, rests, then a new swipe starts: it's the element's.
    now += 1000;
    fire(el, 'pointermove', { pointerType: 'mouse', movementX: 3 });
    now += SETTLE_MS + 10;
    fire(el, 'wheel', { deltaX: 10 });
    expect(ownsWheel(el)).toBe(true);
    release();
    expect(ownsWheel(el)).toBe(false);
    el.remove();
    spy.mockRestore();
  });
});

describe('long choices are not cut short', () => {
  const long = 'Halo (a bright rim round a flat shape, with a very long name)';
  it('Select: the face has the full text as a title and wraps to two lines', () => {
    mount(<Select ariaLabel="Glow style" value="halo" onChange={() => {}} options={[{ value: 'soft', label: 'Soft' }, { value: 'halo', label: long }]} />);
    expect($('[data-select-face]')?.title).toBe(long);
    expect($('select')?.title).toBe(long);
    const label = $('[data-select-label]')!;
    expect(label.style.webkitLineClamp || label.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    expect(label.style.whiteSpace).toBe('normal');
  });

  it('GroupedPicker: the face wraps to two lines and keeps its title', () => {
    mount(<GroupedPicker ariaLabel="Shape" value="a" onChange={() => {}} sections={[{ items: [{ value: 'a', label: long }] }]} />);
    const face = $('[role="combobox"]')!;
    expect(face.title).toBe(long);
    const label = $('[data-picker-face-label]')!;
    expect(label.style.webkitLineClamp || label.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
  });

  it('textFit: clamps and live numbers', () => {
    expect(clampLines(2)).toMatchObject({ WebkitLineClamp: 2, whiteSpace: 'normal' });
    expect(liveNumber(5, 'right')).toMatchObject({ fontVariantNumeric: 'tabular-nums', minWidth: '5ch', textAlign: 'right' });
  });
});

describe('LogRulerSlider', () => {
  it('runs on the logarithm but shows and takes the real value', () => {
    expect(fromLog(toLog(440, 20), 1)).toBe(440);
    const onChange = vi.fn();
    mount(<LogRulerSlider value={440} min={20} max={20000} step={1} ariaLabel="Band" onChange={onChange} format={v => `${v} Hz`} />);
    const chip = $('input[type="text"]') as HTMLInputElement;
    expect(chip.value).toBe('440 Hz');
    expect($('[data-ruler-track]')?.getAttribute('aria-valuetext')).toBe('440 Hz');
    type(chip, '1000');
    expect(onChange).toHaveBeenLastCalledWith(1000);
  });
});
