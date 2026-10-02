/**
 * Layer groups: grouping keeps members together and the order stable,
 * ungrouping, nesting, a hidden group hiding its layers where they draw
 * (the canvas and web pages), moving rows, duplicating a group both ways
 * with every id pointed at the copies, and the saved form.
 */
import { normalizeRules } from '../rules';
import { describe, expect, it } from 'vitest';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, type PlayAction, type PlayControl, type PlayLayer, type PlayMapping, type PlayRecord } from '../../types/play';
import { applyGroupVisibility, buildTree, childrenOf, groupLayerIds, tidyGroups, type LayerGroup } from '../../types/layerGroups';
import { addToGroup, canMove, createGroup, duplicateGroup, liveParams, moveItem, moveItemTo, removeGroup, takeOutOfGroup, ungroup } from '../../components/play/groupOps';
import { duplicateLayer, removeLayer } from '../../components/play/layerOps';
import { playBundle, type PlayHtmlInput } from '../exportHtml';

const L = (kind: PlayLayer['kind'], id: string, over: Record<string, unknown> = {}) => ({ ...defaultLayer(kind, id, id.toUpperCase()), ...over } as PlayLayer);
const rec = (layers: PlayLayer[], more: Partial<PlayRecord> = {}): PlayRecord => ({ ...emptyPlayRecord(), layers, ...more });
const order = (p: PlayRecord) => p.layers.map(l => l.id);
const layer = (id: string) => ({ kind: 'layer' as const, id });
const group = (id: string) => ({ kind: 'group' as const, id });
const G = (id: string, layers: string[], over: Partial<LayerGroup> = {}): LayerGroup => ({ id, label: id, colour: 'blue', layers, ...over });

const six = () => rec([L('background', 'bg'), L('shape', 'a'), L('text', 'b'), L('particles', 'c'), L('null', 'd'), L('image', 'e')]);

describe('grouping', () => {
  it('members come together where the first of them is, keeping their order', () => {
    const { play, id } = createGroup(six(), [layer('e'), layer('b'), layer('d')], { id: 'g' });
    expect(order(play)).toEqual(['bg', 'a', 'b', 'd', 'e', 'c']);
    expect(play.groups).toEqual([{ id, label: 'Group', colour: 'peach', layers: ['b', 'd', 'e'] }]);
    // One row for the group, between a and c.
    expect(buildTree(play).map(n => (n.kind === 'layer' ? n.layer.id : n.group.id))).toEqual(['bg', 'a', 'g', 'c']);
  });

  it('a second group gets the next name and colour', () => {
    let p = createGroup(six(), [layer('a')], { id: 'g1' }).play;
    p = createGroup(p, [layer('c')], { id: 'g2' }).play;
    expect(p.groups!.map(g => [g.label, g.colour])).toEqual([['Group', 'peach'], ['Group 2', 'teal']]);
  });

  it('the Background layer never joins', () => {
    const { play } = createGroup(six(), [layer('bg'), layer('a')], { id: 'g' });
    expect(play.groups![0].layers).toEqual(['a']);
    expect(createGroup(six(), [layer('bg')]).id).toBe('');
  });

  it('a matte and its layer go into a group together', () => {
    const p = rec([L('image', 'img', { trackMatte: { id: 'm', mode: 'alpha', invert: false } }), L('shape', 'x'), L('shape', 'm')]);
    const byLayer = createGroup(p, [layer('img')], { id: 'g' }).play;
    expect(byLayer.groups![0].layers.sort()).toEqual(['img', 'm']);
    expect(order(byLayer)).toEqual(['img', 'm', 'x']);
    const byMatte = createGroup(p, [layer('m')], { id: 'g' }).play;
    expect(byMatte.groups![0].layers.sort()).toEqual(['img', 'm']);
  });

  it('ungroup leaves every layer where it is', () => {
    const grouped = createGroup(six(), [layer('b'), layer('c')], { id: 'g' }).play;
    const back = ungroup(grouped, 'g');
    expect(order(back)).toEqual(order(grouped));
    expect(back.groups).toBeUndefined();
  });

  it('nests: a group in a group, ungrouping the inner one hands its layers to the outer', () => {
    let p = createGroup(six(), [layer('b'), layer('c')], { id: 'inner' }).play;
    p = createGroup(p, [group('inner'), layer('d')], { id: 'outer' }).play;
    expect(p.groups!.find(g => g.id === 'inner')!.parent).toBe('outer');
    expect(groupLayerIds(p, 'outer')).toEqual(['b', 'c', 'd']);
    expect(childrenOf(buildTree(p), 'outer').map(n => (n.kind === 'group' ? n.group.id : n.layer.id))).toEqual(['inner', 'd']);
    const flat = ungroup(p, 'inner');
    expect(flat.groups).toEqual([{ id: 'outer', label: 'Group 2', colour: 'teal', layers: ['d', 'b', 'c'] }]);
    expect(order(flat)).toEqual(order(p));
  });

  it('picking layers from inside a group pulls them into the new one, inside that group', () => {
    let p = createGroup(six(), [layer('b'), layer('c'), layer('d')], { id: 'outer' }).play;
    p = createGroup(p, [layer('c'), layer('d')], { id: 'inner' }).play;
    expect(p.groups!.find(g => g.id === 'inner')).toMatchObject({ parent: 'outer', layers: ['c', 'd'] });
    expect(p.groups!.find(g => g.id === 'outer')!.layers).toEqual(['b']);
  });

  it('a layer taken out lands just after its group; a new one added to a group joins its end', () => {
    let p = createGroup(six(), [layer('a'), layer('b'), layer('c')], { id: 'g' }).play;
    p = takeOutOfGroup(p, 'b');
    expect(p.groups![0].layers).toEqual(['a', 'c']);
    expect(order(p)).toEqual(['bg', 'a', 'c', 'b', 'd', 'e']);
    p = addToGroup({ ...p, layers: [...p.layers, L('lens', 'f')] }, 'f', 'g');
    expect(order(p)).toEqual(['bg', 'a', 'c', 'f', 'b', 'd', 'e']);
  });

  it('members stay together when a layer is duplicated or removed, and an emptied group goes', () => {
    let p = createGroup(six(), [layer('b'), layer('c')], { id: 'g' }).play;
    const dup = duplicateLayer(p, 'c');
    p = tidyGroups(dup.play);
    expect(p.groups![0].layers).toContain(dup.id);
    expect(order(p).slice(2, 5)).toEqual(['b', 'c', dup.id]);
    p = tidyGroups(removeLayer(removeLayer(removeLayer(p, 'b'), 'c'), dup.id));
    expect(p.groups).toBeUndefined();
  });

  it('tidy puts split members back together, and is the same record when nothing changed', () => {
    const p = rec(six().layers, { groups: [G('g', ['a', 'e'])] });
    const t = tidyGroups(p);
    expect(order(t)).toEqual(['bg', 'a', 'e', 'b', 'c', 'd']);
    expect(tidyGroups(t)).toBe(t);
    const none = six();
    expect(tidyGroups(none)).toBe(none);
  });
});

