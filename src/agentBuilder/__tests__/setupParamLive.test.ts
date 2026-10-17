/**
 * The Agent Builder's settings on the nodes round a group (setSetupParam) reach the picture at once, as a
 * card's own slider does: a compiled slider (Draw agents' camera in 3D) writes its uniform with no recompile,
 * anything else compiles now. They used to wait for a 500 ms compile that every tick of a drag pushed back, so
 * the 3D camera's Distance, Angle and Orbit speed seemed to do nothing (bugs 2026-10-13).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear(),
  });
});
import { undoManager, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { agents3dStarter } from '../../agentRules/space3d';
import { endSetupBurst, setSetupParam } from '../actions';
import { n } from '../../store/graphBuilder';

const st = () => useNodeGraphStore.getState();
const draw = () => st().nodes.find(x => x.type === 'drawAgents')!;

beforeEach(() => {
  const { nodes, out } = agents3dStarter('flock3d');
  useNodeGraphStore.setState({ nodes: [...nodes, n('output', 'out', 2100, 0, {}, { color: [out.nodeId, out.outputKey] })], activeGroupPath: [] });
  undoManager.clear();
  endSetupBurst();
  st().compile();
});

describe('Agent Builder settings apply at once', () => {
  it('the 3D camera: Distance, Angle and Orbit speed write their uniforms without a recompile', () => {
    const spec = st().agents;
    const d = spec!.draws.find(x => x.nodeId === draw().id) ?? spec!.draws[0];
    const name = d.params.camDist as string;
    expect(typeof name).toBe('string');
    for (const v of [1.2, 1.3, 1.4]) {
      setSetupParam(draw().id, { camDist: v });
      // At once, every tick of a drag: no compile waiting behind a timer.
      expect(st().paramUniforms[name]).toBe(v);
    }
    setSetupParam(draw().id, { camAngle: 75, rotSpeed: 30 });
    expect(st().paramUniforms[d.params.camAngle as string]).toBe(75);
    expect(st().paramUniforms[d.params.rotSpeed as string]).toBe(30);
    // The same compiled spec: the simulation goes on as it was.
    expect(st().agents).toBe(spec);
  });

  it('a choice (Perspective) compiles now, not half a second later', () => {
    setSetupParam(draw().id, { projection: 'reverse' });
    const d = st().agents!.draws[0];
    expect(d.params.projection).toBe('reverse');
    expect(typeof d.params.reverseDist).toBe('string');
  });
});
