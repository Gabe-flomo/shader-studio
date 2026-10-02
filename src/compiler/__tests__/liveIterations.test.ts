/**
 * A group's Iterations on the Play panel (implementation guide, small tasks):
 * compiled to the cap (128) with a break at a uniform bound to the group's
 * `iterations`, so turning it doesn't recompile. Otherwise unchanged.
 */
import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import { parser } from '@shaderfrog/glsl-parser';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import { compileGraph } from '../graphCompiler';
import { n, out, group } from '../../store/graphBuilder';
import { MAX_GROUP_ITERATIONS } from '../../nodes/definitions/group';
import type { GraphNode } from '../../types/nodeGraph';

const iterated = (iterations: number, live: boolean): GraphNode[] => {
  const g = group('g', 0, 0, {
    label: 'Repeat', iterations, inputs: [],
    outputs: [{ key: 'd', type: 'float', label: 'Distance', from: ['circ', 'distance'] }],
    nodes: [n('uv', 'uv', 0, 0), n('circleSDF', 'circ', 100, 0, { radius: 0.3 }, { position: ['uv', 'uv'] })],
  });
  if (live) g.params.liveIterations = true;
  return [g, out(['g', 'd'], 400)];
};

describe('live iterations', () => {
  it('the cap is 128', () => expect(MAX_GROUP_ITERATIONS).toBe(128));

  it('a live group loops to the cap and stops at its uniform, bound to the group’s iterations', () => {
    const r = compileGraph({ nodes: iterated(5, true) });
    expect(r.errors ?? []).toEqual([]);
    const name = r.paramBindings['g::iterations'];
    expect(name).toMatch(/^u_\w+_iterations$/);
    expect(r.paramUniforms[name]).toBe(5);
    expect(r.fragmentShader).toContain(`uniform float ${name};`);
    // Every name declared: the shader parses as GLSL.
    expect(() => parser.parse(preprocess('vec4 gl_FragColor;\n' + r.fragmentShader, { preserve: {} }), { quiet: true, failOnWarn: true })).not.toThrow();
    expect(r.fragmentShader).toMatch(new RegExp(`< ${MAX_GROUP_ITERATIONS}\\.0; \\w+\\+\\+\\) \\{\\n\\s+if \\(\\w+ >= ${name}\\) break;`));
    // Even at 1 it is a loop (it may be turned up while playing).
    expect(compileGraph({ nodes: iterated(1, true) }).fragmentShader).toContain('break;');
  });

  it('a group not on the panel keeps its literal count', () => {
    const r = compileGraph({ nodes: iterated(5, false) });
    expect(r.paramBindings['g::iterations']).toBeUndefined();
    expect(r.fragmentShader).toMatch(/< 5\.0; \w+\+\+\) \{/);
    expect(r.fragmentShader).not.toMatch(/_iterations\) break/);
  });
});
