/**
 * Start over: empties the whole Play record as one undo step, restored by
 * undo; the Studio graph is untouched; a playing tape or take replay is
 * stopped first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { isPlayRecordEmpty, type PlayLayer, type PlayRecord } from '../../types/play';
import type { TextLayer } from '../../types/playLayers';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore, undoManager } from '../../store/useNodeGraphStore';
import { emptyPlayRecord } from '../../types/play';
import { usePlayUi } from '../../components/play/playUi';
import { tape, useTape } from '../../lib/tape';
import { useTakes } from '../../lib/takes';
import { startOverPlay } from '../startOver';

const node = (id: string, type: string, inputs: GraphNode['inputs'], outputs: GraphNode['outputs'], params: Record<string, unknown> = {}): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs, params });
const graph = (): GraphNode[] => [node('uv', 'uv', {}, { uv: { type: 'vec2', label: 'UV' } })];
const textLayer = (id: string, label: string): TextLayer =>
  ({ id, label, kind: 'text', visible: true, toShader: false, text: 'Hello', x: 0.5, y: 0.5, size: 24 } as unknown as TextLayer);
const filledPlay = (): PlayRecord => ({ ...emptyPlayRecord(), layers: [textLayer('t1', 'Text 1') as unknown as PlayLayer], controls: [], signals: [{ id: 's1', name: 'Signal' }] });

const st = () => useNodeGraphStore.getState();

describe('Start over', () => {
  beforeEach(() => {
    undoManager.clear();
    useNodeGraphStore.setState({ nodes: graph(), play: filledPlay(), activeGroupPath: [], activeGroupId: null, scratch: null });
    usePlayUi.setState({ selected: 't1', entered: '' } as never);
    tape.resetForTests();
  });
  afterEach(() => { tape.resetForTests(); useTakes.setState({ phase: 'idle' } as never); });

  it('empties the record (everything isPlayRecordEmpty checks) and leaves the graph alone', () => {
    const nodesBefore = st().nodes;
    startOverPlay();
    expect(isPlayRecordEmpty(st().play)).toBe(true);
    expect(st().nodes).toBe(nodesBefore);
  });

  it('is one undo step, and undo restores the record exactly', () => {
    const before = st().play;
    startOverPlay();
    expect(undoManager.done()).toHaveLength(1);
    expect(undoManager.done()[0].label).toBe('Started over');
    st().undo();
    expect(st().play).toEqual(before);
  });

  it('clears the split view’s own selection', () => {
    startOverPlay();
    expect(usePlayUi.getState().selected).toBe('');
  });

  it('stops a running tape first', () => {
    useTape.setState({ phase: 'playing' });
    const stop = vi.spyOn(tape, 'stop');
    startOverPlay();
    expect(stop).toHaveBeenCalled();
    expect(useTape.getState().phase).toBe('stopped');
  });

  it('leaves a stopped tape alone', () => {
    const stop = vi.spyOn(tape, 'stop');
    startOverPlay();
    expect(stop).not.toHaveBeenCalled();
  });

  it('ends a take replay first', () => {
    useTakes.setState({ phase: 'replay', replayId: 'x', replayPlaying: true } as never);
    const endReplay = vi.spyOn(useTakes.getState(), 'endReplay');
    startOverPlay();
    expect(endReplay).toHaveBeenCalled();
  });
});
