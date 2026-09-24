/**
 * MIDI Input node: the compiler declares one float uniform per output and
 * maps it back to the node's ORIGINAL id + channel, so the input bus can
 * route engine values without knowing the slug. This is the contract the
 * audio path broke (it rebuilt names from the raw id); the bus test below
 * proves the translation end to end.
 */
import { describe, it, expect } from 'vitest';
import { compileGraph } from '../graphCompiler';
import { inputBus } from '../../lib/inputBus';
import { midiEngine } from '../../lib/midiEngine';
import { midiOutputSockets } from '../../lib/midiOutputs';
import type { GraphNode } from '../../types/nodeGraph';

function midiNode(id: string, params: Record<string, unknown> = {}, label?: string): GraphNode {
  const p = { channel: 'all', smooth_ms: 0, _ccs: [1, 74], ...params, ...(label ? { label } : {}) };
  return {
    id, type: 'midiInput', position: { x: 0, y: 0 }, inputs: {},
    outputs: midiOutputSockets(p), params: p,
  } as GraphNode;
}

function outputNode(fromId: string, outKey: string): GraphNode {
  return {
    id: 'out', type: 'output', position: { x: 600, y: 0 },
    inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: fromId, outputKey: outKey } } },
    outputs: {}, params: {},
  } as GraphNode;
}

describe('MIDI Input node', () => {
  it('declares a float uniform per output and maps each to nodeId::channel', () => {
    const r = compileGraph({ nodes: [midiNode('node_7'), outputNode('node_7', 'velocity')] });
    expect(r.success).toBe(true);
    const keys = Object.keys(r.liveUniforms).sort();
    expect(keys).toEqual([
      'u_midi_midi_7_bend', 'u_midi_midi_7_cc_1', 'u_midi_midi_7_cc_74',
      'u_midi_midi_7_gate', 'u_midi_midi_7_note', 'u_midi_midi_7_velocity',
    ]);
    expect(r.liveUniforms['u_midi_midi_7_cc_74']).toBe('node_7::cc_74');
    for (const name of keys) expect(r.fragmentShader).toContain(`uniform float ${name};`);
    // The output that's wired is read from the uniform, never inlined.
    expect(r.fragmentShader).toMatch(/float midi_7_velocity = u_midi_midi_7_velocity;/);
  });

  it('follows a custom label into the slug without breaking the binding', () => {
    const r = compileGraph({ nodes: [midiNode('node_3', {}, 'Nano Kontrol'), outputNode('node_3', 'note')] });
    expect(r.success).toBe(true);
    const entry = Object.entries(r.liveUniforms).find(([, ch]) => ch === 'node_3::note');
    expect(entry).toBeDefined();
    expect(entry![0]).not.toContain('node_3'); // slugged, not the raw id
    expect(r.fragmentShader).toContain(`uniform float ${entry![0]};`);
  });

  it('routes engine values to the compiled uniform names through the bus', () => {
    const r = compileGraph({ nodes: [midiNode('node_7'), outputNode('node_7', 'velocity')] });
    inputBus.setBindings(r.liveUniforms);
    const off = inputBus.addSource(midiEngine);
    try {
      midiEngine.updateNode('node_7', { channel: 'all', smooth_ms: 0, _ccs: [1, 74] });
      midiEngine.handleBytes(0x90, 60, 127);   // note on C4, full velocity, ch 1
      midiEngine.handleBytes(0xb0 | 2, 74, 64); // CC74 on ch 3 (omni node still sees it)
      const values = inputBus.tick(1 / 60, 0);
      expect(values.get('u_midi_midi_7_velocity')).toBeCloseTo(1);
      expect(values.get('u_midi_midi_7_note')).toBeCloseTo(60 / 127);
      expect(values.get('u_midi_midi_7_gate')).toBe(1);
      expect(values.get('u_midi_midi_7_cc_74')).toBeCloseTo(64 / 127);
      // Unbound channels (nothing compiled for them) are dropped, not leaked.
      expect([...values.keys()].every(k => k.startsWith('u_midi_midi_7_'))).toBe(true);
    } finally {
      off();
      midiEngine.removeNode('node_7');
      inputBus.setBindings({});
    }
  });

  it('produces nothing when no live uniform is bound', () => {
    inputBus.setBindings({});
    expect(inputBus.tick(0.016, 0).size).toBe(0);
    expect(inputBus.hasBindings()).toBe(false);
  });
});
