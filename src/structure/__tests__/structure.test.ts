/**
 * Structure hints (docs/structure-hints.md): the stage map, flow detection, the next stage, the
 * ranking boost, order notices, arrange by stage and the strip's remembered visibility.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
  clear: () => mem.clear(),
});

import { NODE_REGISTRY } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { CATEGORY_STAGE, FLOWS, FLOW_ORDER, STAGES, TYPE_STAGE, inFlow, stageEntry, stageOfType, type FlowId, type StageId } from '../stages';
import { detectFlow, nextStage, outputStage, readFlow, stagesPresent } from '../flow';
import { orderNotices } from '../notices';
import { arrangeByStage, stageColumns } from '../arrange';
import { inTargetStage, nudgeByStage, STAGE_BOOST } from '../boost';
import { currentStageTarget, reloadStructurePrefs, STRIP_KEY, TAGS_KEY, NOTICES_KEY, DISMISSED_KEY, useStructureHints, graphKey } from '../hintsStore';
import { typesForStage } from '../browse';
import { BUILDER_FLOWS } from '../builders';
import { BUILDER_HELP } from '../../components/builders/helpContent';
import { rankMoves } from '../../suggestions/rank';
import { CoTable } from '../../suggestions/usage';

const examples = () => Object.entries(EXAMPLE_GRAPHS)
  .map(([k, g]) => [k, (g as { nodes?: GraphNode[] }).nodes ?? []] as const)
  .filter(([, nodes]) => nodes.length > 0);

// ── The stage map ───────────────────────────────────────────────────────────

describe('stage map', () => {
  it('gives every registered node a stage or an explicit "any"', () => {
    const missing = Object.keys(NODE_REGISTRY).filter(t => !stageEntry(t));
    expect(missing).toEqual([]);
  });

  it('maps every registry category (so a new node in a known category is covered)', () => {
    const cats = [...new Set(Object.values(NODE_REGISTRY).map(d => d.category))];
    expect(cats.filter(c => !(c in CATEGORY_STAGE))).toEqual([]);
  });

  it('has no overrides for types that no longer exist', () => {
    expect(Object.keys(TYPE_STAGE).filter(t => !NODE_REGISTRY[t])).toEqual([]);
  });

  it('puts the common nodes where the flows say', () => {
    expect(stageOfType('uv')).toBe('space');
    expect(stageOfType('polarSpace')).toBe('bend');
    expect(stageOfType('circleSDF')).toBe('shape');
    expect(stageOfType('fbm')).toBe('shape');
    expect(stageOfType('light')).toBe('shapeIt');
    expect(stageOfType('palette')).toBe('colour');
    expect(stageOfType('toneMap')).toBe('post');
    expect(stageOfType('vignette')).toBe('post');
    expect(stageOfType('marchCamera')).toBe('camera');
    expect(stageOfType('sphereSDF3D')).toBe('objects');
    expect(stageOfType('rayMarch')).toBe('march');
    expect(stageOfType('softShadow')).toBe('light');
    expect(stageOfType('pass')).toBe('pass');
    expect(stageOfType('agentSense')).toBe('sense');
    expect(stageOfType('trailField')).toBe('trail');
    expect(stageOfType('add')).toBe('any');
    expect(stageOfType('time')).toBe('any');
    expect(stageOfType('exprNode')).toBe('any');
    expect(stageOfType('no-such-node')).toBe('any');
  });

  it('every flow names known stages, its aliases land on its own stages, and its colours are distinct', () => {
    for (const f of FLOW_ORDER) {
      const flow = FLOWS[f];
      for (const s of flow.stages) expect(STAGES[s]).toBeDefined();
      for (const to of Object.values(flow.alias)) expect(flow.stages).toContain(to);
      const accents = flow.stages.map(s => STAGES[s].accent);
      expect(new Set(accents).size).toBe(accents.length);
      // Every stage reads as something in every flow.
      for (const s of Object.keys(STAGES) as StageId[]) expect(inFlow(s, f)).not.toBeNull();
    }
  });

  it('lists a stage’s nodes for the browser without another flow’s own kinds', () => {
    const shape2d = typesForStage('2d', 'shape').map(x => x.type);
    expect(shape2d).toContain('circleSDF');
    expect(shape2d).toContain('sdfUnion');
    expect(shape2d).not.toContain('sphereSDF3D');
    const colour2d = typesForStage('2d', 'colour').map(x => x.type);
    expect(colour2d).toContain('palette');
    expect(colour2d).not.toContain('toneMap');
    expect(typesForStage('3d', 'objects').map(x => x.type)).toContain('sphereSDF3D');
  });
});

// ── Flows ───────────────────────────────────────────────────────────────────

const graph2d = () => [
  n('uv', 'u', 0, 0),
  n('circleSDF', 'c', 0, 0, {}, { position: ['u', 'uv'] }),
  n('light', 'g', 0, 0, {}, { distance: ['c', 'distance'] }),
  n('output', 'o', 0, 0, {}, { color: ['g', 'tinted'] }),
];

describe('flow detection', () => {
  it('reads a plain picture as 2D', () => {
    expect(detectFlow(graph2d())).toBe('2d');
    expect(detectFlow([])).toBe('2d');
  });

  it('reads a camera and a march as 3D', () => {
    const nodes = [
      n('uv', 'u', 0, 0), n('marchCamera', 'cam', 0, 0, {}, { uv: ['u', 'uv'] }),
      n('rayMarch', 'm', 0, 0, {}, { uv: ['u', 'uv'] }), n('output', 'o', 0, 0, {}, { color: ['m', 'color'] }),
    ];
    expect(detectFlow(nodes)).toBe('3d');
  });

  it('reads a Pass as passes, even with a 2D picture inside', () => {
    const nodes = [...graph2d().slice(0, 3), n('pass', 'p', 0, 0, {}, { color: ['g', 'tinted'] }), n('sampleTexture', 's', 0, 0, {}, { texture: ['p', 'texture'] }), n('output', 'o', 0, 0, {}, { color: ['s', 'color'] })];
    expect(detectFlow(nodes)).toBe('pass');
  });

  it('reads agents as agents', () => {
    const nodes = [n('agentsGroup', 'a', 0, 0), n('drawAgents', 'd', 0, 0, {}, { agents: ['a', 'agents'] }), n('output', 'o', 0, 0, {}, { color: ['d', 'color'] })];
    expect(detectFlow(nodes)).toBe('agents');
  });

  it('agrees with the bundled examples', () => {
    const want: Record<string, FlowId> = { ringGlow: '2d', neonGlow: '2d', learn3dLight: '3d', raymarchSpheres: '3d', gridRulesLife: 'pass', passFeedbackTrails: 'pass', slimeMold: 'agents', agentBoids: 'agents' };
    for (const [k, f] of Object.entries(want)) {
      const nodes = (EXAMPLE_GRAPHS[k] as { nodes: GraphNode[] }).nodes;
      expect([k, detectFlow(nodes)]).toEqual([k, f]);
    }
  });

  it('lights the stages the graph has', () => {
    expect([...stagesPresent(graph2d(), '2d')].sort()).toEqual(['shape', 'shapeIt', 'space']);
  });
});

describe('next stage', () => {
  it('follows the flow’s order', () => {
    expect(nextStage('2d', null)).toBe('space');
    expect(nextStage('2d', 'space')).toBe('bend');
    expect(nextStage('2d', 'shape')).toBe('shapeIt');
    expect(nextStage('2d', 'colour')).toBe('post');
    expect(nextStage('2d', 'post')).toBeNull();
    expect(nextStage('3d', 'march')).toBe('light');
    expect(nextStage('pass', 'pass')).toBe('rule');
    expect(nextStage('agents', 'trail')).toBe('draw');
  });

  it('takes the Output’s stage from the furthest stage feeding it', () => {
    const nodes = graph2d();
    expect(outputStage(nodes, '2d')).toBe('shapeIt');
    expect(readFlow(nodes)).toMatchObject({ flow: '2d', current: 'shapeIt', next: 'colour' });
    // A shape that doesn't reach the Output doesn't count.
    const loose = [...nodes, n('palette', 'p', 0, 0), n('vignette', 'v', 0, 0, {}, { color: ['p', 'color'] })];
    expect(outputStage(loose, '2d')).toBe('shapeIt');
    expect(outputStage([n('circleSDF', 'c', 0, 0)], '2d')).toBeNull();
  });

  it('looks inside a group that feeds the Output', () => {
    const inner = [n('palette', 'ip', 0, 0), n('toneMap', 'it', 0, 0, {}, { color: ['ip', 'color'] })];
    const g = n('group', 'g', 0, 0, { subgraph: { nodes: inner, inputPorts: [], outputPorts: [] } });
    g.outputs = { out: { type: 'vec3', label: 'Out' } };
    const nodes = [g, n('output', 'o', 0, 0, {}, { color: ['g', 'out'] })];
    expect(outputStage(nodes, '2d')).toBe('post');
  });
});

// ── The boost ───────────────────────────────────────────────────────────────

describe('next-stage boost', () => {
  const tables = { table: new CoTable(), personal: new CoTable(), prior: new CoTable() };
  const nodes = [
    n('uv', 'u', 0, 0), n('fbm', 'f', 0, 0, {}, { uv: ['u', 'uv'] }),
    n('palette', 'p', 0, 0, {}, { value: ['f', 'value'] }), n('output', 'o', 0, 0, {}, { color: ['p', 'color'] }),
  ];
  const palette = nodes[2];

  it('is small: a move in the next stage gains STAGE_BOOST, nothing more', () => {
    expect(STAGE_BOOST).toBeGreaterThan(0);
    expect(STAGE_BOOST).toBeLessThan(0.5);
    const plain = rankMoves(palette, nodes, tables, { limit: 20 });
    const boosted = rankMoves(palette, nodes, tables, { limit: 20, stageTarget: { flow: '2d', stage: 'post' } });
    for (const b of boosted) {
      const p = plain.find(x => x.move.id === b.move.id)!;
      const inPost = inTargetStage(b.move.anchor?.type, { flow: '2d', stage: 'post' });
      expect([b.move.id, Math.round((b.score - p.score) * 1e6) / 1e6]).toEqual([b.move.id, inPost ? STAGE_BOOST : 0]);
    }
    // Tone map (a Post move) rises with the boost.
    const at = (list: typeof plain, id: string) => list.findIndex(x => x.move.id === id);
    expect(at(boosted, 'tone-map')).toBeLessThanOrEqual(at(plain, 'tone-map'));
    expect(at(boosted, 'tone-map')).toBe(0);
  });

  it('never beats a confident preview finding', () => {
    // A finding adds up to 4: far more than the boost.
    expect(STAGE_BOOST).toBeLessThan(4 * 0.25);
  });

  it('moves a quick-add pick up at most one place', () => {
    const t = { flow: '2d' as const, stage: 'post' as StageId };
    const list = ['palette', 'oklabMix', 'toneMap', 'vignette', 'hsv'];
    // Each Post pick rises one place (Tone map past OkLab Mix, then Vignette past it too).
    expect(nudgeByStage(list, x => x, t)).toEqual(['palette', 'toneMap', 'vignette', 'oklabMix', 'hsv']);
    expect(nudgeByStage(list, x => x, null)).toEqual(list);
    expect(nudgeByStage(['toneMap', 'palette'], x => x, t)).toEqual(['toneMap', 'palette']);
  });
});

// ── Order notices ───────────────────────────────────────────────────────────

const rules = (nodes: GraphNode[]) => orderNotices(nodes).map(x => x.rule);

describe('order notices', () => {
  it('flags a bend fed a colour whose result is shown as a colour', () => {
    const nodes = [
      n('uv', 'u', 0, 0), n('fbm', 'f', 0, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 0, 0, {}, { value: ['f', 'value'] }),
      n('uvWarp', 'w', 0, 0, {}, { input: ['p', 'color'] }), n('output', 'o', 0, 0, {}, { color: ['w', 'output'] }),
    ];
    expect(rules(nodes)).toEqual(['bend-after-colour']);
    expect(orderNotices(nodes)[0]).toMatchObject({ nodeId: 'w', path: [] });
  });

  it('leaves colour-to-space alone (the bend goes back into a shape)', () => {
    const nodes = [
      n('uv', 'u', 0, 0), n('fbm', 'f', 0, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 0, 0, {}, { value: ['f', 'value'] }),
      n('uvWarp', 'w', 0, 0, {}, { input: ['p', 'color'] }), n('circleSDF', 'c', 0, 0, {}, { position: ['w', 'output'] }),
      n('light', 'g', 0, 0, {}, { distance: ['c', 'distance'] }), n('output', 'o', 0, 0, {}, { color: ['g', 'tinted'] }),
    ];
    expect(rules(nodes)).toEqual([]);
  });

  it('flags Bloom after a Tone map, not before it', () => {
    const base = graph2d().slice(0, 3);
    const after = [...base, n('toneMap', 't', 0, 0, {}, { color: ['g', 'tinted'] }), n('bloom', 'b', 0, 0, {}, { color: ['t', 'color'] }), n('output', 'o', 0, 0, {}, { color: ['b', 'result'] })];
    expect(rules(after)).toEqual(['glow-after-tonemap']);
    const before = [...base, n('bloom', 'b', 0, 0, {}, { color: ['g', 'tinted'] }), n('toneMap', 't', 0, 0, {}, { color: ['b', 'result'] }), n('output', 'o', 0, 0, {}, { color: ['t', 'color'] })];
    expect(rules(before)).toEqual([]);
  });

  it('flags noise mixed in after a finish, not noise that goes through it', () => {
    const base = [...graph2d().slice(0, 3), n('fbm', 'f', 0, 0, {}, { uv: ['u', 'uv'] })];
    const late = [...base, n('vignette', 'v', 0, 0, {}, { color: ['g', 'tinted'] }), n('addColor', 'a', 0, 0, {}, { a: ['v', 'result'], b: ['f', 'value'] }), n('output', 'o', 0, 0, {}, { color: ['a', 'result'] })];
    expect(rules(late)).toEqual(['noise-after-post']);
    const early = [...base, n('addColor', 'a', 0, 0, {}, { a: ['g', 'tinted'], b: ['f', 'value'] }), n('vignette', 'v', 0, 0, {}, { color: ['a', 'result'] }), n('output', 'o', 0, 0, {}, { color: ['v', 'result'] })];
    expect(rules(early)).toEqual([]);
  });

  it('leaves feedback alone', () => {
    const nodes = [
      n('uv', 'u', 0, 0), n('prevFrame', 'pf', 0, 0, {}, { uv: ['u', 'uv'] }),
      n('toneMap', 't', 0, 0, {}, { color: ['pf', 'color'] }), n('bloom', 'b', 0, 0, {}, { color: ['t', 'color'] }), n('output', 'o', 0, 0, {}, { color: ['b', 'result'] }),
    ];
    expect(rules(nodes)).toEqual([]);
  });

  it('looks into plain groups but not iterated ones', () => {
    const inner = () => [n('palette', 'ip', 0, 0), n('toneMap', 'it', 0, 0, {}, { color: ['ip', 'color'] }), n('bloom', 'ib', 0, 0, {}, { color: ['it', 'color'] }), n('output', 'io', 0, 0, {}, { color: ['ib', 'result'] })];
    const plain = n('group', 'g', 0, 0, { iterations: 1, subgraph: { nodes: inner(), inputPorts: [], outputPorts: [] } });
    expect(orderNotices([plain]).map(x => [x.rule, x.path])).toEqual([['glow-after-tonemap', ['g']]]);
    const looped = n('group', 'g', 0, 0, { iterations: 4, subgraph: { nodes: inner(), inputPorts: [], outputPorts: [] } });
    expect(orderNotices([looped])).toEqual([]);
  });

  it('flags almost none of the bundled examples (under 2%)', () => {
    const all = examples();
    const flagged = all.filter(([, nodes]) => orderNotices(nodes).length > 0).map(([k]) => k);
    expect(all.length).toBeGreaterThan(300);
    expect(flagged.length / all.length).toBeLessThan(0.02);
  });
});

// ── Arrange by stage ────────────────────────────────────────────────────────

describe('arrange by stage', () => {
  const nodes = [
    n('output', 'o', 0, 0, {}, { color: ['v', 'result'] }),
    n('vignette', 'v', 900, 900, {}, { color: ['p', 'color'] }),
    n('palette', 'p', 50, 50, {}, { value: ['g', 'glow'] }),
    n('light', 'g', 10, 400, {}, { distance: ['c', 'distance'] }),
    n('circleSDF', 'c', 300, 0, {}, { position: ['w', 'output'], radius: ['m', 'result'] }),
    n('multiply', 'm', 0, 0, {}, { a: ['t', 'time'] }),
    n('time', 't', 0, 0),
    n('polarSpace', 'w', 0, 0, {}, { input: ['u', 'uv'] }),
    n('uv', 'u', 800, 800),
    n('fbm', 'f', 0, 0, {}, { uv: ['u', 'uv'] }),
  ];

  it('puts stages in left-to-right columns, then the Output', () => {
    const pos = arrangeByStage(nodes, { heightOf: () => 100 });
    const x = (id: string) => pos.get(id)!.x;
    const order = ['u', 'w', 'c', 'g', 'p', 'v', 'o'];
    for (let i = 1; i < order.length; i++) expect(x(order[i])).toBeGreaterThan(x(order[i - 1]));
    // Maths sits with the stage it feeds; noise is a shape.
    expect(x('m')).toBe(x('c'));
    expect(x('t')).toBe(x('c'));
    expect(x('f')).toBe(x('c'));
  });

  it('never overlaps two cards', () => {
    const h = (nd: GraphNode) => (nd.id === 'c' ? 260 : 120);
    const pos = arrangeByStage(nodes, { heightOf: h });
    const boxes = nodes.map(nd => ({ id: nd.id, ...pos.get(nd.id)!, w: 360, h: h(nd) }));
    for (const a of boxes) for (const b of boxes) {
      if (a.id >= b.id) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect([a.id, b.id, overlap]).toEqual([a.id, b.id, false]);
    }
  });

  it('drops empty columns', () => {
    const cols = stageColumns(nodes, '2d');
    const pos = arrangeByStage(nodes, { heightOf: () => 100, colW: 400, startX: 0 });
    const xs = [...new Set([...pos.values()].map(p => p.x))].sort((a, b) => a - b);
    expect(xs).toEqual(xs.map((_, i) => i * 400));
    expect(new Set(cols.values()).size).toBe(xs.length);
  });

  it('keeps a loose group’s members together in one column', () => {
    const pos = arrangeByStage(nodes, { heightOf: () => 100, looseGroups: [{ id: 'lg', label: 'look', memberIds: ['p', 'v', 'g'], collapsed: false, position: { x: 0, y: 0 } }] });
    const xs = new Set(['p', 'v', 'g'].map(id => pos.get(id)!.x));
    expect(xs.size).toBe(1);
    const col = [...pos.entries()].filter(([, p]) => p.x === [...xs][0]).sort((a, b) => a[1].y - b[1].y).map(([id]) => id);
    const at = col.map(id => ['p', 'v', 'g'].includes(id));
    // Members are one run in the column.
    expect(at.join('').replace(/(true)+/g, 'R')).not.toMatch(/R.*false.*R/);
  });
});

// ── Preferences ─────────────────────────────────────────────────────────────

describe('strip visibility and preferences', () => {
  beforeEach(() => { mem.clear(); reloadStructurePrefs(); });

  it('shows by default and remembers being hidden', () => {
    expect(useStructureHints.getState().stripOn).toBe(true);
    useStructureHints.getState().setStrip(false);
    expect(mem.get(STRIP_KEY)).toBe('0');
    useStructureHints.setState({ stripOn: true });
    reloadStructurePrefs();
    expect(useStructureHints.getState().stripOn).toBe(false);
    useStructureHints.getState().setStrip(true);
    reloadStructurePrefs();
    expect(useStructureHints.getState().stripOn).toBe(true);
  });

  it('gives no boost while the strip is hidden', () => {
    useStructureHints.getState().setTarget({ flow: '2d', stage: 'colour' });
    expect(currentStageTarget()).toEqual({ flow: '2d', stage: 'colour' });
    useStructureHints.getState().setStrip(false);
    expect(currentStageTarget()).toBeNull();
  });

  it('remembers tags, notices and dismissals per graph', () => {
    const s = useStructureHints.getState();
    s.setTags(false);
    s.setNotices(false);
    s.dismiss(graphKey('My graph'), 'glow-after-tonemap:b');
    s.dismiss(graphKey('My graph'), 'glow-after-tonemap:b');
    reloadStructurePrefs();
    const r = useStructureHints.getState();
    expect([r.tagsOn, r.noticesOn]).toEqual([false, false]);
    expect(r.dismissed['My graph']).toEqual(['glow-after-tonemap:b']);
    expect(r.dismissed[graphKey(null)]).toBeUndefined();
    expect([mem.has(TAGS_KEY), mem.has(NOTICES_KEY), mem.has(DISMISSED_KEY)]).toEqual([true, true, true]);
  });
});

// ── Builders ────────────────────────────────────────────────────────────────

describe('builder flows', () => {
  it('describe stages of their own flow, and point empty sections at a stage', () => {
    for (const [key, bf] of Object.entries(BUILDER_FLOWS)) {
      expect(BUILDER_HELP[key as keyof typeof BUILDER_HELP]).toBeDefined();
      for (const s of Object.keys(bf.lines)) expect(FLOWS[bf.flow].stages).toContain(s);
      for (const [section, s] of Object.entries(bf.emptyNext)) {
        expect(BUILDER_HELP[key as keyof typeof BUILDER_HELP][section]).toBeDefined();
        expect(FLOWS[bf.flow].stages).toContain(s);
      }
    }
    expect(BUILDER_FLOWS['scene-builder'].flow).toBe('3d');
    expect(BUILDER_FLOWS['grid-rules'].flow).toBe('pass');
    expect(BUILDER_FLOWS['agent-rules'].flow).toBe('agents');
  });
});
