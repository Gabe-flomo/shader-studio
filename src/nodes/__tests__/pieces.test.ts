/**
 * Pieces and Balls (nodes/definitions/pieces.ts, docs/pieces.md): their GLSL compiles in graphs, and,
 * run on the CPU, each piece reads the picture at its home wherever its offset takes it, and the
 * bounded search finds every piece a brute-force search does.
 */
import { describe, expect, it } from 'vitest';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { PIECES_GLSL, PIECES_RAND_GLSL, ballsCode, piecesCode, scatterReach } from '../definitions/pieces';
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
/** The settings a Pieces node had before Scatter and the Ball shape (a saved node reads missing keys so). */
const OLD: Record<string, unknown> = { shape: 'circle', count: 40, size: 1, scatter: 0, scatterSize: 0, scatterTurn: 0, dimFloor: 0 };

function runPieces(params: Record<string, unknown>, X: [number, number], field: string | null, opts: { cap?: number; brute?: boolean; quick?: boolean; iv?: Record<string, string>; uniforms?: Record<string, number> } = {}) {
  const n = node('pieces', 'pc', { ...OLD, ...params });
  const { code } = piecesCode(n, { uv: 'X', picture: 'u_pic', ...(field ? { offset: 'fieldfn_test' } : {}), ...(opts.iv ?? {}) }, opts);
  const body = code.replace(/textureLod\(u_pic, /g, 'testPic(');
  const src = [
    'uniform vec2 X;',
    ...Object.keys(opts.uniforms ?? {}).map(k => `uniform float ${k};`),
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
    const q = new CpuShader(src.replace('gl_FragColor = vec4(pc_c1, pc_mask);', 'gl_FragColor = vec4(pc_c1.x, pc_mask, pc_id);')).run([0, 0], { resolution: RES, time: 0, uniforms: { X, ...(opts.uniforms ?? {}) } })!;
    return { colour: [q[0], 0, 0], mask: q[1], home: [0, 0] as [number, number], id: [q[2], q[3]] as [number, number] };
  }
  const out = new CpuShader(src).run([0, 0], { resolution: RES, time: 0, uniforms: { X, ...(opts.uniforms ?? {}) } })!;
  const outHome = new CpuShader(src.replace('gl_FragColor = vec4(pc_c1, pc_mask);', 'gl_FragColor = vec4(pc_home, pc_id);')).run([0, 0], { resolution: RES, time: 0, uniforms: { X, ...(opts.uniforms ?? {}) } })!;
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

describe('Pieces: Scatter', () => {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) pts.push([(((i * 0.61803 + 0.1) % 1) * 2 - 1) * ASPECT * 0.85, (((i * 0.4142 + 0.3) % 1) * 2 - 1) * 0.85]);

  it('Scatter, its turn and size at 0 leave the code exactly as it was (saved nodes are unchanged)', () => {
    const before = node('pieces', 'pc', { shape: 'hexagon', count: 30, size: 1.1 });
    for (const k of ['scatter', 'seed', 'scatterTurn', 'scatterSize', 'dimFloor', 'lightAngle', 'shading', 'focus', 'blur', 'ballLook', 'instability']) delete before.params[k];
    const zero = node('pieces', 'pc', { shape: 'hexagon', count: 30, size: 1.1, scatter: 0, scatterTurn: 0, scatterSize: 0, dimFloor: 0, seed: 7 });
    const iv = { uv: 'X', picture: 'u_pic', offset: 'fieldfn_x' };
    expect(piecesCode(zero, iv).code).toBe(piecesCode(before, iv).code);
    expect(piecesCode(before, iv).code).not.toMatch(/pieces_rand4/);
  });

  it('a wired Scatter of 0 draws what no Scatter draws', () => {
    for (const X of pts.slice(0, 4)) {
      const a = runPieces({ count: 14, shape: 'square' }, X, null, { quick: true });
      const b = runPieces({ count: 14, shape: 'square' }, X, null, { quick: true, iv: { scatter: 'u_s', scatterSize: 'u_z' }, uniforms: { u_s: 0, u_z: 0 } });
      expect(b.mask).toBeCloseTo(a.mask, 6); expect(b.id).toEqual(a.id); expect(b.colour[0]).toBeCloseTo(a.colour[0], 6);
    }
  }, 60_000);

  it('the same seed gives the same layout; another seed another', () => {
    const P = { count: 14, scatter: 0.3, scatterSize: 0.3, scatterTurn: 40, shape: 'square', amount: 0 };
    let differs = 0;
    for (const X of pts) {
      const a = runPieces({ ...P, seed: 3 }, X, null, { quick: true });
      const b = runPieces({ ...P, seed: 3 }, X, null, { quick: true });
      const c = runPieces({ ...P, seed: 4 }, X, null, { quick: true });
      expect(b).toEqual(a);
      if (c.mask !== a.mask || c.id[0] !== a.id[0] || c.id[1] !== a.id[1]) differs++;
    }
    expect(differs).toBeGreaterThan(2);
  }, 60_000);

  it('works with Amount 0: pieces leave their cells', () => {
    let moved = 0;
    const cs = 2 * ASPECT / 14;
    for (const X of pts) {
      const r = runPieces({ count: 14, scatter: 0.4, amount: 0, shape: 'square' }, X, 'vec2(0.5, 0.0)', { quick: true });
      if (r.mask < 0.5) continue;
      const home = [-ASPECT + (r.id[0] + 0.5) * cs, -1 + (r.id[1] + 0.5) * cs];
      if (Math.max(Math.abs(home[0] - X[0]), Math.abs(home[1] - X[1])) > 0.5 * cs) moved++;
    }
    expect(moved).toBeGreaterThan(1);
  }, 60_000);

  // The search bounds take in Scatter's reach (and Scatter size), so nothing is cut: the same as a search of every cell.
  const sameAsBrute = (P: Record<string, unknown>, field: string | null) => {
    for (const X of pts) {
      const a = runPieces(P, X, field, { quick: true });
      const b = runPieces(P, X, field, { cap: 7, brute: true, quick: true });
      expect(a.mask).toBeCloseTo(b.mask, 4);
      if (b.mask > 0.01) { expect(a.id).toEqual(b.id); expect(a.colour[0]).toBeCloseTo(b.colour[0], 4); }
    }
  };
  it('every piece: Scatter 3 cells, Scatter size, Scatter turn, with Amount 0', () => sameAsBrute({ count: 14, scatter: 0.45, scatterSize: 0.5, scatterTurn: 90, shape: 'square', amount: 0 }, 'vec2(0.0)'), 120_000);
  it('every piece: Scatter on top of a moving offset', () => sameAsBrute({ count: 14, scatter: 0.3, size: 1.2, shape: 'hexagon' }, '0.3 * vec2(sin(g_uv.y * 2.0), cos(g_uv.x * 1.5))'), 120_000);
  it('near: Scatter on a smooth field', () => sameAsBrute({ count: 14, scatter: 0.2, searchMode: 'near', shape: 'circle' }, '0.3 * vec2(sin(g_uv.y * 0.6), cos(g_uv.x * 0.5))'), 120_000);
  it('no offset at all: Scatter alone, Ball shape', () => sameAsBrute({ count: 14, scatter: 0.35, shape: 'ball' }, null), 120_000);
  it('Instability (at a time): the pieces wobble, still found', () => sameAsBrute({ count: 14, instability: 0.15, shape: 'square', scatterTurn: 20 }, null), 120_000);
  it('depth of field: Blur 2 on the brightness, with Scatter', () => sameAsBrute({ count: 14, scatter: 0.2, shape: 'ball', sizeBy: 'brightness', focus: 0.2, blur: 2 }, null), 120_000);

  it('depth of field: a piece far from Focus spreads into a soft disc and thins out; at Focus it stays sharp', () => {
    const cs = 2 * ASPECT / 10;
    const c: [number, number] = [-ASPECT + 4.5 * cs, -1 + 4.5 * cs];
    const at = (dx: number, P: Record<string, unknown>) => runPieces({ count: 10, shape: 'circle', size: 0.6, ...P }, [c[0] + dx * cs, c[1] + 0.001], null, { quick: true }).mask;
    // The picture's brightness at this piece's home (the stand-in reads (st, 0)).
    const s0 = st(c), lum = 0.2126 * s0[0] + 0.7152 * s0[1];
    expect(at(0, { focus: lum, blur: 3 })).toBeCloseTo(1, 3);
    expect(at(0.42, { focus: lum, blur: 3 })).toBeLessThan(0.01);
    const blurred = { focus: Math.min(lum + 0.8, 1), blur: 3 };
    expect(at(0, blurred)).toBeLessThan(0.6);
    expect(at(0.42, blurred)).toBeGreaterThan(0.02);
  });

  it('Ball, Glowing (the default): brightest at the centre, falling off to the rim, its colour kept', () => {
    const cs = 2 * ASPECT / 10;
    const c: [number, number] = [-ASPECT + 4.5 * cs, -1 + 4.5 * cs];
    const at = (dx: number, dy: number) => runPieces({ count: 10, shape: 'ball', ballLook: 'glow' }, [c[0] + dx * cs, c[1] + dy * cs], null).colour;
    const core = at(0.01, 0.01), mid = at(0.25, 0), rim = at(0.46, 0);
    expect(core[0] + core[1]).toBeGreaterThan(mid[0] + mid[1]);
    expect(mid[0] + mid[1]).toBeGreaterThan(rim[0] + rim[1]);
    // Glowing from within: the core is the colour pushed up, not washed to white (the hue holds).
    expect(core[0] / core[1]).toBeCloseTo(0.5 / 0.5 * (st(c)[0] / st(c)[1]), 1);
  });

  it('Ball, Lit: shaded as a sphere, lit from the Light angle', () => {
    const cs = 2 * ASPECT / 10;
    const c: [number, number] = [-ASPECT + 4.5 * cs, -1 + 4.5 * cs];
    const at = (dx: number, dy: number) => runPieces({ count: 10, shape: 'ball', ballLook: 'lit', lightAngle: 135, shading: 1 }, [c[0] + dx * cs, c[1] + dy * cs], null).colour;
    const lit = at(-0.2, 0.2), dark = at(0.25, -0.25), edge = at(0.47, 0);
    const lum = (q: number[]) => q[0] + q[1];
    expect(lum(lit)).toBeGreaterThan(lum(dark) * 1.3);
    expect(lum(edge)).toBeLessThan(lum(lit));
  });

  it('the card warns when the reach is past the search\'s cap', () => {
    expect(scatterReach(node('pieces', 'pc', { count: 40, scatter: 0.02 }))!.reach).toBeLessThan(scatterReach(node('pieces', 'pc', { count: 40 }))!.cap);
    const far = scatterReach(node('pieces', 'pc', { count: 120, scatter: 0.5 }))!;
    expect(far.reach).toBeGreaterThan(far.cap);
    const balls = scatterReach(node('pieceBalls', 'b', { count: 40, width: 4, scatter: 0.6 }))!;
    expect(balls.reach).toBeGreaterThan(balls.cap);
    expect(scatterReach(node('pieceBalls', 'b', { count: 40, width: 4, scatter: 0.1 }))!.reach).toBeLessThan(3);
  });
});

describe('Balls: Scatter, Depth, Twist, Instability', { timeout: 120_000 }, () => {
  /** Own grid: 7 × 7 balls a unit apart (Width 7, Aspect 1), at `pos` and time `t`. */
  const run = (params: Record<string, unknown>, pos: [number, number, number], o: { t?: number; cap?: number; brute?: boolean; iv?: Record<string, string>; uniforms?: Record<string, number> } = {}) => {
    const n = node('pieceBalls', 'b', { layout: 'own', count: 7, width: 7, aspect: 1, lift: 1, size: 0.9, ...params });
    const { code } = ballsCode(n, { pos: 'P', picture: 'u_pic', ...(o.iv ?? {}) }, { cap: o.cap, brute: o.brute });
    const src = ['uniform vec3 P;', ...Object.keys(o.uniforms ?? {}).map(k => `uniform float ${k};`), 'vec3 g_cell3 = vec3(0.0);', 'vec3 g_cellSize3 = vec3(0.0);', PIECES_RAND_GLSL,
      'vec4 testPic(vec2 st, float lod) { return vec4(st, 0.0, 1.0); }', 'void main() {', code.replace(/textureLod\(u_pic, /g, 'testPic('), `  gl_FragColor = vec4(b_col.xy, b_cell.x * 10.0 + b_cell.y, ${o.brute ? 'b_bmin' : 'b_dist'});`, '}'].join('\n');
    return new CpuShader(src).run([0, 0], { resolution: [8, 8], time: o.t ?? 0, uniforms: { P: pos, ...(o.uniforms ?? {}) } })!;
  };
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < 10; i++) pts.push([((i * 0.61803 + 0.05) % 1) * 6 - 3, ((i * 0.4142 + 0.2) % 1) * 6 - 3, ((i * 0.7071) % 1) * 1.6 - 0.3]);

  it('Scatter, Depth and the rest at 0 leave the code exactly as it was', () => {
    const before = node('pieceBalls', 'b', { layout: 'own' });
    for (const k of ['scatter', 'scatterDepth', 'scatterSize', 'seed', 'twist', 'instability', 'focus', 'blur']) delete before.params[k];
    const zero = node('pieceBalls', 'b', { layout: 'own', scatter: 0, scatterDepth: 0, scatterSize: 0, twist: 0, instability: 0, seed: 9 });
    expect(ballsCode(zero, { pos: 'P' }).code).toBe(ballsCode(before, { pos: 'P' }).code);
    const rep = { ...zero, params: { ...zero.params, layout: 'repeat' } };
    expect(ballsCode(rep, { pos: 'P' }).code).toBe(ballsCode({ ...before, params: { ...before.params, layout: 'repeat' } }, { pos: 'P' }).code);
  });

  it('a wired Scatter of 0 draws what no Scatter draws (the same ball, colour and surface; rays may step further)', () => {
    for (let i = 0; i < 6; i++) {
      // Points in and just outside the balls (lifted by the stand-in picture's brightness).
      const x = i - 2.5 + 0.2, y = (i % 3) - 1 + 0.1;
      const lift = 0.2126 * (0.5 - Math.round(x) / 7) + 0.7152 * (0.5 + Math.round(y) / 7);
      for (const dz of [0, 0.43, 0.6]) {
        const at: [number, number, number] = [x, y, lift + dz];
        const a = run({}, at);
        const b = run({}, at, { iv: { scatter: 'u_s', instability: 'u_i' }, uniforms: { u_s: 0, u_i: 0 } });
        if (a[3] < 0.05) { for (let k = 0; k < 4; k++) expect(b[k]).toBeCloseTo(a[k], 6); }
        else expect(b[3]).toBeGreaterThanOrEqual(Math.min(a[3], 0.05));
      }
    }
  });

  it('sideways Scatter and Depth: the bounded neighbour search finds the nearest ball a search of every cell finds', () => {
    let hits = 0;
    // Also points among the balls: level with them, between cells.
    const near: Array<[number, number, number]> = [];
    for (let i = 0; i < 16; i++) near.push([((i * 0.377) % 1) * 5 - 2.5, ((i * 0.719) % 1) * 5 - 2.5, 0.25 + ((i * 0.53) % 1) * 0.4]);
    for (const P of [
      { scatter: 0.8, scatterDepth: 0.6, seed: 2 },
      { scatter: 1.6, scatterSize: 0.4, shape: 'box' },
      { instability: 0.4, scatter: 0.3 },
      { blur: 1.5, focus: 0.2 },
    ]) {
      for (const at of [...pts, ...near]) {
        const a = run(P, at, { t: 1.3 });
        const b = run(P, at, { t: 1.3, cap: 6, brute: true }); // b[3]: the nearest ball of every cell
        // Never a step past any ball (no clipping); at a surface, the same ball, distance and colour.
        expect(a[3]).toBeLessThanOrEqual(b[3] + 1e-5);
        if (b[3] < 0.05) { hits++; expect(a[3]).toBeCloseTo(b[3], 5); expect(a[2]).toBe(b[2]); expect(a[0]).toBeCloseTo(b[0], 5); }
      }
    }
    expect(hits).toBeGreaterThan(8);
  });

  it('sideways Scatter moves balls in X and Y; Depth alone only in Z', () => {
    // Somewhere a ball is no longer over its own cell (the ball there is another cell's).
    let sideways = 0;
    for (let i = 0; i < 30; i++) {
      const at: [number, number, number] = [(i % 6) - 2.5 + 0.13, Math.floor(i / 6) - 2.5 + 0.21, 0.3];
      const s = run({ scatter: 0.9, lift: 0 }, at);
      const ownCell = Math.floor(at[0] + 0.5) * 10 + Math.floor(at[1] + 0.5);
      if (s[3] < 0 && Math.round(s[2]) !== ownCell) sideways++;
    }
    expect(sideways).toBeGreaterThan(0);
    // Depth alone stays on the cheap path (no search), its slab grown by Depth.
    const code = ballsCode(node('pieceBalls', 'b', { layout: 'own', scatterDepth: 1 }), { pos: 'P' }).code;
    expect(code).not.toMatch(/for \(int/);
    expect(code).toMatch(/abs\(b_scd\)/);
  });

  it('Twist turns each ball round the middle by Twist × its distance', () => {
    const plain = run({ lift: 0 }, [2, 0, 0]);
    expect(plain[3]).toBeCloseTo(-0.45, 4);
    const a = 40 * Math.PI / 180; // 20° a unit, 2 units out
    const turned = run({ lift: 0, twist: 20 }, [2 * Math.cos(a), 2 * Math.sin(a), 0]);
    expect(turned[3]).toBeLessThan(-0.3);
    expect(turned[2]).toBe(plain[2]);
  });

  it('the same seed scatters the same; Instability moves with time', () => {
    const at: [number, number, number] = [0.4, -0.3, 0.6];
    expect(run({ scatter: 0.5, seed: 5 }, at)).toEqual(run({ scatter: 0.5, seed: 5 }, at));
    const inBall: [number, number, number] = [0.1, 0.05, 0.464];
    expect(Math.abs(run({ instability: 0.3 }, inBall, { t: 0 })[3] - run({ instability: 0.3 }, inBall, { t: 0.4 })[3])).toBeGreaterThan(1e-3);
  });

  it('compiles in graphs with sideways and depth scatter, twist and instability (own grid and Repeat Scene)', () => {
    for (const layout of ['own', 'repeat']) {
      const r = compileGraph({ nodes: [
        node('uv', 'uv'),
        node('pieceBalls', 'ball', { layout, scatter: 0.05, scatterDepth: 0.4, scatterSize: 0.2, twist: 15, instability: 0.02 }),
        node('output', 'out', {}, { color: ['ball', 'color'] }),
      ] });
      expect(r.success, String(r.errors)).toBe(true);
      expect(r.fragmentShader).toContain('vec4 pieces_rand4(');
    }
  });
});
