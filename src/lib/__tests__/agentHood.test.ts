/**
 * The runner's side of Under the hood (lib/agentHood.ts, AgentRunner.stateView / drawHood): the
 * state view is read-only (frozen, asking changes nothing, the targets and the ping-pong stay
 * hidden) and maps texels to walkers by the group's own side; nothing is drawn, read or loaded while
 * no hood is open; the GPU part gets one frame per open request.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { compileGraph } from '../../compiler/graphCompiler';
import { slimeMoldNodes } from '../../store/agentExamples';
import type { CompilationResult } from '../../compiler/types';
import { AgentRunner, AgentTargets } from '../agentRunner';
import { hoodRequests, hoodWanted, openHood, type HoodRequest } from '../agentHood';

function fakeRenderer() {
  const calls = { render: 0, setRenderTarget: 0 };
  const renderer = {
    compileAsync: () => Promise.resolve(),
    getContext: () => ({ getProgramParameter: () => true, LINK_STATUS: 0, flush: () => {} }),
    properties: { get: () => ({}) },
    autoClear: true,
    setRenderTarget: () => { calls.setRenderTarget++; }, clear: () => {}, getClearColor: (c: THREE.Color) => c, getClearAlpha: () => 0, setClearColor: () => {},
    render: () => { calls.render++; },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, calls };
}

async function liveSlime() {
  const r = compileGraph({ nodes: slimeMoldNodes(0, 0) }) as CompilationResult;
  const spec = r.agents!;
  const { renderer, calls } = fakeRenderer();
  // Every uniform the rule reads (sliders, the clock): 0 unless the runner sets it.
  const table: Record<string, THREE.IUniform> = {};
  const uniforms = new Proxy(table, { get: (t, k: string) => (t[k] ??= { value: 0 }) });
  const runner = new AgentRunner({ renderer, geometry: new THREE.PlaneGeometry(2, 2), camera: new THREE.Camera(), uniforms: () => uniforms, onReady: () => {}, onLinkFailed: () => {} });
  runner.update(spec, 'void main() {}');
  await new Promise(res => setTimeout(res, 0));
  const targets = new AgentTargets(renderer, true);
  runner.run(targets, { width: 960, height: 540, time: 0.1, live: true, frameMs: 16 });
  return { runner, targets, spec, calls };
}

describe('the state view', () => {
  it('is frozen and read-only: asking changes nothing, and it holds the current copy of A and B (C and D only when kept)', async () => {
    const { runner, targets, spec } = await liveSlime();
    const g = spec.groups[0];
    const s = targets.groups.get(g.slug)!;
    const before = { cur: s.cur, step: s.step };
    const v = runner.stateView(targets, g.nodeId)!;
    expect(v).toBeTruthy();
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.textures)).toBe(true);
    expect(v).toMatchObject({ nodeId: g.nodeId, side: g.side, count: g.side * g.side, d3: false, stateC: !!g.stateC });
    expect(v.aspect).toBeCloseTo(960 / 540);
    expect(v.textures.A).toBe(s.rt[s.cur].textures[0]);
    expect(v.textures.B).toBe(s.rt[s.cur].textures[1]);
    expect(v.textures.C).toBe(g.stateC ? s.rt[s.cur].textures[2] : null);
    // No way in to the targets or the ping-pong.
    expect(Object.keys(v)).not.toContain('rt');
    expect(Object.keys(v)).not.toContain('cur');
    expect(() => { (v as { side: number }).side = 1; }).toThrow();
    expect(() => { (v.textures as { A: unknown }).A = null; }).toThrow();
    runner.stateView(targets, g.nodeId);
    expect({ cur: s.cur, step: s.step }).toEqual(before);
    // Its trail: the one its Deposit fills.
    expect(v.trail?.nodeId).toBe(spec.trails[0].nodeId);
    // A group the runner doesn't know, or before it has state: null.
    expect(runner.stateView(targets, 'nope')).toBeNull();
    expect(runner.stateView(new AgentTargets(fakeRenderer().renderer, true), g.nodeId)).toBeNull();
  });
});

describe('nothing runs while no hood is open', () => {
  it('no request: hoodWanted is false and drawHood draws, reads and loads nothing', async () => {
    const { runner, targets, calls } = await liveSlime();
    expect(hoodWanted()).toBe(false);
    expect(runner.hoodHeld).toBe(false);
    const before = { ...calls };
    runner.drawHood(targets);
    await new Promise(res => setTimeout(res, 20));
    runner.drawHood(targets);
    expect(calls).toEqual(before);
    expect(runner.hoodHeld).toBe(false);
  });

  it('a request is open from openHood to its close; one a group (a second replaces the first)', () => {
    const req = (groupId: string): HoodRequest => ({ groupId, atlas: { W: 0, H: 0, tile: 0, tiles: [] }, specs: [], species: [], probe: null, pick: null, onAtlas: () => {}, onProbe: () => {}, onPick: () => {} });
    const a = req('g'), b = req('g');
    const closeA = openHood(a);
    expect(hoodWanted()).toBe(true);
    const closeB = openHood(b);
    expect(hoodRequests()).toEqual([b]);
    closeA(); // a stale close doesn't drop the newer one
    expect(hoodRequests()).toEqual([b]);
    closeB();
    expect(hoodWanted()).toBe(false);
  });

  it('with a request open, the runner loads its GPU part and gives it a frame with the group\'s state view', async () => {
    const { runner, targets, spec } = await liveSlime();
    const frame = vi.fn();
    vi.doMock('../agentHoodGpu', () => ({ AgentHoodGpu: class { busy = true; frame = frame; dispose() {} } }));
    const r: HoodRequest = { groupId: spec.groups[0].nodeId, atlas: { W: 0, H: 0, tile: 0, tiles: [] }, specs: [], species: [], probe: null, pick: null, onAtlas: () => {}, onProbe: () => {}, onPick: () => {} };
    const close = openHood(r);
    try {
      runner.drawHood(targets);
      await vi.waitFor(() => expect(runner.hoodHeld).toBe(true));
      runner.drawHood(targets);
      expect(frame).toHaveBeenCalledTimes(1);
      const [reqs, view] = frame.mock.calls[0];
      expect(reqs).toEqual([r]);
      expect(view(r.groupId)?.side).toBe(spec.groups[0].side);
    } finally { close(); vi.doUnmock('../agentHoodGpu'); }
  });
});
