// @vitest-environment jsdom
/**
 * Under the hood in the Agent Builder (docs/agent-builder.md): the panel opens a request only while
 * it is open, shows the textures the runner says the group has (C and D only with per-walker state),
 * each channel labelled with its colour map; the selected section lights its channels; pointing at a
 * texel reads that walker and rings it on the picture; a click on the picture picks the nearest
 * walker and lights its texel everywhere; Follow keeps reading it. Also the slider hammer (the
 * phase 2 "Maximum update depth exceeded") and NumberInput's one render a value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { Profiler, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useBuilderWindows } from '../../../builders/windows';
import { groupRules } from '../../../agentRules/apply';
import { hoodRequests, hoodWanted, type HoodRequest, type HoodStateInfo } from '../../../lib/agentHood';
import { texelCentre } from '../../../agentBuilder/hood';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { useHoodStore } from '../hoodStore';
import { AgentBuilder } from '../AgentBuilder';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
// Every element measures 800 × 600 at the origin (the viewport, a thumbnail, the pick layer).
Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect; };

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return root;
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } vi.useRealTimers(); });
const $ = (sel: string) => document.body.querySelector(sel);
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)];
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const key = (el: Element | null, k: string) => { expect(el).toBeTruthy(); act(() => { el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }); };
const group = () => useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup');

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

function startTrail() {
  mount(<AgentBuilder groupId={null} onClose={() => {}} />);
  click($('[data-start-kind="trail"]'));
  return group()!;
}
const INFO: HoodStateInfo = { side: 512, count: 512 * 512, stateC: false, d3: false, aspect: 16 / 9, species: 1, trail: true };
function openHood(info: Partial<HoodStateInfo> = {}): HoodRequest {
  click($('[data-hood-toggle]'));
  const req = hoodRequests()[0];
  act(() => req.onState!({ ...INFO, ...info }));
  return req;
}
/** The probe's read for a walker at picture position (x, y): A, B, C, D, then where it lands (clip x, y, seen). */
const probeAt = (x: number, y: number, o: { heading?: number; age?: number } = {}) =>
  Float32Array.from([x, y, o.heading ?? 0, o.age ?? 1, 0.1, 0, 0.1, 1e30, 0, 0, 0, 0, 0, 0, 0, 0, x / (16 / 9), y, 1, 0]);
const lit = () => $$('[data-hood-lit]').map(e => e.getAttribute('data-hood-channel')).sort();

describe('Under the hood: opening and closing', () => {
  it('nothing is asked of the runner until the panel opens, and nothing after it closes', () => {
    startTrail();
    expect($('[data-hood-panel]')).toBeNull();
    expect(hoodWanted()).toBe(false);
    click($('[data-hood-toggle]'));
    expect($('[data-hood-panel]')).toBeTruthy();
    expect(hoodWanted()).toBe(true);
    expect(hoodRequests().map(r => r.groupId)).toEqual([group()!.id]);
    expect($('[data-hood-size]')?.textContent).toBe('Waiting for the walkers…');
    // The section diagram gives way to the plain picture and the pick layer.
    expect($('[data-walker-diagram]')).toBeNull();
    expect($('[data-hood-pick]')).toBeTruthy();
    click($('[data-hood-close]'));
    expect($('[data-hood-panel]')).toBeNull();
    expect(hoodWanted()).toBe(false);
    expect(useHoodStore.getState().request).toBeNull();
    expect($('[data-walker-diagram]')).toBeTruthy();
    // Remembered closed.
    expect(localStorage.getItem('builder:agent-builder:studio:hood')).toBe('0');
  });
});

