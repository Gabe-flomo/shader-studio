/**
 * The Files page's Notes: collecting Play notes and node comments (inside
 * groups too) from saved graphs and the open graph, the numbers, search,
 * filter and sort, and deleting one with undo.
 */
import { describe, it, expect } from 'vitest';
import { collectNotes, groupByGraph, notesStats, ownerPath, previewText, queryNotes, removeNote, OPEN_GRAPH_LABEL } from '../notes';
import { memoryKV } from '../mutate';

const CREDIT = { title: 'The Book of Shaders', url: 'https://thebookofshaders.com/05/', chapter: 5, chapterTitle: 'Shaping functions' };

function fixture(): Record<string, string> {
  return {
    'shader-studio:Sunset': JSON.stringify({
      version: 2, savedAt: 2_000_000_000_000,
      nodes: [
        { id: 'n1', type: 'output', params: {} },
        { id: 'n2', type: 'noise', params: { __comment: 'Grain from [the book](https://thebookofshaders.com/11/)', __credit: CREDIT } },
        { id: 'g1', type: 'group', params: { label: 'Waves', subgraph: { nodes: [
          { id: 'i1', type: 'noise', params: { __comment: 'Inner noise' } },
          { id: 'i2', type: 'sin', params: { label: 'Wobble', __comment: '   ' } },
        ] } } },
      ],
      play: { version: 1, controls: [], mappings: [], layers: [], notes: 'Move the mouse. See [[layer:L1]].\n\n\n\nMore', source: CREDIT },
    }),
    'shader-studio:Waves': JSON.stringify({
      version: 1, savedAt: 1_900_000_000_000,
      nodes: [{ id: 'a', type: 'uv', params: { __comment: 'Centre the uv first, a longer comment than the others here' } }, { id: 'b', type: 'output', params: {} }],
    }),
    'shader-studio:Plain': JSON.stringify({ version: 1, nodes: [{ id: 'x', type: 'output', params: {} }] }),
    // Not graphs: a preset and a setting.
    'shader-studio:gp:gp_1': JSON.stringify({ id: 'gp_1', label: 'Glow', subgraph: { nodes: [{ id: 'q', type: 'noise', params: { __comment: 'not listed' } }] } }),
    'shader-studio:theme': 'dark',
  };
}

const labelOf = (t: string) => ({ noise: 'Noise', uv: 'UV', output: 'Output', sin: 'Sine', group: 'Group' } as Record<string, string>)[t];

describe('collecting notes', () => {
  it('finds Play notes and node comments in saved graphs, groups included, with credits and dates', () => {
    const c = collectNotes(memoryKV(fixture()), { labelOf });
    expect(c.notes.map(n => n.id)).toEqual([
      'shader-studio:Sunset|play', 'shader-studio:Sunset|node:n2', 'shader-studio:Sunset|node:g1/i1', 'shader-studio:Waves|node:a',
    ]);
    const play = c.notes[0];
    expect(play).toMatchObject({ kind: 'play', graph: 'Sunset', credit: { title: 'The Book of Shaders' }, date: 2_000_000_000_000, live: false });
    const inner = c.notes[2];
    expect(inner).toMatchObject({ kind: 'comment', nodeId: 'i1', nodeLabel: 'Noise', groupPath: ['g1'], groupLabels: ['Waves'] });
    expect(ownerPath(inner)).toEqual(['Sunset', 'Waves', 'Noise']);
    expect(ownerPath(play)).toEqual(['Sunset', 'Play notes']);
    expect(c.notes[1].credit?.chapter).toBe(5);
    // Every graph counts for "nodes with and without", even one without notes.
    expect(c.graphs.map(g => [g.graph, g.nodes, g.commented])).toEqual([['Plain', 1, 0], ['Sunset', 5, 2], ['Waves', 2, 1]]);
  });

  it('the open graph: unsaved counts on its own; with changes, its live notes stand in for the saved ones', () => {
    const kv = memoryKV(fixture());
    const unsaved = collectNotes(kv, { open: { name: null, dirty: true, nodes: [{ id: 'z', type: 'uv', params: { __comment: 'scratch' } }], play: { notes: 'draft' } }, labelOf });
    const mine = unsaved.notes.filter(n => n.graph === null);
    expect(mine.map(n => [n.kind, n.text, n.graphLabel, n.live])).toEqual([['play', 'draft', OPEN_GRAPH_LABEL, true], ['comment', 'scratch', OPEN_GRAPH_LABEL, true]]);

    const edited = collectNotes(kv, { open: { name: 'Waves', dirty: true, nodes: [{ id: 'a', type: 'uv', params: { __comment: 'Changed' } }] }, labelOf });
    const waves = edited.notes.filter(n => n.graph === 'Waves');
    expect(waves.map(n => [n.text, n.live])).toEqual([['Changed', true]]);
    // Open but saved: what's stored is what's listed.
    const clean = collectNotes(kv, { open: { name: 'Waves', dirty: false, nodes: [] }, labelOf });
    expect(clean.notes.filter(n => n.graph === 'Waves').map(n => n.live)).toEqual([false]);
  });
});

