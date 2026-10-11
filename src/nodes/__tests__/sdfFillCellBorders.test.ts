import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../../sceneBuilder2d/build';
import { templateScene } from '../../sceneBuilder2d/templates';
import { SDFFillNode } from '../definitions/combiners';
import type { GraphNode } from '../../types/nodeGraph';

// SDF Fill's "Crisp" edge used fwidth(d) as its softening width. Across a cell border (a grid, or
// Pixelate's blocks) d jumps, fwidth measures the jump, and every border pixel next to a filled
// cell got half-filled: faint lines along empty cells' edges. The width is now capped to one
// pixel when the change is too big to be a real SDF's slope.
function fillCode(params: Record<string, unknown> = {}, inputs: Record<string, string> = { d: 'dd' }) {
  const node = { id: 'f', type: 'sdfFill', position: { x: 0, y: 0 }, params: { ...SDFFillNode.defaultParams, ...params }, inputs: {} } as unknown as GraphNode;
  return SDFFillNode.generateGLSL(node, inputs).code;
}

describe('SDF Fill crisp edge across cell borders', () => {
  it('treats a jump in the distance as a hard edge instead of a smear', () => {
    const code = fillCode();
    expect(code).toContain('float f_fw = fwidth(f_d);');
    expect(code).toMatch(/f_aa = max\(f_fw > 4\.0 \* f_px \? f_px : f_fw, 0\.00001\)/);
    expect(code).toContain('u_resolution.y');
    expect(code).not.toMatch(/max\(fwidth\(f_d\), 0\.00001\)/);
  });

  it('leaves the Softness slider alone', () => {
    const code = fillCode({ aaMode: 'fixed', antialias: 0.01 });
    expect(code).not.toContain('fwidth');
  });

  for (const key of ['pixel', 'rippleGrid', 'mouseGrid']) {
    it(`2D template ${key}: every fill is border-safe and it compiles`, () => {
      const { nodes } = buildStandalone2D(templateScene(key));
      const r = compileGraph({ nodes }) as unknown as { success: boolean; fragmentShader: string };
      expect(r.success).toBe(true);
      expect(r.fragmentShader).not.toMatch(/_aa = max\(fwidth\(/);
      expect(r.fragmentShader).toMatch(/_fw > 4\.0 \* \w+_px/);
    });
  }
});
