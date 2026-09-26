import { describe, it, expect } from 'vitest';
import { driverOf, paramDrivers } from '../paramDrivers';
import type { GraphNode } from '../../types/nodeGraph';

const circle = (wired: boolean): GraphNode => ({
  id: 'c1', type: 'circleSDF', position: { x: 0, y: 0 },
  inputs: {
    position: { type: 'vec2', label: 'UV' },
    radius: { type: 'float', label: 'Radius' },
    offset: { type: 'vec2', label: 'Center', ...(wired ? { connection: { nodeId: 'mv', outputKey: 'vec' } } : {}) },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  params: { radius: 0.3, posX: 0.1, posY: 0.2 },
} as unknown as GraphNode);

describe('a wire that takes over sliders', () => {
  it('finds the Center X / Y sliders a wired Center socket replaces', () => {
    const d = paramDrivers(circle(true));
    expect([...d.keys()].sort()).toEqual(['posX', 'posY']);
    expect(d.get('posX')).toEqual({ socketKey: 'offset', socketLabel: 'Center', connection: { nodeId: 'mv', outputKey: 'vec' } });
    expect(driverOf(circle(true), 'radius')).toBeNull(); // still free
  });

  it('finds nothing while the socket is unwired', () => {
    expect(paramDrivers(circle(false)).size).toBe(0);
  });

  it('reports a slider whose own socket is wired', () => {
    const n = circle(false);
    n.inputs.radius.connection = { nodeId: 'k', outputKey: 'value' };
    expect(driverOf(n, 'radius')?.socketKey).toBe('radius');
  });
});

import { collectPlayCandidates, upstreamControls } from '../playControls';

const makeVec2 = (wiredX = false): GraphNode => ({
  id: 'mv', type: 'makeVec2', position: { x: 0, y: 0 },
  inputs: { x: { type: 'float', label: 'X', ...(wiredX ? { connection: { nodeId: 'k', outputKey: 'value' } } : {}) }, y: { type: 'float', label: 'Y' } },
  outputs: { xy: { type: 'vec2', label: 'XY' } },
  params: { x: 0.1, y: 0.2 },
} as unknown as GraphNode);
const bindings = { 'c1::radius': 'u1', 'c1::posX': 'u2', 'c1::posY': 'u3', 'mv::x': 'u4', 'mv::y': 'u5' };

describe('Play takes free sliders only', () => {
  it('leaves out the sliders a wire has taken over, and keeps the free ones on the source node', () => {
    const nodes = [circle(true), makeVec2()];
    const targets = collectPlayCandidates(nodes, bindings).map(c => c.target).sort();
    expect(targets).toEqual(['c1::radius', 'mv::x', 'mv::y']);
  });

  it('points from a taken-over slider to the free sliders on the node feeding it', () => {
    const nodes = [circle(true), makeVec2()];
    const up = upstreamControls(nodes, collectPlayCandidates(nodes, bindings), nodes[0], 'posX');
    expect(up?.sourceLabel).toBe('Make Vec2');
    expect(up?.driver.socketLabel).toBe('Center');
    expect(up?.candidates.map(c => c.paramLabel)).toEqual(['X', 'Y']);
    expect(upstreamControls(nodes, [], nodes[0], 'radius')).toBeNull();
  });

  it('goes one hop only: says when the source’s own slider is wired too', () => {
    const nodes = [circle(true), makeVec2(true)];
    const cands = collectPlayCandidates(nodes, { 'c1::posX': 'u2', 'mv::x': 'u4' });
    const up = upstreamControls(nodes, cands, nodes[0], 'posX');
    expect(up?.candidates).toEqual([]);
    expect(up?.blockedBy).toEqual({ param: 'X', from: 'another node' });
  });
});
