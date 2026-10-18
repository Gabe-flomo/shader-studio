/**
 * @vitest-environment jsdom
 *
 * Agent Builder fixes (docs/plan-2026-10-10.md, wave 1 item 2): the How far ahead slider drags
 * smoothly, the focus demos' walkers keep to the picture, Surprise me, the start page's "Clear the
 * graph first?", Edit this one / Start over / Add another, and Advanced rules edited in the builder
 * (never the old rules editor).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { useNodeGraphStore, undoManager } from '../../../store/useNodeGraphStore';
import { useBuilderWindows } from '../../../builders/windows';
import { applyRulesToGroup, groupRules } from '../../../agentRules/apply';
import { rulesTemplate } from '../../../agentRules/templates';
import { kindOf, type WalkerKind } from '../../../agentRules/spec';
import { AgentBuilder } from '../AgentBuilder';
import { fineUnit } from '../../ui/rulerMath';
import { keepIn, makeDemo } from '../../../agentBuilder/demos';
import type { DemoSpec } from '../../../agentBuilder/legend';
import { surpriseForKindFromSeed } from '../../../agentBuilder/surprise';
import { agentSetupIds, builderGroups } from '../../../agentBuilder/actions';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect; };
(Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};

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
const groups = () => useNodeGraphStore.getState().nodes.filter(n => n.type === 'agentsGroup');
const undo = () => act(() => { useNodeGraphStore.getState().undo(); });

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  undoManager.clear('test');
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

/** The builder as the host draws it: on the store's window, following onOpenGroup. */
function Host() {
  const w = useBuilderWindows(s => s.agentBuilder);
  return w ? <AgentBuilder groupId={w.groupId} onClose={() => useBuilderWindows.setState({ agentBuilder: null })} onOpenGroup={id => useBuilderWindows.setState({ agentBuilder: { groupId: id } })} /> : null;
}
const openStart = () => { useBuilderWindows.setState({ agentBuilder: { groupId: null } }); mount(<Host />); };

/** A drag on a ruler: pointer down, `n` moves of `dx` px each, up. Returns the value after each move. */
function drag(track: Element, dx: number, n: number): number[] {
  const pe = (type: string, x: number) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: 10, pointerId: 1, button: 0, buttons: 1 });
  const out: number[] = [];
  act(() => { track.dispatchEvent(pe('pointerdown', 400)); });
  for (let i = 1; i <= n; i++) {
    act(() => { track.dispatchEvent(pe('pointermove', 400 + dx * i)); });
    out.push(Number($('[data-setting="distance"] [data-ruler-track]')!.getAttribute('aria-valuenow')));
  }
  act(() => { track.dispatchEvent(pe('pointerup', 400 + dx * n)); });
  return out;
}

describe('How far ahead', () => {
  it('a small range gets a finer ruler: 0–0.12 is 480 px of drag, not 48', () => {
    expect(fineUnit(0, 0.12)).toBe(0.01);
    expect(fineUnit(0.005, 0.25)).toBe(0.02);
    expect(fineUnit(0, 2)).toBeUndefined();
  });

  it('drags smoothly outward: the value climbs a step at a time and the feelers never snap back', () => {
    openStart();
    click($('[data-start-kind="trail"]'));
    const track = $('[data-setting="distance"] [data-ruler-track]')!;
    expect(track.getAttribute('aria-valuenow')).toBe('0.035');
    const lengths: number[] = [];
    const values: number[] = [];
    for (let i = 0; i < 30; i++) {
      values.push(...drag(track, -4, 1));
      const f = $('[data-feeler="centre"]')!;
      lengths.push(Math.hypot(Number(f.getAttribute('x2')) - Number(f.getAttribute('x1')), Number(f.getAttribute('y2')) - Number(f.getAttribute('y1'))));
    }
    // 4 px a move on a 0.01-a-40-px ruler: 0.001 a move, never a jump, never back.
    values.forEach((v, i) => expect(v).toBeCloseTo(0.036 + i * 0.001, 6));
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThanOrEqual(lengths[i - 1] - 1e-6);
    // The inspector kept the same slider (no remount).
    expect($('[data-setting="distance"] [data-ruler-track]')).toBe(track);
  });

  it('typing past the max widens the range, and it stays wide when the card comes back', () => {
    openStart();
    click($('[data-start-kind="trail"]'));
    const input = $('[data-setting="distance"] input') as HTMLInputElement;
    act(() => { input.focus(); });
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, '0.3');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    act(() => { input.blur(); });
    expect($('[data-setting="distance"] [data-ruler-track]')!.getAttribute('aria-valuemax')).toBe('0.3');
    click($('[data-studio-section="turning"]'));
    click($('[data-studio-section="senses"]'));
    expect($('[data-setting="distance"] [data-ruler-track]')!.getAttribute('aria-valuemax')).toBe('0.3');
  });
});

