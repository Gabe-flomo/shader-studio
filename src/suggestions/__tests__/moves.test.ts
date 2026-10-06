/**
 * The moves library (suggestions/moves.ts): every move, applied where it belongs, gives a graph
 * that compiles, notes every node it adds, and changes the graph the way its shape says
 * (a transform in place, a branch shown, a param on the node).
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { parser } from '@shaderfrog/glsl-parser';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { estimateNodeHeight } from '../../store/graphLayout';
import type { GraphNode } from '../../types/nodeGraph';
import { applyMove, type MoveTarget } from '../applyMove';
import { MOVES, MOVES_BY_ID, quickAddMoves, type Move } from '../moves';

const H = (nd: GraphNode) => estimateNodeHeight(nd);
let k = 0;
const nextId = () => `m${k++}`;

type Start = { name: string; nodes: GraphNode[]; target: MoveTarget };

/** Graphs a move of each kind can go on: wired into a picture, alone, and with no Output. */
function starts(move: Move): Start[] {
  const kinds = move.kinds;
  const out: Start[] = [];
  if (kinds.includes('distance') && move.sides.includes('out')) {
    out.push(
      { name: 'circle painted', target: { nodeId: 'c', key: 'distance', side: 'out' }, nodes: [n('uv', 'u', -400, 0), n('circleSDF', 'c', 0, 0, {}, { position: ['u', 'uv'] }), n('sdfFill', 'f', 400, 0, {}, { d: ['c', 'distance'] }), n('output', 'o', 800, 0, {}, { color: ['f', 'result'] })] },
      { name: 'circle alone, empty Output', target: { nodeId: 'c', key: 'distance', side: 'out' }, nodes: [n('circleSDF', 'c', 0, 0), n('output', 'o', 800, 0)] },
      { name: 'box, no Output', target: { nodeId: 'c', key: 'distance', side: 'out' }, nodes: [n('boxSDF', 'c', 0, 0)] },
    );
  }
  if (kinds.includes('space')) {
    if (move.sides.includes('in')) out.push(
      { name: 'in front of a wired position', target: { nodeId: 'c', key: 'position', side: 'in' }, nodes: [n('uv', 'u', -400, 0), n('circleSDF', 'c', 0, 0, {}, { position: ['u', 'uv'] }), n('light', 'g', 400, 0, {}, { distance: ['c', 'distance'] }), n('output', 'o', 800, 0, {}, { color: ['g', 'tinted'] })] },
      { name: 'in front of an unwired position', target: { nodeId: 'c', key: 'position', side: 'in' }, nodes: [n('circleSDF', 'c', 0, 0), n('light', 'g', 400, 0, {}, { distance: ['c', 'distance'] }), n('output', 'o', 800, 0, {}, { color: ['g', 'tinted'] })] },
    );
    if (move.sides.includes('out')) out.push(
      { name: 'after UV', target: { nodeId: 'u', key: 'uv', side: 'out' }, nodes: [n('uv', 'u', -400, 0), n('fbm', 'f', 0, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 400, 0, {}, { value: ['f', 'value'] }), n('output', 'o', 800, 0, {}, { color: ['p', 'color'] })] },
    );
  }
  if (kinds.includes('colour')) {
    if (move.sides.includes('out')) out.push(
      { name: 'colour on the Output', target: { nodeId: 'p', key: 'color', side: 'out' }, nodes: [n('uv', 'u', -800, 0), n('fbm', 'f', -400, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 0, 0, {}, { value: ['f', 'value'] }), n('output', 'o', 800, 0, {}, { color: ['p', 'color'] })] },
      { name: 'colour alone, empty Output', target: { nodeId: 'p', key: 'color', side: 'out' }, nodes: [n('palette', 'p', 0, 0), n('output', 'o', 800, 0)] },
    );
    if (move.sides.includes('in')) out.push(
      { name: 'in front of a colour input', target: { nodeId: 'v', key: 'color', side: 'in' }, nodes: [n('palette', 'p', -400, 0), n('vignette', 'v', 0, 0, {}, { color: ['p', 'color'] }), n('output', 'o', 800, 0, {}, { color: ['v', 'result'] })] },
    );
  }
  if (kinds.includes('mask')) out.push(
    { name: 'a mask on the Output', target: { nodeId: 'm', key: 'mask', side: 'out' }, nodes: [n('circleSDF', 'c', -400, 0), n('sdfMask', 'm', 0, 0, {}, { sdf: ['c', 'distance'] }), n('floatToVec3', 'g', 400, 0, {}, { input: ['m', 'mask'] }), n('output', 'o', 800, 0, {}, { color: ['g', 'rgb'] })] },
    { name: 'a smoothstep mask alone', target: { nodeId: 'm', key: 'result', side: 'out' }, nodes: [n('circleSDF', 'c', -400, 0), n('smoothstep', 'm', 0, 0, {}, { value: ['c', 'distance'] }), n('output', 'o', 800, 0)] },
  );
  if (kinds.includes('texture')) out.push(
    { name: 'a Pass feeding nothing', target: { nodeId: 'pass', key: 'texture', side: 'out' }, nodes: [n('palette', 'p', -400, 0), n('pass', 'pass', 0, 0, {}, { color: ['p', 'color'] }), n('output', 'o', 800, 0, {}, { color: ['pass', 'color'] })] },
    { name: 'a Pass already read', target: { nodeId: 'pass', key: 'texture', side: 'out' }, nodes: [n('palette', 'p', -400, 0), n('pass', 'pass', 0, 0, {}, { color: ['p', 'color'] }), n('sampleTexture', 's', 400, 0, {}, { texture: ['pass', 'texture'] }), n('output', 'o', 800, 0, {}, { color: ['s', 'color'] })] },
  );
  if (kinds.includes('scalar')) out.push(
    { name: 'noise on a palette', target: { nodeId: 'f', key: 'value', side: 'out' }, nodes: [n('fbm', 'f', 0, 0), n('palette', 'p', 400, 0, {}, { value: ['f', 'value'] }), n('output', 'o', 800, 0, {}, { color: ['p', 'color'] })] },
    { name: 'noise alone', target: { nodeId: 'f', key: 'value', side: 'out' }, nodes: [n('fbm', 'f', 0, 0), n('output', 'o', 800, 0)] },
  );
  return out;
}

