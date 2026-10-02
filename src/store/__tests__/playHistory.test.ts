/**
 * Undo for the Play page: every setPlay edit is a step in the same history as the graph's,
 * named from what changed; a value still moving (a slider drag) is one step; undo and redo
 * bring the record back; playback state and live flags never make a step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import type { PlayLayer, PlayRecord } from '../../types/play';
import type { NullLayer, TextLayer } from '../../types/playLayers';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore, undoManager } from '../useNodeGraphStore';
import { buildTimeline } from '../historyLabels';
import { describePlayChange } from '../playHistory';
import { emptyPlayRecord } from '../../types/play';

const node = (id: string, type: string, inputs: GraphNode['inputs'], outputs: GraphNode['outputs'], params: Record<string, unknown> = {}): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs, params });

function graph(): GraphNode[] {
  return [
    node('uv', 'uv', {}, { uv: { type: 'vec2', label: 'UV' } }),
    node('circ', 'circleSDF',
      { position: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } }, radius: { type: 'float', label: 'Radius' }, offset: { type: 'vec2', label: 'Center' } },
      { distance: { type: 'float', label: 'Distance' } }, { radius: 0.3 }),
    node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'circ', outputKey: 'distance' } } }, {}),
  ];
}

const nullLayer = (id: string, label: string, x = 0.5, y = 0.5): NullLayer =>
  ({ id, label, kind: 'null', visible: true, toShader: false, x, y, size: 10, color: '#fff', follow: 'none', followId: '', handSide: 'any', handPoint: 8, spring: 0.5, wobble: 0.2 } as NullLayer);
const textLayer = (id: string, label: string): TextLayer =>
  ({ id, label, kind: 'text', visible: true, toShader: false, text: 'Hello', x: 0.5, y: 0.5, size: 24 } as unknown as TextLayer);

const st = () => useNodeGraphStore.getState();
const play = () => st().play;
const setPlay = (fn: (p: PlayRecord) => PlayRecord, history?: false | { label?: string }) => st().setPlay(fn, history);
const top = () => undoManager.done()[undoManager.done().length - 1];
const labels = () => undoManager.done().map(e => e.label);
const timeline = () => buildTimeline(undoManager.done(), undoManager.undone(), { nodes: st().nodes, play: st().play });

describe('Play edits as undo steps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    undoManager.clear();
    useNodeGraphStore.setState({ nodes: graph(), play: emptyPlayRecord(), activeGroupPath: [], activeGroupId: null, scratch: null });
  });
  afterEach(() => {
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
  });

  it('names a step per kind of edit', () => {
    setPlay(p => ({ ...p, layers: [...p.layers, textLayer('t1', 'Text 1')] }));
    expect(top().label).toBe('Added layer Text 1');
    expect(top().play).toBeDefined();
    expect(top().nodes).toBeUndefined();

    setPlay(p => ({ ...p, layers: [...p.layers, nullLayer('n1', 'Null 1')] }));
    expect(top().label).toBe('Added layer Null 1');

    setPlay(p => ({ ...p, layers: [p.layers[1], p.layers[0]] }));
    expect(top().label).toBe('Reordered layers');

    setPlay(p => ({ ...p, layers: p.layers.map(l => (l.id === 't1' ? { ...l, label: 'Title' } : l)) as PlayLayer[] }));
    expect(top().label).toBe('Renamed layer “Text 1” to “Title”');

    setPlay(p => ({ ...p, layers: p.layers.map(l => (l.id === 't1' ? { ...l, visible: false } : l)) as PlayLayer[] }));
    expect(top().label).toBe('Hid layer Title');

    setPlay(p => ({ ...p, layers: p.layers.map(l => (l.id === 't1' ? { ...l, size: 32 } : l)) as PlayLayer[] }));
    expect(top().label).toBe('Title · Size 24 → 32');

    setPlay(p => ({ ...p, groups: [{ id: 'g1', label: 'Group 1', colour: 'blue', layers: ['t1'] }] as PlayRecord['groups'] }));
    expect(top().label).toBe('Added group Group 1');

    setPlay(p => ({ ...p, controls: [{ id: 'c1', target: 'circ::radius', kind: 'float', label: 'Radius', min: 0, max: 1 }] }));
    expect(top().label).toBe('Added control Radius');

    setPlay(p => ({ ...p, mappings: [{ id: 'm1', controlId: 'c1', source: { kind: 'mouse', axis: 'x' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }] }));
    expect(top().label).toBe('Added mapping Mouse X → Radius');

    setPlay(p => ({ ...p, mappings: p.mappings.map(m => ({ ...m, enabled: false })) }));
    expect(top().label).toBe('Turned mapping Mouse X → Radius off');

    setPlay(p => ({ ...p, mappings: [] }));
    expect(top().label).toBe('Removed the mapping Mouse X → Radius');

    setPlay(p => ({ ...p, actions: [{ id: 'a1', trigger: { kind: 'key', code: 'Space' } as never, do: 'next', layerId: 't1', amount: 1, enabled: true }] }));
    expect(top().label).toBe('Added action Next line on Title');

    setPlay(p => ({ ...p, signals: [{ id: 's1', name: 'Drop' }] }));
    expect(top().label).toBe('Added rule Drop');

    setPlay(p => ({ ...p, pairs: [{ id: 'p1', label: 'XY', a: 'c1', b: 'c1', position: true }] }));
    expect(top().label).toBe('Added pair XY');

    setPlay(p => ({ ...p, finish: { on: true, effects: [{ id: 'f1', kind: 'grade', enabled: true, exposure: 0 } as never] } }));
    expect(top().label).toBe('Set up finish');

    setPlay(p => ({ ...p, finish: { ...p.finish!, effects: [...p.finish!.effects, { id: 'f2', kind: 'custom', name: 'Glitchy', enabled: true } as never] } }));
    expect(top().label).toBe('Added effect Glitchy');

    setPlay(p => ({ ...p, finish: { ...p.finish!, effects: p.finish!.effects.map(e => (e.id === 'f1' ? { ...e, exposure: 1.5 } : e)) } }));
    expect(top().label).toBe('Grade · Exposure 0 → 1.5');

    setPlay(p => ({ ...p, audioFx: { chains: { master: { on: true, effects: [{ id: 'x1', kind: 'filter', cutoff: 2000 } as never] } } } }));
    expect(top().label).toBe('Set up audio effects');

    setPlay(p => ({ ...p, audioFx: { chains: { master: { on: true, effects: [{ id: 'x1', kind: 'filter', cutoff: 800 } as never] } } } }));
    expect(top().label).toBe('Filter · Cutoff 2000 → 800');

    setPlay(p => ({ ...p, audioEngine: { racks: [{ id: 'r1', name: 'Rack 1', instrument: null, effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false } as never] } }));
    expect(top().label).toBe('Set up audio engine');

    setPlay(p => ({ ...p, audioEngine: { racks: [{ ...p.audioEngine!.racks[0], volume: 0.5 }] } }));
    expect(top().label).toBe('Rack 1 · Volume 1 → 0.5');

    setPlay(p => ({ ...p, notes: 'Try the mouse' }));
    expect(top().label).toBe('Wrote the notes');

    setPlay(p => ({ ...p, controls: [] }));
    expect(top().label).toBe('Removed control Radius');

    setPlay(p => ({ ...p, layers: p.layers.filter(l => l.id !== 'n1') }));
    expect(top().label).toBe('Removed layer Null 1');

    expect(undoManager.canUndo).toBe(24);
  });

  it('folds a value still moving into one step, named from where it started', () => {
    setPlay(p => ({ ...p, layers: [nullLayer('n1', 'Null 1', 0.2, 0.5)] }));
    const before = undoManager.canUndo;
    // A slider drag: many changes of one value, a few ms apart.
    for (const x of [0.25, 0.3, 0.4, 0.5]) {
      vi.advanceTimersByTime(30);
      setPlay(p => ({ ...p, layers: p.layers.map(l => ({ ...l, x })) as PlayLayer[] }));
    }
    expect(undoManager.canUndo).toBe(before + 1);
    expect(top().label).toBe('Null 1 · X 0.2 → 0.5');
    // A drag of the point moves X and Y together: still one step.
    for (const [x, y] of [[0.6, 0.6], [0.7, 0.7]]) {
      vi.advanceTimersByTime(30);
      setPlay(p => ({ ...p, layers: p.layers.map(l => ({ ...l, x, y })) as PlayLayer[] }));
    }
    expect(undoManager.canUndo).toBe(before + 2);
    expect(top().label).toBe('Null 1 · X 0.5 → 0.7 · Y 0.5 → 0.7');
    // After a second of quiet the next change is a new step.
    vi.advanceTimersByTime(1100);
    setPlay(p => ({ ...p, layers: p.layers.map(l => ({ ...l, x: 0.9 })) as PlayLayer[] }));
    expect(undoManager.canUndo).toBe(before + 3);
    expect(top().label).toBe('Null 1 · X 0.7 → 0.9');
    // A different edit ends the burst even inside the second.
    setPlay(p => ({ ...p, layers: p.layers.map(l => ({ ...l, x: 0.95 })) as PlayLayer[] }));
    expect(undoManager.canUndo).toBe(before + 3);
    setPlay(p => ({ ...p, notes: 'a' }));
    setPlay(p => ({ ...p, layers: p.layers.map(l => ({ ...l, x: 1 })) as PlayLayer[] }));
    expect(undoManager.canUndo).toBe(before + 5);
    expect(labels().slice(-3)).toEqual(['Null 1 · X 0.7 → 0.95', 'Wrote the notes', 'Null 1 · X 0.95 → 1']);
  });

  it('undoes and redoes Play edits, in one history with the graph', () => {
    const s = st();
    setPlay(p => ({ ...p, layers: [textLayer('t1', 'Text 1')] }));
    s.updateNodeParams('circ', { radius: 0.6 });
    vi.advanceTimersByTime(1500);
    setPlay(p => ({ ...p, notes: 'Hi' }));
    expect(play().layers).toHaveLength(1);
    expect(play().notes).toBe('Hi');

    expect(s.undoSteps(1)).toBe(1);
    expect(play().notes).toBeUndefined();
    expect(play().layers).toHaveLength(1);
    expect(st().nodes.find(n => n.id === 'circ')!.params.radius).toBe(0.6);

    expect(s.undoSteps(1)).toBe(1);
    expect(st().nodes.find(n => n.id === 'circ')!.params.radius).toBe(0.3);
    expect(play().layers).toHaveLength(1);

    expect(s.undoSteps(1)).toBe(1);
    expect(play().layers).toHaveLength(0);
    expect(undoManager.canUndo).toBe(0);
    expect(undoManager.canRedo).toBe(3);

    expect(s.redoSteps(3)).toBe(3);
    expect(play().layers).toHaveLength(1);
    expect(play().notes).toBe('Hi');
    expect(st().nodes.find(n => n.id === 'circ')!.params.radius).toBe(0.6);

    // The History panel lists all three, with the Play ones marked.
    const steps = timeline();
    expect(steps.map(x => x.label)).toEqual(['Added layer Text 1', 'Changed Radius 0.3 → 0.6', 'Wrote the notes']);
    expect(steps.map(x => !!x.play)).toEqual([true, false, true]);
    expect(steps[0].play!.before.layers).toHaveLength(0);
    expect(steps[0].play!.after.layers).toHaveLength(1);
    expect(steps[2].play!.before.notes).toBeUndefined();
    expect(steps[2].play!.after.notes).toBe('Hi');
    // A Play step's graph is the graph around it.
    expect(steps[2].before).toBe(steps[2].after);
    expect(describePlayChange(steps[0].play!.before, steps[0].play!.after)!.lines).toEqual(['Added layer Text 1']);

    // Restore to here from the panel: two undos, then Redo to here brings them back.
    expect(s.undoSteps(steps[0].undoToHere)).toBe(2);
    expect(play().notes).toBeUndefined();
    expect(play().layers).toHaveLength(1);
    const undone = timeline().filter(x => x.status === 'undone');
    expect(undone.map(x => x.label)).toEqual(['Changed Radius 0.3 → 0.6', 'Wrote the notes']);
    expect(s.redoSteps(undone[1].redoToHere)).toBe(2);
    expect(play().notes).toBe('Hi');
  });

  it('a fresh Play edit after undo abandons the redo branch', () => {
    setPlay(p => ({ ...p, notes: 'one' }));
    vi.advanceTimersByTime(1500);
    setPlay(p => ({ ...p, notes: 'two' }));
    st().undoSteps(1);
    expect(undoManager.canRedo).toBe(1);
    vi.advanceTimersByTime(1500);
    setPlay(p => ({ ...p, notes: 'three' }));
    expect(undoManager.canRedo).toBe(0);
    expect(play().notes).toBe('three');
  });

  it('replacing the graph is one step that brings the Play setup back too', () => {
    setPlay(p => ({ ...p, layers: [textLayer('t1', 'Text 1')] }));
    st().replaceGraph(graph());
    expect(play().layers).toHaveLength(0);
    st().undoSteps(1);
    expect(play().layers).toHaveLength(1);
  });

  it('records nothing for playback state, live flags or writes that opt out', () => {
    setPlay(p => ({ ...p, audioEngine: { racks: [{ id: 'r1', name: 'Rack 1', instrument: null, effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false } as never] } }));
    const n = undoManager.canUndo;
    // The clock and play/pause live in the store, not the record.
    st().setTimePlaying(false);
    useNodeGraphStore.setState({ currentTime: 12.5 });
    expect(undoManager.canUndo).toBe(n);
    // A rack taking or letting go of the keyboard is playing, not editing.
    setPlay(p => ({ ...p, audioEngine: { racks: [{ ...p.audioEngine!.racks[0], keyboard: true }] } }));
    setPlay(p => ({ ...p, audioEngine: { racks: [{ ...p.audioEngine!.racks[0], keyboard: false }] } }));
    expect(undoManager.canUndo).toBe(n);
    // The output window's projection keeps its own history.
    setPlay(p => ({ ...p, notes: 'not a step' }), false);
    expect(undoManager.canUndo).toBe(n);
    expect(play().notes).toBe('not a step');
    // A caller can name the step itself.
    setPlay(p => ({ ...p, notes: 'named' }), { label: 'Rewrote the notes' });
    expect(top().label).toBe('Rewrote the notes');
    // Live mapped values reach the engine, never the record: the same record is no step.
    setPlay(p => p);
    expect(undoManager.canUndo).toBe(n + 1);
  });

  it('shares memory between steps: the untouched parts of the record are the same objects', () => {
    setPlay(p => ({ ...p, layers: [textLayer('t1', 'Text 1'), nullLayer('n1', 'Null 1')] }));
    const layers = play().layers;
    setPlay(p => ({ ...p, notes: 'x' }));
    expect(top().play!.layers).toBe(layers);
    expect(play().layers).toBe(layers);
  });
});
