/**
 * Where new nodes land (store/placement.ts, store/freeSpace.ts; docs/node-browser.md "Where new nodes
 * land"): a setup is centred in the visible canvas, never on a card, and when the view is full it
 * takes the free spot nearest the view's centre, never "right of the whole graph". The store's
 * multi-node adds and the builders' actions all go through it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import type { GraphNode } from '../../types/nodeGraph';

vi.hoisted(() => {
  const ls = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => { ls.set(k, v); },
    removeItem: (k: string) => { ls.delete(k); }, key: () => null, length: 0, clear: () => ls.clear(),
  });
});

import { boxesHit, nearestFree } from '../freeSpace';
import { placeSetupInView, settleAddedInView, type ViewRect } from '../placement';
import { placeInFreeSpace } from '../agentSetup';
import { n } from '../graphBuilder';
import { useNodeGraphStore } from '../useNodeGraphStore';
import { gridPlan } from '../../lang/run';

const H = 200;
const heightOf = () => H;
const box = (nd: GraphNode) => ({ x: nd.position.x, y: nd.position.y, w: 360, h: H });
const noOverlap = (a: GraphNode[], b: GraphNode[]) => {
  for (const x of a) for (const y of b) expect(boxesHit(box(x), box(y), 0), `${x.id} on ${y.id}`).toBe(false);
};
const bounds = (list: GraphNode[]) => {
  const x0 = Math.min(...list.map(nd => nd.position.x)), y0 = Math.min(...list.map(nd => nd.position.y));
  const x1 = Math.max(...list.map(nd => nd.position.x + 360)), y1 = Math.max(...list.map(nd => nd.position.y + H));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
};
const inside = (p: { x: number; y: number }, v: ViewRect) => p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h;

/** A three-card setup laid out at the origin, the way a builder makes one. */
const setup = (tag: string) => [n('uv', `${tag}a`, 0, 0), n('add', `${tag}b`, 440, 0), n('output', `${tag}c`, 880, 0)];
/** A wide graph: a row of cards from x=0 to far to the right. */
const wideGraph = (count: number) => Array.from({ length: count }, (_, i) => n('add', `g${i}`, i * 440, 0));

describe('nearestFree', () => {
  it('keeps the spot asked for when it is clear', () => {
    expect(nearestFree({ w: 100, h: 100 }, [{ x: 500, y: 500, w: 100, h: 100 }], { x: 0, y: 0 }, 20)).toEqual({ x: 0, y: 0 });
  });
  it('moves to the nearest clear spot, touching the card in the way', () => {
    const p = nearestFree({ w: 100, h: 100 }, [{ x: 0, y: 0, w: 100, h: 100 }], { x: 10, y: 0 }, 20);
    expect(p).toEqual({ x: 120, y: 0 });
  });
  it('never lands on an obstacle, even in a crowd', () => {
    const crowd = Array.from({ length: 40 }, (_, i) => ({ x: (i % 8) * 130, y: Math.floor(i / 8) * 130, w: 120, h: 120 }));
    const p = nearestFree({ w: 300, h: 200 }, crowd, { x: 400, y: 300 }, 10);
    for (const o of crowd) expect(boxesHit({ ...p, w: 300, h: 200 }, o, 10)).toBe(false);
  });
});

describe('placeSetupInView', () => {
  const view: ViewRect = { x: 20000, y: 3000, w: 1600, h: 1000 };

  it('centres a setup in an empty view, far from the rest of the graph', () => {
    const placed = placeSetupInView(wideGraph(30), setup('s'), view, { heightOf });
    const b = bounds(placed);
    expect(b.cx).toBeCloseTo(view.x + view.w / 2, 0);
    expect(b.cy).toBeCloseTo(view.y + view.h / 2, 0);
  });

  it('keeps its own layout (moves as one block)', () => {
    const placed = placeSetupInView([], setup('s'), view, { heightOf });
    expect(placed[1].position.x - placed[0].position.x).toBe(440);
    expect(placed[2].position.x - placed[0].position.x).toBe(880);
  });

  it('is nudged off the cards in view, staying near the centre', () => {
    const mid = { x: view.x + view.w / 2, y: view.y + view.h / 2 };
    const there = [n('add', 'x1', mid.x - 180, mid.y - 100), n('add', 'x2', mid.x + 300, mid.y - 100)];
    const placed = placeSetupInView(there, setup('s'), view, { heightOf });
    noOverlap(placed, there);
    const b = bounds(placed);
    expect(Math.hypot(b.cx - mid.x, b.cy - mid.y)).toBeLessThan(b.w + b.h);
  });

  it('a full view: the nearest free space to its centre, not right of the whole graph', () => {
    // A 60-card-wide band, 3 rows deep, with the view on its middle.
    const band = Array.from({ length: 180 }, (_, i) => n('add', `b${i}`, (i % 60) * 440, Math.floor(i / 60) * 300));
    const v: ViewRect = { x: 12000, y: 0, w: 1600, h: 900 };
    const placed = placeSetupInView(band, setup('s'), v, { heightOf });
    noOverlap(placed, band);
    const b = bounds(placed);
    // Right of everything would be x > 26000; the nearest free space is just below the band, under the view.
    expect(b.x).toBeLessThan(v.x + v.w);
    expect(b.x + b.w).toBeGreaterThan(v.x);
    expect(b.y).toBeLessThan(1200);
  });

  it('a setup bigger than the view starts at the view\'s corner, so its beginning shows', () => {
    const big = Array.from({ length: 8 }, (_, i) => n('add', `w${i}`, i * 440, 0));
    const placed = placeSetupInView([], big, view, { heightOf });
    expect(bounds(placed).x).toBe(view.x + 40);
  });
});

