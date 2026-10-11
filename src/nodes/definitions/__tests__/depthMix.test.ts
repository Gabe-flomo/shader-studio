/**
 * Depth Mix (nodes/definitions/depthMix.ts, docs/depth-mix.md): every mode compiles beside a picture and a Depth
 * node, the shapes can read Depth UV and Sized value, and the gradient over depth comes out where it should. The
 * maths is checked on a synthetic depth (no model, nothing downloaded).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../../compiler/graphCompiler';
import { n } from '../../../store/graphBuilder';
import { getNodeDefinition } from '..';
import {
  DEPTH_MIX_COMBINES, DEPTH_MIX_MODES, DEPTH_SPACE_STYLES, depthMixFront, depthMixGradient, depthMixScale, depthMixShape, depthMixUv,
} from '../depthMix';
import type { GraphNode } from '../../../types/nodeGraph';

/** A picture, its depth, a circle measured at Depth UV with its radius Sized by depth, glowing, and a Depth Mix. */
function graph(params: Record<string, unknown> = {}): GraphNode[] {
  return [
    n('uv', 'uv', 0, 0),
    n('textureInput', 'pic', 0, 0),
    n('depth', 'dep', 0, 0, {}, { texture: ['pic', 'texture'] }),
    // Shapes read the first Depth Mix (no scene wired): Depth UV and Sized value
    n('depthMix', 'shapes', 0, 0, { mode: 'space' }, { picture: ['pic', 'color'], depth: ['dep', 'depth'], uv: ['uv', 'uv'] }),
    n('shapeSDF', 'circle', 0, 0, { shape: 'circle', r: 0.3 }, { p: ['shapes', 'uv'] }),
    n('glowLayer', 'glow', 0, 0, { intensity: 0.01, power: 1.2 }, { d: ['circle', 'distance'] }),
    n('depthMix', 'mix', 0, 0, params, { picture: ['pic', 'color'], depth: ['dep', 'depth'], scene: ['glow', 'result'], uv: ['uv', 'uv'] }),
    n('output', 'out', 0, 0, {}, { color: ['mix', 'color'] }),
  ];
}

