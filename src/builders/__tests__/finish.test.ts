import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { finishBuilder } from '../finish';
import { scene2dBuildIds } from '../finishScenes';
import { buildStandalone2D } from '../../sceneBuilder2d/build';
import { applyScene2D } from '../../sceneBuilder2d/apply';
import { templateScene } from '../../sceneBuilder2d/templates';
import type { GraphNode } from '../../types/nodeGraph';

const at = (id: string, type = 'uv') => ({ id, type, position: { x: 0, y: 0 }, params: {}, inputs: {}, outputs: {} }) as unknown as GraphNode;

describe("a builder's Done", () => {
  afterEach(() => { vi.useRealTimers(); useNodeGraphStore.setState({ _fitViewCallback: null }); });

  it('closes the builder, then frames the nodes it made', () => {
    vi.useFakeTimers();
    const fit = vi.fn();
    useNodeGraphStore.setState({ nodes: [at('a'), at('b'), at('c')], activeGroupPath: [], _fitViewCallback: fit });
    const close = vi.fn();
    finishBuilder(close, ['b', 'c', 'gone', null]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(fit).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(fit).toHaveBeenCalledWith(['b', 'c']);
  });

  it('with nothing made, just closes', () => {
    vi.useFakeTimers();
    const fit = vi.fn();
    useNodeGraphStore.setState({ nodes: [at('a')], activeGroupPath: [], _fitViewCallback: fit });
    const close = vi.fn();
    finishBuilder(close, [undefined]);
    vi.runAllTimers();
    expect(close).toHaveBeenCalled();
    expect(fit).not.toHaveBeenCalled();
  });

  it('the 2D Scene Builder frames every node of its build', () => {
    let i = 0;
    const res = applyScene2D([], templateScene('pixel'), { nextId: () => `n${++i}`, at: { x: 0, y: 0 } });
    useNodeGraphStore.setState({ nodes: res.nodes });
    const ids = scene2dBuildIds(res.sceneId);
    const built = buildStandalone2D(templateScene('pixel')).nodes.filter(n => n.type !== 'output').length;
    expect(ids).toContain(res.sceneId);
    expect(new Set(ids).size).toBeGreaterThanOrEqual(built - 1);
  });
});
