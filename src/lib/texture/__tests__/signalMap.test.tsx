// @vitest-environment jsdom
/**
 * The webcam Texture node's camera picker and hand map mode (docs/texture-node.md):
 * - the card's camera picker lists the system's cameras and shares Play's setting both ways;
 * - a hand chip starts map mode, a click on a slider row makes the Play control and the mapping;
 * - a slider that's already a control keeps it; Esc and a second chip click leave map mode.
 * No real camera: navigator.mediaDevices is stubbed, as the other camera tests do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => { throw new Error('no camera in tests'); },
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'cam-a', label: 'FaceTime HD Camera' },
        { kind: 'videoinput', deviceId: 'cam-b', label: 'iPhone Camera' },
        { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
      ],
      addEventListener: () => {},
    },
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { n } from '../../../store/graphBuilder';
import { emptyPlayRecord } from '../../../types/play';
import { useToastStore } from '../../../components/ui/toastStore';
import { cameraInput } from '../../cameraInput';
import { CameraChip } from '../../../components/play/chips';
import { SignalChips, SignalMapLayer } from '../../../components/NodeGraph/SignalMap';
import { handSignalChips, mapSignalOnto, useSignalMap } from '../signalMap';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The compiled shader's uniforms: Play takes sliders that have one. */
const BINDINGS = { 'circ::radius': 'u_circ_radius', 'circ::posX': 'u_circ_posX' };

let root: Root | null = null;
let host: HTMLElement | null = null;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const chipButton = (key: string) => host!.querySelector(`[data-signal-chip="${key}"]`) as HTMLButtonElement;

/** A circle's card as NodeComponent marks it: the card's node id, each slider row's param key. */
function fakeCard(): HTMLElement {
  const card = document.createElement('div');
  card.dataset.nodeId = 'circ';
  card.innerHTML = '<div data-param-key="radius"><input aria-label="Radius" /></div><div data-other>header</div>';
  document.body.appendChild(card);
  return card;
}
const press = (el: Element) => {
  const e = new Event('pointerdown', { bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(e); });
  return e;
};

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useNodeGraphStore.setState({
    nodes: [n('uv', 'uv', 0, 0), n('circleSDF', 'circ', 100, 0, {}, { position: ['uv', 'uv'] }), n('output', 'out', 400, 0, {}, { color: ['circ', 'distance'] })],
    play: emptyPlayRecord(), paramBindings: BINDINGS,
  });
  useSignalMap.getState().stop();
  useToastStore.setState({ toasts: [] } as never);
  await cameraInput.setDevice('');
  await cameraInput.setResolution('720p');
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll('[data-node-id]').forEach(e => e.remove());
  root = null; host = null;
});

