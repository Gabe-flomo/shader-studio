/**
 * Grid Rules (docs/grid-rules.md): the rule set → GLSL for each rule type, run on the CPU
 * (glslRun.ts) against plain references: Count (Life's glider and blinker, every preset), Stages
 * (Brian's Brain's cycle, every preset), walls, Smooth (conservation, the custom update), the
 * start, Reset, the brush and Speed; plus the compile (one board Pass reading its own Previous,
 * one set of uniforms for the node in every program) and the Mouse node's UV in a smaller Pass.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { n } from '../../store/graphBuilder';
import {
  COUNT_PRESETS, GRID_DEFAULTS, SMOOTH_PRESETS, STAGES_PRESETS, customUpdateProblem, floatLiterals, gridShape, gridSignature,
  maskOf, neighbourOffsets, parseRuleString, ruleString, ruleSummary, matchingPreset, type GridShape,
} from '../../gridRules/spec';
import { compileGraph } from '../graphCompiler';
import { gridCellsId } from '../gridRulesExpand';
import { boardFrom, compileNodes, generationsRef, gridOf, inMask, lifeLikeRef, randomGrid, rounded, stepperFor, type Grid } from './gridHarness';
import { makeBoard, texel } from './glslRun';
import type { GraphNode } from '../../types/nodeGraph';

const G = 'node_3';
const graph = (params: Record<string, unknown>, extra: GraphNode[] = []): GraphNode[] => [
  n('gridRules', G, 0, 0, { label: 'Test', rate: 1, ...params }),
  ...extra,
  n('output', 'node_9', 0, 0, {}, { color: [G, 'color'] }),
];
const shapeOf = (params: Record<string, unknown>): GridShape => gridShape({ ...GRID_DEFAULTS, ...params });
const sigOf = (params: Record<string, unknown>) => gridSignature(shapeOf(params));
const stepper = (params: Record<string, unknown>, w: number, h: number) => stepperFor(compileNodes(graph(params)), gridCellsId(G), w, h);

/** Run both the compiled board and a reference for `steps` steps from `start`, expecting the same states every step. */
function agree(params: Record<string, unknown>, start: Grid, ref: (g: Grid) => Grid, steps: number) {
  const w = start[0].length, h = start.length;
  const st = stepper(params, w, h);
  const wrap = shapeOf(params).wrap;
  let board = boardFrom(start, sigOf(params), wrap ? 'repeat' : 'clamp');
  let want = start;
  for (let k = 0; k < steps; k++) {
    board = st.step(board);
    want = ref(want);
    expect(rounded(gridOf(board)), `step ${k + 1}`).toEqual(want);
  }
  return board;
}

