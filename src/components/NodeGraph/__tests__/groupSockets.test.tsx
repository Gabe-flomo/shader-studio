// @vitest-environment jsdom
/**
 * One look for group sockets (docs/groups.md, "Group sockets"): every group card
 * (Group, Scene Group, March Loop, Agents) and the inner inputs cards (March
 * Loop's Group Inputs, Agents' Agent Inputs) draw built-in sockets with a lock
 * and added ones with their type and ×, rename an added one by double-clicking
 * its name, and offer the same "+ Add an input" button and form.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { NodeComponent } from '../NodeComponent';
import { AddGroupPort, GroupPortName } from '../GroupPorts';
import type { GraphNode, SubgraphData } from '../../../types/nodeGraph';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
if (!('ResizeObserver' in globalThis)) {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

let root: Root | null = null;
let host: HTMLElement | null = null;
const st = () => useNodeGraphStore.getState();
const noop = () => {};

function show(node: GraphNode, activeGroupNode: GraphNode | null = null) {
  act(() => { root!.render(<NodeComponent node={node} onStartConnection={noop} onEndConnection={noop} activeGroupNode={activeGroupNode} />); });
}
const top = (id: string) => st().nodes.find(x => x.id === id)!;
const inner = (groupId: string, type: string) => (top(groupId).params.subgraph as SubgraphData).nodes.find(x => x.type === type)!;
const origins = () => [...host!.querySelectorAll('[data-port-origin]')].map(e => `${e.getAttribute('data-port-origin')}:${e.textContent}`);
const buttonText = (dir: 'in' | 'out') => host!.querySelector(`[data-add-port="${dir}"] button`)?.textContent;
function setInput(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setValue.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
  st().replaceGraph([{ id: 'out', type: 'output', position: { x: 900, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} }]);
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

describe('GroupPortName', () => {
  it('a built-in socket shows a lock and nothing to rename or remove', () => {
    const onRename = vi.fn(); const onRemove = vi.fn();
    act(() => { root!.render(<GroupPortName label="Ray Dir" origin="built-in" socketSide="left" onRename={onRename} onRemove={onRemove} />); });
    expect(host!.querySelector('[aria-label="Built in"]')).toBeTruthy();
    expect(host!.querySelector('[data-port-remove]')).toBeNull();
    act(() => { host!.querySelector('[data-port-origin]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(host!.querySelector('input')).toBeNull();
  });

  it('an added socket shows its type, renames on double-click and × removes it', () => {
    const onRename = vi.fn(); const onRemove = vi.fn();
    act(() => { root!.render(<GroupPortName label="Strength" type="float" origin="added" socketSide="right" onRename={onRename} onRemove={onRemove} />); });
    expect(host!.textContent).toContain('number');
    expect(host!.querySelector('[aria-label="Built in"]')).toBeNull();
    act(() => { host!.querySelector('[data-port-origin]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    const input = host!.querySelector('input[aria-label="Socket name"]') as HTMLInputElement;
    setInput(input, 'Amount');
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); input.blur(); });
    act(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(onRename).toHaveBeenCalledWith('Amount');
    act(() => { (host!.querySelector('[data-port-remove]') as HTMLButtonElement).click(); });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('AddGroupPort', () => {
  it('says "Add an input" / "Add an output" and adds a named, typed port', () => {
    const onAdd = vi.fn();
    act(() => { root!.render(<AddGroupPort dir="out" types={['float', 'vec3']} onAdd={onAdd} />); });
    expect(buttonText('out')).toBe('Add an output');
    act(() => { (host!.querySelector('[data-add-port] button') as HTMLButtonElement).click(); });
    setInput(host!.querySelector('input') as HTMLInputElement, 'Mask');
    act(() => { [...host!.querySelectorAll('button')].find(b => b.textContent === 'Colour')!.click(); });
    act(() => { [...host!.querySelectorAll('button')].find(b => b.textContent === 'Add')!.click(); });
    expect(onAdd).toHaveBeenCalledWith('Mask', 'vec3');
    act(() => { root!.render(<AddGroupPort dir="in" types={['float']} onAdd={onAdd} />); });
    expect(buttonText('in')).toBe('Add an input');
  });
});

describe('every group card draws its sockets the same way', () => {
  it('March Loop: definition sockets are built in, an input added from outside is added', () => {
    st().addNode('marchLoopGroup', { x: 0, y: 0 });
    const loop = st().nodes.find(x => x.type === 'marchLoopGroup')!;
    st().addMarchLoopInput(loop.id, 'strength', 'float', 'Strength');
    show(top(loop.id));
    const o = origins();
    expect(o).toContain('built-in:Ray Origin');
    expect(o).toContain('built-in:Color');
    expect(o).toContain('added:Strengthnumber');
    expect(host!.querySelectorAll('[data-port-remove]')).toHaveLength(1);
  });

  it('Scene Group: its Scene output is built in', () => {
    st().addNode('sceneGroup', { x: 0, y: 0 });
    show(st().nodes.find(x => x.type === 'sceneGroup')!);
    expect(origins()).toContain('built-in:Scene');
  });

  it('Group: its own ports are added, and × removes one', () => {
    st().addNode('uv', { x: 0, y: 0 });
    const uv = st().nodes.find(x => x.type === 'uv')!;
    st().groupNodes([uv.id]);
    const g = st().nodes.find(x => x.type === 'group')!;
    st().addGroupOutput(g.id, 'float', 'Mask');
    show(top(g.id));
    expect(origins()).toContain('added:Masknumber');
    const before = (top(g.id).params.subgraph as SubgraphData).outputPorts.length;
    const masks = [...host!.querySelectorAll('[data-group-port^="out:"]')].find(r => r.textContent?.includes('Mask'))!;
    act(() => { (masks.querySelector('[data-port-remove]') as HTMLButtonElement).click(); });
    expect((top(g.id).params.subgraph as SubgraphData).outputPorts.length).toBe(before - 1);
  });

  it('Agents: Emit is built in, the Trail input it starts with is added', () => {
    st().addNode('agentsGroup', { x: 0, y: 0 }, {});
    show(st().nodes.find(x => x.type === 'agentsGroup')!);
    const o = origins();
    expect(o.some(s => s.startsWith('built-in:'))).toBe(true);
    expect(o.some(s => s.startsWith('added:Trail'))).toBe(true);
  });
});

describe('the inner inputs cards share one Add button and one look', () => {
  it.each([['marchLoopGroup', 'marchLoopInputs'], ['agentsGroup', 'agentInputs']])('%s → %s', (groupType, cardType) => {
    st().addNode(groupType, { x: 0, y: 0 }, groupType === 'agentsGroup' ? {} : undefined);
    const g = st().nodes.find(x => x.type === groupType)!;
    act(() => { st().enterGroup(g.id); });
    show(inner(g.id, cardType), top(g.id));
    expect(origins().some(s => s.startsWith('built-in:'))).toBe(true);
    expect(buttonText('in')).toBe('Add an input');
    act(() => { (host!.querySelector('[data-add-port="in"] button') as HTMLButtonElement).click(); });
    setInput(host!.querySelector('[data-add-port="in"] input') as HTMLInputElement, 'My speed');
    act(() => { [...host!.querySelectorAll<HTMLButtonElement>('[data-add-port="in"] button')].find(b => b.textContent === 'Add')!.click(); });
    // The key is a GLSL-safe name; the label keeps what was typed.
    expect(top(g.id).inputs.My_speed?.label).toBe('My speed');
    show(inner(g.id, cardType), top(g.id));
    // Agents start on Image (a Trail), the loop on Number.
    expect(origins()).toContain(`added:My speed${groupType === 'agentsGroup' ? 'image' : 'number'}`);
  });
});
