// @vitest-environment jsdom
/**
 * Agent Builder wave 3 in the window: dragging the diagrams writes what the sliders write, as one
 * undo step a drag; the Where picker's three ways in; Food in the Trail card; text's editor.
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
import { undoManager, useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { n } from '../../../store/graphBuilder';
import { useBuilderWindows } from '../../../builders/windows';
import { groupRules } from '../../../agentRules/apply';
import { setupOf } from '../../../agentBuilder/actions';
import { foodNow } from '../../../agentBuilder/whereActions';
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
const pointer = (el: Element | null, type: string, x: number, y: number) => { expect(el).toBeTruthy(); act(() => { el!.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })); }); };
const nodes = () => useNodeGraphStore.getState().nodes;
const group = () => nodes().find(x => x.type === 'agentsGroup')!;
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
/** Where a handle is drawn (its hit circle). */
const at = (id: string) => { const c = $(`[data-drag-handle="${id}"] circle`)!; return { x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')) }; };

/** A drag of a handle by (dx, dy) in `steps` moves, with pauses longer than an edit burst between them. */
function drag(id: string, dx: number, dy: number, steps = 4) {
  const h = $(`[data-drag-handle="${id}"]`);
  const p = at(id);
  pointer(h, 'pointerdown', p.x, p.y);
  for (let i = 1; i <= steps; i++) { pointer($(`[data-drag-handle="${id}"]`), 'pointermove', p.x + dx * i / steps, p.y + dy * i / steps); wait(1800); }
  pointer($(`[data-drag-handle="${id}"]`), 'pointerup', p.x + dx, p.y + dy);
  wait(400);
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
  undoManager.clear();
});

const onClose = vi.fn();
function start(kind: string) {
  mount(<AgentBuilder groupId={null} onClose={onClose} onOpenGroup={() => {}} />);
  click($('[data-start-kind="' + kind + '"]'));
}

describe('dragging the diagrams', () => {
  it('the feelers: out is How far ahead, sideways How wide; the slider follows; one undo step for the whole drag', () => {
    vi.useFakeTimers();
    start('trail');
    const s0 = groupRules(group()).sensor;
    const steps = undoManager.canUndo;
    expect($$('[data-drag-handle^="feeler-"]').length).toBe(3);
    drag('feeler-centre', 0, -40);
    const s1 = groupRules(group()).sensor;
    expect(s1.distance).toBeGreaterThan(s0.distance);
    expect(s1.angle).toBe(s0.angle);
    expect(undoManager.canUndo).toBe(steps + 1);
    expect(undoManager.top()?.label).toBe('Agent Builder: dragged How far ahead');
    // The slider shows the value the drag wrote.
    const row = $('[data-inspector] [data-setting="distance"]')!;
    expect(`${row.textContent} ${[...row.querySelectorAll('input')].map(i => i.value).join(' ')} ${[...row.querySelectorAll('[aria-valuenow]')].map(i => i.getAttribute('aria-valuenow')).join(' ')}`).toContain(String(s1.distance));
    drag('feeler-left', -60, 0);
    expect(groupRules(group()).sensor.angle).toBeGreaterThan(s0.angle);
    expect(undoManager.canUndo).toBe(steps + 2);
    act(() => { useNodeGraphStore.getState().undo(); });
    act(() => { useNodeGraphStore.getState().undo(); });
    expect(groupRules(group()).sensor).toEqual(s0);
  });

  it('turning: the new heading\'s end sets How sharply, the fan\'s edge the wobble', () => {
    vi.useFakeTimers();
    start('trail');
    click($('[data-studio-section="turning"]'));
    const turn0 = groupRules(group()).species[0].rules.flatMap(r => r.do).find(a => a.kind === 'turn' && a.toward === 'trail') as { degrees: number };
    const steps = undoManager.canUndo;
    drag('turn', -80, 40, 3);
    const turn1 = groupRules(group()).species[0].rules.flatMap(r => r.do).find(a => a.kind === 'turn' && a.toward === 'trail') as { degrees: number };
    expect(turn1.degrees).not.toBe(turn0.degrees);
    expect(undoManager.canUndo).toBe(steps + 1);
    drag('wobble-right', 60, 0, 2);
    expect(undoManager.canUndo).toBe(steps + 2);
  });

  it('Born: its middle moves the Emit, its edge sizes it; one undo step each', () => {
    vi.useFakeTimers();
    start('particles');
    click($('[data-studio-section="born"]'));
    const e0 = setupOf(nodes(), group().id).emit!.params;
    const steps = undoManager.canUndo;
    drag('born-move', 80, -40);
    const e1 = setupOf(nodes(), group().id).emit!.params;
    expect(Number(e1.x)).toBeGreaterThan(Number(e0.x ?? 0));
    expect(Number(e1.y)).toBeGreaterThan(Number(e0.y ?? 0));
    expect(undoManager.canUndo).toBe(steps + 1);
    if ($('[data-drag-handle="born-size"]')) {
      drag('born-size', 50, 0);
      expect(Number(setupOf(nodes(), group().id).emit!.params.size)).not.toBe(Number(e0.size));
      expect(undoManager.canUndo).toBe(steps + 2);
    }
  });

  it('forces: gravity\'s arrow tip turns and stretches it', () => {
    vi.useFakeTimers();
    start('particles');
    const tip = $$('[data-drag-handle]').find(h => /^(gravity|wind)#\d-tip$/.test(h.getAttribute('data-drag-handle') ?? ''));
    expect(tip).toBeTruthy();
    const id = tip!.getAttribute('data-drag-handle')!;
    const before = JSON.stringify(groupRules(group()).species[0].rules);
    drag(id, 60, 30, 2);
    expect(JSON.stringify(groupRules(group()).species[0].rules)).not.toBe(before);
  });

  it('flocks: the view ring\'s handle sets View radius', () => {
    vi.useFakeTimers();
    start('flock');
    click($('[data-studio-section="neighbours"]'));
    const r0 = groupRules(group()).neighbours?.radius;
    drag('view-ring', 40, 40, 2);
    expect(groupRules(group()).neighbours?.radius).toBeGreaterThan(r0 ?? 0);
  });
});

describe('wiring three ways, Food and text', () => {
  it('the picker asks the kind of source, then shows only that; a new group is made, wired, and opened (the builder closes, a toast brings it back)', () => {
    vi.useFakeTimers();
    onClose.mockClear();
    start('trail');
    // A circle in the graph to pick from (and no group to read).
    act(() => useNodeGraphStore.setState(st => ({ nodes: [...st.nodes, n('circleSDF', 'gCircle', -900, 0, { radius: 0.35 })] })));
    click($('[data-studio-section="moving"]'));
    click($('[data-where-open="walls"]'));
    // Walls can't read a texture: no picture or texture kinds.
    expect($$('[data-where-way]').map(x => x.getAttribute('data-where-way'))).toEqual(['graph', 'group', 'create']);
    // No group has an output walls can read: greyed, with a word why.
    const grp = $('[data-where-way="group"]') as HTMLButtonElement;
    expect(grp.disabled).toBe(true);
    expect(grp.querySelector('[data-where-way-why]')?.textContent).toBe('no group has one');
    expect(($('[data-where-way="graph"]') as HTMLButtonElement).disabled).toBe(false);
    // Choosing one locks it in: only its UI, and Change goes back to the kinds.
    click($('[data-where-way="graph"]'));
    expect($('[data-where-chosen="graph"]')).toBeTruthy();
    expect($$('[data-where-way]')).toEqual([]);
    expect($('[data-where-tile="gCircle:distance"]')).toBeTruthy();
    expect($('[data-where-make]')).toBeNull();
    click($('[data-where-back="walls"]'));
    expect($$('[data-where-way]').length).toBe(3);
    expect($('[data-where-tile]')).toBeNull();
    click($('[data-where-way="create"]'));
    expect($('[data-where-tile]')).toBeNull();
    expect($$('[data-where-make]').length).toBe(5);
    expect($('[data-where-create="shaderTexture"]')).toBeNull();
    click($('[data-where-create="group"]'));
    const pg = nodes().find(x => x.type === 'group')!;
    expect(group().inputs.obstacle.connection).toEqual({ nodeId: pg.id, outputKey: 'out0' });
    expect(onClose).toHaveBeenCalled();
    expect(useNodeGraphStore.getState().activeGroupPath).toEqual([pg.id]);
  });

  it('Food: drawn words feed the trail; How much and the channel appear; the words, size, weight and font are editable', () => {
    vi.useFakeTimers();
    start('trail');
    click($('[data-studio-section="trail"]'));
    click($('[data-where-open="food"]'));
    expect($$('[data-where-way]').map(x => x.getAttribute('data-where-way'))).toEqual(['graph', 'group', 'picture', 'texture', 'create']);
    click($('[data-where-way="picture"]'));
    expect($('[data-where-make]')).toBeNull();
    click($('[data-where-back="food"]'));
    click($('[data-where-way="create"]'));
    expect($('[data-where-create="shaderTexture"]')).toBeTruthy();
    click($('[data-where-make="text"]'));
    const draw = $('[data-where-draw="text"]');
    pointer(draw, 'pointerdown', 300, 250);
    pointer(draw, 'pointermove', 500, 330);
    pointer(draw, 'pointerup', 500, 330);
    const f = foodNow(nodes(), group().id)!;
    expect(f).toBeTruthy();
    const text = nodes().find(x => x.params.whereShape)!;
    expect((text.params.whereShape as { font: string }).font).toBe('stroke');
    expect($('[data-setting="foodAmount"]')).toBeTruthy();
    expect($('[data-setting="foodChannel"]')).toBeTruthy();
    expect($('[data-where-text-editor]')).toBeTruthy();
    expect($('[data-setting="textWeight"]')).toBeTruthy();
    // Blocky: the old font, a new outline.
    click($$('[data-where-text-editor] button').find(b => b.textContent === 'Blocky (5 × 7)') ?? null);
    expect((nodes().find(x => x.id === text.id)!.params.whereShape as { font: string }).font).toBe('blocky');
    expect($('[data-setting="textWeight"]')).toBeNull();
  });
});