describe('Under the hood: the textures', () => {
  it('A and B labelled channel by channel with their colour maps, and the trail channels with their readers and writers', () => {
    startTrail();
    const req = openHood();
    expect($('[data-hood-size]')?.textContent).toBe('512 × 512 texels = 262,144 walkers · walker i at (i mod 512, i ÷ 512)');
    expect($$('[data-hood-texture]').map(e => e.getAttribute('data-hood-texture'))).toEqual(['A', 'B']);
    const maps = Object.fromEntries($$('[data-hood-texture] [data-hood-channel]').map(e => [e.getAttribute('data-hood-channel'), e.getAttribute('data-hood-map')]));
    expect(maps).toEqual({ posX: 'gradient', posY: 'gradient', heading: 'hue', age: 'soft', velX: 'diverge', velY: 'diverge', speed: 'ramp', life: 'life' });
    expect($('[data-hood-channel="heading"]')?.textContent).toMatch(/heading/);
    expect($('[data-hood-legend="heading"]')).toBeTruthy();
    expect($('[data-hood-learn="A"]')?.textContent).toMatch(/Each pixel is one walker/);
    expect($$('[data-hood-trail]').length).toBe(4);
    expect($('[data-hood-trail="0"]')?.textContent).toMatch(/read by Senses/);
    expect($('[data-hood-trail="0"]')?.textContent).toMatch(/written by Trail \(Deposit\)/);
    // The request draws what is shown: 8 state thumbnails and 4 trail ones, in the atlas.
    expect(req.atlas.tiles.length).toBe(12);
    expect(req.specs.length).toBe(12);
  });

  it('C and D only when the group keeps them', () => {
    startTrail();
    openHood({ stateC: true });
    expect($$('[data-hood-texture]').map(e => e.getAttribute('data-hood-texture'))).toEqual(['A', 'B', 'C', 'D']);
    expect($('[data-hood-channel="species"]')?.getAttribute('data-hood-map')).toBe('species');
    expect($('[data-hood-channel="memX"]')?.getAttribute('data-hood-map')).toBe('heat');
    expect($('[data-hood-channel="dep0"]')?.getAttribute('data-hood-map')).toBe('channel');
    expect(hoodRequests()[0].atlas.tiles.length).toBe(20);
  });

  it('the selected section lights the channels it uses; a kind chip lights the kind', () => {
    startTrail();
    openHood({ stateC: true });
    // Senses (the first section): the heading and the trail it smells.
    expect(lit()).toEqual(['heading', 'trail0']);
    expect($('[data-hood-channel="posX"]')?.hasAttribute('data-hood-dim')).toBe(true);
    click($('[data-studio-section="moving"]'));
    expect(lit()).toEqual(['heading', 'speed', 'velX', 'velY']);
    click($('[data-studio-section="born"]'));
    expect(lit()).toEqual(['age', 'life', 'posX', 'posY']);
    click($('[data-studio-section="trail"]'));
    expect(lit()).toEqual(['dep0', 'dep1', 'dep2', 'dep3', 'trail0']);
    click($('[data-species="0"]'));
    expect(lit()).toEqual(['species']);
  });
});