describe('the focus demos keep their walkers in the picture', () => {
  const BOX = { x0: -1.6, y0: -1, x1: 1.6, y1: 1 };
  it('keepIn wraps, bounces (heading reflected) or slides', () => {
    expect(keepIn({ x: 1.7, y: 0 }, 0, 'wrap').p.x).toBeCloseTo(-1.5);
    const b = keepIn({ x: 1.7, y: 0 }, 0, 'bounce');
    expect(b.p.x).toBe(1.6);
    expect(Math.cos(b.h)).toBeCloseTo(-1);
    expect(keepIn({ x: 0, y: -1.2 }, -1, 'slide')).toEqual({ p: { x: 0, y: -1 }, h: -1 });
  });

  const specs: DemoSpec[] = [
    { kind: 'senses', angle: 22.5, turn: 45, away: true },
    { kind: 'senses', angle: 80, turn: 2, away: false },
    { kind: 'goal', degrees: 0.2 },
    { kind: 'wander', degrees: 45 },
    { kind: 'orbit', degrees: 0.1, cw: true },
  ];
  for (const edges of ['wrap', 'bounce', 'slide'] as const) {
    it(`every walker stays inside the panel (${edges})`, () => {
      for (const spec of specs) {
        const demo = makeDemo({ ...spec, edges } as DemoSpec);
        for (let t = 0; t < demo.period; t += 1 / 30) {
          const fr = demo.frame(t);
          // The walkers: the white dots and arrows (feelers and goals may reach past the edge; the walker never does).
          const pts = [...fr.dots.filter(d => d.colour === '#ffffff'), ...fr.arrows.filter(a => a.colour === '#ffffff').map(a => a.from)];
          expect(pts.length).toBeGreaterThan(0);
          for (const p of pts) {
            expect(p.x, `${spec.kind} ${edges} x at ${t.toFixed(2)}`).toBeGreaterThanOrEqual(Math.min(BOX.x0, demo.bounds.x0) - 1e-6);
            expect(p.x).toBeLessThanOrEqual(Math.max(BOX.x1, demo.bounds.x1) + 1e-6);
            expect(p.y).toBeGreaterThanOrEqual(Math.min(BOX.y0, demo.bounds.y0) - 1e-6);
            expect(p.y).toBeLessThanOrEqual(Math.max(BOX.y1, demo.bounds.y1) + 1e-6);
          }
        }
      }
    });
  }
});

describe('Surprise me', () => {
  it('keeps the kind, is the same for the same seed, and rescales for 3D', () => {
    for (const kind of ['trail', 'ants', 'particles', 'flock', 'crowd', 'swarm'] as WalkerKind[]) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const s = surpriseForKindFromSeed(seed, kind);
        expect(kindOf(s.set), `${kind} ${seed}`).toBe(kind);
        expect(s.set.species.length).toBeGreaterThan(0);
        expect(surpriseForKindFromSeed(seed, kind)).toEqual(s);
      }
    }
    // Particles get no trail added (their picture is Draw agents).
    const p = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => surpriseForKindFromSeed(seed, 'particles').set);
    expect(p.every(set => set.species.every(sp => sp.rules.every(r => r.do.every(a => a.kind !== 'trail'))))).toBe(true);
    // A trail follower in 3D moves at the 3D scale (a 2D speed is about 0.2).
    const d3 = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => surpriseForKindFromSeed(seed, 'trail', { d3: true }).set);
    expect(d3.every(set => set.species.every(sp => sp.speed >= 0.5))).toBe(true);
  });

  it('in the builder: a random setup of the same kind, one undo step; Reroll and the seed field use it too', () => {
    openStart();
    click($('[data-start-kind="flock"]'));
    const g = groups()[0];
    const before = groupRules(g);
    expect($('[data-surprise-bar]')).toBeTruthy();
    click($('[data-surprise-me]'));
    const after = groupRules(groups()[0]);
    expect(after).not.toEqual(before);
    expect(kindOf(after)).toBe('flock');
    expect($('[data-studio-kind]')?.textContent).toBe('Flock (boids) · 2D');
    expect(($('[data-surprise-seed]') as HTMLInputElement).value).not.toBe('');
    click($('[data-surprise-top]'));
    expect(kindOf(groupRules(groups()[0]))).toBe('flock');
    undo();
    expect(groupRules(groups()[0])).toEqual(after);
    undo();
    expect(groupRules(groups()[0])).toEqual(before);
  });
});