describe('stats', () => {
  it('counts notes, credits, notes per graph, the most-commented graphs and node kinds, and nodes with or without', () => {
    const s = notesStats(collectNotes(memoryKV(fixture()), { labelOf }));
    expect(s).toMatchObject({ total: 4, play: 1, comments: 3, withCredit: 2, nodesWith: 3, nodesWithout: 5 });
    expect(s.perGraph.map(g => [g.label, g.count])).toEqual([['Sunset', 3], ['Waves', 1]]);
    expect(s.topGraphs.length).toBe(2);
    expect(s.topNodes).toEqual([{ label: 'Noise', count: 2 }, { label: 'UV', count: 1 }]);
  });

  it('keeps five of each at most', () => {
    const kv: Record<string, string> = {};
    for (let g = 0; g < 7; g++) kv[`shader-studio:G${g}`] = JSON.stringify({ nodes: Array.from({ length: g + 1 }, (_, i) => ({ id: `n${i}`, type: `t${i}`, params: { __comment: 'c' } })) });
    const s = notesStats(collectNotes(memoryKV(kv)));
    expect(s.topGraphs.map(g => g.label)).toEqual(['G6', 'G5', 'G4', 'G3', 'G2']);
    expect(s.perGraph.length).toBe(7);
    expect(s.topNodes.length).toBe(5);
    expect(s.topNodes[0]).toEqual({ label: 'T0', count: 7 });
  });
});

describe('search, filter and sort', () => {
  const notes = collectNotes(memoryKV(fixture()), { labelOf }).notes;
  it('searches the text, the owner and the credit', () => {
    expect(queryNotes(notes, { search: 'inner' }).map(n => n.nodeId)).toEqual(['i1']);
    expect(queryNotes(notes, { search: 'waves noise' }).map(n => n.nodeId)).toEqual(['i1']);
    expect(queryNotes(notes, { search: 'book of shaders' }).map(n => n.id)).toEqual(['shader-studio:Sunset|play', 'shader-studio:Sunset|node:n2']);
  });
  it('filters by kind and graph', () => {
    expect(queryNotes(notes, { kind: 'play' }).length).toBe(1);
    expect(queryNotes(notes, { kind: 'comment', graph: 'Sunset' }).length).toBe(2);
    expect(queryNotes(notes, { graph: 'Waves' }).map(n => n.nodeId)).toEqual(['a']);
  });
  it('sorts by graph (Play notes first), newest, or longest', () => {
    expect(queryNotes(notes, { sort: 'graph' }).map(n => n.graph)).toEqual(['Sunset', 'Sunset', 'Sunset', 'Waves']);
    expect(queryNotes(notes, { sort: 'graph' })[0].kind).toBe('play');
    expect(queryNotes(notes, { sort: 'date' })[3].graph).toBe('Waves');
    expect(queryNotes(notes, { sort: 'length' })[0].nodeId).toBe('a');
    expect(groupByGraph(queryNotes(notes, {})).map(g => [g.label, g.notes.length])).toEqual([['Sunset', 3], ['Waves', 1]]);
  });
  it('previews: Play note links become their kind, runs of blank lines shrink, long text is cut', () => {
    expect(previewText('See [[layer:L1]].\n\n\n\nMore')).toBe('See (layer).\n\nMore');
    expect(previewText('x'.repeat(400), 100)).toHaveLength(101);
  });
});

describe('deleting a note', () => {
  it('takes a comment (and its credit) out of a node inside a group, and undo puts the graph back exactly', () => {
    const kv = memoryKV(fixture());
    const before = kv.get('shader-studio:Sunset');
    const note = collectNotes(kv, { labelOf }).notes.find(n => n.nodeId === 'i1')!;
    const undo = removeNote(kv, note)!;
    expect(undo).toBeTypeOf('function');
    const after = collectNotes(kv, { labelOf }).notes;
    expect(after.some(n => n.nodeId === 'i1')).toBe(false);
    expect(after.some(n => n.nodeId === 'n2')).toBe(true);
    const g = JSON.parse(kv.get('shader-studio:Sunset')!);
    expect(g.nodes[2].params.subgraph.nodes[0].params).toEqual({});
    expect(g.nodes[2].params.label).toBe('Waves');
    undo();
    expect(kv.get('shader-studio:Sunset')).toBe(before);
  });
  it('takes the Play notes out but keeps the setup’s credit', () => {
    const kv = memoryKV(fixture());
    const note = collectNotes(kv).notes.find(n => n.kind === 'play')!;
    removeNote(kv, note);
    const play = JSON.parse(kv.get('shader-studio:Sunset')!).play;
    expect(play.notes).toBeUndefined();
    expect(play.source.title).toBe('The Book of Shaders');
  });
  it('leaves the open graph’s live notes and notes that are gone alone', () => {
    const kv = memoryKV(fixture());
    const live = collectNotes(kv, { open: { name: null, dirty: true, nodes: [{ id: 'z', type: 'uv', params: { __comment: 's' } }] } }).notes.find(n => n.live)!;
    expect(removeNote(kv, live)).toBeNull();
    const n = collectNotes(kv).notes.find(x => x.nodeId === 'a')!;
    removeNote(kv, n);
    expect(removeNote(kv, n)).toBeNull();
  });
});