describe('moving rows', () => {
  it('a group moves past its neighbours whole; a layer moves inside its group but not out', () => {
    let p = createGroup(six(), [layer('b'), layer('c')], { id: 'g' }).play;
    p = moveItem(p, group('g'), 1);
    expect(order(p)).toEqual(['bg', 'a', 'd', 'b', 'c', 'e']);
    p = moveItem(p, group('g'), -1);
    p = moveItem(p, group('g'), -1);
    expect(order(p)).toEqual(['bg', 'b', 'c', 'a', 'd', 'e']);
    // Not under the Background layer.
    expect(canMove(p, group('g'), -1)).toBe(false);
    expect(canMove(p, layer('b'), -1)).toBe(false);
    p = moveItem(p, layer('b'), 1);
    expect(order(p)).toEqual(['bg', 'c', 'b', 'a', 'd', 'e']);
    expect(canMove(p, layer('b'), 1)).toBe(false);
  });

  it('dragging drops a row before or after a neighbour in the same place', () => {
    let p = createGroup(six(), [layer('b'), layer('c')], { id: 'g' }).play;
    p = moveItemTo(p, group('g'), layer('e'), 'after');
    expect(order(p)).toEqual(['bg', 'a', 'd', 'e', 'b', 'c']);
    // Rows in different groups don't swap places.
    expect(moveItemTo(p, layer('a'), layer('b'), 'before')).toBe(p);
    expect(order(moveItemTo(p, layer('e'), layer('a'), 'before'))).toEqual(['bg', 'e', 'a', 'd', 'b', 'c']);
  });
});

describe('hidden groups', () => {
  it('hide the layers inside, nested ones too, and leave their own switches alone', () => {
    let p = createGroup(six(), [layer('b'), layer('c')], { id: 'inner' }).play;
    p = createGroup(p, [group('inner'), layer('d')], { id: 'outer' }).play;
    p = { ...p, groups: p.groups!.map(g => (g.id === 'outer' ? { ...g, hidden: true as const } : g)) };
    const drawn = applyGroupVisibility(p);
    expect(drawn.layers.filter(l => !l.visible).map(l => l.id).sort()).toEqual(['b', 'c', 'd']);
    expect(p.layers.every(l => l.visible)).toBe(true);
    const shown = { ...p, groups: p.groups!.map(g => { const c = { ...g }; delete c.hidden; return c; }) };
    expect(applyGroupVisibility(shown)).toBe(shown);
  });

  it('web pages get the hidden layers hidden, and no groups', () => {
    let p = createGroup(six(), [layer('a'), layer('e')], { id: 'g' }).play;
    p = { ...p, groups: [{ ...p.groups![0], hidden: true }] };
    const input: PlayHtmlInput = { title: 'T', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play: p, aspect: '16:9' };
    const b = playBundle(input);
    expect('groups' in b.play).toBe(false);
    expect(b.play.layers.filter(l => !l.visible).map(l => l.id).sort()).toEqual(['a', 'e']);
  });
});

