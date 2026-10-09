// @vitest-environment jsdom
/**
 * The Agent Builder, drawn (docs/agent-builder.md): the shared shell's layout and folding (and its
 * drawers on a narrow window), the start page making a trail-follower setup, the cards reading an
 * old rule set, a slider writing the rule set and moving the diagram, presets with undo, and the
 * ways in (the Builders entry, the Do… bar, Edit rules on a group).
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
import { useBuilderWindows } from '../../../builders/windows';
import { openBuilder, runBuilderAction } from '../../../builders/open';
import { openAgentRulesEditor } from '../../../agentRules/storeActions';
import { applyRulesToGroup, groupRules } from '../../../agentRules/apply';
import { rulesTemplate } from '../../../agentRules/templates';
import { AgentBuilder } from '../AgentBuilder';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
// The viewport measures itself: give every element a size so the diagram is drawn.
Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect; };

const setWidth = (w: number) => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: w }); };

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
  setWidth(1440);
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

/** The builder on its start page, Trail followers picked: the group it made. */
function startTrail(onOpenGroup?: (id: string | null) => void) {
  mount(<AgentBuilder groupId={null} onClose={() => {}} onOpenGroup={onOpenGroup} />);
  click($('[data-start-kind="trail"]'));
  return group()!;
}

describe('the shared shell', () => {
  it('top bar, nav, live viewport, inspector and presets; panels fold from the top bar and stay folded', () => {
    startTrail();
    expect($('[data-studio-title]')?.textContent).toBe('Slime mold');
    expect($('[data-studio-kind]')?.textContent).toBe('Trail followers · 2D');
    expect($('[data-studio-space]')?.getAttribute('data-studio-space')).toBe('2d');
    expect($('[data-studio-primary]')?.textContent).toBe('Add to graph');
    expect($$('[data-studio-panel]').map(p => p.getAttribute('data-studio-panel'))).toEqual(['nav', 'inspector', 'presets']);
    expect($('[data-studio-viewport] [data-live-viewport]')).toBeTruthy();
    click($('[data-studio-toggle="nav"]'));
    click($('[data-studio-toggle="presets"]'));
    expect($$('[data-studio-panel]').map(p => p.getAttribute('data-studio-panel'))).toEqual(['inspector']);
    expect(localStorage.getItem('builder:agent-builder:studio:nav')).toBe('0');
    // Remembered: opening again keeps them folded.
    for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); }
    mount(<AgentBuilder groupId={group()!.id} onClose={() => {}} />);
    expect($$('[data-studio-panel]').map(p => p.getAttribute('data-studio-panel'))).toEqual(['inspector']);
    expect($('[data-studio-primary]')?.textContent).toBe('Done');
  });

  it('on a narrow window the side panels are drawers, closed until asked for', () => {
    setWidth(900);
    startTrail();
    expect($$('[data-studio-panel]').map(p => p.getAttribute('data-studio-panel'))).toEqual(['presets']);
    click($('[data-studio-toggle="inspector"]'));
    expect($('[data-studio-panel="inspector"]')?.hasAttribute('data-studio-drawer')).toBe(true);
    // Opening the other closes this one.
    click($('[data-studio-toggle="nav"]'));
    expect($$('[data-studio-drawer]').map(p => p.getAttribute('data-studio-panel'))).toEqual(['nav']);
  });
});

