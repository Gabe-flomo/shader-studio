import { describe, expect, it } from 'vitest';
import { compileGraph } from '../../compiler/graphCompiler';
import { n, out, group, port, time, uv } from '../../store/graphBuilder';
import { retypeDataNode } from '../../nodes/definitions/data';
import { dataBindingsFromShader, dataTexUniform } from '../dataGlsl';
import { packColumns, texSize } from '../texturePack';
import { parseCsv } from '../parse';
import type { GraphNode } from '../../types/nodeGraph';

/** A Data node with its sockets in step with its params, as the store keeps them. */
const data = (id: string, params: Record<string, unknown>, wires: Record<string, [string, string]> = {}): GraphNode => {
  const base = retypeDataNode(n('data', id, 300, 200, params));
  const inputs = { ...base.inputs };
  for (const [k, w] of Object.entries(wires)) inputs[k] = { ...inputs[k], connection: { nodeId: w[0], outputKey: w[1] } };
  return { ...base, inputs };
};

describe('Data node', () => {
  it('compiles with no dataset: outputs are zero, no data uniforms', () => {
    const r = compileGraph({ nodes: [data('d', {}), out(['d', 'count'], 600)] });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).not.toMatch(/u_ds_/);
  });

  it('Values: float and vec2 outputs, Index blends two rows, wraps', () => {
    const d = data('d', { dataset: 'cities', outputs: [{ key: 'o1', columns: ['temp'] }, { key: 'o2', columns: ['x', 'y'] }] });
    expect(d.outputs.o1.type).toBe('float');
    expect(d.outputs.o2.type).toBe('vec2');
    expect(d.outputs.o2.label).toBe('x, y');
    const r = compileGraph({ nodes: [d, n('makeVec3', 'c', 500, 200, {}, { r: ['d', 'o1'], g: ['d', 'count'] }), out(['c', 'rgb'], 700)] });
    expect(r.success, r.errors?.join('\n')).toBe(true);
    const fs = r.fragmentShader;
    const tex = dataTexUniform('cities', ['temp', 'x', 'y']);
    expect(fs).toContain(`uniform sampler2D ${tex};`);
    expect(fs).toContain('uniform float u_ds_cities_n;');
    expect(fs).toMatch(/mix\(dsFetch\(u_ds_cities_\w+, \w+_a\), dsFetch\(u_ds_cities_\w+, \w+_b\), \w+_t\)/);
    expect(fs).toMatch(/mod\(u_p_\w+_index, \w+_n\)/); // Index is a live uniform, wrapped
    expect(fs).toContain('texelFetch(');
    // Helpers come before anything that could call them
    expect(fs.indexOf('uniform float u_ds_cities_n')).toBeLessThan(fs.indexOf('void main'));
    const b = dataBindingsFromShader(fs);
    expect(b.textures).toEqual([{ uniform: tex, dataset: 'cities', columns: ['temp', 'x', 'y'] }]);
    expect(b.counts).toEqual([{ uniform: 'u_ds_cities_n', dataset: 'cities' }]);
  });

  it('Values without Blend, clamped: one fetch per texture, no mix', () => {
    const d = data('d', { dataset: 'cities', blend: false, edge: 'clamp', outputs: [{ key: 'o1', columns: ['a', 'b', 'c', 'd', 'e'].slice(0, 4) }, { key: 'o2', columns: ['e'] }] });
    const r = compileGraph({ nodes: [d, out(['d', 'o2'], 600)] });
    expect(r.success, r.errors?.join('\n')).toBe(true);
    expect(r.fragmentShader).toMatch(/clamp\(u_p_\w+_index, 0\.0, \w+_n - 1\.0\)/);
    expect(r.fragmentShader).not.toMatch(/mix\(dsFetch/);
    // Five columns: two textures
    expect(dataBindingsFromShader(r.fragmentShader).textures.map(t => t.columns)).toEqual([['a', 'b', 'c', 'd'], ['e']]);
  });

  it('a wired Index replaces the slider; in an iterated group it reads a row per pass', () => {
    const inner = [
      n('loopIndex', 'li', 0, 0),
      data('dd', { dataset: 'route', outputs: [{ key: 'o1', columns: ['x', 'y'] }] }, { index: ['li', 'i'] }),
      n('circleSDF', 'cs', 0, 0, { radius: 0.02 }, { position: port('p'), offset: ['dd', 'o1'] }),
      { ...n('light', 'gl', 0, 0, {}, { distance: ['cs', 'distance'] }), assignOp: '+=' as const },
    ];
    const g = group('g', 400, 200, {
      label: 'Every row', iterations: 16,
      inputs: [{ key: 'p', type: 'vec2', label: 'UV', from: ['uv', 'uv'] }],
      outputs: [{ key: 'glow', type: 'float', label: 'Glow', from: ['gl', 'glow'] }],
      nodes: inner,
    });
    const r = compileGraph({ nodes: [uv(), g, out(['g', 'glow'], 700)] });
    expect(r.success, r.errors?.join('\n')).toBe(true);
    expect(r.fragmentShader).toMatch(/for \(float/);
    expect(dataBindingsFromShader(r.fragmentShader).textures[0]?.columns).toEqual(['x', 'y']);
  });

  it('the row helper is a GLSL function Custom Functions can call', () => {
    const d = data('d', { dataset: 'route', rowColumns: ['x', 'y'], glslName: 'route' });
    const fn = n('customFn', 'f', 500, 200, { label: 'Uses data', inputs: [], outputType: 'float', body: 'return route(3.0).x + route_count();' });
    // (a helper function of the Custom Function calling it has to come after it too)
    fn.params.glslFunctions = 'float routeX(float i) { return route(i).x; }';
    fn.params.body = 'return routeX(3.0) + route_count();';
    const r = compileGraph({ nodes: [d, fn, out(['f', 'result'], 700)] });
    expect(r.success, r.errors?.join('\n')).toBe(true);
    expect(r.fragmentShader).toMatch(/vec4 route\(float row\)/);
    expect(r.fragmentShader.indexOf('vec4 route(float row)')).toBeLessThan(r.fragmentShader.indexOf('float routeX('));
  });

  it('Points: distance, nearest row and second distance, looped up to Max points; Path joins rows', () => {
    const d = data('d', { dataset: 'route', mode: 'points', pointColumns: ['x', 'y'], maxPoints: 64 });
    expect(Object.keys(d.outputs)).toEqual(['distance', 'nearest', 'second', 'count']);
    expect(d.inputs.p.type).toBe('vec2');
    const r = compileGraph({ nodes: [d, out(['d', 'distance'], 700)] });
    expect(r.success, r.errors?.join('\n')).toBe(true);
    expect(r.fragmentShader).toMatch(/for \(int \w+ = 0; \w+ < 64;/);
    expect(r.fragmentShader).toContain('dsSmin(');
    const path = compileGraph({ nodes: [data('d', { dataset: 'route', mode: 'points', shape: 'path', pointColumns: ['x', 'y', 'z'] }), out(['d', 'second'], 700)] });
    expect(path.success, path.errors?.join('\n')).toBe(true);
    expect(path.fragmentShader).toContain('dsSegment(');
    expect(retypeDataNode(n('data', 'z', 0, 0, { mode: 'points', pointColumns: ['x', 'y', 'z'] })).inputs.p.type).toBe('vec3');
  });

  it('Keyframes: time column (binary search) or even spacing; every interpolation compiles', () => {
    for (const interp of ['none', 'linear', 'smooth', 'easeIn', 'easeOut', 'easeInOut', 'catmull']) {
      for (const timeColumn of ['', 't']) {
        const d = data('d', { dataset: 'route', mode: 'keyframes', interp, timeColumn, ends: interp === 'none' ? 'hold' : 'pingpong', outputs: [{ key: 'o1', columns: ['x', 'y', 'z'] }] }, { time: ['time', 'time'] });
        const r = compileGraph({ nodes: [time(), d, out(['d', 'o1'], 700)] });
        expect(r.success, `${interp}/${timeColumn}: ${r.errors?.join('\n')}`).toBe(true);
        if (timeColumn) expect(r.fragmentShader).toMatch(/for \(int \w+_s = 0; \w+_s < 20;/);
        if (interp === 'catmull') expect(r.fragmentShader).toContain('dsCatmull(');
      }
    }
    const d = data('d', { dataset: 'route', mode: 'keyframes', outputs: [{ key: 'o1', columns: ['x'] }] });
    expect(Object.keys(d.outputs)).toEqual(['o1', 'row', 'progress', 'count']);
    // Unwired Time is the clock
    expect(compileGraph({ nodes: [d, out(['d', 'o1'], 700)] }).fragmentShader).toMatch(/u_time - \w+_t0/);
  });

  it('changing the mode keeps wires that still fit and drops the rest', () => {
    const d = data('d', { dataset: 'x', outputs: [{ key: 'o1', columns: ['a'] }] }, { index: ['t', 'time'] });
    expect(d.inputs.index.connection).toBeTruthy();
    const k = retypeDataNode({ ...d, params: { ...d.params, mode: 'keyframes' } });
    expect(k.inputs.index).toBeUndefined();
    expect(k.inputs.time).toBeDefined();
    const same = { ...d, params: { ...d.params, blend: false } };
    expect(retypeDataNode(same)).toBe(same); // sockets unchanged: the same node back
  });
});

describe('data textures', () => {
  const t = parseCsv('x,y,kind\n1,2,a\n3,4,b\n5,,a').result;

  it('packs up to four columns as RGBA, categories as codes, missing values 0', () => {
    const p = packColumns(t, ['y', 'kind', 'x', 'gone']);
    expect(p.width).toBe(3);
    expect(p.height).toBe(1);
    expect(Array.from(p.data)).toEqual([2, 0, 1, 0, 4, 1, 3, 0, 0, 0, 5, 0]);
  });

  it('wraps rows into lines of 1024 texels', () => {
    expect(texSize(0)).toEqual({ width: 1, height: 1 });
    expect(texSize(1024)).toEqual({ width: 1024, height: 1 });
    expect(texSize(1025)).toEqual({ width: 1024, height: 2 });
  });
});
