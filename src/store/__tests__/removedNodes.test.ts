/**
 * The old particle systems (Particle Emitter, the P: chain, Particle System)
 * were removed for the Particles node; later Glow Falloff, the 3D fractal DE
 * nodes, Chladni 3D, the orbital nodes and Print Float / Print Text went too.
 * A saved graph that still holds one must open without crashing and say what
 * happened, not "Unknown node type".
 */
import { describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { REMOVED_NODE_TYPES, removedNodeMessage } from '../../nodes/definitions/removedNodes';

const node = (id: string, type: string, inputs: GraphNode['inputs'], outputs: GraphNode['outputs'], params: Record<string, unknown> = {}): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs, params });

/** A graph as an older version saved it: Time → Particle Emitter → Glow → Output. */
const oldSave = () => JSON.stringify({
  nodes: [
    node('t', 'time', {}, { time: { type: 'float', label: 'Time' } }),
    node('emit', 'particleEmitter',
      { time: { type: 'float', label: 'Time', connection: { nodeId: 't', outputKey: 'time' } } },
      { nearest_dist: { type: 'float', label: 'Nearest Dist' } },
      { max_particles: 40, lifetime: 5 }),
    node('glow', 'light',
      { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'emit', outputKey: 'nearest_dist' } } },
      { tinted: { type: 'vec3', label: 'Tinted' } }),
    node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'glow', outputKey: 'tinted' } } }, {}),
  ],
});

describe('removed node types', () => {
  it('are gone from the registry, each with a message naming its replacement', () => {
    for (const type of Object.keys(REMOVED_NODE_TYPES)) {
      expect(getNodeDefinition(type), type).toBeUndefined();
      expect(removedNodeMessage(type)).toMatch(/^.+ was removed( — use the .+ node)?$/);
    }
    expect(removedNodeMessage('particleEmitter')).toBe('Particle Emitter was removed — use the Particles node');
    expect(removedNodeMessage('glowFalloff')).toBe('Glow Falloff was removed — use the Distance Falloff node');
    expect(removedNodeMessage('mengerSponge')).toBe('Menger Sponge was removed');
    expect(removedNodeMessage('mandelbulb')).toBeNull();
    expect(removedNodeMessage('gpuParticles')).toBeNull();
    expect(removedNodeMessage('toString')).toBeNull();
  });

  it('a saved graph with one loads, and the compile error says what was removed', () => {
    const r = useNodeGraphStore.getState().importGraph(oldSave());
    expect(r.ok).toBe(true);
    const st = useNodeGraphStore.getState();
    expect(st.nodes.map(n => n.type)).toContain('particleEmitter');
    expect(st.compilationErrors).toContain('Particle Emitter was removed — use the Particles node');
    expect(st.compilationErrors.join('\n')).not.toMatch(/Unknown node type/);
  });

  it('inside a group too, each removed type once', () => {
    const inner = [node('a', 'pInit', {}, {}), node('b', 'pRender', {}, {}), node('c', 'pInit', {}, {})];
    const r = compileGraph({ nodes: [
      node('g', 'group', {}, {}, { subgraph: { nodes: inner, inputPorts: [], outputPorts: [] } }),
      node('out', 'output', { color: { type: 'vec3', label: 'Color' } }, {}),
    ] });
    expect(r.success).toBe(false);
    expect(r.errors).toEqual(['P: Init was removed — use the Particles node', 'P: Render was removed — use the Particles node']);
  });

  it('the 2026-10 removals: each one is gone, and an old graph with them still loads', () => {
    const gone = ['glowFalloff', 'mandelboxDE', 'kifsTetra', 'mengerSponge', 'chladni3d', 'chladni3dParticles', 'electronOrbital', 'orbitalVolume3d', 'printFloat', 'printText'];
    for (const type of gone) {
      expect(getNodeDefinition(type), type).toBeUndefined();
      expect(removedNodeMessage(type), type).not.toBeNull();
    }
    const save = JSON.stringify({ nodes: [
      node('uv', 'uv', {}, { uv: { type: 'vec2', label: 'UV' } }),
      node('txt', 'printText', { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv', outputKey: 'uv' } } }, { mask: { type: 'float', label: 'Text Mask' } }, { text: 'hi' }),
      node('glow', 'glowFalloff', { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'txt', outputKey: 'mask' } } }, { glow: { type: 'float', label: 'Glow' } }),
      node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'glow', outputKey: 'glow' } } }, {}),
    ] });
    const r = useNodeGraphStore.getState().importGraph(save);
    expect(r.ok).toBe(true);
    const st = useNodeGraphStore.getState();
    expect(st.nodes.map(n => n.type)).toEqual(expect.arrayContaining(['printText', 'glowFalloff']));
    expect(st.compilationErrors).toContain('Print Text was removed');
    expect(st.compilationErrors).toContain('Glow Falloff was removed — use the Distance Falloff node');
    expect(st.compilationErrors.join('\n')).not.toMatch(/Unknown node type/);
  });
});