describe('the start page', () => {
  it('asks what you are making: five kinds with pictures (Crowds has its own), 2D / 3D; nothing is added yet', () => {
    mount(<AgentBuilder groupId={null} onClose={() => {}} />);
    expect($$('[data-start-kind]').map(b => b.getAttribute('data-start-kind'))).toEqual(['trail', 'particles', 'flock', 'crowd', 'orbit']);
    expect($$('[data-kind-picture]').length).toBe(5);
    expect($$('[data-start-old]').length).toBe(0);
    expect($('[aria-label="Start in 2D or 3D"]')).toBeTruthy();
    expect(useNodeGraphStore.getState().nodes).toEqual([]);
  });

  it('Trail followers makes the slime setup (one undo step) and opens its sections on Senses; Back takes it away', () => {
    const opened: Array<string | null> = [];
    const g = startTrail(id => opened.push(id));
    expect(g.params.ruleMode).toBe('rules');
    expect(groupRules(g)).toEqual(rulesTemplate('slime')!.set());
    const nodes = useNodeGraphStore.getState().nodes;
    expect(nodes.find(n => n.type === 'agentEmit')!.params).toMatchObject({ shape: 'disc', size: 0.15, heading: 'outward' });
    expect(nodes.find(n => n.type === 'trailField')!.params).toMatchObject({ halfLife: 0.05, resolution: '1024' });
    expect(nodes.find(n => n.type === 'agentDeposit')!.params.amount).toBe(4);
    expect(opened).toEqual([g.id]);
    expect($$('[data-studio-section]').map(b => b.getAttribute('data-studio-section'))).toEqual(['born', 'senses', 'turning', 'moving', 'trail']);
    expect($('[data-inspector]')?.getAttribute('data-inspector')).toBe('senses');
    expect($('[data-card="senses"]')?.getAttribute('data-card-on')).toBe('true');
    // Only the primary section is open: the others are one-line summaries in the nav.
    expect($$('[data-card]').map(c => c.getAttribute('data-card'))).toEqual(['senses']);
    expect($('[data-studio-section="turning"] [data-studio-summary]')?.textContent).toBe('45° · wobble 7°');
    click($('[data-studio-back]'));
    expect(group()).toBeUndefined();
    expect($('[data-agent-start]')).toBeTruthy();
    expect(opened).toEqual([g.id, null]);
  });

  it('3D makes the 3D slime setup', () => {
    mount(<AgentBuilder groupId={null} onClose={() => {}} />);
    click($$('[aria-label="Start in 2D or 3D"] button').find(b => b.textContent === '3D') ?? null);
    click($('[data-start-kind="trail"]'));
    expect(group()!.params.space).toBe('3d');
    expect($('[data-studio-kind]')?.textContent).toBe('Trail followers · 3D');
  });

  it('Particles makes the spark fountain\'s own setup (its Emit and Draw agents, one undo step) and opens on Forces', () => {
    mount(<AgentBuilder groupId={null} onClose={() => {}} />);
    click($('[data-start-kind="particles"]'));
    const g = group()!;
    expect(groupRules(g)).toEqual(rulesTemplate('particles')!.set());
    const nodes = useNodeGraphStore.getState().nodes;
    expect(nodes.find(n => n.type === 'agentEmit')!.params).toMatchObject({ mode: 'respawn', heading: 'up' });
    expect(nodes.find(n => n.type === 'drawAgents')!.inputs.agents.connection?.nodeId).toBe(g.id);
    expect(useBuilderWindows.getState().agentRules).toBeNull();
    expect($('[data-studio-kind]')?.textContent).toBe('Particles · 2D');
    expect($$('[data-studio-section]').map(b => b.getAttribute('data-studio-section'))).toEqual(['born', 'forces', 'moving', 'life', 'look']);
    expect($('[data-inspector]')?.getAttribute('data-inspector')).toBe('forces');
    expect($$('[data-card-slot]').map(c => c.getAttribute('data-card-slot'))).toEqual(['gravity#0', 'curl#0', 'drag#0', 'attract#0']);
    act(() => { useNodeGraphStore.getState().undo(); });
    expect(group()).toBeUndefined();
  });
});