/** A small graph that isn't agents: a UV into the Output. */
function plainGraph(): GraphNode[] {
  const out: GraphNode = { id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color', connection: { nodeId: 'uv', outputKey: 'uv' } } } as GraphNode['inputs'], outputs: {}, params: {} };
  const uv: GraphNode = { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } } as GraphNode['outputs'], params: {} };
  return [uv, out];
}

describe('the start page: clear the current graph first?', () => {
  it('keep is the default on a graph no builder made (the Scene builder rule; only the untouched starter clears); Keep my graph keeps it; nothing to clear, no question', () => {
    openStart();
    expect($('[data-start-clear]')).toBeNull();
    for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); }
    useNodeGraphStore.setState({ nodes: plainGraph() });
    openStart();
    expect($('[data-start-clear]')?.getAttribute('data-start-clear')).toBe('keep');
    expect($('[data-start-clear]')?.textContent).toContain('Your graph has 1 node');
    click($('[aria-label="Clear the current graph first?"] button:first-child'));
    expect($('[data-start-clear]')?.getAttribute('data-start-clear')).toBe('clear');
    click($('[aria-label="Clear the current graph first?"] button:last-child'));
    expect($('[data-start-clear]')?.getAttribute('data-start-clear')).toBe('keep');
    click($('[data-start-kind="trail"]'));
    expect(useNodeGraphStore.getState().nodes.some(n => n.id === 'uv')).toBe(true);
  });

  it('Clear: the graph is cleared (its own undo step) before the group is added; undo steps back through both; Back restores it all', () => {
    useNodeGraphStore.setState({ nodes: plainGraph() });
    openStart();
    click($('[aria-label="Clear the current graph first?"] button:first-child'));
    expect($('[data-start-clear]')?.getAttribute('data-start-clear')).toBe('clear');
    expect($('[data-start-clear-note]')).toBeTruthy();
    click($('[data-start-kind="trail"]'));
    const nodes = useNodeGraphStore.getState().nodes;
    expect(nodes.some(n => n.id === 'uv')).toBe(false);
    expect(nodes.filter(n => n.type === 'output').map(n => n.id)).toEqual(['out']);
    expect(groups().length).toBe(1);
    undo(); // the group
    expect(groups().length).toBe(0);
    expect(useNodeGraphStore.getState().nodes.map(n => n.id)).toEqual(['out']);
    undo(); // the clear
    expect(useNodeGraphStore.getState().nodes.map(n => n.id)).toEqual(['uv', 'out']);
  });

  it('Back after a cleared start puts the whole graph back', () => {
    useNodeGraphStore.setState({ nodes: plainGraph() });
    openStart();
    click($('[aria-label="Clear the current graph first?"] button:first-child'));
    click($('[data-start-kind="particles"]'));
    click($('[data-studio-back]'));
    expect(useNodeGraphStore.getState().nodes.map(n => n.id)).toEqual(['uv', 'out']);
    expect($('[data-agent-start]')).toBeTruthy();
  });
});

