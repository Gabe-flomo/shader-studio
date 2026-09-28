/**
 * Sliders on nodes inside a Scene Group (and groups / march bodies around it)
 * compile to live uniforms bound by the inner node's own id — the key the
 * store's slider fast path looks up — so a drag is a uniform write, not a
 * recompile. The owner's repro: GI: Box Frame, dragging the Box Frame's Size X.
 */
import { describe, it, expect } from 'vitest';
import { loadExampleGraphs } from '../../store/exampleIndex';
import { compileGraph } from '../graphCompiler';
import { paramBindingKey } from '../uniformPatcher';

describe('scene group sliders', () => {
  it('GI: Box Frame binds the Box Frame sizes to uniforms', async () => {
    const examples = await loadExampleGraphs();
    const r = compileGraph({ nodes: examples.giBoxFrame.nodes });
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    for (const key of ['sizeX', 'sizeY', 'sizeZ', 'thickness']) {
      const uniform = r.paramBindings[paramBindingKey('gbf_frm', key)];
      expect(uniform, `binding for gbf_frm::${key}`).toBeTruthy();
      expect(r.paramUniforms[uniform]).toBeTypeOf('number');
      // Declared and read inside the scene function.
      expect(r.fragmentShader).toMatch(new RegExp(`uniform float ${uniform};`));
      expect(r.fragmentShader.replace(/^\s*uniform .*$/gm, '')).toMatch(new RegExp(`\\b${uniform}\\b`));
    }
    expect(r.paramUniforms[r.paramBindings['gbf_frm::sizeX']]).toBe(0.65);
    expect(r.paramUniforms[r.paramBindings['gbf_sdf::radius']]).toBe(0.32);
    // The GI group's own continuous sliders are live too; its step counts stay baked.
    expect(r.paramUniforms[r.paramBindings['gbf_gi::maxDist']]).toBeTypeOf('number');
    expect(r.paramBindings['gbf_gi::aoSteps']).toBeUndefined();
  });
});