describe('Under the hood: linking a walker to the picture', () => {
  it('pointing at a texel reads that walker and rings it where it is on the picture', () => {
    startTrail();
    const req = openHood();
    const tile = $('[data-hood-tile="posX"]')!;
    // The middle of a thumbnail: texel (256, 256), walker 256 · 512 + 256.
    act(() => { tile.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 400, clientY: 300 })); });
    expect(useHoodStore.getState().hover).toBe(131328);
    expect(req.probe).toBe(131328);
    expect($$('[data-hood-mark="hover"]').length).toBe(8);
    act(() => req.onProbe(probeAt(0.5, 0.25, { heading: Math.PI }), 131328));
    // The viewport (800 × 600) shows the 16:9 picture 800 × 450 from y 75: clip (0.28125, 0.25) → (512.5, 243.75).
    const ring = $('[data-hood-ring="hover"]')!;
    expect(ring.getAttribute('data-walker')).toBe('131328');
    expect(ring.getAttribute('data-x')).toBe('512.5');
    expect(ring.getAttribute('data-y')).toBe('243.8');
    expect($('[data-hood-readout]')?.getAttribute('data-hood-readout')).toBe('131328');
    expect($('[data-hood-value="position"]')?.textContent).toBe('0.5, 0.25');
    expect($('[data-hood-value="heading"]')?.textContent).toBe('180°');
    expect($('[data-hood-value="texel"]')?.textContent).toBe('256, 256');
    // The walker's place on the trail too.
    expect($('[data-hood-trail-mark]')).toBeTruthy();
    act(() => { tile.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })); tile.dispatchEvent(new MouseEvent('pointerleave', { bubbles: false })); });
    expect(useHoodStore.getState().hover).toBeNull();
    expect(req.probe).toBeNull();
    expect($('[data-hood-ring]')).toBeNull();
  });

  it('a click on the picture asks for the nearest walker within a few pixels; its texel lights up in every texture', () => {
    startTrail();
    const req = openHood({ stateC: true });
    act(() => { ($('[data-hood-pick]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 400, clientY: 300 })); });
    expect(req.pick).toEqual({ x: 0, y: 0, rx: 0.02, ry: expect.closeTo(16 / 600) });
    // The runner answers walker 1026: texel (2, 2) of a 512 side.
    act(() => req.onPick(1026));
    expect(useHoodStore.getState().selected).toBe(1026);
    const marks = $$('[data-hood-mark="selected"]');
    expect(marks.length).toBe(16);
    const c = texelCentre(2, 2, 512);
    expect(marks.every(m => m.getAttribute('data-u') === c.u.toFixed(5) && m.getAttribute('data-v') === c.v.toFixed(5))).toBe(true);
    // Its numbers are read once (Follow is off), then the read stops.
    expect(req.probe).toBe(1026);
    act(() => req.onProbe(probeAt(-0.4, 0.1), 1026));
    expect(req.probe).toBeNull();
    expect($('[data-hood-ring="selected"]')?.getAttribute('data-walker')).toBe('1026');
    expect($('[data-hood-readout] b')?.textContent).toBe('Picked');
    // Nobody near: the pick is let go.
    act(() => req.onPick(-1));
    expect(useHoodStore.getState().selected).toBeNull();
    expect($$('[data-hood-mark="selected"]').length).toBe(0);
  });

  it('a click on a texel picks its walker too', () => {
    startTrail();
    openHood();
    act(() => { ($('[data-hood-tile="speed"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 })); });
    expect(useHoodStore.getState().selected).toBe(0);
  });

  it('Follow keeps reading the picked walker as it moves, and the ring follows', () => {
    startTrail();
    const req = openHood();
    act(() => req.onPick(77));
    act(() => req.onProbe(probeAt(0, 0), 77));
    expect(req.probe).toBeNull();
    click($('[data-hood-follow] button'));
    expect(useHoodStore.getState().follow).toBe(true);
    expect(req.probe).toBe(77);
    expect($('[data-hood-readout] b')?.textContent).toBe('Following');
    const x0 = $('[data-hood-ring="selected"]')!.getAttribute('data-x');
    act(() => req.onProbe(probeAt(0.8, 0), 77));
    expect(req.probe).toBe(77);
    const x1 = $('[data-hood-ring="selected"]')!.getAttribute('data-x');
    expect(Number(x1)).toBeGreaterThan(Number(x0));
    expect($('[data-hood-value="position"]')?.textContent).toBe('0.8, 0');
    // Let go: no read, no ring.
    click($('[data-hood-unpick]'));
    expect(req.probe).toBeNull();
    expect($('[data-hood-ring]')).toBeNull();
  });
});

describe('the phase 2 loose end: a hammered slider', () => {
  it('120 quick key presses each way on builder sliders: no update loop, the value and its number box agree', () => {
    vi.useFakeTimers();
    const errs: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(String(a[0])); };
    try {
      startTrail();
      for (const [section, setting] of [['senses', 'distance'], ['moving', 'speed'], ['trail', 'fades']] as const) {
        click($(`[data-studio-section="${section}"]`));
        const track = $(`[data-setting="${setting}"] [data-ruler-track]`);
        act(() => { (track as HTMLElement).focus(); });
        for (let i = 0; i < 120; i++) key(track, 'ArrowRight');
        for (let i = 0; i < 60; i++) key(track, 'ArrowLeft');
        const box = $(`[data-setting="${setting}"] input`) as HTMLInputElement;
        expect(Number(box.value)).toBeCloseTo(Number(track!.getAttribute('aria-valuenow')), 3);
      }
      act(() => { vi.advanceTimersByTime(400); });
      expect(groupRules(group()!).species[0].speed).toBeCloseTo(0.22 + 60 * 0.005);
    } finally { console.error = orig; }
    expect(errs.filter(e => /Maximum update depth|Too many re-renders/.test(e))).toEqual([]);
  });

  it('NumberInput shows a new value in the same render (no second render from an effect)', () => {
    let renders = 0;
    const ui = (v: number) => <Profiler id="n" onRender={() => { renders++; }}><NumberInput value={v} onCommit={() => {}} format={x => x.toFixed(2)} /></Profiler>;
    const root = mount(ui(1));
    const input = $('input') as HTMLInputElement;
    expect(input.value).toBe('1.00');
    renders = 0;
    act(() => root.render(ui(2)));
    expect(input.value).toBe('2.00');
    expect(renders).toBe(1);
    // While typing, a new value from outside leaves the typed text alone; leaving shows the value.
    act(() => { input.focus(); });
    act(() => root.render(ui(3)));
    expect(input.value).toBe('2.00');
    act(() => { input.blur(); });
    expect(input.value).toBe('3.00');
  });
});