describe('Texture webcam: the camera picker', () => {
  it('lists the cameras and shares the choice with Play’s camera setting, both ways', async () => {
    // Two chips at once: Play's and the Texture card's are the same component on the same setting.
    act(() => { root!.render(<><div data-play><CameraChip /></div><div data-texture><CameraChip /></div></>); });
    await flush();
    const selects = () => [...host!.querySelectorAll('select[aria-label="Camera"]')] as HTMLSelectElement[];
    expect([...selects()[1].options].map(o => o.textContent)).toEqual(['Default camera', 'FaceTime HD Camera', 'iPhone Camera']);

    // Picked on the Texture card: the shared setting, and Play's chip, follow.
    act(() => { selects()[1].value = 'cam-b'; selects()[1].dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expect(cameraInput.getDeviceId()).toBe('cam-b');
    expect(selects()[0].value).toBe('cam-b');

    // Changed from Play (or anywhere): the card follows, resolution too.
    await act(async () => { await cameraInput.setDevice('cam-a'); await cameraInput.setResolution('1080p'); });
    expect(selects()[1].value).toBe('cam-a');
    expect((host!.querySelectorAll('select[aria-label="Camera resolution"]')[1] as HTMLSelectElement).value).toBe('1080p');
  });
});

describe('Texture webcam: hand map mode', () => {
  it('offers the everyday hand signals as chips', () => {
    expect(handSignalChips(emptyPlayRecord()).map(c => c.label)).toEqual(['Pinch', 'Openness', 'Palm X', 'Palm Y', 'Roll', 'Nearness']);
  });

  it('a chip, then a slider: the slider becomes a Play control with a mapping from the signal, and a toast says so', () => {
    const card = fakeCard();
    act(() => { root!.render(<><SignalChips live={false} /><SignalMapLayer /></>); });
    act(() => { chipButton('Pinch').click(); });
    expect(useSignalMap.getState().chip?.label).toBe('Pinch');
    expect(document.body.classList.contains('pf-signal-map')).toBe(true);
    expect(chipButton('Pinch').getAttribute('aria-pressed')).toBe('true');

    // A press off the rows does nothing; on the row it maps, and never reaches the slider.
    press(card.querySelector('[data-other]')!);
    expect(useNodeGraphStore.getState().play.controls).toHaveLength(0);
    const inner = vi.fn();
    card.querySelector('input')!.addEventListener('pointerdown', inner);
    const e = press(card.querySelector('input')!);
    expect(inner).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);

    const play = useNodeGraphStore.getState().play;
    expect(play.controls).toHaveLength(1);
    const [control] = play.controls;
    expect(control.target).toBe('circ::radius');
    expect(play.mappings).toHaveLength(1);
    expect(play.mappings[0]).toMatchObject({ controlId: control.id, source: { kind: 'hand', read: 'pinch', side: 'any' }, outMin: 0.01, outMax: 2, smoothMs: 120, enabled: true });
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe(`Pinch → ${control.label} mapped · edit in Play`);
    // One mapping per click: map mode ends.
    expect(useSignalMap.getState().chip).toBeNull();
    expect(document.body.classList.contains('pf-signal-map')).toBe(false);
  });

  it('a slider that is already a control keeps it, and gets the new mapping', () => {
    const st = useNodeGraphStore.getState();
    const first = mapSignalOnto(st.play, st.nodes, BINDINGS, handSignalChips(st.play)[1].source, 'circ', 'radius');
    if (!first.ok) throw new Error(first.reason);
    expect(first.reused).toBe(false);
    useNodeGraphStore.setState({ play: first.play });

    const card = fakeCard();
    act(() => { root!.render(<><SignalChips live={false} /><SignalMapLayer /></>); });
    act(() => { chipButton('Palm X').click(); });
    press(card.querySelector('input')!);
    const play = useNodeGraphStore.getState().play;
    expect(play.controls).toHaveLength(1);
    expect(play.mappings).toHaveLength(2);
    expect(play.mappings.every(m => m.controlId === first.control.id)).toBe(true);
    expect(play.mappings[1].source).toMatchObject({ kind: 'hand', read: 'palm', axis: 'x' });
  });

  it('Esc, or a second click on the chip, leaves map mode without mapping', () => {
    const card = fakeCard();
    act(() => { root!.render(<><SignalChips live={false} /><SignalMapLayer /></>); });
    act(() => { chipButton('Roll').click(); });
    expect(host!.querySelector('[data-signal-map-banner]')?.textContent).toContain('Roll');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(useSignalMap.getState().chip).toBeNull();
    expect(document.body.classList.contains('pf-signal-map')).toBe(false);
    press(card.querySelector('input')!);
    expect(useNodeGraphStore.getState().play.controls).toHaveLength(0);

    act(() => { chipButton('Roll').click(); });
    act(() => { chipButton('Roll').click(); });
    expect(useSignalMap.getState().chip).toBeNull();
  });

  it('a colour row or a wired slider says why instead of mapping', () => {
    useNodeGraphStore.setState({ nodes: [n('uv', 'uv', 0, 0), n('constant', 'k', 0, 0), n('circleSDF', 'circ', 100, 0, {}, { position: ['uv', 'uv'], radius: ['k', 'value'] })] });
    const st = useNodeGraphStore.getState();
    const r = mapSignalOnto(st.play, st.nodes, BINDINGS, handSignalChips(st.play)[0].source, 'circ', 'radius');
    expect(r.ok).toBe(false);
  });
});
