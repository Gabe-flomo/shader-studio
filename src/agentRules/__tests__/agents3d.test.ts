/**
 * The 3D Agent Builder (docs/agent-rules.md "The 3D Agent Builder"): its setup, the 3D templates,
 * the editor's Space switch (the whole setup turned, and back again) and the store's undo for it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { syncAgentSpaces } from '../../nodes/definitions/agents';
import { n } from '../../store/graphBuilder';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';
import { groupRules, isRulesGroup } from '../apply';
import { rulesStarter } from '../starter';
import { RULES_TEMPLATES } from '../templates';
import { describeRule } from '../spec';
import { CAMERA_3D, RULES_TEMPLATES_3D, SPACE_SCALE, agents3dStarter, applyTemplate3d, convertGroupSpace, rescaleForSpace, setupOf } from '../space3d';
import { setGroupSpace } from '../storeActions';

const ids = () => { let i = 0; return () => `x${++i}`; };
const withOutput = (nodes: GraphNode[], from: { nodeId: string; outputKey: string } | null): GraphNode[] =>
  [...nodes, n('output', 'out', 3000, 0, {}, from ? { color: [from.nodeId, from.outputKey] } : {})];
const compile = (nodes: GraphNode[]) => compileGraph({ nodes: syncAgentSpaces(nodes, getNodeDefinition) });
const walk = (nodes: GraphNode[], f: (x: GraphNode) => void) => { for (const x of nodes) { f(x); const sg = x.params.subgraph as { nodes?: GraphNode[] } | undefined; if (sg?.nodes) walk(sg.nodes, f); } };

describe('the 3D Agent Builder\'s setup', () => {
  it('is Emit (Ball) → Agents (3D, rules) → Deposit → a volume Trail, Draw agents through an orbiting camera, every node with a note', () => {
    const s = agents3dStarter();
    const g = s.nodes.find(x => x.id === s.groupId)!;
    expect(isRulesGroup(g)).toBe(true);
    expect(g.params.space).toBe('3d');
    expect(g.params.rulesSpace).toBe('3d');
    const { emits, deposits, trails, draws } = setupOf(s.nodes, s.groupId);
    expect(emits[0].params.shape).toBe('ball');
    expect(deposits).toHaveLength(1);
    expect(trails[0].params.volume).toBe('96');
    expect(g.inputs.trail.connection?.nodeId).toBe(trails[0].id);
    expect(draws[0].params.rotSpeed).toBeGreaterThan(0);
    expect(draws[0].params.camDist).toBe(CAMERA_3D.camDist);
    expect(s.out).toEqual({ nodeId: draws[0].id, outputKey: 'color' });
    // Tuned for a volume: sensors and speed about five times a flat slime's.
    const set = groupRules(g);
    expect(set.sensor.distance).toBeGreaterThanOrEqual(0.1);
    expect(set.species[0].speed).toBeGreaterThanOrEqual(1);
    walk(s.nodes, x => expect(String(x.params.__comment ?? '').length, x.id).toBeGreaterThan(20));
    const r = compile(withOutput(s.nodes, s.out));
    expect(r.errors).toBeUndefined();
    expect(r.agents!.groups[0].fragmentShader).toContain('agTurn3');
  });

  it('every 3D template is a few readable lines, compiles in 3D as a builder setup, and applies onto a flat group', () => {
    expect(RULES_TEMPLATES_3D.map(t => t.key)).toEqual(['slime3d', 'flock3d', 'orbiters3d', 'curl3d']);
    for (const t of RULES_TEMPLATES_3D) {
      const set = t.set();
      set.species.forEach((sp, si) => sp.rules.forEach(r => expect(describeRule(set, si, r)).toMatch(/^When .+ → .+/)));
      const s = agents3dStarter(t.key);
      const r = compile(withOutput(s.nodes, s.out));
      expect(r.errors, t.key).toBeUndefined();
      expect(r.success, t.key).toBe(true);
      // Onto the flat rules starter: switched to 3D, the template's Emit, Trail and camera on its own nodes.
      const flat = rulesStarter(null);
      const on = applyTemplate3d(withOutput(flat.nodes, flat.out), flat.groupId, t.key, ids())!;
      const g = on.nodes.find(x => x.id === flat.groupId)!;
      expect(g.params.space, t.key).toBe('3d');
      expect(groupRules(g).species[0].speed, t.key).toBe(set.species[0].speed);
      const su = setupOf(on.nodes, flat.groupId);
      expect(su.emits[0].params.shape, t.key).toBe(t.emit.shape);
      expect(su.draws[0].params.camDist, t.key).toBe(t.draw.camDist);
      expect(compile(on.nodes).errors, t.key).toBeUndefined();
    }
  });
});

describe('Space 2D ↔ 3D', () => {
  it('rescales a trail follower\'s sensors and speeds, and back; leaves Neighbours walkers alone', () => {
    const slime = RULES_TEMPLATES.find(t => t.key === 'slime')!.set();
    const up = rescaleForSpace(slime, '3d');
    expect(up.sensor.distance).toBeCloseTo(slime.sensor.distance * SPACE_SCALE, 6);
    expect(up.species[0].speed).toBeCloseTo(slime.species[0].speed * SPACE_SCALE, 6);
    expect(rescaleForSpace(up, '2d')).toEqual(slime);
    const boids = RULES_TEMPLATES.find(t => t.key === 'boids')!.set();
    expect(rescaleForSpace(boids, '3d')).toBe(boids);
  });

  it('turns the whole flat setup to 3D: volume trail, Ball, a camera view on the Output; and back to where it was', () => {
    const s = rulesStarter(null);
    const flat = withOutput(s.nodes, s.out);
    const up = convertGroupSpace(flat, s.groupId, '3d', ids())!;
    expect(up.message).toMatch(/^In 3D: /);
    const g = up.nodes.find(x => x.id === s.groupId)!;
    expect(g.params.space).toBe('3d');
    expect(g.params.rulesSpace).toBe('3d');
    expect(groupRules(g).sensor.distance).toBeCloseTo(groupRules(s.nodes.find(x => x.id === s.groupId)!).sensor.distance * SPACE_SCALE, 6);
    const su = setupOf(up.nodes, s.groupId);
    expect(su.emits[0].params.shape).toBe('ball');
    expect(su.trails[0].params.volume).toBe('96');
    expect(su.draws).toHaveLength(1);
    expect(su.draws[0].params.__spaceAdded).toBe(s.groupId);
    expect(su.draws[0].params.rotSpeed).toBe(CAMERA_3D.rotSpeed);
    expect(up.nodes.find(x => x.id === 'out')!.inputs.color.connection).toEqual({ nodeId: su.draws[0].id, outputKey: 'color' });
    expect(up.added).toHaveLength(3);
    const r = compile(up.nodes);
    expect(r.errors).toBeUndefined();
    expect(r.agents!.groups[0].fragmentShader).toContain('agTurn3');
    // Again: nothing to do.
    expect(convertGroupSpace(up.nodes, s.groupId, '3d', ids())).toBeNull();
    // Back: the added view gone, the Output on the palette again, the rules and Emit as they were.
    const down = convertGroupSpace(up.nodes, s.groupId, '2d', ids())!;
    const strip = (nodes: GraphNode[]) => nodes.map(x => ({ ...x, params: { ...x.params, agentSpace: undefined, subgraph: undefined } }));
    expect(strip(down.nodes)).toEqual(strip(flat));
    expect(groupRules(down.nodes.find(x => x.id === s.groupId)!)).toEqual(groupRules(flat.find(x => x.id === s.groupId)!));
    expect(compile(down.nodes).errors).toBeUndefined();
  });

  it('a 3D builder setup switched to 2D keeps its Draw agents and compiles flat', () => {
    const s = agents3dStarter();
    const down = convertGroupSpace(withOutput(s.nodes, s.out), s.groupId, '2d', ids())!;
    const su = setupOf(down.nodes, s.groupId);
    expect(su.emits[0].params.shape).toBe('disc');
    expect(su.draws).toHaveLength(1);
    expect(groupRules(down.nodes.find(x => x.id === s.groupId)!).species[0].speed).toBeCloseTo(1.2 / SPACE_SCALE, 6);
    const r = compile(down.nodes);
    expect(r.errors).toBeUndefined();
    expect(r.agents!.groups[0].fragmentShader).not.toContain('agTurn3');
  });
});

describe('the store', () => {
  beforeEach(() => {
    useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  });
  it('adds the 3D setup on the Output (Rules in 3D), and Space switches undo in one step', () => {
    useNodeGraphStore.setState({ nodes: [n('output', 'o', 0, 0, {})] });
    const id = useNodeGraphStore.getState().addAgentsStarter('rules3d')!;
    const before = useNodeGraphStore.getState().nodes;
    const g = before.find(x => x.id === id)!;
    expect(g.params.space).toBe('3d');
    const draw = before.find(x => x.type === 'drawAgents')!;
    expect(before.find(x => x.id === 'o')!.inputs.color.connection?.nodeId).toBe(draw.id);
    expect(setGroupSpace(id, '2d')).toBe(true);
    expect(useNodeGraphStore.getState().nodes.find(x => x.id === id)!.params.space).toBe('2d');
    expect(setGroupSpace(id, '2d')).toBe(false);
    useNodeGraphStore.getState().undo();
    expect(useNodeGraphStore.getState().nodes.find(x => x.id === id)!.params.space).toBe('3d');
  });
});
