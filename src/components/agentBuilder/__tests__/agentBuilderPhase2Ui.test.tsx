// @vitest-environment jsdom
/**
 * The Agent Builder, phase 2, drawn (docs/agent-builder.md): flocks (the view radius ring follows
 * its slider), particles (force arrows), orbiters (the orbit circle), crowds, kinds of walker as
 * chips (add, rename, remove, lit in the viewport), "only when" lines, dragging cards by keyboard,
 * the undo after making a setup, and the Born diagram in 3D.
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
import { agentSpotRegistry } from '../../../lib/agentRunner';
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
const key = (el: Element | null, k: string) => { expect(el).toBeTruthy(); act(() => { el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }); };
const hover = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { el!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); el!.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })); }); };
const group = () => useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup');
const settle = () => act(() => { vi.advanceTimersByTime(300); });

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

function start(kind: string, space: '2d' | '3d' = '2d') {
  mount(<AgentBuilder groupId={null} onClose={() => {}} />);
  if (space === '3d') click($$('[aria-label="Start in 2D or 3D"] button').find(b => b.textContent === '3D') ?? null);
  click($(`[data-start-kind="${kind}"]`));
  return group()!;
}

describe('flocks', () => {
  it('open on Neighbours: the view radius is a ring that follows its slider, and Max neighbours lights the ones it counts', () => {
    vi.useFakeTimers();
    start('flock');
    expect($('[data-studio-kind]')?.textContent).toBe('Flock (boids) · 2D');
    expect($$('[data-studio-section]').map(b => b.getAttribute('data-studio-section'))).toEqual(['born', 'neighbours', 'steering', 'moving']);
    const d = () => $('[data-diagram="neighbours"]')!;
    expect(d().getAttribute('data-radius')).toBe('0.05');
    const ring0 = Number(d().getAttribute('data-ring-px'));
    const track = $('[data-setting="radius"] [data-ruler-track]');
    act(() => { (track as HTMLElement).focus(); });
    for (let i = 0; i < 10; i++) key(track, 'ArrowRight');
    expect(d().getAttribute('data-radius')).toBe('0.06');
    expect(Number(d().getAttribute('data-ring-px'))).toBeCloseTo(ring0 * 1.2, 0);
    expect($('[data-view-ring]')?.getAttribute('stroke-width')).toBe('3'); // lit while dragged
    settle();
    expect(groupRules(group()!).neighbours?.radius).toBeCloseTo(0.06);
    // Max neighbours: the counted ones.
    key($('[data-setting="max"] [data-ruler-track]'), 'Home');
    expect(d().getAttribute('data-counted')).toBe('1');
    expect($$('[data-neighbour="counted"]').length).toBe(1);
    expect($$('[data-neighbour="ignored"]').length).toBeGreaterThan(5);
  });

  it('Turning: separation, alignment and cohesion are cards with their diagrams; a handle moves a card (rule order)', () => {
    vi.useFakeTimers();
    start('flock');
    click($('[data-studio-section="steering"]'));
    expect($$('[data-card-slot]').map(c => c.getAttribute('data-card-slot'))).toEqual(['separate#0', 'match#0', 'cohere#0', 'wobble#0']);
    expect($('[data-diagram="steering"] [data-separate]')).toBeTruthy();
    expect($('[data-diagram="steering"] [data-cohere]')).toBeTruthy();
    expect($('[data-diagram="steering"] [data-match]')).toBeTruthy();
    hover($('[data-card-slot="cohere#0"]'));
    expect($('[data-kind-diagram]')?.getAttribute('data-card-hot')).toBe('cohere#0');
    expect($('[data-diagram="steering"] [data-separate]')).toBeNull(); // only the pointed card's part
    key($('[data-card-handle="cohere#0"]'), 'ArrowUp');
    expect($$('[data-card-slot]').map(c => c.getAttribute('data-card-slot'))).toEqual(['separate#0', 'cohere#0', 'match#0', 'wobble#0']);
    settle();
    expect(groupRules(group()!).species[0].rules.map(r => r.do.map(a => a.kind))).toEqual([['separate'], ['cohere'], ['match', 'wander']]);
    // Avoid edges: added, its band along the picture's edge.
    click($('[data-card-add="avoidEdges"]'));
    hover($('[data-card-slot="avoidEdges#0"]'));
    expect($('[data-diagram="edges-band"]')?.getAttribute('data-margin')).toBe('0.1');
  });
});

describe('particles', () => {
  it('gravity is an arrow that turns with Direction; a point that pulls draws its arrows in; drag shows the speed a second later', () => {
    vi.useFakeTimers();
    start('particles');
    expect($('[data-force="gravity"]')?.getAttribute('data-angle')).toBe('-90');
    hover($('[data-card-slot="gravity#0"]'));
    key($('[data-card-slot="gravity#0"] [data-setting="angle"] [data-ruler-track]'), 'End');
    expect($('[data-force="gravity"]')?.getAttribute('data-angle')).toBe('180');
    // Attract: the template's mouse push is off; switch it on, then pull toward a point.
    click($('[data-card-switch="attract#0"] button'));
    click($$('[data-card-slot="attract#0"] [aria-label="Toward"] button').find(b => b.textContent === 'A point') ?? null);
    key($('[data-card-slot="attract#0"] [data-setting="strength"] [data-ruler-track]'), 'End');
    expect($('[data-force="attract"]')?.getAttribute('data-pull')).toBe('in');
    settle();
    const rules = groupRules(group()!).species[0].rules;
    expect(rules.find(r => r.do.some(a => a.kind === 'force' && a.field === 'point'))).toMatchObject({ do: [{ kind: 'force', field: 'point', strength: 3 }] });
    expect(rules.find(r => r.do.some(a => a.kind === 'force' && a.field === 'point'))!.off).toBeUndefined();
    expect($('[data-force="drag"]')?.getAttribute('data-keep')).toBe(String(Math.round(Math.exp(-0.35) * 1000) / 1000));
  });

  it('Life: brightness by age with when it dies; the Dies card\'s slider is its only when', () => {
    vi.useFakeTimers();
    start('particles');
    click($('[data-studio-section="life"]'));
    expect($('[data-diagram="life"]')?.getAttribute('data-dies')).toBe('3.2');
    key($('[data-card-slot="die#0"] [data-setting="dieAfter"] [data-ruler-track]'), 'End');
    expect($('[data-diagram="life"]')?.getAttribute('data-dies')).toBe('20');
    settle();
    expect(groupRules(group()!).species[0].rules.find(r => r.do[0].kind === 'die')!.when).toEqual([{ kind: 'age', cmp: '>', seconds: 20 }]);
  });
});

describe('orbiters and crowds', () => {
  it('Orbiters open on Orbit: the circle at its radius, which way round', () => {
    vi.useFakeTimers();
    start('orbit');
    expect($$('[data-studio-section]').map(b => b.getAttribute('data-studio-section'))).toEqual(['born', 'orbit', 'neighbours', 'moving', 'advanced']); // its packed / circling state rules stay Advanced
    const o = () => $('[data-orbit="orbit#0"]')!;
    const r0 = Number(o().getAttribute('data-orbit-r'));
    key($('[data-card-slot="orbit#0"] [data-setting="distance"] [data-ruler-track]'), 'End');
    expect(Number(o().getAttribute('data-orbit-r'))).toBeGreaterThan(r0 * 2);
    click($$('[data-card-slot="orbit#0"] [aria-label="Way round"] button').find(b => b.textContent?.includes('Clockwise')) ?? null);
    expect(o().getAttribute('data-cw')).toBe('cw');
    settle();
    expect(groupRules(group()!).species[0].rules[0].do[0]).toMatchObject({ kind: 'orbit', distance: 1.5, cw: true });
  });

  it('Crowds make two kinds walking opposite ways, with Head for and Slow in a crowd among their Turning cards', () => {
    start('crowd');
    expect($('[data-studio-kind]')?.textContent).toBe('Crowd · 2D');
    expect($$('button[data-species]').map(b => b.textContent)).toEqual(['Going right', 'Going left']);
    expect($$('[data-card-slot]').map(c => c.getAttribute('data-card-slot'))).toEqual(['goal#0', 'separate#0', 'separate#1', 'slow#0', 'wobble#0']);
  });
});

describe('kinds of walker', () => {
  it('add, light, rename and remove a kind: the rule set\'s species', () => {
    vi.useFakeTimers();
    start('trail');
    click($('[data-species-add]'));
    expect($$('button[data-species]').map(b => b.textContent)).toEqual(['Slime', 'Kind 2']);
    expect($('[data-species="1"]')?.getAttribute('aria-checked')).toBe('true');
    // Lit in the viewport: the runner draws that kind into the spotlight canvas.
    expect($('[data-spotlight]')?.getAttribute('data-spotlight')).toBe('1');
    expect(agentSpotRegistry.get(group()!.id)?.dataset.species).toBe('1');
    click($('[data-spotlight-close]'));
    expect($('[data-spotlight]')).toBeNull();
    settle();
    expect(groupRules(group()!).species.length).toBe(2);
    expect(group()!.params.species).toBe('2');
    // Rename in place.
    act(() => { $('[data-species="1"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    const input = $('[data-species-rename="1"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Rivals');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(input, 'Enter');
    expect($$('button[data-species]').map(b => b.textContent)).toEqual(['Slime', 'Rivals']);
    settle();
    expect(groupRules(group()!).species[1].name).toBe('Rivals');
    // Each kind has its own cards.
    click($('[data-card-switch="senses"] button'));
    settle();
    expect(groupRules(group()!).species[1].rules.some(r => r.off)).toBe(true);
    expect(groupRules(group()!).species[0].rules.some(r => r.off)).toBe(false);
    click($('[data-species-remove="1"]'));
    settle();
    expect(groupRules(group()!).species.map(x => x.name)).toEqual(['Slime']);
  });
});

describe('"only when…"', () => {
  it('picking "older than…" puts the condition on the card\'s rule; a shape draws where it applies', () => {
    vi.useFakeTimers();
    start('flock');
    click($('[data-studio-section="steering"]'));
    click($('[data-only-when-add="cohere#0"]'));
    click($$('[role="menuitem"]').find(b => b.textContent?.includes('older than')) ?? null);
    expect($('[data-only-when-chip="cohere#0"]')?.textContent).toContain('older than 2 s');
    settle();
    const rules = groupRules(group()!).species[0].rules;
    expect(rules.find(r => r.do[0].kind === 'cohere')!.when).toEqual([{ kind: 'age', cmp: '>', seconds: 2 }]);
    // Clear it, then pick a shape: the viewport shades where it doesn't act.
    click($('[data-only-when-clear="cohere#0"]'));
    click($('[data-only-when-add="cohere#0"]'));
    click($$('[role="menuitem"]').find(b => b.textContent?.includes('inside / outside')) ?? null);
    hover($('[data-card-slot="cohere#0"]'));
    expect($('[data-only-when-diagram="shape"]')?.getAttribute('data-inside')).toBe('inside');
    settle();
    expect(groupRules(group()!).species[0].rules.find(r => r.do[0].kind === 'cohere')!.when).toEqual([{ kind: 'shape', shape: 'circle', x: 0, y: 0, size: 0.4 }]);
  });

  it('trail followers\' cards have the line too (Senses only when a neighbour is near)', () => {
    vi.useFakeTimers();
    start('trail');
    click($('[data-only-when-add="senses"]'));
    click($$('[role="menuitem"]').find(b => b.textContent?.includes('a neighbour is near')) ?? null);
    settle();
    const r = groupRules(group()!).species[0].rules;
    expect(r.find(x => x.do[0].kind === 'turn')!.when).toEqual([{ kind: 'neighbours', who: 'all', cmp: '>', count: 0 }]);
    expect(r.map(x => x.do.map(a => a.kind))).toEqual([['turn'], ['wander', 'trail']]);
  });
});

describe('undo and Born', () => {
  it('the first undo after making a setup takes back only the last edit (the setup is a step of its own)', () => {
    start('trail');
    click($('[data-studio-section="born"]'));
    key($('[data-setting="size"] [data-ruler-track]'), 'End');
    const emit = () => useNodeGraphStore.getState().nodes.find(n => n.type === 'agentEmit')!;
    expect(emit().params.size).toBe(2);
    act(() => { useNodeGraphStore.getState().undo(); });
    expect(group()).toBeTruthy();
    expect(emit().params.size).toBe(0.15);
    act(() => { useNodeGraphStore.getState().undo(); });
    expect(group()).toBeUndefined();
  });

  it('a 3D ball is drawn through the 3D camera (a projection), not flat', () => {
    start('trail', '3d');
    click($('[data-studio-section="born"]'));
    expect($('[data-diagram="born"]')?.getAttribute('data-born-3d')).toBe('projected');
    expect($('[data-born3d="ball"]')).toBeTruthy();
    expect(Number($('[data-born3d="ball"]')!.getAttribute('data-born3d-r'))).toBeGreaterThan(10);
  });
});