/** WebGL 1 built-ins the parser doesn't declare. */
const GL_BUILTINS = 'vec4 gl_FragColor;\nvec4 gl_FragCoord;\n';
/** The shader parses with every name declared (the GLSL itself is valid, not only the graph). */
export function parses(fragmentShader: string): void {
  expect(() => parser.parse(preprocess(GL_BUILTINS + fragmentShader, { preserve: {} }), { quiet: true, failOnWarn: true })).not.toThrow();
}

function check(move: Move, s: Start) {
  const before = s.nodes;
  const r = applyMove(before, s.target, move, {}, nextId, { heightOf: H });
  if (!r) return null;
  const res = compileGraph({ nodes: r.nodes });
  expect(res.errors, `${move.id} · ${s.name}: ${JSON.stringify(res.errors)}`).toBeUndefined();
  parses(res.fragmentShader!);
  const byId = new Map(r.nodes.map(nd => [nd.id, nd]));
  for (const id of r.added) expect(String(byId.get(id)?.params.__comment ?? '').trim(), `${move.id}: ${byId.get(id)?.type} has a note`).not.toBe('');
  for (const nd of before) expect(byId.has(nd.id), `${move.id} kept ${nd.id}`).toBe(true);
  return r;
}

describe('every move compiles where it belongs', () => {
  for (const move of MOVES) {
    if (move.shape === 'param') continue;
    for (const s of starts(move)) {
      it(`${move.id} · ${s.name}`, () => {
        // A move that doesn't fit this start (its `when`) returns null; that's fine.
        check(move, s);
      });
    }
  }
});

describe('in place', () => {
  it('a transform after an output takes over its wires', () => {
    const s = starts(MOVES_BY_ID.get('onion')!)[0];
    const r = applyMove(s.nodes, s.target, MOVES_BY_ID.get('onion')!, { thickness: 0.05 }, nextId, { heightOf: H })!;
    const fill = r.nodes.find(nd => nd.id === 'f')!;
    const onion = r.nodes.find(nd => nd.type === 'sdfOnion')!;
    expect(fill.inputs.d.connection?.nodeId).toBe(onion.id);
    expect(onion.inputs.dist.connection?.nodeId).toBe('c');
    expect(onion.params.r).toBe(0.05);
    expect(r.rewired).toBe(1);
  });
  it('a transform in front of an input goes between it and its source; an unwired space gets a UV', () => {
    const polar = MOVES_BY_ID.get('polar')!;
    const [wired, unwired] = starts(polar);
    const a = applyMove(wired.nodes, wired.target, polar, {}, nextId, { heightOf: H })!;
    const p = a.nodes.find(nd => nd.type === 'polarSpace')!;
    expect(a.nodes.find(nd => nd.id === 'c')!.inputs.position.connection?.nodeId).toBe(p.id);
    expect(p.inputs.input.connection?.nodeId).toBe('u');
    expect(p.position.x).toBeLessThan(0); // left of the circle
    const b = applyMove(unwired.nodes, unwired.target, polar, {}, nextId, { heightOf: H })!;
    const p2 = b.nodes.find(nd => nd.type === 'polarSpace')!;
    const uv = b.nodes.find(nd => nd.id === p2.inputs.input.connection?.nodeId)!;
    expect(uv.type).toBe('uv');
  });
  it('a branch of light is laid over the picture', () => {
    const glow = MOVES_BY_ID.get('glow')!;
    const s = starts(glow)[0];
    const r = applyMove(s.nodes, s.target, glow, { falloff: 8 }, nextId, { heightOf: H })!;
    const out = r.nodes.find(nd => nd.id === 'o')!;
    const over = r.nodes.find(nd => nd.id === out.inputs.color.connection?.nodeId)!;
    expect(over.type).toBe('addColor');
    expect(over.inputs.a.connection?.nodeId).toBe('f');
    expect(r.nodes.find(nd => nd.type === 'light')!.params.brightness).toBe(8);
    expect(r.shown).toBe(true);
  });
  it('on an empty Output, a distance transform is painted so it shows', () => {
    const onion = MOVES_BY_ID.get('onion')!;
    const s = starts(onion)[1];
    const r = applyMove(s.nodes, s.target, onion, {}, nextId, { heightOf: H })!;
    expect(r.shown).toBe(true);
    const out = r.nodes.find(nd => nd.id === 'o')!;
    expect(r.nodes.find(nd => nd.id === out.inputs.color.connection?.nodeId)!.type).toBe('sdfFill');
  });
  it('a Pass feeding nothing hands Blur to its own starter recipe', () => {
    const blur = MOVES_BY_ID.get('blur-texture')!;
    const s = starts(blur)[0];
    const r = applyMove(s.nodes, s.target, blur, {}, nextId, { heightOf: H })!;
    expect(r.nodes.some(nd => nd.type === 'blurTexture')).toBe(true);
    expect(compileGraph({ nodes: r.nodes }).errors).toBeUndefined();
  });
});

