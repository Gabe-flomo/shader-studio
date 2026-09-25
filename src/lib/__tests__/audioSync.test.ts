/**
 * Songs stop with the graph that owns them: a deleted Audio Input node or
 * audio layer releases its song, and loading a different graph releases all.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const ls: Record<string, string> = {};
  const hidden = (k: string, v: unknown) => Object.defineProperty(ls, k, { value: v, enumerable: false });
  hidden('getItem', (k: string) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null));
  hidden('setItem', (k: string, v: string) => { ls[k] = String(v); });
  hidden('removeItem', (k: string) => { delete ls[k]; });
  hidden('clear', () => { for (const k of Object.keys(ls)) delete ls[k]; });
  hidden('key', (i: number) => Object.keys(ls)[i] ?? null);
  Object.defineProperty(ls, 'length', { get: () => Object.keys(ls).length, enumerable: false });
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});

const loaded = new Set<string>();
vi.mock('../audioEngine', () => ({
  audioEngine: {
    loadedNodeIds: () => [...loaded],
    removeAudio: (k: string) => { loaded.delete(k); },
  },
}));
vi.mock('../layerAudio', () => ({ layerAudio: { remove: (id: string) => { loaded.delete(`layer:${id}`); } } }));

import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { audioOwners, startAudioSync } from '../audioSync';
import { defaultLayer, emptyPlayRecord } from '../../types/play';
import type { GraphNode } from '../../types/nodeGraph';

const audioNode = (id: string): GraphNode => ({ id, type: 'audioInput', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} });

describe('audio follows the graph', () => {
  it('finds the owners: Audio Input nodes (inside groups too) and audio layers', () => {
    const group: GraphNode = { id: 'g', type: 'group', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { subgraph: { nodes: [audioNode('inner')], edges: [] } } };
    const play = { ...emptyPlayRecord(), layers: [defaultLayer('audio', 'bars', 'Bars'), defaultLayer('text', 't', 'T')] };
    expect([...audioOwners([audioNode('a'), group], play)].sort()).toEqual(['a', 'inner', 'layer:bars']);
  });

  it('releases a deleted owner’s song, and every song when another graph loads', () => {
    useNodeGraphStore.setState({ nodes: [audioNode('a')], play: { ...emptyPlayRecord(), layers: [defaultLayer('audio', 'bars', 'Bars')] } });
    ['a', 'layer:bars'].forEach(k => loaded.add(k));
    const stop = startAudioSync();
    useNodeGraphStore.setState(s => ({ play: { ...s.play, layers: [] } }));
    expect([...loaded]).toEqual(['a']);
    // A different graph that happens to reuse the id "a": the old song still goes.
    useNodeGraphStore.setState(s => ({ nodes: [audioNode('a')], graphEpoch: s.graphEpoch + 1 }));
    expect([...loaded]).toEqual([]);
    stop();
  });
});
