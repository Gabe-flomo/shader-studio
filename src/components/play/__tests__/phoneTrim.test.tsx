// @vitest-environment jsdom
/**
 * The phone's Play page, trimmed (user decisions 2026-10-18; play/phoneTrim.ts):
 * the Layers top has only the picture's size (Free or 1:1), every size picker
 * on a phone offers only those two, Sound is one page (the Sampler, readers,
 * effects; no Arrangement), and Add layer leaves out the sound layers but the
 * Sampler. Desktop and tablet keep everything.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  class RO { observe() {} unobserve() {} disconnect() {} }
  class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  vi.stubGlobal('ResizeObserver', RO);
  // jsdom has no scrolling: revealing a layer scrolls to it.
  if (typeof Element !== 'undefined') Element.prototype.scrollIntoView = function scrollIntoView() {};
  vi.stubGlobal('IntersectionObserver', IO);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PlayPage } from '../PlayPage';
import { AspectPicker } from '../../shell/PreviewChrome';
import { AudioFxPanel } from '../finish/AudioFxPanel';
import { DEFAULT_SPLIT, showPage, usePlaySplit } from '../playSplit';
import { useInputsBoard } from '../inputs/InputsBoard';
import { usePlayUi } from '../playUi';
import { useViewport } from '../../../lib/viewport';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { emptyPlayRecord, type PlayRecord } from '../../../types/play';
import { defaultLayer, padsReaderInput } from '../../../types/playLayers';
import { BUILTIN_LAYERS, PHONE_BUILTIN_LAYERS, builtinGroups } from '../layers/addLayerCatalog';
import { PHONE_ASPECTS, aspectChoices, desktopSoundNote, phoneAspect } from '../phoneTrim';
import { addPhoneSampler } from '../pages/PhonePages';
import { PREVIEW_ASPECTS } from '../../../utils/graphImportPlan';
import type { PlayAudioEngine } from '../../../types/playAudioEngine';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const errors: unknown[][] = [];
let spy: ReturnType<typeof vi.spyOn>;
beforeAll(() => { spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a); }); });
afterAll(() => spy.mockRestore());

const DESKTOP_VIEW = { ...useViewport.getState(), width: 1440, height: 900, phone: false, landscape: true, breakpoint: 'desktop-lg' as const };
const PHONE_VIEW = { ...DESKTOP_VIEW, width: 390, height: 844, phone: true, landscape: false, breakpoint: 'mobile' as const, touchSeen: true };

let roots: Array<{ root: Root; el: HTMLElement }> = [];
afterEach(() => {
  for (const r of roots) { act(() => r.root.unmount()); r.el.remove(); }
  roots = [];
  useViewport.setState(DESKTOP_VIEW);
  usePlayUi.setState({ performing: false });
});
beforeEach(() => {
  errors.length = 0;
  useNodeGraphStore.getState().setPlay(() => ({ ...emptyPlayRecord(), layers: [defaultLayer('shape', 'l1', 'Box')] } as PlayRecord));
  useNodeGraphStore.getState().setPreviewAspect('free');
  usePlayUi.setState({ selected: '', folded: {} });
  useInputsBoard.setState({ tab: 'controls' });
  usePlaySplit.setState({ ...DEFAULT_SPLIT });
});

function mount(node: React.ReactNode): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  act(() => root.render(node));
  return el;
}
function mountPhone(): HTMLElement {
  useViewport.setState(PHONE_VIEW);
  usePlaySplit.setState({ ...DEFAULT_SPLIT, available: false, host: null });
  return mount(<PlayPage compact />);
}
const click = (el: Element | null | undefined) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const radios = (el: Element) => [...el.querySelectorAll('[role="radio"]')];

describe('picture sizes on a phone', () => {
  it('only Free and 1:1; any other saved size shows as Free', () => {
    expect(PHONE_ASPECTS).toEqual(['free', '1:1']);
    expect(aspectChoices(true).map(a => a.id)).toEqual(['free', '1:1']);
    expect(aspectChoices(false)).toBe(PREVIEW_ASPECTS);
    expect(phoneAspect('1:1')).toBe('1:1');
    for (const a of ['free', '16:9', '9:16', '4:3', '21:9'] as const) expect(phoneAspect(a)).toBe('free');
  });

  it('the preview’s size picker offers two on the phone’s Play page, every size elsewhere, and doesn’t rewrite the saved one', () => {
    useNodeGraphStore.getState().setPreviewAspect('16:9');
    // Desktop: all eight, 16:9 picked.
    let el = mount(<AspectPicker />);
    expect(radios(el).length).toBe(PREVIEW_ASPECTS.length);
    expect(radios(el).find(r => r.getAttribute('aria-checked') === 'true')?.getAttribute('aria-label')).toMatch(/^16:9/);
    // A phone's Play page: two, Free shown as picked; the saved 16:9 is kept.
    act(() => { useViewport.setState(PHONE_VIEW); usePlayUi.setState({ performing: true }); });
    el = mount(<AspectPicker />);
    expect(radios(el).map(r => r.getAttribute('aria-label')?.split(':')[0])).toEqual(['Free', '1']);
    expect(radios(el)[0].getAttribute('aria-checked')).toBe('true');
    expect(useNodeGraphStore.getState().previewAspect).toBe('16:9');
    // Picking one there saves it.
    click(radios(el)[1]);
    expect(useNodeGraphStore.getState().previewAspect).toBe('1:1');
    expect(errors).toEqual([]);
  });
});

describe('the phone’s Layers top', () => {
  it('has no Canvas row, only the picture’s size above the pinned Background', () => {
    useNodeGraphStore.getState().setPreviewAspect('4:3');
    const el = mountPhone();
    act(() => showPage('layers'));
    expect(el.querySelector('[data-canvas-row]')).toBeNull();
    expect(el.querySelector('[aria-label="Canvas shape"]')).toBeNull();
    expect(el.querySelector('[aria-label^="Preview resolution"]')).toBeNull();
    const row = el.querySelector('[data-phone-size-row]')!;
    expect(row).not.toBeNull();
    expect(radios(row).map(r => r.textContent)).toEqual(['Free', '1:1']);
    // A saved 4:3 shows as Free, and stays saved.
    expect(radios(row)[0].getAttribute('aria-checked')).toBe('true');
    expect(useNodeGraphStore.getState().previewAspect).toBe('4:3');
    expect(el.querySelector('[data-background-pinned]')).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it('a tablet keeps the whole Canvas row', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true, railPage: 'layers', host, wide: false });
    mount(<PlayPage canvasRow />);
    expect(host.querySelector('[data-canvas-row]')).not.toBeNull();
    expect(radios(host.querySelector('[aria-label="Canvas shape"]')!).length).toBe(PREVIEW_ASPECTS.length);
    expect(host.querySelector('[data-phone-size-row]')).toBeNull();
    host.remove();
  });
});

describe('the phone’s Sound tab', () => {
  it('opens straight to one page: Sampler, readers, effects; no Arrangement and no sheet', () => {
    const el = mountPhone();
    click(el.querySelector('[data-rail-category="engine"]'));
    expect(usePlaySplit.getState().railPage).toBe('finish-sound');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const page = el.querySelector('[data-phone-sound]')!;
    expect(page).not.toBeNull();
    expect([...page.querySelectorAll('[data-phone-sound-section]')].map(s => s.getAttribute('data-phone-sound-section'))).toEqual(['sampler', 'readers', 'effects']);
    expect(page.textContent).not.toContain('Arrangement');
    // The MIDI synth's chain (a desktop sound) isn't listed; the master is.
    expect(page.textContent).toContain('Master');
    expect(page.textContent).not.toContain('MIDI synth');
    // No note when the setup has nothing of the desktop's.
    expect(el.querySelector('[data-phone-sound-note]')).toBeNull();
    // Asking for the Arrangement (a link, a saved page) shows this page instead.
    act(() => showPage('engine-performance'));
    expect(el.querySelector('[data-phone-page="finish-sound"] [data-phone-sound]')).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it('+ Sampler adds one and opens it in Layers; readers with nothing to hear listen to it', () => {
    const el = mountPhone();
    act(() => showPage('finish-sound'));
    click([...el.querySelectorAll('[data-phone-sound-section="sampler"] button')].find(b => b.textContent === 'Sampler'));
    const play = useNodeGraphStore.getState().play;
    const sampler = play.layers.find(l => l.kind === 'sampler')!;
    expect(sampler).toBeTruthy();
    expect(play.audioReaders?.input).toBe(padsReaderInput(sampler.id));
    expect(usePlaySplit.getState().railPage).toBe('layers');
    expect(usePlayUi.getState().selected).toBe(sampler.id);
    expect(errors).toEqual([]);
  });

  it('readers that already listen to something keep it', () => {
    const p0 = { ...emptyPlayRecord(), audioReaders: { input: 'node1', readers: [] } } as PlayRecord;
    expect(addPhoneSampler(p0, 's1').audioReaders?.input).toBe('node1');
  });

  it('a setup with the desktop’s Audio engine says it still plays, edited on a computer', () => {
    const engine = { racks: [{ id: 'r1', name: 'Rack 1' }] } as unknown as PlayAudioEngine;
    useNodeGraphStore.getState().setPlay(p => ({ ...p, audioEngine: engine }));
    expect(desktopSoundNote(useNodeGraphStore.getState().play)).toMatch(/still plays here/);
    const el = mountPhone();
    act(() => showPage('finish-sound'));
    expect(el.querySelector('[data-phone-sound-note]')?.textContent).toMatch(/1 rack\b.*computer/);
  });

  it('desktop keeps the Arrangement and the full Effects page', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, available: true, railPage: 'finish-sound', host, wide: true });
    mount(<PlayPage />);
    expect(host.querySelector('[data-phone-sound]')).toBeNull();
    expect(host.textContent).toContain('MIDI synth');
    host.remove();
  });
});

describe('Add layer on a phone', () => {
  it('leaves out the Audio layer but keeps the Sampler; desktop keeps both', () => {
    const kinds = (layers: typeof BUILTIN_LAYERS) => builtinGroups('', layers).flatMap(g => g.items.map(i => i.kind));
    expect(kinds(PHONE_BUILTIN_LAYERS)).not.toContain('audio');
    expect(kinds(PHONE_BUILTIN_LAYERS)).toContain('sampler');
    expect(kinds(BUILTIN_LAYERS)).toContain('audio');
    expect(kinds(BUILTIN_LAYERS)).toContain('sampler');
  });

  it('the phone’s menu shows Sampler and no Audio', () => {
    const el = mountPhone();
    act(() => showPage('layers'));
    click([...el.querySelectorAll('button')].find(b => /Add layer/.test(b.textContent ?? '')));
    const text = document.body.textContent ?? '';
    expect(text).toContain('Sampler');
    expect(text).not.toContain('Live sound as a waveform');
    expect(errors).toEqual([]);
  });
});

describe('the effects list on a phone', () => {
  it('a MIDI synth chain with effects still shows (it plays), an empty one doesn’t', () => {
    const play = { ...emptyPlayRecord(), audioFx: { chains: { synth: { on: true, effects: [{ id: 'e1', kind: 'reverb', on: true }] } } } } as unknown as PlayRecord;
    const el = mount(<AudioFxPanel play={play} onChange={() => {}} touch />);
    expect(el.textContent).toContain('MIDI synth');
    const el2 = mount(<AudioFxPanel play={emptyPlayRecord()} onChange={() => {}} touch />);
    expect(el2.textContent).not.toContain('MIDI synth');
  });
});