describe('placeInFreeSpace (top-left asked for)', () => {
  it('blocked: the nearest free spot, not right of the whole graph', () => {
    const graph = wideGraph(40);
    const placed = placeInFreeSpace(graph, setup('s'), { x: 2000, y: 0 }, heightOf);
    noOverlap(placed, graph);
    expect(bounds(placed).x).toBeLessThan(5000);
  });
});

describe('settleAddedInView', () => {
  const view: ViewRect = { x: 0, y: 0, w: 1600, h: 1000 };
  const before = [n('add', 'a', 100, 100)];

  it('ifOutOfView: brings nodes added far off screen into view', () => {
    const after = [...before, n('uv', 'new1', 9000, 9000), n('add', 'new2', 9440, 9000)];
    const out = settleAddedInView(before, after, view, { heightOf });
    const b = bounds(out.filter(nd => nd.id.startsWith('new')));
    expect(inside({ x: b.cx, y: b.cy }, view)).toBe(true);
    expect(out.find(nd => nd.id === 'a')!.position).toEqual({ x: 100, y: 100 });
    noOverlap(out.filter(nd => nd.id.startsWith('new')), before);
  });

  it('ifOutOfView: leaves nodes already on screen where the planner put them', () => {
    const after = [...before, n('uv', 'new1', 600, 100)];
    expect(settleAddedInView(before, after, view, { heightOf })).toBe(after);
  });

  it('centre: centres them even when on screen', () => {
    const after = [...before, n('uv', 'new1', 1200, 700)];
    const out = settleAddedInView(before, after, view, { mode: 'centre', heightOf });
    expect(out.find(nd => nd.id === 'new1')!.position).not.toEqual({ x: 1200, y: 700 });
  });

  it('leaves a rewrite in place (a node was removed) and does nothing without a view', () => {
    const rewrite = [n('uv', 'new1', 9000, 9000)];
    expect(settleAddedInView(before, rewrite, view, { heightOf })).toBe(rewrite);
    const after = [...before, n('uv', 'new1', 9000, 9000)];
    expect(settleAddedInView(before, after, null, { heightOf })).toBe(after);
  });
});

