/**
 * Pieces and Balls (nodes/definitions/pieces.ts, docs/pieces.md): their GLSL compiles in graphs, and,
 * run on the CPU, each piece reads the picture at its home wherever its offset takes it, and the
 * bounded search finds every piece a brute-force search does.
 */
import { describe, expect, it } from 'vitest';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { PIECES_GLSL, ballsCode, piecesCode } from '../definitions/pieces';
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

const RES: [number, number] = [160, 90];
const ASPECT = RES[0] / RES[1];

/**
 * The Pieces code on the CPU at the point X. The picture is a stand-in that returns the place it is
 * read (st, 0), so a colour says where on the picture a piece took it. `field` is the Offset ƒ body.
 */
function runPieces(params: Record<string, unknown>, X: [number, number], field: string | null, opts: { cap?: number; brute?: boolean; quick?: boolean } = {}) {
  const n = node('pieces', 'pc', params);
  const { code } = piecesCode(n, { uv: 'X', picture: 'u_pic', ...(field ? { offset: 'fieldfn_test' } : {}) }, opts);
  const body = code.replace(/textureLod\(u_pic, /g, 'testPic(');
  const src = [
    'uniform vec2 X;',
    'vec4 testPic(vec2 st, float lod) { return vec4(st, 0.0, 1.0); }',
    ...PIECES_GLSL,
    field ? `vec2 fieldfn_test(vec2 g_uv, vec2 fieldCell, float fieldInfluence, float fieldIndex) { return ${field}; }` : '',
    'void main() {',
    body,
    '  gl_FragColor = vec4(pc_c1, pc_mask);',
    '}',
  ].join('\n');
  if (opts.quick) {
    // One run: the top piece's red, the mask and its id (what the clip checks compare).
    const q = new CpuShader(src.replace('gl_FragColor = vec4(pc_c1, pc_mask);', 'gl_FragColor = vec4(pc_c1.x, pc_mask, pc_id);')).run([0, 0], { resolution: RES, time: 0, uniforms: { X } })!;
    return { colour: [q[0], 0, 0], mask: q[1], home: [0, 0] as [number, number], id: [q[2], q[3]] as [number, number] };
  }
  const out = new CpuShader(src).run([0, 0], { resolution: RES, time: 0, uniforms: { X } })!;
  const outHome = new CpuShader(src.replace('gl_FragColor = vec4(pc_c1, pc_mask);', 'gl_FragColor = vec4(pc_home, pc_id);')).run([0, 0], { resolution: RES, time: 0, uniforms: { X } })!;
  return { colour: out.slice(0, 3), mask: out[3], home: outHome.slice(0, 2) as [number, number], id: outHome.slice(2, 4) as [number, number] };
}

/** Picture coordinates (0–1, stretched over the frame) of a centred picture-unit point. */
const st = (q: [number, number]) => [q[0] / ASPECT * 0.5 + 0.5, q[1] * 0.5 + 0.5];

describe('Pieces: where each piece reads the picture', { timeout: 60_000 }, () => {
  const count = 16;
  const cs = 2 * ASPECT / count;
  const cellCentre = (q: [number, number]): [number, number] => [
    -ASPECT + (Math.floor((q[0] + ASPECT) / cs) + 0.5) * cs,
    -1 + (Math.floor((q[1] + 1) / cs) + 0.5) * cs,
  ];
  /** A point well inside a cell (not on an edge, where two pieces share the pixel). */
  const inCell = (x: number, y: number): [number, number] => { const c = cellCentre([x, y]); return [c[0] + 0.13 * cs, c[1] - 0.21 * cs]; };

  it('at rest, each pixel shows the colour at its own cell\'s centre (a mosaic)', () => {
    for (const X of [inCell(0.13, 0.27), inCell(-1.2, -0.6), inCell(0.9, 0.81)]) {
      const r = runPieces({ count, shape: 'square' }, X, null);
      const h = cellCentre(X);
      expect(r.mask).toBeGreaterThan(0.99);
      expect(r.home[0]).toBeCloseTo(h[0], 5); expect(r.home[1]).toBeCloseTo(h[1], 5);
      expect(r.colour[0]).toBeCloseTo(st(h)[0], 5); expect(r.colour[1]).toBeCloseTo(st(h)[1], 5);
    }
  });

  it('moved by an offset, a piece keeps the colour of its home', () => {
    const off: [number, number] = [0.31, -0.17];
    for (const at of [inCell(0.2, 0.1), inCell(-0.5, 0.4), inCell(1.0, -0.3)]) {
      const X: [number, number] = [at[0] + off[0], at[1] + off[1]];
      const r = runPieces({ count, shape: 'square', amount: 1 }, X, `vec2(${off[0]}, ${off[1]})`);
      // The piece here came from the home under X − offset.
      const h = cellCentre([X[0] - off[0], X[1] - off[1]]);
      expect(r.mask).toBeGreaterThan(0.99);
      expect(r.home[0]).toBeCloseTo(h[0], 5); expect(r.home[1]).toBeCloseTo(h[1], 5);
      expect(r.colour[0]).toBeCloseTo(st(h)[0], 5); expect(r.colour[1]).toBeCloseTo(st(h)[1], 5);
    }
  });

  it('Amount 0 puts every piece home, whatever the offset', () => {
    const X = inCell(0.42, -0.33);
    const r = runPieces({ count, shape: 'square', amount: 0 }, X, 'vec2(0.8, 0.5)');
    expect(r.home[0]).toBeCloseTo(cellCentre(X)[0], 5);
    expect(r.home[1]).toBeCloseTo(cellCentre(X)[1], 5);
  });

  it('a field that differs per piece: the piece found covers the pixel, and reads its own home', () => {
    const field = '0.35 * vec2(sin(g_uv.y * 3.0 + 1.0), cos(g_uv.x * 2.0))';
    const offAt = (h: [number, number]) => [0.35 * Math.sin(h[1] * 3 + 1), 0.35 * Math.cos(h[0] * 2)];
    let found = 0;
    for (const X of [[0.1, 0.1], [-0.7, 0.5], [0.6, -0.6], [1.3, 0.2], [-1.4, -0.2]] as Array<[number, number]>) {
      const r = runPieces({ count, size: 1.3, searchMode: 'near' }, X, field);
      if (r.mask < 0.5) continue;
      found++;
      const o = offAt(r.home);
      const at = [r.home[0] + o[0], r.home[1] + o[1]];
      expect(Math.hypot(X[0] - at[0], X[1] - at[1])).toBeLessThan(0.5 * cs * 1.3 + 2 / RES[1]);
      expect(r.colour[0]).toBeCloseTo(st(r.home)[0], 5); expect(r.colour[1]).toBeCloseTo(st(r.home)[1], 5);
    }
    expect(found).toBeGreaterThan(2);
  }, 60_000);

  it('Piece mode carries the picture round the home: at rest it reads the pixel itself', () => {
    const X: [number, number] = [0.237, -0.418];
    const r = runPieces({ count, colourMode: 'piece', shape: 'square' }, X, null);
    expect(r.colour[0]).toBeCloseTo(st(X)[0], 5); expect(r.colour[1]).toBeCloseTo(st(X)[1], 5);
  });
});

describe('Pieces: the bounded search does not clip', () => {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) pts.push([(((i * 0.61803) % 1) * 2 - 1) * ASPECT * 0.9, (((i * 0.4142) % 1) * 2 - 1) * 0.9]);
  const sameAsBrute = (P: Record<string, unknown>, field: string) => {
    for (const X of pts) {
      const a = runPieces(P, X, field, { quick: true });
      const b = runPieces(P, X, field, { cap: 7, brute: true, quick: true });
      expect(a.mask).toBeCloseTo(b.mask, 4);
      if (b.mask > 0.01) { expect(a.id).toEqual(b.id); expect(a.colour[0]).toBeCloseTo(b.colour[0], 4); }
    }
  };
  // Every piece (the default): a wild field of steady strength, pieces crossing each other many cells away.
  const wild = '0.6 * vec2(cos(fieldIndex * 40.0 + g_uv.x * 9.0 + g_uv.y * 7.0), sin(fieldIndex * 40.0 + g_uv.x * 9.0 + g_uv.y * 7.0))';
  // Near: a smooth field (neighbours move together), big turned shapes.
  const smooth = '0.4 * vec2(sin(g_uv.y * 0.6 + g_uv.x * 0.3), cos(g_uv.x * 0.5 - 0.4))';
  for (const shape of ['circle', 'square', 'hexagon']) {
    it(`every piece: ${shape}, a scatter of steady strength`, () => sameAsBrute({ count: 14, size: 1.2, shape, turn: 30 }, wild), 120_000);
    it(`near: ${shape}, size 1.4, turned, a smooth field`, () => sameAsBrute({ count: 14, size: 1.4, shape, turn: 30, searchMode: 'near' }, smooth), 120_000);
  }
});

