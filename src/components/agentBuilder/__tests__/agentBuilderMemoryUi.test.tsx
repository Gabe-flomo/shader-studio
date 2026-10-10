// @vitest-environment jsdom
/**
 * The Agent Builder's Memory section, drawn (docs/agent-builder.md "Memory"): add a level that
 * fades, refill it from what it smells, write it as an expression (checked inline), speed × energy,
 * a memory in "only when", the viewport lens, and the ants preset as cards.
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
import { AgentBuilder } from '../AgentBuilder';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect; };

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } vi.useRealTimers(); });
const $ = (sel: string) => document.body.querySelector(sel);
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)];
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const menuItem = (text: string) => $$('[role="menuitem"]').find(b => b.textContent?.startsWith(text)) ?? null;
const group = () => useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup');
const type = (el: Element | null, value: string) => {
  expect(el).toBeTruthy();
  act(() => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

function startTrail() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<AgentBuilder groupId={null} onClose={() => {}} />));
  mounted.push({ root, host });
  click($('[data-start-kind="trail"]'));
  vi.useFakeTimers();
}
const settle = () => act(() => { vi.advanceTimersByTime(300); });

describe('the Memory section', () => {
  it('an energy level that fades, refilled by what it smells, as an expression; speed × energy; the lens', () => {
    startTrail();
    click($('[data-studio-section="memory"]'));
    expect($('[data-memory-section]')).toBeTruthy();
    click($('[data-memory-add]'));
    click(menuItem('A level that fades'));
    expect($('[data-memory="energy"]')).toBeTruthy();
    expect($('[data-memory-slots]')?.textContent).toBe('1 of 4 numbers');
    // Picked on adding: the viewport colours the walkers by it.
    expect($('[data-memory-lens]')?.getAttribute('data-memory-lens')).toBe('energy');
    // Refilled when it smells: Add up what it smells.
    click($('[data-op-add="energy:sum"]'));
    // And an expression line, checked as you type.
    click($('[data-op-add="energy:expr"]'));
    type($('[data-expr-input]'), 'energy * 0.98 + here.fuel');
    expect($('[data-expr-error]')?.textContent).toMatch(/here.fuel isn't a trail/);
    type($('[data-expr-input]'), 'energy * 0.98 + here.ow');
    expect($$('[data-expr-offer]').map(b => b.textContent)).toEqual(['here.own']);
    click($('[data-expr-offer="here.own"]'));
    expect($('[data-expr-error]')).toBeNull();
    settle();
    const set = groupRules(group()!);
    expect(set.memories).toEqual([{ id: 'm1', name: 'energy', type: 'level', start: 1, fade: 0.3 }]);
    const acts = set.species[0].rules.flatMap(r => r.do).filter(a => a.kind === 'mem');
    expect(acts).toEqual([
      { kind: 'mem', memory: 'm1', op: 'sum', channel: 'own', value: 1 },
      { kind: 'mem', memory: 'm1', op: 'expr', expr: 'energy * 0.98 + here.own' },
    ]);
    // The group has More memory (state E): Agent Output's More memory is wired.
    const out = (group()!.params.subgraph as { nodes: Array<{ type: string; inputs: Record<string, { connection?: unknown }> }> }).nodes.find(n => n.type === 'agentOutput')!;
    expect(out.inputs.moreMemory?.connection).toBeTruthy();
    // Speed × energy on Moving.
    click($('[data-studio-section="moving"]'));
    click($('[data-times-chip="speed"]'));
    click(menuItem('× energy'));
    expect($('[data-times-chip="speed"]')?.textContent).toBe('× energy');
    settle();
    expect(groupRules(group()!).species[0].speedTimes).toEqual({ memory: 'm1' });
  });

  it('a memory in another card\'s "only when"', () => {
    startTrail();
    click($('[data-studio-section="memory"]'));
    click($('[data-memory-add]'));
    click(menuItem('On / off'));
    click($('[data-studio-section="trail"]'));
    click($('[data-only-when-add="trail"]'));
    click(menuItem('carrying…'));
    expect($('[data-only-when-chip="trail:mem"]')?.textContent).toContain('carrying is on');
    settle();
    const r = groupRules(group()!).species[0].rules.find(x => x.do.some(a => a.kind === 'trail'))!;
    expect(r.when).toEqual([{ kind: 'mem', memory: 'm1', cmp: '>', value: 0.5 }]);
  });

  it('the ants preset is cards: two Senses, Head for and Turn round, memories with their cards, nothing Advanced', () => {
    startTrail();
    click($('[data-preset="ants"]'));
    expect($('[data-studio-section="advanced"]')).toBeNull();
    click($('[data-studio-section="senses"]'));
    expect($$('[data-card-slot]').map(x => x.getAttribute('data-card-slot'))).toEqual(['senses#1']);
    expect($$('[data-only-when-chip]').map(x => x.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('carrying is off'), expect.stringContaining('carrying is on')]));
    click($('[data-studio-section="memory"]'));
    expect($$('[data-memory]').map(x => x.getAttribute('data-memory'))).toEqual(['carrying', 'away']);
    expect($$('[data-memory="carrying"] [data-card]')).toHaveLength(2);
    expect($('[data-memory-colour] [role="radio"][aria-checked="true"]')?.textContent).toBe('carrying');
  });
});