const compiles = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  expect(() => parser.parse(r.fragmentShader, { quiet: true })).not.toThrow();
  return r.fragmentShader;
};
/** The compiled name of the Depth Mix the Output shows (the compiler renames node ids). */
const out = (fs: string) => /gl_FragColor = vec4\((\w+)_color/.exec(fs)![1];
const has = (fs: string, re: (id: string) => RegExp) => expect(fs).toMatch(re(out(fs)));

describe('Depth Mix', () => {
  it('is in the registry, under Texture tools, with a mode for each look', () => {
    const def = getNodeDefinition('depthMix')!;
    expect(def.label).toBe('Depth Mix');
    expect(def.category).toBe('Texture tools');
    expect(def.paramDefs!.mode.options!.map(o => o.value)).toEqual([...DEPTH_MIX_MODES]);
  });

  it.each(DEPTH_MIX_MODES)('mode %s compiles beside a picture and its Depth node', mode => {
    has(compiles(graph({ mode })), id => new RegExp(`${id}_n = pow\\(clamp`));
  });

  it.each(DEPTH_MIX_COMBINES)('With the picture: %s compiles', combine => {
    compiles(graph({ mode: 'occlude', combine }));
    compiles(graph({ mode: 'size', combine }));
  });

  it.each(DEPTH_SPACE_STYLES)('Depth → space, %s, compiles and moves the point', spaceStyle => {
    has(compiles(graph({ mode: 'space', spaceStyle })), id => new RegExp(`vec2 ${id}_uv = `));
  });

  it('depth → size: a circle\'s radius read through Sized value compiles', () => {
    const nodes = graph({ mode: 'size' });
    const c = nodes.find(x => x.id === 'circle')!;
    // The radius as a wire: Value in, Sized value out, into a Ring SDF's radius (a float socket)
    nodes.push(n('constant', 'r', 0, 0, { value: 0.25 }));
    nodes.find(x => x.id === 'shapes')!.inputs.value = { type: 'float', label: 'Value', connection: { nodeId: 'r', outputKey: 'value' } };
    nodes.push(n('ringSDF', 'ring', 0, 0, {}, { position: ['uv', 'uv'], radius: ['shapes', 'sized'] }));
    c.inputs.p = { ...c.inputs.p, connection: { nodeId: 'uv', outputKey: 'uv' } };
    nodes.find(x => x.id === 'glow')!.inputs.d = { type: 'float', label: 'd', connection: { nodeId: 'ring', outputKey: 'distance' } };
    const fs = compiles(nodes);
    expect(fs).toMatch(/(\w+)_sized = \(\w+\) \* \1_scale/);
  });

  it('the gradient over depth: off writes black, a preset lays a cosine palette along depth, on the scene, the picture or both', () => {
    has(compiles(graph({ mode: 'mix' })), id => new RegExp(`vec3 ${id}_grad = vec3\\(0\\.0\\)`));
    for (const gradientTo of ['scene', 'picture', 'both']) {
      for (const gradientHow of ['multiply', 'colorize', 'add']) {
        const fs = compiles(graph({ mode: 'mix', gradient: '1', gradientTo, gradientHow }));
        const id = out(fs);
        expect(fs).toContain(`${id}_grad = vec3(0.5, 0.5, 0.5) + vec3(0.5, 0.5, 0.5) * cos(6.2831853`);
        const pic = new RegExp(`vec3 ${id}_pic = ([^;]*);`).exec(fs)![1];
        const sc = new RegExp(`vec3 ${id}_sc = ([^;]*);`).exec(fs)![1];
        expect(pic.includes(`${id}_grad`)).toBe(gradientTo !== 'scene');
        expect(sc.includes(`${id}_grad`)).toBe(gradientTo !== 'picture');
      }
    }
  });

  it('the gradient\'s Phase socket adds to its phase (wire Time to make it flow)', () => {
    const nodes = graph({ mode: 'light', gradient: '4' });
    nodes.push(n('time', 't', 0, 0));
    nodes.find(x => x.id === 'mix')!.inputs.phase = { type: 'float', label: 'Phase', connection: { nodeId: 't', outputKey: 'time' } };
    has(compiles(nodes), id => new RegExp(`${id}_n \\* \\w+ \\+ \\w+ \\+ \\(time`));
  });

  describe('the maths on a synthetic depth', () => {
    it('shapes depth through the range and the curve', () => {
      expect(depthMixShape(1, 0, 1, 1)).toBe(1);
      expect(depthMixShape(0.25, 0, 1, 1)).toBeCloseTo(0.25);
      expect(depthMixShape(0.6, 0.2, 1, 1)).toBeCloseTo(0.5);
      expect(depthMixShape(0.5, 0, 1, 2)).toBeCloseTo(0.25);
      expect(depthMixShape(0.1, 0.2, 1, 1)).toBe(0);
      // A reversed range turns it over
      expect(depthMixShape(0.25, 1, 0, 1)).toBeCloseTo(0.75);
    });

    it('size grows shapes on near things', () => {
      expect(depthMixScale(0, 0.4, 1.6)).toBeCloseTo(0.4);
      expect(depthMixScale(1, 0.4, 1.6)).toBeCloseTo(1.6);
    });

    it('space moves near and far apart about Focus', () => {
      expect(depthMixUv([0.2, 0.1], 0.5, 'shift', 0.2, 0, 0.5)).toEqual([0.2, 0.1]);
      const [x, y] = depthMixUv([0, 0], 1, 'shift', 0.2, 90, 0);
      expect(x).toBeCloseTo(0); expect(y).toBeCloseTo(0.2);
      expect(depthMixUv([0.5, 0], 1, 'radial', 0.5, 0, 0)[0]).toBeCloseTo(0.75);
      const r = depthMixUv([1, 0], 1, 'swirl', 0.25, 0, 0);
      expect(r[0]).toBeCloseTo(0); expect(r[1]).toBeCloseTo(1);
    });

    it('occlude: the scene shows where it sits nearer than the picture', () => {
      expect(depthMixFront(0.2, 0.5, 0.05)).toBe(1);
      expect(depthMixFront(0.9, 0.5, 0.05)).toBe(0);
      expect(depthMixFront(0.5, 0.5, 0.05)).toBeCloseTo(0.5);
    });

    it('the gradient changes colour as the picture gets deeper, and Phase shifts it', () => {
      const far = depthMixGradient(0, 1, 1, 0), near = depthMixGradient(0.5, 1, 1, 0);
      expect(far).not.toEqual(near);
      const shifted = depthMixGradient(0, 1, 1, 0.5);
      near.forEach((v, i) => expect(shifted[i]).toBeCloseTo(v));
    });
  });
});