describe('cards and the diagram', () => {
  it('a slider writes the rule set (live, one undo step) and the diagram follows it at once', () => {
    vi.useFakeTimers();
    const g = startTrail();
    expect($('[data-walker-diagram]')?.getAttribute('data-walker-diagram')).toBe('senses');
    expect($('[data-diagram="senses"]')?.getAttribute('data-angle')).toBe('22.5');
    const leftBefore = $('[data-feeler="left"]')!.getAttribute('x2');
    const track = $('[data-setting="angle"] [data-ruler-track]');
    act(() => { (track as HTMLElement).focus(); });
    expect($('[data-walker-diagram]')?.getAttribute('data-setting')).toBe('angle');
    key(track, 'End');
    expect($('[data-diagram="senses"]')?.getAttribute('data-angle')).toBe('90');
    expect(Number($('[data-feeler="left"]')!.getAttribute('x2'))).toBeLessThan(Number(leftBefore));
    expect($('[data-studio-section="senses"] [data-studio-summary]')?.textContent).toBe('0.035 ahead · 90°');
    // Applied a quarter of a second later.
    expect(groupRules(group()!).sensor.angle).toBe(22.5);
    act(() => { vi.advanceTimersByTime(300); });
    expect(groupRules(group()!).sensor.angle).toBe(90);
    // How far ahead: the feelers grow.
    const len = () => Number($('[data-feeler="centre"]')!.getAttribute('y1')) - Number($('[data-feeler="centre"]')!.getAttribute('y2'));
    const l0 = len();
    key($('[data-setting="distance"] [data-ruler-track]'), 'ArrowRight');
    key($('[data-setting="distance"] [data-ruler-track]'), 'ArrowRight');
    expect($('[data-diagram="senses"]')?.getAttribute('data-distance')).toBe('0.037');
    expect(len()).toBeGreaterThan(l0);
    act(() => { vi.advanceTimersByTime(300); });
    expect(groupRules(group()!).sensor.distance).toBeCloseTo(0.037);
    expect(g.id).toBe(group()!.id);
  });

  it('Turning, Moving and Trail draw their own diagrams; Senses off switches the turn off', () => {
    vi.useFakeTimers();
    startTrail();
    click($('[data-card-switch="senses"] button'));
    act(() => { vi.advanceTimersByTime(300); });
    const r = groupRules(group()!).species[0].rules;
    expect(r.find(x => x.do[0].kind === 'turn')?.off).toBe(true);
    click($('[data-studio-section="turning"]'));
    expect($('[data-diagram="turning"]')?.getAttribute('data-turn')).toBe('45');
    expect($('[data-new-heading]')).toBeNull(); // no turn toward a smell while Senses is off
    key($('[data-setting="wobble"] [data-ruler-track]'), 'End');
    expect($('[data-diagram="turning"]')?.getAttribute('data-wobble')).toBe('45');
    click($('[data-studio-section="moving"]'));
    expect($('[data-diagram="moving"]')?.getAttribute('data-speed')).toBe('0.22');
    act(() => { ($('[data-setting="edges"] button') as HTMLElement).focus(); });
    expect($('[data-diagram="edges"]')?.getAttribute('data-edges')).toBe('wrap');
    click($('[data-studio-section="trail"]'));
    expect($('[data-diagram="trail"]')?.getAttribute('data-half-life')).toBe('0.05');
    click($('[data-studio-section="born"]'));
    expect($('[data-diagram="born"]')?.getAttribute('data-born')).toBe('disc');
    expect($('[data-diagram="born"]')?.getAttribute('data-size')).toBe('0.15');
  });

  it('an old rule set opens in the builder: its rules map to cards, the rest is Advanced (opening the rules editor)', () => {
    const old = normalizeOld();
    const g = applyRulesToGroup({ id: 'g1', type: 'agentsGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { tier: '64k' } } as GraphNode, old);
    useNodeGraphStore.setState({ nodes: [g] });
    mount(<AgentBuilder groupId="g1" onClose={() => {}} />);
    expect($('[data-studio-section="senses"] [data-studio-summary]')?.textContent).toBe('0.05 ahead · 30°');
    expect($('[data-studio-section="moving"] [data-studio-summary]')?.textContent).toBe('0.3 · bounce');
    click($('[data-studio-section="advanced"]'));
    expect($$('[data-advanced-text]').map(x => x.textContent)).toEqual(['When age > 5 s → die']);
    click($('[data-open-rules-editor]'));
    expect(useBuilderWindows.getState()).toMatchObject({ agentRules: 'g1', agentBuilder: null });
  });
});

function normalizeOld() {
  return groupRules({ id: 'x', type: 'agentsGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { agentRules: {
    v: 1, channels: [], masks: [], edges: 'bounce', sensor: { distance: 0.05, angle: 30 },
    species: [{ name: 'W', speed: 0.3, states: [{ name: 'a', colour: [1, 1, 1] }], rules: [
      { when: [{ kind: 'always' }], do: [{ kind: 'turn', toward: 'trail', channel: 'own', degrees: 30 }, { kind: 'wander', degrees: 8 }, { kind: 'trail', channel: 'own', amount: 1 }] },
      { when: [{ kind: 'age', cmp: '>', seconds: 5 }], do: [{ kind: 'die' }] },
    ] }],
  } } } as unknown as GraphNode);
}

