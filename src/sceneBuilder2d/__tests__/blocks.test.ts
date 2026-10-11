import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../build';
import {
  blockGlslLines, blockMap, checkBlock, checkLine, combineMap, emptyBlock, parseBlockText, parseLineText, paramNameProblem,
  type BlockLine, type SpaceBlock,
} from '../blocks';
import { BLOCK_CATEGORIES, BLOCK_LIBRARY, blockFromEntry, isLibraryBlock, randomChoices } from '../blockLibrary';
import { emptyScene, newBlockOp, newCombineOp, newShape, newSpaceOp, type Scene2D } from '../spec';
import { parseRecipe2D, printRecipe2D } from '../recipe';
import { renderWarpThumbnail, stackMap } from '../thumbnails';

const L = (target: BlockLine['target'], op: BlockLine['op'], rhs: string): BlockLine => ({ target, op, rhs });
const blk = (lines: BlockLine[], params: SpaceBlock['params'] = [], times = 1): SpaceBlock => ({ name: 'Test', lines, params, times });

function compiles(scene: Scene2D) {
  const { nodes, warnings } = buildStandalone2D(scene);
  const r = compileGraph({ nodes });
  expect(r.success, String(r.errors)).toBe(true);
  expect(() => parser.parse(r.fragmentShader.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
  return { nodes, warnings, fs: r.fragmentShader };
}

describe('space blocks: reading lines', () => {
  it('reads the three targets and the four assign operators', () => {
    expect(parseLineText('uv.x += sin(y + t) * 0.2').line).toEqual(L('uv.x', '+=', 'sin(y + t) * 0.2'));
    expect(parseLineText('uv.y -= 0.1').line).toEqual(L('uv.y', '-=', '0.1'));
    expect(parseLineText('uv *= 2;').line).toEqual(L('uv', '*=', '2'));
    expect(parseLineText('uv = abs(uv)').line).toEqual(L('uv', '=', 'abs(uv)'));
    // Graphtoy-style: x and y as targets are uv.x and uv.y.
    expect(parseLineText('x = sin(x + t) * y').line).toEqual(L('uv.x', '=', 'sin(x + t) * y'));
    expect(parseLineText('').line).toBeNull();
  });

  it('says what is wrong with a line it cannot read', () => {
    expect(parseLineText('p = 2').error).toMatch(/starts with uv\.x, uv\.y or uv/);
    expect(parseLineText('uv /= 2').error).toMatch(/isn’t one of the operators/);
    expect(parseLineText('uv.x +=').error).toMatch(/Nothing after/);
    expect(parseLineText('uv == 2').error).toBeTruthy();
  });

  it('reads a block of up to three lines, split by new lines or ;', () => {
    const r = parseBlockText('uv.x += sin(y)\nuv.y += cos(x); uv *= 1.5');
    expect(r.errors).toEqual([]);
    expect(r.lines.map(l => l.target)).toEqual(['uv.x', 'uv.y', 'uv']);
    // A ; inside brackets isn't a split (there are none in GLSL expressions, but be safe).
    expect(parseBlockText('uv = vec2(1, 2)').lines).toHaveLength(1);
    expect(parseBlockText('uv *= 1\nuv *= 2\nuv *= 3\nuv *= 4').errors[0]).toMatch(/at most 3 lines/);
  });
});

describe('space blocks: checking', () => {
  it('lets x, y, uv and t be used everywhere (Graphtoy-style)', () => {
    const c = checkLine(L('uv.x', '+=', 'sin(x + t) * y'), []);
    expect(c.ok, c.error).toBe(true);
    expect(c.glsl).toBe('sin(uv.x + t) * uv.y');
  });

  it('writes whole numbers as floats, but not an index', () => {
    expect(checkLine(L('uv', '*=', '2'), []).glsl).toBe('2.0');
    expect(checkLine(L('uv.x', '=', 'pow(x, 2) + uv[0]'), []).glsl).toBe('pow(uv.x, 2.0) + uv[0]');
    expect(checkLine(L('uv', '=', 'vec2(1, 2.5) * 3e-1'), []).glsl).toBe('vec2(1.0, 2.5) * 3e-1');
  });

  it('knows slider names, PI and TAU, and reports unknown names with a suggestion', () => {
    const p = [{ name: 'amp', value: 0.1, min: 0, max: 1 }];
    expect(checkLine(L('uv.x', '+=', 'amp * sin(TAU * y)'), p).ok).toBe(true);
    const bad = checkLine(L('uv.x', '+=', 'ampp * sin(y)'), p);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/“ampp” isn't known.*Did you mean “amp”/);
    expect(checkLine(L('uv.x', '+=', 'sinn(y)'), []).error).toMatch(/sinn\(\) isn't a function GLSL knows\. Did you mean sin\(\)/);
    expect(checkLine(L('uv.x', '+=', 'sin(y'), []).error).toMatch(/Can't read/);
    expect(checkLine(L('uv.x', '+=', 'texture(y)'), []).error).toMatch(/can't be used/);
  });

  it('checks types against the target', () => {
    expect(checkLine(L('uv.x', '=', 'uv * 2'), []).error).toMatch(/uv\.x is one number, but this gives a vec2/);
    expect(checkLine(L('uv', '=', 'length(uv)'), []).error).toMatch(/uv = needs two numbers/);
    expect(checkLine(L('uv', '*=', 'length(uv)'), []).ok).toBe(true);
    expect(checkLine(L('uv', '+=', '0.1'), []).ok).toBe(true);
    expect(checkLine(L('uv', '=', 'vec3(uv, 1)'), []).error).toMatch(/gives a vec3/);
    expect(checkLine(L('uv.y', '=', 'mix(x, vec3(1), 0.5)'), []).ok).toBe(false);
  });

  it('an empty line leaves uv as it is', () => {
    const b = emptyBlock();
    expect(checkBlock(b).ok).toBe(true);
    expect(blockGlslLines(b)).toEqual([]);
    expect(blockMap(b)(0.3, -0.2)).toEqual([0.3, -0.2]);
  });

  it('checks slider names', () => {
    expect(paramNameProblem('x')).toMatch(/taken/);
    expect(paramNameProblem('sin')).toMatch(/GLSL function/);
    expect(paramNameProblem('2a')).toMatch(/letters/);
    expect(paramNameProblem('amp', ['amp'])).toMatch(/already/);
    expect(paramNameProblem('amp')).toBeNull();
  });

  it('runs lines top to bottom, x and y being the point as it is now', () => {
    const b = blk([L('uv.x', '=', 'x + 1'), L('uv.y', '=', 'x')]);
    expect(blockMap(b)(0.5, 0)).toEqual([1.5, 1.5]);
    const times = blk([L('uv', '*=', '2')], [], 3);
    expect(blockMap(times)(1, 1)).toEqual([8, 8]);
    expect(blockGlslLines(times)).toHaveLength(3);
  });
});

describe('the library', () => {
  it('has every category the plan asks for, each with entries', () => {
    for (const c of BLOCK_CATEGORIES) expect(BLOCK_LIBRARY.filter(e => e.category === c.id).length, c.id).toBeGreaterThanOrEqual(3);
    const ids = BLOCK_LIBRARY.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(BLOCK_LIBRARY.map(e => [e.id, e] as const))('%s: checks, runs on the CPU, draws a thumbnail and compiles', (_id, e) => {
    expect(e.blurb.length).toBeGreaterThan(10);
    expect(e.lines.length).toBeLessThanOrEqual(3);
    const b = blockFromEntry(e);
    const chk = checkBlock(b);
    expect(chk.ok, JSON.stringify([chk.errors, chk.lines.map(l => l.error)])).toBe(true);
    // Every exposed number is used by a line.
    expect(chk.unused).toEqual([]);
    for (const p of b.params) expect(p.value >= p.min && p.value <= p.max, p.name).toBe(true);
    // It moves at least some points (not a no-op) and gives numbers.
    const m = blockMap(b, 1);
    const pts: Array<[number, number]> = [[0.31, 0.17], [-0.6, 0.42], [0.83, -0.71], [-0.2, -0.9]];
    const moved = pts.some(([x, y]) => { const [a, c] = m(x, y); return Math.abs(a - x) + Math.abs(c - y) > 1e-4; });
    expect(moved).toBe(true);
    for (const [x, y] of pts) expect(m(x, y).every(Number.isFinite)).toBe(true);
    expect(renderWarpThumbnail(m, 24)).toHaveLength(24 * 24 * 4);
    expect(isLibraryBlock(b)).toBe(e);
    // Into the graph: an Expression Block with uv in, the lines, and the sliders.
    const s = emptyScene();
    s.space.push(newBlockOp('p1', b));
    s.layers.push(newShape('ring', 's1'));
    const { nodes, warnings } = compiles(s);
    expect(warnings).toEqual([]);
    const node = nodes.find(n => n.params._sbRole === 'p1')!;
    expect(node.type).toBe('exprNode');
    expect(node.params.outputType).toBe('vec2');
    expect((node.params.lines as unknown[]).length).toBe(e.lines.length * (e.times ?? 1));
    for (const p of e.params) expect(node.params[p.name]).toBe(p.value);
    expect(String(node.params.__comment)).toContain(e.blurb);
  });
});

describe('chaining and combining', () => {
  it('chains blocks: each block\'s uv feeds the next', () => {
    const s = emptyScene();
    s.space.push(newBlockOp('p1', blk([L('uv', '*=', '2')])));
    s.space.push(newBlockOp('p2', blk([L('uv.x', '+=', '1')])));
    s.space.push(newSpaceOp('mirror', 'p3'));
    s.layers.push(newShape('circle', 's1'));
    const { nodes } = compiles(s);
    const p1 = nodes.find(n => n.params._sbRole === 'p1')!;
    const p2 = nodes.find(n => n.params._sbRole === 'p2')!;
    expect(p2.inputs.uv.connection?.nodeId).toBe(p1.id);
    const p3 = nodes.find(n => n.params._sbRole === 'p3')!;
    expect(Object.values(p3.inputs).some(i => i.connection?.nodeId === p2.id)).toBe(true);
    // On the CPU: (x, y) → (2x + 1, 2y), then the mirror folds x.
    expect(stackMap(s.space)(-1, 0.25)).toEqual([1, 0.5]);
  });

  it.each(['add', 'subtract', 'multiply', 'blend'] as const)('combines two blocks with %s, and it compiles', mode => {
    const a = blk([L('uv.x', '+=', '0.5')]);
    const b = blk([L('uv', '*=', '2')]);
    const s = emptyScene();
    s.space.push(newCombineOp('p1', a, b, mode, 0.25));
    s.layers.push(newShape('circle', 's1'));
    const { nodes } = compiles(s);
    const comb = nodes.find(n => n.params._sbRole === 'p1')!;
    const A = nodes.find(n => n.params._sbRole === 'p1:a')!;
    const B = nodes.find(n => n.params._sbRole === 'p1:b')!;
    expect(comb.inputs.a.connection?.nodeId).toBe(A.id);
    expect(comb.inputs.b.connection?.nodeId).toBe(B.id);
    // Both blocks start from the same uv.
    expect(A.inputs.uv.connection).toEqual(B.inputs.uv.connection);
    expect(comb.inputs.uv.connection).toEqual(A.inputs.uv.connection);
    const want = { add: [2.5, 2], subtract: [0.5, 0], multiply: [3, 2], blend: [1.625, 1.25] }[mode];
    const got = combineMap(s.space[0].combine!)(1, 1);
    expect(got).toEqual(want);
    if (mode === 'blend') expect(comb.params.amount).toBe(0.25);
  });

  it('leaves a block that does not check out of the graph, with a warning', () => {
    const s = emptyScene();
    s.space.push(newBlockOp('p1', blk([L('uv.x', '+=', 'nope * 2')])));
    s.layers.push(newShape('circle', 's1'));
    const { nodes, warnings } = compiles(s);
    expect(nodes.some(n => n.params._sbRole === 'p1')).toBe(false);
    expect(warnings.join(' ')).toMatch(/left out: .*nope/);
  });
});

describe('random offers three choices', () => {
  it('gives three different blocks from different categories, sliders in range', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let k = 0; k < 20; k++) {
      const three = randomChoices(rand);
      expect(three).toHaveLength(3);
      expect(new Set(three.map(b => b.lib)).size).toBe(3);
      const cats = three.map(b => BLOCK_LIBRARY.find(e => e.id === b.lib)!.category);
      expect(new Set(cats).size).toBe(3);
      for (const b of three) {
        expect(checkBlock(b).ok).toBe(true);
        for (const p of b.params) expect(p.value >= p.min && p.value <= p.max).toBe(true);
      }
    }
  });
});

describe('recipes with blocks', () => {
  it('prints and reads library blocks, written blocks and combines', () => {
    const s = emptyScene();
    const rip = blockFromEntry(BLOCK_LIBRARY.find(e => e.id === 'ripple-rings')!);
    rip.params[0].value = 0.07;
    s.space.push(newBlockOp('p1', rip));
    s.space.push(newBlockOp('p2', blk([L('uv.x', '+=', 'amp * sin(y * 8 + t)'), L('uv', '*=', '1.2')], [{ name: 'amp', value: 0.1, min: 0, max: 1 }], 2)));
    s.space.push(newCombineOp('p3', blockFromEntry(BLOCK_LIBRARY.find(e => e.id === 'twirl')!), blk([L('uv', '=', 'abs(uv)')]), 'blend', 0.3));
    s.layers.push(newShape('circle', 's1'));
    const text = printRecipe2D(s);
    expect(text).toContain('space-block ripple-rings amp=0.07');
    expect(text).toContain('space-block {uv.x += amp * sin(y * 8 + t); uv *= 1.2} amp=0.1 times=2');
    expect(text).toContain('combine-blocks blend a=twirl b={uv = abs(uv)} amount=0.3');
    const back = parseRecipe2D(text);
    expect(back.errors).toEqual([]);
    expect(back.scene.space.map(o => o.kind)).toEqual(['block', 'block', 'combine']);
    expect(printRecipe2D(back.scene)).toBe(text);
    expect(back.scene.space[0].block!.params[0].value).toBe(0.07);
  });

  it('reports block mistakes in a recipe', () => {
    expect(parseRecipe2D('space-block ripples · circle').errors[0].message).toMatch(/isn't a block in the library/);
    expect(parseRecipe2D('space-block {uv.x += nope}').errors[0].message).toMatch(/“nope” isn't known/);
    expect(parseRecipe2D('space-block twirl amuont=2').errors[0].message).toMatch(/Did you mean “amount”/);
    expect(parseRecipe2D('combine-blocks add a=twirl').errors[0].message).toMatch(/needs both blocks/);
  });
});
