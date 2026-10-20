/**
 * Texture Lab (docs/texture-lab.md): every block builds its node and compiles, a Pass goes in only where a block reads
 * round each pixel of a computed picture, rebuilds keep ids by role, and a build reads back as the spec it was.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { passBudget } from '../../compiler/passBudget';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { BLOCKS } from '../blocks';
import { blankSpec, newBlock, type TextureLabSpec } from '../spec';
import { applyTextureLab, blockPasses, findTxBuild, labOfBuild, specOfBuild, txBuildIds } from '../apply';

let counter = 0;
const nextId = () => `n${++counter}`;
const outputOnly = (): GraphNode[] => [n('output', 'out', 800, 0)];

function withBlocks(types: string[], source: TextureLabSpec['source'] = { kind: 'room' }): TextureLabSpec {
  const spec = blankSpec(source);
  for (const t of types) spec.blocks.push(newBlock(spec, t));
  return spec;
}

const build = (spec: TextureLabSpec, graph: GraphNode[] = outputOnly(), sourceId?: string | null, preview?: { split?: number | null; upTo?: string | null }) =>
  applyTextureLab(graph, spec, { nextId, sourceId, preview });

const roleIds = (nodes: GraphNode[]) => Object.fromEntries(nodes.filter(x => typeof x.params._txRole === 'string').map(x => [x.params._txRole as string, x.id]));

describe('Texture Lab blocks', () => {
  it.each(BLOCKS.map(b => [b.type]))('%s builds on the photo and compiles, first and after a computed block', type => {
    for (const types of [[type], ['textureLevels', type]]) {
      const r = build(withBlocks(types));
      const c = compileGraph({ nodes: r.nodes });
      expect(c.errors ?? [], `${types.join(' → ')}: ${(c.errors ?? []).join('; ')}`).toEqual([]);
      expect(c.success).toBe(true);
      const main = r.nodes.find(x => x.params._txRole === `b${types.length}:main`)!;
      expect(main.type).toBe(type);
    }
  });

  it('builds on the Ball action clip too', () => {
    const r = build(withBlocks(['glowTexture', 'textureFeedback'], { kind: 'ball' }));
    expect(r.nodes.find(x => x.id === r.sourceId)?.type).toBe('videoInput');
    expect(compileGraph({ nodes: r.nodes }).success).toBe(true);
  });
});

describe('Texture Lab passes', () => {
  it('a texture block on the source needs no Pass; after a computed block it gets one', () => {
    const first = build(withBlocks(['blurTexture']));
    expect(first.nodes.some(x => x.params._txRole === 'b1:pass')).toBe(false);
    expect(passBudget(first.nodes).used).toBe(0);
    const second = build(withBlocks(['textureLevels', 'blurTexture']));
    const pass = second.nodes.find(x => x.params._txRole === 'b2:pass');
    expect(pass?.type).toBe('pass');
    expect(passBudget(second.nodes).used).toBe(1);
    expect(blockPasses(second.nodes, second.sourceId)).toEqual({ b2: 1 });
  });

  it('a per-pixel block never gets a Pass', () => {
    const r = build(withBlocks(['blurTexture', 'textureLevels', 'curves', 'threshold']));
    expect(passBudget(r.nodes).used).toBe(0);
  });

  it('counts each block\'s own passes: Feedback 1, Optical Flow 2, a jump flood 1', () => {
    const r = build(withBlocks(['textureFeedback', 'opticalFlow', 'distanceShape']));
    const per = blockPasses(r.nodes, r.sourceId);
    expect(per.b1).toBe(1);
    expect(per.b2).toBe(3); // its Pass (after Feedback) and its own two
    expect(per.b3).toBe(1);
  });
});

describe('Texture Lab rebuilds and reads back', () => {
  it('keeps ids by role, rewires a reorder, and reads the spec back', () => {
    const spec = withBlocks(['edgesTexture', 'textureLevels', 'glowTexture']);
    spec.blocks[1].amount = 0.4;
    spec.blocks[2].muted = true;
    const a = build(spec);
    const idsA = roleIds(a.nodes);
    const back = specOfBuild(a.nodes, a.sourceId)!;
    expect(back.blocks.map(b => b.type)).toEqual(['edgesTexture', 'textureLevels', 'glowTexture']);
    expect(back.blocks[1].amount).toBeCloseTo(0.4);
    expect(back.blocks[2].muted).toBe(true);
    // A setting changed on a card is what the builder shows.
    const edited = a.nodes.map(x => (x.id === idsA['b1:main'] ? { ...x, params: { ...x.params, strength: 5 } } : x));
    expect(specOfBuild(edited, a.sourceId)!.blocks[0].params.strength).toBe(5);
    // Reorder: Glow first.
    const moved = { ...back, blocks: [back.blocks[2], back.blocks[0], back.blocks[1]] };
    const b = build(moved, a.nodes, a.sourceId);
    const idsB = roleIds(b.nodes);
    for (const role of ['source', 'b1:main', 'b2:main', 'b3:main', 'b3:mix']) expect(idsB[role]).toBe(idsA[role]);
    expect(b.nodes.filter(x => x.type === 'output')).toHaveLength(1);
    expect(compileGraph({ nodes: b.nodes }).success).toBe(true);
    // Glow now reads the source (no Pass); Edges reads a computed picture (a Pass).
    expect(idsB['b3:pass']).toBeUndefined();
    expect(idsB['b1:pass']).toBeDefined();
    expect(labOfBuild(b.nodes, idsB['b2:mix'])).toBe(a.sourceId);
    expect(txBuildIds(b.nodes, a.sourceId).sort()).toEqual(Object.values(idsB).sort());
  });

  it('the preview (split, up to a block) is the builder\'s only: a build without it has none of its nodes', () => {
    const spec = withBlocks(['edgesTexture', 'glowTexture']);
    const p = build(spec, outputOnly(), null, { split: 0.5, upTo: 'b1' });
    expect(compileGraph({ nodes: p.nodes }).success).toBe(true);
    const out = p.nodes.find(x => x.type === 'output')!;
    const cmp = p.nodes.find(x => x.params._txRole === 'view:cmp')!;
    expect(out.inputs.color.connection?.nodeId).toBe(cmp.id);
    expect(cmp.inputs.after.connection?.nodeId).toBe(roleIds(p.nodes)['b1:mix']);
    const done = build(spec, p.nodes, p.sourceId);
    expect(done.nodes.some(x => String(x.params._txRole ?? '').startsWith('view:'))).toBe(false);
    expect(done.nodes.find(x => x.type === 'output')!.inputs.color.connection?.nodeId).toBe(roleIds(done.nodes)['b2:mix']);
  });

  it('a node of yours as the source stays yours', () => {
    const graph: GraphNode[] = [n('textureInput', 'mine', 0, 0, { label: 'My picture' }), ...outputOnly()];
    const r = build(withBlocks(['blurTexture'], { kind: 'node', nodeId: 'mine', name: 'My picture' }), graph);
    expect(r.sourceId).toBe('mine');
    expect(findTxBuild(r.nodes, 'mine')).not.toBeNull();
    expect(txBuildIds(r.nodes, 'mine')).not.toContain('mine');
    // Back to a built-in photo: your node stays, without the builder's keys.
    const back = build(withBlocks(['blurTexture']), r.nodes, 'mine');
    const mine = back.nodes.find(x => x.id === 'mine')!;
    expect(mine.params.textureLab).toBeUndefined();
    expect(back.sourceId).not.toBe('mine');
  });
});
