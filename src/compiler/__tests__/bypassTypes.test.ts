/**
 * A bypassed node passes an input through to its outputs. When its first input isn't the output's
 * type, an input of the output's type is used, else the first one converted, never an input of a
 * third type. The Performance panel's cost-by-node bypasses each node in turn: a Palette (Angle wired
 * from FBM) used to compile to `vec3 pal_color = 0.0;` (its Angle offset, a float), which the GPU
 * refused ("'=' : dimension mismatch").
 */
import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import { compileGraph } from '../graphCompiler';
import { n, out } from '../../store/graphBuilder';
import { recompileTriggers } from '../../lib/recompileTriggers';
import type { GraphNode } from '../../types/nodeGraph';

const fbmPalette = (): GraphNode[] => [
  n('uv', 'uv', 0, 0),
  n('time', 'time', 0, 200),
  n('fbm', 'fbm', 200, 0, { octaves: 5, lacunarity: 2, gain: 0.5, scale: 1.6, time_scale: 0.03 }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
  n('palette', 'pal', 400, 0, { preset: '3' }, { value: ['fbm', 'value'] }),
  out(['pal', 'color'], 600),
];

describe('bypass pass-through types', () => {
  it('a bypassed Palette passes its float Angle on as a vec3, not its Angle offset', () => {
    const nodes = fbmPalette().map(x => (x.id === 'pal' ? { ...x, bypassed: true } : x));
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    const line = r.fragmentShader.split('\n').find(l => /vec3 pal_\w*color =/.test(l)) ?? '';
    expect(line).toMatch(/= vec3\(fbm_\w+\);/);
  });

  it('a node whose first input is the output type still passes that one', () => {
    const nodes: GraphNode[] = [
      ...fbmPalette().slice(0, 4),
      n('toneMap', 'tone', 600, 0, {}, { color: ['pal', 'color'] }),
      out(['tone', 'color'], 800),
    ];
    const r = compileGraph({ nodes: nodes.map(x => (x.id === 'tone' ? { ...x, bypassed: true } : x)) });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/vec3 tone_\w*color = pal_\w*color;/);
  });
});

describe('recompile triggers (Performance panel)', () => {
  it('FBM has none: every slider, Octaves too, is a live uniform', () => {
    expect(recompileTriggers(fbmPalette())).toEqual([]);
    const r = compileGraph({ nodes: fbmPalette() });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/fbm\([^;]*int\(u_p_\w*octaves \+ 0\.5\)/);
  });
  it('names the compile-time param, not the whole node', () => {
    expect(recompileTriggers([n('flowField', 'ff', 0, 0)])).toEqual(expect.arrayContaining([expect.stringMatching(/· .*Curves/)]));
  });
});
