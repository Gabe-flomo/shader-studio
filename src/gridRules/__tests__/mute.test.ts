/**
 * Muting in the Grid Rules builder (docs/grid-rules.md "Muting", builders/mute.ts). A stacked card,
 * a stencil or a block is muted by its `off` switch (the builders' ⊘): it stays in the spec and the
 * text, and is left out of the step (the fallback: Grid Rules bake into their own Pass, where the
 * mute gate isn't wired). Muted equals the chain without it, on the GPU text and on the CPU step.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { n } from '../../store/graphBuilder';
import { COUNT_PRESETS, GRID_DEFAULTS, gridShape, presetPatch } from '../spec';
import { BLOCK_PRESETS, PATTERN_PRESETS, readBlocks, readPatterns } from '../stencils';
import { newStackRule, readStack, soloOff, type StackKind, type StackRule } from '../stack';
import { cpuBoard, cpuStep, type CpuBoard } from '../cpu';
import { compileGraph } from '../../compiler/graphCompiler';
import { parseGrid, printGrid } from '../../lang/dialects/grid';
import { MUTE_PARAM } from '../../builders/mute';

type P = Record<string, unknown>;
const card = (kind: StackKind, o: Partial<StackRule> = {}): StackRule => ({ ...newStackRule(kind), ...o });
const life = (stack: unknown[]): P => ({ ...GRID_DEFAULTS, afterglow: 0, ruleType: 'count', ...presetPatch(COUNT_PRESETS.life), stack, rate: 1, steps: 1 });
const compile = (params: P) => {
  const r = compileGraph({ nodes: [n('gridRules', 'node_3', 0, 0, { label: 'Test', ...params }), n('output', 'node_9', 0, 0, {}, { color: ['node_3', 'color'] })] });
  expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  return r;
};
const shaderText = (params: P) => {
  const r = compile(params);
  return [r.fragmentShader, ...(r.passes ?? []).map(p => p.fragmentShader)].join('\n----\n');
};
function seeded(w: number, h: number, seed: number): CpuBoard {
  const B = cpuBoard(w, h);
  let s = seed;
  for (let i = 0; i < w * h; i++) { s = (s * 1103515245 + 12345) % 2147483648; B.a[i] = s / 2147483648 < 0.35 ? 1 : 0; }
  B.step = 0;
  return B;
}
const run = (params: P, steps = 6) => { let B = seeded(24, 16, 7); for (let k = 0; k < steps; k++) B = cpuStep(params, B); return Array.from(B.a); };

describe('Grid Rules muting', () => {
  it('a muted stacked card equals the chain without it (CPU step and GPU text)', () => {
    const drift = card('drift', { chance: 1 }), crowd = card('crowd', { lo: 4 });
    const muted = life([drift, { ...crowd, off: true }]);
    const without = life([drift]);
    expect(gridShape(muted).stack).toEqual(gridShape(without).stack);
    expect(run(muted)).toEqual(run(without));
    expect(run(life([drift, crowd]))).not.toEqual(run(without));
    expect(shaderText(muted)).toBe(shaderText(without));
  });

  it('a muted stencil or block is left out of the step', () => {
    const ww = PATTERN_PRESETS.wireworld.params.patterns as P[];
    const base = { ...GRID_DEFAULTS, ...presetPatch(PATTERN_PRESETS.wireworld), ruleType: 'patterns' };
    const mutedP = { ...base, patterns: ww.map((r, i) => (i === 0 ? { ...r, off: true } : r)) };
    expect(shaderText(mutedP)).toBe(shaderText({ ...base, patterns: ww.slice(1) }));
    const sand = BLOCK_PRESETS.sand.params.blocks as P[];
    const bBase = { ...GRID_DEFAULTS, ...presetPatch(BLOCK_PRESETS.sand), ruleType: 'blocks' };
    expect(gridShape({ ...bBase, blocks: sand.map((r, i) => (i === 1 ? { ...r, off: true } : r)) }).blocks.filter(r => !r.off))
      .toEqual(gridShape({ ...bBase, blocks: sand.filter((_, i) => i !== 1) }).blocks);
  });

  it('never-muted builds carry no mute gate and no off flag', () => {
    const r = compile(life([card('drift'), card('explode')]));
    expect(JSON.stringify(r)).not.toContain(MUTE_PARAM);
    expect(readStack([card('drift')])[0]).not.toHaveProperty('off');
  });

  it('a saved `muted: true` reads as off (stack, stencils, blocks); `off` keeps reading', () => {
    expect(readStack([{ ...card('drift'), muted: true }])[0].off).toBe(true);
    expect(readStack([{ ...card('drift'), off: true }])[0].off).toBe(true);
    expect(readPatterns([{ cells: [], becomes: 1, muted: true }])[0].off).toBe(true);
    expect(readBlocks([{ before: [], after: [], muted: true }])[0].off).toBe(true);
  });

  it('Alt-click solos a card; soloing it again turns them all back on; the settings stay', () => {
    const list = [card('drift'), card('crowd', { off: true }), card('cluster')];
    const solo = soloOff(list, 1);
    expect(solo.map(r => !!r.off)).toEqual([true, false, true]);
    expect(solo[1]).not.toHaveProperty('off');
    expect(soloOff(solo, 1).map(r => !!r.off)).toEqual([false, false, false]);
    expect(soloOff(solo, 1).map(r => r.kind)).toEqual(['drift', 'crowd', 'cluster']);
    expect(solo[0]).toEqual({ ...list[0], off: true });
  });

  it('text: a muted card prints @off and round-trips; `muted` and @muted read as off', () => {
    const P = life([card('drift', { dir: 1 }), card('crowd', { lo: 4, move: true, off: true })]);
    const text = printGrid(P, { pretty: true });
    expect(text).toContain('then crowd at=4 move @off');
    const back = parseGrid(text);
    expect(back.errors).toEqual([]);
    expect(readStack(back.params.stack)).toEqual(readStack(P.stack));
    expect(printGrid(back.params, { pretty: true })).toBe(text);

    for (const src of ['life · then crowd at=4 muted', 'life · then crowd at=4 @muted', 'life · then crowd muted at=4']) {
      const r = parseGrid(src);
      expect(r.errors, src).toEqual([]);
      expect(readStack(r.params.stack)[0].off, src).toBe(true);
    }
    const st = parseGrid('grid patterns states=4 · stencil .../.1./... → 2 muted · stencil .../.2./... → 3 @muted');
    expect(st.errors).toEqual([]);
    expect(readPatterns(st.params.patterns).map(r => !!r.off)).toEqual([true, true]);
    const bl = parseGrid('grid blocks states=3 · block 11/00 → 00/11 chance=0.5 muted');
    expect(bl.errors).toEqual([]);
    expect(readBlocks(bl.params.blocks)[0]).toMatchObject({ off: true, chance: 0.5 });
  });
});
