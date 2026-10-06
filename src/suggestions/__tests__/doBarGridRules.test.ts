/**
 * Grid Rules phrases in the Do… bar (suggestions/doBarGridRules.ts): preset names → a Grid Rules
 * node with that preset, the optional slots, where the node goes, and that the result compiles.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { estimateNodeHeight } from '../../store/graphLayout';
import type { GraphNode } from '../../types/nodeGraph';
import { parseDo, runDoPlan, type DoContext } from '../doBar';
import { GRID_PHRASES, readGridRules } from '../doBarGridRules';
import { matchingPreset } from '../../gridRules/spec';
import { graphOutput } from '../../nodes/scene3dDefaults';

const H = (nd: GraphNode) => estimateNodeHeight(nd);
const EMPTY: DoContext = { nodes: [n('output', 'o', 900, 0)], selected: [] };
const NOTHING: DoContext = { nodes: [], selected: [] };
const CIRCLE: DoContext = {
  nodes: [n('uv', 'u', 0, 0), n('circleSDF', 'c', 420, 0, {}, { position: ['u', 'uv'] }), n('sdfFill', 'f', 840, 0, {}, { d: ['c', 'distance'] }), n('output', 'o', 1260, 0, {}, { color: ['f', 'result'] })],
  selected: ['c'],
};

const presetOf = (phrase: string, ctx: DoContext = EMPTY) => {
  const p = parseDo(phrase, ctx);
  const s = p.steps[0];
  return p.steps.length === 1 && s.kind === 'gridRules' ? s.preset : `not grid: ${p.steps.map(x => x.kind).join(',') || p.problem || 'nothing'}`;
};

const PHRASES: Array<[string, string]> = [
  ['game of life', 'count:life'],
  ["conway's game of life", 'count:life'],
  ['add a game of life', 'count:life'],
  ['highlife', 'count:highLife'],
  ['seeds', 'count:seeds'],
  ['day and night', 'count:dayNight'],
  ['day & night', 'count:dayNight'],
  ["brian's brain", 'stages:briansBrain'],
  ['brians brain', 'stages:briansBrain'],
  ['caves', 'count:caves'],
  ['make caves', 'count:caves'],
  ['heat', 'smooth:heat'],
  ['heat diffusion', 'smooth:heat'],
  ['water ripples', 'smooth:ripples'],
  ['reaction diffusion', 'smooth:mitosis'],
  ['reaction-diffusion', 'smooth:mitosis'],
  ['falling sand', 'blocks:sand'],
  ['wireworld', 'patterns:wireworld'],
  ['gas', 'blocks:gas'],
  ['life without death', 'count:lifeWithoutDeath'],
  ['star wars', 'stages:starWars'],
  ['coral growth', 'smooth:coralRd'],
  ['coral', 'count:coral'],
  ['ripples grid', 'smooth:ripples'],
  ['swirl simulation', 'stages:swirl'],
];

describe('Grid Rules phrases', () => {
  for (const [phrase, preset] of PHRASES) it(`“${phrase}” → ${preset}`, () => expect(presetOf(phrase)).toBe(preset));

  it('every preset has a phrase that reads as it', () => {
    for (const ph of GRID_PHRASES) expect((readGridRules(ph.words[0]) ?? readGridRules(`${ph.words[0]} grid`))?.phrase.id, ph.words[0]).toBe(ph.id);
  });

  it('words that are also Do… bar actions or shapes stay actions without a grid word', () => {
    expect(presetOf('ripples', CIRCLE)).toMatch(/^not grid/);
    expect(presetOf('add ripples', CIRCLE)).toMatch(/^not grid/);
    expect(presetOf('swirl the space 3', CIRCLE)).toMatch(/^not grid/);
    expect(presetOf('diamonds', EMPTY)).toMatch(/^not grid/);
    expect(presetOf('circle with a glow', EMPTY)).toMatch(/^not grid/);
    // A preset name with a word that isn't a slot is not a Grid Rules phrase
    expect(presetOf('heat with a glow', CIRCLE)).toMatch(/^not grid/);
  });

  it('the preset is applied: the node matches it, with the look its type brings', () => {
    for (const [phrase] of PHRASES) {
      const s = parseDo(phrase, EMPTY).steps[0];
      if (s.kind !== 'gridRules') throw new Error(phrase);
      expect(matchingPreset(s.params), phrase).toBe(s.preset.split(':')[1]);
    }
    const life = parseDo('game of life', EMPTY).steps[0];
    expect(life.kind === 'gridRules' && life.params.ruleType).toBe('count');
    const caves = parseDo('caves', EMPTY).steps[0];
    expect(caves.kind === 'gridRules' && caves.params.density).toBe(0.45);
  });

  it('slots: board size, speed, colours', () => {
    const params = (phrase: string) => { const s = parseDo(phrase, EMPTY).steps[0]; if (s.kind !== 'gridRules') throw new Error(phrase); return s.params; };
    expect(params('game of life on a chunky board').board).toBe('0.0625');
    expect(params('fine game of life').board).toBe('0.5');
    expect(params('game of life, big cells').board).toBe('0.0625');
    expect(params('game of life 240 cells across').board).toBe('0.125');
    expect(params('seeds board 100').board).toBe('0.0625');
    expect(params('falling sand, slow').rate).toBe(0.2);
    expect(params('heat speed 0.7').rate).toBe(0.7);
    expect(params('game of life fast')).toMatchObject({ rate: 1 });
    expect(params('game of life speed 4')).toMatchObject({ rate: 1, steps: 4 });
    expect(params('game of life in green on black')).toMatchObject({ color1: [0.2, 0.85, 0.35], color0: [0, 0, 0] });
    expect(params('heat red')).toMatchObject({ color3: [1, 0.15, 0.12] });
    expect(params('brians brain, navy background, chunky board, slow')).toMatchObject({ color0: [0.05, 0.1, 0.4], board: '0.0625', rate: 0.2 });
    const plan = parseDo('game of life on a chunky board, fast, green', EMPTY);
    expect(plan.steps[0].label).toBe('Add Grid Rules (Life) · board chunky, speed 1, colours');
    expect(plan.reading.map(r => r.as)).toEqual(['do: grid rules (Life)', 'board 0.0625', 'speed 1', 'colour: live cells']);
  });

  let k = 0;
  const nextId = () => `g${k++}`;
  it('an empty graph: Color goes to the Output', () => {
    const r = runDoPlan(EMPTY.nodes, parseDo('game of life', EMPTY), nextId, { heightOf: H });
    const g = r.nodes.find(nd => nd.type === 'gridRules')!;
    expect(graphOutput(r.nodes)?.inputs.color?.connection).toEqual({ nodeId: g.id, outputKey: 'color' });
    expect(r.select).toBe(g.id);
    const res = compileGraph({ nodes: r.nodes });
    expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
  });

  it('no nodes at all: an Output is made for it', () => {
    const r = runDoPlan(NOTHING.nodes, parseDo('falling sand', NOTHING), nextId, { heightOf: H });
    expect(r.nodes.map(nd => nd.type).sort()).toEqual(['gridRules', 'output']);
    expect(graphOutput(r.nodes)?.inputs.color?.connection?.outputKey).toBe('color');
  });

  it('a graph with work in it: beside the selection, unwired, and the Output keeps what it shows', () => {
    const r = runDoPlan(CIRCLE.nodes, parseDo('heat', CIRCLE), nextId, { heightOf: H });
    const g = r.nodes.find(nd => nd.type === 'gridRules')!;
    const sel = CIRCLE.nodes.find(nd => nd.id === 'c')!;
    expect(g.position.x).toBe(sel.position.x + 420);
    expect(g.position.y).toBeGreaterThanOrEqual(sel.position.y);
    expect(graphOutput(r.nodes)?.inputs.color?.connection).toEqual({ nodeId: 'f', outputKey: 'result' });
    // Nothing overlaps it
    for (const nd of CIRCLE.nodes) {
      const overlapX = Math.abs(nd.position.x - g.position.x) < 360;
      const overlapY = nd.position.y < g.position.y + H(g) && g.position.y < nd.position.y + H(nd);
      expect(overlapX && overlapY, nd.id).toBe(false);
    }
  });

  it('every listed phrase compiles on an empty graph', () => {
    for (const [phrase] of PHRASES) {
      const r = runDoPlan(EMPTY.nodes, parseDo(phrase, EMPTY), nextId, { heightOf: H });
      const res = compileGraph({ nodes: r.nodes });
      expect(res.errors, `${phrase}: ${JSON.stringify(res.errors)}`).toBeUndefined();
    }
  });
});