describe('duplicating a group', () => {
  const hooked = (): PlayRecord => {
    const layers = [
      L('null', 'n', { x: 0.2, y: 0.3 }),
      L('particles', 'p', { spawn: 'null', nullId: 'n' }),
      L('shape', 's', { trackMatte: { id: 'm', mode: 'alpha', invert: false } }),
      L('shape', 'm'),
      L('text', 'out'),
    ];
    const controls: PlayControl[] = [
      { id: 'c1', target: 'layer:p::speed', kind: 'float', label: 'P · Speed', min: 0, max: 3 },
      { id: 'c2', target: 'act:p::burst', kind: 'action', label: 'P · Burst', min: 0, max: 1, amount: 60 },
      { id: 'c3', target: 'layer:out::size', kind: 'float', label: 'OUT · Size', min: 0, max: 1 },
    ];
    const mappings: PlayMapping[] = [
      { id: 'm1', controlId: 'c1', source: { kind: 'null', layerId: 'n', axis: 'x' }, outMin: 0, outMax: 3, curve: 'linear', smoothMs: 0, enabled: true },
      { id: 'm2', controlId: 'c2', source: { kind: 'trigger', trigger: { on: 'proximity', a: 'n', b: 's', when: 'closer', distance: 0.1, margin: 0.02 }, mode: 'envelope', attack: 0, decay: 100, sustain: 0, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      { id: 'm3', controlId: 'c3', source: { kind: 'sensor', layerId: 's', read: 'distance', otherId: 'n' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
    ];
    const actions: PlayAction[] = [
      { id: 'a1', trigger: { on: 'zone', layerId: 's', event: 'click', threshold: 0.5 }, do: 'burst', layerId: 'p', amount: 30, enabled: true },
      { id: 'a2', trigger: { on: 'key', code: 'Space' }, do: 'next', layerId: 'out', amount: 1, enabled: true },
    ];
    return createGroup(rec(layers, { controls, mappings, actions }), [layer('n'), layer('p'), layer('s')], { id: 'g', label: 'Fireflies' }).play;
  };

  it('layers only: copies with settings, links between them pointed at the copies, nothing hooked up', () => {
    const p = hooked();
    const { play, id } = duplicateGroup(p, 'g', false);
    const copy = play.groups!.find(g => g.id === id)!;
    expect(copy.label).toBe('Fireflies (2)');
    expect(copy.layers).toHaveLength(4);
    const byLabel = (label: string) => play.layers.find(l => l.label === label) as unknown as Record<string, unknown>;
    const n2 = byLabel('N (2)'), p2 = byLabel('P (2)'), s2 = byLabel('S (2)'), m2 = byLabel('M (2)');
    expect(p2.nullId).toBe(n2.id);
    expect((s2.trackMatte as { id: string }).id).toBe(m2.id);
    // Placed after the original, as one block.
    expect(order(play).slice(0, 8)).toEqual(['n', 'p', 's', 'm', n2.id, p2.id, s2.id, m2.id]);
    expect(play.controls).toEqual(p.controls);
    expect(play.mappings).toEqual(p.mappings);
    expect(play.actions).toEqual(p.actions);
    // A second copy counts on.
    expect(duplicateGroup(play, id, false).play.groups!.map(g => g.label)).toContain('Fireflies (3)');
  });

  it('with controls and mappings: those are copied and every layer id in them retargeted', () => {
    // As the app holds it: the action on the group's layer is a rule.
    const p = normalizeRules(hooked());
    const { play } = duplicateGroup(p, 'g', true);
    const id = (label: string) => play.layers.find(l => l.label === label)!.id;
    const n2 = id('N (2)'), p2 = id('P (2)'), s2 = id('S (2)');
    const newControls = play.controls.slice(p.controls.length);
    expect(newControls.map(c => [c.target, c.label])).toEqual([[`layer:${p2}::speed`, 'P (2) · Speed'], [`act:${p2}::burst`, 'P (2) · Burst']]);
    const newMaps = play.mappings.slice(p.mappings.length);
    expect(newMaps.map(m => m.controlId)).toEqual(newControls.map(c => c.id));
    expect(newMaps[0].source).toEqual({ kind: 'null', layerId: n2, axis: 'x' });
    expect(newMaps[1].source).toMatchObject({ kind: 'trigger', trigger: { on: 'proximity', a: n2, b: s2 } });
    // A control outside the group keeps its one mapping.
    expect(play.mappings.filter(m => m.controlId === 'c3')).toHaveLength(1);
    const newRules = play.signals!.slice(p.signals!.length);
    expect(newRules).toHaveLength(1);
    expect(newRules[0].inputs![0]).toMatchObject({ kind: 'trigger', trigger: { on: 'zone', layerId: s2 } });
    expect(newRules[0].do![0]).toMatchObject({ layerId: p2 });
    expect(newRules[0].do![0].id).not.toBe('a1');
    // The originals are untouched, and the copy round-trips.
    expect(play.controls.slice(0, 3)).toEqual(p.controls);
    expect(parsePlayRecord(JSON.parse(JSON.stringify(play)))).toEqual(play);
  });

  it('copies nested groups inside it, pointed at the copy', () => {
    let p = createGroup(six(), [layer('b'), layer('c')], { id: 'inner' }).play;
    p = createGroup(p, [group('inner'), layer('d')], { id: 'outer', label: 'Outer' }).play;
    const { play, id } = duplicateGroup(p, 'outer', false);
    const inner2 = play.groups!.find(g => g.parent === id)!;
    expect(inner2.label).toBe('Group (2)');
    expect(groupLayerIds(play, id)).toHaveLength(3);
    expect(groupLayerIds(play, inner2.id)).toHaveLength(2);
  });

  it('delete removes the group with its layers and what uses them', () => {
    const p = removeGroup(hooked(), 'g');
    expect(order(p)).toEqual(['out']);
    expect(p.controls.map(c => c.id)).toEqual(['c3']);
    expect(p.actions!.map(a => a.id)).toEqual(['a2']);
    expect(p.groups).toBeUndefined();
  });
});

describe('what a group card shows', () => {
  it('live parameters: controls, action buttons, nulls that drive mappings, settings that follow a null', () => {
    const p = rec([
      L('null', 'n'), L('particles', 'p', { spawn: 'null', nullId: 'n' }), L('text', 't'),
    ], {
      controls: [{ id: 'c1', target: 'layer:p::speed', kind: 'float', label: 'Whatever', min: 0, max: 3 }, { id: 'c2', target: 'act:p::burst', kind: 'action', label: 'P · Burst', min: 0, max: 1 }],
      mappings: [{ id: 'm', controlId: 'c1', source: { kind: 'null', layerId: 'n', axis: 'x' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
      groups: [G('g', ['n', 'p', 't'])],
    });
    const params = liveParams(p, 'g');
    expect(params.map(x => `${x.kind} ${x.label}`)).toEqual(['prop N · X', 'prop N · Y', 'prop P · Speed', 'action P · Burst', 'follow P · Null']);
  });
});

describe('saved form', () => {
  it('round-trips, and files without groups read back unchanged', () => {
    let p = createGroup(six(), [layer('b'), layer('c')], { id: 'inner' }).play;
    p = createGroup(p, [group('inner'), layer('d')], { id: 'outer' }).play;
    p = { ...p, groups: p.groups!.map(g => (g.id === 'inner' ? { ...g, hidden: true as const, colour: 'peach' as const, label: 'Fireflies' } : g)) };
    expect(parsePlayRecord(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const old = six();
    const back = parsePlayRecord(JSON.parse(JSON.stringify(old)));
    expect('groups' in back).toBe(false);
  });

  it('drops what doesn’t fit: unknown layers, the Background, a layer in two groups, loops, empty groups; and rejoins split members', () => {
    const raw = {
      ...six(),
      groups: [
        { id: 'g1', label: '', colour: 'nope', layers: ['a', 'e', 'bg', 'ghost'] },
        { id: 'g2', label: 'Two', colour: 'teal', layers: ['a', 'c'], parent: 'g3' },
        { id: 'g3', label: 'Three', colour: 'red', layers: ['d'], parent: 'g2' },
        { id: 'g4', label: 'Empty', colour: 'red', layers: ['ghost'] },
        { id: 'a', label: 'Clashes with a layer id', colour: 'red', layers: ['b'] },
        'junk',
      ],
    };
    const p = parsePlayRecord(JSON.parse(JSON.stringify(raw)));
    expect(p.groups).toEqual([
      { id: 'g1', label: 'Group', colour: 'mauve', layers: ['a', 'e'] },
      { id: 'g2', label: 'Two', colour: 'teal', layers: ['c'] },
      { id: 'g3', label: 'Three', colour: 'red', layers: ['d'], parent: 'g2' },
    ]);
    // g1's layers are together, where a was.
    expect(order(p).slice(0, 3)).toEqual(['bg', 'a', 'e']);
  });
});
