/**
 * Looped space blocks (docs/scene-builder-2d.md, "Looped blocks"): the eight library entries built on
 * the Expression Block's Loop mode. Each compiles and is live (Iterations a uniform on its node), its
 * orbit trap is the node's `trap` output and Look → Colour by trap wires it into the palette; they
 * chain, combine, mute (the trap too), save and print in a recipe, and draw a warped-grid thumbnail.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../build';
import { blockGlslLines, blockMap, checkBlock, MAX_LOOP_TIMES, type SpaceBlock } from '../blocks';
import { BLOCK_BY_ID, BLOCK_LIBRARY, blockFromEntry, isLibraryBlock } from '../blockLibrary';
import { emptyScene, newBlockOp, newCombineOp, newShape, type Scene2D } from '../spec';
import { parseRecipe2D, printRecipe2D } from '../recipe';
import { renderWarpThumbnail } from '../thumbnails';
import { parseSpaceBlock } from '../savedBlocks';
import { MUTE_PARAM } from '../../builders/mute';
import type { GraphNode } from '../../types/nodeGraph';

const LOOPED = ['kali-loop', 'ifs-kaleido', 'mandelbox', 'warp-loop', 'apollonian-loop', 'julia', 'spiral-repeats', 'log-polar-zoom'];

function scene(...blocks: SpaceBlock[]): Scene2D {
  const s = emptyScene();
  s.layers = [newShape('circle', 's1')];
  s.space = blocks.map((b, i) => newBlockOp(`p${i + 1}`, b));
  return s;
}

function compiles(sc: Scene2D) {
  const { nodes, warnings } = buildStandalone2D(sc);
  const r = compileGraph({ nodes });
  expect(r.success, String(r.errors)).toBe(true);
  expect(() => parser.parse(r.fragmentShader.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
  return { nodes, warnings, r };
}

const blockNodeOf = (nodes: GraphNode[], role: string) => nodes.find(n => n.type === 'exprNode' && n.params._sbRole === role)!;

describe('looped space blocks', () => {
  it('are all in the library, looped, checking', () => {
    for (const id of LOOPED) {
      const e = BLOCK_BY_ID[id];
      expect(e, id).toBeTruthy();
      expect(e.loop, id).toBe(true);
      const b = blockFromEntry(e);
      expect(checkBlock(b).ok, `${id}: ${JSON.stringify(checkBlock(b))}`).toBe(true);
      // Written once: the node's loop runs them
      expect(blockGlslLines(b)!.length).toBe(b.lines.filter(l => l.rhs.trim()).length);
    }
    expect(BLOCK_LIBRARY.filter(e => e.loop).map(e => e.id).sort()).toEqual([...LOOPED].sort());
  });

  it.each(LOOPED)('%s compiles with a live Iterations (a uniform), in Loop mode', id => {
    const b = { ...blockFromEntry(BLOCK_BY_ID[id]), trap: 'point' as const };
    const { nodes, r } = compiles(scene(b));
    const node = blockNodeOf(nodes, 'p1');
    expect(node.params.loop).toMatchObject({ on: true, max: MAX_LOOP_TIMES });
    expect(node.params.loopN).toBe(b.times);
    expect(r.paramBindings[`${node.id}::loopN`]).toMatch(/^u_p_/);
    expect(r.fragmentShader).toContain(`for (int i = 0; i < ${MAX_LOOP_TIMES}; i++) {`);
    // Its trap is an output of the node
    expect(node.outputs.trap?.type).toBe('float');
    expect(node.params.outputs).toEqual(['trap']);
  });

  it.each(LOOPED)('%s moves points on the CPU (finite) and draws a warped-grid thumbnail', id => {
    const b = blockFromEntry(BLOCK_BY_ID[id]);
    const m = blockMap(b, 0.5);
    const pts: Array<[number, number]> = [[0.31, -0.22], [0.9, -0.7], [-0.05, 0.08]];
    for (const [px, py] of pts) { const [x, y] = m(px, py); expect(Number.isFinite(x) && Number.isFinite(y), `${id} → ${x}, ${y}`).toBe(true); }
    expect(pts.some(([px, py]) => { const [x, y] = m(px, py); return Math.abs(x - px) + Math.abs(y - py) > 1e-4; })).toBe(true);
    const px = renderWarpThumbnail(m, 24);
    expect(px.length).toBe(24 * 24 * 4);
  });

  it('Colour by trap wires the last looped block’s trap output into the palette', () => {
    const sc = scene(blockFromEntry(BLOCK_BY_ID['ifs-kaleido']), { ...blockFromEntry(BLOCK_BY_ID.julia), trap: 'ring' });
    sc.look.colour.by = 'trap';
    const { nodes, warnings } = compiles(sc);
    const julia = blockNodeOf(nodes, 'p2');
    const readers = nodes.filter(n => Object.values(n.inputs).some(s => s.connection?.nodeId === julia.id && s.connection.outputKey === 'trap'));
    expect(readers.length).toBeGreaterThan(0);
    expect(warnings.some(w => /Colour by trap/.test(w))).toBe(false);
    // The trap line: min over the passes, then a shade
    const loop = julia.params.loop as { before: Array<{ lhs: string }>; after: Array<{ rhs: string }> };
    expect(loop.before.map(l => l.lhs)).toContain('float trap');
    expect(loop.after[0].rhs).toBe('exp(-3.0 * trap)');
    expect((julia.params.lines as Array<{ rhs: string }>).at(-1)!.rhs).toBe('min(trap, abs(length(uv) - 1.0))');
  });

  it('Colour by trap without a trap falls back, with a warning', () => {
    const sc = scene(blockFromEntry(BLOCK_BY_ID['ifs-kaleido']));
    sc.look.colour.by = 'trap';
    const { warnings } = compiles(sc);
    expect(warnings.some(w => /Colour by trap needs/.test(w))).toBe(true);
  });

  it('chains and combines with ordinary blocks', () => {
    const sc = scene(blockFromEntry(BLOCK_BY_ID.mandelbox), blockFromEntry(BLOCK_BY_ID.twirl));
    sc.space.push(newCombineOp('p3', blockFromEntry(BLOCK_BY_ID['kali-loop']), blockFromEntry(BLOCK_BY_ID['spiral-repeats']), 'blend', 0.4));
    sc.look.colour.by = 'trap';
    const { nodes } = compiles(sc);
    expect(nodes.filter(n => n.params.loop).length).toBe(3);
    // The combine's A side has the trap (Kali loop's default): the palette reads it
    const a = blockNodeOf(nodes, 'p3:a');
    expect(nodes.some(n => Object.values(n.inputs).some(s => s.connection?.nodeId === a.id && s.connection.outputKey === 'trap'))).toBe(true);
  });

  it('mutes live: the gate passes uv through and the trap goes to 0', () => {
    const sc = scene({ ...blockFromEntry(BLOCK_BY_ID.julia) });
    sc.space[0].muted = true;
    sc.look.colour.by = 'trap';
    const { nodes, r } = compiles(sc);
    const node = blockNodeOf(nodes, 'p1');
    expect(node.params[MUTE_PARAM]).toBe(1);
    expect(r.fragmentShader).toMatch(/float \w+_mt_trap = mix\(\w+_trap, 0\.0, u_\w+_mute\);/);
  });

  it('saves (My blocks) and prints in a recipe with its trap and Iterations', () => {
    const b: SpaceBlock = { ...blockFromEntry(BLOCK_BY_ID.mandelbox), times: 20, trap: 'point' };
    const back = parseSpaceBlock(JSON.parse(JSON.stringify(b)))!;
    expect(back).toMatchObject({ loop: true, trap: 'point', times: 20 });
    expect(isLibraryBlock(back)?.id).toBe('mandelbox');
    const sc = scene(b);
    const text = printRecipe2D(sc);
    expect(text).toContain('space-block mandelbox');
    expect(text).toContain('times=20');
    expect(text).toContain('trap=point');
    const re = parseRecipe2D(text);
    expect(re.errors).toEqual([]);
    const rb = re.scene.space[0].block!;
    expect(rb).toMatchObject({ loop: true, trap: 'point', times: 20, lib: 'mandelbox' });
    // A written looped block: loop=on and its own names (uv0, fi, k)
    const w = parseRecipe2D('space-block {uv = abs(uv) * 1.2 - uv0 * k} loop=on trap=cross times=30\ncircle');
    expect(w.errors).toEqual([]);
    expect(w.scene.space[0].block).toMatchObject({ loop: true, trap: 'cross', times: 30 });
    expect(parseRecipe2D(printRecipe2D(w.scene)).scene.space[0].block).toMatchObject({ loop: true, trap: 'cross', times: 30 });
  });

  it('keeps the loop’s names for a looped block only', () => {
    const plain: SpaceBlock = { name: 'x', lines: [{ target: 'uv', op: '+=', rhs: 'uv0 * k' }], params: [], times: 1 };
    expect(checkBlock(plain).ok).toBe(false);
    expect(checkBlock({ ...plain, loop: true }).ok).toBe(true);
    expect(checkBlock({ ...plain, loop: true, params: [{ name: 'k', value: 1, min: 0, max: 2 }] }).errors[0]).toMatch(/loop’s own name/);
  });
});
