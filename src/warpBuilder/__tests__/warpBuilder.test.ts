/**
 * The Warp Builder (docs/warp-builder.md): tiles ↔ lines round-trip; every library block reads into
 * tiles (code tiles where needed) and prints back to the same warp; building by dropping tiles;
 * the preview's sliders are uniforms (no recompile); stacking; My blocks; to and from the 2D
 * builder; each preview mode's shader parses and the standalone Done graph compiles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import { parser } from '@shaderfrog/glsl-parser';
import { BLOCK_LIBRARY, blockFromEntry } from '../../sceneBuilder2d/blockLibrary';
import { blockMap, checkBlock, type SpaceBlock } from '../../sceneBuilder2d/blocks';
import { loadSavedBlocks, saveSavedBlock, savedBlockFrom, sceneOpFromSaved } from '../../sceneBuilder2d/savedBlocks';
import { buildStandalone2D } from '../../sceneBuilder2d/build';
import { compileGraph } from '../../compiler/graphCompiler';
import { useSceneBuilder2D } from '../../sceneBuilder2d/store';
import { newBlockOp, newSpaceOp, starterScene } from '../../sceneBuilder2d/spec';
import {
  FN_TILES, appendTo, duplicateAt, hasCode, moveTile, removeAt, swapAt, textToTile, tileText, wrapAt, type Tile,
} from '../tiles';
import {
  PREVIEW_MODES, addRow, blockWithWrap, dropTile, newWarpBlock, rowProblems, rowTile, setRowTile, spaceWithWarp, surpriseWarp, warpFromSpace, warpMap,
  type WarpSpec,
} from '../spec';
import { previewShader, previewUniforms } from '../preview';
import { openWarpFrom2D, sceneForWarp, sendWarpTo2D } from '../actions';
import { useWarpBuilder } from '../store';

const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
const SAMPLES: Array<[number, number]> = [[0.13, -0.41], [-0.7, 0.22], [0.5, 0.5], [-0.05, -0.9], [0.31, 0.02]];
const sameMap = (a: SpaceBlock, b: SpaceBlock, t = 0.7) => {
  const A = blockMap(a, t), B = blockMap(b, t);
  return SAMPLES.every(([x, y]) => near(A(x, y), B(x, y)));
};
const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

describe('tiles ↔ lines', () => {
  const cases = [
    '0.1 * sin(y * 7 + t)', 'amp * sin(y * freq + t * speed)', 'abs(uv) - 0.5', '-x * 2', 'x - (-0.5)', 'sin(length(uv) * 8 - t)',
    'rotate(uv, atan(y, x) * 0.5)', 'uv.yx * 2', 'vec2(cos(t), sin(t)) * 0.2', 'x / (1 + y * y)', 'mix(x, y, 0.5)', '(x + y) * (x - y)',
    'x > 0.0 ? 1.0 : -1.0', 'valueNoise(uv * 3 + t)',
  ];
  it.each(cases)('%s → tiles → text → tiles', text => {
    const params = ['amp', 'freq', 'speed'];
    const t1 = textToTile(text, params)!;
    const printed = tileText(t1);
    const t2 = textToTile(printed, params);
    expect(t2).toEqual(t1);
    // The printed text is the same warp as the typed one.
    const a: SpaceBlock = { lines: [{ target: text.includes('uv,') || text.startsWith('abs(uv)') || text.startsWith('uv') || text.startsWith('vec2') ? 'uv' : 'uv.x', op: '+=', rhs: text }], params: params.map(name => ({ name, value: 0.3, min: 0, max: 1 })), times: 1 };
    const b: SpaceBlock = { ...a, lines: [{ ...a.lines[0], rhs: printed }] };
    expect(checkBlock(b).ok).toBe(checkBlock(a).ok);
    expect(sameMap(a, b)).toBe(true);
  });

  it('r and θ are length(uv) and atan(y, x); uv.x reads as x; an index stays a code tile', () => {
    expect(textToTile('length(uv)')).toEqual({ k: 'var', name: 'r' });
    expect(textToTile('atan(uv.y, uv.x)')).toEqual({ k: 'var', name: 'theta' });
    expect(textToTile('uv.x')).toEqual({ k: 'var', name: 'x' });
    expect(hasCode(textToTile('uv[0] * 2.0'))).toBe(true);
    expect(textToTile('sin(')).toEqual({ k: 'code', text: 'sin(' });
    expect(textToTile('')).toBeNull();
  });

  it('editing: wrap, operators, duplicate, swap, move, remove', () => {
    let row: Tile | null = { k: 'var', name: 'x' };
    row = wrapAt(row, [], 'sin');
    expect(tileText(row)).toBe('sin(x)');
    row = duplicateAt(row, []);
    expect(tileText(row)).toBe('sin(x) + sin(x)');
    row = wrapAt(row, [1, 0], 'abs');
    expect(tileText(row)).toBe('sin(x) + sin(abs(x))');
    row = swapAt(row, []);
    expect(tileText(row)).toBe('sin(abs(x)) + sin(x)');
    row = moveTile(row, [0, 0], [1, 0]);
    expect(tileText(row)).toBe('sin(_) + sin(abs(x))');
    row = removeAt(row, [0]);
    expect(tileText(row)).toBe('sin(abs(x))');
    expect(tileText(appendTo(row, { k: 'var', name: 't' }, '*'))).toBe('sin(abs(x)) * t');
    expect(removeAt(row, [])).toBeNull();
    for (const f of FN_TILES) expect(tileText(wrapAt({ k: 'var', name: 'x' }, [], f.fn))).toContain(f.fn);
  });
});

describe('every library block opens as tiles', () => {
  it.each(BLOCK_LIBRARY.map(e => [e.id, e] as const))('%s', (_id, e) => {
    const block = blockFromEntry(e);
    const again: SpaceBlock = structuredClone(block);
    again.lines.forEach((_l, i) => setRowTile(again, i, rowTile(block, i)));
    // Same sliders, still checks, same warp (looped blocks too).
    expect(again.params.map(p => p.name)).toEqual(block.params.map(p => p.name));
    expect(checkBlock(again).ok).toBe(true);
    expect(sameMap(block, again)).toBe(true);
  });

  it('only a few need a code tile', () => {
    const coded = BLOCK_LIBRARY.filter(e => blockFromEntry(e).lines.some((_l, i) => hasCode(rowTile(blockFromEntry(e), i))));
    expect(coded.length).toBeLessThan(BLOCK_LIBRARY.length / 3);
  });
});

describe('building by dropping tiles', () => {
  it('uv.x += 0.1 * sin(y * 7 + t): sin onto X, y in, # into the frequency, the clock, # for the amplitude', () => {
    const spec: WarpSpec = { blocks: [{ id: 'w1', block: newWarpBlock() }] };
    const row = { block: 0, line: 0 };
    let sel = dropTile(spec, { ...row, path: null }, { from: 'palette', kind: 'fn', fn: 'sin' });
    expect(spec.blocks[0].block.lines[0].rhs).toBe('sin(_)');
    expect(sel?.path).toEqual([0]);
    sel = dropTile(spec, { ...row, path: [0] }, { from: 'palette', kind: 'var', name: 'y' });
    sel = dropTile(spec, { ...row, path: [0] }, { from: 'palette', kind: 'num' });
    expect(spec.blocks[0].block.lines[0].rhs).toBe('sin(y * freq)');
    sel = dropTile(spec, { ...row, path: [0] }, { from: 'palette', kind: 'var', name: 't' });
    expect(spec.blocks[0].block.lines[0].rhs).toBe('sin(y * freq + t)');
    sel = dropTile(spec, { ...row, path: [] }, { from: 'palette', kind: 'num' });
    const b = spec.blocks[0].block;
    expect(b.lines[0]).toEqual({ target: 'uv.x', op: '+=', rhs: 'sin(y * freq + t) * amp' });
    expect(b.params.map(p => [p.name, p.value])).toEqual([['freq', 7], ['amp', 0.1]]);
    expect(checkBlock(b).ok).toBe(true);
    expect(sel).not.toBeNull();
    // The same warp as the typed line.
    const typed: SpaceBlock = { lines: [{ target: 'uv.x', op: '+=', rhs: '0.1 * sin(y * 7 + t)' }], params: [], times: 1 };
    expect(sameMap(b, typed)).toBe(true);
  });

  it('removing a number tile drops its slider; moving across blocks takes it along', () => {
    const spec: WarpSpec = { blocks: [{ id: 'w1', block: newWarpBlock() }, { id: 'w2', block: newWarpBlock() }] };
    dropTile(spec, { block: 0, line: 0, path: null }, { from: 'palette', kind: 'var', name: 'y' });
    dropTile(spec, { block: 0, line: 0, path: [] }, { from: 'palette', kind: 'num' });
    expect(spec.blocks[0].block.params).toHaveLength(1);
    dropTile(spec, { block: 1, line: 1, path: null }, { from: 'row', block: 0, line: 0, path: [] });
    expect(spec.blocks[0].block.lines[0].rhs).toBe('');
    expect(spec.blocks[0].block.params).toHaveLength(0);
    expect(spec.blocks[1].block.lines[1].rhs).toBe('y * amp');
    expect(spec.blocks[1].block.params.map(p => p.name)).toEqual(['amp']);
  });

  it('an empty slot is a plain-words problem, and rows add up to three', () => {
    const b = newWarpBlock();
    b.lines[0].rhs = 'sin(_)';
    expect(rowProblems(b)[0]).toMatch(/empty slot/);
    expect(addRow(b)).toBe(true);
    expect(b.lines.map(l => l.target)).toEqual(['uv.x', 'uv.y', 'uv']);
    expect(addRow(b)).toBe(false);
  });

  it('the palette pictures: the row with the function wrapped round the picked tile', () => {
    const b: SpaceBlock = { lines: [{ target: 'uv.x', op: '+=', rhs: 'y * 0.3' }], params: [], times: 1 };
    expect(blockWithWrap(b, 0, [], 'sin').lines[0].rhs).toBe('sin(y * 0.3)');
    expect(blockWithWrap(b, 0, [0], 'mix').lines[0].rhs).toBe('mix(y, 0, 0.5) * 0.3');
  });

  it('Surprise me makes blocks that check, the same for the same seed', () => {
    for (let s = 1; s < 40; s++) {
      const w = surpriseWarp(s);
      expect(checkBlock(w.blocks[0].block).ok).toBe(true);
      expect(surpriseWarp(s)).toEqual(w);
    }
  });
});

describe('the preview', () => {
  const lib = (id: string) => blockFromEntry(BLOCK_LIBRARY.find(e => e.id === id)!);
  const stack: WarpSpec = { blocks: [{ id: 'w1', block: lib('sine-shift') }, { id: 'w2', block: lib('twirl') ?? lib('sine-weave') }, { id: 'w3', block: lib(BLOCK_LIBRARY.find(e => e.loop)!.id) }] };

  it.each(PREVIEW_MODES.map(m => [m.mode]))('%s parses as GLSL', mode => {
    expect(parses(previewShader(stack, mode).source)).toBeNull();
  });

  it('every library block parses in the preview shader', () => {
    const all: WarpSpec = { blocks: BLOCK_LIBRARY.slice(0, 16).map((e, i) => ({ id: `w${i}`, block: blockFromEntry(e) })) };
    expect(parses(previewShader(all, 'checker').source)).toBeNull();
    const rest: WarpSpec = { blocks: BLOCK_LIBRARY.slice(16, 32).map((e, i) => ({ id: `w${i}`, block: blockFromEntry(e) })) };
    expect(parses(previewShader(rest, 'vectors').source)).toBeNull();
  });

  it('sliders, Run ×, mute and hover are uniforms: the shader stays the same', () => {
    const a = previewShader(stack, 'checker');
    const moved = structuredClone(stack);
    moved.blocks[0].block.params[0].value = 0.42;
    moved.blocks[1].block.times = 3;
    moved.blocks[1].muted = true;
    expect(previewShader(moved, 'checker').source).toBe(a.source);
    const u = previewUniforms(moved, 1);
    expect(u.p[a.offsets[0]]).toBeCloseTo(0.42);
    expect(u.n[1]).toBe(3);
    expect(u.on[1]).toBe(0);
    expect(u.upto).toBe(1);
  });
});

describe('stacking', () => {
  it('the next block warps the result of the one before; muted ones pass through', () => {
    const a: SpaceBlock = { lines: [{ target: 'uv.x', op: '+=', rhs: '0.5' }], params: [], times: 1 };
    const b: SpaceBlock = { lines: [{ target: 'uv', op: '*=', rhs: '2' }], params: [], times: 1 };
    const spec: WarpSpec = { blocks: [{ id: 'w1', block: a }, { id: 'w2', block: b }] };
    expect(warpMap(spec)(0.1, 0.2)).toEqual([1.2, 0.4]);
    expect(warpMap(spec, 0, 1)(0.1, 0.2)).toEqual([0.6, 0.2]);
    spec.blocks[0].muted = true;
    expect(warpMap(spec)(0.1, 0.2)).toEqual([0.2, 0.4]);
  });
});

describe('My blocks', () => {
  beforeEach(() => localStorage.clear());
  it('a warp block saves to My blocks and loads back as tiles', () => {
    const spec: WarpSpec = { blocks: [{ id: 'w1', block: newWarpBlock() }] };
    dropTile(spec, { block: 0, line: 0, path: null }, { from: 'palette', kind: 'fn', fn: 'sin' });
    dropTile(spec, { block: 0, line: 0, path: [0] }, { from: 'palette', kind: 'var', name: 'y' });
    const saved = savedBlockFrom({ block: spec.blocks[0].block }, { name: 'Wiggle' })!;
    expect(saved.thumb).toMatch(/^data:image\/png/);
    saveSavedBlock(saved);
    const back = sceneOpFromSaved(loadSavedBlocks().find(s => s.name === 'Wiggle')!).block!;
    expect(tileText(rowTile(back, 0))).toBe('sin(y)');
  });
});

describe('to and from the 2D Scene Builder', () => {
  beforeEach(() => { useSceneBuilder2D.getState().close(); useWarpBuilder.getState().close(); });

  it('opens on a space block, and Done writes it back in place (other ops stay)', () => {
    const scene = starterScene();
    scene.space = [newSpaceOp('zoom', 'p1'), newBlockOp('p2', blockFromEntry(BLOCK_LIBRARY[0])), newBlockOp('p3', blockFromEntry(BLOCK_LIBRARY[1]))];
    useSceneBuilder2D.getState().openWith(scene);
    openWarpFrom2D(['p2']);
    const w = useWarpBuilder.getState();
    expect(w.open).toBe(true);
    expect(w.spec.blocks).toHaveLength(1);
    expect(w.spec.blocks[0].block.lines[0].rhs).toBe(BLOCK_LIBRARY[0].lines[0].rhs);
    w.edit(d => { d.blocks[0].block.lines[0].rhs = 'amp * cos(x * 3)'; d.blocks.push({ id: 'w2', block: { lines: [{ target: 'uv', op: '*=', rhs: '1.5' }], params: [], times: 1 } }); });
    sendWarpTo2D();
    const space = useSceneBuilder2D.getState().scene.space;
    expect(space.map(o => o.kind)).toEqual(['zoom', 'block', 'block', 'block']);
    expect(space[1].id).toBe('p2');
    expect(space[1].block!.lines[0].rhs).toBe('amp * cos(x * 3)');
    expect(space[2].block!.lines[0].rhs).toBe('1.5');
    expect(space[3].id).toBe('p3');
    expect(new Set(space.map(o => o.id)).size).toBe(4);
    expect(useWarpBuilder.getState().open).toBe(false);
  });

  it('the whole stack opens, and a new warp sent over goes to the end', () => {
    const ops = [newBlockOp('p1', blockFromEntry(BLOCK_LIBRARY[2])), newSpaceOp('mirror', 'p2'), newBlockOp('p3', blockFromEntry(BLOCK_LIBRARY[3]))];
    expect(warpFromSpace(ops).blocks).toHaveLength(2);
    const added = spaceWithWarp(ops, surpriseWarp(5), null, taken => { for (let i = 1; ; i++) if (!taken.has(`p${i}`)) return `p${i}`; });
    expect(added.map(o => o.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('a standalone Done builds a graph that compiles, for each preview', () => {
    const spec = surpriseWarp(11);
    for (const m of PREVIEW_MODES) {
      const s = sceneForWarp(spec, m.mode);
      expect(s.space).toHaveLength(1);
      const g = buildStandalone2D(s);
      const r = compileGraph({ nodes: g.nodes });
      expect(r.errors ?? []).toEqual([]);
      expect(r.success).toBe(true);
    }
  });
});
