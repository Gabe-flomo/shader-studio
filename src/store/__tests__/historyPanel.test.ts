/**
 * The History panel's data: labelled undo steps, names read from snapshots for the rest,
 * restore-to-here as N undos (still redoable), and the Activity log of toasts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore, undoManager } from '../useNodeGraphStore';
import { buildTimeline, describeDiff, diffGraphs } from '../historyLabels';
import { getNodeDefinition } from '../../nodes/definitions';
import { toast, useToastStore } from '../../components/ui/toastStore';
import { ACTIVITY_CAP, UNDO_ACTION_TTL_MS, actionAvailable, useActivityStore } from '../../components/ui/activityStore';

const node = (id: string, type: string, inputs: GraphNode['inputs'], outputs: GraphNode['outputs'], params: Record<string, unknown> = {}): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs, params });

function graph(): GraphNode[] {
  return [
    node('uv', 'uv', {}, { uv: { type: 'vec2', label: 'UV' } }),
    node('t', 'time', {}, { time: { type: 'float', label: 'Time' } }),
    node('circ', 'circleSDF',
      { position: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } }, radius: { type: 'float', label: 'Radius' }, offset: { type: 'vec2', label: 'Center' } },
      { distance: { type: 'float', label: 'Distance' } }, { radius: 0.3 }),
    node('f2v', 'floatToVec3', { input: { type: 'float', label: 'Float', connection: { nodeId: 'circ', outputKey: 'distance' } } }, { rgb: { type: 'vec3', label: 'Color' } }),
    node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v', outputKey: 'rgb' } } }, {}),
  ];
}

const top = () => undoManager.done()[undoManager.done().length - 1];
const timeline = () => buildTimeline(undoManager.done(), undoManager.undone(), useNodeGraphStore.getState().nodes);
const label = (id: string) => getNodeDefinition(useNodeGraphStore.getState().nodes.find(n => n.id === id)!.type)!.label;

describe('undo step labels', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    undoManager.clear();
    useNodeGraphStore.setState({ nodes: graph(), activeGroupPath: [], activeGroupId: null, scratch: null });
  });
  afterEach(() => {
    vi.advanceTimersByTime(2000); // end any param-edit burst
    vi.useRealTimers();
  });

  it('names the main actions as they happen', () => {
    const s = useNodeGraphStore.getState();
    const circle = label('circ');

    s.disconnectInput('circ', 'position');
    expect(top().label).toBe(`Disconnected UV → ${circle}`);

    s.connectNodes('uv', 'uv', 'circ', 'position');
    expect(top().label).toBe(`Connected UV → ${circle}`);

    const added = s.addNode('time', { x: 10, y: 10 });
    expect(top().label).toBe(`Added ${getNodeDefinition('time')!.label}`);

    s.toggleBypass('circ');
    expect(top().label).toBe(`Bypassed ${circle}`);
    s.toggleBypass('circ');
    expect(top().label).toBe(`Turned ${circle} back on`);

    s.duplicateNode('circ');
    expect(top().label).toBe(`Duplicated ${circle}`);

    s.removeNodes([added!, 't']);
    expect(top().label).toBe('Removed 2 nodes');

    s.groupNodes(['circ', 'f2v']);
    expect(top().label).toBe('Grouped 2 nodes');
    expect(top().nodeIds).toEqual(['circ', 'f2v']);

    s.autoLayout();
    expect(top().label).toBe('Tidied the layout');

    s.setNodesRewritten(useNodeGraphStore.getState().nodes);
    expect(top().label).toBe('Optimised the graph');
  });

  it('names a slider burst from what it changed, first value to last', () => {
    const s = useNodeGraphStore.getState();
    s.updateNodeParams('circ', { radius: 0.35 });
    s.updateNodeParams('circ', { radius: 0.4 });
    s.updateNodeParams('circ', { radius: 0.42 });
    expect(undoManager.canUndo).toBe(1); // one step for the whole burst
    expect(top().label).toBeUndefined();
    expect(timeline()[0].label).toBe('Changed Radius 0.3 → 0.42');
    expect(timeline()[0].status).toBe('current');
  });

  it('a loaded or blank graph is where the history starts', async () => {
    await useNodeGraphStore.getState().loadExampleGraph('blank');
    expect(undoManager.getOrigin()?.label).toBe('Started a new graph');
    expect(undoManager.canUndo).toBe(0);
  });
});

describe('fallback labels from the snapshots', () => {
  it('reads simple changes from the diff', () => {
    const before = graph();
    const circle = getNodeDefinition('circleSDF')!.label;
    const unwired = before.map(n => n.id === 'circ' ? { ...n, inputs: { ...n.inputs, position: { ...n.inputs.position, connection: undefined } } } : n);
    expect(describeDiff(diffGraphs(before, unwired))).toBe(`Disconnected UV → ${circle}`);
    expect(describeDiff(diffGraphs(unwired, before))).toBe(`Connected UV → ${circle}`);
    const moved = before.map(n => n.id === 'uv' ? { ...n, position: { x: 50, y: 0 } } : n);
    expect(describeDiff(diffGraphs(before, moved))).toBe('Moved UV');
    const fewer = before.filter(n => n.id !== 't');
    expect(describeDiff(diffGraphs(before, fewer))).toBe(`Removed ${getNodeDefinition('time')!.label}`);
  });

  it('says "Edited the graph" with a count when several kinds of change mix', () => {
    const before = graph();
    const after = before
      .filter(n => n.id !== 't')
      .map(n => n.id === 'circ' ? { ...n, params: { radius: 0.5 } } : n.id === 'uv' ? { ...n, position: { x: 99, y: 9 } } : n)
      .concat(node('extra', 'time', {}, { time: { type: 'float', label: 'Time' } }));
    const d = diffGraphs(before, after);
    expect(d.changedCount).toBe(4);
    expect(describeDiff(d)).toBe('Edited the graph · 4 nodes changed');
  });

  it('an unlabelled push is named from the diff in the timeline', () => {
    undoManager.clear();
    const before = graph();
    useNodeGraphStore.setState({ nodes: before });
    undoManager.push(before);
    useNodeGraphStore.setState({ nodes: before.map(n => n.id === 'circ' ? { ...n, params: { radius: 0.3 }, bypassed: true, position: { x: 1, y: 1 } } : n.id === 'uv' ? { ...n, position: { x: 5, y: 5 } } : n) });
    expect(timeline()[0].label).toBe('Edited the graph · 2 nodes changed');
  });

  it('lists a new group once, not the nodes that went inside it', () => {
    vi.useFakeTimers();
    undoManager.clear();
    useNodeGraphStore.setState({ nodes: graph(), activeGroupPath: [], activeGroupId: null, scratch: null });
    useNodeGraphStore.getState().groupNodes(['circ', 'f2v']);
    const step = timeline()[0];
    const d = diffGraphs(step.before, step.after);
    expect(d.added).toHaveLength(1);
    expect(d.removed.map(r => r.id).sort()).toEqual(['circ', 'f2v']);
    // The wires into and out of the group are the ones worth showing
    expect(d.wires.every(w => w.kind === 'added')).toBe(true);
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
  });
});

describe('restore to here', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    undoManager.clear('Loaded example: Test');
    useNodeGraphStore.setState({ nodes: graph(), activeGroupPath: [], activeGroupId: null, scratch: null });
  });
  afterEach(() => { vi.advanceTimersByTime(2000); vi.useRealTimers(); });

  it('is the same as N undos, and stays redoable', () => {
    const s = useNodeGraphStore.getState();
    const states: GraphNode[][] = [useNodeGraphStore.getState().nodes];
    s.toggleBypass('circ'); states.push(useNodeGraphStore.getState().nodes);
    s.disconnectInput('circ', 'position'); states.push(useNodeGraphStore.getState().nodes);
    s.addNode('time', { x: 0, y: 0 }); states.push(useNodeGraphStore.getState().nodes);
    s.toggleBypass('f2v'); states.push(useNodeGraphStore.getState().nodes);
    s.duplicateNode('uv'); states.push(useNodeGraphStore.getState().nodes);

    const steps = timeline();
    expect(steps.map(x => x.status)).toEqual(['done', 'done', 'done', 'done', 'current']);
    // Restore to the second step: three undos in one go
    const target = steps[1];
    expect(target.undoToHere).toBe(3);
    expect(s.undoSteps(target.undoToHere)).toBe(3);
    expect(useNodeGraphStore.getState().nodes).toEqual(states[2]);

    // The same as three single undos from the end
    const viaSingles = (() => {
      s.redoSteps(3);
      s.undo(); s.undo(); s.undo();
      return useNodeGraphStore.getState().nodes;
    })();
    expect(viaSingles).toEqual(states[2]);

    const after = timeline();
    expect(after.map(x => x.status)).toEqual(['done', 'current', 'undone', 'undone', 'undone']);
    expect(after.map(x => x.label)).toEqual(steps.map(x => x.label));
    // Redo to the last one brings everything back
    expect(after[4].redoToHere).toBe(3);
    expect(s.redoSteps(after[4].redoToHere)).toBe(3);
    expect(useNodeGraphStore.getState().nodes).toEqual(states[5]);
    expect(undoManager.canRedo).toBe(0);
  });

  it('restoring to the start undoes every step', () => {
    const s = useNodeGraphStore.getState();
    const start = useNodeGraphStore.getState().nodes;
    s.toggleBypass('circ');
    s.toggleBypass('uv');
    expect(s.undoSteps(undoManager.canUndo)).toBe(2);
    expect(useNodeGraphStore.getState().nodes).toEqual(start);
    expect(undoManager.getOrigin()?.label).toBe('Loaded example: Test');
  });

  it('keeps at most maxDepth steps and says older ones are gone', () => {
    const s = useNodeGraphStore.getState();
    for (let i = 0; i < undoManager.maxDepth + 3; i++) s.toggleBypass('circ');
    expect(undoManager.canUndo).toBe(undoManager.maxDepth);
    expect(undoManager.isTrimmed()).toBe(true);
  });
});

describe('activity log', () => {
  beforeEach(() => {
    useActivityStore.getState().clear();
    useToastStore.setState({ toasts: [] });
  });

  it('keeps every toast with its kind, title and message', () => {
    toast.success('Saved “Neon”');
    toast.error('Couldn’t import', { message: 'Not a graph file.', details: 'SyntaxError' });
    toast.info('Loaded an example with a Play setup', { action: { label: 'Open Play', onClick: () => {} } });
    const e = useActivityStore.getState().entries;
    expect(e.map(x => [x.kind, x.title])).toEqual([
      ['success', 'Saved “Neon”'], ['error', 'Couldn’t import'], ['info', 'Loaded an example with a Play setup'],
    ]);
    expect(e[1]).toMatchObject({ message: 'Not a graph file.', details: 'SyntaxError' });
    // Only three toasts show at once; the log keeps them all
    toast.info('a'); toast.info('b');
    expect(useToastStore.getState().toasts).toHaveLength(3);
    expect(useActivityStore.getState().entries).toHaveLength(5);
  });

  it('caps its size', () => {
    for (let i = 0; i < ACTIVITY_CAP + 25; i++) toast.info(`n${i}`);
    const e = useActivityStore.getState().entries;
    expect(e).toHaveLength(ACTIVITY_CAP);
    expect(e[e.length - 1].title).toBe(`n${ACTIVITY_CAP + 24}`);
    expect(e[0].title).toBe('n25');
  });

  it('counts unseen entries until the list is watched', () => {
    const st = useActivityStore.getState();
    toast.info('one'); toast.warning('two');
    const s1 = useActivityStore.getState();
    expect(s1.entries.filter(x => x.id > s1.seenId)).toHaveLength(2);
    const stop = st.watch();
    toast.info('three');
    const s2 = useActivityStore.getState();
    expect(s2.entries.filter(x => x.id > s2.seenId)).toHaveLength(0);
    stop();
    toast.info('four');
    const s3 = useActivityStore.getState();
    expect(s3.entries.filter(x => x.id > s3.seenId)).toHaveLength(1);
  });

  it('runs a button once; an Undo without its own check expires', () => {
    const open = vi.fn();
    toast.info('Play setup', { action: { label: 'Open Play', onClick: open } });
    const id = useActivityStore.getState().entries.at(-1)!.id;
    expect(useActivityStore.getState().runAction(id)).toBe(true);
    expect(useActivityStore.getState().runAction(id)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);

    toast.info('Step deleted', { action: { label: 'Undo', onClick: () => {} } });
    const u = useActivityStore.getState().entries.at(-1)!;
    expect(actionAvailable(u, u.at + 1000)).toBe(true);
    expect(actionAvailable(u, u.at + UNDO_ACTION_TTL_MS + 1)).toBe(false);

    let ok = true;
    toast.info('Went back 3 steps', { action: { label: 'Undo', onClick: () => {}, stillValid: () => ok } });
    const r = useActivityStore.getState().entries.at(-1)!;
    expect(actionAvailable(r)).toBe(true);
    ok = false;
    expect(actionAvailable(r)).toBe(false);
  });
});