describe('a builder group already in the graph: Edit this one / Start over / Add another', () => {
  /** A trail-followers setup made by the builder itself (the real setup round the group). */
  function madeSetup(kind = 'trail') {
    openStart();
    click($(`[data-start-kind="${kind}"]`));
    click($('[data-studio-primary]')); // Add to graph: keep it, close
    for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); }
    return groups()[0].id;
  }

  it('asks instead of adding; Edit this one opens it', () => {
    const id = madeSetup();
    const count = useNodeGraphStore.getState().nodes.length;
    openStart();
    expect($('[data-agent-existing]')).toBeTruthy();
    expect($('[data-agent-start]')).toBeNull();
    expect($('[data-existing-group]')?.getAttribute('data-existing-group')).toBe(id);
    click($('[data-existing-edit]'));
    expect(useBuilderWindows.getState().agentBuilder).toEqual({ groupId: id });
    expect($('[data-studio-primary]')?.textContent).toBe('Done');
    expect(useNodeGraphStore.getState().nodes.length).toBe(count);
  });

  it('Add another: the start page, and a second group beside the first', () => {
    madeSetup();
    openStart();
    click($('[data-existing-add]'));
    expect($('[data-agent-start]')).toBeTruthy();
    click($('[data-start-kind="flock"]'));
    expect(groups().length).toBe(2);
  });

  it('Start over: the group and its setup go (one undo step), then the start page', () => {
    const id = madeSetup();
    const before = useNodeGraphStore.getState().nodes;
    const setup = agentSetupIds(before, id);
    expect([...setup].map(x => before.find(n => n.id === x)!.type).sort()).toEqual(expect.arrayContaining(['agentsGroup', 'agentEmit', 'agentDeposit', 'trailField']));
    expect([...setup].some(x => before.find(n => n.id === x)?.type === 'output')).toBe(false);
    openStart();
    click($('[data-existing-over]'));
    expect(groups().length).toBe(0);
    expect(useNodeGraphStore.getState().nodes.filter(n => setup.has(n.id))).toEqual([]);
    expect($('[data-agent-start]')).toBeTruthy();
    expect($('[data-start-note]')?.textContent).toContain('Started over');
    undo();
    expect(useNodeGraphStore.getState().nodes).toEqual(before);
  });

  it('with several groups, pick which one to edit', () => {
    const a = applyRulesToGroup({ id: 'g1', type: 'agentsGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { label: 'Veins' } } as GraphNode, rulesTemplate('slime')!.set());
    const b = applyRulesToGroup({ id: 'g2', type: 'agentsGroup', position: { x: 0, y: 400 }, inputs: {}, outputs: {}, params: { label: 'Birds' } } as GraphNode, rulesTemplate('boids')!.set());
    useNodeGraphStore.setState({ nodes: [a, b] });
    expect(builderGroups([a, b]).map(g => g.label)).toEqual(['Veins', 'Birds']);
    openStart();
    expect($$('[data-existing-group]').map(x => x.getAttribute('data-existing-group'))).toEqual(['g1', 'g2']);
    click($('[data-existing-group="g2"]'));
    expect($('[data-existing-edit]')?.textContent).toBe('Edit Birds');
    click($('[data-existing-edit]'));
    expect(useBuilderWindows.getState().agentBuilder).toEqual({ groupId: 'g2' });
    expect($('[data-studio-kind]')?.textContent).toBe('Flock (boids) · 2D');
  });
});

describe('Advanced rules stay in the builder', () => {
  function oldGroup() {
    const set = rulesTemplate('slime')!.set();
    set.species[0].rules.push({ when: [{ kind: 'age', cmp: '>', seconds: 5 }], do: [{ kind: 'die' }] });
    const g = applyRulesToGroup({ id: 'g1', type: 'agentsGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} } as GraphNode, set);
    useNodeGraphStore.setState({ nodes: [g] });
    useBuilderWindows.setState({ agentBuilder: { groupId: 'g1' } });
    mount(<Host />);
  }

  it('the rules the cards can\'t show are cards here, edited in place (one undo step a burst)', () => {
    vi.useFakeTimers();
    oldGroup();
    click($('[data-studio-section="advanced"]'));
    expect($('[data-advanced-rules]')?.getAttribute('data-advanced-rules')).toBe('advanced');
    expect($$('[data-advanced-rule]').map(x => x.getAttribute('data-advanced-rule'))).toEqual(['1']);
    expect($('[data-advanced-text]')?.textContent).toBe('When age > 5 s → die');
    // Switch it off, here.
    click($('[data-rule-switch="1"] [role="switch"], [data-rule-switch="1"] button, [data-rule-switch="1"] input'));
    act(() => { vi.advanceTimersByTime(300); });
    expect(groupRules(groups()[0]).species[0].rules[1].off).toBe(true);
    // Add a rule: it shows every rule.
    click($('[data-add-rule]'));
    act(() => { vi.advanceTimersByTime(300); });
    expect($('[data-advanced-rules]')?.getAttribute('data-advanced-rules')).toBe('all');
    expect(groupRules(groups()[0]).species[0].rules.length).toBe(3);
    // Take it away again.
    click($('[data-rule-remove="2"]'));
    act(() => { vi.advanceTimersByTime(300); });
    expect(groupRules(groups()[0]).species[0].rules.length).toBe(2);
    expect(useBuilderWindows.getState().agentRules).toBeNull();
  });

  it('the top bar\'s {} shows every rule as lines in the builder; nothing opens the old rules editor', () => {
    oldGroup();
    expect($('[data-open-rules-editor]')).toBeNull();
    click($('[data-open-rules]'));
    expect($('[data-inspector]')?.getAttribute('data-inspector')).toBe('advanced');
    expect($('[data-advanced-rules]')?.getAttribute('data-advanced-rules')).toBe('all');
    expect($$('[data-advanced-rule]').length).toBe(2);
    expect(useBuilderWindows.getState().agentRules).toBeNull();
    expect(useBuilderWindows.getState().agentBuilder).toEqual({ groupId: 'g1' });
  });
});