const GLIDER: Grid = [
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 0, 0],
  [1, 1, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const shift = (g: Grid, dx: number, dr: number): Grid => g.map((row, r) => row.map((_, x) => g[(r - dr + g.length) % g.length][(x - dx + row.length) % row.length]));

describe('the rule spec', () => {
  it('reads and writes B/S strings and masks', () => {
    expect(ruleString(maskOf([3]), maskOf([2, 3]))).toBe('B3/S23');
    expect(parseRuleString('b36/s23')).toEqual({ born: maskOf([3, 6]), survive: maskOf([2, 3]) });
    expect(parseRuleString('23/3')).toEqual({ born: maskOf([3]), survive: maskOf([2, 3]) });
    expect(parseRuleString('nonsense')).toBeNull();
    expect(ruleSummary(GRID_DEFAULTS)).toBe('Count B3/S23');
    expect(ruleSummary({ ruleType: 'stages', ...STAGES_PRESETS.briansBrain.params })).toBe('Stages B2/S/C3');
    expect(matchingPreset({ ...GRID_DEFAULTS })).toBe('life');
  });

  it('neighbourhoods: 8, 4, and a radius box or circle', () => {
    expect(neighbourOffsets('moore')).toHaveLength(8);
    expect(neighbourOffsets('vonNeumann')).toHaveLength(4);
    expect(neighbourOffsets('radius', 2, 'box')).toHaveLength(24);
    expect(neighbourOffsets('radius', 5, 'box')).toHaveLength(120);
    expect(neighbourOffsets('radius', 2, 'circle').length).toBeLessThan(24);
  });

  it('a signature per rule type, template and start, never 0 or 1', () => {
    const sigs = new Set<number>();
    for (const ruleType of ['count', 'stages', 'patterns', 'blocks']) for (const start of ['noise', 'empty', 'image', 'centre']) sigs.add(sigOf({ ruleType, start }));
    for (const template of ['diffusion', 'waves', 'reaction', 'custom']) for (const start of ['noise', 'empty', 'image', 'centre']) sigs.add(sigOf({ ruleType: 'smooth', template, start }));
    expect(sigs.size).toBe(32);
    expect(Math.min(...sigs)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...sigs)).toBeLessThan(2048); // a whole number in half float
  });

  it('checks a custom Smooth update, and makes its numbers floats', () => {
    expect(customUpdateProblem('u + 0.2 * lap_u')).toBeNull();
    expect(customUpdateProblem('u = 1.0')).toMatch(/assignment/);
    expect(customUpdateProblem('foo(u)')).toMatch(/function/);
    expect(customUpdateProblem('u + q')).toMatch(/q isn't available/);
    expect(customUpdateProblem('(u')).toMatch(/parentheses/);
    expect(floatLiterals('u * 2 + exp2(v) - 0.5 + 1e3')).toBe('u * 2.0 + exp2(v) - 0.5 + 1e3');
  });
});

describe('rule spec → GLSL', () => {
  const programs = (params: Record<string, unknown>) => {
    const r = compileNodes(graph(params));
    expect(r.errors).toBeUndefined();
    return { board: r.passes!.find(p => p.nodeId === gridCellsId(G))!.fragmentShader, final: r.fragmentShader, r };
  };

  it('Count: the masks as live uniforms, eight reads (four for von Neumann), a loop for a radius', () => {
    const moore = programs({}).board;
    expect(moore).toMatch(/exp2\(\w+_cnt\)/);
    expect(moore).toMatch(/u_p_\w+_bornMask/);
    expect((moore.match(/texture2D\(u_passprev_/g) ?? []).length).toBe(9);
    expect((programs({ neighbourhood: 'vonNeumann' }).board.match(/texture2D\(u_passprev_/g) ?? []).length).toBe(5);
    const r = programs({ neighbourhood: 'radius', radius: 3, shape: 'circle' }).board;
    expect(r).toMatch(/for \(int \w+_dy = -3; \w+_dy <= 3; \w+_dy\+\+\)/);
    expect(r).toMatch(/u_p_\w+_bornLo/);
    expect(r).toMatch(/step\(dot\(/);
  });

  it('Stages: the states as a live uniform', () => {
    expect(programs({ ruleType: 'stages' }).board).toMatch(/max\(floor\(u_p_\w+_states \+ 0\.5\), 2\.0\)/);
  });

  it('Smooth: each template\'s update', () => {
    expect(programs({ ruleType: 'smooth', template: 'diffusion' }).board).toMatch(/_spread\)/);
    expect(programs({ ruleType: 'smooth', template: 'waves' }).board).toMatch(/2\.0 \* \w+_u - \w+_v/);
    expect(programs({ ruleType: 'smooth', template: 'reaction' }).board).toMatch(/_abb = /);
    expect(programs({ ruleType: 'smooth', template: 'custom', customU: 'u + 2 * lap_u' }).board).toMatch(/clamp\(u \+ 2\.0 \* lap_u, -1000\.0, 1000\.0\)/);
  });

  it('compiles every rule type, neighbourhood, start, edge and template, and every program runs', () => {
    const cases: Array<Record<string, unknown>> = [];
    for (const ruleType of ['count', 'stages']) for (const neighbourhood of ['moore', 'vonNeumann', 'radius']) for (const start of ['noise', 'empty', 'centre', 'image']) for (const edges of ['wrap', 'walls']) cases.push({ ruleType, neighbourhood, start, edges, radius: 2 });
    for (const template of ['diffusion', 'waves', 'reaction', 'custom']) for (const start of ['noise', 'empty', 'centre', 'image']) cases.push({ ruleType: 'smooth', template, start, steps: 2 });
    for (const params of cases) {
      const r = compileNodes(graph(params));
      expect(r.errors, JSON.stringify(params)).toBeUndefined();
      const st = stepperFor(r, gridCellsId(G), 6, 5);
      const b = st.step(makeBoard(6, 5)); // an empty Pass: seeded
      expect(texel(b, 2, 2)[3], JSON.stringify(params)).toBe(sigOf(params));
    }
  });

  it('one board Pass reading its own Previous, nearest, at the board size; Steps is its Repeat', () => {
    const r = compileNodes(graph({ board: '0.0625', edges: 'walls', steps: 4 }));
    const p = r.passes!.find(x => x.nodeId === gridCellsId(G))!;
    expect(p).toMatchObject({ scale: 0.0625, filter: 'nearest', wrap: 'clamp', previous: true, live: true, repeat: 4 });
    expect(p.readsPrevious).toEqual([p.slug]);
    expect(r.passes).toHaveLength(1); // no picture pass until Texture is wired
  });

  it('the node\'s params are one set of uniforms in every program, bound to its id', () => {
    const r = compileNodes(graph({}, [n('glowTexture', 'node_4', 0, 0, {}, { texture: [G, 'texture'] })]));
    expect(r.errors).toBeUndefined();
    for (const k of ['rate', 'reset', 'bornMask', 'brushRadius', 'color1']) expect(r.paramBindings[`${G}::${k}`], k).toMatch(/^u_p_\w+$/);
    const u = r.paramBindings[`${G}::bornMask`];
    const board = r.passes!.find(p => p.nodeId === gridCellsId(G))!;
    expect(board.fragmentShader).toContain(u);
    // The Texture output: a second small pass with the coloured board, read by the Glow.
    const pic = r.passes!.find(p => p.nodeId === `${G}__pic`)!;
    expect(pic.reads).toEqual([board.slug]);
    expect(pic.fragmentShader).toContain(r.paramBindings[`${G}::color1`]);
    expect(Object.keys(r.paramBindings).some(k => k.includes('__step') || k.includes('__picview'))).toBe(false);
  });

  it('counts its board (and picture) towards the 8 Pass nodes', () => {
    const nodes: GraphNode[] = [];
    for (let k = 0; k < 5; k++) nodes.push(n('gridRules', `node_${10 + k}`, 0, 0, { label: `G${k}` }), n('glowTexture', `node_${20 + k}`, 0, 0, {}, { texture: [`node_${10 + k}`, 'texture'] }));
    nodes.push(n('output', 'node_9', 0, 0, {}, { color: ['node_10', 'color'] }));
    const r = compileNodes(nodes);
    expect(r.success).toBe(false);
    expect(r.errors?.[0]).toMatch(/up to 8 Pass nodes .*Grid Rules/);
  });
});

describe('Count against a CPU reference', () => {
  const B3S23 = { born: inMask(maskOf([3])), surv: inMask(maskOf([2, 3])) };
  it('a glider glides one cell diagonally every 4 steps (torus)', () => {
    const board = agree({}, GLIDER, g => lifeLikeRef(g, B3S23.born, B3S23.surv, neighbourOffsets('moore')), 8);
    expect(rounded(gridOf(board))).toEqual(shift(GLIDER, 2, 2));
  });

  it('a blinker blinks', () => {
    const blinker: Grid = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, x) => (r === 2 && x >= 1 && x <= 3 ? 1 : 0)));
    const st = stepper({}, 5, 5);
    const b1 = st.step(boardFrom(blinker, sigOf({})));
    expect(rounded(gridOf(b1)).map(r => r.join(''))).toEqual(['00000', '00100', '00100', '00100', '00000']);
    expect(rounded(gridOf(st.step(b1)))).toEqual(blinker);
  });

  it('every Count preset, from a random board', () => {
    for (const [key, pr] of Object.entries(COUNT_PRESETS)) {
      const P = { ...GRID_DEFAULTS, ...pr.params } as Record<string, number | string>;
      const s = shapeOf(P);
      const offsets = neighbourOffsets(s.neighbourhood, s.radius, s.shape);
      const radius = s.neighbourhood === 'radius';
      const born = radius ? (c: number) => c >= Number(P.bornLo) && c <= Number(P.bornHi) : inMask(Number(P.bornMask));
      const surv = radius ? (c: number) => c >= Number(P.surviveLo) && c <= Number(P.surviveHi) : inMask(Number(P.surviveMask));
      const size = radius ? 13 : 9;
      agree(pr.params, randomGrid(size, size - 1, 7 + key.length, radius ? 0.5 : 0.35), g => lifeLikeRef(g, born, surv, offsets), radius ? 2 : 4);
    }
  }, 60000);

  it('walls: the edge ring stays empty and nothing wraps', () => {
    const P = { edges: 'walls' };
    agree(P, randomGrid(9, 7, 3, 0.45), g => lifeLikeRef(g, B3S23.born, B3S23.surv, neighbourOffsets('moore'), false), 4);
  });
});

describe('Stages against a CPU reference', () => {
  it('Brian\'s Brain: on → dying → off, and a lone pair of on cells starts sparks', () => {
    const P = { ruleType: 'stages', ...STAGES_PRESETS.briansBrain.params };
    // The cycle: an isolated on cell (no neighbours) goes 1 → 2 → 0.
    const one: Grid = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    const st = stepper(P, 5, 5);
    const a = st.step(boardFrom(one, sigOf(P)));
    expect(rounded(gridOf(a))[2][2]).toBe(2);
    expect(rounded(gridOf(st.step(a)))[2][2]).toBe(0);
    const ref = (g: Grid) => generationsRef(g, inMask(maskOf([2])), () => false, 3, neighbourOffsets('moore'));
    agree(P, randomGrid(10, 9, 11, 0.3, 2), ref, 6);
  });

  it('every Stages preset, from a random board', () => {
    for (const [key, pr] of Object.entries(STAGES_PRESETS)) {
      const P = { ruleType: 'stages', ...GRID_DEFAULTS, ...pr.params } as Record<string, number | string>;
      const states = Number(P.states);
      const ref = (g: Grid) => generationsRef(g, inMask(Number(P.bornMask)), inMask(Number(P.surviveMask)), states, neighbourOffsets('moore'));
      agree({ ruleType: 'stages', ...pr.params }, randomGrid(9, 8, 5 + key.length, 0.4, states - 1), ref, 4);
    }
  });

  it('Stages with walls and a von Neumann neighbourhood', () => {
    const P = { ruleType: 'stages', neighbourhood: 'vonNeumann', edges: 'walls', bornMask: maskOf([1, 2]), surviveMask: maskOf([1]), states: 5 };
    const ref = (g: Grid) => generationsRef(g, inMask(maskOf([1, 2])), inMask(maskOf([1])), 5, neighbourOffsets('vonNeumann'), false);
    agree(P, randomGrid(8, 8, 21, 0.4, 4), ref, 5);
  });
});

describe('the shared settings', () => {
  it('a new board (an empty Pass) is dealt from noise at Density; Reset deals again', () => {
    const st = stepper({ density: 0.3 }, 40, 30);
    const b = st.step(makeBoard(40, 30));
    const on = gridOf(b).flat().filter(v => v === 1).length / 1200;
    expect(on).toBeGreaterThan(0.22);
    expect(on).toBeLessThan(0.38);
    expect(texel(b, 3, 3)[3]).toBe(sigOf({}));
    // A board of another rule's signature is new too.
    const other = boardFrom(randomGrid(40, 30, 1, 0.9), 99);
    expect(gridOf(st.step(other)).flat().filter(v => v === 1).length / 1200).toBeLessThan(0.38);
    // Reset held: dealt again every frame.
    const full = boardFrom(Array.from({ length: 30 }, () => Array(40).fill(1)), sigOf({}));
    st.uniforms[Object.keys(st.uniforms).find(k => k.endsWith('_reset'))!] = 1;
    expect(gridOf(st.step(full)).flat().filter(v => v === 1).length / 1200).toBeLessThan(0.38);
  });

  it('Empty and Centre seed starts', () => {
    expect(gridOf(stepper({ start: 'empty' }, 10, 10).step(makeBoard(10, 10))).flat().every(v => v === 0)).toBe(true);
    const c = gridOf(stepper({ start: 'centre', density: 1 }, 40, 40).step(makeBoard(40, 40)));
    expect(c[20][20]).toBe(1);
    expect(c[2][2]).toBe(0);
  });

  it('Speed below 1 steps on some frames only; the phase is kept in blue', () => {
    const P = { rate: 0.5 };
    const st = stepper(P, 8, 8);
    const b0 = boardFrom(GLIDER, sigOf(P));
    const b1 = st.step(b0);
    expect(rounded(gridOf(b1))).toEqual(GLIDER);
    expect(texel(b1, 0, 0)[2]).toBeCloseTo(0.5, 6);
    const b2 = st.step(b1);
    expect(rounded(gridOf(b2))).not.toEqual(GLIDER);
    expect(texel(b2, 0, 0)[2]).toBeCloseTo(0, 6);
  });

  it('the brush paints its state under the pointer (in picture pixels) while the button is down', () => {
    const P = { start: 'empty', brushState: 1, brushFill: 1, brushRadius: 2, rate: 0, board: '0.125' };
    const st = stepper(P, 20, 20);
    const empty = boardFrom(Array.from({ length: 20 }, () => Array(20).fill(0)), sigOf(P));
    st.uniforms.u_mouse = [10.5 * 8, 6.5 * 8]; // cell (10, 6) at ⅛
    expect(gridOf(st.step(empty)).flat().some(v => v > 0)).toBe(false); // button up
    st.uniforms.u_mousebtn = 1;
    const painted = st.step(empty);
    expect(texel(painted, 10, 6)[0]).toBe(1);
    expect(texel(painted, 11, 7)[0]).toBe(1);
    expect(texel(painted, 14, 6)[0]).toBe(0);
    // Paint (a Play switch) paints without the button.
    st.uniforms.u_mousebtn = 0;
    st.uniforms[Object.keys(st.uniforms).find(k => k.endsWith('_paint'))!] = 1;
    expect(texel(st.step(empty), 10, 6)[0]).toBe(1);
  });

  it('afterglow: a cell that dies glows, fading each step; live cells age', () => {
    const P = { afterglow: 0.5, ageRate: 0.1 };
    const st = stepper(P, 5, 5);
    const one: Grid = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    const a = st.step(boardFrom(one, sigOf(P)));
    expect(texel(a, 2, 2)).toEqual([0, 0.5, 0, sigOf(P)]);
    expect(texel(st.step(a), 2, 2)[1]).toBeCloseTo(0.25, 6);
    const block: Grid = [[0, 0, 0, 0], [0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0]];
    const b = st.step(st.step(boardFrom(block, sigOf(P))));
    expect(texel(b, 1, 1)[1]).toBeCloseTo(0.2, 6);
  });
});

describe('Smooth', () => {
  it('diffusion with no cooling keeps the total on a torus', () => {
    const P = { ruleType: 'smooth', template: 'diffusion', spread: 0.8, decay: 0 };
    const st = stepper(P, 8, 8);
    const g = randomGrid(8, 8, 9, 0.5);
    const b = st.step(boardFrom(g, sigOf(P)), 5);
    const sum = (x: Grid) => x.flat().reduce((a, v) => a + v, 0);
    expect(sum(gridOf(b))).toBeCloseTo(sum(g), 4);
  });

  it('waves move height into the last height; reaction stays between 0 and 1', () => {
    const W = { ruleType: 'smooth', template: 'waves' };
    const g = randomGrid(6, 6, 2, 0.3);
    const b = stepper(W, 6, 6).step(boardFrom(g, sigOf(W)));
    expect(rounded(gridOf(b, 1))).toEqual(g);
    const R = { ruleType: 'smooth', ...SMOOTH_PRESETS.mitosis.params };
    const rb = stepper(R, 8, 8).step(boardFrom(randomGrid(8, 8, 4, 0.5), sigOf(R), 'repeat', randomGrid(8, 8, 5, 0.5)), 6);
    for (const v of [...gridOf(rb, 0).flat(), ...gridOf(rb, 1).flat()]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('a custom update runs as written', () => {
    const P = { ruleType: 'smooth', template: 'custom', customU: 'u * 0.5 + n + a', customV: '1 - v', knobA: 0.25 };
    const g = randomGrid(5, 5, 8, 0.5);
    const b = stepper(P, 5, 5).step(boardFrom(g, sigOf(P)));
    const got = gridOf(b), gotV = gridOf(b, 1);
    for (let r = 0; r < 5; r++) for (let x = 0; x < 5; x++) {
      expect(got[r][x]).toBeCloseTo(g[r][x] * 0.5 + g[(r + 4) % 5][x] + 0.25, 6);
      expect(gotV[r][x]).toBeCloseTo(1, 6);
    }
  });
});

describe('the Mouse node in a smaller Pass', () => {
  it('its UV is measured against the pass (the pointer times the pass\'s scale); Pixels stays in picture pixels', () => {
    const nodes = [
      n('mouse', 'node_1', 0, 0),
      n('makeVec3', 'node_2', 0, 0, {}, { r: ['node_1', 'x'] }),
      n('pass', 'node_3', 0, 0, { scale: '0.25' }, { color: ['node_2', 'rgb'] }),
      n('output', 'node_4', 0, 0, {}, { color: ['node_3', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.passes![0].fragmentShader).toContain('((u_mouse * 0.25) / u_resolution.y');
    expect(r.passes![0].fragmentShader).toMatch(/_px = u_mouse;/);
    // A full-size pass and the picture: as before.
    nodes[2] = n('pass', 'node_3', 0, 0, {}, { color: ['node_2', 'rgb'] });
    expect(compileGraph({ nodes }).passes![0].fragmentShader).toContain('= (u_mouse / u_resolution.y');
  });
});