describe('presets', () => {
  it('a picture card applies its rule set as one undo step; undo takes it back', () => {
    startTrail();
    expect($$('[data-preset]').map(b => b.getAttribute('data-preset'))).toEqual(['slime', 'veins', 'cells', 'mesh', 'clumps', 'ants', 'predatorPrey', 'dla']);
    click($('[data-preset="veins"]'));
    expect(groupRules(group()!).species[0].rules[0].do[0]).toMatchObject({ kind: 'turn', degrees: 20 });
    expect($('[data-studio-section="turning"] [data-studio-summary]')?.textContent).toBe('20° · wobble 7°');
    click($('[data-preset="ants"]'));
    expect(groupRules(group()!).kind).toBe('ants');
    expect($('[data-studio-section="advanced"]')).toBeTruthy();
    act(() => { useNodeGraphStore.getState().undo(); });
    expect(groupRules(group()!).species[0].rules[0].do[0]).toMatchObject({ kind: 'turn', degrees: 20 });
    expect($('[data-studio-section="advanced"]')).toBeNull();
    act(() => { useNodeGraphStore.getState().undo(); });
    expect(groupRules(group()!).species[0].rules[0].do[0]).toMatchObject({ kind: 'turn', degrees: 45 });
  });
});

describe('the ways in', () => {
  it('the Builders entry and "new agent rules" open the start page; nothing is added', () => {
    openBuilder('agents');
    expect(useBuilderWindows.getState().agentBuilder).toEqual({ groupId: null });
    useBuilderWindows.setState({ agentBuilder: null });
    expect(runBuilderAction({ kind: 'new-agents' } as Parameters<typeof runBuilderAction>[0])).toBe(true);
    expect(useBuilderWindows.getState().agentBuilder).toEqual({ groupId: null });
    expect(useNodeGraphStore.getState().nodes).toEqual([]);
  });

  it('Edit rules on any rules group opens the builder (flocks too, since phase 2); Advanced opens the rules editor', () => {
    const trail = applyRulesToGroup({ id: 'g1', type: 'agentsGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} } as GraphNode, rulesTemplate('slime')!.set());
    const ants = applyRulesToGroup({ ...trail, id: 'g2' }, rulesTemplate('ants')!.set());
    const boids = applyRulesToGroup({ ...trail, id: 'g3' }, rulesTemplate('boids')!.set());
    useNodeGraphStore.setState({ nodes: [trail, ants, boids] });
    openAgentRulesEditor('g1');
    expect(useBuilderWindows.getState()).toMatchObject({ agentBuilder: { groupId: 'g1' }, agentRules: null });
    openAgentRulesEditor('g2');
    expect(useBuilderWindows.getState().agentBuilder).toEqual({ groupId: 'g2' });
    openAgentRulesEditor('g3');
    expect(useBuilderWindows.getState()).toMatchObject({ agentBuilder: { groupId: 'g3' }, agentRules: null });
    expect(runBuilderAction({ kind: 'open-agents', groupId: 'g1' } as Parameters<typeof runBuilderAction>[0])).toBe(true);
    expect(useBuilderWindows.getState().agentBuilder).toEqual({ groupId: 'g1' });
  });
});
