// @vitest-environment jsdom
/**
 * Follow a field in the Agent Builder (docs/agent-builder.md "Follow a field"): the card, its
 * gallery, layers, masks, your own expressions with inline errors, one legend entry a layer, and
 * the field drawn over the picture (a lit layer alone).
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
import type { RuleAction } from '../../../agentRules/spec';
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
const input = (el: Element | null, v: string) => {
  expect(el).toBeTruthy();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const group = () => useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup');
const settle = () => act(() => { vi.advanceTimersByTime(300); });
const fieldOf = () => groupRules(group()!).species[0].rules.flatMap(r => r.do).find(a => a.kind === 'field') as Extract<RuleAction, { kind: 'field' }> | undefined;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

function start(kind: string) {
  mount(<AgentBuilder groupId={null} onClose={() => {}} />);
  click($(`[data-start-kind="${kind}"]`));
  return group()!;
}

describe('Follow a field', () => {
  it('a new card draws its field over the picture, one legend entry a layer; the gallery adds layers', () => {
    vi.useFakeTimers();
    start('particles');
    click($('[data-card-add="field"]'));
    settle();
    expect(fieldOf()).toMatchObject({ strength: 1, grip: 3, spec: { layers: [{ kind: 'vortex' }] } });
    expect(Number($('[data-force="field"]')?.getAttribute('data-field-arrows'))).toBeGreaterThan(50);
    expect($$('[data-legend-entry]').map(e => e.getAttribute('data-legend-entry'))).toContain('field#0:L0');
    expect($('[data-legend-entry="field#0:L0"]')?.textContent).toMatch(/Vortex at the centre, strength 0.6: particles circle anticlockwise, faster near the middle/);
    // The gallery: eleven tiles; curl noise adds a layer and a legend entry.
    click($('[data-field-add]'));
    expect($$('[data-field-tile]').length).toBe(11);
    click($('[data-field-tile="curl"]'));
    settle();
    expect(fieldOf()!.spec.layers.map(l => l.kind)).toEqual(['vortex', 'curl']);
    expect($('[data-legend-entry="field#0:L1"]')).toBeTruthy();
    // Weight it down, and keep it inside a circle.
    key($('[data-setting="layer1-weight"] [data-ruler-track]'), 'Home');
    click($('[data-field-extras="1"]'));
    click($$('[data-setting="layer1-mask"] button').find(b => b.textContent === 'Only inside') ?? null);
    settle();
    expect(fieldOf()!.spec.layers[1]).toMatchObject({ kind: 'curl', weight: -2, mask: { shape: 'circle', size: 0.5 } });
    // Hovering a layer's legend entry draws that layer alone.
    hover($('[data-legend-entry="field#0:L1"]'));
    expect($('[data-force="field"]')?.getAttribute('data-field-lit')).toBe('1');
  });

  it('your own: errors inline as you type, an example inserts, the shader gets the layer', () => {
    vi.useFakeTimers();
    start('particles');
    click($('[data-card-add="field"]'));
    click($('[data-field-add]'));
    click($('[data-field-tile="own"]'));
    input($('[data-field-own-input="vx"]'), '-y * 2');
    expect($('[data-field-own-error="vx"]')?.textContent).toMatch(/2\.0/);
    input($('[data-field-own-input="vy"]'), 'q');
    expect($('[data-field-own-error="vy"]')?.textContent).toMatch(/q isn't known/);
    click($('[data-field-example="Ripples"]'));
    expect($('[data-field-own-error="vx"]')).toBeNull();
    settle();
    expect(fieldOf()!.spec.layers[1]).toMatchObject({ kind: 'own', vx: 'sin(y * 6.0 + t)', vy: 'cos(x * 6.0 - t)' });
    const inside = (group()!.params.subgraph as { nodes: Array<{ id: string; params: Record<string, unknown> }> }).nodes;
    const block = inside.find(x => x.params.fieldSpec);
    expect(JSON.stringify(block?.params.lines)).toContain('sin(q2.y * 6.0 + u_time)');
  });
});