describe('param moves', () => {
  it('Lower intensity scales the node\'s own setting; SDF Glow raises its Falloff', () => {
    const dim = MOVES_BY_ID.get('dimmer')!;
    const nodes = [n('circleSDF', 'c', 0, 0), n('light', 'g', 400, 0, { brightness: 10 }, { distance: ['c', 'distance'] }), n('output', 'o', 800, 0, {}, { color: ['g', 'tinted'] })];
    const r = applyMove(nodes, { nodeId: 'g', key: 'tinted', side: 'out' }, dim, {}, nextId, { heightOf: H })!;
    expect(r.nodes.find(nd => nd.id === 'g')!.params.brightness).toBe(16);
    const b = [n('palette', 'p', 0, 0), n('bloom', 'b', 400, 0, { intensity: 2 }, { color: ['p', 'color'] })];
    const r2 = applyMove(b, { nodeId: 'b', key: 'result', side: 'out' }, dim, {}, nextId, { heightOf: H })!;
    expect(r2.nodes.find(nd => nd.id === 'b')!.params.intensity).toBe(1.2);
  });
  it('Wire UV in feeds a flat node\'s space input', () => {
    const nodes = [n('fbm', 'f', 0, 0), n('output', 'o', 800, 0)];
    const r = applyMove(nodes, { nodeId: 'f', key: 'value', side: 'out' }, MOVES_BY_ID.get('feed-uv')!, {}, nextId, { heightOf: H })!;
    const f = r.nodes.find(nd => nd.id === 'f')!;
    expect(r.nodes.find(nd => nd.id === f.inputs.uv.connection?.nodeId)!.type).toBe('uv');
    expect(compileGraph({ nodes: r.nodes }).errors).toBeUndefined();
  });
  it('the output fixes compile', () => {
    const fixes = ['add-noise', 'add-gradient', 'dither'];
    for (const id of fixes) {
      const move = MOVES_BY_ID.get(id)!;
      const nodes = move.kinds.includes('colour')
        ? [n('palette', 'p', 0, 0), n('output', 'o', 800, 0, {}, { color: ['p', 'color'] })]
        : [n('fbm', 'p', 0, 0), n('palette', 'q', 400, 0, {}, { value: ['p', 'value'] }), n('output', 'o', 800, 0, {}, { color: ['q', 'color'] })];
      const key = move.kinds.includes('colour') ? 'color' : 'value';
      const r = applyMove(nodes, { nodeId: 'p', key, side: 'out' }, move, {}, nextId, { heightOf: H })!;
      expect(compileGraph({ nodes: r.nodes }).errors, id).toBeUndefined();
    }
  });
});

describe('quick-add rules as moves', () => {
  it('a distance offers the quick-add consumers, and each compiles', () => {
    const nodes = [n('circleSDF', 'c', 0, 0), n('output', 'o', 800, 0)];
    const moves = quickAddMoves(nodes[0], 'distance', 'distance');
    expect(moves.map(m => m.anchor?.type)).toEqual(['sdfFill', 'glowLayer', 'sdfColorize']);
    for (const m of moves) {
      const r = applyMove(nodes, { nodeId: 'c', key: 'distance', side: 'out' }, m, {}, nextId, { heightOf: H })!;
      expect(compileGraph({ nodes: r.nodes }).errors, m.id).toBeUndefined();
    }
  });
});
