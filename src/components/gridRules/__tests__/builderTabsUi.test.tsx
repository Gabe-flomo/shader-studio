// @vitest-environment jsdom
/**
 * The builders as tabs, drawn: Agent Rules has Species · Rules · Trails · Look · Recipe. (Grid Rules
 * is on the Agent Builder's shell now: gridRulesBuilderUi.test.tsx.)
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
import { GRID_DEFAULTS } from '../../../gridRules/spec';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { AgentRulesModal } from '../../NodeGraph/AgentRulesModal';
import { useBuilderWindows } from '../../../builders/windows';
import { newAgentRules, openBuilder } from '../../../builders/open';

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

const grid: GraphNode = { id: 'g1', type: 'gridRules', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { ...GRID_DEFAULTS, ruleType: 'count' } };

beforeEach(() => {
  localStorage.clear();
  useNodeGraphStore.setState({ nodes: [structuredClone(grid)], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
});

describe('Agent Rules as tabs', () => {
  it('Species · Rules · Trails · Look, opening on Rules; masks and sensors folded', () => {
    useBuilderWindows.setState({ gridRules: null, agentRules: null, recipe: null });
    newAgentRules(); // the rules starter (the Builders entry now opens the Agent Builder's start page)
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

  it('3D Agent Builder: Space 3D in the header, the camera on Look (depth of field folded); 2D takes the camera away', () => {
    useBuilderWindows.setState({ gridRules: null, agentRules: null, recipe: null });
    openBuilder('agents3d'); // hidden from the list; still the 3D setup behind "new 3d agents"
    const group = useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup')!;
    localStorage.setItem('builder:agent-rules:tab', 'look');
    mount(<AgentRulesModal node={group} onClose={() => {}} />);
    expect($('[data-agent-space]')?.getAttribute('data-agent-space')).toBe('3d');
    expect($$('[data-camera]').map(x => x.getAttribute('data-camera'))).toEqual(['camDist', 'camAngle', 'camElevation', 'rotSpeed', 'fov']);
    expect($('[data-fold="agentRules:open:dof"] button')?.getAttribute('aria-expanded')).toBe('false');
    expect($('[data-fold="agentRules:open:dof"]')?.textContent).toMatch(/focus 1 · blur 0\.2/);
    // Around a shape: folded, "none" until one is picked.
    expect($('[data-fold="agentRules:open:shape"] button')?.getAttribute('aria-expanded')).toBe('false');
    expect($('[data-fold="agentRules:open:shape"]')?.textContent).toMatch(/Around a shape.*none/);
    const two =$$('[data-agent-space] button').find(b => b.textContent === '2D') ?? null;
    click(two);
    const after = useNodeGraphStore.getState().nodes.find(n => n.id === group.id)!;
    expect(after.params.space).toBe('2d');
    expect(useNodeGraphStore.getState().nodes.find(n => n.type === 'agentEmit')!.params.shape).toBe('disc');
  });

  it('Recipe: the rule set as text; Apply writes it into the group (one step)', () => {
    vi.useFakeTimers();
    useBuilderWindows.setState({ gridRules: null, agentRules: null, recipe: null });
    newAgentRules(); // the rules starter (the Builders entry now opens the Agent Builder's start page)
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