describe('Pieces in graphs', () => {
  const base = (params: Record<string, unknown> = {}) => [
    node('uv', 'uv'),
    node('time', 'time'),
    node('textureInput', 'tex', {}, { uv: ['uv', 'uv'] }),
    node('vectorField', 'vf', { mode: 'curl' }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
    node('lfo', 'lfo', { amplitude: 0.5, offset: 0.5, freq: 0.2 }),
    node('pieces', 'pc', params, { uv: ['uv', 'uv'], picture: ['tex', 'texture'], offset: ['vf', 'dir'], amount: ['lfo', 'value'] }),
    node('output', 'out', {}, { color: ['pc', 'color'] }),
  ];
  it('compiles with a noise offset and an LFO on Amount', () => {
    const r = compileGraph({ nodes: base() });
    expect(r.success, String(r.errors)).toBe(true);
    expect(r.fragmentShader).toMatch(/fieldfn_\w+\(/);
  });
  for (const shape of ['circle', 'square', 'hexagon', 'diamond', 'glyph']) {
    for (const extra of [{}, { sizeBy: 'brightness', colourMode: 'piece', stagger: 1 }]) {
      it(`compiles: ${shape} ${JSON.stringify(extra)}`, () => {
        const r = compileGraph({ nodes: base({ shape, ...extra }) });
        expect(r.success, String(r.errors)).toBe(true);
      });
    }
  }
  it('compiles with nothing wired', () => {
    const r = compileGraph({ nodes: [node('pieces', 'pc'), node('output', 'out', {}, { color: ['pc', 'color'] })] });
    expect(r.success, String(r.errors)).toBe(true);
  });
});

describe('Balls', () => {
  it('reads the picture at its copy\'s centre, lifted by the brightness', () => {
    const n = node('pieceBalls', 'b', { layout: 'repeat', count: 9, aspect: 1.5, lift: 2, size: 1 });
    const { code } = ballsCode(n, { pos: 'P', picture: 'u_pic' });
    const src = ['uniform vec3 P;', 'vec3 g_cell3 = vec3(2.0, -1.0, 0.0);', 'vec3 g_cellSize3 = vec3(0.5, 0.5, 50.0);',
      'vec4 testPic(vec2 st, float lod) { return vec4(st, 0.0, 1.0); }', 'void main() {', code.replace(/textureLod\(u_pic, /g, 'testPic('), '  gl_FragColor = vec4(b_st, b_lift, b_dist);', '}'].join('\n');
    const out = new CpuShader(src).run([0, 0], { resolution: [8, 8], time: 0, uniforms: { P: [0, 0, 0] } })!;
    // Home (1, −0.5) on a picture 4.5 wide, 3 tall, mirrored in X.
    expect(out[0]).toBeCloseTo(0.5 - 1 / 4.5, 5);
    expect(out[1]).toBeCloseTo(0.5 - 0.5 / 3, 5);
    const lum = 0.2126 * out[0] + 0.7152 * out[1];
    expect(out[2]).toBeCloseTo(2 * lum, 5);
    expect(out[3]).toBeCloseTo(2 * lum - 0.25, 4);
  });

  /** Own grid: 5 × 5 balls a unit apart (Width 5, Aspect 1), run on the CPU at `pos`. */
  const ownGrid = (pos: [number, number, number]) => {
    const n = node('pieceBalls', 'b', { layout: 'own', count: 5, width: 5, aspect: 1, lift: 2, size: 0.9 });
    const { code } = ballsCode(n, { pos: 'P', picture: 'u_pic' });
    const src = ['uniform vec3 P;', 'vec3 g_cell3 = vec3(0.0);', 'vec3 g_cellSize3 = vec3(0.0);',
      'vec4 testPic(vec2 st, float lod) { return vec4(st, 0.0, 1.0); }', 'void main() {', code.replace(/textureLod\(u_pic, /g, 'testPic('), '  gl_FragColor = vec4(b_st, b_lift, b_dist);', '}'].join('\n');
    return new CpuShader(src).run([0, 0], { resolution: [8, 8], time: 0, uniforms: { P: pos } })!;
  };

  it('on its own grid: finds the cell, reads its home, and is a ball there', () => {
    const at = ownGrid([1.2, -0.9, 0]);
    expect(at[0]).toBeCloseTo(0.3, 5); // home (1, −1) on a picture 5 wide, mirrored in X
    expect(at[1]).toBeCloseTo(0.3, 5);
    const lift = at[2];
    expect(lift).toBeCloseTo(2 * (0.2126 * 0.3 + 0.7152 * 0.3), 5);
    // At the ball's centre: inside by its radius.
    expect(ownGrid([1, -1, lift])[3]).toBeCloseTo(-0.45, 4);
  });

  it('on its own grid: the distance never steps past a wall into a neighbour, but runs free off the edge', () => {
    // Level with the balls, 0.05 from the wall to the next column: capped at the wall.
    expect(ownGrid([1.45, -1, 0])[3]).toBeCloseTo(0.05 + 0.04 + 0.001, 4);
    // Far in front of every ball (beyond the lift, 2, and a radius): the slab, not the wall.
    expect(ownGrid([1.45, -1, 6])[3]).toBeCloseTo(6 - 2 - 0.45, 4);
    // Past the last column there is no neighbour: the plain distance to the edge ball.
    const far = ownGrid([9, 0, 0]);
    expect(far[3]).toBeGreaterThan(6);
  });
});
