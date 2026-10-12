/**
 * The Warp Builder's If tile and conditions (docs/warp-builder.md, "If and conditions"): `?:`,
 * comparisons and and/or/not print and read back; nested Ifs; the smooth If; the space-block
 * checker accepts them; the CPU map and the preview agree; drops respect the condition slot.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});
import { parser } from '@shaderfrog/glsl-parser';
import { blockMap, checkBlock, checkLine, type SpaceBlock } from '../../sceneBuilder2d/blocks';
import { buildStandalone2D } from '../../sceneBuilder2d/build';
import { compileGraph } from '../../compiler/graphCompiler';
import { canSoft, hasCode, setSoft, slotKind, textToTile, tileText, type Tile } from '../tiles';
import { blockWithIf, dropAllowed, dropTile, fillHoles, newWarpBlock, rowProblems, type WarpSpec } from '../spec';
import { previewShader } from '../preview';
import { sceneForWarp } from '../actions';

const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };
const blockOf = (rhs: string, target: SpaceBlock['lines'][number]['target'] = 'uv.x', params: SpaceBlock['params'] = []): SpaceBlock => ({ lines: [{ target, op: '+=', rhs }], params, times: 1 });
const x: Tile = { k: 'var', name: 'x' }, y: Tile = { k: 'var', name: 'y' };
const n = (value: number): Tile => ({ k: 'num', value });

describe('printing and reading ?: and conditions', () => {
  const cases = [
    'x > 0 ? 0.2 : -0.2',
    'x > a ? sin(y * 3) : 0',
    'x >= 0 && y < 0.5 ? 1 : 0',
    'x > 0 || !(y > 0) ? 0.1 : 0',
    'x == 0 ? 1 : 0',
    'x != y ? 0.3 : 0',
    'x > 0 ? (y > 0 ? 0.1 : 0.2) : (y > 0 ? 0.3 : 0.4)',
    'x > 0 ? 0.1 : y > 0 ? 0.2 : 0.3',
    'sin(x > 0 ? y : -y) * 0.1',
    '(x > 0 ? 1 : 2) * 0.1',
  ];
  it.each(cases)('%s → tiles → text → tiles, and the checker accepts it', text => {
    const t1 = textToTile(text, ['a'])!;
    expect(hasCode(t1)).toBe(false);
    const printed = tileText(t1);
    expect(textToTile(printed, ['a'])).toEqual(t1);
    const params = [{ name: 'a', value: 0.2, min: 0, max: 1 }];
    const typed = blockOf(text, 'uv.x', params), back = blockOf(printed, 'uv.x', params);
    expect(checkBlock(typed).ok).toBe(true);
    expect(checkBlock(back).ok).toBe(true);
    const A = blockMap(typed, 0.3), B = blockMap(back, 0.3);
    for (const [px, py] of [[0.3, -0.2], [-0.4, 0.6], [0, 0], [0.7, 0.7]] as const) expect(B(px, py)).toEqual(A(px, py));
  });

  it('a ternary reads as an If tile (no longer a code tile), comparisons, and/or/not as theirs', () => {
    expect(textToTile('x > 0.0 ? 1.0 : -1.0')).toEqual({ k: 'if', cond: { k: 'cmp', op: '>', a: x, b: n(0) }, a: n(1), b: n(-1) });
    expect(textToTile('x > 0 && !(y < 1) ? 1 : 0')).toMatchObject({ k: 'if', cond: { k: 'logic', op: '&&', b: { k: 'not', a: { k: 'cmp', op: '<' } } } });
    expect(tileText({ k: 'if', cond: { k: 'logic', op: '||', a: { k: 'cmp', op: '>', a: x, b: n(0) }, b: { k: 'cmp', op: '<', a: y, b: n(0) } }, a: n(1), b: n(0) })).toBe('x > 0 || y < 0 ? 1 : 0');
  });

  it('the checker: a vec2 If on uv, a bool where a number goes fails in words', () => {
    expect(checkLine({ target: 'uv', op: '=', rhs: 'x > 0 ? uv : -uv' }, []).ok).toBe(true);
    expect(checkLine({ target: 'uv.x', op: '+=', rhs: 'x > 0' }, []).ok).toBe(false);
    expect(checkLine({ target: 'uv.x', op: '+=', rhs: 'x > 0 && y > 0 ? 0.1 : 0' }, []).ok).toBe(true);
  });
});

describe('the smooth If', () => {
  const hard = textToTile('x > a ? 0.2 : -0.2', ['a'])!;
  const w: Tile = { k: 'param', name: 'width' };
  it('prints as mix(false, true, smoothstep(a - w, a + w, value)) and reads back', () => {
    const soft = setSoft(hard, w)!;
    const text = tileText(soft);
    expect(text).toBe('mix(-0.2, 0.2, smoothstep(a - width, a + width, x))');
    expect(textToTile(text, ['a', 'width'])).toEqual(soft);
    expect(tileText(setSoft(soft, null))).toBe('x > a ? 0.2 : -0.2');
  });
  it('a < condition is written as > with the branches swapped; == can’t be smooth', () => {
    const lt = setSoft(textToTile('x < 0.5 ? 1 : 0')!, w)!;
    expect(tileText(lt)).toBe('mix(1, 0, smoothstep(0.5 - width, 0.5 + width, x))');
    expect(canSoft(textToTile('x == 0 ? 1 : 0'))).toBe(false);
    expect(setSoft(textToTile('x == 0 ? 1 : 0')!, w)).toBeNull();
  });
  it('compiles: the space-block checker, the preview shader and the standalone graph', () => {
    const block = blockOf(tileText(setSoft(hard, w)), 'uv.x', [{ name: 'a', value: 0.1, min: 0, max: 1 }, { name: 'width', value: 0.05, min: 0, max: 0.5 }]);
    expect(checkBlock(block).ok).toBe(true);
    const spec: WarpSpec = { blocks: [{ id: 'w1', block }, { id: 'w2', block: blockOf('x > 0 && y > 0 ? 0.1 : 0', 'uv.y') }] };
    for (const mode of ['checker', 'ring', 'vectors', 'heat'] as const) expect(parses(previewShader(spec, mode).source)).toBeNull();
    const r = compileGraph({ nodes: buildStandalone2D(sceneForWarp(spec, 'checker')).nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    // Soft and hard agree away from the edge.
    const H = blockMap(blockOf('x > 0.1 ? 0.2 : -0.2'), 0), S = blockMap(block, 0);
    expect(S(0.6, 0)[0]).toBeCloseTo(H(0.6, 0)[0]);
    expect(S(-0.6, 0)[0]).toBeCloseTo(H(-0.6, 0)[0]);
  });
});

describe('dropping into the If', () => {
  const fresh = (): WarpSpec => ({ blocks: [{ id: 'w1', block: newWarpBlock() }] });
  const row = { block: 0, line: 0 };

  it('if onto X, > into the condition, x and # into its slots, values into then/else', () => {
    const spec = fresh();
    let sel = dropTile(spec, { ...row, path: null }, { from: 'palette', kind: 'if' });
    expect(spec.blocks[0].block.lines[0].rhs).toBe('_ ? _ : _');
    expect(sel?.path).toEqual([0]);
    expect(slotKind(textToTile('_ ? _ : _'), [0])).toBe('bool');
    sel = dropTile(spec, { ...row, path: [0] }, { from: 'palette', kind: 'cmp', op: '>' });
    expect(spec.blocks[0].block.lines[0].rhs).toBe('_ > _ ? _ : _');
    sel = dropTile(spec, { ...row, path: [0, 0] }, { from: 'palette', kind: 'var', name: 'x' });
    sel = dropTile(spec, { ...row, path: [0, 1] }, { from: 'palette', kind: 'num' });
    sel = dropTile(spec, { ...row, path: [1] }, { from: 'palette', kind: 'num' });
    expect(sel?.path).toEqual([2]);
    dropTile(spec, { ...row, path: [2] }, { from: 'palette', kind: 'fn', fn: 'sin' });
    dropTile(spec, { ...row, path: [2, 0] }, { from: 'palette', kind: 'var', name: 'y' });
    const b = spec.blocks[0].block;
    expect(b.lines[0].rhs).toBe('x > edge ? a : sin(y)');
    expect(rowProblems(b)[0]).toBeNull();
    expect(checkBlock(b).ok).toBe(true);
  });

  it('the condition takes only conditions; then/else and rows take only values', () => {
    const spec = fresh();
    dropTile(spec, { ...row, path: null }, { from: 'palette', kind: 'if' });
    const before = spec.blocks[0].block.lines[0].rhs;
    expect(dropAllowed(spec, { ...row, path: [0] }, { from: 'palette', kind: 'var', name: 'x' })).toBe(false);
    expect(dropTile(spec, { ...row, path: [0] }, { from: 'palette', kind: 'num' })).toBeNull();
    expect(dropTile(spec, { ...row, path: [1] }, { from: 'palette', kind: 'cmp', op: '<' })).toBeNull();
    expect(dropAllowed(spec, { ...row, path: null }, { from: 'palette', kind: 'not' })).toBe(false);
    expect(spec.blocks[0].block.lines[0].rhs).toBe(before);
  });

  it('and/or/not wrap a condition; a comparison on a comparison changes its sign; nested If', () => {
    const spec = fresh();
    spec.blocks[0].block.lines[0].rhs = 'x > 0 ? 0.1 : 0';
    dropTile(spec, { ...row, path: [0] }, { from: 'palette', kind: 'cmp', op: '<=' });
    expect(spec.blocks[0].block.lines[0].rhs).toBe('x <= 0 ? 0.1 : 0');
    dropTile(spec, { ...row, path: [0] }, { from: 'palette', kind: 'logic', op: '||' });
    dropTile(spec, { ...row, path: [0, 1] }, { from: 'palette', kind: 'cmp', op: '>' });
    dropTile(spec, { ...row, path: [0, 1, 0] }, { from: 'palette', kind: 'var', name: 'y' });
    dropTile(spec, { ...row, path: [0, 1, 1] }, { from: 'palette', kind: 'var', name: 'x' });
    dropTile(spec, { ...row, path: [0, 0] }, { from: 'palette', kind: 'not' });
    expect(spec.blocks[0].block.lines[0].rhs).toBe('!(x <= 0) || y > x ? 0.1 : 0');
    // An If in the else slot: nested.
    dropTile(spec, { ...row, path: [2] }, { from: 'palette', kind: 'if' });
    expect(spec.blocks[0].block.lines[0].rhs).toBe('!(x <= 0) || y > x ? 0.1 : _ ? 0 : _');
    // Moving a condition tile into a value slot is refused.
    expect(dropAllowed(spec, { ...row, path: [1] }, { from: 'row', block: 0, line: 0, path: [0] })).toBe(false);
  });

  it('pictures: empty conditions read as x > 0; the If picture keeps the tile on one side', () => {
    expect(tileText(fillHoles(textToTile('_ ? _ : 1')))).toBe('x > 0 ? 0 : 1');
    const b = blockWithIf(blockOf('sin(y * 4) * 0.2'), 0, []);
    expect(b.lines[0].rhs).toBe('x > 0 ? sin(y * 4) * 0.2 : 0');
    expect(blockWithIf(blockOf('sin(y * 4) * 0.2'), 0, [], '&&').lines[0].rhs).toBe('x > 0 && y > 0 ? sin(y * 4) * 0.2 : 0');
    expect(checkBlock(b).ok).toBe(true);
  });
});
