/**
 * The node search's logic (nodeSearchModel.ts, docs/node-browser.md "Node search"): match tiers,
 * ranking, related nodes, wire filters, category tiles and keyboard moves.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
});

import type { NodeDefinition } from '../../../types/nodeGraph';
import { getNodeDefinition, getOfferedDefinitions } from '../../../nodes/definitions';
import { TIER, categorySections, navMove, passesWireFilter, rankMatches, rankRelated, textMatch, wordsOf, type NavSection } from '../nodeSearchModel';

const fake = (type: string, label: string, extra: Partial<NodeDefinition> = {}): NodeDefinition =>
  ({ type, label, category: 'Math', inputs: {}, outputs: {}, generateGLSL: () => ({ code: '', outputVars: {} }), ...extra }) as unknown as NodeDefinition;

describe('text match tiers', () => {
  it('splits words on spaces and camelCase', () => {
    expect(wordsOf('Gaussian Blur')).toEqual(['gaussian', 'blur']);
    expect(wordsOf('sdBoxFrame')).toEqual(['sd', 'box', 'frame']);
  });

  it('grades exact, prefix, word prefix, fuzzy and keyword matches', () => {
    const circle = getNodeDefinition('circleSDF')!;
    expect(textMatch(circle, 'circle sdf')?.tier).toBe(TIER.exact);
    expect(textMatch(circle, 'circ')?.tier).toBe(TIER.prefix);
    expect(textMatch(circle, 'sdf')?.tier).toBe(TIER.word);
    expect(textMatch(circle, 'sdf circ')?.tier).toBe(TIER.word);
    expect(textMatch(circle, 'rcle')?.tier).toBe(TIER.fuzzy);
    expect(textMatch(circle, 'crclsdf')?.tier).toBe(TIER.fuzzy);
    // Transform's "leads for" words are keywords.
    expect(textMatch(getNodeDefinition('transform')!, 'translate')?.tier).toBe(TIER.keyword);
    expect(textMatch(circle, 'zzz')).toBeNull();
  });

  it('ranks exact before prefix before word before fuzzy before keyword', () => {
    const defs = [
      fake('kw', 'Something', { aliases: ['glow thing'] }),
      fake('fz', 'Aglowish'),
      fake('wd', 'Soft Glow Pass'),
      fake('px', 'Glow Layer'),
      fake('ex', 'Glow'),
    ];
    expect(rankMatches(defs, 'glow').map(m => m.def.type)).toEqual(['ex', 'px', 'wd', 'fz', 'kw']);
  });

  it('puts what fits where you are first within a tier, and other kinds of graph last', () => {
    const defs = [fake('a', 'Noise A'), fake('b', 'Noise B'), fake('c', 'Noise C')];
    expect(rankMatches(defs, 'noise', { context: t => (t === 'c' ? 1 : 0) }).map(m => m.def.type)).toEqual(['c', 'a', 'b']);
    expect(rankMatches(defs, 'noise', { misfit: d => d.type === 'a' }).map(m => m.def.type)).toEqual(['b', 'c', 'a']);
    // Never above a better tier.
    const tiers = [fake('x', 'Noise'), fake('y', 'Noise Field')];
    expect(rankMatches(tiers, 'noise', { context: t => (t === 'y' ? 1 : 0) }).map(m => m.def.type)).toEqual(['x', 'y']);
  });
});

describe('related nodes', () => {
  const defs = [fake('glow', 'Glow'), fake('fill', 'Fill'), fake('pal', 'Palette'), fake('noise', 'Noise')];
  it('lists what usually goes with the node you came from, then recent ones, without the matches', () => {
    const r = rankRelated(defs, {
      fromType: 'circle', fromLabel: 'Circle', affinity: t => (t === 'glow' ? 0.4 : t === 'fill' ? 0.1 : 0),
      follows: new Map([['fill', 4], ['glow', 2]]), recents: ['noise'],
    }, new Set(['pal']));
    expect(r.map(x => x.def.type)).toEqual(['glow', 'fill', 'noise']);
    expect(r[0].why).toBe('Usually goes with Circle');
    expect(r[2].why).toBe('Used recently');
  });
  it('is empty with no context', () => {
    expect(rankRelated(defs, {})).toEqual([]);
  });
});

describe('wire filters', () => {
  it('keeps nodes that take or give the wire’s type', () => {
    const takesVec2 = fake('a', 'A', { inputs: { p: { type: 'vec2', label: 'P' } } as never, outputs: { o: { type: 'vec3', label: 'O' } } as never });
    expect(passesWireFilter(takesVec2, undefined, 'vec2')).toBe(true);
    expect(passesWireFilter(takesVec2, undefined, 'vec3')).toBe(false);
    expect(passesWireFilter(takesVec2, 'vec3')).toBe(true);
    expect(passesWireFilter(takesVec2, 'vec2')).toBe(false);
    expect(passesWireFilter(fake('exprNode', 'Expr'), undefined, 'mat2')).toBe(true);
  });
});

describe('category tiles', () => {
  it('lists the library rows by section with their counts', () => {
    const secs = categorySections(() => true);
    const all = secs.flatMap(s => s.tiles);
    const noise = all.find(t => t.row === 'Noise')!;
    expect(noise.count).toBeGreaterThan(3);
    expect(noise.preview.length).toBe(3);
    expect(secs.map(s => s.label)).toContain('3D tools');
    // A filter that lets nothing through leaves no tiles.
    expect(categorySections(() => false)).toEqual([]);
    // Counts follow the filter.
    const only = getOfferedDefinitions().find(d => d.category === 'Noise')!;
    expect(categorySections(d => d.type === only.type).flatMap(s => s.tiles).map(t => t.count)).toEqual([1]);
  });
});

describe('keyboard moves', () => {
  const secs: NavSection[] = [{ layout: 'grid', count: 6 }, { layout: 'list', count: 3 }, { layout: 'grid', count: 0 }, { layout: 'grid', count: 2 }];
  it('moves across a grid by columns and sideways by one', () => {
    expect(navMove(secs, { s: 0, i: 0 }, 'right', 4)).toEqual({ s: 0, i: 1 });
    expect(navMove(secs, { s: 0, i: 1 }, 'down', 4)).toEqual({ s: 0, i: 5 });
    expect(navMove(secs, { s: 0, i: 2 }, 'down', 4)).toEqual({ s: 0, i: 5 }); // a short last row: its last item
    expect(navMove(secs, { s: 0, i: 5 }, 'down', 4)).toEqual({ s: 1, i: 0 });
    expect(navMove(secs, { s: 0, i: 5 }, 'up', 4)).toEqual({ s: 0, i: 1 });
    expect(navMove(secs, { s: 1, i: 0 }, 'up', 4)).toEqual({ s: 0, i: 5 });
  });
  it('goes through a list by one and skips empty groups', () => {
    expect(navMove(secs, { s: 1, i: 2 }, 'down', 4)).toEqual({ s: 3, i: 0 });
    expect(navMove(secs, { s: 3, i: 0 }, 'left', 4)).toEqual({ s: 1, i: 2 });
  });
  it('Tab and Shift+Tab jump between groups, round the end', () => {
    expect(navMove(secs, { s: 0, i: 3 }, 'tab', 4)).toEqual({ s: 1, i: 0 });
    expect(navMove(secs, { s: 1, i: 1 }, 'tab', 4)).toEqual({ s: 3, i: 0 });
    expect(navMove(secs, { s: 3, i: 1 }, 'tab', 4)).toEqual({ s: 0, i: 0 });
    expect(navMove(secs, { s: 0, i: 0 }, 'shiftTab', 4)).toEqual({ s: 3, i: 0 });
  });
});
