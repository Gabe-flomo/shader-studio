// @vitest-environment jsdom
/**
 * The builders' live viewport (components/builders/studio/LiveViewport.tsx), used by the Agent Builder and the Splat
 * builder: with the clock paused, it keeps asking the main preview for a frame until one comes (so it shows the last
 * frame, not "the preview is hidden"), then stops asking; with `ownSize`, the main preview draws at its size.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LiveViewport } from '../studio/LiveViewport';
import { sendPreviewFrame, setPreviewWake } from '../../../lib/previewMirror';
import { previewSizeOverride } from '../../../lib/previewSize';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { onRuntimeReset } from '../../../lib/runtimeReset';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null;
  setPreviewWake(null);
  vi.useRealTimers();
});

function mount(ui: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
}

describe('LiveViewport', () => {
  it('a paused preview: asks for frames until one comes, then shows it (never "hidden")', () => {
    const wake = vi.fn();
    setPreviewWake(wake);
    mount(<LiveViewport />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(wake.mock.calls.length).toBeGreaterThanOrEqual(4);
    const frame = document.createElement('canvas');
    frame.width = 64; frame.height = 36;
    act(() => { sendPreviewFrame(frame); });
    expect(host!.querySelector('[data-live-viewport]')?.getAttribute('data-live-viewport')).toBe('live');
    const asked = wake.mock.calls.length;
    act(() => { vi.advanceTimersByTime(3000); });
    expect(wake.mock.calls.length).toBe(asked);
    expect(host!.textContent).not.toContain('hidden');
  });

  it('with no frame at all it says the preview is hidden, and keeps asking (a frame later still shows)', () => {
    const wake = vi.fn();
    setPreviewWake(wake);
    mount(<LiveViewport emptyNote="The preview is hidden." />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(host!.querySelector('[data-live-viewport]')?.getAttribute('data-live-viewport')).toBe('none');
    const frame = document.createElement('canvas');
    frame.width = 64; frame.height = 36;
    act(() => { sendPreviewFrame(frame); });
    expect(host!.querySelector('[data-live-viewport]')?.getAttribute('data-live-viewport')).toBe('live');
  });

  it('ownSize: no size held until it is measured; let go when it closes', () => {
    mount(<LiveViewport ownSize />);
    // jsdom measures 0 × 0: nothing is held.
    expect(previewSizeOverride()).toBeNull();
    act(() => root!.unmount());
    root = null;
    expect(previewSizeOverride()).toBeNull();
  });

  it('clock: Pause / Play drives the app\'s clock and ↺ is the true reset (the Splat and Time Cube builders)', () => {
    mount(<LiveViewport />);
    expect(host!.querySelector('[data-preview-clock]')).toBeNull();
    act(() => root!.unmount());
    useNodeGraphStore.getState().setTimePlaying(true);
    mount(<LiveViewport ownSize clock />);
    const [pause, reset] = Array.from(host!.querySelectorAll<HTMLButtonElement>('[data-preview-clock] button'));
    act(() => pause.click());
    expect(useNodeGraphStore.getState().timePlaying).toBe(false);
    expect(pause.textContent).toContain('Play');
    act(() => pause.click());
    expect(useNodeGraphStore.getState().timePlaying).toBe(true);
    const fn = vi.fn();
    const off = onRuntimeReset(fn);
    act(() => reset.click());
    off();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
