/**
 * The node library's relevance (structure/relevance.ts): graph context on fixture graphs, the category
 * filter, "Fits here" ranking from a small corpus, the remembered toggle, and search badges.
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

import { getOfferedDefinitions } from '../../nodes/definitions';
import { scoreNodeDef } from '../../nodes/searchNodes';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { buildFollowCounts, categoryFits, libraryContext, misfitBadge, rankFits, splitCategories } from '../relevance';
import { RELEVANT_KEY, reloadLibraryPrefs, useLibraryPrefs } from '../libraryPrefs';

const container = (type: string, id: string, nodes: GraphNode[]): GraphNode => ({
  id, type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { subgraph: { nodes } },
} as unknown as GraphNode);

const plain2d = [n('uv', 'uv', 0, 0), n('circleSDF', 'c', 100, 0), n('output', 'out', 200, 0)];
const inScene = [n('sphereSDF3D', 'sp', 0, 0)];
const scene3d = [container('sceneGroup', 'sg', inScene), n('output', 'out', 200, 0)];
const agents = [container('agentsGroup', 'ag', [n('uv', 'uv', 0, 0)]), n('output', 'out', 200, 0)];

describe('graph context', () => {
  it('a plain picture is 2D', () => {
    expect(libraryContext(plain2d, [])).toEqual({ flow: '2d', inside: null });
  });
  it('a graph with a scene group is 3D, and inside the group too', () => {
    expect(libraryContext(scene3d, []).flow).toBe('3d');
    expect(libraryContext(scene3d, ['sg'])).toEqual({ flow: '3d', inside: 'sceneGroup' });
  });
  it('an Agents group is agents, inside and out', () => {
    expect(libraryContext(agents, []).flow).toBe('agents');
    expect(libraryContext(agents, ['ag'])).toEqual({ flow: 'agents', inside: 'agentsGroup' });
  });
  it('a plain group in a 2D graph stays 2D', () => {
    expect(libraryContext([container('group', 'g', [n('uv', 'uv', 0, 0)])], ['g']).flow).toBe('2d');
  });
});

describe('category filter', () => {
  it('hides 3D-only categories outside 3D, keeps them in 3D', () => {
    for (const c of ['3D Primitives', '3D Transforms', '3D Scene', '3D Lighting']) {
      expect(categoryFits(c, '2d')).toBe(false);
      expect(categoryFits(c, 'agents')).toBe(false);
      expect(categoryFits(c, '3d')).toBe(true);
    }
    expect(categoryFits('SDF', '2d')).toBe(true);
  });
  it('splits into fitting and not, with 3D ones first in 3D', () => {
    const cats = ['2D Primitives', 'SDF', '3D Primitives', 'Combiners', '3D Scene'];
    expect(splitCategories(cats, '2d')).toEqual({ fit: ['2D Primitives', 'SDF', 'Combiners'], other: ['3D Primitives', '3D Scene'] });
    const s3 = splitCategories(cats, '3d');
    expect(s3.other).toEqual([]);
    expect(s3.fit.slice(0, 2)).toEqual(['3D Primitives', '3D Scene']);
  });
});

describe('Fits here', () => {
  it('ranks followers by how often they follow in the corpus', () => {
    const defs = getOfferedDefinitions();
    const circle = defs.find(d => d.type === 'circleSDF')!;
    const circleOut = Object.keys(circle.outputs)[0];
    const firstIn = (type: string) => Object.keys(defs.find(d => d.type === type)!.inputs)[0];
    const g = (to: string, id: string) => {
      const b = n(to, `${id}b`, 100, 0);
      b.inputs[firstIn(to)].connection = { nodeId: `${id}a`, outputKey: circleOut };
      return { nodes: [n('circleSDF', `${id}a`, 0, 0), b] };
    };
    const counts = buildFollowCounts([g('sdfFill', 'x'), g('sdfFill', 'y'), g('sdfFill', 'z'), g('glowLayer', 'w')]);
    const outType = defs.find(d => d.type === 'circleSDF')!.outputs[circleOut].type;
    const fits = rankFits('circleSDF', outType, defs, counts).map(d => d.type);
    expect(fits[0]).toBe('sdfFill');
    expect(fits).toContain('glowLayer');
    expect(fits.indexOf('sdfFill')).toBeLessThan(fits.indexOf('glowLayer'));
  });
  it('is empty for a type the corpus never saw, and skips hidden types', () => {
    const defs = getOfferedDefinitions();
    expect(rankFits('circleSDF', 'float', defs, new Map())).toEqual([]);
    const counts = new Map([['circleSDF', new Map([['sdfFill', 5]])]]);
    expect(rankFits('circleSDF', 'float', defs, counts, 8, new Set(['sdfFill']))).toEqual([]);
  });
});

describe('search still finds hidden items, with the badge', () => {
  it('finds a 3D primitive in a 2D graph and marks it', () => {
    const def = getOfferedDefinitions().find(d => d.type === 'sphereSDF3D')!;
    expect(scoreNodeDef(def, 'sphere')).toBeGreaterThan(0);
    expect(misfitBadge(def.category, '2d')).toBe('3D only');
    expect(misfitBadge(def.category, '3d')).toBeNull();
    expect(misfitBadge('SDF', '2d')).toBeNull();
  });
});

describe('the toggle is remembered', () => {
  beforeEach(() => { mem.clear(); reloadLibraryPrefs(); });
  it('defaults on and persists', () => {
    expect(useLibraryPrefs.getState().relevantOnly).toBe(true);
    useLibraryPrefs.getState().setRelevantOnly(false);
    expect(mem.get(RELEVANT_KEY)).toBe('0');
    reloadLibraryPrefs();
    expect(useLibraryPrefs.getState().relevantOnly).toBe(false);
  });
});

describe('the bundled examples', () => {
  it('count Circle SDF followed by fills and glows, quickly enough to do once', async () => {
    const { EXAMPLE_GRAPHS } = await import('../../store/exampleGraphs');
    const t = performance.now();
    const counts = buildFollowCounts(Object.values(EXAMPLE_GRAPHS));
    const ms = performance.now() - t;
    const defs = getOfferedDefinitions();
    const outType = Object.values(defs.find(d => d.type === 'circleSDF')!.outputs)[0].type;
    const fits = rankFits('circleSDF', outType, defs, counts, 8).map(d => d.type);
    console.log('circleSDF fits', fits, `${Math.round(ms)}ms`);
    expect(fits).toContain('sdfFill');
    expect(ms).toBeLessThan(10000);
  }, 30000);
});
