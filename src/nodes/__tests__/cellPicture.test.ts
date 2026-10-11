/**
 * Cell Picture and Cell Pattern (nodes/definitions/cellPicture.ts): the Grid builder's picture
 * modes and draw modes as plain nodes. Their GLSL run on the CPU, and a graph with them compiles.
 */
import { describe, expect, it } from 'vitest';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { CellPatternNode, CellPictureNode } from '../definitions/cellPicture';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition } from '../definitions';
import type { GraphNode } from '../../types/nodeGraph';

function node(type: string, id: string, params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}): GraphNode {
  const def = getNodeDefinition(type)!;
  return {
    id, type, position: { x: 0, y: 0 },
    inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, v]) => [k, { type: v.type, label: v.label, ...(wires[k] ? { connection: { nodeId: wires[k][0], outputKey: wires[k][1] } } : {}) }])),
    outputs: Object.fromEntries(Object.entries(def.outputs).map(([k, v]) => [k, { type: v.type, label: v.label }])),
    params: { ...(def.defaultParams ?? {}), ...params },
  };
}

/** Cell Pattern's Source ID and Is Source for a cell, its GLSL run on the CPU. */
function source(params: Record<string, unknown>, cell: [number, number]): [number, number, number] {
  const n = node('cellPattern', 'cp', params);
  const { code } = CellPatternNode.generateGLSL(n, { cellID: 'cid' });
  const out = new CpuShader(`uniform vec2 cid;\nvoid main() {\n${code}  gl_FragColor = vec4(cp_s, cp_is, 0.0);\n}`).run([0, 0], { resolution: [8, 8], time: 0, uniforms: { cid: cell } })!;
  return [out[0], out[1], out[2]];
}

describe('Cell Pattern', () => {
  it('repeat: every period from the offset, rows of tiles shifted', () => {
    const P = { mode: 'repeat', periodX: 3, periodY: 2, offsetX: 1, offsetY: 0, shift: 1 };
    expect(source(P, [1, 0])).toEqual([1, 0, 1]);
    expect(source(P, [4, 0])).toEqual([1, 0, 0]);
    expect(source(P, [2, 2])).toEqual([1, 0, 0]);
    expect(source(P, [-2, 0])).toEqual([1, 0, 0]);
    expect(source(P, [3, 1])).toEqual([3, 1, 1]);
  });

  it('mirror across the centre, and rotate four quarters round it', () => {
    expect(source({ mode: 'mirrorX' }, [2, 3]).slice(0, 2)).toEqual([-3, 3]);
    expect(source({ mode: 'mirrorX' }, [-3, 3])).toEqual([-3, 3, 1]);
    expect(source({ mode: 'mirrorY' }, [2, 3]).slice(0, 2)).toEqual([2, -4]);
    expect(source({ mode: 'mirrorXY' }, [2, 3]).slice(0, 2)).toEqual([-3, -4]);
    // The quarter below-left of (0, 0): cell (−2, −1); its three turns land on it.
    for (const c of [[-2, -1], [-1, 1], [1, 0], [0, -2]] as Array<[number, number]>) expect(source({ mode: 'rotate4' }, c).slice(0, 2)).toEqual([-2, -1]);
  });

  it('compiles in a graph after a Grid', () => {
    const nodes = [
      node('uv', 'uv'),
      node('gridLayout', 'grid', {}, { uv: ['uv', 'uv'] }),
      node('cellPattern', 'pat', { mode: 'mirrorXY' }, { cellID: ['grid', 'cellID'] }),
      node('cellFilter', 'pick', { x: 0, y: 0 }, { cellID: ['pat', 'sourceID'] }),
      node('output', 'out', {}, { color: ['pick', 'mask'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.success, String(r.errors)).toBe(true);
  });
});

describe('Cell Picture', () => {
  const read = (mode: string) => {
    const { code } = CellPictureNode.generateGLSL(node('cellPicture', 'pc', { mode }), { uv: 'uv', cellCenter: 'cc', cellUV: 'cu', cellSize: 'cs' });
    return new CpuShader(`uniform vec2 uv;\nuniform vec2 cc;\nuniform vec2 cu;\nuniform float cs;\nvoid main() {\n${code}  gl_FragColor = vec4(pc_uv, 0.0, 0.0);\n}`)
      .run([0, 0], { resolution: [8, 8], time: 0, uniforms: { uv: [0.31, 0.12], cc: [0.3, 0.1], cu: [0.25, -0.1], cs: 0.2 } })!.slice(0, 2);
  };
  it('mask reads the pixel, matte the centre, piece the centre plus Cell UV × Cell Size', () => {
    expect(read('mask')).toEqual([0.31, 0.12]);
    expect(read('matte')).toEqual([0.3, 0.1]);
    const piece = read('piece');
    expect(piece[0]).toBeCloseTo(0.35, 6); expect(piece[1]).toBeCloseTo(0.08, 6);
  });

  it('a Grid Pattern carrying a picture in pieces compiles', () => {
    const nodes = [
      node('uv', 'uv'),
      node('gridPattern', 'gp', {}, { uv: ['uv', 'uv'] }),
      node('cellPicture', 'pc', { mode: 'piece' }, { uv: ['uv', 'uv'], cellCenter: ['gp', 'cellCenter'], cellUV: ['gp', 'cellUV'], cellSize: ['gp', 'cellSize'] }),
      node('textureInput', 'tex', {}, { uv: ['pc', 'uv'] }),
      node('gridPaint', 'paint', {}, { color: ['tex', 'color'], distance: ['gp', 'distance'], placed: ['gp', 'placed'] }),
      node('output', 'out', {}, { color: ['paint', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.success, String(r.errors)).toBe(true);
  });
});