describe('the store\'s adds land in view', () => {
  const S = () => useNodeGraphStore.getState();
  const view: ViewRect = { x: 30000, y: 4000, w: 1600, h: 1000 };
  beforeEach(() => {
    useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
    S().replaceGraph([...wideGraph(30), n('output', 'out', 30 * 440, 0)]);
    useNodeGraphStore.setState({ _viewportRectGetter: () => view, _viewportCenterGetter: () => ({ x: view.x + view.w / 2, y: view.y + view.h / 2 }) });
  });

  const addedSince = (ids: Set<string>) => S().nodes.filter(nd => !ids.has(nd.id));
  const centreInView = (list: GraphNode[]) => {
    const x0 = Math.min(...list.map(nd => nd.position.x)), x1 = Math.max(...list.map(nd => nd.position.x + 360));
    const y0 = Math.min(...list.map(nd => nd.position.y)), y1 = Math.max(...list.map(nd => nd.position.y + 200));
    // A setup taller than the view starts at its top edge: its first cards are on screen.
    return inside({ x: (x0 + x1) / 2, y: Math.min((y0 + y1) / 2, y0 + 200) }, view);
  };

  it('Agents starters (the Agent Builder, the node browser) are centred in the view', () => {
    for (const kind of ['particles', 'slime', 'rules'] as const) {
      S().replaceGraph([...wideGraph(30), n('output', 'out', 30 * 440, 0)]);
      const ids = new Set(S().nodes.map(nd => nd.id));
      S().addAgentsStarter(kind);
      expect(centreInView(addedSince(ids)), kind).toBe(true);
    }
  });

  it('a second setup added to the same view sits right next to the first, not far off', () => {
    S().addAgentsStarter('particles');
    const ids = new Set(S().nodes.map(nd => nd.id));
    S().addAgentsStarter('slime');
    const added = addedSince(ids);
    const x0 = Math.min(...added.map(nd => nd.position.x)), y0 = Math.min(...added.map(nd => nd.position.y));
    const x1 = Math.max(...added.map(nd => nd.position.x + 360)), y1 = Math.max(...added.map(nd => nd.position.y + 200));
    // Its box comes within one view of the view (the first setup fills the view itself).
    expect(x0).toBeLessThan(view.x + 2 * view.w);
    expect(x1).toBeGreaterThan(view.x - view.w);
    expect(y0).toBeLessThan(view.y + 2 * view.h + 2000);
    expect(y1).toBeGreaterThan(view.y - view.h - 2000);
    noOverlap(added, S().nodes.filter(nd => !added.includes(nd)));
  });

  it('an Agents preset from the node browser lands round where it was added', () => {
    const ids = new Set(S().nodes.map(nd => nd.id));
    S().addNode('slimeMoldPreset', { x: view.x + 600, y: view.y + 400 });
    expect(centreInView(addedSince(ids))).toBe(true);
  });

  it('a Do… bar plan that put its node below the graph is brought into view', () => {
    const ids = new Set(S().nodes.map(nd => nd.id));
    S().runDoPlan(gridPlan({}), 'grid rules');
    const added = addedSince(ids);
    expect(added.length).toBeGreaterThan(0);
    expect(centreInView(added)).toBe(true);
  });

  it('a group preset with no position goes to the middle of the view', () => {
    useNodeGraphStore.setState({ _viewportRectGetter: () => view, _viewportCenterGetter: () => ({ x: 30800, y: 4500 }) });
    const id = S().placeSubgraphAsGroup('G', { nodes: [], inputPorts: [], outputPorts: [] });
    const g = S().nodes.find(nd => nd.id === id)!;
    expect(inside({ x: g.position.x + 180, y: g.position.y + 90 }, view)).toBe(true);
  });
});

describe('every multi-node add goes through the placement helpers', () => {
  // Where each call site lives, and the helper it must use (store/placement.ts via spawnPoint.ts's intoView).
  const sites: Array<[string, RegExp]> = [
    ['src/agentBuilder/actions.ts', /placeSetupInView\(/],
    ['src/store/useNodeGraphStore.ts', /addAgentsStarter:[\s\S]*?placeSetupInView\(/],
    ['src/store/useNodeGraphStore.ts', /AGENT_PRESET_TYPES\.has\(type\)\) \{[\s\S]*?placeSetupInView\(/],
    ['src/store/useNodeGraphStore.ts', /applyStarterRecipe:[\s\S]*?settleAddedInView\(/],
    ['src/store/useNodeGraphStore.ts', /applySuggestion:[\s\S]*?settleAddedInView\(/],
    ['src/store/useNodeGraphStore.ts', /runDoPlan:[\s\S]*?settleAddedInView\(/],
    ['src/store/useNodeGraphStore.ts', /runCommand:[\s\S]*?settleAddedInView\(/],
    ['src/sceneBuilder/actions.ts', /intoView\(nodes, result\.nodes/],
    ['src/sceneBuilder2d/actions.ts', /intoView\(nodes, result\.nodes/],
    ['src/exprBuilder/actions.ts', /intoView\(now\.nodes, r\.nodes/],
    ['src/builders/open.ts', /intoView\(now\.nodes, made\.nodes/],
    ['src/components/NodeGraph/DoBar.tsx', /intoView\(nodes, made\.nodes\)[\s\S]*intoView\(nodes, made\.nodes\)/],
    ['src/components/NodeGraph/NodeBrowser.tsx', /openUserNodeSource\(userNode\.id, spawnPoint\(\)\)/],
  ];
  for (const [file, re] of sites) it(`${file} ${re.source.slice(0, 40)}`, () => expect(readFileSync(file, 'utf8')).toMatch(re));

  it('no add places nodes at random any more', () => {
    for (const file of ['src/store/useNodeGraphStore.ts', 'src/components/NodeGraph/NodeBrowser.tsx']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/position: \{ x: \d+ \+ Math\.random\(\)|x: \d+ \+ Math\.random\(\) \* \d+, y:/);
    }
  });
});
