/**
 * Agents with shaders (store/agentShaderExamples.ts, docs/agents-group.md "Using Agents with
 * your shaders"): each example compiles with every program live, and wires the pattern it teaches.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { AGENT_SHADER_EXAMPLE_KEYS, buildAgentShaderExamples } from '../../store/agentShaderExamples';
import type { GraphNode } from '../../types/nodeGraph';

const graphs = buildAgentShaderExamples();
const compile = (k: string) => compileGraph({ nodes: resolveNodeAliases(graphs[k].nodes, getNodeDefinition) });
const top = (k: string, id: string) => graphs[k].nodes.find(nd => nd.id === id) as GraphNode;

describe('Agents with shaders', () => {
  it('has the eight examples', () => expect(AGENT_SHADER_EXAMPLE_KEYS).toHaveLength(8));
  it.each(AGENT_SHADER_EXAMPLE_KEYS)('%s compiles, every program live, at 256k', k => {
    const r = compile(k);
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
    expect(r.agents!.groups.every(g => g.live)).toBe(true);
    expect(r.agents!.trails.every(t => t.live)).toBe(true);
    for (const nd of graphs[k].nodes) if (nd.type === 'agentsGroup') expect(nd.params.tier).toBe('256k');
  });
  it('rings: the ring SDF is food, painted into the trail every step (Trail Add)', () => {
    expect(top('agentShaderRings', 'srTrail').inputs.add.connection?.nodeId).toBe('srFood');
    expect(compile('agentShaderRings').agents!.trails[0].stepShader).toMatch(/circleSDF\(/);
  });
  it('walls: the shapes\' distance reaches Move\'s Obstacle ƒ and the Trail\'s Block', () => {
    const fs = compile('agentShaderWalls').agents!.groups[0].fragmentShader;
    expect(fs).toMatch(/sdHeart\(/);
    expect(fs).toMatch(/sdStarN\(/);
    expect(top('agentShaderWalls', 'swTrail').inputs.block.connection?.nodeId).toBe('swBlock');
  });
  it('noise flow, polar, sound rings: an outer chain is read at the walker inside the group', () => {
    expect(compile('agentShaderNoiseFlow').agents!.groups[0].fragmentShader).toMatch(/fbm\(/);
    expect(compile('agentShaderPolar').agents!.groups[0].fragmentShader).toMatch(/atan\(/);
    expect(compile('agentShaderSoundRings').agents!.groups[0].fragmentShader).toMatch(/circleSDF\(/);
  });
  it('emitter and outlines: a Pass is the picture Emit is born on and a texture the rule reads', () => {
    for (const [k, emit, pass] of [['agentShaderEmitter', 'emEmit', 'emPass'], ['agentShaderOutlines', 'olEmit', 'olOutlines']] as const) {
      expect(top(k, emit).inputs.picture.connection).toEqual({ nodeId: pass, outputKey: 'texture' });
      expect(compile(k).agents!.groups[0].fragmentShader).toMatch(/uniform sampler2D u_pass_\w+;/);
    }
    expect(compile('agentShaderEmitter').agents!.groups[0].stateC).toBe(true);
  });
  it('feedback: the trail texture drives Edges and Blur in the picture', () => {
    const r = compile('agentShaderFeedback');
    expect(r.fragmentShader).toMatch(/uniform sampler2D u_trail_\w+;/);
  });
});
