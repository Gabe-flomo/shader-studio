/**
 * Colorize (a float field painted with a colour) and Stops Palette (a palette
 * from colour stops that cycles like Palette).
 */
import { describe, expect, it } from 'vitest';
import { compileGraph } from '../graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';

const uv: GraphNode = { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} };
const time: GraphNode = { id: 't', type: 'time', position: { x: 0, y: 0 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} };
const len: GraphNode = { id: 'len', type: 'length', position: { x: 0, y: 0 },
  inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv', outputKey: 'uv' } }, scale: { type: 'float', label: 'Scale' } },
  outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1 } };
const out = (from: string, key = 'color'): GraphNode => ({ id: 'out', type: 'output', position: { x: 0, y: 0 },
  inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: from, outputKey: key } } }, outputs: {}, params: {} });

const stopPalette = (params: Record<string, unknown>): GraphNode => ({ id: 'sp', type: 'stopPalette', position: { x: 0, y: 0 },
  inputs: { value: { type: 'float', label: 'Angle', connection: { nodeId: 'len', outputKey: 'output' } }, anim: { type: 'float', label: 'Angle offset', connection: { nodeId: 't', outputKey: 'time' } } },
  outputs: { color: { type: 'vec3', label: 'Color' } }, params });

describe('Colorize', () => {
  it('is Colour × Field with a black background, and mixes from Background otherwise', () => {
    const node: GraphNode = { id: 'cz', type: 'colorize', position: { x: 0, y: 0 },
      inputs: { field: { type: 'float', label: 'Field', connection: { nodeId: 'len', outputKey: 'output' } }, color: { type: 'vec3', label: 'Colour' }, background: { type: 'vec3', label: 'Background' }, gain: { type: 'float', label: 'Gain' } },
      outputs: { color: { type: 'vec3', label: 'Color' } }, params: { color: [1, 0.5, 0.2], background: [0, 0, 0], gain: 2 } };
    const r = compileGraph({ nodes: [uv, len, node, out('cz')] });
    expect(r.success, r.errors?.join()).toBe(true);
    // colour and background are live uniforms, so the swatches never recompile
    expect(r.fragmentShader).toMatch(/vec3 \w+_color = mix\(u_p_\w+_background, u_p_\w+_color, \w+ \* u_p_\w+_gain\);/);
  });

  it('takes a wired colour over the swatch', () => {
    const pal = stopPalette({ stops: '3' });
    const node: GraphNode = { id: 'cz', type: 'colorize', position: { x: 0, y: 0 },
      inputs: { field: { type: 'float', label: 'Field', connection: { nodeId: 'len', outputKey: 'output' } }, color: { type: 'vec3', label: 'Colour', connection: { nodeId: 'sp', outputKey: 'color' } } },
      outputs: { color: { type: 'vec3', label: 'Color' } }, params: {} };
    const r = compileGraph({ nodes: [uv, time, len, pal, node, out('cz')] });
    expect(r.success, r.errors?.join()).toBe(true);
    expect(r.fragmentShader).toMatch(/_color = mix\(vec3\([^)]*\), stoppalett\w*_color, /);
  });
});

describe('Stops Palette', () => {
  const body = (params: Record<string, unknown>) => {
    const r = compileGraph({ nodes: [uv, time, len, stopPalette(params), out('sp')] });
    expect(r.success, r.errors?.join()).toBe(true);
    return r.fragmentShader;
  };

  it('Loop has one segment per stop and wraps the last back to the first', () => {
    const fs = body({ stops: '4', wrap: 'loop' });
    expect(fs).toMatch(/fract\(/);
    expect(fs.match(/if \(\w+_x >= \d\.0\)/g)).toHaveLength(4);
    expect(fs).toMatch(/mix\(\w+_c3, \w+_c0, /);          // last → first
    expect(fs).toMatch(/\w+_x = min\(fract\([^;]+\) \* 4\.0, 4\.0 - 0\.0001\);/);
  });

  it('Clamp and Mirror stop at the last stop; Bands is a hard step', () => {
    const clamp = body({ stops: '3', wrap: 'clamp', blend: 'bands' });
    expect(clamp.match(/if \(\w+_x >= \d\.0\)/g)).toHaveLength(2);
    expect(clamp).not.toMatch(/mix\(\w+_c2, \w+_c0/);
    expect(clamp).toMatch(/mix\(\w+_c0, \w+_c1, 0\.0\)/);
    const mirror = body({ stops: '3', wrap: 'mirror' });
    expect(mirror).toMatch(/abs\(fract\([^;]+\* 0\.5\) \* 2\.0 - 1\.0\)/);
  });

  it('stop colours are live uniforms', () => {
    const fs = body({ stops: '2', color0: [1, 0, 0], color1: [0, 0, 1] });
    expect(fs).toMatch(/vec3 \w+_c0 = u_p_\w+_color0;/);
    expect(fs).toMatch(/vec3 \w+_c1 = u_p_\w+_color1;/);
  });
});
