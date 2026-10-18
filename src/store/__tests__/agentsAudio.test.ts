/**
 * Audio nodes inside an Agents group (docs/agents-group.md, "Sound from outside"): the agents' update program shares
 * the preview's uniform table, so a Band level inside drives the walkers like any live value. Its sound can be an
 * Audio Source inside the group, or one outside wired through a Sound port (Agent Inputs' added `audio` input): the
 * engine follows that port to the source, and the program compiles with the band's live uniform.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { collectAudioNodes } from '../../lib/audioTools/graphWalk';
import { groupAddable } from '../../nodes/groupPorts';

const outputOnly = (): GraphNode[] => [
  { id: 'out', type: 'output', position: { x: 900, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} },
];
const mk = (id: string, type: string): GraphNode => {
  const def = getNodeDefinition(type)!;
  return {
    id, type, position: { x: 0, y: 0 }, params: { ...(def.defaultParams ?? {}) },
    inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label }])),
    outputs: Object.fromEntries(Object.entries(def.outputs).map(([k, s]) => [k, { type: s.type, label: s.label }])),
  };
};

/** A slime preset whose walkers' Speed is a Band level inside the group; `outside`: its Audio Source through a Sound port. */
function slimeHearing(outside: boolean): GraphNode[] {
  useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
  useNodeGraphStore.getState().replaceGraph(outputOnly());
  useNodeGraphStore.getState().addNode('slimeMoldPreset', { x: 0, y: 0 });
  const nodes = structuredClone(useNodeGraphStore.getState().nodes);
  const g = nodes.find(n => n.type === 'agentsGroup')!;
  const sub = g.params.subgraph as SubgraphData;
  const src = mk('asrc', 'audioSource');
  const band = mk('aband', 'audioBand');
  const move = sub.nodes.find(n => n.type === 'agentMove')!;
  move.inputs.speed = { ...move.inputs.speed, connection: { nodeId: 'aband', outputKey: 'level' } };
  sub.nodes.push(band);
  if (outside) {
    nodes.push(src);
    const ai = sub.nodes.find(n => n.type === 'agentInputs')!;
    ai.params.extraInputs = [...((ai.params.extraInputs ?? []) as unknown[]), { key: 'snd', type: 'audio', label: 'Sound' }];
    ai.outputs.snd = { type: 'audio', label: 'Sound' };
    g.inputs.snd = { type: 'audio', label: 'Sound', connection: { nodeId: 'asrc', outputKey: 'audio' } };
    band.inputs.audio.connection = { nodeId: ai.id, outputKey: 'snd' };
  } else {
    sub.nodes.push(src);
    band.inputs.audio.connection = { nodeId: 'asrc', outputKey: 'audio' };
  }
  return nodes;
}

describe('Audio nodes inside an Agents group', () => {
  it('an Agents group can take a Sound port', () => {
    expect(groupAddable('agentsGroup').inputs).toContain('audio');
  });

  for (const outside of [false, true]) {
    it(`a Band level inside drives the walkers (its Audio Source ${outside ? 'outside, through a Sound port' : 'inside'})`, () => {
      const nodes = slimeHearing(outside);
      const r = compileGraph({ nodes });
      expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
      const live = Object.entries(r.liveUniforms).find(([, ch]) => ch === 'aband::level')?.[0];
      expect(live).toBeDefined();
      const fs = r.agents!.groups[0].fragmentShader;
      expect(fs).toContain(`uniform float ${live};`);
      expect(fs).toMatch(new RegExp(`\\* ${live}`));
      // The engine finds the band's sound, so it writes aband::level.
      expect(collectAudioNodes(nodes).find(a => a.node.id === 'aband')?.sourceId).toBe('asrc');
    });
  }
});
