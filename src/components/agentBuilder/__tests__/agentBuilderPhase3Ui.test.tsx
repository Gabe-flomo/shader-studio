// @vitest-environment jsdom
/**
 * Agent Builder phase 3 in the window (docs/agent-builder.md "Where", "Trail channels", "Look"):
 * the Where picker lists the graph's regions and wires the picked one; a shape drawn on the picture
 * becomes a node with handles; trail channels are named colour swatches; Look for every kind; the
 * kind of walker can be changed from the nav.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useBuilderWindows } from '../../../builders/windows';
import { groupRules } from '../../../agentRules/apply';
import { n } from '../../../store/graphBuilder';
import { readMadeShape } from '../../../agentBuilder/madeShapes';
import { hoodTrailChannels } from '../../../agentBuilder/hood';
import { AgentBuilder } from '../AgentBuilder';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect; };

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } vi.useRealTimers(); });
const $ = (sel: string) => document.body.querySelector(sel);
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)];
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const pointer = (el: Element | null, type: string, x: number, y: number) => { expect(el).toBeTruthy(); act(() => { el!.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y })); }); };
const input = (el: Element | null, v: string) => {
  expect(el).toBeTruthy();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const choose = (el: Element | null, v: string) => {
  expect(el).toBeTruthy();
  act(() => { (el as HTMLSelectElement).value = v; el!.dispatchEvent(new Event('change', { bubbles: true })); });
};
const blur = (el: Element | null) => act(() => { (el as HTMLElement).blur(); el!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
const nodes = () => useNodeGraphStore.getState().nodes;
const group = () => nodes().find(x => x.type === 'agentsGroup')!;
const settle = () => act(() => { vi.advanceTimersByTime(300); });

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  // A circle in the graph to pick from.
  useNodeGraphStore.setState({ nodes: [n('circleSDF', 'gCircle', -900, 0, { radius: 0.35, posX: 0.4 })], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

function start(kind: string) {
  // As from the Scene builder's kind page with Keep my graph: the circle stays to be picked.
  mount(<AgentBuilder groupId={null} onClose={() => {}} onOpenGroup={() => {}} fromShell />);
  click($('[data-start-kind="' + kind + '"]'));
}

describe('the Where picker', () => {
  it('only when inside a shape of the graph: the list shows it with its kind; picking wires the group\'s mask', () => {
    vi.useFakeTimers();
    start('trail');
    click($('[data-only-when-add="senses"]'));
    click($$('[role="menuitem"]').find(b => b.textContent?.includes('inside / outside a region')) ?? null);
    click($('[data-where-way="graph"]'));
    const tile = $('[data-where-tile="gCircle:distance"]');
    expect(tile?.getAttribute('data-where-tile-kind')).toBe('shape');
    expect(tile?.textContent).toContain('Circle SDF');
    click(tile);
    const r = groupRules(group()).species[0].rules.find(x => x.do.some(a => a.kind === 'turn'))!;
    expect(r.when).toEqual([{ kind: 'mask', mask: 0, cmp: '<', value: 0 }]);
    expect(group().inputs.mask1?.connection).toEqual({ nodeId: 'gCircle', outputKey: 'distance' });
    expect($('[data-only-when-chip="senses"]')?.textContent).toContain('inside Circle SDF');
    // Pointing at its Where row shows it over the picture; outside flips the condition.
    // (the chip opened itself when the region was asked for)
    act(() => { $('[data-where="senses:where"]')!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); });
    expect($('[data-region-overlay="graph"]')?.getAttribute('data-region-kind')).toBe('shape');
    click($$('[data-where="senses:where"] button').find(b => b.textContent === 'Outside it') ?? null);
    expect(groupRules(group()).species[0].rules.find(x => x.do.some(a => a.kind === 'turn'))!.when).toEqual([{ kind: 'mask', mask: 0, cmp: '>', value: 0 }]);
  });

  it('a circle drawn on the picture becomes a node with a note; its handles drag it (its sliders)', () => {
    vi.useFakeTimers();
    start('flock');
    click($('[data-studio-section="steering"]'));
    click($('[data-only-when-add="cohere#0"]'));
    click($$('[role="menuitem"]').find(b => b.textContent?.includes('inside / outside a region')) ?? null);
    click($('[data-only-when-picking="cohere#0"] [data-where-way="create"]'));
    click($('[data-only-when-picking="cohere#0"] [data-where-make="circle"]'));
    const draw = $('[data-where-draw="circle"]');
    pointer(draw, 'pointerdown', 400, 300);
    pointer(draw, 'pointermove', 480, 300);
    pointer(draw, 'pointerup', 480, 300);
    const made = nodes().find(x => x.params.whereShape)!;
    expect(made.params.label).toBe('Where: circle');
    expect(String(made.params.__comment)).toMatch(/signed distance, below 0 inside/);
    const shape = readMadeShape(made)!;
    expect(shape.shape).toBe('circle');
    expect(shape.size).toBeGreaterThan(0.1);
    expect(group().inputs.mask1?.connection).toEqual({ nodeId: made.id, outputKey: 'result' });
    // Its handles on the picture: drag the middle.
    act(() => { $('[data-where="cohere#0:where"]')?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); });
    const overlay = $('[data-region-overlay="made"]');
    expect(overlay?.getAttribute('data-region-shape')).toBe('circle');
    pointer($('[data-where-handle="move"]'), 'pointerdown', 400, 300);
    pointer(overlay, 'pointermove', 300, 200);
    pointer(overlay, 'pointerup', 300, 200);
    const moved = readMadeShape(nodes().find(x => x.id === made.id))!;
    expect(moved.x).toBeLessThan(shape.x - 0.2);
    expect(moved.y).toBeGreaterThan(shape.y + 0.2);
    // The lines didn't change: a slider move (no recompile).
    expect(nodes().find(x => x.id === made.id)!.params.lines).toEqual(made.params.lines);
  });

  it('born inside and walls: a region feeds the Emit\'s Where ƒ and Move\'s Obstacle ƒ', () => {
    start('trail');
    click($('[data-studio-section="born"]'));
    // Where: the built-in shapes and External…; there is no separate "Or born inside" row.
    expect($('[data-setting="bornWhere"]')).toBeNull();
    expect($('[data-where="born"]')).toBeNull();
    const where = () => $('select[aria-label="Where they are born"]') as HTMLSelectElement;
    expect([...where().options].map(o => o.value)).toContain('external');
    choose(where(), 'external');
    // External opens on the kinds of source; picking one wires the Emit's Where ƒ as before.
    expect($('[data-where-panel="born"] [data-where-ways]')).toBeTruthy();
    click($('[data-where-panel="born"] [data-where-way="graph"]'));
    click($('[data-where-tile="gCircle:distance"]'));
    const emit = nodes().find(x => x.type === 'agentEmit')!;
    expect(emit.params.shape).toBe('field');
    expect(nodes().find(x => x.id === emit.inputs.where.connection!.nodeId)!.params.whereAdapter).toMatchObject({ nodeId: 'gCircle', use: 'born' });
    expect(where().value).toBe('external');
    expect($('[data-where="born"] [data-where-name]')?.textContent).toBe('Circle SDF');
    expect($('[data-where-panel="born"]')).toBeNull();
    click($('[data-studio-section="moving"]'));
    click($('[data-where-open="walls"]'));
    click($('[data-where-way="graph"]'));
    click($('[data-where-tile="gCircle:distance"]'));
    expect(groupRules(group()).obstacle).toEqual({ on: 'turn' });
    expect(group().inputs.obstacle?.connection).toEqual({ nodeId: 'gCircle', outputKey: 'distance' });
    click($$('[data-setting="wallsHow"] button').find(b => b.textContent === 'Slide along') ?? null);
  });

  it('a scene already born inside a source reopens as External with its summary; a built-in shape unwires it', () => {
    start('trail');
    click($('[data-studio-section="born"]'));
    choose($('select[aria-label="Where they are born"]'), 'external');
    click($('[data-where-panel="born"] [data-where-way="graph"]'));
    click($('[data-where-tile="gCircle:distance"]'));
    const id = group().id;
    for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); }
    mount(<AgentBuilder groupId={id} onClose={() => {}} onOpenGroup={() => {}} />);
    click($('[data-studio-section="born"]'));
    const where = () => $('select[aria-label="Where they are born"]') as HTMLSelectElement;
    expect(where().value).toBe('external');
    expect($('[data-where="born"] [data-where-name]')?.textContent).toBe('Circle SDF');
    expect($('[data-where-panel="born"]')).toBeNull();
    // Change opens the kinds again; ✕ or a built-in shape takes it away.
    click($('[data-where-open="born"]'));
    expect($('[data-where-panel="born"] [data-where-ways]')).toBeTruthy();
    choose(where(), 'ring');
    const emit = nodes().find(x => x.type === 'agentEmit')!;
    expect(emit.params.shape).toBe('ring');
    expect(emit.inputs.where?.connection).toBeUndefined();
    expect($('[data-where="born"]')).toBeNull();
  });
});

describe('trail channels', () => {
  it('named colour swatches: rename in place, recolour; the Smells chips and Under the hood use them', () => {
    vi.useFakeTimers();
    start('trail');
    click($('[data-studio-section="trail"]'));
    expect($$('[data-channel]').map(e => e.getAttribute('data-channel'))).toEqual(['0']);
    expect($('[data-channel="0"]')?.textContent).toMatch(/read by.*Senses/);
    click($('[data-channel-add]'));
    settle();
    expect(groupRules(group()).channels[1]).toBe('food');
    click($('[data-channel-name="1"]'));
    input($('[data-channel-name-input="1"]'), 'food');
    blur($('[data-channel-name-input="1"]'));
    click($('[data-channel-colour="1"]'));
    click($('[data-channel-swatch="yellow"]'));
    settle();
    const set = groupRules(group());
    expect(set.channels[1]).toBe('food');
    expect(set.channelColours?.[1]).toBe('#f2d14b');
    expect(hoodTrailChannels(set)[1]).toMatchObject({ name: 'food', colour: [242 / 255, 209 / 255, 75 / 255] });
    click($('[data-studio-section="senses"]'));
    expect($$('[data-setting="smells"] [data-chip]').map(c => c.textContent)).toEqual(expect.arrayContaining(['its trail · amber', 'food · yellow']));
    // Fades and Spreads: a before / after strip.
    click($('[data-studio-section="trail"]'));
    expect($$('[data-fade-strip] > span').length).toBe(3);
  });
});

describe('Look for every kind', () => {
  it('particles: style and colour by write Draw agents; by a trail writes the rules (Colour by Agent)', () => {
    vi.useFakeTimers();
    start('particles');
    click($('[data-studio-section="look"]'));
    const draw = () => nodes().find(x => x.type === 'drawAgents')!;
    click($$('[data-setting="style"] button').find(b => b.textContent === 'Glow') ?? null);
    expect(draw().params.style).toBe('glow');
    click($('[data-setting="colourBy"] [data-chip="speed"]'));
    expect(draw().params.colorBy).toBe('speed');
    expect($('[data-legend-entry="look:colour"]')?.textContent).toMatch(/Slow particles at the palette's start/);
    click($('[data-setting="colourBy"] [data-chip="trail"]'));
    settle();
    expect(draw().params.colorBy).toBe('agent');
    expect(groupRules(group()).look).toMatchObject({ by: 'trail', gain: 1 });
  });

  it('trail followers: no Draw agents yet, "Draw the walkers too" adds one; the trail\'s palette; the kind select', () => {
    vi.useFakeTimers();
    start('trail');
    click($('[data-studio-section="look"]'));
    expect(nodes().some(x => x.type === 'drawAgents')).toBe(false);
    click($('[data-look-add-draw]'));
    const d = nodes().find(x => x.type === 'drawAgents')!;
    expect(d.inputs.agents.connection?.nodeId).toBe(group().id);
    const out = nodes().find(x => x.type === 'output');
    if (out) expect(out.inputs.color.connection?.nodeId).toBe(d.id);
    click($('[data-trail-palette="ice"]'));
    const pal = nodes().find(x => x.type === 'stopPalette')!;
    expect(pal.params.color4).toEqual([0.95, 1, 1]);
    // The kind of walker (the old editor's Kind).
    expect($('[data-walker-kind]')).toBeTruthy();
  });
});
