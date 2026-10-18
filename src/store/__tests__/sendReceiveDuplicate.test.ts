/**
 * Duplicating Sends and Receives (docs/send-receive.md): a Send and its Receive duplicated together give a
 * copied Receive that reads the copied Send; a Receive duplicated alone keeps reading the original.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';

const graph = (): GraphNode[] => [
  { id: 'out', type: 'output', position: { x: 900, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} },
  { id: 'snd', type: 'send', position: { x: 0, y: 0 }, inputs: { value: { type: 'float', label: 'Value' } }, outputs: { value: { type: 'float', label: 'Value' } }, params: { name: 'signal' } },
  { id: 'rcv', type: 'receive', position: { x: 300, y: 0 }, inputs: {}, outputs: { value: { type: 'float', label: 'Value' } }, params: { sendId: 'snd', name: 'signal' } },
];

const st = () => useNodeGraphStore.getState();
const added = (before: Set<string>) => st().nodes.filter(n => !before.has(n.id));

describe('duplicating a Send and a Receive', () => {
  beforeEach(() => {
    useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
    st().replaceGraph(graph());
  });

  it('together: the copied Receive reads the copied Send', () => {
    const before = new Set(st().nodes.map(n => n.id));
    st().duplicateNodes(['snd', 'rcv']);
    const copies = added(before);
    const send = copies.find(n => n.type === 'send')!;
    const recv = copies.find(n => n.type === 'receive')!;
    expect(recv.params.sendId).toBe(send.id);
    expect(st().nodes.find(n => n.id === 'rcv')!.params.sendId).toBe('snd');
  });

  it('a Receive alone keeps reading the original Send', () => {
    const before = new Set(st().nodes.map(n => n.id));
    st().duplicateNodes(['rcv']);
    expect(added(before)[0].params.sendId).toBe('snd');
  });
});
