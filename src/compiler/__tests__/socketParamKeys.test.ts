/**
 * A float slider and an input socket that drive the same value must share a
 * key: the card swaps the slider for a "wired" chip by `node.inputs[key]`,
 * addNode drops the socket default when a same-keyed paramDef exists, and
 * keyframes bind to the socket key. A socket whose fallback reads a
 * *different* param leaves that slider live-looking but dead while wired.
 */
import { describe, it, expect } from 'vitest';
import { NODE_REGISTRY, getNodeDefinition } from '../../nodes/definitions';
import { compileGraph } from '../graphCompiler';
import { migrateNodeParams } from '../../types/nodeGraph';
import type { GraphNode, InputSocket } from '../../types/nodeGraph';

function savedNode(id: string, type: string, conns: Record<string, { nodeId: string; outputKey: string }> = {}): GraphNode {
  const def = NODE_REGISTRY[type];
  const inputs: Record<string, InputSocket> = {};
  for (const [k, s] of Object.entries(def.inputs)) inputs[k] = { type: s.type, label: s.label, ...(conns[k] ? { connection: conns[k] } : {}) };
  return { id, type, position: { x: 0, y: 0 }, inputs, outputs: { ...def.outputs }, params: { ...def.defaultParams } } as GraphNode;
}

describe('volumeClouds density socket', () => {
  it('is keyed like its slider', () => {
    const def = NODE_REGISTRY.volumeClouds;
    expect(def.inputs.density_scale).toBeDefined();
    expect(def.inputs.density).toBeUndefined();
    expect(def.paramDefs?.density_scale).toBeDefined();
  });

  it('migrates a saved graph wired to the old `density` key and compiles to the same shader', () => {
    const uv = savedNode('uv1', 'uv');
    const time = savedNode('t1', 'time');
    const c = savedNode('c1', 'constant');
    c.params = { ...c.params, value: 2.5 };
    const out = { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'vc1', outputKey: 'color' } } }, outputs: {}, params: {} } as GraphNode;
    const base = { uv: { nodeId: 'uv1', outputKey: 'uv' }, time: { nodeId: 't1', outputKey: 'time' } };

    // A graph saved before the rename: socket keyed `density`.
    const legacy = savedNode('vc1', 'volumeClouds', base);
    delete legacy.inputs.density_scale;
    legacy.inputs.density = { type: 'float', label: 'Density Scale', connection: { nodeId: 'c1', outputKey: 'value' } };

    const migrated = migrateNodeParams(legacy, getNodeDefinition);
    expect(Object.keys(migrated.inputs)).not.toContain('density');
    expect(migrated.inputs.density_scale?.connection).toEqual({ nodeId: 'c1', outputKey: 'value' });

    // The same graph saved with the current key.
    const current = savedNode('vc1', 'volumeClouds', { ...base, density_scale: { nodeId: 'c1', outputKey: 'value' } });

    const a = compileGraph({ nodes: [uv, time, c, migrated, out] });
    const b = compileGraph({ nodes: [uv, time, c, current, out] });
    expect(a.success).toBe(true);
    expect(a.fragmentShader).toBe(b.fragmentShader);
    expect(a.paramUniforms).toEqual(b.paramUniforms);
    // The wired socket, not the slider, feeds the density term.
    // (node ids are slugified in the shader: the Constant's output is `cst_1_value`)
    expect(a.fragmentShader).toMatch(/_dens = cloudDensity\([^;]*\) \* cst_1_value;/);
  });
});
