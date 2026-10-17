// @vitest-environment jsdom
/**
 * Phone tap targets (the 2026-10 mobile audit): segments, switches and small icon buttons grow to a
 * thumb-sized target on a phone only — desktop sizes stay exactly as they were — and a long press
 * on a touch screen shows an icon button's label (there is no hover to show its tooltip).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { segmentMinHeight, Segmented, Toggle } from '../Choice';
import { IconButton, iconButtonSize } from '../Button';
import { LONG_PRESS_MS } from '../Tooltip';
import { useViewport } from '../../../lib/viewport';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return host;
}
const initial = useViewport.getState();
afterEach(() => {
  for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); }
  useViewport.setState(initial, true);
  vi.useRealTimers();
});
const setPhone = (phone: boolean) => useViewport.setState({ ...initial, phone, breakpoint: phone ? 'mobile' : 'desktop-lg' }, true);

const OPTIONS = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] as const;

describe('segment heights', () => {
  it('desktop: none unless tall', () => {
    expect(segmentMinHeight({ tall: false, phone: false, sm: false })).toBeUndefined();
    expect(segmentMinHeight({ tall: false, phone: false, sm: true })).toBeUndefined();
    expect(segmentMinHeight({ tall: true, phone: false, sm: true })).toBe(40);
  });
  it('phone: 32 compact, 36 regular, tall still 40', () => {
    expect(segmentMinHeight({ tall: false, phone: true, sm: true })).toBe(32);
    expect(segmentMinHeight({ tall: false, phone: true, sm: false })).toBe(36);
    expect(segmentMinHeight({ tall: true, phone: true, sm: false })).toBe(40);
  });
  it('renders the phone height only on a phone', () => {
    setPhone(false);
    let host = mount(<Segmented ariaLabel="X" value="a" onChange={() => {}} options={OPTIONS} />);
    expect(host.querySelector<HTMLElement>('[role="radio"]')!.style.minHeight).toBe('');
    setPhone(true);
    host = mount(<Segmented ariaLabel="X" value="a" onChange={() => {}} options={OPTIONS} />);
    expect(host.querySelector<HTMLElement>('[role="radio"]')!.style.minHeight).toBe('36px');
  });
  it('a switch is a 32px row on a phone, unchanged elsewhere', () => {
    setPhone(false);
    expect(mount(<Toggle checked={false} onChange={() => {}} label="L" />).querySelector<HTMLElement>('[role="switch"]')!.style.minHeight).toBe('');
    setPhone(true);
    expect(mount(<Toggle checked={false} onChange={() => {}} label="L" />).querySelector<HTMLElement>('[role="switch"]')!.style.minHeight).toBe('32px');
  });
});

describe('icon buttons', () => {
  it('26/32 on desktop, 32 for both on a phone', () => {
    expect(iconButtonSize('sm', false)).toBe(26);
    expect(iconButtonSize('md', false)).toBe(32);
    expect(iconButtonSize('sm', true)).toBe(32);
    expect(iconButtonSize('md', true)).toBe(32);
  });

  function touch(el: Element, type: string) {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    Object.defineProperty(e, 'pointerType', { value: 'touch' });
    act(() => { el.dispatchEvent(e); });
  }

  it('a long press shows the label and is not also a tap', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const host = mount(<IconButton icon="trash" label="Clear the editor" onClick={onClick} />);
    const btn = host.querySelector('button')!;
    touch(btn, 'pointerdown');
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 10); });
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Clear the editor');
    touch(btn, 'pointerup');
    act(() => { btn.click(); });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('a quick tap is a tap, with no tooltip', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const host = mount(<IconButton icon="trash" label="Clear the editor" onClick={onClick} />);
    const btn = host.querySelector('button')!;
    touch(btn, 'pointerdown');
    act(() => { vi.advanceTimersByTime(100); });
    touch(btn, 'pointerup');
    act(() => { btn.click(); });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2); });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });
});
