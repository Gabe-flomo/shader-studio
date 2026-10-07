// @vitest-environment jsdom
/**
 * The builders as tabs, drawn: Grid Rules opens on Presets, a tab click shows that section only
 * with its "How this works", the tab is remembered; Born & Survive draws a 3×3 picture on every
 * switch, reads back as one sentence that follows the switches, and has the mini-board; Agent
 * Rules has Species · Rules · Trails · Look.
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
import type { GraphNode } from '../../../types/nodeGraph';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { GridRulesEditor } from '../GridRulesEditor';
import { AgentRulesModal } from '../../NodeGraph/AgentRulesModal';
import { COUNT_PRESETS, GRID_DEFAULTS, presetPatch } from '../../../gridRules/spec';
import { useBuilderWindows } from '../../../builders/windows';
import { BuildersSection } from '../../builders/BuildersSection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

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
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const $ = (sel: string) => document.body.querySelector(sel);
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)];
const tabs = () => $$('[data-builder-tabbar] [data-builder-tab]').map(b => b.textContent);

const grid: GraphNode = { id: 'g1', type: 'gridRules', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { ...GRID_DEFAULTS, ...presetPatch(COUNT_PRESETS.life), ruleType: 'count' } };

beforeEach(() => {
  localStorage.clear();
  useNodeGraphStore.setState({ nodes: [structuredClone(grid)], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
});

describe('Grid Rules as tabs', () => {
  it('opens on Presets; each tab shows its own section and "How this works"; the tab is remembered', () => {
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    expect(tabs()).toEqual(['Presets', 'Neighbourhood', 'Born & Survive', 'Start', 'Brush', 'Colours', 'Recipe']);
    expect($('[data-grid-tab]')?.getAttribute('data-grid-tab')).toBe('presets');
    expect($('[data-builder-how]')?.textContent).toMatch(/How this works: Pick the kind of rule/);
    expect($('[role="radiogroup"][aria-label="Rule type"]')).toBeTruthy();

    click($('[data-builder-tab="start"]'));
    expect($('[data-grid-tab]')?.getAttribute('data-grid-tab')).toBe('start');
    expect($('[data-builder-tab="start"]')?.getAttribute('aria-selected')).toBe('true');
    expect($('[role="radiogroup"][aria-label="Rule type"]')).toBeNull();
    expect($('[data-fold="gridRules:open:run-more"]')?.textContent).toMatch(/Seed and speed/);
    expect(localStorage.getItem('builder:grid-rules:tab')).toBe('start');

    click($('[data-builder-tab="neighbourhood"]'));
    expect($$('[data-nb]').map(b => b.getAttribute('data-nb'))).toEqual(['moore', 'vonNeumann', 'radius']);
    expect($('[data-nb="moore"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('Born & Survive: a 3×3 picture on every switch, one live sentence, and the mini-board', () => {
    localStorage.setItem('builder:grid-rules:tab', 'rule');
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    const born = $$('[data-count-row="born"] [data-count]');
    const survive = $$('[data-count-row="survive"] [data-count]');
    expect(born).toHaveLength(9);
    expect(survive).toHaveLength(9);
    for (const b of [...born, ...survive]) expect(b.querySelectorAll('svg rect')).toHaveLength(9);
    expect(born[3].getAttribute('aria-label')).toBe('Born with 3: empty + 3 neighbours → comes alive');
    expect(survive[4].getAttribute('aria-label')).toBe('Survive with 4: live + 4 → dies (too crowded)');
    expect(survive[1].getAttribute('aria-label')).toBe('Survive with 1: live + 1 → dies of loneliness');
    expect($('[data-rule-sentence]')?.textContent).toBe('Cells are born with exactly 3 neighbours and survive with 2 or 3; fewer and they die of loneliness, more and they die of crowding.');
    expect($$('[data-mini-board] [data-pattern]').map(b => b.textContent)).toEqual(['Glider', 'Blinker', 'R-pentomino', 'Random blob']);

    // Switching Born on 6 (HighLife) changes the node and the sentence.
    click(born[6]);
    expect(useNodeGraphStore.getState().nodes[0].params.bornMask).toBe((1 << 3) | (1 << 6));
    expect($('[data-rule-sentence]')?.textContent).toMatch(/^Cells are born with 3 or 6 neighbours/);
  });

  it('Recipe: the rule as text in the Playfield language; typing and Apply change the node (one step)', () => {
    localStorage.setItem('builder:grid-rules:tab', 'recipe');
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    const ta = $('textarea[data-language-text="grid"]') as HTMLTextAreaElement;
    expect(ta.value).toBe('life');
    const type = (v: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, v);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    type('highlife walls bord=480');
    expect($$('[data-language-error]').map(e => e.textContent).join()).toMatch(/Did you mean “board”/);
    expect(($('[data-language-apply]') as HTMLButtonElement).disabled).toBe(true);
    type('highlife walls board=480');
    click($('[data-language-apply]'));
    expect(useNodeGraphStore.getState().nodes[0].params).toMatchObject({ bornMask: (1 << 3) | (1 << 6), edges: 'walls', board: '0.25' });
    expect(ta.value).toBe('highlife board=480 walls');
  });

  it('a tab the rule type does not have falls back to the rule\'s own tab', () => {
    localStorage.setItem('builder:grid-rules:tab', 'neighbourhood');
    useNodeGraphStore.setState({ nodes: [{ ...structuredClone(grid), params: { ...grid.params, ruleType: 'smooth' } }] });
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    expect(tabs()).toEqual(['Presets', 'Smooth', 'Start', 'Brush', 'Colours', 'Recipe']);
    expect($('[data-grid-tab]')?.getAttribute('data-grid-tab')).toBe('presets');
  });
});

describe('Agent Rules as tabs', () => {
  it('Species · Rules · Trails · Look, opening on Rules; masks and sensors folded', () => {
    useBuilderWindows.setState({ gridRules: null, agentRules: null, recipe: null });
    mount(<BuildersSection />);
    click($('[data-builder="agents"]'));
    const group = useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup')!;
    mount(<AgentRulesModal node={group} onClose={() => {}} />);
    expect(tabs()).toEqual(['Species', 'Rules', 'Trails', 'Look', 'Recipe']);
    expect($('[data-agent-tab]')?.getAttribute('data-agent-tab')).toBe('rules');
    expect($('[data-fold="agentRules:open:masks"] button')?.getAttribute('aria-expanded')).toBe('false');
    click($('[data-builder-tab="trails"]'));
    expect($('[data-agent-tab]')?.getAttribute('data-agent-tab')).toBe('trails');
    expect($('[aria-label="Name of trail channel 1"]')).toBeTruthy();
    expect($('[data-fold="agentRules:open:sensing"]')?.textContent).toMatch(/Sensors/);
    expect($('[data-builder-how]')?.textContent).toMatch(/trails in four channels/);
    click($('[data-builder-tab="species"]'));
    expect($('[aria-label="Species name"]')).toBeTruthy();
    expect(localStorage.getItem('builder:agent-rules:tab')).toBe('species');
  });

  it('Recipe: the rule set as text; Apply writes it into the group (one step)', () => {
    vi.useFakeTimers();
    useBuilderWindows.setState({ gridRules: null, agentRules: null, recipe: null });
    mount(<BuildersSection />);
    click($('[data-builder="agents"]'));
    const group = useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup')!;
    localStorage.setItem('builder:agent-rules:tab', 'recipe');
    mount(<AgentRulesModal node={group} onClose={() => {}} />);
    const ta = $('textarea[data-language-text="agents"]') as HTMLTextAreaElement;
    expect(ta.value).toMatch(/^agents/);
    expect(ta.value).toMatch(/always do /);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'agents kind=trail\nspecies Slime speed=0.22\n  always do turn toward trail 45deg, wander 7deg, leave trail 1');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click($('[data-language-apply]'));
    act(() => { vi.runAllTimers(); });
    vi.useRealTimers();
    const rules = useNodeGraphStore.getState().nodes.find(n => n.id === group.id)!.params.agentRules as { species: Array<{ name: string; rules: unknown[] }> };
    expect(rules.species.map(x => x.name)).toEqual(['Slime']);
    expect(rules.species[0].rules).toHaveLength(1);
  });
});
