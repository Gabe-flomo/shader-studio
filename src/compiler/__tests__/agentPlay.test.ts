/**
 * Agents P4 (docs/agents-plan.md "What shipped (P4)"): the group's Sound from,
 * inner sliders as Play controls and pinned sliders, hands into Target sockets
 * (Hand X / Y and Follow a hand), and the Motion (texture) node.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { particlesNodes, soundBurstNodes } from '../../store/agentExamples';
import { handBeatNodes, HAND_EX } from '../../store/agentPlayExample';
import { n } from '../../store/graphBuilder';
import { collectPlayCandidates } from '../../play/playControls';
import { followHand, canFollowHand, FOLLOW_HAND_ANCHOR } from '../../play/followHand';
import { agentPinnedRows } from '../../nodes/agentPins';
import { webInputFrom } from '../../play/webInput';
import { readsMotionMap } from '../../play/motionTexture';
import { AgentAttractNode, AgentVortexNode } from '../../nodes/definitions/agentForces';
import { AgentEmitNode } from '../../nodes/definitions/agents';
import { emptyPlayRecord, usesHands, type PlayRecord } from '../../types/play';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

const inside = (g: GraphNode) => (g.params.subgraph as SubgraphData).nodes;
const emptyPlay = (): PlayRecord => ({ version: 1, controls: [], mappings: [], layers: [] });

describe('the group\'s Sound from', () => {
  it('leaves each listening node its own by default (every group saved before P4)', () => {
    const r = compileGraph({ nodes: soundBurstNodes(0, 0) });
    expect(r.success).toBe(true);
    const [l] = r.agents!.groups[0].listeners;
    expect(l.soundFrom).toBe('graph');
    expect(l.params.beat).toMatch(/^u_p_/); // the kick's own Beat slider
  });

  it('is shared by every Sound kick and Chladni inside when set, with the group\'s Level and Beat', () => {
    const base = soundBurstNodes(0, 0);
    const group = base.find(x => x.type === 'agentsGroup')!;
    // A Chladni inside too: both hear the group.
    const plate = n('agentChladni', 'sbPlate', 0, 900, { soundFrom: 'live', __comment: 'a plate' });
    const nodes = base.map(x => (x.id === group.id ? { ...x, params: { ...x.params, soundFrom: 'track2', level: 0.25, beat: 90, subgraph: { ...(x.params.subgraph as SubgraphData), nodes: [...inside(x), plate] } } } : x));
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    const ls = r.agents!.groups[0].listeners;
    expect(ls.map(l => l.kind).sort()).toEqual(['kick', 'plate']);
    for (const l of ls) {
      expect(l.soundFrom).toBe('track2');
      // The group's sliders (their uniforms), not the node's.
      expect(l.params.level).toBe(r.paramBindings![`${group.id}::level`]);
      expect(l.params.beat).toBe(r.paramBindings![`${group.id}::beat`]);
    }
    // The update shader is the same: Sound from only changes what the engine feeds it.
    const plain = compileGraph({ nodes: nodes.map(x => (x.id === group.id ? { ...x, params: { ...x.params, soundFrom: 'nodes' } } : x)) });
    expect(plain.agents!.groups[0].fragmentShader).toBe(r.agents!.groups[0].fragmentShader);
  });
});

describe('inner sliders in Play', () => {
  it('lists every live slider inside an Agents group as a Play control (group::inner::key), bound to its uniform', () => {
    const nodes = particlesNodes(0, 0);
    const r = compileGraph({ nodes });
    const c = collectPlayCandidates(nodes, r.paramBindings!);
    const targets = c.map(x => x.target);
    expect(targets).toEqual(expect.arrayContaining(['particles::ptCurl::strength', 'particles::ptMouse::strength', 'particles::ptMove::drag', 'particles::ptSwirl::x']));
    for (const t of targets.filter(x => x.startsWith('particles::'))) expect(r.paramBindings![t.split('::').slice(-2).join('::')]).toMatch(/^u_p_/);
  });

  it('pins: rows for the pinned inner sliders that exist, with their values', () => {
    const g = handBeatNodes().find(x => x.id === HAND_EX.group)!;
    const rows = agentPinnedRows({ ...g, params: { ...g.params, pinned: [...(g.params.pinned as string[]), 'gone::strength', `${HAND_EX.attract}::target`] } });
    expect(rows.map(x => x.path)).toEqual([`${HAND_EX.attract}::strength`, `${HAND_EX.attract}::swirl`, `${HAND_EX.kick}::strength`, `${HAND_EX.curl}::strength`]);
    expect(rows[0]).toMatchObject({ label: 'Strength', nodeLabel: 'Attract / Repel', value: 1.2 });
  });
});

describe('hands into Target sockets', () => {
  const glsl = (def: typeof AgentAttractNode, params: Record<string, unknown>) => def.generateGLSL!({ id: 'x', type: def.type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { ...def.defaultParams, ...params } }, {}).code;

  it('A hand or null places the point from Hand X / Y (0–1) at any aspect', () => {
    for (const [def, key] of [[AgentAttractNode, 'target'], [AgentVortexNode, 'at'], [AgentEmitNode, 'at']] as const) {
      const code = glsl(def, { [key]: 'hand', handX: 0.25, handY: 0.75 });
      expect(code, def.type).toContain('(0.25 * 2.0 - 1.0) * (u_resolution.x / u_resolution.y)');
      expect(code, def.type).toContain('0.75 * 2.0 - 1.0');
    }
  });

  it('the defaults read as before (the mouse, X and Y)', () => {
    expect(glsl(AgentAttractNode, {})).toContain('u_mouse');
    expect(glsl(AgentVortexNode, { x: 0.3, y: -0.2 })).toContain('vec2(0.3, -0.2)');
    expect(glsl(AgentEmitNode, { x: 0.3, y: -0.2 })).toContain('vec2(0.3, -0.2)');
  });

  it('Follow a hand: both sliders as controls, paired as a position, the pointer then a hand', () => {
    const nodes = handBeatNodes();
    const r = compileGraph({ nodes });
    const candidates = collectPlayCandidates(nodes, r.paramBindings!);
    const hx = candidates.find(c => c.target === `${HAND_EX.group}::${HAND_EX.attract}::handX`)!;
    expect(canFollowHand(candidates, hx)).toBe(true);
    const { play, pairId } = followHand(emptyPlay(), candidates, hx);
    expect(pairId).not.toBe('');
    expect(play.controls.map(c => c.target)).toEqual([`${HAND_EX.group}::${HAND_EX.attract}::handX`, `${HAND_EX.group}::${HAND_EX.attract}::handY`]);
    expect(play.pairs).toEqual([expect.objectContaining({ position: true, a: play.controls[0].id, b: play.controls[1].id })]);
    expect(play.pairMappings!.map(m => m.source)).toEqual([{ kind: 'position', anchor: 'pointer' }, { kind: 'position', anchor: FOLLOW_HAND_ANCHOR }]);
    expect(play.pairMappings![0].a).toMatchObject({ outMin: 0, outMax: 1 });
    expect(usesHands(play)).toBe(true);
    // Again: the pair is made afresh, not doubled.
    const again = followHand(play, candidates, hx).play;
    expect(again.pairs).toHaveLength(1);
    expect(again.pairMappings).toHaveLength(2);
    // A slider without an X/Y partner can't.
    const str = candidates.find(c => c.target === `${HAND_EX.group}::${HAND_EX.attract}::strength`)!;
    expect(canFollowHand(candidates, str)).toBe(false);
  });
});

describe('Motion (texture)', () => {
  it('compiles in the picture, reads the shared map, and web pages fill it (P5)', () => {
    const nodes = [n('motionMap', 'mm', 0, 0, { gain: 2 }), n('output', 'out', 400, 0, {}, { color: ['mm', 'amount'] })];
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    expect(readsMotionMap(r.fragmentShader)).toBe(true);
    expect(r.fragmentShader).toContain('uniform sampler2D u_motionMap;');
    const { input, missing } = webInputFrom(r, emptyPlayRecord(), { title: 'x', aspect: 'free' });
    expect(missing).toEqual([]);
    expect(input.motionMap).toBe('u_motionMap');
  });

  it('goes into an Agents group program: Emit Picture born where it moves', () => {
    const nodes = handBeatNodes().map(x => (x.id === HAND_EX.emit
      ? { ...x, params: { ...x.params, shape: 'picture' }, inputs: { ...x.inputs, picture: { ...x.inputs.picture, connection: { nodeId: 'mm', outputKey: 'texture' } } } }
      : x));
    const r = compileGraph({ nodes: [...nodes, n('motionMap', 'mm', 0, 900)] });
    expect(r.errors).toBeUndefined();
    expect(readsMotionMap(r.agents!.groups[0].fragmentShader)).toBe(true);
    expect(readsMotionMap(r.fragmentShader)).toBe(false);
  });
});

describe('the example', () => {
  it('compiles, and its controls are all live sliders', () => {
    const nodes = handBeatNodes();
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    const targets = new Set(collectPlayCandidates(nodes, r.paramBindings!).map(c => c.target));
    for (const t of [`${HAND_EX.group}::${HAND_EX.attract}::handX`, `${HAND_EX.group}::${HAND_EX.attract}::handY`, `${HAND_EX.group}::${HAND_EX.attract}::strength`, `${HAND_EX.group}::${HAND_EX.kick}::strength`, `${HAND_EX.emit}::burst`]) expect(targets.has(t), t).toBe(true);
    expect(r.agents!.groups[0].listeners[0].soundFrom).toBe('track1');
  });
});
